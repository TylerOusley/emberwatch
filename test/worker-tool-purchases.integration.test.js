import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { Simulation } from '../server/simulation.js';
import { ensureWorkers } from '../server/workers.js';
import { ensureOwnership } from '../server/ownership.js';
import { buildingEntrance } from '../shared/access.js';
import { BUILDINGS, RESOURCES, canStand } from '../shared/world.js';
import { workerStats, workerTool } from '../shared/workers.js';

// Actual account balances, Simulation actions and SQLite restarts exercise the
// boundary between persistent bank savings and the saved worker equipment.
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'emberwatch-worker-tool-purchases-'));
  const f = { directory, store: new Store(directory) };
  t.after(async () => { f.store.close(); await rm(directory, { recursive: true, force: true }); });
  for (const [key, name] of [['owner', 'ToolEmployer'], ['resident', 'ToolResident']]) {
    const session = await f.store.authenticate('register', name, 'worker-tool-regression-password');
    f[`${key}Id`] = session.playerId;
  }
  f.sim = new Simulation(f.store, { daySeconds: 10000 });
  f.id = f.sim.create('Workers Forge', f.store.account(f.ownerId)).id;
  f.owner = f.sim.join(f.id, f.store.account(f.ownerId));
  f.resident = f.sim.join(f.id, f.store.account(f.residentId));
  f.v = f.sim.villages.get(f.id);
  f.owner.wallet = 10000; f.resident.wallet = 10000;
  f.store.bank(f.ownerId, 1000); f.store.bank(f.residentId, 2000);
  f.node = RESOURCES.find(node => node.type === 'stone' && canStand(node.x, node.z + 1.6, .4));
  for (const state of f.v.resources) {
    state.available = state.id === f.node.id;
    state.remaining = state.available ? 1000 : 0;
    state.regrowAt = 100000;
  }
  f.act = (worker, kind, data = {}, player = f.owner) => {
    player.lastAction = -100;
    return f.sim.action(f.id, player.id, { kind, workerId: worker?.id, ...data });
  };
  f.hire = () => {
    Object.assign(f.owner, buildingEntrance(BUILDINGS.find(b => b.id === 'bank')));
    f.act(null, 'worker_hire');
    return f.v.workers.at(-1);
  };
  f.assign = worker => {
    f.act(worker, 'worker_assign', { resource: 'stone', sourcePlotId: null, mode: 'sell', destinationPlotId: null });
    worker.paidWorkSeconds = 30;
    f.prepareHarvest(worker);
  };
  f.prepareHarvest = worker => Object.assign(worker, {
    x: f.node.x, z: f.node.z + 1.6, targetNodeId: f.node.id,
    gatherProgress: workerStats(worker, f.owner).gatherSeconds - .1
  });
  f.harvest = worker => {
    const xp = worker.workXp;
    f.prepareHarvest(worker); f.sim.tick(.1);
    assert.equal(worker.workXp, xp + 1, worker.status);
  };
  f.buy = (worker, tier = 'iron', tool = 'pickaxe') => f.act(worker, 'worker_buy_tool', { tool, tier });
  f.auto = (worker, enabled = true) => f.act(worker, 'worker_auto_replace', { enabled });
  f.setBank = value => f.store.bank(f.ownerId, value - f.store.account(f.ownerId).bank);
  f.restart = () => {
    f.store.close(); f.store = new Store(directory);
    f.sim = new Simulation(f.store, { daySeconds: 10000 });
    f.v = f.sim.villages.get(f.id);
    f.owner = f.v.players[f.ownerId]; f.resident = f.v.players[f.residentId];
  };
  return f;
}

