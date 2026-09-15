import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS, PLOTS, plotBedPoint, canStand, plotSolids } from '../shared/world.js';
import { BUILDING_TYPES } from '../shared/content.js';
import { buildingEntrance, plotEntrance, canUseBuilding, canUsePlot, canUseChurchBed } from '../shared/access.js';
import { Simulation } from '../server/simulation.js';

function fixture(role = 'villager') {
  const account = { id: 'resident', name: 'Resident', bank: 100, debt: 100, credit: 0 };
  const store = { loadVillages: () => [], saveVillage() {}, transaction: fn => fn(), initialWallet: () => 10, account: () => account,
    bank(id, amount) { account.bank += amount; }, issueCredit(id, amount) { account.credit += amount; account.debt += amount; },
    repayDebt(id, amount) { account.debt -= amount; }, spendCredit(id, amount) { account.credit -= amount; } };
  const sim = new Simulation(store), { id } = sim.create('Doorwatch', account), p = sim.join(id, account, role), v = sim.villages.get(id);
  p.wallet = 10000; p.backpackTier = 3; p.inventory.wheat = 10; p.inventory.timber = 10; p.inventory.stone = 10;
  const act = action => { v.clock += .7; return sim.action(id, p.id, action); };
  return { sim, v, p, account, act };
}
const building = id => BUILDINGS.find(b => b.id === id);
const opposite = (site, entrance) => ({ x: site.x * 2 - entrance.x, z: site.z * 2 - entrance.z });
function rejectedWithoutMutation(f, action, pattern = /Visit|Bring|Stand beside/) {
  // Advance before the checkpoint so cooldown cannot disguise access failures.
  f.v.clock += .7;
  const before = structuredClone(f.v), account = structuredClone(f.account);
  assert.throws(() => f.sim.action(f.v.id, f.p.id, action), pattern);
  assert.deepEqual(f.v, before); assert.deepEqual(f.account, account);
}

test('every authored entrance is collision-accessible and rejects sides, rear and invalid positions', () => {
  for (const b of BUILDINGS) {
    const point = buildingEntrance(b), dx = point.x - b.x, dz = point.z - b.z;
    assert.ok(canStand(point.x, point.z), `${b.id} doorway can be reached`);
    assert.ok(canUseBuilding(point, b));
    assert.equal(canUseBuilding(opposite(b, point), b), false, `${b.id} rear`);
    for (const sign of [-1, 1]) assert.equal(canUseBuilding({ x: b.x + sign * dz, z: b.z - sign * dx }, b), false, `${b.id} side`);
    assert.equal(canUseBuilding({ x: b.x, z: b.z }, b), false, `${b.id} interior`);
    assert.equal(canUseBuilding({ x: NaN, z: point.z }, b), false);
  }
  for (const site of PLOTS) for (const type of [null, ...Object.keys(BUILDING_TYPES)]) {
    const state = { id: site.id, building: type, hp: type ? 300 : 0 }, point = plotEntrance(site, state);
    assert.ok(canStand(point.x, point.z, .48, plotSolids([state])), `${site.id} ${type} approach is clear`);
    assert.ok(canUsePlot(point, site, state));
    assert.equal(canUsePlot(opposite(site, point), site, state), false, `${site.id} ${type} rear`);
    assert.equal(canUsePlot(site, site, state), false, `${site.id} ${type} interior`);
  }
});

test('bank and market transactions recheck their own doorway on every request and remain atomic after walking away', () => {
  const cases = [
    { kind: 'deposit', amount: 1 }, { kind: 'withdraw', amount: 1 },
    { kind: 'sell', resource: 'wheat', amount: 1, minTotal: 1 },
    { kind: 'buyResource', resource: 'wheat', amount: 1, maxTotal: 100 },
    { kind: 'donate' }, { kind: 'loan', amount: 10 }, { kind: 'repayLoan', amount: 10 },
    { kind: 'propose_policy', policy: 'tradeTax', value: 10 }, { kind: 'worker_hire' }
  ];
  for (const action of cases) {
    const f = fixture(), bank = building(['sell', 'buyResource', 'donate'].includes(action.kind) ? 'market' : 'bank'), entrance = buildingEntrance(bank);
    Object.assign(f.p, opposite(bank, entrance)); rejectedWithoutMutation(f, action);
    Object.assign(f.p, entrance); assert.doesNotThrow(() => f.act(action), action.kind);
    Object.assign(f.p, { x: bank.x, z: bank.z + bank.d / 2 + 1 });
    rejectedWithoutMutation(f, action);
  }
});

test('bank finance and exchange resource services cannot be used from each other’s entrance', () => {
  for (const action of [
    { kind: 'sell', resource: 'wheat', amount: 1, minTotal: 1 },
    { kind: 'buyResource', resource: 'wheat', amount: 1, maxTotal: 100 },
    { kind: 'donate' }, { kind: 'donate', targetId: 'bank' }
  ]) {
    const f = fixture(); Object.assign(f.p, buildingEntrance(building('bank')));
    rejectedWithoutMutation(f, action, /Resource Exchange/);
    Object.assign(f.p, buildingEntrance(building('market'))); assert.doesNotThrow(() => f.act(action));
  }
  for (const action of [{ kind: 'deposit', amount: 1 }, { kind: 'withdraw', amount: 1 }, { kind: 'loan', amount: 10 }, { kind: 'repayLoan', amount: 10 }, { kind: 'worker_hire' }]) {
    const f = fixture(); Object.assign(f.p, buildingEntrance(building('market')));
    rejectedWithoutMutation(f, action, /Treasury/);
    Object.assign(f.p, buildingEntrance(building('bank'))); assert.doesNotThrow(() => f.act(action));
  }
});

