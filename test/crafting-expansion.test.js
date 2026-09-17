import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PLOTS, RESOURCES, resolveResource } from '../shared/world.js';
import { plotEntrance } from '../shared/access.js';
import { BUILDING_TYPES, RECIPES, RESOURCE_WEIGHTS, shopPrice, SHOP_PRICE_LIMIT, inventoryWeight } from '../shared/content.js';
import { canEquip } from '../shared/equipment.js';
import { TRADE_ITEMS } from '../shared/trading.js';
import { saleQuote, purchaseQuote } from '../shared/market.js';
import { ensureOwnership, ownershipAction, ownershipSnapshot } from '../server/ownership.js';
import { ensureCaves, regrowCaveResource } from '../server/caves.js';
import { Store } from '../server/store.js';
import { createMusketModel } from '../public/src/musket-model.js';

function fixture(building = 'tinker_shop') {
  const player = id => ({ id, name: id, role: 'villager', online: true, wallet: 1000, inventory: {}, durability: {}, tiers: {}, x: 0, z: 0 });
  const owner = player('owner'), buyer = player('buyer');
  const village = { id: 'crafting', day: 1, clock: 0, players: { owner, buyer }, treasury: 2500, guards: [], policies: { tradeTax: 10 } };
  const accounts = { owner: { credit: 0 }, buyer: { credit: 0 } };
  const sim = { store: { account: id => accounts[id], spendCredit: (id, count) => { accounts[id].credit -= count; } }, awardIncome: (v, p, count) => { p.wallet += count; } };
  ensureOwnership(village);
  const plot = village.plots[0]; Object.assign(plot, { ownerId: owner.id, building, hp: BUILDING_TYPES[building].maxHp, maxHp: BUILDING_TYPES[building].maxHp });
  ensureOwnership(village); Object.assign(owner, plotEntrance(PLOTS[0], plot)); Object.assign(buyer, plotEntrance(PLOTS[0], plot));
  const act = (p, action) => ownershipAction(sim, village, p, { plotId: plot.id, ...action });
  return { village, owner, buyer, plot, act, accounts };
}

test('sulfur migration appends private and public nodes without restoring depleted old ore', () => {
  const { village, plot } = fixture('mine');
  village.plotResources = village.plotResources.filter(node => node.type !== 'sulfur');
  Object.assign(village.plotResources[0], { available: false, remaining: 0, regrowAt: 600 });
  const original = structuredClone(village.plotResources);
  village.resources = village.resources.filter(node => !node.id.startsWith('sulfur-'));
  ensureOwnership(village); ensureCaves(village);
  assert.deepEqual(village.plotResources.filter(node => node.type !== 'sulfur'), original);
  assert.equal(village.plotResources.filter(node => node.plotId === plot.id && node.type === 'sulfur').length, 1);
  const sulfur = RESOURCES.filter(node => node.type === 'sulfur'); assert.equal(sulfur.length, 8);
  for (const node of sulfur) {
    const state = village.resources.find(state => state.id === node.id);
    assert.equal(resolveResource(node, state).type, 'sulfur'); assert.equal(node.caveTier, 'deep');
    Object.assign(state, { available: false, remaining: 0, regrowAt: 0 });
    assert.equal(regrowCaveResource(village, node, state), true); assert.equal(state.type, 'sulfur');
  }
  const saved = JSON.parse(JSON.stringify(village)); ensureOwnership(saved); ensureCaves(saved);
  assert.deepEqual(saved.plotResources, village.plotResources);
  assert.deepEqual(saved.resources, village.resources);
});

test('every pickaxe tier harvests sulfur and the material is tradeable and weighted', () => {
  const { village, owner, act } = fixture('mine');
  const node = village.plotResources.find(node => node.type === 'sulfur');
  Object.assign(owner, { x: node.x, z: node.z, tool: 'pickaxe' });
  for (const [tier, yieldCount] of [['wood', 1], ['stone', 2], ['iron', 3]]) {
    owner.tiers.pickaxe = tier; owner.durability.pickaxe = 100; const before = owner.inventory.sulfur;
    act(owner, { kind: 'gather', targetId: node.id });
    assert.equal(owner.inventory.sulfur - before, yieldCount); assert.equal(owner.durability.pickaxe, 99);
  }
  assert.equal(RESOURCE_WEIGHTS.sulfur, 2); assert.equal(TRADE_ITEMS.sulfur, 'Sulfur');
  assert.equal(saleQuote('sulfur', 0, 30), 25 * 6 + 5 * 5);
  assert.ok(purchaseQuote('sulfur', 30, 30) > saleQuote('sulfur', 0, 30));
});

