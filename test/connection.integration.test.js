import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createApp } from '../server/index.js';

async function waitFor(fn) {
  const until = performance.now() + 3000;
  while (performance.now() < until) { const value = fn(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw new Error('Timed out waiting for connection state.');
}

async function fixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'emberwatch-network-'));
  let networkTime = 0;
  const app = createApp({ dataDir, autoTick: false, networkClock: () => networkTime, heartbeatIntervalMs: 3600000 });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const session = await app.store.authenticate('register', 'Network Watch', 'a-network-test-password');
  const account = app.store.accountFromToken(session.token), { id } = app.simulation.create('Steady Watch', account);
  const village = app.simulation.villages.get(id);
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  async function connect(extra = {}, wsOptions = {}) {
    const ws = new WebSocket(`ws://127.0.0.1:${app.server.address().port}/socket`, wsOptions), frames = [];
    ws.on('message', bytes => frames.push(JSON.parse(bytes.toString())));
    await once(ws, 'open'); ws.send(JSON.stringify({ type: 'join', token: session.token, villageId: id, statePatches: true, ...extra }));
    await waitFor(() => frames.some(frame => frame.type === 'state' || frame.type === 'error'));
    return { ws, frames, send: message => ws.send(JSON.stringify(message)), welcome: frames.find(frame => frame.type === 'welcome') };
  }
  return { app, session, village, connect, setTime: time => { networkTime = time; } };
}

test('same-session recovery replaces stale sockets without duplicate residents, loss of progress, or old-socket mutations', async t => {
  const { app, session, village, connect } = await fixture(t);
  const first = await connect(), player = village.players[session.playerId];
  const oldServerSocket = [...app.wss.clients][0];
  player.inventory.iron = 17; player.wallet = 42;
  const duplicate = await connect();
  assert.equal(duplicate.frames[0].code, 'ALREADY_CONNECTED'); assert.equal(duplicate.frames[0].fatal, true);
  duplicate.ws.close();
  const previousClosed = once(first.ws, 'close');
  const resumed = await connect({ resumeToken: first.welcome.resumeToken });
  const [closeCode] = await previousClosed; assert.equal(closeCode, 4001);
  assert.equal(resumed.welcome.id, first.welcome.id);
  assert.equal(Object.keys(village.players).length, 1); assert.equal(player.online, true);
  assert.deepEqual([player.inventory.iron, player.wallet], [17, 42]);
  const full = resumed.frames.find(frame => frame.type === 'state');
  assert.equal(full.patch, false); assert.ok(full.state.resources.length > 100);
  assert.equal(full.state.players[0].inventory.iron, 17);
  oldServerSocket.emit('message', Buffer.from(JSON.stringify({ type: 'input', x: 1, z: 0, yaw: 0 })));
  assert.equal(app.simulation.inputs.has(player.id), false, 'delayed predecessor messages are fenced');
  resumed.send({ type: 'input', x: 0, z: 1, yaw: 0 });
  await waitFor(() => app.simulation.inputs.get(player.id)?.z === 1);
  assert.equal(player.online, true, 'predecessor close cannot disconnect its replacement');
});

test('heartbeat tolerates a delayed pong, reclaims silent sockets, and provides explicit full-state resync', async t => {
  const { app, village, connect, setTime } = await fixture(t);
  const live = await connect({}, { autoPong: false });
  live.send({ type: 'ping', nonce: 123 });
  await waitFor(() => live.frames.some(frame => frame.type === 'pong' && frame.nonce === 123));
  setTime(20000); app.heartbeatCheck();
  assert.equal([...app.wss.clients][0].readyState, WebSocket.OPEN, 'one missed ping is not a disconnect');
  const count = live.frames.length; app.broadcast();
  await waitFor(() => live.frames.slice(count).some(frame => frame.patch === true));
  live.send({ type: 'resync' });
  await waitFor(() => live.frames.slice(count).some(frame => frame.type === 'state' && frame.patch === false));
  const fresh = live.frames.at(-1);
  assert.ok(fresh.state.plots.length > 0); assert.equal(fresh.state.id, village.id);
  // resync refreshes liveness at network time 20 seconds.
  setTime(64000); app.heartbeatCheck(); assert.equal([...app.wss.clients][0].readyState, WebSocket.OPEN);
  const closed = once(live.ws, 'close'); setTime(65000); app.heartbeatCheck(); await closed;
  await waitFor(() => !Object.values(village.players)[0].online);
  const recovered = await connect({ resumeToken: live.welcome.resumeToken });
  assert.equal(recovered.frames.find(frame => frame.type === 'state').patch, false);
});

test('a resumed input burst sheds excess messages without kicking the player or replaying actions', async t => {
  const { app, session, village, connect } = await fixture(t);
  const client = await connect();
  for (let i = 0; i < 150; i++) client.send({ type: 'input', x: 0, z: 0, yaw: 0 });
  await waitFor(() => client.frames.some(frame => frame.code === 'RATE_LIMIT'));
  assert.equal(client.ws.readyState, WebSocket.OPEN);
  assert.equal(village.players[session.playerId].online, true);
  assert.equal(app.simulation.inputs.get(session.playerId).x, 0);
});

test('recovery can replace a socket even when its first welcome was lost', async t => {
  const { village, connect } = await fixture(t);
  const clientId = 'c9a77ee07702f37ce507e4ca31887df8';
  const first = await connect({ clientId });
  // A reconnect knows its own pre-join nonce even if it never received the
  // server resume token. Do not pass first.welcome.resumeToken here.
  const closed = once(first.ws, 'close');
  const retry = await connect({ clientId }); await closed;
  assert.equal(retry.welcome.id, first.welcome.id);
  assert.equal(Object.keys(village.players).length, 1);
  assert.equal(village.players[retry.welcome.id].online, true);
});
