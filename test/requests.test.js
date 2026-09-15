import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS, PLOTS } from '../shared/world.js';
import { buildingEntrance, plotEntrance } from '../shared/access.js';
import { REQUEST_RULES, requestDestinations } from '../shared/requests.js';
import { ensureRequests, requestsTick, requestsAction, requestsSnapshot, requestsBeforeAction, requestsAfterAction } from '../server/requests.js';
import { repayIncome } from '../server/transport.js';
import { economyAction, ensureEconomy } from '../server/economy.js';
import { taxedPurchaseQuote } from '../shared/economy.js';

function fixture() {
  const p = { id: 'alice', name: 'Alice', online: true, role: 'villager', hp: 100, maxHp: 100, wallet: 1000, inventory: { wheat: 60, stone: 30, coal: 30 }, durability: {} };
  const q = { ...p, id: 'bob', name: 'Bob', inventory: { ...p.inventory } };
  const v = { id: 'village', clock: 0, day: 1, phase: 'day', status: 'active', treasury: 2500, stock: { wheat: 100, timber: 100, stone: 100 }, barracks: { wheat: 12 }, players: { alice: p, bob: q }, plots: [], guards: [{ hp: 160 }, { hp: 0 }], policies: { guardWage: 25, priestWage: 25 } };
  const accounts = { alice: { bank: 0, debt: 0 }, bob: { bank: 0, debt: 0 } };
  const sim = { store: { account: id => accounts[id], repayDebt(id, amount, remainder) { accounts[id].debt -= amount; accounts[id].repayment_remainder = remainder; } },
    awardIncome(v, p, gold) { const net = repayIncome(this, v, p, gold); p.wallet += net; return net; } };
  ensureEconomy(v); ensureRequests(v);
  Object.assign(p, buildingEntrance(BUILDINGS.find(b => b.id === 'bank'))); Object.assign(q, { x: p.x, z: p.z });
  return { v, p, q, sim, accounts };
}
const open = v => v.requests.items.filter(r => r.status === 'open');
const funds = v => v.treasury + Object.values(v.players).reduce((sum, p) => sum + p.wallet, 0) + v.requests.items.reduce((sum, r) => sum + r.reserved, 0);
function deliver(f, request, amount, p = f.p) {
  const action = { kind: 'request_deliver', requestId: request.id, amount };
  const before = requestsBeforeAction(f.v);
  const message = requestsAction(f.sim, f.v, p, action);
  requestsAfterAction(f.v, before, action); requestsTick(f.sim, f.v); return message;
}
const unchanged = (v, fn, pattern) => { const before = structuredClone(v); assert.throws(fn, pattern); assert.deepEqual(v, before); };

test('requests reflect shortages, reserve actual gold and conserve resources through partial multiplayer deliveries', () => {
  const f = fixture(), { v, p, q, sim } = f;
  requestsTick(sim, v); assert.equal(open(v).length, 0, 'plentiful stores need no delivery');
  v.stock.wheat = 0; const total = funds(v), wheat = p.inventory.wheat + q.inventory.wheat;
  requestsTick(sim, v); const r = open(v)[0]; assert.equal(r.resource, 'wheat'); assert.equal(r.remaining, 24);
  assert.equal(r.reserved, r.unitGold * 24); assert.equal(funds(v), total);
  deliver(f, r, 9); deliver(f, r, 15, q);
  assert.equal(r.status, 'complete'); assert.equal(r.reserved, 0); assert.equal(v.stock.wheat, 24);
  assert.equal(p.inventory.wheat + q.inventory.wheat + v.stock.wheat, wheat); assert.equal(funds(v), total);
  unchanged(v, () => deliver(f, r, 1), /closed/);
  for (let i = 0; i < 20; i++) requestsTick(sim, v);
  assert.equal(v.requests.items.length, 1, 'same shortage has no repeat bounty that day');
});

