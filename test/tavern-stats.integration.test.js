import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { Simulation } from '../server/simulation.js';
import { villageFinanceAction, villageFinanceSnapshot, villageFinanceTick } from '../server/village-finance.js';
import { TAVERN_GAMES } from '../shared/village-finance.js';
import { BUILDINGS } from '../shared/world.js';
import { buildingEntrance } from '../shared/access.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'emberwatch-tavern-stats-'));
  const store = new Store(directory, { testAdminAccountIds: [] });
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  const accounts = ['Stats First', 'Stats Second'].map(name => {
    const id = randomUUID();
    store.db.prepare('INSERT INTO accounts(id,name,salt,password_hash) VALUES(?,?,?,?)').run(id, name, 'fixture', 'fixture');
    return store.account(id);
  });
  const sim = new Simulation(store), village = sim.villages.get(sim.create('Stats Village', accounts[0]).id);
  const players = accounts.map(account => sim.join(village.id, account));
  for (const player of players) { player.wallet = 100000; Object.assign(player, buildingEntrance(BUILDINGS.find(building => building.id === 'merchant'))); }
  village.treasury = 100000;
  const otherVillage = randomUUID(); store.saveVillage({ id: otherVillage, status: 'fallen', players: {} });
  function save(fields = {}, account = accounts[0], villageId = village.id) {
    const receipt = { kind: 'tavern_bet', requestId: randomUUID(), createdAt: Date.now(), game: 'coinflip', status: 'settled', stake: 10, payout: 20, ...fields };
    store.saveFinanceReceipt(villageId, account.id, receipt); return receipt;
  }
  function act(action, random = () => 0) {
    village.clock += .7;
    const request = { kind: 'tavern_bet', requestId: randomUUID(), ...action }, original = sim.performAction;
    sim.performAction = (villageId, playerId, message) => villageFinanceAction(sim, village, village.players[playerId], message, { random });
    try { sim.action(village.id, players[0].id, request); return { request, receipt: store.financeReceipt(village.id, players[0].id, request.requestId) }; }
    finally { sim.performAction = original; }
  }
  const stats = () => store.tavernStats(village.id, accounts[0].id);
  return { directory, store, sim, village, accounts, players, otherVillage, save, act, stats };
}
const empty = () => ({ bets: 0, wins: 0, losses: 0, pushes: 0, wagered: '0', returned: '0', won: '0', lost: '0', net: '0' });
const seededRoll = (seed = 17) => maximum => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % maximum; };
const card = (rank, suit = 0) => suit * 13 + rank - 2;

test('full saved history, all games, village scope and lifetime scope remain separate from recent-20 receipts', async t => {
  const { store, village, accounts, otherVillage, save, stats } = await fixture(t);
  for (let i = 0; i < 25; i++) save({ payout: i % 2 ? 0 : 20 });
  save({ game: 'roulette', stake: 100, payout: 3600 }, accounts[0], otherVillage);
  save({ game: 'blackjack', roundId: randomUUID(), stake: 100, payout: 100 });
  save({ game: 'three_card_poker', roundId: randomUUID(), stake: 200, payout: 100, win: true });
  save({ game: 'slots', stake: 100, payout: 200 });
  save({ game: 'wheel', stake: 100, payout: 50, win: true });
  save({ stake: 9999, payout: 19998 }, accounts[1]);
  save({ kind: 'investment_deposit', stake: 9999, payout: 19998 });
  const result = stats();
  assert.equal(store.financeReceipts(village.id, accounts[0].id, true).length, 20);
  assert.deepEqual(result.village.totals, { bets: 29, wins: 14, losses: 14, pushes: 1, wagered: '750', returned: '710', won: '230', lost: '270', net: '-40' });
  assert.deepEqual(result.lifetime.totals, { bets: 30, wins: 15, losses: 14, pushes: 1, wagered: '850', returned: '4310', won: '3730', lost: '270', net: '3460' });
  assert.deepEqual(Object.keys(result.lifetime.byGame), Object.keys(TAVERN_GAMES));
  assert.deepEqual(result.village.byGame.roulette, empty());
  assert.equal(result.lifetime.byGame.roulette.net, '3500');
  assert.equal(result.village.byGame.blackjack.pushes, 1);
  assert.equal(result.village.byGame.three_card_poker.losses, 1);
  assert.equal(result.village.byGame.wheel.losses, 1);
  assert.equal(result.village.byGame.wheel.won, '0', 'a partial return is a loss despite the legacy win flag');
});

