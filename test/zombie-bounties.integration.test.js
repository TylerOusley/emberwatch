import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { Simulation } from '../server/simulation.js';
import { createEnemy } from '../server/enemies.js';
import { careTick } from '../server/care-defense.js';
import { magicTick } from '../server/magic.js';
import { PLOTS } from '../shared/world.js';
import { LOANS } from '../shared/transport.js';

// Real SQLite accounts exercise the same income, debt and restart boundaries as
// production. Every fixture has its own temporary database and reserved village.
async function fixture(t, roles = ['villager', 'guard']) {
  const directory = await mkdtemp(join(tmpdir(), 'emberwatch-zombie-bounty-'));
  const f = { directory, store: new Store(directory), players: [] };
  t.after(async () => { f.store.close(); await rm(directory, { recursive: true, force: true }); });
  const accounts = [];
  for (const [index, role] of roles.entries()) {
    const session = await f.store.authenticate('register', `Bounty ${role} ${index}`, 'bounty-regression-password');
    accounts.push(f.store.account(session.playerId));
  }
  f.sim = new Simulation(f.store);
  const { id } = f.sim.create('Bounty Hearth', accounts[0]);
  f.v = f.sim.villages.get(id);
  for (const [index, account] of accounts.entries()) f.players.push(f.sim.join(id, account, roles[index]));
  f.v.guards = []; f.v.zombies = []; f.v.phase = 'night'; f.v.phaseRemaining = 10000;
  f.v.waveCount = 10000; f.v.spawned = 0; f.v.nextSpawn = 100000;
  for (const p of f.players) Object.assign(p, { wallet: 0, x: 0, z: 4 });
  f.enemy = (kind = 'shambler', x = 0, z = 40) => {
    const enemy = createEnemy(f.v, kind, { x, z, roadIndex: 3 });
    enemy.emergeUntil = f.v.clock; enemy.spawnAt = f.v.clock - 3; enemy.anim = 'walk';
    f.v.zombies.push(enemy);
    return enemy;
  };
  f.build = (building, owner, id = 'outpost-1', level = 1) => {
    const plot = f.v.plots.find(p => p.id === id);
    Object.assign(plot, { building, ownerId: owner.id, level, hp: 600, maxHp: 600,
      storage: { stone: 100, coal: 100, sulfur: 100, arrows: 100, musket_ammo: 100 } });
    return plot;
  };
  f.restart = () => {
    const ids = f.players.map(p => p.id);
    f.store.close(); f.store = new Store(directory); f.sim = new Simulation(f.store);
    f.v = f.sim.villages.get(id); f.players = ids.map(playerId => f.v.players[playerId]);
  };
  return f;
}

test('every enemy tier pays its full bounty to all six contributing roles without rewarding bystanders', async t => {
  const f = await fixture(t, ['villager', 'guard', 'priest', 'manager', 'tinker', 'wizard', 'villager']);
  let total = 0, count = 0;
  for (const [kind, bounty] of [['shambler', 100], ['runner', 100], ['splinter', 100], ['armored', 200], ['splitter', 200], ['siege', 1000]]) {
    const enemy = f.enemy(kind), treasury = f.v.treasury;
    // Saved/malformed reward fields cannot override the server's enemy table.
    enemy.reward = 999999; enemy.bounty = 1;
    for (const p of f.players.slice(0, 6)) f.sim.hitZombie(f.v, enemy, .01, p);
    assert.ok(enemy.hp > enemy.maxHp * .99, 'tiny positive assists remain eligible');
    assert.ok(f.players.slice(0, 6).every(p => p.wallet === total), 'bounties settle on death, not per hit');
    f.sim.hitZombie(f.v, enemy, 10000, f.players[0]); total += bounty; count++;
    assert.deepEqual(f.players.map(p => p.wallet), [total, total, total, total, total, total, 0], kind);
    assert.deepEqual(f.players[0].combatRewards, { kills: count, assists: 0, gold: total });
    for (const p of f.players.slice(1, 6)) assert.deepEqual(p.combatRewards, { kills: 0, assists: count, gold: total });
    assert.equal(f.v.treasury, treasury, 'the reward cannot consume village reserves');
    assert.equal(f.players[1].jobBonus, 0, 'the old capped Guard reward is replaced');
  }
});