test('delivery authentication, front-door position, alive state, finite quantities and concurrent quotas are authoritative', () => {
  const f = fixture(), { v, p, sim } = f; v.stock.wheat = 0; requestsTick(sim, v); const r = open(v)[0];
  for (const amount of [0, -1, 1.5, '2', Infinity, NaN, 25]) unchanged(v, () => deliver(f, r, amount), /positive whole/);
  const action = { kind: 'request_deliver', requestId: r.id, amount: 1 };
  unchanged(v, () => requestsAction(sim, v, { ...p }, action), /Join this village/);
  p.online = false; unchanged(v, () => requestsAction(sim, v, p, action), /Join/); p.online = true;
  for (const property of ['downed', 'bedPlotId', 'mountedHorseId']) { p[property] = true; unchanged(v, () => requestsAction(sim, v, p, action), /Stand/); p[property] = false; }
  const bank = BUILDINGS.find(b => b.id === 'bank'); Object.assign(p, { x: bank.x, z: bank.z });
  unchanged(v, () => deliver(f, r, 1), /entrance/); Object.assign(p, buildingEntrance(bank));
  deliver(f, r, 20); unchanged(v, () => deliver(f, r, 5), /remaining need changed/);
  p.inventory.wheat = 0; unchanged(v, () => deliver(f, r, 1), /enough wheat/);
});

test('essential reserve and two payroll cycles precede the bounded daily request budget', () => {
  const { v, p, q, sim } = fixture(); v.stock = { wheat: 0, timber: 0, stone: 0 }; v.barracks.wheat = 0;
  p.role = 'guard'; q.role = 'priest'; v.treasury = 600;
  requestsTick(sim, v); assert.equal(open(v).length, 0); assert.equal(v.treasury, 600);
  v.treasury = 900; requestsTick(sim, v);
  assert.ok(v.treasury >= 600); assert.ok(v.requests.spent <= REQUEST_RULES.dailyGold); assert.ok(open(v).length <= REQUEST_RULES.maxDaily);
  assert.equal(v.treasury + v.requests.spent, 900);
  const spent = v.requests.spent; v.stock = { wheat: 100, timber: 100, stone: 100 }; v.barracks.wheat = 100; requestsTick(sim, v);
  assert.equal(v.requests.spent, spent, 'refunding does not reset daily funding cap'); assert.equal(v.treasury, 900);
  v.stock.wheat = 0; requestsTick(sim, v); assert.equal(open(v).length, 0, 'a cancelled shortage cannot reopen for the same day');
});

test('ordinary donations or worker deposits fill needs without duplicate payouts; expiry and fallen runs refund once', () => {
  const f = fixture(), { v, p, sim } = f; v.stock.wheat = 0; requestsTick(sim, v); const r = open(v)[0], wallet = p.wallet;
  const before = requestsBeforeAction(v); v.stock.wheat += 56; p.inventory.wheat -= 56;
  requestsAfterAction(v, before, { kind: 'donate' }); requestsTick(sim, v);
  assert.equal(r.status, 'supplied'); assert.equal(p.wallet, wallet); assert.equal(r.reserved, 0);
  v.day++; v.stock.wheat = 0; requestsTick(sim, v); const next = open(v)[0]; assert.ok(next);
  v.day++; v.phase = 'night'; const treasury = v.treasury + next.reserved; requestsTick(sim, v);
  assert.equal(next.status, 'expired'); assert.equal(v.treasury, treasury); requestsTick(sim, v); assert.equal(v.treasury, treasury);
  v.phase = 'day'; requestsTick(sim, v); const final = open(v)[0]; assert.ok(final); v.status = 'fallen'; requestsTick(sim, v);
  assert.equal(final.status, 'cancelled'); const refunded = v.treasury; requestsTick(sim, v); assert.equal(v.treasury, refunded);
});

