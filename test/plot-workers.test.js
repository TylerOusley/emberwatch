import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS, PLOTS, plotFront } from '../shared/world.js';
import { buildingEntrance } from '../shared/access.js';
import { WORKER_RULES, plotStaffCount } from '../shared/workers.js';
import { RESOURCE_WEIGHTS, inventoryWeight } from '../shared/content.js';
import { ensureOwnership } from '../server/ownership.js';
import { ensureWorkers, workersAction, workersTick, workersSnapshot } from '../server/workers.js';

function fixture() {
  const p = { id: 'owner', name: 'Owner', wallet: 5000, online: true, role: 'villager', inventory: {}, durability: {}, ...buildingEntrance(BUILDINGS.find(b => b.id === 'bank')) };
  const visitor = { ...p, id: 'visitor', inventory: {}, durability: {} };
  const v = { id: 'staff-test', status: 'active', clock: 0, phase: 'day', players: { owner: p, visitor }, workers: [], guards: [], resources: [] };
  ensureOwnership(v);
  const sim = {};
  const build = (index, building, level = 1, ownerId = p.id) => {
    const plot = v.plots[index]; Object.assign(plot, { ownerId, building, level, hp: 500, maxHp: 500 }); ensureOwnership(v); ensureWorkers(v); return plot;
  };
  const act = (w, kind, data = {}, player = p) => workersAction(sim, v, player, { kind, workerId: w?.id, ...data });
  const tick = (dt = .1) => { v.clock += dt; workersTick(sim, v, dt); };
  const at = (w, plot) => Object.assign(w, plotFront(PLOTS.find(anchor => anchor.id === plot.id), 1));
  const staff = plot => v.workers.filter(w => w.staffPlotId === plot.id && !w.staffRetired);
  const route = (w, source, resource = 'wheat', targetPercent = 1) => act(w, 'worker_assign', { sourcePlotId: source.id, destinationPlotId: w.staffPlotId, mode: 'store', resource, targetPercent });
  return { v, p, visitor, build, act, tick, at, staff, route };
}

test('plot staff add zero, one, two or three places separately from five paid personal hires', () => {
  const f = fixture(), plot = f.build(0, 'mine');
  plot.level = 0; ensureWorkers(f.v); assert.equal(f.staff(plot).length, 0);
  plot.level = 1; ensureWorkers(f.v); assert.equal(f.staff(plot).length, 1);
  plot.level = 2; ensureWorkers(f.v); assert.equal(f.staff(plot).length, 2);
  plot.level = 3; ensureWorkers(f.v); assert.equal(f.staff(plot).length, 3);
  const wallet = f.p.wallet;
  for (let i = 0; i < WORKER_RULES.maxPerPlayer; i++) f.act(null, 'worker_hire');
  assert.equal(f.v.workers.length, 8); assert.equal(f.p.wallet, wallet - 5 * WORKER_RULES.hireCost);
  assert.throws(() => f.act(null, 'worker_hire'), /at most 5/);
  for (const building of ['wheat_farm', 'tree_farm', 'mine', 'tool_shop', 'tinker_shop', 'sword_shop', 'church', 'barracks', 'archer_tower', 'cannon']) {
    assert.equal(plotStaffCount({ ownerId: f.p.id, building, level: 2, hp: 100 }), 2);
  }
  assert.equal(plotStaffCount({ ownerId: f.p.id, building: 'house', level: 3, hp: 100 }), 0);
  assert.equal(plotStaffCount({ ownerId: f.p.id, building: null, level: 3, hp: 100 }), 0);
});

test('plot staff arrive paused without charges and gathering staff stay tied to their plot', () => {
  const f = fixture(), farm = f.build(0, 'wheat_farm'), mine = f.build(1, 'mine'), w = f.staff(farm)[0];
  assert.equal(w.resource, 'wheat'); assert.equal(w.sourcePlotId, farm.id); assert.equal(w.destinationPlotId, farm.id); assert.equal(w.paused, true);
  const wallet = f.p.wallet; for (let i = 0; i < 50; i++) f.tick();
  assert.equal(f.p.wallet, wallet); assert.equal(w.paidWorkSeconds, 0); assert.equal(inventoryWeight(w.cargo), 0);
  assert.throws(() => f.act(w, 'worker_assign', { resource: 'stone', sourcePlotId: mine.id, mode: 'store', destinationPlotId: farm.id }), /their own production plot/);
  assert.throws(() => f.act(w, 'worker_dismiss'), /stay with their building/);
  f.act(w, 'worker_pause', { paused: false }); assert.equal(w.paused, false);
  ensureWorkers(f.v); assert.equal(w.paused, false, 'reconciliation never resets an existing assignment');
});

