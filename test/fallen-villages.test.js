import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server/index.js';
import { BUILDINGS } from '../shared/world.js';
import { buildingEntrance } from '../shared/access.js';

const bankEntrance = buildingEntrance(BUILDINGS.find(building => building.id === 'bank'));

async function listen(app) {
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  return `http://127.0.0.1:${app.server.address().port}`;
}

async function account(app, name) {
  const session = await app.store.authenticate('register', name, 'a-good-test-pass');
  return { session, user: app.store.accountFromToken(session.token) };
}

test('fallen runs leave the public list immediately and after restart while results and bank savings remain', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'emberwatch-fallen-'));
  let app = createApp({ dataDir: directory, autoTick: false });
  let base = await listen(app);
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const founder = await account(app, 'LastWatchFounder');
  const neighbor = await account(app, 'QuietWatchFounder');
  const fallenId = app.simulation.create('Last Watch', founder.user).id;
  const activeId = app.simulation.create('Quiet Watch', neighbor.user).id;
  const village = app.simulation.villages.get(fallenId);
  const player = app.simulation.join(fallenId, founder.user);
  const neighborPlayer = app.simulation.join(activeId, neighbor.user);
  app.simulation.disconnect(activeId, neighborPlayer.id);
  Object.assign(player, bankEntrance); player.wallet = 50;
  app.simulation.action(fallenId, player.id, { kind: 'deposit', amount: 30 });
  const list = async () => (await (await fetch(base + '/api/villages')).json()).villages;
  assert.deepEqual((await list()).map(v => v.id), [fallenId, activeId]);

  // Exercise the real defeat transition with a zombie already at the keep.
  village.guards = []; village.gate.hp = 0; village.keep.hp = 10;
  village.zombies = [{ id: 'last-zombie', x: 0, z: -34, yaw: Math.PI, hp: 65, maxHp: 65, anim: 'walk', roadIndex: 5, cooldown: 0, elite: false, speed: 1.75 }];
  app.simulation.tickNpcs(village, .05);
  village.clock += .81; app.simulation.tickNpcs(village, .81);
  assert.equal(village.status, 'fallen');
  const available = await list();
  assert.deepEqual(available.map(v => v.id), [activeId]);
  assert.equal(available[0].online, 0, 'an empty but surviving village stays available');
  assert.equal(available[0].residents, 1, 'offline resident places are retained');
  assert.equal(app.simulation.villages.get(fallenId), village, 'connected residents can still see the loss screen');
  const loss = app.simulation.snapshot(village, player.id);
  assert.equal(loss.status, 'fallen');
  assert.equal(loss.players.find(p => p.id === player.id).bank, 30);
  assert.throws(() => app.simulation.join(fallenId, founder.user), /has fallen/);

  await app.close();
  app = createApp({ dataDir: directory, autoTick: false });
  base = await listen(app);
  assert.deepEqual((await list()).map(v => v.id), [activeId], 'saved fallen runs never reappear after deployment');
  assert.equal(app.store.loadVillages().find(v => v.id === fallenId).status, 'fallen');
  const returningAccount = app.store.accountFromToken(founder.session.token);
  assert.equal(returningAccount.bank, 30);
  const nextId = app.simulation.create('Next Watch', returningAccount).id;
  const nextPlayer = app.simulation.join(nextId, returningAccount);
  Object.assign(nextPlayer, bankEntrance);
  const wallet = nextPlayer.wallet;
  app.simulation.action(nextId, nextPlayer.id, { kind: 'withdraw', amount: 20 });
  assert.equal(nextPlayer.wallet, wallet + 20, 'savings remain spendable in the next run');
  assert.equal(app.store.account(nextPlayer.id).bank, 10);
  assert.deepEqual((await list()).map(v => v.id), [activeId, nextId]);
});
