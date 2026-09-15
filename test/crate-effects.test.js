import test from 'node:test';
import assert from 'node:assert/strict';
import { absorbDamage, ensureRoleStats } from '../server/roles.js';
import { crateEnemyDamage, crateProtectionActive, breakCrateProtection, crateAfterEnemyHit, crateRespawnEffects, ensureCrateEffects } from '../server/crate-effects.js';

const village = (extra = {}) => ({ id: 'crate-combat-village', day: 7, phase: 'night', clock: 100, ...extra });
const resident = (extra = {}) => ({ id: 'crate-player', role: 'villager', hp: 100, maxHp: 100, online: true, downed: false, crateEquipment: {}, ...extra });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} should equal ${expected}`);
const bestArmor = { head: 'dawnsteel_helm', body: 'runeforged_cuirass', feet: 'guardians_boots' };
const lastStand = { head: 'sunforged_viking_helm' };

// Exercise the module contract with the real ordinary shield helper. The
// Simulation integration calls this same sequence around its downed handling.
function enemyHit(v, p, damage) {
  if (crateProtectionActive(v, p)) return;
  const previous = p.hp;
  p.hp = Math.max(0, p.hp - crateEnemyDamage(v, p, absorbDamage(v, p, damage)));
  crateAfterEnemyHit(v, p, previous);
  if (p.hp <= 0) p.downed = true;
}

test('only physical armor in matching slots reduces enemy damage, additively up to 25 percent', () => {
  const v = village();
  close(crateEnemyDamage(v, resident(), 100), 100);
  close(crateEnemyDamage(v, resident({ crateEquipment: { head: 'padded_cap', feet: 'stout_leather_boots' } }), 100), 97);
  close(crateEnemyDamage(v, resident({ crateEquipment: bestArmor }), 100), 75);
  close(crateEnemyDamage(v, resident({ crateEquipment: { head: 'runeforged_cuirass', utility: 'dawnsteel_helm', body: '__proto__', feet: 'unknown' } }), 100), 100);
  close(crateEnemyDamage(v, resident({ loadout: bestArmor, accountCrates: { loadout: bestArmor } }), 100), 100, 'future loadout does not grant armor this run');
});

test('the guard shield absorbs first, armor reduces overflow, and shield-only hits preserve the ward', () => {
  const v = village(), p = resident({ role: 'guard', crateEquipment: bestArmor });
  ensureRoleStats(p, { fresh: true, clock: v.clock });
  enemyHit(v, p, 100);
  assert.equal(p.shield, 0); close(p.hp, 55); assert.equal(p.shieldHitAt, 100);
  Object.assign(p, { hp: 100, shield: 40, lastStandUsedVillage: v.id, lastStandUsedDay: v.day, lastStandWard: 20, lastStandWardUntil: 110 });
  enemyHit(v, p, 20);
  assert.equal(p.shield, 20); assert.equal(p.hp, 100); assert.equal(p.lastStandWard, 20);
  enemyHit(v, p, 40);
  assert.equal(p.shield, 0); assert.equal(p.hp, 100); close(p.lastStandWard, 5, 'armor reduces the 20-point overflow before ward absorption');
});

test('Last Stand grants a ward only after the surviving threshold-crossing hit and absorbs later hits', () => {
  const v = village(), p = resident({ hp: 30, crateEquipment: lastStand });
  enemyHit(v, p, 10);
  close(p.hp, 20.6); assert.equal(p.lastStandWard, 20); assert.equal(p.lastStandWardUntil, 110);
  assert.equal(p.lastStandUsedVillage, v.id); assert.equal(p.lastStandUsedDay, 7);
  enemyHit(v, p, 10);
  close(p.hp, 20.6); close(p.lastStandWard, 10.6);
  enemyHit(v, p, 20);
  close(p.hp, 12.4); assert.equal(p.lastStandWard, 0); assert.equal(p.lastStandWardUntil, 110);
  assert.equal(p.lastStandUsedDay, 7);
});

test('Last Stand excludes lethal, already-low, unchanged and exactly-at-threshold health', () => {
  for (const [before, after] of [[30, 0], [24, 20], [25, 25], [30, 25], [20, 20], [0, 20]]) {
    const v = village(), p = resident({ hp: after, crateEquipment: lastStand });
    assert.equal(crateAfterEnemyHit(v, p, before), false, `${before}→${after}`);
    assert.equal(p.lastStandWard, 0);
  }
  const v = village(), atThreshold = resident({ hp: 24, crateEquipment: lastStand });
  assert.equal(crateAfterEnemyHit(v, atThreshold, 25), true);
  const priest = resident({ role: 'priest', hp: 30, maxHp: 125, crateEquipment: lastStand });
  assert.equal(crateAfterEnemyHit(v, priest, 32), true, 'uses current maximum health, including priest health');
  const downed = resident({ hp: 10, downed: true, crateEquipment: lastStand });
  assert.equal(crateAfterEnemyHit(v, downed, 50), false);
});

test('Last Stand cannot refresh through gear changes, roles, reconnecting or a day-to-night phase change', () => {
  const v = village({ phase: 'day' }), p = resident({ hp: 20, crateEquipment: lastStand });
  assert.equal(crateAfterEnemyHit(v, p, 30), true);
  p.crateEquipment = {}; ensureCrateEffects(v, p); p.crateEquipment = lastStand;
  p.lastStandWard = 3; v.clock = 104; p.hp = 20;
  assert.equal(crateAfterEnemyHit(v, p, 30), false); assert.equal(p.lastStandWard, 3); assert.equal(p.lastStandWardUntil, 110);
  p.role = 'priest'; ensureRoleStats(p, { clock: v.clock });
  p.hp = 20; assert.equal(crateAfterEnemyHit(v, p, 40), false);
  const saved = JSON.parse(JSON.stringify(p)); v.phase = 'night'; v.clock = 111;
  ensureCrateEffects(v, saved); assert.equal(saved.lastStandWard, 0); assert.equal(saved.lastStandWardUntil, 0);
  assert.equal(crateAfterEnemyHit(v, saved, 40), false);
  v.day = 6; assert.equal(crateAfterEnemyHit(v, saved, 40), false, 'a clock/day rollback does not reissue the spent charge');
  v.day = 8; assert.equal(crateAfterEnemyHit(v, saved, 40), true, 'a later day grants the next once-per-cycle opportunity');
});

test('an active ward cannot stack or extend when the next day begins', () => {
  const v = village(), p = resident({ hp: 20, crateEquipment: lastStand });
  assert.equal(crateAfterEnemyHit(v, p, 30), true);
  v.day++; v.clock = 102; p.lastStandWard = 5;
  assert.equal(crateAfterEnemyHit(v, p, 30), false);
  assert.equal(p.lastStandWard, 5); assert.equal(p.lastStandWardUntil, 110);
  v.clock = 110;
  assert.equal(crateAfterEnemyHit(v, p, 30), true);
  assert.equal(p.lastStandWard, 20); assert.equal(p.lastStandWardUntil, 120);
});

test('Phoenix protection blocks enemy damage before shield use, expires at three seconds and breaks on attack', () => {
  const v = village(), p = resident({ role: 'guard', hp: 40, crateEquipment: bestArmor });
  ensureRoleStats(p, { fresh: true, clock: 90 }); p.hp = 40; p.shield = 12; p.phoenixProtectedUntil = 103;
  enemyHit(v, p, 1000);
  assert.equal(p.hp, 40); assert.equal(p.shield, 12); assert.equal(p.shieldHitAt, 90);
  const restored = JSON.parse(JSON.stringify(p)); v.clock = 102.99;
  assert.equal(crateProtectionActive(v, restored), true);
  breakCrateProtection(restored); assert.equal(crateProtectionActive(v, restored), false);
  enemyHit(v, restored, 16); assert.equal(restored.shield, 0); close(restored.hp, 37);
  v.clock = 103; assert.equal(crateProtectionActive(v, p), false); assert.equal(p.phoenixProtectedUntil, 0);
  enemyHit(v, p, 16); assert.equal(p.shield, 0); close(p.hp, 37);
});

test('manual respawn clears physical equipment and temporary defenses without resetting the spent marker', () => {
  const v = village(), p = resident({ hp: 20, crateEquipment: lastStand, wallet: 95, inventory: { iron: 4 } });
  crateAfterEnemyHit(v, p, 30); p.phoenixProtectedUntil = 103;
  crateRespawnEffects(p);
  assert.deepEqual(p.crateEquipment, { head: '', body: '', feet: '', utility: '' });
  assert.equal(p.lastStandWard, 0); assert.equal(p.lastStandWardUntil, 0); assert.equal(p.phoenixProtectedUntil, 0);
  assert.equal(p.lastStandUsedVillage, v.id); assert.equal(p.lastStandUsedDay, v.day);
  assert.equal(p.wallet, 95); assert.deepEqual(p.inventory, { iron: 4 }, 'ordinary respawn ledgers remain the caller’s responsibility');
  p.crateEquipment = lastStand;
  assert.equal(crateAfterEnemyHit(v, p, 30), false);
});

test('legacy and corrupted temporary effects normalize without granting protection or resetting valid spent markers', () => {
  const v = village(), legacy = resident(); ensureCrateEffects(v, legacy);
  assert.equal(legacy.lastStandWard, 0); assert.equal(legacy.phoenixProtectedUntil, 0);
  const corrupt = resident({ lastStandWard: Infinity, lastStandWardUntil: Infinity, phoenixProtectedUntil: Infinity, lastStandUsedVillage: v.id, lastStandUsedDay: 7 });
  ensureCrateEffects(v, corrupt);
  assert.equal(corrupt.lastStandWard, 0); assert.equal(corrupt.lastStandWardUntil, 0); assert.equal(corrupt.phoenixProtectedUntil, 0);
  assert.equal(corrupt.lastStandUsedDay, 7);
  Object.assign(corrupt, { lastStandWard: 90, lastStandWardUntil: 110, phoenixProtectedUntil: 500 }); ensureCrateEffects(v, corrupt);
  assert.equal(corrupt.lastStandWard, 20); assert.equal(corrupt.phoenixProtectedUntil, 0);
  const ward = corrupt.lastStandWard;
  for (const damage of [-1, 0, NaN, Infinity]) assert.equal(crateEnemyDamage(v, corrupt, damage), 0);
  assert.equal(corrupt.lastStandWard, ward, 'invalid damage cannot spend a valid ward');
});
