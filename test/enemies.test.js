import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../server/simulation.js';
import { createEnemy, ensureEnemies, spawnWaveEnemy, splitEnemy } from '../server/enemies.js';
import { ENEMY_TYPES, ENEMY_LIMITS, ZOMBIE_BOUNTY_GOLD, LARGE_ZOMBIE_BOUNTY_GOLD, enemyBountyGold, enemyForWave, enemySpawnInterval, enemyStats, emergenceProgress } from '../shared/enemies.js';
import { ROAD, PLOTS, plotSolid, canStand, plotSolids } from '../shared/world.js';

function fixture() {
  const saved = new Map(), account = { id: 'defender', name: 'Defender', bank: 0 };
  const store = { loadVillages: () => [...saved.values()].map(v => structuredClone(v)), saveVillage: v => saved.set(v.id, structuredClone(v)), transaction: fn => fn(), account: () => account, initialWallet: () => 10 };
  const sim = new Simulation(store), { id } = sim.create('Gravewatch', account);
  const player = sim.join(id, account, 'guard'), village = sim.villages.get(id);
  village.guards = []; village.phaseRemaining = 10000;
  return { sim, store, account, village, player };
}
function ready(village, kind, x = 0, z = 40, roadIndex = 3) {
  const enemy = createEnemy(village, kind, { x, z, roadIndex });
  enemy.spawnAt = village.clock - ENEMY_LIMITS.graveEmergence; enemy.emergeUntil = village.clock; enemy.anim = 'walk';
  village.zombies.push(enemy);
  return enemy;
}

test('night mix introduces quick runners, broods and armor, with exactly one fifth-night siege', () => {
  assert.equal(enemyForWave(1, 2), 'runner');
  assert.equal(enemyForWave(2, 4), 'splitter');
  assert.equal(enemyForWave(3, 5), 'armored');
  for (const day of [1, 4, 5, 6, 10, 15, 20, 25, 30, 40, 50, 100]) {
    const kinds = Array.from({ length: 80 }, (_, i) => enemyForWave(day, i));
    assert.equal(kinds.filter(k => k === 'siege').length, day % 5 === 0 ? 1 : 0);
    assert.ok(!kinds.includes('splinter'), 'weak offspring can only come from a slain brood');
  }
  const one = fixture(), eight = fixture();
  for (let i = 1; i < 8; i++) eight.village.players[`p${i}`] = { online: true };
  one.village.day = eight.village.day = 5; one.sim.startNight(one.village); eight.sim.startNight(eight.village);
  assert.ok(eight.village.waveCount > one.village.waveCount);
  assert.ok(enemyStats('siege', 0, 8).maxHp > enemyStats('siege', 0, 1).maxHp);
  assert.ok(enemyStats('runner', 1).maxHp > enemyStats('runner', 0).maxHp);
  assert.ok(one.village.siegeNight); assert.match(one.sim.notices.at(-1).message, /Gravebreaker/);
});

test('the first twenty nights retain their existing enemy sequence and spawn intervals exactly', () => {
  const previousKind = (day, index) => day % 5 === 0 && index === 0 ? 'siege'
    : day >= 3 && index % 7 === 5 ? 'armored' : day >= 2 && index % 7 === 4 ? 'splitter'
      : index % 4 === 2 ? 'runner' : 'shambler';
  for (let day = 1; day <= 20; day++) {
    for (let index = 0; index < 80; index++) assert.equal(enemyForWave(day, index), previousKind(day, index), `night ${day}, slot ${index}`);
    assert.equal(enemySpawnInterval(day), Math.max(1.5, 6 - Math.floor((day - 1) / 5) * .4), `night ${day}`);
  }
});

test('late waves add runners at night twenty-one and armor at thirty-one while retaining brood and siege slots', () => {
  const counts = day => Array.from({ length: 28 }, (_, index) => enemyForWave(day, index))
    .reduce((all, kind) => ({ ...all, [kind]: (all[kind] ?? 0) + 1 }), {});
  assert.deepEqual(counts(19), { shambler: 15, runner: 5, splitter: 4, armored: 4 });
  assert.deepEqual(counts(21), { shambler: 12, runner: 8, splitter: 4, armored: 4 });
  assert.deepEqual(counts(31), { shambler: 9, runner: 7, armored: 8, splitter: 4 });
  assert.equal(enemyForWave(20, 1), 'shambler'); assert.equal(enemyForWave(21, 1), 'runner');
  assert.equal(enemyForWave(30, 3), 'shambler'); assert.equal(enemyForWave(31, 3), 'armored');
  for (const day of [21, 25, 30, 31, 40, 41, 60, 100]) {
    for (let index = 4; index < 80; index += 7) assert.equal(enemyForWave(day, index), 'splitter');
    assert.equal(Array.from({ length: 80 }, (_, index) => enemyForWave(day, index)).filter(kind => kind === 'siege').length, day % 5 === 0 ? 1 : 0);
  }
});

