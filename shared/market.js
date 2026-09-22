// The client displays these same quotes that the authoritative server validates.
// All prices and balances are whole gold. A quote includes the price change caused
// by each unit in the sale; multiplying the first unit's price would overpay bulk sales.
export const RESOURCE_MARKET = Object.freeze({
  wheat: Object.freeze({ label: 'Wheat' }),
  timber: Object.freeze({ label: 'Timber' }),
  stone: Object.freeze({ label: 'Stone' }),
  iron: Object.freeze({ label: 'Iron ore' }),
  iron_ingot: Object.freeze({ label: 'Iron ingot' }),
  steel_ingot: Object.freeze({ label: 'Steel ingot' }),
  coal: Object.freeze({ label: 'Coal' }),
  sulfur: Object.freeze({ label: 'Sulfur' })
});

// Resource purchases stop at this reserve; other village expenses still use it.
export const TREASURY_RESERVE = 500;
export const MAX_TRADE_AMOUNT = 10000;
const PRICE_BANDS = [
  { below: 25, wheat: 4, timber: 5, stone: 5, iron: 7, iron_ingot: 10, steel_ingot: 16, coal: 5, sulfur: 6 },
  { below: 100, wheat: 3, timber: 4, stone: 4, iron: 6, iron_ingot: 9, steel_ingot: 14, coal: 4, sulfur: 5 },
  { below: 300, wheat: 2, timber: 3, stone: 3, iron: 5, iron_ingot: 8, steel_ingot: 12, coal: 3, sulfur: 4 },
  { below: 1000, wheat: 1, timber: 2, stone: 2, iron: 4, iron_ingot: 7, steel_ingot: 11, coal: 2, sulfur: 3 },
  { below: Infinity, wheat: 1, timber: 1, stone: 1, iron: 3, iron_ingot: 6, steel_ingot: 10, coal: 2, sulfur: 2 }
];

function validateStock(resource, stock) {
  if (typeof resource !== 'string' || !Object.hasOwn(RESOURCE_MARKET, resource)) throw new Error('Choose wheat, timber, stone, iron ore, iron ingots, steel ingots, coal or sulfur to trade.');
  if (!Number.isSafeInteger(stock) || stock < 0) throw new Error('Village stock is unavailable.');
}

/** Gold for the next unit sold, at the village's stock before receiving that unit. */
export function saleUnitPrice(resource, stock) {
  validateStock(resource, stock);
  return PRICE_BANDS.find(band => stock < band.below)[resource];
}

/** Whole-gold total for a bounded bulk trade. Invalid quotes never enter a loop. */
export function saleQuote(resource, stock, amount) {
  validateStock(resource, stock);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > MAX_TRADE_AMOUNT) throw new Error(`Sell a whole amount from 1 to ${MAX_TRADE_AMOUNT}.`);
  if (!Number.isSafeInteger(stock + amount)) throw new Error('Village stock is full.');
  let total = 0;
  for (let i = 0; i < amount; i++) total += saleUnitPrice(resource, stock + i);
  return total;
}

/** Purchase the last unit at its pre-deposit bid plus a two-gold spread. */
export function purchaseQuote(resource, stock, amount) {
  validateStock(resource, stock);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > MAX_TRADE_AMOUNT) throw new Error(`Buy a whole amount from 1 to ${MAX_TRADE_AMOUNT}.`);
  if (amount > stock) throw new Error('The village does not have enough of that resource.');
  let total = 0;
  for (let i = 0; i < amount; i++) total += saleUnitPrice(resource, stock - i - 1) + 2;
  return total;
}
