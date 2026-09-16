import { saleQuote, purchaseQuote, saleUnitPrice, MAX_TRADE_AMOUNT, TREASURY_RESERVE } from './market.js';
export { MAX_TRADE_AMOUNT } from './market.js';

export const POLICIES = Object.freeze({
  guardWage: Object.freeze({ label: 'Guard daily wage', initial: 25, min: 10, max: 60, step: 5 }),
  priestWage: Object.freeze({ label: 'Priest daily wage', initial: 25, min: 10, max: 60, step: 5 }),
  tradeTax: Object.freeze({ label: 'Trade tax %', initial: 5, min: 0, max: 20, step: 5 }),
  landTax: Object.freeze({ label: 'Land tax base', initial: 2, min: 0, max: 10, step: 2 }),
  exportPriority: Object.freeze({ label: 'Merchant export policy', initial: 'balanced', choices: ['conserve', 'balanced', 'trade'] })
});

export const FOOD = Object.freeze({
  food: Object.freeze({ label: 'Food', hunger: 25, wheat: 2, fee: 1 }),
  good_food: Object.freeze({ label: 'Good food', hunger: 60, wheat: 4, fee: 2 }),
  best_food: Object.freeze({ label: 'Best food', hunger: 100, wheat: 6, fee: 3 })
});

export const MERCHANT_PRICES = Object.freeze({ iron: 9, coal: 7, arrows: 3 });
export const MERCHANT_STOCK = Object.freeze({ iron: 30, coal: 30, arrows: 60 });
export const MERCHANT_EXPORT_PERCENTAGES = Object.freeze({ conserve: 25, balanced: 50, trade: 100 });

export function merchantExportPercent(priority) {
  return typeof priority === 'string' && Object.hasOwn(MERCHANT_EXPORT_PERCENTAGES, priority)
    ? MERCHANT_EXPORT_PERCENTAGES[priority] : MERCHANT_EXPORT_PERCENTAGES.balanced;
}

export function foodQuote(stock, tier = 'food') {
  if (typeof tier !== 'string' || !Object.hasOwn(FOOD, tier)) throw new Error('Choose food, good food or best food.');
  const item = FOOD[tier];
  if (!Number.isSafeInteger(stock) || stock < 0) throw new Error('Village wheat stock is unavailable.');
  // Quote even if sold out, while retaining the scarce-ingredient price.
  const price = purchaseQuote('wheat', Math.max(stock, item.wheat), item.wheat) - item.wheat * 2 + item.fee;
  return { ...item, price };
}

export function tradeTax(total, percent) {
  if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(percent) || percent < 0 || percent > 20) throw new Error('Invalid trade tax.');
  return Math.floor(total * percent / 100);
}

export function taxedSaleQuote(resource, stock, amount, percent = 5) {
  const gross = saleQuote(resource, stock, amount), tax = tradeTax(gross, percent);
  return { gross, tax, total: gross - tax };
}

/** Largest carried sale the current treasury can fund, using the server's exact
 * unit prices and whole-bundle tax. This is a quote only; it never moves goods. */
export function maxSaleQuote({ resource, stock, carried, treasury, percent = 5 }) {
  saleUnitPrice(resource, stock); tradeTax(0, percent);
  if (!Number.isSafeInteger(carried) || carried < 0) throw new Error('Carried stock is unavailable.');
  if (!Number.isSafeInteger(treasury) || treasury < 0) throw new Error('Village treasury is unavailable.');
  let low = 0, high = Math.min(carried, MAX_TRADE_AMOUNT, Number.MAX_SAFE_INTEGER - stock);
  const funds = Math.max(0, treasury - TREASURY_RESERVE);
  // Net whole-gold proceeds are monotonic, even at price and rounding bands.
  while (low < high) {
    const amount = Math.ceil((low + high) / 2);
    if (taxedSaleQuote(resource, stock, amount, percent).total <= funds) low = amount;
    else high = amount - 1;
  }
  return { amount: low, quote: low ? taxedSaleQuote(resource, stock, low, percent) : { gross: 0, tax: 0, total: 0 } };
}

export function taxedPurchaseQuote(resource, stock, amount, percent = 5) {
  const subtotal = purchaseQuote(resource, stock, amount), tax = tradeTax(subtotal, percent);
  return { subtotal, tax, total: subtotal + tax };
}
