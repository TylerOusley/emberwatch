import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingEntrance } from '../shared/access.js';
import { BUILDINGS } from '../shared/world.js';
import { FOOD, MERCHANT_EXPORT_PERCENTAGES, MERCHANT_EXPORT_PRICES, merchantExportPercent, foodQuote, taxedSaleQuote, taxedPurchaseQuote } from '../shared/economy.js';
import { MAX_TRADE_AMOUNT, RESOURCE_MARKET } from '../shared/market.js';
import { carryCapacity } from '../shared/content.js';
import { ensureEconomy, economyAction, economyDawn, economySnapshot, exportReserves, stewardReview } from '../server/economy.js';

function fixture(roles = ['villager']) {
  const players = Object.fromEntries(roles.map((role, i) => [`p${i}`, { id: `p${i}`, name: `Dwarf ${i}`, role, online: true, hp: 100, maxHp: 100, wallet: 500, inventory: {}, durability: {}, hunger: 10, participated: 720, jobBonus: 0 }]));
  const v = { id: 'village', clock: 100, day: 1, phase: 'day', treasury: 2500, players, plots: [], stock: { wheat: 100, timber: 150, stone: 100 }, gate: { hp: 1200, maxHp: 1200 }, keep: { hp: 2000, maxHp: 2000 }, guards: [{ hp: 100 }, { hp: 100 }], zombies: [] };
  const sim = { daySeconds: 480, nightSeconds: 240, notice() {} };
  ensureEconomy(v);
  const p = players.p0;
  visit(p, 'bank');
  return { v, p, sim };
}
function visit(p, id) {
  const b = BUILDINGS.find(item => item.id === id);
  assert.ok(b, `${id} has a mapped service`);
  Object.assign(p, buildingEntrance(b));
}
function rejected(v, fn, pattern) {
  const before = structuredClone(v);
  assert.throws(fn, pattern);
  assert.deepEqual(v, before, 'validation must precede any economic mutation');
}

test('taxed market transfers real items and money and buying back cannot mint gold', () => {
  const { v, p, sim } = fixture();
  visit(p, 'market'); p.inventory.wheat = 60; v.stock.wheat = 24;
  const quote = taxedSaleQuote('wheat', 24, 60, 5);
  assert.deepEqual(quote, { gross: 181, tax: 9, total: 172 });
  const wealth = v.treasury + p.wallet, wallet = p.wallet;
  economyAction(sim, v, p, { kind: 'sell', resource: 'wheat', amount: 60, minTotal: quote.total });
  assert.equal(v.stock.wheat, 84); assert.equal(p.inventory.wheat, 0);
  assert.equal(p.wallet, wallet + quote.total); assert.equal(v.treasury + p.wallet, wealth);
  const buy = taxedPurchaseQuote('wheat', 84, 60, 5);
  economyAction(sim, v, p, { kind: 'buyResource', resource: 'wheat', amount: 60, maxTotal: buy.total });
  assert.equal(v.stock.wheat, 24); assert.equal(p.inventory.wheat, 60);
  assert.ok(p.wallet < wallet, 'market spread and tax prevent round-trip profits');
  assert.equal(v.treasury + p.wallet, wealth);
});

test('quotes, stock and whole numbers are validated atomically; purchased goods may encumber players', () => {
  const { v, p, sim } = fixture();
  visit(p, 'market'); p.inventory.wheat = 5;
  for (const amount of [0, -1, 1.2, '2', Infinity, MAX_TRADE_AMOUNT + 1]) rejected(v, () => economyAction(sim, v, p, { kind: 'sell', resource: 'wheat', amount, minTotal: 1 }), /whole amount/);
  for (const resource of ['food', '__proto__', 'constructor']) rejected(v, () => economyAction(sim, v, p, { kind: 'sell', resource, amount: 1, minTotal: 1 }), /Choose/);
  rejected(v, () => economyAction(sim, v, p, { kind: 'sell', resource: 'wheat', amount: 2, minTotal: 99 }), /price changed/);
  v.treasury = 500;
  rejected(v, () => economyAction(sim, v, p, { kind: 'sell', resource: 'wheat', amount: 1, minTotal: 1 }), /essential expenses/);
  const heavyAmount = Math.floor(carryCapacity(p) / 3) + 1;
  economyAction(sim, v, p, { kind: 'buyResource', resource: 'stone', amount: heavyAmount, maxTotal: 1000 });
  assert.equal(p.inventory.stone, heavyAmount);
  rejected(v, () => economyAction(sim, v, p, { kind: 'buyResource', resource: 'iron', amount: 1, maxTotal: 1000 }), /not have enough/);
  rejected(v, () => economyAction(sim, v, p, { kind: 'buyResource', resource: 'wheat', amount: 1, maxTotal: 1 }), /price changed/);
});

