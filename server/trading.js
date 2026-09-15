import { randomUUID } from 'node:crypto';
import { carryCapacity, inventoryWeight, transferableCount, boundInventoryCount } from '../shared/content.js';
import { TRADE_ITEMS, TRADE_RULES, emptyTradeOffer, normalizeTradeOffer, canTrade, withinTradeRange } from '../shared/trading.js';

export function ensureTrading(village) {
  village.trades ??= [];
  village.tradeResults ??= {};
}
const involved = (trade, playerId) => trade.playerIds.includes(playerId);
const current = (village, playerId) => (village.trades ?? []).find(trade => involved(trade, playerId));
function closeTrade(village, trade, status, message) {
  for (const id of trade.playerIds) village.tradeResults[id] = { id: trade.id, status, message };
  village.trades = village.trades.filter(row => row.id !== trade.id);
}
export function cancelPlayerTrades(village, playerId, message = 'Trade cancelled because a player disconnected. Nothing was exchanged.') {
  ensureTrading(village);
  for (const trade of [...village.trades]) if (involved(trade, playerId)) closeTrade(village, trade, 'cancelled', message);
}
function pairError(village, trade) {
  const [a, b] = trade.playerIds.map(id => village.players[id]);
  if (village.status !== 'active' || !canTrade(a) || !canTrade(b)) return 'Both players must be alive, online and standing on foot to trade.';
  if (!withinTradeRange(a, b)) return 'Stay close to your trading partner.';
  if (village.clock >= trade.expiresAt) return 'The trade expired.';
  return null;
}
export function tradingTick(simulation, village) {
  ensureTrading(village);
  for (const trade of [...village.trades]) {
    const error = pairError(village, trade);
    if (error) closeTrade(village, trade, 'cancelled', `${error} Nothing was exchanged.`);
  }
}
function inventoryCount(player, id) {
  const n = player.inventory?.[id] ?? 0;
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${player.name}'s inventory cannot be traded right now.`);
  return n;
}
function walletGold(player) {
  if (!Number.isSafeInteger(player.wallet) || player.wallet < 0) throw new Error(`${player.name}'s wallet cannot be traded right now.`);
  return player.wallet;
}
function validateStock(player, offer) {
  if (offer.gold > walletGold(player)) throw new Error(`${player.name} no longer has enough wallet gold for this offer.`);
  for (const [id, amount] of Object.entries(offer.resources)) {
    inventoryCount(player, id);
    if (amount > transferableCount(player, id)) throw new Error(`${player.name} no longer has enough ${TRADE_ITEMS[id].toLowerCase()} for this offer.${boundInventoryCount(player, id) ? ' Kit supplies stay with their owner.' : ''}`);
  }
}
function exchangeQuote(village, trade) {
  return trade.playerIds.map((id, index) => {
    const player = village.players[id], own = normalizeTradeOffer(trade.offers[id]), other = normalizeTradeOffer(trade.offers[trade.playerIds[1 - index]]);
    validateStock(player, own);
    const inventory = { ...player.inventory };
    for (const item of Object.keys(TRADE_ITEMS)) {
      const n = inventoryCount(player, item) - own.resources[item] + other.resources[item];
      if (!Number.isSafeInteger(n) || n < 0) throw new Error('The resulting inventory would exceed its allowed amount.');
      inventory[item] = n;
    }
    const wallet = walletGold(player) - own.gold + other.gold;
    if (!Number.isSafeInteger(wallet) || wallet < 0) throw new Error('The resulting wallet would exceed its allowed amount.');
    if (inventoryWeight({ ...player, inventory }) > carryCapacity(player)) throw new Error(`${player.name} needs more room in their pack before this trade can complete.`);
    return { player, inventory, wallet };
  });
}
export function tradingAction(simulation, village, player, action) {
  if (!['trade_invite', 'trade_accept', 'trade_offer', 'trade_confirm', 'trade_cancel'].includes(action.kind)) return null;
  ensureTrading(village);
  if (!player || village.players[player.id] !== player || !player.online) throw new Error('Join this village before trading.');
  if (action.kind === 'trade_invite') {
    const target = typeof action.targetId === 'string' && village.players[action.targetId];
    if (village.status !== 'active' || !canTrade(player) || !canTrade(target)) throw new Error('Both players must be alive, online and standing on foot to trade.');
    if (player.id === target.id) throw new Error('Choose another player to trade with.');
    if (!withinTradeRange(player, target)) throw new Error('Move closer to the player you want to trade with.');
    if (current(village, player.id) || current(village, target.id)) throw new Error('One of you is already in a trade. Finish or cancel it first.');
    const trade = { id: randomUUID(), playerIds: [player.id, target.id], inviterId: player.id, status: 'invited', version: 1, expiresAt: village.clock + TRADE_RULES.invitationSeconds,
      offers: { [player.id]: emptyTradeOffer(), [target.id]: emptyTradeOffer() }, confirmations: { [player.id]: false, [target.id]: false } };
    village.trades.push(trade);
    return `Trade invitation sent to ${target.name}.`;
  }
  const trade = current(village, player.id);
  if (!trade || typeof action.tradeId !== 'string' || action.tradeId !== trade.id) throw new Error('That trade is no longer available.');
  if (action.kind === 'trade_cancel') {
    closeTrade(village, trade, 'cancelled', `${player.name} cancelled the trade. Nothing was exchanged.`);
    return 'Trade cancelled. Nothing was exchanged.';
  }
  const error = pairError(village, trade);
  if (error) throw new Error(error);
  if (action.kind === 'trade_accept') {
    if (trade.status !== 'invited' || trade.inviterId === player.id) throw new Error('Only the invited player can accept this invitation.');
    trade.status = 'active'; trade.expiresAt = village.clock + TRADE_RULES.activeSeconds;
    return 'Trade accepted. Set your offer, then both confirm the same terms.';
  }
  if (trade.status !== 'active') throw new Error('Wait for your partner to accept the invitation.');
  if (action.kind === 'trade_offer') {
    const offer = normalizeTradeOffer(action.offer);
    validateStock(player, offer);
    if (JSON.stringify(offer) === JSON.stringify(trade.offers[player.id])) return 'Your offer is unchanged.';
    trade.offers[player.id] = offer; trade.version++;
    for (const id of trade.playerIds) trade.confirmations[id] = false;
    trade.expiresAt = village.clock + TRADE_RULES.activeSeconds;
    return 'Offer updated. Both players must confirm these new terms.';
  }
  if (!Number.isSafeInteger(action.version) || action.version !== trade.version) throw new Error('The offer changed. Review the latest terms and confirm again.');
  if (!Object.values(trade.offers).some(offer => offer.gold > 0 || Object.values(offer.resources).some(amount => amount > 0))) throw new Error('Add at least one resource or some gold before confirming.');
  // Compute every post-trade balance before moving anything. Confirmations do
  // not reserve inventory; availability and net carrying capacity are rechecked
  // on both confirmations. Simulation.action persists all changes atomically.
  const exchange = exchangeQuote(village, trade);
  const partnerId = trade.playerIds.find(id => id !== player.id);
  if (!trade.confirmations[partnerId]) {
    trade.confirmations[player.id] = true; trade.expiresAt = village.clock + TRADE_RULES.activeSeconds;
    return 'Terms confirmed. Waiting for your partner to confirm.';
  }
  for (const { player: recipient, inventory, wallet } of exchange) { recipient.inventory = inventory; recipient.wallet = wallet; }
  closeTrade(village, trade, 'completed', 'Trade complete. The agreed resources and wallet gold were exchanged.');
  return 'Trade complete.';
}
export function tradingSnapshot(village, viewerId) {
  const trade = current(village, viewerId);
  return { trading: { trade: trade ? structuredClone({ ...trade, players: trade.playerIds.map(id => ({ id, name: village.players[id]?.name ?? 'Player' })) }) : null, result: village.tradeResults?.[viewerId] ? { ...village.tradeResults[viewerId] } : null } };
}
