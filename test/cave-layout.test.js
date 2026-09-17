import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  BUILDINGS, PLOTS, RESOURCES, WORLD_BOUNDS, CAVE_AREAS, CAVE_HEIGHTS, CAVE_ROUTE,
  caveAreaAt, caveTierAt, caveDepthAt, groundHeight, clearResourceSegment, canStand, moveWithCollision
} from '../shared/world.js';
import { buildingEntrance } from '../shared/access.js';
import { nearestGatherable } from '../public/src/interactions.js';
import { stepNpcNavigation } from '../server/navigation.js';

const minerals = RESOURCES.filter(node => ['stone', 'iron', 'coal', 'sulfur', 'gold'].includes(node.type));
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Captured from the original, pre-cave map. Saved node depletion and plot
// ownership key off these identities; moving ore must not reroll the forest.
test('the cave relocation preserves all saved resource identities and all 48 deeds', () => {
  assert.equal(digest(RESOURCES.filter(node => node.type !== 'sulfur').map(({ id, type, seed }) => [id, type, seed])),
    '8c840d31642d36ac1981201cd410a1048afa6ac34d5254ca345bba4757119d1b');
  assert.equal(digest(RESOURCES.filter(node => !minerals.includes(node)).map(({ id, type, x, z, seed }) => [id, type, x, z, seed])),
    '29208596cebfca96d308d7214d7c67531b29d705a55cb1c36cda1f635c790911');
  assert.equal(PLOTS.length, 48);
  assert.equal(digest(PLOTS), '147539805ea4297bc19649047cd41e5c5ad3f6666bc63e037536939f668734cf');
});

test('every public mineral has a reachable cave approach and can be selected without gathering through rock', () => {
  const available = RESOURCES.map(node => ({ id: node.id, available: true }));
  assert.equal(minerals.filter(node => node.type !== 'sulfur').length, 44);
  assert.equal(minerals.filter(node => node.type === 'sulfur').length, 8);
  for (const node of minerals) {
    assert.ok(caveAreaAt(node.x, node.z), `${node.id} is inside the cave`);
    assert.ok(caveTierAt(node.x, node.z), `${node.id} has a depth tier`);
    assert.ok(caveDepthAt(node.x, node.z) > 0, `${node.id} is below the surface`);
    assert.ok(!PLOTS.some(plot => Math.abs(node.x - plot.x) < plot.w / 2 + 2 && Math.abs(node.z - plot.z) < plot.d / 2 + 2), `${node.id} avoids plots`);
    assert.ok(BUILDINGS.every(building => distance(node, buildingEntrance(building)) > 3.3), `${node.id} avoids service entrances`);
    const approaches = [];
    for (const radius of [1.6, 2.2]) for (let index = 0; index < 24; index++) {
      const angle = index * Math.PI / 12, point = { x: node.x + Math.sin(angle) * radius, z: node.z + Math.cos(angle) * radius };
      if (canStand(point.x, point.z) && caveAreaAt(point.x, point.z) && clearResourceSegment(point, node)
        && nearestGatherable(point, 'pickaxe', RESOURCES, available)?.id === node.id) approaches.push(point);
    }
    assert.ok(approaches.length > 0, `${node.id} can be approached and selected from a clear side`);
  }
});

function walkSegment(entity, target) {
  const limit = Math.ceil(distance(entity, target) / .1) + 100;
  for (let step = 0; step < limit && distance(entity, target) > 1e-6; step++) {
    const before = { ...entity }, gap = distance(entity, target), travel = Math.min(.1, gap);
    moveWithCollision(entity, (target.x - entity.x) / gap * travel, (target.z - entity.z) / gap * travel);
    assert.ok(canStand(entity.x, entity.z), 'the player retains full body clearance');
    assert.ok(distance(before, entity) <= travel + 1e-8, 'movement does not teleport');
    assert.ok(Math.abs(groundHeight(entity.x, entity.z) - groundHeight(before.x, before.z)) <= .15 + 1e-8, 'the traversable floor does not jump between levels');
  }
  assert.ok(distance(entity, target) < 1e-5, `the route reaches ${JSON.stringify(target)}`);
}

test('a player can walk continuously down the complete mine route and back to the village', () => {
  assert.ok(CAVE_ROUTE.length > 3);
  const player = { ...CAVE_ROUTE[0] };
  assert.ok(canStand(player.x, player.z));
  for (const target of CAVE_ROUTE.slice(1)) walkSegment(player, target);
  assert.ok(caveDepthAt(player.x, player.z) >= 13, 'the route reaches the deepest floor');
  for (const target of CAVE_ROUTE.slice(0, -1).reverse()) walkSegment(player, target);
  assert.ok(distance(player, CAVE_ROUTE[0]) < 1e-5);
  assert.equal(groundHeight(player.x, player.z), 0);
});