test('all food tiers consume wheat only on purchase and restore hunger only on eating', () => {
  for (const [tier, spec] of Object.entries(FOOD)) {
    const { v, p, sim } = fixture(); visit(p, 'food');
    const wheat = v.stock.wheat, wallet = p.wallet, treasury = v.treasury, price = foodQuote(wheat, tier).price;
    economyAction(sim, v, p, { kind: 'buyFood', tier });
    assert.equal(v.stock.wheat, wheat - spec.wheat); assert.equal(p.wallet, wallet - price);
    assert.equal(v.treasury, treasury + price); assert.equal(p.inventory[tier], 1); assert.equal(p.hunger, 10);
    economyAction(sim, v, p, { kind: 'eat', tier });
    assert.equal(p.inventory[tier], 0); assert.equal(p.hunger, Math.min(100, 10 + spec.hunger));
    assert.equal(v.stock.wheat, wheat - spec.wheat); assert.equal(p.wallet, wallet - price);
    rejected(v, () => economyAction(sim, v, p, { kind: 'eat', tier }), /Buy food/);
  }
  assert.ok(foodQuote(10, 'food').price > foodQuote(1500, 'food').price, 'scarce wheat cannot be sold dearly and baked at a fixed subsidized loss');
});

test('a role majority does not override the steward when there is no need for a raise', () => {
  const { v, p, sim } = fixture(['guard', 'guard', 'guard', 'villager']);
  economyAction(sim, v, p, { kind: 'propose_policy', policy: 'guardWage', value: 30 });
  const proposal = v.proposals[0];
  assert.equal(proposal.required, 3);
  economyAction(sim, v, v.players.p1, { kind: 'vote_policy', proposalId: proposal.id, approve: true });
  economyAction(sim, v, v.players.p2, { kind: 'vote_policy', proposalId: proposal.id, approve: true });
  assert.equal(proposal.status, 'vetoed'); assert.match(proposal.reason, /no current combat shortage/);
  assert.equal(v.policies.guardWage, 25);
  v.zombies = [{ hp: 10 }];
  assert.equal(stewardReview(v, 'guardWage', 30).approved, false, 'one straggler does not justify a raise for three guards plus the watch');
});

test('a needed affordable raise takes effect next dawn and a changed budget triggers re-review', () => {
  const { v, p, sim } = fixture(['priest']);
  p.hp = 50;
  economyAction(sim, v, p, { kind: 'propose_policy', policy: 'priestWage', value: 30 });
  assert.equal(v.proposals[0].status, 'approved'); assert.equal(v.policies.priestWage, 25);
  v.day++; economyDawn(sim, v);
  assert.equal(v.policies.priestWage, 30); assert.equal(v.proposals[0].status, 'applied');
  v.clock += 61;
  economyAction(sim, v, p, { kind: 'propose_policy', policy: 'priestWage', value: 35 });
  assert.equal(v.proposals[1].status, 'approved');
  v.treasury = 510; v.day++; economyDawn(sim, v);
  assert.equal(v.policies.priestWage, 30); assert.equal(v.proposals[1].status, 'vetoed');
  assert.match(v.proposals[1].reason, /Conditions changed/);
});

test('bonuses and service income count against unnecessary wage increases', () => {
  const { v, p } = fixture(['guard']);
  v.policies.guardWage = 30; v.gate.hp = 100; p.jobBonus = 10; p.cycleServiceIncome = 20;
  const review = stewardReview(v, 'guardWage', 35);
  assert.equal(review.approved, false); assert.match(review.reason, /already earn about 60 gold/);
  p.jobBonus = 0; p.cycleServiceIncome = 0; v.treasury = 510; p.bank = 100000;
  assert.equal(stewardReview(v, 'guardWage', 35).approved, false, 'personal savings cannot fund public payroll');
});

