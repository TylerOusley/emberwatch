import { RESOURCE_WEIGHTS, inventoryWeight } from './content.js';

const stock = value => value?.inventory ?? value ?? {};
const whole = value => Number.isSafeInteger(value) && value >= 0;

// Both the preview and the server use integer item counts and weight capacity.
// A max transfer is resolved from current state when the action is received.
export function transferLimit(source, destination, resource, capacity) {
  if (!Object.hasOwn(RESOURCE_WEIGHTS, resource)) return 0;
  const available = stock(source)[resource] ?? 0, held = stock(destination)[resource] ?? 0;
  if (!whole(available) || !whole(held) || !Number.isFinite(capacity)) return 0;
  const room = Math.max(0, capacity - inventoryWeight(destination));
  return Math.min(available, Number.MAX_SAFE_INTEGER - held, Math.max(0, Math.floor((room + 1e-6) / RESOURCE_WEIGHTS[resource])));
}

export function moveResource({ source, destination, resource, action, capacity, fullMessage = 'This storage is full.' }) {
  if (!Object.hasOwn(RESOURCE_WEIGHTS, resource)) throw new Error('Choose a resource or supply from your pack.');
  if (action.max !== undefined && typeof action.max !== 'boolean') throw new Error('Choose a valid transfer amount.');
  const from = stock(source), to = stock(destination), available = from[resource] ?? 0, held = to[resource] ?? 0;
  if (!whole(available) || !whole(held)) throw new Error('These supplies cannot be transferred.');
  const maximum = transferLimit(source, destination, resource, capacity);
  const amount = action.max === true ? maximum : action.amount;
  if (action.max !== true && (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000000)) throw new Error('Choose a positive whole item amount.');
  if (!available || amount > available) throw new Error(`There is not enough ${resource} to transfer.`);
  if (!amount || amount > maximum) throw new Error(fullMessage);
  from[resource] = available - amount;
  to[resource] = held + amount;
  return amount;
}