test('legacy instant bets are included, active card steps excluded and duplicate card settlements count once per village', async t => {
  const { accounts, otherVillage, save, stats } = await fixture(t), roundId = randomUUID();
  save({ game: 'coinflip', status: undefined, payout: 0 });
  save({ game: 'roulette', status: undefined, payout: 360 });
  save({ game: 'slots', status: undefined });
  save({ game: 'blackjack', status: 'playing', roundId, round: { totalStake: 10 }, stake: undefined, payout: undefined });
  save({ game: 'blackjack', status: 'playing', roundId });
  save({ game: 'blackjack', status: 'settled', roundId, payout: 10 });
  save({ game: 'blackjack', status: 'settled', roundId, payout: 20 });
  save({ game: 'blackjack', status: 'settled', roundId, payout: 20 }, accounts[0], otherVillage);
  const result = stats();
  assert.equal(result.village.totals.bets, 3); assert.equal(result.village.totals.wagered, '30');
  assert.equal(result.village.totals.net, '340'); assert.equal(result.village.byGame.blackjack.pushes, 1);
  assert.equal(result.lifetime.totals.bets, 4); assert.equal(result.lifetime.byGame.blackjack.wins, 1);
});

test('invalid or corrupt receipt amounts never poison valid totals', async t => {
  const { store, village, accounts, save, stats } = await fixture(t);
  for (const fields of [{ stake: -1 }, { payout: -1 }, { stake: 1.5 }, { stake: '10' }, { payout: null }, { payout: Number.MAX_SAFE_INTEGER + 1 }, { status: 'failed' }, { game: '__proto__' }, { game: 'blackjack' }, { game: 'blackjack', roundId: '' }]) save(fields);
  store.db.prepare('INSERT INTO village_finance_receipts VALUES(?,?,?,?,?,?)').run(village.id, accounts[0].id, randomUUID(), 'tavern_bet', '{bad json', Date.now());
  save();
  assert.deepEqual(stats().lifetime.totals, { bets: 1, wins: 1, losses: 0, pushes: 0, wagered: '10', returned: '20', won: '10', lost: '0', net: '10' });
});

test('gold totals remain exact decimal strings beyond the safe Number range', async t => {
  const { save, stats } = await fixture(t), maximum = Number.MAX_SAFE_INTEGER, amount = BigInt(maximum);
  save({ stake: maximum, payout: 0 }); save({ stake: maximum, payout: 0 });
  save({ stake: 1, payout: maximum }); save({ stake: 1, payout: maximum });
  assert.deepEqual(stats().lifetime.totals, { bets: 4, wins: 2, losses: 2, pushes: 0, wagered: String(amount * 2n + 2n), returned: String(amount * 2n), won: String((amount - 1n) * 2n), lost: String(amount * 2n), net: '-2' });
  assert.doesNotThrow(() => JSON.stringify(stats()));
});

test('snapshot stats are private to a resident, read only and cannot mutate the cached totals', async t => {
  const { store, sim, village, players, save, stats } = await fixture(t);
  save(); const changes = store.db.prepare('SELECT total_changes() AS n').get().n;
  const mine = villageFinanceSnapshot(sim, village, players[0].id), other = villageFinanceSnapshot(sim, village, players[1].id);
  assert.equal(mine.tavern.stats.lifetime.totals.net, '10');
  assert.deepEqual(other.tavern.stats.lifetime.totals, empty());
  assert.equal(villageFinanceSnapshot(sim, village).tavern.stats, null);
  assert.equal(villageFinanceSnapshot(sim, village, randomUUID()).tavern.stats, null);
  assert.equal(store.tavernStats(village.id, randomUUID()), null);
  assert.equal(store.db.prepare('SELECT total_changes() AS n').get().n, changes);
  mine.tavern.stats.lifetime.totals.net = '999999'; mine.tavern.stats.village.byGame.coinflip.bets = 999;
  assert.equal(stats().lifetime.totals.net, '10'); assert.equal(stats().village.byGame.coinflip.bets, 1);
  assert.doesNotMatch(JSON.stringify(mine.tavern.stats), /account|requestId|wallet|password|roundId/);
});

