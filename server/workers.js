import { buildingEntrance, canUseBuilding } from '../shared/access.js';
import { randomUUID } from 'node:crypto';
import { BUILDINGS, PLOTS, RESOURCES, SOLIDS, canStand, plotFront, plotSolids, resolveResource } from '../shared/world.js';
import { BUILDING_TYPES, RESOURCE_WEIGHTS, TOOL_WEIGHTS, TOOL_TIERS, inventoryWeight, carryCapacity, resourceWeight } from '../shared/content.js';
import { TREASURY_RESERVE } from '../shared/market.js';
import { taxedSaleQuote } from '../shared/economy.js';
import { WORKER_RULES as RULES, WORKER_RESOURCES, WORKER_MINE_RESOURCES, WORKER_ASSIGNMENTS, WORKER_TOOLS, WORKER_EQUIPMENT, WORKER_ATTRIBUTES, WORKER_COLORS, WORKER_MAX_XP, PLOT_STAFF, plotStaffCount, transporterTarget, workerStats, workerEmployment, workerTool } from '../shared/workers.js';
import { plotStorageCapacity, productionRegrowSeconds, productionHarvest } from '../shared/production.js';
import { resetNpcNavigation, stepNpcNavigation } from './navigation.js';
import { ownedCartCount } from '../shared/cart-ownership.js';
import { TRANSPORT } from '../shared/transport.js';

const kinds = new Set(['worker_hire', 'worker_assign', 'worker_pause', 'worker_collect', 'worker_dismiss', 'worker_upgrade', 'worker_color', 'worker_equip', 'worker_unequip', 'worker_repair', 'worker_maintenance', 'worker_buy_tool', 'worker_auto_replace']);
const tools = WORKER_TOOLS;
const production = { wheat: 'wheat_farm', timber: 'tree_farm', stone: 'mine', iron: 'mine', coal: 'mine', sulfur: 'mine', mine_all: 'mine' };
const cargoResources = Object.keys(RESOURCE_WEIGHTS);
const publicNodes = new Map(RESOURCES.map(node => [node.id, node]));
const bank = BUILDINGS.find(building => building.id === 'bank');
const market = BUILDINGS.find(building => building.id === 'market');
const marketDoor = buildingEntrance(market);
const home = plotFront(bank, -1.3);
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const whole = value => Number.isSafeInteger(value) && value >= 0;
const hasCargo = worker => cargoResources.some(id => worker.cargo[id] > 0);
const nearBank = p => Math.hypot(Math.max(0, Math.abs(p.x - bank.x) - bank.w / 2), Math.max(0, Math.abs(p.z - bank.z) - bank.d / 2)) <= 3.5;
const requireBank = p => { if (!canUseBuilding(p, bank)) throw new Error('Visit the Village Treasury to hire or dismiss workers.'); };
const homeFor = (v, w) => {
  if (w.staffPlotId && !w.staffRetired) {
    const anchor = PLOTS.find(plot => plot.id === w.staffPlotId);
    if (anchor) {
      const front = plotFront(anchor, 1), side = [-2, 2, 3.4][w.staffSlot] ?? -2;
      return { x: front.x + Math.cos(anchor.yaw ?? 0) * side, z: front.z - Math.sin(anchor.yaw ?? 0) * side };
    }
  }
  const slot = Math.max(0, v.workers.filter(worker => !worker.staffPlotId || worker.staffRetired).indexOf(w));
  // Manager crews can reach eighty personal hires in a full village. Park
  // twenty on each face instead of stacking the extra hires on old positions.
  // The clearance includes navigation's arrival tolerance for dismissal range.
  const face = Math.floor(slot / 20) % 4, side = face % 2 ? -1 : 1, local = slot % 20;
  return face < 2
    ? { x: bank.x + side * (bank.w / 2 + .9 + local % 2 * 1.2), z: bank.z + (Math.floor(local / 2) - 4.5) }
    : { x: bank.x + (Math.floor(local / 2) - 4.5), z: bank.z + side * (bank.d / 2 + .9 + local % 2 * 1.2) };
};
const marketFor = (v, w) => {
  // First arrivals occupy the counter; the remaining queue extends into the
  // open forecourt and advances as deliveries finish. Owners need not be online;
  // paused, retired or unfunded workers cannot hold a working crew's position.
  const queue = v.workers.filter(worker => !worker.paused && !worker.roleLimitPaused && !worker.staffRetired && v.players?.[worker.ownerId] && allowance(worker, v.players[worker.ownerId], 1) > 0 && worker.mode === 'sell' && worker.delivering && hasCargo(worker));
  const slot = Math.max(0, queue.indexOf(w)), row = Math.floor(slot / 4);
  return { x: marketDoor.x - (row < 4 ? row * .6 : 1.8 + (row - 3) * .9), z: marketDoor.z + (slot % 4 - 1.5) * .9 };
};

function ensureWorkerProgress(w) {
  w.workXp = whole(w.workXp) ? Math.min(WORKER_MAX_XP, w.workXp) : 0;
  const earned = Math.floor(w.workXp / RULES.xpPerPoint);
  let remaining = earned;
  const attributes = {};
  for (const id of Object.keys(WORKER_ATTRIBUTES)) {
    attributes[id] = whole(w.attributes?.[id]) ? Math.min(RULES.maxAttributeRank, w.attributes[id], remaining) : 0;
    remaining -= attributes[id];
  }
  w.attributes = attributes; w.upgradePoints = remaining; w.level = earned + 1;
  if (!WORKER_COLORS.some(color => color.value === w.color)) w.color = WORKER_COLORS[0].value;
}

