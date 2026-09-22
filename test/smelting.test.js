import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUILDINGS, PLOTS } from '../shared/world.js';
import { buildingEntrance, plotEntrance } from '../shared/access.js';
import { BUILDING_TYPES, RECIPES, TOOL_TIERS, RESOURCE_WEIGHTS, inventoryWeight } from '../shared/content.js';
import { ROLE_STATS } from '../shared/roles.js';
import { craftingCost } from '../shared/skills.js';
import { SMELTING_BATCH_LIMIT, SMELTING_RECIPES, smeltingJob } from '../shared/smelting.js';
import { RESOURCE_MARKET, purchaseQuote, saleQuote, saleUnitPrice } from '../shared/market.js';
import { MERCHANT_EXPORT_PRICES, taxedSaleQuote, taxedPurchaseQuote } from '../shared/economy.js';
import { ownershipAction, ownershipSnapshot, ownershipTick, ensureOwnership } from '../server/ownership.js';
import { economyAction, economyDawn, ensureEconomy } from '../server/economy.js';
import { Store } from '../server/store.js';
import { Simulation } from '../server/simulation.js';
import { createEnemy } from '../server/enemies.js';

function fixture(role = 'villager') {
  const owner = { id: 'owner', name: 'Owner', role, online: true, wallet: 10000, inventory: {}, durability: {}, x: 0, z: 0 };
  const visitor = { ...owner, id: 'visitor', name: 'Visitor', inventory: {}, durability: {} };
  const v = { id: 'smelt-test', status: 'active', players: { owner, visitor }, clock: 0, day: 1, phase: 'day', treasury: 20000, guards: [], resources: [], policies: { tradeTax: 5 }, stock: {}, stable: { stock: 1 } };
  const sim = { store: { account: () => ({ credit: 0 }) }, awardIncome: (v, p, amount) => { p.wallet += amount; } };
  ensureOwnership(v); ensureEconomy(v);
  const plot = v.plots[0]; Object.assign(plot, { ownerId: owner.id, building: 'smelter', hp: 550, maxHp: 550 });
  for (const p of [owner, visitor]) Object.assign(p, plotEntrance(PLOTS[0], plot));
  const act = (action, player = owner) => ownershipAction(sim, v, player, { plotId: plot.id, ...action });
  const start = (recipe = 'iron_ingot', batches = 1) => act({ kind: 'smelt_start', recipe, batches });
  const tick = dt => ownershipTick(sim, v, dt);
  return { v, owner, visitor, plot, sim, act, start, tick };
}
const unchanged = (value, fn, pattern) => { const before = structuredClone(value); assert.throws(fn, pattern); assert.deepEqual(value, before); };

test('any role can construct a smelter without ingots and existing iron stays ore across normalization', () => {
  for (const role of Object.keys(ROLE_STATS)) {
    const f = fixture(role); f.plot.building = null; f.plot.hp = 0;
    Object.assign(f.owner, plotEntrance(PLOTS[0], f.plot));
    f.owner.inventory.iron = 37; f.owner.inventory.timber = 30; f.owner.inventory.stone = 60;
    f.act({ kind: 'plot_build', building: 'smelter' });
    assert.equal(f.plot.building, 'smelter'); assert.equal(f.plot.hp, 550);
    assert.equal(f.owner.wallet, 9880); assert.equal(f.owner.inventory.iron, 37);
    assert.equal(f.owner.inventory.iron_ingot, 0); assert.equal(f.owner.inventory.steel_ingot, 0);
    ensureOwnership(f.v); assert.equal(f.owner.inventory.iron, 37);
    assert.equal(RESOURCE_MARKET.iron.label, 'Iron ore');
  }
});

