import { troopStats } from '../shared/troops.js';
import { groundHeight } from '../shared/world.js';

function ammunitionStock(village, guard) {
  return village.plots.find(p => p.id === guard.plotId && p.ownerId === guard.ownerId && p.building === 'barracks' && p.hp > 0)?.storage;
}

// Empty ranged units continue marching or following orders instead of being
// pinned in place by a distant enemy. They only stop to fend off close threats.
export function troopCanEngage(sim, village, guard, target) {
  const stats = troopStats(guard);
  if (!stats.ammo) return true;
  const available = ammunitionStock(village, guard)?.[stats.ammo];
  if (Number.isSafeInteger(available) && available > 0) return true;
  return Math.hypot(target.x - guard.x, target.z - guard.z) <= 2.1 && (!sim.clearAttack || sim.clearAttack(village, guard, target, false));
}

// Called after order-aware target selection and cooldown advancement. The
// server applies one hit and records its endpoints for the clients' shot effect.
export function tickRangedTroop(sim, village, guard, target, dt, neighbors = []) {
  const stats = troopStats(guard);
  if (!stats.ammo) return false;
  const distance = Math.hypot(target.x - guard.x, target.z - guard.z);
  const stock = ammunitionStock(village, guard);
  const armed = Number.isSafeInteger(stock?.[stats.ammo]) && stock[stats.ammo] > 0;
  const clear = !sim.clearAttack || sim.clearAttack(village, guard, target, false);
  guard.yaw = Math.atan2(target.x - guard.x, target.z - guard.z);
  if (!armed) {
    guard.anim = 'idle';
    // An empty quiver does not turn a ranged unit into an unlimited rifle.
    // It can still fend off an enemy already within arm's reach.
    if (distance <= 2.1 && clear && !guard.cooldown) {
      sim.hitZombie(village, target, 6 * (guard.hungry ? .75 : 1), village.players[guard.ownerId]);
      guard.cooldown = 1.2;
    }
    return true;
  }
  if (distance > stats.range || !clear) {
    sim.stepNpc(guard, target, 3.2, dt, neighbors);
    return true;
  }
  guard.anim = 'idle';
  if (guard.cooldown || !(target.hp > 0)) return true;
  stock[stats.ammo]--;
  guard.anim = 'attack'; guard.attackUntil = village.clock + .45;
  guard.cooldown = stats.cooldown;
  guard.shotSequence = (guard.shotSequence ?? 0) + 1;
  guard.lastShot = { id: `${guard.id}:${guard.shotSequence}`, kind: stats.tool, firedAt: village.clock, until: village.clock + .65,
    fromX: guard.x, fromY: groundHeight(guard.x, guard.z) + 1.3, fromZ: guard.z,
    x: target.x, y: groundHeight(target.x, target.z) + .9, z: target.z };
  sim.hitZombie(village, target, stats.damage * (guard.hungry ? .75 : 1), village.players[guard.ownerId]);
  return true;
}