test('same-night bounties exceed the former cap even with an empty treasury', async t => {
  const f = await fixture(t, ['priest']), p = f.players[0];
  f.v.treasury = 0; p.jobBonus = 25;
  for (let i = 0; i < 60; i++) f.sim.hitZombie(f.v, f.enemy(), 10000, p);
  assert.equal(p.wallet, 6000); assert.equal(p.jobBonus, 25); assert.equal(f.v.treasury, 0);
  assert.equal(f.v.phase, 'night');
});

test('invalid damage cannot create an assist and an unowned finisher pays every genuine contributor', async t => {
  const f = await fixture(t, ['wizard', 'manager', 'guard']);
  const [a, b, untouched] = f.players, enemy = f.enemy();
  for (const damage of [0, -1, NaN, Infinity]) f.sim.hitZombie(f.v, enemy, damage, untouched);
  f.sim.hitZombie(f.v, enemy, 1, a); f.sim.hitZombie(f.v, enemy, .01, b);
  f.sim.hitZombie(f.v, enemy, 10000, null);
  assert.deepEqual(f.players.map(p => p.wallet), [100, 100, 0]);
  f.sim.hitZombie(f.v, enemy, 10000, untouched);
  assert.deepEqual(f.players.map(p => p.wallet), [100, 100, 0], 'a late hit on a corpse does not count');
});

test('player, tower and recruited guard damage count once for their shared owner', async t => {
  const f = await fixture(t, ['tinker', 'guard']), [owner, finisher] = f.players;
  const tower = f.build('archer_tower', owner), site = PLOTS.find(p => p.id === tower.id);
  const enemy = f.enemy('siege', site.x, site.z + 8);
  f.sim.hitZombie(f.v, enemy, 1, owner);
  careTick(f.sim, f.v, .1);
  assert.ok(tower.lastShot, 'a real tower shot must contribute');
  const afterTower = enemy.hp;
  f.v.guards = [{ id: 'bounty-owner-sword', ownerId: owner.id, x: enemy.x, z: enemy.z - 1.5,
    yaw: 0, hp: 160, maxHp: 160, cooldown: 0, roadIndex: 3, unitType: 'sword', hungry: false }];
  f.sim.tickNpcs(f.v, .05);
  assert.ok(enemy.hp < afterTower, 'a real owned guard strike must contribute');
  f.sim.hitZombie(f.v, enemy, 10000, finisher);
  assert.equal(owner.wallet, 1000); assert.equal(finisher.wallet, 1000);
  assert.deepEqual(owner.combatRewards, { kills: 0, assists: 1, gold: 1000 });
});

for (const [building, level, count] of [['archer_tower', 1, 1], ['cannon', 1, 2], ['wizard_tower', 2, 3]]) {
  test(`${building} ${level === 2 ? 'lightning chains' : 'shots'} reward the offline owner for each defeated zombie`, async t => {
    const f = await fixture(t, ['manager', 'villager']), owner = f.players[0];
    const plot = f.build(building, owner, 'outpost-1', level), site = PLOTS.find(p => p.id === plot.id);
    const enemies = Array.from({ length: count }, (_, i) => {
      const z = f.enemy('armored', site.x, site.z + 8 + i * (building === 'cannon' ? 1 : 4)); z.hp = 1; return z;
    });
    f.sim.disconnect(f.v.id, owner.id);
    assert.equal(owner.online, false); assert.equal(f.players[1].online, true);
    f.sim.tick(.05);
    assert.ok(enemies.every(z => z.hp === 0)); assert.equal(owner.wallet, count * 200);
    assert.equal(f.players[1].wallet, 0, 'online bystanders do not inherit offline-owner rewards');
    f.restart(); assert.equal(f.players[0].wallet, count * 200, 'the payout survives immediate restart');
  });
}

