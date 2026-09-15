import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameConnection } from '../public/src/connection.js';

function fixture() {
  let time = 0, timerId = 0;
  const timers = new Map(), sockets = [], statuses = [], messages = [];
  class Socket {
    constructor() { this.readyState = 0; this.bufferedAmount = 0; this.sent = []; sockets.push(this); }
    open() { this.readyState = 1; this.onopen?.(); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
    receive(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
    interrupt() { this.readyState = 3; this.onclose?.({ code: 1006 }); }
  }
  const connection = createGameConnection({ url: 'ws://test/socket', join: () => ({ token: 'session', villageId: 'village', statePatches: true }),
    WebSocketImpl: Socket, now: () => time, random: () => .5,
    schedule(fn, delay) { const id = ++timerId; timers.set(id, { at: time + delay, fn }); return id; }, cancel(id) { timers.delete(id); },
    onStatus: (status, detail) => statuses.push({ status, ...detail }), onMessage: message => messages.push(message) });
  function advance(ms) {
    const end = time + ms;
    for (;;) {
      const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]); time = next[1].at; next[1].fn();
    }
    time = end;
  }
  return { connection, sockets, statuses, messages, advance, timers };
}

test('reconnect fences late socket callbacks, resumes the same session, and never replays actions', () => {
  const { connection, sockets, messages, advance } = fixture();
  connection.connect(); const first = sockets[0]; first.open();
  assert.equal(connection.send({ type: 'action', kind: 'deposit', amount: 10 }), false, 'no gameplay before welcome');
  first.receive({ type: 'welcome', id: 'dwarf', resumeToken: 'resume-secret' });
  connection.send({ type: 'action', kind: 'deposit', amount: 10 });
  first.interrupt();
  assert.equal(connection.status, 'reconnecting');
  assert.equal(connection.send({ type: 'action', kind: 'deposit', amount: 10 }), false, 'disconnected transaction is discarded');
  advance(500); const second = sockets[1]; second.open();
  assert.equal(second.sent[0].resumeToken, 'resume-secret');
  assert.match(second.sent[0].clientId, /^[a-f0-9]{32}$/);
  assert.equal(second.sent[0].clientId, first.sent[0].clientId);
  assert.deepEqual(second.sent.map(message => message.type), ['join']);
  first.receive({ type: 'state', state: { wallet: 999 } }); first.onclose({ code: 1006 });
  second.receive({ type: 'welcome', id: 'dwarf', resumeToken: 'resume-secret' });
  second.receive({ type: 'state', patch: false, state: { wallet: 10 } });
  advance(500);
  assert.equal(sockets.length, 2, 'a stale close does not create a third socket');
  assert.deepEqual(messages.filter(message => message.type === 'state').map(message => message.state.wallet), [10]);
  assert.equal(first.sent.filter(message => message.type === 'action').length, 1);
  assert.equal(second.sent.filter(message => message.type === 'action').length, 0);
  assert.equal(connection.requestResync(), true);
  assert.equal(second.sent.at(-1).type, 'resync'); connection.close();
});

test('a silent half-open socket is replaced, while incoming heartbeats keep a session alive', () => {
  const { connection, sockets, advance } = fixture();
  connection.connect(); const first = sockets[0]; first.open(); first.receive({ type: 'welcome' });
  for (let i = 0; i < 5; i++) { advance(10000); first.receive({ type: 'pong' }); }
  assert.equal(sockets.length, 1); assert.equal(connection.status, 'connected');
  assert.equal(first.sent.filter(message => message.type === 'ping').length, 5);
  advance(40000); assert.equal(connection.status, 'reconnecting');
  advance(500); assert.equal(sockets.length, 2); connection.close();
});

test('join timeouts back off, fatal authentication errors stop retries, and an intentional close stays closed', () => {
  const { connection, sockets, advance, timers } = fixture();
  connection.connect(); sockets[0].open(); advance(20000); assert.equal(connection.status, 'reconnecting');
  advance(500); sockets[1].open(); sockets[1].receive({ type: 'error', code: 'SESSION_EXPIRED', fatal: true, message: 'Sign in again.' });
  assert.equal(connection.status, 'failed'); advance(60000); assert.equal(sockets.length, 2);
  connection.connect(); const last = sockets.at(-1); last.open(); last.receive({ type: 'welcome' });
  connection.close(); last.interrupt(); advance(60000);
  assert.equal(connection.status, 'closed'); assert.equal(sockets.length, 3); assert.equal(timers.size, 0);
});

test('a replaced window stops reconnecting and cannot steal the session back', () => {
  const { connection, sockets, advance } = fixture();
  connection.connect(); sockets[0].open(); sockets[0].receive({ type: 'welcome' });
  sockets[0].onclose({ code: 4001, reason: 'This connection was resumed in another window.' });
  assert.equal(connection.status, 'failed'); advance(60000); assert.equal(sockets.length, 1);
});
