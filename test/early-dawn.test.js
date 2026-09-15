import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { Simulation } from '../server/simulation.js';
import { createEnemy, nightIsCleared } from '../server/enemies.js';

function fixture() {
  const saved = new Map(), account = { id: 'defender', name: 'Defender', bank: 0 };
  const store = { loadVillages: () => [...saved.values()].map(v => structuredClone(v)), saveVillage: v => saved.set(v.id, structuredClone(v)), transaction: fn => fn(), account: () => account, initialWallet: () => 10 };
  const sim = new Simulation(store), { id } = sim.create('Dawnwatch', account);
  const player = sim.join(id, account, 'guard'), village = sim.villages.get(id); village.guards = [];
  const advance = seconds => { for (let i = 0; i < seconds * 20; i++) sim.tick(.05); };
  const enemy = (kind = 'shambler', x = 0, z = 40) => {
    const zombie = createEnemy(village, kind, { x, z, roadIndex: 3 }); zombie.emergeUntil = village.clock; village.zombies.push(zombie); return zombie;
  };
  return { sim, store, account, village, player, advance, enemy };
}

test('night never clears before the first spawn or between scheduled graveyard entries', () => {
  const f = fixture(), { sim, village } = f; sim.startNight(village);
  assert.equal(nightIsCleared(village), false); f.advance(1.5); assert.equal(village.phase, 'night');
  f.advance(.6); assert.equal(village.spawned, 1);
  village.zombies[0].hp = 0; f.advance(1);
  assert.equal(village.phase, 'night'); assert.equal(village.spawned, 1, 'the next grave entry is still due');
  village.spawned = village.waveCount - 1; assert.equal(nightIsCleared(village), false);
  village.spawned = village.waveCount; assert.equal(nightIsCleared(village), true);
  village.waveCount = 0; village.spawned = 0; assert.equal(nightIsCleared(village), false, 'an uninitialized wave cannot award dawn');
});

test('the final sword cleave starts dawn immediately and pays accrued wages, bonuses and one nightly grant', () => {
  const f = fixture(), { sim, store, account, village, player } = f;
  player.wageAccrued = 10.5; player.jobBonus = 3; player.repairBonus = 2;
  sim.startNight(village); village.spawned = village.waveCount;
  const a = f.enemy(), b = f.enemy('shambler', .8, 40);
  f.advance(2);
  Object.assign(a, { x: 0, z: 40, hp: 1 }); Object.assign(b, { x: .8, z: 40, hp: 1 });
  Object.assign(player, { x: 0, z: 38, yaw: 0, tool: 'sword' }); player.durability.sword = 5;
  const wallet = player.wallet, treasury = village.treasury, wage = Math.floor(player.wageAccrued);
  sim.action(village.id, player.id, { kind: 'attack' });
  assert.equal(village.phase, 'day'); assert.equal(village.day, 2); assert.equal(village.phaseRemaining, sim.daySeconds);
  assert.equal(player.wallet, wallet + wage + 3 + 2 + 2); assert.equal(player.durability.sword, 4);
  assert.equal(village.treasury, treasury + 1000 - wage - 2, 'only actual wage accrual is paid, with one hidden night grant');
  assert.equal(player.wageAccrued, 0); assert.equal(player.jobBonus, 0); assert.equal(player.repairBonus, 0);
  assert.equal(player.accountProgression.nights, 1, 'short night honors use actual observed participation');
  assert.deepEqual([village.spawned, village.waveCount, village.nextSpawn], [0, 0, 0]);
  assert.match(sim.notices.at(-1).message, /Dawn breaks early/); assert.doesNotMatch(sim.notices.at(-1).message, /gold|1000/);
  const paidWallet = player.wallet, paidTreasury = village.treasury;
  f.advance(1); sim.disconnect(village.id, player.id); sim.tick(100);
  const restart = new Simulation(store), restored = restart.villages.get(village.id); restart.join(village.id, account, 'guard'); restart.tick(.05);
  assert.equal(restored.day, 2); assert.equal(restored.players[player.id].wallet, paidWallet); assert.equal(restored.treasury, paidTreasury);
  assert.equal(restored.players[player.id].accountProgression.nights, 1); assert.equal(restart.finishClearedNight(restored), false);
});

test('guard cleaves and archer towers can finish a fully spawned night in the same server tick', () => {
  for (const mode of ['guard', 'tower']) {
    const f = fixture(), { sim, village, player } = f; sim.startNight(village); village.spawned = village.waveCount;
    const a = f.enemy('shambler', 0, 31), b = mode === 'guard' ? f.enemy('shambler', .7, 31.3) : null;
    a.hp = 1; if (b) b.hp = 1;
    if (mode === 'guard') village.guards = [{ id: 'cleaver', ownerId: player.id, x: 0, z: 29.5, yaw: 0, hp: 160, maxHp: 160, roadIndex: 3, cooldown: 0 }];
    else Object.assign(village.plots.find(p => p.id === 'outpost-1'), { ownerId: player.id, building: 'archer_tower', hp: 500, maxHp: 500, level: 1, storage: {} });
    const wallet = player.wallet; sim.tick(.05);
    assert.equal(village.phase, 'day', mode); assert.equal(village.day, 2); assert.equal(player.wallet, wallet + (b ? 2 : 1) - village.economy.lastTaxes);
    assert.equal(village.zombies.filter(z => z.hp > 0).length, 0);
    assert.equal(sim.notices.filter(n => /Dawn breaks early/.test(n.message)).length, 1);
  }
});

