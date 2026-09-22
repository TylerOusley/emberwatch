import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import { PET_CATALOG } from '../shared/pets.js';
import { createPetWorld, PET_HEIGHTS, PET_MAX_SPANS } from '../public/src/pets-world.js';

// Node does not expose the browser image-decoding API. Supply that boundary
// with actual decoded PNG/JPEG pixels; GLTFLoader, material/UV assignment,
// skinning, cloning and animation below are the production Three modules.
const originalSelf = globalThis.self, originalBitmap = globalThis.createImageBitmap;
globalThis.self = globalThis;
globalThis.createImageBitmap = async blob => {
  const bytes = Buffer.from(await blob.arrayBuffer());
  const image = bytes.subarray(1, 4).toString() === 'PNG' ? PNG.sync.read(bytes) : jpeg.decode(bytes, { useTArray: true });
  assert.ok(image.width > 0 && image.height > 0 && image.data.length === image.width * image.height * 4);
  return { width: image.width, height: image.height, data: image.data, decodedPixels: true, close() { this.closed = true; } };
};
test.after(() => {
  if (originalSelf === undefined) delete globalThis.self; else globalThis.self = originalSelf;
  if (originalBitmap === undefined) delete globalThis.createImageBitmap; else globalThis.createImageBitmap = originalBitmap;
});
const flush = () => new Promise(resolve => setImmediate(resolve));
const point = new THREE.Vector3();

function documentFor(bytes) {
  assert.equal(bytes.toString('utf8', 0, 4), 'glTF'); assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const jsonLength = bytes.readUInt32LE(12); assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
  return JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength).trim());
}
function meshesOf(scene) { const meshes = []; scene.traverse(object => { if (object.isSkinnedMesh) meshes.push(object); }); return meshes; }
function sample(scene, meshes) {
  scene.updateMatrixWorld(true); for (const mesh of meshes) mesh.skeleton.update();
  const coordinates = [];
  for (const mesh of meshes) {
    const count = mesh.geometry.attributes.position.count, step = Math.max(1, Math.floor(count / 96));
    for (let i = 0; i < count; i += step) { mesh.getVertexPosition(i, point); point.applyMatrix4(mesh.matrixWorld); coordinates.push(point.x, point.y, point.z); }
  }
  return coordinates;
}