test('account index and cursor consume old rows once and only new rows on later snapshots', async t => {
  const { store, village, accounts, save, stats } = await fixture(t);
  for (let i = 0; i < 60; i++) save();
  const query = "SELECT rowid,village_id,receipt FROM village_finance_receipts WHERE account_id=? AND kind='tavern_bet' AND rowid>? ORDER BY rowid";
  const plan = store.db.prepare(`EXPLAIN QUERY PLAN ${query}`).all(accounts[0].id, 0);
  assert.ok(plan.some(row => /village_finance_receipts_tavern_account.*account_id=\? AND rowid>\?/.test(row.detail)), JSON.stringify(plan));
  const prepare = store.db.prepare.bind(store.db), reads = [];
  store.db.prepare = sql => {
    const statement = prepare(sql);
    if (sql === query) {
      const iterate = statement.iterate.bind(statement);
      statement.iterate = function* (...args) { const read = { cursor: args[1], rows: 0 }; reads.push(read); for (const row of iterate(...args)) { read.rows++; yield row; } };
    }
    return statement;
  };
  try {
    assert.equal(stats().village.totals.bets, 60);
    assert.equal(stats().village.totals.bets, 60);
    save({ payout: 0 });
    assert.equal(stats().village.totals.bets, 61);
    assert.deepEqual(reads.map(read => read.rows), [60, 0, 1]);
    assert.equal(reads[0].cursor, 0n); assert.ok(reads[1].cursor > 0n); assert.equal(reads[1].cursor, reads[2].cursor);
  } finally { store.db.prepare = prepare; }
});

test('restart backfills old records and a second database connection advances an already cached history', async t => {
  const { directory, store, village, accounts, save, stats } = await fixture(t);
  save({ status: undefined, payout: 0 }); const before = stats();
  const reopened = new Store(directory, { testAdminAccountIds: [] });
  try {
    assert.deepEqual(reopened.tavernStats(village.id, accounts[0].id), before);
    reopened.saveFinanceReceipt(village.id, accounts[0].id, { kind: 'tavern_bet', requestId: randomUUID(), game: 'roulette', stake: 10, payout: 360, createdAt: Date.now() });
    assert.equal(stats().lifetime.totals.bets, 2); assert.equal(stats().lifetime.totals.net, '340');
    assert.deepEqual(reopened.tavernStats(village.id, accounts[0].id), stats());
  } finally { reopened.close(); }
  assert.equal(store.financeReceipts(village.id, accounts[0].id, true).length, 2);
});

test('outer and nested rollback discard uncommitted totals and deduplication keys', async t => {
  const { store, save, stats } = await fixture(t), roundId = randomUUID();
  save({ payout: 0 }); const before = stats();
  assert.throws(() => store.transaction(() => {
    save({ game: 'blackjack', roundId }); assert.equal(stats().lifetime.totals.bets, 2);
    throw new Error('injected outer rollback');
  }), /injected outer rollback/);
  assert.deepEqual(stats(), before);
  store.transaction(() => {
    save({ game: 'blackjack', roundId });
    assert.throws(() => store.transaction(() => { save({ game: 'roulette', payout: 360 }); assert.equal(stats().lifetime.totals.bets, 3); throw new Error('injected nested rollback'); }), /injected nested rollback/);
    assert.equal(stats().lifetime.totals.bets, 2);
  });
  assert.equal(stats().lifetime.totals.bets, 2); assert.equal(stats().lifetime.byGame.blackjack.wins, 1);
  assert.equal(stats().lifetime.totals.net, '0');
  const committed = stats();
  assert.throws(() => store.transaction(() => {
    store.transaction(() => { save({ game: 'roulette', payout: 360 }); assert.equal(stats().lifetime.totals.bets, 3); });
    throw new Error('outer rollback after inner commit');
  }), /outer rollback after inner commit/);
  assert.deepEqual(stats(), committed, 'inner cache advances are invalidated when an ancestor transaction rolls back');
});

