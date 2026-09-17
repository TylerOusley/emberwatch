import { REQUEST_RULES, requestDestinations, requestAtDestination } from '../shared/requests.js';
import { TREASURY_RESERVE, saleUnitPrice } from '../shared/market.js';
import { RESOURCE_WEIGHTS, STORAGE_CAPACITY, inventoryWeight, transferableCount, boundInventoryCount } from '../shared/content.js';

const whole = value => Number.isSafeInteger(value) && value >= 0;
const record = (book, key) => book.ledger[key] ||= { withdrawn: 0, stock: 0 };
const eligible = (book, target) => Math.max(0, target.target - target.stock - (book.ledger[target.key]?.withdrawn || 0));

export function ensureRequests(v) {
  v.requests ||= { version: 1, day: v.day, spent: 0, issued: [], nextId: 1, items: [], ledger: {} };
  const book = v.requests;
  book.ledger ||= {};
  const targets = requestDestinations(v);
  for (const target of targets) {
    if (!Object.hasOwn(book.ledger, target.key)) book.ledger[target.key] = { withdrawn: 0, stock: target.stock };
  }
  // Relocate old open and historical deliveries without reissuing them, touching
  // escrow, or clearing the provenance that prevents buy/deliver payout loops.
  for (const request of book.items) if (request.destinationId === 'bank') {
    const target = targets.find(t => t.key === request.key);
    if (target) { request.destinationName = target.name; request.point = { ...target.point }; }
  }
  book.version = 2;
  return book;
}

function refund(v, request, units) {
  const gold = Math.min(request.reserved, units * request.unitGold);
  request.reserved -= gold; v.treasury += gold;
}
function close(v, request, status, reason) {
  refund(v, request, request.remaining); request.remaining = 0; request.status = status; request.reason = reason;
}
function payroll(v) {
  return Object.values(v.players || {}).filter(p => p.online || p.participated > 0)
    .reduce((sum, p) => sum + (p.role === 'guard' ? v.policies?.guardWage ?? 25 : p.role === 'priest' ? v.policies?.priestWage ?? 25 : 0), 0);
}
function unitGold(target, units) {
  if (target.destinationId === 'barracks') return 3;
  if (target.destinationId !== 'bank') return 3;
  // A small delivery bonus, quoted at the last unit in the entire bundle. Even
  // buying back the cheapest funded unit costs more than this fixed reward.
  return saleUnitPrice(target.resource, target.stock + units - 1) + 1;
}

/** Observe passive deposits (workers) and genuine consumption between actions. */
function observe(book, targets) {
  for (const target of targets) {
    const item = record(book, target.key);
    if (target.stock > item.stock) item.withdrawn = Math.max(0, item.withdrawn - (target.stock - item.stock));
    item.stock = target.stock;
  }
}

export function requestsTick(sim, v) {
  const book = ensureRequests(v), targets = requestDestinations(v), byKey = new Map(targets.map(t => [t.key, t]));
  observe(book, targets);
  for (const request of book.items.filter(r => r.status === 'open')) {
    const target = byKey.get(request.key);
    if (v.status !== 'active') { close(v, request, 'cancelled', 'The village has fallen.'); continue; }
    if (request.expiresDay <= v.day) { close(v, request, 'expired', 'The steward reviews fresh needs at dawn.'); continue; }
    if (!target || target.ownerId !== request.ownerId || target.building !== request.building) {
      close(v, request, 'cancelled', 'This destination is no longer available.'); continue;
    }
    const needed = Math.min(request.remaining, eligible(book, target));
    if (needed < request.remaining) { refund(v, request, request.remaining - needed); request.remaining = needed; }
    if (!needed) { close(v, request, 'supplied', 'Other deliveries filled this shortage.'); }
  }
  if (book.day !== v.day) { book.day = v.day; book.spent = 0; book.issued = []; }
  if (v.status !== 'active' || v.phase !== 'day' || !Object.values(v.players || {}).some(p => p.online)) return;
  const essential = TREASURY_RESERVE + 2 * payroll(v);
  for (const target of targets) {
    if (book.issued.length >= REQUEST_RULES.maxDaily) break;
    if (book.issued.includes(target.key) || target.stock >= target.target / 2 || eligible(book, target) < Math.ceil(target.target / 2)) continue;
    let units = Math.min(REQUEST_RULES.maxUnits, eligible(book, target));
    const rate = unitGold(target, units), funds = Math.min(REQUEST_RULES.dailyGold - book.spent, Math.max(0, v.treasury - essential));
    units = Math.min(units, Math.floor(funds / rate));
    if (units < 1) continue;
    const reserved = units * rate;
    const request = { id: `request-${book.nextId++}`, key: target.key, destinationId: target.destinationId, ownerId: target.ownerId,
      building: target.building, resource: target.resource, destinationName: target.name, point: target.point,
      quantity: units, delivered: 0, remaining: units, unitGold: rate, reserved, status: 'open', reason: target.reason,
      day: v.day, expiresDay: v.day + 1 };
    v.treasury -= reserved; book.spent += reserved; book.issued.push(target.key); book.items.push(request);
  }
  // Closed entries are only a short public history. Provenance and daily limits
  // are separate persisted ledgers, so trimming history cannot reopen a payout.
  const open = book.items.filter(r => r.status === 'open'), closed = book.items.filter(r => r.status !== 'open');
  book.items = [...closed.slice(-REQUEST_RULES.history), ...open];
}