test('paid iron and steel jobs finish deterministically without trusting client output or timing', () => {
  for (const [id, recipe] of Object.entries(SMELTING_RECIPES)) {
    const f = fixture(); f.plot.storage = { iron: 6, timber: 3, coal: 3 };
    const wallet = f.owner.wallet;
    f.act({ kind: 'smelt_start', recipe: id, batches: 3, seconds: 0, ready: 999, cost: {}, amount: 999 });
    assert.equal(f.plot.storage.iron, 0); assert.equal(f.plot.storage.timber, 0);
    assert.equal(f.plot.storage.coal, id === 'steel_ingot' ? 0 : 3);
    f.tick(recipe.seconds - .1); assert.equal(f.plot.storage[id] ?? 0, 0);
    f.tick(.1); assert.equal(f.plot.storage[id], 1); assert.equal(f.plot.smelting.remaining, 2);
    const checkpoint = structuredClone(f.plot.smelting);
    ownershipSnapshot(f.v, f.owner.id); ensureOwnership(f.v);
    assert.deepEqual(f.plot.smelting, checkpoint, 'reads and migration never advance the job');
    f.tick(100000); assert.equal(f.plot.storage[id], 3); assert.equal(f.plot.smelting, null);
    f.tick(100000); assert.equal(f.plot.storage[id], 3); assert.equal(f.owner.wallet, wallet);
  }
});

test('smelting rejects invalid inputs, distant or foreign owners and ruined buildings before consuming stock', () => {
  const f = fixture(); f.plot.storage = { iron: 200, timber: 100, coal: 100 };
  for (const recipe of ['iron', '__proto__', 'constructor', '', null, {}]) unchanged(f.v, () => f.start(recipe), /Choose/);
  for (const batches of [0, -1, 1.5, '1', NaN, Infinity, SMELTING_BATCH_LIMIT + 1]) unchanged(f.v, () => f.start('iron_ingot', batches), /1 to 100/);
  unchanged(f.v, () => f.act({ kind: 'smelt_start', recipe: 'iron_ingot' }, f.visitor), /owner/);
  Object.assign(f.owner, { x: 0, z: 0 }); unchanged(f.v, () => f.start(), /Visit/);
  f.plot.hp = 0; Object.assign(f.owner, plotEntrance(PLOTS[0], f.plot));
  unchanged(f.v, () => f.start(), /Repair/); f.plot.hp = 550; Object.assign(f.owner, plotEntrance(PLOTS[0], f.plot));
  f.plot.storage.coal = 0; unchanged(f.v, () => f.start('steel_ingot'), /coal/);
  f.start('iron_ingot', 100); unchanged(f.v, () => f.start(), /current/);
});

test('unclaimed finished ingots remain safe at full storage and block replacement jobs', () => {
  const f = fixture(); f.plot.storage = { iron: 4, timber: 2 }; f.start('iron_ingot', 2);
  f.plot.storage.wheat = 1500; f.tick(30);
  assert.equal(f.plot.smelting.remaining, 0); assert.equal(f.plot.smelting.ready, 2);
  assert.equal(f.plot.storage.iron_ingot ?? 0, 0); assert.equal(inventoryWeight(f.plot.storage), 1500);
  unchanged(f.v, () => f.start(), /current/);
  f.plot.storage.wheat = 1497; f.tick(1);
  assert.equal(f.plot.storage.iron_ingot, 1); assert.equal(f.plot.smelting.ready, 1);
  f.plot.storage.wheat = 1494; f.tick(1);
  assert.equal(f.plot.storage.iron_ingot, 2); assert.equal(f.plot.smelting, null);
});

test('cancellation refunds only unfinished batches plus held output and does not erase a full tray', () => {
  const f = fixture(); f.plot.storage = { iron: 6, timber: 3, coal: 3 }; f.start('steel_ingot', 3); f.tick(20);
  assert.equal(f.plot.storage.steel_ingot, 1); assert.equal(f.plot.smelting.progress, 5);
  f.plot.storage.wheat = 1497;
  unchanged(f.v, () => f.act({ kind: 'smelt_cancel' }), /Make room/);
  f.plot.storage.wheat = 0; f.plot.hp = 0; Object.assign(f.owner, plotEntrance(PLOTS[0], f.plot));
  f.act({ kind: 'smelt_cancel' });
  assert.equal(f.plot.smelting, null);
  assert.deepEqual(f.plot.storage, { iron: 4, timber: 2, coal: 2, steel_ingot: 1, wheat: 0 });
  unchanged(f.v, () => f.act({ kind: 'smelt_cancel' }), /no valid/);
});

