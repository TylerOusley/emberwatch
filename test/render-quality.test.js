import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createRenderQuality, createGraphicsUI, QUALITY_PRESETS } from '../public/src/render-quality.js';
import { createRenderPipeline } from '../public/src/render-pipeline.js';

function memory(value = null) {
  const values = new Map(value === null ? [] : [['emberwatch-graphics-v1', value]]);
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, item) => values.set(key, item) };
}
function fixture({ preset, storage = memory(preset ? JSON.stringify({ version: 1, preset }) : null), size = { width: 1280, height: 720 }, ratio = 2, maxTextureSize = 16384, anisotropy = 16, samples = 4 } = {}) {
  let width = 300, height = 150, pixelRatio = 1;
  const allocations = [], renderer = {
    shadowMap: { enabled: false, type: null }, capabilities: { maxTextureSize, maxSamples: samples, getMaxAnisotropy: () => anisotropy },
    setDrawingBufferSize(w, h, r) { width = w; height = h; pixelRatio = r; allocations.push({ width: Math.floor(w * r), height: Math.floor(h * r), pixelRatio: r }); },
    getDrawingBufferSize: vector => vector.set(Math.floor(width * pixelRatio), Math.floor(height * pixelRatio)),
    getPixelRatio: () => pixelRatio
  };
  const sun = new THREE.DirectionalLight(), moon = new THREE.DirectionalLight(); sun.castShadow = true;
  const quality = createRenderQuality({ storage, viewport: () => size, devicePixelRatio: () => ratio });
  return { quality, renderer, sun, moon, allocations, storage, size, apply() { return quality.apply(renderer, { sun, fill: moon }); } };
}
function sample(quality, seconds, fps, active = true) {
  const changes = [];
  for (let i = 0; i < Math.ceil(seconds * fps); i++) if (quality.sampleFrame(1 / fps, { active })) changes.push(i / fps);
  return changes;
}

test('first startup applies balanced Auto within budget before subscribers configure the view', () => {
  const f = fixture(); f.apply(); const seen = [];
  f.quality.subscribe(settings => seen.push({ ...settings }));
  assert.equal(seen.length, 1); assert.equal(seen[0].preset, 'auto'); assert.equal(seen[0].effectivePreset, 'balanced');
  assert.equal(seen[0].pixelRatio, 1.5); assert.equal(f.renderer.shadowMap.type, THREE.PCFSoftShadowMap);
  assert.equal(f.sun.castShadow, true); assert.equal(f.moon.castShadow, false); assert.equal(f.allocations.length, 1);
  assert.equal(f.allocations[0].width * f.allocations[0].height, 2_073_600);
});

test('saved choices are versioned and validated; corrupt or unavailable storage keeps startup usable', () => {
  assert.equal(fixture({ preset: 'high' }).quality.getSettings().effectivePreset, 'high');
  for (const value of ['{bad json', '{"version":2,"preset":"high"}', '{"version":1,"preset":"ultra"}', 'null']) {
    assert.equal(fixture({ storage: memory(value) }).quality.getSettings().preset, 'auto');
  }
  const denied = fixture({ storage: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } } });
  denied.apply(); denied.quality.setSettings({ preset: 'low' });
  assert.equal(denied.quality.getSettings().effectivePreset, 'low'); assert.equal(denied.quality.getSettings().persisted, false);
  const saved = fixture(); saved.quality.setSettings({ preset: 'high' });
  assert.deepEqual(JSON.parse(saved.storage.values.get('emberwatch-graphics-v1')), { version: 1, preset: 'high' });
  saved.quality.setSettings({ preset: 'invalid' }); assert.equal(saved.quality.getSettings().preset, 'high');
});

