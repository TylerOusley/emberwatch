import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { Simulation } from '../server/simulation.js';
import { ensureOwnership } from '../server/ownership.js';
import { ensureWorkers } from '../server/workers.js';
import { buildingEntrance } from '../shared/access.js';
import { BUILDINGS, PLOTS, RESOURCES, plotFront } from '../shared/world.js';
import { WORKER_RULES } from '../shared/workers.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'emberwatch-offline-employer-'));
  const f = { directory, store: new Store(directory) };
  t.after(async () => { f.store.close(); await rm(directory, { recursive: true, force: true }); });
  f.sim = new Simulation(f.store, { daySeconds: 10000 });
  for (const [key, name] of [['owner', 'AbsentEmployer'], ['resident', 'PresentResident']]) {
    const session = await f.store.authenticate('register', name, 'offline-employment-test-password');
    f[`${key}Id`] = session.playerId;
  }
  f.id = f.sim.create('Working Village', f.store.account(f.ownerId)).id;
  f.owner = f.sim.join(f.id, f.store.account(f.ownerId));
  f.resident = f.sim.join(f.id, f.store.account(f.residentId));
  f.owner.wallet = 1000; f.resident.wallet = 9000;
  f.store.bank(f.ownerId, 57); f.store.bank(f.residentId, 83);
  f.v = f.sim.villages.get(f.id);
  f.build = (index, building, level = 1) => {
    Object.assign(f.v.plots[index], { ownerId: f.ownerId, building, level, hp: 500, maxHp: 500 });
    ensureOwnership(f.v); ensureWorkers(f.v); return f.v.plots[index];
  };
  f.act = (worker, kind, data = {}) => {
    // Action throttling is unrelated to employment; commands use distinct
    // server times without ticking workers before the disconnect under test.
    f.owner.lastAction = -100;
    return f.sim.action(f.id, f.ownerId, { kind, workerId: worker?.id, ...data });
  };
  f.hire = () => {
    Object.assign(f.owner, buildingEntrance(BUILDINGS.find(b => b.id === 'bank')));
    f.act(null, 'worker_hire'); return f.v.workers.find(w => !w.staffPlotId);
  };
  f.restart = () => {
    f.store.close(); f.store = new Store(directory);
    f.sim = new Simulation(f.store, { daySeconds: 10000 });
    f.v = f.sim.villages.get(f.id);
    f.owner = f.v.players[f.ownerId]; f.resident = f.v.players[f.residentId];
  };
  return f;
}

function atPlot(worker, plot) {
  Object.assign(worker, plotFront(PLOTS.find(anchor => anchor.id === plot.id), 1));
}

function atNode(worker, node) {
  Object.assign(worker, { x: node.x, z: node.z + 1.6, targetNodeId: node.id });
}

function until(f, predicate, maxTicks = 1200) {
  for (let i = 0; i < maxTicks && !predicate(); i++) f.sim.tick(.1);
  assert.ok(predicate(), f.v.workers.map(w => `${w.staffRole ?? 'personal'}: ${w.status} at ${w.x}, ${w.z}`).join('; '));
}

function workState(worker) {
  const keys = ['id', 'ownerId', 'staffPlotId', 'staffSlot', 'staffRole', 'staffRetired', 'x', 'z', 'yaw', 'resource', 'sourcePlotId', 'destinationPlotId', 'mode', 'targetPercent', 'paused', 'cargo', 'paidWorkSeconds', 'gatherProgress', 'targetNodeId', 'delivering', 'workXp', 'environmentYieldRemainders'];
  return structuredClone(Object.fromEntries(keys.map(key => [key, worker[key]])));
}

