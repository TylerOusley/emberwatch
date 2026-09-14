const RESOURCE_TOOLS = { axe: 'timber', pickaxe: 'stone', scythe: 'wheat' };
const SERVICES = new Set(['bank', 'shop', 'food', 'church', 'barracks']);
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function nearestGatherable(player, tool, nodes, states) {
  const type = RESOURCE_TOOLS[tool];
  if (!player || !type) return null;
  const available = new Set(states.filter(s => s.available).map(s => s.id));
  let target = null, nearest = 3.3;
  for (const node of nodes) {
    if (node.type !== type || !available.has(node.id)) continue;
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
  let target = null, nearest = 2.4;
  for (const building of buildings) {
    if (!SERVICES.has(building.kind)) continue;
    const gap = Math.hypot(Math.max(0, Math.abs(player.x - building.x) - building.w / 2), Math.max(0, Math.abs(player.z - building.z) - building.d / 2));
    if (gap < nearest) { nearest = gap; target = building; }
  }
  return target ? { kind: target.kind, building: target } : null;
}
