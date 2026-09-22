import { randomUUID } from 'node:crypto';
import { canStand, groundHeight, plotSolids } from '../shared/world.js';
import { equippedPet } from './pets.js';
import { stepNpcNavigation, resetNpcNavigation } from './navigation.js';

export const PET_COMBAT = Object.freeze({ acquire: 8, leash: 10, catchUp: 18, follow: 1.6, speed: 6.5, windup: .35, projectileSeconds: .3 });
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const point = actor => ({ x: actor.x, y: groundHeight(actor.x, actor.z) + (actor.flying ? 1.6 : .5), z: actor.z });
const alive = p => p?.online && p.hp > 0 && !p.downed;
const canFight = p => alive(p) && !p.mountedHorseId && !p.bedPlotId && !p.carriedBy && !p.carryingId && !p.rescueCartId;
function spawnNear(owner, solids) {
  for (const radius of [PET_COMBAT.follow, 1, .5, 0]) for (let i = 0; i < 8; i++) {
    const angle = (owner.yaw ?? 0) + Math.PI + i * Math.PI / 4;
    const candidate = { x: owner.x + Math.sin(angle) * radius, z: owner.z + Math.cos(angle) * radius };
    if (canStand(candidate.x, candidate.z, .4, solids)) return candidate;
  }
  return { x: owner.x, z: owner.z };
}

// Account ownership is authoritative. Cached equipped lookups are invalidated
// immediately by account equip actions, so a saved player field never grants a pet.
export function syncPetCompanions(sim, village) {
  const previous = new Map((village.petActors ?? []).map(actor => [actor.ownerId, actor]));
  const actors = [], solids = plotSolids(village.plots ?? []);
  for (const owner of Object.values(village.players ?? {})) {
    const pet = equippedPet(sim.store, owner.id, sim.petOptions);
    owner.petSpeciesId = pet?.id ?? '';
    if (!Number.isFinite(owner.petReadyAt) || owner.petReadyAt < 0) owner.petReadyAt = 0;
    if (!pet || village.status !== 'active' || !alive(owner)) continue;
    let actor = previous.get(owner.id);
    if (!actor || actor.speciesId !== pet.id || ![actor.x, actor.z].every(Number.isFinite)) {
      actor = { id: `pet:${owner.id}`, ownerId: owner.id, speciesId: pet.id, ...spawnNear(owner, solids), yaw: owner.yaw ?? 0, anim: 'idle', targetId: null, lastAttack: null, pending: null };
    }
    actor.flying = Boolean(pet.flying);
    actors.push(actor);
  }
  village.petActors = actors;
  return actors;
}

function legalTarget(sim, village, actor, owner, target, attack) {
  return target?.hp > 0 && canFight(owner) && distance(owner, actor) <= PET_COMBAT.leash && distance(owner, target) <= PET_COMBAT.acquire &&
    distance(actor, target) <= attack.range + 1e-6 && Math.abs(groundHeight(actor.x, actor.z) - groundHeight(target.x, target.z)) < 2 &&
    sim.clearAttack(village, actor, target, false);
}
function stopAttack(actor, clock) {
  if (actor.pending && actor.lastAttack) Object.assign(actor.lastAttack, { cancelled: true, until: clock });
  actor.pending = null; actor.targetId = null; actor.anim = 'idle';
}
function restore(target, source) {
  for (const key of Object.keys(target)) if (!Object.hasOwn(source, key)) delete target[key];
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && target[key] && typeof target[key] === 'object' && Array.isArray(value) === Array.isArray(target[key])) restore(target[key], value);
    else target[key] = value;
  }
  if (Array.isArray(source)) target.length = source.length;
}
function impact(sim, village, actor, owner, target, attack) {
  // Impact, healing, paid bounties and the consumed intention are one commit.
  // Checkpoint only an actual hit, never the ordinary follow/movement frames.
  const checkpoint = structuredClone(village), noticeCount = sim.notices?.length;
  try { sim.store.transaction(() => {
    actor.pending = null; actor.anim = 'idle';
    const before = target.hp;
    sim.hitZombie(village, target, attack.damage, owner);
    if (attack.healOnHit && target.hp < before && alive(owner)) owner.hp = Math.min(owner.maxHp, owner.hp + attack.healOnHit);
    sim.store.saveVillage(village);
  }); } catch (error) {
    restore(village, checkpoint);
    if (Number.isInteger(noticeCount)) sim.notices.length = noticeCount;
    throw error;
  }
}

