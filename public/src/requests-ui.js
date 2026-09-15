import { requestAtDestination } from '../../shared/requests.js';
import { BUILDINGS, PLOTS } from '../../shared/world.js';
import { buildingEntrance, plotEntrance, canUseBuilding, canUsePlot } from '../../shared/access.js';
import { NOTICEBOARD_POINT, canReadNoticeboard } from './noticeboard.js';
import { itemArt } from './shop-display.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const title = value => String(value || '').replace(/^./, c => c.toUpperCase());

// The board is a place to read and plan. Deliveries have a separate, local
// counter view so residents can finish a request without carrying the board UI.
export function createRequestsUI({ getState, getMe, getActivePanel, openPanel, closePanel = () => {}, send, markTarget, document: doc = globalThis.document }) {
  let view = null, signature = '', handlers = [], deliveryButtons = new Map();
  const drafts = new Map();
  const content = () => doc.getElementById('panel-content');
  const active = () => view && getActivePanel() === 'requests';
  const standing = () => getState()?.status === 'active' && getMe() && !getMe().downed && !(getMe().hp <= 0) && !getMe().bedPlotId && !getMe().mountedHorseId && !getMe().carriedBy;
  function destination(id) {
    // The saved request ledger retains its 'bank' destination key. Shared
    // supplies now physically arrive at the Resource Exchange counter.
    const service = ['bank', 'barracks'].includes(id) && BUILDINGS.find(b => b.id === (id === 'bank' ? 'market' : id));
    if (service) return { id, name: service.name, point: { ...buildingEntrance(service), id: service.id, name: service.name, kind: 'service' }, allowed: canUseBuilding(getMe(), service) };
    const plot = getState()?.plots?.find(p => p.id === id && p.building === 'cannon' && p.ownerId && p.hp > 0), site = plot && PLOTS.find(p => p.id === id);
    return site ? { id, name: site.name, point: { ...plotEntrance(site, plot), id, name: site.name, kind: 'plot' }, allowed: canUsePlot(getMe(), site, plot) } : null;
  }
  const viewAllowed = () => standing() && (view?.kind === 'board' ? canReadNoticeboard(getMe()) : view?.kind === 'destination' && destination(view.id)?.allowed);
  function markAndClose(point) { view = null; signature = ''; if (point) markTarget({ ...point }); closePanel(); }
  function requireAccess() {
    if (viewAllowed()) return true;
    markAndClose(view?.kind === 'destination' ? destination(view.id)?.point ?? NOTICEBOARD_POINT : NOTICEBOARD_POINT); return false;
  }
  const ready = request => view?.kind === 'destination' && request.destinationId === view.id && standing() && request.status === 'open' &&
    request.expiresDay > (getState()?.day ?? 0) && requestAtDestination(getMe(), request, getState());
  const limit = request => Math.max(0, Math.min(request.remaining, getMe()?.inventory?.[request.resource] || 0));
  const draftAmount = request => Number(drafts.get(request.id) ?? Math.min(limit(request), 10));
  const valid = request => ready(request) && Number.isSafeInteger(draftAmount(request)) && draftAmount(request) > 0 && draftAmount(request) <= limit(request);
  const selectedItems = () => (getState()?.requests?.items ?? []).filter(r => r.status === 'open' && (view?.kind === 'board' || r.destinationId === view?.id));
  const currentSignature = () => JSON.stringify([view, getState()?.requests, getState()?.status, getState()?.day, getMe()?.inventory, standing()]);
  function button(text, handler, disabled = false) {
    const index = handlers.push(handler) - 1;
    return `<button class="secondary-button" type="button" data-request-button="${index}" ${disabled ? 'disabled' : ''}>${esc(text)}</button>`;
  }
  function row(request, index) {
    const board = view.kind === 'board';
    let html = `<section class="${board ? 'request-paper' : 'request-delivery-card'}"><span class="request-pin" aria-hidden="true"></span><div class="request-resource-art">${itemArt(request.resource)}</div><span class="request-wax-seal" aria-hidden="true"><svg viewBox="0 0 60 60"><path d="M30 3 37 7 45 7 49 15 56 20 54 30 57 39 48 45 44 53 35 53 28 58 20 53 11 50 9 42 3 34 7 25 6 17 15 12 21 5Z" fill="#8c382a"/><circle cx="30" cy="30" r="18" fill="none" stroke="#d1875e" stroke-width="2"/><path d="M30 17 40 22 39 35 30 44 21 35 20 22Z" fill="none" stroke="#e3b38b" stroke-width="2"/><path d="m30 24-4 7h5l-2 6 7-9h-6Z" fill="#e3b38b"/></svg></span><p class="request-paper-kicker">${board ? 'By order of the steward' : 'Funded delivery'}</p><strong>${esc(title(request.resource))} → ${esc(request.destinationName)}</strong><p>${esc(request.reason)}</p>` +
      `<div class="settlement-stats"><div><span>Still needed</span><strong>${request.remaining} ${esc(request.resource)}</strong></div><div><span>Payment</span><strong>${request.unitGold} gold each</strong></div><div><span>You carry</span><strong>${getMe()?.inventory?.[request.resource] || 0}</strong></div></div><p>Expires at dawn on day ${request.expiresDay}.</p>`;
    if (view.kind === 'board') return html + button('Mark delivery entrance', () => { if (requireAccess()) markAndClose(request.point); }) + '</section>';
    const maximum = limit(request), amount = drafts.get(request.id) ?? Math.min(maximum, 10);
    html += '<div class="transfer-form">' + `<input id="request-amount-${index}" data-request-input="${index}" type="number" inputmode="numeric" min="1" max="${Math.max(1, maximum)}" value="${esc(amount)}" aria-label="${esc(request.resource)} delivery amount">`;
    deliveryButtons.set(request.id, handlers.length);
    html += button('Deliver supplies', () => {
      if (!requireAccess()) return;
      const current = selectedItems().find(r => r.id === request.id);
      if (!current || !valid(current)) { render(); return; }
      send({ type: 'action', kind: 'request_deliver', requestId: current.id, amount: draftAmount(current) });
    }, !valid(request));
    return html + '</div></section>';
  }
  function updateDeliveryButtons() {
    const buttons = content()?.querySelectorAll('[data-request-button]') ?? [];
    for (const [id, index] of deliveryButtons) { const request = selectedItems().find(r => r.id === id); if (buttons[index]) buttons[index].disabled = !request || !valid(request); }
  }
  function render() {
    if (!getState() || !getMe() || !view || !requireAccess()) return;
    const book = getState().requests || { items: [], reservedGold: 0 }, items = selectedItems(), board = view.kind === 'board';
    const history = board ? book.items.filter(r => r.status !== 'open').slice(-4).reverse() : [];
    handlers = []; deliveryButtons = new Map(); signature = currentSignature();
    const scroll = doc.getElementById('panel-dialog')?.scrollTop || 0;
    const html = '<div class="settlement-panel ' + (board ? 'request-board-view' : 'request-counter-view') + '"><p class="eyebrow">' + (board ? 'VILLAGE REQUEST BOARD' : 'REQUESTED DELIVERIES') + '</p><h2>' + (board ? 'Supplies for the next watch.' : esc(destination(view.id).name)) + '</h2>' +
      (board ? '<p>The steward posts deliveries when village food, repairs, or defenses need supplies. Anyone can help. Mark a delivery entrance, close the board, and bring your supplies there.</p>' + `<p><strong>${book.reservedGold} gold reserved</strong> for open requests. At the destination, press E and choose “Requested deliveries” to receive the posted payment.</p>` : '<p>You are at this delivery entrance. These requests belong to this destination only. Payment comes from the funds reserved by the steward; loan repayments apply to earnings.</p>') +
      (items.length ? `<div class="${board ? 'request-papers' : 'request-delivery-list'}">${items.map(row).join('')}</div>` : `<p>${board ? 'No funded deliveries are needed right now. The steward checks shortages during the day while protecting essential funds.' : 'No funded deliveries are open for this destination. Check the village request board for other needs.'}</p>`) +
      '<p>Ordinary sales and donations still work. They can fill a shortage and close its request; use “Deliver supplies” at the requested destination to receive the posted payment. Removing stored supplies does not create a rewarded shortage.</p>' +
      (history.length ? '<h3>Recent requests</h3>' + history.map(r => `<div class="settlement-row"><div><strong>${esc(title(r.resource))} · ${esc(r.destinationName)}</strong><small>${esc(title(r.status))} · ${r.delivered} delivered · ${esc(r.reason)}</small></div></div>`).join('') : '') + '</div>';
    openPanel(html, 'requests');
    const dialog = doc.getElementById('panel-dialog'); dialog?.classList.add('settlement-dialog'); if (dialog) dialog.scrollTop = scroll;
    for (const b of content().querySelectorAll('[data-request-button]')) b.onclick = () => { if (!b.disabled) handlers[Number(b.dataset.requestButton)]?.(); };
    for (const input of content().querySelectorAll('[data-request-input]')) input.oninput = () => {
      const request = items[Number(input.dataset.requestInput)]; if (request) drafts.set(request.id, input.value); updateDeliveryButtons();
    };
  }
  function update() {
    if (!active() || !getState() || !getMe() || !requireAccess()) return;
    updateDeliveryButtons();
    // Retain the focused input as well as its draft while snapshots arrive.
    // Controls still revalidate shortages and inventory immediately above.
    if (doc.activeElement?.tagName === 'INPUT' && content()?.contains?.(doc.activeElement)) return;
    if (currentSignature() !== signature) render();
  }
  function show() { view = { kind: 'board' }; signature = ''; render(); }
  function showDestination(id) { view = { kind: 'destination', id }; signature = ''; render(); }
  function findBoard() { if (standing() && canReadNoticeboard(getMe())) show(); else markAndClose(NOTICEBOARD_POINT); }
  function clear() { view = null; signature = ''; drafts.clear(); }
  return { show, showDestination, findBoard, update, clear };
}
