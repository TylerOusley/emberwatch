import { plotEntrance } from '../shared/access.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PLOTS, plotFront, canStand, plotSolids, plotSolid, plotBedPoint, groundHeight } from '../shared/world.js';
import { CHURCH, RECRUIT } from '../shared/defense.js';
import { careAction, careTick, careNight, ensureCare, cancelCarry, cancelTreatment, careSnapshot, guardPathFor, tickDefenseAttack } from '../server/care-defense.js';

function fixture(building = 'church', id = 'west-1') {
  const site = PLOTS.find(p => p.id === id), door = building === 'church' ? plotBedPoint(site, 0) : plotEntrance(site, building);
  const player = name => ({ id: name, name, role: name === 'owner' ? 'priest' : 'villager', online: true, downed: false, hp: 60, maxHp: 100, wallet: 500, x: door.x, z: door.z, inventory: {}, durability: { hammer: 100 }, tiers: { hammer: 'iron' }, tool: 'hammer', repairBonus: 0, jobBonus: 0 });
  const owner = player('owner'), visitor = player('visitor'), casualty = player('casualty');
  const plot = { id, ownerId: owner.id, building, level: 1, hp: 300, maxHp: 300, storage: { wheat: 0, timber: 100, stone: 100, iron: 100, coal: 10, arrows: 10 } };
  const village = { id: 'village', day: 1, phase: 'day', clock: 0, treasury: 2500, stock: { timber: 20, stone: 20 }, players: { owner, visitor, casualty }, plots: [plot], guards: [], zombies: [], barracks: { wheat: 10 }, gate: { hp: 1200 } };
  const hits = [], saved = [];
  const sim = { inputs: new Map(), store: { saveVillage(v) { saved.push(v.id); } }, notice() {}, awardIncome(v, p, amount) { p.wallet += amount; }, hitZombie(v, zombie, damage, player) {
    hits.push({ id: zombie.id, playerId: player?.id, damage });
    zombie.hp = Math.max(0, zombie.hp - damage);
    if (!zombie.hp && player?.online && player.role === 'guard') player.jobBonus++;
  }, stepNpc(entity, destination, speed, dt) {
    const dx = destination.x - entity.x, dz = destination.z - entity.z, length = Math.hypot(dx, dz);
    const amount = Math.min(length, speed * dt);
    entity.x += dx / length * amount; entity.z += dz / length * amount;
  } };
  ensureCare(village);
  return { sim, village, plot, site, owner, visitor, casualty, hits, saved };
}

test('church healing charges once, pays owner on completion and grants no priest performance bonus', () => {
  const { sim, village, plot, owner, visitor } = fixture();
  careAction(sim, village, visitor, { kind: 'churchTreat', plotId: plot.id });
  assert.equal(visitor.wallet, 500 - CHURCH.healFee);
  assert.equal(owner.wallet, 500, 'payment is held until treatment finishes');
  assert.equal(visitor.bedPlotId, plot.id);
  assert.throws(() => careAction(sim, village, visitor, { kind: 'churchTreat', plotId: plot.id }), /Leave your church bed/);
  village.clock = CHURCH.healSeconds - .1;
  careTick(sim, village, .1);
  assert.equal(visitor.hp, 60);
  village.clock += .1;
  careTick(sim, village, .1);
  careTick(sim, village, .1);
  assert.equal(visitor.hp, 100); assert.equal(visitor.bedPlotId, null);
  assert.equal(owner.wallet, 500 + CHURCH.healFee); assert.equal(owner.jobBonus, 0);
  assert.equal(owner.cycleServiceIncome, CHURCH.healFee);
});

