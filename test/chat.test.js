import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createApp } from '../server/index.js';

async function fixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'emberwatch-chat-'));
  let now = 1700000000000;
  const app = createApp({ dataDir, autoTick: false, chatClock: () => now });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const socketUrl = `ws://127.0.0.1:${app.server.address().port}/socket`;
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  return { app, socketUrl, advance: (ms = 1000) => { now += ms; } };
}

async function account(app, name) {
  const session = await app.store.authenticate('register', name, 'good-chat-test-password');
  return { ...session, user: app.store.accountFromToken(session.token) };
}

async function connect(socketUrl, session, villageId) {
  const ws = new WebSocket(socketUrl), queue = [];
  ws.on('message', data => queue.push(JSON.parse(data.toString())));
  await once(ws, 'open');
  const connection = { ws, queue, send: value => ws.send(JSON.stringify(value)) };
  if (session) {
    connection.send({ type: 'join', token: session.token, villageId });
    await waitFor(() => queue.find(message => message.type === 'chatHistory'));
  }
  return connection;
}

async function waitFor(fn, timeout = 2500) {
  const end = performance.now() + timeout;
  while (performance.now() < end) {
    const result = fn();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for chat message.');
}

async function flush(connection) {
  const received = once(connection.ws, 'pong');
  connection.ws.ping('chat-test-barrier');
  await received;
}

async function expectError(connection, message, match) {
  const previous = connection.queue.length;
  connection.send(message);
  const error = await waitFor(() => connection.queue.slice(previous).find(entry => entry.type === 'error'));
  assert.match(error.message, match);
}

test('chat and typing require authenticated village membership', async t => {
  const { app, socketUrl } = await fixture(t);
  const founder = await account(app, 'ChatFounder');
  const village = app.simulation.create('Chat Hearth', founder.user);
  const stranger = await connect(socketUrl);
  await expectError(stranger, { type: 'chat', text: 'Anyone here?', villageId: village.id }, /Join a village first/);
  await expectError(stranger, { type: 'typing', typing: true }, /Join a village first/);
  await expectError(stranger, { type: 'join', token: 'not-a-session', villageId: village.id }, /session expired/);
  assert.equal(stranger.queue.some(message => message.type === 'chat' || message.type === 'chatHistory'), false);
});

test('chat uses authenticated identity and reaches only the sender and their village', async t => {
  const { app, socketUrl } = await fixture(t);
  const alice = await account(app, 'ChatAlice'), bob = await account(app, 'ChatBobby'), carol = await account(app, 'ChatCarol');
  const village = app.simulation.create('First Hearth', alice.user), other = app.simulation.create('Other Hearth', carol.user);
  const a = await connect(socketUrl, alice, village.id), b = await connect(socketUrl, bob, village.id), c = await connect(socketUrl, carol, other.id);
  a.send({ type: 'chat', text: '  Gate\n\t needs\u0000 guards!  ', playerId: carol.playerId, name: 'Fake Steward', villageId: other.id, at: 0, id: 'fake-id' });
  const received = await waitFor(() => b.queue.find(message => message.type === 'chat'));
  assert.deepEqual(received, {
    type: 'chat', id: received.id, playerId: alice.playerId, name: alice.name,
    text: 'Gate needs guards!', at: 1700000000000,
  });
  assert.match(received.id, /^[0-9a-f-]{36}$/);
  const echo = await waitFor(() => a.queue.find(message => message.type === 'chat'));
  assert.deepEqual(echo, received);
  await flush(c);
  assert.equal(c.queue.some(message => message.type === 'chat'), false, 'another village must never receive chat');
  assert.equal(received.wallet, undefined);
});

test('chat validates text and limits each player across reconnects without blocking other players', async t => {
  const { app, socketUrl, advance } = await fixture(t);
  const alice = await account(app, 'RateAlice'), bob = await account(app, 'RateBobby');
  const village = app.simulation.create('Quiet Hearth', alice.user);
  const a = await connect(socketUrl, alice, village.id), b = await connect(socketUrl, bob, village.id);
  for (const text of [null, 12, true, {}, []]) await expectError(a, { type: 'chat', text }, /must be text/);
  for (const text of ['', ' \n\t\u0000 ', 'a'.repeat(241), '🪓'.repeat(121)]) await expectError(a, { type: 'chat', text }, /1–240 characters/);
  const text = '🪓'.repeat(120);
  a.send({ type: 'chat', text });
  await waitFor(() => a.queue.find(message => message.type === 'chat'));
  await expectError(a, { type: 'chat', text: 'Too soon' }, /Wait a moment/);
  b.send({ type: 'chat', text: 'My own message can still send.' });
  await waitFor(() => b.queue.find(message => message.type === 'chat' && message.playerId === bob.playerId));
  a.ws.close();
  await once(a.ws, 'close');
  await waitFor(() => !app.simulation.villages.get(village.id).players[alice.playerId].online);
  const reconnected = await connect(socketUrl, alice, village.id);
  await expectError(reconnected, { type: 'chat', text: 'Reconnect must not reset cooldown' }, /Wait a moment/);
  advance();
  reconnected.send({ type: 'chat', text: '<b>Plain text, not HTML</b>' });
  const accepted = await waitFor(() => reconnected.queue.find(message => message.type === 'chat'));
  assert.equal(accepted.text, '<b>Plain text, not HTML</b>', 'the server transports plain text; UI must render it as text');
  assert.equal(reconnected.queue.find(message => message.type === 'chatHistory').messages.length, 2, 'invalid/rate-limited submissions do not enter history');
});

test('new arrivals get only the last thirty messages for their village, outside persisted state', async t => {
  const { app, socketUrl, advance } = await fixture(t);
  const alice = await account(app, 'HistoryAlice'), bob = await account(app, 'HistoryBobby'), carol = await account(app, 'HistoryCarol');
  const village = app.simulation.create('History Hearth', alice.user), other = app.simulation.create('Empty Hearth', carol.user);
  const a = await connect(socketUrl, alice, village.id);
  assert.deepEqual(a.queue.find(message => message.type === 'chatHistory').messages, []);
  for (let index = 0; index < 32; index++) {
    advance();
    const text = `history-line-${index}`;
    a.send({ type: 'chat', text });
    await waitFor(() => a.queue.find(message => message.type === 'chat' && message.text === text));
  }
  const b = await connect(socketUrl, bob, village.id), c = await connect(socketUrl, carol, other.id);
  const history = b.queue.find(message => message.type === 'chatHistory').messages;
  assert.equal(history.length, 30);
  assert.equal(history[0].text, 'history-line-2');
  assert.equal(history[29].text, 'history-line-31');
  assert.equal(new Set(history.map(message => message.id)).size, 30);
  assert.deepEqual(c.queue.find(message => message.type === 'chatHistory').messages, []);
  app.simulation.saveAll();
  assert.equal(JSON.stringify(app.store.loadVillages()).includes('history-line-'), false, 'chat history is never written to village saves');
});

test('typing is village-scoped, never reveals drafts, throttles true, and clears immediately', async t => {
  const { app, socketUrl, advance } = await fixture(t);
  const alice = await account(app, 'TypingAlice'), bob = await account(app, 'TypingBobby'), carol = await account(app, 'TypingCarol');
  const village = app.simulation.create('Typing Hearth', alice.user), other = app.simulation.create('Silent Hearth', carol.user);
  const a = await connect(socketUrl, alice, village.id), b = await connect(socketUrl, bob, village.id), c = await connect(socketUrl, carol, other.id);
  await expectError(a, { type: 'typing', typing: 'true' }, /Invalid typing status/);
  a.send({ type: 'typing', typing: true, name: 'King', playerId: carol.playerId, villageId: other.id, text: 'private unsent draft' });
  const first = await waitFor(() => b.queue.find(message => message.type === 'typing'));
  assert.deepEqual(first, { type: 'typing', playerId: alice.playerId, name: alice.name, typing: true });
  a.send({ type: 'typing', typing: true });
  await flush(a); await flush(b); await flush(c);
  assert.equal(b.queue.filter(message => message.type === 'typing').length, 1, 'repeated true updates are throttled');
  assert.equal(a.queue.some(message => message.type === 'typing'), false, 'typing indicators go to peers only');
  assert.equal(c.queue.some(message => message.type === 'typing'), false);
  a.send({ type: 'typing', typing: false });
  await waitFor(() => b.queue.find(message => message.type === 'typing' && !message.typing));
  advance();
  a.send({ type: 'typing', typing: true });
  await waitFor(() => b.queue.filter(message => message.type === 'typing' && message.typing).length === 2);
  a.send({ type: 'chat', text: 'Ready to defend.' });
  await waitFor(() => b.queue.find(message => message.type === 'chat'));
  assert.equal(b.queue.filter(message => message.type === 'typing' && !message.typing).length, 2, 'submitting a message clears typing');
  advance();
  a.send({ type: 'typing', typing: true });
  await waitFor(() => b.queue.filter(message => message.type === 'typing' && message.typing).length === 3);
  a.ws.close();
  await waitFor(() => b.queue.filter(message => message.type === 'typing' && !message.typing).length === 3);
  assert.equal(b.queue.filter(message => message.type === 'typing').some(message => 'text' in message), false);
});
