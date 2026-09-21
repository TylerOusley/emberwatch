import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { Simulation } from '../server/simulation.js';
import { ensureOwnership } from '../server/ownership.js';
import { ensureWorkers, workersSnapshot } from '../server/workers.js';
import { buildingEntrance } from '../shared/access.js';
import { BUILDINGS, PLOTS, plotFront } from '../shared/world.js';
import { WORKER_MINE_RESOURCES, workerStats } from '../shared/workers.js';
import { inventoryWeight } from '../shared/content.js';
import { plotStorageCapacity, productionRegrowSeconds } from '../shared/production.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'emberwatch-worker-donations-'));
  const f = { store: new Store(directory) };
  t.after(async () => { f.store.close(); await rm(directory, { recursive: true, force: true }); });
  for (const [key, name] of [['owner', 'DonatingMiner'], ['resident', 'VillageRecipient']]) {
    f[`${key}Id`] = (await f.store.authenticate('register', name, 'worker-donation-test-password')).playerId;
  }
  f.sim = new Simulation(f.store, { daySeconds: 10000 });
  f.id = f.sim.create('Shared village supplies', f.store.account(f.ownerId)).id;
  f.owner = f.sim.join(f.id, f.store.account(f.ownerId));
  f.resident = f.sim.join(f.id, f.store.account(f.residentId));
  f.v = f.sim.villages.get(f.id);
  f.owner.wallet = 10000; f.resident.wallet = 20000;
  f.store.bank(f.ownerId, 500); f.store.bank(f.residentId, 900);
  f.build = (index, building, level = 1, ownerId = f.ownerId) => {
    const plot = f.v.plots[index];
    Object.assign(plot, { ownerId, building, level, hp: 500, maxHp: 500 });
    ensureOwnership(f.v); ensureWorkers(f.v); return plot;
  };
  f.act = (worker, kind, data = {}, player = f.owner) => {
    player.lastAction = -100;
    return f.sim.action(f.id, player.id, { kind, workerId: worker?.id, ...data });
  };
  f.hire = () => {
    Object.assign(f.owner, buildingEntrance(BUILDINGS.find(b => b.id === 'bank')));
    f.act(null, 'worker_hire'); return f.v.workers.at(-1);
  };
  f.assign = (worker, mine, destination = null) => f.act(worker, 'worker_assign', {
    resource: 'mine_all', sourcePlotId: mine.id, mode: destination ? 'store' : 'sell', destinationPlotId: destination?.id ?? null
  });
  f.tick = (count = 1) => { for (let i = 0; i < count; i++) f.sim.tick(.1); };
  f.restart = () => {
    f.store.close(); f.store = new Store(directory); f.sim = new Simulation(f.store, { daySeconds: 10000 });
    f.v = f.sim.villages.get(f.id); f.owner = f.v.players[f.ownerId]; f.resident = f.v.players[f.residentId];
  };
  return f;
}

const atPlot = (worker, plot) => Object.assign(worker, plotFront(PLOTS.find(anchor => anchor.id === plot.id), 1));
function atNode(worker, node, owner, almostDone = false) {
  Object.assign(worker, { x: node.x, z: node.z + 1.6, targetNodeId: node.id, delivering: false,
    gatherProgress: almostDone ? workerStats(worker, owner).gatherSeconds - .1 : 0 });
}
function until(f, condition, ticks = 600) {
  for (let i = 0; i < ticks && !condition(); i++) f.tick();
  assert.ok(condition(), f.v.workers.map(w => `${w.resource}: ${w.status}`).join('; '));
}