export function ensureWorkers(v) {
  if (!Array.isArray(v.workers)) v.workers = [];
  reconcilePlotStaff(v);
  const personalCounts = new Map();
  for (const w of v.workers) {
    ensureWorkerProgress(w);
    w.cargo ??= {};
    for (const id of cargoResources) if (!whole(w.cargo[id])) w.cargo[id] = 0;
    w.name ??= `${v.players?.[w.ownerId]?.name ?? 'Village'}'s worker`;
    if (!Number.isFinite(w.x) || !Number.isFinite(w.z)) { w.x = home.x; w.z = home.z; }
    if (!Number.isFinite(w.yaw)) w.yaw = Math.PI / 2;
    if (!Number.isFinite(w.paidWorkSeconds) || w.paidWorkSeconds < 0) w.paidWorkSeconds = 0;
    // Preserve the duration of already purchased work through role switches,
    // reconnects and save migration. New wages use the owner's current role.
    w.paidWageSeconds = [30, 60].includes(w.paidWageSeconds) ? w.paidWageSeconds : w.paidWorkSeconds > 30 ? 60 : 30;
    w.paidWorkSeconds = Math.min(w.paidWageSeconds, w.paidWorkSeconds);
    const count = personalCounts.get(w.ownerId) ?? 0;
    w.roleLimitPaused = !w.staffPlotId && count >= workerEmployment(v.players?.[w.ownerId]).limit;
    if (!w.staffPlotId) personalCounts.set(w.ownerId, count + 1);
    const equipment = {};
    for (const tool of ['axe', 'pickaxe', 'scythe']) {
      const item = w.equipment?.[tool];
      if (!item || !['stone', 'iron'].includes(item.tier)) continue;
      const maxDurability = whole(item.maxDurability) && item.maxDurability > 0 ? Math.min(10000, item.maxDurability) : TOOL_TIERS[item.tier].durability;
      equipment[tool] = { tier: item.tier, maxDurability, durability: whole(item.durability) ? Math.min(maxDurability, item.durability) : 0, workerOnly: item.workerOnly === true };
    }
    w.equipment = equipment;
    // Previous maintenance only authorized capped wallet/material spending. It
    // must never silently opt an existing worker into bank-funded replacements.
    w.autoReplaceEnabled = w.autoReplaceEnabled === true;
    delete w.maintenanceEnabled; delete w.maintenanceBudgetGold; delete w.maintenancePlotId;
    if (!Number.isFinite(w.gatherProgress) || w.gatherProgress < 0) w.gatherProgress = 0;
    w.gatherProgress = Math.min(workerStats(w).gatherSeconds, w.gatherProgress);
    if (typeof w.paused !== 'boolean') w.paused = true;
    w.sourcePlotId ??= null; w.destinationPlotId ??= null;
    // Older assignments could only deliver to their owner's buildings. Do not
    // silently authorize a new recipient when a saved destination changes hands.
    if (w.destinationPlotId && typeof w.destinationOwnerId !== 'string') w.destinationOwnerId = w.ownerId;
    if (!w.destinationPlotId) w.destinationOwnerId = null;
    w.resource ??= null; w.mode ??= 'sell';
    w.anim ??= 'idle'; w.status ??= 'Choose an assignment'; w.hp = w.maxHp = 100;
  }
}

function reconcilePlotStaff(v) {
  const claimed = new Set();
  for (const w of v.workers) {
    if (!w.staffPlotId) continue;
    const plot = v.plots?.find(plot => plot.id === w.staffPlotId && plot.ownerId === w.ownerId);
    const key = `${w.ownerId}:${w.staffPlotId}:${w.staffSlot}`;
    const active = plot && PLOTS.some(anchor => anchor.id === plot.id) && PLOT_STAFF[plot.building] === w.staffRole && whole(w.staffSlot) && w.staffSlot < plotStaffCount(plot) && !claimed.has(key);
    if (active) claimed.add(key);
    w.staffRetired = !active;
    if (!active) { w.paused = true; w.status = 'Plot staff inactive — cargo kept; rebuild or collect supplies'; }
  }
  for (const plot of v.plots ?? []) {
    if (!v.players?.[plot.ownerId] || !PLOTS.some(anchor => anchor.id === plot.id)) continue;
    for (let slot = 0; slot < plotStaffCount(plot); slot++) {
      const key = `${plot.ownerId}:${plot.id}:${slot}`;
      if (claimed.has(key)) continue;
      const role = PLOT_STAFF[plot.building];
      // Reuse retired staff after rebuilding or changing this plot's building.
      // Cargo, training and prepaid wages stay with the original worker.
      let w = v.workers.find(worker => worker.ownerId === plot.ownerId && worker.staffPlotId === plot.id && worker.staffSlot === slot && worker.staffRetired);
      const resource = plot.building === 'wheat_farm' ? 'wheat' : plot.building === 'tree_farm' ? 'timber' : plot.building === 'mine' ? 'stone' : null;
      if (!w) {
        const anchor = plotFront(PLOTS.find(anchor => anchor.id === plot.id), 1);
        w = { id: `worker-${randomUUID()}`, ownerId: plot.ownerId, staffPlotId: plot.id, staffSlot: slot,
          name: `${v.players[plot.ownerId].name}'s plot ${role} ${slot + 1}`, ...anchor, yaw: Math.PI / 2, cargo: {}, paidWorkSeconds: 0 };
        v.workers.push(w);
      }
      Object.assign(w, { staffRole: role, staffRetired: false, resource, sourcePlotId: role === 'gatherer' ? plot.id : null,
        mode: 'store', destinationPlotId: plot.id, destinationOwnerId: plot.ownerId, targetPercent: 50, paused: true, targetNodeId: null,
        gatherProgress: 0, delivering: cargoResources.some(id => w.cargo?.[id] > 0), status: role === 'gatherer' ? 'Plot worker ready — resume to start' : 'Choose a supply route' });
      resetNpcNavigation(w); claimed.add(key);
    }
  }
}

function ownedWorker(v, p, id) {
  const worker = typeof id === 'string' && v.workers.find(w => w.id === id);
  if (!worker || worker.ownerId !== p.id) throw new Error('Choose one of your own workers.');
  return worker;
}

