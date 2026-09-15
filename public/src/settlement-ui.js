import { BUILDING_TYPES, RECIPES, TOOL_TIERS, RESOURCE_WEIGHTS, BACKPACKS, carryCapacity, MAX_PLOTS, PLOT_PRICES, TOOL_WEIGHTS, inventoryWeight } from '../../shared/content.js';
import { BUILDINGS, PLOTS, plotFront } from '../../shared/world.js';
import { RESOURCE_MARKET, TREASURY_RESERVE, MAX_TRADE_AMOUNT } from '../../shared/market.js';
import { FOOD, POLICIES, taxedSaleQuote, taxedPurchaseQuote } from '../../shared/economy.js';
import { CHURCH, RECRUIT, DEFENSE_UPGRADES, TOWER_STATS } from '../../shared/defense.js';
import { ROLE_STATS } from '../../shared/roles.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = value => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });
const label = id => ({ food: 'Bread', good_food: 'Hearty meal', best_food: 'Feast', arrows: 'Arrows', cart: 'Cargo cart' }[id] || String(id).replaceAll('_', ' ').replace(/^./, c => c.toUpperCase()));
const costText = cost => Object.entries(cost || {}).map(([id, count]) => `${num(count)} ${id}`).join(' · ');
const resources = ['timber', 'stone', 'wheat', 'iron', 'coal'];
const equipment = ['sword', 'axe', 'pickaxe', 'scythe', 'hammer', 'bow'];
const gap = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const hasCost = (stock, cost) => Object.entries(cost || {}).every(([id, amount]) => id === 'gold' || (stock?.[id] || 0) >= amount);

