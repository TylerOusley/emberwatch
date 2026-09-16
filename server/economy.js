import { canUseBuilding } from '../shared/access.js';
import { randomUUID } from 'node:crypto';
import { BUILDINGS, CONFIG } from '../shared/world.js';
import { carryCapacity, inventoryWeight, resourceWeight, boundInventoryCount, transferableCount } from '../shared/content.js';
import { RESOURCE_MARKET, TREASURY_RESERVE } from '../shared/market.js';
import { POLICIES, FOOD, MERCHANT_PRICES, MERCHANT_STOCK, foodQuote, maxSaleQuote, taxedSaleQuote, taxedPurchaseQuote } from '../shared/economy.js';

const materials = Object.keys(RESOURCE_MARKET);
const basics = ['wheat', 'timber', 'stone'];
const own = (object, key) => typeof key === 'string' && Object.hasOwn(object, key);
const whole = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= min && value <= max;
const near = (p, id) => canUseBuilding(p, BUILDINGS.find(building => building.id === id));
const requireBank = p => { if (!near(p, 'bank')) throw new Error('Visit the Village Treasury to manage village debts.'); };
const requireMarket = p => { if (!near(p, 'market')) throw new Error('Visit the Resource Exchange to trade or donate resources.'); };
const addIncome = (sim, v, p, amount) => {
  if (!whole(p.wallet) || !whole(p.wallet + amount)) throw new Error('Your wallet cannot accept this payment.');
  if (sim.awardIncome) sim.awardIncome(v, p, amount);
  else p.wallet += amount;
};
const capacity = (p, id, amount) => {
  if (inventoryWeight(p) + resourceWeight(p, id) * amount > carryCapacity(p) + .00001) throw new Error('Your pack is full. Buy a larger backpack at Oak & Iron, or store or sell some items first.');
};

export function ensureEconomy(v) {
  v.stock ||= {};
  for (const id of materials) v.stock[id] ??= 0;
  v.policies ||= {};
  for (const [id, policy] of Object.entries(POLICIES)) v.policies[id] ??= policy.initial;
  v.proposals ||= [];
  v.steward ||= { lastDecision: 'The treasury is keeping reserves for food, repairs and wages.' };
  v.stable ||= { stock: 0 };
  v.merchant ||= { present: false, lastVisitDay: 0, visits: 0, stock: {}, prices: {}, summary: 'The merchant first visits on day 3, then every other day.' };
  v.merchant.prices ||= {};
  for (const id of Object.keys(v.merchant.stock ?? {})) if (own(MERCHANT_PRICES, id) && !whole(v.merchant.prices[id], 1)) v.merchant.prices[id] = Math.max(1, Math.floor(MERCHANT_PRICES[id] * .8));
  v.economy ||= { lastDawn: v.day, lastExportGold: 0, lastTaxes: 0 };
  for (const p of Object.values(v.players)) {
    p.landDebt ??= 0;
    for (const id of [...materials, ...Object.keys(FOOD), 'arrows']) p.inventory[id] ??= 0;
  }
  return v;
}

/** Reserves cover several meals, two nights of troop food and current damage. */
export function exportReserves(v) {
  const residents = Math.max(1, Object.values(v.players).filter(p => p.online || p.participated > 0).length);
  const troops = (v.guards || []).filter(g => g.hp > 0).length;
  const defensePlots = (v.plots || []).filter(p => ['archer_tower', 'cannon', 'barracks'].includes(p.building)).length;
  const gateRepair = Math.ceil(Math.max(0, (v.gate?.maxHp ?? 1200) - (v.gate?.hp ?? 1200)) / 35);
  const keepRepair = Math.ceil(Math.max(0, (v.keep?.maxHp ?? 2000) - (v.keep?.hp ?? 2000)) / 35);
  const horizon = v.policies?.exportPriority === 'conserve' ? 2 : 1;
  return {
    wheat: Math.max(80, residents * 12 + troops * 2) * horizon,
    timber: Math.max(100, gateRepair + keepRepair + 40 + defensePlots * 8) * horizon,
    stone: Math.max(80, keepRepair + 30 + defensePlots * 8) * horizon
  };
}

function validateProposal(v, policy, value) {
  if (!own(POLICIES, policy)) throw new Error('Choose a village wage, tax or export policy.');
  const rule = POLICIES[policy];
  if (rule.choices) {
    if (!rule.choices.includes(value)) throw new Error('Choose conserve, balanced or trade.');
  } else {
    if (!whole(value, rule.min, rule.max)) throw new Error(`${rule.label} must be a whole number from ${rule.min} to ${rule.max}.`);
    if (Math.abs(value - v.policies[policy]) > rule.step) throw new Error(`Change ${rule.label.toLowerCase()} by no more than ${rule.step} at a time.`);
  }
  if (value === v.policies[policy]) throw new Error('That policy is already in effect.');
}

