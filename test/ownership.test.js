import { plotEntrance } from '../shared/access.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PLOTS, RESOURCES } from '../shared/world.js';
import { BUILDING_TYPES, carryCapacity, inventoryWeight, RECIPES, TOOL_TIERS, MAX_PLOTS, PLOT_PRICES } from '../shared/content.js';
import { ensureOwnership, ownershipAction, ownershipSnapshot, ownershipTick } from '../server/ownership.js';
import { PRODUCTION_UPGRADES, plotStorageCapacity, productionNodeCapacity, productionRegrowSeconds, productionStats, productionYield, productionUpgrade } from '../shared/production.js';

function fixture() {
  const player = (id, role = 'villager') => ({ id, name: id, role, online: true, wallet: 10000, inventory: {}, durability: { sword: 100, axe: 100, pickaxe: 100, scythe: 100, hammer: 100 }, x: 0, z: 0, tool: 'sword' });
  const owner = player('Owner'), visitor = player('Visitor');
  const village = { players: { Owner: owner, Visitor: visitor }, clock: 0, day: 1, treasury: 2500, guards: [], resources: [], policies: { tradeTax: 5 } };
  const accounts = { Owner: { credit: 0 }, Visitor: { credit: 0 } };
  const sim = { store: { account: id => accounts[id], spendCredit: (id, amount) => { assert.ok(accounts[id].credit >= amount); accounts[id].credit -= amount; } }, awardIncome: (v, p, amount) => { p.wallet += amount; } };
  ensureOwnership(village);
  const at = (p, index = 0) => { Object.assign(p, plotEntrance(PLOTS[index], village.plots[index])); return village.plots[index]; };
  const act = (p, action) => ownershipAction(sim, village, p, action);
  const built = (building, index = 0) => {
    const plot = at(owner, index); plot.ownerId = owner.id; plot.building = building; plot.hp = plot.maxHp = BUILDING_TYPES[building].maxHp;
    ensureOwnership(village); at(owner, index); return plot;
  };
  return { village, owner, visitor, accounts, sim, at, act, built };
}

test('level-two production upgrades pay displayed costs and preserve prior depletion across every resource', () => {
  for (const building of ['mine', 'tree_farm', 'wheat_farm']) {
    const { village, owner, act, built, sim } = fixture(), plot = built(building), cost = PRODUCTION_UPGRADES[building][2];
    for (const [id, amount] of Object.entries(cost.resources)) { plot.storage[id] = amount - 1; owner.inventory[id] = 1; }
    const nodes = village.plotResources.filter(node => node.plotId === plot.id);
    const active = nodes[0], exhausted = nodes[1];
    const remaining = active.remaining, beforeHp = plot.maxHp, wallet = owner.wallet, treasury = village.treasury;
    exhausted.available = false; exhausted.remaining = 0; exhausted.regrowAt = 100;
    act(owner, { kind: 'upgradeProduction', plotId: plot.id });
    assert.equal(plot.level, 2); assert.equal(plot.maxHp, Math.round(beforeHp * 1.5));
    assert.equal(owner.wallet, wallet - cost.gold); assert.equal(village.treasury, treasury + cost.gold);
    for (const id of Object.keys(cost.resources)) { assert.equal(plot.storage[id], 0); assert.equal(owner.inventory[id], 0); }
    assert.equal(active.remaining, remaining + productionNodeCapacity(active.type, plot) - productionNodeCapacity(active.type));
    assert.equal(exhausted.available, false); assert.equal(exhausted.remaining, 0); assert.equal(exhausted.regrowAt, 75);
    assert.equal(plotStorageCapacity(plot), 2000);
    assert.equal(productionUpgrade(plot).level, 3);
    village.clock = 75; ownershipTick(sim, village, .1);
    assert.equal(exhausted.remaining, productionNodeCapacity(exhausted.type, plot));
    assert.equal(exhausted.available, true);
    for (const resource of new Set(nodes.map(node => node.type))) {
      const node = nodes.find(node => node.type === resource);
      node.available = true; node.remaining = 1; owner.tool = resource === 'wheat' ? 'scythe' : resource === 'timber' ? 'axe' : 'pickaxe';
      Object.assign(owner, { x: node.x, z: node.z });
      act(owner, { kind: 'gather', targetId: node.id });
      assert.equal(node.available, false);
      assert.equal(node.regrowAt - village.clock, productionRegrowSeconds(resource, plot));
    }
    const saved = JSON.parse(JSON.stringify(village)); ensureOwnership(saved);
    assert.equal(saved.plots[0].level, 2); assert.deepEqual(saved.plotResources, village.plotResources);
  }
});