test('GPU dimensions, preset pixel budgets, anisotropy and sample limits hold even across enormous resizes', () => {
  for (const preset of ['low', 'balanced', 'high']) {
    const f = fixture({ preset, maxTextureSize: 2048, anisotropy: 2, samples: 0 }); f.apply();
    for (const [width, height] of [[3840, 2160], [32000, 18000], [5_000_000, 5_000_000], [1, 1]]) {
      Object.assign(f.size, { width, height }); const settings = f.quality.resize(), buffer = f.allocations.at(-1);
      assert.ok(buffer.width > 0 && buffer.height > 0); assert.ok(buffer.width <= 2048 && buffer.height <= 2048);
      assert.ok(buffer.width * buffer.height <= QUALITY_PRESETS[preset].maxPixels);
      assert.equal(settings.renderWidth, buffer.width); assert.equal(settings.renderHeight, buffer.height);
      assert.ok(settings.shadowMapSize <= 2048); assert.equal(settings.anisotropy, 2); assert.equal(settings.samples, 0);
    }
  }
});

test('resize subscribers may request the current size without recursion or duplicate allocations', () => {
  const f = fixture(); f.apply(); let notifications = 0;
  const stop = f.quality.subscribe(() => { notifications++; f.quality.resize(); });
  Object.assign(f.size, { width: 1920, height: 1080 }); f.quality.resize();
  assert.equal(notifications, 2); assert.equal(f.allocations.length, 2);
  f.quality.resize(); assert.equal(notifications, 2); assert.equal(f.allocations.length, 2);
  f.quality.setSettings({ preset: 'high' }); assert.equal(notifications, 3); assert.equal(f.allocations.length, 3);
  f.quality.setSettings({ preset: 'high' }); assert.equal(notifications, 3);
  stop(); f.quality.setSettings({ preset: 'low' }); assert.equal(notifications, 3);
});

test('renderer replacement configures a fresh buffer and new capability limits', () => {
  const f = fixture({ preset: 'high' }); f.apply();
  const second = fixture({ maxTextureSize: 1024, anisotropy: 1, samples: 2 });
  f.quality.apply(second.renderer, { sun: second.sun });
  assert.equal(second.allocations.length, 1); assert.equal(f.allocations.length, 1);
  assert.equal(f.quality.getSettings().shadowMapSize, 1024); assert.equal(f.quality.getSettings().samples, 2);
  assert.equal(f.quality.getSettings().anisotropy, 1);
});

test('preset switches retire obsolete shadow targets and keep the current sun or moon caster', () => {
  const f = fixture(); f.apply(); let dropped = 0;
  f.sun.castShadow = false; f.moon.castShadow = true;
  for (const light of [f.sun, f.moon]) {
    light.shadow.map = { dispose() { dropped++; } }; light.shadow.mapPass = { dispose() { dropped++; } };
  }
  f.quality.setSettings({ preset: 'high' }); assert.equal(dropped, 4);
  assert.equal(f.sun.castShadow, false); assert.equal(f.moon.castShadow, true);
  assert.equal(f.sun.shadow.camera.left, -60); assert.equal(f.moon.shadow.mapSize.x, 4096);
  f.moon.shadow.map = { dispose() { dropped++; } };
  f.quality.setSettings({ preset: 'low' }); assert.equal(dropped, 5); assert.equal(f.moon.shadow.map, null);
  assert.equal(f.renderer.shadowMap.enabled, false); assert.equal(f.quality.getSettings().postProcessing, false);
});

test('anisotropy updates shared material maps once and reapplies remembered scene sources', () => {
  const f = fixture(); f.apply(); const color = new THREE.Texture(), normal = new THREE.Texture(), extra = new THREE.Texture();
  const scene = new THREE.Scene(), material = new THREE.MeshStandardMaterial({ map: color, normalMap: normal });
  const shader = new THREE.ShaderMaterial({ uniforms: { image: { value: extra } } });
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), [material, material, shader]));
  assert.equal(f.quality.applyTextures(scene), 3); const version = color.version;
  assert.equal(f.quality.applyTextures(scene), 0); assert.equal(color.version, version);
  f.quality.setSettings({ preset: 'high' });
  for (const texture of [color, normal, extra]) assert.equal(texture.anisotropy, 8);
  assert.equal(color.version, version + 1);
  f.quality.setSettings({ preset: 'low' }); assert.equal(color.anisotropy, 2);
  scene.children[0].geometry.dispose(); material.dispose(); shader.dispose(); color.dispose(); normal.dispose(); extra.dispose();
});

