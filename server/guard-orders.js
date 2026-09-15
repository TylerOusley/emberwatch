import { GUARD_ORDERS, GUARD_ORDER_RULES } from '../shared/guard-orders.js';
import { PLOTS, canStand, plotFront, plotSolids, plotAccessRoute } from '../shared/world.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const ownedBarracks = (village, id, ownerId) => (village.plots ?? []).find(plot =>
  plot.id === id && plot.ownerId === ownerId && plot.building === 'barracks' && plot.hp > 0 && PLOTS.some(site => site.id === id));
const living = player => player?.online && !player.downed && player.hp > 0;
const validMode = mode => Object.hasOwn(GUARD_ORDERS, mode);
const retreatRoutes = new WeakMap();

// The village and its southern approach are connected through the shared gate.
// The narrow terrain beyond the side/rear walls has no troop road: following
// mounted explorers there would cause futile searches around the whole castle.
export function canRallyAt(village, point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) return false;
  if (point.z < 21 && (Math.abs(point.x) > 85 || point.z < -130)) return false;
  return canStand(point.x, point.z, .5, plotSolids(village.plots));
}

function readOrder(plot) {
  const order = plot.guardOrder;
  if (!order || order.ownerId !== plot.ownerId || !validMode(order.mode)) return { mode: 'defend' };
  return order;
}

function homeFor(plot, slot = 1) {
  const site = PLOTS.find(p => p.id === plot.id), door = plotFront(site, 1), yaw = site.yaw ?? 0;
  return { x: door.x + Math.cos(yaw) * (slot - 1) * 1.2, z: door.z - Math.sin(yaw) * (slot - 1) * 1.2 };
}

function followPoint(village, owner, slot) {
  const yaw = Number.isFinite(owner.yaw) ? owner.yaw : 0;
  const point = { x: owner.x - Math.sin(yaw) * 2.6 + Math.cos(yaw) * (slot - 1) * 1.3,
    z: owner.z - Math.cos(yaw) * 2.6 - Math.sin(yaw) * (slot - 1) * 1.3 };
  return canRallyAt(village, point) ? point : { x: owner.x, z: owner.z };
}

function retreatWaypoint(guard, plot, anchor, fallback) {
  let state = retreatRoutes.get(guard);
  if (!state || state.order !== plot.guardOrder || state.fallback !== fallback) {
    const route = plotAccessRoute(PLOTS.find(site => site.id === plot.id)).slice().reverse();
    route[route.length - 1] = anchor;
    let index = 0;
    for (let i = 1; i < route.length; i++) if (distance(guard, route[i]) <= distance(guard, route[index])) index = i;
    state = { order: plot.guardOrder, fallback, route, index }; retreatRoutes.set(guard, state);
  }
  while (state.index < state.route.length - 1 && distance(guard, state.route[state.index]) < 1.25) state.index++;
  return guardOrderWaypoint(guard, state.route[state.index]);
}

// Select a gate waypoint before asking the collision-aware navigator to solve
// the local route. Orders on opposite sides never ask it to cross a wall.
export function guardOrderWaypoint(from, target) {
  const inside = { x: 0, z: 14 }, outside = { x: 0, z: 25 };
  if (target.z >= 21 && from.z < 21) {
    if (from.z < 19 && (from.z < 13 || Math.abs(from.x) > 3)) return inside;
    return outside;
  }
  if (target.z <= 15 && from.z > 15) {
    if (from.z > 19 && (from.z > 26 || Math.abs(from.x) > 3)) return outside;
    return inside;
  }
  return target;
}

