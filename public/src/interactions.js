const RESOURCE_TOOLS = { axe: ['timber'], pickaxe: ['stone', 'iron', 'coal'], scythe: ['wheat'] };
const SERVICES = new Set(['bank', 'shop', 'food', 'church', 'barracks', 'stable', 'merchant', 'keep']);
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function nearestGatherable(player, tool, nodes, states) {
  const type = RESOURCE_TOOLS[tool];
  if (!player || !type) return null;
  const available = new Set(states.filter(s => s.available).map(s => s.id));
  let target = null, nearest = 3.3;
  for (const node of nodes) {
    if (!type.includes(node.type) || !available.has(node.id)) continue;
    const gap = distance(player, node);
    if (gap <= nearest) { nearest = gap; target = node; }
  }
  return target;
}

// A selected gathering tool expresses intent: a reachable matching resource
// takes priority over a neighboring shop. The same target is used for E and click.
export function chooseInteraction(player, tool, nodes, states, buildings) {
  if (!player || player.downed) return null;
  const resource = nearestGatherable(player, tool, nodes, states);
  if (resource) return { kind: 'gather', resource, targetId: resource.id };
  if (tool === 'hammer' && distance(player, { x: 0, z: 18 }) <= 4.5) return { kind: 'repair', targetId: 'gate' };
  let target = null, nearest = Infinity;
  for (const building of buildings) {
    if (!SERVICES.has(building.kind) || !canUseBuilding(player, building)) continue;
    const gap = distance(player, buildingEntrance(building));
    if (gap < nearest) { nearest = gap; target = building; }
  }
  return target ? { kind: target.kind, building: target } : null;
}

// Occupied plots use their building's doorway. Open land uses the fence gate;
// church beds are separate interaction points for care beside the bed itself.
export function choosePlotInteraction(player, sites, states = []) {
  if (!player || player.downed) return null;
  let nearest = Infinity, selected = null;
  for (const site of sites) {
    const state = states.find(plot => plot.id === site.id);
    const atDoor = canUsePlot(player, site, state);
    const atBed = canUseChurchBed(player, site, state);
    if (!atDoor && !atBed) continue;
    const gap = distance(player, plotEntrance(site, state));
    if (gap < nearest) { nearest = gap; selected = { kind: 'plot', site, state, atBed: atBed && !atDoor }; }
  }
  return selected;
}
import { buildingEntrance, plotEntrance, canUseBuilding, canUsePlot, canUseChurchBed } from '../../shared/access.js';
