import { SOLIDS, WORLD_BOUNDS, moveWithCollision } from '../shared/world.js';

const RADIUS = .4, GRID = 1.5, MAX_EXPANDED = 3500;
const routes = new WeakMap();
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function insideBounds(point) {
  return point.x >= WORLD_BOUNDS.minX + RADIUS && point.x <= WORLD_BOUNDS.maxX - RADIUS && point.z >= WORLD_BOUNDS.minZ + RADIUS && point.z <= WORLD_BOUNDS.maxZ - RADIUS;
}

function free(point, solids) {
  return insideBounds(point) && !solids.some(s => Math.abs(point.x - s.x) < s.w / 2 + RADIUS && Math.abs(point.z - s.z) < s.d / 2 + RADIUS);
}

// Test the whole swept segment, not just its endpoints. Expanding rectangles
// by the dwarf's radius also prevents diagonal cuts across building corners.
function clear(from, to, solids) {
  if (!insideBounds(from) || !insideBounds(to)) return false;
  const dx = to.x - from.x, dz = to.z - from.z;
  for (const solid of solids) {
    let low = 0, high = 1;
    for (const [start, delta, center, half] of [[from.x, dx, solid.x, solid.w / 2 + RADIUS], [from.z, dz, solid.z, solid.d / 2 + RADIUS]]) {
      if (Math.abs(delta) < 1e-9) {
        if (Math.abs(start - center) > half) { low = 1; high = 0; break; }
      } else {
        const a = (center - half - start) / delta, b = (center + half - start) / delta;
        low = Math.max(low, Math.min(a, b)); high = Math.min(high, Math.max(a, b));
      }
    }
    if (low <= high && high > 1e-7 && low < 1 - 1e-7) return false;
  }
  return true;
}

class Frontier {
  constructor() { this.items = []; }
  push(value) {
    let index = this.items.length; this.items.push(value);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.items[parent].score <= value.score) break;
      this.items[index] = this.items[parent]; index = parent;
    }
    this.items[index] = value;
  }
  pop() {
    const first = this.items[0], tail = this.items.pop();
    if (this.items.length) {
      let index = 0;
      while (index * 2 + 1 < this.items.length) {
        let child = index * 2 + 1;
        if (child + 1 < this.items.length && this.items[child + 1].score < this.items[child].score) child++;
        if (this.items[child].score >= tail.score) break;
        this.items[index] = this.items[child]; index = child;
      }
      this.items[index] = tail;
    }
    return first;
  }
}

function findRoute(start, target, allSolids, margin) {
  if (!free(target, allSolids)) return null;
  const bounds = {
    minX: Math.max(WORLD_BOUNDS.minX + RADIUS, Math.min(start.x, target.x) - margin),
    maxX: Math.min(WORLD_BOUNDS.maxX - RADIUS, Math.max(start.x, target.x) + margin),
    minZ: Math.max(WORLD_BOUNDS.minZ + RADIUS, Math.min(start.z, target.z) - margin),
    maxZ: Math.min(WORLD_BOUNDS.maxZ - RADIUS, Math.max(start.z, target.z) + margin)
  };
  const solids = allSolids.filter(s => s.x + s.w / 2 + RADIUS >= bounds.minX && s.x - s.w / 2 - RADIUS <= bounds.maxX && s.z + s.d / 2 + RADIUS >= bounds.minZ && s.z - s.d / 2 - RADIUS <= bounds.maxZ);
  const frontier = new Frontier(), best = new Map(), parents = new Map(), points = new Map(), open = new Map();
  const key = (x, z) => `${x}:${z}`;
  const point = (x, z) => ({ x: x * GRID, z: z * GRID });
  const legal = (x, z) => {
    const id = key(x, z);
    if (!open.has(id)) {
      const p = point(x, z);
      open.set(id, p.x >= bounds.minX && p.x <= bounds.maxX && p.z >= bounds.minZ && p.z <= bounds.maxZ && free(p, solids));
    }
    return open.get(id);
  };
  const add = (x, z, cost, parent) => {
    const id = key(x, z);
    if (cost >= (best.get(id) ?? Infinity)) return;
    const p = point(x, z);
    best.set(id, cost); parents.set(id, parent); points.set(id, p);
    frontier.push({ id, x, z, cost, score: cost + distance(p, target) });
  };
  const sx = Math.round(start.x / GRID), sz = Math.round(start.z / GRID);
  // The initial virtual node retains the exact position; no grid snapping or
  // teleporting is used to escape a collision or reach a nearby grid center.
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    if (!legal(sx + dx, sz + dz)) continue;
    const p = point(sx + dx, sz + dz);
    if (clear(start, p, solids)) add(sx + dx, sz + dz, distance(start, p), null);
  }
  let expanded = 0;
  while (frontier.items.length && expanded++ < MAX_EXPANDED) {
    const current = frontier.pop();
    if (current.cost !== best.get(current.id)) continue;
    const here = points.get(current.id);
    if (distance(here, target) <= GRID * 1.6 && clear(here, target, solids)) {
      const result = [target];
      for (let id = current.id; id !== null; id = parents.get(id)) result.push(points.get(id));
      result.reverse();
      const smooth = []; let previous = start;
      for (let i = 0; i < result.length; i++) {
        let furthest = i;
        for (let j = i + 1; j < Math.min(result.length, i + 12); j++) {
          if (clear(previous, result[j], solids)) furthest = j;
        }
        smooth.push(result[furthest]); previous = result[furthest]; i = furthest;
      }
      return smooth;
    }
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if ((!dx && !dz) || !legal(current.x + dx, current.z + dz)) continue;
      const next = point(current.x + dx, current.z + dz);
      if (!clear(here, next, solids)) continue;
      add(current.x + dx, current.z + dz, current.cost + GRID * Math.hypot(dx, dz), current.id);
    }
  }
  return null;
}