test('plot gathering consumes real finite nodes, delivers to owned storage and keeps night wages', () => {
  const f = fixture(), farm = f.build(0, 'wheat_farm'), w = f.staff(farm)[0];
  const node = f.v.plotResources.find(node => node.plotId === farm.id && node.type === 'wheat');
  Object.assign(w, { x: node.x, z: node.z + 1.6, targetNodeId: node.id });
  f.act(w, 'worker_pause', { paused: false }); f.v.phase = 'night';
  const wallet = f.p.wallet, remaining = node.remaining;
  for (let i = 0; i < 100 && !w.cargo.wheat; i++) f.tick();
  assert.equal(w.cargo.wheat, 1); assert.equal(node.remaining, remaining - 1); assert.equal(farm.storage.wheat ?? 0, 0);
  assert.equal(f.p.wallet, wallet - 1); w.delivering = true; f.at(w, farm); f.tick();
  assert.equal(farm.storage.wheat, 1); assert.equal(w.cargo.wheat, 0);
  f.p.online = f.visitor.online = false; const paid = w.paidWorkSeconds;
  for (let i = 0; i < 10; i++) f.tick();
  assert.equal(w.paidWorkSeconds, paid); assert.equal(farm.storage.wheat, 1);
});

test('destroyed, downgraded and rebuilt plots preserve cargo, wages and staff identities without duplicates', () => {
  const f = fixture(), plot = f.build(0, 'mine', 2), [a, b] = f.staff(plot);
  a.cargo.stone = 4; a.paidWorkSeconds = .0001; b.cargo.iron = 2;
  const ids = f.v.workers.map(w => w.id); plot.level = 1; ensureWorkers(f.v);
  assert.equal(a.staffRetired, false); assert.equal(b.staffRetired, true); assert.equal(b.cargo.iron, 2);
  plot.hp = 0; f.tick(); assert.ok(f.v.workers.every(w => w.staffRetired && w.paused));
  assert.equal(a.cargo.stone, 4); assert.equal(a.paidWorkSeconds, .0001);
  assert.throws(() => f.act(a, 'worker_pause', { paused: false }), /no longer supports/);
  Object.assign(plot, { hp: 500, building: 'tinker_shop', level: 2 }); ensureWorkers(f.v);
  assert.deepEqual(f.v.workers.map(w => w.id), ids); assert.equal(f.staff(plot).length, 2);
  assert.ok(f.staff(plot).every(w => w.staffRole === 'transporter' && w.paused));
  assert.equal(a.cargo.stone, 4); assert.equal(b.cargo.iron, 2); assert.equal(a.paidWorkSeconds, .0001);
  for (let i = 0; i < 20; i++) ensureWorkers(f.v);
  assert.equal(f.v.workers.length, 2); assert.equal(a.cargo.stone, 4);
});

test('ownership changes retire old staff without transferring their private cargo or controls', () => {
  const f = fixture(), plot = f.build(0, 'mine'), old = f.staff(plot)[0]; old.cargo.iron = 3;
  plot.ownerId = f.visitor.id; ensureWorkers(f.v);
  const next = f.v.workers.find(w => w.ownerId === f.visitor.id);
  assert.equal(old.staffRetired, true); assert.equal(old.ownerId, f.p.id); assert.equal(old.cargo.iron, 3);
  assert.notEqual(next.id, old.id); assert.equal(next.cargo.iron, 0);
  assert.throws(() => f.act(old, 'worker_collect', {}, f.visitor), /your own workers/);
  const visible = workersSnapshot(f.v, f.visitor.id).workers.find(w => w.id === old.id);
  assert.equal(visible.cargo, undefined); assert.equal(visible.staffPlotId, undefined);
});

test('transport orders validate owned distinct sources, living destinations and whole percentages atomically', () => {
  const f = fixture(), source = f.build(0, 'mine'), destination = f.build(1, 'tinker_shop'), foreign = f.build(2, 'mine', 1, f.visitor.id), w = f.staff(destination)[0];
  const before = structuredClone(w);
  assert.throws(() => f.route(w, foreign), /you own/);
  assert.throws(() => f.route(w, destination), /different living source/);
  for (const target of [0, 101, 1.5, '50', NaN]) assert.throws(() => f.route(w, source, 'wheat', target), /1 to 100/);
  assert.throws(() => f.route(w, source, '__proto__'), /stored resource/);
  assert.throws(() => f.act(w, 'worker_assign', { sourcePlotId: source.id, destinationPlotId: source.id, mode: 'store', resource: 'wheat', targetPercent: 50 }), /different living source/);
  assert.deepEqual(w, before); f.route(w, source); assert.equal(w.paused, false);
});

test('transporters physically conserve supplies and refill only the target shortfall, counting goods in transit', () => {
  const f = fixture(), source = f.build(0, 'house'), destination = f.build(1, 'tinker_shop', 2), [a, b] = f.staff(destination);
  source.storage.wheat = 100; destination.storage.wheat = 4;
  for (const w of [a, b]) f.route(w, source);
  f.tick(); assert.equal(source.storage.wheat, 100, 'remote orders never teleport supplies');
  f.at(a, source); f.at(b, source); f.tick();
  assert.equal(a.cargo.wheat + b.cargo.wheat, 11); assert.equal(source.storage.wheat, 89); assert.equal(destination.storage.wheat, 4);
  f.at(a, destination); f.tick(); assert.equal(destination.storage.wheat, 15); assert.equal(a.cargo.wheat, 0);
  const wallet = f.p.wallet, paid = a.paidWorkSeconds;
  for (let i = 0; i < 10; i++) f.tick();
  assert.equal(f.p.wallet, wallet); assert.equal(a.paidWorkSeconds, paid, 'fulfilled targets have no idle wage drain');
  destination.storage.wheat -= 3; f.at(a, source); f.tick(); assert.equal(a.cargo.wheat, 3);
  f.at(a, destination); f.tick(); assert.equal(destination.storage.wheat, 15); assert.equal(source.storage.wheat, 86);
});

