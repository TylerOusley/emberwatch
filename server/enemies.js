import { randomUUID } from 'node:crypto';
import { ROAD, PLOTS, canStand, plotSolids, plotSolid } from '../shared/world.js';
import { ENEMY_TYPES, ENEMY_LIMITS, enemyKind, enemyStats, enemyForWave } from '../shared/enemies.js';

export function ensureEnemies(village) {
  village.zombies ??= [];
  village.siegeNight ??= village.phase === 'night' && village.day % 5 === 0;
  for (const zombie of village.zombies) {
    // Existing enemies retain every point of health and their current location.
    // Old elites retain their original defense instead of gaining free armor.
    const legacy = !Object.hasOwn(ENEMY_TYPES, zombie.kind);
    zombie.legacyCombat ??= legacy;
    zombie.kind = enemyKind(zombie);
    const stats = enemyStats(zombie.kind, Math.floor((village.day - 1) / 5));
    zombie.speed ??= stats.speed;
    zombie.damage ??= legacy ? zombie.elite ? 15 : 9 : stats.damage;
    if (!zombie.legacyCombat) zombie.structureDamage ??= stats.structureDamage;
    zombie.armor ??= legacy ? 0 : stats.armor;
    zombie.birth ??= 'grave';
    zombie.spawnAt ??= village.clock - ENEMY_LIMITS.graveEmergence;
    zombie.emergeUntil ??= village.clock;
    zombie.windupStartedAt ??= null;
    zombie.windupUntil ??= null;
    zombie.windupTarget ??= null;
    zombie.lastSlamAt ??= null;
    zombie.parentId ??= null;
    if (Number.isFinite(zombie.windupUntil) && !Number.isFinite(zombie.windupRadius)) cancelZombieWindup(zombie);
  }
}

export function createEnemy(village, kind, { x = ROAD[0].x, z = ROAD[0].z, birth = 'grave', parentId = null, roadIndex = 1 } = {}) {
  const stats = enemyStats(kind, Math.floor((village.day - 1) / 5), Object.values(village.players).filter(p => p.online).length);
  return { id: randomUUID(), kind, x, z, yaw: Math.PI, hp: stats.maxHp, maxHp: stats.maxHp, anim: birth === 'split' ? 'burst' : 'emerge', roadIndex, cooldown: 0,
    elite: ['armored', 'siege'].includes(kind), speed: stats.speed, damage: stats.damage, structureDamage: stats.structureDamage, armor: stats.armor,
    birth, parentId, spawnAt: village.clock, emergeUntil: village.clock + (birth === 'split' ? ENEMY_LIMITS.splitEmergence : ENEMY_LIMITS.graveEmergence),
    windupStartedAt: null, windupUntil: null, windupTarget: null, lastSlamAt: null, lastSlamTarget: null };
}

export function spawnWaveEnemy(village) {
  // Reserve room for one full brood when the battlefield is crowded. A full
  // battlefield delays the next spawn instead of silently consuming it.
  if (village.zombies.filter(z => z.hp > 0).length > ENEMY_LIMITS.active - ENEMY_LIMITS.splitCount - 1) return false;
  const index = village.spawned, kind = enemyForWave(village.day, index);
  village.zombies.push(createEnemy(village, kind, { x: ROAD[0].x + (index % 3 - 1) * 1.3, z: ROAD[0].z + (index % 2) * 1.5 }));
  village.spawned++;
  const band = Math.floor((village.day - 1) / 5);
  village.nextSpawn = village.clock + Math.max(1.5, 6 - band * .4);
  return true;
}

export function nightIsCleared(village) {
  // Empty gaps between grave spawns are not a victory. Every scheduled entry
  // must have appeared, and surviving remnants/burst children count too.
  return village.status === 'active' && village.phase === 'night' &&
    Number.isSafeInteger(village.waveCount) && village.waveCount > 0 &&
    Number.isSafeInteger(village.spawned) && village.spawned >= village.waveCount &&
    !village.zombies.some(zombie => zombie.hp > 0);
}

export function splitEnemy(village, zombie) {
  if (enemyKind(zombie) !== 'splitter' || zombie.hp > 0 || zombie.splitDone) return [];
  // Set this before adding children: splash hits, guard strikes and repeated
  // callbacks must never produce another brood or duplicate the parent reward.
  zombie.splitDone = true;
  const room = Math.max(0, ENEMY_LIMITS.active - village.zombies.filter(z => z.hp > 0).length);
  const solids = plotSolids(village.plots), children = [];
  for (let i = 0; i < Math.min(ENEMY_LIMITS.splitCount, room); i++) {
    const angle = i * Math.PI * 2 / ENEMY_LIMITS.splitCount;
    let x = zombie.x + Math.cos(angle) * .8, z = zombie.z + Math.sin(angle) * .8;
    // A parent can die beside the gate or a tower. Keep its brood on the same
    // side of an intact gate and out of solid buildings.
    if (village.gate.hp > 0 && (z < 18) !== (zombie.z < 18) || !canStand(x, z, .35, solids)) { x = zombie.x; z = zombie.z; }
    const child = createEnemy(village, 'splinter', { x, z, birth: 'split', parentId: zombie.id, roadIndex: zombie.roadIndex });
    children.push(child);
  }
  village.zombies.push(...children);
  return children;
}