test('any dwarf can carry a casualty to church; revival crosses dawn without auto respawning or losing inventory', () => {
  const { sim, village, plot, visitor, casualty } = fixture();
  casualty.hp = 0; casualty.downed = true; casualty.inventory = { iron: 15 }; casualty.respawnAvailable = false;
  careAction(sim, village, visitor, { kind: 'carryPlayer', targetId: casualty.id });
  visitor.x += .5; careTick(sim, village, .05);
  assert.equal(casualty.x, visitor.x); assert.equal(casualty.carriedBy, visitor.id);
  careAction(sim, village, visitor, { kind: 'churchTreat', plotId: plot.id, targetId: casualty.id });
  assert.equal(visitor.carryingId, null); assert.equal(casualty.carriedBy, null);
  assert.equal(visitor.wallet, 500 - CHURCH.reviveFee);
  village.day++; village.phase = 'day'; casualty.respawnAvailable = true; village.clock = 19;
  careTick(sim, village, .05);
  assert.equal(casualty.downed, true); assert.equal(casualty.respawnAvailable, true);
  assert.equal(careSnapshot(village).beds[0].patients[0].remaining, 1);
  village.clock = 20; careTick(sim, village, .05);
  assert.equal(casualty.hp, CHURCH.reviveHp); assert.equal(casualty.downed, false); assert.equal(casualty.respawnAvailable, false);
  assert.equal(casualty.wallet, 500); assert.equal(casualty.inventory.iron, 15);
});

test('carry and treatment cleanup prevents stuck dwarfs and refunds only once', () => {
  const { sim, village, plot, visitor, casualty } = fixture();
  casualty.hp = 0; casualty.downed = true;
  careAction(sim, village, visitor, { kind: 'carryPlayer', targetId: casualty.id });
  visitor.online = false; cancelCarry(village, visitor);
  assert.equal(casualty.carriedBy, null); assert.equal(visitor.carryingId, null);
  visitor.online = true;
  careAction(sim, village, visitor, { kind: 'churchTreat', plotId: plot.id });
  visitor.online = false; cancelTreatment(village, visitor); cancelTreatment(village, visitor);
  assert.equal(visitor.wallet, 500); assert.equal(visitor.bedPlotId, null); assert.equal(plot.patients.length, 0);
  visitor.online = true;
  careAction(sim, village, visitor, { kind: 'churchTreat', plotId: plot.id });
  plot.hp = 0; careTick(sim, village, .05);
  assert.equal(visitor.wallet, 500); assert.equal(visitor.bedPlotId, null);
});

test('church ownership, beds, and carrying restrictions cannot be bypassed by requests', () => {
  const { sim, village, plot, owner, visitor, casualty } = fixture();
  assert.throws(() => careAction(sim, village, visitor, { kind: 'upgradeDefense', plotId: plot.id }), /owner/);
  assert.throws(() => careAction(sim, village, visitor, { kind: 'churchTreat', plotId: plot.id, targetId: casualty.id }), /Carry the downed/);
  visitor.mountedHorseId = 'horse';
  assert.throws(() => careAction(sim, village, visitor, { kind: 'churchTreat', plotId: plot.id }), /Dismount/);
  visitor.mountedHorseId = null;
  careAction(sim, village, visitor, { kind: 'churchTreat', plotId: plot.id });
  careAction(sim, village, owner, { kind: 'churchTreat', plotId: plot.id });
  assert.throws(() => careAction(sim, village, casualty, { kind: 'churchTreat', plotId: plot.id }), /occupied/);
  assert.equal(casualty.wallet, 500, 'unavailable bed never charges');
});

test('each troop eats from its own barracks once per night, including late deliveries and replacements', () => {
  const { sim, village, plot, owner } = fixture('barracks');
  owner.role = 'guard'; village.phase = 'night'; plot.storage.wheat = 1;
  careAction(sim, village, owner, { kind: 'recruitGuard', plotId: plot.id });
  careAction(sim, village, owner, { kind: 'recruitGuard', plotId: plot.id });
  assert.equal(village.guards[0].hungry, false); assert.equal(village.guards[1].hungry, true);
  assert.equal(plot.storage.wheat, 0); assert.equal(village.barracks.wheat, 10, 'owned guards do not take public barracks food');
  plot.storage.wheat = 5; careTick(sim, village, .05); careNight(sim, village); careTick(sim, village, .05);
  assert.equal(plot.storage.wheat, 4, 'only the hungry troop consumes a late wheat delivery');
  village.guards[0].hp = 0;
  careTick(sim, village, .05);
  village.clock += RECRUIT.respawnSeconds;
  careTick(sim, village, .05);
  assert.equal(plot.storage.wheat, 3, 'replacement needs its own ration');
  village.day++; careNight(sim, village); careNight(sim, village);
  assert.equal(plot.storage.wheat, 1, 'two living troops each eat once on the new night');
});

