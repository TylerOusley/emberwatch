import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS } from '../shared/world.js';
import { MAX_TRADE_AMOUNT, saleQuote, purchaseQuote } from '../shared/market.js';
import { taxedSaleQuote, taxedPurchaseQuote, MAX_TRADE_AMOUNT as sharedLimit } from '../shared/economy.js';
import { ensureEconomy, economyAction } from '../server/economy.js';
import { inventoryWeight } from '../shared/content.js';

test('bulk quotes price every crossed stock band and cap work at ten thousand units', () => {
  assert.equal(MAX_TRADE_AMOUNT, 10000); assert.equal(sharedLimit, MAX_TRADE_AMOUNT);
  assert.equal(saleQuote('wheat', 10, 550), 945);
  assert.equal(purchaseQuote('wheat', 560, 550), 2045);
  assert.equal(saleQuote('wheat', 0, MAX_TRADE_AMOUNT), 10425);
  assert.equal(purchaseQuote('wheat', MAX_TRADE_AMOUNT, MAX_TRADE_AMOUNT), 30425);
  for (const amount of [0, -1, .5, '550', NaN, Infinity, MAX_TRADE_AMOUNT + 1, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => saleQuote('wheat', 20000, amount), /whole amount/);
    assert.throws(() => purchaseQuote('wheat', 20000, amount), /whole amount/);
  }
  assert.throws(() => saleQuote('wheat', Number.MAX_SAFE_INTEGER, 1), /stock is full/);
  assert.throws(() => purchaseQuote('wheat', 549, 550), /not have enough/);
});

test('a full expedition backpack trades in one action with finite gold, inventory and storage', () => {
  const bank = BUILDINGS.find(b => b.id === 'bank');
  const player = { id: 'bulk', role: 'villager', backpackTier: 3, x: bank.x - bank.w / 2 - 1, z: bank.z, online: true, wallet: 5000, inventory: { wheat: 550 }, durability: {} };
  const village = { players: { bulk: player }, stock: { wheat: 10 }, treasury: 10000, day: 1, policies: {} };
  ensureEconomy(village);
  const run = action => economyAction({}, village, player, action);
  const sale = taxedSaleQuote('wheat', 10, 550, 5);
  run({ kind: 'sell', resource: 'wheat', amount: 550, minTotal: sale.total });
  assert.equal(player.inventory.wheat, 0); assert.equal(village.stock.wheat, 560);
  assert.equal(player.wallet, 5000 + sale.total); assert.equal(village.treasury, 10000 - sale.total);
  const purchase = taxedPurchaseQuote('wheat', 560, 550, 5);
  run({ kind: 'buyResource', resource: 'wheat', amount: 550, maxTotal: purchase.total });
  assert.equal(inventoryWeight(player), 550); assert.equal(village.stock.wheat, 10);
  assert.equal(player.wallet, 5000 + sale.total - purchase.total);
  assert.equal(village.treasury, 10000 - sale.total + purchase.total);
  const before = structuredClone(village);
  assert.throws(() => run({ kind: 'buyResource', resource: 'wheat', amount: 1, maxTotal: 100 }), /pack is full/);
  assert.deepEqual(village, before, 'a larger bulk limit never bypasses the actual carry limit');
  assert.throws(() => run({ kind: 'sell', resource: 'wheat', amount: MAX_TRADE_AMOUNT + 1, minTotal: 1 }), /whole amount/);
  assert.deepEqual(village, before);
  assert.throws(() => run({ kind: 'sell', resource: 'wheat', amount: 551, minTotal: 1 }), /not have enough/);
  assert.deepEqual(village, before);
  village.treasury = 500;
  assert.throws(() => run({ kind: 'sell', resource: 'wheat', amount: 550, minTotal: sale.total }), /essential expenses/);
  assert.equal(player.inventory.wheat, 550, 'the reserve check applies to the entire bulk sale');
});
