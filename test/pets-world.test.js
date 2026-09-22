import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPetWorld, PET_HEIGHTS, PET_RENDER_LIMITS } from '../public/src/pets-world.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
const actor = (id, speciesId = 'wolf', extra = {}) => ({ id, ownerId: `owner-${id}`, speciesId, x: 0, z: 0, yaw: 0, anim: 'idle', ...extra });
const groups = world => world.root.getObjectByName('pet-models').children;
const bolts = world => world.root.getObjectByName('pet-projectiles').children.filter(group => group.visible);
function mesh(group) { let found; group.traverse(object => { if (object.isSkinnedMesh) found = object; }); return found; }
function asset({ attack = true } = {}) {
  const scene = new THREE.Group(), geometry = new THREE.BoxGeometry(1, 2, 1);
  const indices = [], weights = [];
  for (let i = 0; i < geometry.attributes.position.count; i++) { indices.push(geometry.attributes.position.getY(i) > 0 ? 1 : 0, 0, 0, 0); weights.push(1, 0, 0, 0); }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4)); geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const texture = new THREE.DataTexture(new Uint8Array([220, 190, 140, 255]), 1, 1);
  const material = new THREE.MeshStandardMaterial({ color: '#c5b290', map: texture, roughness: .7 });
  const body = new THREE.SkinnedMesh(geometry, material), base = new THREE.Bone(), tip = new THREE.Bone();
  base.name = 'RootBone'; tip.name = 'TipBone'; tip.position.y = .5; base.add(tip); body.add(base); body.bind(new THREE.Skeleton([base, tip]));
  scene.position.set(3, 4, 5); scene.add(body);
  const clip = (name, angle) => {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle);
    return new THREE.AnimationClip(name, 1, [new THREE.QuaternionKeyframeTrack('TipBone.quaternion', [0, .5, 1], [0, 0, 0, 1, ...q.toArray(), 0, 0, 0, 1])]);
  };
  return { scene, animations: [clip('idle', .05), clip('walk', .8), ...(attack ? [clip('attack', 1.2)] : [])], geometry, material, texture };
}

test('pets share one GLTF request and source materials while skeletons and animation mixers stay independent', async () => {
  const scene = new THREE.Scene(), original = asset(), requests = [];
  const world = createPetWorld(scene, { loadAsset: async url => { requests.push(url); return original; } });
  const pets = [actor('one'), actor('two', 'wolf', { x: 4, anim: 'walk' })];
  world.update(pets, 0, 0); await flush();
  for (let frame = 0; frame < 5; frame++) world.update(pets, frame * .05, .05);
  assert.deepEqual(requests, ['/assets/pets/wolf/model.glb']);
  const [a, b] = groups(world).map(mesh);
  assert.notEqual(a, b); assert.notEqual(a.skeleton, b.skeleton);
  assert.notEqual(a.skeleton.bones[1], b.skeleton.bones[1]);
  assert.equal(a.geometry, original.geometry); assert.equal(b.geometry, original.geometry);
  assert.equal(a.material, original.material); assert.equal(b.material.map, original.texture);
  assert.notDeepEqual(a.skeleton.bones[1].quaternion.toArray(), b.skeleton.bones[1].quaternion.toArray());
  const ownBone = a.skeleton.bones[1].quaternion.clone(); b.skeleton.bones[1].rotation.z = 2;
  assert.deepEqual(a.skeleton.bones[1].quaternion.toArray(), ownBone.toArray(), 'one pet cannot animate its neighbor');
  const before = groups(world).slice();
  for (let frame = 0; frame < 100; frame++) world.update(pets, 1 + frame / 60, 1 / 60);
  assert.deepEqual(groups(world), before, 'snapshots do not rebuild the model');
  assert.equal(requests.length, 1); world.dispose();
});

