import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { BUILDINGS, RESOURCES, WALLS, canStand } from '../shared/world.js';

const edgeDistance = (point, bounds) => Math.hypot(
  Math.max(0, Math.abs(point.x - bounds.x) - bounds.w / 2),
  Math.max(0, Math.abs(point.z - bounds.z) - bounds.d / 2)
);

test('quarry outcrops leave usable clearance from buildings, walls and each other', () => {
  const stones = RESOURCES.filter(node => node.type === 'stone');
  assert.equal(stones.length, 12);
  for (const [index, node] of stones.entries()) {
    // Includes the outcrop's extent and a dwarf standing beside it.
    assert.ok(canStand(node.x, node.z, 1.75), `${node.id} needs space around all sides`);
    assert.ok(BUILDINGS.every(building => edgeDistance(node, building) > 3.4), `${node.id} is too close to a building`);
    assert.ok(WALLS.every(wall => edgeDistance(node, wall) > 2), `${node.id} is too close to a wall`);
    assert.ok(stones.slice(index + 1).every(other => Math.hypot(node.x - other.x, node.z - other.z) > 2.2), `${node.id} overlaps another outcrop`);
    const clearApproach = Array.from({ length: 16 }, (_, step) => {
      const angle = step * Math.PI / 8;
      const point = { x: node.x + Math.cos(angle) * 1.6, z: node.z + Math.sin(angle) * 1.6 };
      return canStand(point.x, point.z) && BUILDINGS.every(building => edgeDistance(point, building) > 2.4);
    }).some(Boolean);
    assert.ok(clearApproach, `${node.id} needs a harvesting position outside building interaction range`);
  }
});

test('quarry relocation retains the original saved resource identities and appearance seeds', () => {
  // These 137 identities came from the original map. New nodes may be appended,
  // but inserting or reseeding them would silently change existing save records.
  const identities = RESOURCES.slice(0, 137).map(({ id, type, seed }) => ({ id, type, seed }));
  const digest = createHash('sha256').update(JSON.stringify(identities)).digest('hex');
  assert.equal(digest, '4f808e736bab796940797f9d9cfabe6babe1065524322216cdfe7d0db00aa86d');
});