export function createSettlementUI({ getState, getMe, getActivePanel, openPanel, send, toast, getHotbar, setHotbar }) {
  let current = null, signature = '', handlers = [], waypoint = null;
  const tradeAmounts = new Map(), displayedTrades = new Map();
  const content = () => document.getElementById('panel-content');
  const me = () => getMe();
  const state = () => getState();
  const wallet = () => me()?.wallet || 0;
  const money = () => (me()?.wallet || 0) + (state()?.loan?.credit || 0);
  const plots = () => state()?.plots || [];
  const owned = () => plots().filter(p => p.ownerId === me()?.id);
  const head = (kicker, title, copy = '') => `<p class="eyebrow">${esc(kicker)}</p><h2>${esc(title)}</h2>${copy ? `<p>${esc(copy)}</p>` : ''}`;
  const row = (name, detail, control = '') => `<div class="settlement-row"><div><strong>${esc(name)}</strong>${detail ? `<small>${esc(detail)}</small>` : ''}</div>${control}</div>`;
  const stat = (name, value) => `<div><span>${esc(name)}</span><strong>${esc(value)}</strong></div>`;
  const stats = values => `<div class="settlement-stats">${values.map(([name, value]) => stat(name, value)).join('')}</div>`;
  function button(text, onClick, disabled = false, title = '', className = 'secondary-button') {
    const id = handlers.push(onClick) - 1;
    return `<button type="button" class="${className}" data-settlement-button="${id}" ${disabled ? 'disabled' : ''} ${title ? `title="${esc(title)}"` : ''}>${esc(text)}</button>`;
  }
  function command(text, kind, extra = {}, disabled = false, title = '') {
    return button(text, () => send({ type: 'action', kind, ...extra }), disabled, title);
  }
  function choices(id, values, selected) {
    return `<select id="${id}">${values.map(([value, text]) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select>`;
  }
  function quantity(id, max = 100, value = 1) {
    return `<input id="${id}" type="number" inputmode="numeric" min="1" max="${Math.max(1, max)}" value="${esc(value)}" aria-label="Amount">`;
  }
  const value = id => document.getElementById(id)?.value;
  const amount = id => Math.floor(Number(value(id)));
  function wire() {
    for (const b of content().querySelectorAll('[data-settlement-button]')) b.onclick = () => {
      if (b.disabled) return;
      handlers[Number(b.dataset.settlementButton)]?.();
    };
    const policyInput=document.getElementById('policy-name');
    if(policyInput)policyInput.onchange=()=>{const info=POLICIES[policyInput.value],field=document.getElementById('policy-value');field.min=info.min;field.max=info.max;field.step=info.step;field.value=state().policies?.[policyInput.value]??info.initial;};
    for (const select of content().querySelectorAll('[data-hotbar-slot]')) select.onchange = () => setHotbar(Number(select.dataset.hotbarSlot), select.value);
    for (const resource of Object.keys(RESOURCE_MARKET)) {
      const input = document.getElementById(`trade-amount-${resource}`);
      if (input) input.oninput = () => { tradeAmounts.set(resource, input.value); updateTrade(resource); };
    }
  }
  function show(kind, id = null) {
    if (!me() || !state()) return;
    current = { kind, id }; signature = ''; render();
  }
  function confirm(title, detail, kind, extra) {
    current = { kind: 'confirm', title, detail, action: kind, extra }; render();
  }
  function render() {
    if (!current || !me() || !state()) return;
    handlers = [];
    const builders = { inventory: pack, bank, food, tools, barracks: watch, church, stable, merchant, policies, roles, plot, cart, horse, atlas, confirm: confirmation };
    const body = builders[current.kind]?.(current.id) || '';
    if (!body) return;
    const dialog = document.getElementById('panel-dialog');
    const scroll = dialog.scrollTop;
    openPanel(`<div class="settlement-panel">${body}</div>`, 'settlement');
    dialog.classList.add('settlement-dialog'); wire(); dialog.scrollTop = scroll;
  }
  function refresh() {
    if (!current || getActivePanel() !== 'settlement' || !document.getElementById('panel-dialog').open) return;
    // Network snapshots must not reset a quantity or selection while it is being edited.
    if (content().contains(document.activeElement) && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
      if (current.kind === 'bank') for (const resource of Object.keys(RESOURCE_MARKET)) updateTrade(resource);
      return;
    }
    const p = me(), s = state();
    if (!p || !s) return;
    const next = JSON.stringify([p.wallet, p.bank, p.role, p.wageAccrued,p.jobBonus,p.repairBonus, p.inventory, p.durability, p.tiers, p.backpackTier, p.hp, Math.floor(p.hunger), p.carryingId, p.bedPlotId, p.mountedHorseId, s.stock, s.treasury, s.plots, s.policies, s.proposals, s.merchant, s.stable, s.loan, s.landDebt, s.foodQuotes, s.beds, s.barracks, s.defenseStatus, s.guardReplacements, s.guards.map(g => [g.id, g.hp > 0, g.hungry]), s.carts?.map(c => [c.id, c.storage, c.horseId]), s.horses?.map(h => [h.id, h.riderId, h.cartId])]);
    if (next !== signature) { signature = next; render(); }
  }
  function pack() {
    const p = me(), s = state();
    const backpack = BACKPACKS[p.backpackTier] || BACKPACKS[0];
    let html = head('YOUR PACK', 'Make room for the next watch.', 'Tools and items count toward your carrying limit. Store supplies at your own plots or in a cart.') + stats([['Carried weight', `${num(inventoryWeight(p))} / ${carryCapacity(p)}`], ['Carrying gear', backpack.name], ['Wallet', `${num(p.wallet)} gold`], ['Plots', `${owned().length} / ${MAX_PLOTS}`]]);
    html += '<p>Buy larger backpacks at Oak &amp; Iron, the village starter tool shop.</p>' + button('Mark the backpack shop', () => markService('tools'));
    html += '<h3>Carried supplies</h3>' + Object.keys(RESOURCE_WEIGHTS).map(id => row(label(id), `${num(RESOURCE_WEIGHTS[id])} weight each`, `<strong>${num(p.inventory?.[id])}</strong>`)).join('');
    if (p.inventory?.cart) html += command('Place your cargo cart', 'deployCart');
    if (p.carryingId) html += command('Put down the carried dwarf', 'dropPlayer');
    if (p.mountedHorseId) html += command('Dismount your horse', 'dismountHorse');
    html += '<h3>Equipment</h3>' + equipment.map(id => {
      const tier = TOOL_TIERS[p.tiers?.[id] || 'wood'];
      const durability = p.durability?.[id] || 0;
      return row(durability > 0 ? `${tier.name} ${label(id).toLowerCase()}` : label(id), durability > 0 ? `${num(durability)} uses remaining${['axe', 'pickaxe', 'scythe'].includes(id) ? ` · ${tier.yield} resources per swing` : ''}` : 'Not equipped');
    }).join('');
    const options = [...equipment, 'food', 'good_food', 'best_food', ...(p.role === 'priest' ? ['heal'] : [])];
    html += '<h3>Your eight hotbar slots</h3><p>Choose which equipment and food each number selects. A tool’s current tier is equipped automatically.</p><div class="hotbar-editor">' + getHotbar().map((selected, index) => `<label>Slot ${index + 1}<select data-hotbar-slot="${index}">${options.map(id => `<option value="${id}" ${id === selected ? 'selected' : ''}>${id === 'heal' ? 'Priest blessing' : label(id)}</option>`).join('')}</select></label>`).join('') + '</div>';
    html += '<h3>The village</h3>' + stats(resources.map(id => [label(id), num(s.stock?.[id])])) + row('Accrued role wage', 'Prorated by participation and paid at dawn.', `<strong>${num(p.wageAccrued)} gold</strong>`) + row('Performance bonus', 'Paid with wages at dawn; maximum 25 gold.', `<strong>${num(p.jobBonus)} / 25</strong>`) + row('Pending repair pay', 'Paid at dawn; maximum 10 gold each cycle.', `<strong>${num(p.repairBonus)} / 10</strong>`);
    html += '<div class="panel-actions">' + button('Village atlas', () => show('atlas')) + button('Change role', () => show('roles')) + '</div>';
    return html;
  }
  function bank() {
    const p = me(), s = state(), tax = s.policies?.tradeTax || 0, loan = s.loan || {};
    let html = head('VILLAGE TREASURY', 'A village built on shared supplies.', 'Trade prices follow the stock in the village. Quotes include the price change across the whole bundle.') + stats([['Wallet', `${num(p.wallet)} gold`], ['Protected savings', `${num(p.bank)} gold`], ['Treasury', `${num(s.treasury)} gold`]]);
    html += '<p>Your bank savings carry into another run. Trading tax: ' + num(tax) + '%. Emergency purchase reserve: ' + TREASURY_RESERVE + ' gold.</p><div class="transfer-form">' + quantity('bank-amount', Math.max(p.wallet, p.bank), 10) + button('Deposit', () => send({ type: 'action', kind: 'deposit', amount: amount('bank-amount') }), p.wallet < 1) + button('Withdraw', () => send({ type: 'action', kind: 'withdraw', amount: amount('bank-amount') }), p.bank < 1) + '</div><h3>Buy and sell resources</h3>';
    html += '<p>Enter any whole quantity. Quotes include the changing price of every unit and the village tax. You can sell a full pack in one trade.</p>';
    for (const [resource, info] of Object.entries(RESOURCE_MARKET)) {
      if (!tradeAmounts.has(resource)) tradeAmounts.set(resource, '10');
      const trade = quoteTrade(resource); displayedTrades.set(resource, trade);
      html += `<section class="market-row"><div class="market-heading"><strong>${esc(info.label)}</strong><span id="trade-stock-${resource}">${esc(trade.stockText)}</span></div>`;
      html += `<label class="trade-quantity" for="trade-amount-${resource}">Quantity ${quantity(`trade-amount-${resource}`, trade.maxAmount, tradeAmounts.get(resource)).replace('aria-label="Amount"', `aria-label="${esc(info.label)} quantity" aria-describedby="trade-limit-${resource}"`)}</label><p class="trade-limit" id="trade-limit-${resource}">${esc(trade.limitText)}</p>`;
      html += `<div class="trade-quotes"><p id="trade-sell-quote-${resource}">${esc(trade.sellText)}</p><p id="trade-buy-quote-${resource}">${esc(trade.buyText)}</p></div><div class="market-buttons">`;
      for (const direction of ['sell', 'buy']) html += button(trade[direction + 'Button'], () => submitTrade(resource, direction), !trade[direction + 'Allowed'], trade[direction + 'Reason']).replace('<button ', `<button id="trade-${direction}-${resource}" `);
      html += '</div></section>';
    }
    html += '<h3>Support the village</h3><p>Donate all the raw resources in your pack without payment.</p>' + command('Donate carried resources', 'donate', {}, !resources.some(id => p.inventory?.[id] > 0));
    html += '<h3>Purchase credit</h3><p>Credit pays for eligible purchases. It cannot be withdrawn or deposited as savings. Debt follows your account between runs; ' + num(loan.repaymentPercent ?? 20) + '% of earnings repays it.</p>' + stats([['Debt', `${num(loan.debt)} gold`], ['Unspent credit', `${num(loan.credit)} gold`], ['Credit limit', `${num(loan.maxDebt || 200)} gold`]]) + '<div class="transfer-form">' + quantity('loan-amount', 200, 100) + button('Borrow purchase credit', () => send({ type: 'action', kind: 'loan', amount: amount('loan-amount') }), (loan.debt || 0) >= (loan.maxDebt || 200) || (loan.availablePool || 0) < 1) + button('Repay from wallet', () => send({ type: 'action', kind: 'repayLoan', amount: amount('loan-amount') }), !loan.debt || !p.wallet) + '</div>';
    if (s.landDebt) html += `<p class="settlement-warning">Outstanding land tax: ${num(s.landDebt)} gold.</p>` + command('Pay land tax from wallet', 'pay_land_debt', {}, wallet() < 1);
    html += '<div class="panel-actions">' + button('Village policies & votes', () => show('policies')) + '</div>';
    return html;
  }
  function quoteTrade(resource) {
    const p = me(), s = state(), stock = s.stock?.[resource] || 0, carried = p.inventory?.[resource] || 0;
    const count = Number(tradeAmounts.get(resource)), valid = Number.isSafeInteger(count) && count >= 1 && count <= MAX_TRADE_AMOUNT;
    const room = Math.max(0, Math.floor((carryCapacity(p) - inventoryWeight(p)) / RESOURCE_WEIGHTS[resource]));
    const sellMax = Math.min(carried, MAX_TRADE_AMOUNT), buyMax = Math.min(stock, room, MAX_TRADE_AMOUNT);
    let sale = null, purchase = null;
    if (valid) {
      try { sale = taxedSaleQuote(resource, stock, count, s.policies?.tradeTax || 0); } catch {}
      try { purchase = taxedPurchaseQuote(resource, stock, count, s.policies?.tradeTax || 0); } catch {}
    }
    const invalidReason = `Enter a whole quantity from 1 to ${num(MAX_TRADE_AMOUNT)}.`;
    const sellReason = !valid ? invalidReason : count > carried ? `You carry only ${num(carried)} ${resource}.` : !sale ? 'A sale quote is unavailable.' : sale.total > s.treasury - TREASURY_RESERVE ? 'The treasury cannot pay this amount while preserving its reserve.' : '';
    const buyReason = !valid ? invalidReason : count > stock ? `The village has only ${num(stock)} ${resource}.` : count > room ? `Your pack has room for ${num(room)} more ${resource}.` : !purchase ? 'A purchase quote is unavailable.' : purchase.total > wallet() ? 'You do not have enough gold for this quantity.' : '';
    return {
      count, sale, purchase, maxAmount: Math.max(1, sellMax, buyMax), sellAllowed: !sellReason, buyAllowed: !buyReason, sellReason, buyReason,
      stockText: `${num(carried)} carried · ${num(stock)} in village`, limitText: `Can sell up to ${num(sellMax)} · Can buy up to ${num(buyMax)} with current stock and pack space.`,
      sellText: (sale ? `Sell: receive ${num(sale.total)}g (${num(sale.gross)}g value − ${num(sale.tax)}g tax).` : 'Sell: no quote.') + (sellReason ? ' ' + sellReason : ''),
      buyText: (purchase ? `Buy: pay ${num(purchase.total)}g (${num(purchase.subtotal)}g price + ${num(purchase.tax)}g tax).` : 'Buy: no quote.') + (buyReason ? ' ' + buyReason : ''),
      sellButton: sale ? `Sell ${num(count)} · ${num(sale.total)}g` : 'Sell', buyButton: purchase ? `Buy ${num(count)} · ${num(purchase.total)}g` : 'Buy'
    };
  }
  function updateTrade(resource) {
    if (!document.getElementById(`trade-amount-${resource}`)) return;
    const trade = quoteTrade(resource); displayedTrades.set(resource, trade);
    const write = (id, text) => { const node = document.getElementById(id); if (node) node.textContent = text; };
    document.getElementById(`trade-amount-${resource}`).max = trade.maxAmount;
    write(`trade-stock-${resource}`, trade.stockText); write(`trade-limit-${resource}`, trade.limitText);
    for (const direction of ['sell', 'buy']) {
      write(`trade-${direction}-quote-${resource}`, trade[direction + 'Text']);
      const control = document.getElementById(`trade-${direction}-${resource}`);
      if (control) { control.textContent = trade[direction + 'Button']; control.disabled = !trade[direction + 'Allowed']; control.title = trade[direction + 'Reason']; }
    }
  }
  function submitTrade(resource, direction) {
    // Submit the exact quote that was displayed. A newer, less favorable server
    // price is rejected through minTotal/maxTotal rather than silently accepted.
    const trade = displayedTrades.get(resource);
    if (!trade?.[direction + 'Allowed'] || Number(value(`trade-amount-${resource}`)) !== trade.count) return;
    send({ type: 'action', kind: direction === 'sell' ? 'sell' : 'buyResource', resource, amount: trade.count, ...(direction === 'sell' ? { minTotal: trade.sale.total } : { maxTotal: trade.purchase.total }) });
  }
  function food() {
    const s = state(), p = me();
    let html = head('THE BREADBOARD', 'Something warm for the road.', 'Meals go into your pack. Equip one on your hotbar or eat it here whenever you need it.') + stats([['Hunger', `${num(p.hunger)} / 100`], ['Village wheat', num(s.stock?.wheat)]]);
    for (const id of ['food', 'good_food', 'best_food']) {
      const item = s.foodQuotes?.[id] || FOOD[id];
      if (!item) continue;
      html += row(item.label || label(id), `Restores ${item.hunger} hunger · uses ${item.wheat} village wheat · ${num(p.inventory?.[id])} carried`, command(`Buy · ${item.price}g`, 'buyFood', { tier: id }, wallet() < item.price || (s.stock?.wheat || 0) < item.wheat || inventoryWeight(p) + RESOURCE_WEIGHTS[id] > carryCapacity(p)));
      if (p.inventory?.[id]) html += command('Eat ' + label(id).toLowerCase(), 'eat', { tier: id }, p.hunger >= 100);
    }
    return html;
  }
  function tools() {
    const p = me(), backpack = BACKPACKS[p.backpackTier] || BACKPACKS[0];
    let html = head('OAK & IRON', 'Tools for the job. Room for the haul.', 'Start with 10 gold and choose your first wooden tool. An axe gathers timber, a pickaxe mines stone and ore, and a scythe harvests wheat. Hammers repair structures using village supplies.') + stats([['Wallet', `${num(p.wallet)} gold`], ...(state().loan?.credit > 0 ? [['Purchase credit', `${num(state().loan.credit)} gold`]] : []), ['Carried weight', `${num(inventoryWeight(p))} / ${carryCapacity(p)}`]]) + '<h3>Wooden tools · 10 gold each</h3>';
    html += ['axe', 'pickaxe', 'scythe', 'hammer'].map(id => row('Wooden ' + id, p.durability?.[id] > 0 ? `${num(p.durability[id])} uses remain · replace it once broken` : `100 durability · ${id === 'hammer' ? 'repairs damaged structures' : 'one resource per swing'}`, command('Buy · 10g', 'buyTool', { tool: id }, money() < 10 || p.durability?.[id] > 0 || inventoryWeight(p) + TOOL_WEIGHTS[id] > carryCapacity(p)))).join('');
    html += '<p>Wooden tools need no materials. Stocked player tool shops craft stone and iron tools for higher yields at the same swing speed.</p><h3>Backpacks</h3><p>Equip a larger backpack to carry more tools, food, and resources. Upgrades replace your current bag. Each price is the full purchase price.</p>';
    html += row(backpack.name, `${carryCapacity(p)} total carrying capacity`, '<span class="status-pill">Equipped</span>');
    for (const pack of BACKPACKS.filter(pack => pack.tier > backpack.tier)) {
      const capacity = carryCapacity({ ...p, backpackTier: pack.tier });
      html += row(pack.name, `${capacity} total capacity · +${capacity - carryCapacity(p)} more weight`, command(`Equip · ${pack.price}g`, 'buyBackpack', { tier: pack.tier }, money() < pack.price));
    }
    if (backpack.tier === BACKPACKS.at(-1).tier) html += '<p>Your expedition backpack provides the largest carrying capacity.</p>';
    return html + '<div class="panel-actions">' + button('Find a player tool shop', () => show('atlas')) + '</div>';
  }
  function watch() {
    const replacements = (state().guardReplacements || []).filter(g => !g.plotId && !g.ownerId);
    return head('THE WATCH', 'One gate. Every dwarf helps.', 'The public watch marches from this barracks to the road outside the gate. Any role may defend with a sword or bow.') + stats([['Village watch', num(state().guards.filter(g => !g.ownerId && g.hp > 0).length)], ['Awaiting replacement', num(replacements.length)], ['Stored wheat', num(state().barracks?.wheat)]]) + `<p>Each deployed troop eats one wheat each night. Hungry troops deal less damage. Fallen guards return after ${RECRUIT.respawnSeconds} seconds if the barracks has ${RECRUIT.respawnWheat} wheat per replacement. Guards can build up to two owned barracks, each with ${RECRUIT.capacity} recruited troops.</p>` + replacementRows(replacements) + command('Donate carried wheat', 'donate', { targetId: 'barracks' }, !me().inventory?.wheat) + '<div class="panel-actions">' + button('Your land', () => show('atlas')) + '</div>';
  }
  function replacementRows(replacements, destroyed = false) {
    return replacements.map((g, index) => row(`Fallen guard ${index + 1}`, destroyed ? 'Waiting for barracks repairs' : g.waitingForWheat ? `Waiting for ${RECRUIT.respawnWheat} wheat in this barracks${g.remaining > 0 ? ` · ${Math.ceil(g.remaining)} seconds preparation remaining` : ''}` : `Returns in ${Math.ceil(g.remaining)} seconds · costs ${RECRUIT.respawnWheat} stored wheat`)).join('');
  }
  function markService(kind) {
    const service = BUILDINGS.find(b => b.id === kind);
    if (!service) return;
    waypoint = { ...service, kind: 'service' };
    toast(service.name + ' marked on your minimap.');
  }
  function church(id = 'church') {
    if (id === 'church') return head('THE SANCTUARY', 'Find care in the village.', 'Priests can heal and revive nearby allies with their blessing. Automatic paid beds are available at churches built by priest players.') + '<div class="panel-actions">' + button('Find a player church', () => show('atlas')) + '</div>';
    const p = me(), beds = (state().beds || []).find(b => b.plotId === id), patients = beds?.patients || [], busy = patients.length >= (beds?.capacity || 2);
    let html = head('SANCTUARY BEDS', 'A place to recover.', 'A priest can heal and revive in the field. Church beds offer paid care even while the priest is away.') + stats([['Beds occupied', `${patients.length} / ${beds?.capacity || 2}`], ['Healing', `${CHURCH.healFee}g · ${CHURCH.healSeconds}s`], ['Revival', `${CHURCH.reviveFee}g · ${CHURCH.reviveSeconds}s`]]);
    for (const patient of patients) html += row(state().players.find(v => v.id === patient.playerId)?.name || 'Recovering dwarf', `${patient.revive ? 'Reviving' : 'Healing'} · ${Math.ceil(patient.remaining)} seconds remaining`);
    if (p.bedPlotId) html += command('Leave your bed', 'churchLeave');
    else html += command(`Pay ${CHURCH.healFee}g and rest`, 'churchTreat', { plotId: id }, busy || p.hp >= p.maxHp || wallet() < CHURCH.healFee);
    if (p.carryingId) html += command(`Place carried dwarf in bed · ${CHURCH.reviveFee}g`, 'churchTreat', { plotId: id, targetId: p.carryingId }, busy || wallet() < CHURCH.reviveFee);
    return html;
  }
  function stable() {
    const horse = state().horses?.find(h => h.ownerId === me().id);
    return head('THE VILLAGE STABLE', 'A companion for the road.', 'The steward restocks an empty stable when the merchant visits and the treasury can afford it. Each dwarf may own one horse.') + stats([['Horses for sale', `${num(state().stable?.stock)} / 3`]]) + (horse ? row('Your horse', 'Approach your horse to ride or attach a cart.', button('Mark on map', () => { waypoint = { id: horse.id, kind: 'horse', name: 'Your horse' }; toast('Your horse is marked on the minimap.'); })) : command('Buy a horse · 100g', 'buyHorse', {}, !state().stable?.stock || wallet() < 100));
  }
  function horse(id) {
    const h = state().horses?.find(v => v.id === id);
    if (!h) return head('STABLE', 'Your horse is no longer here.');
    const cart = state().carts?.find(c => c.ownerId === me().id && gap(c, h) <= 4);
    let html = head('YOUR HORSE', 'Travel farther. Bring more home.');
    html += h.riderId === me().id ? command('Dismount', 'dismountHorse') : command('Ride your horse', 'mountHorse', { targetId: h.id }, Boolean(h.riderId));
    if (h.cartId) html += command('Detach cargo cart', 'attachCart', { targetId: h.cartId, horseId: null });
    else if (cart) html += command('Attach nearby cargo cart', 'attachCart', { targetId: cart.id, horseId: h.id });
    return html;
  }
  function cart(id) {
    const c = state().carts?.find(v => v.id === id);
    if (!c) return head('CARGO CART', 'This cart is no longer here.');
    let html = head('CARGO CART', 'Bring supplies back together.', 'Cart storage is separate from your carrying capacity. Attach the cart to your horse to transport its contents.') + stats([['Stored weight', `${num(inventoryWeight(c.storage || {}))} / 300`]]);
    html += storage(c.storage || {}, id, true);
    const h = state().horses?.find(h => h.ownerId === me().id && gap(h, c) <= 4);
    if (c.horseId) html += command('Detach from horse', 'attachCart', { targetId: c.id, horseId: null });
    else if (h) html += command('Attach to nearby horse', 'attachCart', { targetId: c.id, horseId: h.id });
    return html;
  }
  function merchant() {
    const m = state().merchant || {};
    let html = head('TRAVELING MERCHANT', m.present ? 'Fresh wares at the crossroads.' : 'The merchant is on the road.', 'The merchant visits during the day after every second night. Dwarfs gather the village’s basic materials; the steward can export a safe surplus.');
    if (m.summary) html += `<p>${esc(m.summary)}</p>`;
    if (m.present) for (const [resource, stock] of Object.entries(m.stock || {})) html += row(label(resource), `${num(stock)} available · ${num(me().inventory?.[resource])} carried`, command(`Buy one · ${num(m.prices?.[resource])}g`, 'merchant_buy', { resource, amount: 1 }, stock < 1 || wallet() < m.prices?.[resource] || inventoryWeight(me()) + (RESOURCE_WEIGHTS[resource] || 1) > carryCapacity(me())));
    html += '<h3>The steward’s last decision</h3><p>' + esc(state().steward?.lastDecision || 'The steward is watching village supplies.') + '</p>';
    return html;
  }
  function policies() {
    const s = state();
    let html = head('VILLAGE COUNCIL', 'A voice for every dwarf.', 'A majority vote goes to the steward for an affordability and fairness review. Approved policies take effect at the next dawn.') + stats([['Guard wage', `${num(s.policies?.guardWage)}g`], ['Priest wage', `${num(s.policies?.priestWage)}g`], ['Trade tax', `${num(s.policies?.tradeTax)}%`], ['Base land tax', `${num(s.policies?.landTax)}g`]]);
    html += '<p>Wages are paid at dawn and depend on participation. Performance pay is additional. Full-cycle land tax is the base tax multiplied by the square of your plot count, prorated by your time online.</p><h3>Propose a change</h3><div class="policy-form"><label>Policy' + choices('policy-name', [['guardWage', 'Guard daily wage'], ['priestWage', 'Priest daily wage'], ['tradeTax', 'Trade tax %'], ['landTax', 'Land tax base']]) + '</label><label>New value' + quantity('policy-value', 60, 25).replace('min="1"', 'min="10" step="5"') + '</label>' + button('Submit proposal', () => send({ type: 'action', kind: 'propose_policy', policy: value('policy-name'), value: amount('policy-value') })) + '</div><div class="transfer-form">' + choices('export-priority', [['conserve', 'Conserve supplies'], ['balanced', 'Balanced reserves'], ['trade', 'Export more surplus']], s.policies?.exportPriority) + button('Propose resource priority', () => send({ type: 'action', kind: 'propose_policy', policy: 'exportPriority', value: value('export-priority') })) + '</div><h3>Votes & decisions</h3>';
    const proposals = s.proposals || [];
    if (!proposals.length) html += '<p>No proposals yet. All residents have a voice.</p>';
    for (const proposal of [...proposals].reverse()) {
      html += `<section class="proposal-card"><div class="market-heading"><strong>${esc(label(proposal.policy))} → ${esc(proposal.value)}</strong><span class="status-pill">${esc(proposal.status)}</span></div><p>${esc(proposal.proposerName)} · ${proposal.yes} yes / ${proposal.no} no · ${proposal.required} votes needed</p>`;
      if (proposal.reason) html += `<p>${esc(proposal.reason)}</p>`;
      if (proposal.effectiveDay && proposal.status === 'approved') html += `<p>Takes effect at dawn on day ${proposal.effectiveDay}.</p>`;
      if (proposal.canVote) html += '<div class="panel-actions">' + command(proposal.myVote === true ? 'You voted yes' : 'Vote yes', 'vote_policy', { proposalId: proposal.id, approve: true }, proposal.myVote === true) + command(proposal.myVote === false ? 'You voted no' : 'Vote no', 'vote_policy', { proposalId: proposal.id, approve: false }, proposal.myVote === false) + '</div>';
      html += '</section>';
    }
    html += '<h3>The steward explains</h3><p>' + esc(s.steward?.lastDecision || 'No spending decision yet.') + '</p>';
    return html;
  }
  function roles() {
    let html = head('YOUR CALLING', 'Choose how you serve.', 'Every job can gather, use weapons, build universal structures, and repair defenses. Role changes preserve your land and universal buildings.');
    for (const id of ['villager', 'guard', 'priest']) {
      const losses = owned().filter(p => BUILDING_TYPES[p.building]?.role && BUILDING_TYPES[p.building].role !== id);
      const traits = ROLE_STATS[id];
      html += row(label(id), { villager: `Build, gather, craft, and trade. Carry ${traits.extraCapacity} extra weight, with or without a backpack.`, guard: `Own barracks and sword shops. Earn defense pay. Gain ${traits.maxShield} shield; it recovers ${traits.shieldRegen} per second after ${traits.shieldDelay} seconds without taking damage.`, priest: `Heal and revive allies. Own churches and earn care pay. ${traits.maxHp} maximum health.` }[id], button(id === me().role ? 'Current role' : 'Choose ' + id, () => {
        if (losses.length) confirm('Change your role?', 'You will lose ' + losses.map(p => `${BUILDING_TYPES[p.building].name} (${PLOTS.find(v => v.id === p.id)?.name || p.id})`).join(', ') + '. Their troops are disbanded. Empty their stores and finish treatments first. Your plots and universal buildings remain.', 'role_change', { role: id, confirm: true });
        else send({ type: 'action', kind: 'role_change', role: id });
      }, id === me().role));
    }
    return html;
  }
  function storage(stored, id, isCart = false, owner = true) {
    const transferable = Object.keys(RESOURCE_WEIGHTS);
    let html = '<div class="storage-grid">' + transferable.filter(r => stored[r] > 0 || me().inventory?.[r] > 0 || resources.includes(r)).map(r => `<div><span>${esc(label(r))}</span><strong>${num(stored[r])}</strong><small>${num(me().inventory?.[r])} carried</small></div>`).join('') + '</div><div class="transfer-form">' + choices('storage-resource', transferable.map(id => [id, label(id)])) + quantity('storage-amount', 1500, 1);
    html += button('Store', () => send({ type: 'action', kind: isCart ? 'cartDeposit' : 'plot_deposit', ...(isCart ? { targetId: id } : { plotId: id }), resource: value('storage-resource'), amount: amount('storage-amount') }));
    if (owner) html += button('Take', () => send({ type: 'action', kind: isCart ? 'cartWithdraw' : 'plot_withdraw', ...(isCart ? { targetId: id } : { plotId: id }), resource: value('storage-resource'), amount: amount('storage-amount') }));
    return html + '</div>';
  }
  function plot(id) {
    const place = PLOTS.find(p => p.id === id), p = plots().find(p => p.id === id) || { id }, mine = p.ownerId === me().id;
    if (!place) return head('LAND REGISTRY', 'That plot is unavailable.');
    const type = BUILDING_TYPES[p.building], title = type?.name || 'Open plot';
    let html = head(place.outside ? 'BEYOND THE WALL · EXPOSED LAND' : 'VILLAGE LAND', `${place.name || id} · ${title}`, place.outside ? 'Outside plots offer forward defenses and access to rich gathering grounds. Buildings here are exposed to the horde.' : 'One building or land use per plot. Stand by the plot to buy, build, trade, or manage it.');
    if (!p.ownerId) {
      const count = owned().length, price = PLOT_PRICES[count];
      html += stats([['Your land', `${count} / ${MAX_PLOTS}`], ['Purchase', price === undefined ? 'Plot limit reached' : `${price} gold`], ['Total daily tax after purchase', `${num((state().policies?.landTax ?? 2) * (count + 1) ** 2)} gold`]]);
      html += command(price ? `Buy this plot · ${price}g` : 'Plot limit reached', 'plot_buy', { plotId: id }, price === undefined || money() < price);
      return html;
    }
    html += stats([['Owner', p.ownerName || 'Village resident'], ['Building health', p.building ? `${num(p.hp)} / ${num(p.maxHp)}` : 'Unbuilt'], ['Level', num(p.level || 1)]]);
    if (p.building && p.hp > 0 && p.hp < p.maxHp) html += command('Repair with equipped hammer', 'repairPlot', { plotId: id }, !me().durability?.hammer, 'Consumes shared village repair supplies and hammer durability.');
    if (['mine', 'wheat_farm', 'tree_farm'].includes(p.building)) html += '<p>' + (mine ? 'Your harvest is yours. When visitors harvest, their output is split 80% to them and 20% into your storage over time.' : p.allowVisitors ? 'Visitors may gather here. Your share is 80%; the owner receives the remaining 20% over time.' : 'This owner has closed harvesting to visitors.') + '</p>' + (mine ? command(p.allowVisitors ? 'Close visitor harvesting' : 'Allow visitor harvesting', 'plot_access', { plotId: id, allowVisitors: !p.allowVisitors }) : '');
    const recipes = Object.entries(RECIPES).filter(([, r]) => r.shop === p.building);
    if (recipes.length) {
      html += '<h3>Crafted to order</h3><p>Each purchase uses this shop’s stored materials. Payment goes to its owner. Equipment replaces your current item of that type.</p>';
      for (const [recipe, r] of recipes) html += row(r.name, costText(r.cost), button(`Buy · ${r.price}g`, () => {if(r.tool && me().durability?.[r.tool]>0)confirm('Replace your equipped item?', `${r.name} costs ${r.price} gold and uses ${costText(r.cost)} from this shop. Your existing ${r.tool} and its remaining durability will be lost.`, 'craft_buy', {plotId:id,recipe,confirm:true});else send({type:'action',kind:'craft_buy',plotId:id,recipe});}, !hasCost(p.storage, r.cost) || (mine?wallet():money()) < r.price || p.hp <= 0, !hasCost(p.storage, r.cost) ? 'The shop needs more materials.' : 'Crafts from shop storage.'));
    }
    if (p.building === 'church') html += church(id).replace(/^.*?<h2>.*?<\/h2>/s, '');
    if (p.building === 'barracks') {
      const troops = state().guards.filter(g => g.plotId === id && g.hp > 0);
      const replacements = (state().guardReplacements || []).filter(g => g.plotId === id);
      html += '<h3>Barracks troops</h3>' + stats([['Recruited slots', `${troops.length + replacements.length} / ${RECRUIT.capacity}`], ['Living troops', num(troops.length)], ['Awaiting replacement', num(replacements.length)], ['Hungry troops', num(troops.filter(g => g.hungry).length)], ['Stored wheat', num(p.storage?.wheat)]]) + `<p>Each deployed troop consumes one stored wheat per night. Unfed troops deal 25% less damage. Fallen troops keep their recruited slot and return after ${RECRUIT.respawnSeconds} seconds when this barracks has ${RECRUIT.respawnWheat} wheat per replacement. Replacements cost no gold.</p>` + replacementRows(replacements, p.hp <= 0) + '<p>Recruiting an additional slot costs ' + costText({gold:RECRUIT.gold,...RECRUIT.resources}) + '.</p>';
      if (mine) html += command('Recruit a guard', 'recruitGuard', { plotId: id }, troops.length + replacements.length >= RECRUIT.capacity || wallet() < RECRUIT.gold || !hasCost(p.storage, RECRUIT.resources) || p.hp <= 0);
    }
    if (TOWER_STATS[p.building]) {
      const tower = TOWER_STATS[p.building], status = state().defenseStatus?.find(d => d.plotId === id);
      const ammunition = Object.entries(tower.ammo).map(([resource, cost]) => [label(resource) + ' stored', num(p.storage?.[resource])]);
      const shots = status?.shotsRemaining ?? Math.min(...Object.entries(tower.ammo).map(([resource, cost]) => Math.floor((p.storage?.[resource] || 0) / cost)));
      const condition = p.hp <= 0 ? 'destroyed' : shots < 1 ? 'empty' : status?.status || 'ready';
      const descriptions = {
        ready: ['Ready', 'Automatically fires when a zombie enters range.'],
        firing: ['Engaging zombies', 'A zombie is in range and the defense is attacking.'],
        blocked: ['Shot blocked', 'Nearby terrain or buildings block the shot. A target needs a clear line of fire.'],
        out_of_range: ['Waiting for targets', 'The zombies are outside this defense’s firing range.'],
        empty: ['Out of ammunition', 'Add ammunition to Building storage below to resume firing.'],
        destroyed: ['Destroyed', 'The owner must empty its storage, remove the ruined building, and rebuild.']
      };
      const [name, detail] = descriptions[condition] || descriptions.ready;
      html += '<h3>Automatic defense</h3><div class="defense-state" data-defense-state="' + esc(condition) + '"><strong>' + esc(name) + '</strong><p>' + esc(detail) + '</p></div>' + stats([['Firing range', `${num(status?.range ?? tower.range)} m`], ['Shots available', num(shots)], ...ammunition]);
      html += '<p>' + (p.building === 'archer_tower' ? `Each shot consumes one stored arrow. New towers include ${tower.starterAmmo.arrows} arrows. Buy more from a player tinker shop or the traveling merchant, then store them in the tower.` : 'Each shot consumes one stored stone and one stored coal. Gather both with a pickaxe and place them in this building’s storage.') + '</p>';
    }
    if(mine && DEFENSE_UPGRADES[p.building]) {const upgrade=DEFENSE_UPGRADES[p.building];html+='<h3>Building upgrade</h3><p>'+costText({gold:upgrade.gold,...upgrade.resources})+'</p>'+command((p.level||1)>=2?'Fully upgraded':p.building==='church'?'Upgrade to four beds':'Upgrade to level 2','upgradeDefense',{plotId:id},(p.level||1)>=2||wallet()<upgrade.gold||!hasCost(p.storage,upgrade.resources)||p.hp<=0);}
    if (mine || p.building) html += '<h3>Building storage</h3><p>Capacity: ' + num(inventoryWeight(p.storage||{})) + ' / 1,500 weight. Materials stored on an empty plot can fund its construction.</p>' + storage(p.storage || {}, id, false, mine);
    if (mine) {
      html += '<h3>' + (p.building ? 'Convert this plot' : 'Choose a building') + '</h3><p>Construction consumes gold, uses this plot’s stored materials first, then any remaining materials from your pack. Converting removes the existing building; first empty its storage and finish treatments.</p><div class="building-catalog">';
      for (const [building, info] of Object.entries(BUILDING_TYPES)) {
        const wrongRole = info.role && info.role !== me().role;
        const atLimit = info.limit && owned().filter(v => v.building === building).length >= info.limit;
        html += `<section class="building-card"><strong>${esc(info.name)}</strong><p>${esc(costText(info.cost))}${building === 'archer_tower' ? `<br>Includes ${TOWER_STATS.archer_tower.starterAmmo.arrows} arrows` : ''}</p>${info.role ? `<small>${esc(label(info.role))} only${info.limit ? ` · limit ${info.limit}` : ''}</small>` : '<small>Every role</small>'}` + button(p.building === building ? 'Already built' : p.building ? 'Convert plot' : 'Build', () => {
          if (p.building) confirm('Replace this building?', `This removes your ${type.name} and any deployed troops. Empty storage and finish church treatments first. Building the ${info.name} costs ${costText(info.cost)}.`, 'plot_build', { plotId: id, building, confirm: true });
          else send({ type: 'action', kind: 'plot_build', plotId: id, building });
        }, wrongRole || atLimit || p.building === building || money() < info.cost.gold || !hasCost(Object.fromEntries(resources.map(r=>[r,(me().inventory?.[r]||0)+(p.storage?.[r]||0)])), info.cost)) + '</section>';
      }
      html += '</div>';
      if(p.building)html+='<h3>Remove this building</h3><p>Demolition retains your land. Empty storage and finish treatments first. There is no refund.</p>'+button('Demolish building',()=>confirm('Remove this building?',`Your ${type.name} and deployed troops will be removed without a refund. The plot remains yours.`,'plot_demolish',{plotId:id,confirm:true}));
    }
    return html;
  }
  function confirmation() {
    return head('PLEASE REVIEW', current.title, current.detail) + '<div class="panel-actions">' + button('Cancel', () => show('inventory')) + button('Confirm change', () => { send({ type: 'action', kind: current.action, ...current.extra }); show('inventory'); }, false, '', 'primary-button') + '</div>';
  }
  function atlas() {
    let html = head('VILLAGE ATLAS', 'Find your place in the village.', 'Gold marks your land. Open plots lie beyond the central services, with exposed defense plots beside the approach road. Mark a destination to find it on your minimap.');
    html += '<h3>Permanent services</h3><div class="atlas-list">';
    for (const b of BUILDINGS.filter(b => !['house'].includes(b.kind))) html += row(b.name, `${Math.round(gap(b, me()))} m away`, button('Mark', () => { waypoint = { ...b, kind: 'service' }; toast(b.name + ' marked on your minimap.'); }));
    html += '</div><h3>Plots & player businesses</h3><div class="atlas-list">';
    for (const place of PLOTS) {
      const p = plots().find(p => p.id === place.id), type = BUILDING_TYPES[p?.building];
      html += row(`${place.name || place.id}${p?.ownerId === me().id ? ' · yours' : ''}`, `${type?.name || 'Open plot'}${p?.ownerId ? ' · ' + (p.ownerName || 'Village resident') : ''} · ${place.outside ? 'outside' : 'inside'} · ${Math.round(gap(place, me()))} m`, button('Mark', () => { waypoint = { ...plotFront(place, -.8), id: place.id, name: place.name || place.id, kind: 'plot' }; toast((place.name || place.id) + ' marked on your minimap.'); }));
    }
    return html + '</div>';
  }
  return { show, refresh, getWaypoint: () => waypoint, clear: () => { current = null; waypoint = null; signature = ''; tradeAmounts.clear(); displayedTrades.clear(); } };
}
