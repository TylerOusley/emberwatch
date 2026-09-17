import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { Simulation } from '../server/simulation.js';
import { villageFinanceAction, villageFinanceDawn, villageFinanceSnapshot } from '../server/village-finance.js';
import { fairDividendAllocation, normalizeTavernBet, tavernPayout, ROULETTE_RED } from '../shared/village-finance.js';
import { TREASURY_RESERVE } from '../shared/market.js';
import { BUILDINGS } from '../shared/world.js';
import { buildingEntrance } from '../shared/access.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'emberwatch-finance-')), store = new Store(directory, { testAdminAccountIds: [] });
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  const a = await store.authenticate('register', 'Village Investor', 'village-finance-password'), b = await store.authenticate('register', 'Second Investor', 'village-finance-password');
  const sim = new Simulation(store), account = store.account(a.playerId), other = store.account(b.playerId), { id } = sim.create('Finance Watch', account), village = sim.villages.get(id);
  const first = sim.join(id, account), second = sim.join(id, other);
  village.stock = { timber: 10000, stone: 10000, wheat: 10000, iron: 10000, coal: 10000 }; village.barracks.wheat = 10000;
  first.wallet = second.wallet = 100000;
  function near(id, player = first) { Object.assign(player, buildingEntrance(BUILDINGS.find(building => building.id === id))); }
  near('bank'); near('bank', second);
  function act(action, player = first, roll = null) {
    village.clock += .7;
    const request = { requestId: randomUUID(), ...action }, original = sim.performAction;
    if (roll !== null) sim.performAction = (villageId, playerId, message) => villageFinanceAction(sim, village, village.players[playerId], message, { random: () => roll });
    try { const message = sim.action(village.id, player.id, request); return { message, receipt: store.financeReceipt(village.id, player.id, request.requestId), request }; }
    finally { sim.performAction = original; }
  }
  function dawn(day) { return store.transaction(() => { const report = villageFinanceDawn(sim, village, day); village.day = Math.max(village.day, day + 1); store.saveVillage(village); return report; }); }
  const position = (player = first) => store.financePosition(village.id, player.id);
  const total = () => village.treasury + Object.values(village.players).reduce((sum, player) => sum + player.wallet, 0) + store.financePositions(village.id).reduce((sum, row) => sum + row.earnings, 0) + (village.requests?.items ?? []).reduce((sum, row) => sum + (row.reserved ?? 0), 0);
  return { directory, store, sim, village, first, second, account, other, near, act, dawn, position, total };
}

test('investments fund the live treasury, skip their first dawn, and pay from treasury into separately funded escrow', async t => {
  const f = await fixture(t), { first, village, act, dawn, position, total } = f;
  const initial = total(), wallet = first.wallet, treasury = village.treasury;
  act({ kind: 'investment_deposit', amount: 10000 });
  assert.equal(first.wallet, wallet - 10000); assert.equal(village.treasury, treasury + 10000); assert.equal(position().principal, 10000);
  assert.equal(dawn(1).paid, 0, 'the deposit-day dawn grants no interest');
  assert.equal(dawn(2).paid, 100); assert.equal(position().earnings, 100); assert.equal(total(), initial);
  const beforeClaim = village.treasury;
  act({ kind: 'investment_claim', max: true });
  assert.equal(position().earnings, 0); assert.equal(first.wallet, wallet - 9900); assert.equal(village.treasury, beforeClaim, 'funded dividends are already outside spendable treasury');
  assert.equal(total(), initial);
});

test('late deposits and reinvestments wait a full cycle and fractional small investments eventually earn whole gold', async t => {
  const f = await fixture(t), { village, act, dawn, position } = f;
  village.day = 7; village.clock = 5039.999;
  act({ kind: 'investment_deposit', amount: 10000 });
  assert.equal(dawn(7).paid, 0); assert.equal(dawn(8).paid, 100);
  act({ kind: 'investment_reinvest', max: true });
  assert.equal(position().principal, 10100); assert.equal(position().earnings, 0);
  assert.equal(dawn(9).paid, 100, 'the new 100 principal is still pending on its deposit day');
  assert.equal(dawn(10).paid, 101);
  act({ kind: 'investment_withdraw', max: true }); act({ kind: 'investment_claim', max: true });
  act({ kind: 'investment_deposit', amount: 10 });
  assert.equal(dawn(11).paid, 0);
  for (let day = 12; day < 21; day++) assert.equal(dawn(day).paid, 0);
  assert.equal(dawn(21).paid, 1); assert.equal(position().earnings, 1);
});

