import test from 'node:test';
import assert from 'node:assert/strict';
import { PLOTS, RESOURCES } from '../shared/world.js';
import { BUILDING_TYPES, CARRY_CAPACITY, inventoryWeight, RECIPES, TOOL_TIERS } from '../shared/content.js';
import { ensureOwnership, ownershipAction, ownershipSnapshot, ownershipTick } from '../server/ownership.js';

function fixture() {
  const player = (id, role = 'villager') => ({ id, name: id, role, online: true, wallet: 10000, inventory: {}, durability: { sword: 100, axe: 100, pickaxe: 100, scythe: 100, hammer: 100 }, x: 0, z: 0, tool: 'sword' });
  const owner = player('Owner'), visitor = player('Visitor');
  const village = { players: { Owner: owner, Visitor: visitor }, clock: 0, day: 1, treasury: 2500, guards: [], resources: [], policies: { tradeTax: 5 } };
  const accounts = { Owner: { credit: 0 }, Visitor: { credit: 0 } };
  const sim = { store: { account: id => accounts[id], spendCredit: (id, amount) => { assert.ok(accounts[id].credit >= amount); accounts[id].credit -= amount; } }, awardIncome: (v, p, amount) => { p.wallet += amount; } };
  ensureOwnership(village);
  const at = (p, index = 0) => { p.x = PLOTS[index].x; p.z = PLOTS[index].z; return village.plots[index]; };
  const act = (p, action) => ownershipAction(sim, village, p, action);
  const built = (building, index = 0) => {
    const plot = at(owner, index); plot.ownerId = owner.id; plot.building = building; plot.hp = plot.maxHp = BUILDING_TYPES[building].maxHp;
    ensureOwnership(village); return plot;
  };
  return { village, owner, visitor, accounts, sim, at, act, built };
}

test('plot purchases enforce proximity, increasing prices and a five-plot limit', () => {
  const { village, owner, visitor, at, act } = fixture();
  assert.throws(() => act(owner, { kind: 'plot_buy', plotId: PLOTS[0].id }), /Visit/);
  const wallet = owner.wallet;
  for (let i = 0; i < 5; i++) { const plot = at(owner, i); act(owner, { kind: 'plot_buy', plotId: plot.id }); }
  assert.equal(owner.wallet, wallet - 2000);
  assert.equal(village.treasury, 4500);
  at(owner, 5); assert.throws(() => act(owner, { kind: 'plot_buy', plotId: PLOTS[5].id }), /at most five/);
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
  plot.allowVisitors = true; visitor.inventory.wheat = CARRY_CAPACITY;
  assert.throws(() => act(visitor, { kind: 'gather', targetId: node.id }), /pack is full/);
  assert.equal(node.available, true); assert.equal(visitor.durability.scythe, 100);
  visitor.inventory.wheat = 0; plot.splitRemainders.wheat = 4; plot.storage.wheat = 1500;
  assert.throws(() => act(visitor, { kind: 'gather', targetId: node.id }), /make room/);
  assert.equal(plot.splitRemainders.wheat, 4); assert.equal(visitor.durability.scythe, 100);
  owner.inventory.stone = 30; assert.ok(inventoryWeight(owner) > CARRY_CAPACITY, 'tools are included in carried weight');
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
