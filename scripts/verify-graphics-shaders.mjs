// Capture the installed Three.js compiler's exact WebGL2 sources, then ask Mesa
// EGL to compile and link them. Node alone does not validate GLSL.
// Usage: node scripts/verify-graphics-shaders.mjs [--export /tmp/shaders.json]
import * as THREE from 'three';
import { WebGLProgram } from 'three/src/renderers/webgl/WebGLProgram.js';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const hash = source => createHash('sha256').update(source).digest('hex');

// This context only records shaderSource arguments. Actual compilation is done
// by compile-graphics-shaders.py; no fake compilation result counts as a pass.
export function captureThreeProgram(name, shader, options = {}) {
  const gl = {
    VERTEX_SHADER: 0x8B31, FRAGMENT_SHADER: 0x8B30,
    createProgram: () => ({}), createShader: kind => ({ kind }),
    shaderSource: (shader, source) => { shader.source = source; },
    compileShader() {}, attachShader() {}, linkProgram() {}, bindAttribLocation() {}, deleteProgram() {}
  };
  const parameters = {
    shaderType: 'MeshStandardMaterial', shaderName: name, defines: {}, precision: 'highp',
    vertexShader: shader.vertexShader, fragmentShader: shader.fragmentShader,
    isRawShaderMaterial: false, rendererExtensionParallelShaderCompile: false,
    toneMapping: THREE.NoToneMapping, outputColorSpace: THREE.LinearSRGBColorSpace,
    envMapCubeUVHeight: null, shadowMapType: THREE.PCFSoftShadowMap,
    numDirLights: 0, numPointLights: 0, numSpotLights: 0, numRectAreaLights: 0, numHemiLights: 0,
    numDirLightShadows: 0, numPointLightShadows: 0, numSpotLightShadows: 0,
    numSpotLightMaps: 0, numSpotLightShadowsWithMaps: 0, numLightProbes: 0,
    numClippingPlanes: 0, numClipIntersection: 0,
    ...options
  };
  const renderer = { getContext: () => gl, debug: { checkShaderErrors: false } };
  const program = new WebGLProgram(renderer, name, parameters, { releaseStatesOfProgram() {} });
  const vertex = program.vertexShader.source, fragment = program.fragmentShader.source;
  if (!vertex?.startsWith('#version 300 es') || !fragment?.startsWith('#version 300 es')) throw new Error(`${name}: expected exact WebGL2 GLSL ES 3 sources.`);
  if (/#include\s+</.test(vertex + fragment)) throw new Error(`${name}: Three.js did not expand all shader chunks.`);
  program.destroy();
  return { name, vertex, fragment, hashes: { vertex: hash(vertex), fragment: hash(fragment) } };
}

// Load the browser's actual scene factories with only their import URLs adapted
// for Node. This exercises the real season hook after the real PBR hook.
function sceneModule(filename, overrides = {}) {
  const url = new URL(`../public/src/${filename}`, import.meta.url);
  const source = readFileSync(url, 'utf8').replace(/from\s+(['"])([^'"]+)\1/g, (all, quote, name) => {
    const target = overrides[name] ?? (name === 'three' ? new URL('../node_modules/three/build/three.module.js', import.meta.url).href
      : name.startsWith('/shared/') ? new URL(`..${name}`, import.meta.url).href
      : name.startsWith('.') ? new URL(name, url).href : null);
    return target ? `from ${JSON.stringify(target)}` : all;
  });
  return 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
}

async function captureEnvironmentPrograms(lighting) {
  const plots = sceneModule('plots-world.js');
  const { createWorld } = await import(sceneModule('world.js', { './plots-world.js': plots }));
  const { createEnvironmentWorld } = await import('../public/src/environment-world.js');
  const scene = new THREE.Scene(), previousDocument = globalThis.document;
  let environment;
  try {
    // Signs need a canvas while geometry is created; these four shader programs
    // use no canvas pixels. No fake GL compilation or shader source is supplied.
    globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }) }) };
    createWorld(scene);
    globalThis.document = previousDocument;
    environment = createEnvironmentWorld(scene);
    environment.update({ season: 'winter', weather: 'snow' }, { dt: .1, time: 5 });
    let foliage;
    scene.traverse(object => {
      if (!foliage && object.isInstancedMesh && object.geometry.userData.forest && object.material.vertexColors && object.material.side === THREE.DoubleSide) foliage = object;
    });
    const terrain = scene.getObjectByName('village-terrain');
    if (!terrain || !foliage) throw new Error('Actual terrain and instanced forest foliage are required for season shader validation.');
    const programs = [];
    for (const [name, object] of [['weather-rain-snow-particles', environment.particles], ['weather-overcast-clouds', environment.clouds]]) {
      const material = object.material;
      programs.push(captureThreeProgram(name, material, { shaderType: 'ShaderMaterial', flipSided: material.side === THREE.BackSide,
        toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace }));
    }
    for (const [name, object] of [['season-world-terrain-pbr', terrain], ['season-world-instanced-foliage', foliage]]) {
      const material = object.material, library = THREE.ShaderLib.standard;
      const shader = { vertexShader: library.vertexShader, fragmentShader: library.fragmentShader, uniforms: THREE.UniformsUtils.clone(library.uniforms) };
      material.onBeforeCompile(shader, {});
      if (!shader.uniforms.environmentSeasonTint?.value?.isColor || !Number.isFinite(shader.uniforms.environmentSeasonAmount?.value)) throw new Error(`${name}: season hook did not bind real uniforms.`);
      if (object === terrain && (!shader.uniforms.surfaceAlbedo?.value?.isTexture || !shader.fragmentShader.includes('surfaceGradient'))) throw new Error(`${name}: season hook lost the terrain's surface shader.`);
      programs.push(captureThreeProgram(name, shader, { ...lighting, vertexColors: material.vertexColors, instancing: object.isInstancedMesh === true,
        doubleSided: material.side === THREE.DoubleSide, toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace }));
    }
    return programs;
  } finally {
    globalThis.document = previousDocument;
    environment?.dispose();
    const resources = new Set();
    scene.traverse(object => {
      if (object.geometry) resources.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) if (material) { resources.add(material); if (material.map) resources.add(material.map); }
      if (object.isInstancedMesh) object.dispose();
    });
    for (const resource of resources) resource.dispose();
    scene.clear();
  }
}

