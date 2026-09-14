import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseInteraction, nearestGatherable } from '../public/src/interactions.js';

const church = { id: 'church', kind: 'church', x: 22, z: -14, w: 9, d: 14 };
const nodes = [{ id: 'stone-near', type: 'stone', x: 27, z: -22 }, { id: 'stone-far', type: 'stone', x: 30, z: -25 }, { id: 'tree', type: 'timber', x: 29, z: -22 }];
const states = nodes.map(n => ({ id: n.id, available: true }));
const player = { x: 27, z: -21 };

test('pickaxe gathers stone instead of opening an overlapping church interaction', () => {
  const selected = chooseInteraction(player, 'pickaxe', nodes, states, [church]);
  assert.equal(selected.kind, 'gather'); assert.equal(selected.targetId, 'stone-near');
  assert.equal(nearestGatherable(player, 'pickaxe', nodes, states).id, selected.targetId, 'click and E resolve the same target');
  assert.equal(chooseInteraction(player, 'sword', nodes, states, [church]).kind, 'church', 'switching away from a gathering tool still allows visiting the service');
});

test('gathering chooses the nearest available matching resource within server reach', () => {
  assert.equal(nearestGatherable(player, 'axe', nodes, states).id, 'tree');
  assert.equal(nearestGatherable(player, 'scythe', nodes, states), null);
  const depleted = states.map(s => ({ ...s, available: s.id !== 'stone-near' }));
  assert.equal(nearestGatherable(player, 'pickaxe', nodes, depleted), null, 'distant stone is not offered while nearby stone regrows');
  assert.equal(chooseInteraction(player, 'pickaxe', nodes, depleted, [church]).kind, 'church');
  assert.equal(chooseInteraction({ ...player, downed: true }, 'pickaxe', nodes, states, [church]), null);
});

test('every pickaxe tier can target public or private iron and coal nodes', () => {
  const ore = [{ id: 'iron', type: 'iron', x: 27, z: -22 }, { id: 'plot:mine:coal', type: 'coal', x: 27, z: -20 }];
  const availability = ore.map(node => ({ ...node, available: true }));
  assert.ok(['iron', 'plot:mine:coal'].includes(nearestGatherable(player, 'pickaxe', ore, availability).id));
  assert.equal(nearestGatherable(player, 'pickaxe', ore, availability.map(node => ({ ...node, available: node.id === 'iron' }))).id, 'iron');
  assert.equal(nearestGatherable(player, 'axe', ore, availability), null);
});