test('active jobs survive offline owners, pause for empty or fallen villages and ruined or reassigned plots', () => {
  const f = fixture(); f.plot.storage = { iron: 4, timber: 2 }; f.start('iron_ingot', 2);
  f.owner.online = false; f.tick(3); assert.equal(f.plot.smelting.progress, 3);
  f.visitor.online = false; f.tick(300); assert.equal(f.plot.smelting.progress, 3);
  f.visitor.online = true; f.v.status = 'fallen'; f.tick(300); assert.equal(f.plot.smelting.progress, 3);
  f.v.status = 'active'; f.plot.hp = 0; f.tick(300); assert.equal(f.plot.smelting.progress, 3);
  f.plot.hp = 550; f.plot.ownerId = f.visitor.id; f.tick(300); assert.equal(f.plot.smelting.progress, 3);
  f.plot.ownerId = f.owner.id; f.tick(7); assert.equal(f.plot.storage.iron_ingot, 1);
});

test('demolition and replacement cannot destroy paid inputs, and invalid saved jobs never mint outputs', () => {
  const f = fixture(); f.plot.storage = { iron: 2, timber: 1 }; f.start();
  for (const action of [{ kind: 'plot_demolish', confirm: true }, { kind: 'plot_build', building: 'house', confirm: true }]) unchanged(f.v, () => f.act(action), /smelting job/);
  const savedJob = structuredClone(f.plot.smelting);
  for (const corrupt of [{ ready: 900 }, { remaining: -1 }, { progress: Infinity }, { recipe: '__proto__' }]) {
    f.plot.smelting = { ...savedJob, ...corrupt }; const before = structuredClone(f.plot.smelting);
    f.tick(1000); assert.deepEqual(f.plot.smelting, before); assert.equal(smeltingJob(f.plot), null); assert.equal(f.plot.storage.iron_ingot ?? 0, 0);
  }
});

test('all metal shop recipes require ingots and steel follows yield and durability progression with owner prices and Tinker savings', () => {
  assert.equal(TOOL_TIERS.steel.yield, 4); assert.equal(TOOL_TIERS.steel.durability, 250); assert.equal(TOOL_TIERS.steel.swordDamage, 25);
  for (const recipe of Object.values(RECIPES)) assert.equal(Object.hasOwn(recipe.cost, 'iron'), false);
  for (const tool of ['axe', 'pickaxe', 'scythe', 'hammer', 'sword']) {
    const f = fixture('tinker'); f.owner.skills = { tinker_efficiency: 2 };
    const id = `steel_${tool}`, recipe = RECIPES[id]; f.plot.building = recipe.shop; f.plot.shopPrices[id] = 211;
    Object.assign(f.visitor, plotEntrance(PLOTS[0], f.plot));
    const cost = craftingCost(recipe, f.owner); f.plot.storage = { ...cost, iron: 99 };
    f.act({ kind: 'craft_buy', recipe: id, price: 211 }, f.visitor);
    assert.equal(f.visitor.tiers[tool], 'steel'); assert.equal(f.visitor.durability[tool], 250);
    assert.equal(f.visitor.wallet, 9789); assert.equal(f.plot.storage.iron, 99);
    for (const resource of Object.keys(cost)) assert.equal(f.plot.storage[resource], 0);
    assert.equal(cost.steel_ingot, Math.ceil(recipe.cost.steel_ingot * .8));
  }
});

