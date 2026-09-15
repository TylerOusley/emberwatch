import { STORAGE_CAPACITY } from './content.js';

// Level two keeps the same harvest anchors, permissions and visitor split.
// More harvests per node and shorter regrowth improve sustained production.
export const PRODUCTION_UPGRADES = Object.freeze({
  wheat_farm: Object.freeze({ gold: 80, resources: Object.freeze({ timber: 20, stone: 15, iron: 3 }) }),
  tree_farm: Object.freeze({ gold: 100, resources: Object.freeze({ timber: 25, stone: 20, iron: 5 }) }),
  mine: Object.freeze({ gold: 150, resources: Object.freeze({ timber: 30, stone: 30, iron: 10 }) })
});
export function productionLevel(plot) {
  return Object.hasOwn(PRODUCTION_UPGRADES, plot?.building ?? '') && plot.level >= 2 ? 2 : 1;
}
export function plotStorageCapacity(plot) {
  return productionLevel(plot) === 2 ? 2000 : STORAGE_CAPACITY;
}
export function productionNodeCapacity(type, plot = null) {
  const base = type === 'wheat' ? 1 : type === 'timber' ? 5 : 8;
  return productionLevel(plot) === 2 ? Math.ceil(base * 1.5) : base;
}
export function productionRegrowSeconds(type, plot = null) {
  return (type === 'wheat' ? 90 : 150) * (plot ? .65 : 1) * (productionLevel(plot) === 2 ? .75 : 1);
}
