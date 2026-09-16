import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { createApp } from '../server/index.js';
import { BUILDINGS } from '../shared/world.js';
import { buildingEntrance } from '../shared/access.js';

async function waitFor(predicate) {
  const deadline = performance.now() + 3000;
  while (performance.now() < deadline) {
    const result = predicate();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for the saved finance receipt.');
}

async function fixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'emberwatch-finance-recovery-'));
  const app = createApp({ dataDir, autoTick: false, heartbeatIntervalMs: 3600000, testAdminAccountIds: [] });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  const session = await app.store.authenticate('register', 'Finance Recovery', 'finance-recovery-test-password');
  const villageId = app.simulation.create('Receipt Recovery Watch', app.store.account(session.playerId)).id;
  const frames = [], ws = new WebSocket(`ws://127.0.0.1:${app.server.address().port}/socket`);
  ws.on('message', bytes => frames.push(JSON.parse(bytes.toString())));
  await once(ws, 'open');
  ws.send(JSON.stringify({ type: 'join', token: session.token, villageId, statePatches: false }));
  await waitFor(() => frames.find(frame => frame.type === 'state'));
  const village = app.simulation.villages.get(villageId), player = village.players[session.playerId];
  Object.assign(player, buildingEntrance(BUILDINGS.find(building => building.id === 'bank')), { wallet: 1000 });
  async function receipt(action) {
    const offset = frames.length;
    ws.send(JSON.stringify({ type: 'action', ...action }));
    return waitFor(() => frames.slice(offset).find(frame => frame.requestId === action.requestId && (frame.receipt || frame.type === 'error')));
  }
  return { app, village, player, receipt };
}

test('WebSocket recovery returns the exact durable finance receipt after it leaves recent snapshot history', async t => {
  const { app, village, player, receipt } = await fixture(t);
  const original = { kind: 'investment_deposit', amount: 1, requestId: randomUUID() };
  const first = await receipt(original);
  assert.equal(first.type, 'financeReceipt'); assert.equal(first.requestId, original.requestId);
  assert.equal(first.receipt.amount, 1);
  for (let i = 0; i < 21; i++) {
    const response = await receipt({ kind: 'investment_deposit', amount: 1, requestId: randomUUID() });
    assert.equal(response.type, 'financeReceipt');
  }
  const recent = app.simulation.snapshot(village, player.id).finance.receipts;
  assert.equal(recent.length, 20); assert.equal(recent.some(row => row.requestId === original.requestId), false);
  const before = { wallet: player.wallet, treasury: village.treasury, position: app.store.financePosition(village.id, player.id) };
  const recovered = await receipt({ ...original, amount: 999, targetId: 'another-account', playerId: 'another-account' });
  assert.equal(recovered.type, 'financeReceipt'); assert.deepEqual(recovered.receipt, first.receipt);
  assert.deepEqual({ wallet: player.wallet, treasury: village.treasury, position: app.store.financePosition(village.id, player.id) }, before);
});

test('committed finance receipts recover after physical state changes or a fallen village without another mutation', async t => {
  const { app, village, player, receipt } = await fixture(t);
  const original = { kind: 'investment_deposit', amount: 7, requestId: randomUUID() };
  const first = await receipt(original); assert.equal(first.type, 'financeReceipt');
  for (const change of [
    { downed: true, hp: 0, bedPlotId: null, mountedHorseId: null },
    { downed: false, hp: 100, bedPlotId: 'occupied-bed', mountedHorseId: null },
    { downed: false, hp: 100, bedPlotId: null, mountedHorseId: 'ridden-horse' },
    { downed: false, hp: 100, bedPlotId: null, mountedHorseId: null, x: 999, z: 999 },
    { downed: true, hp: 0, bedPlotId: null, mountedHorseId: null, fallen: true }
  ]) {
    const { fallen, ...state } = change; Object.assign(player, state);
    if (fallen) { village.status = 'fallen'; village.keep.hp = 0; }
    const before = structuredClone(village), position = app.store.financePosition(village.id, player.id);
    const recovered = await receipt(original);
    assert.equal(recovered.type, 'financeReceipt'); assert.deepEqual(recovered.receipt, first.receipt);
    assert.deepEqual(village, before, 'recovery returns the receipt without executing an action or changing physical state');
    assert.deepEqual(app.store.financePosition(village.id, player.id), position);
    const newAction = await receipt({ ...original, requestId: randomUUID() });
    assert.equal(newAction.type, 'error', 'state restrictions still apply to a genuinely new transaction');
    assert.deepEqual(app.store.financePosition(village.id, player.id), position);
    assert.equal(player.wallet, before.players[player.id].wallet); assert.equal(village.treasury, before.treasury);
  }
});