test('normalization preserves the original rig transform and gives ground and flying species distinct terrain-relative heights', async () => {
  const world = createPetWorld(new THREE.Scene(), { loadAsset: async () => asset(), terrainHeight: () => -8, inCave: () => true });
  const pets = [actor('rabbit', 'rabbit'), actor('dragon', 'dragon', { x: 3 }), actor('dog', 'husky', { x: 6 }), actor('owl', 'owl', { x: 9 })];
  world.update(pets, 0, 0); await flush(); world.update(pets, 0, 0, { reducedMotion: true });
  for (const group of groups(world)) {
    group.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(group), species = group.name.slice(4), flying = species === 'owl';
    assert.ok(Math.abs(bounds.max.y - bounds.min.y - PET_HEIGHTS[species]) < 1e-6);
    assert.ok(Math.abs(bounds.min.y - (-8 + .02 + (flying ? .8 : 0))) < 1e-6, `${species} minimum ${bounds.min.y}, expected ${-8 + .02 + (flying ? .8 : 0)}`);
    assert.ok(bounds.max.y < -5, 'flying pets remain below the conservative cave envelope');
    assert.deepEqual(mesh(group).parent.position.toArray(), [3, 4, 5], 'normalization lives outside the authored model transform');
  }
  world.update([actor('owl', 'owl', { x: 9, yaw: Math.PI / 2 })], 1, .1);
  const owl = groups(world)[0]; assert.ok(owl.position.y > -7.3 && owl.position.y < -7.1);
  assert.ok(owl.rotation.y > 0 && owl.rotation.y < Math.PI / 2, 'yaw interpolates instead of snapping');
  world.dispose();
});

test('removing a pet disposes its skeleton without invalidating cached assets needed by another pet or a later rejoin', async () => {
  const original = asset(), disposed = { geometry: 0, material: 0, texture: 0, bone: 0 }; let requests = 0;
  for (const key of ['geometry', 'material', 'texture']) original[key].addEventListener('dispose', () => disposed[key]++);
  const world = createPetWorld(new THREE.Scene(), { loadAsset: async () => { requests++; return original; } });
  world.update([actor('one'), actor('two')], 0, 0); await flush();
  const first = mesh(groups(world)[0]); first.skeleton.computeBoneTexture(); first.skeleton.boneTexture.addEventListener('dispose', () => disposed.bone++);
  world.update([actor('two')], .1, .1);
  assert.deepEqual(disposed, { geometry: 0, material: 0, texture: 0, bone: 1 });
  world.clear(); assert.equal(groups(world).length, 0);
  world.update([actor('three')], 0, 0); await flush(); assert.equal(requests, 1); assert.ok(groups(world)[0].visible);
  world.dispose(); world.dispose();
  assert.deepEqual(disposed, { geometry: 1, material: 1, texture: 1, bone: 1 });
});

test('clear, species switches and disposal cannot attach a stale asynchronous model', async () => {
  const pending = new Map(), scene = new THREE.Scene();
  const world = createPetWorld(scene, { loadAsset: url => new Promise(resolve => pending.set(url, resolve)) });
  world.update([actor('one')], 0, 0); await flush(); world.clear();
  world.update([actor('one', 'fox')], 0, 0); await flush();
  pending.get('/assets/pets/wolf/model.glb')(asset()); await flush();
  assert.equal(groups(world).length, 1); assert.equal(groups(world)[0].name, 'pet-fox'); assert.equal(groups(world)[0].visible, false);
  const late = asset(); let released = 0; late.geometry.addEventListener('dispose', () => released++);
  world.dispose(); pending.get('/assets/pets/fox/model.glb')(late); await flush();
  assert.equal(released, 1); assert.equal(scene.getObjectByName('pet-companions'), undefined);
  world.update([actor('ignored')], 10, .1); assert.equal(scene.children.length, 0);
});

test('failed assets stay absent and retry once after the delay without repeated requests or placeholder models', async () => {
  let time = 0, requests = 0; const failures = [];
  const world = createPetWorld(new THREE.Scene(), { now: () => time, onAssetError: error => failures.push(error),
    loadAsset: async () => { if (++requests === 1) throw new Error('temporary asset failure'); return asset(); } });
  const pets = [actor('one')]; world.update(pets, 0, 0); await flush();
  for (let i = 0; i < 100; i++) world.update(pets, i / 60, 1 / 60);
  assert.equal(requests, 1); assert.equal(failures.length, 1); assert.equal(groups(world)[0].visible, false);
  assert.equal(mesh(groups(world)[0]), undefined);
  time = PET_RENDER_LIMITS.retrySeconds; world.update(pets, 10, .1); await flush();
  assert.equal(requests, 2); assert.equal(groups(world)[0].visible, true); world.dispose();
});