test('the irregular side workings enlarge saved chamber floors and remain connected to the main route', () => {
  const original=CAVE_AREAS.filter(area=>area.kind!=='alcove'),branches=CAVE_AREAS.filter(area=>area.kind==='alcove');
  assert.equal(branches.length,10);
  for(const area of original)for(let x=area.x-area.w/2+.6;x<area.x+area.w/2-.5;x+=1.5)for(let z=area.z-area.d/2+.6;z<area.z+area.d/2-.5;z+=1.5){
    assert.ok(caveAreaAt(x,z),'a saved miner never loses their existing floor');
    assert.ok(canStand(x,z),'expansion introduces no blockers on an old chamber floor');
  }
  const miner={id:'branch-surveyor',x:0,z:-151,hp:100,anim:'idle'};
  for(const area of branches){
    for(let tick=0;tick<3600&&distance(miner,area)>.2;tick++)stepNpcNavigation(miner,area,3,.05,[miner]);
    assert.ok(distance(miner,area)<.3,`connected floor reaches ${area.id}`);
  }
});

test('the cave has descending depth bands and keeps normal surface ground level outside its footprint', () => {
  const centers = [{ x: 0, z: -151, height: -3, tier: 'upper' }, { x: 16, z: -182, height: -8, tier: 'middle' }, { x: 0, z: -217, height: -14, tier: 'deep' }];
  for (const point of centers) {
    assert.equal(groundHeight(point.x, point.z), point.height);
    assert.equal(caveDepthAt(point.x, point.z), -point.height);
    assert.equal(caveTierAt(point.x, point.z), point.tier);
    assert.ok(canStand(point.x, point.z));
  }
  for (const point of [{ x: 0, z: 3 }, { x: 70, z: -100 }, { x: -80, z: -190 }, { x: 80, z: -220 }]) {
    assert.equal(caveAreaAt(point.x, point.z), null);
    assert.equal(groundHeight(point.x, point.z), 0);
    assert.equal(caveDepthAt(point.x, point.z), 0);
    assert.equal(caveTierAt(point.x, point.z), null);
  }
  assert.ok(CAVE_AREAS.every(area => [area.x, area.z, area.w, area.d].every(Number.isFinite) && area.w > 0 && area.d > 0));
  for (const join of CAVE_HEIGHTS.slice(0, -1)) {
    let traversable = false;
    for (let x = -20; x <= 40; x += .5) {
      if (!canStand(x, join.z - .0001) || !canStand(x, join.z + .0001)) continue;
      traversable = true;
      assert.ok(Math.abs(groundHeight(x, join.z - .0001) - groundHeight(x, join.z + .0001)) < .001, `the floor joins continuously at ${x},${join.z}`);
    }
    assert.ok(traversable, `the floor transition at ${join.z} remains traversable`);
  }
});

test('solid mountain sides and rear prevent bypassing the north entrance or leaving the excavated mine', () => {
  // Cover the entire northern extension, including beyond the village's side
  // walls, so the mine cannot be reached by simply walking around the castle.
  for (let x = WORLD_BOUNDS.minX + 1; x < WORLD_BOUNDS.maxX; x += 1) {
    for (let z = WORLD_BOUNDS.minZ + 1; z < -134; z += 1) {
      if (!caveAreaAt(x, z)) assert.equal(canStand(x, z), false, `unexcavated rock at ${x},${z} is solid`);
    }
  }
  for (const x of [-104, -92, -25, -9, 9, 25, 92, 104]) {
    const player = { x, z: -116 };
    assert.ok(canStand(player.x, player.z));
    moveWithCollision(player, 0, -80);
    assert.ok(player.z > -133, 'the north boundary cannot be crossed away from the twelve-metre entrance');
  }
  for (const probe of [
    { from: { x: -11, z: -151 }, dx: -80, dz: 0 },
    { from: { x: 11, z: -151 }, dx: 80, dz: 0 },
    { from: { x: 0, z: -225 }, dx: 0, dz: -80 }
  ]) {
    const player = { ...probe.from };
    assert.ok(canStand(player.x, player.z));
    moveWithCollision(player, probe.dx, probe.dz);
    assert.ok(canStand(player.x, player.z));
    assert.ok(caveAreaAt(player.x, player.z), 'walking into the side or back wall stays inside the cave');
    assert.ok(distance(player, probe.from) < 20, 'large movement packets cannot tunnel through the mountain');
  }
  assert.equal(clearResourceSegment({ x: -8, z: -158 }, { x: 3, z: -175 }), false, 'a gather ray cannot cut through the solid bend between chambers');
});

test('NPC navigation follows the cave corridors from the bank to deep ore and back without crossing solid rock', () => {
  const bank = buildingEntrance(BUILDINGS.find(building => building.id === 'bank'));
  const entity = { id: 'cave-worker', ...bank, hp: 100, anim: 'idle' };
  const deep = { x: 0, z: -217 }, deepCorner = { x: -15, z: -226 }, middleCorner = { x: 30, z: -190 };
  for (const target of [deep, bank, deepCorner, bank, middleCorner, bank]) {
    for (let index = 0; index < 240 / .05 && distance(entity, target) > .2; index++) {
      const before = { x: entity.x, z: entity.z };
      stepNpcNavigation(entity, target, 3, .05, [entity]);
      assert.ok(canStand(entity.x, entity.z, .4), 'the worker stays out of cave walls and surface buildings');
      assert.ok(distance(before, entity) <= 3 * .05 * 1.15 + 1e-7, 'the worker traverses continuously');
      assert.ok(Math.abs(groundHeight(entity.x, entity.z) - groundHeight(before.x, before.z)) <= .26 + 1e-8, 'the worker cannot bypass a ramp by crossing a floor cliff');
    }
    assert.ok(distance(entity, target) < .3, `the worker reaches ${JSON.stringify(target)}`);
  }
});