/** Deterministic public-interest review. No remote AI or private savings are used. */
export function stewardReview(v, policy, value) {
  const active = Object.values(v.players).filter(p => p.online || p.participated > 0);
  const next = { ...v.policies, [policy]: value };
  const payroll = active.reduce((sum, p) => sum + (p.role === 'guard' ? next.guardWage : p.role === 'priest' ? next.priestWage : 0), 0);
  if (policy.endsWith('Wage') && value > v.policies[policy]) {
    if (v.treasury - payroll * 2 < TREASURY_RESERVE) return { approved: false, reason: `Veto: two cycles of proposed wages (${payroll * 2} gold) would leave less than the ${TREASURY_RESERVE}-gold emergency reserve.` };
    const role = policy === 'guardWage' ? 'guard' : 'priest';
    const staff = active.filter(p => p.role === role);
    if (!staff.length) return { approved: false, reason: `Veto: there are no active ${role}s to fill this need.` };
    const injured = active.filter(p => p.downed || p.hp < p.maxHp * .8).length;
    const enemies = (v.zombies || []).filter(z => z.hp > 0).length;
    const watch = (v.guards || []).filter(g => g.hp > 0).length;
    const damagedDefense = v.gate.hp < v.gate.maxHp * .75 || v.keep.hp < v.keep.maxHp;
    const strongerWave = v.day % 5 === 0 || (v.day > 1 && (v.day - 1) % 5 === 0);
    const danger = enemies > 0 || strongerWave || damagedDefense;
    const guardShortage = damagedDefense || enemies > staff.length * 2 + watch || (strongerWave && staff.length < Math.max(2, Math.ceil(active.length / 2)));
    const demand = role === 'guard' ? guardShortage : injured >= staff.length || (danger && staff.length === 1);
    const averageBonus = staff.reduce((sum, p) => sum + (p.jobBonus || 0) + (p.cycleServiceIncome || 0), 0) / staff.length;
    if (!demand) return { approved: false, reason: `Veto: ${role === 'guard' ? 'the defenses are sound and there is no current combat shortage' : 'the village is healthy and has no unmet treatment need'}. A majority alone does not justify higher pay.` };
    if (averageBonus >= 20) return { approved: false, reason: `Veto: active ${role}s already earn about ${Math.round(v.policies[policy] + averageBonus)} gold with bonuses and service income. Keep the present wage while rewarding useful work.` };
    const reserves = exportReserves(v);
    if (v.stock.wheat < Math.min(12, reserves.wheat) && payroll > 0) return { approved: false, reason: 'Veto: the village is short of food. Rebuild the wheat reserve before committing to a higher permanent wage.' };
    return { approved: true, reason: `Approved: ${role === 'guard' ? 'combat pressure' : 'unmet healing demand'} supports the increase, and two wage cycles still leave the emergency reserve intact.` };
  }
  if ((policy === 'tradeTax' || policy === 'landTax') && value < v.policies[policy] && v.treasury < TREASURY_RESERVE + payroll * 2) return { approved: false, reason: 'Veto: reducing treasury income now would put the next two wage cycles and emergency repairs at risk.' };
  if (policy === 'landTax' && value > v.policies.landTax && active.some(p => (p.landDebt || 0) > 0)) return { approved: false, reason: 'Veto: residents already owe land tax. Resolve the arrears before increasing the levy.' };
  if (policy === 'exportPriority' && value === 'trade' && (v.gate.hp < v.gate.maxHp / 2 || v.keep.hp < v.keep.maxHp * .75)) return { approved: false, reason: 'Veto: major repairs are outstanding. Keep the larger building-material reserve until the village is secure.' };
  return { approved: true, reason: 'Approved: the change is within the village limits and preserves essential services. Surplus exports always retain food and repair reserves.' };
}

function decide(v, proposal) {
  const votes = Object.values(proposal.votes), yes = votes.filter(Boolean).length, no = votes.filter(vote => !vote).length;
  if (yes >= proposal.required) {
    const review = stewardReview(v, proposal.policy, proposal.value);
    proposal.status = review.approved ? 'approved' : 'vetoed';
    proposal.reason = review.reason;
    proposal.effectiveDay = v.day + 1;
    v.steward.lastDecision = review.reason;
  } else if (no >= proposal.required) {
    proposal.status = 'rejected'; proposal.reason = 'Residents voted to keep the current policy.';
  }
}

