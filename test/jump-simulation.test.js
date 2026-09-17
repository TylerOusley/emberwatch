import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { Store } from '../server/store.js';
import { Simulation } from '../server/simulation.js';
import { createApp } from '../server/index.js';
import { stepNpcNavigation } from '../server/navigation.js';
import { CONFIG, CAVE_ROUTE, groundHeight, canStand } from '../shared/world.js';
import { JUMP, movePlayer, resetJump, standingHeight } from '../shared/movement.js';
import { PoseBuffer } from '../public/src/motion.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'emberwatch-jump-'));
  const f = { directory, store: new Store(directory) };
  t.after(async () => { f.store.close(); await rm(directory, { recursive: true, force: true }); });
  f.sim = new Simulation(f.store, { daySeconds: 10000 });
  const session = await f.store.authenticate('register', 'JumpTester', 'jump-test-password');
  f.account = f.store.account(session.playerId); f.id = f.sim.create('Jump Village', f.account).id;
  f.player = f.sim.join(f.id, f.account); f.v = f.sim.villages.get(f.id);
  f.input = (jump = false, x = 0, z = 0, extra = {}) => f.sim.input(f.id, f.player.id, { x, z, yaw: 0, jump, ...extra });
  f.step = (jump = false, x = 0, z = 0, dt = .02) => { f.input(jump, x, z); f.sim.tick(dt); };
  return f;
}

async function waitFor(predicate, message) {
  const until = performance.now() + 3000;
  while (performance.now() < until) { const value = predicate(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw new Error(message ?? 'Timed out waiting for jump replication.');
}

test('authenticated socket input produces shared jump height and ignores forged height, velocity, dt and owner fields', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'emberwatch-jump-socket-'));
  const app = createApp({ dataDir: directory, autoTick: false }), clients = [];
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(async () => { for (const client of clients) client.terminate(); await app.close(); await rm(directory, { recursive: true, force: true }); });
  const a = await app.store.authenticate('register', 'JumpSender', 'jump-test-password'), b = await app.store.authenticate('register', 'JumpObserver', 'jump-test-password');
  const villageId = app.simulation.create('Socket Jump Village', app.store.account(a.playerId)).id;
  const connect = async session => {
    const ws = new WebSocket(`ws://127.0.0.1:${app.server.address().port}/socket`), queue = []; clients.push(ws);
    ws.on('message', data => queue.push(JSON.parse(data.toString()))); await once(ws, 'open');
    ws.send(JSON.stringify({ type: 'join', token: session.token, villageId, role: 'villager' }));
    await waitFor(() => queue.find(message => message.type === 'state')); return { ws, queue };
  };
  const sender = await connect(a), observer = await connect(b), village = app.simulation.villages.get(villageId), player = village.players[a.playerId];
  Object.assign(player, { x: 0, z: 4 }); resetJump(player); const startX = player.x;
  sender.ws.send(JSON.stringify({ type: 'input', x: 100, z: 0, yaw: .123, jump: true, y: 10000, verticalSpeed: 10000, grounded: true, dt: 99999, playerId: b.playerId }));
  await waitFor(() => app.simulation.inputs.get(player.id)?.yaw === .123);
  const stored = app.simulation.inputs.get(player.id);
  assert.equal(stored.x, 1); assert.equal(stored.y, undefined); assert.equal(stored.verticalSpeed, undefined); assert.equal(stored.dt, undefined);
  app.simulation.tick(.1); app.broadcast();
  const packet = await waitFor(() => observer.queue.find(message => message.type === 'state' && message.state.players?.some(p => p.id === player.id && p.y > 0)));
  const remote = packet.state.players.find(p => p.id === player.id);
  assert.ok(player.y > 0 && player.y < JUMP.height); assert.ok(player.x - startX <= CONFIG.speed * .1 + 1e-8);
  assert.equal(remote.y, player.y); assert.equal(remote.verticalSpeed, player.verticalSpeed); assert.equal(remote.grounded, false);
  assert.equal(remote.inventory, undefined); assert.equal(village.players[b.playerId].y ?? 0, 0, 'the sender cannot jump another player');
});

