import { PLOTS, RESOURCES } from '../shared/world.js';
import { BUILDING_TYPES, RECIPES, TOOL_TIERS, TOOL_WEIGHTS, RESOURCE_WEIGHTS, PLOT_PRICES, MAX_PLOTS, CARRY_CAPACITY, STORAGE_CAPACITY, inventoryWeight } from '../shared/content.js';
import { chargePurchase } from './transport.js';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const kinds = new Set(['plot_buy', 'plot_build', 'plot_demolish', 'plot_access', 'plot_deposit', 'plot_withdraw', 'craft_buy', 'role_change', 'gather']);
const resourceTool = { timber: 'axe', stone: 'pickaxe', iron: 'pickaxe', coal: 'pickaxe', wheat: 'scythe' };
const yieldRemainder = (plot, type) => Number.isInteger(plot.splitRemainders?.[type]) ? plot.splitRemainders[type] : 0;
const maxHarvests = type => type === 'wheat' ? 1 : type === 'timber' ? 5 : 8;
const gatherDelay = (type, privatePlot) => (type === 'wheat' ? 90 : 150) * (privatePlot ? .65 : 1);
const metadata = id => PLOTS.find(plot => plot.id === id);
const checkNear = (player, plot) => {
  const m = metadata(plot.id);
  if (!m || Math.hypot(Math.max(0, Math.abs(player.x - m.x) - m.w / 2), Math.max(0, Math.abs(player.z - m.z) - m.d / 2)) > 4) throw new Error('Visit this plot to use it.');
};
const checkOwner = (plot, player) => { if (plot.ownerId !== player.id) throw new Error('Only the plot owner can do that.'); };
const checkEmpty = plot => {
  if (Object.values(plot.storage).some(amount => amount > 0)) throw new Error('Withdraw the stored goods before removing this building.');
  if (plot.patients?.length) throw new Error('Wait until every church patient has left before removing this building.');
};
const checkCapacity = (player, id, count) => {
  if (inventoryWeight(player) + (RESOURCE_WEIGHTS[id] ?? 1) * count > CARRY_CAPACITY + 1e-6) throw new Error('Your pack is full. Store goods on a plot or in a cart.');
};
const award = (sim, village, player, gold) => {
  if (typeof sim.awardIncome === 'function') sim.awardIncome(village, player, gold);
  else player.wallet += gold;
};

function plotNodes(plot) {
  const m = metadata(plot.id);
  if (!m || !['wheat_farm', 'tree_farm', 'mine'].includes(plot.building)) return [];
  const yaw = m.yaw ?? (m.x < 0 ? Math.PI / 2 : -Math.PI / 2);
  const localToWorld = (x, z) => ({ x: m.x + x * Math.cos(yaw) + z * Math.sin(yaw), z: m.z - x * Math.sin(yaw) + z * Math.cos(yaw) });
  const points = [];
  if (plot.building === 'wheat_farm') {
    for (let row = 0; row < 4; row++) for (let column = 0; column < 6; column++) points.push({ type: 'wheat', x: (column - 2.5) * 1.2, z: (row - 1.5) * 1.5 });
  } else if (plot.building === 'tree_farm') {
    for (let row = 0; row < 2; row++) for (let column = 0; column < 3; column++) points.push({ type: 'timber', x: (column - 1) * 2.7, z: (row - .5) * 4 });
  } else {
    for (let i = 0; i < 6; i++) points.push({ type: i < 3 ? 'stone' : i < 5 ? 'iron' : 'coal', x: (i % 3 - 1) * 2.6, z: 1 + Math.floor(i / 3) * 2.2 });
  }
  return points.map((point, i) => ({ id: `plot:${plot.id}:${i}`, type: point.type, ...localToWorld(point.x, point.z), plotId: plot.id, available: true, remaining: maxHarvests(point.type), regrowAt: 0, seed: i * 491 + 37 }));
}

