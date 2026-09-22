import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { PET_CATALOG } from '../../shared/pets.js';
import { groundHeight, caveAreaAt } from '../../shared/world.js';

export const PET_HEIGHTS = Object.freeze({ rabbit: .45, marmot: .45, squirrel: .5, fox: .65, husky: .85, shiba: .85,
  wolf: 1, boar: .75, owl: .65, frost_bat: .6, vampire_bat: .6, griffin: 1, dragon: 1.2 });
export const PET_MAX_SPANS = Object.freeze({ frost_bat: 1.7, vampire_bat: 1.7, griffin: 2.2 });
export const PET_RENDER_LIMITS = Object.freeze({ actors: 8, projectiles: 16, retrySeconds: 10 });
const finite = value => Number.isFinite(value);
const bounded = (value, min, max) => Math.max(min, Math.min(max, value));
const pointValid = point => point && finite(point.x) && finite(point.z);
const hash = text => { let n = 0; for (const c of String(text)) n = (Math.imul(n, 31) + c.charCodeAt(0)) | 0; return (n >>> 0) / 4294967296; };

// Geometry, materials and textures belong to the cached source, never an
// individual skeleton clone. Dispose once when the entire world is retired.
function disposeAsset(asset) {
  const resources = new Set(), images = new Set(), skeletons = new Set();
  asset?.scene?.traverse(object => {
    if (object.geometry) resources.add(object.geometry);
    if (object.skeleton) skeletons.add(object.skeleton);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!material) continue;
      resources.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) {
        resources.add(value);
        if (value.source?.data?.close) images.add(value.source.data);
      }
    }
  });
  for (const skeleton of skeletons) skeleton.dispose();
  for (const resource of resources) resource.dispose();
  for (const image of images) image.close();
}