test('production upgrades reject missing costs, foreign ownership and ruined buildings without consuming anything', () => {
  const { village, owner, visitor, at, act, built } = fixture(), plot = built('mine');
  at(visitor); assert.throws(() => act(visitor, { kind: 'upgradeProduction', plotId: plot.id }), /owner/);
  plot.storage = { timber: 30, stone: 30, iron: 9 };
  const before = JSON.stringify({ plot, wallet: owner.wallet, treasury: village.treasury, nodes: village.plotResources });
  assert.throws(() => act(owner, { kind: 'upgradeProduction', plotId: plot.id }), /10 iron/);
  assert.equal(JSON.stringify({ plot, wallet: owner.wallet, treasury: village.treasury, nodes: village.plotResources }), before);
  plot.storage.iron = 10; owner.wallet = 149;
  assert.throws(() => act(owner, { kind: 'upgradeProduction', plotId: plot.id }), /150 wallet gold/);
  assert.equal(plot.storage.iron, 10); assert.equal(plot.level, 1);
  owner.wallet = 150; plot.hp = 0;
  assert.throws(() => act(owner, { kind: 'upgradeProduction', plotId: plot.id }), /Repair/);
  assert.equal(owner.wallet, 150);
});

test('third-level upgrades preserve spent harvests and node identity across saves without replenishing on normalization', () => {
  for (const building of ['mine', 'tree_farm', 'wheat_farm']) {
    const { village, owner, act, built, sim } = fixture(), plot = built(building);
    plot.level = 2; plot.hp = plot.maxHp = Math.round(BUILDING_TYPES[building].maxHp * 1.5);
    const nodes = village.plotResources.filter(node => node.plotId === plot.id), beforeIds = nodes.map(({ id, x, z }) => ({ id, x, z }));
    const active = nodes[0], spent = nodes[1], old = { ...plot }, remaining = active.remaining;
    Object.assign(spent, { available: false, remaining: 0, regrowAt: 90 });
    const cost = productionUpgrade(plot);
    for (const [id, amount] of Object.entries(cost.resources)) plot.storage[id] = amount;
    const wallet = owner.wallet; act(owner, { kind: 'upgradeProduction', plotId: plot.id, level: 99 });
    assert.equal(plot.level, 3); assert.equal(owner.wallet, wallet - cost.gold);
    assert.equal(plot.maxHp, BUILDING_TYPES[building].maxHp * 2); assert.equal(plotStorageCapacity(plot), 3000);
    assert.equal(active.remaining, remaining + productionNodeCapacity(active.type, plot) - productionNodeCapacity(active.type, old));
    assert.equal(spent.available, false); assert.equal(spent.remaining, 0); assert.equal(spent.regrowAt, 60);
    assert.deepEqual(nodes.map(({ id, x, z }) => ({ id, x, z })), beforeIds);
    assert.equal(productionUpgrade(plot), null);
    assert.throws(() => act(owner, { kind: 'upgradeProduction', plotId: plot.id }), /fully upgraded at level 3/);
    const saved = JSON.parse(JSON.stringify(village)), savedNodes = structuredClone(saved.plotResources);
    ensureOwnership(saved); ensureOwnership(saved); ownershipSnapshot(saved, owner.id);
    assert.equal(saved.plots[0].level, 3); assert.deepEqual(saved.plotResources, savedNodes, 'reloading and snapshots never refill nodes');
    const snapshot = ownershipSnapshot(saved, owner.id);
    assert.equal(snapshot.plots[0].production.yieldBonus, 2); assert.equal(snapshot.plotResources[0].productionLevel, 3);
    saved.clock = 60; ownershipTick(sim, saved, .1);
    const regrown = saved.plotResources.find(node => node.id === spent.id);
    assert.equal(regrown.remaining, productionNodeCapacity(spent.type, plot)); assert.equal(regrown.available, true);
  }
});