test('held jump creates one bounded arc; release re-arms it and stale input cannot keep a player airborne', async t => {
  const f = await fixture(t); let peak = 0, launches = 0, previouslyGrounded = true;
  for (let i = 0; i < 125; i++) {
    f.step(true); peak = Math.max(peak, f.player.y);
    if (previouslyGrounded && !f.player.grounded) launches++; previouslyGrounded = f.player.grounded;
  }
  assert.equal(launches, 1); assert.ok(peak > 1.1 && peak <= JUMP.height); assert.equal(f.player.y, 0);
  f.step(false); f.step(true); assert.ok(f.player.y > 0);
  f.sim.inputs.get(f.player.id).received = -10000;
  for (let i = 0; i < 100; i++) f.sim.tick(.02);
  assert.equal(f.player.y, 0); assert.equal(f.player.grounded, true); assert.equal(f.player.verticalSpeed, 0);
  f.input('true'); f.sim.tick(.1); assert.equal(f.player.y, 0, 'truthy strings cannot request a jump');
});

test('disconnect and real SQLite restart discard airborne momentum and stale held input', async t => {
  const f = await fixture(t); f.step(true, 0, 0, .1); assert.ok(f.player.y > 0);
  f.sim.disconnect(f.id, f.player.id); assert.equal(f.player.y, 0); assert.equal(f.player.verticalSpeed, 0); assert.equal(f.player.jumpHeld, false);
  f.sim.join(f.id, f.account); f.step(true, 0, 0, .1); assert.ok(f.player.y > 0);
  // Simulate a process restart without the orderly disconnect path.
  f.sim.saveAll(); f.store.close(); f.store = new Store(f.directory); f.sim = new Simulation(f.store, { daySeconds: 10000 });
  f.v = f.sim.villages.get(f.id); f.player = f.v.players[f.account.id];
  assert.equal(f.player.online, false); assert.equal(f.player.y, groundHeight(f.player.x, f.player.z)); assert.equal(f.player.verticalSpeed, 0);
  f.sim.join(f.id, f.store.account(f.account.id)); assert.equal(f.sim.inputs.has(f.player.id), false);
  assert.equal(f.sim.snapshot(f.v, f.player.id).players.find(p => p.id === f.player.id).grounded, true);
});

test('a midair death settles the body and mounted, carried, rescue and bed states cannot jump or retain momentum', async t => {
  const f = await fixture(t); f.step(true, 0, 0, .1); assert.ok(f.player.y > 0);
  f.sim.hurtPlayer(f.v, f.player, 10000); assert.equal(f.player.downed, true); assert.equal(f.player.y, 0); assert.equal(f.player.verticalSpeed, 0);
  f.sim.tick(.1); assert.equal(f.player.y, 0);
  for (const key of ['mountedHorseId', 'carryingId', 'carriedBy', 'rescueCartId', 'bedPlotId', 'downed']) {
    const p = { x: 0, z: 4, y: .8, verticalSpeed: 4, [key]: key === 'downed' ? true : 'other' };
    movePlayer(p, .5, 0, .1, true); assert.equal(p.y, 0, key); assert.equal(p.verticalSpeed, 0, key);
    assert.equal(p.x, ['mountedHorseId', 'carryingId'].includes(key) ? .5 : 0, `${key} controls horizontal movement separately from jump`);
  }
});

test('authoritative movement climbs three quarry steps, preserves legal elevated saves and walks off without a collision trap', async t => {
  const f = await fixture(t); Object.assign(f.player, { x: -73, z: 111 }); resetJump(f.player); let highestLanding = 0;
  for (let i = 0; i < 155; i++) {
    f.step(i % 45 < 10, -1, 0); if (f.player.grounded) highestLanding = Math.max(highestLanding, f.player.y);
  }
  assert.equal(highestLanding, 1.65); assert.ok(f.player.x < -84); assert.equal(f.player.y, 0); assert.ok(canStand(f.player.x, f.player.z));
  Object.assign(f.player, { x: -82, z: 111 }); resetJump(f.player); const before = { x: f.player.x, z: f.player.z };
  f.sim.relocateBlocked(f.v); assert.equal(f.player.x, before.x); assert.equal(f.player.z, before.z); assert.equal(f.player.y, 1.65);
  f.sim.disconnect(f.id, f.player.id); f.sim.join(f.id, f.account);
  assert.equal(f.player.x, before.x); assert.equal(f.player.z, before.z); assert.equal(f.player.y, 1.65);
});

