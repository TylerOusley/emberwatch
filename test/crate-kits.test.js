import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createKit } from '../public/src/crate-kits.js';

const specs = [
  ['hearth_ration_kit', 'basic', null, 'food'],
  ['tradesmans_kit', 'rare', 'wood', 'food'],
  ['prospectors_kit', 'epic', 'stone', 'good_food'],
  ['master_expedition_kit', 'legendary', 'iron', 'best_food']
];
const drawables = root => { const result = []; root.traverse(o => { if (o.isMesh || o.isPoints) result.push(o); }); return result; };
const components = root => drawables(root).flatMap(o => o.userData.components ?? []);

test('all kit/tool choices expose the exact food and tool, with centered finite bounded artwork', () => {
  const signatures = new Set();
  for (const [id, tier, toolTier, food] of specs) for (const tool of ['axe', 'pickaxe', 'scythe']) {
    const kit = createKit(id, { tool }), [{ bone, object: root }] = kit.parts;
    assert.equal(kit.parts.length, 1); assert.equal(bone, null); assert.ok(root.isGroup);
    assert.equal(root.userData.itemId, id); assert.equal(root.userData.tier, tier); assert.equal(root.userData.displayOnly, true);
    assert.equal(root.userData.tool, toolTier ? tool : null);
    assert.equal(root.userData.contents.find(item => item.item === food)?.quantity, 2);
    assert.equal(root.userData.contents.length, toolTier ? 2 : 1);
    if (toolTier) {
      assert.equal(root.userData.contents.find(item => item.item === `${toolTier}_${tool}`)?.quantity, 1);
      assert.ok(components(root).some(name => name.startsWith(`${toolTier}-${tool}-`)));
      assert.ok(!components(root).some(name => ['axe', 'pickaxe', 'scythe'].filter(t => t !== tool).some(t => name.startsWith(`${toolTier}-${t}-`))));
      signatures.add(JSON.stringify(drawables(root).map(o => Array.from(o.geometry.attributes.position.array))));
    }
    const meshes = drawables(root); assert.ok(meshes.length <= 16); assert.ok(meshes.length >= 5);
    let vertices = 0;
    root.traverse(o => assert.ok(!o.isLight));
    for (const mesh of meshes) {
      for (const attribute of Object.values(mesh.geometry.attributes)) assert.ok(attribute.array.every(Number.isFinite));
      assert.equal(mesh.geometry.index, null); vertices += mesh.geometry.attributes.position.count;
      assert.ok(mesh.material.name); assert.equal(mesh.material.map, null);
    }
    assert.ok(vertices < 100_000, `${id} ${tool} has ${vertices} vertices`);
    const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3());
    assert.ok(box.getCenter(new THREE.Vector3()).length() < 1e-6);
    assert.ok(Math.abs(Math.max(size.x, size.y, size.z) - 1.1) < 1e-5);
    assert.ok(size.x > .6 && size.y > .3 && size.z > .3);
    kit.dispose();
  }
  assert.equal(signatures.size, 9, 'each material tier and chosen tool produces its own geometry');
});

test('Phoenix has a bird silhouette, one heart and bounded motion that respects reduced motion and external transforms', () => {
  const model = createKit('phoenix_ember'), root = model.parts[0].object;
  assert.deepEqual(root.userData.contents, [{ item: 'phoenix_ember', quantity: 1 }]);
  assert.equal(components(root).filter(name => name === 'single-living-ember-heart').length, 1);
  assert.equal(components(root).filter(name => name.startsWith('phoenix-wing-')).length, 10);
  assert.ok(drawables(root).length <= 16);
  const sparks = root.getObjectByName('twelve-ember-sparks'); assert.equal(sparks.geometry.attributes.position.count, 12);
  const geometry = sparks.geometry, attr = geometry.attributes.position;
  root.position.set(4, 5, 6); root.rotation.set(.1, .2, .3); root.scale.setScalar(2);
  const before = root.matrix.clone(); root.updateMatrix(); const placement = root.matrix.clone();
  for (const time of [0, 1, 90, 100000, -5, NaN, Infinity]) {
    model.update(time);
    assert.equal(sparks.geometry, geometry); assert.equal(sparks.geometry.attributes.position, attr);
    assert.ok(attr.array.every(Number.isFinite));
    for (let i = 0; i < attr.count; i++) assert.ok(attr.getY(i) >= -.101 && attr.getY(i) <= .491);
  }
  model.update(1, { reducedMotion: true }); const still = attr.array.slice(); assert.equal(sparks.visible, false);
  const glow = drawables(root).find(o => o.material.name === 'living-ember').material;
  assert.equal(glow.emissiveIntensity, 1.2); model.update(17, { reducedMotion: true });
  assert.deepEqual(attr.array, still); assert.equal(glow.emissiveIntensity, 1.2);
  root.updateMatrix(); assert.deepEqual(root.matrix, placement); assert.notDeepEqual(before, placement);
  model.update(17); assert.equal(sparks.visible, true); model.dispose();
});

test('models own independent resources and dispose every visible resource once, detaching their display', () => {
  for (const id of [...specs.map(s => s[0]), 'phoenix_ember']) {
    const first = createKit(id), second = createKit(id), root = first.parts[0].object;
    const scene = new THREE.Scene(); scene.add(root);
    const geometries = new Set(drawables(root).map(o => o.geometry));
    const materials = new Set(drawables(root).map(o => o.material));
    for (const other of drawables(second.parts[0].object)) {
      assert.ok(!geometries.has(other.geometry)); assert.ok(!materials.has(other.material));
    }
    const disposals = new Map();
    for (const item of [...geometries, ...materials]) item.addEventListener('dispose', () => disposals.set(item, (disposals.get(item) ?? 0) + 1));
    first.dispose(); first.dispose(); first.update(90);
    assert.equal(root.parent, null); assert.equal(root.children.length, 0);
    assert.equal(disposals.size, geometries.size + materials.size);
    for (const count of disposals.values()) assert.equal(count, 1);
    assert.ok(drawables(second.parts[0].object).length > 0); second.update(2); second.dispose();
  }
});

test('unknown kit and tool IDs cannot silently display a different reward', () => {
  for (const id of ['missing_kit', 'toString', '__proto__']) assert.throws(() => createKit(id), /Unknown crate kit/);
  assert.throws(() => createKit('tradesmans_kit', { tool: 'sword' }), /Unknown kit tool/);
});