test('upgraded player yield respects tool tiers, visitor splitting and full-batch capacity atomically', () => {
  for (const building of ['mine', 'tree_farm', 'wheat_farm']) for (const level of [2, 3]) {
    const { village, owner, visitor, act, built } = fixture(), plot = built(building); plot.level = level;
    const node = village.plotResources.find(node => node.plotId === plot.id);
    const tool = node.type === 'wheat' ? 'scythe' : node.type === 'timber' ? 'axe' : 'pickaxe';
    owner.tool = visitor.tool = tool; Object.assign(owner, { x: node.x, z: node.z }); Object.assign(visitor, { x: node.x, z: node.z });
    for (const tier of ['wood', 'stone', 'iron']) {
      owner.tiers[tool] = tier; node.available = true; node.remaining = 10;
      const before = owner.inventory[node.type], durability = owner.durability[tool];
      act(owner, { kind: 'gather', targetId: node.id });
      assert.equal(owner.inventory[node.type] - before, productionYield(TOOL_TIERS[tier].yield, plot));
      assert.equal(owner.durability[tool], durability - 1); assert.equal(node.remaining, 9);
    }
    visitor.tiers[tool] = 'iron'; node.available = true; node.remaining = 5;
    for (let i = 0; i < 5; i++) act(visitor, { kind: 'gather', targetId: node.id });
    const output = productionYield(3, plot) * 5;
    assert.equal(visitor.inventory[node.type], output * .8); assert.equal(plot.storage[node.type], output * .2);
    assert.equal(node.remaining, 0); assert.equal(node.available, false);
    node.available = true; node.remaining = 3;
    owner.inventory = { wheat: 149 }; owner.durability = { [tool]: 1 };
    ensureOwnership(village);
    const before = structuredClone({ inventory: owner.inventory, node, storage: plot.storage, durability: owner.durability });
    assert.throws(() => act(owner, { kind: 'gather', targetId: node.id }), /pack is full/);
    assert.deepEqual({ inventory: owner.inventory, node, storage: plot.storage, durability: owner.durability }, before);
  }
});

test('plot purchases enforce proximity, increasing prices and an eight-plot limit', () => {
  const { village, owner, visitor, at, act } = fixture();
  assert.throws(() => act(owner, { kind: 'plot_buy', plotId: PLOTS[0].id }), /Visit/);
  const wallet = owner.wallet;
  for (let i = 0; i < MAX_PLOTS; i++) { const plot = at(owner, i); act(owner, { kind: 'plot_buy', plotId: plot.id }); }
  assert.equal(MAX_PLOTS, 8); assert.deepEqual(PLOT_PRICES, [100, 200, 350, 550, 800, 1100, 1450, 1850]);
  const total = PLOT_PRICES.reduce((sum, price) => sum + price, 0);
  assert.equal(owner.wallet, wallet - total);
  assert.equal(village.treasury, 2500 + total);
  at(owner, MAX_PLOTS); assert.throws(() => act(owner, { kind: 'plot_buy', plotId: PLOTS[MAX_PLOTS].id }), /at most 8/);
  at(visitor, 0); assert.throws(() => act(visitor, { kind: 'plot_buy', plotId: PLOTS[0].id }), /already belongs/);
});

test('crafting verifies complete stock and payment before changing any ledger', () => {
  const { village, owner, visitor, at, act, built } = fixture();
  const plot = built('tool_shop'); at(visitor); visitor.wallet = 100; visitor.durability.pickaxe = 0;
  plot.storage = { stone: 10, timber: 4 };
  const before = { wallet: visitor.wallet, ownerWallet: owner.wallet, treasury: village.treasury, durability: visitor.durability.pickaxe };
  assert.throws(() => act(visitor, { kind: 'craft_buy', plotId: plot.id, recipe: 'stone_pickaxe' }), /timber/);
  assert.deepEqual(plot.storage, { stone: 10, timber: 4 });
  assert.deepEqual({ wallet: visitor.wallet, ownerWallet: owner.wallet, treasury: village.treasury, durability: visitor.durability.pickaxe }, before);
  plot.storage.timber = 5; visitor.wallet = 1;
  assert.throws(() => act(visitor, { kind: 'craft_buy', plotId: plot.id, recipe: 'stone_pickaxe' }), /more wallet/);
  assert.deepEqual(plot.storage, { stone: 10, timber: 5 });
  visitor.wallet = 100;
  act(visitor, { kind: 'craft_buy', plotId: plot.id, recipe: 'stone_pickaxe' });
  assert.equal(visitor.wallet, 65); assert.equal(owner.wallet, before.ownerWallet + 34); assert.equal(village.treasury, before.treasury + 1);
  assert.deepEqual(plot.storage, { stone: 0, timber: 0 });
  assert.equal(visitor.tiers.pickaxe, 'stone'); assert.equal(visitor.durability.pickaxe, 150);
  assert.throws(() => act(visitor, { kind: 'craft_buy', plotId: plot.id, recipe: 'stone_pickaxe', confirm: true }), /stone/);
  assert.equal(visitor.wallet, 65, 'a second purchase cannot spend the first purchase stock');
});