test('source destruction and capacity changes retain transported cargo without overdrawing or overfilling', () => {
  const f = fixture(), source = f.build(0, 'house'), destination = f.build(1, 'tinker_shop'), w = f.staff(destination)[0];
  source.storage.stone = 50; f.route(w, source, 'stone', 50); f.at(w, source); f.tick();
  assert.equal(w.cargo.stone, 13); assert.equal(source.storage.stone, 37);
  source.hp = 0; destination.storage.wheat = 1497; f.at(w, destination); f.tick();
  assert.equal(destination.storage.stone, 1); assert.equal(w.cargo.stone, 12); assert.equal(inventoryWeight(destination.storage), 1500);
  assert.match(w.status, /cargo kept/); const paid = w.paidWorkSeconds; f.tick(); assert.equal(w.paidWorkSeconds, paid);
  destination.storage.wheat = 0; f.tick(); assert.equal(destination.storage.stone, 13); assert.equal(w.cargo.stone, 0);
  f.tick(); assert.match(w.status, /supply source/); assert.equal(source.storage.stone, 37);
});

test('transport rechecks source ownership at pickup and preserves cargo when a deposit fills its target in transit', () => {
  const f = fixture(), source = f.build(0, 'house'), destination = f.build(1, 'tinker_shop'), w = f.staff(destination)[0];
  source.storage.wheat = 50; f.route(w, source); source.ownerId = f.visitor.id; f.at(w, source); f.tick();
  assert.equal(source.storage.wheat, 50); assert.equal(w.cargo.wheat, 0); assert.match(w.status, /supply source/);
  source.ownerId = f.p.id; f.at(w, source); f.tick(); assert.equal(w.cargo.wheat, 15); assert.equal(source.storage.wheat, 35);
  destination.storage.wheat = 15; f.at(w, destination); const paid = w.paidWorkSeconds; f.tick();
  assert.equal(w.cargo.wheat, 15); assert.equal(destination.storage.wheat, 15); assert.equal(w.paidWorkSeconds, paid);
  assert.match(w.status, /target met/);
  destination.storage.wheat -= 4; f.tick(); assert.equal(w.cargo.wheat, 11); assert.equal(destination.storage.wheat, 15);
  assert.equal(source.storage.wheat, 35);
});

test('transporters support ammunition and powder and retain cargo when the village empties or loses the destination', () => {
  const f = fixture(), source = f.build(0, 'house'), destination = f.build(1, 'archer_tower'), w = f.staff(destination)[0];
  for (const resource of ['arrows', 'gunpowder', 'musket_ammo']) {
    f.p.online = true;
    assert.ok(RESOURCE_WEIGHTS[resource] > 0); source.storage[resource] = 10;
    f.route(w, source, resource, 50); f.at(w, source); f.tick(); assert.equal(w.cargo[resource], 10);
    f.p.online = f.visitor.online = false; const paid = w.paidWorkSeconds; f.at(w, destination); f.tick();
    assert.equal(w.cargo[resource], 10); assert.equal(w.paidWorkSeconds, paid); f.visitor.online = true;
    f.at(w, destination); f.tick(); assert.equal(destination.storage[resource], 10); assert.equal(w.cargo[resource], 0);
  }
  source.storage.arrows = 5; f.route(w, source, 'arrows', 50); f.at(w, source); f.tick();
  destination.hp = 0; f.tick(); assert.equal(w.staffRetired, true); assert.equal(w.cargo.arrows, 5);
  Object.assign(f.p, { x: w.x, z: w.z }); f.act(w, 'worker_collect'); assert.equal(f.p.inventory.arrows, 5); assert.equal(w.cargo.arrows, 0);
});

test('a complete transporter journey walks between two plot doors and earns wages only for real work', () => {
  const f = fixture(), source = f.build(0, 'house'), destination = f.build(1, 'tool_shop'), w = f.staff(destination)[0];
  source.storage.wheat = 15; f.route(w, source); const start = { x: w.x, z: w.z }, wallet = f.p.wallet;
  let moved = false, carried = false;
  for (let i = 0; i < 2400 && destination.storage.wheat !== 15; i++) {
    f.tick(); moved ||= Math.hypot(w.x - start.x, w.z - start.z) > 2; carried ||= w.cargo.wheat > 0;
  }
  assert.equal(destination.storage.wheat, 15); assert.equal(source.storage.wheat, 0); assert.equal(w.cargo.wheat, 0);
  assert.ok(moved && carried); assert.ok(f.p.wallet < wallet); assert.equal(w.workXp, 1);
});
