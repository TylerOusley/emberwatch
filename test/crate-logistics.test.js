import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS, PLOTS } from '../shared/world.js';
import { buildingEntrance, plotEntrance } from '../shared/access.js';
import { carryCapacity, inventoryWeight, resourceWeight, transferableCount, boundInventoryCount, acquiredToolDurability, normalizeToolDurability } from '../shared/content.js';
import { transferLimit, moveResource } from '../shared/transfers.js';
import { ensureOwnership, ownershipAction } from '../server/ownership.js';
import { ensureEconomy, economyAction } from '../server/economy.js';
import { ensureWorkers, workersAction } from '../server/workers.js';
import { ensureTrading, tradingAction } from '../server/trading.js';

const player = (id = 'owner', utility = '') => ({ id, name: id, role: 'guard', online: true, hp: 100, maxHp: 100, hunger: 0, wallet: 1000, x: 0, z: 0,
  inventory: {}, durability: {}, tiers: {}, crateEquipment: { utility } });
function fixture(utility = '') {
  const p = player('owner', utility), visitor = player('visitor');
  const village = { id: 'logistics', status: 'active', day: 1, phase: 'day', clock: 0, treasury: 10000, players: { owner: p, visitor }, resources: [], guards: [], zombies: [], stock: { wheat: 100, timber: 100, stone: 100, iron: 100, coal: 100 }, policies: { tradeTax: 0 }, plots: [] };
  ensureOwnership(village); ensureEconomy(village); ensureWorkers(village); ensureTrading(village);
  const sim = { store: { account: () => ({ credit: 0 }) }, awardIncome: (v, who, amount) => { who.wallet += amount; } };
  const near = id => Object.assign(p, buildingEntrance(BUILDINGS.find(building => building.id === id)));
  return { p, visitor, village, sim, near };
}

test('only deployed utility affects capacity and carried weights; storage keeps ordinary weights', () => {
  const p = player(); p.role = 'villager'; p.backpackTier = 2;
  p.accountProgression = { loadout: { utility: 'deep_delvers_belt' } };
  assert.equal(carryCapacity(p), 400, 'future loadout grants no current equipment effect');
  p.crateEquipment.utility = 'foragers_pouch'; assert.equal(carryCapacity(p), 415);
  p.crateEquipment.utility = 'deep_delvers_belt'; assert.equal(carryCapacity(p), 440);
  p.crateEquipment.utility = 'mining_pack'; p.inventory = { timber: 10, stone: 10, iron: 10, coal: 10, wheat: 10 }; p.durability.pickaxe = 100;
  assert.equal(carryCapacity(p), 400); assert.equal(inventoryWeight(p), 97); assert.equal(inventoryWeight(p.inventory), 110);
  assert.equal(resourceWeight(p, 'timber'), 2);
  p.crateEquipment.utility = 'lumber_pack'; assert.equal(inventoryWeight(p), 109);
  p.crateEquipment = { head: 'mining_pack' }; assert.equal(inventoryWeight(p), 113, 'utility in the wrong slot has no effect');
});

test('discounted cargo expands the pack only, and moving between storage and pack conserves item counts', () => {
  const p = player('owner', 'mining_pack'); p.inventory.stone = 125;
  const cart = {};
  assert.equal(transferLimit(p, cart, 'stone', 300), 100, 'cart still weighs each stone at three');
  moveResource({ source: p, destination: cart, resource: 'stone', action: { max: true }, capacity: 300 });
  assert.equal(p.inventory.stone, 25); assert.equal(cart.stone, 100); assert.equal(inventoryWeight(cart), 300);
  moveResource({ source: cart, destination: p, resource: 'stone', action: { max: true }, capacity: carryCapacity(p) });
  assert.equal(p.inventory.stone, 41); assert.equal(cart.stone, 84); assert.equal(inventoryWeight(p), 98.4);
  assert.equal(p.inventory.stone + cart.stone, 125);
  assert.equal(transferLimit(cart, p, 'stone', carryCapacity(p)), 0);
});

