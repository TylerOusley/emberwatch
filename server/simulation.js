import { randomUUID } from 'node:crypto';
import { CONFIG, ROAD, GUARD_ROAD, RESOURCES, BUILDINGS, SOLIDS, canStand, moveWithCollision, plotSolids } from '../shared/world.js';
import { ensureOwnership, ownershipAction, ownershipTick, ownershipSnapshot } from './ownership.js';
import { ensureEconomy, economyAction, economyDawn, economySnapshot } from './economy.js';
import { ensureCare, careAction, careTick, careNight, careSnapshot, guardPathFor, tickDefenseAttack, cancelCarry, cancelTreatment } from './care-defense.js';
import { ensureTransport, transportAction, transportTick, transportSnapshot, repayIncome, dismountPlayer, chargePurchase } from './transport.js';
import { ensureWorkers, workersAction, workersTick, workersSnapshot } from './workers.js';
import { TRANSPORT } from '../shared/transport.js';
import { stepNpcNavigation } from './navigation.js';
import { TOOL_TIERS, TOOL_WEIGHTS, carryCapacity, inventoryWeight } from '../shared/content.js';

import { ensureRoleStats, tickRoleStats, absorbDamage } from './roles.js';
import { STARTER_GOLD, FOOD_IDS, canEquip } from '../shared/equipment.js';
import { canUseBuilding } from '../shared/access.js';
const ROLES = new Set(['guard', 'priest', 'villager']);
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const emptyInventory = () => ({ timber: 0, stone: 0, wheat: 0, iron: 0, coal: 0, food: 0, good_food: 0, best_food: 0, arrows: 0, bow: 0, cart: 0 });
const durability = () => ({ sword: 0, axe: 0, pickaxe: 0, scythe: 0, hammer: 0, bow: 0 });
const makeResource = resource => ({ id: resource.id, available: true, remaining: resource.type === 'wheat' ? 1 : resource.type === 'timber' ? 5 : 8, regrowAt: 0 });
const building = id => BUILDINGS.find(b => b.id === id);
const nearStructure = (player, id, range = 3.5) => {
  const b = building(id);
  return Math.hypot(Math.max(0, Math.abs(player.x - b.x) - b.w / 2), Math.max(0, Math.abs(player.z - b.z) - b.d / 2)) <= range;
};

export function createVillage(name, creatorId, options = {}) {
  const village = {
    id: randomUUID(), name, creatorId, day: 1, phase: 'day', phaseRemaining: options.daySeconds ?? CONFIG.daySeconds,
    clock: 0, status: 'active', gate: { hp: CONFIG.gateMax, maxHp: CONFIG.gateMax }, keep: { hp: CONFIG.keepMax, maxHp: CONFIG.keepMax },
    treasury: 20000, stock: { timber: 60, stone: 40, wheat: 40 }, barracks: { wheat: 12 }, players: {},
    resources: RESOURCES.map(makeResource), zombies: [], guards: [0, 1].map(i => ({ id: `watch-${i}`, x: GUARD_ROAD[0].x, z: GUARD_ROAD[0].z + (i - .5) * 1.4, yaw: Math.PI / 2, hp: 160, maxHp: 160, anim: 'idle', roadIndex: 0, cooldown: 0, hungry: false })),
    nextSpawn: 0, spawned: 0, waveCount: 0, nightParticipants: [], warningSent: false
  };
  ensureVillage(village);
  return village;
}

// Add fields to existing runs without resetting balances, depleted nodes, or plots.
function ensureVillage(village) {
  const saved = new Map((village.resources ?? []).map(node => [node.id, node]));
  village.resources = RESOURCES.map(node => saved.get(node.id) ?? makeResource(node));
  if ((village.schemaVersion ?? 0) < 4 && village.phase === 'night') {
    for (const guard of village.guards ?? []) if (!guard.plotId && !guard.hungry && guard.hp > 0) guard.fedNight ??= village.day;
  }
  ensureEconomy(village); ensureOwnership(village); ensureCare(village); ensureTransport(village); ensureWorkers(village);
  for (const player of Object.values(village.players)) {
    ensureRoleStats(player, { clock: village.clock });
    player.inventory = { ...emptyInventory(), ...player.inventory };
    player.durability = { ...durability(), ...player.durability };
    if (!canEquip(player, player.tool) && !(player.tool === 'food' && FOOD_IDS.some(id => canEquip(player, id)))) player.tool = '';
    player.wageAccrued ??= 0;
    // Older builds only tracked participation; preserve that earned fraction once.
    if (player.wageVersion !== 1) {
      player.wageAccrued = ['guard', 'priest'].includes(player.role) ? 25 * Math.min(1, (player.participated ?? 0) / 720) : 0;
      player.wageVersion = 1;
    }
  }
  village.schemaVersion = 4;
}

