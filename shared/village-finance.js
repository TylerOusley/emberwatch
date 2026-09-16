import { TREASURY_RESERVE } from './market.js';

export const INVESTMENT_RULES = Object.freeze({ dividendRate: .01, rateDenominator: 100, minimumCompletedDays: 1, maxAction: 1_000_000, maxPrincipal: 1_000_000_000, reserve: TREASURY_RESERVE });
export const TAVERN_RULES = Object.freeze({ minStake: 1, maxStake: 1000, reserve: TREASURY_RESERVE, coinflipMultiplier: 2, rouletteNumberMultiplier: 36, rouletteEvenMoneyMultiplier: 2 });
export const ROULETTE_RED = Object.freeze([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export function rouletteColor(number) { return number === 0 ? 'green' : ROULETTE_RED.includes(number) ? 'red' : 'black'; }

export function normalizeTavernBet(action) {
  if (!Number.isSafeInteger(action.stake) || action.stake < TAVERN_RULES.minStake || action.stake > TAVERN_RULES.maxStake) throw new Error('Choose a whole-gold stake from 1 to 1,000.');
  if (action.game === 'coinflip') {
    if (!['heads', 'tails'].includes(action.choice)) throw new Error('Choose heads or tails.');
    return { game: 'coinflip', stake: action.stake, choice: action.choice, multiplier: 2 };
  }
  if (action.game !== 'roulette') throw new Error('Choose coinflip or European roulette.');
  if (!['number', 'red', 'black', 'even', 'odd'].includes(action.choice)) throw new Error('Choose a number, red, black, even or odd.');
  if (action.choice === 'number' && (!Number.isSafeInteger(action.number) || action.number < 0 || action.number > 36)) throw new Error('Choose a roulette number from 0 to 36.');
  return { game: 'roulette', stake: action.stake, choice: action.choice, ...(action.choice === 'number' ? { number: action.number } : {}), multiplier: action.choice === 'number' ? 36 : 2 };
}

export function tavernPayout(bet, outcome) {
  let wins;
  if (bet.game === 'coinflip') wins = outcome === bet.choice;
  else if (bet.choice === 'number') wins = outcome === bet.number;
  else wins = outcome !== 0 && (bet.choice === rouletteColor(outcome) || bet.choice === 'even' && outcome % 2 === 0 || bet.choice === 'odd' && outcome % 2 === 1);
  return wins ? bet.stake * bet.multiplier : 0;
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