test('ties retain policy and voters cannot vote twice or join an already opened electorate', () => {
  const { v, p, sim } = fixture(['villager', 'villager', 'villager', 'villager']);
  economyAction(sim, v, p, { kind: 'propose_policy', policy: 'tradeTax', value: 0 });
  const proposal = v.proposals[0];
  economyAction(sim, v, v.players.p1, { kind: 'vote_policy', proposalId: proposal.id, approve: true });
  economyAction(sim, v, v.players.p2, { kind: 'vote_policy', proposalId: proposal.id, approve: false });
  economyAction(sim, v, v.players.p3, { kind: 'vote_policy', proposalId: proposal.id, approve: false });
  rejected(v, () => economyAction(sim, v, p, { kind: 'vote_policy', proposalId: proposal.id, approve: true }), /already voted/);
  const outsider = { ...p, id: 'late' };
  rejected(v, () => economyAction(sim, v, outsider, { kind: 'vote_policy', proposalId: proposal.id, approve: true }), /active when/);
  const snapshot = economySnapshot(v, p.id);
  assert.equal(snapshot.proposals[0].yes, 2); assert.equal(snapshot.proposals[0].no, 2);
  assert.equal(snapshot.proposals[0].myVote, true); assert.equal(snapshot.proposals[0].canVote, false);
  v.day++; economyDawn(sim, v);
  assert.equal(proposal.status, 'rejected'); assert.equal(v.policies.tradeTax, 5);
});

test('land taxes scale by holdings, prorate activity, leave offline holdings alone and track unpaid tax', () => {
  const { v, p, sim } = fixture(['villager', 'villager', 'villager']);
  p.wallet = 3; v.players.p1.online = false; v.players.p1.participated = 0; v.players.p2.participated = 360;
  v.plots = [{ ownerId: p.id }, { ownerId: p.id }, { ownerId: 'p1' }, { ownerId: 'p2' }];
  v.day++; economyDawn(sim, v);
  assert.equal(p.wallet, 0); assert.equal(p.landDebt, 5, 'two holdings cost 2 × 2² = 8 per full active cycle');
  assert.equal(v.players.p1.wallet, 500); assert.equal(v.players.p1.landDebt, 0);
  assert.equal(v.players.p2.wallet, 499, 'half a cycle pays half the one-plot tax');
  assert.equal(v.plots.filter(plot => plot.ownerId === p.id).length, 2, 'arrears do not silently confiscate land');
  const saved = JSON.stringify(v); economyDawn(sim, v); assert.equal(JSON.stringify(v), saved, 'dawn is idempotent');
  p.wallet = 4; economyAction(sim, v, p, { kind: 'pay_land_debt' }); assert.equal(p.landDebt, 1); assert.equal(p.wallet, 0);
});

test('merchant visits every other dawn, exports only surplus, and restocks only an empty stable', () => {
  const { v, sim } = fixture();
  v.stock = { wheat: 1000, timber: 1000, stone: 1000, iron: 5, coal: 5 };
  v.gate.hp = 0; v.keep.hp = 0;
  v.day = 2; economyDawn(sim, v); assert.equal(v.merchant.present, false); assert.equal(v.stable.stock, 0);
  const reserve = exportReserves(v), original = { ...v.stock };
  v.day = 3; economyDawn(sim, v);
  assert.equal(v.merchant.present, true); assert.equal(v.stable.stock, 3); assert.equal(v.merchant.visits, 1);
  for (const id of ['wheat', 'timber', 'stone']) { assert.ok(v.stock[id] >= reserve[id]); assert.ok(v.stock[id] < original[id]); }
  assert.equal(v.stock.iron, 3); assert.equal(v.stock.coal, 3); assert.equal(v.stock.sulfur, 0);
  assert.equal(Object.keys(v.merchant.stock).length, 2, 'each visit offers a random subset');
  for (const [id, stock] of Object.entries(v.merchant.stock)) {
    assert.equal(stock, { iron: 30, coal: 30, arrows: 60 }[id]);
    assert.ok(v.merchant.prices[id] < { iron: 9, coal: 7, arrows: 3 }[id], `${id} is discounted`);
  }
  const saved = JSON.stringify(v); economyDawn(sim, v); assert.equal(JSON.stringify(v), saved);
  v.stable.stock = 1; v.day = 4; economyDawn(sim, v); assert.equal(v.merchant.present, false);
  v.day = 5; economyDawn(sim, v); assert.equal(v.stable.stock, 1, 'a partially stocked stable is not topped up automatically');
  v.phase = 'night'; assert.equal(economySnapshot(v, 'p0').merchant.present, false);
});