test('late spawn pressure changes only at its night boundaries and never crosses the population-safe cadence floor', () => {
  for (const [day, seconds] of [[20, 4.8], [21, 3.96], [30, 3.6], [31, 3.24], [40, 2.88], [41, 2.24], [46, 1.92], [51, 1.6], [56, 1.5], [100, 1.5]]) {
    assert.ok(Math.abs(enemySpawnInterval(day) - seconds) < 1e-8, `night ${day}`);
  }
  for (let day = 1; day <= 1000; day++) {
    assert.ok(enemySpawnInterval(day) >= 1.5);
    if (day > 1) assert.ok(enemySpawnInterval(day) <= enemySpawnInterval(day - 1));
  }
});

test('real late waves retain population sizing and spawn the new mix with unchanged per-enemy combat stats', () => {
  for (const day of [20, 21, 30, 31, 40, 41, 100]) {
    const { sim, village } = fixture(); village.day = day;
    for (let i = 1; i < 4; i++) village.players[`p${i}`] = { online: true };
    sim.startNight(village);
    const band = Math.floor((day - 1) / 5);
    assert.equal(village.waveCount, Math.min(80, 5 + 4 * 3 + band * 5));
    while (village.spawned < village.waveCount) {
      village.clock = village.nextSpawn; const previousClock = village.clock, index = village.spawned;
      assert.equal(spawnWaveEnemy(village), true);
      const enemy = village.zombies.at(-1), stats = enemyStats(enemyForWave(day, index), band, 4);
      assert.equal(enemy.kind, enemyForWave(day, index)); assert.equal(enemy.hp, stats.maxHp);
      assert.equal(enemy.damage, stats.damage); assert.equal(enemy.structureDamage, stats.structureDamage);
      assert.equal(enemy.speed, stats.speed); assert.equal(enemy.armor, stats.armor);
      assert.ok(Math.abs(village.nextSpawn - previousClock - enemySpawnInterval(day)) < 1e-8);
      assert.ok(village.zombies.length <= ENEMY_LIMITS.active);
    }
  }
});

test('a crowded late battlefield still delays a wave slot and resumes its exact kind once space opens', () => {
  const { sim, village } = fixture(); village.day = 41; sim.startNight(village); village.spawned = 1;
  for (let i = 0; i < ENEMY_LIMITS.active - ENEMY_LIMITS.splitCount; i++) ready(village, 'shambler');
  const due = village.nextSpawn;
  assert.equal(spawnWaveEnemy(village), false); assert.equal(village.spawned, 1); assert.equal(village.nextSpawn, due);
  village.zombies[0].hp = 0;
  assert.equal(spawnWaveEnemy(village), true); assert.equal(village.spawned, 2);
  assert.equal(village.zombies.at(-1).kind, 'runner');
  assert.equal(village.zombies.filter(enemy => enemy.hp > 0).length, ENEMY_LIMITS.active - ENEMY_LIMITS.splitCount);
});

test('graveyard enemies rise for their full authoritative duration without movement or attacks', () => {
  const { sim, village, player } = fixture();
  sim.startNight(village); sim.tick(2);
  const zombie = village.zombies[0], origin = { x: zombie.x, z: zombie.z };
  assert.equal(zombie.birth, 'grave'); assert.equal(zombie.anim, 'emerge');
  assert.ok(Math.hypot(zombie.x - ROAD[0].x, zombie.z - ROAD[0].z) < 3);
  Object.assign(player, { x: zombie.x, z: zombie.z + 1 });
  const hp = player.hp, shield = player.shield;
  sim.tick(2);
  assert.deepEqual({ x: zombie.x, z: zombie.z }, origin); assert.equal(player.hp, hp); assert.equal(player.shield, shield);
  assert.ok(emergenceProgress(zombie, village.clock) < 1);
  sim.tick(.25);
  assert.equal(zombie.anim, 'windup'); assert.equal(player.shield, shield);
  sim.tick(.81); assert.equal(zombie.anim, 'attack'); assert.ok(player.shield < shield);
  const publicEnemy = sim.snapshot(village, player.id).zombies[0];
  assert.equal(publicEnemy.spawnAt, zombie.spawnAt); assert.equal(publicEnemy.emergeUntil, zombie.emergeUntil); assert.equal(publicEnemy.kind, zombie.kind);
  assert.equal(publicEnemy.contributors, undefined);
});

