import { buildingEntrance, canUseBuilding } from '../shared/access.js';
import { randomUUID } from 'node:crypto';
import { BUILDINGS, PLOTS, RESOURCES, SOLIDS, canStand, plotFront, plotSolids, resolveResource } from '../shared/world.js';
import { RESOURCE_WEIGHTS, inventoryWeight, carryCapacity } from '../shared/content.js';
import { TREASURY_RESERVE } from '../shared/market.js';
import { taxedSaleQuote } from '../shared/economy.js';
import { WORKER_RULES as RULES, WORKER_RESOURCES, WORKER_ATTRIBUTES, WORKER_COLORS, WORKER_MAX_XP, workerStats } from '../shared/workers.js';
import { plotStorageCapacity, productionRegrowSeconds } from '../shared/production.js';
import { stepNpcNavigation } from './navigation.js';

const kinds = new Set(['worker_hire', 'worker_assign', 'worker_pause', 'worker_collect', 'worker_dismiss', 'worker_upgrade', 'worker_color']);
const tools = { wheat: 'scythe', timber: 'axe', stone: 'pickaxe', iron: 'pickaxe', coal: 'pickaxe' };
const production = { wheat: 'wheat_farm', timber: 'tree_farm', stone: 'mine', iron: 'mine', coal: 'mine' };
const publicNodes = new Map(RESOURCES.map(node => [node.id, node]));
const bank = BUILDINGS.find(building => building.id === 'bank');
const market = BUILDINGS.find(building => building.id === 'market');
const marketDoor = buildingEntrance(market);
const home = plotFront(bank, -1.3);
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const whole = value => Number.isSafeInteger(value) && value >= 0;
const hasCargo = worker => WORKER_RESOURCES.some(id => worker.cargo[id] > 0);
const nearBank = p => Math.hypot(Math.max(0, Math.abs(p.x - bank.x) - bank.w / 2), Math.max(0, Math.abs(p.z - bank.z) - bank.d / 2)) <= 3.5;
const requireBank = p => { if (!canUseBuilding(p, bank)) throw new Error('Visit the Village Treasury to hire or dismiss workers.'); };
const homeFor = (v, w) => {
  const slot = Math.max(0, v.workers.indexOf(w));
  return { x: home.x + slot % 2 * 1.2, z: bank.z + (Math.floor(slot / 2) - 3.5) * 1.2 };
};
const marketFor = (v, w) => {
  // Four short queue rows fit wholly in front of the counter. Sales still
  // require its actual entrance range; no side/rear unloading is possible.
  const slot = Math.max(0, v.workers.indexOf(w)) % 16;
  return { x: marketDoor.x - Math.floor(slot / 4) * .6, z: marketDoor.z + (slot % 4 - 1.5) * .9 };
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
  for (const w of v.workers) {
    ensureWorkerProgress(w);
    w.cargo ??= {};
    for (const id of WORKER_RESOURCES) if (!whole(w.cargo[id])) w.cargo[id] = 0;
    w.name ??= `${v.players?.[w.ownerId]?.name ?? 'Village'}'s worker`;
    if (!Number.isFinite(w.x) || !Number.isFinite(w.z)) { w.x = home.x; w.z = home.z; }
    if (!Number.isFinite(w.yaw)) w.yaw = Math.PI / 2;
    if (!Number.isFinite(w.paidWorkSeconds) || w.paidWorkSeconds < 0) w.paidWorkSeconds = 0;
    w.paidWorkSeconds = Math.min(RULES.wageSeconds, w.paidWorkSeconds);
    if (!Number.isFinite(w.gatherProgress) || w.gatherProgress < 0) w.gatherProgress = 0;
    w.gatherProgress = Math.min(workerStats(w).gatherSeconds, w.gatherProgress);
    if (typeof w.paused !== 'boolean') w.paused = true;
    w.sourcePlotId ??= null; w.destinationPlotId ??= null;
    w.resource ??= null; w.mode ??= 'sell';
    w.anim ??= 'idle'; w.status ??= 'Choose an assignment'; w.hp = w.maxHp = 100;
  }
}