test('ingot trades move real resources, cannot profit by round trip and exceed ore value in every market band', () => {
  for (const id of ['iron_ingot', 'steel_ingot']) {
    const f = fixture(); Object.assign(f.owner, buildingEntrance(BUILDINGS.find(b => b.id === 'market')));
    f.owner.inventory[id] = 30; f.v.stock[id] = 23; const wallet = f.owner.wallet;
    const sale = taxedSaleQuote(id, 23, 30, 5);
    economyAction(f.sim, f.v, f.owner, { kind: 'sell', resource: id, amount: 30, minTotal: sale.total });
    assert.equal(f.v.stock[id], 53); assert.equal(f.owner.inventory[id], 0);
    const buy = taxedPurchaseQuote(id, 53, 30, 5);
    economyAction(f.sim, f.v, f.owner, { kind: 'buyResource', resource: id, amount: 30, maxTotal: buy.total });
    assert.equal(f.v.stock[id], 23); assert.equal(f.owner.inventory[id], 30); assert.ok(f.owner.wallet < wallet);
    for (const stock of [0, 24, 25, 99, 100, 299, 300, 999, 1000, 10000]) assert.ok(saleUnitPrice(id, stock) > saleUnitPrice('iron', stock));
    const cheapestInputs = Object.entries(SMELTING_RECIPES[id].cost).reduce((sum, [resource, count]) => sum + purchaseQuote(resource, 10000, count), 0);
    assert.ok(cheapestInputs >= saleQuote(id, 0, 1), 'buying inputs and smelting cannot mint gold');
  }
});

test('ingots use the uncapped surplus percentage and never take privately stored production', () => {
  for (const [policy, divisor] of [['conserve', 4], ['balanced', 2], ['trade', 1]]) {
    const f = fixture(); f.v.policies.exportPriority = policy;
    f.v.stock.iron_ingot = 10003; f.v.stock.steel_ingot = 5003; f.plot.storage = { iron_ingot: 70, steel_ingot: 80 };
    f.v.day = 3; economyDawn(f.sim, f.v);
    const ironSold = Math.floor(10003 / divisor), steelSold = Math.floor(5003 / divisor);
    assert.equal(f.v.stock.iron_ingot, 10003 - ironSold); assert.equal(f.v.stock.steel_ingot, 5003 - steelSold);
    assert.equal(f.v.economy.lastExportGold, ironSold * MERCHANT_EXPORT_PRICES.iron_ingot + steelSold * MERCHANT_EXPORT_PRICES.steel_ingot);
    assert.deepEqual(f.plot.storage, { iron_ingot: 70, steel_ingot: 80 });
  }
  assert.equal(RESOURCE_WEIGHTS.iron_ingot, 3); assert.equal(RESOURCE_WEIGHTS.steel_ingot, 3);
});

test('SQLite restart preserves paid progress and rollback restores inputs, output and job together', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'emberwatch-smelting-')), store = new Store(dir);
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });
  const session = await store.authenticate('register', 'SmeltingOwner', 'smelting-regression-password'), account = store.account(session.playerId);
  let sim = new Simulation(store); const { id } = sim.create('Foundry', account), p = sim.join(id, account, 'villager'), v = sim.villages.get(id), plot = v.plots[0];
  Object.assign(plot, { ownerId: p.id, building: 'smelter', hp: 550, maxHp: 550, storage: { iron: 6, timber: 3, coal: 3 } });
  Object.assign(p, plotEntrance(PLOTS[0], plot)); p.lastAction = -100; v.phaseRemaining = 10000;
  const save = store.saveVillage.bind(store), initial = structuredClone(v);
  store.saveVillage = () => { throw new Error('disk unavailable'); };
  assert.throws(() => sim.action(id, p.id, { kind: 'smelt_start', plotId: plot.id, recipe: 'steel_ingot', batches: 3 }), /disk unavailable/);
  assert.deepEqual(v, initial, 'failed transaction restores the paid inputs and job');
  store.saveVillage = save;
  sim.action(id, p.id, { kind: 'smelt_start', plotId: plot.id, recipe: 'steel_ingot', batches: 3 });
  sim.tick(20); sim.saveAll();
  const paid = structuredClone(v.plots[0].smelting); assert.equal(paid.remaining, 2); assert.equal(paid.progress, 5);
  sim = new Simulation(store); const recovered = sim.villages.get(id);
  sim.tick(1000); assert.deepEqual(recovered.plots[0].smelting, paid, 'empty villages do no offline work');
  const resumed = sim.join(id, account, 'villager'); sim.tick(10);
  assert.equal(recovered.plots[0].storage.steel_ingot, 2); assert.equal(recovered.plots[0].smelting.remaining, 1);
  Object.assign(resumed, plotEntrance(PLOTS[0], recovered.plots[0]));
  const beforeCancel = structuredClone(recovered);
  store.saveVillage = () => { throw new Error('disk unavailable'); };
  assert.throws(() => sim.action(id, resumed.id, { kind: 'smelt_cancel', plotId: plot.id }), /disk unavailable/);
  assert.deepEqual(recovered, beforeCancel, 'failed cancellation restores the remaining paid batch');
  store.saveVillage = save;
  sim.action(id, resumed.id, { kind: 'smelt_cancel', plotId: plot.id });
  assert.equal(recovered.plots[0].storage.steel_ingot, 2); assert.equal(recovered.plots[0].storage.iron, 2);
  assert.equal(recovered.plots[0].smelting, null);
});

