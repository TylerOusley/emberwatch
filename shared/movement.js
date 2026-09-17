import { groundHeight, moveWithCollision, CONFIG } from './world.js';
import { LOW_OBSTACLES } from './elevation.js';
export const JUMP = Object.freeze({ velocity: 7, gravity: 20, height: 1.225 });
export function standingHeight(x, z, feet = Infinity, radius = CONFIG.playerRadius) {
  let floor = groundHeight(x, z);
  // Use the same foot footprint as horizontal collision. Dropping the player
  // when only their center leaves a ledge would strand their remaining body
  // overlap inside the ledge's side, unable to finish walking off it.
  for (const obstacle of LOW_OBSTACLES) if (Math.abs(x - obstacle.x) < obstacle.w / 2 + radius && Math.abs(z - obstacle.z) < obstacle.d / 2 + radius && obstacle.height <= feet + .06) floor = Math.max(floor, obstacle.height);
  return floor;
}
export function resetJump(player) {
  player.y = standingHeight(player.x, player.z); player.verticalSpeed = 0; player.grounded = true; player.jumpHeld = false;
}
export function movePlayer(player, dx, dz, dt, jump, solids = [], radius = CONFIG.playerRadius) {
  if (!Number.isFinite(player.y)) resetJump(player);
  if (![dx, dz, dt].every(Number.isFinite) || dt <= 0) return player;
  if (!Number.isFinite(player.verticalSpeed) || player.verticalSpeed > JUMP.velocity) player.verticalSpeed = 0;
  const locked = player.downed || player.mountedHorseId || player.bedPlotId || player.carriedBy || player.carryingId || player.rescueCartId;
  if (locked) {
    resetJump(player); player.jumpHeld = Boolean(jump);
    if (!player.downed && !player.bedPlotId && !player.carriedBy && !player.rescueCartId) moveWithCollision(player, dx, dz, radius, solids);
    player.y = standingHeight(player.x, player.z, player.y); return player;
  }
  const floor = standingHeight(player.x, player.z, player.y);
  const grounded = player.y <= floor + .06 && (player.verticalSpeed ?? 0) <= 0;
  if (jump && !player.jumpHeld && grounded) player.verticalSpeed = JUMP.velocity;
  player.jumpHeld = Boolean(jump);
  if (!dx && !dz && grounded && player.verticalSpeed <= 0) {
    player.y = floor; player.verticalSpeed = 0; player.grounded = true; return player;
  }
  // Substeps keep both low ledge collision and gravity stable under a slow tick.
  const steps = Math.max(1, Math.ceil(dt / .025)), sub = dt / steps;
  for (let i = 0; i < steps; i++) {
    player.verticalSpeed = (player.verticalSpeed ?? 0) - JUMP.gravity * sub;
    const oldFloor = standingHeight(player.x, player.z, player.y);
    player.y += player.verticalSpeed * sub;
    moveWithCollision(player, dx / steps, dz / steps, radius, solids, player.y);
    const nextFloor = standingHeight(player.x, player.z, Math.max(player.y, oldFloor));
    if (player.y <= nextFloor) { player.y = nextFloor; player.verticalSpeed = 0; player.grounded = true; }
    else player.grounded = false;
  }
  return player;
}