test('owner can manufacture gunpowder then musket shots into storage with exact material conservation', () => {
  const { village, owner, plot, act } = fixture(); plot.storage = { sulfur: 4, coal: 2, stone: 8 };
  const wallet = owner.wallet, treasury = village.treasury;
  act(owner, { kind: 'craft_stock', recipe: 'gunpowder', batches: 2 });
  assert.deepEqual(plot.storage, { sulfur: 0, coal: 0, stone: 8, gunpowder: 10 });
  act(owner, { kind: 'craft_stock', recipe: 'musket_ammo', batches: 2 });
  assert.deepEqual(plot.storage, { sulfur: 0, coal: 0, stone: 0, gunpowder: 6, musket_ammo: 16 });
  assert.equal(owner.wallet, wallet); assert.equal(village.treasury, treasury);
  assert.equal(owner.inventory.gunpowder, 0); assert.equal(owner.inventory.musket_ammo, 0);
  act(owner, { kind: 'plot_withdraw', resource: 'musket_ammo', amount: 8 });
  assert.equal(owner.inventory.musket_ammo, 8); assert.equal(plot.storage.musket_ammo, 8);
  assert.equal(TRADE_ITEMS.gunpowder, 'Gunpowder'); assert.equal(TRADE_ITEMS.musket_ammo, 'Musket shots');
});

test('prepared gunpowder sells once at the owner price without consuming crafting materials again', () => {
  const { village, owner, buyer, plot, act } = fixture(); plot.storage = { gunpowder: 5 };
  act(owner, { kind: 'shop_price', recipe: 'gunpowder', price: 47 });
  const before = { owner: owner.wallet, buyer: buyer.wallet, treasury: village.treasury };
  act(buyer, { kind: 'craft_buy', recipe: 'gunpowder', price: 47 });
  assert.equal(plot.storage.gunpowder, 0); assert.equal(buyer.inventory.gunpowder, 5);
  assert.equal(buyer.wallet, before.buyer - 47); assert.equal(owner.wallet, before.owner + 43); assert.equal(village.treasury, before.treasury + 4);
  const after = JSON.stringify(village);
  assert.throws(() => act(buyer, { kind: 'craft_buy', recipe: 'gunpowder', price: 47 }), /sulfur/);
  assert.equal(JSON.stringify(village), after);
});

test('each shop owner controls each supported recipe price and custom charges reach its own owner', () => {
  for (const building of ['tool_shop', 'sword_shop', 'tinker_shop']) {
    const { owner, buyer, plot, act } = fixture(building);
    for (const [id, recipe] of Object.entries(RECIPES).filter(([, recipe]) => recipe.shop === building)) {
      act(owner, { kind: 'shop_price', recipe: id, price: 123 }); assert.equal(shopPrice(plot, id), 123);
      assert.equal(plot.shopPrices[id], 123);
    }
    const [id, recipe] = Object.entries(RECIPES).find(([, recipe]) => recipe.shop === building);
    plot.storage = { ...recipe.cost }; const wallet = buyer.wallet;
    act(buyer, { kind: 'craft_buy', recipe: id, price: 123 }); assert.equal(buyer.wallet, wallet - 123);
    assert.ok(ownershipSnapshot({ ...fixture().village, plots: [plot] }, buyer.id).plots[0].shopPrices);
  }
});

test('price edits require the owner, working shop, proximity, valid recipe and bounded whole gold', () => {
  const { owner, buyer, plot, act } = fixture();
  const before = JSON.stringify(plot);
  assert.throws(() => act(buyer, { kind: 'shop_price', recipe: 'musket', price: 1 }), /owner/);
  for (const price of [0, -1, 1.5, NaN, Infinity, '25', SHOP_PRICE_LIMIT + 1]) assert.throws(() => act(owner, { kind: 'shop_price', recipe: 'musket', price }), /whole-gold/);
  for (const recipe of ['__proto__', 'constructor', 'iron_sword']) assert.throws(() => act(owner, { kind: 'shop_price', recipe, price: 20 }), /item made/);
  assert.equal(JSON.stringify(plot), before);
  owner.x = 0; owner.z = 0; assert.throws(() => act(owner, { kind: 'shop_price', recipe: 'musket', price: 20 }), /Visit/);
  plot.hp = 0; Object.assign(owner, plotEntrance(PLOTS[0], plot));
  assert.throws(() => act(owner, { kind: 'shop_price', recipe: 'musket', price: 20 }), /working shop/);
});

test('changed shop prices reject stale or missing quotes before funds, stock or equipment change', () => {
  const { village, owner, buyer, plot, act } = fixture(); plot.storage = { iron: 14, timber: 16 };
  act(owner, { kind: 'shop_price', recipe: 'musket', price: 250 });
  for (const price of [undefined, 180, 1, '250']) {
    const before = JSON.stringify(village);
    assert.throws(() => act(buyer, { kind: 'craft_buy', recipe: 'musket', price }), /price changed/);
    assert.equal(JSON.stringify(village), before);
  }
  act(buyer, { kind: 'craft_buy', recipe: 'musket', price: 250 });
  assert.equal(buyer.durability.musket, 100); assert.equal(buyer.maxDurability.musket, 100);
  assert.equal(canEquip(buyer, 'musket'), true); assert.equal(inventoryWeight(buyer), 5);
});

