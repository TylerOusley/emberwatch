import { TRADE_ITEMS, TRADE_RULES, emptyTradeOffer, normalizeTradeOffer, canTrade, withinTradeRange } from '../../shared/trading.js';
import { carryCapacity, inventoryWeight } from '../../shared/content.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const count = value => Number.isSafeInteger(value) && value > 0 ? value : 0;
const pretty = value => count(value).toLocaleString('en-US');

export function createTradingUI({ getState, getMe, getActivePanel, openPanel, send, toast = () => {}, document: doc = globalThis.document }) {
  let signature = '', draftTradeId = null, ownOfferSignature = '', seenInvite = null, seenResult = null, handlers = [], controls = {};
  const drafts = new Map();
  const content = () => doc.getElementById('panel-content');
  const tradeNow = () => getState()?.trading?.trade ?? null;
  const active = () => getActivePanel() === 'trading';
  const ready = () => getState()?.status === 'active' && canTrade(getMe());
  const nearby = () => (getState()?.players ?? []).filter(player => player.id !== getMe()?.id && canTrade(player) && withinTradeRange(getMe(), player)).sort((a, b) => a.name.localeCompare(b.name));
  const available = id => Math.min(TRADE_RULES.maxAmount, count(id === 'gold' ? getMe()?.wallet : getMe()?.inventory?.[id]));
  const currentSignature = () => JSON.stringify([getState()?.trading, ready(), getMe()?.inventory, getMe()?.wallet, getMe()?.backpackTier, getMe()?.role, nearby().map(p => [p.id, p.name])]);
  function resetDraft(trade) {
    draftTradeId = trade?.id ?? null;
    const own = trade?.offers[getMe()?.id] ?? emptyTradeOffer();
    ownOfferSignature = JSON.stringify(own); drafts.clear();
    for (const id of Object.keys(TRADE_ITEMS)) drafts.set(id, String(own.resources[id] ?? 0));
    drafts.set('gold', String(own.gold ?? 0));
  }
  function syncDraft(trade) {
    if (draftTradeId !== trade?.id || ownOfferSignature !== JSON.stringify(trade?.offers[getMe()?.id] ?? emptyTradeOffer())) resetDraft(trade);
  }
  function draftOffer() {
    const number = id => {
      const text = drafts.get(id) ?? '0';
      if (text !== '' && !/^\d+$/.test(text)) throw new Error('Enter whole amounts, using digits only.');
      return Number(text || '0');
    };
    return normalizeTradeOffer({ resources: Object.fromEntries(Object.keys(TRADE_ITEMS).map(id => [id, number(id)])), gold: number('gold') });
  }
  function draftValid() {
    try { const offer = draftOffer(); return offer.gold <= available('gold') && Object.entries(offer.resources).every(([id, n]) => n <= available(id)); } catch { return false; }
  }
  function dirty() {
    try { return JSON.stringify(draftOffer()) !== JSON.stringify(tradeNow()?.offers[getMe()?.id]); } catch { return true; }
  }
  const hasOffer = trade => trade && Object.values(trade.offers).some(offer => offer.gold || Object.values(offer.resources).some(Boolean));
  function emit(kind, extra = {}, expected = null) {
    if (expected && tradeNow()?.id !== expected.id) { toast('That trade has ended.'); return; }
    if (kind !== 'trade_cancel' && !ready()) { toast('Stand on foot, out of bed, to trade.'); return; }
    send({ type: 'action', kind, ...extra });
  }
  function button(label, handler, disabled = false, control = null) {
    const index = handlers.push(handler) - 1;
    if (control) controls[control] = index;
    return `<button class="secondary-button" type="button" data-trade-button="${index}" ${disabled ? 'disabled' : ''}>${esc(label)}</button>`;
  }
  function refreshButtons() {
    const buttons = content()?.querySelectorAll('[data-trade-button]') ?? [], trade = tradeNow();
    const enabled = ready() && trade?.status === 'active';
    if (buttons[controls.save]) buttons[controls.save].disabled = !enabled || !draftValid() || !dirty();
    if (buttons[controls.confirm]) buttons[controls.confirm].disabled = !enabled || dirty() || !hasOffer(trade) || !!trade?.confirmations[getMe()?.id];
    const status = doc.getElementById('trade-draft-status');
    if (status) status.textContent = dirty() ? (draftValid() ? 'You have unsaved changes. Update your offer before confirming.' : 'Enter whole amounts up to what you carry.') : 'Your displayed offer is saved.';
  }
  function summary(offer) {
    const rows = Object.entries(offer.resources).filter(([, amount]) => amount > 0).map(([id, amount]) => `<div class="panel-row"><span>${esc(TRADE_ITEMS[id])}</span><strong>${pretty(amount)}</strong></div>`);
    if (offer.gold) rows.push(`<div class="panel-row"><span>Wallet gold</span><strong>${pretty(offer.gold)}</strong></div>`);
    return rows.join('') || '<p>Nothing offered.</p>';
  }
  function render() {
    if (!getMe() || !getState()) return;
    const trade = tradeNow(), me = getMe(), result = getState().trading?.result;
    syncDraft(trade); signature = currentSignature(); handlers = []; controls = {};
    const focused = doc.activeElement, focusId = focused?.dataset?.tradeInput, selection = focusId ? [focused.selectionStart, focused.selectionEnd] : null;
    const scroll = doc.getElementById('panel-dialog')?.scrollTop ?? 0;
    let html = '<div id="trading-panel" class="settlement-panel"><p class="eyebrow">DWARF TO DWARF</p><h2>Player trading</h2><p>Exchange resources, food, arrows and wallet gold with a nearby player. Each of you reviews the final offer and confirms it. Equipment, carts, savings and purchase credit stay with their owner.</p>';
    if (!trade) {
      if (result) html += `<p role="status"><strong>${esc(result.message)}</strong></p>`;
      html += '<h3>Nearby players</h3>';
      if (!ready()) html += '<p>You must be alive, on foot and out of bed to trade.</p>';
      const players = ready() ? nearby() : [];
      html += players.length ? players.map(player => `<div class="panel-row"><span>${esc(player.name)}</span>${button('Invite to trade', () => { const target = nearby().find(p => p.id === player.id); if (target) emit('trade_invite', { targetId: target.id }); else toast('Move closer to that player.'); })}</div>`).join('') : `<p>Walk within ${TRADE_RULES.range} steps of another standing player, then open this panel.</p>`;
    } else {
      const partner = trade.players.find(player => player.id !== me.id), partnerName = partner?.name ?? 'Your partner';
      html += `<h3>Trading with ${esc(partnerName)}</h3>`;
      if (trade.status === 'invited') {
        const incoming = trade.inviterId !== me.id;
        html += `<p>${incoming ? `${esc(partnerName)} invited you to trade.` : 'Waiting for your partner to accept the invitation.'} Nothing leaves your inventory until both players confirm the final offer.</p><div class="panel-actions">`;
        if (incoming) html += button('Accept invitation', () => emit('trade_accept', { tradeId: trade.id }, trade), !ready());
        html += button(incoming ? 'Decline' : 'Cancel invitation', () => emit('trade_cancel', { tradeId: trade.id }, trade)) + '</div>';
      } else {
        const own = trade.offers[me.id], other = trade.offers[partner.id], version = trade.version;
        html += `<p><strong>Offer revision ${version}</strong> · Any change clears both confirmations. Stay beside each other while trading.</p><div class="settlement-stats"><div><span>You give</span>${summary(own)}</div><div><span>You receive from ${esc(partnerName)}</span>${summary(other)}</div></div>`;
        const nextInventory = { ...me.inventory };
        for (const id of Object.keys(TRADE_ITEMS)) nextInventory[id] = count(nextInventory[id]) - own.resources[id] + other.resources[id];
        const nextWeight = inventoryWeight({ ...me, inventory: nextInventory });
        html += `<p>Your pack after this trade: <strong>${nextWeight} / ${carryCapacity(me)}</strong> weight${nextWeight > carryCapacity(me) ? ' — make room before confirming.' : '.'}</p><p aria-live="polite">You: <strong>${trade.confirmations[me.id] ? 'Confirmed' : 'Reviewing'}</strong> · ${esc(partnerName)}: <strong>${trade.confirmations[partner.id] ? 'Confirmed' : 'Reviewing'}</strong></p>`;
        html += '<div class="panel-actions">' + button(trade.confirmations[me.id] ? 'Waiting for partner' : 'Confirm this exchange', () => {
          if (tradeNow()?.version !== version) { toast('The offer changed. Review the latest terms first.'); render(); return; }
          if (dirty()) { toast('Update your offer before confirming.'); return; }
          emit('trade_confirm', { tradeId: trade.id, version }, trade);
        }, false, 'confirm') + button('Cancel trade', () => emit('trade_cancel', { tradeId: trade.id }, trade)) + '</div><h3>Edit your offer</h3><p>Type an amount or use Max. Choose Update offer to share changes.</p>';
        for (const [id, label] of [...Object.entries(TRADE_ITEMS), ['gold', 'Wallet gold']]) html += `<div class="settlement-row"><div><label for="trade-input-${id}"><strong>${label}</strong></label><small>You carry ${pretty(available(id))}</small></div><div class="transfer-form"><input id="trade-input-${id}" data-trade-input="${id}" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="7" value="${esc(drafts.get(id))}" aria-label="${label} offered">${button('Max', () => { drafts.set(id, String(available(id))); const input = doc.getElementById(`trade-input-${id}`); if (input) input.value = drafts.get(id); refreshButtons(); })}</div></div>`;
        html += '<p id="trade-draft-status" role="status"></p><div class="panel-actions">' + button('Update offer', () => {
          if (!draftValid()) { toast('Enter whole amounts up to what you carry.'); return; }
          emit('trade_offer', { tradeId: trade.id, offer: draftOffer() }, trade);
        }, false, 'save') + button('Discard edits', () => { resetDraft(tradeNow()); render(); }) + '</div>';
      }
    }
    html += '<p>Closing this panel keeps the invitation or trade open. Use Cancel trade to end it. Walking away, disconnecting, falling or timing out cancels safely without moving any items.</p></div>';
    openPanel(html, 'trading');
    const dialog = doc.getElementById('panel-dialog'); dialog?.classList.add('settlement-dialog'); if (dialog) dialog.scrollTop = scroll;
    for (const element of content()?.querySelectorAll('[data-trade-button]') ?? []) element.onclick = () => { if (!element.disabled) handlers[Number(element.dataset.tradeButton)]?.(); };
    for (const input of content()?.querySelectorAll('[data-trade-input]') ?? []) {
      input.oninput = () => { drafts.set(input.dataset.tradeInput, input.value); refreshButtons(); };
      if (input.dataset.tradeInput === focusId) { input.focus?.({ preventScroll: true }); if (selection?.every(Number.isInteger)) input.setSelectionRange?.(...selection); }
    }
    refreshButtons();
  }
  function update() {
    const trade = tradeNow(), result = getState()?.trading?.result;
    if (trade?.status === 'invited' && trade.inviterId !== getMe()?.id && trade.id !== seenInvite) {
      seenInvite = trade.id;
      toast(`${trade.players.find(p => p.id === trade.inviterId)?.name ?? 'A player'} invited you to trade. Open Player trading in the village menu.`);
    }
    if (result && result.id !== seenResult) { seenResult = result.id; toast(result.message); }
    if (active() && currentSignature() !== signature) render();
  }
  function clear() { signature = ''; draftTradeId = null; ownOfferSignature = ''; seenInvite = null; seenResult = null; drafts.clear(); }
  return { show: render, update, clear };
}