test('starter shops, barracks, stables and merchant enforce front access authoritatively', () => {
  const cases = [
    ['tools', { kind: 'buyTool', tool: 'axe' }], ['tools', { kind: 'buyBackpack', tier: 1 }],
    ['food', { kind: 'buyFood', tier: 'food' }], ['barracks', { kind: 'donate', targetId: 'barracks' }],
    ['stable', { kind: 'buyHorse' }], ['merchant', { kind: 'merchant_buy', resource: 'arrows', amount: 1 }]
  ];
  for (const [id, action] of cases) {
    const f = fixture(), b = building(id), point = buildingEntrance(b);
    f.v.stable.stock = 1; f.v.merchant.present = true; f.v.merchant.lastVisitDay = f.v.day; f.v.merchant.stock.arrows = 2;
    if (action.kind === 'buyBackpack') f.p.backpackTier = 0;
    Object.assign(f.p, opposite(b, point)); rejectedWithoutMutation(f, action);
    Object.assign(f.p, point); assert.doesNotThrow(() => f.act(action), action.kind);
  }
});

test('plot purchases, crafting and owner controls use the current building entrance', () => {
  const actions = [
    { kind: 'plot_deposit', resource: 'wheat', amount: 1 },
    { kind: 'plot_withdraw', resource: 'wheat', amount: 1 },
    { kind: 'craft_buy', recipe: 'stone_axe' }, { kind: 'plot_access', allowVisitors: false },
    { kind: 'plot_demolish', confirm: true }
  ];
  for (const action of actions) {
    const f = fixture(), site = PLOTS[0], plot = f.v.plots[0];
    Object.assign(plot, { ownerId: f.p.id, building: 'tool_shop', hp: 300, maxHp: 300 });
    if (action.kind !== 'plot_demolish') Object.assign(plot.storage, { wheat: 2, stone: 10, timber: 5 });
    const request = { ...action, plotId: plot.id }, entrance = plotEntrance(site, plot);
    Object.assign(f.p, opposite(site, entrance)); rejectedWithoutMutation(f, request);
    Object.assign(f.p, entrance); assert.doesNotThrow(() => f.act(request), action.kind);
  }
  const f = fixture(), site = PLOTS[0], plot = f.v.plots[0];
  Object.assign(f.p, { x: site.x, z: site.z }); rejectedWithoutMutation(f, { kind: 'plot_buy', plotId: plot.id });
  Object.assign(f.p, plotEntrance(site, plot)); f.act({ kind: 'plot_buy', plotId: plot.id });
  Object.assign(plot.storage, { stone: 50, timber: 50 });
  f.act({ kind: 'plot_build', plotId: plot.id, building: 'house' });
  rejectedWithoutMutation(f, { kind: 'plot_deposit', plotId: plot.id, resource: 'wheat', amount: 1 });
  Object.assign(f.p, plotEntrance(site, plot)); f.act({ kind: 'plot_deposit', plotId: plot.id, resource: 'wheat', amount: 1 });
});

test('church care works at a physical bed, upgrades require the door, and repairs still work beside walls', () => {
  const f = fixture('priest'), site = PLOTS[0], plot = f.v.plots[0];
  Object.assign(plot, { ownerId: f.p.id, building: 'church', hp: 200, maxHp: 300, level: 2 });
  f.p.hp = 50; f.p.tool = 'hammer'; f.p.durability.hammer = 100;
  Object.assign(f.p, plotBedPoint(site, 3));
  assert.ok(canUseChurchBed(f.p, site, plot)); assert.equal(canUsePlot(f.p, site, plot), false);
  rejectedWithoutMutation(f, { kind: 'upgradeDefense', plotId: plot.id });
  f.act({ kind: 'churchTreat', plotId: plot.id }); assert.equal(f.p.bedPlotId, plot.id);
  f.act({ kind: 'churchLeave' });
  Object.assign(f.p, { x: site.x, z: site.z + 4.5 });
  assert.equal(canUsePlot(f.p, site, plot), false); assert.equal(canUseChurchBed(f.p, site, plot), false);
  rejectedWithoutMutation(f, { kind: 'churchTreat', plotId: plot.id });
  const hp = plot.hp; f.act({ kind: 'repairPlot', plotId: plot.id }); assert.ok(plot.hp > hp);
  const keep = building('keep'); Object.assign(f.p, { x: keep.x + keep.w / 2 + 1, z: keep.z }); f.v.keep.hp -= 100;
  assert.equal(canUseBuilding(f.p, keep), false); f.act({ kind: 'repair', targetId: 'keep' });
  assert.equal(f.v.keep.hp, f.v.keep.maxHp - 65);
});

test('recruitment and defense upgrades cannot use a barracks from behind', () => {
  for (const kind of ['recruitGuard', 'upgradeDefense']) {
    const f = fixture('guard'), site = PLOTS[20], plot = f.v.plots[20];
    Object.assign(plot, { ownerId: f.p.id, building: 'barracks', hp: 300, maxHp: 300 });
    Object.assign(plot.storage, { timber: 100, stone: 100, iron: 100 });
    const entrance = plotEntrance(site, plot), action = { kind, plotId: plot.id };
    Object.assign(f.p, opposite(site, entrance)); rejectedWithoutMutation(f, action);
    Object.assign(f.p, entrance); f.act(action);
    assert.ok(kind === 'recruitGuard' ? f.v.guards.some(g => g.plotId === plot.id) : plot.level === 2);
  }
});