test('all-mine orders require an owned living mine and invalid orders preserve the previous assignment', async t => {
  const f = await fixture(t), mine = f.build(0, 'mine'), farm = f.build(1, 'wheat_farm');
  const foreign = f.build(2, 'mine', 1, f.residentId), worker = f.hire();
  f.assign(worker, mine); const saved = structuredClone(worker);
  for (const source of [null, foreign.id, farm.id, 'missing']) {
    assert.throws(() => f.act(worker, 'worker_assign', { resource: 'mine_all', sourcePlotId: source, mode: 'sell', destinationPlotId: null }), /owned mine|you own|supplies this resource/);
    assert.deepEqual(worker, saved);
  }
  assert.throws(() => f.act(worker, 'worker_assign', { resource: 'mine_all', sourcePlotId: mine.id, mode: 'store', destinationPlotId: foreign.id }, f.resident), /own workers/);
});

test('mixed mining switches from depleted sulfur to another owned vein without waiting or visiting foreign/public nodes', async t => {
  const f = await fixture(t), mine = f.build(0, 'mine'), foreign = f.build(1, 'mine', 1, f.residentId), worker = f.hire();
  f.assign(worker, mine);
  const nodes = f.v.plotResources.filter(node => node.plotId === mine.id), sulfur = nodes.find(node => node.type === 'sulfur');
  for (const node of nodes) { node.remaining = 1; }
  const untouched = structuredClone(f.v.plotResources.filter(node => node.plotId === foreign.id));
  atNode(worker, sulfur, f.owner);
  until(f, () => worker.cargo.sulfur === 1, 80);
  assert.equal(sulfur.available, false);
  until(f, () => ['stone', 'iron', 'coal'].some(id => worker.cargo[id] > 0), 250);
  assert.ok(f.v.clock < sulfur.regrowAt, 'the next resource is harvested before sulfur regrows');
  assert.equal(worker.resource, 'mine_all'); assert.ok(worker.workXp >= 2);
  assert.deepEqual(f.v.plotResources.filter(node => node.plotId === foreign.id), untouched);
  assert.equal(Object.hasOwn(worker.cargo, 'mine_all'), false);
  assert.equal(workersSnapshot(f.v, f.ownerId).workers.find(w => w.id === worker.id).tool, 'pickaxe');
});

test('plot mining staff use actual resource yield, weight, regrowth, tool wear and separate fractional remainders', async t => {
  const f = await fixture(t), mine = f.build(0, 'mine', 2), worker = f.v.workers.find(w => w.staffPlotId === mine.id);
  f.assign(worker, mine); f.act(worker, 'worker_buy_tool', { tool: 'pickaxe', tier: 'stone' });
  worker.paidWorkSeconds = 30;
  for (const type of WORKER_MINE_RESOURCES) {
    const node = f.v.plotResources.find(n => n.plotId === mine.id && n.type === type);
    node.remaining = 1; atNode(worker, node, f.owner, true); f.tick();
    assert.equal(worker.cargo[type], 2, `${type} uses the level-two yield and stone pickaxe`);
    assert.equal(worker.toolYieldRemainders[type], .5, 'fractional bonuses stay with each actual resource');
    assert.equal(node.remaining, 0);
    assert.ok(Math.abs(node.regrowAt - f.v.clock - productionRegrowSeconds(type, mine, f.v.environment)) < 1e-7);
  }
  assert.equal(worker.equipment.pickaxe.durability, 146); assert.equal(worker.workXp, 4);
  assert.ok(Number.isFinite(inventoryWeight(worker.cargo))); assert.ok(inventoryWeight(worker.cargo) <= workerStats(worker, f.owner).carryCapacity);
  assert.equal(Object.hasOwn(worker.toolYieldRemainders, 'mine_all'), false);
  const node = f.v.plotResources.find(n => n.plotId === mine.id && n.type === 'sulfur');
  node.remaining = 1; node.available = true; atNode(worker, node, f.owner, true); f.tick();
  assert.equal(worker.cargo.sulfur, 5, 'the next sulfur harvest receives its accumulated half unit');
});