for (const unitType of ['sword', 'archer', 'musketeer']) {
  test(`a real ${unitType} troop pays its offline owner rather than the active resident`, async t => {
    const f = await fixture(t, ['villager', 'guard']), owner = f.players[0];
    const barracks = f.build('barracks', owner, 'west-1');
    f.v.guards = [{ id: `bounty-${unitType}`, ownerId: owner.id, plotId: barracks.id, unitType,
      x: 0, z: 38, yaw: 0, hp: 160, maxHp: 160, cooldown: 0, roadIndex: 3, hungry: false }];
    const enemy = f.enemy('siege', 0, unitType === 'sword' ? 39.5 : 44); enemy.hp = 1;
    f.sim.disconnect(f.v.id, owner.id); f.sim.tick(.05);
    assert.equal(enemy.hp, 0); assert.equal(owner.wallet, 1000); assert.equal(f.players[1].wallet, 0);
  });
}

test('burn damage retains the offline Wizard assist when an unowned defender finishes the kill', async t => {
  const f = await fixture(t, ['wizard', 'guard']), wizard = f.players[0], enemy = f.enemy();
  Object.assign(wizard, { x: 0, z: 37, yaw: 0, tool: 'staff' });
  f.sim.action(f.v.id, wizard.id, { kind: 'attack' });
  assert.equal(enemy.magicBurnOwnerId, wizard.id);
  f.sim.disconnect(f.v.id, wizard.id);
  const beforeBurn = enemy.hp; f.v.clock += 1; magicTick(f.sim, f.v, 1);
  assert.ok(enemy.hp < beforeBurn, 'fire continues doing attributed damage after disconnect');
  f.sim.hitZombie(f.v, enemy, 10000, null);
  assert.equal(wizard.wallet, 100); assert.equal(f.players[1].wallet, 0);
});

test('daytime remnants still pay a downed contributor when a village-owned defender finishes them', async t => {
  const f = await fixture(t, ['manager', 'guard']), [assistant, bystander] = f.players, enemy = f.enemy();
  f.sim.hitZombie(f.v, enemy, 1, assistant);
  Object.assign(assistant, { hp: 0, downed: true }); f.v.phase = 'day';
  enemy.hp = 1;
  f.v.guards = [{ id: 'unowned-watch-0', x: 0, z: 38.5, yaw: 0, hp: 160, maxHp: 160,
    cooldown: 0, roadIndex: 3, hungry: false }];
  f.sim.tickNpcs(f.v, .05);
  assert.equal(enemy.hp, 0); assert.equal(assistant.wallet, 100); assert.equal(bystander.wallet, 0);
  assert.deepEqual(assistant.combatRewards, { kills: 0, assists: 1, gold: 100 });
});

test('living enemy contributions survive SQLite restart and dead enemy callbacks cannot pay again', async t => {
  const f = await fixture(t, ['tinker', 'wizard']), [assistant, finisher] = f.players, enemy = f.enemy();
  const enemyId = enemy.id;
  f.sim.hitZombie(f.v, enemy, 1, assistant); f.sim.saveAll(); f.restart();
  const restored = f.v.zombies.find(z => z.id === enemyId);
  assert.equal(restored.hp, enemy.maxHp - 1);
  f.sim.join(f.v.id, f.store.account(finisher.id), 'wizard');
  f.sim.hitZombie(f.v, restored, 10000, f.players[1]);
  assert.deepEqual(f.players.map(p => p.wallet), [100, 100]);
  f.sim.hitZombie(f.v, restored, 10000, f.players[1]);
  f.restart(); const dead = f.v.zombies.find(z => z.id === enemyId);
  assert.ok(dead && dead.hp === 0, 'death and payout were saved together');
  f.sim.hitZombie(f.v, dead, 10000, f.players[0]);
  assert.deepEqual(f.players.map(p => p.wallet), [100, 100]);
});

test('a brood and its offspring award separate bounties without inheriting parent assists', async t => {
  const f = await fixture(t, ['priest', 'guard']), [assistant, finisher] = f.players, parent = f.enemy('splitter');
  f.sim.hitZombie(f.v, parent, 1, assistant); f.sim.hitZombie(f.v, parent, 10000, finisher);
  const children = f.v.zombies.filter(z => z.parentId === parent.id);
  assert.equal(children.length, 3); assert.deepEqual(f.players.map(p => p.wallet), [200, 200]);
  for (const child of children) { f.sim.hitZombie(f.v, child, 10000, finisher); f.sim.hitZombie(f.v, child, 10000, finisher); }
  f.sim.hitZombie(f.v, parent, 10000, assistant);
  assert.deepEqual(f.players.map(p => p.wallet), [200, 500]);
  assert.equal(f.v.zombies.filter(z => z.parentId === parent.id).length, 3);
});