test('merchant preserves scarce basic stock and a tight treasury cannot buy horses', () => {
  const { v, sim } = fixture(['guard']);
  v.treasury = 560; v.stock.wheat = 2; v.stock.timber = 3; v.stock.stone = 4;
  v.day = 3; economyDawn(sim, v);
  assert.equal(v.stable.stock, 0); assert.equal(v.treasury, 560);
  assert.equal(v.stock.wheat, 2); assert.equal(v.stock.timber, 3); assert.equal(v.stock.stone, 4);
  assert.match(v.merchant.summary, /No surplus/);
});

test('merchant export percentages preserve saved policy choices and use a safe default', () => {
  assert.deepEqual(MERCHANT_EXPORT_PERCENTAGES, { conserve: 25, balanced: 50, trade: 100 });
  assert.equal(Object.isFrozen(MERCHANT_EXPORT_PERCENTAGES), true);
  for (const [priority, percent] of Object.entries(MERCHANT_EXPORT_PERCENTAGES)) {
    const { v } = fixture();
    v.policies.exportPriority = priority;
    ensureEconomy(v);
    assert.equal(v.policies.exportPriority, priority);
    assert.equal(merchantExportPercent(priority), percent);
  }
  for (const unknown of [undefined, null, '', 'unknown', '__proto__', 'constructor', {}]) assert.equal(merchantExportPercent(unknown), 50);
});

for (const [priority, percent] of Object.entries({ conserve: 25, balanced: 50, trade: 100 })) {
  test(`${priority} exports ${percent}% of each surplus without a 120-unit cap`, () => {
    const { v, sim } = fixture();
    v.policies.exportPriority = priority; v.stable.stock = 1;
    const reserves = exportReserves(v), surplus = { wheat: 1003, timber: 2003, stone: 3003, iron: 4003, coal: 5003, sulfur: 6003 };
    const unitPrices = { wheat: 1, timber: 2, stone: 2, iron: 3, coal: 2, sulfur: 2 };
    for (const id of Object.keys(surplus)) v.stock[id] = (reserves[id] ?? 0) + surplus[id];
    const treasury = v.treasury;
    v.day = 3; economyDawn(sim, v);
    let proceeds = 0;
    for (const [id, excess] of Object.entries(surplus)) {
      const sold = Math.floor(excess * percent / 100);
      assert.ok(sold > 120, `${id} must not be restricted by the old cap`);
      assert.equal(v.stock[id], (reserves[id] ?? 0) + excess - sold);
      assert.ok(v.stock[id] >= (reserves[id] ?? 0));
      proceeds += sold * unitPrices[id];
    }
    assert.equal(proceeds, { conserve: 11250, balanced: 22512, trade: 45036 }[priority]);
    assert.equal(v.economy.lastExportGold, proceeds); assert.equal(v.treasury, treasury + proceeds);
    assert.match(v.merchant.summary, new RegExp(`Exported ${percent}% of surplus:`));
    const saved = JSON.stringify(v), reloaded = JSON.parse(saved);
    economyDawn(sim, reloaded);
    assert.equal(JSON.stringify(reloaded), saved, 'a saved dawn must not repeat an uncapped export');
  });

  test(`${priority} rounds exports down after protecting food and repair reserves`, () => {
    const { v, sim } = fixture();
    v.policies.exportPriority = priority; v.stable.stock = 1;
    const reserves = exportReserves(v), divisor = 100 / percent;
    Object.assign(v.stock, { wheat: reserves.wheat + divisor - 1, timber: reserves.timber + divisor * 2 - 1, stone: reserves.stone + divisor * 3 - 1, iron: divisor - 1, coal: divisor * 2 - 1, sulfur: divisor * 3 - 1 });
    const before = { ...v.stock }, treasury = v.treasury;
    v.day = 3; economyDawn(sim, v);
    assert.equal(v.stock.wheat, before.wheat, 'less than a whole export unit remains in stock');
    assert.equal(v.stock.timber, before.timber - 1);
    assert.equal(v.stock.stone, before.stone - 2);
    assert.equal(v.stock.iron, before.iron, 'fractional iron exports round down to zero');
    assert.equal(v.stock.coal, before.coal - 1); assert.equal(v.stock.sulfur, before.sulfur - 2);
    assert.equal(v.economy.lastExportGold, 12); assert.equal(v.treasury, treasury + 12);
  });
}