test('runners are faster and fragile while armored enemies reduce actual damage and earned contribution', () => {
  const { sim, village, player } = fixture();
  const runner = ready(village, 'runner', -1, 75, 2), shambler = ready(village, 'shambler', 1, 75, 2);
  const before = [runner.z, shambler.z]; sim.tick(.3);
  assert.ok(before[0] - runner.z > before[1] - shambler.z); assert.ok(runner.hp < shambler.hp);
  const armored = ready(village, 'armored');
  sim.hitZombie(village, armored, 20, player);
  assert.equal(armored.maxHp - armored.hp, 13); assert.equal(armored.contributors[player.id], 13);
  sim.hitZombie(village, armored, 10000, player);
  assert.equal(player.combatRewards.gold, LARGE_ZOMBIE_BOUNTY_GOLD);
  sim.hitZombie(village, armored, 10000, player); assert.equal(player.combatRewards.gold, LARGE_ZOMBIE_BOUNTY_GOLD);
});

test('a slain brood bursts into exactly three weak children once with independent credit and no recursive split', () => {
  const { sim, village, player } = fixture();
  const parent = ready(village, 'splitter', 0, 19.1, 4), treasury = village.treasury;
  sim.hitZombie(village, parent, 10000, player);
  const children = village.zombies.filter(z => z.parentId === parent.id);
  assert.equal(children.length, 3); assert.equal(parent.splitDone, true);
  assert.equal(player.combatRewards.gold, LARGE_ZOMBIE_BOUNTY_GOLD); assert.equal(village.treasury, treasury);
  for (const child of children) {
    assert.equal(child.kind, 'splinter'); assert.equal(child.birth, 'split'); assert.equal(child.anim, 'burst'); assert.equal(child.roadIndex, 4);
    assert.ok(child.z >= 18, 'a brood cannot spawn through the intact gate');
    assert.ok(Math.hypot(child.x - parent.x, child.z - parent.z) <= 1);
    assert.ok(child.hp < 25); assert.equal(child.contributors, undefined);
    assert.ok(canStand(child.x, child.z, .35, plotSolids(village.plots)));
  }
  const gate = village.gate.hp;
  sim.tick(.6); assert.equal(village.gate.hp, gate, 'burst children settle before attacking');
  sim.tick(.1); assert.equal(village.gate.hp, gate, 'even weak offspring warn before striking');
  sim.tick(.66); assert.ok(village.gate.hp < gate);
  sim.hitZombie(village, parent, 10000, player); splitEnemy(village, parent);
  assert.equal(village.zombies.filter(z => z.parentId === parent.id).length, 3);
  for (const child of children) { sim.hitZombie(village, child, 100, player); sim.hitZombie(village, child, 100, player); }
  assert.equal(player.combatRewards.gold, LARGE_ZOMBIE_BOUNTY_GOLD + 3 * ZOMBIE_BOUNTY_GOLD); assert.equal(village.zombies.filter(z => z.hp > 0).length, 0);
});

test('cannon splash splits a brood only once, spends one shot and credits its guard owner', () => {
  const { sim, village, player } = fixture(), site = PLOTS.find(p => p.id === 'outpost-1');
  const plot = village.plots.find(p => p.id === site.id);
  Object.assign(plot, { ownerId: player.id, building: 'cannon', hp: 500, maxHp: 500, level: 1, storage: { stone: 4, coal: 2 } });
  const parent = ready(village, 'splitter', 0, 31); parent.hp = 1;
  sim.tick(.05);
  assert.equal(parent.hp, 0); assert.equal(village.zombies.filter(z => z.parentId === parent.id).length, 3);
  assert.equal(player.combatRewards.gold, LARGE_ZOMBIE_BOUNTY_GOLD); assert.equal(plot.storage.coal, 1);
  assert.ok(village.zombies.filter(z => z.parentId === parent.id).every(z => z.hp > 0), 'children cannot be hit by a splash iteration captured before their birth');
});

