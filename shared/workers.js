// Employment costs are paid from the owner's wallet. Hired hands never spend
// protected savings, purchase credit, or the village's treasury.
export const WORKER_RULES = Object.freeze({
  maxPerPlayer: 5, hireCost: 75, wageGold: 1, wageSeconds: 30,
  carryCapacity: 40, gatherSeconds: 4, speed: 3,
  xpPerPoint: 25, maxAttributeRank: 5
});
export const WORKER_RESOURCES = Object.freeze(['wheat', 'timber', 'stone', 'iron', 'coal', 'sulfur']);
// Plot staff are additional to the five personally hired workers. An empty or
// destroyed plot has no active staff; staff never create stock by themselves.
export const PLOT_STAFF = Object.freeze({
  wheat_farm: 'gatherer', tree_farm: 'gatherer', mine: 'gatherer',
  tool_shop: 'transporter', tinker_shop: 'transporter', sword_shop: 'transporter',
  archer_tower: 'transporter', cannon: 'transporter', barracks: 'transporter', church: 'transporter'
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
export function workerStats(worker = {}) {
  const rank = id => Number.isInteger(worker.attributes?.[id]) ? Math.max(0, Math.min(WORKER_RULES.maxAttributeRank, worker.attributes[id])) : 0;
  return {
    gatherSeconds: Math.round((WORKER_RULES.gatherSeconds - rank('gathering') * .4) * 10) / 10,
    speed: WORKER_RULES.speed + rank('speed') * .3,
    carryCapacity: WORKER_RULES.carryCapacity + rank('carry') * 10
  };
}