function sourcePlot(v, w) {
  return v.plots?.find(p => p.id === w.sourcePlotId && p.ownerId === w.ownerId && p.hp > 0 && !p.ruined && !p.rebuilding && p.building === production[w.resource]);
}

function destinationPlot(v, w) {
  const plot = storageBuilding(v, w.destinationPlotId);
  return plot?.ownerId === (w.destinationOwnerId ?? w.ownerId) ? plot : null;
}

function storageBuilding(v, id) {
  return v.plots?.find(p => p.id === id && p.ownerId && p.hp > 0 && !p.ruined && !p.rebuilding && Object.hasOwn(BUILDING_TYPES, p.building ?? '') && PLOTS.some(m => m.id === p.id));
}

function storageSource(v, w) {
  const plot = storageBuilding(v, w.sourcePlotId);
  return plot?.ownerId === w.ownerId ? plot : null;
}

function purchasedEquipment(tier) {
  return { tier, durability: TOOL_TIERS[tier].durability, maxDurability: TOOL_TIERS[tier].durability, workerOnly: true };
}

function equipmentAction(v, w, p, action) {
  if (['worker_equip', 'worker_repair', 'worker_maintenance'].includes(action.kind)) throw new Error('Worker tools have changed. Refresh the game to buy tools or manage automatic replacement.');
  if (action.kind === 'worker_auto_replace') {
    if (typeof action.enabled !== 'boolean') throw new Error('Choose whether automatic tool replacement is enabled.');
    if (action.enabled && (w.staffRetired || w.roleLimitPaused || w.staffRole === 'transporter')) throw new Error('Only an active gathering worker can enable automatic tool replacement.');
    w.autoReplaceEnabled = action.enabled;
    return action.enabled
      ? 'Automatic replacement enabled. Broken stone tools cost 30 bank gold; iron tools cost 100 bank gold. Replacements keep the same tier.'
      : 'Automatic tool replacement disabled.';
  }
  if (!['axe', 'pickaxe', 'scythe'].includes(action.tool)) throw new Error('Choose an axe, pickaxe or scythe.');
  const tool = action.tool, previous = w.equipment[tool];
  if (action.kind === 'worker_unequip') {
    if (!previous) throw new Error('This worker uses standard wooden equipment in that slot.');
    if (previous.workerOnly) throw new Error('Purchased worker tools stay with the worker and cannot be recovered into your pack.');
    if (distance(p, w) > 3.3) throw new Error('Stand next to this worker to recover their supplied tool.');
    p.durability ??= {}; p.maxDurability ??= {}; p.tiers ??= {};
    if (p.durability[tool] > 0) throw new Error('Your tool slot is occupied. Empty the slot before recovering this tool.');
    if (previous.durability > 0 && inventoryWeight(p) + TOOL_WEIGHTS[tool] > carryCapacity(p) + 1e-6) throw new Error('Your pack is full. Make room before recovering this tool.');
    p.tiers[tool] = previous.tier; p.durability[tool] = previous.durability; p.maxDurability[tool] = previous.maxDurability;
    delete w.equipment[tool];
    if (p.boundKitTools) delete p.boundKitTools[tool];
    return 'Previously supplied tool recovered. Standard wooden equipment is available again.';
  }
  if (w.roleLimitPaused) throw new Error('This worker is suspended by your current role limit. Reactivate them before buying tools.');
  if (w.staffRole === 'transporter') throw new Error('Transporters carry supplies and do not use gathering tools.');
  if (!['stone', 'iron'].includes(action.tier)) throw new Error('Choose a stone or iron worker tool.');
  if (previous?.tier === action.tier && previous.durability > 0) throw new Error('This worker already has a usable tool of that tier.');
  const price = WORKER_EQUIPMENT[action.tier].purchaseGold;
  if (!whole(p.wallet) || p.wallet < price) throw new Error(`This worker tool costs ${price} wallet gold.`);
  p.wallet -= price; w.equipment[tool] = purchasedEquipment(action.tier);
  return `${TOOL_TIERS[action.tier].name} ${tool} bought for ${price} wallet gold.${previous ? ' The previous worker tool was discarded without a refund.' : ''}`;
}

// Keep live worker/player/node references valid after an automatic replacement
// fails to persist. The SQLite transaction rolls back the matching bank debit.
function restoreWorkerState(target, source) {
  for (const key of Object.keys(target)) if (!Object.hasOwn(source, key)) delete target[key];
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && target[key] && typeof target[key] === 'object' && Array.isArray(value) === Array.isArray(target[key])) restoreWorkerState(target[key], value);
    else target[key] = structuredClone(value);
  }
  if (Array.isArray(target)) target.length = source.length;
}