test('gathering, market buying and merchant buying accept discounted units at the actual boundary', () => {
  const f = fixture('mining_pack'), { p, village: v, sim } = f, plot = v.plots[0];
  Object.assign(plot, { ownerId: p.id, building: 'mine', hp: 450, maxHp: 450 }); ensureOwnership(v);
  const node = v.plotResources.find(node => node.plotId === plot.id && node.type === 'stone');
  p.inventory.stone = 39; p.durability.pickaxe = 100; p.tiers.pickaxe = 'wood'; p.tool = 'pickaxe'; Object.assign(p, { x: node.x, z: node.z });
  ownershipAction(sim, v, p, { kind: 'gather', targetId: node.id }); assert.equal(inventoryWeight(p), 99);
  assert.throws(() => ownershipAction(sim, v, p, { kind: 'gather', targetId: node.id }), /pack is full/); assert.equal(p.durability.pickaxe, 99);
  p.inventory = { stone: 40 }; p.durability = {}; f.near('market');
  economyAction(sim, v, p, { kind: 'buyResource', resource: 'stone', amount: 1, maxTotal: 100 }); assert.equal(p.inventory.stone, 41);
  assert.throws(() => economyAction(sim, v, p, { kind: 'buyResource', resource: 'stone', amount: 1, maxTotal: 100 }), /pack is full/);
  p.inventory = { coal: 60 }; f.near('merchant'); Object.assign(v.merchant, { present: true, lastVisitDay: 1, stock: { coal: 10 } });
  economyAction(sim, v, p, { kind: 'merchant_buy', resource: 'coal', amount: 2 }); assert.equal(inventoryWeight(p), 99.2);
  assert.throws(() => economyAction(sim, v, p, { kind: 'merchant_buy', resource: 'coal', amount: 1 }), /pack is full/);
});

test('collecting worker cargo uses the owner utility while the worker cargo has ordinary weight', () => {
  const f = fixture('lumber_pack'), { p, village: v, sim } = f; f.near('bank');
  workersAction(sim, v, p, { kind: 'worker_hire' }); const worker = v.workers[0];
  Object.assign(worker, { x: p.x, z: p.z, cargo: { wheat: 0, timber: 10, stone: 0, iron: 0, coal: 0 } });
  p.inventory = { timber: 60 };
  workersAction(sim, v, p, { kind: 'worker_collect', workerId: worker.id });
  assert.equal(p.inventory.timber, 62); assert.equal(worker.cargo.timber, 8); assert.equal(inventoryWeight(p), 99.2); assert.equal(inventoryWeight(worker.cargo), 16);
});

test('mixed kit food stays bound through max storage and consumption uses bound food first', () => {
  const f = fixture(), { p, village: v, sim } = f, plot = v.plots[0];
  Object.assign(plot, { ownerId: p.id, building: 'house', hp: 500, maxHp: 500 }); Object.assign(p, plotEntrance(PLOTS[0], plot));
  p.inventory.food = 5; p.boundInventory = { food: 2 };
  ownershipAction(sim, v, p, { kind: 'plot_deposit', plotId: plot.id, resource: 'food', max: true });
  assert.equal(p.inventory.food, 2); assert.equal(plot.storage.food, 3); assert.equal(p.boundInventory.food, 2);
  assert.throws(() => ownershipAction(sim, v, p, { kind: 'plot_deposit', plotId: plot.id, resource: 'food', amount: 1 }), /Kit supplies/);
  ownershipAction(sim, v, p, { kind: 'plot_withdraw', plotId: plot.id, resource: 'food', amount: 3 });
  assert.equal(transferableCount(p, 'food'), 3);
  economyAction(sim, v, p, { kind: 'eat', tier: 'food' });
  assert.equal(p.inventory.food, 4); assert.equal(p.boundInventory.food, 1); assert.equal(transferableCount(p, 'food'), 3);
  economyAction(sim, v, p, { kind: 'eat', tier: 'food' });
  assert.equal(p.inventory.food, 3); assert.equal(boundInventoryCount(p, 'food'), 0); assert.equal(transferableCount(p, 'food'), 3);
  f.near('food'); economyAction(sim, v, p, { kind: 'buyFood', tier: 'food' }); assert.equal(transferableCount(p, 'food'), 4);
});