test('donated cargo is delivered physically within recipient capacity and survives destruction or ownership changes', async t => {
  const f = await fixture(t), mine = f.build(0, 'mine'), recipient = f.build(1, 'house', 1, f.residentId), worker = f.hire();
  recipient.allowVisitors = false; recipient.storage.stone = 499;
  worker.cargo.stone = 4; f.assign(worker, mine, recipient);
  assert.equal(worker.destinationOwnerId, f.residentId);
  f.tick(); assert.equal(recipient.storage.stone, 499, 'assignment cannot remotely transfer cargo');
  atPlot(worker, recipient); f.tick();
  assert.equal(recipient.storage.stone, 500); assert.equal(worker.cargo.stone, 3);
  assert.equal(inventoryWeight(recipient.storage), plotStorageCapacity(recipient));
  const paid = worker.paidWorkSeconds, wallet = f.owner.wallet; f.tick(20);
  assert.equal(worker.paidWorkSeconds, paid); assert.equal(f.owner.wallet, wallet, 'full destinations do not consume wages');
  recipient.hp = 0; f.tick(); assert.equal(worker.cargo.stone, 3);
  recipient.hp = 500; recipient.ownerId = f.ownerId; recipient.storage.stone = 490;
  atPlot(worker, recipient); f.tick();
  assert.equal(worker.cargo.stone, 3); assert.equal(recipient.storage.stone, 490, 'a changed recipient requires a new explicit order');
  f.assign(worker, mine, recipient); atPlot(worker, recipient); f.tick();
  assert.equal(worker.cargo.stone, 0); assert.equal(recipient.storage.stone, 493);
});

test('transporters donate only employer-owned stock and count all owners goods in transit toward the destination target', async t => {
  const f = await fixture(t), source = f.build(0, 'house'), home = f.build(1, 'tinker_shop');
  const recipient = f.build(2, 'tinker_shop', 1, f.residentId), foreignSource = f.build(3, 'house', 1, f.residentId);
  const a = f.v.workers.find(w => w.staffPlotId === home.id), b = f.v.workers.find(w => w.staffPlotId === recipient.id);
  source.storage.wheat = 100; foreignSource.storage.wheat = 100; recipient.storage.wheat = 4;
  const route = (worker, from, player) => f.act(worker, 'worker_assign', { resource: 'wheat', sourcePlotId: from.id,
    destinationPlotId: recipient.id, mode: 'store', targetPercent: 1 }, player);
  assert.throws(() => route(a, foreignSource, f.owner), /you own/);
  route(a, source, f.owner); route(b, foreignSource, f.resident);
  f.sim.disconnect(f.id, f.ownerId);
  atPlot(a, source); atPlot(b, foreignSource); f.tick();
  assert.equal(a.cargo.wheat + b.cargo.wheat, 11, 'a funded offline owner still contributes committed deliveries');
  assert.equal(source.storage.wheat + foreignSource.storage.wheat, 189);
  assert.equal(recipient.storage.wheat, 4);
  atPlot(a, recipient); atPlot(b, recipient); f.tick();
  assert.equal(recipient.storage.wheat, 15); assert.equal(a.cargo.wheat + b.cargo.wheat, 0);
  assert.equal(a.staffPlotId, home.id, 'redirecting a route does not transfer employment');
  f.sim.join(f.id, f.store.account(f.ownerId));
  Object.assign(f.owner, plotFront(PLOTS.find(p => p.id === recipient.id), 1));
  assert.throws(() => f.act(null, 'plot_withdraw', { plotId: recipient.id, resource: 'wheat', amount: 1 }), /owner/);
  assert.equal(recipient.storage.wheat, 15);
});

