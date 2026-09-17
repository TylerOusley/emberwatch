import { randomUUID } from 'node:crypto';
import { CONFIG, ROAD, GUARD_ROAD, RESOURCES, BUILDINGS, SOLIDS, canStand, moveWithCollision, plotSolids } from '../shared/world.js';
import { ensureOwnership, ownershipAction, ownershipTick, ownershipSnapshot } from './ownership.js';
import { ensureEconomy, economyAction, economyDawn, economySnapshot } from './economy.js';
import { ensureCare, careAction, careTick, careNight, careSnapshot, guardPathFor, tickDefenseAttack, cancelCarry, cancelTreatment, resolveHealTarget } from './care-defense.js';
import { ensureTransport, transportAction, transportTick, transportSnapshot, repayIncome, dismountPlayer, releaseTransportPassenger, chargePurchase, bankTransfer } from './transport.js';
import { ensureWorkers, workersAction, workersTick, workersSnapshot } from './workers.js';
import { TRANSPORT, mountedTravelSpeed } from '../shared/transport.js';
import { stepNpcNavigation } from './navigation.js';
import { TOOL_TIERS, TOOL_WEIGHTS, carryCapacity, inventoryWeight, acquiredToolDurability, normalizeToolDurability, transferableCount } from '../shared/content.js';

