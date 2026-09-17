import { randomUUID } from 'node:crypto';
import { ownsStaff } from '../shared/equipment.js';
import { MAGIC } from '../shared/magic.js';
import { roleSkills } from '../shared/skills.js';
import { ensureSkills } from './skills.js';
import { breakCrateProtection } from './crate-effects.js';

const gap = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const point = value => ({ x: value.x, z: value.z });
export function magicAttack(sim, village, player, action) {
  if (action.kind !== 'attack' || player.tool !== 'staff') return null;
  ensureSkills(player);
  if (player.role !== 'wizard') throw new Error('Only wizards can wield a staff.');
  if (!ownsStaff(player)) throw new Error('Reclaim your staff for free at an Arcane Academy.');
  const stats = roleSkills(player), element = stats.staffElements.includes(player.staffElement) ? player.staffElement : 'fire', spell = MAGIC[element];
  if (Number.isFinite(player.staffReadyAt) && village.clock < player.staffReadyAt) throw new Error('Your staff is still recovering.');
  if (player.mana < spell.mana) throw new Error(`This spell needs ${spell.mana} mana. Let your mana recover.`);
  const targets = village.zombies.filter(target => target.hp > 0 && gap(player, target) <= MAGIC.range && sim.clearAttack(village, player, target, true)).sort((a, b) => gap(player, a) - gap(player, b));
  const first = targets[0], hits = first ? [first] : [];
  if (element === 'lightning') while (hits.length && hits.length < spell.chainTargets) {
    const prior = hits.at(-1);
    const next = village.zombies.filter(target => target.hp > 0 && !hits.includes(target) && gap(prior, target) <= spell.chainRange && sim.clearAttack(village, prior, target, false)).sort((a, b) => gap(prior, a) - gap(prior, b))[0];
    if (!next) break; hits.push(next);
  }
  player.mana -= spell.mana; player.staffReadyAt = village.clock + spell.cooldown;
  player.anim = 'attack'; player.animationUntil = village.clock + .55; breakCrateProtection(player);
  for (const [index, target] of hits.entries()) {
    sim.hitZombie(village, target, spell.damage * stats.staffDamageMultiplier * (element === 'lightning' ? spell.chainFalloff ** index : 1), player);
    if (target.hp > 0 && element === 'fire') {
      target.magicBurnUntil = village.clock + spell.burnSeconds;
      target.magicBurnDamage = spell.burnDamage * stats.staffDamageMultiplier;
      target.magicBurnOwnerId = player.id;
      target.magicBurnTickAt = village.clock;
    }
    if (target.hp > 0 && element === 'frost') target.magicSlowUntil = village.clock + spell.slowSeconds;
  }
  const destinations = hits.length ? hits : [{ x: player.x + Math.sin(player.yaw) * MAGIC.range, z: player.z + Math.cos(player.yaw) * MAGIC.range }];
  player.lastShot = { id: randomUUID(), at: village.clock, kind: 'magic', element, from: point(player), to: point(destinations[0]), segments: destinations.map((target, index) => ({ from: point(index ? destinations[index - 1] : player), to: point(target) })) };
  return hits.length ? `${spell.name} struck ${hits.length === 1 ? 'an enemy' : `${hits.length} enemies`}.` : `${spell.name} cast.`;
}
export function magicTick(sim, village, dt) {
  if (!Number.isFinite(dt) || dt <= 0) return;
  for (const player of Object.values(village.players)) {
    if (player.role !== 'wizard' || !player.online || player.downed || !(player.hp > 0)) continue;
    ensureSkills(player);
    player.mana = Math.min(player.manaMax, player.mana + MAGIC.manaRegen * dt);
  }
  for (const target of village.zombies) {
    if (!(target.hp > 0) || !Number.isFinite(target.magicBurnUntil) || !Number.isFinite(target.magicBurnTickAt) || !Number.isFinite(target.magicBurnDamage) || target.magicBurnDamage <= 0) continue;
    const end = Math.min(village.clock, target.magicBurnUntil), start = Math.max(village.clock - dt, target.magicBurnTickAt);
    if (end > start) sim.hitZombie(village, target, Math.min(MAGIC.fire.burnDamage * 1.2, target.magicBurnDamage) * (end - start), village.players[target.magicBurnOwnerId]);
    target.magicBurnTickAt = Math.max(target.magicBurnTickAt, end);
    if (village.clock >= target.magicBurnUntil) { target.magicBurnUntil = 0; target.magicBurnDamage = 0; }
  }
}
