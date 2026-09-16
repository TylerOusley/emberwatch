import { PCFSoftShadowMap } from 'three';

export const QUALITY_PRESETS = Object.freeze({
  high: Object.freeze({ pixelRatioCap: 2, maxPixels: 4_000_000, shadows: true, shadowMapSize: 4096, shadowRadius: 60, anisotropy: 8, postProcessing: true, contactShadows: true, bloom: true, samples: 4 }),
  balanced: Object.freeze({ pixelRatioCap: 1.5, maxPixels: 2_500_000, shadows: true, shadowMapSize: 2048, shadowRadius: 48, anisotropy: 4, postProcessing: true, contactShadows: false, bloom: false, samples: 2 }),
  low: Object.freeze({ pixelRatioCap: 1, maxPixels: 2_000_000, shadows: false, shadowMapSize: 1024, shadowRadius: 40, anisotropy: 2, postProcessing: false, contactShadows: false, bloom: false, samples: 0 })
});
const NAMES = ['auto', 'high', 'balanced', 'low'], LEVELS = ['low', 'balanced', 'high'];
const MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'bumpMap', 'alphaMap', 'emissiveMap', 'displacementMap'];
const STORAGE_KEY = 'emberwatch-graphics-v1';
const safeStorage = () => { try { return globalThis.localStorage; } catch { return null; } };
const finite = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
const readOption = value => typeof value === 'function' ? value() : value;
const prettyPreset = value => ({ auto: 'Auto', high: 'High', balanced: 'Balanced', low: 'Low' }[value] || 'Auto');

