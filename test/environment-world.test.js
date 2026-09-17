import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createEnvironmentWorld } from '../public/src/environment-world.js';

function fixture() {
  const scene = new THREE.Scene(); scene.fog = new THREE.FogExp2('#cccccc', .0035);
  const sun = new THREE.DirectionalLight('#ffffff', 3), skyLight = new THREE.HemisphereLight('#ffffff', '#333333', 1);
  scene.add(sun, skyLight);
  const terrain = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshStandardMaterial({ vertexColors: true })); terrain.name = 'village-terrain'; scene.add(terrain);
  const treeGeometry = new THREE.BoxGeometry(); treeGeometry.userData.forest = true;
  const leaves = new THREE.Mesh(treeGeometry, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide })); scene.add(leaves);
  const trunk = new THREE.Mesh(treeGeometry, new THREE.MeshStandardMaterial()); scene.add(trunk);
  return { scene, sun, skyLight, terrain, leaves, trunk, weather: createEnvironmentWorld(scene, { sun, skyLight }) };
}

test('weather stays within two draw calls and fixed particle budgets at every quality setting', () => {
  const { scene, weather } = fixture(), state = { season: 'winter', weather: 'snow' };
  const originalGeometry = weather.particles.geometry, originalPositions = originalGeometry.attributes.position.array;
  for (const [quality, count] of [['low', 120], ['medium', 320], ['high', 640]]) {
    for (let i = 0; i < 50; i++) { scene.fog.density = .0035; weather.update(state, { dt: .1, time: i / 10, position: { x: 4, y: -1, z: 8 }, quality }); }
    assert.equal(originalGeometry.drawRange.count, count);
    assert.equal(weather.particles.geometry.attributes.position.array, originalPositions);
    assert.equal(weather.group.children.length, 2);
    assert.equal(weather.group.children.some(object => object.isLight), false);
    assert.equal(weather.clouds.visible, quality !== 'low');
  }
  assert.deepEqual(weather.group.position.toArray(), [4, -1, 8]);
  assert.ok(weather.particles.material.uniforms.snowfall.value > .99);
  assert.equal(weather.particles.material.depthWrite, false);
  weather.dispose();
});

test('weather fades through mine entry, switches off underground, and honors reduced motion', () => {
  const { weather, scene } = fixture(), state = { season: 'spring', weather: 'rain' };
  for (let i = 0; i < 20; i++) weather.update(state, { dt: .1 });
  const outside = weather.particles.material.uniforms.opacity.value;
  weather.update(state, { caveMix: .75, dt: 0 }); assert.equal(weather.particles.material.uniforms.opacity.value, outside * .25);
  const density = scene.fog.density; weather.update(state, { caveMix: 1, dt: 0 });
  assert.equal(weather.group.visible, false); assert.equal(scene.fog.density, density);
  weather.update(state, { reducedMotion: true }); assert.equal(weather.particles.visible, false);
  weather.update(null); assert.equal(weather.group.visible, false);
  weather.dispose();
});

test('season shading chains existing shaders and changes uniforms without recompiling materials or tinting tree trunks', () => {
  const { weather, terrain, leaves, trunk } = fixture(), version = terrain.material.version;
  const shader = { uniforms: {}, fragmentShader: '#include <color_fragment>' };
  terrain.material.onBeforeCompile(shader, {});
  assert.match(shader.fragmentShader, /environmentSeasonTint/);
  assert.match(leaves.material.customProgramCacheKey(), /environment-seasons-v1/);
  assert.doesNotMatch(trunk.material.customProgramCacheKey(), /environment-seasons-v1/);
  const initial = shader.uniforms.environmentSeasonTint.value.clone();
  for (let i = 0; i < 100; i++) weather.update({ season: 'winter', weather: 'snow' }, { dt: .1, caveMix: 1 });
  assert.equal(terrain.material.version, version);
  assert.ok(shader.uniforms.environmentSeasonAmount.value > .77);
  assert.ok(shader.uniforms.environmentSeasonTint.value.b > initial.b);
  weather.dispose(); assert.doesNotMatch(terrain.material.customProgramCacheKey(), /environment-seasons-v1/);
});

test('rain, snow and fog approach their targets gradually and owned buffers dispose once', () => {
  const { weather, scene } = fixture();
  weather.update({ season: 'spring', weather: 'rain' }, { dt: .016 });
  assert.ok(weather.particles.material.uniforms.opacity.value > 0 && weather.particles.material.uniforms.opacity.value < .1);
  scene.fog.density = .0035; weather.update({ season: 'spring', weather: 'fog' }, { dt: .1 }); assert.ok(scene.fog.density > .0035);
  let disposed = 0;
  for (const object of weather.group.children) { object.geometry.addEventListener('dispose', () => disposed++); object.material.addEventListener('dispose', () => disposed++); }
  weather.dispose(); weather.dispose(); assert.equal(disposed, 4); assert.equal(scene.getObjectByName('seasons-and-weather'), undefined);
});