test('personal hires, plot gatherers and transporters work for an offline owner and resume from SQLite when only another resident returns', async t => {
  const f = await fixture(t);
  const farm = f.build(0, 'wheat_farm'), shop = f.build(1, 'tinker_shop', 2), source = f.build(2, 'house');
  source.storage.arrows = 40;
  const personal = f.hire(), gatherer = f.v.workers.find(w => w.staffPlotId === farm.id);
  const [transporter, pausedStaff] = f.v.workers.filter(w => w.staffPlotId === shop.id);
  f.act(personal, 'worker_assign', { resource: 'wheat', sourcePlotId: null, mode: 'store', destinationPlotId: source.id });
  f.act(gatherer, 'worker_pause', { paused: false });
  f.act(transporter, 'worker_assign', { resource: 'arrows', sourcePlotId: source.id, mode: 'store', destinationPlotId: shop.id, targetPercent: 1 });
  const publicNode = RESOURCES.find(node => node.type === 'wheat' && node.z > 40);
  const farmNode = f.v.plotResources.find(node => node.plotId === farm.id && node.type === 'wheat');
  atNode(personal, publicNode); atNode(gatherer, farmNode); atPlot(transporter, source);
  const ownerWallet = f.owner.wallet, residentWallet = f.resident.wallet, farmRemaining = farmNode.remaining;
  f.sim.disconnect(f.id, f.ownerId);
  until(f, () => personal.cargo.wheat > 0 && gatherer.cargo.wheat > 0 && transporter.cargo.arrows === 40, 100);
  assert.equal(f.owner.online, false); assert.equal(f.resident.online, true);
  assert.equal(farmNode.remaining, farmRemaining - 1, 'the absent owner earns goods from a real finite plot node');
  assert.equal(source.storage.arrows, 0, 'the transporter physically picked up existing supplies');
  assert.equal(f.owner.wallet, ownerWallet - 3 * WORKER_RULES.wageGold, 'all three active workers charge their employer once');
  assert.equal(f.resident.wallet, residentWallet, 'keeping the village active does not pay another resident\'s wages');
  assert.ok([personal, gatherer, transporter].every(w => w.paidWorkSeconds > 0 && w.paidWorkSeconds < WORKER_RULES.wageSeconds));
  assert.equal(pausedStaff.paused, true); assert.equal(pausedStaff.paidWorkSeconds, 0);
  assert.equal(pausedStaff.workXp, 0, 'manual pause still applies to supplemental staff');

  f.sim.disconnect(f.id, f.residentId);
  const saved = f.v.workers.map(workState), clock = f.v.clock, savedWallet = f.owner.wallet;
  const savedPlots = structuredClone(f.v.plots), savedNodes = structuredClone(f.v.plotResources);
  f.sim.tick(3600);
  assert.equal(f.v.clock, clock);
  assert.deepEqual(f.v.workers.map(workState), saved, 'the last disconnect freezes movement, cargo and prepaid wage time');
  assert.deepEqual(f.v.plots, savedPlots); assert.deepEqual(f.v.plotResources, savedNodes);
  f.sim.saveAll(); f.restart();
  assert.ok(Object.values(f.v.players).every(p => !p.online));
  assert.deepEqual(f.v.workers.map(workState), saved, 'assignments and earned goods survive an actual SQLite reload');
  f.sim.tick(3600);
  assert.equal(f.v.clock, clock); assert.equal(f.owner.wallet, savedWallet);
  assert.deepEqual(f.v.workers.map(workState), saved);

  f.sim.join(f.id, f.store.account(f.residentId));
  const restoredPersonal = f.v.workers.find(w => w.id === personal.id), restoredGatherer = f.v.workers.find(w => w.id === gatherer.id);
  const restoredTransporter = f.v.workers.find(w => w.id === transporter.id), restoredShop = f.v.plots.find(plot => plot.id === shop.id);
  const beforePaid = restoredPersonal.paidWorkSeconds;
  until(f, () => restoredShop.storage.arrows === 40 && restoredPersonal.workXp > personal.workXp && restoredGatherer.workXp > gatherer.workXp);
  assert.equal(f.owner.online, false, 'the employer never rejoins to reactivate the workers');
  assert.equal(f.resident.wallet, residentWallet);
  assert.ok(restoredPersonal.paidWorkSeconds !== beforePaid, 'the saved prepaid wage balance is spent after activity resumes');
  assert.equal(restoredTransporter.cargo.arrows, 0); assert.equal(f.v.plots.find(plot => plot.id === source.id).storage.arrows, 0);
  assert.equal(f.v.workers.length, saved.length, 'rejoin grants no duplicate hires or plot staff');
  assert.equal(f.store.account(f.ownerId).bank, 57); assert.equal(f.store.account(f.residentId).bank, 83);
  f.sim.saveAll(); f.restart(); f.sim.join(f.id, f.store.account(f.residentId)); f.sim.tick(.1);
  assert.equal(f.v.plots.find(plot => plot.id === shop.id).storage.arrows, 40, 'the completed delivery cannot replay after another restart');
  assert.equal(f.v.workers.find(w => w.id === transporter.id).cargo.arrows, 0);
});

