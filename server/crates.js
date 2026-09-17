import { randomInt, randomUUID } from 'node:crypto';
import { CRATE_CATALOG_VERSION, CRATE_EQUIPMENT, CRATE_POOLS, CRATE_PRICES, CRATE_RULES, LOADOUT_SLOTS, GATHERING_TOOLS, emptyLoadout, normalizeLoadout, crateMilestoneTier, crateRewardTier } from '../shared/crates.js';
import { TOOL_TIERS } from '../shared/content.js';
import { cancelCarry, cancelTreatment } from './care-defense.js';
import { activateEmberWard, emberWardStatus } from './crate-effects.js';

const physicalEquipment = loadout => Object.fromEntries(['head', 'body', 'feet', 'utility'].map(slot => [slot, loadout[slot] || '']));
const safeKey = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{16,96}$/.test(value);

function milestones(store, playerId) {
  store.crateAccount(playerId);
  const nights = store.progression(playerId).nights;
  for (let milestone = store.lastCrateMilestone(playerId) + 10; milestone <= nights; milestone += 10) {
    const tier = crateMilestoneTier(milestone);
    if (tier) store.grantCrate(playerId, tier, milestone);
  }
  if (nights >= CRATE_RULES.helmetNights) store.unlockCrateItem(playerId, 'sunforged_viking_helm', 'lifetime:100');
  return nights;
}

export function refreshCrateMilestones(sim, playerId) {
  if (!sim.store.crateAccount) return;
  return sim.store.transaction(() => milestones(sim.store, playerId));
}

function selectedLoadout(store, playerId, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => ![...LOADOUT_SLOTS, 'tool', 'reserveEmber'].includes(key))) throw new Error('Choose valid equipment slots for your next run.');
  const unlocked = new Set(store.crateUnlocks(playerId));
  for (const slot of LOADOUT_SLOTS) {
    const item = value[slot];
    if (item === undefined || item === null || item === '') continue;
    if (typeof item !== 'string' || !Object.hasOwn(CRATE_EQUIPMENT, item) || CRATE_EQUIPMENT[item].slot !== slot || !unlocked.has(item)) throw new Error(`Unlock an item for the ${slot} slot before selecting it.`);
  }
  if (value.tool !== undefined && !GATHERING_TOOLS.includes(value.tool)) throw new Error('Choose an axe, pickaxe or scythe for your starting kit.');
  if (value.reserveEmber !== undefined && typeof value.reserveEmber !== 'boolean') throw new Error('Choose whether to reserve a Phoenix Ember.');
  return normalizeLoadout(value);
}

function openCrate(store, playerId, action, chooseIndex = randomInt, chooseRarity = randomInt) {
  if (!safeKey(action.requestId)) throw new Error('Provide a unique opening request ID.');
  const previous = store.crateOpening(playerId, action.requestId);
  if (previous) return previous;
  let grant = null, tier, funding, paid;
  if (action.grantId !== undefined) {
    if (!safeKey(action.grantId)) throw new Error('Choose one of your earned crates.');
    grant = store.crateGrant(playerId, action.grantId);
    if (!grant) throw new Error('That earned crate does not belong to this account.');
    if (grant.resultId) return store.crateOpeningById(playerId, grant.resultId);
    tier = grant.tier; funding = 'earned'; paid = 0;
  } else {
    tier = action.tier; funding = action.currency;
    if (typeof tier !== 'string' || !Object.hasOwn(CRATE_PRICES, tier)) throw new Error('Choose a crate tier.');
    if (!['bank', 'credits'].includes(funding)) throw new Error('Crates use personal bank savings or crate credits.');
    paid = CRATE_PRICES[tier][funding];
    if (funding === 'bank') {
      const bank = store.account(playerId)?.bank;
      if (!Number.isSafeInteger(bank) || bank < paid) throw new Error('Not enough personal bank savings for this crate.');
      store.bank(playerId, -paid);
    } else store.crateCredit(playerId, -paid);
  }
  const rewardTier = crateRewardTier(tier, chooseRarity(10000));
  const pool = CRATE_POOLS[rewardTier], index = chooseIndex(pool.length);
  if (!Number.isInteger(index) || index < 0 || index >= pool.length) throw new Error('Unable to select this crate result.');
  const itemId = pool[index], openingId = randomUUID(), chargeGranted = itemId === 'phoenix_ember';
  const duplicate = !chargeGranted && !store.unlockCrateItem(playerId, itemId, openingId);
  let refund = null;
  if (chargeGranted) store.grantEmber(playerId, openingId);
  else if (duplicate) {
    const currency = funding === 'bank' ? 'bank' : 'credits';
    const amount = Math.floor((funding === 'earned' ? CRATE_PRICES[tier].credits : paid) * CRATE_RULES.duplicateReturn);
    if (currency === 'bank') store.bank(playerId, amount); else store.crateCredit(playerId, amount);
    refund = { currency, amount };
  }
  const result = { id: openingId, requestId: action.requestId, grantId: grant?.id ?? null, tier, rewardTier, funding, paid, itemId, duplicate, refund, chargeGranted, createdAt: Date.now(), catalogVersion: CRATE_CATALOG_VERSION };
  store.saveCrateOpening(playerId, result);
  if (grant) store.openCrateGrant(playerId, grant.id, openingId);
  return result;
}

