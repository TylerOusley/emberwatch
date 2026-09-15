import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { Store } from '../server/store.js';
import { createApp } from '../server/index.js';

const TEST_GOLD = 10_000_000;
const PASSWORD = 'admin-integration-test-password';

async function waitFor(predicate) {
  const deadline = performance.now() + 3000;
  while (performance.now() < deadline) {
    const result = predicate();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for an admin integration response.');
}

async function fixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'emberwatch-admin-'));
  const bootstrap = new Store(dataDir, { testAdminAccountIds: [] });
  let admin, regular, expired;
  try {
    admin = await bootstrap.authenticate('register', 'Test Administrator', PASSWORD);
    regular = await bootstrap.authenticate('register', 'Ordinary Resident', PASSWORD);
    expired = await bootstrap.authenticate('login', admin.name, PASSWORD);
    bootstrap.db.prepare('UPDATE sessions SET expires=? WHERE token_hash=?').run(Date.now() - 1, createHash('sha256').update(expired.token).digest('hex'));
    bootstrap.bank(admin.playerId, 321); bootstrap.bank(regular.playerId, 789);
    bootstrap.issueCredit(admin.playerId, 41); bootstrap.issueCredit(regular.playerId, 13);
  } finally { bootstrap.close(); }

  let app;
  async function start() {
    app = createApp({ dataDir, autoTick: false, heartbeatIntervalMs: 3600000, testAdminAccountIds: [admin.playerId] });
    app.server.listen(0, '127.0.0.1');
    await once(app.server, 'listening');
  }
  await start();
  const villageId = app.simulation.create('Admin Integration Watch', app.store.account(admin.playerId)).id;
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });

  async function connect(session = admin, extra = {}) {
    const frames = [], ws = new WebSocket(`ws://127.0.0.1:${app.server.address().port}/socket`);
    ws.on('message', bytes => frames.push(JSON.parse(bytes.toString())));
    await once(ws, 'open');
    ws.send(JSON.stringify({ type: 'join', token: session?.token, villageId, statePatches: false, ...extra }));
    await waitFor(() => frames.find(frame => frame.type === 'state' || frame.type === 'error'));
    return { ws, frames, send: message => ws.send(JSON.stringify(message)) };
  }
  async function action(client, payload) {
    const offset = client.frames.length;
    client.send({ type: 'action', ...payload });
    return waitFor(() => client.frames.slice(offset).find(frame => frame.type === 'notice' || frame.type === 'error'));
  }
  async function state(client) {
    const offset = client.frames.length;
    client.send({ type: 'resync' });
    return (await waitFor(() => client.frames.slice(offset).find(frame => frame.type === 'state'))).state;
  }
  async function disconnect(client, playerId) {
    const closed = once(client.ws, 'close'); client.ws.close(); await closed;
    await waitFor(() => !app.simulation.villages.get(villageId).players[playerId]?.online);
  }
  async function restart() { await app.close(); await start(); }
  return { get app() { return app; }, get village() { return app.simulation.villages.get(villageId); }, admin, regular, expired, villageId, connect, action, state, disconnect, restart };
}

test('admin funds require authenticated account identity and the private privilege flag is visible only to its owner', async t => {
  const f = await fixture(t), { admin, regular } = f;
  assert.equal(f.app.store.account(admin.playerId).bank, TEST_GOLD, 'startup grants the configured existing account');
  assert.equal(f.app.store.account(regular.playerId).bank, 789);
  assert.equal(f.app.simulation.devTools, false);
  const config = await fetch(`http://127.0.0.1:${f.app.server.address().port}/api/config`).then(response => response.json());
  assert.equal(config.devTools, false);

  for (const session of [null, f.expired]) {
    const rejected = await f.connect(session, { playerId: admin.playerId, admin: true, testAdmin: true });
    const failure = rejected.frames.find(frame => frame.type === 'error');
    assert.equal(failure.fatal, true); assert.equal(failure.code, 'SESSION_EXPIRED');
    assert.equal(rejected.frames.some(frame => frame.type === 'welcome'), false);
    rejected.ws.close();
  }
  assert.equal(Object.keys(f.village.players).length, 0, 'failed credentials never join a resident');

  const adminClient = await f.connect(admin), regularClient = await f.connect(regular);
  assert.equal(f.village.players[admin.playerId].wallet, TEST_GOLD);
  assert.equal(f.village.players[regular.playerId].wallet, 10);
  for (const [client, ownId, expected] of [[adminClient, admin.playerId, true], [regularClient, regular.playerId, false]]) {
    const snapshot = await f.state(client);
    assert.equal(snapshot.players.find(player => player.id === ownId).testAdmin, expected);
    for (const player of snapshot.players.filter(player => player.id !== ownId)) {
      assert.equal(Object.hasOwn(player, 'testAdmin'), false);
      assert.equal(Object.hasOwn(player, 'bank'), false);
      assert.equal(Object.hasOwn(player, 'wallet'), false);
    }
  }
  const balances = [admin, regular].map(session => ({ account: f.app.store.account(session.playerId), wallet: f.village.players[session.playerId].wallet }));
  for (const target of [admin.playerId, regular.playerId]) {
    const rejected = await f.action(regularClient, { kind: 'admin_refill_gold', targetId: target, playerId: admin.playerId, accountId: admin.playerId, admin: true, testAdmin: true, amount: Number.MAX_SAFE_INTEGER });
    assert.equal(rejected.type, 'error');
  }
  assert.deepEqual([admin, regular].map(session => ({ account: f.app.store.account(session.playerId), wallet: f.village.players[session.playerId].wallet })), balances);
  const nightAttempt = await f.action(adminClient, { kind: 'startNight', admin: true });
  assert.equal(nightAttempt.type, 'error'); assert.match(nightAttempt.message, /Testing controls are disabled/);
  assert.equal(f.village.phase, 'day');
});