// Adaptation uses long active-play windows. Loading stalls, hidden tabs and
// individual slow frames cannot continually resize the renderer.
export function createRenderQuality({ storage = safeStorage(), devicePixelRatio = () => globalThis.devicePixelRatio || 1,
  viewport = () => ({ width: globalThis.innerWidth || 1280, height: globalThis.innerHeight || 720 }) } = {}) {
  let preset = 'auto', effectivePreset = 'balanced', renderer = null, lights = [], disposed = false, persisted = Boolean(storage);
  let width = 1280, height = 720, pixelRatio = 1, maxTextureSize = 4096, maxAnisotropy = 8, maxSamples = 4, lastResize = null;
  let activeSeconds = 0, windowSeconds = 0, frameTimes = [], slowWindows = 0, fastWindows = 0, lastChange = -20, frameRate = null, warmedUp = false;
  const listeners = new Set(), textureSources = new Set();
  try { const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null'); if (saved?.version === 1 && NAMES.includes(saved.preset)) preset = saved.preset; }
  catch { persisted = false; }
  if (preset !== 'auto') effectivePreset = preset;
  function config() {
    const selected = QUALITY_PRESETS[effectivePreset];
    const mapLimit = Math.max(256, 2 ** Math.floor(Math.log2(maxTextureSize)));
    return { ...selected, shadowMapSize: Math.min(selected.shadowMapSize, mapLimit), anisotropy: Math.max(1, Math.min(selected.anisotropy, maxAnisotropy)), samples: Math.min(selected.samples, maxSamples) };
  }
  function getSettings() {
    return { preset, effectivePreset, ...config(), pixelRatio, renderWidth: Math.floor(width * pixelRatio), renderHeight: Math.floor(height * pixelRatio), frameRate, persisted };
  }
  function notify() { const settings = getSettings(); for (const listener of listeners) listener(settings); }
  function dimensions(w, h) {
    const size = readOption(viewport) || {};
    width = Math.max(1, Math.floor(finite(w, finite(size.width, 1280))));
    height = Math.max(1, Math.floor(finite(h, finite(size.height, 720))));
    const deviceRatio = finite(readOption(devicePixelRatio), 1), settings = config();
    const cap = Math.min(deviceRatio, settings.pixelRatioCap, maxTextureSize / width, maxTextureSize / height);
    pixelRatio = Math.min(cap, Math.sqrt(settings.maxPixels / (width * height)));
    // Never round above the GPU/budget limit, including unusually large
    // desktops. Preserve tiny ratios instead of rounding the buffer to zero.
    if (pixelRatio >= .001) pixelRatio = Math.floor(pixelRatio * 1000) / 1000;
  }
  function resize(w, h, { silent = false } = {}) {
    if (disposed) return getSettings();
    const before = `${width}:${height}:${pixelRatio}`;
    dimensions(w, h);
    const next = `${width}:${height}:${pixelRatio}`;
    if (renderer && next !== lastResize) {
      // Update logical dimensions and density together, so an old density
      // never creates an oversized intermediate allocation during a resize.
      renderer.setDrawingBufferSize(width, height, pixelRatio);
      lastResize = next;
    }
    if (!silent && before !== next) notify();
    return getSettings();
  }
  function configureLights() {
    const settings = config();
    for (const light of lights) {
      if (!light?.shadow) continue;
      const shadow = light.shadow, camera = shadow.camera;
      if (shadow.mapSize?.x !== settings.shadowMapSize || shadow.mapSize?.y !== settings.shadowMapSize) {
        // Three only allocates an existing shadow target once; discard its old
        // target when the requested resolution changes so the new size takes.
        shadow.map?.dispose?.(); shadow.map = null;
        shadow.mapPass?.dispose?.(); shadow.mapPass = null;
        shadow.mapSize?.set?.(settings.shadowMapSize, settings.shadowMapSize);
      }
      if (!settings.shadows && shadow.map) { shadow.map.dispose?.(); shadow.map = null; }
      if (camera) {
        const radius = settings.shadowRadius;
        if (camera.left !== -radius || camera.right !== radius || camera.top !== radius || camera.bottom !== -radius) {
          camera.left = camera.bottom = -radius; camera.right = camera.top = radius;
          camera.updateProjectionMatrix?.();
        }
      }
      shadow.bias = effectivePreset === 'high' ? -.00018 : -.0003;
      shadow.normalBias = effectivePreset === 'high' ? .035 : .05;
      shadow.needsUpdate = true;
      // Main selects the active sun/moon caster each frame. Preset changes do
      // not turn both lights on or override that day/night decision.
    }
  }
  function texturesIn(source) {
    const found = new Set();
    const material = value => {
      if (!value) return;
      if (Array.isArray(value)) { value.forEach(material); return; }
      if (value.isTexture) { found.add(value); return; }
      for (const name of MAPS) if (value[name]?.isTexture) found.add(value[name]);
      for (const uniform of Object.values(value.uniforms || {})) if (uniform?.value?.isTexture) found.add(uniform.value);
    };
    if (source?.traverse) source.traverse(object => material(object.material));
    else if (source?.isTexture || source?.isMaterial) material(source);
    else if (source?.[Symbol.iterator]) for (const value of source) material(value);
    return found;
  }
  function applyTextures(source, { remember = true } = {}) {
    if (disposed || !source) return 0;
    if (remember) textureSources.add(source);
    let changed = 0;
    for (const texture of texturesIn(source)) if (texture.anisotropy !== config().anisotropy) { texture.anisotropy = config().anisotropy; texture.needsUpdate = true; changed++; }
    return changed;
  }
  function applySettings() {
    if (renderer?.shadowMap) {
      const changed = renderer.shadowMap.enabled !== config().shadows || renderer.shadowMap.type !== PCFSoftShadowMap;
      renderer.shadowMap.enabled = config().shadows;
      renderer.shadowMap.type = PCFSoftShadowMap;
      if (changed) renderer.shadowMap.needsUpdate = true;
    }
    configureLights();
    for (const source of textureSources) applyTextures(source, { remember: false });
    resize(undefined, undefined, { silent: true });
    notify();
  }
  function apply(nextRenderer, { sun, fill, lights: explicitLights } = {}) {
    if (disposed || !nextRenderer) return getSettings();
    if (renderer !== nextRenderer) { renderer = nextRenderer; lastResize = null; }
    lights = (explicitLights || [sun, fill]).filter(Boolean);
    const caps = renderer.capabilities || {};
    maxTextureSize = finite(caps.maxTextureSize, 4096);
    maxAnisotropy = finite(caps.getMaxAnisotropy?.(), 1);
    maxSamples = Math.max(0, Math.floor(Number.isFinite(caps.maxSamples) ? caps.maxSamples : 4));
    applySettings();
    return getSettings();
  }
  function resetSamples() { windowSeconds = 0; frameTimes = []; slowWindows = fastWindows = 0; }
  function setSettings(value) {
    if (disposed || !NAMES.includes(value?.preset)) return getSettings();
    if (preset === value.preset) return getSettings();
    preset = value.preset;
    effectivePreset = preset === 'auto' ? 'balanced' : preset;
    resetSamples(); lastChange = activeSeconds; warmedUp = false;
    try { if (storage) { storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, preset })); persisted = true; } else persisted = false; } catch { persisted = false; }
    applySettings();
    return getSettings();
  }
  function sampleFrame(dt, { active = true } = {}) {
    if (disposed) return false;
    // Keep sustained very low frame rates eligible for a downgrade. Discard
    // whole-second loading/resume stalls; the window and hysteresis filters
    // already prevent an isolated shorter hitch from switching detail.
    if (!active || !Number.isFinite(dt) || dt <= 0 || dt > 1) { resetSamples(); return false; }
    activeSeconds += dt;
    if (!warmedUp) { if (activeSeconds < 6 || activeSeconds - lastChange < 6) return false; warmedUp = true; }
    frameTimes.push(dt); windowSeconds += dt;
    if (windowSeconds < 5) return false;
    const average = windowSeconds / frameTimes.length;
    const sorted = frameTimes.slice().sort((a, b) => a - b), p90 = sorted[Math.floor((sorted.length - 1) * .9)];
    frameRate = Math.round(1 / average);
    windowSeconds = 0; frameTimes = [];
    if (preset !== 'auto') return false;
    if (average > 1 / 45 || p90 > 1 / 35) { slowWindows++; fastWindows = 0; }
    else if (average < 1 / 57 && p90 < 1 / 48) { fastWindows++; slowWindows = 0; }
    else { slowWindows = fastWindows = 0; }
    if (activeSeconds - lastChange < 20) return false;
    const level = LEVELS.indexOf(effectivePreset);
    const next = slowWindows >= 2 ? Math.max(0, level - 1) : fastWindows >= 6 ? Math.min(2, level + 1) : level;
    if (next === level) return false;
    effectivePreset = LEVELS[next]; lastChange = activeSeconds; resetSamples(); applySettings();
    return true;
  }
  dimensions();
  return { getSettings, setSettings, apply, resize, applyTextures, sampleFrame,
    subscribe(listener) { if (disposed || typeof listener !== 'function') return () => {}; listeners.add(listener); listener(getSettings()); return () => listeners.delete(listener); },
    dispose() { disposed = true; listeners.clear(); textureSources.clear(); renderer = null; lights = []; }
  };
}