test('population is bounded and delayed wave slots are not consumed by a crowded battlefield', () => {
  const { village } = fixture();
  const parent = ready(village, 'splitter');
  for (let i = 0; i < 119; i++) ready(village, 'shambler');
  const spawned = village.spawned;
  assert.equal(spawnWaveEnemy(village), false); assert.equal(village.spawned, spawned);
  parent.hp = 0; splitEnemy(village, parent);
  assert.equal(village.zombies.filter(z => z.hp > 0).length, ENEMY_LIMITS.active);
  for (const z of village.zombies) if (z.kind === 'shambler') z.hp = 0;
  splitEnemy(village, parent); assert.equal(village.zombies.filter(z => z.parentId === parent.id).length, 1, 'a capped brood cannot be retriggered later');
  assert.equal(spawnWaveEnemy(village), true); assert.equal(village.spawned, spawned + 1);
});

test('siege strikes telegraph a fixed circle and never harm dwarfs across a closed gate', () => {
  const { sim, village, player } = fixture();
  const brute = ready(village, 'siege', 0, 20, 4), gate = village.gate.hp;
  Object.assign(player, { x: 0, z: 17.5 });
  sim.tick(.05);
  assert.equal(brute.anim, 'windup'); assert.equal(brute.windupTarget, 'gate'); assert.equal(brute.windupX, 0); assert.equal(brute.windupZ, 18);
  assert.equal(village.gate.hp, gate); sim.tick(1.5); assert.equal(village.gate.hp, gate);
  const start = brute.windupStartedAt, shield = player.shield;
  sim.tick(.16); assert.equal(village.gate.hp, gate - ENEMY_TYPES.siege.structureDamage); assert.equal(player.shield, shield);
  assert.ok(brute.lastSlamAt > start); assert.equal(brute.lastSlamTarget, 'gate'); assert.equal(brute.windupUntil, null);
  const once = village.gate.hp; sim.tick(.1); assert.equal(village.gate.hp, once, 'cooldown prevents repeated slam damage');
});

test('siege uses the same timed strike for an outer tower and a breached keep', () => {
  const { sim, village } = fixture();
  const site = PLOTS.find(p => p.id === 'outpost-1'), plot = village.plots.find(p => p.id === site.id);
  Object.assign(plot, { ownerId: 'owner', building: 'archer_tower', hp: 60, maxHp: 400, storage: {} });
  const brute = ready(village, 'siege', site.x + plotSolid(site, plot.building).w / 2 + .8, site.z);
  sim.tick(.05); assert.equal(brute.windupTarget, site.id); assert.equal(plot.hp, 60);
  sim.tick(1.66); assert.equal(plot.hp, 0); assert.equal(brute.lastSlamTarget, site.id);
  Object.assign(brute, { x: 0, z: -34, cooldown: 0, roadIndex: 5 }); village.gate.hp = 0; village.keep.hp = 70;
  sim.tick(.05); assert.equal(brute.windupTarget, 'keep'); assert.equal(village.status, 'active');
  sim.tick(1.66); assert.equal(village.keep.hp, 0); assert.equal(village.status, 'fallen');
});

test('emergence and siege windup survive save/rejoin and pause with no online players', () => {
  const { sim, store, account, village, player } = fixture();
  const rising = createEnemy(village, 'runner'); village.zombies.push(rising);
  const brute = ready(village, 'siege', 0, 20, 4); sim.tick(.3);
  const deadline = brute.windupUntil, progress = emergenceProgress(rising, village.clock), clock = village.clock;
  sim.disconnect(village.id, player.id); sim.tick(100);
  assert.equal(village.clock, clock); assert.equal(brute.windupUntil, deadline); assert.equal(emergenceProgress(rising, village.clock), progress);
  const restart = new Simulation(store), restored = restart.villages.get(village.id);
  restart.tick(100); assert.equal(restored.clock, clock);
  restart.join(village.id, account, 'guard');
  assert.equal(restored.zombies.find(z => z.id === brute.id).windupUntil, deadline);
  assert.equal(restored.zombies.find(z => z.id === rising.id).emergeUntil, rising.emergeUntil);
  const hp = restored.gate.hp; restart.tick(1.7); assert.equal(restored.gate.hp, hp - ENEMY_TYPES.siege.structureDamage);
});

