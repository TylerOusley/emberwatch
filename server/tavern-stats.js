import { TAVERN_GAMES } from '../shared/village-finance.js';

const games = Object.keys(TAVERN_GAMES);
const cardGames = new Set(['blackjack', 'three_card_poker']);
const legacyGames = new Set(['coinflip', 'roulette']);
const goldFields = ['wagered', 'returned', 'won', 'lost', 'net'];
const emptyTotals = () => ({ bets: 0, wins: 0, losses: 0, pushes: 0, wagered: 0n, returned: 0n, won: 0n, lost: 0n, net: 0n });
const emptySummary = () => ({ totals: emptyTotals(), byGame: Object.fromEntries(games.map(game => [game, emptyTotals()])) });

export function createTavernStats() {
  return { cursor: 0n, lifetime: emptySummary(), villages: new Map(), settledRounds: new Set() };
}

function settledBet(receipt) {
  if (receipt?.kind !== 'tavern_bet' || !games.includes(receipt.game)) return null;
  if (receipt.status !== 'settled' && !(receipt.status === undefined && legacyGames.has(receipt.game))) return null;
  if (!Number.isSafeInteger(receipt.stake) || receipt.stake < 1 || !Number.isSafeInteger(receipt.payout) || receipt.payout < 0) return null;
  if (cardGames.has(receipt.game) && (typeof receipt.roundId !== 'string' || !receipt.roundId)) return null;
  return { game: receipt.game, stake: BigInt(receipt.stake), payout: BigInt(receipt.payout), roundId: cardGames.has(receipt.game) ? receipt.roundId : null };
}

function add(totals, bet) {
  const net = bet.payout - bet.stake;
  totals.bets++;
  totals.wagered += bet.stake; totals.returned += bet.payout; totals.net += net;
  if (net > 0n) { totals.wins++; totals.won += net; }
  else if (net < 0n) { totals.losses++; totals.lost -= net; }
  else totals.pushes++;
}

export function addTavernStatsRow(stats, row) {
  stats.cursor = row.rowid;
  let receipt;
  try { receipt = JSON.parse(row.receipt); } catch { return; }
  const bet = settledBet(receipt);
  if (!bet) return;
  if (bet.roundId) {
    const key = JSON.stringify([row.village_id, bet.game, bet.roundId]);
    if (stats.settledRounds.has(key)) return;
    stats.settledRounds.add(key);
  }
  let village = stats.villages.get(row.village_id);
  if (!village) { village = emptySummary(); stats.villages.set(row.village_id, village); }
  for (const summary of [stats.lifetime, village]) { add(summary.totals, bet); add(summary.byGame[bet.game], bet); }
}

function serializeSummary(summary) {
  const serializeTotals = totals => ({ ...totals, ...Object.fromEntries(goldFields.map(field => [field, totals[field].toString()])) });
  return { totals: serializeTotals(summary.totals), byGame: Object.fromEntries(games.map(game => [game, serializeTotals(summary.byGame[game])])) };
}

export function tavernStatsSnapshot(stats, villageId) {
  return { lifetime: serializeSummary(stats.lifetime), village: serializeSummary(stats.villages.get(villageId) ?? emptySummary()) };
}