test('remote purchases cost exactly 30 or 100 wallet gold without consuming carried tools or materials', async t => {
  const f = await fixture(t), worker = f.hire();
  Object.assign(f.owner, { x: 0, z: -100 });
  Object.assign(f.owner.inventory, { stone: 17, iron: 13, coal: 11, timber: 19 });
  Object.assign(f.owner.tiers, { pickaxe: 'wood', axe: 'wood', scythe: 'wood' });
  Object.assign(f.owner.durability, { pickaxe: 0, axe: 0, scythe: 0 });
  const inventory = structuredClone(f.owner.inventory), gear = structuredClone(f.owner.durability);
  const wallet = f.owner.wallet, bank = f.store.account(f.ownerId).bank;
  assert.equal(worker.autoReplaceEnabled, false, 'purchasing must not opt in to bank spending');
  f.buy(worker, 'stone', 'axe'); f.buy(worker, 'iron', 'pickaxe'); f.buy(worker, 'stone', 'scythe');
  assert.equal(f.owner.wallet, wallet - 160); assert.equal(f.store.account(f.ownerId).bank, bank);
  assert.deepEqual(f.owner.inventory, inventory); assert.deepEqual(f.owner.durability, gear);
  for (const [tool, tier, durability] of [['axe', 'stone', 150], ['pickaxe', 'iron', 200], ['scythe', 'stone', 150]]) {
    assert.deepEqual(worker.equipment[tool], { tier, durability, maxDurability: durability, workerOnly: true });
  }
  const paid = f.owner.wallet;
  assert.throws(() => f.buy(worker), /already|same|intact/i);
  assert.equal(f.owner.wallet, paid, 'a repeated purchase does not charge for an intact matching tool');
  Object.assign(f.owner, { x: worker.x, z: worker.z });
  assert.throws(() => f.act(worker, 'worker_unequip', { tool: 'pickaxe' }), /worker|recover|purchased/i);
  assert.equal(f.owner.durability.pickaxe, 0, 'discounted worker equipment cannot become personal gear');
});

test('tool purchase and automatic replacement commands validate ownership, tiers and explicit boolean consent', async t => {
  const f = await fixture(t), worker = f.hire(), wallet = f.owner.wallet;
  for (const tier of ['wood', 'gold', '', null, 100, '__proto__']) {
    assert.throws(() => f.buy(worker, tier), /stone|iron|tier|tool/i);
  }
  for (const tool of ['sword', 'bow', '__proto__', null]) {
    assert.throws(() => f.buy(worker, 'iron', tool), /axe|pickaxe|scythe|tool/i);
  }
  assert.throws(() => f.act(worker, 'worker_buy_tool', { tool: 'pickaxe', tier: 'iron' }, f.resident), /own workers/i);
  assert.throws(() => f.act(worker, 'worker_auto_replace', { enabled: true }, f.resident), /own workers/i);
  for (const enabled of [1, 'true', undefined, null]) {
    assert.throws(() => f.act(worker, 'worker_auto_replace', { enabled }), /whether|enable|boolean|automatic/i);
  }
  assert.equal(f.owner.wallet, wallet); assert.deepEqual(worker.equipment, {});
  assert.equal(worker.autoReplaceEnabled, false);
  f.owner.wallet = 29; f.store.issueCredit(f.ownerId, 200);
  assert.throws(() => f.buy(worker, 'stone'), /wallet|gold|cost/i);
  assert.equal(f.owner.wallet, 29); assert.equal(f.store.account(f.ownerId).bank, 1000);
  assert.equal(f.store.account(f.ownerId).credit, 200, 'manual tool buying cannot silently draw credit or bank savings');
});

for (const [tier, cost, durability] of [['stone', 30, 150], ['iron', 100, 200]]) {
  test(`${tier} automatic replacement buys the same tier on each break from the owner's bank only`, async t => {
    const f = await fixture(t), worker = f.hire();
    f.assign(worker); f.buy(worker, tier); f.auto(worker);
    const wallet = f.owner.wallet, bank = f.store.account(f.ownerId).bank;
    const residentBank = f.store.account(f.residentId).bank;
    for (let i = 1; i <= 2; i++) {
      worker.equipment.pickaxe.durability = 1;
      f.harvest(worker);
      assert.equal(worker.equipment.pickaxe.tier, tier);
      assert.equal(worker.equipment.pickaxe.durability, durability);
      assert.equal(worker.equipment.pickaxe.workerOnly, true);
      assert.equal(f.store.account(f.ownerId).bank, bank - cost * i);
      assert.equal(f.owner.wallet, wallet, 'prepaid working time isolates replacement cost from wages');
      assert.equal(f.store.account(f.residentId).bank, residentBank);
    }
    const equipment = structuredClone(worker.equipment), id = worker.id;
    // Replacement itself saves the completed harvest. No extra saveAll is used.
    f.restart();
    const restored = f.v.workers.find(w => w.id === id);
    assert.deepEqual(restored.equipment, equipment); assert.equal(restored.autoReplaceEnabled, true);
    assert.equal(restored.workXp, 2); assert.equal(f.store.account(f.ownerId).bank, bank - cost * 2);
    f.sim.join(f.id, f.store.account(f.ownerId)); f.sim.tick(.1);
    assert.equal(f.store.account(f.ownerId).bank, bank - cost * 2, 'restart cannot charge again for a completed replacement');
  });
}