test('merchant export prices cover the complete resource market including ingots and preserve basic rates', () => {
  assert.deepEqual(MERCHANT_EXPORT_PRICES, { wheat: 1, timber: 2, stone: 2, iron: 3, iron_ingot: 6, steel_ingot: 10, coal: 2, sulfur: 2 });
  assert.equal(Object.isFrozen(MERCHANT_EXPORT_PRICES), true);
  assert.deepEqual(Object.keys(MERCHANT_EXPORT_PRICES).sort(), Object.keys(RESOURCE_MARKET).sort());
});

test('food and repair reserves retain their existing values while ores have no reserve', () => {
  const { v } = fixture();
  v.gate.hp = 0; v.keep.hp = 0;
  v.plots = [{ building: 'archer_tower' }, { building: 'cannon' }, { building: 'barracks' }];
  assert.deepEqual(exportReserves(v), { wheat: 80, timber: 157, stone: 112 });
  v.policies.exportPriority = 'conserve';
  assert.deepEqual(exportReserves(v), { wheat: 160, timber: 314, stone: 224 });
});

test('every raw resource exports independently of which wares the merchant offers', () => {
  const { v, sim } = fixture();
  v.policies.exportPriority = 'trade'; v.stable.stock = 1;
  const omitted = new Set();
  for (const day of [3, 5, 7, 9, 11, 13]) {
    Object.assign(v.stock, exportReserves(v), { iron: 151, coal: 152, sulfur: 153 });
    const treasury = v.treasury;
    v.day = day; economyDawn(sim, v);
    for (const resource of ['iron', 'coal', 'sulfur']) {
      assert.equal(v.stock[resource], 0, `${resource} exports on day ${day}`);
      assert.match(v.merchant.summary, new RegExp(`\\b${resource}\\b`));
      if (!Object.hasOwn(v.merchant.stock, resource)) omitted.add(resource);
    }
    assert.equal(v.economy.lastExportGold, 1063);
    assert.equal(v.treasury, treasury + 1063);
    assert.equal(Object.keys(v.merchant.stock).length, 2);
    assert.equal(Object.hasOwn(v.merchant.stock, 'sulfur'), false, 'exporting sulfur does not add it to wares for sale');
  }
  assert.deepEqual([...omitted].sort(), ['coal', 'iron', 'sulfur'], 'each ore exported even on visits that did not sell it');
});

test('new and saved villages with missing ore stock safely default to zero on a merchant visit', () => {
  for (const reload of [false, true]) {
    const fixtureData = fixture(), sim = fixtureData.sim;
    fixtureData.v.stock = { wheat: 80, timber: 100, stone: 80 };
    const v = reload ? JSON.parse(JSON.stringify(fixtureData.v)) : fixtureData.v;
    v.stable.stock = 1;
    const treasury = v.treasury;
    v.day = 3; economyDawn(sim, v);
    assert.deepEqual(v.stock, { wheat: 80, timber: 100, stone: 80, iron: 0, iron_ingot: 0, steel_ingot: 0, coal: 0, sulfur: 0 });
    assert.equal(v.economy.lastExportGold, 0); assert.equal(v.treasury, treasury);
    assert.match(v.merchant.summary, /No surplus/);
  }
});

