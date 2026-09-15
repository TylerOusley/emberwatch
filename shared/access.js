import { plotSolid, plotBedPoint } from './world.js';
import { bedCapacity } from './defense.js';

// Service positions follow the same +local-Z frontage as the artwork. The
// approach point lies outside the facade (and outside open-shop counters).
export const INTERACTION_RANGE = 2.6;
const shopTypes = new Set(['tool_shop', 'tinker_shop', 'sword_shop']);
const finitePoint = p => p && Number.isFinite(p.x) && Number.isFinite(p.z);
const frontDepth = site => Math.abs(Math.sin(site.yaw ?? 0)) > .5 ? site.w / 2 : site.d / 2;
function approach(site, depth, clearance) {
  if (!finitePoint(site) || !Number.isFinite(depth) || !Number.isFinite(site.yaw ?? 0)) return null;
  const yaw = site.yaw ?? 0;
  return { x: site.x + Math.sin(yaw) * (depth + clearance), z: site.z + Math.cos(yaw) * (depth + clearance) };
}
function inFront(player, site, depth, point, range) {
  if (!finitePoint(player) || !finitePoint(point) || !Number.isFinite(range) || range < 0) return false;
  const yaw = site.yaw ?? 0;
  const forward = (player.x - site.x) * Math.sin(yaw) + (player.z - site.z) * Math.cos(yaw);
  // A radial door check alone can reach through the wall on small structures.
  return forward >= depth + .25 && Math.hypot(player.x - point.x, player.z - point.z) <= range;
}
export function buildingEntrance(building) {
  if (!building) return null;
  const counter = building.kind === 'shop' || building.kind === 'food' || building.kind === 'market';
  return approach(building, frontDepth(building), counter ? 2.55 : .9);
}
export function canUseBuilding(player, building, range = INTERACTION_RANGE) {
  return !!building && inFront(player, building, frontDepth(building), buildingEntrance(building), range);
}
function plotShape(site, state) {
  const type = typeof state === 'string' ? state : state?.building;
  const ruined = typeof state === 'object' && state !== null && state.hp <= 0;
  const solid = !ruined && type && plotSolid(site, type);
  return { type, depth: frontDepth(solid ? { ...solid, yaw: site.yaw } : site), solid };
}
export function plotEntrance(site, state) {
  if (!site) return null;
  const shape = plotShape(site, state);
  return approach(site, shape.depth, shape.solid && shopTypes.has(shape.type) ? 2.55 : .9);
}
export function canUsePlot(player, site, state, range = INTERACTION_RANGE) {
  if (!site) return false;
  const shape = plotShape(site, state);
  return inFront(player, site, shape.depth, plotEntrance(site, state), range);
}
export function canUseChurchBed(player, site, state, range = INTERACTION_RANGE) {
  if (!finitePoint(player) || !finitePoint(site) || state?.building !== 'church' || state.hp <= 0 || !Number.isFinite(range) || range < 0) return false;
  return Array.from({ length: bedCapacity(state) }, (_, index) => plotBedPoint(site, index))
    .some(point => Math.hypot(player.x - point.x, player.z - point.z) <= range);
}