test('insufficient bank savings fall back to wood and a later deposit resumes without taking wallet gold or credit', async t => {
  const f = await fixture(t), worker = f.hire();
  f.assign(worker); f.buy(worker); f.auto(worker); f.setBank(99); f.store.issueCredit(f.ownerId, 200);
  const wallet = f.owner.wallet;
  worker.equipment.pickaxe.durability = 1; f.harvest(worker);
  assert.equal(worker.equipment.pickaxe.durability, 0); assert.equal(workerTool(worker).tier, 'wood');
  f.harvest(worker);
  assert.equal(f.store.account(f.ownerId).bank, 99); assert.equal(f.owner.wallet, wallet);
  assert.equal(f.store.account(f.ownerId).credit, 200); assert.equal(worker.workXp, 2);
  f.store.bank(f.ownerId, 1); f.harvest(worker);
  assert.equal(f.store.account(f.ownerId).bank, 0); assert.equal(worker.equipment.pickaxe.durability, 199);
  assert.equal(workerTool(worker).tier, 'iron'); assert.equal(f.owner.wallet, wallet);
});

test('the replacement toggle can stop future bank spending immediately and re-enable an already broken tool', async t => {
  const f = await fixture(t), worker = f.hire();
  f.assign(worker); f.buy(worker, 'stone'); f.auto(worker); f.auto(worker, false);
  worker.equipment.pickaxe.durability = 1; const bank = f.store.account(f.ownerId).bank;
  f.harvest(worker); f.harvest(worker);
  assert.equal(worker.equipment.pickaxe.durability, 0); assert.equal(f.store.account(f.ownerId).bank, bank);
  f.auto(worker); assert.equal(f.store.account(f.ownerId).bank, bank, 'opting in does not buy before work resumes');
  f.harvest(worker);
  assert.equal(worker.equipment.pickaxe.durability, 149); assert.equal(f.store.account(f.ownerId).bank, bank - 30);
});

test('offline owners fund opted-in replacements while another resident is active, but empty villages spend nothing', async t => {
  const f = await fixture(t), worker = f.hire();
  f.assign(worker); f.buy(worker); f.auto(worker); worker.equipment.pickaxe.durability = 1;
  const bank = f.store.account(f.ownerId).bank;
  f.sim.disconnect(f.id, f.ownerId); f.harvest(worker);
  assert.equal(f.owner.online, false); assert.equal(f.store.account(f.ownerId).bank, bank - 100);
  assert.equal(f.store.account(f.residentId).bank, 2000);
  worker.equipment.pickaxe.durability = 0; f.prepareHarvest(worker);
  f.sim.disconnect(f.id, f.residentId); const before = structuredClone(worker), clock = f.v.clock;
  f.sim.tick(3600);
  assert.deepEqual(worker, before); assert.equal(f.v.clock, clock);
  assert.equal(f.store.account(f.ownerId).bank, bank - 100);
});

test('paused, retired, role-suspended and unpaid workers never spend bank savings on replacements', async t => {
  const f = await fixture(t);
  f.owner.role = 'manager';
  const workers = Array.from({ length: 6 }, () => f.hire());
  for (const worker of workers) {
    f.assign(worker); f.buy(worker); f.auto(worker); worker.equipment.pickaxe.durability = 0;
  }
  for (const worker of workers.slice(0, 5)) worker.paused = true;
  f.owner.role = 'villager';
  const bank = f.store.account(f.ownerId).bank; f.sim.tick(.1);
  assert.equal(workers[5].roleLimitPaused, true); assert.equal(f.store.account(f.ownerId).bank, bank);
  const mine = f.v.plots[0]; Object.assign(mine, { ownerId: f.ownerId, building: 'mine', level: 1, hp: 500, maxHp: 500 });
  ensureOwnership(f.v); ensureWorkers(f.v);
  const staff = f.v.workers.find(w => w.staffPlotId === mine.id);
  f.buy(staff); f.auto(staff); staff.equipment.pickaxe.durability = 0;
  mine.hp = 0; staff.paused = false; f.sim.tick(.1);
  assert.equal(staff.staffRetired, true); assert.equal(f.store.account(f.ownerId).bank, bank);
  workers[0].paused = false; workers[0].paidWorkSeconds = 0; f.owner.wallet = 0;
  f.prepareHarvest(workers[0]); f.sim.tick(.1);
  assert.equal(workers[0].equipment.pickaxe.durability, 0); assert.equal(f.store.account(f.ownerId).bank, bank);
});

