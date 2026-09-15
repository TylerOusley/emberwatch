// One continuous horizontal route descends through the mountain. There are no
// stacked floors sharing x/z, so collision, harvesting and height agree.
export const CAVE_ENTRANCE = Object.freeze({ x: 0, z: -118 });
export const CAVE_HEIGHTS = Object.freeze([
  { z: -118, y: 0 }, { z: -142, y: -3 }, { z: -162, y: -3 },
  { z: -174, y: -8 }, { z: -193, y: -8 }, { z: -207, y: -14 }, { z: -230, y: -14 }
].map(Object.freeze));
export const CAVE_AREAS = Object.freeze([
  { id: 'entrance', tier: 'upper', kind: 'ramp', x: 0, z: -130, w: 12, d: 24 },
  { id: 'upper', tier: 'upper', kind: 'chamber', x: 0, z: -151, w: 28, d: 22 },
  { id: 'middle-ramp', tier: 'middle', kind: 'ramp', x: 9, z: -167, w: 10, d: 16 },
  { id: 'middle', tier: 'middle', kind: 'chamber', x: 16, z: -182, w: 34, d: 22 },
  { id: 'deep-ramp', tier: 'deep', kind: 'ramp', x: 4, z: -198, w: 10, d: 16 },
  { id: 'deep', tier: 'deep', kind: 'chamber', x: 0, z: -217, w: 38, d: 26 }
].map(Object.freeze));
export const CAVE_ROUTE = Object.freeze([
  { x: 0, z: -115 }, { x: 0, z: -130 }, { x: 0, z: -146 },
  { x: 9, z: -154 }, { x: 9, z: -178 }, { x: 4, z: -187 },
  { x: 4, z: -211 }, { x: 0, z: -223 }
].map(Object.freeze));
const contains = (area, x, z) => Math.abs(x - area.x) <= area.w / 2 + 1e-8 && Math.abs(z - area.z) <= area.d / 2 + 1e-8;
export function caveAreaAt(x, z) { return CAVE_AREAS.find(area => contains(area, x, z)) ?? null; }
export function caveTierAt(x, z) { return caveAreaAt(x, z)?.tier ?? null; }
export function groundHeight(x, z) {
  if (!caveAreaAt(x, z)) return 0;
  for (let i = 1; i < CAVE_HEIGHTS.length; i++) {
    const high = CAVE_HEIGHTS[i - 1], low = CAVE_HEIGHTS[i];
    if (z >= low.z) return high.y + (low.y - high.y) * Math.max(0, Math.min(1, (high.z - z) / (high.z - low.z)));
  }
  return CAVE_HEIGHTS.at(-1).y;
}
export function caveDepthAt(x, z) { return Math.max(0, -groundHeight(x, z)); }

// The mountain mouth occupies only the unused center behind the village. The
// broad sealed region begins beyond the north wall, leaving all deeds/lanes
// and the existing trees untouched. Rectangle complement seals every bypass.
function caveSolids() {
  const xs = [...new Set([-112, -14, 14, 112, ...CAVE_AREAS.flatMap(a => [a.x - a.w / 2, a.x + a.w / 2])])].sort((a,b) => a-b);
  const zs = [...new Set([-234, -133, -118, ...CAVE_AREAS.flatMap(a => [a.z - a.d / 2, a.z + a.d / 2])])].sort((a,b) => a-b);
  const rows = [];
  for (let j = 1; j < zs.length; j++) {
    let row = null;
    for (let i = 1; i < xs.length; i++) {
      const x = (xs[i - 1] + xs[i]) / 2, z = (zs[j - 1] + zs[j]) / 2;
      const blocked = (z < -133 || z < -118 && Math.abs(x) < 14) && !caveAreaAt(x, z);
      if (blocked) {
        if (row && Math.abs(row.right - xs[i - 1]) < 1e-8) row.right = xs[i];
        else { row = { left: xs[i - 1], right: xs[i], low: zs[j - 1], high: zs[j] }; rows.push(row); }
      } else row = null;
    }
  }
  const merged = [];
  for (const row of rows) {
    const previous = merged.find(r => r.left === row.left && r.right === row.right && r.high === row.low);
    if (previous) previous.high = row.high; else merged.push({ ...row });
  }
  return merged.map(r => Object.freeze({ x: (r.left + r.right) / 2, z: (r.low + r.high) / 2, w: r.right - r.left, d: r.high - r.low, cave: true }));
}
export const CAVE_SOLIDS = Object.freeze(caveSolids());

export function caveSlot(index) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= 44) throw new Error('Unknown cave mineral slot.');
  let x, z, caveTier;
  if (index < 12) { x = index % 2 ? 8 : -8; z = -143 - Math.floor(index / 2) * 3; caveTier = 'upper'; }
  else if (index < 28) { const i = index - 12; x = [3, 10, 23, 30][i % 4]; z = -175 - Math.floor(i / 4) * 5; caveTier = 'middle'; }
  else { const i = index - 28; x = [-15, -7, 7, 15][i % 4]; z = -208 - Math.floor(i / 4) * 6; caveTier = 'deep'; }
  return { x, z, caveTier, depth: caveDepthAt(x, z), caveSlot: index };
}
export function caveResourceType(tier, seed, roll = 0) {
  if (tier === 'upper') return 'stone';
  let value = 2166136261;
  for (const char of `${seed}:${roll}`) { value ^= char.charCodeAt(0); value = Math.imul(value, 16777619); }
  value ^= value >>> 16; value = Math.imul(value, 0x7feb352d); value ^= value >>> 15; value = Math.imul(value, 0x846ca68b); value ^= value >>> 16;
  const sample = (value >>> 0) / 4294967296, stone = tier === 'deep' ? .2 : .4, iron = tier === 'deep' ? .4 : .3;
  return sample < stone ? 'stone' : sample < stone + iron ? 'iron' : 'coal';
}
export function caveTravelWaypoint(from, target) {
  if (caveAreaAt(target.x, target.z) && from.z >= -118) return { x: 0, z: -124 };
  if (caveAreaAt(from.x, from.z) && !caveAreaAt(target.x, target.z)) return { x: 0, z: -115 };
  return target;
}