test('exports leave crafted and unknown public items and all private supplies untouched', () => {
  const { v, p, sim } = fixture();
  v.policies.exportPriority = 'trade'; v.policies.landTax = 0; v.stable.stock = 1;
  Object.assign(v.stock, exportReserves(v), { iron: 10, coal: 20, sulfur: 30, food: 40, arrows: 50, gunpowder: 60, musket_ammo: 70, gold_ore: 80, unknown_resource: 90 });
  Object.assign(p.inventory, { wheat: 11, timber: 12, stone: 13, iron: 14, coal: 15, sulfur: 16, gunpowder: 17 });
  v.plots = [{ ownerId: p.id, building: 'tinker_shop', storage: { wheat: 21, timber: 22, stone: 23, iron: 24, coal: 25, sulfur: 26, gunpowder: 27 } }];
  v.civic = { depot: { timber: 31, stone: 32, iron: 33, coal: 34, sulfur: 35, arrows: 36, gold: 500 } };
  const inventory = structuredClone(p.inventory), plots = structuredClone(v.plots), civic = structuredClone(v.civic), wallet = p.wallet, treasury = v.treasury;
  v.day = 3; economyDawn(sim, v);
  assert.deepEqual(p.inventory, inventory); assert.deepEqual(v.plots, plots); assert.deepEqual(v.civic, civic); assert.equal(p.wallet, wallet);
  for (const [id, count] of Object.entries({ food: 40, arrows: 50, gunpowder: 60, musket_ammo: 70, gold_ore: 80, unknown_resource: 90 })) assert.equal(v.stock[id], count, id);
  for (const id of ['iron', 'coal', 'sulfur']) assert.equal(v.stock[id], 0);
  assert.equal(v.economy.lastExportGold, 130); assert.equal(v.treasury, treasury + 130);
});

test('an overflowing ore payment retains the complete mixed shipment without partial sales', () => {
  for (const overflowingPayment of [false, true]) {
    const { v, sim } = fixture();
    v.policies.exportPriority = 'trade'; v.stable.stock = 1;
    const reserves = exportReserves(v);
    Object.assign(v.stock, { wheat: reserves.wheat + 1, timber: reserves.timber + 1, stone: reserves.stone + 1, iron: overflowingPayment ? Number.MAX_SAFE_INTEGER : 1, coal: 1, sulfur: 1 });
    // The five-gold basics fit, but the full twelve-gold shipment does not.
    if (!overflowingPayment) v.treasury = Number.MAX_SAFE_INTEGER - 5;
    const stock = { ...v.stock }, treasury = v.treasury;
    v.day = 3; economyDawn(sim, v);
    assert.deepEqual(v.stock, stock); assert.equal(v.treasury, treasury);
    assert.equal(v.economy.lastExportGold, 0);
    assert.match(v.merchant.summary, /treasury cannot accept.*supplies were retained/);
  }
});

test('an approved export policy applies before that dawn’s percentage sale', () => {
  const { v, p, sim } = fixture();
  v.day = 2; v.stable.stock = 1;
  Object.assign(v.stock, { wheat: 1000, timber: 1000, stone: 1000, iron: 1000, coal: 1000, sulfur: 1000 });
  economyAction(sim, v, p, { kind: 'propose_policy', policy: 'exportPriority', value: 'trade' });
  assert.equal(v.proposals[0].status, 'approved'); assert.equal(v.policies.exportPriority, 'balanced');
  v.day = 3; economyDawn(sim, v);
  assert.equal(v.proposals[0].status, 'applied'); assert.equal(v.policies.exportPriority, 'trade');
  const reserves = exportReserves(v);
  for (const id of Object.keys(RESOURCE_MARKET)) assert.equal(v.stock[id], reserves[id] ?? 0);
  assert.match(v.merchant.summary, /Exported 100% of surplus:/);
});

test('council can increase or decrease every export percentage through a majority vote at dawn', () => {
  const priorities = ['conserve', 'balanced', 'trade'];
  for (const current of priorities) for (const proposed of priorities) {
    if (current === proposed) continue;
    const { v, p, sim } = fixture(['villager', 'wizard', 'guard']);
    v.day = 2; v.stable.stock = 1; v.policies.exportPriority = current;
    Object.assign(v.stock, Object.fromEntries(Object.keys(RESOURCE_MARKET).map(resource => [resource, 1000])));
    economyAction(sim, v, p, { kind: 'propose_policy', policy: 'exportPriority', value: proposed });
    const proposal = v.proposals.at(-1);
    assert.equal(proposal.required, 2);
    assert.equal(proposal.status, 'voting', `${current} → ${proposed} awaits a majority`);
    assert.equal(v.policies.exportPriority, current);
    economyAction(sim, v, v.players.p1, { kind: 'vote_policy', proposalId: proposal.id, approve: true });
    assert.equal(proposal.status, 'approved');
    assert.equal(v.policies.exportPriority, current, 'approved changes wait for dawn');
    v.day = 3; economyDawn(sim, v);
    assert.equal(proposal.status, 'applied');
    assert.equal(v.policies.exportPriority, proposed, `${current} → ${proposed} takes effect`);
    const reserves = exportReserves(v), percent = merchantExportPercent(proposed);
    for (const resource of Object.keys(RESOURCE_MARKET)) {
      const reserve = reserves[resource] ?? 0;
      assert.equal(v.stock[resource], 1000 - Math.floor((1000 - reserve) * percent / 100), 'merchant uses the newly approved percentage and reserve');
    }
  }
});

