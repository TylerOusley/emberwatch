import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseInteraction, choosePlotInteraction, nearestGatherable } from '../public/src/interactions.js';
import { BUILDINGS, PLOTS, plotBedPoint, plotFront } from '../shared/world.js';
import { buildingEntrance, plotEntrance } from '../shared/access.js';

const church = BUILDINGS.find(b => b.id === 'church');
const nodes = [{ id: 'stone-near', type: 'stone', x: 27, z: -22 }, { id: 'stone-far', type: 'stone', x: 30, z: -25 }, { id: 'tree', type: 'timber', x: 29, z: -22 }];
const states = nodes.map(n => ({ id: n.id, available: true }));
const player = { x: 27, z: -21 };

test('pickaxe gathers stone instead of opening an overlapping church interaction', () => {
  const selected = chooseInteraction(player, 'pickaxe', nodes, states, [church]);
  assert.equal(selected.kind, 'gather'); assert.equal(selected.targetId, 'stone-near');
  assert.equal(nearestGatherable(player, 'pickaxe', nodes, states).id, selected.targetId, 'click and E resolve the same target');
  assert.equal(chooseInteraction(player, 'sword', nodes, states, [church]), null, 'a building menu does not open from its side');
});

test('gathering chooses the nearest available matching resource within server reach', () => {
  assert.equal(nearestGatherable(player, 'axe', nodes, states).id, 'tree');
  assert.equal(nearestGatherable(player, 'scythe', nodes, states), null);
  const depleted = states.map(s => ({ ...s, available: s.id !== 'stone-near' }));
  assert.equal(nearestGatherable(player, 'pickaxe', nodes, depleted), null, 'distant stone is not offered while nearby stone regrows');
  assert.equal(chooseInteraction(player, 'pickaxe', nodes, depleted, [church]), null);
  assert.equal(chooseInteraction({ ...player, downed: true }, 'pickaxe', nodes, states, [church]), null);
});

test('every pickaxe tier can target public or private iron and coal nodes', () => {
  const ore = [{ id: 'iron', type: 'iron', x: 27, z: -22 }, { id: 'plot:mine:coal', type: 'coal', x: 27, z: -20 }];
  const availability = ore.map(node => ({ ...node, available: true }));
  assert.ok(['iron', 'plot:mine:coal'].includes(nearestGatherable(player, 'pickaxe', ore, availability).id));
  assert.equal(nearestGatherable(player, 'pickaxe', ore, availability.map(node => ({ ...node, available: node.id === 'iron' }))).id, 'iron');
  assert.equal(nearestGatherable(player, 'axe', ore, availability), null);
});

test('service prompts use the real entrance and reject rear or side approaches', () => {
  for (const building of BUILDINGS.filter(b => b.kind !== 'house')) {
    const door = buildingEntrance(building);
    assert.equal(chooseInteraction(door, '', [], [], [building])?.building.id, building.id);
    const back = { x: building.x * 2 - door.x, z: building.z * 2 - door.z };
    assert.equal(chooseInteraction(back, '', [], [], [building]), null, `${building.id} rear`);
    const dx = door.x - building.x, dz = door.z - building.z;
    for (const sign of [-1, 1]) assert.equal(chooseInteraction({ x: building.x + sign * dz, z: building.z - sign * dx }, '', [], [], [building]), null, `${building.id} side`);
  }
});

test('gathering still wins beside a valid shop entrance', () => {
  const shop = BUILDINGS.find(b => b.id === 'tools'), atDoor = buildingEntrance(shop);
  const tree = { id: 'near-entrance-tree', type: 'timber', x: atDoor.x, z: atDoor.z + 2 };
  assert.equal(chooseInteraction(atDoor, 'axe', [tree], [{ id: tree.id, available: true }], [shop])?.kind, 'gather');
  assert.equal(chooseInteraction(atDoor, '', [tree], [], [shop])?.kind, 'shop');
});

test('built plot prompts follow the doorway while open land uses its frontage', () => {
  for (const site of [PLOTS[0], PLOTS[20], PLOTS[40]]) {
    const state = { id: site.id, building: 'tool_shop', hp: 300, ownerId: 'alice' };
    const door = plotEntrance(site, state);
    assert.equal(choosePlotInteraction(door, [site], [state])?.site.id, site.id);
    assert.equal(choosePlotInteraction({ x: site.x * 2 - door.x, z: site.z * 2 - door.z }, [site], [state]), null);
    assert.equal(choosePlotInteraction({ ...door, downed: true }, [site], [state]), null);
    const open = { id: site.id, building: null, hp: 0 };
    assert.equal(choosePlotInteraction(plotFront(site, -.9), [site], [open])?.site.id, site.id);
  }
});

test('church beds remain separate care interactions without opening commerce at other walls', () => {
  const site = PLOTS[0], state = { id: site.id, building: 'church', hp: 650, level: 2 };
  const bed = choosePlotInteraction(plotBedPoint(site, 3), [site], [state]);
  assert.equal(bed?.site.id, site.id); assert.equal(bed?.atBed, true);
  assert.equal(choosePlotInteraction({ x: site.x, z: site.z - 5 }, [site], [state]), null);
});

test('cave prompts show the shared rolled ore and do not offer mining through a rock corner', () => {
  const node={id:'rolled',type:'iron',caveTier:'middle',x:4.5,z:-164};
  const current=[{id:node.id,type:'coal',available:true,roll:3}];
  assert.equal(nearestGatherable({x:3,z:-161.5},'pickaxe',[node],current),null,'close straight-line distance cannot cross solid cave rock');
  const selected=nearestGatherable({x:6,z:-164},'pickaxe',[node],current);
  assert.equal(selected.type,'coal');assert.equal(selected.roll,3);
  assert.equal(nearestGatherable({x:6,z:-164},'pickaxe',[node],[{...current[0],available:false}]),null);
});
