// Shared identities and presentation sizes; the server owns combat and time.
export const ZOMBIE_BOUNTIES = Object.freeze({ small: 100, large: 200, boss: 1000 });
// Keep the base constant for callers describing an ordinary zombie.
export const ZOMBIE_BOUNTY_GOLD = ZOMBIE_BOUNTIES.small;
export const LARGE_ZOMBIE_BOUNTY_GOLD = ZOMBIE_BOUNTIES.large;
export const BOSS_ZOMBIE_BOUNTY_GOLD = ZOMBIE_BOUNTIES.boss;
export const ENEMY_TYPES = Object.freeze({
  shambler: Object.freeze({ label: 'Shambler', scale: 1, hp: 65, speed: 1.75, damage: 9, structureDamage: 8, reward: ZOMBIE_BOUNTY_GOLD, windup: .8, radius: 1.45, recovery: .8 }),
  runner: Object.freeze({ label: 'Grave runner', scale: .86, hp: 36, speed: 3.25, damage: 6, structureDamage: 5, reward: ZOMBIE_BOUNTY_GOLD, windup: .65, radius: 1.05, recovery: .65 }),
  armored: Object.freeze({ label: 'Ironbound', scale: 1.12, hp: 110, speed: 1.5, damage: 13, structureDamage: 13, armor: .35, reward: LARGE_ZOMBIE_BOUNTY_GOLD, windup: 1.1, radius: 1.65, recovery: 1 }),
  splitter: Object.freeze({ label: 'Brood husk', scale: 1.45, hp: 135, speed: 1.4, damage: 12, structureDamage: 12, reward: LARGE_ZOMBIE_BOUNTY_GOLD, windup: 1.45, radius: 2.7, recovery: 1.2 }),
  splinter: Object.freeze({ label: 'Grave mite', scale: .54, hp: 18, speed: 2.6, damage: 3, structureDamage: 3, reward: ZOMBIE_BOUNTY_GOLD, windup: .65, radius: .85, recovery: .8 }),
  siege: Object.freeze({ label: 'Gravebreaker', scale: 1.85, hp: 360, speed: 1.15, damage: 21, structureDamage: 75, reward: BOSS_ZOMBIE_BOUNTY_GOLD, windup: 1.65, radius: 3.2, recovery: 2.4 })
});
export const ENEMY_LIMITS = Object.freeze({ active: 120, graveEmergence: 2.2, splitEmergence: .65, splitCount: 3, siegeWindup: 1.65 });
export const MELEE = Object.freeze({ playerRange: 3.2, guardRange: 2.6, halfArc: Math.PI / 3 });
export function inMeleeArc(from, target, range) {
  const dx = target.x - from.x, dz = target.z - from.z, length = Math.hypot(dx, dz);
  return length <= range && (length < 1e-6 || (dx * Math.sin(from.yaw) + dz * Math.cos(from.yaw)) / length >= Math.cos(MELEE.halfArc) - 1e-8);
}
export function enemyKind(enemy) {
  return Object.hasOwn(ENEMY_TYPES, enemy?.kind) ? enemy.kind : enemy?.elite ? 'armored' : 'shambler';
}
// Resolve from the authoritative kind, including migrated elites, never a saved
// reward field or the damage/health scaling used for later waves.
export function enemyBountyGold(enemy) {
  return ENEMY_TYPES[enemyKind(enemy)].reward;
}
export function enemyStats(kind, band = 0, players = 1) {
  const type = ENEMY_TYPES[kind] ?? ENEMY_TYPES.shambler;
  const level = Math.max(0, Math.floor(Number.isFinite(band) ? band : 0));
  const active = Math.max(1, Math.min(8, Math.floor(Number.isFinite(players) ? players : 1)));
  return { ...type, maxHp: Math.round(type.hp + level * (kind === 'splinter' ? 3 : kind === 'siege' ? 55 : 14) + (kind === 'siege' ? (active - 1) * 70 : 0)),
    speed: type.speed + Math.min(level * .08, .65), damage: type.damage + Math.min(15, level * 2), structureDamage: type.structureDamage + Math.min(35, level * 2), armor: type.armor ?? 0 };
}
export function emergenceProgress(enemy, clock) {
  if (!Number.isFinite(enemy?.emergeUntil) || !Number.isFinite(enemy?.spawnAt) || enemy.emergeUntil <= enemy.spawnAt) return 1;
  return Math.max(0, Math.min(1, (clock - enemy.spawnAt) / (enemy.emergeUntil - enemy.spawnAt)));
}
export function enemyForWave(day, index) {
  if (day % 5 === 0 && index === 0) return 'siege';
  if (day >= 3 && index % 7 === 5) return 'armored';
  if (day >= 2 && index % 7 === 4) return 'splitter';
  // Established villages face more pressure from existing enemy roles. Keep
  // the first twenty nights, brood slots and fifth-night siege contract intact.
  if (day >= 31 && index % 7 === 3) return 'armored';
  if (day >= 21 && index % 7 === 1) return 'runner';
  if (index % 4 === 2) return 'runner';
  return 'shambler';
}

export function enemySpawnInterval(day) {
  const night = Number.isFinite(day) ? Math.max(1, day) : 1;
  const band = Math.floor((night - 1) / 5);
  const latePressure = night >= 41 ? .8 : night >= 21 ? .9 : 1;
  return Math.max(1.5, (6 - band * .4) * latePressure);
}