export function stepNpcNavigation(entity, target, speed, dt, neighbors = [], extraSolids = []) {
  if (![entity.x, entity.z, target?.x, target?.z, speed, dt].every(Number.isFinite) || dt <= 0 || speed <= 0) return;
  const solids = [...SOLIDS, ...extraSolids];
  let state = routes.get(entity);
  if (!state) { state = { target: { ...target }, blocked: 0, time: 0, retryAt: 0, failures: 0, path: null, index: 0 }; routes.set(entity, state); }
  state.time += dt;
  if (distance(state.target, target) > 3) {
    state.target = { ...target }; state.path = null; state.blocked = 0; state.failures = 0;
  }
  const direct = clear(entity, target, solids);
  if (direct) { state.path = null; state.blocked = 0; state.failures = 0; }
  if (state.path) {
    while (state.index < state.path.length - 1 && distance(entity, state.path[state.index]) < .3) state.index++;
    if (!clear(entity, state.path[state.index], solids)) { state.path = null; state.blocked = .3; }
  }
  if (!direct && !state.path && state.blocked >= .3 && state.time >= state.retryAt) {
    state.target = { ...target };
    state.path = findRoute(entity, target, solids, state.failures ? 32 : 14);
    state.index = 0; state.retryAt = state.time + (state.path ? .7 : 1.5);
    if (!state.path) state.failures++;
  }
  const destination = state.path?.[state.index] ?? target;
  const dx = destination.x - entity.x, dz = destination.z - entity.z, length = Math.hypot(dx, dz);
  if (length < .15) {
    if (state.path && state.index < state.path.length - 1) state.index++;
    else if (state.path && distance(entity, target) >= .2) { state.path = null; state.blocked = .3; }
    entity.anim = 'idle'; return;
  }
  let vx = dx / length * speed, vz = dz / length * speed;
  for (const other of neighbors) {
    if (other === entity || other.hp <= 0) continue;
    const apart = distance(entity, other);
    if (apart > .001 && apart < 1.1) {
      vx += (entity.x - other.x) / apart * (1.1 - apart) * 2;
      vz += (entity.z - other.z) / apart * (1.1 - apart) * 2;
    }
  }
  const norm = Math.hypot(vx, vz) || 1, travel = Math.min(length, norm * dt, speed * dt * 1.15);
  const before = { x: entity.x, z: entity.z };
  moveWithCollision(entity, vx / norm * travel, vz / norm * travel, RADIUS, extraSolids);
  const moved = distance(before, entity), progress = distance(before, destination) - distance(entity, destination);
  if (!direct && (!state.path || moved < speed * dt * .15)) {
    state.blocked = progress < speed * dt * .2 ? state.blocked + dt : Math.max(0, state.blocked - dt * .5);
    if (state.path && state.blocked > .5) { state.path = null; state.blocked = .3; }
  }
  if (moved > .001) { entity.yaw = Math.atan2(entity.x - before.x, entity.z - before.z); entity.anim = 'walk'; }
  else entity.anim = 'idle';
}
