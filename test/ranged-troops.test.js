import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PLOTS } from '../shared/world.js';
import { plotEntrance } from '../shared/access.js';
import { TROOP_TYPES, barracksCapacity, troopStats } from '../shared/troops.js';
import { careAction, careTick, careSnapshot, ensureCare } from '../server/care-defense.js';
import { tickRangedTroop, troopCanEngage } from '../server/troop-combat.js';
import { guardDirective, guardOrderCanEngage } from '../server/guard-orders.js';
import { createDefenseTroopWorld } from '../public/src/defense-troop-world.js';
import { createCharacter } from '../public/src/characters.js';

function fixture() {
  const plot = { id: PLOTS[0].id, ownerId: 'owner', building: 'barracks', level: 1, hp: 650, maxHp: 650, storage: { timber: 1000, iron: 1000, stone: 1000, wheat: 100, arrows: 10, musket_ammo: 10 } };
  const owner = { id: 'owner', role: 'guard', online: true, hp: 100, wallet: 10000, inventory: {}, ...plotEntrance(PLOTS[0], plot) };
  const village = { id: 'troops', day: 1, phase: 'day', clock: 0, treasury: 0, players: { owner }, plots: [plot], guards: [], zombies: [], barracks: { wheat: 100 }, gate: { hp: 1200 } };
  const hits = [], moves = [], sim = { store: { saveVillage() {} }, clearAttack: () => true, stepNpc: (...args) => moves.push(args), hitZombie(v, target, damage, player) { hits.push({ damage, ownerId: player?.id }); target.hp -= damage; } };
  ensureCare(village);
  const recruit = unitType => { careAction(sim, village, owner, { kind: 'recruitGuard', plotId: plot.id, unitType }); return village.guards.at(-1); };
  return { village, plot, owner, sim, hits, moves, recruit };
}

test('mixed barracks recruitment shares slots, charges distinct costs and rejects forged types without payment', () => {
  const f = fixture(), initial = f.owner.wallet;
  for (const type of Object.keys(TROOP_TYPES)) { const guard = f.recruit(type); assert.equal(guard.unitType, type); assert.equal(guard.tool, TROOP_TYPES[type].tool); }
  assert.equal(f.owner.wallet, initial - 35 - 45 - 70);
  assert.throws(() => f.recruit('archer'), /three recruited/);
  const other = fixture(), before = structuredClone(other.plot.storage);
  assert.throws(() => other.recruit('__proto__'), /Choose a swordsman/);
  assert.deepEqual(other.plot.storage, before); assert.equal(other.owner.wallet, 10000);
});

test('barracks upgrades add six combined slots while each soldier trains separately', () => {
  const f = fixture(), swordsman = f.recruit('sword');
  careAction(f.sim, f.village, f.owner, { kind: 'upgradeDefense', plotId: f.plot.id });
  assert.equal(barracksCapacity(f.plot), 6); assert.equal(swordsman.maxHp, 160); assert.equal(swordsman.damage, 14);
  for (let i = 1; i < 6; i++) f.recruit(i % 2 ? 'archer' : 'musketeer');
  assert.equal(new Set(f.village.guards.map(g => g.slot)).size, 6);
  assert.equal(new Set(f.village.guards.map(g => `${g.x},${g.z}`)).size, 6);
  assert.throws(() => f.recruit('sword'), /six recruited/);
  swordsman.hp = 90;
  careAction(f.sim, f.village, f.owner, { kind: 'upgradeTroop', plotId: f.plot.id, guardId: swordsman.id });
  assert.equal(swordsman.hp, 150); assert.equal(swordsman.maxHp, 220); assert.equal(swordsman.damage, 18);
  const wallet = f.owner.wallet;
  assert.throws(() => careAction(f.sim, f.village, f.owner, { kind: 'upgradeTroop', plotId: f.plot.id, guardId: swordsman.id }), /fully trained/);
  assert.equal(f.owner.wallet, wallet);
  assert.throws(() => careAction(f.sim, f.village, { ...f.owner, id: 'visitor' }, { kind: 'upgradeTroop', plotId: f.plot.id, guardId: swordsman.id }), /owner/);
});