test('dawn retains existing enemies and brood births but stops new graveyard waves', () => {
  const { sim, village, player } = fixture();
  village.day = 5; sim.startNight(village); const parent = ready(village, 'splitter');
  sim.dawn(village); assert.equal(village.siegeNight, false);
  const spawned = village.spawned;
  sim.hitZombie(village, parent, 10000, player); sim.tick(.1);
  assert.equal(village.spawned, spawned); assert.equal(village.zombies.filter(z => z.kind === 'splinter').length, 3);
  assert.equal(village.day, 6); assert.equal(village.phase, 'day');
});

test('legacy saves migrate idempotently without restoring health, moving enemies or restarting emergence', () => {
  const { village } = fixture();
  const legacy = { id: 'old-elite', x: 0, z: 31, hp: 17, maxHp: 140, elite: true, roadIndex: 4, speed: 1.83, anim: 'attack', cooldown: .5 };
  village.clock = 88; village.zombies = [legacy];
  const treasury = village.treasury;
  ensureEnemies(village); const migrated = structuredClone(village); ensureEnemies(village);
  assert.deepEqual(village, migrated); assert.equal(legacy.hp, 17); assert.equal(legacy.maxHp, 140); assert.equal(legacy.z, 31);
  assert.equal(legacy.kind, 'armored'); assert.equal(legacy.armor, 0); assert.equal(legacy.emergeUntil, 88);
  assert.equal(emergenceProgress(legacy, 88), 1); assert.equal(village.treasury, treasury);
});

test('player sword cleaves the full forward arc once while excluding rear, distant and blocked enemies', () => {
  const { sim, village, player } = fixture();
  village.phase = 'night'; village.waveCount = 0;
  Object.assign(player, { x: 0, z: 38, yaw: 0, tool: 'sword' }); player.durability.sword = 5;
  const a = ready(village, 'shambler', -.6, 40), b = ready(village, 'shambler', .7, 40);
  const behind = ready(village, 'shambler', 0, 36), side = ready(village, 'shambler', 3, 39), far = ready(village, 'shambler', 0, 42);
  a.hp = b.hp = 1;
  sim.action(village.id, player.id, { kind: 'attack' });
  assert.equal(a.hp, 0); assert.equal(b.hp, 0); assert.equal(player.combatRewards.gold, 2 * ZOMBIE_BOUNTY_GOLD); assert.equal(player.durability.sword, 4);
  for (const enemy of [behind, side, far]) assert.equal(enemy.hp, enemy.maxHp);
  assert.throws(() => sim.action(village.id, player.id, { kind: 'attack' }), /next action/); assert.equal(player.durability.sword, 4);
  village.clock += 1; Object.assign(player, { x: 0, z: 17, yaw: 0 });
  const outsideGate = ready(village, 'shambler', 0, 19), insideGate = ready(village, 'shambler', 0, 17.8);
  sim.action(village.id, player.id, { kind: 'attack' });
  assert.equal(outsideGate.hp, outsideGate.maxHp); assert.ok(insideGate.hp < insideGate.maxHp); assert.equal(player.durability.sword, 3);
  village.clock += 1; Object.assign(player, { x: -10, z: 8, yaw: -Math.PI / 2 });
  const wall = ready(village, 'shambler', -13.1, 8), open = ready(village, 'shambler', -11.7, 9);
  sim.action(village.id, player.id, { kind: 'attack' });
  assert.equal(wall.hp, wall.maxHp, 'a shop wall blocks the swept sword'); assert.ok(open.hp < open.maxHp);
});