test('uncapped exports retain the entire shipment when its gold cannot fit safely', () => {
  for (const excessivePayment of [false, true]) {
    const { v, sim } = fixture();
    v.policies.exportPriority = 'trade'; v.stable.stock = 1;
    const reserves = exportReserves(v);
    Object.assign(v.stock, { wheat: reserves.wheat + 10, timber: excessivePayment ? Number.MAX_SAFE_INTEGER : reserves.timber + 10, stone: reserves.stone + 10 });
    if (!excessivePayment) v.treasury = Number.MAX_SAFE_INTEGER - 49;
    const stock = { ...v.stock }, treasury = v.treasury;
    v.day = 3; economyDawn(sim, v);
    assert.deepEqual(v.stock, stock, 'no part of an unpayable shipment may leave storage');
    assert.equal(v.treasury, treasury); assert.equal(v.economy.lastExportGold, 0);
    assert.match(v.merchant.summary, /treasury cannot accept.*supplies were retained/);
  }
});

test('percentage exports stay exact for large representable stock and payments', () => {
  for (const [priority, percent] of Object.entries(MERCHANT_EXPORT_PERCENTAGES)) {
    const { v, sim } = fixture();
    v.policies.exportPriority = priority; v.stable.stock = 1; v.treasury = 0;
    const reserves = exportReserves(v);
    Object.assign(v.stock, reserves, { wheat: Number.MAX_SAFE_INTEGER });
    const expected = Number((BigInt(Number.MAX_SAFE_INTEGER) - BigInt(reserves.wheat)) * BigInt(percent) / 100n);
    v.day = 3; economyDawn(sim, v);
    assert.equal(v.stock.wheat, Number.MAX_SAFE_INTEGER - expected);
    assert.equal(v.stock.timber, reserves.timber); assert.equal(v.stock.stone, reserves.stone);
    assert.equal(v.economy.lastExportGold, expected); assert.equal(v.treasury, expected);
    assert.equal(Number.isSafeInteger(v.treasury), true);
  }
});

test('specialist merchant purchases are finite, local and never import basic resources', () => {
  const { v, p, sim } = fixture();
  v.day = 3; economyDawn(sim, v); visit(p, 'merchant');
  const price = v.merchant.prices.iron;
  economyAction(sim, v, p, { kind: 'merchant_buy', resource: 'iron', amount: 2 });
  assert.equal(p.inventory.iron, 2); assert.equal(v.merchant.stock.iron, 28); assert.equal(p.wallet, 500 - price * 2);
  for (const resource of ['wheat', 'timber', 'stone', 'iron_pickaxe', '__proto__']) rejected(v, () => economyAction(sim, v, p, { kind: 'merchant_buy', resource, amount: 1 }), /offered/);
  rejected(v, () => economyAction(sim, v, p, { kind: 'merchant_buy', resource: 'iron', amount: -5 }), /whole amount/);
  v.phase = 'night'; rejected(v, () => economyAction(sim, v, p, { kind: 'merchant_buy', resource: 'iron', amount: 1 }), /returns/);
});

test('Quick Sell sells every affordable carried raw resource without touching food or equipment', () => {
  const { v, p, sim } = fixture(); visit(p, 'market');
  Object.assign(p.inventory, { wheat: 8, timber: 5, stone: 3, iron: 2, coal: 1, food: 4, arrows: 9 });
  const before = v.treasury + p.wallet;
  const message = economyAction(sim, v, p, { kind: 'sell_all' });
  assert.match(message, /Quick sold/);
  for (const id of ['wheat', 'timber', 'stone', 'iron', 'coal']) assert.equal(p.inventory[id], 0, id);
  assert.equal(p.inventory.food, 4); assert.equal(p.inventory.arrows, 9);
  assert.equal(v.treasury + p.wallet, before, 'sale conserves gold');
});