test('admin refill is self-only, capped and repeatable without changing healing or bypassing unrelated state', async t => {
  const f = await fixture(t), client = await f.connect(), other = await f.connect(f.regular);
  const player = f.village.players[f.admin.playerId], regular = f.village.players[f.regular.playerId];
  const otherBefore = { account: f.app.store.account(regular.id), player: structuredClone(regular) };
  const economyBefore = { treasury: f.village.treasury, stock: structuredClone(f.village.stock), credit: f.app.store.account(player.id).credit, debt: f.app.store.account(player.id).debt };
  for (const state of [
    { downed: false, hp: 100, bedPlotId: null, mountedHorseId: null },
    { downed: true, hp: 0, bedPlotId: null, mountedHorseId: null },
    { downed: true, hp: 0, bedPlotId: 'occupied-test-bed', mountedHorseId: null },
    { downed: false, hp: 100, bedPlotId: null, mountedHorseId: 'mounted-test-horse' }
  ]) {
    Object.assign(player, state, { wallet: 37, lastAction: f.village.clock, healing: { targetId: regular.id, until: f.village.clock + 5 } });
    f.app.store.bank(player.id, 123 - f.app.store.account(player.id).bank);
    const before = structuredClone(player);
    const response = await f.action(client, { kind: 'admin_refill_gold', targetId: regular.id, playerId: regular.id, admin: false, amount: Number.MAX_SAFE_INTEGER });
    assert.equal(response.type, 'notice', response.message);
    assert.equal(f.app.store.account(player.id).bank, TEST_GOLD);
    assert.deepEqual(player, { ...before, wallet: TEST_GOLD }, 'only the current wallet changes; healing, cooldown and physical state remain');
    assert.equal((await f.action(client, { kind: 'admin_refill_gold' })).type, 'notice');
    assert.equal(player.wallet, TEST_GOLD); assert.equal(f.app.store.account(player.id).bank, TEST_GOLD);
  }
  f.app.store.bank(player.id, 51); player.wallet = TEST_GOLD + 83;
  assert.equal((await f.action(client, { kind: 'admin_refill_gold', amount: 1 })).type, 'notice');
  assert.equal(f.app.store.account(player.id).bank, TEST_GOLD + 51); assert.equal(player.wallet, TEST_GOLD + 83, 'refill never reduces an above-target balance');
  assert.deepEqual({ account: f.app.store.account(regular.id), player: regular }, otherBefore);
  assert.deepEqual({ treasury: f.village.treasury, stock: f.village.stock, credit: f.app.store.account(player.id).credit, debt: f.app.store.account(player.id).debt }, economyBefore);
  assert.equal(other.ws.readyState, WebSocket.OPEN);
});

test('admin crate purchases spend savings normally and reconnecting or restarting never refills spent funds', async t => {
  const f = await fixture(t), id = f.admin.playerId;
  let client = await f.connect();
  const purchase = await f.action(client, { kind: 'crate_open', requestId: randomUUID(), tier: 'basic', currency: 'bank' });
  assert.equal(purchase.type, 'notice', purchase.message);
  assert.equal(f.app.store.account(id).bank, TEST_GOLD - 1000, 'first crate still charges its ordinary bank price');
  assert.equal(f.app.store.crateHistory(id).length, 1);
  f.village.players[id].wallet -= 17;
  await f.disconnect(client, id); client = await f.connect();
  assert.equal(f.app.store.account(id).bank, TEST_GOLD - 1000); assert.equal(f.village.players[id].wallet, TEST_GOLD - 17);
  await f.restart(); client = await f.connect();
  assert.equal(f.app.store.account(id).bank, TEST_GOLD - 1000, 'one-time startup bank grant has a durable ledger');
  assert.equal(f.village.players[id].wallet, TEST_GOLD - 17, 'returning residents receive no new starting wallet');
  assert.equal(f.app.store.crateHistory(id).length, 1); assert.equal(f.app.simulation.devTools, false);
  assert.equal((await f.state(client)).players.find(player => player.id === id).testAdmin, true);
});

test('failed admin refill persistence rolls back both savings and the live wallet before a safe retry', async t => {
  const f = await fixture(t), client = await f.connect(), player = f.village.players[f.admin.playerId];
  f.app.store.bank(player.id, 123 - f.app.store.account(player.id).bank); player.wallet = 456;
  const beforeAccount = f.app.store.account(player.id), beforePlayer = structuredClone(player), save = f.app.store.saveVillage;
  f.app.store.saveVillage = () => { throw new Error('Injected admin refill save failure.'); };
  try {
    const failure = await f.action(client, { kind: 'admin_refill_gold' });
    assert.equal(failure.type, 'error'); assert.match(failure.message, /Injected admin refill save failure/);
  } finally { f.app.store.saveVillage = save; }
  assert.deepEqual(f.app.store.account(player.id), beforeAccount); assert.deepEqual(player, beforePlayer);
  assert.equal((await f.action(client, { kind: 'admin_refill_gold' })).type, 'notice');
  assert.equal(f.app.store.account(player.id).bank, TEST_GOLD); assert.equal(player.wallet, TEST_GOLD);
});
