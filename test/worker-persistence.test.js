import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { Simulation, createVillage } from '../server/simulation.js';
import { BUILDINGS, plotFront } from '../shared/world.js';
import { WORKER_RULES } from '../shared/workers.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'emberwatch-worker-save-'));
  const f = { directory, store: new Store(directory) };
  t.after(async () => { f.store.close(); await rm(directory, { recursive: true, force: true }); });
  f.sim = new Simulation(f.store);
  const session = await f.store.authenticate('register', 'WorkerSaveOwner', 'worker-save-test-password');
  f.account = f.store.account(session.playerId);
  f.restart = () => {
    f.store.close();
    f.store = new Store(directory);
    f.sim = new Simulation(f.store);
  };
  return f;
}

function savedWork(w) {
  return structuredClone({
    id: w.id, ownerId: w.ownerId, name: w.name, x: w.x, z: w.z, yaw: w.yaw,
    resource: w.resource, sourcePlotId: w.sourcePlotId, mode: w.mode,
    destinationPlotId: w.destinationPlotId, paused: w.paused, cargo: w.cargo,
    paidWorkSeconds: w.paidWorkSeconds, gatherProgress: w.gatherProgress,
    targetNodeId: w.targetNodeId, delivering: w.delivering
  });
}

test('real worker progress survives SQLite restart and resumes without another hiring charge or offline work', async t => {
  const f = await fixture(t);
  const { id } = f.sim.create('Working Hearth', f.account);
  const player = f.sim.join(id, f.account), village = f.sim.villages.get(id);
  player.wallet = 1000;
  Object.assign(player, plotFront(BUILDINGS.find(b => b.id === 'bank'), -1.3));
  f.store.bank(player.id, 57);
  f.sim.action(id, player.id, { kind: 'worker_hire' });
  assert.equal(player.wallet, 1000 - WORKER_RULES.hireCost);
  const worker = village.workers[0];
  const start = { x: worker.x, z: worker.z };
  f.sim.tick(.7);
  f.sim.action(id, player.id, { kind: 'worker_assign', workerId: worker.id, resource: 'stone', sourcePlotId: null, mode: 'sell', destinationPlotId: null });
  for (let i = 0; i < 2400 && worker.cargo.stone < 1; i++) f.sim.tick(.05);
  assert.equal(worker.cargo.stone, 1, 'the worker walks to a real public node and harvests through Simulation.tick');
  assert.ok(Math.hypot(worker.x - start.x, worker.z - start.z) > 10, 'cargo was earned after actual navigation');
  assert.ok(player.wallet < 1000 - WORKER_RULES.hireCost, 'working time is paid before the checkpoint');
  assert.ok(worker.paidWorkSeconds > 0 && worker.paidWorkSeconds < WORKER_RULES.wageSeconds);
  const expected = savedWork(worker), wallet = player.wallet, clock = village.clock;
  const treasury = village.treasury, resources = structuredClone(village.resources);
  f.sim.saveAll();
  f.restart();

  const restoredVillage = f.sim.villages.get(id), restoredWorker = restoredVillage.workers[0];
  assert.equal(restoredVillage.workers.length, 1);
  assert.deepEqual(savedWork(restoredWorker), expected);
  assert.ok(Object.values(restoredVillage.players).every(p => !p.online));
  f.sim.tick(3600);
  assert.equal(restoredVillage.clock, clock, 'an empty village does not simulate time while its owner is offline');
  assert.deepEqual(savedWork(restoredWorker), expected, 'offline ticks do not generate cargo or consume prepaid wages');
  assert.deepEqual(restoredVillage.resources, resources);
  assert.equal(restoredVillage.treasury, treasury);
  assert.equal(restoredVillage.players[player.id].wallet, wallet);
  assert.equal(f.store.account(player.id).bank, 57);

  const returningPlayer = f.sim.join(id, f.store.account(player.id));
  assert.equal(returningPlayer.wallet, wallet, 'rejoining neither charges another hiring fee nor grants new starter gold');
  assert.deepEqual(savedWork(restoredVillage.workers[0]), expected);
  for (let i = 0; i < 400 && restoredWorker.cargo.stone < 2; i++) f.sim.tick(.05);
  assert.equal(restoredWorker.cargo.stone, 2, 'the saved assignment resumes automatically on the same worker');
  assert.equal(restoredWorker.id, expected.id);
  assert.ok(wallet - returningPlayer.wallet <= WORKER_RULES.wageGold, 'resumed work costs only any due wage increment');
  assert.equal(f.store.account(player.id).bank, 57, 'employment never touches protected bank savings');
});

test('a legacy SQLite village without workers loads an empty roster without replacing its treasury', async t => {
  const f = await fixture(t);
  const legacy = createVillage('Before Hired Hands', f.account.id);
  delete legacy.workers;
  legacy.treasury = 777;
  f.store.saveVillage(legacy);
  assert.equal(f.store.loadVillages()[0].workers, undefined, 'fixture contains a real saved record from before workers');
  f.restart();
  const restored = f.sim.villages.get(legacy.id);
  assert.deepEqual(restored.workers, []);
  assert.equal(restored.treasury, 777, 'adding worker defaults must not reissue starting village gold');
  f.sim.saveAll();
  const persisted = f.store.loadVillages().find(v => v.id === legacy.id);
  assert.deepEqual(persisted.workers, []);
  assert.equal(persisted.treasury, 777);
});
