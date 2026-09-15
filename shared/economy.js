import { saleQuote, purchaseQuote } from './market.js';
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

export function taxedPurchaseQuote(resource, stock, amount, percent = 5) {
  const subtotal = purchaseQuote(resource, stock, amount), tax = tradeTax(subtotal, percent);
  return { subtotal, tax, total: subtotal + tax };
}