function ownedWorker(v, p, id) {
  const worker = typeof id === 'string' && v.workers.find(w => w.id === id);
  if (!worker || worker.ownerId !== p.id) throw new Error('Choose one of your own workers.');
  return worker;
}

function sourcePlot(v, w) {
  return v.plots?.find(p => p.id === w.sourcePlotId && p.ownerId === w.ownerId && p.hp > 0 && p.building === production[w.resource]);
}

function destinationPlot(v, w) {
  return v.plots?.find(p => p.id === w.destinationPlotId && p.ownerId === w.ownerId && p.hp > 0 && p.building && PLOTS.some(m => m.id === p.id));
}

export function workersAction(sim, v, p, action) {
  if (!kinds.has(action.kind)) return null;
  ensureWorkers(v);
  if (action.kind === 'worker_hire') {
    requireBank(p);
    const owned = v.workers.filter(w => w.ownerId === p.id);
    if (owned.length >= RULES.maxPerPlayer) throw new Error(`You may hire at most ${RULES.maxPerPlayer} workers.`);
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
    if (!WORKER_RESOURCES.includes(action.resource)) throw new Error('Choose wheat, timber, stone, iron or coal.');
    if (action.sourcePlotId !== null && typeof action.sourcePlotId !== 'string') throw new Error('Choose public resources or one of your production plots.');
    if (!['store', 'sell'].includes(action.mode)) throw new Error('Choose whether to store or sell the resources.');
    const order = { ownerId: p.id, resource: action.resource, sourcePlotId: action.sourcePlotId, destinationPlotId: action.destinationPlotId };
    if (action.sourcePlotId !== null && !sourcePlot(v, order)) throw new Error('Choose a living production building you own that supplies this resource.');
    if (action.mode === 'store' && (typeof action.destinationPlotId !== 'string' || !destinationPlot(v, order))) throw new Error('Choose one of your living buildings for storage.');
    if (action.mode === 'sell' && action.destinationPlotId !== null) throw new Error('Resource Exchange sales do not need a storage building.');
    Object.assign(w, { resource: action.resource, sourcePlotId: action.sourcePlotId, mode: action.mode, destinationPlotId: action.mode === 'store' ? action.destinationPlotId : null,
      paused: false, status: 'Starting work', targetNodeId: null, gatherProgress: 0, delivering: hasCargo(w), nextSearchAt: 0 });
    return 'Worker assigned. Work continues day and night while you are online.';
  }
  if (action.kind === 'worker_pause') {
    if (typeof action.paused !== 'boolean') throw new Error('Choose whether to pause your worker.');
    w.paused = action.paused; w.gatherProgress = 0; w.targetNodeId = null;
    w.status = w.paused ? 'Returning to treasury — paused' : 'Starting work';
    return w.paused ? 'Worker paused and returning to the treasury with their cargo.' : 'Worker will resume the saved assignment, day or night.';
  }
  if (action.kind === 'worker_collect') {
    if (distance(p, w) > 3.3) throw new Error('Move closer to your worker to collect their cargo.');
    if (!hasCargo(w)) throw new Error('This worker has no cargo to collect.');
    let room = Math.max(0, carryCapacity(p) - inventoryWeight(p)), count = 0;
    const transfers = [];
    for (const id of WORKER_RESOURCES) {
      const amount = Math.min(w.cargo[id], Math.floor((room + 1e-6) / RESOURCE_WEIGHTS[id]));
      if (!amount) continue;
      if (!whole(p.inventory[id] ?? 0) || !whole((p.inventory[id] ?? 0) + amount)) throw new Error('Your pack cannot accept this cargo.');
      transfers.push([id, amount]); room -= amount * RESOURCE_WEIGHTS[id]; count += amount;
    }
    if (!count) throw new Error('Your pack is full. Store or sell some goods first.');
    for (const [id, amount] of transfers) { p.inventory[id] = (p.inventory[id] ?? 0) + amount; w.cargo[id] -= amount; }
    if (!hasCargo(w)) w.delivering = false;
    return `Collected ${count} resources from your worker${hasCargo(w) ? '. The remaining cargo stays with them' : ''}.`;
  }
  requireBank(p);
  if (!nearBank(w)) throw new Error('Pause this worker and wait for them to return to the treasury before dismissal.');
  if (hasCargo(w)) throw new Error('Collect or deliver this worker\'s cargo before dismissal.');
  v.workers = v.workers.filter(worker => worker !== w);
  return 'Worker dismissed. Hiring fees and unused prepaid wages are not refunded.';
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
  if (w.sourcePlotId !== null) return sourcePlot(v, w) ? (v.plotResources ?? []).filter(node => node.plotId === w.sourcePlotId && node.type === w.resource && node.available && node.remaining > 0).map(node => ({ node, state: node })) : [];
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
  return whole(p.wallet) && p.wallet >= RULES.wageGold ? Math.min(dt, RULES.wageSeconds) : 0;
}

