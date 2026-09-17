import { randomUUID } from 'node:crypto';
import { RESOURCES, caveResourceType, resolveResource } from '../shared/world.js';

export function ensureCaves(village) {
  village.caveSeed ??= randomUUID();
  const states = new Map(village.resources.map(state => [state.id, state]));
  for (const resource of RESOURCES) {
    if (!resource.caveTier) continue;
    const state = states.get(resource.id);
    if (!state) continue;
    if (!Number.isSafeInteger(state.roll) || state.roll < 0) state.roll = 0;
    // Original identities and depletion are retained. Once a slot has a valid
    // rolled mineral it never rerolls merely because somebody joins/restarts.
    if (resource.type === 'sulfur') state.type = 'sulfur';
    else if (resource.caveTier === 'upper' || !['stone', 'iron', 'coal'].includes(state.type)) state.type = caveResourceType(resource.caveTier, `${village.caveSeed}:${resource.id}`, state.roll);
    state.caveVersion = 1;
  }
}

export function regrowCaveResource(village, resource, state) {
  if (!resource.caveTier || state.available || village.clock < state.regrowAt) return false;
  state.roll = Math.min(Number.MAX_SAFE_INTEGER, (state.roll ?? 0) + 1);
  state.type = resource.type === 'sulfur' ? 'sulfur' : caveResourceType(resource.caveTier, `${village.caveSeed}:${resource.id}`, state.roll);
  state.available = true; state.remaining = 8; state.regrowAt = 0; state.caveVersion = 1;
  return true;
}

export function publicResourceSnapshot(state, resource) {
  const { id, available, remaining } = state;
  if (!resource?.caveTier) return { id, available, remaining };
  const node = resolveResource(resource, state);
  return { id, available, remaining, type: node.type, x: node.x, z: node.z, depth: node.depth, caveTier: node.caveTier, roll: node.roll };
}
