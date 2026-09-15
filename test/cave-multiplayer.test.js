import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createApp } from '../server/index.js';
import { RESOURCES, BUILDINGS, caveResourceType, groundHeight } from '../shared/world.js';
import { buildingEntrance } from '../shared/access.js';
import { taxedSaleQuote } from '../shared/economy.js';

async function waitFor(check, timeout = 3000) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    const result = check(); if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for cave multiplayer state.');
}
async function connect(base, session, villageId, patches) {
  const ws = new WebSocket(base + '/socket'), stream = { ws, state: null, frames: [], errors: [] };
  ws.on('message', bytes => {
    const message = JSON.parse(bytes.toString());
    if (message.type === 'error') stream.errors.push(message.message);
    if (message.type !== 'state') return;
    stream.frames.push(message);
    stream.state = message.patch ? { ...stream.state, ...message.state } : message.state;
  });
  await once(ws, 'open');
  ws.send(JSON.stringify({ type: 'join', token: session.token, villageId, role: 'villager', statePatches: patches }));
  await waitFor(() => stream.state); return stream;
}
async function broadcast(app, ...streams) {
  const counts = streams.map(s => s.frames.length); app.broadcast();
  await Promise.all(streams.map((s, i) => waitFor(() => s.frames.length > counts[i])));
}
async function disconnect(stream, village, id) {
  stream.ws.close(); await once(stream.ws, 'close'); await waitFor(() => !village.players[id].online);
}
const mineralState = (stream, id) => stream.state.resources.find(n => n.id === id);