export function cancelZombieWindup(zombie) {
  for (const field of ['windupStartedAt', 'windupUntil', 'windupTarget', 'windupKind', 'windupX', 'windupZ', 'windupRadius', 'windupDamage', 'windupStructureDamage', 'windupSourceX', 'windupSourceZ', 'windupBuilding']) zombie[field] = null;
}

export function beginZombieAttack(village, zombie, center, targetId, targetKind = 'ground', structure = null) {
  if (zombie.hp <= 0 || zombie.cooldown > 0 || village.clock < (zombie.emergeUntil ?? 0) || Number.isFinite(zombie.windupUntil)) return false;
  const stats = ENEMY_TYPES[enemyKind(zombie)];
  zombie.windupStartedAt = village.clock; zombie.windupUntil = village.clock + stats.windup;
  zombie.windupX = center.x; zombie.windupZ = center.z; zombie.windupRadius = stats.radius;
  zombie.windupSourceX = zombie.x; zombie.windupSourceZ = zombie.z;
  zombie.windupTarget = targetId; zombie.windupKind = targetKind; zombie.windupBuilding = structure?.building ?? null;
  zombie.windupDamage = zombie.damage ?? (zombie.elite ? 15 : 9);
  const fallback = targetKind === 'keep' ? zombie.elite ? 20 : 10 : targetKind === 'plot' ? zombie.elite ? 18 : 10 : zombie.elite ? 15 : 8;
  zombie.windupStructureDamage = zombie.structureDamage ?? fallback;
  zombie.yaw = Math.atan2(center.x - zombie.x, center.z - zombie.z); zombie.anim = 'windup';
  return true;
}

export function attackZombieStructure(village, zombie, structure, targetId, targetKind) {
  if (structure.hp <= 0) { cancelZombieWindup(zombie); return false; }
  let contact = targetKind === 'gate' ? { x: 0, z: 18 } : { x: 0, z: -35 };
  if (targetKind === 'plot') {
    const site = PLOTS.find(p => p.id === targetId);
    if (!site) return false;
    const solid = plotSolid(site, structure.building) ?? site;
    contact = { x: Math.max(site.x - solid.w / 2, Math.min(site.x + solid.w / 2, zombie.x)), z: Math.max(site.z - solid.d / 2, Math.min(site.z + solid.d / 2, zombie.z)) };
  }
  if (zombie.cooldown > 0) zombie.anim = 'idle';
  beginZombieAttack(village, zombie, contact, targetId, targetKind, structure);
  // Damage always resolves through tickZombieAttack after the warning window.
  return false;
}

export function tickZombieAttack(sim, village, zombie, defenders) {
  if (!Number.isFinite(zombie.windupUntil)) return false;
  if (zombie.hp <= 0 || Math.hypot(zombie.x - zombie.windupSourceX, zombie.z - zombie.windupSourceZ) > .6) { cancelZombieWindup(zombie); return true; }
  zombie.anim = 'windup';
  if (village.clock + 1e-8 < zombie.windupUntil) return true;
  const center = { x: zombie.windupX, z: zombie.windupZ }, radius = zombie.windupRadius, damage = zombie.windupDamage;
  const targetId = zombie.windupTarget, targetKind = zombie.windupKind, structureDamage = zombie.windupStructureDamage, building = zombie.windupBuilding;
  zombie.lastSlamAt = village.clock; zombie.lastSlamTarget = targetId; zombie.lastSlamX = center.x; zombie.lastSlamZ = center.z; zombie.lastSlamRadius = radius;
  zombie.cooldown = ENEMY_TYPES[enemyKind(zombie)].recovery; zombie.anim = 'attack';
  cancelZombieWindup(zombie);
  // The circle stays at its original ground location. Only feet inside its
  // advertised radius at impact are hit; neither a moving target nor its size
  // secretly expands the warning. Buildings and the closed gate still block it.
  for (const defender of defenders) {
    if (defender.hp <= 0 || defender.downed || 'online' in defender && !defender.online) continue;
    if (Math.hypot(defender.x - center.x, defender.z - center.z) > radius || !sim.clearAttack(village, zombie, defender)) continue;
    if ('online' in defender) sim.hurtPlayer(village, defender, damage);
    else defender.hp = Math.max(0, defender.hp - damage);
  }
  const structure = targetKind === 'gate' ? village.gate : targetKind === 'keep' ? village.keep : targetKind === 'plot' ? village.plots.find(p => p.id === targetId && p.building === building) : null;
  if (structure?.hp > 0 && sim.clearAttack(village, zombie, center)) {
    structure.hp = Math.max(0, structure.hp - structureDamage);
    if (structure.hp <= 0 && targetKind === 'plot') {
      structure.lastShot = null;
      sim.notice(village.id, 'A defensive building has been destroyed. Its owner can rebuild on the plot.');
      sim.store.saveVillage(village);
    }
  }
  return true;
}

export function enemySnapshot(zombie) {
  const { id, x, z, yaw, hp, maxHp, anim, spawnAt, emergeUntil, birth, parentId, windupStartedAt, windupUntil, windupTarget, windupKind, windupX, windupZ, windupRadius, lastSlamAt, lastSlamTarget, lastSlamX, lastSlamZ, lastSlamRadius } = zombie;
  return { id, x, z, yaw, hp, maxHp, anim, kind: enemyKind(zombie), spawnAt, emergeUntil, birth, parentId, windupStartedAt, windupUntil, windupTarget, windupKind, windupX, windupZ, windupRadius, lastSlamAt, lastSlamTarget, lastSlamX, lastSlamZ, lastSlamRadius };
}
