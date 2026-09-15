const RESOURCE_TOOLS = { axe: ['timber'], pickaxe: ['stone', 'iron', 'coal'], scythe: ['wheat'] };
const SERVICES = new Set(['bank', 'market', 'shop', 'food', 'church', 'barracks', 'stable', 'merchant', 'keep']);
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
import { clearResourceSegment, resolveResource } from '../../shared/world.js';

export function nearestGatherable(player, tool, nodes, states) {
  const type = RESOURCE_TOOLS[tool];
  if (!player || !type) return null;
  const available = new Map(states.filter(s => s.available).map(s => [s.id, s]));
  let target = null, nearest = 3.3;
  for (const metadata of nodes) {
    const node = resolveResource(metadata, available.get(metadata.id));
    if (!type.includes(node.type) || !available.has(node.id)) continue;
    const gap = distance(player, node);
    if (gap <= nearest && (!node.caveTier || clearResourceSegment(player, node))) { nearest = gap; target = node; }
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

// Guards use the same blessing as player allies. Ignore healthy/dead guards and
// offline residents so an invalid nearer entity cannot hide a valid patient.
export function nearestHealingTarget(player, players = [], guards = []) {
  if (!player || player.role !== 'priest' || player.downed) return null;
  return [...players.filter(p => p.id !== player.id && p.online && (p.downed || p.hp < p.maxHp)),
    ...guards.filter(g => g.hp > 0 && g.hp < g.maxHp)]
    .filter(target => distance(player, target) <= 3.5)
    .sort((a, b) => distance(player, a) - distance(player, b))[0] ?? null;
}

// Immediate transport/carry actions must not disappear behind a shop or a tree.
export function directCompanionInteraction(player, horses = []) {
  if (!player || player.downed || player.carriedBy || player.bedPlotId) return null;
  if (player.mountedHorseId) return { kind: 'dismountHorse', id: player.mountedHorseId, title: 'Dismount your horse', subtitle: 'Press E to get off · Cargo and hitching in your pack' };
  if (player.carryingId) return { kind: 'dropPlayer', id: player.carryingId, title: 'Put your companion down', subtitle: 'Press E or G to put down · Carry them to a church for treatment' };
  const horse = horses.filter(h => h.ownerId === player.id && !h.riderId && distance(player, h) <= 3)
    .sort((a, b) => distance(player, a) - distance(player, b))[0];
  return horse ? { kind: 'mountHorse', id: horse.id, title: 'Mount your horse', subtitle: 'Press E to get on · Cargo and hitching in your pack' } : null;
}