test('crafted steel equipment survives SQLite reload and performs four-unit harvests and 25-damage sword strikes', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'emberwatch-steel-gameplay-')), store = new Store(dir);
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });
  const session = await store.authenticate('register', 'SteelCraftsman', 'steel-gameplay-password'), account = store.account(session.playerId);
  let sim = new Simulation(store); const { id } = sim.create('Steel Settlement', account), p = sim.join(id, account, 'tinker'), v = sim.villages.get(id);
  p.wallet = 1000; v.phaseRemaining = 10000;
  for (const [index, building] of ['tool_shop', 'sword_shop', 'mine'].entries()) {
    Object.assign(v.plots[index], { ownerId: p.id, building, hp: BUILDING_TYPES[building].maxHp, maxHp: BUILDING_TYPES[building].maxHp, storage: { steel_ingot: 20, timber: 20 } });
  }
  ensureOwnership(v);
  for (const [index, recipe] of ['steel_pickaxe', 'steel_sword'].entries()) {
    Object.assign(p, plotEntrance(PLOTS[index], v.plots[index])); v.clock += 1;
    sim.action(id, p.id, { kind: 'craft_buy', plotId: PLOTS[index].id, recipe });
  }
  sim.saveAll(); sim = new Simulation(store); const restored = sim.villages.get(id), player = sim.join(id, account, 'tinker');
  assert.equal(player.tiers.pickaxe, 'steel'); assert.equal(player.tiers.sword, 'steel');
  assert.equal(player.durability.pickaxe, 250); assert.equal(player.durability.sword, 250);
  const node = restored.plotResources.find(node => node.plotId === PLOTS[2].id && node.type === 'stone');
  Object.assign(player, { x: node.x, z: node.z, tool: 'pickaxe' }); restored.clock += 1;
  const beforeStone = player.inventory.stone, beforeHarvests = node.remaining;
  sim.action(id, player.id, { kind: 'gather', targetId: node.id });
  assert.equal(player.inventory.stone, beforeStone + 4); assert.equal(node.remaining, beforeHarvests - 1);
  assert.equal(player.durability.pickaxe, 249);
  Object.assign(player, { x: 0, z: 4, yaw: 0, tool: 'sword' }); restored.clock += 1;
  const enemy = createEnemy(restored, 'shambler', { x: 0, z: 6 }); restored.zombies = [enemy];
  const beforeHp = enemy.hp;
  sim.action(id, player.id, { kind: 'attack' });
  assert.equal(enemy.hp, beforeHp - 25); assert.equal(player.durability.sword, 249);
  const persisted = store.loadVillages().find(saved => saved.id === id).players[player.id];
  assert.equal(persisted.tiers.pickaxe, 'steel'); assert.equal(persisted.tiers.sword, 'steel');
  assert.equal(persisted.inventory.stone, beforeStone + 4); assert.equal(persisted.durability.pickaxe, 249); assert.equal(persisted.durability.sword, 249);
});
