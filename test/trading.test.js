import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { Simulation } from '../server/simulation.js';
import { TRADE_RULES, TRADE_ITEMS } from '../shared/trading.js';
import { ensureTrading, tradingAction, tradingTick, tradingSnapshot, cancelPlayerTrades } from '../server/trading.js';

function fixture() {
  const player = (id, x) => ({ id, name: id, online: true, hp: 100, role: 'villager', x, z: 4, wallet: 100, inventory: { timber: 20, stone: 10, wheat: 10, arrows: 5 }, durability: {} });
  const a = player('alice', 0), b = player('bob', 1), c = player('carol', 2);
  const v = { id: 'village', status: 'active', clock: 0, players: { alice: a, bob: b, carol: c } }, sim = {};
  ensureTrading(v);
  const act = (p, kind, fields = {}) => tradingAction(sim, v, p, { kind, ...(v.trades[0] ? { tradeId: v.trades[0].id } : {}), ...fields });
  const invite = () => { act(a, 'trade_invite', { targetId: b.id }); return v.trades[0]; };
  const start = () => { const trade = invite(); act(b, 'trade_accept'); return trade; };
  const offer = (p, resources = {}, gold = 0) => act(p, 'trade_offer', { offer: { resources, gold } });
  const confirm = p => act(p, 'trade_confirm', { version: v.trades[0]?.version });
  return { v, a, b, c, sim, act, invite, start, offer, confirm };
}
const unchanged = (v, fn, pattern) => { const before = structuredClone(v); assert.throws(fn, pattern); assert.deepEqual(v, before); };
const possessions = ({ a, b, c }) => [a, b, c].map(p => ({ id: p.id, wallet: p.wallet, inventory: structuredClone(p.inventory) }));

test('nearby invitation, two-sided offers and confirmation exchange exactly once while keeping private balances private', () => {
  const f = fixture(), { v, a, b, c, act } = f, trade = f.start();
  f.offer(a, { timber: 10, arrows: 2 }, 7); f.offer(b, { stone: 4 }, 13);
  const prior = possessions(f);
  f.confirm(a); assert.deepEqual(possessions(f), prior, 'confirmation does not escrow anything');
  assert.equal(tradingSnapshot(v, c.id).trading.trade, null);
  const snap = tradingSnapshot(v, b.id).trading.trade;
  assert.equal(snap.offers.alice.gold, 7); assert.equal(snap.players.some(p => 'wallet' in p || 'inventory' in p), false);
  snap.offers.alice.gold = 999; assert.equal(trade.offers.alice.gold, 7, 'snapshots cannot mutate live offers');
  f.confirm(b);
  assert.equal(v.trades.length, 0); assert.equal(a.wallet, 106); assert.equal(b.wallet, 94);
  assert.equal(a.inventory.timber, 10); assert.equal(b.inventory.timber, 30);
  assert.equal(a.inventory.stone, 14); assert.equal(b.inventory.stone, 6);
  assert.equal(a.inventory.arrows, 3); assert.equal(b.inventory.arrows, 7);
  assert.equal(tradingSnapshot(v, a.id).trading.result.status, 'completed');
  unchanged(v, () => act(b, 'trade_confirm', { tradeId: trade.id, version: trade.version }), /no longer/);
  assert.deepEqual(possessions(f)[2], prior[2], 'an uninvolved player receives nothing');
});

test('offer edits reset both confirmations and stale confirmation versions cannot commit', () => {
  const f = fixture(), trade = f.start(); f.offer(f.a, { timber: 5 }); f.confirm(f.a);
  const version = trade.version; assert.equal(trade.confirmations.alice, true);
  f.offer(f.b, {}, 3); assert.equal(trade.version, version + 1);
  assert.deepEqual(trade.confirmations, { alice: false, bob: false });
  unchanged(f.v, () => f.act(f.b, 'trade_confirm', { version }), /offer changed/);
  const before = possessions(f); f.confirm(f.b); assert.deepEqual(possessions(f), before);
  f.confirm(f.b); assert.deepEqual(possessions(f), before, 'repeated confirmation by one party cannot act as both parties');
  f.confirm(f.a); assert.equal(f.a.wallet, 103); assert.equal(f.b.inventory.timber, 25);
});

