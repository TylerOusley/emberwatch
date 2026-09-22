import { roleSkills } from './skills.js';
import { equippedItem } from './crates.js';

// Employment costs are paid from the owner's wallet. Hired hands never spend
// purchase credit or the village's treasury. Opted-in tool replacement is the
// separate exception that spends the owner's bank savings.
export const WORKER_RULES = Object.freeze({
  maxPerPlayer: 5, hireCost: 75, wageGold: 1, wageSeconds: 30,
  carryCapacity: 40, gatherSeconds: 4, speed: 3,
  xpPerPoint: 25, maxAttributeRank: 5
});
export const WORKER_RESOURCES = Object.freeze(['wheat', 'timber', 'stone', 'iron', 'coal', 'sulfur']);
export const WORKER_MINE_RESOURCES = Object.freeze(['stone', 'iron', 'coal', 'sulfur']);
// Assignments may describe several node types, but cargo and sale accounting
// always use real resource IDs. Mixed mining is confined to an owned mine.
export const WORKER_ASSIGNMENTS = Object.freeze([...WORKER_RESOURCES, 'mine_all']);
export const WORKER_TOOLS = Object.freeze({ wheat: 'scythe', timber: 'axe', stone: 'pickaxe', iron: 'pickaxe', coal: 'pickaxe', sulfur: 'pickaxe', mine_all: 'pickaxe' });
export const WORKER_EQUIPMENT = Object.freeze({
  wood: Object.freeze({ multiplier: 1 }),
  stone: Object.freeze({ multiplier: 1.25, purchaseGold: 30 }),
  iron: Object.freeze({ multiplier: 1.5, purchaseGold: 100 })
});
export function workerEmployment(player = {}) {
  const skills = roleSkills(player);
  return { limit: skills.workerLimit, wageSeconds: skills.workerWageSeconds };
}
export function workerTool(worker, tool = WORKER_TOOLS[worker?.resource]) {
  const equipped = worker?.equipment?.[tool];
  return equipped && ['stone', 'iron'].includes(equipped.tier) && equipped.durability > 0 ? equipped : { tier: 'wood', durability: null, maxDurability: null };
}
// Plot staff are additional to the five personally hired workers. An empty or
// destroyed plot has no active staff; staff never create stock by themselves.
export const PLOT_STAFF = Object.freeze({
  wheat_farm: 'gatherer', tree_farm: 'gatherer', mine: 'gatherer',
  tool_shop: 'transporter', tinker_shop: 'transporter', sword_shop: 'transporter', smelter: 'transporter',
  archer_tower: 'transporter', cannon: 'transporter', barracks: 'transporter', church: 'transporter',
  wizard_tower: 'transporter', arcane_academy: 'transporter'
});
export function plotStaffCount(plot) {
  return plot?.ownerId && plot.hp > 0 && Object.hasOwn(PLOT_STAFF, plot.building ?? '') && Number.isInteger(plot.level)
    ? Math.max(0, Math.min(3, plot.level)) : 0;
}
export function transporterTarget(capacity, resourceWeight, percent) {
  return Number.isFinite(capacity) && capacity > 0 && Number.isFinite(resourceWeight) && resourceWeight > 0 && Number.isInteger(percent) && percent >= 1 && percent <= 100
    ? Math.floor((capacity * percent / 100 + 1e-6) / resourceWeight) : 0;
}
export const WORKER_ATTRIBUTES = Object.freeze({
  gathering: Object.freeze({ name: 'Gathering', benefit: '0.4 seconds faster per harvest' }),
  speed: Object.freeze({ name: 'Movement', benefit: '+0.3 movement speed' }),
  carry: Object.freeze({ name: 'Carrying', benefit: '+10 cargo capacity' })
});
export const WORKER_COLORS = Object.freeze([
  { name: 'Moss', value: '#71865b' }, { name: 'Ocean', value: '#4c86a4' },
  { name: 'Brick', value: '#b55f4f' }, { name: 'Gold', value: '#c49b47' },
  { name: 'Violet', value: '#9772ae' }, { name: 'Teal', value: '#478d80' },
  { name: 'Rose', value: '#ba768e' }, { name: 'Slate', value: '#71808f' }
].map(Object.freeze));
export const WORKER_MAX_XP = WORKER_RULES.xpPerPoint * WORKER_RULES.maxAttributeRank * Object.keys(WORKER_ATTRIBUTES).length;
export function workerStats(worker = {}, owner = {}) {
  const rank = id => Number.isInteger(worker.attributes?.[id]) ? Math.max(0, Math.min(WORKER_RULES.maxAttributeRank, worker.attributes[id])) : 0;
  const skills = roleSkills(owner);
  return {
    gatherSeconds: (Math.round((WORKER_RULES.gatherSeconds - rank('gathering') * .4) * 10) / 10) / skills.workerGatherMultiplier,
    speed: WORKER_RULES.speed + rank('speed') * .3,
    carryCapacity: WORKER_RULES.carryCapacity + rank('carry') * 10 + skills.workerCargoBonus + (equippedItem(owner, 'utility')?.workerCarryBonus ?? 0)
  };
}
