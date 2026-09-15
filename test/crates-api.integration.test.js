import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { createApp } from '../server/index.js';

async function waitFor(check) {
  const end = performance.now() + 3000;
  while (performance.now() < end) { const result = check(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw new Error('Timed out waiting for crate API update.');
}

test('account API works before joining and HTTP/WebSocket replays share one private committed opening', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'emberwatch-crate-api-')), app = createApp({ dataDir: directory, autoTick: false });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const first = await app.store.authenticate('register', 'API Collector', 'a-crate-api-password'), second = await app.store.authenticate('register', 'API Observer', 'a-crate-api-password');
  const account = app.store.account(first.playerId); app.store.bank(first.playerId, 10000);
  const api = (path, session, body) => fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await api('/api/crates')).status, 401);
  const before = await (await api('/api/crates', first)).json(); assert.equal(before.crates.bank, 10000); assert.equal(before.crates.run, null);
  const requestId = randomUUID(), opening = { kind: 'crate_open', requestId, tier: 'basic', currency: 'bank', playerId: second.playerId, price: 0, itemId: 'phoenix_ember' };
  const concurrent = await Promise.all([api('/api/crates/action', first, opening), api('/api/crates/action', first, opening)]);
  for (const response of concurrent) assert.equal(response.status, 200);
  const [a, b] = await Promise.all(concurrent.map(response => response.json())); assert.deepEqual(a.result, b.result);
  assert.equal(a.crates.bank, 9000); assert.equal(a.result.chargeGranted, false); assert.equal(app.store.crateHistory(first.playerId).length, 1);
  assert.equal((await api('/api/crates/action', second, opening)).status, 400, 'body identity cannot spend another account savings');
  assert.equal((await api('/api/crates/action', first, { kind: 'phoenix_revive' })).status, 400, 'revival requires the authoritative joined simulation');

  const { id: villageId } = app.simulation.create('API Crate Watch', account);
  async function connect(session) {
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/socket'), messages = [];
    ws.on('message', bytes => messages.push(JSON.parse(bytes.toString())));
    await once(ws, 'open'); ws.send(JSON.stringify({ type: 'join', token: session.token, villageId, statePatches: true }));
    await waitFor(() => messages.find(message => message.type === 'state'));
    return { ws, messages };
  }
  const owner = await connect(first), observer = await connect(second);
  owner.ws.send(JSON.stringify({ type: 'action', ...opening }));
  await waitFor(() => owner.messages.find(message => message.type === 'notice' && /Crate opened/.test(message.message)));
  assert.equal(app.store.account(first.playerId).bank, 9000); assert.equal(app.store.crateHistory(first.playerId).length, 1);
  const mine = app.simulation.snapshot(app.simulation.villages.get(villageId), first.playerId), theirs = app.simulation.snapshot(app.simulation.villages.get(villageId), second.playerId);
  assert.deepEqual(mine.crates.history[0], a.result); assert.deepEqual(theirs.crates.history, []); assert.deepEqual(theirs.crates.unlocks, []); assert.equal(theirs.crates.bank, 0);
  assert.equal(theirs.players.find(player => player.id === first.playerId).crateHistory, undefined);
  assert.ok(!JSON.stringify(theirs).includes(a.result.id), 'other residents cannot inspect private opening IDs or results');
  const loadout = { kind: 'crate_loadout', loadout: { head: '', body: '', feet: '', utility: '', kit: '', tool: 'axe', reserveEmber: false } };
  const saved = await (await api('/api/crates/action', first, loadout)).json();
  assert.equal(saved.crates.loadout.tool, 'axe'); assert.equal(saved.crates.run.villageId, villageId);
  owner.ws.close(); observer.ws.close();
});