function snapshot(store, playerId, villageId) {
  const nights = store.progression(playerId).nights;
  const account = store.readCrateAccount(playerId) ?? { credits: 0, loadout: emptyLoadout() }, runId = villageId ?? store.activeCrateVillage(playerId), run = runId ? store.crateRun(playerId, runId) : null;
  return { nights, bank: store.account(playerId).bank, credits: account.credits, unlocks: store.crateUnlocks(playerId), loadout: normalizeLoadout(account.loadout), earnedCrates: store.earnedCrates(playerId), history: store.crateHistory(playerId), charges: store.crateCharges(playerId),
    run: run ? { villageId: runId, forfeited: run.forfeited, equipment: run.forfeited ? physicalEquipment(emptyLoadout()) : physicalEquipment(run.loadout), phoenixStatus: run.phoenixStatus, phoenixAvailable: !run.forfeited && run.phoenixStatus === 'reserved' && store.emberReserved(playerId, runId, run.chargeId) } : null };
}

export function accountCrateSnapshot(store, playerId, villageId = null) {
  return store.transaction(() => { milestones(store, playerId); store.releaseEndedEmbers(playerId); return snapshot(store, playerId, villageId); });
}

export function crateAccountAction(store, playerId, action, { chooseIndex = randomInt, chooseRarity = randomInt } = {}) {
  return store.transaction(() => {
    milestones(store, playerId);
    let result;
    if (action?.kind === 'crate_open') result = openCrate(store, playerId, action, chooseIndex, chooseRarity);
    else if (action?.kind === 'crate_loadout') store.saveCrateLoadout(playerId, selectedLoadout(store, playerId, action.loadout));
    else throw new Error('Choose a crate opening or a future loadout.');
    store.releaseEndedEmbers(playerId);
    return { crates: snapshot(store, playerId, null), ...(result ? { result } : {}) };
  });
}