test('stock crafting rejects visitors, overdrawn inputs and invalid batches without changing goods or balances', () => {
  const { village, owner, buyer, plot, act } = fixture(); plot.storage = { sulfur: 2, coal: 1 };
  const before = JSON.stringify(village);
  assert.throws(() => act(buyer, { kind: 'craft_stock', recipe: 'gunpowder' }), /owner/);
  for (const batches of [0, -1, 1.5, '2', 101, Infinity]) assert.throws(() => act(owner, { kind: 'craft_stock', recipe: 'gunpowder', batches }), /batches/);
  assert.throws(() => act(owner, { kind: 'craft_stock', recipe: 'gunpowder', batches: 2 }), /4 sulfur/);
  assert.throws(() => act(owner, { kind: 'craft_stock', recipe: 'musket' }), /Only gunpowder/);
  assert.equal(JSON.stringify(village), before);
});

test('new shop supplies obey pack capacity, trade tax overflow and wallet-only self purchases atomically', () => {
  const { village, owner, buyer, plot, act, accounts } = fixture(); plot.storage = { musket_ammo: 8 };
  buyer.inventory.stone = 50;
  let before = JSON.stringify(village);
  assert.throws(() => act(buyer, { kind: 'craft_buy', recipe: 'musket_ammo', price: 24 }), /pack is full/);
  assert.equal(JSON.stringify(village), before);
  buyer.inventory.stone = 0; village.treasury = Number.MAX_SAFE_INTEGER; before = JSON.stringify(village);
  assert.throws(() => act(buyer, { kind: 'craft_buy', recipe: 'musket_ammo', price: 24 }), /treasury/);
  assert.equal(JSON.stringify(village), before);
  village.treasury = 2500; owner.wallet = 0; accounts.owner.credit = 100;
  assert.throws(() => act(owner, { kind: 'craft_buy', recipe: 'musket_ammo', price: 24 }), /wallet/);
  assert.equal(accounts.owner.credit, 100); assert.equal(plot.storage.musket_ammo, 8);
});

test('SQLite retains individual shop prices, manufactured supplies and musket durability across reload', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'emberwatch-crafting-'));
  const store = new Store(directory); t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  const { village, owner, plot, act } = fixture(); plot.storage = { sulfur: 4, coal: 2 };
  act(owner, { kind: 'shop_price', recipe: 'gunpowder', price: 37 });
  act(owner, { kind: 'shop_price', recipe: 'musket', price: 231 });
  act(owner, { kind: 'craft_stock', recipe: 'gunpowder', batches: 2 });
  owner.durability.musket = 63; owner.maxDurability.musket = 100; owner.tiers.musket = 'wood'; owner.inventory.musket_ammo = 17;
  store.saveVillage(village);
  const restored = store.loadVillages().find(v => v.id === village.id); ensureOwnership(restored);
  assert.deepEqual(restored.plots[0].shopPrices, { gunpowder: 37, musket: 231 }); assert.equal(restored.plots[0].storage.gunpowder, 10);
  assert.equal(restored.players.owner.inventory.musket_ammo, 17); assert.equal(restored.players.owner.durability.musket, 63);
  assert.equal(restored.players.owner.maxDurability.musket, 100); assert.equal(restored.plots[0].ownerId, owner.id);
});

test('shop tax and automatic owner debt repayment both fit before any sale ledger changes', () => {
  const { village, owner, buyer, plot, act, accounts } = fixture();
  plot.storage.gunpowder = 5; accounts.owner.debt = 100; accounts.owner.repayment_remainder = 90;
  village.treasury = Number.MAX_SAFE_INTEGER - 2;
  const before = JSON.stringify({ village, accounts });
  assert.throws(() => act(buyer, { kind: 'craft_buy', recipe: 'gunpowder', price: 20 }), /treasury/);
  assert.equal(JSON.stringify({ village, accounts }), before);
  assert.equal(owner.wallet, 1000); assert.equal(buyer.wallet, 1000);
});

test('musket meshes share bounded assets and disposing one instance preserves other weapons and muzzle socket', () => {
  const a = createMusketModel(), b = createMusketModel();
  const meshes = a.children.filter(child => child.isMesh); assert.equal(meshes.length, 3);
  assert.equal(a.getObjectByName('musket-muzzle').position.y, 1.05);
  for (const mesh of meshes) {
    const other = b.getObjectByName(mesh.name); assert.equal(mesh.geometry, other.geometry); assert.equal(mesh.material, other.material);
    assert.ok([...mesh.geometry.attributes.position.array].every(Number.isFinite));
    assert.ok(mesh.geometry.attributes.position.count < 6000);
  }
  a.userData.dispose(); assert.ok(b.getObjectByName('musket-steel').geometry.attributes.position.count > 0);
});