test('cannon ammunition uses real storage and entrance; archer towers never request arrows', () => {
  const f = fixture(), { v, p, sim } = f; const site = PLOTS[0];
  v.plots = [{ id: site.id, ownerId: p.id, building: 'cannon', hp: 500, storage: { coal: 0, stone: 8 } }, { id: PLOTS[1].id, ownerId: p.id, building: 'archer_tower', hp: 500, storage: {} }];
  requestsTick(sim, v); const r = open(v)[0]; assert.equal(r.resource, 'coal'); assert.equal(r.destinationId, site.id);
  assert.ok(!requestDestinations(v).some(t => t.resource === 'arrows'));
  unchanged(v, () => deliver(f, r, 1), /entrance/); Object.assign(p, plotEntrance(site, v.plots[0]));
  deliver(f, r, 4); assert.equal(v.plots[0].storage.coal, 4); assert.equal(p.inventory.coal, 26);
  v.plots[0].hp = 0; requestsTick(sim, v); assert.equal(r.status, 'cancelled'); assert.equal(r.reserved, 0);
});

test('buying public stock cannot manufacture rewarded scarcity or profitable buyback loops', () => {
  const { v, p, sim } = fixture(); v.stock.wheat = 20; p.inventory = { wheat: 0 }; ensureRequests(v);
  const before = requestsBeforeAction(v), quote = taxedPurchaseQuote('wheat', 20, 10, v.policies.tradeTax), wallet = p.wallet;
  economyAction(sim, v, p, { kind: 'buyResource', resource: 'wheat', amount: 10, maxTotal: quote.total });
  requestsAfterAction(v, before, { kind: 'buyResource' }); requestsTick(sim, v); const r = open(v)[0];
  assert.equal(v.requests.ledger['bank:wheat'].withdrawn, 10);
  assert.ok(r.remaining <= 56 - 10 - 10, 'purchased items do not increase the true deficit');
  requestsAction(sim, v, p, { kind: 'request_deliver', requestId: r.id, amount: 10 });
  assert.ok(p.wallet < wallet, 'the request reward remains below resource buyback cost');
  assert.equal(v.requests.ledger['bank:wheat'].withdrawn, 10, 'paid deliveries cannot clear transfer provenance');
});

test('withdrawing cannon supplies cannot fund another bounty even after dawn, reload, or ruin repair', () => {
  const f = fixture(), { v, p, sim } = f; const site = PLOTS[0], plot = { id: site.id, ownerId: p.id, building: 'cannon', hp: 500, storage: { coal: 0, stone: 8 } };
  v.plots = [plot]; requestsTick(sim, v); const r = open(v)[0]; Object.assign(p, plotEntrance(site, plot)); deliver(f, r, 8);
  plot.hp = 0; requestsTick(sim, v);
  const before = requestsBeforeAction(v); plot.storage.coal -= 8; p.inventory.coal += 8; requestsAfterAction(v, before, { kind: 'plot_withdraw' });
  assert.equal(v.requests.ledger[`${site.id}:coal`].withdrawn, 8);
  plot.hp = 500; v.day++; v.requests = JSON.parse(JSON.stringify(v.requests)); requestsTick(sim, v);
  assert.ok(!open(v).some(r => r.destinationId === site.id), 'withdrawn or previously rewarded supplies cannot create a new request');
  const restoration = requestsBeforeAction(v); plot.storage.coal += 8; p.inventory.coal -= 8; requestsAfterAction(v, restoration, { kind: 'plot_deposit' });
  assert.equal(v.requests.ledger[`${site.id}:coal`].withdrawn, 0);
  plot.storage.coal = 0; requestsTick(sim, v); assert.ok(open(v).some(r => r.resource === 'coal'), 'real cannon consumption can create a new funded need');
});

