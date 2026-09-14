import test from 'node:test';
import assert from 'node:assert/strict';
import { PLOTS, plotFront, canStand, plotSolids, plotSolid } from '../shared/world.js';
import { CHURCH, RECRUIT } from '../shared/defense.js';
import { careAction, careTick, careNight, ensureCare, cancelCarry, cancelTreatment, careSnapshot, guardPathFor, tickDefenseAttack } from '../server/care-defense.js';

function fixture(building = 'church', id = 'west-1') {
  const site = PLOTS.find(p => p.id === id), door = plotFront(site, 1);
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
  careAction(sim, village, owner, { kind: 'recruitGuard', plotId: plot.id });
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
  assert.throws(() => careAction(sim, village, owner, { kind: 'recruitGuard', plotId: plot.id }), /three living/);
  for (const guard of village.guards) {
    assert.ok(canStand(guard.x, guard.z, .4, plotSolids(village.plots)), 'recruits start outside the building');
    assert.ok(guardPathFor(village, guard).some(p => p.x === 0 && p.z === 25), 'marching route passes through the gate');
  }
  plot.building = 'house'; careTick(sim, village, .05);
  assert.equal(village.guards.length, 0);
});

test('towers consume finite ammunition and pass the authentic owner to combat credit', () => {
  const { sim, village, plot, owner, site, hits } = fixture('archer_tower', 'outpost-1');
  owner.role = 'guard'; plot.storage.arrows = 1;
  village.zombies = [{ id: 'zombie', x: site.x + 10, z: site.z, hp: 15 }];
  careTick(sim, village, .05);
  assert.equal(plot.storage.arrows, 0); assert.equal(village.zombies[0].hp, 0);
  assert.equal(hits[0].playerId, owner.id); assert.equal(owner.jobBonus, 1);
  village.zombies.push({ id: 'second', x: site.x + 10, z: site.z, hp: 15 });
  careTick(sim, village, 5); assert.equal(hits.length, 1, 'empty towers do not fire');
  plot.storage.arrows = 1; owner.online = false;
  careTick(sim, village, 5);
  assert.equal(hits.length, 2); assert.equal(owner.jobBonus, 1, 'offline ownership does not earn a bonus');
});

test('cannons consume both ammunition ingredients; ruined towers stop firing', () => {
  const { sim, village, plot, site, hits } = fixture('cannon', 'outpost-1');
  village.zombies = [{ id: 'a', x: site.x + 10, z: site.z, hp: 100 }, { id: 'b', x: site.x + 11, z: site.z, hp: 100 }];
  plot.storage.stone = 0; careTick(sim, village, 1); assert.equal(hits.length, 0); assert.equal(plot.storage.coal, 10);
  plot.storage.stone = 2; careTick(sim, village, 1);
  assert.equal(hits.length, 2); assert.equal(plot.storage.stone, 1); assert.equal(plot.storage.coal, 9);
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

test('tower fire respects obstacles without charging ammunition for blocked shots', () => {
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
  assert.equal(plot.storage.arrows, 9); assert.equal(hits.length, 1);
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