test('offline-owner workers exhaust only their wallet and prepaid time while another wealthy resident stays online', async t => {
  const f = await fixture(t), house = f.build(0, 'house'), worker = f.hire();
  f.act(worker, 'worker_assign', { resource: 'wheat', sourcePlotId: null, mode: 'store', destinationPlotId: house.id });
  atNode(worker, RESOURCES.find(node => node.type === 'wheat' && node.z > 40));
  f.owner.wallet = 1;
  const residentWallet = f.resident.wallet;
  f.sim.disconnect(f.id, f.ownerId);
  f.sim.tick(.1);
  assert.equal(f.owner.wallet, 0); assert.ok(worker.paidWorkSeconds > 29);
  until(f, () => worker.workXp > 0, 100);
  assert.equal(f.owner.wallet, 0, 'a purchased wage block remains usable after the wallet reaches zero');
  until(f, () => /needs wallet gold/i.test(worker.status), 800);
  assert.ok(worker.paidWorkSeconds <= 1e-7);
  const cargo = structuredClone(worker.cargo), xp = worker.workXp, treasury = f.v.treasury;
  for (let i = 0; i < 100; i++) f.sim.tick(.1);
  assert.deepEqual(worker.cargo, cargo); assert.equal(worker.workXp, xp, 'unpaid workers cannot continue harvesting');
  assert.equal(f.owner.wallet, 0); assert.equal(f.resident.wallet, residentWallet);
  assert.equal(f.v.treasury, treasury, 'employment never falls back to village funds');
  assert.equal(f.store.account(f.ownerId).bank, 57, 'protected savings cannot subsidize an offline employer');
  assert.equal(f.store.account(f.residentId).bank, 83);
  f.sim.saveAll(); f.restart(); f.sim.join(f.id, f.store.account(f.residentId)); f.sim.tick(.1);
  const restored = f.v.workers.find(w => w.id === worker.id);
  assert.equal(f.owner.wallet, 0); assert.deepEqual(restored.cargo, cargo); assert.equal(restored.workXp, xp);
  assert.match(restored.status, /needs wallet gold/i);
});

test('an offline owner receives the real market sale after restart without charging the resident who keeps the village active', async t => {
  const f = await fixture(t), worker = f.hire();
  f.act(worker, 'worker_assign', { resource: 'stone', sourcePlotId: null, mode: 'sell', destinationPlotId: null });
  Object.assign(worker, { x: 0, z: -100, paidWorkSeconds: .0001, delivering: true });
  worker.cargo.stone = 7;
  for (const node of f.v.resources) { node.available = false; node.regrowAt = f.v.clock + 10000; }
  f.sim.disconnect(f.id, f.ownerId); f.sim.saveAll(); f.restart();
  f.sim.join(f.id, f.store.account(f.residentId));
  const restored = f.v.workers.find(w => w.id === worker.id), wallet = f.owner.wallet, residentWallet = f.resident.wallet;
  const treasury = f.v.treasury, stock = f.v.stock.stone;
  until(f, () => restored.cargo.stone === 0);
  assert.equal(f.owner.online, false); assert.equal(f.v.stock.stone, stock + 7);
  assert.ok(f.v.treasury < treasury, 'sale uses the actual public market payout');
  assert.equal(f.owner.wallet, wallet - WORKER_RULES.wageGold + treasury - f.v.treasury, 'sale proceeds and the due wage block both belong to the offline owner');
  assert.equal(f.resident.wallet, residentWallet); assert.equal(f.store.account(f.ownerId).bank, 57);
  const finalWallet = f.owner.wallet, finalTreasury = f.v.treasury;
  f.sim.saveAll(); f.restart(); f.sim.join(f.id, f.store.account(f.residentId)); f.sim.tick(.1);
  assert.equal(f.owner.wallet, finalWallet); assert.equal(f.v.treasury, finalTreasury);
  assert.equal(f.v.stock.stone, stock + 7, 'a persisted completed sale cannot be credited twice');
});