function payForTime(w, p, dt) {
  if (dt <= 0) return;
  if (w.paidWorkSeconds <= 1e-7) { p.wallet -= RULES.wageGold; w.paidWorkSeconds = RULES.wageSeconds; }
  w.paidWorkSeconds = Math.max(0, w.paidWorkSeconds - dt);
}

function move(w, target, dt, neighbors, solids, p = null) {
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
  const speed = workerStats(w).speed;
  stepNpcNavigation(w, destination, speed, dt, neighbors, solids);
  const moved = distance(before, w);
  if (p && moved > .001) payForTime(w, p, Math.min(dt, moved / speed));
  return moved > .001;
}

function returnHome(v, w, reason, dt, neighbors, solids) {
  w.gatherProgress = 0; w.targetNodeId = null;
  const target = homeFor(v, w);
  if (distance(w, target) > .7) {
    move(w, target, dt, neighbors, solids); w.status = `Returning to treasury — ${reason.toLowerCase()}`;
  } else { w.anim = 'idle'; w.status = reason; }
}

function storeCargo(v, w) {
  const plot = destinationPlot(v, w);
  if (!plot) return false;
  let room = Math.max(0, plotStorageCapacity(plot) - inventoryWeight(plot.storage));
  for (const id of WORKER_RESOURCES) {
    const amount = Math.min(w.cargo[id], Math.floor((room + 1e-6) / RESOURCE_WEIGHTS[id]));
    if (amount > 0 && whole(plot.storage[id] ?? 0) && whole((plot.storage[id] ?? 0) + amount)) {
      plot.storage[id] = (plot.storage[id] ?? 0) + amount; w.cargo[id] -= amount; room -= amount * RESOURCE_WEIGHTS[id];
    }
  }
  w.status = hasCargo(w) ? 'Storage full — cargo kept' : 'Delivery complete';
  return !hasCargo(w);
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
  if (!Number.isFinite(dt) || dt <= 0 || v.status !== 'active') return;
  ensureWorkers(v);
  // The server advances in short steps; a delayed caller cannot earn an entire
  // offline harvest or jump a worker across the map in one update.
  dt = Math.min(dt, 1);
  const solids = plotSolids(v.plots), neighbors = [...v.workers, ...(v.guards ?? [])];
  for (const w of v.workers) {
    w.anim = 'idle';
    const p = v.players?.[w.ownerId];
    const stats = workerStats(w);
    const reason = w.paused ? 'Paused' : !p?.online ? 'Owner offline' : !WORKER_RESOURCES.includes(w.resource) ? 'Choose an assignment' : null;
    if (reason) { returnHome(v, w, reason, dt, neighbors, solids); continue; }
    if (w.mode === 'store' && !destinationPlot(v, w)) { returnHome(v, w, 'Choose a storage building', dt, neighbors, solids); continue; }
    if (w.sourcePlotId !== null && !sourcePlot(v, w) && !hasCargo(w)) { returnHome(v, w, 'Choose a resource source', dt, neighbors, solids); continue; }
    const time = allowance(w, p, dt);
    if (!time) { returnHome(v, w, 'Needs wallet gold for wages', dt, neighbors, solids); continue; }
    const resourceWeight = RESOURCE_WEIGHTS[w.resource];
    if (inventoryWeight(w.cargo) + resourceWeight > stats.carryCapacity) w.delivering = true;
    const nodes = availableNodes(v, w);
    if (!nodes.length && hasCargo(w)) w.delivering = true;
    if (w.delivering && hasCargo(w)) {
      const plot = w.mode === 'store' ? destinationPlot(v, w) : null;
      const target = plot ? plotFront(PLOTS.find(m => m.id === plot.id), 1) : marketFor(v, w);
      w.targetNodeId = null; w.gatherProgress = 0;
      if (plot ? distance(w, target) > .7 : !canUseBuilding(w, market)) {
        const moved = move(w, target, time, neighbors, solids, p);
        w.status = moved ? (plot ? 'Carrying goods to storage' : 'Carrying goods to Resource Exchange') : 'Waiting for a clear delivery path';
      } else {
        const complete = plot ? storeCargo(v, w) : sellCargo(sim, v, w, p);
        if (complete) w.delivering = false;
      }
      continue;
    }
    if (w.mode === 'store') {
      const plot = destinationPlot(v, w);
      if (inventoryWeight(plot.storage) + resourceWeight > plotStorageCapacity(plot)) { w.status = 'Storage full — work paused'; w.gatherProgress = 0; continue; }
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
    if (distance(w, target) > .65 || distance(w, chosen.node) > 3.3 || !openSegment(w, chosen.node, [...SOLIDS, ...solids])) {
      w.gatherProgress = 0;
      const moved = move(w, target, time, neighbors, solids, p);
      w.status = moved ? `Walking to ${w.resource}` : 'Waiting for a clear gathering path';
      continue;
    }
    payForTime(w, p, time); w.gatherProgress += time; w.status = `Gathering ${w.resource}`; w.anim = 'gather';
    w.yaw = Math.atan2(chosen.node.x - w.x, chosen.node.z - w.z);
    if (w.gatherProgress + 1e-7 < stats.gatherSeconds) continue;
    w.gatherProgress = 0;
    // Re-read the shared node at the moment of harvest: another worker or a
    // player may have exhausted it earlier in this same simulation step.
    if (!chosen.state.available || chosen.state.remaining <= 0) continue;
    w.cargo[w.resource]++; chosen.state.remaining--;
    w.workXp = Math.min(WORKER_MAX_XP, w.workXp + 1); ensureWorkerProgress(w);
    if (chosen.state.remaining <= 0) {
      chosen.state.available = false;
      chosen.state.regrowAt = v.clock + productionRegrowSeconds(w.resource, w.sourcePlotId === null ? null : sourcePlot(v, w));
      w.targetNodeId = null;
    }
  }
}

export function workersSnapshot(v, viewerId) {
  ensureWorkers(v);
  return { workers: v.workers.map(w => ({
    id: w.id, name: w.name, ownerId: w.ownerId, x: w.x, z: w.z, yaw: w.yaw,
    hp: 100, maxHp: 100, role: 'villager', tool: tools[w.resource] ?? '', anim: w.anim, color: w.color,
    backpackTier: 1, tiers: { axe: 'wood', pickaxe: 'wood', scythe: 'wood' },
    ...(viewerId === w.ownerId ? { resource: w.resource, sourcePlotId: w.sourcePlotId,
      mode: w.mode, destinationPlotId: w.destinationPlotId, status: w.status,
      paused: w.paused, cargo: { ...w.cargo }, paidWorkSeconds: w.paidWorkSeconds,
      level: w.level, workXp: w.workXp, upgradePoints: w.upgradePoints, attributes: { ...w.attributes } } : {})
  })) };
}