test('guard troops cleave multiple enemies with one cooldown and bow shots stay single-target', () => {
  const { sim, village, player } = fixture();
  village.phase = 'night'; village.waveCount = 0;
  const guard = { id: 'troop-cleave', ownerId: player.id, x: 0, z: 37.5, yaw: 0, hp: 160, maxHp: 160, anim: 'idle', roadIndex: 3, cooldown: 0, hungry: false };
  village.guards = [guard];
  const a = ready(village, 'shambler', -.2, 39), b = ready(village, 'shambler', .8, 39.4), rear = ready(village, 'shambler', 0, 35.1);
  a.hp = b.hp = 1; sim.tick(.05);
  assert.equal(a.hp, 0); assert.equal(b.hp, 0); assert.equal(rear.hp, rear.maxHp); assert.equal(player.combatRewards.gold, 2 * ZOMBIE_BOUNTY_GOLD); assert.equal(guard.cooldown, 1.05);
  sim.tick(.05); assert.equal(rear.hp, rear.maxHp, 'turning toward another target does not reset a sword cooldown');
  village.guards = []; village.zombies = [];
  Object.assign(player, { x: 0, z: 38, yaw: 0, tool: 'bow' }); player.inventory.bow = 1; player.inventory.arrows = 3; player.durability.bow = 5;
  const close = ready(village, 'shambler', 0, 41), next = ready(village, 'shambler', .5, 42);
  sim.action(village.id, player.id, { kind: 'attack' });
  assert.ok(close.hp < close.maxHp); assert.equal(next.hp, next.maxHp); assert.equal(player.inventory.arrows, 2); assert.equal(player.durability.bow, 4);
});

test('guard swing animation marks real strikes and rests between attack windows', () => {
  const { sim, village, player } = fixture();
  const guard = { id: 'swing-clock', ownerId: player.id, x: 0, z: 38, yaw: 0, hp: 160, maxHp: 160, roadIndex: 3, cooldown: 0 };
  village.guards = [guard]; const target = ready(village, 'shambler', 0, 39.5); target.hp = target.maxHp = 1000;
  sim.tick(.05); assert.equal(guard.anim, 'attack'); assert.equal(target.hp, 986);
  sim.tick(.4); assert.equal(guard.anim, 'attack'); assert.equal(target.hp, 986);
  sim.tick(.1); assert.equal(guard.anim, 'idle'); assert.equal(target.hp, 986, 'the cooldown has no phantom sword swings');
  sim.tick(.6); assert.equal(guard.anim, 'attack'); assert.equal(target.hp, 972);
});

test('a sword that kills a brood cannot also strike its newly created offspring in the same swing', () => {
  const { sim, village, player } = fixture();
  Object.assign(player, { x: 0, z: 38, yaw: 0, tool: 'sword' }); player.durability.sword = 1;
  const brood = ready(village, 'splitter', 0, 40); brood.hp = 1;
  sim.action(village.id, player.id, { kind: 'attack' });
  const children = village.zombies.filter(z => z.parentId === brood.id);
  assert.equal(children.length, 3); assert.ok(children.every(z => z.hp === z.maxHp)); assert.equal(player.combatRewards.gold, LARGE_ZOMBIE_BOUNTY_GOLD); assert.equal(player.durability.sword, 0);
  village.clock += 1; assert.throws(() => sim.action(village.id, player.id, { kind: 'attack' }), /broken/);
});

test('every zombie attack has a fixed, readable ground warning and can be dodged', () => {
  for (const kind of Object.keys(ENEMY_TYPES)) {
    const { sim, village, player } = fixture(); player.role = 'villager';
    Object.assign(player, { x: 0, z: 41 }); const zombie = ready(village, kind, 0, 40);
    sim.tick(.05);
    const { windupX, windupZ, windupUntil, windupStartedAt, windupRadius } = zombie;
    assert.equal(zombie.anim, 'windup', kind); assert.equal(zombie.windupKind, 'ground'); assert.equal(windupX, 0); assert.equal(windupZ, 41);
    assert.ok(windupUntil - windupStartedAt >= .65 - 1e-8, kind); assert.equal(windupRadius, ENEMY_TYPES[kind].radius);
    const hp = player.hp; sim.tick((windupUntil - village.clock) * .5); assert.equal(player.hp, hp);
    player.x = windupRadius + .1;
    assert.equal(zombie.windupX, windupX); assert.equal(zombie.windupZ, windupZ);
    sim.tick(windupUntil - village.clock + .01);
    assert.equal(player.hp, hp, `${kind} must miss a dwarf outside its warning`); assert.equal(zombie.windupUntil, null);
    assert.equal(zombie.lastSlamX, windupX); assert.equal(zombie.lastSlamZ, windupZ); assert.equal(zombie.lastSlamRadius, windupRadius);
  }
});