test('a final brood does not end the night while any emerging child or older remnant survives', () => {
  const f = fixture(), { sim, village, player } = f; sim.startNight(village); village.spawned = village.waveCount;
  const brood = f.enemy('splitter'), remnant = f.enemy('runner', 20, 103); brood.hp = 1;
  Object.assign(player, { x: 0, z: 38, yaw: 0, tool: 'sword' }); player.durability.sword = 10;
  sim.action(village.id, player.id, { kind: 'attack' }); assert.equal(village.phase, 'night');
  const children = village.zombies.filter(z => z.parentId === brood.id); assert.equal(children.length, 3);
  remnant.hp = 0; assert.equal(nightIsCleared(village), false);
  children[0].hp = children[1].hp = 0; assert.equal(nightIsCleared(village), false, 'one emerging offspring still prevents dawn');
  f.advance(.7); const final = children[2]; Object.assign(final, { x: 0, z: 40, hp: 1 });
  sim.action(village.id, player.id, { kind: 'attack' }); assert.equal(village.phase, 'day'); assert.equal(village.day, 2);
});

test('the regular night deadline still brings dawn with live stragglers and no subsequent duplicate reward', () => {
  const f = fixture(), { sim, village } = f; sim.startNight(village); village.spawned = village.waveCount;
  const remnant = f.enemy(); village.phaseRemaining = .1;
  f.advance(.15); assert.equal(village.phase, 'day'); assert.equal(village.day, 2); assert.ok(remnant.hp > 0);
  assert.match(sim.notices.find(n => /Dawn breaks/.test(n.message)).message, /Remaining zombies/);
  const treasury = village.treasury; remnant.hp = 0; f.advance(.1);
  assert.equal(village.day, 2); assert.equal(village.treasury, treasury); assert.equal(sim.notices.filter(n => /Dawn breaks/.test(n.message)).length, 1);
});

test('a failed final-kill dawn rolls the complete action back and a retry pays only once', () => {
  const f = fixture(), { sim, store, village, player } = f; sim.startNight(village); village.spawned = village.waveCount;
  f.enemy().hp = 1; Object.assign(player, { x: 0, z: 38, yaw: 0, tool: 'sword' }); player.durability.sword = 2;
  const before = structuredClone(village), notices = structuredClone(sim.notices), original = store.saveVillage;
  store.saveVillage = v => { if (v.phase === 'day') throw new Error('Dawn save failed'); original(v); };
  assert.throws(() => sim.action(village.id, player.id, { kind: 'attack' }), /Dawn save failed/);
  assert.deepEqual(village, before); assert.deepEqual(sim.notices, notices);
  store.saveVillage = original; sim.action(village.id, player.id, { kind: 'attack' });
  assert.equal(village.day, 2); assert.equal(player.durability.sword, 1); assert.equal(player.wallet, before.players[player.id].wallet + 1);
  assert.equal(sim.notices.filter(n => /Dawn breaks early/.test(n.message)).length, 1);
});

test('SQLite commits final kill, shortened-night honor and dawn payment together, including rollback and restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'emberwatch-early-dawn-')), store = new Store(directory);
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  const session = await store.authenticate('register', 'Early Defender', 'early-dawn-test-password'), account = store.account(session.playerId);
  const sim = new Simulation(store), { id } = sim.create('Early Watch', account), player = sim.join(id, account, 'guard'), village = sim.villages.get(id);
  village.guards = []; sim.startNight(village); village.spawned = village.waveCount;
  const target = createEnemy(village, 'shambler', { x: 0, z: 40 }); target.hp = 1; village.zombies.push(target);
  village.clock += 5; village.phaseRemaining -= 5; village.progression.watch.seconds[player.id] = 5;
  Object.assign(player, { x: 0, z: 38, yaw: 0, tool: 'sword' }); player.durability.sword = 2;
  store.saveVillage(village); const before = structuredClone(village), persisted = store.loadVillages(), original = store.saveVillage.bind(store);
  store.saveVillage = v => { if (v.phase === 'day') throw new Error('Dawn save failed'); original(v); };
  assert.throws(() => sim.action(id, player.id, { kind: 'attack' }), /Dawn save failed/);
  assert.deepEqual(village, before); assert.deepEqual(store.loadVillages(), persisted); assert.equal(store.progression(player.id).nights, 0);
  store.saveVillage = original; sim.action(id, player.id, { kind: 'attack' });
  assert.equal(store.progression(player.id).nights, 1); assert.equal(village.phase, 'day'); const paid = player.wallet, treasury = village.treasury;
  const restart = new Simulation(store); restart.join(id, account, 'guard'); restart.tick(.1); const restored = restart.villages.get(id);
  assert.equal(restored.day, 2); assert.equal(restored.players[player.id].wallet, paid); assert.equal(restored.treasury, treasury); assert.equal(store.progression(player.id).nights, 1);
});