export function ensureOwnership(village) {
  const existing = new Map((village.plots ?? []).map(plot => [plot.id, plot]));
  village.plots = PLOTS.map(m => {
    const plot = existing.get(m.id) ?? { id: m.id, ownerId: null, building: null, level: 1, hp: 0, maxHp: 0 };
    plot.storage ??= {}; plot.allowVisitors ??= true; plot.splitRemainders ??= {};
    return plot;
  });
  village.plotResources ??= [];
  const activeIds = new Set(village.plots.filter(plot => plot.ownerId && ['mine', 'tree_farm', 'wheat_farm'].includes(plot.building)).map(plot => plot.id));
  village.plotResources = village.plotResources.filter(node => activeIds.has(node.plotId));
  const present = new Set(village.plotResources.map(node => node.plotId));
  for (const plot of village.plots) if (activeIds.has(plot.id) && !present.has(plot.id)) village.plotResources.push(...plotNodes(plot));
  for (const player of Object.values(village.players ?? {})) {
    player.tiers ??= {};
    for (const tool of Object.keys(TOOL_WEIGHTS)) if (tool !== 'bow' && !own(player.tiers, tool)) player.tiers[tool] = 'wood';
    player.inventory ??= {};
    for (const id of Object.keys(RESOURCE_WEIGHTS)) player.inventory[id] ??= 0;
  }
  village.resources ??= [];
  const known = new Set(village.resources.map(node => node.id));
  for (const node of RESOURCES) if (!known.has(node.id)) village.resources.push({ id: node.id, available: true, remaining: maxHarvests(node.type), regrowAt: 0 });
}

function removeBuilding(village, plot) {
  village.guards = village.guards.filter(guard => guard.plotId !== plot.id && guard.barracksId !== plot.id);
  village.plotResources = village.plotResources.filter(node => node.plotId !== plot.id);
  Object.assign(plot, { building: null, hp: 0, maxHp: 0, level: 1, patients: [], splitRemainders: {} });
}