export function workersAction(sim, v, p, action) {
  if (!kinds.has(action.kind)) return null;
  ensureWorkers(v);
  if (action.kind === 'worker_hire') {
    requireBank(p);
    const owned = v.workers.filter(w => w.ownerId === p.id && !w.staffPlotId);
    const limit = workerEmployment(p).limit;
    if (owned.length >= limit) throw new Error(`You may hire at most ${limit} workers in your current role.`);
    if (!whole(p.wallet) || p.wallet < RULES.hireCost) throw new Error(`Hiring a worker costs ${RULES.hireCost} wallet gold.`);
    const worker = {
      id: `worker-${randomUUID()}`, name: `${p.name}'s worker ${owned.length + 1}`, ownerId: p.id,
      x: home.x, z: home.z + (owned.length ? 1.2 : -1.2), yaw: Math.PI / 2,
      hp: 100, maxHp: 100, anim: 'idle', resource: null, sourcePlotId: null,
      mode: 'sell', destinationPlotId: null, paused: true, status: 'Choose an assignment',
      cargo: {}, paidWorkSeconds: 0, gatherProgress: 0, targetNodeId: null, delivering: false
    };
    p.wallet -= RULES.hireCost; v.workers.push(worker); Object.assign(worker, homeFor(v, worker)); ensureWorkers(v);
    return 'Worker hired. Choose a resource and delivery order to begin.';
  }
  const w = ownedWorker(v, p, action.workerId);
  if (w.staffRetired && !['worker_collect', 'worker_dismiss', 'worker_color', 'worker_unequip', 'worker_auto_replace'].includes(action.kind)) throw new Error('This plot no longer supports this worker. Rebuild it or collect the carried supplies.');
  if (['worker_equip', 'worker_unequip', 'worker_repair', 'worker_maintenance', 'worker_buy_tool', 'worker_auto_replace'].includes(action.kind)) return equipmentAction(v, w, p, action);
  if (action.kind === 'worker_upgrade') {
    if (typeof action.attribute !== 'string' || !Object.hasOwn(WORKER_ATTRIBUTES, action.attribute)) throw new Error('Choose gathering, movement or carrying to improve.');
    if (w.attributes[action.attribute] >= RULES.maxAttributeRank) throw new Error('This worker attribute is fully upgraded.');
    if (w.upgradePoints < 1) throw new Error(`Your worker earns an upgrade point every ${RULES.xpPerPoint} completed harvests.`);
    w.attributes[action.attribute]++; ensureWorkerProgress(w);
    return `${WORKER_ATTRIBUTES[action.attribute].name} improved to ${w.attributes[action.attribute]} / ${RULES.maxAttributeRank}.`;
  }
  if (action.kind === 'worker_color') {
    const color = WORKER_COLORS.find(option => option.value === action.color);
    if (!color) throw new Error('Choose one of the worker clothing colors.');
    w.color = color.value;
    return `Worker clothing changed to ${color.name.toLowerCase()}.`;
  }
  if (action.kind === 'worker_assign') {
    if (w.roleLimitPaused) throw new Error('Your current role supports fewer personal workers. Become a Manager or dismiss another hire to reactivate this worker.');
    if (w.staffRole === 'transporter') {
      const source = storageSource(v, { ...w, sourcePlotId: action.sourcePlotId });
      const destination = storageBuilding(v, action.destinationPlotId);
      if (!cargoResources.includes(action.resource)) throw new Error('Choose a stored resource to transport.');
      if (!source) throw new Error('Choose a living source building you own.');
      if (action.mode !== 'store' || !destination) throw new Error('Choose a living building for storage or donation.');
      if (source.id === destination.id) throw new Error('Choose a different living source building you own.');
      if (!Number.isInteger(action.targetPercent) || action.targetPercent < 1 || action.targetPercent > 100) throw new Error('Choose a target percentage from 1 to 100.');
      Object.assign(w, { resource: action.resource, sourcePlotId: source.id, mode: 'store', destinationPlotId: destination.id, destinationOwnerId: destination.ownerId, targetPercent: action.targetPercent,
        paused: false, delivering: hasCargo(w), gatherProgress: 0, targetNodeId: null, stalledFor: 0, status: 'Starting supply route' });
      resetNpcNavigation(w);
      return `Transporter will fill ${action.resource} to ${action.targetPercent}% of this building's storage capacity while anyone is online in the village and your wages are funded.`;
    }
    if (!WORKER_ASSIGNMENTS.includes(action.resource)) throw new Error('Choose wheat, timber, stone, iron, coal, sulfur or all mine resources.');
    if (action.sourcePlotId !== null && typeof action.sourcePlotId !== 'string') throw new Error('Choose public resources or one of your production plots.');
    if (action.resource === 'mine_all' && action.sourcePlotId === null) throw new Error('Choose an owned mine to gather all its resources.');
    if (!['store', 'sell'].includes(action.mode)) throw new Error('Choose whether to store or sell the resources.');
    const order = { ownerId: p.id, resource: action.resource, sourcePlotId: action.sourcePlotId, destinationPlotId: action.destinationPlotId };
    if (w.staffRole === 'gatherer' && action.sourcePlotId !== w.staffPlotId) throw new Error('Plot gatherers work at their own production plot.');
    if (action.sourcePlotId !== null && !sourcePlot(v, order)) throw new Error('Choose a living production building you own that supplies this resource.');
    const destination = action.mode === 'store' ? storageBuilding(v, action.destinationPlotId) : null;
    if (action.mode === 'store' && !destination) throw new Error('Choose a living building for storage or donation.');
    if (action.mode === 'sell' && action.destinationPlotId !== null) throw new Error('Resource Exchange sales do not need a storage building.');
    Object.assign(w, { resource: action.resource, sourcePlotId: action.sourcePlotId, mode: action.mode, destinationPlotId: destination?.id ?? null, destinationOwnerId: destination?.ownerId ?? null,
      paused: false, status: 'Starting work', targetNodeId: null, gatherProgress: 0, delivering: hasCargo(w), nextSearchAt: 0, stalledFor: 0 });
    resetNpcNavigation(w);
    return 'Worker assigned. Work continues day and night while anyone is online in the village and your wages are funded.';
  }
  if (action.kind === 'worker_pause') {
    if (typeof action.paused !== 'boolean') throw new Error('Choose whether to pause your worker.');
    if (!action.paused && w.roleLimitPaused) throw new Error('This worker is suspended by your current role limit. Their cargo and prepaid wages are kept.');
    w.paused = action.paused; w.gatherProgress = 0; w.targetNodeId = null;
    w.stalledFor = 0; resetNpcNavigation(w);
    const restingPlace = w.staffPlotId ? 'plot' : 'treasury';
    w.status = w.paused ? `Returning to ${restingPlace} — paused` : 'Starting work';
    return w.paused ? `Worker paused and returning to the ${restingPlace} with their cargo.` : 'Worker will resume the saved assignment, day or night.';
  }
  if (action.kind === 'worker_collect') {
    if (distance(p, w) > 3.3) throw new Error('Move closer to your worker to collect their cargo.');
    if (!hasCargo(w)) throw new Error('This worker has no cargo to collect.');
    let room = Math.max(0, carryCapacity(p) - inventoryWeight(p)), count = 0;
    const transfers = [];
    for (const id of cargoResources) {
      const amount = Math.min(w.cargo[id], Math.floor((room + 1e-6) / resourceWeight(p, id)));
      if (!amount) continue;
      if (!whole(p.inventory[id] ?? 0) || !whole((p.inventory[id] ?? 0) + amount)) throw new Error('Your pack cannot accept this cargo.');
      transfers.push([id, amount]); room -= amount * resourceWeight(p, id); count += amount;
    }
    if (!count) throw new Error('Your pack is full. Store or sell some goods first.');
    for (const [id, amount] of transfers) { p.inventory[id] = (p.inventory[id] ?? 0) + amount; w.cargo[id] -= amount; }
    if (!hasCargo(w)) w.delivering = false;
    return `Collected ${count} resources from your worker${hasCargo(w) ? '. The remaining cargo stays with them' : ''}.`;
  }
  if (w.staffPlotId && !w.staffRetired) throw new Error('Plot staff stay with their building. Pause them to stop work and wages.');
  requireBank(p);
  if (!nearBank(w)) throw new Error('Pause this worker and wait for them to return to the treasury before dismissal.');
  if (hasCargo(w)) throw new Error('Collect or deliver this worker\'s cargo before dismissal.');
  if (Object.values(w.equipment).some(item => !item.workerOnly)) throw new Error('Recover this worker\'s previously supplied tools before dismissal.');
  v.workers = v.workers.filter(worker => worker !== w);
  return 'Worker dismissed. Purchased worker tools are discarded; hiring fees and unused prepaid wages are not refunded.';
}