export function tickPetCompanions(sim, village, dt) {
  if (!Number.isFinite(dt) || dt <= 0 || village.status !== 'active') return;
  const actors = syncPetCompanions(sim, village), solids = plotSolids(village.plots ?? []);
  for (const actor of actors) {
    const owner = village.players[actor.ownerId], pet = equippedPet(sim.store, owner.id, sim.petOptions), attack = pet?.attack;
    if (!pet || pet.id !== actor.speciesId) continue;
    // Catch up after fast travel or a route reset. Cancel the old intention first;
    // neither a melee strike nor a projectile can teleport to its former victim.
    if (distance(actor, owner) > PET_COMBAT.catchUp || !canStand(actor.x, actor.z, .4, solids)) {
      stopAttack(actor, village.clock); Object.assign(actor, spawnNear(owner, solids)); resetNpcNavigation(actor); continue;
    }
    if (actor.pending) {
      const pending = actor.pending, target = village.zombies.find(z => z.id === pending.targetId);
      if (!attack || !pending.ownerFrom || !legalTarget(sim, village, actor, owner, target, attack) || distance(owner, pending.ownerFrom) > 4) { stopAttack(actor, village.clock); continue; }
      actor.yaw = Math.atan2(target.x - actor.x, target.z - actor.z);
      if (village.clock < pending.impactAt) continue;
      impact(sim, village, actor, owner, target, attack);
      continue;
    }
    let target = null;
    if (attack && canFight(owner) && distance(actor, owner) <= PET_COMBAT.leash) {
      target = village.zombies.filter(z => z.hp > 0 && distance(owner, z) <= PET_COMBAT.acquire && Math.abs(groundHeight(actor.x, actor.z) - groundHeight(z.x, z.z)) < 2 && sim.clearAttack(village, actor, z, false))
        .sort((a, b) => distance(actor, a) - distance(actor, b))[0];
    }
    actor.targetId = target?.id ?? null;
    if (target && legalTarget(sim, village, actor, owner, target, attack)) {
      actor.anim = 'idle'; actor.yaw = Math.atan2(target.x - actor.x, target.z - actor.z);
      if (village.clock < owner.petReadyAt) continue;
      owner.petReadyAt = village.clock + attack.cooldown;
      const impactAt = village.clock + PET_COMBAT.windup + (attack.kind === 'ranged' ? PET_COMBAT.projectileSeconds : 0);
      actor.pending = { targetId: target.id, impactAt, ownerFrom: { x: owner.x, z: owner.z } };
      actor.lastAttack = { id: randomUUID(), kind: attack.kind, projectile: attack.projectile ?? null, from: point(actor), to: { x: target.x, y: groundHeight(target.x, target.z) + .8, z: target.z }, at: village.clock, launchAt: village.clock + PET_COMBAT.windup, impactAt, until: impactAt + .3 };
      actor.anim = 'attack';
      continue;
    }
    const destination = target && distance(owner, target) <= PET_COMBAT.acquire ? target : spawnNear(owner, solids);
    if (distance(actor, destination) > (target ? attack.range * .8 : .6)) {
      const before = { x: actor.x, z: actor.z };
      stepNpcNavigation(actor, destination, PET_COMBAT.speed, Math.min(dt, .25), actors.filter(p => p !== actor), solids, dt);
      actor.anim = distance(actor, before) > .001 ? 'walk' : 'idle';
    } else actor.anim = 'idle';
  }
}

export function petCompanionsSnapshot(village) {
  return { petActors: (village.petActors ?? []).map(({ id, ownerId, speciesId, x, z, yaw, anim, targetId, lastAttack, flying }) =>
    ({ id, ownerId, speciesId, x, z, yaw, anim, targetId, flying, lastAttack: lastAttack ? structuredClone(lastAttack) : null })) };
}