test('barracks recruitment is finite, limited to three, and removed with the building', () => {
  const { sim, village, plot, owner, visitor } = fixture('barracks');
  owner.role = 'guard';
  assert.throws(() => careAction(sim, village, visitor, { kind: 'recruitGuard', plotId: plot.id }), /owner/);
  for (let i = 0; i < 3; i++) careAction(sim, village, owner, { kind: 'recruitGuard', plotId: plot.id });
  assert.equal(owner.wallet, 500 - RECRUIT.gold * 3);
  assert.equal(plot.storage.iron, 100 - RECRUIT.resources.iron * 3);
  assert.throws(() => careAction(sim, village, owner, { kind: 'recruitGuard', plotId: plot.id }), /three recruited/);
  for (const guard of village.guards) {
    assert.ok(canStand(guard.x, guard.z, .4, plotSolids(village.plots)), 'recruits start outside the building');
    assert.ok(guardPathFor(village, guard).some(p => p.x === 0 && p.z === 25), 'marching route passes through the gate');
  }
  plot.building = 'house'; careTick(sim, village, .05);
  assert.equal(village.guards.length, 0);
});

test('archer towers fire without ammunition and pass the authentic owner to combat credit', () => {
  const { sim, village, plot, owner, site, hits } = fixture('archer_tower', 'outpost-1');
  owner.role = 'guard'; plot.storage.arrows = 0;
  village.zombies = [{ id: 'zombie', x: site.x + 10, z: site.z, hp: 15 }];
  careTick(sim, village, .05);
  assert.equal(plot.storage.arrows, 0); assert.equal(village.zombies[0].hp, 0);
  assert.equal(hits[0].playerId, owner.id); assert.equal(owner.jobBonus, 1);
  village.zombies.push({ id: 'second', x: site.x + 10, z: site.z, hp: 15 });
  owner.online = false;
  careTick(sim, village, 5);
  assert.equal(hits.length, 2); assert.equal(owner.jobBonus, 1, 'offline ownership does not earn a bonus');
  assert.equal(plot.storage.arrows, 0, 'empty arrow storage never prevents a shot');
});

test('cannons consume both ammunition ingredients; ruined towers stop firing', () => {
  const { sim, village, plot, site, hits } = fixture('cannon', 'outpost-1');
  village.zombies = [{ id: 'a', x: site.x + 10, z: site.z, hp: 100 }, { id: 'b', x: site.x + 11, z: site.z, hp: 100 }];
  plot.storage.stone = 0; careTick(sim, village, 1); assert.equal(hits.length, 0); assert.equal(plot.storage.coal, 10);
  plot.storage.stone = 2; careTick(sim, village, 1);
  assert.equal(hits.length, 2); assert.equal(plot.storage.stone, 1); assert.equal(plot.storage.coal, 9);
  assert.equal(plot.lastShot.targetId, 'a'); assert.equal(plot.lastShot.id, `${plot.id}:1`);
  assert.deepEqual([plot.lastShot.x, plot.lastShot.y, plot.lastShot.z], [village.zombies[0].x, groundHeight(village.zombies[0].x, village.zombies[0].z) + .9, village.zombies[0].z]);
  assert.equal(plot.lastShot.firedAt, village.clock);
  const impact = { ...plot.lastShot }; village.zombies[0].x += 3;
  assert.equal(plot.lastShot.x, impact.x, 'saved impact stays at the damaged target point after it moves');
  plot.hp = 10;
  const zombie = { id: 'siege', x: site.x + plotSolid(site, plot.building).w / 2 + .8, z: site.z, hp: 100, cooldown: 0, speed: 2 };
  assert.equal(tickDefenseAttack(sim, village, zombie, .05), true); assert.equal(plot.hp, 0);
  careTick(sim, village, 5); assert.equal(hits.length, 2);
});