// Harvesting requires an open hand-to-node segment as well as proximity. This
// prevents an NPC on the opposite side of a wall from collecting through it.
function openSegment(from, to, solids) {
  for (const s of solids) {
    let low = 0, high = 1;
    for (const [start, delta, center, half] of [[from.x, to.x - from.x, s.x, s.w / 2], [from.z, to.z - from.z, s.z, s.d / 2]]) {
      if (Math.abs(delta) < 1e-9) {
        if (Math.abs(start - center) > half) { low = 1; high = 0; break; }
      } else {
        const a = (center - half - start) / delta, b = (center + half - start) / delta;
        low = Math.max(low, Math.min(a, b)); high = Math.min(high, Math.max(a, b));
      }
    }
    if (low <= high && high > 1e-7 && low < 1 - 1e-7) return false;
  }
  return true;
}

function approach(node, from, extraSolids) {
  const solids = [...SOLIDS, ...extraSolids], candidates = [];
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI / 6, point = { x: node.x + Math.sin(angle) * 1.6, z: node.z + Math.cos(angle) * 1.6 };
    if (canStand(point.x, point.z, .4, extraSolids) && openSegment(point, node, solids)) candidates.push(point);
  }
  return candidates.sort((a, b) => distance(from, a) - distance(from, b))[0] ?? null;
}

function availableNodes(v, w) {
  if (w.sourcePlotId !== null) return sourcePlot(v, w) ? (v.plotResources ?? []).filter(node => node.plotId === w.sourcePlotId && (w.resource === 'mine_all' ? WORKER_MINE_RESOURCES.includes(node.type) : node.type === w.resource) && node.available && node.remaining > 0).map(node => ({ node, state: node })) : [];
  return (v.resources ?? []).flatMap(state => {
    const node = resolveResource(publicNodes.get(state.id), state);
    // Sidewall woodland needs a much longer route around the wall's southern
    // end than the bounded navigation search supports. Hired hands use the
    // interior and the accessible fields/woodland beyond the shared gate.
    return node?.type === w.resource && !(Math.abs(node.x) > 85 && node.z < 18) && state.available && state.remaining > 0 ? [{ node, state }] : [];
  });
}

function allowance(w, p, dt) {
  if (w.paidWorkSeconds > 1e-7) return Math.min(dt, w.paidWorkSeconds);
  return whole(p.wallet) && p.wallet >= RULES.wageGold ? Math.min(dt, workerEmployment(p).wageSeconds) : 0;
}

function payForTime(w, p, dt) {
  if (dt <= 0) return;
  if (w.paidWorkSeconds <= 1e-7) { p.wallet -= RULES.wageGold; w.paidWageSeconds = workerEmployment(p).wageSeconds; w.paidWorkSeconds = w.paidWageSeconds; }
  w.paidWorkSeconds = Math.max(0, w.paidWorkSeconds - dt);
}

function move(w, target, dt, neighbors, solids, p = null, elapsedDt = dt) {
  const before = { x: w.x, z: w.z };
  let destination = target;
  const inside = w.z < 18, targetInside = target.z < 18;
  // The map's only passage through the southern wall is its central gate.
  // Explicit entry waypoints keep that gate inside the bounded path search
  // even when both endpoints are far to one side of the village.
  if (inside !== targetInside) {
    const approachGate = Math.abs(w.x) > 4 || (inside ? w.z < 10 : w.z > 26);
    destination = { x: 0, z: approachGate ? (inside ? 11 : 25) : (inside ? 25 : 11) };
  }
  const speed = workerStats(w, p ?? {}).speed;
  stepNpcNavigation(w, destination, speed, dt, neighbors, solids, elapsedDt);
  const moved = distance(before, w);
  if (moved > .001) w.stalledFor = 0;
  else if (distance(w, destination) > .7) {
    w.stalledFor = (Number.isFinite(w.stalledFor) ? w.stalledFor : 0) + elapsedDt;
    if (w.stalledFor >= 2) {
      // A fresh command or a long crowd/obstacle stall must not inherit a
      // failed cached route forever. Replan and release the current node so a
      // later tick can choose another reachable approach.
      resetNpcNavigation(w); w.targetNodeId = null; w.nextSearchAt = 0; w.stalledFor = 0;
    }
  }
  // Charge even sub-animation movement: otherwise a tiny prepaid remainder
  // caps every future step without ever being spent, continually throttling the
  // worker despite fresh orders. Truly blocked movement still costs nothing.
  if (p && moved > 0) payForTime(w, p, Math.min(dt, moved / speed));
  return moved > .001;
}