import { ensureRoleStats, tickRoleStats, absorbDamage } from './roles.js';
import { STARTER_GOLD, FOOD_IDS, canEquip } from '../shared/equipment.js';
import { canUseBuilding } from '../shared/access.js';
import { ENEMY_TYPES, MELEE, inMeleeArc, enemyKind } from '../shared/enemies.js';
import { ensureEnemies, spawnWaveEnemy, splitEnemy, enemySnapshot, cancelZombieWindup, attackZombieStructure, beginZombieAttack, tickZombieAttack, nightIsCleared } from './enemies.js';
import { ensureRequests, requestsTick, requestsSnapshot, requestsAction, requestsBeforeAction, requestsAfterAction } from './requests.js';
import { ensureProgression, joinProgression, progressionNight, progressionTick, progressionDawn, progressionAction, recordProgressionAction, progressionSnapshot } from './progression.js';
import { guardOrdersAction, guardOrdersSnapshot, guardDirective, guardOrderCanEngage } from './guard-orders.js';
import { ensureCaves, regrowCaveResource, publicResourceSnapshot } from './caves.js';
import { ensureTrading, tradingAction, tradingTick, tradingSnapshot, cancelPlayerTrades } from './trading.js';
import { joinCrates, crateAction, crateSnapshot, forfeitCrates, refreshCrateMilestones } from './crates.js';
import { ensureCrateEffects, crateProtectionActive, breakCrateProtection, crateEnemyDamage, crateAfterEnemyHit, crateRespawnEffects, emberWardStatus } from './crate-effects.js';
import { TEST_GOLD } from './admin.js';
import { ensureVillageFinance, villageFinanceAction, villageFinanceDawn, villageFinanceSnapshot, villageFinanceTick } from './village-finance.js';
import { MUSKET } from '../shared/firearms.js';
import { ensureEnvironment, tickEnvironment, environmentSnapshot } from './environment.js';
import { tickRangedTroop, troopCanEngage } from './troop-combat.js';
import { ROLE_STATS } from '../shared/roles.js';
import { roleSkills } from '../shared/skills.js';
import { ensureSkills, skillsAction, skillsSnapshot } from './skills.js';
import { magicAttack, magicTick } from './magic.js';
import { magicMovementMultiplier } from '../shared/magic.js';
import { ensureCivic, civicAction, civicTick, civicSnapshot } from './civic.js';
import { movePlayer, resetJump } from '../shared/movement.js';
const ROLES = new Set(Object.keys(ROLE_STATS));
const FINANCE_ACTIONS = new Set(['investment_deposit', 'investment_withdraw', 'investment_claim', 'investment_reinvest', 'tavern_bet']);
// Form transfers and release actions are immediately validated transactions;
// they should not inherit the swing delay used for tools and combat.
const IMMEDIATE_ACTIONS = new Set(['ember_ward', 'civic_select', 'civic_donate', 'civic_supply', 'academy_learn', 'staff_element', 'cartRescueUnload', 'cartRescueTreat', 'cartPlotLoad', 'cartPlotUnload', 'dropPlayer', 'churchLeave', 'dismountHorse', 'plot_deposit', 'plot_withdraw', 'cartDeposit', 'cartWithdraw', 'deposit', 'withdraw', 'trade_invite', 'trade_accept', 'trade_offer', 'trade_confirm', 'trade_cancel', 'crate_open', 'crate_loadout', 'phoenix_revive', 'investment_deposit', 'investment_withdraw', 'investment_claim', 'investment_reinvest', 'tavern_bet']);
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const emptyInventory = () => ({ timber: 0, stone: 0, wheat: 0, iron: 0, coal: 0, sulfur: 0, gunpowder: 0, musket_ammo: 0, food: 0, good_food: 0, best_food: 0, arrows: 0, bow: 0, musket: 0, cart: 0 });
const durability = () => ({ sword: 0, axe: 0, pickaxe: 0, scythe: 0, hammer: 0, bow: 0, musket: 0 });
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
  ensureEconomy(village); ensureOwnership(village); ensureCare(village); ensureTransport(village); ensureWorkers(village); ensureEnemies(village); ensureRequests(village); ensureProgression(village);
  ensureCaves(village);
  ensureTrading(village);
  ensureVillageFinance(village);
  ensureEnvironment(village); ensureCivic(village);
  for (const player of Object.values(village.players)) {
    ensureSkills(player); ensureRoleStats(player, { clock: village.clock });
    ensureCrateEffects(village, player);
    player.inventory = { ...emptyInventory(), ...player.inventory };
    player.durability = { ...durability(), ...player.durability };
    normalizeToolDurability(player);
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
      for (const player of Object.values(village.players)) { player.online = false; player.anim = player.downed ? 'downed' : 'idle'; player.healing = null; resetJump(player); }
      for (const player of Object.values(village.players)) cancelPlayerTrades(village, player.id);
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
    if (!ROLES.has(role)) throw new Error('Choose one of the six village roles.');
    if (village.status !== 'active') throw new Error('This village has fallen. Join or found a new village.');
    if ([...this.villages.values()].some(v => v.id !== villageId && v.status === 'active' && v.players[account.id])) throw new Error('You already have a reserved place in another active village.');
    let player = village.players[account.id];
    if (!player && Object.keys(village.players).length >= 8) throw new Error('All eight resident places are reserved, including offline residents.');
    const fresh = !player, checkpoint = structuredClone(village);
    try { this.store.transaction(() => {
      if (!player) {
        player = { id: account.id, name: account.name, role, x: (Object.keys(village.players).length % 3 - 1) * 1.5, z: 4, yaw: Math.PI, hp: 100, maxHp: 100, online: true, downed: false, respawnAvailable: false, tool: '', anim: 'idle', inventory: emptyInventory(), wallet: this.store.initialWallet(account.id, village.id), durability: durability(), backpackTier: 0, repairBonus: 0, jobBonus: 0, healingProgress: 0, revivedThisNight: [], participated: 0, lastAction: -100, animationUntil: 0, healing: null, hunger: 100 };
        ensureRoleStats(player, { fresh: true, clock: village.clock });
        village.players[account.id] = player;
      }
      player.online = true;
      ensureVillage(village);
      transportTick(this, village, 0);
      joinProgression(this, village, player);
      joinCrates(this, village, player, { fresh });
      this.relocateBlocked(village);
      resetJump(player);
      this.inputs.delete(player.id);
      this.store.saveVillage(village);
    }); } catch (error) { restoreState(village, checkpoint); throw error; }
    return player;
  }
  disconnect(villageId, playerId) {
    const village = this.villages.get(villageId), player = village?.players[playerId];
    if (!player) return;
    cancelPlayerTrades(village, playerId);
    cancelCarry(village, player); cancelTreatment(village, player);
    dismountPlayer(village, player); releaseTransportPassenger(village, player); resetJump(player);
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
    this.inputs.set(playerId, { x: length > 1 ? input.x / length : input.x, z: length > 1 ? input.z / length : input.z, yaw: input.yaw, sprint: input.sprint === true, jump: input.jump === true, received: performance.now() });
    if (canEquip(player, input.tool) || input.tool === 'food' && FOOD_IDS.some(id => canEquip(player, id))) player.tool = input.tool;
  }
  snapshot(village, viewerId) {
    return { id: village.id, name: village.name, clock: village.clock, day: village.day, phase: village.phase, phaseRemaining: Math.ceil(village.phaseRemaining),
      phaseDuration: village.phase === 'night' ? this.nightSeconds : this.daySeconds,
      phaseEndsAt: Math.round((village.clock + Math.max(0, village.phaseRemaining)) * 1000) / 1000,
      clockRunning: village.status === 'active' && Object.values(village.players).some(p => p.online),
      gate: village.gate, keep: village.keep, treasury: village.treasury, stock: village.stock, barracks: village.barracks, status: village.status, devTools: this.devTools,
      ...ownershipSnapshot(village, viewerId), ...economySnapshot(village, viewerId), ...careSnapshot(village, viewerId, this), ...transportSnapshot(village, viewerId, this.store), ...workersSnapshot(village, viewerId),
      ...requestsSnapshot(village), ...progressionSnapshot(this, village, viewerId), ...guardOrdersSnapshot(village, viewerId), ...tradingSnapshot(village, viewerId), ...crateSnapshot(this, village, viewerId), ...villageFinanceSnapshot(this, village, viewerId),
      ...skillsSnapshot(village, viewerId), ...civicSnapshot(village),
      environment: environmentSnapshot(village),
      players: Object.values(village.players).map(p => ({ id: p.id, name: p.name, role: p.role, x: p.x, z: p.z, yaw: p.yaw, hp: p.hp, maxHp: p.maxHp, online: p.online, downed: p.downed, respawnAvailable: p.respawnAvailable, tool: p.tool, anim: p.anim,
        lastShot: p.lastShot, y: p.y, verticalSpeed: p.verticalSpeed, grounded: p.grounded, jumpHeld: p.jumpHeld, rescueCartId: p.rescueCartId, rescueSlot: p.rescueSlot, emberWard: p.emberWard, emberWardUntil: p.emberWardUntil, staffElement: p.staffElement,
        ...(p.id === viewerId ? { environmentYieldRemainders: p.environmentYieldRemainders, skills: p.skills, mana: p.mana, manaMax: p.manaMax, emberWardStatus: emberWardStatus(village,p) } : {}),
        tiers: p.tiers, backpackTier: p.backpackTier, crateEquipment: p.crateEquipment ?? {}, mountedHorseId: p.mountedHorseId, carryingId: p.carryingId, carriedBy: p.carriedBy, bedPlotId: p.bedPlotId,
        ...(p.id === viewerId ? { testAdmin: this.store.isTestAdmin?.(p.id) ?? false, inventory: p.inventory, boundInventory: p.boundInventory ?? {}, boundKitTools: p.boundKitTools ?? {}, maxDurability: p.maxDurability ?? {}, shield: p.shield, maxShield: p.maxShield, wallet: p.wallet, bank: this.store.account(p.id)?.bank ?? 0, durability: p.durability, repairBonus: p.repairBonus, jobBonus: p.jobBonus, hunger: Math.floor(p.hunger ?? 100), carryWeight: inventoryWeight(p), carryCapacity: carryCapacity(p), wageAccrued: Math.floor(p.wageAccrued ?? 0), healRemaining: p.healing ? Math.max(0, Math.ceil(p.healing.until - village.clock)) : 0, lastStandWard: p.lastStandWardUntil > village.clock ? p.lastStandWard ?? 0 : 0, phoenixProtectionRemaining: Math.max(0, (p.phoenixProtectedUntil ?? 0) - village.clock) } : {}) })),
      siegeNight: village.siegeNight,
      zombies: village.zombies.filter(z => z.hp > 0).map(enemySnapshot),
      guards: village.guards.filter(g => g.hp > 0).map(({ id, x, z, yaw, hp, maxHp, anim, hungry, ownerId, plotId, unitType, troopLevel, tool, damage, lastShot }) => ({ id, x, z, yaw, hp, maxHp, anim, hungry, ownerId, plotId, unitType, troopLevel, tool, damage, lastShot })),
      resources: village.resources.map((state, index) => publicResourceSnapshot(state, RESOURCES[index])) };
  }
  notice(villageId, message) { this.notices.push({ villageId, message }); }
  action(villageId, playerId, action) {
    const village = this.villages.get(villageId);
    if (!village) throw new Error('Join a village first.');
    // A committed receipt is a read, even if the resident moved, mounted or
    // fell after the request. Only the current authenticated player can read it.
    if (FINANCE_ACTIONS.has(action?.kind) && typeof action.requestId === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(action.requestId) && village.players[playerId]?.online && this.store.account(playerId)) {
      const receipt = this.store.financeReceipt?.(villageId, playerId, action.requestId);
      if (receipt) return receipt.message;
    }
    const checkpoint = structuredClone(village), noticeCount = this.notices.length;
    try { return this.store.transaction(() => {
      const requestBefore = requestsBeforeAction(village);
      const result = this.performAction(villageId, playerId, action);
      requestsAfterAction(village, requestBefore, action);
      this.finishClearedNight(village);
      requestsTick(this, village);
      this.store.saveVillage(village);
      return result;
    }); }
    catch (error) { restoreState(village, checkpoint); this.notices.length = noticeCount; throw error; }
  }
  performAction(villageId, playerId, action) {
    const village = this.villages.get(villageId), player = village?.players[playerId];
    if (!player?.online) throw new Error('Join a village first.');
    if (village.status !== 'active') throw new Error('The keep has fallen. This run has ended.');
    const kind = action.kind;
    if (typeof kind !== 'string') throw new Error('Invalid action.');
    if (kind === 'admin_refill_gold') {
      // Only the authenticated player can refill their own fixed test balances.
      // The enclosing action transaction saves bank and wallet together.
      if (!this.store.isTestAdmin?.(player.id)) throw new Error('This account does not have testing controls.');
      if (!Number.isSafeInteger(player.wallet) || player.wallet < 0) throw new Error('Invalid wallet balance.');
      const { bank } = this.store.refillTestBank(player.id);
      player.wallet = Math.max(player.wallet, TEST_GOLD);
      return `Test gold ready: ${player.wallet.toLocaleString('en-US')} in your wallet and ${bank.toLocaleString('en-US')} in your bank.`;
    }
    if (player.downed && !['respawn', 'churchLeave', 'guide_visibility', 'trade_cancel', 'crate_open', 'crate_loadout', 'phoenix_revive'].includes(kind)) throw new Error('You are downed. A priest can revive you, or you can choose to respawn after dawn.');
    if (!IMMEDIATE_ACTIONS.has(kind) && village.clock - player.lastAction < .55) throw new Error('Wait for your next action.');
    if (player.bedPlotId && !['churchLeave', 'respawn', 'guide_visibility', 'trade_cancel', 'crate_open', 'crate_loadout', 'phoenix_revive'].includes(kind)) throw new Error('Leave your church bed before taking another action.');
    if (player.carryingId && ['attack', 'gather', 'repair', 'repairPlot', 'heal', 'mountHorse'].includes(kind)) throw new Error('Put your companion down before using tools or weapons.');
    if (player.mountedHorseId && !['dismountHorse', 'attachCart', 'cartDeposit', 'cartWithdraw', 'cartRescueUnload', 'cartRescueTreat', 'cartPlotLoad', 'cartPlotUnload', 'guide_visibility', 'trade_cancel', 'crate_open', 'crate_loadout'].includes(kind)) throw new Error('Dismount before working, shopping, or fighting.');
    if (!['heal', 'guide_visibility'].includes(kind)) player.healing = null;
    for (const handler of [skillsAction, magicAttack, civicAction, villageFinanceAction, crateAction, tradingAction, requestsAction, progressionAction, guardOrdersAction, ownershipAction, economyAction, careAction, transportAction, workersAction]) {
      const result = handler(this, village, player, action);
      if (result !== null && result !== undefined) {
        if (kind === 'plot_build') this.relocateBlocked(village);
        if (kind === 'role_change') { ensureSkills(player); ensureRoleStats(player, { clock: village.clock }); if (!canEquip(player, player.tool)) player.tool = ''; }
        player.lastAction = village.clock;
        recordProgressionAction(this, village, player, action);
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
      const musket = tool === 'musket', ranged = tool === 'bow' || musket;
      if (ranged) {
        if (!(player.durability[tool] > 0)) throw new Error(`Buy a ${tool} at a tinker shop first.`);
        if (!(player.inventory[musket ? MUSKET.ammo : 'arrows'] > 0)) throw new Error(musket ? 'You need musket shot to fire your musket.' : 'You need arrows to fire your bow.');
        if (musket && village.clock < (player.musketReadyAt ?? 0)) throw new Error('Your musket is still reloading.');
      } else use('sword');
      breakCrateProtection(player);
      const inReach = village.zombies.filter(z => z.hp > 0 && (ranged ? distance(player, z) <= (musket ? MUSKET.range : 24) : inMeleeArc(player, z, MELEE.playerRange)) && this.clearAttack(village, player, z, ranged)).sort((a, b) => distance(player, a) - distance(player, b));
      const targets = ranged ? inReach.slice(0, 1) : inReach;
      player.anim = 'attack'; player.animationUntil = village.clock + .45;
      if (ranged) player.inventory[musket ? MUSKET.ammo : 'arrows']--;
      player.durability[ranged ? tool : 'sword']--;
      if (musket) {
        player.musketReadyAt = village.clock + MUSKET.cooldown;
        player.lastShot = { id: randomUUID(), at: village.clock, kind: 'musket', from: { x: player.x, z: player.z }, to: { x: targets[0]?.x ?? player.x + Math.sin(player.yaw) * MUSKET.range, z: targets[0]?.z ?? player.z + Math.cos(player.yaw) * MUSKET.range } };
      }
      const damage = musket ? MUSKET.damage : ranged ? 22 : ({ wood: 10, stone: 15, iron: 20 }[player.tiers?.sword] ?? 10);
      for (const target of targets) this.hitZombie(village, target, damage * (player.role === 'guard' ? 1.2 : 1), player);
      if (targets.length) message = musket ? 'Musket shot landed.' : ranged ? 'Arrow landed.' : 'Strike landed.';
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
      structure.hp = Math.min(structure.maxHp, structure.hp + (TOOL_TIERS[player.tiers?.hammer ?? 'wood']?.repair ?? 35) * roleSkills(player).repairMultiplier);
      player.durability.hammer -= 1;
      if (player.repairBonus < CONFIG.repairCap) { player.repairBonus++; village.treasury--; }
      player.anim = 'repair'; player.animationUntil = village.clock + .5;
      message = `Repaired ${id}. Repair earnings: ${player.repairBonus}/10, paid at dawn.`;
    } else if (kind === 'heal') {
      if (player.role !== 'priest') throw new Error('Only priests can heal and revive other dwarfs.');
      const resolved = resolveHealTarget(village, action.targetId), target = resolved?.target;
      if (!target || target.id === player.id || distance(player, target) > 3.5) throw new Error('Move near another injured dwarf or living town guard.');
      if (target.hp >= target.maxHp) throw new Error('That dwarf is already healthy.');
      if (player.healing) throw new Error('Your blessing is already in progress. Stay nearby.');
      player.healing = { targetId: target.id, targetKind: resolved.isGuard ? 'guard' : 'player', revive: Boolean(target.downed), until: village.clock + (target.downed ? 5 * roleSkills(player).reviveSecondsMultiplier : 2) };
      player.anim = 'heal'; player.animationUntil = player.healing.until;
      message = target.downed ? `Hold still for ${5 * roleSkills(player).reviveSecondsMultiplier} seconds to revive your companion.` : 'Hold still to heal your companion.';
    } else if (kind === 'respawn') {
      if (!player.downed || !player.respawnAvailable) throw new Error('Respawning unlocks at the next dawn.');
      forfeitCrates(this, village, player);
      crateRespawnEffects(player);
      cancelCarry(village, player); cancelTreatment(village, player); releaseTransportPassenger(village, player);
      player.inventory = emptyInventory(); player.wallet = Math.floor(player.wallet * .75); player.durability = durability(); player.backpackTier = 0;
      player.boundInventory = {}; player.maxDurability = {};
      player.tiers = { sword: 'wood', axe: 'wood', pickaxe: 'wood', scythe: 'wood', hammer: 'wood' };
      Object.assign(player, { downed: false, respawnAvailable: false, hp: 100, hunger: 100, x: 0, z: 4, yaw: Math.PI, tool: '', anim: 'idle', healing: null });
      ensureRoleStats(player, { fresh: true, clock: village.clock });
      resetJump(player);
      message = 'You returned empty-handed. Your carried inventory, equipment, backpack and 25% of wallet gold were lost. Your bank savings are safe.';
    } else if (kind === 'deposit' || kind === 'withdraw') {
      message = bankTransfer(this, village, player, action);
    } else if (kind === 'donate') {
      if (action.targetId === 'barracks') {
        if (!canUseBuilding(player, building('barracks'))) throw new Error('Bring wheat to The Watch to feed the guards.');
        const amount = transferableCount(player, 'wheat');
        if (!amount) throw new Error('Gather some wheat for the barracks first.');
        village.barracks.wheat += amount;
        message = `${amount} wheat delivered to the barracks.`;
        player.inventory.wheat -= amount;
      } else {
        if (!canUseBuilding(player, building('market'))) throw new Error('Bring your materials to the Resource Exchange.');
        const total = ['timber', 'stone', 'wheat'].reduce((sum, id) => sum + transferableCount(player, id), 0);
        if (!total) throw new Error('You have no materials to donate.');
        for (const id of ['timber', 'stone', 'wheat']) { const amount = transferableCount(player, id); village.stock[id] += amount; player.inventory[id] -= amount; }
        message = `${total} materials donated to village supplies.`;
      }
    } else if (kind === 'buyTool') {
      if (!canUseBuilding(player, building('tools'))) throw new Error('Visit Oak & Iron to buy wooden tools.');
      if (!['axe', 'pickaxe', 'scythe', 'hammer'].includes(action.tool)) throw new Error('Choose a wooden gathering tool or hammer.');
      if (player.durability[action.tool] > 0) throw new Error('Your current tool still has durability remaining.');
      if (inventoryWeight(player) + TOOL_WEIGHTS[action.tool] > carryCapacity(player)) throw new Error('Make room in your pack before buying another tool.');
      chargePurchase(this, village, player, STARTER_GOLD, { credit: true }); village.treasury += STARTER_GOLD;
      player.durability[action.tool] = acquiredToolDurability(player, action.tool, 'wood');
      player.maxDurability ??= {}; player.maxDurability[action.tool] = player.durability[action.tool];
      if (player.boundKitTools) delete player.boundKitTools[action.tool];
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
    recordProgressionAction(this, village, player, action);
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
      const isPlayer = village.players[entity.id] === entity, feet = isPlayer && Number.isFinite(entity.y) ? entity.y : 0;
      if (entity.bedPlotId || entity.carriedBy || canStand(entity.x, entity.z, .5, solids, feet)) continue;
      let found = false;
      for (let radius = 1; radius <= 20 && !found; radius++) for (let i = 0; i < 24; i++) {
        const x = entity.x + Math.sin(i * Math.PI / 12) * radius, z = entity.z + Math.cos(i * Math.PI / 12) * radius;
        if (canStand(x, z, .6, solids)) { entity.x = x; entity.z = z; if (isPlayer) resetJump(entity); found = true; break; }
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
    const dealt = damage * (1 - clamp(zombie.armor ?? 0, 0, .8));
    const actual = Math.min(zombie.hp, dealt);
    if (player?.online && player.role === 'guard') {
      zombie.contributors ??= {};
      zombie.contributors[player.id] = (zombie.contributors[player.id] ?? 0) + actual;
    }
    zombie.hp = Math.max(0, zombie.hp - dealt);
    if (zombie.hp <= 0) {
      cancelZombieWindup(zombie);
      for (const [id, contribution] of Object.entries(zombie.contributors ?? {})) {
        const contributor = village.players[id];
        if (contributor?.online && contributor.role === 'guard' && (contribution >= zombie.maxHp * .15 || id === player?.id)) this.awardJob(village, contributor, ENEMY_TYPES[enemyKind(zombie)].reward);
      }
      splitEnemy(village, zombie);
    }
  }
  cancelZombieWindup(zombie) { cancelZombieWindup(zombie); }
  attackZombieStructure(village, zombie, structure, targetId, targetKind) { return attackZombieStructure(village, zombie, structure, targetId, targetKind); }
  hurtPlayer(village, player, damage) {
    if (crateProtectionActive(village, player)) return;
    const previousHp = player.hp;
    player.hp = Math.max(0, player.hp - crateEnemyDamage(village, player, absorbDamage(village, player, damage)));
    crateAfterEnemyHit(village, player, previousHp);
    if (player.hp <= 0) { cancelCarry(village, player); cancelTreatment(village, player); dismountPlayer(village, player); player.downed = true; player.respawnAvailable = false; player.anim = 'downed'; player.healing = null; resetJump(player); this.inputs.delete(player.id); }
  }
  startNight(village) {
    village.phase = 'night'; village.phaseRemaining = this.nightSeconds; village.spawned = 0; village.nextSpawn = village.clock + 2;
    progressionNight(village);
    const active = Object.values(village.players).filter(p => p.online).length;
    const band = Math.floor((village.day - 1) / 5);
    village.waveCount = Math.min(80, 5 + active * 3 + band * 5);
    village.siegeNight = village.day % 5 === 0;
    village.nightParticipants = Object.values(village.players).filter(p => p.online).map(p => p.id);
    careNight(this, village);
    this.notice(village.id, village.siegeNight ? `Siege night ${village.day}! A Gravebreaker is rising. Step outside its red warning circle before the slam.` : `Night ${village.day}. Defend the gate together and dodge the red attack circles.`);
  }
  finishClearedNight(village) {
    if (village.phaseRemaining <= 0 || !nightIsCleared(village)) return false;
    this.dawn(village, { earlyClear: true });
    return true;
  }
  dawn(village, { earlyClear = false } = {}) {
    const checkpoint = structuredClone(village), noticeCount = this.notices.length;
    try { return this.store.transaction(() => this.payDawn(village, { earlyClear })); }
    catch (error) { restoreState(village, checkpoint); this.notices.length = noticeCount; throw error; }
  }
  payDawn(village, { earlyClear = false } = {}) {
    const survived = village.day;
    progressionDawn(this, village, survived, { earlyClear });
    for (const player of Object.values(village.players)) refreshCrateMilestones(this, player.id);
    village.phase = 'day'; village.phaseRemaining = this.daySeconds; village.day++; village.warningSent = false; village.siegeNight = false;
    village.spawned = 0; village.waveCount = 0; village.nextSpawn = 0;
    village.treasury += Math.min(5000, 1000 * survived);
    economyDawn(this, village);
    for (const player of Object.values(village.players)) {
      if (player.downed) player.respawnAvailable = true;
      const base = Math.floor((player.wageAccrued ?? 0) + 1e-7);
      const funded = Math.min(base, village.treasury); village.treasury -= funded;
      this.awardIncome(village, player, funded + player.jobBonus + player.repairBonus);
      player.jobBonus = 0; player.repairBonus = 0; player.participated = 0; player.revivedThisNight = [];
      player.wageAccrued = 0; player.cycleServiceIncome = 0;
    }
    villageFinanceDawn(this, village, survived);
    this.notice(village.id, earlyClear ? `The last zombie has fallen. Night ${survived} cleared! Dawn breaks early.` : `Dawn breaks. Night ${survived} survived.${village.zombies.some(z => z.hp > 0) ? ' Remaining zombies must still be defeated.' : ''}`);
    requestsTick(this, village);
    this.store.saveVillage(village);
  }
  tick(dt) {
    for (const village of this.villages.values()) {
      if (village.status !== 'active' || !Object.values(village.players).some(p => p.online)) continue;
      village.clock += dt; village.phaseRemaining -= dt; this.activeClock = village.clock; this.activeSolids = plotSolids(village.plots);
      for (const notice of tickEnvironment(village, dt, { active: true })) this.notice(village.id, notice.text);
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
        player.hunger = Math.max(0, (player.hunger ?? 100) - dt * .05 * roleSkills(player).hungerMultiplier);
        const input = this.inputs.get(player.id);
        const fresh = input && performance.now() - input.received < 700;
        // Gathering and blessings can turn toward a target without walking.
        if (fresh) player.yaw = input.yaw;
        if (fresh && !player.bedPlotId && !player.carriedBy && Math.hypot(input.x, input.z) > .02) {
          player.healing = null;
          let speed = player.mountedHorseId ? mountedTravelSpeed(village, player) : input.sprint && player.hunger > 0 ? CONFIG.sprintSpeed : CONFIG.speed;
          if (player.carryingId) speed = CONFIG.speed * .55;
          if (inventoryWeight(player) > carryCapacity(player)) speed *= .65;
          movePlayer(player, input.x * speed * dt, input.z * speed * dt, dt, fresh && input.jump, solids, player.mountedHorseId ? .8 : CONFIG.playerRadius);
          if (village.clock > player.animationUntil) player.anim = input.sprint ? 'run' : 'walk';
        } else {
          movePlayer(player, 0, 0, dt, fresh && input.jump, solids);
          if (player.bedPlotId) player.anim = 'downed';
          else if (village.clock > player.animationUntil) player.anim = 'idle';
        }
        if (player.healing) {
          const resolved = resolveHealTarget(village, player.healing.targetId), target = resolved?.target;
          const targetKind = resolved?.isGuard ? 'guard' : 'player';
          if (!target || targetKind !== (player.healing.targetKind ?? 'player') || distance(player, target) > 3.5 || Boolean(target.downed) !== Boolean(player.healing.revive)) { player.healing = null; continue; }
          if (village.clock >= player.healing.until) {
            const wasDowned = target.downed;
            const restored = Math.min((wasDowned ? 45 : 30) * roleSkills(player).healMultiplier, target.maxHp - target.hp);
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
      magicTick(this, village, dt);
      civicTick(this, village, dt);
      villageFinanceTick(this, village);
      careTick(this, village, dt);
      transportTick(this, village, dt);
      for (let i = 0; i < village.resources.length; i++) {
        const node = village.resources[i];
        if (!node.available && village.clock >= node.regrowAt && !regrowCaveResource(village, RESOURCES[i], node)) Object.assign(node, makeResource(RESOURCES[i]));
      }
      workersTick(this, village, dt);
      if (village.phase === 'night' && village.spawned < village.waveCount && village.clock >= village.nextSpawn) {
        spawnWaveEnemy(village);
      }
      this.tickNpcs(village, dt);
      tradingTick(this, village);
      progressionTick(this, village, dt);
      requestsTick(this, village);
      if (village.status === 'fallen') continue;
      if (!this.finishClearedNight(village) && village.phaseRemaining <= 0) { if (village.phase === 'day') this.startNight(village); else this.dawn(village); }
      if (village.phase === 'day' && !village.warningSent && (village.day % 5 === 0 || village.day % 5 === 1 && village.day > 1)) {
        village.warningSent = true;
        this.notice(village.id, village.day % 5 === 0 ? 'Siege tonight: a Gravebreaker is stirring beneath the graveyard. Stock the defenses and repair the gate.' : 'A stronger horde is stirring in the graveyard. Prepare before tonight.');
      }
      village.zombies = village.zombies.filter(z => z.hp > 0);
    }
  }
  stepNpc(entity, target, speed, dt, neighbors = []) {
    return stepNpcNavigation(entity, target, speed * magicMovementMultiplier(entity, this.activeClock ?? 0), dt, neighbors, this.activeSolids ?? []);
  }
  tickNpcs(village, dt) {
    this.activeClock = village.clock; this.activeSolids = plotSolids(village.plots);
    const alivePlayers = Object.values(village.players).filter(p => p.online && !p.downed);
    const guards = village.guards.filter(g => g.hp > 0);
    const zombies = village.zombies.filter(z => z.hp > 0);
    for (const guard of guards) {
      const guardPath = guardPathFor(village, guard);
      const directive = guardDirective(village, guard);
      guard.cooldown = Math.max(0, guard.cooldown - dt);
      if (village.clock < (guard.attackUntil ?? -1)) { guard.anim = 'attack'; continue; }
      const target = zombies.filter(z => z.hp > 0 && guardOrderCanEngage(guard, z, directive) && troopCanEngage(this, village, guard, z)).sort((a, b) => distance(guard, a) - distance(guard, b))[0];
      if (target) {
        if (tickRangedTroop(this, village, guard, target, dt, guards)) continue;
        if (distance(guard, target) > 2.1 || !this.clearAttack(village, guard, target)) this.stepNpc(guard, target, 3.4, dt, guards);
        else {
          guard.anim = 'idle'; guard.yaw = Math.atan2(target.x - guard.x, target.z - guard.z);
          if (!guard.cooldown && this.clearAttack(village, guard, target)) {
            guard.anim = 'attack'; guard.attackUntil = village.clock + .45;
            const victims = zombies.filter(z => z.hp > 0 && inMeleeArc(guard, z, MELEE.guardRange) && this.clearAttack(village, guard, z));
            for (const victim of victims) this.hitZombie(village, victim, (guard.damage ?? 14) * (guard.hungry ? .75 : 1), village.players[guard.ownerId]);
            guard.cooldown = 1.05;
          }
        }
      } else if (directive) {
        this.stepNpc(guard, directive.destination, 3, dt, guards);
      } else {
        const point = guardPath[Math.min(guard.roadIndex, guardPath.length - 1)];
        if (distance(guard, point) < 1.4 && guard.roadIndex < guardPath.length - 1) guard.roadIndex++;
        const destination = guard.roadIndex === guardPath.length - 1 ? guard.post ?? { x: guard.id.endsWith('0') ? -2 : 2, z: 35 } : point;
        this.stepNpc(guard, destination, 3, dt, guards);
      }
    }
    for (const zombie of zombies) {
      if (zombie.hp <= 0) continue;
      if (village.clock < (zombie.emergeUntil ?? 0)) { zombie.anim = zombie.birth === 'split' ? 'burst' : 'emerge'; continue; }
      zombie.cooldown = Math.max(0, zombie.cooldown - dt);
      const defenders = [...alivePlayers.filter(p => !p.downed), ...guards.filter(g => g.hp > 0)];
      if (tickZombieAttack(this, village, zombie, defenders)) {
        if (village.keep.hp <= 0) { village.status = 'fallen'; requestsTick(this, village); this.notice(village.id, 'The Hearthkeep has fallen. Your personal bank savings are safe.'); this.store.saveVillage(village); return; }
        continue;
      }
      // An intact gate blocks attacks/aggro across the doorway until a defender steps outside.
      const target = defenders.filter(d => distance(zombie, d) < 7 && !(village.gate.hp > 0 && zombie.z > 18 && d.z < 18)).sort((a, b) => distance(zombie, a) - distance(zombie, b))[0];
      if (target) {
        if (distance(zombie, target) > 1.9 || !this.clearAttack(village, zombie, target)) this.stepNpc(zombie, target, zombie.speed, dt, zombies);
        else {
          zombie.anim = 'idle'; zombie.yaw = Math.atan2(target.x - zombie.x, target.z - zombie.z);
          beginZombieAttack(village, zombie, target, target.id, 'ground');
        }
        continue;
      }
      if (tickDefenseAttack(this, village, zombie, dt)) continue;
      if (village.gate.hp > 0 && zombie.z >= 18 && zombie.z <= 23 && zombie.roadIndex >= 3) {
        zombie.yaw = Math.PI;
        this.attackZombieStructure(village, zombie, village.gate, 'gate', 'gate');
      } else if (zombie.z <= -33) {
        zombie.yaw = Math.PI;
        this.attackZombieStructure(village, zombie, village.keep, 'keep', 'keep');
        if (village.keep.hp <= 0) { village.status = 'fallen'; requestsTick(this, village); this.notice(village.id, 'The Hearthkeep has fallen. Your personal bank savings are safe.'); this.store.saveVillage(village); return; }
      } else {
        cancelZombieWindup(zombie);
        const point = ROAD[Math.min(zombie.roadIndex, ROAD.length - 1)];
        if (distance(zombie, point) < 2 && zombie.roadIndex < ROAD.length - 1) zombie.roadIndex++;
        this.stepNpc(zombie, ROAD[Math.min(zombie.roadIndex, ROAD.length - 1)], zombie.speed, dt, zombies);
      }
    }
  }
  saveAll() { for (const village of this.villages.values()) this.store.saveVillage(village); }
}