test('every unit retains its paid training and type through saved casualties and replacements', () => {
  for (const unitType of Object.keys(TROOP_TYPES)) {
    const f = fixture(), guard = f.recruit(unitType);
    careAction(f.sim, f.village, f.owner, { kind: 'upgradeTroop', plotId: f.plot.id, guardId: guard.id });
    const wallet = f.owner.wallet;
    guard.hp = 0; careTick(f.sim, f.village, .05);
    const saved = JSON.parse(JSON.stringify(f.village)); saved.clock = 31;
    const waiting = careSnapshot(saved).guardReplacements[0];
    assert.equal(waiting.unitType, unitType); assert.equal(waiting.troopLevel, 2);
    careTick(f.sim, saved, .05);
    const returned = saved.guards[0];
    assert.equal(returned.id, guard.id); assert.equal(returned.unitType, unitType); assert.equal(returned.troopLevel, 2);
    assert.equal(returned.hp, TROOP_TYPES[unitType].veteranHp); assert.equal(saved.players.owner.wallet, wallet);
  }
});

test('legacy veteran barracks migrate once and six saved slots survive normalization', () => {
  const f = fixture(); f.plot.level = 2;
  f.village.guards = Array.from({ length: 6 }, (_, slot) => ({ id: `old-${slot}`, ownerId: f.owner.id, plotId: f.plot.id, slot, hp: 120, maxHp: 220 }));
  delete f.village.guardRosterVersion;
  ensureCare(f.village); ensureCare(f.village);
  assert.equal(f.village.guards.length, 6);
  for (const guard of f.village.guards) { assert.equal(guard.unitType, 'sword'); assert.equal(guard.troopLevel, 2); assert.equal(guard.damage, 18); }
  f.village.guards[0].troopLevel = 1; ensureCare(f.village); assert.equal(f.village.guards[0].damage, 14, 'explicit new training level never inherits building strength');
});

test('ranged troops consume their own finite ammunition once per shot with owner credit, cooldown and line of sight', () => {
  for (const unitType of ['archer', 'musketeer']) {
    const f = fixture(), guard = f.recruit(unitType), stats = troopStats(guard), target = { id: 'zombie', x: guard.x + 10, z: guard.z, hp: 500 };
    const before = f.plot.storage[stats.ammo];
    tickRangedTroop(f.sim, f.village, guard, target, .05);
    assert.equal(f.plot.storage[stats.ammo], before - 1); assert.equal(f.hits[0].damage, stats.damage); assert.equal(f.hits[0].ownerId, f.owner.id);
    assert.equal(guard.lastShot.kind, stats.tool); assert.equal(guard.lastShot.x, target.x);
    tickRangedTroop(f.sim, f.village, guard, target, .05); assert.equal(f.hits.length, 1);
    guard.cooldown = 0; f.sim.clearAttack = () => false;
    tickRangedTroop(f.sim, f.village, guard, target, .05); assert.equal(f.hits.length, 1); assert.equal(f.plot.storage[stats.ammo], before - 1); assert.equal(f.moves.length, 1);
    f.sim.clearAttack = () => true; guard.hungry = true;
    tickRangedTroop(f.sim, f.village, guard, target, .05); assert.equal(f.hits.at(-1).damage, stats.damage * .75);
    guard.cooldown = 0; f.plot.storage[stats.ammo] = 0;
    assert.equal(troopCanEngage(f.sim, f.village, guard, target), false, 'empty ranged units ignore distant enemies so orders continue');
    tickRangedTroop(f.sim, f.village, guard, target, .05); assert.equal(f.hits.length, 2); assert.equal(f.plot.storage[stats.ammo], 0);
    f.plot.storage[stats.ammo] = 1; target.x = guard.x + stats.range + 1;
    tickRangedTroop(f.sim, f.village, guard, target, .05); assert.equal(f.hits.length, 2); assert.equal(f.plot.storage[stats.ammo], 1);
  }
});