function returnHome(v, w, reason, dt, neighbors, solids) {
  w.gatherProgress = 0; w.targetNodeId = null;
  const target = homeFor(v, w);
  if (distance(w, target) > .7) {
    move(w, target, dt, neighbors, solids); w.status = `Returning to ${w.staffPlotId && !w.staffRetired ? 'plot' : 'treasury'} — ${reason.toLowerCase()}`;
  } else { w.anim = 'idle'; w.status = reason; }
}

function storeCargo(v, w) {
  const plot = destinationPlot(v, w);
  if (!plot) return false;
  let room = Math.max(0, plotStorageCapacity(plot) - inventoryWeight(plot.storage));
  for (const id of cargoResources) {
    const wanted = w.staffRole === 'transporter' && id === w.resource ? Math.max(0, transporterTarget(plotStorageCapacity(plot), RESOURCE_WEIGHTS[id], w.targetPercent) - (plot.storage[id] ?? 0)) : Infinity;
    const amount = Math.min(w.cargo[id], wanted, donationAllowance(v, w, plot, id), Math.floor((room + 1e-6) / RESOURCE_WEIGHTS[id]));
    if (amount > 0 && whole(plot.storage[id] ?? 0) && whole((plot.storage[id] ?? 0) + amount)) {
      plot.storage[id] = (plot.storage[id] ?? 0) + amount; w.cargo[id] -= amount; room -= amount * RESOURCE_WEIGHTS[id];
    }
  }
  w.status = hasCargo(w) ? w.staffRole === 'transporter' ? 'Storage full or target met — cargo kept' : 'Storage full — cargo kept' : 'Delivery complete';
  return !hasCargo(w);
}

function donationAllowance(v, w, plot, resource) {
  if (resource !== 'cart' || plot.ownerId === w.ownerId) return Infinity;
  const recipient = v.players?.[plot.ownerId];
  return recipient ? Math.max(0, TRANSPORT.maxCarts - ownedCartCount(v, recipient)) : 0;
}

function incomingDelivery(v, w, destination, resource) {
  const owner = v.players?.[w.ownerId];
  // Paused and unfunded donors keep their cargo, but must not reserve another
  // owner's supply target forever. Online presence is not a wage requirement.
  if (w.paused || w.roleLimitPaused || w.staffRetired || !owner || allowance(w, owner, 1) <= 0 || w.mode !== 'store'
      || w.destinationPlotId !== destination.id || (w.destinationOwnerId ?? w.ownerId) !== destination.ownerId
      || !(w.staffRole === 'transporter' ? cargoResources : WORKER_ASSIGNMENTS).includes(w.resource)
      || !(w.staffRole === 'transporter' || w.delivering)) return 0;
  // A transporter retains any excess over its own target on arrival. Count
  // only the portion it can actually deliver toward this recipient's stock.
  const wanted = w.staffRole === 'transporter' && resource === w.resource
    ? Math.max(0, transporterTarget(plotStorageCapacity(destination), RESOURCE_WEIGHTS[resource], w.targetPercent) - (destination.storage[resource] ?? 0)) : Infinity;
  return Math.min(w.cargo?.[resource] ?? 0, wanted, donationAllowance(v, w, destination, resource));
}

function transporterTick(v, w, p, dt, neighbors, solids) {
  const destination = destinationPlot(v, w);
  if (!destination) { returnHome(v, w, 'Choose a storage building', dt, neighbors, solids); return; }
  if (hasCargo(w)) {
    const time = allowance(w, p, dt);
    if (!time) { returnHome(v, w, 'Needs wallet gold for wages', dt, neighbors, solids); return; }
    const point = plotFront(PLOTS.find(anchor => anchor.id === destination.id), 1);
    if (distance(w, point) > .7) {
      const moved = move(w, point, time, neighbors, solids, p, dt);
      w.status = moved ? destination.ownerId === w.ownerId ? 'Transporting supplies to storage' : 'Delivering donated supplies' : 'Waiting for a clear delivery path';
    } else if (storeCargo(v, w)) {
      w.delivering = false; w.workXp = Math.min(WORKER_MAX_XP, w.workXp + 1); ensureWorkerProgress(w);
    }
    return;
  }
  const source = storageSource(v, w);
  if (!source || source === destination) { returnHome(v, w, 'Choose a supply source', dt, neighbors, solids); return; }
  const weight = RESOURCE_WEIGHTS[w.resource];
  const incoming = v.workers.reduce((sum, worker) => sum + (worker === w ? 0 : incomingDelivery(v, worker, destination, w.resource)), 0);
  const wanted = Math.max(0, transporterTarget(plotStorageCapacity(destination), weight, w.targetPercent) - (destination.storage[w.resource] ?? 0) - incoming);
  const room = Math.min(donationAllowance(v, w, destination, w.resource), Math.max(0, Math.floor((plotStorageCapacity(destination) - inventoryWeight(destination.storage) + 1e-6) / weight)));
  const available = source.storage[w.resource] ?? 0;
  if (!whole(available) || !whole(destination.storage[w.resource] ?? 0)) { w.status = 'Invalid storage balance — supply route paused'; return; }
  if (!wanted || !room) { w.status = 'Supply target met or storage full'; return; }
  if (!available) { w.status = `Waiting for ${w.resource} in source storage`; return; }
  const time = allowance(w, p, dt);
  if (!time) { returnHome(v, w, 'Needs wallet gold for wages', dt, neighbors, solids); return; }
  const point = plotFront(PLOTS.find(anchor => anchor.id === source.id), 1);
  if (distance(w, point) > .7) {
    const moved = move(w, point, time, neighbors, solids, p, dt);
    w.status = moved ? 'Walking to supply storage' : 'Waiting for a clear supply path';
    return;
  }
  const amount = Math.min(available, wanted, room, Math.floor((workerStats(w, p).carryCapacity + 1e-6) / weight));
  if (!whole(amount) || !amount) return;
  source.storage[w.resource] -= amount; w.cargo[w.resource] = amount; w.delivering = true;
  payForTime(w, p, time); w.status = `Collected ${amount} ${w.resource} for delivery`;
}