test('dividend shortfalls are allocated proportionally without debt and the reserve stays untouched', async t => {
  const { village, first, second, act, dawn, position } = await fixture(t);
  act({ kind: 'investment_deposit', amount: 10000 }, first); act({ kind: 'investment_deposit', amount: 30000 }, second); dawn(1);
  village.treasury = TREASURY_RESERVE + 100;
  const report = dawn(2);
  assert.equal(report.due, 400); assert.equal(report.paid, 100); assert.equal(village.treasury, TREASURY_RESERVE);
  assert.equal(position(first).earnings, 25); assert.equal(position(second).earnings, 75);
  village.treasury = TREASURY_RESERVE + 1000;
  const next = dawn(3); assert.equal(next.due, 400, 'unfunded dividends do not become debt or another claim');
  assert.equal(position(first).earnings, 125); assert.equal(position(second).earnings, 375);
});

test('fractional pro-rata ties rotate by day and do not depend on account iteration order', () => {
  const demands = [{ id: 'a', amount: 1 }, { id: 'b', amount: 1 }, { id: 'c', amount: 1 }], totals = { a: 0, b: 0, c: 0 };
  for (let day = 1; day <= 3; day++) {
    const forward = fairDividendAllocation(demands, 1, day), reverse = fairDividendAllocation([...demands].reverse(), 1, day);
    assert.deepEqual(forward, reverse);
    for (const row of forward) totals[row.id] += row.paid;
  }
  assert.deepEqual(totals, { a: 1, b: 1, c: 1 });
  const large = fairDividendAllocation([{ id: 'a', amount: 9007199254740990 }, { id: 'b', amount: 9007199254740990 }], 9007199254740990, 1);
  assert.deepEqual(large.map(row => row.paid), [4503599627370495, 4503599627370495]);
});

test('principal withdrawals depend on surplus while escrow remains claimable, and withdrawing pending capital preserves mature lots', async t => {
  const { village, act, dawn, position, total } = await fixture(t);
  act({ kind: 'investment_deposit', amount: 10000 }); dawn(1); dawn(2);
  act({ kind: 'investment_deposit', amount: 2000 }); act({ kind: 'investment_withdraw', amount: 2000 });
  assert.equal(position().lots.length, 1); assert.equal(position().lots[0].amount, 10000);
  village.treasury = TREASURY_RESERVE;
  assert.throws(() => act({ kind: 'investment_withdraw', amount: 1 }), /reserve/);
  const before = total(); act({ kind: 'investment_claim', max: true });
  assert.equal(village.treasury, TREASURY_RESERVE); assert.equal(total(), before); assert.equal(position().earnings, 0);
  assert.throws(() => act({ kind: 'investment_claim', max: true }), /no claimable/);
  village.treasury += 1000; act({ kind: 'investment_withdraw', max: true });
  assert.equal(position().principal, 9000); assert.equal(village.treasury, TREASURY_RESERVE);
});

test('coinflip and European roulette pay the stated total returns, with zero losing all even-money categories', async t => {
  const { village, first, near, act, total } = await fixture(t); near('merchant');
  village.merchant.present = false; village.phase = 'night';
  const initial = total();
  for (const [game, choice, number, roll, multiplier] of [
    ['coinflip', 'heads', undefined, 0, 2], ['coinflip', 'tails', undefined, 0, 0],
    ['roulette', 'number', 0, 0, 36], ['roulette', 'number', 36, 36, 36],
    ['roulette', 'red', undefined, 1, 2], ['roulette', 'black', undefined, 2, 2],
    ['roulette', 'even', undefined, 2, 2], ['roulette', 'odd', undefined, 1, 2],
    ...['red', 'black', 'even', 'odd'].map(choice => ['roulette', choice, undefined, 0, 0])
  ]) {
    const before = first.wallet, result = act({ kind: 'tavern_bet', game, choice, number, stake: 10 }, first, roll).receipt;
    assert.equal(result.payout, multiplier * 10); assert.equal(result.net, multiplier * 10 - 10);
    assert.equal(first.wallet, before + result.net); assert.equal(total(), initial);
  }
  assert.equal(ROULETTE_RED.length, 18); assert.equal(new Set(ROULETTE_RED).size, 18);
  for (const choice of ['red', 'black', 'even', 'odd']) {
    const bet = normalizeTavernBet({ game: 'roulette', choice, stake: 1 });
    assert.equal(Array.from({ length: 37 }, (_, n) => tavernPayout(bet, n)).reduce((sum, n) => sum + n, 0), 36, '18 out of 37 wheel outcomes pay 2x');
  }
});

