import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createApp } from '../server/index.js';
import { RESOURCES } from '../shared/world.js';

async function waitFor(fn, timeout = 2500) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) { const value = fn(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw new Error('Timed out waiting for state patch.');
}
const wire = value => JSON.parse(JSON.stringify(value));
async function connect(base, session, villageId, patches) {
  const ws = new WebSocket(base + '/socket'), stream = { ws, frames: [], errors: [], merged: null };
  ws.on('message', bytes => {
    const message = JSON.parse(bytes.toString());
    if (message.type === 'error') stream.errors.push(message.message);
    if (message.type !== 'state') return;
    stream.frames.push({ ...message, bytes: bytes.length });
    stream.merged = message.patch ? { ...stream.merged, ...message.state } : message.state;
  });
  await once(ws, 'open');
  ws.send(JSON.stringify({ type: 'join', token: session.token, villageId, role: 'villager', ...(patches ? { statePatches: true } : {}) }));
  await waitFor(() => stream.frames.length);
  return stream;
}
async function broadcast(app, ...streams) {
  const next = streams.map(stream => stream.frames.length);
  app.broadcast();
  return Promise.all(streams.map((stream, index) => waitFor(() => stream.frames[next[index]])));
}

test('opt-in state patches coexist with legacy snapshots, preserve private state and reset on reconnect', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'emberwatch-patches-'));
  const app = createApp({ dataDir, autoTick: false }), streams = [];
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(async () => { for (const stream of streams) stream.ws.terminate(); await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  const base = `ws://127.0.0.1:${app.server.address().port}`;
  const firstSession = await app.store.authenticate('register', 'PatchResident', 'a-patch-test-password');
  const secondSession = await app.store.authenticate('register', 'LegacyResident', 'a-patch-test-password');
  const firstAccount = app.store.accountFromToken(firstSession.token), secondAccount = app.store.accountFromToken(secondSession.token);
  const { id } = app.simulation.create('Patch Settlement', firstAccount), village = app.simulation.villages.get(id);
  const first = app.simulation.join(id, firstAccount), second = app.simulation.join(id, secondAccount);
  first.x = -18; first.z = -17.5; village.clock += .7;
  app.simulation.action(id, first.id, { kind: 'loan', amount: 200 });
  const modern = await connect(base, firstSession, id, true), legacy = await connect(base, secondSession, id, false);
  streams.push(modern, legacy);
  assert.equal(modern.frames[0].patch, false, 'a patch-capable client first receives a complete state');
  assert.equal(modern.frames[0].state.plots.length, 48); assert.ok(modern.frames[0].state.resources.length > 137);
  assert.equal(legacy.frames[0].patch, undefined, 'old clients retain their existing full-snapshot protocol');
  assert.deepEqual([modern.merged.loan.debt, modern.merged.loan.credit], [200, 200]);
  assert.deepEqual([legacy.merged.loan.debt, legacy.merged.loan.credit], [0, 0]);
  for (const [stream, ownId, otherId] of [[modern, first.id, second.id], [legacy, second.id, first.id]]) {
    assert.equal(stream.merged.players.find(player => player.id === ownId).wallet, 10);
    const other = stream.merged.players.find(player => player.id === otherId);
    for (const field of ['wallet', 'inventory', 'bank', 'loan', 'credit', 'debt']) assert.equal(other[field], undefined, `${field} remains private in ${stream === modern ? 'patch' : 'legacy'} state`);
  }

  const [idlePatch, idleFull] = await broadcast(app, modern, legacy);
  assert.equal(idlePatch.patch, true); assert.equal(idlePatch.state.plots, undefined); assert.equal(idlePatch.state.resources, undefined);
  assert.ok(idleFull.state.plots && idleFull.state.resources, 'the simultaneous legacy client continues receiving every field');
  assert.ok(idlePatch.bytes < idleFull.bytes / 10, 'an unchanged village should not retransmit its large map catalogue');
  assert.deepEqual(modern.merged, wire(app.simulation.snapshot(village, first.id)));

  first.x = 0; first.z = 4;
  modern.ws.send(JSON.stringify({ type: 'input', x: 1, z: 0, yaw: Math.PI / 2, tool: 'sword' }));
  await waitFor(() => app.simulation.inputs.get(first.id)?.x === 1);
  app.simulation.tick(.05);
  const [movementPatch, movementFull] = await broadcast(app, modern, legacy);
  assert.ok(movementPatch.state.players, 'movement transmits the changed player list');
  assert.equal(movementPatch.state.plots, undefined); assert.equal(movementPatch.state.resources, undefined);
  assert.ok(movementPatch.bytes < movementFull.bytes / 4, 'movement packets remain substantially smaller than full map snapshots');
  assert.deepEqual(modern.merged, wire(app.simulation.snapshot(village, first.id)));

  const node = RESOURCES.find(resource => resource.type === 'iron'); first.x = node.x; first.z = node.z;
  first.durability.pickaxe = 100; // Equipment already obtained before this gather/snapshot scenario.
  modern.ws.send(JSON.stringify({ type: 'input', x: 0, z: 0, yaw: 0, tool: 'pickaxe' }));
  await waitFor(() => first.tool === 'pickaxe');
  const originalIron = first.inventory.iron; village.clock += .7;
  modern.ws.send(JSON.stringify({ type: 'action', kind: 'gather', targetId: node.id }));
  await waitFor(() => first.inventory.iron === originalIron + 1);
  const [gatherPatch] = await broadcast(app, modern, legacy);
  assert.ok(gatherPatch.state.resources, 'resource depletion sends the changed resource state');
  assert.ok(gatherPatch.state.players, 'the harvester receives the authoritative inventory and durability update');
  assert.equal(gatherPatch.state.plots, undefined, 'gathering ore does not repeat all plot metadata');
  assert.equal(modern.merged.players.find(player => player.id === first.id).inventory.iron, originalIron + 1);
  assert.equal(legacy.merged.players.find(player => player.id === first.id).inventory, undefined, 'a gather update cannot expose another dwarf inventory');
  assert.deepEqual(modern.merged, wire(app.simulation.snapshot(village, first.id)));
  assert.deepEqual(legacy.merged, wire(app.simulation.snapshot(village, second.id)));
  assert.deepEqual(modern.errors, []); assert.deepEqual(legacy.errors, []);

  modern.ws.close(); await once(modern.ws, 'close'); await waitFor(() => !first.online);
  const reconnected = await connect(base, firstSession, id, true); streams.push(reconnected);
  assert.equal(reconnected.frames[0].patch, false, 'a new socket never inherits the old socket patch baseline');
  assert.equal(reconnected.frames[0].state.plots.length, 48);
  assert.equal(reconnected.merged.players.find(player => player.id === first.id).inventory.iron, originalIron + 1);
  assert.deepEqual(reconnected.merged, wire(app.simulation.snapshot(village, first.id)));
  t.diagnostic(`Wire bytes: idle ${idlePatch.bytes}/${idleFull.bytes}; movement ${movementPatch.bytes}/${movementFull.bytes} (patch/full).`);
});