test('ranged intents launch and expire at server times, deduplicate snapshots, and stop immediately when cancelled', async () => {
  const world = createPetWorld(new THREE.Scene(), { loadAsset: async () => asset() });
  const attack = { id: 'fire-one', kind: 'ranged', projectile: 'fire', at: 10, launchAt: 10.35, impactAt: 10.65, until: 10.95,
    from: { x: 0, y: 1.6, z: 0 }, to: { x: 9, y: 1, z: 0 } };
  const pet = actor('dragon', 'dragon', { anim: 'attack', lastAttack: attack });
  world.update([pet], 10, 0); await flush(); assert.equal(bolts(world).length, 0);
  world.update([pet], 10.35, .1); assert.equal(bolts(world).length, 1); assert.equal(bolts(world)[0].position.x, 0);
  world.update([pet], 10.5, .1); assert.equal(bolts(world).length, 1); assert.ok(Math.abs(bolts(world)[0].position.x - 4.5) < 1e-6);
  world.update([{ ...pet, lastAttack: { ...attack, cancelled: true, until: 10.51 } }], 10.51, .01);
  assert.equal(bolts(world).length, 0);
  world.update([pet], 10.55, .04); assert.equal(bolts(world).length, 0, 'the same stale intent cannot restart a cancelled projectile');
  const next = { ...attack, id: 'fire-two', at: 12, launchAt: 12.35, impactAt: 12.65, until: 12.95 };
  world.update([{ ...pet, lastAttack: next }], 12.5, .1); assert.equal(bolts(world).length, 1);
  world.update([{ ...pet, lastAttack: next }], 12.65, .1); assert.equal(bolts(world).length, 0);
  world.update([pet], 13, .1); assert.equal(bolts(world).length, 0, 'old snapshot events do not replay after impact');
  world.dispose();
});

test('attack clips finish and return to idle; missing clips use only a restrained motion of the actual model', async () => {
  const world = createPetWorld(new THREE.Scene(), { loadAsset: async url => asset({ attack: !url.includes('/griffin/') }) });
  const shot = { id: 'bite', kind: 'melee', at: 1, impactAt: 1.35, until: 1.65 };
  const pets = [actor('wolf'), actor('griffin', 'griffin')];
  world.update(pets, 0, 0); await flush();
  world.update(pets.map(p => ({ ...p, anim: 'attack', lastAttack: shot })), 1.3, .1);
  assert.ok(mesh(groups(world)[0]).skeleton.bones[1].rotation.z > .3, 'the rig plays its authored attack clip');
  assert.ok(groups(world)[1].children[0].position.z > .1, 'a missing attack clip uses a small model swoop');
  world.update(pets, 2, .1); world.update(pets, 2.1, .1); world.update(pets, 2.2, .1);
  assert.ok(Math.abs(mesh(groups(world)[0]).skeleton.bones[1].rotation.z) < .1);
  assert.deepEqual(groups(world)[1].children[0].position.toArray(), [0, 0, 0]); world.dispose();
});

test('actor and projectile allocations stay bounded across crowded snapshots and unknown species are ignored', async () => {
  const world = createPetWorld(new THREE.Scene(), { loadAsset: async () => asset() });
  const pets = Array.from({ length: 30 }, (_, i) => actor(String(i), 'owl', { x: i }));
  world.update([{ ...actor('bad'), speciesId: '__proto__' }, ...pets], 0, 0); await flush();
  assert.equal(groups(world).length, PET_RENDER_LIMITS.actors);
  const pool = world.root.getObjectByName('pet-projectiles'), meshes = pool.children.slice();
  for (let frame = 0; frame < 80; frame++) {
    const time = frame * .01;
    world.update(pets.map(p => ({ ...p, lastAttack: { id: `${p.id}:${frame}`, kind: 'ranged', projectile: 'wind', at: time,
      launchAt: time, impactAt: time + .3, until: time + .6, from: { x: p.x, z: 0 }, to: { x: p.x, z: 4 } } })), time, .01);
    assert.ok(bolts(world).length <= PET_RENDER_LIMITS.projectiles);
  }
  assert.deepEqual(pool.children, meshes);
  let lights = 0; world.root.traverse(object => { if (object.isLight) lights++; }); assert.equal(lights, 0);
  world.clear(); assert.equal(bolts(world).length, 0); world.dispose();
});
