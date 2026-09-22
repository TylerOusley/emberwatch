import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { Simulation } from '../server/simulation.js';
import { carryStatus, movementSpeed, ENCUMBERED_SPEED_MULTIPLIER } from '../shared/encumbrance.js';
import { carryCapacity } from '../shared/content.js';
import { BUILDINGS, CONFIG } from '../shared/world.js';
import { buildingEntrance } from '../shared/access.js';
import { moveResource, transferLimit, PLAYER_CARRY_LIMIT } from '../shared/transfers.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'emberwatch-encumbrance-'));
  const f = { directory, store: new Store(directory) };
  t.after(async () => { f.store.close(); await rm(directory, { recursive: true, force: true }); });
  const session = await f.store.authenticate('register', 'HeavyHauler', 'encumbrance-integration-test');
  f.id = session.playerId; f.sim = new Simulation(f.store);
  const village = f.sim.create('Heavy cargo', f.store.account(f.id));
  f.v = f.sim.villages.get(village.id); f.p = f.sim.join(village.id, f.store.account(f.id));
  Object.assign(f.p, { durability: {}, wallet: 1000, inventory: {}, hunger: 100 });
  f.v.guards = []; f.v.phaseRemaining = 10000;
  f.act = action => { f.v.clock += 1; return f.sim.action(f.v.id, f.id, action); };
  f.near = id => Object.assign(f.p, buildingEntrance(BUILDINGS.find(b => b.id === id)));
  return f;
}

test('carry threshold is inclusive and every movement mode shares the same penalty', () => {
  const p = { role: 'guard', inventory: { wheat: 100 }, hunger: 100, durability: {} };
  assert.deepEqual(carryStatus(p), { carryWeight: 100, carryCapacity: 100, encumbered: false, carrySpeedMultiplier: 1 });
  assert.equal(movementSpeed(p, { sprinting: true }), CONFIG.sprintSpeed);
  p.inventory.wheat++;
  assert.equal(carryStatus(p).encumbered, true);
  assert.equal(movementSpeed(p), CONFIG.speed * ENCUMBERED_SPEED_MULTIPLIER);
  assert.equal(movementSpeed(p, { sprinting: true }), movementSpeed(p), 'sprint cannot bypass encumbrance');
  p.mountedHorseId = 'horse';
  assert.equal(movementSpeed(p, { sprinting: true, mountedSpeed: 10 }), 4.5);
  p.carryingId = 'companion';
  assert.equal(movementSpeed(p, { sprinting: true, mountedSpeed: 10 }), CONFIG.speed * .55 * .45);
  p.backpackTier = 1; assert.equal(carryStatus(p).encumbered, false);
});

test('explicit player maximum receives all transferable units while storage and safe integers stay bounded', () => {
  const source = { stone: 1000 }, p = { inventory: { stone: 2 }, role: 'guard', durability: {} };
  assert.equal(transferLimit(source, p, 'stone', PLAYER_CARRY_LIMIT), 1000);
  assert.equal(transferLimit(source, {}, 'stone', PLAYER_CARRY_LIMIT), 0, 'soft limit is never applied to a storage object');
  assert.equal(transferLimit(source, p, 'stone', Infinity), 0, 'Infinity is not an implicit unlimited transfer');
  moveResource({ source, destination: p, resource: 'stone', action: { max: true }, capacity: PLAYER_CARRY_LIMIT });
  assert.equal(source.stone, 0); assert.equal(p.inventory.stone, 1002); assert.equal(carryStatus(p).encumbered, true);
  const cart = { stone: 332 };
  moveResource({ source: p, destination: cart, resource: 'stone', action: { max: true }, capacity: 1000 });
  assert.equal(cart.stone, 333); assert.equal(p.inventory.stone, 1001);
  p.inventory.stone = Number.MAX_SAFE_INTEGER - 1; source.stone = 2;
  moveResource({ source, destination: p, resource: 'stone', action: { max: true }, capacity: PLAYER_CARRY_LIMIT });
  assert.equal(p.inventory.stone, Number.MAX_SAFE_INTEGER); assert.equal(source.stone, 1);
  assert.throws(() => moveResource({ source, destination: p, resource: 'stone', action: { amount: 1 }, capacity: PLAYER_CARRY_LIMIT }), /full/);
  assert.equal(source.stone, 1);
});

