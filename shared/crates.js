// Crate balance is shared for inspection; ownership and rolls are server-authoritative.
export const CRATE_CATALOG_VERSION = 2;
export const LOADOUT_SLOTS = Object.freeze(['head', 'body', 'feet', 'utility', 'kit']);
export const GATHERING_TOOLS = Object.freeze(['axe', 'pickaxe', 'scythe']);
export const CRATE_PRICES = Object.freeze({
  basic: Object.freeze({ bank: 1000, credits: 100 }),
  rare: Object.freeze({ bank: 10000, credits: 1000 }),
  epic: Object.freeze({ bank: 50000, credits: 5000 }),
  legendary: Object.freeze({ bank: 100000, credits: 10000 })
});
export const CRATE_POOLS = Object.freeze({
  basic: Object.freeze(['padded_cap', 'stout_leather_boots', 'foragers_pouch', 'hearth_ration_kit', 'harvest_satchel']),
  rare: Object.freeze(['iron_coif', 'riveted_vest', 'miners_buckle', 'tradesmans_kit', 'mining_pack', 'lumber_pack', 'quartermasters_belt']),
  epic: Object.freeze(['tempered_cuirass', 'runed_helm', 'deep_delvers_belt', 'prospectors_kit', 'tinkers_pouch', 'steadfast_crew_kit']),
  legendary: Object.freeze(['runeforged_cuirass', 'dawnsteel_helm', 'guardians_boots', 'master_expedition_kit', 'phoenix_ember', 'caravan_harness', 'arcanists_seal']),
  godly: Object.freeze(['heart_of_emberwatch'])
});
export const CRATE_UPGRADES = Object.freeze({
  basic: Object.freeze({ tier: 'rare', percent: 5 }),
  rare: Object.freeze({ tier: 'epic', percent: 10 }),
  epic: Object.freeze({ tier: 'legendary', percent: 20 }),
  legendary: Object.freeze({ tier: 'godly', percent: 1 })
});
// One rarity roll, then one uniform item roll. A promoted reward never rolls
// again: in particular an Epic crate cannot reach the Godly pool.
export function crateRewardTier(tier, roll) {
  if (!Object.hasOwn(CRATE_PRICES, tier) || !Number.isInteger(roll) || roll < 0 || roll >= 10000) throw new Error('Unable to select this crate rarity.');
  const upgrade = CRATE_UPGRADES[tier];
  return roll < upgrade.percent * 100 ? upgrade.tier : tier;
}
export function crateRewardOdds(tier) {
  if (!Object.hasOwn(CRATE_PRICES, tier)) return [];
  const upgrade = CRATE_UPGRADES[tier];
  return [[tier, 100 - upgrade.percent], [upgrade.tier, upgrade.percent]].flatMap(([rarity, percent]) => CRATE_POOLS[rarity].map(itemId => ({ itemId, tier: rarity, percent: percent / CRATE_POOLS[rarity].length })));
}
const equipment = {
  padded_cap: {slot:'head', reduction:.02},
  stout_leather_boots: {slot:'feet', reduction:.01},
  foragers_pouch: {slot:'utility', capacity:15},
  hearth_ration_kit: {slot:'kit', food:'food', amount:2},
  iron_coif: {slot:'head', reduction:.04},
  riveted_vest: {slot:'body', reduction:.06},
  miners_buckle: {slot:'utility', gatheringDurability:1.1},
  tradesmans_kit: {slot:'kit', food:'food', amount:2, toolTier:'wood'},
  mining_pack: {slot:'utility', weights:Object.freeze({stone:.8,iron:.8,coal:.8})},
  lumber_pack: {slot:'utility', weights:Object.freeze({timber:.8})},
  tempered_cuirass: {slot:'body', reduction:.09},
  runed_helm: {slot:'head', reduction:.06},
  deep_delvers_belt: {slot:'utility', capacity:40},
  prospectors_kit: {slot:'kit', food:'good_food', amount:2, toolTier:'stone'},
  runeforged_cuirass: {slot:'body', reduction:.12},
  dawnsteel_helm: {slot:'head', reduction:.08},
  guardians_boots: {slot:'feet', reduction:.05},
  master_expedition_kit: {slot:'kit', food:'best_food', amount:2, toolTier:'iron'},
  phoenix_ember: {slot:'consumable'},
  harvest_satchel: {slot:'utility', weights:Object.freeze({wheat:.8})},
  quartermasters_belt: {slot:'utility', capacity:20, workerCarryBonus:10},
  tinkers_pouch: {slot:'utility', weights:Object.freeze({iron:.75,coal:.75,sulfur:.75,gunpowder:.75})},
  steadfast_crew_kit: {slot:'kit', food:'good_food', amount:3, toolTier:'stone'},
  caravan_harness: {slot:'utility', capacity:80},
  arcanists_seal: {slot:'utility', capacity:25, weights:Object.freeze({sulfur:.5,gunpowder:.5})},
  heart_of_emberwatch: {slot:'utility', emberWard:true},
  sunforged_viking_helm: {slot:'head', reduction:.06, lastStand:true}
};
export const CRATE_EQUIPMENT = Object.freeze(Object.fromEntries(Object.entries(equipment).map(([id,value])=>[id,Object.freeze({id,...value})])));
export const CRATE_RULES = Object.freeze({
  duplicateReturn:.7, armorCap:.25, milestoneEvery:10, helmetNights:100,
  phoenixHealth:.4, phoenixProtectionSeconds:3,
  lastStandThreshold:.25, lastStandWard:20, lastStandSeconds:10,
  emberWard:50, emberWardSeconds:10, emberWardRadius:8
});
export function emptyLoadout() {
  return {head:'',body:'',feet:'',utility:'',kit:'',tool:'pickaxe',reserveEmber:false};
}
// This only validates shape. The server must separately verify account ownership.
export function normalizeLoadout(value={}) {
  const clean=emptyLoadout();
  if(!value||typeof value!=='object')return clean;
  for(const slot of LOADOUT_SLOTS)if(CRATE_EQUIPMENT[value[slot]]?.slot===slot)clean[slot]=value[slot];
  if(GATHERING_TOOLS.includes(value.tool))clean.tool=value.tool;
  clean.reserveEmber=value.reserveEmber===true;
  return clean;
}
export function equippedItem(player,slot) {
  const item=CRATE_EQUIPMENT[player?.crateEquipment?.[slot]];
  return item?.slot===slot?item:null;
}
export function crateMilestoneTier(nights) {
  if(!Number.isSafeInteger(nights)||nights<10||nights%10)return null;
  return nights<40?'basic':nights<70?'rare':nights<100?'epic':'legendary';
}