test('real poker actions count final ante plus play once, recognize a partial-return loss and ignore request replay', async t => {
  const { village, players, act, stats } = await fixture(t);
  const start = act({ game: 'three_card_poker', stake: 10 }, seededRoll());
  assert.equal(start.receipt.status, 'playing'); assert.deepEqual(stats().village.totals, empty());
  const round = village.villageFinance.rounds[players[0].id];
  round.cards = [card(12), card(13, 1), card(14, 2)]; round.dealer = [card(7), card(7, 1), card(7, 2)];
  const finish = act({ game: 'three_card_poker', roundId: round.id, move: 'play' });
  assert.equal(finish.receipt.stake, 20); assert.equal(finish.receipt.payout, 10);
  const expected = { bets: 1, wins: 0, losses: 1, pushes: 0, wagered: '20', returned: '10', won: '0', lost: '10', net: '-10' };
  assert.deepEqual(stats().village.totals, expected);
  act(finish.request); act(start.request);
  assert.deepEqual(stats().village.totals, expected);
});

test('real timeout settlement rolls back with the save, counts exactly once and survives restart', async t => {
  const { directory, store, sim, village, players, act, stats } = await fixture(t);
  act({ game: 'blackjack', stake: 10 }, seededRoll());
  const round = village.villageFinance.rounds[players[0].id];
  round.cards = [card(10), card(8)]; round.dealer = [card(10), card(7)]; village.clock = round.deadline;
  store.saveVillage(village); assert.deepEqual(stats().village.totals, empty());
  const saveVillage = store.saveVillage;
  store.saveVillage = () => { assert.equal(stats().village.totals.bets, 1, 'exercise cache with an uncommitted receipt'); throw new Error('injected timeout save failure'); };
  try { assert.throws(() => villageFinanceTick(sim, village), /injected timeout save failure/); }
  finally { store.saveVillage = saveVillage; }
  assert.deepEqual(stats().village.totals, empty());
  villageFinanceTick(sim, village); villageFinanceTick(sim, village);
  assert.deepEqual(stats().village.totals, { bets: 1, wins: 1, losses: 0, pushes: 0, wagered: '10', returned: '20', won: '10', lost: '0', net: '10' });
  const reopened = new Store(directory, { testAdminAccountIds: [] });
  try { assert.deepEqual(reopened.tavernStats(village.id, players[0].id), stats()); }
  finally { reopened.close(); }
});

test('unrelated failures and rejected bets keep warmed histories cached; rollback evicts only accounts advanced inside it', async t => {
  const { store, village, accounts, players, save, act, stats } = await fixture(t);
  for (let i = 0; i < 30; i++) { save(); save({}, accounts[1]); }
  stats(); store.tavernStats(village.id, accounts[1].id);
  const prepare = store.db.prepare.bind(store.db), reads = [];
  store.db.prepare = sql => {
    const statement = prepare(sql);
    if (sql.startsWith('SELECT rowid,village_id,receipt FROM village_finance_receipts')) {
      const iterate = statement.iterate.bind(statement);
      statement.iterate = function* (...args) { const read = { account: args[0], rows: 0 }; reads.push(read); for (const row of iterate(...args)) { read.rows++; yield row; } };
    }
    return statement;
  };
  try {
    assert.throws(() => store.transaction(() => { stats(); throw new Error('ordinary failed action'); }), /ordinary failed action/);
    assert.equal(stats().lifetime.totals.bets, 30); store.tavernStats(village.id, accounts[1].id);
    players[0].wallet = 0;
    assert.throws(() => act({ game: 'coinflip', choice: 'heads', stake: 10 }), /enough wallet gold/);
    assert.equal(stats().lifetime.totals.bets, 30); store.tavernStats(village.id, accounts[1].id);
    assert.deepEqual(reads.map(read => read.rows), [0, 0, 0, 0, 0], 'read-only or unrelated rollback never rescans either player');
    reads.length = 0;
    assert.throws(() => store.transaction(() => {
      save(); assert.equal(stats().lifetime.totals.bets, 31);
      store.tavernStats(village.id, accounts[1].id);
      throw new Error('receipt rollback');
    }), /receipt rollback/);
    assert.equal(stats().lifetime.totals.bets, 30);
    assert.equal(store.tavernStats(village.id, accounts[1].id).lifetime.totals.bets, 30);
    assert.deepEqual(reads.map(read => read.rows), [1, 0, 30, 0], 'only the advanced account rebuilds after receipt rollback');
  } finally { store.db.prepare = prepare; }
});
