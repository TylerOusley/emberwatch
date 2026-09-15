import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createHorseModel, createHorseResources } from '../public/src/horse-model.js';

test('horse coat is one connected sculpted surface with normalized bone influences', () => {
  const resources = createHorseResources(), horse = createHorseModel('anatomy', resources);
  const meshes = horse.group.children.filter(child => child.isSkinnedMesh);
  assert.equal(meshes.length, 2, 'shared coat and detail meshes keep draw calls bounded');
  assert.ok(meshes.reduce((n, mesh) => n + mesh.geometry.attributes.position.count / 3, 0) < 40000);
  for (const mesh of meshes) {
    for (const attribute of Object.values(mesh.geometry.attributes)) assert.ok(attribute.array.every(Number.isFinite));
    const weights = mesh.geometry.attributes.skinWeight, indices = mesh.geometry.attributes.skinIndex;
    for (let i = 0; i < weights.count; i++) {
      const w = [weights.getX(i), weights.getY(i), weights.getZ(i), weights.getW(i)];
      assert.ok(w.every(v => v >= 0 && v <= 1));
      assert.ok(Math.abs(w.reduce((sum, value) => sum + value, 0) - 1) < 1e-5);
      assert.ok([indices.getX(i), indices.getY(i), indices.getZ(i), indices.getW(i)].every(v => v < horse.skeleton.bones.length));
    }
  }
  // Weld the export's duplicated triangle vertices and verify the neck, head,
  // shoulders, knees and hooves really share a surface rather than overlap.
  const p = resources.coat.attributes.position, nodes = new Map(), parents = [];
  const find = i => parents[i] === i ? i : (parents[i] = find(parents[i]));
  function index(i) {
    const key = [p.getX(i), p.getY(i), p.getZ(i)].map(v => Math.round(v * 100000)).join(',');
    if (!nodes.has(key)) { nodes.set(key, parents.length); parents.push(parents.length); }
    return nodes.get(key);
  }
  for (let i = 0; i < p.count; i += 3) {
    const a = index(i), b = index(i + 1), c = index(i + 2);
    parents[find(b)] = find(a); parents[find(c)] = find(a);
  }
  assert.equal(new Set(parents.map((_, i) => find(i))).size, 1, 'all coat anatomy is connected');
  horse.dispose(); resources.dispose();
});

test('independent horse skeletons stay finite through trot, cart pulling and idle away from the origin', () => {
  const resources = createHorseResources(), horse = createHorseModel('motion', resources);
  horse.group.position.set(32, 0, -47); horse.group.rotation.y = 1.2;
  for (const rate of [30, 60, 120]) for (const options of [{ moving: true }, { moving: true, cartId: 'cart' }, { moving: false }]) {
    for (let frame = 0; frame < rate; frame++) {
      horse.update(1 / rate, frame / rate, options); horse.group.updateMatrixWorld(true); horse.skeleton.update();
      assert.ok(horse.skeleton.boneMatrices.every(Number.isFinite));
      if (frame % 10) continue;
      const bounds = new THREE.Box3();
      horse.group.traverse(mesh => {
        if (!mesh.isSkinnedMesh) return;
        for (let i = 0; i < mesh.geometry.attributes.position.count; i += 113) {
          const p = mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
          assert.ok(p.toArray().every(Number.isFinite)); bounds.expandByPoint(p);
        }
      });
      assert.ok(bounds.min.x > 28 && bounds.max.x < 36, 'skin and tack remain attached at a world offset');
      assert.ok(bounds.min.z > -51 && bounds.max.z < -43);
      assert.ok(bounds.min.y > -.12 && bounds.max.y < 3.7, 'hooves and head retain plausible bounds');
    }
  }
  for (let frame = 0; frame < 120; frame++) horse.update(1 / 60, frame / 60, { moving: false });
  assert.ok(horse.legs.every(leg => Math.abs(leg.upper.rotation.x) < .0001), 'legs settle after stopping');
  horse.dispose(); resources.dispose();
});