export function economyAction(sim, v, p, action) {
  const { kind } = action;
  if (!['propose_policy', 'vote_policy', 'sell', 'sell_all', 'buyResource', 'buyFood', 'eat', 'merchant_buy', 'pay_land_debt'].includes(kind) && !(kind === 'donate' && !action.targetId)) return null;
  ensureEconomy(v);
  if (kind === 'propose_policy') {
    if (!near(p, 'bank') && !near(p, 'keep')) throw new Error('Visit the treasury or Hearthkeep to propose village policy.');
    validateProposal(v, action.policy, action.value);
    if (v.proposals.some(item => item.policy === action.policy && ['voting', 'approved'].includes(item.status))) throw new Error('A proposal for that policy is already awaiting a decision or dawn.');
    if (v.clock - (p.lastProposalAt ?? -10000) < 60) throw new Error('Give the village a minute to consider your last proposal.');
    const voters = Object.values(v.players).filter(player => player.online).map(player => player.id);
    const proposal = { id: randomUUID(), policy: action.policy, value: action.value, proposerId: p.id, proposerName: p.name, day: v.day, eligible: voters, required: Math.floor(voters.length / 2) + 1, votes: { [p.id]: true }, status: 'voting', reason: 'Awaiting a majority of the residents active when this vote opened.' };
    v.proposals.push(proposal); v.proposals = v.proposals.slice(-16); p.lastProposalAt = v.clock;
    decide(v, proposal);
    return proposal.status === 'voting' ? 'Proposal opened. Your yes vote is included.' : proposal.reason;
  }
  if (kind === 'vote_policy') {
    const proposal = v.proposals.find(item => item.id === action.proposalId);
    if (!proposal || proposal.status !== 'voting') throw new Error('That vote has closed.');
    if (typeof action.approve !== 'boolean') throw new Error('Choose yes or no.');
    if (!proposal.eligible.includes(p.id)) throw new Error('This vote is for the residents active when it opened. You can join the next vote.');
    if (own(proposal.votes, p.id)) throw new Error('You have already voted on this proposal.');
    proposal.votes[p.id] = action.approve; decide(v, proposal);
    return proposal.status === 'voting' ? 'Your vote has been recorded.' : proposal.reason;
  }
  if (kind === 'sell') {
    requireMarket(p);
    const { resource, amount, minTotal } = action;
    const quote = taxedSaleQuote(resource, v.stock[resource], amount, v.policies.tradeTax);
    if (!whole(minTotal, 1)) throw new Error('Request a current whole-gold sale quote.');
    if (!whole(p.inventory[resource]) || transferableCount(p, resource) < amount) throw new Error(`You do not have enough ${resource} to sell.${boundInventoryCount(p, resource) ? ' Kit supplies stay with their owner until eaten.' : ''}`);
    if (quote.total < minTotal) throw new Error('The price changed as village stock increased. Review the new quote and try again.');
    if (!whole(v.treasury) || v.treasury - quote.total < TREASURY_RESERVE) throw new Error(`The village must keep ${TREASURY_RESERVE} gold for essential expenses. Try a smaller sale or return later.`);
    if (!whole(p.wallet) || !whole(p.wallet + quote.total)) throw new Error('Your wallet cannot accept this sale.');
    p.inventory[resource] -= amount; v.stock[resource] += amount; v.treasury -= quote.total;
    addIncome(sim, v, p, quote.total);
    return `Sold ${amount} ${resource} for ${quote.total} gold${quote.tax ? ` after ${quote.tax} gold tax` : ''}. Gold added to your wallet.`;
  }
  if (kind === 'sell_all') {
    requireMarket(p);
    let units = 0, proceeds = 0;
    const sold = [];
    for (const resource of materials) {
      const carried = transferableCount(p, resource);
      if (!carried) continue;
      const { amount, quote } = maxSaleQuote({ resource, stock: v.stock[resource], carried, treasury: v.treasury, percent: v.policies.tradeTax });
      if (!amount) continue;
      p.inventory[resource] -= amount; v.stock[resource] += amount; v.treasury -= quote.total;
      addIncome(sim, v, p, quote.total); units += amount; proceeds += quote.total; sold.push(`${amount} ${resource}`);
    }
    if (!units) throw new Error(`The village cannot currently buy any carried resources while keeping its ${TREASURY_RESERVE}-gold reserve.`);
    return `Quick sold ${sold.join(', ')} for ${proceeds} gold. Equipped gear and stored goods were not included.`;
  }
  if (kind === 'buyResource') {
    requireMarket(p);
    const { resource, amount, maxTotal } = action;
    const quote = taxedPurchaseQuote(resource, v.stock[resource], amount, v.policies.tradeTax);
    if (!whole(maxTotal, 1)) throw new Error('Request a current whole-gold purchase quote.');
    if (quote.total > maxTotal) throw new Error('The price changed as village stock fell. Review the new quote and try again.');
    if (p.wallet < quote.total) throw new Error(`You need ${quote.total} gold to buy these resources.`);
    capacity(p, resource, amount);
    if (!whole(p.inventory[resource] + amount) || !whole(v.treasury + quote.total)) throw new Error('Storage or treasury is full.');
    p.wallet -= quote.total; v.treasury += quote.total; v.stock[resource] -= amount; p.inventory[resource] += amount;
    return `Bought ${amount} ${resource} for ${quote.total} gold, including trade tax.`;
  }
  if (kind === 'buyFood') {
    if (!near(p, 'food')) throw new Error('Visit The Breadboard to buy food.');
    const tier = action.tier ?? 'food', item = foodQuote(v.stock.wheat, tier);
    if (p.wallet < item.price) throw new Error(`${item.label} costs ${item.price} gold.`);
    if (v.stock.wheat < item.wheat) throw new Error('The village needs wheat to bake more food.');
    capacity(p, tier, 1);
    p.wallet -= item.price; v.treasury += item.price; v.stock.wheat -= item.wheat; p.inventory[tier]++;
    return `${item.label} added to your pack. Eat it when you need it.`;
  }
  if (kind === 'eat') {
    const tier = action.tier ?? 'food';
    if (!own(FOOD, tier)) throw new Error('Choose food, good food or best food.');
    if (!whole(p.inventory[tier], 1)) throw new Error('Buy food from The Breadboard first.');
    if ((p.hunger ?? 100) >= 100) throw new Error('You are already well fed.');
    const bound = boundInventoryCount(p, tier);
    if (bound > 0) p.boundInventory[tier] = bound - 1;
    p.inventory[tier]--; p.hunger = Math.min(100, (p.hunger ?? 100) + FOOD[tier].hunger);
    return `You ate ${FOOD[tier].label.toLowerCase()}. Hunger restored.`;
  }
  if (kind === 'merchant_buy') {
    if (!v.merchant.present || v.phase !== 'day' || v.merchant.lastVisitDay !== v.day) throw new Error('The traveling merchant returns on the morning after every second night.');
    if (!near(p, 'merchant')) throw new Error('Visit the traveling merchant to buy specialist supplies.');
    const { resource, amount } = action;
    if (!own(v.merchant.prices, resource)) throw new Error('Choose one of the goods offered on this visit.');
    if (!whole(amount, 1, 60)) throw new Error('Buy a whole amount from 1 to 60.');
    if ((v.merchant.stock[resource] ?? 0) < amount) throw new Error('The merchant does not have enough stock.');
    const price = v.merchant.prices[resource] * amount;
    if (p.wallet < price) throw new Error(`You need ${price} gold.`);
    capacity(p, resource, amount);
    p.wallet -= price; p.inventory[resource] += amount; v.merchant.stock[resource] -= amount;
    return `Bought ${amount} ${resource} from the traveling merchant.`;
  }
  if (kind === 'pay_land_debt') {
    requireBank(p);
    const amount = Math.min(p.landDebt, p.wallet);
    if (!amount) throw new Error(p.landDebt ? 'You need wallet gold to pay the arrears.' : 'Your land taxes are paid.');
    p.wallet -= amount; p.landDebt -= amount; v.treasury += amount;
    return `Paid ${amount} gold in land-tax arrears.`;
  }
  requireMarket(p);
  const total = materials.reduce((sum, id) => sum + transferableCount(p, id), 0);
  if (!total) throw new Error('You have no materials to donate.');
  for (const id of materials) { const amount = transferableCount(p, id); v.stock[id] += amount; p.inventory[id] -= amount; }
  return `${total} materials donated to village supplies.`;
}

