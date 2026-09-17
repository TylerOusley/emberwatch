import { randomInt, randomUUID } from 'node:crypto';
import { BUILDINGS } from '../shared/world.js';
import { canUseBuilding } from '../shared/access.js';
import { TREASURY_RESERVE } from '../shared/market.js';
import { INVESTMENT_RULES, TAVERN_RULES, TAVERN_GAMES, SLOT_SYMBOLS, FATE_WHEEL, normalizeTavernBet, tavernPayout, rouletteColor, fairDividendAllocation, blackjackValue, pokerHand, comparePokerHands } from '../shared/village-finance.js';

const KINDS = new Set(['investment_deposit', 'investment_withdraw', 'investment_claim', 'investment_reinvest', 'tavern_bet']);
const whole = (amount, maximum = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(amount) && amount >= 0 && amount <= maximum;
const validRequestId = id => typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
const emptyPosition = () => ({ principal: 0, earnings: 0, lots: [], remainder: 0 });
const surplus = village => whole(village.treasury) ? Math.max(0, village.treasury - TREASURY_RESERVE) : 0;

export function ensureVillageFinance(village) { village.villageFinance ??= { version: 1 }; village.villageFinance.rounds ??= {}; }

function roll(random, limit) {
  const result = random(limit);
  if (!Number.isSafeInteger(result) || result < 0 || result >= limit) throw new Error('The tavern could not determine a result.');
  return result;
}
function newDeck(random) {
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) { const j = roll(random, i + 1); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  return deck;
}
function privateRound(round, clock, reveal = false) {
  if (!round) return null;
  return { id: round.id, game: round.game, stake: round.stake, totalStake: round.totalStake, cards: [...round.cards], dealer: reveal ? [...round.dealer] : round.game === 'blackjack' ? [round.dealer[0], null] : [null, null, null],
    secondsRemaining: Math.max(0, Math.ceil(round.deadline - clock)), ...(round.game === 'blackjack' ? { value: blackjackValue(round.cards).total } : { hand: pokerHand(round.cards).label }) };
}
function settleRound(sim, village, player, round, action, move) {
  let payout = 0, outcome;
  if (round.game === 'blackjack') {
    const hand = blackjackValue(round.cards);
    if (hand.total <= 21) while (blackjackValue(round.dealer).total < 17) round.dealer.push(round.deck.pop());
    const dealer = blackjackValue(round.dealer);
    if (hand.total > 21) outcome = 'Bust';
    else if (hand.natural && !dealer.natural) { payout = Math.floor(round.stake * 2.5); outcome = 'Blackjack'; }
    else if (dealer.natural && !hand.natural) outcome = 'Dealer blackjack';
    else if (dealer.total > 21 || hand.total > dealer.total) { payout = round.stake * 2; outcome = 'Win'; }
    else if (hand.total === dealer.total) { payout = round.stake; outcome = 'Push'; }
    else outcome = 'Dealer wins';
  } else if (move === 'fold') outcome = 'Fold';
  else {
    const hand = pokerHand(round.cards), dealer = pokerHand(round.dealer), comparison = comparePokerHands(hand, dealer), qualifies = dealer.rank > 0 || dealer.values[0] >= 12;
    payout = round.stake * (hand.bonus + (!qualifies ? 3 : comparison > 0 ? 4 : comparison === 0 ? 2 : 0));
    outcome = `${hand.label} · ${!qualifies ? 'Dealer does not qualify' : comparison > 0 ? 'Win' : comparison === 0 ? 'Push' : 'Dealer wins'}`;
  }
  if (!whole(player.wallet + payout) || !whole(village.treasury + round.escrow - payout)) throw new Error('The hand cannot settle until gold balances have room.');
  player.wallet += payout; village.treasury += round.escrow - payout;
  delete village.villageFinance.rounds[player.id];
  const net = payout - round.totalStake;
  return finish(sim, village, player, action, { game: round.game, roundId: round.id, move, status: 'settled', stake: round.totalStake, ante: round.stake, outcome, payout, net, win: net > 0,
    cards: [...round.cards], dealer: [...round.dealer],
    message: `${TAVERN_GAMES[round.game]}: ${outcome}. ${payout} gold returned; ${net > 0 ? `${net} gold won` : net < 0 ? `${-net} gold lost` : 'stake returned'}.` });
}
function playCards(sim, village, player, action, random) {
  ensureVillageFinance(village);
  const existing = village.villageFinance.rounds[player.id];
  if (action.move !== undefined) {
    if (!existing || action.roundId !== existing.id || action.game !== existing.game) throw new Error('That hand is no longer active. Check your saved result.');
    const allowed = existing.game === 'blackjack' ? ['hit', 'stand'] : ['play', 'fold'];
    if (!allowed.includes(action.move)) throw new Error('Choose an available move for this hand.');
    if (village.clock >= existing.deadline) return settleRound(sim, village, player, existing, action, existing.game === 'blackjack' ? 'stand' : 'fold');
    if (action.move === 'hit') {
      existing.cards.push(existing.deck.pop());
      if (blackjackValue(existing.cards).total < 21) return finish(sim, village, player, action, { game: existing.game, status: 'playing', roundId: existing.id, round: privateRound(existing, village.clock), message: `Blackjack: ${blackjackValue(existing.cards).total}. Hit or stand.` });
    }
    if (action.move === 'play') {
      if (player.wallet < existing.stake) throw new Error('You need wallet gold equal to your ante to play. You can fold.');
      player.wallet -= existing.stake; existing.escrow += existing.stake; existing.totalStake += existing.stake;
    }
    return settleRound(sim, village, player, existing, action, action.move);
  }
  if (existing) throw new Error('Finish your current card hand before starting another bet.');
  const bet = normalizeTavernBet(action), liability = bet.game === 'blackjack' ? Math.floor(bet.stake * 1.5) : bet.stake * 7;
  if (player.wallet < bet.stake * (bet.game === 'three_card_poker' ? 2 : 1)) throw new Error('Your wallet must cover this stake, including the optional play wager.');
  if (surplus(village) < liability) throw new Error('The treasury cannot cover that bet’s maximum win while keeping its emergency reserve. Lower the stake.');
  if (!whole(player.wallet + liability) || !whole(village.treasury + bet.stake * 2)) throw new Error('That bet would exceed a gold balance limit.');
  const deck = newDeck(random), cards = [], dealer = [];
  for (let i = 0; i < (bet.game === 'blackjack' ? 2 : 3); i++) { cards.push(deck.pop()); dealer.push(deck.pop()); }
  const round = { id: action.requestId, game: bet.game, stake: bet.stake, totalStake: bet.stake, escrow: liability + bet.stake, cards, dealer, deck, deadline: village.clock + TAVERN_RULES.handSeconds };
  player.wallet -= bet.stake; village.treasury -= liability; village.villageFinance.rounds[player.id] = round;
  if (bet.game === 'blackjack' && (blackjackValue(cards).natural || blackjackValue(dealer).natural)) return settleRound(sim, village, player, round, action, 'deal');
  return finish(sim, village, player, action, { game: bet.game, status: 'playing', roundId: round.id, round: privateRound(round, village.clock), message: `${TAVERN_GAMES[bet.game]} dealt. ${bet.game === 'blackjack' ? 'Hit or stand' : 'Play an equal wager or fold'}. Hand expires in ${TAVERN_RULES.handSeconds} village seconds.` });
}

export function villageFinanceTick(sim, village) {
  if (village.status !== 'active' || !sim.store.saveFinanceReceipt) return;
  for (const [id, round] of Object.entries(village.villageFinance?.rounds ?? {})) {
    if (round.deadline > village.clock || !village.players[id]) continue;
    // Tick runs outside the action transaction. Save the hand, balances and
    // timeout receipt together so a process restart cannot settle twice.
    const player = village.players[id], checkpoint = { wallet: player.wallet, treasury: village.treasury, round: structuredClone(round) };
    try {
      sim.store.transaction(() => {
        settleRound(sim, village, player, round, { kind: 'tavern_bet', requestId: randomUUID() }, round.game === 'blackjack' ? 'stand' : 'fold');
        sim.store.saveVillage(village);
      });
    } catch (error) {
      player.wallet = checkpoint.wallet; village.treasury = checkpoint.treasury; village.villageFinance.rounds[id] = checkpoint.round;
      throw error;
    }
  }
}

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
    if (['blackjack', 'three_card_poker'].includes(action.game) || action.move !== undefined) return playCards(sim, village, player, action, random);
    if (village.villageFinance?.rounds?.[player.id]) throw new Error('Finish your current card hand before starting another bet.');
    const bet = normalizeTavernBet(action), liability = bet.stake * (bet.multiplier - 1);
    if (player.wallet < bet.stake) throw new Error('You do not have enough wallet gold for this stake.');
    if (surplus(village) < liability) throw new Error('The treasury cannot cover that bet’s maximum win while keeping its emergency reserve. Lower the stake.');
    if (!whole(village.treasury + bet.stake) || !whole(player.wallet + liability)) throw new Error('That bet would exceed a gold balance limit.');
    const outcome = bet.game === 'slots' ? Array.from({ length: 3 }, () => roll(random, SLOT_SYMBOLS.length)) : bet.game === 'coinflip' ? ['heads', 'tails'][roll(random, 2)] : roll(random, bet.game === 'wheel' ? FATE_WHEEL.length : 37);
    const payout = tavernPayout(bet, outcome), net = payout - bet.stake;
    player.wallet += net; village.treasury -= net;
    const label = bet.game === 'slots' ? outcome.map(n => SLOT_SYMBOLS[n]).join(' · ') : bet.game === 'wheel' ? `${FATE_WHEEL[outcome]}× return` : bet.game === 'coinflip' ? outcome : `${outcome} ${rouletteColor(outcome)}`;
    return finish(sim, village, player, action, { ...bet, outcome, ...(bet.game === 'roulette' ? { color: rouletteColor(outcome) } : {}), payout, net, win: payout > 0,
      status: 'settled', message: `${TAVERN_GAMES[bet.game]}: ${label}. ${payout ? `${payout} gold returned including your stake; ${net} gold won.` : `${bet.stake} gold lost.`}` });
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
    tavern: { minStake: TAVERN_RULES.minStake, maxStake: TAVERN_RULES.maxStake, reserve: TREASURY_RESERVE, coinflipMaximumStake: Math.min(TAVERN_RULES.maxStake, available), evenMoneyMaximumStake: Math.min(TAVERN_RULES.maxStake, available), rouletteNumberMaximumStake: Math.min(TAVERN_RULES.maxStake, Math.floor(available / 35)),
      blackjackMaximumStake: Math.min(TAVERN_RULES.maxStake, Math.floor((available * 2 + 1) / 3)), pokerMaximumAnte: Math.min(TAVERN_RULES.pokerMaxAnte, Math.floor(available / 7)), slotsMaximumStake: Math.min(TAVERN_RULES.maxStake, Math.floor(available / 29)), wheelMaximumStake: Math.min(TAVERN_RULES.maxStake, Math.floor(available / 5)),
      round: viewer ? privateRound(village.villageFinance?.rounds?.[viewerId], village.clock) : null,
      history: viewer ? store.financeReceipts?.(village.id, viewerId, true) ?? [] : [] }
  };
}