test('two workers sharing one bank cannot overdraw or replace on another resident\'s savings', async t => {
  const f = await fixture(t), workers = [f.hire(), f.hire()];
  for (const worker of workers) { f.assign(worker); f.buy(worker); f.auto(worker); worker.equipment.pickaxe.durability = 0; }
  f.setBank(100); for (const worker of workers) f.prepareHarvest(worker);
  f.sim.tick(.1);
  assert.deepEqual(workers.map(w => w.workXp), [1, 1]);
  assert.equal(workers.filter(w => w.equipment.pickaxe.durability > 0).length, 1);
  assert.equal(workers.filter(w => workerTool(w).tier === 'wood').length, 1);
  assert.equal(f.store.account(f.ownerId).bank, 0); assert.equal(f.store.account(f.residentId).bank, 2000);
  f.setBank(100); for (const worker of workers) f.prepareHarvest(worker);
  f.sim.tick(.1);
  assert.ok(workers.every(w => w.equipment.pickaxe.durability > 0)); assert.equal(f.store.account(f.ownerId).bank, 0);
});

test('failed manual purchase persistence restores wallet and equipment before a successful retry', async t => {
  const f = await fixture(t), worker = f.hire(), wallet = f.owner.wallet;
  const save = f.store.saveVillage;
  f.store.saveVillage = () => { throw new Error('tool purchase disk failure'); };
  assert.throws(() => f.buy(worker, 'stone'), /disk failure/);
  f.store.saveVillage = save;
  assert.equal(f.owner.wallet, wallet); assert.deepEqual(worker.equipment, {});
  assert.equal(f.store.account(f.ownerId).bank, 1000);
  f.buy(worker, 'stone'); const id = worker.id; f.restart();
  assert.equal(f.owner.wallet, wallet - 30);
  assert.equal(f.v.workers.find(w => w.id === id).equipment.pickaxe.durability, 150);
});

test('failed automatic replacement persistence rolls back bank, tool, cargo and node consumption together', async t => {
  const f = await fixture(t), worker = f.hire();
  f.assign(worker); f.buy(worker); f.auto(worker); worker.equipment.pickaxe.durability = 1;
  f.prepareHarvest(worker); f.sim.saveAll();
  const bank = f.store.account(f.ownerId).bank, wallet = f.owner.wallet;
  const cargo = structuredClone(worker.cargo), xp = worker.workXp;
  const remaining = f.v.resources.find(n => n.id === f.node.id).remaining;
  const save = f.store.saveVillage;
  f.store.saveVillage = () => { throw new Error('replacement disk failure'); };
  assert.throws(() => f.sim.tick(.1), /disk failure/);
  f.store.saveVillage = save;
  assert.equal(f.store.account(f.ownerId).bank, bank); assert.equal(f.owner.wallet, wallet);
  assert.equal(worker.equipment.pickaxe.durability, 1); assert.deepEqual(worker.cargo, cargo);
  assert.equal(worker.workXp, xp); assert.equal(f.v.resources.find(n => n.id === f.node.id).remaining, remaining);
  const id = worker.id; f.restart();
  const restored = f.v.workers.find(w => w.id === id);
  assert.equal(restored.equipment.pickaxe.durability, 1); assert.equal(f.store.account(f.ownerId).bank, bank);
  f.sim.join(f.id, f.store.account(f.ownerId)); f.harvest(restored);
  assert.equal(restored.equipment.pickaxe.durability, 200); assert.equal(f.store.account(f.ownerId).bank, bank - 100);
  f.restart();
  assert.equal(f.v.workers.find(w => w.id === id).equipment.pickaxe.durability, 200);
  assert.equal(f.store.account(f.ownerId).bank, bank - 100);
});