test('priest revivals release carried dwarfs and supersede bed treatment without double charging', () => {
  const { sim, village, plot, visitor, casualty, owner } = fixture();
  casualty.hp = 0; casualty.downed = true;
  careAction(sim, village, visitor, { kind: 'carryPlayer', targetId: casualty.id });
  casualty.hp = 45; casualty.downed = false;
  careTick(sim, village, .05);
  assert.equal(visitor.carryingId, null); assert.equal(casualty.carriedBy, null);
  casualty.hp = 0; casualty.downed = true;
  careAction(sim, village, visitor, { kind: 'carryPlayer', targetId: casualty.id });
  careAction(sim, village, visitor, { kind: 'churchTreat', plotId: plot.id, targetId: casualty.id });
  casualty.hp = 45; casualty.downed = false;
  careTick(sim, village, .05); village.clock = 30; careTick(sim, village, .05);
  assert.equal(casualty.hp, 45); assert.equal(casualty.bedPlotId, null);
  assert.equal(visitor.wallet, 500); assert.equal(owner.wallet, 500);
  casualty.hp = 0; casualty.downed = true;
  visitor.x = casualty.x; visitor.z = casualty.z;
  careAction(sim, village, visitor, { kind: 'carryPlayer', targetId: casualty.id });
  careAction(sim, village, visitor, { kind: 'churchTreat', plotId: plot.id, targetId: casualty.id });
  careAction(sim, village, casualty, { kind: 'churchLeave' });
  assert.equal(casualty.downed, true); assert.equal(casualty.bedPlotId, null); assert.equal(visitor.wallet, 500);
});

test('archer fire respects obstacles and preserves any arrows left in storage', () => {
  const { sim, village, plot, site, hits } = fixture('archer_tower', 'outpost-1');
  village.zombies = [{ id: 'hidden', x: site.x + 10, z: site.z, hp: 100 }];
  sim.clearAttack = () => false;
  careTick(sim, village, .05);
  assert.equal(plot.storage.arrows, 10); assert.equal(hits.length, 0);
  sim.clearAttack = (v, from, target) => {
    assert.ok(Math.abs(from.x - site.x) > plotSolid(site, plot.building).w / 2, 'shot starts outside the tower collision footprint');
    return true;
  };
  careTick(sim, village, .05);
  assert.equal(plot.storage.arrows, 10); assert.equal(hits.length, 1);
});

test('plot repairs use hammer tier, real shared materials and the same capped dawn bonus', () => {
  const { sim, village, plot, visitor } = fixture('archer_tower', 'outpost-1');
  plot.hp = 10; careAction(sim, village, visitor, { kind: 'repairPlot', plotId: plot.id });
  assert.equal(plot.hp, 90); assert.equal(visitor.durability.hammer, 99);
  assert.equal(village.stock.timber, 19); assert.equal(village.stock.stone, 19); assert.equal(visitor.repairBonus, 1);
  visitor.repairBonus = 10;
  const gold = village.treasury; careAction(sim, village, visitor, { kind: 'repairPlot', plotId: plot.id });
  assert.equal(visitor.repairBonus, 10); assert.equal(village.treasury, gold);
  village.stock.stone = 0;
  assert.throws(() => careAction(sim, village, visitor, { kind: 'repairPlot', plotId: plot.id }), /timber and stone/);
  assert.equal(plot.hp, 170);
});