for (const [id, definition] of Object.entries(PET_CATALOG)) {
  test(`pet asset ${id} loads its real rig, materials, images and separate animated clips`, async () => {
    const directory = new URL(`../public/assets/pets/${definition.assetId}/`, import.meta.url);
    const bytes = await readFile(new URL('model.glb', directory));
    const provenance = JSON.parse(await readFile(new URL('provenance.json', directory), 'utf8'));
    assert.equal(provenance.assetId, definition.assetId); assert.equal(provenance.model, 'model.glb');
    assert.equal(provenance.modelBytes, bytes.length);
    assert.equal(provenance.modelSha256, createHash('sha256').update(bytes).digest('hex'));
    assert.ok(provenance.license && provenance.authors?.length && provenance.sourceUrls?.some(url => /^https:\/\//.test(url)));
    assert.equal(provenance.normalization?.up, '+Y'); assert.equal(provenance.normalization?.forward, '+Z');
    const thumbnail = PNG.sync.read(await readFile(new URL('thumbnail.png', directory)));
    assert.ok(thumbnail.width >= 128 && thumbnail.height >= 128);
    assert.ok(thumbnail.data.some((value, index) => index % 4 === 3 && value > 0), 'thumbnail contains rendered visible pixels');

    const json = documentFor(bytes);
    assert.ok(json.meshes?.length > 0 && json.skins?.length > 0);
    assert.ok((json.buffers ?? []).every(buffer => !buffer.uri), 'model must not depend on missing external binary files');
    assert.ok((json.images ?? []).every(image => Number.isInteger(image.bufferView) && !image.uri), 'images must be embedded in the model');
    assert.ok(!(json.extensionsRequired ?? []).some(extension => ['KHR_draco_mesh_compression', 'KHR_texture_basisu', 'EXT_meshopt_compression'].includes(extension)), 'pet models require no unconfigured decoder');
    for (const texture of json.textures ?? []) assert.ok(Number.isInteger(texture.source) && json.images?.[texture.source]);
    const manager = new THREE.LoadingManager();
    manager.setURLModifier(url => { assert.ok(url.startsWith('blob:') || url.startsWith('data:'), `unexpected external dependency: ${url}`); return url; });
    const gltf = await new GLTFLoader(manager).parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    const meshes = meshesOf(gltf.scene); assert.ok(meshes.length > 0);
    assert.ok(meshes.reduce((count, mesh) => count + mesh.geometry.attributes.position.count, 0) > 100, 'selected pets retain their real animal mesh');
    const maps = new Set();
    for (const mesh of meshes) {
      assert.ok(mesh.skeleton.bones.length > 1); assert.ok(mesh.geometry.attributes.skinIndex && mesh.geometry.attributes.skinWeight);
      const weights = mesh.geometry.attributes.skinWeight;
      for (let i = 0; i < weights.count; i += Math.max(1, Math.floor(weights.count / 100))) {
        const total = weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i);
        assert.ok(Number.isFinite(total) && Math.abs(total - 1) < .02, 'skin weights remain normalized');
      }
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        assert.ok(material?.isMaterial);
        for (const value of Object.values(material)) if (value?.isTexture) maps.add(value);
      }
    }
    if (json.textures?.length) {
      assert.ok(maps.size > 0, 'original embedded textures remain assigned to their materials');
      for (const map of maps) {
        assert.equal(map.image?.decodedPixels, true);
        assert.equal(map.image.data.length, map.image.width * map.image.height * 4);
      }
    } else assert.ok(provenance.surfaceNotes?.includes('no image textures'), 'untextured sources document their authored material colors');

    const cloned = cloneSkeleton(gltf.scene), clonedMeshes = meshesOf(cloned);
    assert.notEqual(clonedMeshes[0].skeleton, meshes[0].skeleton);
    assert.notEqual(clonedMeshes[0].skeleton.bones[0], meshes[0].skeleton.bones[0]);
    assert.equal(clonedMeshes[0].geometry, meshes[0].geometry); assert.equal(clonedMeshes[0].material, meshes[0].material);
    const mixer = new THREE.AnimationMixer(cloned);
    const requiredClips = ['idle', 'walk', ...(definition.attack ? ['attack'] : [])];
    const staticClips = [];
    for (const name of requiredClips) {
      const clip = gltf.animations.find(clip => clip.name === name);
      assert.ok(clip?.duration > 0 && clip.tracks.length > 0, `${name} is a separate nonempty clip`);
      mixer.stopAllAction(); const action = mixer.clipAction(clip); action.reset().play(); mixer.setTime(0);
      const initial = sample(cloned, clonedMeshes); let movement = 0;
      for (const fraction of [.17, .39, .67, .89]) {
        mixer.setTime(clip.duration * fraction); const moved = sample(cloned, clonedMeshes);
        for (let i = 0; i < moved.length; i++) {
          assert.ok(Number.isFinite(moved[i]), 'animated skinned vertices must remain finite');
          movement = Math.max(movement, Math.abs(moved[i] - initial[i]));
        }
      }
      if (movement <= .00001) staticClips.push(name);
    }
    assert.deepEqual(staticClips, [], 'every required clip must deform the actual skinned mesh, not merely be renamed');
    mixer.stopAllAction(); mixer.uncacheRoot(cloned);
    for (const mesh of clonedMeshes) mesh.skeleton.dispose();

    // Exercise the exact production loader result inside the production world
    // renderer, including normalization and an independent animated clone.
    const world = createPetWorld(new THREE.Scene(), { loadAsset: async () => gltf, terrainHeight: () => 0, inCave: () => false });
    const entity = { id: `asset:${id}`, ownerId: 'tester', speciesId: id, x: 0, z: 0, yaw: 0, anim: 'idle' };
    world.update([entity], 0, 0); await flush(); world.update([entity], 0, 0, { reducedMotion: true });
    const actor = world.root.getObjectByName('pet-models').children[0]; assert.equal(actor.visible, true);
    actor.updateMatrixWorld(true); for (const mesh of meshesOf(actor)) mesh.computeBoundingBox();
    const bounds = new THREE.Box3().setFromObject(actor);
    assert.ok(Number.isFinite(bounds.min.y) && bounds.max.y > bounds.min.y);
    if (PET_MAX_SPANS[id]) {
      assert.ok(Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) <= PET_MAX_SPANS[id] * 1.03, `${id} wingspan stays within its companion-size budget`);
      assert.ok(bounds.max.y - bounds.min.y > .07 && bounds.max.y - bounds.min.y <= PET_HEIGHTS[id] * 1.25);
    } else assert.ok(Math.abs(bounds.max.y - bounds.min.y - PET_HEIGHTS[id]) < PET_HEIGHTS[id] * .25, `${id} stays near its intended displayed size`);
    assert.ok(Math.abs(bounds.min.y - (definition.flying ? .82 : .02)) < .22, `${id} rests near its terrain or hover plane`);
    world.dispose();
  });
}