test('the treasury must fund maximum possible win before RNG runs and client odds/results cannot change payouts', async t => {
  const { village, first, near, act, store, sim } = await fixture(t); near('merchant');
  village.treasury = TREASURY_RESERVE + 349;
  let rolls = 0;
  assert.throws(() => villageFinanceAction(sim, village, first, { kind: 'tavern_bet', requestId: randomUUID(), game: 'roulette', choice: 'number', number: 5, stake: 10 }, { random() { rolls++; return 4; } }), /maximum win/);
  assert.equal(rolls, 0, 'even a losing outcome cannot bypass the published solvency check');
  village.treasury++;
  const snapshot = villageFinanceSnapshot(sim, village, first.id); assert.equal(snapshot.tavern.rouletteNumberMaximumStake, 10);
  const result = act({ kind: 'tavern_bet', game: 'roulette', choice: 'number', number: 5, stake: 10, multiplier: 999, payout: 999999, outcome: 6, treasury: 1e9 }, first, 5).receipt;
  assert.equal(result.payout, 360); assert.equal(village.treasury, TREASURY_RESERVE);
  assert.equal(store.financeReceipts(village.id, first.id, true).length, 1);
});

test('wallet-only amounts, ownership, location, integer limits and authenticated resident identity are validated', async t => {
  const { village, first, second, store, sim, near, act, position } = await fixture(t);
  store.issueCredit(first.id, 200); first.wallet = 0;
  assert.throws(() => act({ kind: 'investment_deposit', amount: 100 }), /wallet/);
  assert.equal(store.account(first.id).credit, 200); first.wallet = 10000;
  act({ kind: 'investment_deposit', amount: 100, playerId: second.id, ownerId: second.id });
  assert.equal(position(first).principal, 100); assert.equal(position(second).principal, 0);
  assert.throws(() => villageFinanceAction(sim, village, { ...first }, { kind: 'investment_deposit', requestId: randomUUID(), amount: 100 }), /Join/);
  for (const amount of [-1, 0, .5, '10', Infinity, 1000001]) assert.throws(() => act({ kind: 'investment_deposit', amount }), /amount|wallet/);
  assert.throws(() => act({ kind: 'investment_deposit', amount: 10, requestId: '__proto__' }), /request ID/);
  near('merchant'); assert.throws(() => act({ kind: 'investment_deposit', amount: 10 }), /Treasury entrance/);
  for (const bad of [{ stake: 10001 }, { stake: '10' }, { choice: '__proto__' }, { choice: 'number', number: -1 }, { choice: 'number', number: 37 }, { choice: 'number', number: '0' }]) assert.throws(() => act({ kind: 'tavern_bet', game: 'roulette', choice: 'red', stake: 10, ...bad }), /Choose/);
  near('bank'); assert.throws(() => act({ kind: 'tavern_bet', game: 'coinflip', choice: 'heads', stake: 10 }), /Wayfarer entrance/);
});

test('request UUID replay is immutable across action kinds and a saved result survives reconnect and process restart', async t => {
  const { directory, village, first, account, store, sim, near, act, position } = await fixture(t);
  const invested = act({ kind: 'investment_deposit', amount: 1000 }), before = { wallet: first.wallet, treasury: village.treasury };
  act({ kind: 'investment_withdraw', amount: 500, requestId: invested.request.requestId });
  assert.deepEqual({ wallet: first.wallet, treasury: village.treasury }, before); assert.equal(position().principal, 1000);
  near('merchant'); const bet = act({ kind: 'tavern_bet', game: 'coinflip', choice: 'heads', stake: 10 }, first, 0);
  sim.disconnect(village.id, first.id);
  const reopened = new Store(directory, { testAdminAccountIds: [] });
  try {
    const recovered = new Simulation(reopened), player = recovered.join(village.id, account), v = recovered.villages.get(village.id), wallet = player.wallet, treasury = v.treasury;
    recovered.action(v.id, player.id, { ...bet.request, choice: 'tails' });
    assert.equal(player.wallet, wallet); assert.equal(v.treasury, treasury); assert.deepEqual(reopened.financeReceipt(v.id, player.id, bet.request.requestId), bet.receipt);
    assert.equal(villageFinanceSnapshot(recovered, v, player.id).tavern.history[0].requestId, bet.request.requestId);
  } finally { reopened.close(); }
  assert.equal(store.financeReceipts(village.id, first.id, true).length, 1);
});

test('durable position and dividend claims prevent duplicate payouts and stale world records cannot recreate withdrawn principal', async t => {
  const { village, store, sim, act, dawn, position, total } = await fixture(t);
  act({ kind: 'investment_deposit', amount: 10000 }); dawn(1); const first = dawn(2), before = total();
  const duplicate = store.transaction(() => villageFinanceDawn(sim, village, 2));
  assert.deepEqual(duplicate, first); assert.equal(position().earnings, 100); assert.equal(total(), before);
  act({ kind: 'investment_withdraw', max: true }); village.villageFinance = { principal: 10000, earnings: 100000, lastDawn: 0 };
  assert.throws(() => act({ kind: 'investment_withdraw', amount: 1 }), /principal/); assert.equal(position().principal, 0);
});