test('Auto waits for sustained play, steps down on slow performance and recovers gradually', () => {
  const f = fixture(); f.apply();
  assert.equal(sample(f.quality, 10, 30).length, 0); assert.equal(f.quality.getSettings().effectivePreset, 'balanced');
  assert.equal(sample(f.quality, 8, 30).length, 1); assert.equal(f.quality.getSettings().effectivePreset, 'low');
  assert.equal(sample(f.quality, 15, 60).length, 0, 'brief recovery does not immediately reverse the downgrade');
  assert.equal(sample(f.quality, 20, 60).length, 1); assert.equal(f.quality.getSettings().effectivePreset, 'balanced');
  assert.equal(sample(f.quality, 32, 60).length, 1); assert.equal(f.quality.getSettings().effectivePreset, 'high');
  assert.equal(f.quality.getSettings().preset, 'auto', 'adaptation does not silently replace the chosen mode');
  assert.equal(f.storage.values.size, 0, 'temporary performance decisions are not persisted as manual settings');
});

test('hidden play, loading stalls and middle-range performance do not trigger quality oscillation', () => {
  const f = fixture(); f.apply();
  assert.equal(sample(f.quality, 40, 20, false).length, 0);
  for (const dt of [NaN, Infinity, 0, -1, 1.5]) assert.equal(f.quality.sampleFrame(dt), false);
  assert.equal(sample(f.quality, 50, 50).length, 0); assert.equal(f.quality.getSettings().effectivePreset, 'balanced');
  sample(f.quality, 6, 30); f.quality.sampleFrame(2); sample(f.quality, 6, 30);
  assert.equal(f.quality.getSettings().effectivePreset, 'balanced', 'a loading interruption clears incomplete slow windows');
});

test('Auto can reduce detail under sustained sub-four-FPS load instead of rejecting every slow frame', () => {
  const f = fixture(); f.apply();
  assert.equal(sample(f.quality, 24, 2).length, 1);
  assert.equal(f.quality.getSettings().effectivePreset, 'low'); assert.equal(f.quality.getSettings().frameRate, 2);
});

test('manual presets stay fixed under load; returning to Auto starts a fresh measurement window', () => {
  const f = fixture({ preset: 'high' }); f.apply(); sample(f.quality, 50, 20);
  assert.equal(f.quality.getSettings().effectivePreset, 'high'); assert.equal(f.quality.getSettings().frameRate, 20);
  f.quality.setSettings({ preset: 'auto' }); sample(f.quality, 10, 20);
  assert.equal(f.quality.getSettings().effectivePreset, 'balanced');
  sample(f.quality, 14, 20); assert.equal(f.quality.getSettings().effectivePreset, 'low');
});

test('root subscription order switches post-processing targets after the bounded buffer resize', () => {
  const f = fixture(), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  Object.assign(f.renderer, { extensions: { has: () => true }, info: { reset() {} }, setRenderTarget() {}, render() {} });
  const pipeline = createRenderPipeline(f.renderer, scene, camera); f.apply();
  const stop = f.quality.subscribe(settings => pipeline.configure(settings));
  assert.equal(pipeline.target.width, f.quality.getSettings().renderWidth);
  const initial = pipeline.target; let dropped = 0; initial.addEventListener('dispose', () => dropped++);
  Object.assign(f.size, { width: 3840, height: 2160 }); f.quality.resize();
  assert.equal(pipeline.target, initial); assert.equal(pipeline.target.width, f.quality.getSettings().renderWidth);
  // Resizing Three's target releases GPU attachments, then changing MSAA
  // replaces the whole target; no inactive target survives the Low preset.
  f.quality.setSettings({ preset: 'low' }); assert.equal(pipeline.target, null); assert.ok(dropped >= 1);
  f.quality.setSettings({ preset: 'high' }); assert.ok(pipeline.target); assert.notEqual(pipeline.target, initial);
  assert.equal(pipeline.target.width, f.quality.getSettings().renderWidth);
  stop(); pipeline.dispose(); f.quality.dispose();
});