test('two authenticated cave miners share depletion and weighted regrowth across patch/full clients, reconnects and a SQLite server restart', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'emberwatch-cave-wire-'));
  let app = null; const streams = [];
  t.after(async () => {
    for (const stream of streams) stream.ws.terminate();
    if (app) await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  async function start() {
    app = createApp({ dataDir, autoTick: false }); app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
    return `ws://127.0.0.1:${app.server.address().port}`;
  }
  let base = await start();
  const alice = await app.store.authenticate('register', 'Cave Alice', 'cave-wire-test-password');
  const bob = await app.store.authenticate('register', 'Cave Bobby', 'cave-wire-test-password');
  const { id } = app.simulation.create('Shared Depths', app.store.accountFromToken(alice.token));
  let a = await connect(base, alice, id, true), b = await connect(base, bob, id, false); streams.push(a, b);
  let village = app.simulation.villages.get(id), p = village.players[alice.playerId], q = village.players[bob.playerId];
  village.guards = [];
  const meta = RESOURCES.find(node => node.caveTier === 'deep');
  let node = village.resources.find(n => n.id === meta.id);
  const initialType = node.type, seed = village.caveSeed;
  for (const player of [p, q]) {
    Object.assign(player, { x: meta.x, z: meta.z + 1.6, tool: 'pickaxe' });
    player.durability.pickaxe = 100;
  }
  await broadcast(app, a, b);
  assert.equal(a.frames[0].patch, false); assert.equal(b.frames[0].patch, undefined);
  assert.deepEqual(a.state.resources, b.state.resources);
  assert.equal(mineralState(a, meta.id).type, initialType);
  assert.equal(mineralState(a, meta.id).depth, -groundHeight(meta.x, meta.z));
  assert.equal(a.state.caveSeed, undefined, 'the private seed is not part of the public protocol');
  for (let i = 0; i < 8; i++) {
    const stream = i % 2 ? b : a; village.clock += .7;
    stream.ws.send(JSON.stringify({ type: 'action', kind: 'gather', targetId: meta.id, resource: 'gold', mineralType: 'gold', roll: 999999, amount: 999 }));
    await waitFor(() => { if (stream.errors.length) throw new Error(stream.errors.join('; ')); return node.remaining === 7 - i; });
  }
  assert.equal(node.available, false); assert.equal(node.roll, 0); assert.equal(node.type, initialType);
  assert.equal(p.inventory[initialType], 4); assert.equal(q.inventory[initialType], 4);
  assert.equal(p.inventory.gold, undefined); assert.equal(q.inventory.gold, undefined);
  assert.equal(p.durability.pickaxe, 96); assert.equal(q.durability.pickaxe, 96);
  await broadcast(app, a, b);
  assert.deepEqual(mineralState(a, meta.id), mineralState(b, meta.id));
  assert.equal(mineralState(a, meta.id).available, false);
  assert.equal(a.state.players.find(row => row.id === q.id).inventory, undefined, 'shared ore never exposes another miner’s pack');
  const depleted = structuredClone(node), clock = village.clock;
  a.ws.send(JSON.stringify({ type: 'action', kind: 'gather', targetId: meta.id, roll: 123 }));
  await waitFor(() => a.errors.some(message => /regrowing/.test(message)));
  assert.deepEqual(node, depleted, 'forged repeat gathers cannot reset a depleted slot or reroll its type');
  await disconnect(a, village, p.id);
  a = await connect(base, alice, id, true); streams.push(a);
  assert.equal(a.frames[0].patch, false); assert.deepEqual(mineralState(a, meta.id), mineralState(b, meta.id));
  assert.deepEqual(node, depleted); assert.equal(village.caveSeed, seed);
  await disconnect(a, village, p.id); await disconnect(b, village, q.id);
  app.simulation.tick(500); assert.equal(village.clock, clock); assert.deepEqual(node, depleted);
  const oldApp = app; app = null; await oldApp.close();
  base = await start(); village = app.simulation.villages.get(id); node = village.resources.find(n => n.id === meta.id);
  assert.equal(village.caveSeed, seed); assert.deepEqual(node, depleted);
  a = await connect(base, alice, id, true); b = await connect(base, bob, id, false); streams.push(a, b);
  assert.deepEqual(a.state.resources, b.state.resources); assert.equal(mineralState(a, meta.id).available, false);
  p = village.players[alice.playerId]; q = village.players[bob.playerId];
  assert.equal(p.inventory[initialType], 4); assert.equal(q.inventory[initialType], 4);
  const remaining = node.regrowAt - village.clock;
  app.simulation.tick(remaining - .05); assert.equal(node.available, false); assert.equal(node.roll, 0);
  app.simulation.tick(.1); assert.equal(node.available, true); assert.equal(node.remaining, 8); assert.equal(node.roll, 1);
  const nextType = caveResourceType(meta.caveTier, `${seed}:${meta.id}`, 1);
  assert.equal(node.type, nextType); await broadcast(app, a, b);
  assert.deepEqual(mineralState(a, meta.id), mineralState(b, meta.id)); assert.equal(mineralState(a, meta.id).type, nextType);
  assert.equal(mineralState(a, meta.id).roll, 1);
  app.simulation.tick(1); assert.equal(node.roll, 1, 'an available slot never rerolls on ordinary ticks');
  // Real trade uses the type that was harvested, even if that slot has since
  // regenerated as another mineral. The resource identity is not a currency.
  Object.assign(p, buildingEntrance(BUILDINGS.find(building => building.id === 'bank')));
  const stock = { ...village.stock }, wallet = p.wallet, quote = taxedSaleQuote(initialType, stock[initialType], 1, village.policies.tradeTax);
  a.ws.send(JSON.stringify({ type: 'action', kind: 'sell', resource: initialType, amount: 1, minTotal: quote.total }));
  await waitFor(() => p.inventory[initialType] === 3);
  assert.equal(p.wallet, wallet + quote.total); assert.equal(village.stock[initialType], stock[initialType] + 1);
  for (const resource of ['stone', 'iron', 'coal'].filter(type => type !== initialType)) assert.equal(village.stock[resource], stock[resource]);
  assert.deepEqual(b.errors, []); assert.deepEqual(a.errors, []);
  await disconnect(a, village, p.id); await disconnect(b, village, q.id);
  const finalApp = app; app = null; await finalApp.close(); base = await start();
  const final = app.simulation.villages.get(id).resources.find(n => n.id === meta.id);
  assert.equal(final.type, nextType); assert.equal(final.roll, 1); assert.equal(final.available, true);
});
