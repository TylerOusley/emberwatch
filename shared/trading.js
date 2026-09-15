// Only stackable inventory entries are exchangeable. Equipment, carts, bank
// balances and purchase credit have separate ownership and are never offered.
export const TRADE_ITEMS = Object.freeze({ timber: 'Timber', stone: 'Stone', wheat: 'Wheat', iron: 'Iron', coal: 'Coal', food: 'Bread', good_food: 'Hearty meal', best_food: 'Feast', arrows: 'Arrows' });
export const TRADE_RULES = Object.freeze({ range: 4, maxAmount: 1000000, invitationSeconds: 90, activeSeconds: 300 });
export const emptyTradeOffer = () => ({ resources: Object.fromEntries(Object.keys(TRADE_ITEMS).map(id => [id, 0])), gold: 0 });
export function canTrade(player) {
  return !!player?.online && player.hp > 0 && !player.downed && !player.mountedHorseId && !player.bedPlotId && !player.carriedBy && !player.carryingId;
}
export function withinTradeRange(a, b) {
  return !!a && !!b && [a.x, a.z, b.x, b.z].every(Number.isFinite) && Math.hypot(a.x - b.x, a.z - b.z) <= TRADE_RULES.range;
}
export function normalizeTradeOffer(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['resources', 'gold'].includes(key))) throw new Error('Choose resources and wallet gold for your offer.');
  if (!value.resources || typeof value.resources !== 'object' || Array.isArray(value.resources)) throw new Error('Choose resources for your offer.');
  if (Object.keys(value.resources).some(key => !Object.hasOwn(TRADE_ITEMS, key))) throw new Error('Only resources, food and arrows can be traded.');
  const amount = n => {
    if (!Number.isSafeInteger(n) || n < 0 || n > TRADE_RULES.maxAmount) throw new Error(`Trade amounts must be whole numbers from 0 to ${TRADE_RULES.maxAmount.toLocaleString('en-US')}.`);
    return n;
  };
  return { resources: Object.fromEntries(Object.keys(TRADE_ITEMS).map(id => [id, amount(Object.hasOwn(value.resources, id) ? value.resources[id] : 0)])), gold: amount(value.gold) };
}