function uiFixture(storage = memory()) {
  const quality = fixture({ storage }); quality.apply(); let html = '', panel = null, buttons = [], renders = 0;
  const doc = { activeElement: null, getElementById: () => ({ querySelectorAll: () => buttons }) };
  const ui = createGraphicsUI({ getSettings: quality.quality.getSettings, setSettings: quality.quality.setSettings, getActivePanel: () => panel, document: doc,
    openPanel(next, nextPanel) { html = next; panel = nextPanel; renders++; buttons = [...html.matchAll(/<button\b([^>]*)>/g)].map(([, attributes]) => {
      const button = { attributes, dataset: { qualityPreset: attributes.match(/data-quality-preset="([^"]+)"/)[1] }, focus() { doc.activeElement = button; } }; return button;
    }); }
  });
  const stop = quality.quality.subscribe(() => ui.update());
  return { ui, quality, doc, get html() { return html; }, get buttons() { return buttons; }, get renders() { return renders; }, close() { panel = null; }, stop };
}

test('illustrated native menu controls show selection, preserve keyboard focus and redraw once per choice', () => {
  const f = uiFixture(); f.ui.show(); assert.equal(f.buttons.length, 4);
  assert.equal((f.html.match(/<svg /g) || []).length, 4); assert.equal((f.html.match(/aria-pressed="true"/g) || []).length, 1);
  for (const button of f.buttons) assert.match(button.attributes, /type="button"/);
  for (const [, body] of f.html.matchAll(/<button[^>]*>(.*?)<\/button>/gs)) assert.doesNotMatch(body, /<p\b|<div\b/, 'button content stays valid phrasing content');
  const high = f.buttons.find(button => button.dataset.qualityPreset === 'high'); high.focus(); high.onclick();
  assert.equal(f.renders, 2); assert.equal(f.doc.activeElement.dataset.qualityPreset, 'high'); assert.match(f.doc.activeElement.attributes, /aria-pressed="true"/);
  assert.equal(f.quality.quality.getSettings().preset, 'high'); f.ui.update(); assert.equal(f.renders, 2);
  f.close(); f.quality.quality.setSettings({ preset: 'low' }); assert.equal(f.renders, 2, 'a graphics update cannot reopen a closed menu');
  f.stop();
});

test('preference saving failures remain usable and are explained in the menu', () => {
  const f = uiFixture({ getItem: () => null, setItem() { throw new Error('storage full'); } });
  f.ui.show(); f.buttons.find(button => button.dataset.qualityPreset === 'low').onclick();
  assert.equal(f.quality.quality.getSettings().effectivePreset, 'low'); assert.match(f.html, /Applied for this visit/);
  assert.doesNotMatch(f.html, /Your choice is remembered/); f.stop();
});

test('disposed quality controllers release subscriptions and never mutate renderer resources again', () => {
  const f = fixture(); f.apply(); let count = 0; f.quality.subscribe(() => count++); f.quality.dispose();
  const allocations = f.allocations.length; f.quality.setSettings({ preset: 'high' }); f.quality.resize(500, 500); f.apply();
  assert.equal(f.quality.sampleFrame(1 / 20), false); assert.equal(f.quality.applyTextures(new THREE.Texture()), 0);
  f.quality.subscribe(() => count++); assert.equal(count, 1); assert.equal(f.allocations.length, allocations);
});
