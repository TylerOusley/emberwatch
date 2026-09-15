import { CAVE_SOLIDS, caveAreaAt, groundHeight } from '../../shared/world.js';

export function localDwarfOccludesCamera(camera, player) {
  return Math.hypot(camera.x-player.x,camera.y-(groundHeight(player.x,player.z)+1.45),camera.z-player.z)<.8;
}

// Clip from the dwarf toward the camera, including after smoothing. Sampling
// the whole segment also catches narrow rock corners on a descending ramp.
export function constrainCaveCamera(anchor, position, lookAt = null) {
  if (Math.min(anchor.z, position.z) > -117) return position;
  const dx = position.x - anchor.x, dy = position.y - anchor.y, dz = position.z - anchor.z;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy, dz) / .12));
  let safe = 0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, x = anchor.x + dx * t, y = anchor.y + dy * t, z = anchor.z + dz * t;
    const area = caveAreaAt(x, z), floor = groundHeight(x, z);
    if (CAVE_SOLIDS.some(s => Math.abs(x - s.x) < s.w / 2 + .22 && Math.abs(z - s.z) < s.d / 2 + .22)
      || y < floor + .28 || (area && z < -122 && y > floor + 4.85)) break;
    safe = t;
  }
  position.x = anchor.x + dx * safe;
  position.y = anchor.y + dy * safe;
  position.z = anchor.z + dz * safe;
  if (lookAt && caveAreaAt(anchor.x, anchor.z)) lookAt.y = Math.min(lookAt.y, groundHeight(anchor.x, anchor.z) + 4.6);
  return position;
}