test('invite, accept and offer authorization rejects self-trading, busy players and forged actors', () => {
  const f = fixture();
  unchanged(f.v, () => f.act(f.a, 'trade_invite', { targetId: f.a.id }), /another player/);
  unchanged(f.v, () => f.act({ ...f.a }, 'trade_invite', { targetId: f.b.id }), /Join/);
  const trade = f.invite();
  unchanged(f.v, () => f.act(f.c, 'trade_invite', { targetId: f.b.id }), /already in a trade/);
  unchanged(f.v, () => f.act(f.a, 'trade_accept'), /Only the invited/);
  unchanged(f.v, () => f.act(f.c, 'trade_accept', { tradeId: trade.id }), /no longer/);
  unchanged(f.v, () => f.offer(f.a, { timber: 1 }), /accept/);
  f.act(f.b, 'trade_accept');
  unchanged(f.v, () => f.act(f.b, 'trade_accept'), /Only the invited/);
  unchanged(f.v, () => f.act(f.a, 'trade_offer', { tradeId: 'forged', offer: { resources: {}, gold: 0 } }), /no longer/);
});

test('trade offers reject unsafe numeric values, unowned gold, equipment and inherited-name inventory entries', () => {
  const f = fixture(); f.start();
  for (const n of [-1, 1.5, '10', NaN, Infinity, TRADE_RULES.maxAmount + 1, Number.MAX_SAFE_INTEGER]) {
    unchanged(f.v, () => f.offer(f.a, { timber: n }), /whole numbers/);
    unchanged(f.v, () => f.offer(f.a, {}, n), /whole numbers/);
  }
  for (const item of ['cart', 'bow', 'sword', 'constructor', '__proto__']) {
    const resources = JSON.parse(`{"${item}":1}`);
    unchanged(f.v, () => f.offer(f.a, resources), /Only resources/);
  }
  for (const offer of [null, [], {}, { resources: null, gold: 0 }, { resources: [], gold: 0 }, { resources: {}, gold: 0, wallet: 90 }]) unchanged(f.v, () => f.act(f.a, 'trade_offer', { offer }), /Choose/);
  unchanged(f.v, () => f.offer(f.a, {}, 101), /wallet gold/);
  unchanged(f.v, () => f.offer(f.a, { timber: 21 }), /enough timber/);
  unchanged(f.v, () => f.confirm(f.a), /Add at least/);
});

test('final confirmation rechecks spent gold, removed resources and both pack capacities before any mutation', () => {
  for (const mutate of [f => { f.a.wallet = 0; }, f => { f.a.inventory.timber = 0; }, f => { f.b.inventory.stone = 50; }]) {
    const f = fixture(); f.start(); f.offer(f.a, { timber: 10 }, 10); f.offer(f.b, {}, 1); f.confirm(f.a);
    mutate(f); unchanged(f.v, () => f.confirm(f.b), /enough|room/);
  }
});

test('equal weight exchanges can free receiving capacity and include equipped tool weight', () => {
  const f = fixture();
  f.a.inventory = { timber: 75 }; f.b.inventory = { stone: 50 }; f.start();
  f.offer(f.a, { timber: 15 }); f.offer(f.b, { stone: 10 }); f.confirm(f.a); f.confirm(f.b);
  assert.equal(f.a.inventory.stone, 10); assert.equal(f.b.inventory.timber, 15);
  const g = fixture(); g.a.inventory = { timber: 20 }; g.b.inventory = { timber: 74 }; g.b.durability = { axe: 100 }; g.start(); g.offer(g.a, { timber: 1 });
  unchanged(g.v, () => g.confirm(g.b), /room/);
});

test('standing, online state, village status and distance are checked on every action and in ticks', () => {
  for (const mutate of [f => { f.b.online = false; }, f => { f.b.downed = true; }, f => { f.b.hp = 0; }, f => { f.b.mountedHorseId = 'horse'; }, f => { f.b.bedPlotId = 'bed'; }, f => { f.b.carryingId = 'other'; }, f => { f.b.carriedBy = 'other'; }, f => { f.b.x = 5; }, f => { f.b.x = NaN; }, f => { f.v.status = 'fallen'; }]) {
    const f = fixture(); f.start(); f.offer(f.a, {}, 10); f.confirm(f.a); mutate(f);
    unchanged(f.v, () => f.confirm(f.b), /Both players|Stay close|Join/);
    const before = possessions(f); tradingTick(f.sim, f.v); assert.equal(f.v.trades.length, 0); assert.deepEqual(possessions(f), before);
    assert.equal(tradingSnapshot(f.v, f.a.id).trading.result.status, 'cancelled');
  }
});

