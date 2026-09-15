import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { BUILDINGS, RESOURCES } from '../shared/world.js';
import { createHorseModel, createHorseResources } from '../public/src/horse-model.js';
import { createCharacter } from '../public/src/characters.js';
import { createMerchantVisit } from '../public/src/merchant-model.js';

const stall = BUILDINGS.find(b => b.id === 'merchant');
const bounds = object => new THREE.Box3().setFromObject(object);
async function transportModule() {
  const urls = {
    three: '../node_modules/three/build/three.module.js', '/shared/world.js': '../shared/world.js',
    './horse-model.js': '../public/src/horse-model.js', './merchant-model.js': '../public/src/merchant-model.js'
  };
  let source = readFileSync(new URL('../public/src/transport-world.js', import.meta.url), 'utf8');
  for (const [specifier, path] of Object.entries(urls)) source = source.replace(`'${specifier}'`, JSON.stringify(new URL(path, import.meta.url).href));
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}

test('merchant, team and carriage appear together from authoritative presence, including rejoining an active visit', async () => {
  const { createTransportWorld } = await transportModule();
  const scene = new THREE.Scene(), world = createTransportWorld(scene);
  const state = { merchant: { present: false }, stable: { stock: 1 }, horses: [], carts: [] };
  world.update(state); assert.equal(world.root.getObjectByName('merchant-visit'), undefined);
  state.merchant.present = true; const saved = JSON.stringify(state); world.update(state);
  const visit = world.root.getObjectByName('merchant-visit');
  assert.ok(visit?.visible); assert.ok(visit.getObjectByName('wayfarer-merchant'));
  assert.ok(visit.getObjectByName('wayfarer-carriage'));
  assert.equal(visit.children.filter(child => child.name.startsWith('horse-wayfarer-team-')).length, 2);
  assert.equal(JSON.stringify(state), saved, 'decorations never create purchasable horses or modify server state');
  for (const presence of [false, true, false, true]) {
    state.merchant.present = presence; world.update(state);
    assert.equal(visit.visible, presence); assert.equal(world.root.getObjectByName('merchant-visit'), visit, 'successive visits reuse geometry');
    assert.ok(world.root.getObjectByName('horse-stable-stock-0').visible, 'merchant departure leaves stable stock alone');
  }
  delete state.merchant; world.update(state); assert.equal(visit.visible, false);
  state.merchant = { present: true }; world.update(state); world.update(null); assert.equal(visit.visible, false);
  world.dispose(); world.dispose(); assert.equal(scene.children.length, 0);
  const rejoined = createTransportWorld(scene); rejoined.update(state);
  assert.ok(rejoined.root.getObjectByName('merchant-visit')?.visible, 'joining mid-visit creates the caravan immediately');
  rejoined.dispose();
});

test('parked caravan keeps the stall frontage, streets, buildings and public minerals clear', () => {
  const resources = createHorseResources(), visit = createMerchantVisit(stall, resources);
  visit.update(1 / 60, 1); visit.group.updateMatrixWorld(true);
  const merchantBounds = bounds(visit.merchant.group);
  assert.ok(merchantBounds.min.y >= 1.275 && merchantBounds.min.y < 1.32, 'feet stand on the existing platform');
  assert.ok(merchantBounds.max.y < 3.7, 'merchant remains below the stall sign and canopy');
  assert.ok(merchantBounds.max.x < stall.x + stall.w / 2, 'merchant stays behind the front edge');
  for (const object of [visit.carriage, ...visit.horses.map(h => h.group)]) {
    const box = bounds(object);
    assert.ok(box.min.y >= -.01, 'wheels and hooves stay above the ground');
    assert.ok(box.max.x < -8.5 && box.max.z < -72.8, 'park north of the stall, away from the entry road and central square');
    for (const building of BUILDINGS) {
      const solid = new THREE.Box3(new THREE.Vector3(building.x - building.w / 2 - .5, -1, building.z - building.d / 2 - .5), new THREE.Vector3(building.x + building.w / 2 + .5, 10, building.z + building.d / 2 + .5));
      assert.ok(!box.intersectsBox(solid), `${object.name} clears ${building.id}`);
    }
    for (const resource of RESOURCES.filter(r => r.type === 'iron' || r.type === 'coal')) {
      const distance = box.distanceToPoint(new THREE.Vector3(resource.x, box.min.y, resource.z));
      assert.ok(distance > 2.8, `${object.name} leaves room to gather ${resource.id}`);
    }
  }
  const meshes = []; visit.carriage.traverse(mesh => { if (mesh.isMesh) meshes.push(mesh); });
  assert.ok(meshes.length <= 10, 'static caravan details batch into a bounded number of draw calls');
  for (const { geometry } of meshes) for (const attribute of Object.values(geometry.attributes)) assert.ok(attribute.array.every(Number.isFinite));
  visit.dispose(); resources.dispose();
});

test('merchant clothing and disposal leave shared villager and horse assets intact', () => {
  const resources = createHorseResources(), otherHorse = createHorseModel('owned-horse', resources), resident = createCharacter('villager', 17);
  const visit = createMerchantVisit(stall, resources), regularShirts = new Set(), merchantColors = new Set();
  resident.group.traverse(mesh => { if (mesh.isMesh && mesh.material.color?.getHex() === 0x60765b) regularShirts.add(mesh.material); });
  visit.merchant.group.traverse(mesh => { if (mesh.isMesh) merchantColors.add(mesh.material.color?.getHex()); });
  assert.ok(regularShirts.size); assert.ok(!merchantColors.has(0x60765b)); assert.ok(merchantColors.has(new THREE.Color('#79617f').getHex()));
  let sharedDisposed = 0, skeletonsDisposed = 0, ownedDisposed = 0;
  for (const asset of [resources.coat, resources.tack, resources.material, ...regularShirts]) asset.addEventListener('dispose', () => sharedDisposed++);
  const staticGeometries = new Set(); visit.carriage.traverse(mesh => { if (mesh.isMesh) staticGeometries.add(mesh.geometry); });
  for (const geometry of staticGeometries) geometry.addEventListener('dispose', () => ownedDisposed++);
  for (const horse of visit.horses) {
    const dispose = horse.skeleton.dispose.bind(horse.skeleton); horse.skeleton.dispose = () => { skeletonsDisposed++; dispose(); };
  }
  for (let frame = 0; frame < 30; frame++) visit.update(1 / 30, frame / 30);
  visit.group.updateMatrixWorld(true);
  for (const horse of visit.horses) { horse.skeleton.update(); assert.ok(horse.skeleton.boneMatrices.every(Number.isFinite)); }
  visit.dispose(); visit.dispose(); assert.equal(skeletonsDisposed, 2); assert.equal(ownedDisposed, staticGeometries.size); assert.equal(sharedDisposed, 0);
  assert.ok([...regularShirts].every(material => material.color.getHex() === 0x60765b), 'villagers retain their original clothing');
  resident.update(1 / 60, 1); otherHorse.update(1 / 60, 1); otherHorse.group.updateMatrixWorld(true); otherHorse.skeleton.update();
  assert.ok(otherHorse.skeleton.boneMatrices.every(Number.isFinite));
  resident.dispose(); otherHorse.dispose(); resources.dispose();
});
