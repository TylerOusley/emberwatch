import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createApp } from '../server/index.js';
import { BUILDINGS } from '../shared/world.js';
import { saleQuote, saleUnitPrice, TREASURY_RESERVE, MAX_TRADE_AMOUNT } from '../shared/market.js';
import { taxedSaleQuote } from '../shared/economy.js';

const treasury = BUILDINGS.find(b => b.id === 'bank');
const visitTreasury = player => Object.assign(player, { x: treasury.x, z: treasury.z + treasury.d / 2 + 1 });

async function fixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'emberwatch-market-'));
  const context = { dataDir, app: createApp({ dataDir, autoTick: false }) };
  t.after(async () => { await context.app.close(); await rm(dataDir, { recursive: true, force: true }); });
  return context;
}
async function account(app, name) {
  const session = await app.store.authenticate('register', name, 'a-good-test-pass');
  return { session, user: app.store.accountFromToken(session.token) };
}
async function settlement(app, name = 'MarketDwarf') {
  const { user } = await account(app, name);
  const { id } = app.simulation.create('Marketwatch', user);
  const player = app.simulation.join(id, user), village = app.simulation.villages.get(id);
  visitTreasury(player);
  return { player, village };
}
function rejectedUnchanged(app, village, player, action, pattern) {
  const before = JSON.stringify(village), saved = app.store.loadVillages();
  const bank = app.store.account(player.id).bank;
  assert.throws(() => app.simulation.action(village.id, player.id, action), pattern);
  assert.equal(JSON.stringify(village), before, 'rejected sale changes no live village state');
  assert.deepEqual(app.store.loadVillages(), saved, 'rejected sale changes no saved village state');
  assert.equal(app.store.account(player.id).bank, bank, 'personal bank savings never fund village purchases');
}
async function waitFor(fn, timeout = 2000) {
  const end = performance.now() + timeout;
  while (performance.now() < end) {
    const result = fn();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for a market response.');
}
async function joinSocket(base, session, villageId) {
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/socket'), queue = [];
  ws.on('message', data => queue.push(JSON.parse(data.toString())));
  await once(ws, 'open');
  ws.send(JSON.stringify({ type: 'join', token: session.token, villageId, role: 'villager' }));
  await waitFor(() => queue.find(message => message.type === 'state'));
  return { ws, queue };
}

test('resource scarcity raises prices, and bulk quotes include crossed stock tiers', () => {
  assert.equal(TREASURY_RESERVE, 500);
  assert.equal(saleUnitPrice('wheat', 10), 4);
  assert.equal(saleUnitPrice('wheat', 1500), 1);
  assert.equal(saleUnitPrice('timber', 0), 5);
  assert.equal(saleUnitPrice('stone', 1500), 1);
  assert.equal(saleQuote('wheat', 24, 2), 7, 'first unit earns 4, second earns 3');
  assert.equal(saleQuote('wheat', 24, 60), 181);
  assert.equal(saleQuote('stone', 99, 3), 10, 'stock 99 pays 4, then 3 per unit');
  assert.equal(saleQuote('timber', 299, 3), 7);
  assert.equal(saleQuote('stone', 999, 3), 4);
  assert.equal(saleQuote('wheat', 1000, 60), 60);
});

test('quote helper rejects unsupported resources and unsafe or non-whole quantities', () => {
  for (const resource of ['food', '__proto__', 'constructor', null, {}]) assert.throws(() => saleQuote(resource, 10, 1), /Choose/);
  for (const stock of [-1, .5, NaN, Infinity, '25']) assert.throws(() => saleQuote('wheat', stock, 1), /stock/);
  for (const amount of [-1, 0, .5, MAX_TRADE_AMOUNT + 1, Infinity, '2']) assert.throws(() => saleQuote('wheat', 10, amount), /whole amount/);
  assert.throws(() => saleQuote('wheat', Number.MAX_SAFE_INTEGER, 1), /stock is full/);
});

test('market rejects invalid, remote, downed, unaffordable and stale sales atomically', async t => {
  const { app } = await fixture(t);
  const { village, player } = await settlement(app);
  player.inventory.wheat = 3; village.stock.wheat = 24;
  const valid = { kind: 'sell', resource: 'wheat', amount: 1, minTotal: 4 };
  const reject = (patch, pattern) => rejectedUnchanged(app, village, player, { ...valid, ...patch }, pattern);
  for (const resource of ['food', 'gold', '__proto__']) reject({ resource }, /Choose/);
  for (const amount of [-1, 0, 1.5, MAX_TRADE_AMOUNT + 1, '1']) reject({ amount }, /whole amount/);
  for (const minTotal of [-1, 0, 1.5, '4', Infinity]) reject({ minTotal }, /whole-gold/);
  reject({ amount: 4 }, /not have enough wheat/);
  reject({ minTotal: 5 }, /price changed/);
  village.treasury = TREASURY_RESERVE + 3;
  reject({}, /essential expenses/);
  village.treasury = 2500;
  player.x = 0; player.z = 4;
  reject({}, /Visit the Village Treasury/);
  visitTreasury(player); player.downed = true;
  reject({}, /downed/);
  player.downed = false; player.lastAction = village.clock;
  reject({}, /next action/);
  player.lastAction = -100; player.online = false;
  reject({}, /Join a village first/);
  player.online = true; village.status = 'fallen';
  reject({}, /run has ended/);
});

test('sales transfer real inventory and treasury gold, stop at the reserve, and keep savings separate', async t => {
  const { app } = await fixture(t);
  const { village, player } = await settlement(app, 'FiniteFunds');
  player.inventory.wheat = 2; village.stock.wheat = 24;
  app.store.bank(player.id, 17);
  village.treasury = TREASURY_RESERVE + 4;
  const wallet = player.wallet;
  const result = app.simulation.action(village.id, player.id, { kind: 'sell', resource: 'wheat', amount: 1, minTotal: 3 });
  assert.match(result, /Sold 1 wheat for 4 gold/, 'a quote that improves is accepted at the higher price');
  assert.equal(player.inventory.wheat, 1); assert.equal(village.stock.wheat, 25);
  assert.equal(player.wallet, wallet + 4); assert.equal(village.treasury, TREASURY_RESERVE);
  assert.equal(app.store.account(player.id).bank, 17);
  village.clock += 1;
  rejectedUnchanged(app, village, player, { kind: 'sell', resource: 'wheat', amount: 1, minTotal: 3 }, /essential expenses/);
});

test('two real WebSocket sellers cannot both receive an out-of-date scarce-stock price', async t => {
  const { app } = await fixture(t);
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const first = await account(app, 'FirstSeller'), second = await account(app, 'SecondSeller');
  const { id } = app.simulation.create('Shared Market', first.user), village = app.simulation.villages.get(id);
  village.stock.wheat = 24;
  const a = await joinSocket(base, first.session, id), b = await joinSocket(base, second.session, id);
  for (const p of Object.values(village.players)) { visitTreasury(p); p.inventory.wheat = 1; }
  const firstQuote = saleQuote('wheat', a.queue.find(m => m.type === 'state').state.stock.wheat, 1);
  const secondQuote = saleQuote('wheat', b.queue.find(m => m.type === 'state').state.stock.wheat, 1);
  assert.equal(firstQuote, 4); assert.equal(secondQuote, 4);
  const response = client => client.queue.find(m => m.type === 'notice' || m.type === 'error');
  a.ws.send(JSON.stringify({ type: 'action', kind: 'sell', resource: 'wheat', amount: 1, minTotal: firstQuote }));
  b.ws.send(JSON.stringify({ type: 'action', kind: 'sell', resource: 'wheat', amount: 1, minTotal: secondQuote }));
  await waitFor(() => response(a) && response(b));
  assert.deepEqual([response(a).type, response(b).type].sort(), ['error', 'notice']);
  const loser = response(a).type === 'error' ? a : b;
  assert.match(response(loser).message, /price changed/);
  assert.equal(village.stock.wheat, 25); assert.equal(village.treasury, 19996);
  assert.deepEqual(Object.values(village.players).map(p => p.inventory.wheat).sort(), [0, 1]);
  assert.deepEqual(Object.values(village.players).map(p => p.wallet).sort((a, b) => a - b), [10, 14]);
  app.broadcast();
  const updated = await waitFor(() => loser.queue.find(m => m.type === 'state' && m.state.stock.wheat === 25));
  loser.queue.length = 0;
  loser.ws.send(JSON.stringify({ type: 'action', kind: 'sell', resource: 'wheat', amount: 1, minTotal: saleQuote('wheat', updated.state.stock.wheat, 1) }));
  await waitFor(() => response(loser));
  assert.equal(response(loser).type, 'notice', 'a failed quote does not consume the action cooldown');
  assert.equal(village.stock.wheat, 26); assert.equal(village.treasury, 19993);
  assert.deepEqual(Object.values(village.players).map(p => p.inventory.wheat), [0, 0]);
  assert.deepEqual(Object.values(village.players).map(p => p.wallet).sort((a, b) => a - b), [13, 14]);
  a.ws.close(); b.ws.close();
  await waitFor(() => Object.values(village.players).every(p => !p.online));
});

test('accepted sales recover with consistent inventory, stock and gold after SQLite reload', async t => {
  const context = await fixture(t), { app } = context;
  const { village, player } = await settlement(app, 'SavedSeller');
  player.inventory.timber = 60; village.stock.timber = 95;
  app.store.bank(player.id, 17);
  const { gross, tax, total: quote } = taxedSaleQuote('timber', 95, 60, village.policies.tradeTax);
  assert.equal(gross, 185); assert.equal(tax, 9); assert.equal(quote, 176);
  app.simulation.action(village.id, player.id, { kind: 'sell', resource: 'timber', amount: 60, minTotal: quote });
  const saved = app.store.loadVillages().find(v => v.id === village.id);
  assert.equal(saved.stock.timber, 155); assert.equal(saved.players[player.id].wallet, 186);
  assert.equal(saved.players[player.id].inventory.timber, 0); assert.equal(saved.treasury, 19824);
  await app.close();
  context.app = createApp({ dataDir: context.dataDir, autoTick: false });
  const recovered = context.app.simulation.villages.get(village.id);
  assert.equal(recovered.stock.timber, 155); assert.equal(recovered.treasury, 19824);
  assert.equal(recovered.players[player.id].inventory.timber, 0);
  assert.equal(recovered.players[player.id].wallet, 186);
  assert.equal(recovered.players[player.id].online, false);
  assert.equal(context.app.store.account(player.id).bank, 17);
});