export function economyDawn(sim, v) {
  ensureEconomy(v);
  if (v.economy.lastDawn >= v.day) return;
  v.economy.lastDawn = v.day;
  for (const proposal of v.proposals) {
    if (proposal.status === 'voting' && proposal.day < v.day) {
      proposal.status = 'rejected'; proposal.reason = 'The day ended without a majority. The current policy remains in place.';
    }
    if (proposal.status === 'approved' && proposal.effectiveDay <= v.day) {
      const review = stewardReview(v, proposal.policy, proposal.value);
      if (review.approved) { v.policies[proposal.policy] = proposal.value; proposal.status = 'applied'; proposal.reason = `In effect from day ${v.day}. ${review.reason}`; }
      else { proposal.status = 'vetoed'; proposal.reason = `Conditions changed before dawn. ${review.reason}`; }
      v.steward.lastDecision = proposal.reason;
    }
  }
  const cycle = (sim.daySeconds || CONFIG.daySeconds) + (sim.nightSeconds || CONFIG.nightSeconds);
  let taxes = 0;
  for (const p of Object.values(v.players)) {
    if (!(p.participated > 0)) continue;
    const count = (v.plots || []).filter(plot => plot.ownerId === p.id).length;
    const charge = Math.ceil(v.policies.landTax * count * count * Math.min(1, p.participated / cycle));
    const paid = Math.min(p.wallet, charge); p.wallet -= paid; v.treasury += paid; taxes += paid; p.landDebt += charge - paid;
  }
  v.economy.lastTaxes = taxes;
  v.merchant.present = v.day > 1 && v.day % 2 === 1;
  if (!v.merchant.present) return;
  v.merchant.lastVisitDay = v.day; v.merchant.visits++;
  const wares = Object.keys(MERCHANT_STOCK), seed = [...`${v.id}:${v.day}:${v.merchant.visits}`].reduce((n, c) => (Math.imul(n, 33) + c.charCodeAt(0)) >>> 0, 5381);
  const offered = wares.filter((_, index) => index !== seed % wares.length);
  v.merchant.stock = Object.fromEntries(offered.map(id => [id, MERCHANT_STOCK[id]]));
  v.merchant.prices = Object.fromEntries(offered.map((id, index) => [id, Math.max(1, Math.floor(MERCHANT_PRICES[id] * (index ? .8 : .7)))]));
  const reserves = exportReserves(v), cap = v.policies.exportPriority === 'conserve' ? 40 : v.policies.exportPriority === 'trade' ? 120 : 80;
  let exported = 0, gold = 0;
  const manifest = [];
  for (const id of basics) {
    const amount = Math.min(cap, Math.max(0, v.stock[id] - reserves[id]));
    if (!amount) continue;
    const payout = amount * (id === 'wheat' ? 1 : 2);
    v.stock[id] -= amount; v.treasury += payout; gold += payout; exported += amount; manifest.push(`${amount} ${id}`);
  }
  v.economy.lastExportGold = gold;
  let horses = 0;
  // Stable restocks are the sole automatic import. No basic resources are bought.
  const activePayroll = Object.values(v.players).filter(p => p.online).reduce((sum, p) => sum + (p.role === 'guard' ? v.policies.guardWage : p.role === 'priest' ? v.policies.priestWage : 0), 0);
  if (v.stable.stock === 0) {
    horses = Math.min(3, Math.max(0, Math.floor((v.treasury - TREASURY_RESERVE - activePayroll * 2) / 50)));
    v.stable.stock = horses; v.treasury -= horses * 50;
  }
  v.merchant.summary = `${exported ? `Exported ${manifest.join(', ')} for ${gold} treasury gold after reserving food and repairs.` : 'No surplus was safe to export.'}${horses ? ` Restocked ${horses} horses at 50 gold each.` : ''}`;
  sim.notice?.(v.id, 'The traveling merchant has arrived for the day.');
}

export function economySnapshot(v, viewerId) {
  ensureEconomy(v);
  return {
    policies: { ...v.policies },
    proposals: v.proposals.map(p => ({ id: p.id, policy: p.policy, value: p.value, proposerId: p.proposerId, proposerName: p.proposerName, day: p.day, status: p.status, yes: Object.values(p.votes).filter(Boolean).length, no: Object.values(p.votes).filter(vote => !vote).length, required: p.required, myVote: p.votes[viewerId] ?? null, canVote: p.status === 'voting' && p.eligible.includes(viewerId) && !own(p.votes, viewerId), reason: p.reason, effectiveDay: p.effectiveDay })),
    steward: { ...v.steward, exportReserves: exportReserves(v) },
    merchant: { ...v.merchant, present: v.merchant.present && v.phase === 'day' && v.merchant.lastVisitDay === v.day, stock: { ...v.merchant.stock }, prices: { ...v.merchant.prices } },
    stable: { ...v.stable },
    foodQuotes: Object.fromEntries(Object.keys(FOOD).map(tier => [tier, foodQuote(v.stock.wheat, tier)])),
    landDebt: v.players[viewerId]?.landDebt ?? 0
  };
}