test('trade validation excludes kit portions and net receiving capacity uses each players own utility', () => {
  const { p, visitor: other, village: v, sim } = fixture('mining_pack');
  p.inventory = { stone: 40, food: 3 }; p.boundInventory = { food: 2 }; other.inventory = { stone: 5 }; p.x = 0; other.x = 1; p.z = other.z = 0;
  const act = (who, kind, fields = {}) => tradingAction(sim, v, who, { kind, tradeId: v.trades[0]?.id, ...fields });
  act(p, 'trade_invite', { targetId: other.id }); act(other, 'trade_accept');
  assert.throws(() => act(p, 'trade_offer', { offer: { resources: { food: 2 }, gold: 0 } }), /Kit supplies/);
  act(p, 'trade_offer', { offer: { resources: { food: 1 }, gold: 0 } });
  act(other, 'trade_offer', { offer: { resources: { stone: 1 }, gold: 0 } });
  assert.throws(() => act(p, 'trade_confirm', { version: v.trades[0].version }), /room/, 'bound food still consumes carried capacity');
  p.inventory.stone = 39;
  act(p, 'trade_confirm', { version: v.trades[0].version }); act(other, 'trade_confirm', { version: v.trades[0].version });
  assert.equal(p.inventory.stone, 40); assert.equal(p.inventory.food, 2); assert.equal(p.boundInventory.food, 2); assert.equal(other.inventory.food, 1);
  assert.equal(other.boundInventory?.food ?? 0, 0); assert.equal(inventoryWeight(p), 98);
});

test('buckle grants durability only on new gathering tools, preserving wear and ordinary starter kits', () => {
  const { p, village: v, sim } = fixture('miners_buckle'), plot = v.plots[0];
  p.durability.pickaxe = 17; delete p.maxDurability; normalizeToolDurability(p);
  assert.equal(p.durability.pickaxe, 17); assert.equal(p.maxDurability.pickaxe, 100);
  assert.equal(acquiredToolDurability(p, 'pickaxe'), 110);
  assert.equal(acquiredToolDurability(p, 'axe', 'stone'), 165);
  assert.equal(acquiredToolDurability(p, 'scythe', 'iron'), 220);
  assert.equal(acquiredToolDurability(p, 'hammer', 'stone'), 150);
  assert.equal(acquiredToolDurability(p, 'pickaxe', 'iron', { starter: true }), 200);
  Object.assign(plot, { ownerId: p.id, building: 'tool_shop', hp: 350, maxHp: 350, storage: { stone: 10, timber: 5 } }); Object.assign(p, plotEntrance(PLOTS[0], plot));
  ownershipAction(sim, v, p, { kind: 'craft_buy', plotId: plot.id, recipe: 'stone_pickaxe', confirm: true });
  assert.equal(p.durability.pickaxe, 165); assert.equal(p.maxDurability.pickaxe, 165);
  p.durability.pickaxe = 163; ensureOwnership(v); ensureOwnership(v);
  assert.equal(p.durability.pickaxe, 163); assert.equal(p.maxDurability.pickaxe, 165);
});

test('selling and donations move only available counts and leave any bound allocation untouched', () => {
  const f = fixture(), { p, village: v, sim } = f; f.near('market');
  p.inventory.wheat = 5; p.boundInventory = { wheat: 2 };
  assert.throws(() => economyAction(sim, v, p, { kind: 'sell', resource: 'wheat', amount: 4, minTotal: 1 }), /Kit supplies/);
  const prior = v.stock.wheat;
  economyAction(sim, v, p, { kind: 'donate' });
  assert.equal(v.stock.wheat, prior + 3); assert.equal(p.inventory.wheat, 2); assert.equal(p.boundInventory.wheat, 2);
});
