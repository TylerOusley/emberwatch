import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { Simulation } from '../server/simulation.js';

async function fixture(t, residents = 1) {
  const directory = await mkdtemp(join(tmpdir(), 'emberwatch-survival-grants-'));
  const f = { directory, store: new Store(directory), players: [] };
  t.after(async () => { f.store.close(); await rm(directory, { recursive: true, force: true }); });
  const accounts = [];
  for (let index = 0; index < residents; index++) {
    const session = await f.store.authenticate('register', `Grant Dwarf ${index}`, 'survival-grants-password');
    accounts.push(f.store.account(session.playerId));
  }
  f.sim = new Simulation(f.store);
  const { id } = f.sim.create('Grant Watch', accounts[0]); f.v = f.sim.villages.get(id);
  f.players = accounts.map(account => f.sim.join(id, account, 'villager'));
  f.v.guards = []; f.v.stable.stock = 3;
  f.v.stock = { wheat: 300, timber: 300, stone: 300, iron: 0, coal: 0, sulfur: 0 };
  f.v.barracks.wheat = 300;
  f.night = day => { f.v.day = day; f.sim.startNight(f.v); f.v.nextSpawn = f.v.clock + 10000; };
  f.restart = () => {
    const ids = f.players.map(p => p.id);
    f.store.close(); f.store = new Store(directory); f.sim = new Simulation(f.store);
    f.v = f.sim.villages.get(id); f.players = ids.map(playerId => f.v.players[playerId]);
  };
  return f;
}

for (const night of [1, 5, 10, 100]) {
  test(`surviving night ${night} grants exactly ${1000 * night} treasury gold before ordinary dawn transactions`, async t => {
    const f = await fixture(t, night === 10 ? 8 : 1);
    f.night(night); f.v.phaseRemaining = .05;
    const treasury = f.v.treasury, wallets = f.players.map(p => p.wallet), banks = f.players.map(p => f.store.account(p.id).bank);
    f.sim.tick(.1);
    assert.equal(f.v.phase, 'day'); assert.equal(f.v.day, night + 1);
    assert.equal(f.v.treasury - treasury - f.v.economy.lastExportGold, 1000 * night, 'one grant for the village, independent of resident count');
    assert.equal(f.v.economy.lastTaxes, 0); assert.equal(f.v.requests.items.filter(r => r.status === 'open').length, 0);
    assert.deepEqual(f.players.map(p => p.wallet), wallets); assert.deepEqual(f.players.map(p => f.store.account(p.id).bank), banks);
    const paid = f.v.treasury, noticeCount = f.sim.notices.length;
    assert.equal(f.sim.dawn(f.v), false); assert.equal(f.sim.finishClearedNight(f.v), false);
    assert.equal(f.v.treasury, paid); assert.equal(f.v.day, night + 1); assert.equal(f.sim.notices.length, noticeCount);
    f.restart(); assert.equal(f.sim.dawn(f.v), false); f.sim.tick(10000);
    assert.equal(f.v.treasury, paid, 'an empty restored village remains paused without another grant'); assert.equal(f.v.day, night + 1);
  });
}

test('uncapped night grant, earned wages and honors roll back together on failed SQLite save and pay once on retry', async t => {
  const f = await fixture(t); f.night(10);
  const player = f.players[0]; player.wageAccrued = 17; player.jobBonus = 3; player.repairBonus = 2;
  f.v.progression.watch.seconds[player.id] = f.v.progression.watch.duration;
  f.sim.saveAll();
  const before = structuredClone(f.v), saved = f.store.loadVillages(), notices = structuredClone(f.sim.notices);
  const save = f.store.saveVillage.bind(f.store);
  f.store.saveVillage = village => { save(village); throw new Error('Injected grant save failure'); };
  assert.throws(() => f.sim.dawn(f.v), /Injected grant save failure/);
  assert.deepEqual(f.v, before); assert.deepEqual(f.store.loadVillages(), saved); assert.deepEqual(f.sim.notices, notices);
  assert.equal(f.store.progression(player.id).nights, 0);
  f.store.saveVillage = save;
  assert.equal(f.sim.dawn(f.v), true);
  assert.equal(f.v.treasury, before.treasury + 10000 + f.v.economy.lastExportGold - 17);
  assert.equal(player.wallet, before.players[player.id].wallet + 22); assert.equal(f.store.progression(player.id).nights, 1);
  const paid = f.v.treasury; f.restart();
  assert.equal(f.sim.dawn(f.v), false); assert.equal(f.v.treasury, paid); assert.equal(f.store.progression(player.id).nights, 1);
});

test('early clearing night 100 pays the same uncapped grant exactly once', async t => {
  const f = await fixture(t); f.night(100); f.v.spawned = f.v.waveCount;
  const treasury = f.v.treasury;
  assert.equal(f.sim.finishClearedNight(f.v), true);
  assert.equal(f.v.treasury - treasury - f.v.economy.lastExportGold, 100000);
  assert.equal(f.sim.finishClearedNight(f.v), false); assert.equal(f.sim.dawn(f.v), false);
  assert.equal(f.v.day, 101);
});

test('fallen villages and destroyed keeps cannot collect survival grants', async t => {
  const f = await fixture(t); f.night(10); f.v.status = 'fallen';
  const before = structuredClone(f.v);
  assert.equal(f.sim.dawn(f.v), false); assert.deepEqual(f.v, before);
  f.v.status = 'active'; f.v.keep.hp = 0;
  const ruined = structuredClone(f.v);
  assert.equal(f.sim.dawn(f.v), false); assert.deepEqual(f.v, ruined);
});

test('survival grants reject unrepresentable balances atomically instead of capping or rounding the payment', async t => {
  const f = await fixture(t); f.night(100);
  f.v.treasury = Number.MAX_SAFE_INTEGER - 99999;
  const before = structuredClone(f.v);
  assert.throws(() => f.sim.dawn(f.v), /supported treasury balance/); assert.deepEqual(f.v, before);
  f.v.treasury = 20000; f.v.day = Number.MAX_SAFE_INTEGER;
  const hugeNight = structuredClone(f.v);
  assert.throws(() => f.sim.dawn(f.v), /supported treasury balance/); assert.deepEqual(f.v, hugeNight);
});
