import { CRATE_RULES, equippedItem } from '../shared/crates.js';

const EPSILON = 1e-7;
const clockOf = village => Number.isFinite(village?.clock) ? Math.max(0, village.clock) : 0;
const dayOf = village => Number.isSafeInteger(village?.day) && village.day > 0 ? village.day : 0;
const villageIdOf = village => typeof village?.id === 'string' ? village.id : '';

// These fields belong to the physical resident, so role/equipment changes and
// reconnecting retain both the timer and the already-used day marker.
export function ensureCrateEffects(village, player) {
  const now = clockOf(village);
  if (typeof player.lastStandUsedVillage !== 'string') player.lastStandUsedVillage = '';
  if (!Number.isSafeInteger(player.lastStandUsedDay) || player.lastStandUsedDay < 0) player.lastStandUsedDay = 0;
  if (!Number.isFinite(player.lastStandWard) || player.lastStandWard < 0) player.lastStandWard = 0;
  player.lastStandWard = Math.min(CRATE_RULES.lastStandWard, player.lastStandWard);
  const expires = player.lastStandWardUntil;
  if (!Number.isFinite(expires) || expires <= now || expires > now + CRATE_RULES.lastStandSeconds + EPSILON || player.lastStandUsedVillage !== villageIdOf(village) || !player.lastStandUsedDay) {
    player.lastStandWard = 0; player.lastStandWardUntil = 0;
  }
  const protection = player.phoenixProtectedUntil;
  if (!Number.isFinite(protection) || protection <= now || protection > now + CRATE_RULES.phoenixProtectionSeconds + EPSILON) player.phoenixProtectedUntil = 0;
  return player;
}

// The caller checks this BEFORE absorbDamage so an Ember's brief protection
// neither consumes the ordinary shield nor postpones its recovery.
export function crateProtectionActive(village, player) {
  ensureCrateEffects(village, player);
  return !player.downed && player.hp > 0 && player.phoenixProtectedUntil > clockOf(village);
}

export function breakCrateProtection(player) {
  player.phoenixProtectedUntil = 0;
}

// Input is only the damage left AFTER the ordinary guard shield. Armor reduces
// that remainder once, then an already-active Last Stand ward absorbs it.
export function crateEnemyDamage(village, player, damageAfterShield) {
  ensureCrateEffects(village, player);
  if (!Number.isFinite(damageAfterShield) || damageAfterShield <= 0 || crateProtectionActive(village, player)) return 0;
  const armor = ['head', 'body', 'feet'].reduce((sum, slot) => sum + (equippedItem(player, slot)?.reduction || 0), 0);
  const reduced = damageAfterShield * (1 - Math.min(CRATE_RULES.armorCap, Math.max(0, armor)));
  const absorbed = Math.min(reduced, player.lastStandWard);
  player.lastStandWard = Math.max(0, player.lastStandWard - absorbed);
  return Math.max(0, reduced - absorbed);
}

// Call only after subtracting enemy damage from HP. The ward never reverses
// this hit, triggers for an already-low resident, or revives a lethal victim.
export function crateAfterEnemyHit(village, player, previousHp) {
  ensureCrateEffects(village, player);
  const now = clockOf(village), day = dayOf(village), villageId = villageIdOf(village);
  if (!day || !villageId || player.downed || !(player.hp > 0) || !Number.isFinite(player.maxHp) || player.maxHp <= 0 || !Number.isFinite(previousHp) || previousHp <= player.hp) return false;
  if (!equippedItem(player, 'head')?.lastStand) return false;
  const threshold = player.maxHp * CRATE_RULES.lastStandThreshold;
  if (previousHp + EPSILON < threshold || player.hp >= threshold - EPSILON) return false;
  if (player.lastStandUsedVillage === villageId && player.lastStandUsedDay >= day) return false;
  if (player.lastStandWard > 0 && player.lastStandWardUntil > now) return false;
  player.lastStandUsedVillage = villageId; player.lastStandUsedDay = day;
  player.lastStandWard = CRATE_RULES.lastStandWard;
  player.lastStandWardUntil = now + CRATE_RULES.lastStandSeconds;
  return true;
}

export function crateRespawnEffects(player) {
  // Manual respawn forfeits physical equipment. Preserve the spent-day marker
  // so granting a new role or reconnecting cannot reset Last Stand's use.
  player.crateEquipment = { head: '', body: '', feet: '', utility: '' };
  player.lastStandWard = 0; player.lastStandWardUntil = 0;
  breakCrateProtection(player);
}