test('fallen recruits retain their paid slots, wait for wheat, and respawn without a second night ration', () => {
  const { sim, village, plot, owner } = fixture('barracks');
  owner.role = 'guard'; village.phase = 'night'; plot.storage.wheat = 3;
  for (let i = 0; i < RECRUIT.capacity; i++) careAction(sim, village, owner, { kind: 'recruitGuard', plotId: plot.id });
  const troop = village.guards[0], paidWallet = owner.wallet;
  troop.hp = 0;
  careTick(sim, village, .05);
  assert.throws(() => careAction(sim, village, owner, { kind: 'recruitGuard', plotId: plot.id }), /three recruited/);
  assert.equal(owner.wallet, paidWallet);
  let waiting = careSnapshot(village).guardReplacements[0];
  assert.equal(waiting.remaining, 30); assert.equal(waiting.waitingForWheat, true);
  village.clock = 50; careTick(sim, village, .05);
  assert.equal(troop.hp, 0, 'a replacement cannot appear without its own barracks wheat');
  assert.equal(village.barracks.wheat, 10, 'public wheat is never borrowed for an owned barracks');
  plot.storage.wheat = 2; careTick(sim, village, .05);
  const replacement = village.guards.find(g => g.id === troop.id);
  assert.notEqual(replacement, troop, 'new navigation entity starts from its own door');
  assert.equal(replacement.hp, replacement.maxHp); assert.equal(replacement.slot, troop.slot);
  assert.equal(replacement.ownerId, owner.id); assert.equal(replacement.plotId, plot.id);
  assert.equal(replacement.roadIndex, 0); assert.equal(replacement.cooldown, 0);
  assert.ok(canStand(replacement.x, replacement.z, .4, plotSolids(village.plots)));
  assert.equal(plot.storage.wheat, 1);
  careTick(sim, village, 5); careNight(sim, village);
  assert.equal(plot.storage.wheat, 1, 'respawn ration also feeds this deployment for the current night');
  assert.equal(village.guards.length, 3); assert.equal(owner.wallet, paidWallet);
  assert.equal(careSnapshot(village).guardReplacements.length, 0);
});

test('barracks never fill unpaid slots and destroyed or converted barracks cancel replacements', () => {
  for (const removal of ['destroy', 'convert']) {
    const { sim, village, plot, owner } = fixture('barracks');
    owner.role = 'guard'; plot.storage.wheat = 30;
    village.clock = 100; careTick(sim, village, 100);
    assert.equal(village.guards.length, 0, 'empty barracks cannot recruit for free');
    careAction(sim, village, owner, { kind: 'recruitGuard', plotId: plot.id });
    village.guards[0].hp = 0; careTick(sim, village, .05);
    if (removal === 'destroy') plot.hp = 0;
    else plot.building = 'house';
    village.clock += 31; careTick(sim, village, .05);
    assert.equal(village.guards.length, 0); assert.equal(plot.storage.wheat, 30);
    assert.equal(careSnapshot(village).guardReplacements.length, 0);
  }
});

test('roster migration preserves living recruits and newest casualties without duplicating paid slots', () => {
  const { village, plot } = fixture('barracks');
  village.guards = [
    { id: 'old-casualty', plotId: plot.id, ownerId: plot.ownerId, slot: 0, hp: 0 },
    { id: 'living-replacement', plotId: plot.id, ownerId: plot.ownerId, slot: 0, hp: 160 },
    { id: 'older-second', plotId: plot.id, ownerId: plot.ownerId, slot: 1, hp: 0 },
    { id: 'newer-second', plotId: plot.id, ownerId: plot.ownerId, slot: 1, hp: 0 }
  ];
  delete village.guardRosterVersion; ensureCare(village); ensureCare(village);
  assert.deepEqual(village.guards.map(g => g.id), ['living-replacement', 'newer-second']);
});

test('archer status reports unlimited shots, range, obstructions, and destroyed structures', () => {
  const { sim, village, plot, site } = fixture('archer_tower', 'outpost-1');
  const status = () => careSnapshot(village, null, sim).defenseStatus[0];
  plot.storage.arrows = 0;
  assert.equal(status().status, 'ready'); assert.equal(status().shotsRemaining, null); assert.equal(status().unlimitedAmmo, true);
  plot.storage.arrows = 4;
  village.zombies = [{ id: 'distant', x: site.x + 40, z: site.z, hp: 100 }];
  assert.equal(status().status, 'out_of_range');
  village.zombies[0].x = site.x + 10; sim.clearAttack = () => false;
  assert.equal(status().status, 'blocked'); assert.equal(status().shotsRemaining, null);
  sim.clearAttack = () => true;
  assert.equal(status().status, 'ready'); careTick(sim, village, .05);
  assert.equal(status().status, 'firing'); assert.equal(status().shotsRemaining, null);
  plot.hp = 0; assert.equal(status().status, 'destroyed');
});