test('cancel, decline, timeout and disconnect never move resources or gold, even after one confirmation', () => {
  for (const close of [f => f.act(f.b, 'trade_cancel'), f => cancelPlayerTrades(f.v, f.a.id), f => { f.v.clock = f.v.trades[0].expiresAt; tradingTick(f.sim, f.v); }]) {
    const f = fixture(); f.start(); f.offer(f.a, { timber: 10 }, 5); f.confirm(f.a); const before = possessions(f);
    close(f); assert.equal(f.v.trades.length, 0); assert.deepEqual(possessions(f), before);
  }
  const f = fixture(); const invitation = f.invite(); assert.equal(invitation.expiresAt, TRADE_RULES.invitationSeconds);
  f.v.clock = TRADE_RULES.invitationSeconds; tradingTick(f.sim, f.v); assert.equal(f.v.trades.length, 0);
});

test('snapshot offer keys remain bounded to explicitly supported inventory, and integer overflow is rejected', () => {
  const f = fixture(); const trade = f.start(); assert.deepEqual(Object.keys(trade.offers.alice.resources), Object.keys(TRADE_ITEMS));
  f.a.wallet = Number.MAX_SAFE_INTEGER; f.offer(f.b, {}, 1);
  unchanged(f.v, () => f.confirm(f.b), /wallet would exceed/);
});

test('simulation transaction rolls back both sides on failed persistence and saved invitations cancel on restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'emberwatch-trading-'));
  const store = new Store(directory); t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  const session = await store.authenticate('register', 'TradingAlice', 'protected-test-password');
  const second = await store.authenticate('register', 'TradingBobby', 'protected-test-password');
  const sim = new Simulation(store), villageId = sim.create('Trading Hearth', store.account(session.playerId)).id;
  const a = sim.join(villageId, store.account(session.playerId)), b = sim.join(villageId, store.account(second.playerId)), v = sim.villages.get(villageId);
  a.wallet = b.wallet = 100; a.inventory.timber = 20; b.inventory.stone = 10; a.x = 0; b.x = 1; a.z = b.z = 4;
  function act(p, kind, fields = {}) { v.clock += .6; return sim.action(villageId, p.id, { kind, ...(v.trades[0] ? { tradeId: v.trades[0].id } : {}), ...fields }); }
  act(a, 'trade_invite', { targetId: b.id }); act(b, 'trade_accept');
  act(a, 'trade_offer', { offer: { resources: { timber: 10 }, gold: 5 } }); act(b, 'trade_offer', { offer: { resources: { stone: 5 }, gold: 7 } });
  act(a, 'trade_confirm', { version: v.trades[0].version });
  const possessions = [structuredClone(a.inventory), structuredClone(b.inventory), a.wallet, b.wallet], save = store.saveVillage.bind(store);
  store.saveVillage = () => { throw new Error('Injected save failure'); };
  assert.throws(() => act(b, 'trade_confirm', { version: v.trades[0].version }), /Injected save failure/);
  assert.deepEqual([a.inventory, b.inventory, a.wallet, b.wallet], possessions);
  assert.equal(v.trades.length, 1); assert.equal(v.trades[0].confirmations[a.id], true);
  store.saveVillage = save;
  act(b, 'trade_confirm', { version: v.trades[0].version }); assert.equal(v.trades.length, 0);
  const saved = store.loadVillages().find(row => row.id === v.id); assert.equal(saved.players[a.id].wallet, 102); assert.equal(saved.players[b.id].inventory.timber, 10);
  act(a, 'trade_invite', { targetId: b.id });
  const restored = new Simulation(store).villages.get(villageId);
  assert.equal(restored.trades.length, 0); assert.equal(restored.players[a.id].wallet, 102); assert.equal(restored.tradeResults[a.id].status, 'cancelled');
});
