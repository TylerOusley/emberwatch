import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createApp } from '../server/index.js';
import { BUILDINGS, PLOTS, ROAD, plotFront } from '../shared/world.js';
import { buildingEntrance } from '../shared/access.js';
import { ENEMY_LIMITS } from '../shared/enemies.js';

async function waitFor(predicate, label, timeout = 2500) {
  const end = performance.now() + timeout;
  while (performance.now() < end) {
    const result = predicate(); if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}
async function connect(base, session, villageId, patches, role) {
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/socket'), stream = { ws, frames: [], errors: [], notices: [], state: null };
  ws.on('message', bytes => {
    const message = JSON.parse(bytes.toString());
    if (message.type === 'error') stream.errors.push(message.message);
    if (message.type === 'notice') stream.notices.push(message.message);
    if (message.type === 'state') {
      stream.frames.push(message);
      stream.state = message.patch ? { ...stream.state, ...message.state } : message.state;
    }
  });
  await once(ws, 'open');
  ws.send(JSON.stringify({ type: 'join', token: session.token, villageId, role, statePatches: patches }));
  await waitFor(() => stream.state, 'authenticated first snapshot'); return stream;
}
async function broadcast(app, streams) {
  const indexes = streams.map(stream => stream.frames.length); app.broadcast();
  await Promise.all(streams.map((stream, i) => waitFor(() => stream.frames[indexes[i]], 'broadcast snapshot')));
}
async function command(village, stream, payload, errorPattern = null) {
  village.clock += .7;
  const notices = stream.notices.length, errors = stream.errors.length;
  stream.ws.send(JSON.stringify({ type: 'action', ...payload }));
  await waitFor(() => stream.notices.length > notices || stream.errors.length > errors, `${payload.kind} response`);
  if (errorPattern) { assert.equal(stream.errors.length, errors + 1, 'the action receives an explicit rejection'); assert.match(stream.errors.at(-1) ?? '', errorPattern); }
  else assert.equal(stream.errors.length, errors, stream.errors.at(-1));
}

test('build 10 survives authenticated patch/legacy multiplayer, funded deliveries, unlock privacy and SQLite restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'emberwatch-watch-update-'));
  const options = { dataDir: directory, autoTick: false, daySeconds: 30, nightSeconds: 10 };
  let app = createApp(options), streams = [];
  t.after(async () => { for (const stream of streams) stream.ws.terminate(); await app.close(); await rm(directory, { recursive: true, force: true }); });
  async function listen() { app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening'); return `http://127.0.0.1:${app.server.address().port}`; }
  let base = await listen();
  async function register(name) {
    const response = await fetch(base + '/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'register', name, password: 'combined-watch-test-password' }) });
    assert.equal(response.status, 200); return response.json();
  }
  const firstSession = await register('Modern Watch'), secondSession = await register('Legacy Watch');
  const create = await fetch(base + '/api/villages', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${firstSession.token}` }, body: JSON.stringify({ name: 'Shared Watch' }) });
  assert.equal(create.status, 201); const { village: summary } = await create.json();
  let modern = await connect(base, firstSession, summary.id, true, 'guard'), legacy = await connect(base, secondSession, summary.id, false, 'villager');
  streams.push(modern, legacy);
  assert.equal(modern.frames[0].patch, false); assert.equal(legacy.frames[0].patch, undefined);
  const village = app.simulation.villages.get(summary.id), first = village.players[firstSession.playerId], second = village.players[secondSession.playerId];
  // Existing owned infrastructure and gathered wheat are fixture state. Every
  // command, delivery, guide choice and appearance choice below uses a socket.
  const site = PLOTS.find(p => p.id === 'west-1'), plot = village.plots.find(p => p.id === site.id);
  Object.assign(plot, { ownerId: first.id, building: 'barracks', hp: 800, maxHp: 800, storage: { wheat: 12 } });
  village.guards.push({ id: 'owned-watch-test', ownerId: first.id, plotId: plot.id, slot: 1, ...plotFront(site, 1), hp: 160, maxHp: 160, cooldown: 0, roadIndex: 0 });
  village.stock.wheat = 0; first.inventory.wheat = 24; Object.assign(first, { x: 0, z: 0 });
  app.simulation.tick(.05);
  const request = village.requests.items.find(r => r.status === 'open' && r.destinationId === 'bank' && r.resource === 'wheat');
  assert.ok(request?.reserved > 0);
  await command(village, modern, { kind: 'guard_order', plotId: plot.id, mode: 'hold', ownerId: second.id, x: 999, z: 999 });
  assert.deepEqual(plot.guardOrder, { mode: 'hold', ownerId: first.id, x: 0, z: 0 }, 'authenticated owner and server position determine the order');
  await broadcast(app, [modern, legacy]);
  assert.equal(modern.state.guardOrders.length, 1); assert.deepEqual(legacy.state.guardOrders, []);
  assert.deepEqual(modern.state.requests, legacy.state.requests, 'noticeboard funding and needs are public');
  assert.equal(modern.state.requests.ledger, undefined, 'withdrawal provenance stays server-side');
  assert.ok(modern.frames.at(-1).patch);

  const before = { wallet: first.wallet, inventory: first.inventory.wheat, stock: village.stock.wheat, treasury: village.treasury, reserved: request.reserved };
  await command(village, modern, { kind: 'request_deliver', requestId: request.id, amount: 10, playerId: second.id }, /entrance/);
  assert.deepEqual({ wallet: first.wallet, inventory: first.inventory.wheat, stock: village.stock.wheat, treasury: village.treasury, reserved: request.reserved }, before, 'remote delivery leaves items, wallet and escrow unchanged');
  Object.assign(first, buildingEntrance(BUILDINGS.find(b => b.id === 'bank')));
  await command(village, modern, { kind: 'request_deliver', requestId: request.id, amount: 10, playerId: second.id });
  const delivered = village.requests.items.find(r => r.id === request.id), paid = 10 * delivered.unitGold;
  assert.equal(first.inventory.wheat, before.inventory - 10); assert.equal(village.stock.wheat, before.stock + 10);
  assert.equal(first.wallet, before.wallet + paid); assert.equal(delivered.reserved, before.reserved - paid);
  assert.equal(village.treasury, before.treasury); assert.equal(second.wallet, 10);
  assert.equal(first.wallet + village.treasury + delivered.reserved, before.wallet + before.treasury + before.reserved, 'escrow pays once without minting currency');
  await command(village, modern, { kind: 'guide_visibility', dismissed: true, done: ['forged'], nights: 999 });
  Object.assign(first, { x: 0, z: 14 }); app.simulation.tick(.05);
  await broadcast(app, [modern, legacy]);
  assert.equal(modern.state.requests.items.find(r => r.id === request.id).delivered, 10);
  assert.deepEqual(modern.state.requests, legacy.state.requests);
  assert.equal(modern.state.progression.guide.dismissed, true); assert.equal(legacy.state.progression.guide.dismissed, false);
  assert.ok(modern.state.progression.guide.done.includes('gate')); assert.deepEqual(legacy.state.progression.guide.done, []);
  assert.equal(legacy.state.players.find(p => p.id === first.id).accountProgression, undefined);
  assert.equal(legacy.state.players.find(p => p.id === first.id).inventory, undefined);

  Object.assign(first, { x: 0, z: -5 }); app.simulation.hurtPlayer(village, second, second.hp + (second.shield ?? 0));
  app.simulation.startNight(village);
  for (let i = 0; i < 101; i++) app.simulation.tick(.1);
  assert.equal(village.phase, 'day'); assert.equal(village.day, 2);
  assert.equal(app.store.progression(first.id).nights, 1); assert.equal(app.store.progression(second.id).nights, 0);
  assert.ok(village.progression.watch.seconds[first.id] >= 5, 'the ten-second watch requires five observed living seconds');
  assert.equal(village.progression.watch.seconds[second.id] ?? 0, 0);
  await command(village, legacy, { kind: 'respawn' });
  await command(village, modern, { kind: 'cosmetic_player', palette: 'ember', crest: 'flame' });
  await command(village, legacy, { kind: 'cosmetic_player', palette: 'ember', crest: 'flame', nights: 999, unlocked: ['first_watch'], playerId: first.id }, /Earn/);
  await broadcast(app, [modern, legacy]);
  assert.equal(modern.state.progression.nights, 1); assert.equal(legacy.state.progression.nights, 0);
  assert.deepEqual(modern.state.progression.unlocked, ['first_watch']); assert.deepEqual(legacy.state.progression.unlocked, []);
  assert.deepEqual(modern.state.cosmetics, legacy.state.cosmetics, 'chosen appearances replicate independently of private unlock ledgers');
  assert.deepEqual(legacy.state.cosmetics.players[first.id], { palette: 'ember', crest: 'flame' });
  assert.deepEqual(modern.state.cosmetics.players[second.id], { palette: 'natural', crest: 'none' });

  village.day = 5; village.stock.wheat = 0; app.simulation.tick(.05); app.simulation.startNight(village);
  for (let i = 0; i < 21; i++) app.simulation.tick(.1);
  const siege = village.zombies.find(z => z.kind === 'siege'); assert.ok(siege);
  assert.ok(Math.hypot(siege.x - ROAD[0].x, siege.z - ROAD[0].z) < 2, 'the siege actually spawns at the graveyard');
  assert.equal(siege.anim, 'emerge'); assert.ok(Math.abs(siege.emergeUntil - siege.spawnAt - ENEMY_LIMITS.graveEmergence) < 1e-8);
  await broadcast(app, [modern, legacy]);
  assert.equal(modern.state.siegeNight, true); assert.equal(legacy.state.siegeNight, true);
  assert.equal(modern.state.phaseDuration, 10); assert.equal(modern.state.phaseEndsAt, legacy.state.phaseEndsAt); assert.equal(modern.state.clock, legacy.state.clock);
  const modernSiege = modern.state.zombies.find(z => z.id === siege.id), legacySiege = legacy.state.zombies.find(z => z.id === siege.id);
  assert.deepEqual(modernSiege, legacySiege); assert.equal(modernSiege.birth, 'grave');
  for (const key of ['kind', 'spawnAt', 'emergeUntil', 'windupStartedAt', 'windupUntil', 'windupTarget']) assert.ok(Object.hasOwn(modernSiege, key));
  while (village.clock <= siege.emergeUntil) app.simulation.tick(.1);
  // Move the emerged siege to gate contact to exercise the real attack warning
  // without spending the test walking it along the whole graveyard road.
  Object.assign(siege, { x: 0, z: 21, roadIndex: 3, cooldown: 0 });
  app.simulation.tick(.05); await broadcast(app, [modern, legacy]);
  const attack = modern.state.zombies.find(z => z.id === siege.id);
  assert.equal(attack.anim, 'windup'); assert.ok(attack.windupUntil > modern.state.clock);
  assert.equal(attack.windupTarget, 'gate'); assert.deepEqual(attack, legacy.state.zombies.find(z => z.id === siege.id));

  const saved = { requests: structuredClone(village.requests), order: structuredClone(plot.guardOrder),
    first: app.store.progression(first.id), second: app.store.progression(second.id),
    wallets: [first.wallet, second.wallet], treasury: village.treasury, clock: village.clock,
    gate: village.gate.hp, windupUntil: siege.windupUntil };
  assert.ok(saved.requests.items.some(r => r.status === 'open' && r.reserved > 0), 'restart exercises a still-funded request');
  await app.close(); streams = []; app = createApp(options); base = await listen();
  const recovered = app.simulation.villages.get(summary.id); app.simulation.tick(1000);
  assert.equal(recovered.clock, saved.clock, 'restarting an empty village never advances clocks or awards another night');
  assert.deepEqual(recovered.requests, saved.requests); assert.deepEqual(recovered.plots.find(p => p.id === plot.id).guardOrder, saved.order);
  assert.deepEqual(app.store.progression(first.id), saved.first); assert.deepEqual(app.store.progression(second.id), saved.second);
  modern = await connect(base, firstSession, summary.id, true, 'guard'); legacy = await connect(base, secondSession, summary.id, false, 'villager'); streams.push(modern, legacy);
  await broadcast(app, [modern, legacy]);
  assert.equal(modern.frames[0].patch, false); assert.equal(modern.state.progression.nights, 1); assert.equal(legacy.state.progression.nights, 0);
  assert.deepEqual([recovered.players[first.id].wallet, recovered.players[second.id].wallet], saved.wallets); assert.equal(recovered.treasury, saved.treasury);
  assert.deepEqual(recovered.requests, saved.requests); assert.equal(recovered.gate.hp, saved.gate);
  assert.equal(modern.state.zombies.find(z => z.id === siege.id).windupUntil, saved.windupUntil);
  assert.equal(modern.state.guardOrders[0].mode, 'hold'); assert.deepEqual(legacy.state.guardOrders, []);
  assert.deepEqual(modern.state.cosmetics, legacy.state.cosmetics);

  const modulePaths = ['/src/guard-orders-ui.js', '/src/requests-ui.js', '/src/noticeboard.js', '/src/progression-ui.js', '/src/cosmetics.js', '/src/audio.js', '/src/zombie-presentation.js', '/shared/enemies.js', '/shared/progression.js', '/shared/requests.js'];
  await Promise.all(modulePaths.map(async path => {
    const response = await fetch(base + path); assert.equal(response.status, 200, `${path} is served to game clients`); assert.match(response.headers.get('content-type'), /javascript/);
  }));
});