test('restricted purchase credit cannot be converted to wallet gold in an owned shop', () => {
  const { owner, accounts, act, built } = fixture();
  const plot = built('tool_shop'); plot.storage = { stone: 10, timber: 5 }; owner.wallet = 0; accounts.Owner.credit = 100;
  assert.throws(() => act(owner, { kind: 'craft_buy', plotId: plot.id, recipe: 'stone_axe', confirm: true }), /wallet/);
  assert.equal(accounts.Owner.credit, 100); assert.equal(owner.wallet, 0); assert.equal(plot.storage.stone, 10);
});

test('crafting in an owned shop returns existing gold without counting it as income', () => {
  const { village, owner, accounts, sim, act, built } = fixture();
  const plot = built('tool_shop'); plot.storage = { stone: 10, timber: 5 }; owner.wallet = 100;
  owner.cycleServiceIncome = 17; accounts.Owner.debt = 100; accounts.Owner.credit = 40;
  sim.awardIncome = () => assert.fail('Returning the owner payment must not enter the debt repayment income path.');
  const treasury = village.treasury;
  act(owner, { kind: 'craft_buy', plotId: plot.id, recipe: 'stone_axe', confirm: true });
  assert.equal(owner.wallet, 99, 'the owner pays only the one-gold transaction tax');
  assert.equal(village.treasury, treasury + 1);
  assert.equal(owner.cycleServiceIncome, 17); assert.equal(accounts.Owner.debt, 100); assert.equal(accounts.Owner.credit, 40);
  assert.equal(owner.tiers.axe, 'stone'); assert.equal(owner.durability.axe, 150);
  assert.deepEqual(plot.storage, { stone: 0, timber: 0 });
});

test('visitor output is conserved with a persistent exact eighty/twenty split across tiers', () => {
  for (const tier of ['wood', 'stone', 'iron']) {
    const { village, visitor, owner, act, built, sim } = fixture();
    const plot = built('wheat_farm'); visitor.tool = 'scythe'; visitor.tiers.scythe = tier;
    const ids = village.plotResources.map(node => node.id);
    for (let i = 0; i < 15; i++) {
      const node = village.plotResources.find(node => node.id === ids[i]); visitor.x = node.x; visitor.z = node.z;
      act(visitor, { kind: 'gather', targetId: node.id });
      if (i === 6) { village.plots = JSON.parse(JSON.stringify(village.plots)); ensureOwnership(village); }
    }
    const savedPlot = village.plots.find(p => p.id === plot.id), produced = TOOL_TIERS[tier].yield * 15;
    assert.equal(visitor.inventory.wheat, produced * .8); assert.equal(savedPlot.storage.wheat, produced * .2);
    assert.equal(visitor.inventory.wheat + savedPlot.storage.wheat, produced);
    assert.equal(visitor.durability.scythe, 85, 'yield never changes action speed or durability use');
    const node = village.plotResources.find(node => node.available); owner.x = node.x; owner.z = node.z; owner.tool = 'scythe';
    act(owner, { kind: 'gather', targetId: node.id }); assert.equal(owner.inventory.wheat, 1, 'owner harvest is not split');
    village.clock = 1000; ownershipTick(sim, village, .05);
    assert.ok(village.plotResources.every(n => n.available), 'private stalks regrow individually');
  }
});