function sellCargo(sim, v, w, p) {
  for (const id of WORKER_RESOURCES) {
    if (!w.cargo[id] || !whole(v.stock?.[id]) || !whole(v.treasury) || !whole(p.wallet)) continue;
    let amount = w.cargo[id], quote;
    for (; amount > 0; amount--) {
      if (!whole(v.stock[id] + amount)) continue;
      quote = taxedSaleQuote(id, v.stock[id], amount, v.policies?.tradeTax ?? 5);
      if (v.treasury - quote.total >= TREASURY_RESERVE && whole(p.wallet + quote.total)) break;
    }
    if (amount <= 0) continue;
    w.cargo[id] -= amount; v.stock[id] += amount; v.treasury -= quote.total;
    if (typeof sim.awardIncome === 'function') sim.awardIncome(v, p, quote.total);
    else p.wallet += quote.total;
  }
  w.status = hasCargo(w) ? 'Waiting for treasury funds — cargo kept' : 'Sale complete';
  return !hasCargo(w);
}

export function workersTick(sim, v, dt) {
  if (!Number.isFinite(dt) || dt <= 0 || v.status !== 'active' || !Object.values(v.players ?? {}).some(player => player.online)) return;
  ensureWorkers(v);
  // The server advances in short steps; a delayed caller cannot earn an entire
  // catch-up harvest or jump a worker across the map in one update.
  dt = Math.min(dt, 1);
  const solids = plotSolids(v.plots), neighbors = [...v.workers, ...(v.guards ?? [])];
  for (const w of v.workers) {
    w.anim = 'idle';
    const p = v.players?.[w.ownerId];
    const stats = workerStats(w, p);
    const reason = w.staffRetired ? 'Plot staff inactive — cargo kept' : w.roleLimitPaused ? 'Current role worker limit — cargo and wages kept' : w.paused ? 'Paused' : !p ? 'Owner unavailable' : !(w.staffRole === 'transporter' ? cargoResources : WORKER_ASSIGNMENTS).includes(w.resource) ? 'Choose an assignment' : null;
    if (reason) { returnHome(v, w, reason, dt, neighbors, solids); continue; }
    if (w.staffRole === 'transporter') { transporterTick(v, w, p, dt, neighbors, solids); continue; }
    if (w.mode === 'store' && !destinationPlot(v, w)) { returnHome(v, w, 'Choose a storage building', dt, neighbors, solids); continue; }
    if ((w.sourcePlotId !== null || w.resource === 'mine_all') && !sourcePlot(v, w) && !hasCargo(w)) { returnHome(v, w, 'Choose a resource source', dt, neighbors, solids); continue; }
    const time = allowance(w, p, dt);
    if (!time) { returnHome(v, w, 'Needs wallet gold for wages', dt, neighbors, solids); continue; }
    const nodes = availableNodes(v, w);
    if (!nodes.length && hasCargo(w)) w.delivering = true;
    if (w.delivering && hasCargo(w)) {
      const plot = w.mode === 'store' ? destinationPlot(v, w) : null;
      const target = plot ? plotFront(PLOTS.find(m => m.id === plot.id), 1) : marketFor(v, w);
      w.targetNodeId = null; w.gatherProgress = 0;
      if (plot ? distance(w, target) > .7 : !canUseBuilding(w, market)) {
        const moved = move(w, target, time, neighbors, solids, p, dt);
        w.status = moved ? (plot ? plot.ownerId === w.ownerId ? 'Carrying goods to storage' : 'Delivering donated supplies' : 'Carrying goods to Resource Exchange') : 'Waiting for a clear delivery path';
      } else {
        const complete = plot ? storeCargo(v, w) : sellCargo(sim, v, w, p);
        if (complete) w.delivering = false;
      }
      continue;
    }
    if (w.mode === 'sell' && (!whole(v.treasury) || v.treasury <= TREASURY_RESERVE)) { w.status = 'Waiting for treasury funds'; w.gatherProgress = 0; continue; }
    let chosen = nodes.find(({ node }) => node.id === w.targetNodeId), target = chosen && approach(chosen.node, w, solids);
    if (!target) {
      w.targetNodeId = null; w.gatherProgress = 0;
      if (v.clock < (w.nextSearchAt ?? 0)) { w.status = 'Waiting for resources'; continue; }
      w.nextSearchAt = v.clock + 1;
      for (const candidate of nodes.sort((a, b) => distance(a.node, w) - distance(b.node, w))) {
        const point = approach(candidate.node, w, solids);
        if (point) { chosen = candidate; target = point; w.targetNodeId = candidate.node.id; break; }
      }
    }
    if (!chosen || !target) { w.status = 'Waiting for resources'; continue; }
    // All yield, capacity, regrowth and tool accounting follow the actual node,
    // never the mine_all assignment. Depleting one vein releases the target so
    // the normal bounded search can find another resource in the same plot.
    const resource = chosen.node.type, tool = tools[resource];
    const harvest = productionHarvest(1, w.sourcePlotId === null ? null : sourcePlot(v, w), resource, v.environment, w.environmentYieldRemainders?.[resource] ?? 0);
    const savedRemainder = w.toolYieldRemainders?.[resource], toolRemainder = Number.isFinite(savedRemainder) && savedRemainder >= 0 && savedRemainder < 1 ? savedRemainder : 0;
    const toolTotal = harvest.yield * WORKER_EQUIPMENT[workerTool(w, tool).tier].multiplier + toolRemainder;
    const harvestYield = Math.floor(toolTotal + 1e-9);
    const harvestWeight = RESOURCE_WEIGHTS[resource] * harvestYield;
    if (inventoryWeight(w.cargo) + harvestWeight > stats.carryCapacity) { w.delivering = true; w.gatherProgress = 0; continue; }
    if (w.mode === 'store') {
      const plot = destinationPlot(v, w);
      if (inventoryWeight(plot.storage) + harvestWeight > plotStorageCapacity(plot)) { w.status = 'Storage full — work paused'; w.gatherProgress = 0; continue; }
    }
    if (distance(w, target) > .65 || distance(w, chosen.node) > 3.3 || !openSegment(w, chosen.node, [...SOLIDS, ...solids])) {
      w.gatherProgress = 0;
      const moved = move(w, target, time, neighbors, solids, p, dt);
      w.status = moved ? `Walking to ${resource}` : 'Waiting for a clear gathering path';
      continue;
    }
    if (w.gatherProgress + time + 1e-7 < stats.gatherSeconds) {
      payForTime(w, p, time); w.gatherProgress += time; w.status = `Gathering ${resource}`; w.anim = 'gather';
      w.yaw = Math.atan2(chosen.node.x - w.x, chosen.node.z - w.z);
      continue;
    }
    // Check again at completion: another worker or player may have exhausted
    // this node. Replacement never spends savings on an unsuccessful harvest.
    if (!chosen.state.available || chosen.state.remaining <= 0) { w.gatherProgress = 0; continue; }
    const item = w.equipment[tool], price = WORKER_EQUIPMENT[item?.tier]?.purchaseGold;
    const account = w.autoReplaceEnabled && item?.durability <= 1 ? sim.store?.account(p.id) : null;
    const replacing = !!price && whole(account?.bank) && account.bank >= price;
    const replacingBefore = replacing && item.durability === 0;
    const completedTotal = replacingBefore ? harvest.yield * WORKER_EQUIPMENT[item.tier].multiplier + toolRemainder : toolTotal;
    const completedYield = Math.floor(completedTotal + 1e-9), completedWeight = RESOURCE_WEIGHTS[resource] * completedYield;
    if (inventoryWeight(w.cargo) + completedWeight > stats.carryCapacity) { w.delivering = true; w.gatherProgress = 0; continue; }
    if (w.mode === 'store' && inventoryWeight(destinationPlot(v, w).storage) + completedWeight > plotStorageCapacity(destinationPlot(v, w))) {
      w.status = 'Storage full — work paused'; w.gatherProgress = 0; continue;
    }
    const finishHarvest = () => {
      const replace = () => { sim.store.bank(p.id, -price); w.equipment[tool] = purchasedEquipment(item.tier); };
      if (replacingBefore) replace();
      payForTime(w, p, time); w.gatherProgress = 0; w.status = `Gathering ${resource}`; w.anim = 'gather';
      w.yaw = Math.atan2(chosen.node.x - w.x, chosen.node.z - w.z);
      w.cargo[resource] += completedYield; chosen.state.remaining--;
      w.environmentYieldRemainders ??= {}; w.environmentYieldRemainders[resource] = harvest.remainder;
      w.toolYieldRemainders ??= {}; w.toolYieldRemainders[resource] = Math.max(0, completedTotal - completedYield);
      if (w.equipment[tool]?.durability > 0) w.equipment[tool].durability--;
      if (replacing && !replacingBefore) replace();
      w.workXp = Math.min(WORKER_MAX_XP, w.workXp + 1); ensureWorkerProgress(w);
      if (chosen.state.remaining <= 0) {
        chosen.state.available = false;
        chosen.state.regrowAt = v.clock + productionRegrowSeconds(resource, w.sourcePlotId === null ? null : sourcePlot(v, w), v.environment);
        w.targetNodeId = null;
      }
    };
    if (!replacing) { finishHarvest(); continue; }
    const checkpoint = structuredClone(v);
    try { sim.store.transaction(() => { finishHarvest(); sim.store.saveVillage(v); }); }
    catch (error) { restoreWorkerState(v, checkpoint); throw error; }

  }
}