function restoreState(target, source) {
  for (const key of Object.keys(target)) if (!Object.hasOwn(source, key)) delete target[key];
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && target[key] && typeof target[key] === 'object' && Array.isArray(value) === Array.isArray(target[key])) restoreState(target[key], value);
    else target[key] = value;
  }
  if (Array.isArray(source)) target.length = source.length;
}

export class Simulation {
  constructor(store, { daySeconds = CONFIG.daySeconds, nightSeconds = CONFIG.nightSeconds, devTools = false } = {}) {
    this.store = store;
    this.daySeconds = daySeconds;
    this.nightSeconds = nightSeconds;
    this.devTools = devTools;
    this.villages = new Map(store.loadVillages().map(village => {
      ensureVillage(village);
      for (const player of Object.values(village.players)) { player.online = false; player.anim = player.downed ? 'downed' : 'idle'; player.healing = null; }
      return [village.id, village];
    }));
    this.inputs = new Map();
    this.notices = [];
  }
  list() {
    return [...this.villages.values()].filter(v => v.status === 'active').map(v => ({ id: v.id, name: v.name, day: v.day, online: Object.values(v.players).filter(p => p.online).length, residents: Object.keys(v.players).length, maxResidents: 8, status: v.status }));
  }
  create(name, account) {
    if (typeof name !== 'string' || name.trim().length < 3 || name.trim().length > 32) throw new Error('Village names must be 3–32 characters.');
    if ([...this.villages.values()].some(v => v.creatorId === account.id && v.status === 'active')) throw new Error('You already founded an active village.');
    if ([...this.villages.values()].some(v => v.status === 'active' && v.players[account.id])) throw new Error('Your place is reserved in an active village. Rejoin it to continue.');
    const village = createVillage(name.trim(), account.id, this);
    this.store.saveVillage(village);
    this.villages.set(village.id, village);
    return this.list().find(v => v.id === village.id);
  }
  join(villageId, account, role = 'villager') {
    const village = this.villages.get(villageId);
    if (!village) throw new Error('Village not found.');
    if (!ROLES.has(role)) throw new Error('Choose guard, priest or villager.');
    if (village.status !== 'active') throw new Error('This village has fallen. Join or found a new village.');
    if ([...this.villages.values()].some(v => v.id !== villageId && v.status === 'active' && v.players[account.id])) throw new Error('You already have a reserved place in another active village.');
    let player = village.players[account.id];
    if (!player && Object.keys(village.players).length >= 8) throw new Error('All eight resident places are reserved, including offline residents.');
    this.store.transaction(() => {
      if (!player) {
        player = { id: account.id, name: account.name, role, x: (Object.keys(village.players).length % 3 - 1) * 1.5, z: 4, yaw: Math.PI, hp: 100, maxHp: 100, online: true, downed: false, respawnAvailable: false, tool: '', anim: 'idle', inventory: emptyInventory(), wallet: this.store.initialWallet(account.id, village.id), durability: durability(), backpackTier: 0, repairBonus: 0, jobBonus: 0, healingProgress: 0, revivedThisNight: [], participated: 0, lastAction: -100, animationUntil: 0, healing: null, hunger: 100 };
        ensureRoleStats(player, { fresh: true, clock: village.clock });
        village.players[account.id] = player;
      }
      player.online = true;
      ensureVillage(village);
      this.relocateBlocked(village);
      this.inputs.delete(player.id);
      this.store.saveVillage(village);
    });
    return player;
  }
  disconnect(villageId, playerId) {
    const village = this.villages.get(villageId), player = village?.players[playerId];
    if (!player) return;
    cancelCarry(village, player); cancelTreatment(village, player);
    dismountPlayer(village, player);
    player.online = false; player.healing = null; player.anim = player.downed ? 'downed' : 'idle';
    transportTick(this, village, 0);
    this.inputs.delete(player.id);
    this.store.saveVillage(village);
  }
  input(villageId, playerId, input) {
    const player = this.villages.get(villageId)?.players[playerId];
    if (!player?.online) return;
    if (![input.x, input.z, input.yaw].every(Number.isFinite) || Math.abs(input.x) > 100 || Math.abs(input.z) > 100 || Math.abs(input.yaw) > 1e6) throw new Error('Invalid movement.');
    const length = Math.hypot(input.x, input.z);
    this.inputs.set(playerId, { x: length > 1 ? input.x / length : input.x, z: length > 1 ? input.z / length : input.z, yaw: input.yaw, sprint: input.sprint === true, received: performance.now() });
    if (canEquip(player, input.tool) || input.tool === 'food' && FOOD_IDS.some(id => canEquip(player, id))) player.tool = input.tool;
  }
  snapshot(village, viewerId) {
    return { id: village.id, name: village.name, clock: village.clock, day: village.day, phase: village.phase, phaseRemaining: Math.ceil(village.phaseRemaining),
      phaseDuration: village.phase === 'night' ? this.nightSeconds : this.daySeconds,
      phaseEndsAt: Math.round((village.clock + Math.max(0, village.phaseRemaining)) * 1000) / 1000,
      clockRunning: village.status === 'active' && Object.values(village.players).some(p => p.online),
      gate: village.gate, keep: village.keep, treasury: village.treasury, stock: village.stock, barracks: village.barracks, status: village.status, devTools: this.devTools,
      ...ownershipSnapshot(village, viewerId), ...economySnapshot(village, viewerId), ...careSnapshot(village, viewerId, this), ...transportSnapshot(village, viewerId, this.store), ...workersSnapshot(village, viewerId),
      players: Object.values(village.players).map(p => ({ id: p.id, name: p.name, role: p.role, x: p.x, z: p.z, yaw: p.yaw, hp: p.hp, maxHp: p.maxHp, online: p.online, downed: p.downed, respawnAvailable: p.respawnAvailable, tool: p.tool, anim: p.anim,
        tiers: p.tiers, backpackTier: p.backpackTier, mountedHorseId: p.mountedHorseId, carryingId: p.carryingId, carriedBy: p.carriedBy, bedPlotId: p.bedPlotId,
        ...(p.id === viewerId ? { inventory: p.inventory, shield: p.shield, maxShield: p.maxShield, wallet: p.wallet, bank: this.store.account(p.id)?.bank ?? 0, durability: p.durability, repairBonus: p.repairBonus, jobBonus: p.jobBonus, hunger: Math.floor(p.hunger ?? 100), carryWeight: inventoryWeight(p), carryCapacity: carryCapacity(p), wageAccrued: Math.floor(p.wageAccrued ?? 0), healRemaining: p.healing ? Math.max(0, Math.ceil(p.healing.until - village.clock)) : 0 } : {}) })),
      zombies: village.zombies.filter(z => z.hp > 0).map(({ id, x, z, yaw, hp, maxHp, anim }) => ({ id, x, z, yaw, hp, maxHp, anim })),
      guards: village.guards.filter(g => g.hp > 0).map(({ id, x, z, yaw, hp, maxHp, anim, hungry, ownerId, plotId }) => ({ id, x, z, yaw, hp, maxHp, anim, hungry, ownerId, plotId })),
      resources: village.resources.map(({ id, available, remaining }) => ({ id, available, remaining })) };
  }
  notice(villageId, message) { this.notices.push({ villageId, message }); }
  action(villageId, playerId, action) {
    const village = this.villages.get(villageId);
    if (!village) throw new Error('Join a village first.');
    const checkpoint = structuredClone(village), noticeCount = this.notices.length;
    try { return this.store.transaction(() => this.performAction(villageId, playerId, action)); }
    catch (error) { restoreState(village, checkpoint); this.notices.length = noticeCount; throw error; }
  }
  performAction(villageId, playerId, action) {
    const village = this.villages.get(villageId), player = village?.players[playerId];
    if (!player?.online) throw new Error('Join a village first.');
    if (village.status !== 'active') throw new Error('The keep has fallen. This run has ended.');
    const kind = action.kind;
    if (typeof kind !== 'string') throw new Error('Invalid action.');
    if (player.downed && !['respawn', 'churchLeave'].includes(kind)) throw new Error('You are downed. A priest can revive you, or you can choose to respawn after dawn.');
    if (village.clock - player.lastAction < .55) throw new Error('Wait for your next action.');
    if (player.bedPlotId && !['churchLeave', 'respawn'].includes(kind)) throw new Error('Leave your church bed before taking another action.');
    if (player.carryingId && ['attack', 'gather', 'repair', 'repairPlot', 'heal', 'mountHorse'].includes(kind)) throw new Error('Put your companion down before using tools or weapons.');
    if (player.mountedHorseId && !['dismountHorse', 'attachCart', 'cartDeposit', 'cartWithdraw'].includes(kind)) throw new Error('Dismount before working, shopping, or fighting.');
    if (kind !== 'heal') player.healing = null;
    for (const handler of [ownershipAction, economyAction, careAction, transportAction, workersAction]) {
      const result = handler(this, village, player, action);
      if (result !== null && result !== undefined) {
        if (kind === 'plot_build') this.relocateBlocked(village);
        if (kind === 'role_change') { ensureRoleStats(player, { clock: village.clock }); if (!canEquip(player, player.tool)) player.tool = ''; }
        player.lastAction = village.clock;
        this.store.saveVillage(village);
        return result;
      }
    }
    const tool = player.tool;
    const use = required => {
      if (tool !== required) throw new Error(`Equip your ${required} first.`);
      if (!(player.durability[required] > 0)) throw new Error('Your tool has broken. Buy a replacement at Oak & Iron.');
    };
    let message;
    if (kind === 'attack') {
      const ranged = tool === 'bow';
      if (ranged) {
        if (!(player.durability.bow > 0)) throw new Error('Buy a bow at a tinker shop first.');
        if (!(player.inventory.arrows > 0)) throw new Error('You need arrows to fire your bow.');
      } else use('sword');
      const target = village.zombies.filter(z => z.hp > 0 && distance(player, z) <= (ranged ? 24 : 3.2) && this.clearAttack(village, player, z, ranged)).sort((a, b) => distance(player, a) - distance(player, b))[0];
      player.anim = 'attack'; player.animationUntil = village.clock + .45;
      if (ranged) player.inventory.arrows--;
      if (target) { const damage = ranged ? 22 : ({ wood: 10, stone: 15, iron: 20 }[player.tiers?.sword] ?? 10); this.hitZombie(village, target, damage * (player.role === 'guard' ? 1.2 : 1), player); message = ranged ? 'Arrow landed.' : 'Strike landed.'; }
    } else if (kind === 'repair') {
      use('hammer');
      const id = action.targetId === 'keep' ? 'keep' : action.targetId === 'gate' ? 'gate' : null;
      if (!id) throw new Error('Choose the gate or keep to repair.');
      if (id === 'gate' ? distance(player, { x: 0, z: 18 }) > 4.5 : !nearStructure(player, 'keep', 4.5)) throw new Error('Move closer to the damaged structure.');
      const structure = village[id];
      if (structure.hp >= structure.maxHp) throw new Error('This structure is already fully repaired.');
      const cost = id === 'gate' ? { timber: 1, stone: 0 } : { timber: 1, stone: 1 };
      if (village.stock.timber < cost.timber || village.stock.stone < cost.stone) throw new Error('The village needs more repair materials.');
      if (player.repairBonus < CONFIG.repairCap && village.treasury < 1) throw new Error('The treasury cannot currently fund repair work.');
      village.stock.timber -= cost.timber; village.stock.stone -= cost.stone;
      structure.hp = Math.min(structure.maxHp, structure.hp + (TOOL_TIERS[player.tiers?.hammer ?? 'wood']?.repair ?? 35));
      player.durability.hammer -= 1;
      if (player.repairBonus < CONFIG.repairCap) { player.repairBonus++; village.treasury--; }
      player.anim = 'repair'; player.animationUntil = village.clock + .5;
      message = `Repaired ${id}. Repair earnings: ${player.repairBonus}/10, paid at dawn.`;
    } else if (kind === 'heal') {
      if (player.role !== 'priest') throw new Error('Only priests can heal and revive other dwarfs.');
      const target = village.players[action.targetId];
      if (!target?.online || target.id === player.id || distance(player, target) > 3.5) throw new Error('Move near another injured dwarf.');
      if (target.hp >= target.maxHp) throw new Error('That dwarf is already healthy.');
      if (player.healing) throw new Error('Your blessing is already in progress. Stay nearby.');
      player.healing = { targetId: target.id, revive: target.downed, until: village.clock + (target.downed ? 5 : 2) };
      player.anim = 'heal'; player.animationUntil = player.healing.until;
      message = target.downed ? 'Hold still for 5 seconds to revive your companion.' : 'Hold still to heal your companion.';
    } else if (kind === 'respawn') {
      if (!player.downed || !player.respawnAvailable) throw new Error('Respawning unlocks at the next dawn.');
      cancelCarry(village, player); cancelTreatment(village, player);
      player.inventory = emptyInventory(); player.wallet = Math.floor(player.wallet * .75); player.durability = durability(); player.backpackTier = 0;
      player.tiers = { sword: 'wood', axe: 'wood', pickaxe: 'wood', scythe: 'wood', hammer: 'wood' };
      Object.assign(player, { downed: false, respawnAvailable: false, hp: 100, hunger: 100, x: 0, z: 4, yaw: Math.PI, tool: '', anim: 'idle', healing: null });
      ensureRoleStats(player, { fresh: true, clock: village.clock });
      message = 'You returned empty-handed. Your carried inventory, equipment, backpack and 25% of wallet gold were lost. Your bank savings are safe.';
    } else if (kind === 'deposit' || kind === 'withdraw') {
      if (!canUseBuilding(player, building('bank'))) throw new Error('Visit the Village Treasury to use your savings.');
      if (!Number.isSafeInteger(action.amount) || action.amount < 1 || action.amount > 1000000) throw new Error('Enter a whole gold amount.');
      if (kind === 'deposit' && player.wallet < action.amount) throw new Error('You do not have that much gold in your wallet.');
      const delta = kind === 'deposit' ? action.amount : -action.amount;
      this.store.transaction(() => { this.store.bank(player.id, delta); player.wallet -= delta; this.store.saveVillage(village); });
      message = kind === 'deposit' ? 'Gold secured in your personal bank.' : 'Gold withdrawn to your wallet.';
    } else if (kind === 'donate') {
      if (action.targetId === 'barracks') {
        if (!canUseBuilding(player, building('barracks'))) throw new Error('Bring wheat to The Watch to feed the guards.');
        if (!player.inventory.wheat) throw new Error('Gather some wheat for the barracks first.');
        village.barracks.wheat += player.inventory.wheat;
        message = `${player.inventory.wheat} wheat delivered to the barracks.`;
        player.inventory.wheat = 0;
      } else {
        if (!canUseBuilding(player, building('bank'))) throw new Error('Bring your materials to the Village Treasury.');
        const total = player.inventory.timber + player.inventory.stone + player.inventory.wheat;
        if (!total) throw new Error('You have no materials to donate.');
        for (const id of ['timber', 'stone', 'wheat']) { village.stock[id] += player.inventory[id]; player.inventory[id] = 0; }
        message = `${total} materials donated to village supplies.`;
      }
    } else if (kind === 'buyTool') {
      if (!canUseBuilding(player, building('tools'))) throw new Error('Visit Oak & Iron to buy wooden tools.');
      if (!['axe', 'pickaxe', 'scythe', 'hammer'].includes(action.tool)) throw new Error('Choose a wooden gathering tool or hammer.');
      if (player.durability[action.tool] > 0) throw new Error('Your current tool still has durability remaining.');
      if (inventoryWeight(player) + TOOL_WEIGHTS[action.tool] > carryCapacity(player)) throw new Error('Make room in your pack before buying another tool.');
      chargePurchase(this, village, player, STARTER_GOLD, { credit: true }); village.treasury += STARTER_GOLD; player.durability[action.tool] = 100;
      player.tiers[action.tool] = 'wood';
      if (!player.tool || !canEquip(player, player.tool)) player.tool = action.tool;
      message = `Purchased a wooden ${action.tool}.`;
    } else if (kind === 'startNight') {
      if (!this.devTools) throw new Error('Testing controls are disabled.');
      if (village.phase !== 'day') throw new Error('It is already nighttime.');
      this.startNight(village);
      message = 'Test night started.';
    } else throw new Error('Unknown action.');
    player.lastAction = village.clock;
    // Save all successful authoritative mutations before reporting them to the client.
    this.store.saveVillage(village);
    return message;
  }
  awardJob(village, player, gold) {
    const awarded = Math.min(gold, 25 - player.jobBonus, village.treasury);
    if (awarded > 0) { player.jobBonus += awarded; village.treasury -= awarded; }
  }
  awardIncome(village, player, gold) {
    if (!Number.isSafeInteger(gold) || gold < 0) throw new Error('Income must be whole gold.');
    const net = repayIncome(this, village, player, gold);
    player.wallet += net;
    return net;
  }
  relocateBlocked(village) {
    const solids = plotSolids(village.plots);
    for (const entity of [...Object.values(village.players), ...village.guards, ...village.zombies, ...village.horses, ...village.carts, ...village.workers]) {
      if (entity.bedPlotId || entity.carriedBy || canStand(entity.x, entity.z, .5, solids)) continue;
      let found = false;
      for (let radius = 1; radius <= 20 && !found; radius++) for (let i = 0; i < 24; i++) {
        const x = entity.x + Math.sin(i * Math.PI / 12) * radius, z = entity.z + Math.cos(i * Math.PI / 12) * radius;
        if (canStand(x, z, .6, solids)) { entity.x = x; entity.z = z; found = true; break; }
      }
    }
  }
  clearAttack(village, from, target, ranged = false) {
    if (village.gate.hp > 0 && ((from.z < 18 && target.z > 18) || (target.z < 18 && from.z > 18))) return false;
    const dx = target.x - from.x, dz = target.z - from.z, length = Math.hypot(dx, dz);
    if (ranged && (dx * Math.sin(from.yaw) + dz * Math.cos(from.yaw)) / Math.max(.01, length) < .35) return false;
    for (const solid of [...SOLIDS, ...plotSolids(village.plots)]) {
      // Slab intersection prevents striking through a shop, wall, or plot building.
      let lo = .03, hi = .97;
      for (const [position, delta, center, size] of [[from.x, dx, solid.x, solid.w], [from.z, dz, solid.z, solid.d]]) {
        if (Math.abs(delta) < 1e-8) { if (Math.abs(position - center) > size / 2) { lo = 1; break; } }
        else { const a = (center - size / 2 - position) / delta, b = (center + size / 2 - position) / delta; lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b)); }
      }
      if (lo <= hi) return false;
    }
    return true;
  }
  hitZombie(village, zombie, damage, player) {
    if (zombie.hp <= 0 || !Number.isFinite(damage) || damage <= 0) return;
    const actual = Math.min(zombie.hp, damage);
    if (player?.online && player.role === 'guard') {
      zombie.contributors ??= {};
      zombie.contributors[player.id] = (zombie.contributors[player.id] ?? 0) + actual;
    }
    zombie.hp = Math.max(0, zombie.hp - damage);
    if (zombie.hp <= 0) for (const [id, contribution] of Object.entries(zombie.contributors ?? {})) {
      const contributor = village.players[id];
      if (contributor?.online && contributor.role === 'guard' && (contribution >= zombie.maxHp * .15 || id === player?.id)) this.awardJob(village, contributor, zombie.elite ? 3 : 1);
    }
  }
  hurtPlayer(village, player, damage) {
    player.hp = Math.max(0, player.hp - absorbDamage(village, player, damage));
    if (player.hp <= 0) { cancelCarry(village, player); cancelTreatment(village, player); dismountPlayer(village, player); player.downed = true; player.respawnAvailable = false; player.anim = 'downed'; player.healing = null; this.inputs.delete(player.id); }
  }
  startNight(village) {
    village.phase = 'night'; village.phaseRemaining = this.nightSeconds; village.spawned = 0; village.nextSpawn = village.clock + 2;
    const active = Object.values(village.players).filter(p => p.online).length;
    const band = Math.floor((village.day - 1) / 5);
    village.waveCount = Math.min(80, 5 + active * 3 + band * 5);
    village.nightParticipants = Object.values(village.players).filter(p => p.online).map(p => p.id);
    careNight(this, village);
    this.notice(village.id, `Night ${village.day}. Defend the gate together.`);
  }
  dawn(village) {
    return this.store.transaction(() => this.payDawn(village));
  }
  payDawn(village) {
    const survived = village.day;
    village.phase = 'day'; village.phaseRemaining = this.daySeconds; village.day++; village.warningSent = false;
    village.treasury += 1000 * survived;
    economyDawn(this, village);
    for (const player of Object.values(village.players)) {
      if (player.downed) player.respawnAvailable = true;
      const base = Math.floor((player.wageAccrued ?? 0) + 1e-7);
      const funded = Math.min(base, village.treasury); village.treasury -= funded;
      this.awardIncome(village, player, funded + player.jobBonus + player.repairBonus);
      player.jobBonus = 0; player.repairBonus = 0; player.participated = 0; player.revivedThisNight = [];
      player.wageAccrued = 0; player.cycleServiceIncome = 0;
    }
    this.notice(village.id, `Dawn breaks. Night ${survived} survived. Remaining zombies must still be defeated.`);
    this.store.saveVillage(village);
  }
  tick(dt) {
    for (const village of this.villages.values()) {
      if (village.status !== 'active' || !Object.values(village.players).some(p => p.online)) continue;
      village.clock += dt; village.phaseRemaining -= dt;
      const solids = plotSolids(village.plots);
      ownershipTick(this, village, dt);
      for (const player of Object.values(village.players)) {
        if (!player.online) continue;
        tickRoleStats(village, player, dt);
        player.participated += dt;
        if (village.phase === 'night' && !village.nightParticipants.includes(player.id)) village.nightParticipants.push(player.id);
        const wage = player.role === 'guard' ? village.policies.guardWage : player.role === 'priest' ? village.policies.priestWage : 0;
        player.wageAccrued = (player.wageAccrued ?? 0) + wage * dt / (this.daySeconds + this.nightSeconds);
        if (player.downed) continue;
        player.hunger = Math.max(0, (player.hunger ?? 100) - dt * .05);
        const input = this.inputs.get(player.id);
        const fresh = input && performance.now() - input.received < 700;
        // Gathering and blessings can turn toward a target without walking.
        if (fresh) player.yaw = input.yaw;
        if (fresh && !player.bedPlotId && !player.carriedBy && Math.hypot(input.x, input.z) > .02) {
          player.healing = null;
          let speed = player.mountedHorseId ? TRANSPORT.horseSpeed : input.sprint && player.hunger > 0 ? CONFIG.sprintSpeed : CONFIG.speed;
          if (player.carryingId) speed = CONFIG.speed * .55;
          if (inventoryWeight(player) > carryCapacity(player)) speed *= .65;
          moveWithCollision(player, input.x * speed * dt, input.z * speed * dt, player.mountedHorseId ? .8 : CONFIG.playerRadius, solids);
          if (village.clock > player.animationUntil) player.anim = input.sprint ? 'run' : 'walk';
        } else if (player.bedPlotId) player.anim = 'downed';
        else if (village.clock > player.animationUntil) player.anim = 'idle';
        if (player.healing) {
          const target = village.players[player.healing.targetId];
          if (!target?.online || distance(player, target) > 3.5 || target.downed !== player.healing.revive) { player.healing = null; continue; }
          if (village.clock >= player.healing.until) {
            const wasDowned = target.downed;
            const restored = Math.min(wasDowned ? 45 : 30, target.maxHp - target.hp);
            target.hp += restored;
            if (wasDowned) {
              target.downed = false; target.respawnAvailable = false; target.anim = 'idle';
              if (!player.revivedThisNight.includes(target.id)) { this.awardJob(village, player, 5); player.revivedThisNight.push(target.id); }
            } else {
              player.healingProgress += restored;
              const rewards = Math.floor(player.healingProgress / 50); player.healingProgress %= 50;
              this.awardJob(village, player, rewards);
            }
            player.healing = null;
            this.store.saveVillage(village);
          }
        }
      }
      careTick(this, village, dt);
      transportTick(this, village, dt);
      for (let i = 0; i < village.resources.length; i++) {
        const node = village.resources[i];
        if (!node.available && village.clock >= node.regrowAt) Object.assign(node, makeResource(RESOURCES[i]));
      }
      workersTick(this, village, dt);
      if (village.phase === 'night' && village.spawned < village.waveCount && village.clock >= village.nextSpawn) {
        const band = Math.floor((village.day - 1) / 5), elite = band > 0 && village.spawned % 5 === 0;
        village.zombies.push({ id: randomUUID(), x: ROAD[0].x + (village.spawned % 3 - 1) * 1.3, z: ROAD[0].z + (village.spawned % 2) * 1.5, yaw: Math.PI, hp: elite ? 120 + band * 20 : 65 + band * 14, maxHp: elite ? 120 + band * 20 : 65 + band * 14, anim: 'walk', roadIndex: 1, cooldown: 0, elite, speed: 1.75 + Math.min(band * .08, .65) });
        village.spawned++; village.nextSpawn = village.clock + Math.max(1.5, 6 - band * .4);
      }
      this.tickNpcs(village, dt);
      if (village.status === 'fallen') continue;
      if (village.phaseRemaining <= 0) { if (village.phase === 'day') this.startNight(village); else this.dawn(village); }
      if (village.phase === 'day' && village.day % 5 === 1 && village.day > 1 && !village.warningSent) { village.warningSent = true; this.notice(village.id, 'A stronger horde is stirring in the graveyard. Prepare before tonight.'); }
      village.zombies = village.zombies.filter(z => z.hp > 0);
    }
  }
  stepNpc(entity, target, speed, dt, neighbors = []) {
    return stepNpcNavigation(entity, target, speed, dt, neighbors, this.activeSolids ?? []);
  }
  tickNpcs(village, dt) {
    this.activeSolids = plotSolids(village.plots);
    const alivePlayers = Object.values(village.players).filter(p => p.online && !p.downed);
    const guards = village.guards.filter(g => g.hp > 0);
    const zombies = village.zombies.filter(z => z.hp > 0);
    for (const guard of guards) {
      const guardPath = guardPathFor(village, guard);
      guard.cooldown = Math.max(0, guard.cooldown - dt);
      const target = zombies.filter(z => z.hp > 0 && distance(guard, z) < 12 && z.z < 55).sort((a, b) => distance(guard, a) - distance(guard, b))[0];
      if (target) {
        if (distance(guard, target) > 2.1 || !this.clearAttack(village, guard, target)) this.stepNpc(guard, target, 3.4, dt, guards);
        else { guard.anim = 'attack'; guard.yaw = Math.atan2(target.x - guard.x, target.z - guard.z); if (!guard.cooldown && this.clearAttack(village, guard, target)) { this.hitZombie(village, target, (guard.damage ?? 14) * (guard.hungry ? .75 : 1), village.players[guard.ownerId]); guard.cooldown = 1.05; } }
      } else {
        const point = guardPath[Math.min(guard.roadIndex, guardPath.length - 1)];
        if (distance(guard, point) < 1.4 && guard.roadIndex < guardPath.length - 1) guard.roadIndex++;
        const destination = guard.roadIndex === guardPath.length - 1 ? guard.post ?? { x: guard.id.endsWith('0') ? -2 : 2, z: 35 } : point;
        this.stepNpc(guard, destination, 3, dt, guards);
      }
    }
    for (const zombie of zombies) {
      if (zombie.hp <= 0) continue;
      zombie.cooldown = Math.max(0, zombie.cooldown - dt);
      const defenders = [...alivePlayers.filter(p => !p.downed), ...guards.filter(g => g.hp > 0)];
      // An intact gate blocks attacks/aggro across the doorway until a defender steps outside.
      const target = defenders.filter(d => distance(zombie, d) < 7 && !(village.gate.hp > 0 && zombie.z > 18 && d.z < 18)).sort((a, b) => distance(zombie, a) - distance(zombie, b))[0];
      if (target) {
        if (distance(zombie, target) > 1.9 || !this.clearAttack(village, zombie, target)) this.stepNpc(zombie, target, zombie.speed, dt, zombies);
        else { zombie.anim = 'attack'; zombie.yaw = Math.atan2(target.x - zombie.x, target.z - zombie.z); if (!zombie.cooldown && this.clearAttack(village, zombie, target)) { if ('online' in target) this.hurtPlayer(village, target, zombie.elite ? 15 : 9); else target.hp = Math.max(0, target.hp - (zombie.elite ? 15 : 9)); zombie.cooldown = 1.5; } }
        continue;
      }
      if (tickDefenseAttack(this, village, zombie, dt)) continue;
      if (village.gate.hp > 0 && zombie.z >= 18 && zombie.z <= 23 && zombie.roadIndex >= 3) {
        zombie.anim = 'attack'; zombie.yaw = Math.PI;
        if (!zombie.cooldown) { village.gate.hp = Math.max(0, village.gate.hp - (zombie.elite ? 15 : 8)); zombie.cooldown = 1.4; }
      } else if (zombie.z <= -33) {
        zombie.anim = 'attack'; zombie.yaw = Math.PI;
        if (!zombie.cooldown) { village.keep.hp = Math.max(0, village.keep.hp - (zombie.elite ? 20 : 10)); zombie.cooldown = 1.4; }
        if (village.keep.hp <= 0) { village.status = 'fallen'; this.notice(village.id, 'The Hearthkeep has fallen. Your personal bank savings are safe.'); this.store.saveVillage(village); return; }
      } else {
        const point = ROAD[Math.min(zombie.roadIndex, ROAD.length - 1)];
        if (distance(zombie, point) < 2 && zombie.roadIndex < ROAD.length - 1) zombie.roadIndex++;
        this.stepNpc(zombie, ROAD[Math.min(zombie.roadIndex, ROAD.length - 1)], zombie.speed, dt, zombies);
      }
    }
  }
  saveAll() { for (const village of this.villages.values()) this.store.saveVillage(village); }
}