test('public watch includes fallen slots and rewards use existing fractional loan repayment', () => {
  const f = fixture(), { v, p, sim, accounts } = f; v.barracks.wheat = 0; v.guards.forEach(g => { g.hp = 0; });
  requestsTick(sim, v); const r = open(v)[0]; assert.equal(r.destinationId, 'barracks'); assert.equal(r.quantity, 6);
  accounts.alice.debt = 20; const wallet = p.wallet, total = funds(v); Object.assign(p, buildingEntrance(BUILDINGS.find(b => b.id === 'barracks')));
  for (let i = 0; i < 6; i++) deliver(f, r, 1);
  assert.equal(v.barracks.wheat, 6); assert.equal(accounts.alice.debt, 17); assert.equal(p.wallet, wallet + 15); assert.equal(funds(v), total);
});

test('request state round trips without new escrow or disclosed withdrawal provenance', () => {
  const f = fixture(), { v, sim } = f; v.stock.wheat = 0; requestsTick(sim, v); const initial = structuredClone(v);
  const restored = JSON.parse(JSON.stringify(v)); ensureRequests(restored); requestsTick(sim, restored); assert.deepEqual(restored, initial);
  const snapshot = requestsSnapshot(v); assert.equal(snapshot.requests.items.length, 1); assert.ok(!Object.hasOwn(snapshot.requests, 'ledger'));
  snapshot.requests.items[0].remaining = 0; snapshot.requests.items[0].point.x = 1000;
  assert.equal(v.requests.items[0].remaining, 24); assert.notEqual(v.requests.items[0].point.x, 1000);
});

test('Simulation delivery transactions roll back escrow and loan payments together and persist successful requests across reload', async t => {
  const { Store } = await import('../server/store.js');
  const { Simulation } = await import('../server/simulation.js');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const directory = await mkdtemp(join(tmpdir(), 'emberwatch-requests-'));
  const store = new Store(directory); t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  const auth = await store.authenticate('register', 'Delivery Dwarf', 'delivery-test-only');
  const account = store.account(auth.playerId), sim = new Simulation(store), { id } = sim.create('Supply watch', account), p = sim.join(id, account), v = sim.villages.get(id);
  v.stock.wheat = 0; p.inventory.wheat = 24; Object.assign(p, buildingEntrance(BUILDINGS.find(b => b.id === 'bank')));
  requestsTick(sim, v); store.db.prepare('UPDATE accounts SET debt=20 WHERE id=?').run(p.id); store.saveVillage(v);
  const r = open(v)[0], action = { kind: 'request_deliver', requestId: r.id, amount: 10 }, before = structuredClone(v), awardIncome = sim.awardIncome;
  sim.awardIncome = function (...args) { awardIncome.apply(this, args); throw new Error('Simulated payment failure'); };
  assert.throws(() => sim.action(id, p.id, action), /Simulated payment failure/);
  assert.deepEqual(v, before); assert.equal(store.account(p.id).debt, 20); assert.deepEqual(store.loadVillages()[0], before);
  sim.awardIncome = awardIncome; sim.action(id, p.id, action);
  assert.equal(v.stock.wheat, 10); assert.equal(open(v)[0].remaining, 14); assert.equal(store.account(p.id).debt, 10);
  const saved = store.loadVillages()[0]; assert.equal(saved.requests.items[0].reserved, 70);
  const reloaded = new Simulation(store), restored = reloaded.villages.get(id);
  assert.deepEqual(restored.requests, v.requests); assert.equal(restored.players[p.id].wallet, p.wallet);
  assert.equal(reloaded.snapshot(restored, p.id).requests.reservedGold, 70);
  // Real action routing must mark a resource purchase as a transfer, not demand.
  v.clock += 1; const quote = taxedPurchaseQuote('wheat', v.stock.wheat, 2, v.policies.tradeTax);
  sim.action(id, p.id, { kind: 'buyResource', resource: 'wheat', amount: 2, maxTotal: quote.total });
  assert.equal(v.requests.ledger['bank:wheat'].withdrawn, 2);
  assert.equal(store.loadVillages()[0].requests.ledger['bank:wheat'].withdrawn, 2);
});