test('closed private plots, pack weight and owner storage are checked before harvest consumption', () => {
  const { village, visitor, owner, act, built } = fixture();
  const plot = built('wheat_farm'), node = village.plotResources[0]; visitor.x = node.x; visitor.z = node.z; visitor.tool = 'scythe';
  plot.allowVisitors = false;
  assert.throws(() => act(visitor, { kind: 'gather', targetId: node.id }), /closed/);
  plot.allowVisitors = true; visitor.inventory.wheat = carryCapacity(visitor) - inventoryWeight(visitor);
  assert.throws(() => act(visitor, { kind: 'gather', targetId: node.id }), /pack is full/);
  assert.equal(node.available, true); assert.equal(visitor.durability.scythe, 100);
  visitor.inventory.wheat = 0; plot.splitRemainders.wheat = 4; plot.storage.wheat = 1500;
  assert.throws(() => act(visitor, { kind: 'gather', targetId: node.id }), /make room/);
  assert.equal(plot.splitRemainders.wheat, 4); assert.equal(visitor.durability.scythe, 100);
  owner.inventory.stone = Math.floor(carryCapacity(owner) / 3); assert.ok(inventoryWeight(owner) > carryCapacity(owner), 'tools are included in carried weight');
});

test('all pickaxe tiers can harvest iron and coal without mining access restrictions', () => {
  const { village, owner, act } = fixture();
  owner.tool = 'pickaxe';
  for (const tier of ['wood', 'stone', 'iron']) for (const type of ['iron', 'coal']) {
    const node = RESOURCES.find(n => n.type === type); assert.ok(node, `${type} has public ore nodes`);
    const state = village.resources.find(n => n.id === node.id); state.available = true; state.remaining = 8;
    owner.x = node.x; owner.z = node.z; owner.tiers.pickaxe = tier;
    const previous = owner.inventory[type]; act(owner, { kind: 'gather', targetId: node.id });
    assert.equal(owner.inventory[type] - previous, TOOL_TIERS[tier].yield);
  }
});

test('storage allows donations, protects owner withdrawals and funds construction in stages', () => {
  const { owner, visitor, at, act } = fixture();
  const plot = at(owner); plot.ownerId = owner.id; at(visitor); visitor.inventory.timber = 10;
  act(visitor, { kind: 'plot_deposit', plotId: plot.id, resource: 'timber', amount: 10 });
  assert.equal(plot.storage.timber, 10); assert.equal(visitor.inventory.timber, 0);
  assert.throws(() => act(visitor, { kind: 'plot_withdraw', plotId: plot.id, resource: 'timber', amount: 1 }), /owner/);
  const prior = owner.wallet; act(owner, { kind: 'plot_build', plotId: plot.id, building: 'wheat_farm' });
  assert.equal(plot.storage.timber, 0); assert.equal(owner.wallet, prior - 20); assert.equal(plot.building, 'wheat_farm');
});

test('role buildings enforce limits and role changes preserve land and earned pay', () => {
  const { village, owner, at, act, built } = fixture();
  const plot = at(owner); plot.ownerId = owner.id;
  assert.throws(() => act(owner, { kind: 'plot_build', plotId: plot.id, building: 'barracks' }), /Only a guard/);
  owner.role = 'guard'; built('barracks', 0); built('barracks', 1);
  const third = at(owner, 2); third.ownerId = owner.id;
  assert.throws(() => act(owner, { kind: 'plot_build', plotId: third.id, building: 'barracks' }), /at most 2/);
  const house = built('house', 3); owner.jobBonus = 7; owner.repairBonus = 3;
  village.guards = [{ id: 'owned-guard', plotId: plot.id }, { id: 'starter' }];
  assert.throws(() => act(owner, { kind: 'role_change', role: 'priest' }), /Confirm/);
  plot.storage.wheat = 1;
  assert.throws(() => act(owner, { kind: 'role_change', role: 'priest', confirm: true }), /stored/);
  plot.storage.wheat = 0;
  act(owner, { kind: 'role_change', role: 'priest', confirm: true });
  assert.equal(owner.role, 'priest'); assert.equal(owner.jobBonus, 7); assert.equal(owner.repairBonus, 3);
  assert.equal(plot.ownerId, owner.id); assert.equal(plot.building, null); assert.equal(house.building, 'house');
  assert.deepEqual(village.guards, [{ id: 'starter' }]);
});

