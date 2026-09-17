import { ROAD, PLOTS } from './world.js';

export const TRANSPORT = Object.freeze({ horseCost: 100, merchantHorseCost: 50, stableCapacity: 3, horseSpeed: 10.5, loadedRoadBonus: 1.2,
  cartCapacity: 1000, upgradedCartCapacity: 2000, cartUpgradeGold: 750, cartUpgradeMaterials: Object.freeze({ timber: 40, iron: 15 }),
  rescueCapacity: 2, maxHorses: 1, maxCarts: 1 });
export const LOANS = Object.freeze({ maximumDebt: 1000, runPool: 8000, reserve: 1000, repaymentPercent: 20 });

export const cartCapacity = cart => cart?.upgradeLevel >= 1 ? TRANSPORT.upgradedCartCapacity : TRANSPORT.cartCapacity;

// Match the main road, paved northern approach and neighbourhood lanes. Narrow
// footpaths and the underground mine remain ordinary horse speed.
const freightRoads = [
  ...ROAD.slice(1).map((point, i) => [ROAD[i], point, 3.2]),
  [{ x: 0, z: -60 }, { x: 0, z: -129.4 }, 1.8],
  ...[-1, 1].flatMap(side => [
    ...[39, 61].map(x => [{ x: side * x, z: 14 }, { x: side * x, z: -129.4 }, 1.7]),
    ...[14, -60].map(z => [{ x: 0, z }, { x: side * 61, z }, 1.5])
  ])
];
export function onFreightRoad(point) {
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.z)) return false;
  return freightRoads.some(([a, b, halfWidth]) => {
    const dx = b.x - a.x, dz = b.z - a.z, t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(point.x - a.x - dx * t, point.z - a.z - dz * t) <= halfWidth;
  });
}

export function mountedTravelSpeed(village, player) {
  const horse = village?.horses?.find(h => h.id === player?.mountedHorseId && h.riderId === player?.id);
  const cart = horse && village?.carts?.find(c => c.id === horse.cartId && c.horseId === horse.id);
  const loaded = cart && ((cart.weight ?? 0) > 0 || Object.values(cart.storage ?? {}).some(amount => amount > 0) || cart.rescuePlayerIds?.length > 0);
  return TRANSPORT.horseSpeed * (loaded && onFreightRoad(player) ? TRANSPORT.loadedRoadBonus : 1);
}

export function cartPassengerPoint(cart, slot = 0) {
  const lateral = slot === 1 ? .46 : -.46, yaw = cart.yaw ?? 0;
  return { x: cart.x + Math.cos(yaw) * lateral, z: cart.z - Math.sin(yaw) * lateral };
}

export const transportPlotSite = plot => PLOTS.find(site => site.id === plot?.id) ?? plot;