function preview(preset) {
  const rich = preset === 'high', simple = preset === 'low';
  return `<svg viewBox="0 0 220 114" role="img" aria-label="${prettyPreset(preset)} illustration of village lighting"><rect width="220" height="114" rx="7" fill="${simple ? '#738c88' : '#86a49a'}"/><circle cx="177" cy="22" r="${rich ? 13 : 10}" fill="#f5da96"${rich ? ' opacity=".95"' : ''}/><path d="M0 84q51-28 93-10 39 12 127-20v60H0Z" fill="#557a59"/><path d="M0 99q58-19 122-6 49 7 98-13v34H0Z" fill="#6c925f"/>${simple ? '' : '<path d="m88 86 62 14 52-17-74-5Z" fill="#1a332d" opacity=".35"/>'}<path d="M69 51h67v36H69Z" fill="#d0bd92"/><path d="m57 54 44-34 48 34Z" fill="#685745"/><path d="M77 87V51m49 36V51M101 27v60M69 67h66" fill="none" stroke="#6d6149" stroke-width="4"/><path d="M91 88V67q10-12 20 0v21Z" fill="#384744"/><path d="M117 59h12v10h-12Z" fill="#e1cf93"/><path d="m34 39-21 36h12L10 91h48L45 74h11Z" fill="#305b49"/><path d="M32 86h5v15h-5Z" fill="#766347"/>${rich ? '<path d="m67 47 69 0m-56-11 42 0M70 82h63" stroke="#b69965" stroke-width="1.5"/><path d="M111 95h13m8 4h12m-65 6h11m-19-13h10" stroke="#b4ac81" stroke-width="3"/><path d="M121 60v8m-3-4h10" stroke="#756b50" stroke-width="1"/>' : ''}</svg>`;
}
export function createGraphicsUI({ openPanel, getActivePanel, getSettings, setSettings, getRendererInfo = () => ({}), document: doc = globalThis.document }) {
  let signature = '';
  const content = () => doc.getElementById('panel-content');
  const information = {
    auto: ['Find a comfortable balance', 'Gently adjusts picture detail as you play. A good starting choice for most computers.'],
    high: ['Bring the village into focus', 'Crisp surfaces, detailed shadows, richer nearby light, and a soft glow on bright highlights.'],
    balanced: ['A clear view, steady movement', 'Sharp surroundings and soft daylight shadows, with lighter effects for busy nights.'],
    low: ['Keep movement responsive', 'A simpler picture and lighting for older computers or a very busy village.']
  };
  function snapshot() {
    const s = getSettings(), info = getRendererInfo() || {};
    return { ...s, frameRate: s.frameRate ?? (Number.isFinite(info.fps) ? Math.round(info.fps) : null) };
  }
  function show() {
    const settings = snapshot(), focus = doc.activeElement?.dataset?.qualityPreset;
    const pixelCount = settings.renderWidth && settings.renderHeight ? `${settings.renderWidth.toLocaleString('en-US')} × ${settings.renderHeight.toLocaleString('en-US')}` : 'Fits your display';
    const cards = NAMES.map(preset => `<button type="button" class="graphics-preset${settings.preset === preset ? ' selected' : ''}" data-quality-preset="${preset}" aria-pressed="${settings.preset === preset}">${preview(preset === 'auto' ? 'balanced' : preset)}<span class="graphics-preset-title">${prettyPreset(preset)}${preset === 'auto' ? '<small>RECOMMENDED</small>' : ''}<i aria-hidden="true">${settings.preset === preset ? '✓' : '○'}</i></span><strong>${information[preset][0]}</strong><span class="graphics-preset-copy">${information[preset][1]}</span></button>`).join('');
    openPanel(`<section class="graphics-settings"><p class="eyebrow">MAKE THE VIEW YOURS</p><h2>Picture & performance</h2><p>Choose how much detail your computer draws. Changes apply immediately and keep your village progress intact.</p><div class="graphics-presets">${cards}</div><div class="graphics-current"><div><span>PICTURE IN USE</span><strong>${prettyPreset(settings.effectivePreset)}</strong></div><div><span>PICTURE SIZE</span><strong>${pixelCount}</strong></div><div><span>MOTION SMOOTHNESS</span><strong>${settings.frameRate ? `${settings.frameRate} frames / second` : 'Measuring during play'}</strong></div></div><p class="graphics-guidance">${settings.preset === 'auto' ? `Auto is currently using ${prettyPreset(settings.effectivePreset)}. It waits for sustained changes in performance before adjusting, so the view stays steady.` : settings.preset === 'high' ? 'High keeps the richest picture. If a busy night feels sluggish, Balanced or Auto can help movement stay smooth.' : settings.preset === 'low' ? 'Low favors responsive movement. Switch to Balanced when you want more detail.' : 'Balanced keeps a clear picture with lighter effects. High adds finer lighting and detail when your computer has room.'}</p><p class="graphics-save-note">${settings.persisted === false ? 'Applied for this visit. Your browser could not remember this preference.' : 'Your choice is remembered in this browser.'}</p></section>`, 'graphics');
    for (const button of content()?.querySelectorAll('[data-quality-preset]') || []) button.onclick = () => { setSettings({ preset: button.dataset.qualityPreset }); update(); };
    if (focus) [...content()?.querySelectorAll('[data-quality-preset]') || []].find(button => button.dataset.qualityPreset === focus)?.focus?.({ preventScroll: true });
    signature = JSON.stringify(settings);
  }
  function update() { if (getActivePanel() === 'graphics' && JSON.stringify(snapshot()) !== signature) show(); }
  return { show, update, clear() { signature = ''; } };
}