test('church conversion is explicit and refuses active patients without charging', () => {
  const { village, owner, act, built } = fixture();
  owner.role = 'priest'; const plot = built('church'); plot.patients = [{ playerId: 'Visitor' }];
  const funds = owner.wallet;
  assert.throws(() => act(owner, { kind: 'plot_demolish', plotId: plot.id, confirm: true }), /patient/);
  assert.throws(() => act(owner, { kind: 'role_change', role: 'villager', confirm: true }), /patient/);
  assert.equal(plot.building, 'church'); assert.equal(owner.wallet, funds);
  const snap = ownershipSnapshot(village, owner.id);
  assert.equal(snap.plots.length, PLOTS.length); assert.equal(snap.plots[0].ownerName, 'Owner');
  assert.equal(RECIPES.wood_axe, undefined, 'free-material wooden tools stay exclusive to the starter shop');
});

test('exact and maximum plot transfers conserve supplies and resolve current source and destination limits', () => {
  const { owner, visitor, at, act, built } = fixture(), plot = built('house');
  owner.inventory = { timber: 15 }; owner.durability = {};
  act(owner, { kind: 'plot_deposit', plotId: plot.id, resource: 'timber', amount: 10 });
  assert.equal(owner.inventory.timber, 5); assert.equal(plot.storage.timber, 10);
  const before = JSON.stringify([owner.inventory, plot.storage]);
  for (const amount of [0, -1, 1.5, '10', NaN, Infinity]) assert.throws(() => act(owner, { kind: 'plot_deposit', plotId: plot.id, resource: 'timber', amount }));
  assert.equal(JSON.stringify([owner.inventory, plot.storage]), before);
  plot.storage = { wheat: 1495 }; owner.inventory = { stone: 10 };
  act(owner, { kind: 'plot_deposit', plotId: plot.id, resource: 'stone', max: true });
  assert.equal(plot.storage.stone, 1); assert.equal(owner.inventory.stone, 9);
  assert.throws(() => act(owner, { kind: 'plot_deposit', plotId: plot.id, resource: 'stone', max: true }), /full/);
  owner.inventory = { wheat: carryCapacity(owner) - 5 };
  plot.storage = { stone: 50 };
  act(owner, { kind: 'plot_withdraw', plotId: plot.id, resource: 'stone', max: true });
  assert.equal(owner.inventory.stone, 1); assert.equal(plot.storage.stone, 49);
  at(visitor); assert.throws(() => act(visitor, { kind: 'plot_withdraw', plotId: plot.id, resource: 'stone', max: true }), /owner/);
});

test('cart purchases count packed, stored and deployed carts, and gifts check the receiving owner', () => {
  const { village, owner, visitor, at, act, built } = fixture(), plot = built('tinker_shop');
  plot.storage = { timber: 200, iron: 100 }; owner.durability = {}; visitor.durability = {}; at(visitor);
  act(visitor, { kind: 'craft_buy', plotId: plot.id, recipe: 'cart' });
  const before = JSON.stringify([plot.storage, owner.wallet, visitor.wallet, village.treasury]);
  assert.throws(() => act(visitor, { kind: 'craft_buy', plotId: plot.id, recipe: 'cart' }), /one cargo cart/);
  assert.equal(JSON.stringify([plot.storage, owner.wallet, visitor.wallet, village.treasury]), before);
  act(visitor, { kind: 'plot_deposit', plotId: plot.id, resource: 'cart', amount: 1 });
  assert.equal(visitor.inventory.cart, 0); assert.equal(plot.storage.cart, 1);
  at(owner); assert.throws(() => act(owner, { kind: 'craft_buy', plotId: plot.id, recipe: 'cart' }), /one cargo cart/);
  act(owner, { kind: 'plot_withdraw', plotId: plot.id, resource: 'cart', amount: 1 });
  assert.equal(owner.inventory.cart, 1, 'moving an owned cart from storage keeps the same ownership');
  at(visitor); act(visitor, { kind: 'craft_buy', plotId: plot.id, recipe: 'cart' });
  assert.throws(() => act(visitor, { kind: 'plot_deposit', plotId: plot.id, resource: 'cart', max: true }), /one cargo cart/);
  assert.equal(visitor.inventory.cart, 1); assert.equal(plot.storage.cart, 0);
  visitor.inventory.cart = 0; village.carts = [{ ownerId: visitor.id, storage: {} }];
  assert.throws(() => act(visitor, { kind: 'craft_buy', plotId: plot.id, recipe: 'cart' }), /one cargo cart/);
});