test('100 gold bounties use the existing loan repayment path and persist the net wallet', async t => {
  const f = await fixture(t, ['manager']), owner = f.players[0];
  f.store.issueCredit(owner.id, 200); const treasury = f.v.treasury;
  f.sim.hitZombie(f.v, f.enemy(), 10000, owner);
  const repayment = LOANS.repaymentPercent;
  assert.equal(owner.wallet, 100 - repayment); assert.equal(f.store.account(owner.id).debt, 200 - repayment);
  assert.equal(f.v.treasury, treasury + repayment, 'only debt repayments enter the treasury');
  assert.equal(owner.combatRewards.gold, 100, 'the reward display records gross income before loan repayment');
  f.restart(); assert.equal(f.players[0].wallet, 100 - repayment); assert.equal(f.store.account(owner.id).debt, 200 - repayment);
});

test('failed lethal-save rolls back every recipient, loan payment, death and brood split before a safe retry', async t => {
  const f = await fixture(t, ['guard', 'priest']), [assistant, finisher] = f.players, parent = f.enemy('splitter');
  for (const p of f.players) f.store.issueCredit(p.id, 200);
  f.sim.hitZombie(f.v, parent, 1, assistant); f.sim.saveAll();
  const checkpoint = structuredClone(f.v), accounts = f.players.map(p => f.store.account(p.id));
  const savedBefore = f.store.loadVillages(), saveVillage = f.store.saveVillage.bind(f.store);
  f.store.saveVillage = village => { saveVillage(village); throw new Error('Injected bounty-save failure'); };
  assert.throws(() => f.sim.hitZombie(f.v, parent, 10000, finisher), /Injected bounty-save failure/);
  assert.deepEqual(f.v, checkpoint); assert.deepEqual(f.players.map(p => f.store.account(p.id)), accounts);
  assert.deepEqual(f.store.loadVillages(), savedBefore, 'the SQLite write and repayments roll back together');
  f.store.saveVillage = saveVillage;
  f.sim.hitZombie(f.v, parent, 10000, finisher);
  assert.deepEqual(f.players.map(p => p.wallet), [200 - 2 * LOANS.repaymentPercent, 200 - 2 * LOANS.repaymentPercent]);
  assert.equal(f.v.zombies.filter(z => z.parentId === parent.id).length, 3);
});

test('a failed real attack save rolls back its tool use and all bounties, including nested SQLite debt payments', async t => {
  const f = await fixture(t, ['guard']), p = f.players[0], enemy = f.enemy(); enemy.hp = 1;
  Object.assign(p, { x: 0, z: 38, yaw: 0, tool: 'sword' }); p.durability.sword = 5;
  f.store.issueCredit(p.id, 200); f.sim.saveAll();
  const checkpoint = structuredClone(f.v), account = f.store.account(p.id), saveVillage = f.store.saveVillage.bind(f.store);
  let saves = 0;
  f.store.saveVillage = village => { saveVillage(village); if (++saves === 2) throw new Error('Injected outer attack-save failure'); };
  assert.throws(() => f.sim.action(f.v.id, p.id, { kind: 'attack' }), /Injected outer attack-save failure/);
  assert.deepEqual(f.v, checkpoint); assert.deepEqual(f.store.account(p.id), account);
  f.store.saveVillage = saveVillage;
  f.sim.action(f.v.id, p.id, { kind: 'attack' });
  assert.equal(p.wallet, 100 - LOANS.repaymentPercent); assert.equal(p.durability.sword, 4);
});

test('a bounty that would overflow a wallet rolls back the kill and all other recipients', async t => {
  const f = await fixture(t, ['guard', 'priest']), [assistant, finisher] = f.players, enemy = f.enemy('siege');
  assistant.wallet = Number.MAX_SAFE_INTEGER - 999;
  f.sim.hitZombie(f.v, enemy, 1, assistant); f.sim.saveAll();
  const before = structuredClone(f.v), saved = f.store.loadVillages();
  assert.throws(() => f.sim.hitZombie(f.v, enemy, 10000, finisher), /supported gold balance/);
  assert.deepEqual(f.v, before); assert.deepEqual(f.store.loadVillages(), saved);
});