test('removing a horse disposes its skeleton without disposing another horse shared assets', () => {
  const resources = createHorseResources(), first = createHorseModel('first', resources), second = createHorseModel('second', resources);
  let geometryDisposed = 0, materialDisposed = 0, skeletonDisposed = 0;
  resources.coat.addEventListener('dispose', () => geometryDisposed++);
  resources.tack.addEventListener('dispose', () => geometryDisposed++);
  resources.material.addEventListener('dispose', () => materialDisposed++);
  const dispose = first.skeleton.dispose.bind(first.skeleton);
  first.skeleton.dispose = () => { skeletonDisposed++; dispose(); };
  assert.notEqual(first.skeleton, second.skeleton);
  first.dispose(); first.dispose();
  assert.equal(skeletonDisposed, 1); assert.equal(geometryDisposed, 0); assert.equal(materialDisposed, 0);
  second.update(1 / 60, 1, { moving: true }); second.group.updateMatrixWorld(true); second.skeleton.update();
  assert.ok(second.skeleton.boneMatrices.every(Number.isFinite));
  second.dispose(); resources.dispose(); resources.dispose();
  assert.equal(geometryDisposed, 2); assert.equal(materialDisposed, 1);
});

test('mounted horses use the rider rendered transform while dismounted and stable horses remain independent', async () => {
  const threeURL = new URL('../node_modules/three/build/three.module.js', import.meta.url).href;
  const sharedURL = new URL('../shared/world.js', import.meta.url).href;
  const horseURL = new URL('../public/src/horse-model.js', import.meta.url).href;
  const merchantURL = new URL('../public/src/merchant-model.js', import.meta.url).href;
  const source = readFileSync(new URL('../public/src/transport-world.js', import.meta.url), 'utf8')
    .replace("'three'", JSON.stringify(threeURL)).replace("'/shared/world.js'", JSON.stringify(sharedURL)).replace("'./horse-model.js'", JSON.stringify(horseURL)).replace("'./merchant-model.js'", JSON.stringify(merchantURL));
  const { createTransportWorld } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const scene = new THREE.Scene(), world = createTransportWorld(scene);
  const state = { horses: [{ id: 'ridden', riderId: 'player', x: 0, z: 0, yaw: 0, moving: true }], carts: [], stable: { stock: 1 } };
  const riders = new Map([['player', { x: 3, z: -4, yaw: 1.1 }]]);
  world.update(state, 1 / 60, riders);
  const horse = world.root.getObjectByName('horse-ridden'), stable = world.root.getObjectByName('horse-stable-stock-0');
  const stablePosition = stable.position.clone();
  for (const pose of [{ x: 3.17, z: -4.11, yaw: 1.18 }, { x: 3.4, z: -4.22, yaw: -3.13 }, { x: 3.4, z: -4.22, yaw: 3.13 }]) {
    riders.set('player', pose); world.update(state, 1 / 60, riders);
    assert.equal(horse.position.x, pose.x); assert.equal(horse.position.z, pose.z); assert.equal(horse.rotation.y, pose.yaw);
    assert.deepEqual(stable.position.toArray(), stablePosition.toArray());
  }
  state.horses[0] = { id: 'ridden', x: 5, z: -4, yaw: 0, moving: false };
  world.update(state, 1 / 60, riders);
  assert.ok(horse.position.x > 3.4 && horse.position.x < 5, 'unmounted horse resumes normal interpolation');
  const actor = horse.userData.actor;
  let disposed = 0; const dispose = actor.skeleton.dispose.bind(actor.skeleton);
  actor.skeleton.dispose = () => { disposed++; dispose(); };
  state.horses = []; world.update(state, 1 / 60, riders);
  assert.equal(world.root.getObjectByName('horse-ridden'), undefined);
  assert.equal(disposed, 1, 'removing an entity frees its independent skeleton');
  world.dispose();
});