test('failed receipt, village or dividend persistence rolls back every balance and allows a successful retry', async t => {
  const { village, first, store, sim, near, act, dawn, position } = await fixture(t);
  let before = { wallet: first.wallet, treasury: village.treasury, position: position() };
  const writeReceipt = store.saveFinanceReceipt; store.saveFinanceReceipt = () => { throw new Error('receipt write failed'); };
  const requestId = randomUUID(); assert.throws(() => act({ kind: 'investment_deposit', amount: 1000, requestId }), /receipt write failed/); store.saveFinanceReceipt = writeReceipt;
  assert.deepEqual({ wallet: first.wallet, treasury: village.treasury, position: position() }, before); assert.equal(store.financeReceipt(village.id, first.id, requestId), null);
  act({ kind: 'investment_deposit', amount: 1000, requestId }); dawn(1);
  const writeDawn = store.saveFinanceDawn, old = structuredClone(village), oldPosition = position();
  store.saveFinanceDawn = () => { throw new Error('dividend write failed'); };
  assert.throws(() => sim.dawn(village), /dividend write failed/); store.saveFinanceDawn = writeDawn;
  assert.deepEqual(village, old); assert.deepEqual(position(), oldPosition); assert.equal(store.financeDawn(village.id, 2), null);
  assert.equal(dawn(2).paid, 10);
  near('merchant'); before = { wallet: first.wallet, treasury: village.treasury };
  const save = store.saveVillage; store.saveVillage = () => { throw new Error('village write failed'); };
  const betId = randomUUID(); assert.throws(() => act({ kind: 'tavern_bet', game: 'roulette', choice: 'number', number: 0, stake: 10, requestId: betId }, first, 0), /village write failed/); store.saveVillage = save;
  assert.deepEqual({ wallet: first.wallet, treasury: village.treasury }, before); assert.equal(store.financeReceipt(village.id, first.id, betId), null);
  assert.equal(act({ kind: 'tavern_bet', game: 'roulette', choice: 'number', number: 0, stake: 10, requestId: betId }, first, 0).receipt.payout, 360);
});

test('private finance snapshots expose only the viewer receipts and earnings and perform no database writes', async t => {
  const { store, sim, village, first, second, act, dawn, near } = await fixture(t);
  act({ kind: 'investment_deposit', amount: 1000 }); dawn(1); dawn(2); near('merchant');
  const bet = act({ kind: 'tavern_bet', game: 'coinflip', choice: 'heads', stake: 10 }, first, 0).receipt;
  const changes = store.db.prepare('SELECT total_changes() AS count').get().count, transaction = store.transaction;
  store.transaction = () => { throw new Error('snapshot write transaction'); };
  try {
    const mine = villageFinanceSnapshot(sim, village, first.id), other = villageFinanceSnapshot(sim, village, second.id), anonymous = villageFinanceSnapshot(sim, village);
    assert.equal(mine.finance.earnings, 10); assert.equal(other.finance.earnings, 0); assert.equal(other.finance.totalPrincipal, 1000);
    assert.deepEqual(other.finance.receipts, []); assert.deepEqual(other.tavern.history, []); assert.deepEqual(anonymous.tavern.history, []);
    assert.ok(!JSON.stringify(other).includes(bet.requestId)); assert.equal(mine.tavern.history[0].requestId, bet.requestId);
  } finally { store.transaction = transaction; }
  assert.equal(store.db.prepare('SELECT total_changes() AS count').get().count, changes);
});

test('a fallen village stops investment withdrawal, claiming and gambling, with no further dividends', async t => {
  const { village, sim, act, dawn, near, position } = await fixture(t);
  act({ kind: 'investment_deposit', amount: 1000 }); dawn(1); dawn(2); village.status = 'fallen';
  assert.throws(() => act({ kind: 'investment_claim', max: true }), /fallen/);
  assert.throws(() => act({ kind: 'investment_withdraw', max: true }), /fallen/);
  near('merchant'); assert.throws(() => act({ kind: 'tavern_bet', game: 'coinflip', choice: 'heads', stake: 10 }), /fallen/);
  assert.equal(villageFinanceDawn(sim, village, 3), null); assert.equal(position().earnings, 10);
});

test('recent receipt snapshots use indexed village/account histories without pruning durable replay records', async t => {
  const { store, village, first } = await fixture(t);
  for (const [comparison, index] of [['=', 'village_finance_receipts_tavern_recent'], ['<>', 'village_finance_receipts_investment_recent']]) {
    const plan = store.db.prepare(`EXPLAIN QUERY PLAN SELECT receipt FROM village_finance_receipts WHERE village_id=? AND account_id=? AND kind ${comparison} 'tavern_bet' ORDER BY created DESC,rowid DESC LIMIT 20`).all(village.id, first.id);
    assert.ok(plan.some(row => row.detail.includes(`USING INDEX ${index}`)), JSON.stringify(plan));
  }
});