for (const blockedBy of ['pause', 'unpaid wages', 'fulfilled donor target']) {
  test(`a foreign delivery blocked by ${blockedBy} cannot starve the recipient's own transporter`, async t => {
    const f = await fixture(t), donorSource = f.build(0, 'house'), donorHome = f.build(1, 'tinker_shop');
    const recipient = f.build(2, 'tinker_shop', 1, f.residentId), ownSource = f.build(3, 'house', 1, f.residentId);
    const donor = f.v.workers.find(w => w.staffPlotId === donorHome.id), supplier = f.v.workers.find(w => w.staffPlotId === recipient.id);
    donorSource.storage.wheat = ownSource.storage.wheat = 100;
    const route = (worker, source, player, targetPercent) => f.act(worker, 'worker_assign', {
      resource: 'wheat', sourcePlotId: source.id, destinationPlotId: recipient.id, mode: 'store', targetPercent
    }, player);
    route(donor, donorSource, f.owner, 1); atPlot(donor, donorSource); f.tick();
    assert.equal(donor.cargo.wheat, 15); assert.equal(donorSource.storage.wheat, 85);
    if (blockedBy === 'pause') f.act(donor, 'worker_pause', { paused: true });
    if (blockedBy === 'unpaid wages') { f.owner.wallet = 0; donor.paidWorkSeconds = 0; }
    if (blockedBy === 'fulfilled donor target') recipient.storage.wheat = 20;
    route(supplier, ownSource, f.resident, blockedBy === 'fulfilled donor target' ? 2 : 1);
    atPlot(supplier, ownSource); f.tick();
    const refill = blockedBy === 'fulfilled donor target' ? 10 : 15;
    assert.equal(supplier.cargo.wheat, refill, 'the recipient can collect its entire actual shortfall');
    assert.equal(ownSource.storage.wheat, 100 - refill); assert.equal(donor.cargo.wheat, 15);
    atPlot(supplier, recipient); f.tick();
    assert.equal(recipient.storage.wheat, blockedBy === 'fulfilled donor target' ? 30 : 15);
    assert.equal(supplier.cargo.wheat, 0); assert.equal(donor.cargo.wheat, 15);
  });
}

test('mixed donations persist through SQLite and continue with an offline employer until that employer runs out of wages', async t => {
  const f = await fixture(t), mine = f.build(0, 'mine'), recipient = f.build(1, 'house', 1, f.residentId), worker = f.hire();
  f.assign(worker, mine, recipient);
  const node = f.v.plotResources.find(n => n.plotId === mine.id && n.type === 'sulfur');
  node.remaining = 1; atNode(worker, node, f.owner, true); f.tick();
  assert.equal(worker.cargo.sulfur, 1);
  f.owner.wallet = 1; worker.paidWorkSeconds = .1;
  f.sim.disconnect(f.id, f.ownerId); f.sim.saveAll(); const id = worker.id;
  f.restart(); f.sim.join(f.id, f.store.account(f.residentId));
  const restored = f.v.workers.find(w => w.id === id), destination = f.v.plots.find(p => p.id === recipient.id);
  assert.equal(restored.resource, 'mine_all'); assert.equal(restored.destinationOwnerId, f.residentId);
  assert.equal(restored.cargo.sulfur, 1); assert.equal(f.owner.online, false);
  restored.delivering = true; atPlot(restored, destination); f.tick();
  assert.equal(destination.storage.sulfur, 1); assert.equal(restored.cargo.sulfur, 0);
  const residentWallet = f.resident.wallet;
  until(f, () => /needs wallet gold/i.test(restored.status), 700);
  assert.equal(f.owner.wallet, 0); assert.equal(f.resident.wallet, residentWallet);
  const xp = restored.workXp, cargo = structuredClone(restored.cargo); f.tick(50);
  assert.equal(restored.workXp, xp); assert.deepEqual(restored.cargo, cargo);
  assert.equal(f.store.account(f.ownerId).bank, 500); assert.equal(f.store.account(f.residentId).bank, 900);
  f.sim.saveAll(); f.restart();
  assert.equal(f.v.plots.find(p => p.id === recipient.id).storage.sulfur, 1);
});