test('simulation movement slows above the allowance and immediately recovers after unloading or backpack upgrade', async t => {
  const f = await fixture(t), { p, v, sim } = f;
  const travel = sprint => {
    Object.assign(p, { x: 0, z: 4, y: 0, grounded: true, verticalSpeed: 0 });
    sim.input(v.id, p.id, { x: 1, z: 0, yaw: 0, sprint }); sim.tick(.1); return p.x;
  };
  p.inventory.wheat = carryCapacity(p);
  assert.ok(Math.abs(travel(true) - CONFIG.sprintSpeed * .1) < 1e-6);
  p.inventory.wheat++;
  const slow = travel(true); assert.ok(Math.abs(slow - CONFIG.speed * .45 * .1) < 1e-6);
  assert.equal(p.anim, 'walk'); assert.equal(travel(false), slow);
  const snapshot = sim.snapshot(v, p.id).players.find(item => item.id === p.id);
  assert.equal(snapshot.encumbered, true); assert.equal(snapshot.carrySpeedMultiplier, .45);
  p.inventory.wheat--;
  assert.ok(Math.abs(travel(true) - CONFIG.sprintSpeed * .1) < 1e-6);
  p.inventory.wheat = 175; f.near('tools'); f.act({ kind: 'buyBackpack', tier: 1 });
  assert.equal(carryStatus(p).encumbered, false);
  assert.ok(Math.abs(travel(true) - CONFIG.sprintSpeed * .1) < 1e-6);
});

test('approved credit can purchase an overweight tool, rollback is atomic, and encumbrance survives SQLite restart', async t => {
  const f = await fixture(t);
  f.p.inventory.wheat = carryCapacity(f.p) + 50; f.p.wallet = 0;
  f.store.issueCredit(f.id, 100); f.store.bank(f.id, 500); f.near('tools');
  f.store.saveVillage(f.v); const originalSave = f.store.saveVillage.bind(f.store);
  const prior = structuredClone(f.p), credit = f.store.account(f.id).credit;
  f.store.saveVillage = () => { throw new Error('injected write failure'); };
  assert.throws(() => f.act({ kind: 'buyTool', tool: 'pickaxe' }), /injected/);
  assert.deepEqual(f.p, prior); assert.equal(f.store.account(f.id).credit, credit);
  f.store.saveVillage = originalSave;
  f.act({ kind: 'buyTool', tool: 'pickaxe' });
  assert.equal(f.p.durability.pickaxe, 100); assert.equal(f.store.account(f.id).credit, 90);
  assert.equal(f.store.account(f.id).bank, 500); assert.equal(carryStatus(f.p).encumbered, true);
  const beforeRestart = carryStatus(f.p), villageId = f.v.id;
  f.store.close(); f.store = new Store(f.directory); f.sim = new Simulation(f.store);
  const restored = f.sim.join(villageId, f.store.account(f.id));
  assert.deepEqual(carryStatus(restored), beforeRestart); assert.equal(restored.durability.pickaxe, 100);
});

test('overweight shop intakes still reject unsafe item totals before charging or removing stock', async t => {
  const f = await fixture(t); f.near('market'); f.p.inventory.stone = Number.MAX_SAFE_INTEGER;
  f.v.clock += 1;
  const before = structuredClone(f.v), account = f.store.account(f.id);
  assert.throws(() => f.sim.action(f.v.id, f.id, { kind: 'buyResource', resource: 'stone', amount: 1, maxTotal: 100 }), /pack cannot/);
  assert.deepEqual(f.v, before); assert.deepEqual(f.store.account(f.id), account);
});
