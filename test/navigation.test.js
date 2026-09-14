import test from 'node:test';
import assert from 'node:assert/strict';
import { canStand, plotSolids, PLOTS, plotFront } from '../shared/world.js';
import { stepNpcNavigation } from '../server/navigation.js';

const apart = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const npc = (x, z, id = 'npc') => ({ id, x, z, yaw: 0, anim: 'idle', hp: 100 });

function walk(entity, target, solids, seconds = 25, neighbors = [entity]) {
  for (let i = 0; i < seconds / .05 && apart(entity, target) > .2; i++) {
    const previous = { x: entity.x, z: entity.z };
    stepNpcNavigation(entity, target, 3, .05, neighbors, solids);
    assert.ok(canStand(entity.x, entity.z, .4, solids), 'every simulated position remains outside walls and buildings');
    assert.ok(apart(previous, entity) <= 3 * .05 * 1.15 + 1e-7, 'navigation walks continuously without snapping or teleporting');
  }
}

test('NPCs chase around a new plot building and return around it to a road waypoint', () => {
  const plot = PLOTS.find(p => p.id === 'east-8'), solids = plotSolids([{ id: plot.id, building: 'house' }]);
  const entity = npc(plot.x - 7, plot.z), target = { x: plot.x + 7, z: plot.z };
  walk(entity, target, solids);
  assert.ok(apart(entity, target) < .3, 'guard reaches a dwarf on the opposite side of the house');
  const road = plotFront(plot, 1);
  walk(entity, road, solids);
  assert.ok(apart(entity, road) < .3, 'guard returns to the original road after a chase');
});

test('existing static barracks can be navigated around without changing its collision footprint', () => {
  const entity = npc(-30, -3), target = { x: -14, z: -3 };
  walk(entity, target, []);
  assert.ok(apart(entity, target) < .3);
});

test('a cached route responds to a moving target and newly constructed obstacle', () => {
  const solids = [{ x: 50, z: -90, w: 10, d: 10 }], entity = npc(40, -90);
  walk(entity, { x: 60, z: -90 }, solids, 3);
  const target = { x: 60, z: -78 };
  solids.push({ x: 57, z: -82, w: 4, d: 4 });
  walk(entity, target, solids);
  assert.ok(apart(entity, target) < .3, 'target movement invalidates the old detour');
});

test('troops keep local separation and movement remains bounded with multiple actors', () => {
  const a = npc(42, -90.2, 'a'), b = npc(42, -89.8, 'b'), neighbors = [a, b], target = { x: 60, z: -90 };
  for (let i = 0; i < 35; i++) for (const entity of neighbors) {
    stepNpcNavigation(entity, target, 3, .05, neighbors);
    assert.ok(canStand(entity.x, entity.z, .4));
  }
  assert.ok(apart(a, b) > .65, 'nearby marching guards avoid collapsing into one position');
  assert.ok(a.x > 45 && b.x > 45);
});

test('an unreachable target across the outer wall never makes an NPC walk through the wall', () => {
  const entity = npc(84, -80), target = { x: 91, z: -80 };
  walk(entity, target, [], 5);
  assert.ok(entity.x < 85.61, 'the wall remains solid even when a bounded path search fails');
});