test('jumping follows the continuous cave descent and cannot bypass the mountain or village wall', async t => {
  const f = await fixture(t); Object.assign(f.player, CAVE_ROUTE[0]); resetJump(f.player);
  let ticks = 0;
  for (const target of CAVE_ROUTE.slice(1)) {
    for (let guard = 0; Math.hypot(f.player.x - target.x, f.player.z - target.z) > .2 && guard < 500; guard++) {
      const dx = target.x - f.player.x, dz = target.z - f.player.z, length = Math.hypot(dx, dz);
      f.step(ticks++ % 70 < 8, dx / length, dz / length);
      assert.ok(f.player.y >= groundHeight(f.player.x, f.player.z) - 1e-8);
    }
    assert.ok(Math.hypot(f.player.x - target.x, f.player.z - target.z) <= .2, `reachable cave route point ${target.x},${target.z}`);
  }
  for (let i = 0; i < 100; i++) f.step(false);
  assert.equal(f.player.y, -14); assert.equal(f.player.grounded, true);
  for (const start of [{ x: -84, z: -40, dx: -1, dz: 0 }, { x: 0, z: -130, dx: 1, dz: 0 }]) {
    Object.assign(f.player, { x: start.x, z: start.z }); resetJump(f.player);
    for (let i = 0; i < 100; i++) f.step(i % 45 < 8, start.dx, start.dz);
    assert.ok(start.dx < 0 ? f.player.x > -85.6 : f.player.x < 5.6, 'full-height geometry remains solid throughout a jump');
  }
});

test('NPC navigation plans around the same log footprint that blocks grounded movement', () => {
  const npc = { x: -66, z: 103, yaw: 0 }, target = { x: -66, z: 109 }; let detour = 0;
  for (let i = 0; i < 400 && Math.hypot(npc.x - target.x, npc.z - target.z) > .5; i++) {
    stepNpcNavigation(npc, target, 3, .05); detour = Math.max(detour, Math.abs(npc.x + 66));
    assert.ok(canStand(npc.x, npc.z, .4), 'the NPC never crosses the solid log');
  }
  assert.ok(detour > 3.8); assert.ok(Math.hypot(npc.x - target.x, npc.z - target.z) <= .5, 'the NPC reaches the far side without repeatedly planning into the obstacle');
});

test('remote jump interpolation smooths height without inventing locomotion or extrapolating through missing packets', () => {
  const track = new PoseBuffer();
  track.push({ x: 0, y: 0, z: 4, grounded: true, anim: 'idle' }, 0);
  track.push({ x: 0, y: 1, z: 4, grounded: false, anim: 'idle' }, 100);
  const mid = track.sample(170, 120); assert.equal(mid.y, .5); assert.equal(mid.speed, 0); assert.equal(mid.grounded, false);
  const held = track.sample(1000, 120); assert.equal(held.y, 1); assert.equal(held.speed, 0);
  track.push({ x: 0, y: -14, z: 4, grounded: true }, 200); assert.equal(track.frames.length, 1); assert.equal(track.sample(220).y, -14);
  const malformed = { x: -82, z: 111, y: NaN, verticalSpeed: Infinity };
  movePlayer(malformed, 0, 0, .1, false); assert.equal(malformed.y, standingHeight(malformed.x, malformed.z)); assert.equal(malformed.verticalSpeed, 0);
  movePlayer(malformed, 0, 0, Infinity, true); assert.ok(Number.isFinite(malformed.y));
});
