// The client displays these same quotes that the authoritative server validates.
// All prices and balances are whole gold. A quote includes the price change caused
// by each unit in the sale; multiplying the first unit's price would overpay bulk sales.
export const RESOURCE_MARKET = Object.freeze({
  wheat: Object.freeze({ label: 'Wheat' }),
  timber: Object.freeze({ label: 'Timber' }),
  stone: Object.freeze({ label: 'Stone' })
});

// Resource purchases stop at this reserve; other village expenses still use it.
export const TREASURY_RESERVE = 500;
const PRICE_BANDS = [
  { below: 25, wheat: 4, timber: 5, stone: 5 },
  { below: 100, wheat: 3, timber: 4, stone: 4 },
  { below: 300, wheat: 2, timber: 3, stone: 3 },
  { below: 1000, wheat: 1, timber: 2, stone: 2 },
  { below: Infinity, wheat: 1, timber: 1, stone: 1 }
];

function validateStock(resource, stock) {
  if (typeof resource !== 'string' || !Object.hasOwn(RESOURCE_MARKET, resource)) throw new Error('Choose wheat, timber or stone to sell.');
  if (!Number.isSafeInteger(stock) || stock < 0) throw new Error('Village stock is unavailable.');
}

/** Gold for the next unit sold, at the village's stock before receiving that unit. */
export function saleUnitPrice(resource, stock) {
  validateStock(resource, stock);
  return PRICE_BANDS.find(band => stock < band.below)[resource];
}

/** Whole-gold total for 1–60 units. Throws on invalid resource, stock or amount. */
export function saleQuote(resource, stock, amount) {
  validateStock(resource, stock);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 60) throw new Error('Sell a whole amount from 1 to 60.');
  if (!Number.isSafeInteger(stock + amount)) throw new Error('Village stock is full.');
  let total = 0;
  for (let i = 0; i < amount; i++) total += saleUnitPrice(resource, stock + i);
  return total;
}