// Include ruined and temporarily converted plots too. Withdrawing from a ruin
// before repairing it must not erase the provenance of those same materials.
function storeBalances(v) {
  const balances = Object.fromEntries(requestDestinations(v).map(t => [t.key, t.stock]));
  for (const plot of v.plots || []) for (const resource of ['wheat', 'coal', 'stone']) balances[`${plot.id}:${resource}`] = plot.storage?.[resource] || 0;
  return balances;
}

/** Capture all request stores before a player mutation, inside its transaction. */
export function requestsBeforeAction(v) {
  ensureRequests(v);
  return storeBalances(v);
}

/** Purchases/withdrawals are transfers, not shortages the steward should reward. */
export function requestsAfterAction(v, before, action) {
  const book = ensureRequests(v);
  for (const [key, stock] of Object.entries(storeBalances(v))) {
    const item = record(book, key), previous = before[key] ?? stock;
    const removed = Math.max(0, previous - stock), added = Math.max(0, stock - previous);
    if (removed && ['buyResource', 'plot_withdraw', 'cartPlotLoad'].includes(action.kind)) item.withdrawn += removed;
    // Rewarded deliveries fill the genuine deficit, never erase withdrawal debt.
    if (added && action.kind !== 'request_deliver') item.withdrawn = Math.max(0, item.withdrawn - added);
    item.stock = stock;
  }
}

export function requestsAction(sim, v, p, action) {
  if (action.kind !== 'request_deliver') return null;
  if (!p?.online || v.players?.[p.id] !== p) throw new Error('Join this village before making a delivery.');
  if (v.status !== 'active' || p.downed || p.bedPlotId || p.mountedHorseId) throw new Error('Stand at the destination entrance to make a delivery.');
  const book = ensureRequests(v), request = book.items.find(r => r.id === action.requestId);
  if (!request || request.status !== 'open' || request.expiresDay <= v.day) throw new Error('That delivery request has closed. Check the noticeboard.');
  const target = requestDestinations(v).find(t => t.key === request.key);
  if (!target || !requestAtDestination(p, request, v)) throw new Error('Bring these supplies to the marked destination entrance.');
  const amount = action.amount;
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > REQUEST_RULES.maxUnits) throw new Error('Choose a positive whole delivery amount.');
  if (amount > request.remaining || amount > eligible(book, target)) throw new Error('The remaining need changed. Review the noticeboard before delivering.');
  if (!whole(p.inventory?.[request.resource]) || transferableCount(p, request.resource) < amount) throw new Error(`You do not carry enough ${request.resource}.${boundInventoryCount(p, request.resource) ? ' Kit supplies cannot fund deliveries.' : ''}`);
  const plot = v.plots?.find(plot => plot.id === request.destinationId);
  const storage = request.destinationId === 'bank' ? v.stock : request.destinationId === 'barracks' ? v.barracks : plot.storage;
  if (plot && inventoryWeight(storage) + RESOURCE_WEIGHTS[request.resource] * amount > STORAGE_CAPACITY) throw new Error('This defense storage is full.');
  const gold = amount * request.unitGold;
  if (!whole(request.reserved) || gold > request.reserved || !whole(p.wallet) || !whole(p.wallet + gold) || !whole((storage[request.resource] ?? 0) + amount)) throw new Error('This delivery cannot currently be paid or stored.');
  p.inventory[request.resource] -= amount; storage[request.resource] = (storage[request.resource] ?? 0) + amount;
  request.remaining -= amount; request.delivered += amount; request.reserved -= gold;
  record(book, request.key).stock = storage[request.resource];
  if (!request.remaining) { request.status = 'complete'; request.reason = 'Residents completed this funded delivery.'; }
  // The authoritative transaction rolls back items and escrow if repayment fails.
  sim.awardIncome(v, p, gold);
  return `Delivered ${amount} ${request.resource} to ${request.destinationName}. Earned ${gold} gold before any loan repayment.`;
}

export function requestsSnapshot(v) {
  const book = ensureRequests(v);
  return { requests: { day: book.day, dailyGold: REQUEST_RULES.dailyGold, committedGold: book.spent,
    reservedGold: book.items.reduce((sum, r) => sum + r.reserved, 0),
    items: book.items.map(({ key, ...r }) => ({ ...r, point: { ...r.point } })) } };
}