export async function buildGraphicsShaderBundle() {
  const { createSurfaceMaterial, applySurface } = await import('../public/src/surface-materials.js');
  const { presentationVertex, presentationFragment } = await import('../public/src/render-pipeline.js');
  const programs = [], materials = [];
  const lighting = { numDirLights: 2, numHemiLights: 1, numPointLights: 6, numDirLightShadows: 1,
    shadowMapEnabled: true, shadowMapType: THREE.PCFSoftShadowMap, useFog: true, fog: true, fogExp2: true };
  const variants = [
    { name: 'surface-standard-smooth', kind: 'rock', flags: {} },
    { name: 'surface-standard-flat', kind: 'rock', flags: { flatShading: true } },
    { name: 'surface-instanced-nonuniform', kind: 'wood', flags: { instancing: true } },
    { name: 'surface-instanced-flat-color', kind: 'masonry', flags: { instancing: true, instancingColor: true, vertexColors: true, flatShading: true } },
    { name: 'surface-instanced-double-sided', kind: 'grass', flags: { instancing: true, doubleSided: true } },
    { name: 'surface-flat-double-sided-shadow-fog', kind: 'earth', flags: { ...lighting, flatShading: true, doubleSided: true, vertexColors: true } },
    { name: 'surface-instanced-shadow-fog', kind: 'cobble', flags: { ...lighting, instancing: true, instancingColor: true } },
    { name: 'surface-standard-native-normalmap', kind: 'roof', flags: { ...lighting, normalMap: true, normalMapTangentSpace: true, normalMapUv: 'uv' } },
    { name: 'surface-skinned-shadow-fog', kind: 'wood', flags: { ...lighting, skinning: true } },
    { name: 'surface-reflection-physical', kind: 'rock', physical: true, flags: { ...lighting, envMap: true, envMapMode: THREE.CubeUVReflectionMapping, envMapCubeUVHeight: 128, clearcoat: true, defines: { PHYSICAL: '' } } },
    { name: 'surface-direct-aces-srgb', kind: 'rock', flags: { ...lighting, instancing: true, toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace } }
  ];
  try {
    for (const variant of variants) {
      const materialOptions = { flatShading: Boolean(variant.flags.flatShading), vertexColors: Boolean(variant.flags.vertexColors), side: variant.flags.doubleSided ? THREE.DoubleSide : THREE.FrontSide };
      const material = variant.physical ? applySurface(new THREE.MeshPhysicalMaterial({ ...materialOptions, clearcoat: .2 }), variant.kind) : createSurfaceMaterial(variant.kind, materialOptions);
      materials.push(material);
      const library = variant.physical ? THREE.ShaderLib.physical : THREE.ShaderLib.standard;
      const shader = { vertexShader: library.vertexShader, fragmentShader: library.fragmentShader, uniforms: THREE.UniformsUtils.clone(library.uniforms) };
      material.onBeforeCompile(shader, {});
      for (const name of ['surfaceAlbedo', 'surfaceNormal', 'surfaceRoughness']) if (!shader.uniforms[name]?.value?.isTexture) throw new Error(`${variant.name}: ${name} is not a real bound texture.`);
      if (shader.uniforms.surfaceAlbedo.value.colorSpace !== THREE.SRGBColorSpace || shader.uniforms.surfaceNormal.value.colorSpace !== THREE.NoColorSpace || shader.uniforms.surfaceRoughness.value.colorSpace !== THREE.NoColorSpace) throw new Error(`${variant.name}: incorrect texture color spaces.`);
      if (!shader.vertexShader.includes('vSurfaceWorldPosition') || !shader.fragmentShader.includes('surfaceGradient')) throw new Error(`${variant.name}: runtime surface shader hook did not run.`);
      programs.push(captureThreeProgram(variant.name, shader, variant.flags));
    }
    for (const toneMapping of [THREE.ACESFilmicToneMapping, THREE.NoToneMapping]) {
      programs.push(captureThreeProgram(`presentation-${toneMapping === THREE.NoToneMapping ? 'linear' : 'aces'}-srgb`, { vertexShader: presentationVertex, fragmentShader: presentationFragment }, { shaderType: 'ShaderMaterial', toneMapping, outputColorSpace: THREE.SRGBColorSpace }));
    }
    programs.push(...await captureEnvironmentPrograms(lighting));
    return { threeRevision: THREE.REVISION, programs, runtimeHashes: { presentationVertex: hash(presentationVertex), presentationFragment: hash(presentationFragment) } };
  } finally { for (const material of materials) material.dispose(); }
}

export function compileGraphicsBundle(bundle) {
  const python = process.env.CODEX_PRIMARY_RUNTIME_PYTHON || 'python3';
  const helper = fileURLToPath(new URL('./compile-graphics-shaders.py', import.meta.url));
  const result = spawnSync(python, [helper], { input: JSON.stringify(bundle), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 120000 });
  if (result.error) throw result.error;
  let report;
  try { report = JSON.parse(result.stdout); } catch { throw new Error(`Shader compiler returned no report: ${result.stderr || result.stdout}`); }
  return { status: result.status, report, stderr: result.stderr };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bundle = await buildGraphicsShaderBundle();
  const exportIndex = process.argv.indexOf('--export');
  if (exportIndex >= 0) {
    if (!process.argv[exportIndex + 1]) throw new Error('Pass an output filename after --export.');
    writeFileSync(process.argv[exportIndex + 1], JSON.stringify(bundle));
  }
  const { status, report, stderr } = compileGraphicsBundle(bundle);
  if (stderr) process.stderr.write(stderr);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = status || 0;
}
