import { TREASURY_RESERVE } from './market.js';

export const INVESTMENT_RULES = Object.freeze({ dividendRate: .01, rateDenominator: 100, minimumCompletedDays: 1, maxAction: 1_000_000, maxPrincipal: 1_000_000_000, reserve: TREASURY_RESERVE });
export const TAVERN_RULES = Object.freeze({ minStake: 1, maxStake: 10_000, reserve: TREASURY_RESERVE, coinflipMultiplier: 2, rouletteNumberMultiplier: 36, rouletteEvenMoneyMultiplier: 2, handSeconds: 120, pokerMaxAnte: 5_000 });
export const TAVERN_GAMES = Object.freeze({ coinflip: 'Coin flip', roulette: 'European roulette', blackjack: 'Blackjack', three_card_poker: 'Three-card poker', slots: 'Enchanted reels', wheel: 'Wheel of Fate' });
export const SLOT_SYMBOLS = Object.freeze(['wheat', 'bell', 'sword', 'goblet', 'dragon', 'crown']);
export const SLOT_TRIPLE_RETURNS = Object.freeze([6, 8, 10, 15, 20, 30]);
// Twenty equally likely stops. These are total returns, including the stake.
export const FATE_WHEEL = Object.freeze([0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 0, 0, 6, 0, 1, 0, 0, 0]);
export const ROULETTE_RED = Object.freeze([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export function rouletteColor(number) { return number === 0 ? 'green' : ROULETTE_RED.includes(number) ? 'red' : 'black'; }

export function normalizeTavernBet(action) {
  if (!Number.isSafeInteger(action.stake) || action.stake < TAVERN_RULES.minStake || action.stake > TAVERN_RULES.maxStake) throw new Error(`Choose a whole-gold stake from ${TAVERN_RULES.minStake.toLocaleString('en-US')} to ${TAVERN_RULES.maxStake.toLocaleString('en-US')}.`);
  if (action.game === 'coinflip') {
    if (!['heads', 'tails'].includes(action.choice)) throw new Error('Choose heads or tails.');
    return { game: 'coinflip', stake: action.stake, choice: action.choice, multiplier: 2 };
  }
  if (['blackjack', 'three_card_poker', 'slots', 'wheel'].includes(action.game)) {
    if (action.game === 'three_card_poker' && action.stake > TAVERN_RULES.pokerMaxAnte) throw new Error('Choose an ante from 1 to 5,000 gold; ante plus play never exceeds 10,000 gold.');
    return { game: action.game, stake: action.stake, multiplier: ({ blackjack: 2.5, three_card_poker: 9, slots: 30, wheel: 6 })[action.game] };
  }
  if (action.game !== 'roulette') throw new Error('Choose an available tavern game.');
  if (!['number', 'red', 'black', 'even', 'odd'].includes(action.choice)) throw new Error('Choose a number, red, black, even or odd.');
  if (action.choice === 'number' && (!Number.isSafeInteger(action.number) || action.number < 0 || action.number > 36)) throw new Error('Choose a roulette number from 0 to 36.');
  return { game: 'roulette', stake: action.stake, choice: action.choice, ...(action.choice === 'number' ? { number: action.number } : {}), multiplier: action.choice === 'number' ? 36 : 2 };
}

export function tavernPayout(bet, outcome) {
  if (bet.game === 'slots') return bet.stake * slotsMultiplier(outcome);
  if (bet.game === 'wheel') return bet.stake * (FATE_WHEEL[outcome] ?? 0);
  let wins;
  if (bet.game === 'coinflip') wins = outcome === bet.choice;
  else if (bet.choice === 'number') wins = outcome === bet.number;
  else wins = outcome !== 0 && (bet.choice === rouletteColor(outcome) || bet.choice === 'even' && outcome % 2 === 0 || bet.choice === 'odd' && outcome % 2 === 1);
  return wins ? bet.stake * bet.multiplier : 0;
}

export const cardRank = card => card % 13 + 2;
export const cardSuit = card => Math.floor(card / 13);
export function cardLabel(card) { return `${({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' })[cardRank(card)] ?? cardRank(card)}${['♣', '♦', '♥', '♠'][cardSuit(card)]}`; }
export function blackjackValue(cards) {
  let total = cards.reduce((sum, card) => sum + (cardRank(card) === 14 ? 11 : Math.min(10, cardRank(card))), 0);
  // Aces initially count as eleven; reduce only as needed.
  let soft = cards.filter(card => cardRank(card) === 14).length;
  while (total > 21 && soft) { total -= 10; soft--; }
  return { total, soft: soft > 0, natural: cards.length === 2 && total === 21 };
}
export function pokerHand(cards) {
  const ranks = cards.map(cardRank).sort((a, b) => b - a), flush = cards.every(card => cardSuit(card) === cardSuit(cards[0]));
  const straight = new Set(ranks).size === 3 && (ranks[0] - ranks[2] === 2 || ranks.join(',') === '14,3,2');
  const high = ranks.join(',') === '14,3,2' ? 3 : ranks[0];
  if (straight && flush) return { rank: 5, label: 'Straight flush', values: [high], bonus: 5 };
  if (ranks[0] === ranks[2]) return { rank: 4, label: 'Three of a kind', values: [ranks[0]], bonus: 4 };
  if (straight) return { rank: 3, label: 'Straight', values: [high], bonus: 1 };
  if (flush) return { rank: 2, label: 'Flush', values: ranks, bonus: 0 };
  const pair = ranks.find((rank, i) => ranks.indexOf(rank) !== i);
  if (pair) return { rank: 1, label: 'Pair', values: [pair, ...ranks.filter(rank => rank !== pair)], bonus: 0 };
  return { rank: 0, label: 'High card', values: ranks, bonus: 0 };
}
export function comparePokerHands(a, b) {
  if (a.rank !== b.rank) return Math.sign(a.rank - b.rank);
  for (let i = 0; i < a.values.length; i++) if (a.values[i] !== b.values[i]) return Math.sign(a.values[i] - b.values[i]);
  return 0;
}
export function slotsMultiplier(reels) {
  if (!Array.isArray(reels) || reels.length !== 3 || reels.some(n => !Number.isInteger(n) || n < 0 || n >= SLOT_SYMBOLS.length)) return 0;
  if (reels.every(n => n === reels[0])) return SLOT_TRIPLE_RETURNS[reels[0]];
  return new Set(reels).size === 2 ? 1 : 0;
}

// Allocate one simultaneous budget proportionally. BigInt avoids precision
// loss when multiplying whole-gold demands; rotating ties avoids ID priority.
export function fairDividendAllocation(demands, budget, day) {
  const rows = demands.map(row => ({ id: row.id, amount: row.amount })).sort((a, b) => a.id.localeCompare(b.id));
  if (!Number.isSafeInteger(budget) || budget < 0 || rows.some(row => !Number.isSafeInteger(row.amount) || row.amount < 0)) throw new Error('Invalid dividend allocation.');
  const total = rows.reduce((sum, row) => sum + BigInt(row.amount), 0n), funds = BigInt(budget);
  if (total === 0n) return rows.map(row => ({ ...row, paid: 0 }));
  const spending = funds < total ? funds : total;
  let used = 0n;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index], numerator = spending * BigInt(row.amount);
    row.paid = Number(numerator / total); row.fraction = numerator % total;
    row.rank = (index - day % rows.length + rows.length) % rows.length; used += BigInt(row.paid);
  }
  const ranked = [...rows].sort((a, b) => a.fraction === b.fraction ? a.rank - b.rank : a.fraction > b.fraction ? -1 : 1);
  for (let i = 0; i < Number(spending - used); i++) ranked[i].paid++;
  return rows.map(({ id, amount, paid }) => ({ id, amount, paid }));
}