export function createPetWorld(scene, {
  loadAsset = null, terrainHeight = groundHeight, inCave = caveAreaAt,
  now = () => performance.now() / 1000, onAssetError = () => {}, retrySeconds = PET_RENDER_LIMITS.retrySeconds
} = {}) {
  const root = new THREE.Group(); root.name = 'pet-companions'; scene.add(root);
  const companions = new THREE.Group(), projectiles = new THREE.Group();
  companions.name = 'pet-models'; projectiles.name = 'pet-projectiles'; root.add(companions, projectiles);
  const actors = new Map(), assets = new Map();
  const loader = loadAsset ? null : new GLTFLoader();
  const read = loadAsset ?? (url => loader.loadAsync(url));
  let disposed = false, generation = 0;
  const sphere = new THREE.IcosahedronGeometry(.12, 1), cone = new THREE.ConeGeometry(.10, .45, 6), ring = new THREE.TorusGeometry(.15, .025, 4, 14);
  const up = new THREE.Vector3(0, 1, 0), direction = new THREE.Vector3();
  const effects = Array.from({ length: PET_RENDER_LIMITS.projectiles }, () => {
    const group = new THREE.Group(), material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    const head = new THREE.Mesh(sphere, material), tail = new THREE.Mesh(cone, material), gust = new THREE.Mesh(ring, material);
    head.name = 'pet-bolt-head'; tail.name = 'pet-bolt-tail'; gust.name = 'pet-wind-ring';
    tail.position.y = -.22; gust.rotation.x = Math.PI / 2;
    group.add(head, tail, gust); group.visible = false; projectiles.add(group);
    return { group, material, head, tail, gust, active: false, from: new THREE.Vector3(), to: new THREE.Vector3() };
  });

  function source(speciesId) {
    const cached = assets.get(speciesId);
    if (cached?.asset) return Promise.resolve(cached.asset);
    if (cached?.pending) return cached.pending;
    if (cached && now() < cached.retryAt) return null;
    const url = `/assets/pets/${PET_CATALOG[speciesId].assetId}/model.glb`;
    const entry = { asset: null, retryAt: 0, pending: null }; assets.set(speciesId, entry);
    entry.pending = Promise.resolve().then(() => read(url)).then(asset => {
      if (disposed) { disposeAsset(asset); return null; }
      if (!asset?.scene?.isObject3D) throw new Error('The pet asset has no scene.');
      const bounds = new THREE.Box3().setFromObject(asset.scene);
      if (bounds.isEmpty() || !finite(bounds.min.y) || !finite(bounds.max.y) || bounds.max.y - bounds.min.y < .0001) {
        disposeAsset(asset); throw new Error('The pet asset has no usable model bounds.');
      }
      entry.asset = asset; return asset;
    }).catch(error => {
      entry.retryAt = now() + Math.max(1, retrySeconds);
      // Loading failures leave the companion absent until a bounded retry;
      // no generic mesh is substituted for the selected species.
      if (!disposed) { try { onAssetError({ speciesId, url, error, retryAfter: Math.max(1, retrySeconds) }); } catch {} }
      return null;
    }).finally(() => { entry.pending = null; });
    return entry.pending;
  }

  function removeActor(record) {
    record.mixer?.stopAllAction();
    if (record.model) {
      record.mixer?.uncacheRoot(record.model);
      const skeletons = new Set(); record.model.traverse(object => { if (object.skeleton) skeletons.add(object.skeleton); });
      for (const skeleton of skeletons) skeleton.dispose();
    }
    companions.remove(record.group);
    for (const effect of effects) if (effect.owner === record.id) { effect.active = false; effect.group.visible = false; }
  }

  function attach(record) {
    if (record.model || record.loading || disposed) return;
    const promise = source(record.speciesId);
    if (!promise) return;
    const stamp = generation; record.loading = true;
    promise.then(asset => {
      record.loading = false;
      if (!asset || disposed || stamp !== generation || actors.get(record.id) !== record) return;
      const model = cloneSkeleton(asset.scene), normalized = new THREE.Group();
      record.mixer = new THREE.AnimationMixer(model); record.actions = new Map();
      for (const clip of asset.animations ?? []) {
        const name = clip.name.toLowerCase();
        if (['idle', 'walk', 'attack'].includes(name) && !record.actions.has(name)) record.actions.set(name, record.mixer.clipAction(clip));
      }
      // A rig's bind pose is often different from its first idle frame. Apply
      // the real starting pose before measuring feet and wing span, once only.
      record.current = record.actions.get('idle') ?? record.actions.get('walk') ?? null;
      record.current?.play(); record.mixer.update(0);
      model.updateMatrixWorld(true);
      model.traverse(object => { if (object.isSkinnedMesh) object.computeBoundingBox(); });
      const bounds = new THREE.Box3().setFromObject(model), span = PET_MAX_SPANS[record.speciesId] ?? Infinity;
      const scale = Math.min(record.height / (bounds.max.y - bounds.min.y), span / Math.max(.0001, bounds.max.x - bounds.min.x), span / Math.max(.0001, bounds.max.z - bounds.min.z));
      normalized.scale.setScalar(scale);
      normalized.position.set(-(bounds.min.x + bounds.max.x) * scale / 2, -bounds.min.y * scale, -(bounds.min.z + bounds.max.z) * scale / 2);
      normalized.add(model); record.motion.add(normalized); record.model = model;
      model.traverse(object => {
        if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; }
        // Animated wings can extend outside their bind-pose bounds. At most
        // eight pets are present; avoid per-frame skinned-bound recalculation.
        if (object.isSkinnedMesh) object.frustumCulled = false;
        // Imported scene lamps/cameras are not part of the companion budget.
        if (object.isLight || object.isCamera) object.visible = false;
      });
      record.group.visible = true;
    });
  }

  function makeActor(entity) {
    const group = new THREE.Group(), motion = new THREE.Group(); group.add(motion); group.visible = false;
    group.name = `pet-${entity.speciesId}`; group.userData.petId = entity.id;
    group.position.set(entity.x, 0, entity.z); group.rotation.y = finite(entity.yaw) ? entity.yaw : 0;
    companions.add(group);
    const record = { id: entity.id, speciesId: entity.speciesId, height: PET_HEIGHTS[entity.speciesId], group, motion,
      phase: hash(entity.id) * Math.PI * 2, model: null, mixer: null, loading: false, actions: new Map(), current: null,
      actionEvent: null, effectEvent: null, state: 'idle' };
    actors.set(entity.id, record); attach(record); return record;
  }

  function attackWindow(shot, clock) {
    return shot && !shot.cancelled && typeof shot.id === 'string' && finite(shot.at) && finite(shot.until) && shot.until > shot.at
      && clock >= shot.at && clock < shot.until;
  }

  function animate(record, entity, clock, dt, reducedMotion) {
    const shot = entity.lastAttack, attacking = attackWindow(shot, clock);
    const wanted = attacking ? 'attack' : entity.anim === 'walk' ? 'walk' : 'idle';
    const next = record.actions.get(wanted) ?? record.actions.get('idle') ?? record.actions.get('walk');
    const newAttack = attacking && record.actionEvent !== shot.id;
    if (next && (record.current !== next || newAttack)) {
      const previous = record.current;
      next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1);
      if (wanted === 'attack' && record.actions.has('attack')) {
        next.setLoop(THREE.LoopOnce, 1); next.clampWhenFinished = true;
        next.setDuration(bounded(shot.until - shot.at, .25, 2));
        next.time = Math.max(0, clock - shot.at) * next.getEffectiveTimeScale();
      } else { next.setLoop(THREE.LoopRepeat, Infinity); next.clampWhenFinished = false; }
      next.play(); if (previous && previous !== next) next.crossFadeFrom(previous, .15, false);
      record.current = next;
    }
    if (attacking) record.actionEvent = shot.id;
    record.state = wanted; record.mixer?.update(dt);
    record.motion.position.set(0, 0, 0); record.motion.rotation.set(0, 0, 0);
    // Imported clips remain the primary motion. A missing attack clip gets a
    // restrained lunge/swoop of that same model, never a replacement actor.
    if (attacking && !record.actions.has('attack') && !reducedMotion) {
      const p = bounded((clock - shot.at) / (shot.until - shot.at), 0, 1), curve = Math.sin(p * Math.PI);
      record.motion.position.z = curve * .18; record.motion.rotation.x = -.10 * curve;
      if (PET_CATALOG[record.speciesId].flying) record.motion.position.y = -.12 * curve;
    }
  }

  function addShot(record, shot, clock) {
    if (shot?.cancelled) {
      for (const effect of effects) if (effect.owner === record.id && effect.eventId === shot.id) { effect.active = false; effect.group.visible = false; }
      record.effectEvent = shot.id; return;
    }
    if (!shot?.id || record.effectEvent === shot.id) return;
    // Remember even old or invalid intents so repeated snapshots never replay.
    record.effectEvent = shot.id;
    const launch = shot.launchAt ?? (shot.at + .35), impact = shot.impactAt;
    if (shot.kind !== 'ranged' || !pointValid(shot.from) || !pointValid(shot.to) || !finite(launch) || !finite(impact)
        || impact <= launch || impact - launch > 3 || clock >= impact || launch - clock > 1) return;
    const element = ['fire', 'frost', 'wind'].includes(shot.projectile) ? shot.projectile : PET_CATALOG[record.speciesId].attack?.projectile;
    if (!['fire', 'frost', 'wind'].includes(element)) return;
    const effect = effects.find(effect => !effect.active) ?? effects.reduce((oldest, effect) => effect.impact < oldest.impact ? effect : oldest);
    Object.assign(effect, { owner: record.id, eventId: shot.id, active: true, launch, impact, element });
    effect.from.set(shot.from.x, finite(shot.from.y) ? shot.from.y : terrainHeight(shot.from.x, shot.from.z) + .8, shot.from.z);
    effect.to.set(shot.to.x, finite(shot.to.y) ? shot.to.y : terrainHeight(shot.to.x, shot.to.z) + 1, shot.to.z);
    effect.material.color.set({ fire: '#ff983c', frost: '#8de8ff', wind: '#d6fff4' }[element]);
    effect.head.visible = effect.tail.visible = element !== 'wind'; effect.gust.visible = element === 'wind';
    effect.head.scale.set(element === 'frost' ? .7 : 1, element === 'frost' ? 1.6 : 1, element === 'frost' ? .7 : 1);
    direction.copy(effect.to).sub(effect.from);
    effect.group.quaternion.setFromUnitVectors(up, direction.lengthSq() > .0001 ? direction.normalize() : up);
  }

  function clear() {
    generation++;
    for (const record of actors.values()) removeActor(record);
    actors.clear();
    for (const effect of effects) { effect.active = false; effect.group.visible = false; }
  }

  return {
    root,
    update(petActors, clock = 0, dt = 1 / 60, { reducedMotion = false } = {}) {
      if (disposed) return;
      if (!Array.isArray(petActors)) { clear(); return; }
      clock = finite(clock) ? clock : 0; dt = finite(dt) ? bounded(dt, 0, .1) : 0;
      const present = new Set();
      for (const entity of petActors) {
        if (present.size >= PET_RENDER_LIMITS.actors) break;
        if (!entity || typeof entity.id !== 'string' || !pointValid(entity) || !Object.hasOwn(PET_CATALOG, entity.speciesId) || present.has(entity.id)) continue;
        present.add(entity.id);
        let record = actors.get(entity.id);
        if (record && record.speciesId !== entity.speciesId) { removeActor(record); actors.delete(entity.id); record = null; }
        record ??= makeActor(entity); attach(record);
        const distance = Math.hypot(record.group.position.x - entity.x, record.group.position.z - entity.z), blend = distance > 12 ? 1 : 1 - Math.exp(-14 * dt);
        record.group.position.x += (entity.x - record.group.position.x) * blend;
        record.group.position.z += (entity.z - record.group.position.z) * blend;
        const yaw = finite(entity.yaw) ? entity.yaw : 0;
        record.group.rotation.y += Math.atan2(Math.sin(yaw - record.group.rotation.y), Math.cos(yaw - record.group.rotation.y)) * blend;
        const x = record.group.position.x, z = record.group.position.z, floor = terrainHeight(x, z);
        let hover = PET_CATALOG[record.speciesId].flying ? .8 + (reducedMotion ? 0 : .07 * Math.sin(clock * 2.4 + record.phase)) : 0;
        // Cave render ceilings stay above floor+5.26m; this conservative 3m
        // envelope also leaves room below beams for the tallest flying pet.
        if (hover && inCave(x, z)) hover = Math.min(hover, Math.max(.1, 3 - record.height));
        record.group.position.y = floor + .02 + hover;
        animate(record, entity, clock, dt, reducedMotion); addShot(record, entity.lastAttack, clock);
      }
      for (const [id, record] of actors) if (!present.has(id)) { removeActor(record); actors.delete(id); }
      for (const effect of effects) {
        if (!effect.active) continue;
        if (clock >= effect.impact || clock < effect.launch - 1) { effect.active = false; effect.group.visible = false; continue; }
        effect.group.visible = clock >= effect.launch;
        if (!effect.group.visible) continue;
        const p = bounded((clock - effect.launch) / (effect.impact - effect.launch), 0, 1);
        effect.group.position.copy(effect.from).lerp(effect.to, p); effect.material.opacity = 1 - p * .35;
        effect.group.scale.setScalar(effect.element === 'wind' ? .8 + .9 * p : 1);
      }
    },
    clear,
    dispose() {
      if (disposed) return; disposed = true; clear();
      for (const entry of assets.values()) if (entry.asset) disposeAsset(entry.asset);
      assets.clear();
      for (const effect of effects) effect.material.dispose();
      sphere.dispose(); cone.dispose(); ring.dispose(); scene.remove(root);
    }
  };
}
