import { requestAtDestination } from '../../shared/requests.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const title = value => String(value || '').replace(/^./, c => c.toUpperCase());

/** Remote reading is allowed; every actual delivery still requires its doorway. */
export function createRequestsUI({ getState, getMe, getActivePanel, openPanel, send, markTarget, document: doc = globalThis.document }) {
  let visible = false, signature = '', handlers = [];
  const drafts = new Map();
  const content = () => doc.getElementById('panel-content');
  const active = () => visible && getActivePanel() === 'requests';
  const ready = request => {
    const p = getMe(), s = getState();
    return s?.status === 'active' && p && !p.downed && !p.bedPlotId && !p.mountedHorseId && requestAtDestination(p, request, s);
  };
  const limit = request => Math.max(0, Math.min(request.remaining, getMe()?.inventory?.[request.resource] || 0));
  const draftAmount = request => Number(drafts.get(request.id) ?? Math.min(limit(request), 10));
  const valid = request => ready(request) && Number.isSafeInteger(draftAmount(request)) && draftAmount(request) > 0 && draftAmount(request) <= limit(request);
  function button(text, handler, disabled = false) {
    const index = handlers.push(handler) - 1;
    return `<button class="secondary-button" type="button" data-request-button="${index}" ${disabled ? 'disabled' : ''}>${esc(text)}</button>`;
  }
  function row(request, index) {
    const atDoor = ready(request), maximum = limit(request), amount = drafts.get(request.id) ?? Math.min(maximum, 10);
    return `<section class="building-card"><strong>${esc(title(request.resource))} → ${esc(request.destinationName)}</strong>` +
      `<p>${esc(request.reason)}</p><div class="settlement-stats"><div><span>Still needed</span><strong>${request.remaining} ${esc(request.resource)}</strong></div><div><span>Payment</span><strong>${request.unitGold} gold each</strong></div><div><span>You carry</span><strong>${getMe()?.inventory?.[request.resource] || 0}</strong></div></div>` +
      `<p>Expires at dawn on day ${request.expiresDay}. ${atDoor ? 'You are at the delivery entrance.' : 'Bring your supplies to the marked entrance to deliver.'}</p>` +
      '<div class="transfer-form">' + `<input id="request-amount-${index}" data-request-input="${index}" type="number" inputmode="numeric" min="1" max="${Math.max(1, maximum)}" value="${esc(amount)}" aria-label="${esc(request.resource)} delivery amount">` +
      button('Deliver supplies', () => {
        // Recheck a moving player and newer state at the moment of clicking.
        const current = getState()?.requests?.items?.find(r => r.id === request.id && r.status === 'open');
        if (!current || !valid(current)) { render(); return; }
        send({ type: 'action', kind: 'request_deliver', requestId: current.id, amount: draftAmount(current) });
      }, !valid(request)) + button('Mark entrance', () => markTarget({ ...request.point })) + '</div></section>';
  }
  function render() {
    const s = getState(), p = getMe(); if (!s || !p) return;
    const book = s.requests || { items: [], reservedGold: 0 }, items = book.items.filter(r => r.status === 'open');
    const history = book.items.filter(r => r.status !== 'open').slice(-4).reverse();
    handlers = [];
    const scroll = doc.getElementById('panel-dialog')?.scrollTop || 0;
    const html = '<div class="settlement-panel"><p class="eyebrow">VILLAGE NOTICEBOARD</p><h2>Supplies for the next watch.</h2>' +
      '<p>The steward posts deliveries when village food, repairs, or defenses need supplies. Anyone can help. Payment is reserved when a request opens; loan repayments apply to earnings.</p>' +
      `<p><strong>${book.reservedGold} gold reserved</strong> for open requests. Read the board from anywhere, then deliver at the destination entrance.</p>` +
      (items.length ? items.map(row).join('') : '<p>No funded deliveries are needed right now. The steward checks shortages during the day while protecting essential funds.</p>') +
      '<p>Ordinary sales and donations still work. They can fill a shortage and close its request; use “Deliver supplies” here to receive the posted payment. Removing stored supplies does not create a rewarded shortage.</p>' +
      (history.length ? '<h3>Recent requests</h3>' + history.map(r => `<div class="settlement-row"><div><strong>${esc(title(r.resource))} · ${esc(r.destinationName)}</strong><small>${esc(title(r.status))} · ${r.delivered} delivered · ${esc(r.reason)}</small></div></div>`).join('') : '') + '</div>';
    openPanel(html, 'requests');
    const dialog = doc.getElementById('panel-dialog');
    dialog?.classList.add('settlement-dialog'); if (dialog) dialog.scrollTop = scroll;
    for (const b of content().querySelectorAll('[data-request-button]')) b.onclick = () => { if (!b.disabled) handlers[Number(b.dataset.requestButton)]?.(); };
    for (const input of content().querySelectorAll('[data-request-input]')) input.oninput = () => {
      const request = items[Number(input.dataset.requestInput)]; drafts.set(request.id, input.value);
      const button = content().querySelectorAll('[data-request-button]')[Number(input.dataset.requestInput) * 2];
      if (button) button.disabled = !valid(request);
    };
  }
  function update() {
    if (!active() || !getState() || !getMe()) return;
    const next = JSON.stringify([getState().requests, getState().status, getMe().inventory,
      (getState().requests?.items || []).filter(r => r.status === 'open').map(r => ready(r))]);
    if (next !== signature) { signature = next; render(); }
  }
  function show() { visible = true; signature = ''; render(); }
  function clear() { visible = false; signature = ''; drafts.clear(); }
  return { show, update, clear };
}
