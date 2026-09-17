import { STORAGE_CAPACITY } from './content.js';
import { environmentYieldMultiplier, environmentRegrowMultiplier } from './environment.js';

// All levels keep the original harvest anchors and consume one node harvest
// per completed action. Yield bonuses apply to players and hired workers.
export const PRODUCTION_LEVELS = Object.freeze({
  1: Object.freeze({ level: 1, yieldBonus: 0, nodeMultiplier: 1, nodeHarvests: Object.freeze({ wheat: 1, timber: 5, stone: 8, iron: 8, coal: 8, sulfur: 8 }), regrowMultiplier: 1, storageCapacity: STORAGE_CAPACITY, healthMultiplier: 1, resourceScale: 1 }),
  2: Object.freeze({ level: 2, yieldBonus: 1, nodeMultiplier: 1.5, nodeHarvests: Object.freeze({ wheat: 2, timber: 8, stone: 12, iron: 12, coal: 12, sulfur: 12 }), regrowMultiplier: .75, storageCapacity: 2000, healthMultiplier: 1.5, resourceScale: 1.08 }),
  3: Object.freeze({ level: 3, yieldBonus: 2, nodeMultiplier: 2, nodeHarvests: Object.freeze({ wheat: 3, timber: 10, stone: 16, iron: 16, coal: 16, sulfur: 16 }), regrowMultiplier: .5, storageCapacity: 3000, healthMultiplier: 2, resourceScale: 1.16 })
});
const price = (gold, timber, stone, iron) => Object.freeze({ gold, resources: Object.freeze({ timber, stone, iron }) });
export const PRODUCTION_UPGRADES = Object.freeze({
  wheat_farm: Object.freeze({ 2: price(80, 20, 15, 3), 3: price(180, 40, 30, 8) }),
  tree_farm: Object.freeze({ 2: price(100, 25, 20, 5), 3: price(220, 50, 40, 12) }),
  mine: Object.freeze({ 2: price(150, 30, 30, 10), 3: price(300, 60, 60, 25) })
});
export function productionLevel(plot) {
  return Object.hasOwn(PRODUCTION_UPGRADES, plot?.building ?? '') && Number.isInteger(plot.level) && Object.hasOwn(PRODUCTION_LEVELS, plot.level) ? plot.level : 1;
}
export function productionStats(plot) {
  return PRODUCTION_LEVELS[productionLevel(plot)];
}
export function productionUpgrade(plot) {
  if (!Object.hasOwn(PRODUCTION_UPGRADES, plot?.building ?? '')) return null;
  const level = productionLevel(plot) + 1, cost = PRODUCTION_UPGRADES[plot.building][level];
  return cost ? { level, ...cost } : null;
}
export function productionYield(baseYield, plot = null) {
  return Number.isSafeInteger(baseYield) && baseYield > 0 ? baseYield + productionStats(plot).yieldBonus : 0;
}
// Preview first, then persist the remainder only after a successful harvest.
// A worker's one-unit harvest still earns every fractional seasonal/event bonus.
export function productionHarvest(baseYield, plot = null, type = null, environment = null, remainder = 0) {
  const base = productionYield(baseYield, plot);
  if (!base) return { yield: 0, remainder: 0 };
  const carry = Number.isFinite(remainder) && remainder >= 0 && remainder < 1 ? remainder : 0;
  const total = base * environmentYieldMultiplier(environment, type) + carry;
  const whole = Math.floor(total + 1e-9);
  return { yield: whole, remainder: Math.max(0, total - whole) };
}
export function plotStorageCapacity(plot) {
  return productionStats(plot).storageCapacity;
}
export function productionNodeCapacity(type, plot = null) {
  return productionStats(plot).nodeHarvests[type] ?? 8;
}
export function productionRegrowSeconds(type, plot = null, environment = null) {
  return (type === 'wheat' ? 90 : 150) * (plot ? .65 : 1) * productionStats(plot).regrowMultiplier * environmentRegrowMultiplier(environment, type);
}
