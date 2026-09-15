import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { Simulation } from '../server/simulation.js';
import { BUILDINGS, PLOTS, RESOURCES, plotFront } from '../shared/world.js';
import { BACKPACKS, BUILDING_TYPES, carryCapacity, inventoryWeight } from '../shared/content.js';
import { ensureOwnership } from '../server/ownership.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'emberwatch-backpacks-'));
  const f = { directory, store: new Store(directory) };
  t.after(async () => { f.store.close(); await rm(directory, { recursive: true, force: true }); });
  f.sim = new Simulation(f.store);
  const session = await f.store.authenticate('register', 'PackTester', 'backpack-test-password');
  const account = f.store.account(session.playerId);
  const { id } = f.sim.create('Backpack Valley', account);
  f.player = f.sim.join(id, account); f.player.wallet = 1000; f.player.durability = {};
  f.village = f.sim.villages.get(id);
  f.act = action => { f.village.clock += .7; return f.sim.action(f.village.id, f.player.id, action); };
  f.near = id => {
    const b = BUILDINGS.find(building => building.id === id);
    Object.assign(f.player, { x: b.x - b.w / 2 - 1, z: b.z });
  };
  f.fill = weight => {
    for (const id of Object.keys(f.player.inventory)) f.player.inventory[id] = 0;
    f.player.inventory.wheat = weight - inventoryWeight(f.player);
  };
  return f;
}

test('backpacks enforce shop access, exact prices and one-way upgrades without accepting client capacity', async t => {
  const f = await fixture(t), { player: p, village: v } = f;
  assert.throws(() => f.act({ kind: 'buyBackpack', tier: 3, price: 0, carryCapacity: 999999 }), /Visit Oak/);
  assert.equal(p.wallet, 1000); assert.equal(carryCapacity(p), 150);
  f.near('tools');
  for (const tier of [-1, 0, 4, 1.5, '1', '__proto__', null]) {
    assert.throws(() => f.act({ kind: 'buyBackpack', tier }), /Choose a simple/);
  }
  p.wallet = 39;
  assert.throws(() => f.act({ kind: 'buyBackpack', tier: 1 }), /more wallet/);
  assert.equal(p.wallet, 39); assert.equal(v.treasury, 20000);
  p.wallet = 240;
  f.act({ kind: 'buyBackpack', tier: 1, price: 0, capacity: 999999 });
  assert.equal(p.wallet, 200); assert.equal(v.treasury, 20040); assert.equal(carryCapacity(p), 250);
  assert.throws(() => f.act({ kind: 'buyBackpack', tier: 1 }), /already have/);
  f.act({ kind: 'buyBackpack', tier: 3 });
  assert.equal(p.wallet, 0); assert.equal(v.treasury, 20240); assert.equal(carryCapacity(p), 550);
  assert.throws(() => f.act({ kind: 'buyBackpack', tier: 2 }), /already have/);
  assert.equal(inventoryWeight(p), 0, 'equipped backpacks do not consume their own storage');
  const snapshot = f.sim.snapshot(v, p.id);
  assert.equal(snapshot.backpackTier, 3); assert.equal(snapshot.carryCapacity, 550);
});

test('a backpack paid with approved credit persists across SQLite restart without changing protected savings', async t => {
  const f = await fixture(t), { player: p, village: v } = f;
  f.store.bank(p.id, 73); p.wallet = 10;
  f.near('bank'); f.act({ kind: 'loan', amount: 100 });
  f.near('tools'); f.act({ kind: 'buyBackpack', tier: 2 });
  assert.equal(p.wallet, 0); assert.equal(f.store.account(p.id).credit, 10);
  assert.equal(f.store.account(p.id).debt, 100); assert.equal(f.store.account(p.id).bank, 73);
  f.store.close(); f.store = new Store(f.directory);
  f.sim = new Simulation(f.store);
  const restored = f.sim.join(v.id, f.store.account(p.id));
  assert.equal(restored.backpackTier, 2); assert.equal(carryCapacity(restored), 400);
  assert.equal(f.store.account(p.id).credit, 10); assert.equal(f.store.account(p.id).bank, 73);
});

