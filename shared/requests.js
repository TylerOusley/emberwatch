import { BUILDINGS, PLOTS } from './world.js';
import { buildingEntrance, plotEntrance, canUseBuilding, canUsePlot } from './access.js';

export const REQUEST_RULES = Object.freeze({ maxDaily: 4, dailyGold: 300, maxUnits: 24, history: 12 });
const defenseResources = Object.freeze({ cannon: { coal: 8, stone: 8 } });
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;

/** The same doorstep and actual stores power both the public board and delivery checks. */
export function requestDestinations(v) {
  const residents = Math.max(1, Object.values(v.players || {}).filter(p => p.online || p.participated > 0).length);
  const targets = [];
  const add = (id, resource, target, stock, name, reason, site, plot = null) => {
    targets.push({ key: `${id}:${resource}`, destinationId: id, resource, target, stock: count(stock), name, reason,
      ownerId: plot?.ownerId ?? null, building: plot?.building ?? null,
      point: { ...(plot ? plotEntrance(site, plot) : buildingEntrance(site)), id: site.id, name, kind: plot ? 'plot' : 'service' } });
  };
  const market = BUILDINGS.find(b => b.id === 'market'), watch = BUILDINGS.find(b => b.id === 'barracks');
  for (const [resource, target, reason] of [['wheat', 40 + residents * 8, 'Keep the village food stand supplied.'], ['timber', 40, 'Keep timber ready for gate repairs.'], ['stone', 30, 'Keep stone ready for village repairs.']]) {
    // 'bank' is the saved communal-stock ledger identity. Its physical delivery
    // point moved to the exchange; keeping the key preserves withdrawal debt.
    add('bank', resource, target, v.stock?.[resource], market.name, reason, market);
  }
  const watchSlots = (v.guards || []).filter(g => !g.ownerId).length;
  if (watchSlots > 0) add('barracks', 'wheat', Math.max(6, watchSlots * 3), v.barracks?.wheat, watch.name, 'Feed the public watch and replace fallen defenders.', watch);
  for (const plot of v.plots || []) {
    const spec = defenseResources[plot.building], site = PLOTS.find(s => s.id === plot.id);
    if (!spec || !site || !plot.ownerId || !(plot.hp > 0)) continue;
    for (const [resource, target] of Object.entries(spec)) add(plot.id, resource, target, plot.storage?.[resource], site.name || plot.id, 'Restock ammunition for an active village defense.', site, plot);
  }
  return targets;
}

export function requestAtDestination(player, request, village) {
  if (!player || !request) return false;
  if (['bank', 'barracks'].includes(request.destinationId)) return canUseBuilding(player, BUILDINGS.find(b => b.id === (request.destinationId === 'bank' ? 'market' : request.destinationId)));
  const site = PLOTS.find(p => p.id === request.destinationId), plot = village?.plots?.find(p => p.id === request.destinationId);
  return !!plot && plot.hp > 0 && plot.ownerId === request.ownerId && plot.building === request.building && canUsePlot(player, site, plot);
}