test('mixed mining replacement failures roll back actual resource harvest, bank debit and tool before retry', async t => {
  const f = await fixture(t), mine = f.build(0, 'mine'), recipient = f.build(1, 'house', 1, f.residentId), worker = f.hire();
  f.assign(worker, mine, recipient); f.act(worker, 'worker_buy_tool', { tool: 'pickaxe', tier: 'iron' });
  f.act(worker, 'worker_auto_replace', { enabled: true }); worker.equipment.pickaxe.durability = 1;
  const node = f.v.plotResources.find(n => n.plotId === mine.id && n.type === 'sulfur');
  node.remaining = 1; atNode(worker, node, f.owner, true); f.sim.saveAll();
  const save = f.store.saveVillage, wallet = f.owner.wallet, bank = f.store.account(f.ownerId).bank;
  f.store.saveVillage = () => { throw new Error('mixed mining disk failure'); };
  assert.throws(() => f.tick(), /mixed mining disk failure/); f.store.saveVillage = save;
  assert.equal(f.store.account(f.ownerId).bank, bank); assert.equal(f.owner.wallet, wallet);
  assert.equal(worker.cargo.sulfur, 0); assert.equal(worker.workXp, 0); assert.equal(node.remaining, 1);
  assert.equal(worker.equipment.pickaxe.durability, 1); assert.equal(worker.destinationOwnerId, f.residentId);
  atNode(worker, node, f.owner, true); f.tick();
  assert.equal(worker.cargo.sulfur, 1); assert.equal(worker.workXp, 1); assert.equal(node.remaining, 0);
  assert.equal(worker.equipment.pickaxe.durability, 200); assert.equal(f.store.account(f.ownerId).bank, bank - 100);
  const id = worker.id; f.restart();
  assert.equal(f.v.workers.find(w => w.id === id).cargo.sulfur, 1); assert.equal(f.store.account(f.ownerId).bank, bank - 100);
});

test('cart donations enforce the recipient limit at collection and recheck it at delivery', async t => {
  const f = await fixture(t), source = f.build(0, 'house'), home = f.build(1, 'tinker_shop');
  const recipient = f.build(2, 'house', 1, f.residentId), worker = f.v.workers.find(w => w.staffPlotId === home.id);
  source.storage.cart = 1; f.resident.inventory.cart = 1;
  f.act(worker, 'worker_assign', { resource: 'cart', sourcePlotId: source.id, destinationPlotId: recipient.id, mode: 'store', targetPercent: 100 });
  atPlot(worker, source); f.tick();
  assert.equal(worker.cargo.cart, 0); assert.equal(source.storage.cart, 1, 'no goods or wages are taken for a recipient already at the cart limit');
  assert.equal(worker.paidWorkSeconds, 0);
  f.resident.inventory.cart = 0; f.tick(); assert.equal(worker.cargo.cart, 1); assert.equal(source.storage.cart, 0);
  f.resident.inventory.cart = 1; atPlot(worker, recipient); f.tick();
  assert.equal(worker.cargo.cart, 1); assert.equal(recipient.storage.cart ?? 0, 0, 'a newly occupied allowance retains the in-flight cart');
  f.resident.inventory.cart = 0; f.tick();
  assert.equal(worker.cargo.cart, 0); assert.equal(recipient.storage.cart, 1);
});

test('legacy own-storage routes never become donations just because their destination changes owners before reload', async t => {
  const f = await fixture(t), mine = f.build(0, 'mine'), original = f.build(1, 'house'), worker = f.hire();
  f.assign(worker, mine, original); worker.cargo.iron = 3; worker.delivering = true;
  delete worker.destinationOwnerId;
  original.ownerId = f.residentId; f.store.saveVillage(f.v); const id = worker.id;
  f.restart(); f.sim.join(f.id, f.store.account(f.residentId));
  const restored = f.v.workers.find(w => w.id === id), plot = f.v.plots.find(p => p.id === original.id);
  assert.equal(restored.destinationOwnerId, f.ownerId);
  atPlot(restored, plot); f.tick();
  assert.equal(restored.cargo.iron, 3); assert.equal(plot.storage.iron ?? 0, 0);
  assert.match(restored.status, /storage building/);
});