test('expanded formations use distinct positions and ranged acquisition preserves retreat and rally leashes', () => {
  const f = fixture(); f.plot.level = 2; f.plot.guardOrder = { ownerId: f.owner.id, mode: 'follow' };
  const troops = Array.from({ length: 6 }, () => f.recruit('archer'));
  Object.assign(f.owner, { x: 0, z: 35, yaw: 0 });
  assert.equal(new Set(troops.map(guard => JSON.stringify(guardDirective(f.village, guard).anchor))).size, 6);
  const guard = troops[0]; guard.x = 0; guard.z = 32;
  assert.equal(guardOrderCanEngage(guard, { x: 20, z: 32, hp: 100 }, null), true);
  assert.equal(guardOrderCanEngage(guard, { x: 20, z: 32, hp: 100 }, { mode: 'hold', acquireRange: 12, leashRadius: 5, anchor: { x: 0, z: 32 } }), false);
  assert.equal(guardOrderCanEngage(guard, { x: 4, z: 32, hp: 100 }, { mode: 'retreat', acquireRange: 3, leashRadius: 5, anchor: { x: 0, z: 32 } }), false);
});

test('ranged equipment follows troop types and upgrades with bounded shared meshes', () => {
  const rigs = [createCharacter('guard', 1), createCharacter('guard', 2)], actors = new Map([['archer', { rig: rigs[0] }], ['musket', { rig: rigs[1] }]]), world = createDefenseTroopWorld();
  const state = { plots: [{ id: 'b', level: 2, building: 'barracks' }], guards: [{ id: 'archer', plotId: 'b', unitType: 'archer', troopLevel: 1, hp: 120 }, { id: 'musket', plotId: 'b', unitType: 'musketeer', troopLevel: 1, hp: 130 }] };
  world.update(state, actors, 0);
  assert.ok(rigs[0].group.getObjectByName('archer-supplies')); assert.ok(rigs[1].group.getObjectByName('musketeer-supplies'));
  assert.equal(rigs[0].group.getObjectByName('upgraded-watch-head'), undefined);
  state.guards[0].troopLevel = 2; world.update(state, actors, 1);
  assert.ok(rigs[0].group.getObjectByName('upgraded-watch-head')); assert.ok(rigs[0].group.getObjectByName('archer-supplies'));
  const count = world.stats.geometries;
  for (let frame = 0; frame < 30; frame++) world.update(state, actors, 1 + frame / 30);
  assert.equal(world.stats.geometries, count);
  world.dispose(); for (const rig of rigs) rig.dispose();
});

test('player musket and troop arrow effects render new shots once and clear on timeout or reconnect', () => {
  const scene = new THREE.Scene(), world = createDefenseTroopWorld(scene), actors = new Map();
  const player = { id: 'p' }, guard = { id: 'g' }, state = { id: 'v', clock: 10, players: [player], guards: [guard] };
  world.update(state, actors, 0);
  player.lastShot = { id: 'p:1', kind: 'musket', at: 10, from: { x: 0, z: 30 }, to: { x: 0, z: 40 } };
  guard.lastShot = { id: 'g:1', kind: 'bow', firedAt: 10, fromX: 2, fromZ: 30, x: 3, z: 40 };
  world.update(state, actors, .01); assert.equal(world.stats.shots, 2); assert.ok(scene.getObjectByName('ranged-shot-p')); assert.ok(scene.getObjectByName('ranged-shot-g'));
  world.update(state, actors, .02); assert.equal(world.stats.shots, 2);
  world.update(state, actors, 1); assert.equal(world.stats.shots, 0);
  world.clear(); world.update(state, actors, 1.1); assert.equal(world.stats.shots, 0, 'saved shots do not replay after reconnect');
  player.lastShot = { ...player.lastShot, id: 'p:old', at: 1 }; world.update(state, actors, 1.2); assert.equal(world.stats.shots, 0);
  world.dispose(); assert.equal(scene.children.length, 0);
});