export function workersSnapshot(v, viewerId) {
  ensureWorkers(v);
  return { workers: v.workers.map(w => ({
    id: w.id, name: w.name, ownerId: w.ownerId, x: w.x, z: w.z, yaw: w.yaw,
    hp: 100, maxHp: 100, role: 'villager', tool: tools[w.resource] ?? '', anim: w.anim, color: w.color,
    backpackTier: 1, tiers: Object.fromEntries(['axe', 'pickaxe', 'scythe'].map(tool => [tool, workerTool(w, tool).tier])),
    ...(viewerId === w.ownerId ? { resource: w.resource, sourcePlotId: w.sourcePlotId,
      staffPlotId: w.staffPlotId ?? null, staffSlot: w.staffSlot ?? null, staffRole: w.staffRole ?? null, staffRetired: !!w.staffRetired, targetPercent: w.targetPercent ?? 50,
      mode: w.mode, destinationPlotId: w.destinationPlotId, destinationOwnerId: w.destinationOwnerId, status: w.status,
      paused: w.paused, cargo: { ...w.cargo }, paidWorkSeconds: w.paidWorkSeconds,
      roleLimitPaused: w.roleLimitPaused, employment: workerEmployment(v.players?.[w.ownerId]),
      equipment: structuredClone(w.equipment), autoReplaceEnabled: w.autoReplaceEnabled,
      level: w.level, workXp: w.workXp, upgradePoints: w.upgradePoints, attributes: { ...w.attributes } } : {})
  })) };
}