export function ownershipAction(sim, village, player, action) {
  if (!kinds.has(action.kind)) return null;
  ensureOwnership(village);
  if (action.kind === 'gather') {
    const privateNode = village.plotResources.find(node => node.id === action.targetId);
    const node = privateNode ?? RESOURCES.find(node => node.id === action.targetId);
    const state = privateNode ?? village.resources.find(node => node.id === action.targetId);
    if (!node || !state || !state.available) throw new Error('That resource is regrowing.');
    if (distance(player, node) > 3.3) throw new Error('Move closer to gather.');
    const tool = resourceTool[node.type];
    if (player.tool !== tool) throw new Error(`Equip your ${tool} first.`);
    if (!(player.durability[tool] > 0)) throw new Error('Your tool has broken. Buy a replacement.');
    const plot = privateNode ? village.plots.find(p => p.id === privateNode.plotId) : null;
    if (plot && (plot.hp <= 0 || !plot.ownerId)) throw new Error('Repair this production plot before harvesting.');
    if (plot && plot.ownerId !== player.id && !plot.allowVisitors) throw new Error('This owner has closed the plot to visitors.');
    const tier = TOOL_TIERS[player.tiers[tool]] ?? TOOL_TIERS.wood;
    let ownerYield = 0, nextRemainder = 0;
    if (plot && plot.ownerId !== player.id) {
      const numerator = tier.yield + yieldRemainder(plot, node.type);
      ownerYield = Math.floor(numerator / 5); nextRemainder = numerator % 5;
      if (inventoryWeight(plot.storage) + ownerYield * RESOURCE_WEIGHTS[node.type] > STORAGE_CAPACITY) throw new Error('The owner needs to make room in plot storage.');
    }
    const received = tier.yield - ownerYield;
    checkCapacity(player, node.type, received);
    // Commit all three ledgers together only after permissions and both capacities pass.
    player.inventory[node.type] += received;
    if (plot && plot.ownerId !== player.id) {
      plot.storage[node.type] = (plot.storage[node.type] ?? 0) + ownerYield;
      plot.splitRemainders[node.type] = nextRemainder;
    }
    player.durability[tool]--; state.remaining--;
    if (state.remaining <= 0) { state.available = false; state.regrowAt = village.clock + gatherDelay(node.type, !!plot); }
    player.anim = 'gather'; player.animationUntil = village.clock + .5;
    return `+${received} ${node.type}${ownerYield ? ` · ${ownerYield} to the plot owner` : ''}`;
  }
  if (action.kind === 'role_change') {
    if (!['guard', 'priest', 'villager'].includes(action.role)) throw new Error('Choose guard, priest or villager.');
    if (player.role === action.role) throw new Error('That is already your job.');
    const losing = village.plots.filter(plot => plot.ownerId === player.id && BUILDING_TYPES[plot.building]?.role && BUILDING_TYPES[plot.building].role !== action.role);
    if (losing.length && action.confirm !== true) throw new Error(`Confirm this job change: ${losing.length} role buildings will be removed without a refund.`);
    for (const plot of losing) checkEmpty(plot);
    for (const plot of losing) removeBuilding(village, plot);
    // Accrued pay remains a separate dawn ledger; changing jobs never pays or resets it.
    player.role = action.role; player.healing = null;
    if (player.tool === 'heal') player.tool = 'sword';
    return `You are now a ${action.role}. Your land and universal buildings are retained.`;
  }
  const plot = village.plots.find(p => p.id === action.plotId);
  if (!plot) throw new Error('Choose an available village plot.');
  checkNear(player, plot);
  if (action.kind === 'plot_buy') {
    if (plot.ownerId) throw new Error('This plot already belongs to another resident.');
    const count = village.plots.filter(p => p.ownerId === player.id).length;
    if (count >= MAX_PLOTS) throw new Error('You may own at most five plots.');
    chargePurchase(sim, village, player, PLOT_PRICES[count], { credit: true });
    village.treasury += PLOT_PRICES[count];
    plot.ownerId = player.id; plot.purchasedDay = village.day;
    return `Plot purchased for ${PLOT_PRICES[count]} gold. Deposit construction materials here to build.`;
  }
  if (action.kind === 'craft_buy') {
    const recipe = own(RECIPES, action.recipe) ? RECIPES[action.recipe] : null;
    if (!recipe || plot.building !== recipe.shop || !plot.ownerId || plot.hp <= 0) throw new Error('This shop cannot craft that item.');
    const owner = village.players[plot.ownerId];
    if (!owner) throw new Error('The shop has no owner.');
    for (const [id, quantity] of Object.entries(recipe.cost)) if ((plot.storage[id] ?? 0) < quantity) throw new Error(`The shop needs more ${id} to craft this item.`);
    const addedWeight = recipe.tool ? (player.durability[recipe.tool] > 0 ? 0 : TOOL_WEIGHTS[recipe.tool]) : (RESOURCE_WEIGHTS[recipe.item] ?? 1) * recipe.amount;
    if (inventoryWeight(player) + addedWeight > CARRY_CAPACITY + 1e-6) throw new Error('Your pack is full.');
    if (recipe.tool && player.durability[recipe.tool] > 0 && action.confirm !== true) throw new Error('Confirm replacing your current tool or weapon; its remaining durability will be lost.');
    const taxRate = Math.max(0, Math.min(100, village.policies?.tradeTax ?? 5));
    const tax = Math.floor(recipe.price * taxRate / 100);
    if (!Number.isSafeInteger(owner.wallet) || !Number.isSafeInteger(owner.wallet + recipe.price - tax)) throw new Error('The shop owner cannot accept more gold.');
    // Restricted loans cannot be cashed out through one's own shop.
    chargePurchase(sim, village, player, recipe.price, { credit: owner.id !== player.id });
    for (const [id, quantity] of Object.entries(recipe.cost)) plot.storage[id] -= quantity;
    village.treasury += tax;
    if (owner.id === player.id) {
      // An owner crafting in their own shop recovers their existing payment.
      // This is not income and must not repay debt or inflate the steward ledger.
      owner.wallet += recipe.price - tax;
    } else {
      award(sim, village, owner, recipe.price - tax);
      owner.cycleServiceIncome = (owner.cycleServiceIncome ?? 0) + recipe.price - tax;
    }
    if (recipe.tool) { player.tiers[recipe.tool] = recipe.tier; player.durability[recipe.tool] = TOOL_TIERS[recipe.tier].durability; }
    else player.inventory[recipe.item] = (player.inventory[recipe.item] ?? 0) + recipe.amount;
    return `${recipe.name} purchased for ${recipe.price} gold; ${tax} gold paid to the treasury.`;
  }
  if (action.kind === 'plot_deposit' || action.kind === 'plot_withdraw') {
    if (!plot.ownerId) throw new Error('Buy this plot before storing goods.');
    if (!own(RESOURCE_WEIGHTS, action.resource)) throw new Error('Choose a resource or supply from your pack.');
    if (!Number.isSafeInteger(action.amount) || action.amount < 1 || action.amount > 10000) throw new Error('Choose a positive whole item amount.');
    const withdrawing = action.kind === 'plot_withdraw', id = action.resource, amount = action.amount;
    if (withdrawing) checkOwner(plot, player);
    const source = withdrawing ? plot.storage : player.inventory, destination = withdrawing ? player.inventory : plot.storage;
    if ((source[id] ?? 0) < amount) throw new Error(`There is not enough ${id} to transfer.`);
    if (withdrawing) checkCapacity(player, id, amount);
    else if (inventoryWeight(plot.storage) + RESOURCE_WEIGHTS[id] * amount > STORAGE_CAPACITY) throw new Error('This plot storage is full.');
    source[id] -= amount; destination[id] = (destination[id] ?? 0) + amount;
    return `${withdrawing ? 'Withdrew' : 'Stored'} ${amount} ${id}.`;
  }
  checkOwner(plot, player);
  if (action.kind === 'plot_access') {
    if (typeof action.allowVisitors !== 'boolean') throw new Error('Choose whether visitors may harvest.');
    plot.allowVisitors = action.allowVisitors;
    return plot.allowVisitors ? 'Visitors may harvest: you receive 20% of their output.' : 'Only you may harvest this plot.';
  }
  if (action.kind === 'plot_demolish') {
    if (!plot.building) throw new Error('This plot is already empty.');
    if (action.confirm !== true) throw new Error('Confirm demolition. The building is removed without a refund.');
    checkEmpty(plot); removeBuilding(village, plot);
    return 'Building removed. Your plot is ready for a new structure.';
  }
  const type = own(BUILDING_TYPES, action.building) ? BUILDING_TYPES[action.building] : null;
  if (!type) throw new Error('Choose a valid building.');
  if (type.role && type.role !== player.role) throw new Error(`Only a ${type.role} can build a ${type.name.toLowerCase()}.`);
  if (type.limit && village.plots.filter(p => p.ownerId === player.id && p.building === action.building && p.id !== plot.id).length >= type.limit) throw new Error(`You may own at most ${type.limit} ${type.name.toLowerCase()} buildings.`);
  if (plot.building) {
    if (action.confirm !== true) throw new Error('Confirm replacing this building. It will be removed without a refund.');
    checkEmpty(plot);
  }
  const deductions = [];
  for (const [id, quantity] of Object.entries(type.cost)) if (id !== 'gold') {
    const stored = Math.min(quantity, plot.storage[id] ?? 0), carried = quantity - stored;
    if ((player.inventory[id] ?? 0) < carried) throw new Error(`Construction needs ${quantity} ${id} in this plot's storage or your pack.`);
    deductions.push({ id, stored, carried });
  }
  chargePurchase(sim, village, player, type.cost.gold, { credit: true });
  if (plot.building) removeBuilding(village, plot);
  for (const { id, stored, carried } of deductions) { plot.storage[id] = (plot.storage[id] ?? 0) - stored; player.inventory[id] -= carried; }
  village.treasury += type.cost.gold;
  Object.assign(plot, { building: action.building, hp: type.maxHp, maxHp: type.maxHp, level: 1 });
  village.plotResources.push(...plotNodes(plot));
  return `${type.name} constructed. ${['mine', 'wheat_farm', 'tree_farm'].includes(action.building) ? 'Your private resources are ready to harvest.' : 'Open this plot to use its services.'}`;
}

export function ownershipTick(sim, village, dt) {
  ensureOwnership(village);
  for (const node of village.plotResources) if (!node.available && village.clock >= node.regrowAt) {
    node.available = true; node.remaining = maxHarvests(node.type); node.regrowAt = 0;
  }
}

export function ownershipSnapshot(village, viewerId) {
  ensureOwnership(village);
  return {
    plots: village.plots.map(plot => ({ ...metadata(plot.id), ...plot, ownerName: village.players[plot.ownerId]?.name ?? null })),
    plotResources: village.plotResources.map(({ id, type, x, z, plotId, available, remaining, seed }) => ({ id, type, x, z, plotId, available, remaining, seed })),
    carryCapacity: CARRY_CAPACITY, carryWeight: inventoryWeight(village.players[viewerId] ?? {})
  };
}
