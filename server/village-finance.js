import { randomInt } from 'node:crypto';
import { BUILDINGS } from '../shared/world.js';
import { canUseBuilding } from '../shared/access.js';
import { TREASURY_RESERVE } from '../shared/market.js';
import { INVESTMENT_RULES, TAVERN_RULES, normalizeTavernBet, tavernPayout, rouletteColor, fairDividendAllocation } from '../shared/village-finance.js';

const KINDS = new Set(['investment_deposit', 'investment_withdraw', 'investment_claim', 'investment_reinvest', 'tavern_bet']);
const whole = (amount, maximum = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(amount) && amount >= 0 && amount <= maximum;
const validRequestId = id => typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
const emptyPosition = () => ({ principal: 0, earnings: 0, lots: [], remainder: 0 });
const surplus = village => whole(village.treasury) ? Math.max(0, village.treasury - TREASURY_RESERVE) : 0;

export function ensureVillageFinance(village) { village.villageFinance ??= { version: 1 }; }

function validPosition(position) {
  if (!whole(position.principal, INVESTMENT_RULES.maxPrincipal) || !whole(position.earnings) || !whole(position.remainder, 99) || !Array.isArray(position.lots) || position.lots.some(lot => !whole(lot.amount, INVESTMENT_RULES.maxPrincipal) || !Number.isSafeInteger(lot.eligibleDay) || lot.eligibleDay < 1) || position.lots.reduce((sum, lot) => sum + lot.amount, 0) !== position.principal) throw new Error('This investment account cannot be changed right now.');
}

function amountFor(action, maximum, emptyMessage, { allowMax = true } = {}) {
  if (action.max !== undefined && typeof action.max !== 'boolean') throw new Error('Choose a valid transfer amount.');
  if (!allowMax && action.max === true) throw new Error('Enter a whole investment amount up to 1,000,000 gold.');
  if (!maximum) throw new Error(emptyMessage);
  const amount = action.max === true ? maximum : action.amount;
  if (!whole(amount) || amount < 1 || action.max !== true && amount > INVESTMENT_RULES.maxAction) throw new Error('Choose a positive whole amount up to 1,000,000 gold.');
  if (amount > maximum) throw new Error(emptyMessage);
  return amount;
}

function addPrincipal(position, amount, day) {
  const eligibleDay = day + INVESTMENT_RULES.minimumCompletedDays;
  if (!Number.isSafeInteger(eligibleDay)) throw new Error('This investment date cannot be recorded.');
  const lot = position.lots.find(lot => lot.eligibleDay === eligibleDay);
  if (lot) lot.amount += amount; else position.lots.push({ amount, eligibleDay });
  position.principal += amount;
}

function removePrincipal(position, amount) {
  let remaining = amount;
  // Withdraw newer, still-pending contributions first. Already mature capital
  // keeps its eligibility only while that same principal remains invested.
  position.lots.sort((a, b) => b.eligibleDay - a.eligibleDay);
  for (const lot of position.lots) { const take = Math.min(remaining, lot.amount); lot.amount -= take; remaining -= take; }
  position.lots = position.lots.filter(lot => lot.amount > 0); position.principal -= amount;
  if (!position.principal) position.remainder = 0;
}

function finish(sim, village, player, action, result) {
  const receipt = { id: action.requestId, requestId: action.requestId, kind: action.kind, ...result, walletAfter: player.wallet, treasuryAfter: village.treasury, day: village.day, clock: village.clock, createdAt: Date.now() };
  sim.store.saveFinanceReceipt(village.id, player.id, receipt);
  return receipt.message;
}

export function villageFinanceAction(sim, village, player, action, { random = randomInt } = {}) {
  if (!KINDS.has(action.kind)) return null;
  if (!sim.store.financeReceipt) throw new Error('Village finance is unavailable.');
  if (!player?.online || village.players[player.id] !== player || !sim.store.account(player.id)) throw new Error('Join this village before using its finances.');
  if (!validRequestId(action.requestId)) throw new Error('Provide a unique request ID for this transaction.');
  const previous = sim.store.financeReceipt(village.id, player.id, action.requestId);
  if (previous) return previous.message;
  if (village.status !== 'active' || village.keep?.hp <= 0) throw new Error('Finance and tavern games are closed in a fallen village.');
  if (player.downed || player.hp <= 0 || player.mountedHorseId || player.bedPlotId || player.carriedBy) throw new Error('Stand on foot to use village investments or the tavern.');
  if (!whole(player.wallet) || !whole(village.treasury)) throw new Error('These gold balances cannot be used.');
  const service = action.kind === 'tavern_bet' ? 'merchant' : 'bank';
  if (!canUseBuilding(player, BUILDINGS.find(building => building.id === service))) throw new Error(service === 'bank' ? 'Visit the Village Treasury entrance to manage investments.' : 'Visit The Wayfarer entrance to play tavern games.');
  if (action.kind === 'tavern_bet') {
    const bet = normalizeTavernBet(action), liability = bet.stake * (bet.multiplier - 1);
    if (player.wallet < bet.stake) throw new Error('You do not have enough wallet gold for this stake.');
    if (surplus(village) < liability) throw new Error('The treasury cannot cover that bet’s maximum win while keeping its emergency reserve. Lower the stake.');
    if (!whole(village.treasury + bet.stake) || !whole(player.wallet + liability)) throw new Error('That bet would exceed a gold balance limit.');
    const roll = random(bet.game === 'coinflip' ? 2 : 37);
    if (!Number.isSafeInteger(roll) || roll < 0 || roll >= (bet.game === 'coinflip' ? 2 : 37)) throw new Error('The tavern could not determine a result.');
    const outcome = bet.game === 'coinflip' ? ['heads', 'tails'][roll] : roll, payout = tavernPayout(bet, outcome), net = payout - bet.stake;
    player.wallet += net; village.treasury -= net;
    const label = bet.game === 'coinflip' ? outcome : `${outcome} ${rouletteColor(outcome)}`;
    return finish(sim, village, player, action, { ...bet, outcome, ...(bet.game === 'roulette' ? { color: rouletteColor(outcome) } : {}), payout, net, win: payout > 0,
      message: `${bet.game === 'coinflip' ? 'Coinflip' : 'Roulette'}: ${label}. ${payout ? `${payout} gold returned including your stake; ${net} gold won.` : `${bet.stake} gold lost.`}` });
  }
  const position = sim.store.financePosition(village.id, player.id); validPosition(position);
  let amount, message;
  if (action.kind === 'investment_deposit') {
    amount = amountFor(action, Math.min(player.wallet, INVESTMENT_RULES.maxPrincipal - position.principal, Number.MAX_SAFE_INTEGER - village.treasury), 'Your wallet or remaining investment limit cannot cover that amount.', { allowMax: false });
    player.wallet -= amount; village.treasury += amount; addPrincipal(position, amount, village.day);
    message = `${amount} gold invested in the village. This contribution first earns at the dawn after day ${village.day + 1}.`;
  } else if (action.kind === 'investment_withdraw') {
    amount = amountFor(action, Math.min(position.principal, surplus(village), Number.MAX_SAFE_INTEGER - player.wallet), 'Your principal or the treasury surplus cannot cover that withdrawal. The emergency reserve stays protected.');
    removePrincipal(position, amount); village.treasury -= amount; player.wallet += amount;
    message = `${amount} gold of investment principal returned to your wallet.`;
  } else if (action.kind === 'investment_claim') {
    amount = amountFor(action, Math.min(position.earnings, Number.MAX_SAFE_INTEGER - player.wallet), 'There are no claimable earnings or no room in your wallet.');
    position.earnings -= amount; player.wallet += amount;
    message = `${amount} gold of funded dividends claimed to your wallet.`;
  } else {
    amount = amountFor(action, Math.min(position.earnings, INVESTMENT_RULES.maxPrincipal - position.principal, Number.MAX_SAFE_INTEGER - village.treasury), 'There are no earnings available to reinvest or your investment limit has been reached.');
    position.earnings -= amount; village.treasury += amount; addPrincipal(position, amount, village.day);
    message = `${amount} gold of dividends reinvested. New capital first earns at the dawn after day ${village.day + 1}.`;
  }
  sim.store.saveFinancePosition(village.id, player.id, position);
  return finish(sim, village, player, action, { amount, principalAfter: position.principal, earningsAfter: position.earnings, message });
}

export function villageFinanceDawn(sim, village, completedDay) {
  if (!sim.store.financePositions || village.status !== 'active' || village.keep?.hp <= 0) return null;
  if (!Number.isSafeInteger(completedDay) || completedDay < 1 || !whole(village.treasury)) throw new Error('Invalid village dividend date or balance.');
  const rows = sim.store.financePositions(village.id);
  if (!rows.length) return null;
  const prior = sim.store.financeDawn(village.id, completedDay); if (prior) return prior;
  const demands = [];
  for (const row of rows) {
    validPosition(row);
    const eligible = row.lots.filter(lot => lot.eligibleDay <= completedDay).reduce((sum, lot) => sum + lot.amount, 0);
    const accrued = eligible + row.remainder;
    const due = Math.min(Math.floor(accrued / INVESTMENT_RULES.rateDenominator), Number.MAX_SAFE_INTEGER - row.earnings);
    row.remainder = accrued % INVESTMENT_RULES.rateDenominator;
    // Merge mature lots; there is at most one pending contribution date between
    // normal dawns, so investments never accumulate an unbounded daily list.
    row.lots = row.lots.filter(lot => lot.eligibleDay > completedDay);
    if (eligible) row.lots.push({ amount: eligible, eligibleDay: completedDay });
    demands.push({ id: row.id, amount: due });
  }
  const budget = surplus(village), allocations = fairDividendAllocation(demands, budget, completedDay);
  let paid = 0;
  for (const allocation of allocations) {
    const row = rows.find(row => row.id === allocation.id); row.earnings += allocation.paid; paid += allocation.paid;
    const { id, ...position } = row; sim.store.saveFinancePosition(village.id, id, position);
  }
  village.treasury -= paid;
  const report = { day: completedDay, due: demands.reduce((sum, row) => sum + row.amount, 0), paid, budget, allocations: allocations.map(row => ({ id: row.id, due: row.amount, paid: row.paid })) };
  sim.store.saveFinanceDawn(village.id, completedDay, report);
  return report;
}

export function villageFinanceSnapshot(sim, village, viewerId) {
  const store = sim.store, viewer = typeof viewerId === 'string' && Boolean(village.players?.[viewerId]);
  const position = viewer ? store.financePosition?.(village.id, viewerId) ?? emptyPosition() : emptyPosition(), rows = store.financePositions?.(village.id) ?? [], report = store.latestFinanceDawn?.(village.id);
  const available = surplus(village), eligiblePrincipal = position.lots.filter(lot => lot.eligibleDay <= village.day).reduce((sum, lot) => sum + lot.amount, 0), pending = position.lots.filter(lot => lot.eligibleDay > village.day);
  const last = report?.allocations.find(row => row.id === viewerId);
  return {
    finance: { principal: position.principal, earnings: position.earnings, eligiblePrincipal, pendingPrincipal: position.principal - eligiblePrincipal, firstEligibleDay: pending.length ? Math.min(...pending.map(lot => lot.eligibleDay)) : null,
      dividendRate: INVESTMENT_RULES.dividendRate, reserve: TREASURY_RESERVE, availableToWithdraw: Math.min(position.principal, available), treasurySurplus: available, totalPrincipal: rows.reduce((sum, row) => sum + row.principal, 0),
      limits: { maxAction: INVESTMENT_RULES.maxAction, maxPrincipal: INVESTMENT_RULES.maxPrincipal }, lastDividend: report ? { day: report.day, due: last?.due ?? 0, paid: last?.paid ?? 0 } : null, villageDividendsPaid: report?.paid ?? 0,
      receipts: viewer ? store.financeReceipts?.(village.id, viewerId, false) ?? [] : [] },
    tavern: { minStake: TAVERN_RULES.minStake, maxStake: TAVERN_RULES.maxStake, reserve: TREASURY_RESERVE, coinflipMaximumStake: Math.min(TAVERN_RULES.maxStake, available), evenMoneyMaximumStake: Math.min(TAVERN_RULES.maxStake, available), rouletteNumberMaximumStake: Math.min(TAVERN_RULES.maxStake, Math.floor(available / 35)), history: viewer ? store.financeReceipts?.(village.id, viewerId, true) ?? [] : [] }
  };
}
