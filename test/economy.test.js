import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingEntrance } from '../shared/access.js';
import { BUILDINGS } from '../shared/world.js';
import { FOOD, foodQuote, taxedSaleQuote, taxedPurchaseQuote } from '../shared/economy.js';
import { MAX_TRADE_AMOUNT } from '../shared/market.js';
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
  p.inventory.wheat = 60; v.stock.wheat = 24;
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

test('quotes, stock, carry capacity and whole numbers are validated atomically', () => {
  const { v, p, sim } = fixture();
  p.inventory.wheat = 5;
  for (const amount of [0, -1, 1.2, '2', Infinity, MAX_TRADE_AMOUNT + 1]) rejected(v, () => economyAction(sim, v, p, { kind: 'sell', resource: 'wheat', amount, minTotal: 1 }), /whole amount/);
  for (const resource of ['food', '__proto__', 'constructor']) rejected(v, () => economyAction(sim, v, p, { kind: 'sell', resource, amount: 1, minTotal: 1 }), /Choose/);
  rejected(v, () => economyAction(sim, v, p, { kind: 'sell', resource: 'wheat', amount: 2, minTotal: 99 }), /price changed/);
  v.treasury = 500;
  rejected(v, () => economyAction(sim, v, p, { kind: 'sell', resource: 'wheat', amount: 1, minTotal: 1 }), /essential expenses/);
  rejected(v, () => economyAction(sim, v, p, { kind: 'buyResource', resource: 'stone', amount: Math.floor(carryCapacity(p) / 3) + 1, maxTotal: 1000 }), /pack is full/);
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
  assert.equal(v.stock.iron, 5); assert.equal(v.stock.coal, 5);
  assert.deepEqual(v.merchant.stock, { iron: 30, coal: 30, arrows: 60 });
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

test('specialist merchant purchases are finite, local and never import basic resources', () => {
  const { v, p, sim } = fixture();
  v.day = 3; economyDawn(sim, v); visit(p, 'merchant');
  economyAction(sim, v, p, { kind: 'merchant_buy', resource: 'iron', amount: 2 });
  assert.equal(p.inventory.iron, 2); assert.equal(v.merchant.stock.iron, 28); assert.equal(p.wallet, 482);
  for (const resource of ['wheat', 'timber', 'stone', 'iron_pickaxe', '__proto__']) rejected(v, () => economyAction(sim, v, p, { kind: 'merchant_buy', resource, amount: 1 }), /Basic resources/);
  rejected(v, () => economyAction(sim, v, p, { kind: 'merchant_buy', resource: 'arrows', amount: -5 }), /whole amount/);
  v.phase = 'night'; rejected(v, () => economyAction(sim, v, p, { kind: 'merchant_buy', resource: 'arrows', amount: 1 }), /returns/);
});