export function guardOrdersAction(_sim, village, player, action) {
  if (action.kind !== 'guard_order') return null;
  if (village.status !== 'active' || !living(player)) throw new Error('A living guard must give troop orders.');
  if (player.role !== 'guard') throw new Error('Only guards may command barracks troops.');
  if (player.mountedHorseId || player.bedPlotId) throw new Error('Dismount or leave your bed before giving troop orders.');
  const plot = ownedBarracks(village, action.plotId, player.id);
  if (!plot) throw new Error('Choose an intact barracks that you own.');
  if (!validMode(action.mode)) throw new Error('Choose defend, hold, follow, or retreat.');
  if (['hold', 'follow'].includes(action.mode) && !canRallyAt(village, player)) throw new Error('Give that order from open ground inside the village or on the gate approach.');
  // Client coordinates are deliberately ignored: Hold here always means the
  // server's current player position, never an arbitrary forged rally point.
  plot.guardOrder = { mode: action.mode, ownerId: player.id,
    ...(action.mode === 'hold' ? { x: player.x, z: player.z } : {}) };
  for (const guard of village.guards ?? []) if (guard.plotId === plot.id && guard.ownerId === player.id) guard.roadIndex = 0;
  return `${GUARD_ORDERS[action.mode].label}. This barracks and its replacement troops will follow the order.`;
}

// null preserves the original road patrol for public watch and default orders.
export function guardDirective(village, guard) {
  if (!guard.plotId) return null;
  const plot = ownedBarracks(village, guard.plotId, guard.ownerId);
  if (!plot) return null;
  const order = readOrder(plot), owner = village.players?.[guard.ownerId];
  if (order.mode === 'defend') return null;
  let mode = order.mode, fallback = null, anchor;
  const slot = Number.isInteger(guard.slot) ? Math.max(0, Math.min(2, guard.slot)) : 1;
  if (mode === 'hold') {
    if (canRallyAt(village, order)) anchor = { x: order.x, z: order.z };
    else { mode = 'retreat'; fallback = 'Rally point blocked'; }
  }
  if (mode === 'follow') {
    if (living(owner) && owner.role === 'guard' && !owner.mountedHorseId && !owner.bedPlotId && canRallyAt(village, owner)) anchor = followPoint(village, owner, slot);
    else { mode = 'retreat'; fallback = 'Owner unavailable'; }
  }
  if (mode === 'retreat') anchor = homeFor(plot, slot);
  const destination = mode === 'retreat' ? retreatWaypoint(guard, plot, anchor, fallback) : guardOrderWaypoint(guard, anchor);
  if (mode !== 'retreat') retreatRoutes.delete(guard);
  return { mode, requestedMode: order.mode, fallback, anchor, destination,
    acquireRange: mode === 'retreat' ? 3 : GUARD_ORDER_RULES.acquireRange,
    leashRadius: mode === 'hold' ? GUARD_ORDER_RULES.holdLeash : mode === 'follow' ? GUARD_ORDER_RULES.followLeash : GUARD_ORDER_RULES.retreatLeash };
}

export function guardOrderCanEngage(guard, target, directive) {
  if (!(target?.hp > 0) || ![target.x, target.z].every(Number.isFinite)) return false;
  if (!directive) return distance(guard, target) < 12 && target.z < 55;
  if (distance(guard, target) >= directive.acquireRange || distance(target, directive.anchor) > directive.leashRadius) return false;
  // A nearby enemy beyond a side wall is not a valid reason to abandon a rally.
  if ((guard.z < 18) !== (target.z < 18) && (Math.abs(guard.x) > 4 || Math.abs(target.x) > 4)) return false;
  return true;
}

export function guardOrdersSnapshot(village, viewerId) {
  const player = village.players?.[viewerId];
  if (!player || player.role !== 'guard') return { guardOrders: [] };
  return { guardOrders: (village.plots ?? []).filter(plot => ownedBarracks(village, plot.id, viewerId)).map(plot => {
    const troops = (village.guards ?? []).filter(guard => guard.plotId === plot.id && guard.ownerId === viewerId);
    const order = readOrder(plot), representative = troops.find(guard => guard.hp > 0) ?? { ownerId: viewerId, plotId: plot.id, slot: 1, ...homeFor(plot) };
    const directive = guardDirective(village, representative), home = homeFor(plot);
    return { plotId: plot.id, ownerId: viewerId, mode: order.mode, effectiveMode: directive?.mode ?? 'defend', fallback: directive?.fallback ?? null,
      rally: directive?.anchor ?? representative.post ?? { x: 0, z: 35 }, home,
      livingTroops: troops.filter(guard => guard.hp > 0).length, recruitedTroops: troops.length };
  }) };
}