test('upgraded capacity applies consistently to gathering, market, food, shops, plots and carts', async t => {
  const f = await fixture(t), { player: p, village: v } = f;
  f.near('tools'); f.act({ kind: 'buyBackpack', tier: 1 });
  p.durability.scythe = 100; p.tiers.scythe = 'wood'; p.tool = 'scythe';
  const wheat = RESOURCES.filter(node => node.type === 'wheat');
  f.fill(249); Object.assign(p, { x: wheat[0].x, z: wheat[0].z });
  f.act({ kind: 'gather', targetId: wheat[0].id }); assert.equal(inventoryWeight(p), 250);
  Object.assign(p, { x: wheat[1].x, z: wheat[1].z });
  assert.throws(() => f.act({ kind: 'gather', targetId: wheat[1].id }), /pack is full/);
  assert.equal(p.durability.scythe, 99, 'overweight harvest does not spend tool durability');
  assert.ok(v.resources.find(node => node.id === wheat[1].id).available);

  f.fill(249); f.near('bank');
  f.act({ kind: 'buyResource', resource: 'wheat', amount: 1, maxTotal: 100 });
  assert.equal(inventoryWeight(p), 250);
  const gold = p.wallet, stock = v.stock.wheat;
  assert.throws(() => f.act({ kind: 'buyResource', resource: 'wheat', amount: 1, maxTotal: 100 }), /pack is full/);
  assert.equal(p.wallet, gold); assert.equal(v.stock.wheat, stock);

  f.fill(249); f.near('food'); f.act({ kind: 'buyFood', tier: 'food' });
  assert.equal(inventoryWeight(p), 250);
  assert.throws(() => f.act({ kind: 'buyFood', tier: 'food' }), /pack is full/);

  const plot = v.plots[0]; Object.assign(plot, { ownerId: p.id, building: 'tool_shop', hp: 350, maxHp: 350, storage: { stone: 20, timber: 10 } });
  Object.assign(p, plotFront(PLOTS[0], 1)); f.fill(248);
  f.act({ kind: 'craft_buy', plotId: plot.id, recipe: 'stone_hammer' });
  assert.equal(inventoryWeight(p), 250);
  assert.throws(() => f.act({ kind: 'craft_buy', plotId: plot.id, recipe: 'stone_pickaxe' }), /pack is full/);
  assert.equal(plot.storage.stone, 10, 'overweight crafting does not consume shop materials');
  f.fill(247); f.act({ kind: 'plot_withdraw', plotId: plot.id, resource: 'stone', amount: 1 });
  assert.equal(inventoryWeight(p), 250);
  assert.throws(() => f.act({ kind: 'plot_withdraw', plotId: plot.id, resource: 'stone', amount: 1 }), /pack is full/);

  const cart = { id: 'test-cart', ownerId: p.id, x: p.x, z: p.z, yaw: 0, storage: { stone: 3 } };
  v.carts.push(cart); f.fill(247);
  f.act({ kind: 'cartWithdraw', targetId: cart.id, resource: 'stone', amount: 1 });
  assert.equal(inventoryWeight(p), 250); assert.equal(cart.storage.stone, 2);
  assert.throws(() => f.act({ kind: 'cartWithdraw', targetId: cart.id, resource: 'stone', amount: 1 }), /pack cannot/);
  assert.equal(cart.storage.stone, 2);

  f.fill(248); f.near('merchant');
  Object.assign(v.merchant, { present: true, lastVisitDay: v.day, stock: { coal: 5 } });
  f.act({ kind: 'merchant_buy', resource: 'coal', amount: 1 }); assert.equal(inventoryWeight(p), 250);
  assert.throws(() => f.act({ kind: 'merchant_buy', resource: 'coal', amount: 1 }), /pack is full/);
});

test('legacy saves default to pockets and do not refill a purchased backpack or an existing tower', async t => {
  const f = await fixture(t), { player: p, village: v } = f;
  delete p.backpackTier; p.inventory.wheat = 17; ensureOwnership(v);
  assert.equal(p.backpackTier, 0); assert.equal(p.inventory.wheat, 17);
  p.backpackTier = 2; ensureOwnership(v); assert.equal(p.backpackTier, 2);
  const plot = v.plots[0]; plot.ownerId = p.id;
  Object.assign(p, plotFront(PLOTS[0], 1));
  for (const [id, amount] of Object.entries(BUILDING_TYPES.archer_tower.cost)) if (id !== 'gold') plot.storage[id] = amount;
  f.act({ kind: 'plot_build', plotId: plot.id, building: 'archer_tower' });
  assert.equal(plot.storage.arrows, 20, 'only newly paid construction includes a starter quiver');
  plot.storage.arrows = 3; ensureOwnership(v); ensureOwnership(v);
  assert.equal(plot.storage.arrows, 3, 'migration and repeated snapshots never refill spent ammo');
  assert.equal(BACKPACKS[2].capacity + 50, carryCapacity(p));
});

test('villager carrying bonus stacks with backpacks and switching jobs preserves all carried items', async t => {
  const f = await fixture(t), { player: p } = f;
  assert.equal(carryCapacity(p), 150);
  f.near('tools'); f.act({ kind: 'buyBackpack', tier: 1 });
  assert.equal(carryCapacity(p), 250); f.fill(225);
  const inventory = { ...p.inventory };
  f.act({ kind: 'role_change', role: 'guard' });
  assert.equal(carryCapacity(p), 200); assert.equal(p.backpackTier, 1);
  assert.deepEqual(p.inventory, inventory, 'losing a job bonus never destroys excess cargo');
  f.near('food'); assert.throws(() => f.act({ kind: 'buyFood', tier: 'food' }), /pack is full/);
  f.act({ kind: 'role_change', role: 'priest' });
  assert.equal(carryCapacity(p), 200); assert.deepEqual(p.inventory, inventory);
  f.act({ kind: 'role_change', role: 'villager' });
  assert.equal(carryCapacity(p), 250); assert.deepEqual(p.inventory, inventory);
  f.act({ kind: 'buyFood', tier: 'food' }); assert.equal(inventoryWeight(p), 226);
});
