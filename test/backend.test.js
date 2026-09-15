import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingEntrance } from '../shared/access.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createApp } from '../server/index.js';
import { BUILDINGS, RESOURCES, GUARD_ROAD, canStand } from '../shared/world.js';

async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'emberwatch-test-'));
  const app = createApp({ dataDir, autoTick: false, ...options });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  return { app, base, dataDir };
}
async function account(app, name) {
  const session = await app.store.authenticate('register', name, 'a-good-test-pass');
  return { session, user: app.store.accountFromToken(session.token) };
}
async function joinSocket(base, session, villageId, role = 'guard') {
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/socket');
  const queue = [];
  ws.on('message', data => queue.push(JSON.parse(data.toString())));
  await once(ws, 'open');
  ws.send(JSON.stringify({ type: 'join', token: session.token, villageId, role }));
  await waitFor(() => queue.find(m => m.type === 'state'));
  return { ws, queue };
}
async function waitFor(fn, timeout = 2000) {
  const end = performance.now() + timeout;
  while (performance.now() < end) { const result = fn(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw new Error('Timed out waiting for expected state.');
}
function action(app, village, player, message) { village.clock += .7; return app.simulation.action(village.id, player.id, message); }

test('HTTP authentication, real WebSocket multiplayer synchronization, and stale inputs', async t => {
  const { app, base } = await fixture(t);
  const auth = async name => {
    const response = await fetch(base + '/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'register', name, password: 'a-good-test-pass' }) });
    assert.equal(response.status, 200); return response.json();
  };
  const alice = await auth('Alice'), bob = await auth('Bobby');
  const response = await fetch(base + '/api/villages', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${alice.token}` }, body: JSON.stringify({ name: 'Oakwatch' }) });
  const { village: summary } = await response.json();
  const a = await joinSocket(base, alice, summary.id), b = await joinSocket(base, bob, summary.id, 'priest');
  const village = app.simulation.villages.get(summary.id), p = village.players[alice.playerId];
  // This synchronization scenario represents a dwarf who has obtained an axe.
  // New-arrival equipment and purchasing are covered by the starter tests.
  p.durability.axe = 100; p.backpackTier = 3;
  const oldX = p.x;
  a.ws.send(JSON.stringify({ type: 'input', x: 1, z: 0, yaw: Math.PI / 2, sprint: false, tool: 'axe' }));
  await waitFor(() => app.simulation.inputs.get(p.id));
  app.simulation.tick(.1); app.broadcast();
  const synced = await waitFor(() => b.queue.find(m => m.type === 'state' && m.state.players.find(q => q.id === p.id)?.x > oldX));
  assert.equal(synced.state.players.length, 2);
  assert.equal(synced.state.players.find(q => q.id === p.id).tool, 'axe');
  assert.equal(synced.state.players.find(q => q.id === p.id).backpackTier, 3, 'worn backpack tier replicates to another player');
  assert.equal(synced.state.players.find(q => q.id === p.id).inventory, undefined, 'visible equipment does not expose private inventory');
  assert.equal(synced.state.players.find(q => q.id === p.id).wallet, undefined, 'other players never receive private wallet or bank values');
  assert.ok(p.x - oldX <= 5.4 * .1 + .001);
  const beforeTurn = { x: p.x, z: p.z };
  a.ws.send(JSON.stringify({ type: 'input', x: 0, z: 0, yaw: .75, sprint: false, tool: 'axe' }));
  await waitFor(() => app.simulation.inputs.get(p.id)?.yaw === .75);
  app.simulation.tick(.1); app.broadcast();
  await waitFor(() => b.queue.find(m => m.type === 'state' && m.state.players.find(q => q.id === p.id)?.yaw === .75));
  assert.equal(p.x, beforeTurn.x); assert.equal(p.z, beforeTurn.z, 'stationary tool aiming is shared without moving the player');
  app.simulation.inputs.get(p.id).received = -100000;
  const stoppedX = p.x; app.simulation.tick(.1); assert.equal(p.x, stoppedX, 'disconnected/stalled input never makes a dwarf walk forever');
  assert.throws(() => app.simulation.input(village.id, p.id, { x: Infinity, z: 0, yaw: 0 }), /Invalid movement/);
  // Worker contracts travel over the same authenticated socket as player actions.
  Object.assign(p, buildingEntrance(BUILDINGS.find(b => b.id === 'bank')), { wallet: 300 });
  village.clock += 1;
  a.ws.send(JSON.stringify({ type: 'action', kind: 'worker_hire', ownerId: bob.playerId, price: 0 }));
  await waitFor(() => village.workers.length === 1);
  const worker = village.workers[0];
  assert.equal(worker.ownerId, p.id, 'the socket identity owns and pays for the contract');
  assert.equal(p.wallet, 225);
  app.broadcast();
  const ownedCrew = await waitFor(() => a.queue.find(m => m.type === 'state' && m.state.workers?.some(w => w.id === worker.id)));
  const remoteCrew = await waitFor(() => b.queue.find(m => m.type === 'state' && m.state.workers?.some(w => w.id === worker.id)));
  assert.deepEqual(ownedCrew.state.workers[0].cargo, worker.cargo);
  assert.equal(remoteCrew.state.workers[0].cargo, undefined, 'worker cargo is private to the employer');
  assert.equal(remoteCrew.state.workers[0].resource, undefined, 'orders are private to the employer');
  assert.equal(remoteCrew.state.workers[0].backpackTier, 1, 'other residents see the worker and their worn equipment');
  b.ws.send(JSON.stringify({ type: 'action', kind: 'worker_pause', workerId: worker.id, paused: false }));
  await waitFor(() => b.queue.find(m => m.type === 'error' && /own|yours|another|belong/i.test(m.message)));
  const list = await (await fetch(base + '/api/villages')).json();
  assert.equal(list.villages[0].online, 2);
  a.ws.close(); b.ws.close();
  await waitFor(() => Object.values(village.players).every(q => !q.online));
  const clock = village.clock, treasury = village.treasury; app.simulation.tick(100);
  assert.equal(village.clock, clock); assert.equal(village.treasury, treasury);
});

test('eight persistent residents includes offline members and rejects a ninth', async t => {
  const { app } = await fixture(t);
  const founder = await account(app, 'Founder');
  const { id } = app.simulation.create('Eight Hearths', founder.user);
  app.simulation.join(id, founder.user);
  app.simulation.disconnect(id, founder.user.id);
  for (let i = 0; i < 7; i++) {
    const { user } = await account(app, `Resident${i}`);
    app.simulation.join(id, user); app.simulation.disconnect(id, user.id);
  }
  const ninth = await account(app, 'NinthDwarf');
  assert.throws(() => app.simulation.join(id, ninth.user), /eight resident places/);
  assert.deepEqual(app.simulation.list()[0], { id, name: 'Eight Hearths', day: 1, online: 0, residents: 8, maxResidents: 8, status: 'active' });
  assert.equal(app.simulation.join(id, founder.user).id, founder.user.id, 'offline resident can reclaim their reserved place');
});

test('repair validation, finite material consumption, and separate ten-gold dawn payout', async t => {
  const { app } = await fixture(t);
  const { user } = await account(app, 'RepairDwarf');
  const { id } = app.simulation.create('Gatewatch', user);
  const p = app.simulation.join(id, user, 'guard'), village = app.simulation.villages.get(id);
  p.tool = 'hammer'; p.durability.hammer = 100; p.x = 0; p.z = 15;
  const funds = village.treasury, wood = village.stock.timber, hp = village.gate.hp;
  assert.throws(() => action(app, village, p, { kind: 'repair', targetId: 'gate' }), /fully repaired/);
  assert.equal(village.stock.timber, wood); assert.equal(village.treasury, funds); assert.equal(p.repairBonus, 0);
  village.gate.hp = 1;
  p.x = 20;
  assert.throws(() => action(app, village, p, { kind: 'repair', targetId: 'gate' }), /closer/);
  p.x = 0;
  for (let i = 0; i < 12; i++) action(app, village, p, { kind: 'repair', targetId: 'gate' });
  assert.equal(p.repairBonus, 10); assert.equal(village.treasury, funds - 10); assert.equal(village.stock.timber, wood - 12);
  assert.equal(village.gate.hp, 421); assert.equal(p.durability.hammer, 88);
  assert.throws(() => app.simulation.action(id, p.id, { kind: 'repair', targetId: 'gate' }), /next action/);
  const oldBonus = p.repairBonus; village.stock.timber = 0;
  assert.throws(() => action(app, village, p, { kind: 'repair', targetId: 'gate' }), /materials/);
  assert.equal(p.repairBonus, oldBonus); assert.equal(village.gate.hp, 421);
  p.participated = 720; p.wageAccrued = 25; p.jobBonus = 25; const wallet = p.wallet;
  app.simulation.dawn(village);
  assert.equal(p.wallet, wallet + 60); assert.equal(p.repairBonus, 0); assert.equal(p.jobBonus, 0);
});

test('persistent protected savings, new process recovery, no offline advancement, and authenticated login', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'emberwatch-restart-'));
  let app = createApp({ dataDir: directory, autoTick: false });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const { user, session } = await account(app, 'BankDwarf');
  const { id } = app.simulation.create('Saved Hearth', user), village = app.simulation.villages.get(id), p = app.simulation.join(id, user);
  Object.assign(p, buildingEntrance(BUILDINGS.find(b => b.id === 'bank'))); p.wallet = 50; // A funded savings scenario, beyond the new-arrival allowance.
  action(app, village, p, { kind: 'deposit', amount: 30 });
  assert.equal(p.wallet, 20); assert.equal(app.store.account(p.id).bank, 30);
  assert.throws(() => action(app, village, p, { kind: 'withdraw', amount: 31 }), /Insufficient/);
  assert.equal(p.wallet, 20); assert.equal(app.store.account(p.id).bank, 30);
  assert.throws(() => action(app, village, p, { kind: 'deposit', amount: -10 }), /whole gold/);
  village.day = 4; village.phase = 'night'; village.phaseRemaining = 123;
  app.simulation.saveAll(); await app.close();
  app = createApp({ dataDir: directory, autoTick: false });
  const recovered = app.simulation.villages.get(id);
  assert.equal(recovered.phaseRemaining, 123); assert.equal(recovered.players[p.id].online, false);
  app.simulation.tick(1000); assert.equal(recovered.phaseRemaining, 123);
  const accountAgain = app.store.accountFromToken(session.token);
  assert.equal(accountAgain.bank, 30);
  await assert.rejects(app.store.authenticate('login', 'BankDwarf', 'incorrect-password'), /incorrect/);
  const login = await app.store.authenticate('login', 'bankdwarf', 'a-good-test-pass');
  assert.equal(login.playerId, p.id);
  assert.equal(app.simulation.join(id, accountAgain).wallet, 20);
  assert.equal(app.store.initialWallet(p.id), 0, 'starter allowance cannot be minted again');
});

test('gathering uses real nodes and tools; downed dwarfs wait until dawn and choose to respawn', async t => {
  const { app } = await fixture(t);
  const { user } = await account(app, 'MinerDwarf');
  const { id } = app.simulation.create('Stonehome', user), village = app.simulation.villages.get(id), p = app.simulation.join(id, user);
  const node = RESOURCES.find(r => r.type === 'wheat');
  p.x = node.x; p.z = node.z; p.tool = 'pickaxe';
  assert.throws(() => action(app, village, p, { kind: 'gather', targetId: node.id }), /scythe/);
  p.tool = 'scythe'; p.durability.scythe = 100; action(app, village, p, { kind: 'gather', targetId: node.id });
  assert.equal(p.inventory.wheat, 1); assert.equal(p.durability.scythe, 99);
  assert.throws(() => action(app, village, p, { kind: 'gather', targetId: node.id }), /regrowing/);
  app.simulation.hurtPlayer(village, p, p.hp + (p.shield ?? 0));
  assert.throws(() => action(app, village, p, { kind: 'respawn' }), /next dawn/);
  assert.throws(() => action(app, village, p, { kind: 'gather', targetId: node.id }), /downed/);
  app.simulation.dawn(village);
  assert.equal(p.downed, true); assert.equal(p.respawnAvailable, true);
  action(app, village, p, { kind: 'respawn' });
  assert.equal(p.hp, 100); assert.equal(p.inventory.wheat, 0); assert.equal(p.wallet, 7);
  assert.equal(p.tool, ''); assert.ok(Object.values(p.durability).every(value => value === 0), 'morning respawn grants no replacement equipment');
});

test('priests can complete revivals across dawn; non-priests cannot revive', async t => {
  const { app } = await fixture(t);
  const healer = await account(app, 'HealerDwarf'), fighter = await account(app, 'FighterDwarf');
  const { id } = app.simulation.create('Sanctuary', healer.user), v = app.simulation.villages.get(id);
  const priest = app.simulation.join(id, healer.user, 'priest'), guard = app.simulation.join(id, fighter.user, 'guard');
  priest.x = 0; priest.z = 0; guard.x = 1; guard.z = 0;
  app.simulation.hurtPlayer(v, guard, guard.hp + (guard.shield ?? 0));
  action(app, v, priest, { kind: 'heal', targetId: guard.id });
  app.simulation.dawn(v);
  for (let i = 0; i < 101; i++) app.simulation.tick(.05);
  assert.equal(guard.downed, false); assert.equal(guard.hp, 45); assert.equal(guard.respawnAvailable, false);
  assert.equal(priest.jobBonus, 5);
  assert.throws(() => action(app, v, guard, { kind: 'heal', targetId: priest.id }), /Only priests/);
});

test('zombies follow the road, damage gate before keep, and defeat only occurs on keep destruction', async t => {
  const { app } = await fixture(t);
  const { user } = await account(app, 'WatcherDwarf');
  const { id } = app.simulation.create('Last Hearth', user), v = app.simulation.villages.get(id), p = app.simulation.join(id, user);
  p.x = -10; p.z = -10; app.simulation.hurtPlayer(v, p, p.hp + (p.shield ?? 0));
  v.guards = []; app.simulation.startNight(v);
  assert.equal(v.status, 'active', 'all players downed does not end the run');
  for (let i = 0; i < 1300; i++) app.simulation.tick(.05);
  assert.ok(v.gate.hp < v.gate.maxHp, 'road-following horde reaches and attacks the gate');
  assert.equal(v.keep.hp, v.keep.maxHp, 'intact gate protects the keep');
  v.gate.hp = 0; v.keep.hp = 10;
  for (let i = 0; i < 1000 && v.status === 'active'; i++) app.simulation.tick(.05);
  assert.equal(v.status, 'fallen');
});

test('barracks guards leave the east door, pass through the gate, and hold outside', async t => {
  const { app } = await fixture(t);
  const { user } = await account(app, 'RoadwatchDwarf');
  const { id } = app.simulation.create('Roadwatch', user);
  app.simulation.join(id, user);
  const village = app.simulation.villages.get(id);
  const passedGate = new Set();
  for (const guard of village.guards) {
    assert.ok(Math.abs(guard.x - GUARD_ROAD[0].x) < .1, 'guards start at the east-facing door');
    assert.ok(Math.abs(guard.z - GUARD_ROAD[0].z) <= 1, 'guards have room beside the doorway');
  }
  for (let i = 0; i < 700; i++) {
    app.simulation.tick(.05);
    for (const guard of village.guards) {
      if (guard.z > 18 && Math.abs(guard.x) < 5) passedGate.add(guard.id);
      assert.ok(canStand(guard.x, guard.z), 'guards never walk into a building or wall');
    }
  }
  assert.equal(passedGate.size, 2, 'both guards follow the road through the only gate');
  for (const guard of village.guards) {
    assert.ok(Math.abs(guard.z - 35) < 1, 'guard reaches its outside defense position');
    assert.ok(Math.abs(Math.abs(guard.x) - 2) < 1, 'guards hold separate positions instead of overlapping');
  }
});
