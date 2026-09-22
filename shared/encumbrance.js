import { carryCapacity, inventoryWeight } from './content.js';
import { CONFIG } from './world.js';

export const ENCUMBERED_SPEED_MULTIPLIER = .45;

// Capacity is a movement threshold for players. Inventories retain every item,
// including after a role or equipment change reduces the carrying allowance.
export function carryStatus(player = {}) {
  const carryWeight = inventoryWeight(player), capacity = carryCapacity(player);
  const encumbered = carryWeight > capacity + 1e-6;
  return { carryWeight, carryCapacity: capacity, encumbered,
    carrySpeedMultiplier: encumbered ? ENCUMBERED_SPEED_MULTIPLIER : 1 };
}

// Shared by authoritative movement and local prediction. Sprinting, riding and
// carrying a companion all obey the same penalty; storage remains hard-limited.
export function movementSpeed(player, { sprinting = false, mountedSpeed = 0 } = {}) {
  const status = carryStatus(player);
  const base = player.carryingId ? CONFIG.speed * .55
    : player.mountedHorseId ? mountedSpeed
      : sprinting && player.hunger > 0 && !status.encumbered ? CONFIG.sprintSpeed : CONFIG.speed;
  return base * status.carrySpeedMultiplier;
}