test('a later worker save failure preserves the first worker\'s committed purchase and retries only the unpaid replacement', async t => {
  const f = await fixture(t), workers = [f.hire(), f.hire()];
  for (const worker of workers) {
    f.assign(worker); f.buy(worker); f.auto(worker); worker.equipment.pickaxe.durability = 1;
  }
  f.setBank(200); for (const worker of workers) f.prepareHarvest(worker);
  f.sim.saveAll();
  const save = f.store.saveVillage; let saves = 0;
  f.store.saveVillage = function(village) {
    if (++saves === 2) throw new Error('second replacement disk failure');
    return save.call(this, village);
  };
  assert.throws(() => f.sim.tick(.1), /second replacement disk failure/);
  f.store.saveVillage = save;
  assert.equal(f.store.account(f.ownerId).bank, 100);
  assert.deepEqual(workers.map(w => w.equipment.pickaxe.durability), [200, 1]);
  assert.deepEqual(workers.map(w => w.workXp), [1, 0]);
  const ids = workers.map(w => w.id); f.restart();
  const restored = ids.map(id => f.v.workers.find(w => w.id === id));
  assert.deepEqual(restored.map(w => w.equipment.pickaxe.durability), [200, 1]);
  assert.equal(f.store.account(f.ownerId).bank, 100);
  f.sim.join(f.id, f.store.account(f.ownerId)); f.harvest(restored[1]);
  assert.equal(f.store.account(f.ownerId).bank, 0);
  assert.deepEqual(restored.map(w => w.workXp), [1, 1]);
});

test('rebuilding a gathering plot as a shop leaves its former worker able to disable bank replacements', async t => {
  const f = await fixture(t), plot = f.v.plots[0];
  Object.assign(plot, { ownerId: f.ownerId, building: 'mine', level: 1, hp: 500, maxHp: 500 });
  ensureOwnership(f.v); ensureWorkers(f.v);
  const worker = f.v.workers.find(w => w.staffPlotId === plot.id);
  f.buy(worker); f.auto(worker);
  plot.building = 'tinker_shop'; ensureWorkers(f.v);
  assert.equal(worker.staffRole, 'transporter'); assert.equal(worker.autoReplaceEnabled, true);
  assert.doesNotThrow(() => f.auto(worker, false));
  assert.equal(worker.autoReplaceEnabled, false); assert.equal(f.store.account(f.ownerId).bank, 1000);
});

test('legacy maintenance never opts into bank spending and supplied gear remains recoverable after migration', async t => {
  const f = await fixture(t), worker = f.hire(), id = worker.id;
  worker.equipment.pickaxe = { tier: 'stone', durability: 47, maxDurability: 150 };
  Object.assign(worker, { maintenanceEnabled: true, maintenanceBudgetGold: 500, maintenancePlotId: f.v.plots[0].id });
  delete worker.autoReplaceEnabled;
  f.sim.saveAll(); f.restart();
  const restored = f.v.workers.find(w => w.id === id);
  assert.equal(restored.autoReplaceEnabled, false); assert.equal(restored.equipment.pickaxe.durability, 47);
  assert.notEqual(restored.equipment.pickaxe.workerOnly, true);
  f.sim.join(f.id, f.store.account(f.ownerId));
  const own = f.sim.snapshot(f.v, f.ownerId).workers.find(w => w.id === id);
  const other = f.sim.snapshot(f.v, f.residentId).workers.find(w => w.id === id);
  assert.equal(own.autoReplaceEnabled, false); assert.equal(other.autoReplaceEnabled, undefined);
  assert.equal(other.equipment, undefined); assert.equal(other.tiers.pickaxe, 'stone');
  Object.assign(f.owner, { x: restored.x, z: restored.z }); f.owner.durability.pickaxe = 0;
  f.act(restored, 'worker_unequip', { tool: 'pickaxe' });
  assert.equal(f.owner.durability.pickaxe, 47); assert.equal(f.owner.tiers.pickaxe, 'stone');
  assert.equal(restored.equipment.pickaxe, undefined); assert.equal(f.store.account(f.ownerId).bank, 1000);
});