export function joinCrates(sim, village, player, { fresh = false } = {}) {
  if (!sim.store.crateAccount) return;
  const store = sim.store;
  milestones(store, player.id); store.releaseEndedEmbers(player.id);
  let run = store.crateRun(player.id, village.id);
  const deploying = !run && fresh;
  if (!run) {
    const loadout = deploying ? selectedLoadout(store, player.id, store.crateAccount(player.id).loadout) : emptyLoadout();
    const chargeId = deploying && loadout.reserveEmber ? store.reserveEmber(player.id, village.id) : null;
    run = { loadout, kitGranted: deploying, forfeited: false, chargeId, phoenixStatus: chargeId ? 'reserved' : 'none' };
    store.saveCrateRun(player.id, village.id, run);
  }
  player.crateEquipment = physicalEquipment(run.forfeited ? emptyLoadout() : run.loadout);
  player.boundInventory ??= {};
  player.boundKitTools ??= {};
  player.maxDurability ??= {};
  if (run.forfeited) {
    // A durable forfeiture outranks an older restored village snapshot. Remove
    // only tagged kit contents: later ordinary purchases carry no such tag.
    for (const [item, bound] of Object.entries(player.boundInventory)) {
      if (Number.isSafeInteger(bound) && bound > 0) player.inventory[item] = Math.max(0, (player.inventory[item] ?? 0) - bound);
    }
    for (const tool of Object.keys(player.boundKitTools)) {
      if (!GATHERING_TOOLS.includes(tool)) continue;
      player.durability[tool] = 0;
      if (player.tool === tool) player.tool = '';
    }
    player.boundInventory = {}; player.boundKitTools = {};
  }
  if (!deploying) return;
  const kit = CRATE_EQUIPMENT[run.loadout.kit];
  if (kit?.food) {
    player.inventory[kit.food] = (player.inventory[kit.food] ?? 0) + kit.amount;
    player.boundInventory[kit.food] = (player.boundInventory[kit.food] ?? 0) + kit.amount;
    if (kit.toolTier) {
      const tool = run.loadout.tool, durability = TOOL_TIERS[kit.toolTier].durability;
      player.tiers[tool] = kit.toolTier; player.durability[tool] = durability; player.maxDurability[tool] = durability;
      player.boundKitTools[tool] = kit.toolTier;
      if (!player.tool) player.tool = tool;
    }
  }
}

export function forfeitCrates(sim, village, player) {
  player.crateEquipment = physicalEquipment(emptyLoadout()); player.boundInventory = {}; player.boundKitTools = {}; player.phoenixProtectedUntil = 0; player.emberWard = 0; player.emberWardUntil = 0;
  if (!sim.store.crateAccount) return;
  const run = sim.store.crateRun(player.id, village.id);
  if (!run) return;
  run.forfeited = true;
  if (run.phoenixStatus === 'reserved') { sim.store.releaseEmber(player.id, village.id); run.phoenixStatus = 'forfeited'; }
  sim.store.saveCrateRun(player.id, village.id, run);
}

export function crateAction(sim, village, player, action) {
  if (!['crate_open', 'crate_loadout', 'phoenix_revive', 'ember_ward'].includes(action.kind)) return null;
  if (action.kind === 'ember_ward') {
    const count = activateEmberWard(village, player);
    return `Ember Ward protects ${count} ${count === 1 ? 'resident' : 'residents'} for ten seconds.`;
  }
  if (action.kind !== 'phoenix_revive') {
    const response = crateAccountAction(sim.store, player.id, action);
    return response.result ? `Crate opened: ${response.result.itemId.replaceAll('_', ' ')}${response.result.duplicate ? ' · duplicate converted automatically' : ''}.` : 'Loadout saved for your next new village. Current equipment is unchanged.';
  }
  if (!player.online || !player.downed || player.hp > 0 || village.status !== 'active' || village.keep.hp <= 0) throw new Error('Use a Phoenix Ember only while downed in an active village.');
  const run = sim.store.crateRun(player.id, village.id);
  if (!run || run.forfeited || run.phoenixStatus !== 'reserved' || !run.chargeId) throw new Error('No Phoenix Ember is available for this run. Reserve one in your next-run loadout.');
  sim.store.consumeEmber(player.id, village.id, run.chargeId);
  run.phoenixStatus = 'used'; sim.store.saveCrateRun(player.id, village.id, run);
  const position = { x: player.x, z: player.z };
  cancelCarry(village, player); cancelTreatment(village, player);
  Object.assign(player, position, { downed: false, respawnAvailable: false, hp: Math.ceil(player.maxHp * CRATE_RULES.phoenixHealth), anim: 'idle', healing: null, animationUntil: village.clock, phoenixProtectedUntil: village.clock + CRATE_RULES.phoenixProtectionSeconds });
  sim.inputs?.delete(player.id);
  return 'Phoenix Ember consumed. You revived with your belongings intact and three seconds of protection.';
}

export function crateSnapshot(sim, village, viewerId) {
  if (!sim.store.crateAccount || !village.players[viewerId]) return {};
  // This path runs for every viewer at 10 Hz. Preparation/backfill belongs to
  // join, dawn and account actions; snapshots must never take a write lock.
  return { crates: snapshot(sim.store, viewerId, village.id), emberWardStatus: emberWardStatus(village, village.players[viewerId]) };
}