test('a heavy slam damages all defenders actually in its circle, including late arrivals, once', () => {
  const { sim, village, player, account } = fixture();
  player.role = 'villager'; Object.assign(player, { x: 0, z: 41 });
  const other = sim.join(village.id, { ...account, id: 'friend', name: 'Friend' }, 'villager'); Object.assign(other, { x: 9, z: 41 });
  const brute = ready(village, 'siege', 0, 40); sim.tick(.05);
  const radius = brute.windupRadius;
  Object.assign(other, { x: radius - .05, z: 41 });
  const guard = { id: 'witness', x: -.5, z: 41, yaw: 0, hp: 160, maxHp: 160, roadIndex: 0, cooldown: 100 }; village.guards = [guard];
  const hp = player.hp, otherHp = other.hp;
  sim.tick(brute.windupUntil - village.clock + .01);
  assert.equal(player.hp, hp - brute.damage); assert.equal(other.hp, otherHp - brute.damage); assert.equal(guard.hp, 160 - brute.damage);
  const after = player.hp; sim.tick(.1); assert.equal(player.hp, after, 'one impact cannot damage twice');
});

test('windup damage respects obstacles at impact and death cancels every pending attack', () => {
  const { sim, village, player } = fixture(); player.role = 'villager'; Object.assign(player, { x: 0, z: 19.5 });
  const brute = ready(village, 'siege', 0, 20.5); sim.tick(.05);
  const hp = player.hp; Object.assign(player, { x: 0, z: 17.5 });
  assert.ok(Math.hypot(player.x - brute.windupX, player.z - brute.windupZ) < brute.windupRadius);
  sim.tick(brute.windupUntil - village.clock + .01); assert.equal(player.hp, hp, 'the intact gate blocks damage inside the projected circle');
  Object.assign(player, { x: 0, z: 41 }); village.zombies = [];
  const next = ready(village, 'splitter', 0, 40); sim.tick(.05); const due = next.windupUntil;
  sim.hitZombie(village, next, 10000, player); assert.equal(next.windupUntil, null);
  // Remove the children from this casualty-only check; their own warning
  // attacks are covered above and are separate from the cancelled parent.
  village.zombies = [next]; sim.tick(due - village.clock + .1); assert.equal(player.hp, hp);
});

test('failed sword persistence rolls back damage, brood births, durability and bounty together', () => {
  const { sim, store, village, player } = fixture();
  Object.assign(player, { x: 0, z: 38, yaw: 0, tool: 'sword' }); player.durability.sword = 3;
  ready(village, 'splitter', 0, 40).hp = 1;
  const before = structuredClone(village), notices = structuredClone(sim.notices);
  const save = store.saveVillage; store.saveVillage = () => { throw new Error('disk failure'); };
  assert.throws(() => sim.action(village.id, player.id, { kind: 'attack' }), /disk failure/);
  assert.deepEqual(village, before); assert.deepEqual(sim.notices, notices);
  store.saveVillage = save; sim.action(village.id, player.id, { kind: 'attack' });
  assert.equal(player.durability.sword, 2); assert.equal(player.combatRewards.gold, LARGE_ZOMBIE_BOUNTY_GOLD); assert.equal(village.zombies.filter(z => z.kind === 'splinter').length, 3);
});

test('failed dawn persistence restores watch awards, payroll, requests and phase for a safe retry', () => {
  const { sim, store, village, player } = fixture(); sim.startNight(village);
  village.progression.watch.seconds[player.id] = village.progression.watch.duration;
  player.wageAccrued = 10; player.jobBonus = 3;
  const before = structuredClone(village), notices = structuredClone(sim.notices), save = store.saveVillage;
  store.saveVillage = () => { throw new Error('disk failure'); };
  assert.throws(() => sim.dawn(village), /disk failure/); assert.deepEqual(village, before); assert.deepEqual(sim.notices, notices);
  store.saveVillage = save; sim.dawn(village);
  assert.equal(village.day, before.day + 1); assert.equal(player.wallet, before.players[player.id].wallet + 13); assert.equal(player.accountProgression.nights, 1);
});

test('legacy elites use the large bounty while ordinary legacy enemies remain small', () => {
  assert.equal(enemyBountyGold({ elite: true, reward: 100 }), 200);
  assert.equal(enemyBountyGold({ reward: 1000 }), 100);
  assert.equal(enemyBountyGold({ kind: 'siege', reward: 1 }), 1000);
  assert.equal(enemyBountyGold({ kind: 'splinter', elite: true, reward: 200 }), 100);
});
