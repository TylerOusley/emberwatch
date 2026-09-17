import { CIVIC_BOARD, CIVIC_PROJECTS, CIVIC_DEPOT_ITEMS } from '../../shared/civic.js';
import { transferableCount } from '../../shared/content.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function createCivicUI({ getState, getMe, getActivePanel, openPanel, send, markWaypoint, document: doc = globalThis.document, schedule = (fn, ms) => setTimeout(fn, ms), cancel = id => clearTimeout(id) }) {
  let signature = '', pressed = null, releaseTimer = null;
  function release() { cancel(releaseTimer); releaseTimer = null; pressed = null; refresh(); }
  function bind(button, handler) {
    button.onpointerdown = event => { if (event.button === 0 && !button.disabled) pressed = button; };
    button.onpointerup = () => { cancel(releaseTimer); releaseTimer = schedule(release, 0); };
    button.onpointerleave = () => { cancel(releaseTimer); releaseTimer = schedule(release, 0); };
    button.onpointercancel = release; button.onblur = release;
    button.onkeydown = event => { if ([' ', 'Enter'].includes(event.key) && !button.disabled) pressed = button; };
    button.onkeyup = event => { if ([' ', 'Enter'].includes(event.key)) { cancel(releaseTimer); releaseTimer = schedule(release, 0); } };
    button.onclick = () => { try { if (!button.disabled) handler(); } finally { release(); } };
  }
  function show() {
    const state = getState(), player = getMe(); if (!state || !player) return;
    const works = state.civic ?? { completed: [], depot: {}, contributors: {} };
    const near = player.online !== false && !player.downed && !player.mountedHorseId && !player.bedPlotId && Math.hypot(player.x - CIVIC_BOARD.x, player.z - CIVIC_BOARD.z) <= 4;
    const carried = resource => resource === 'gold' ? Math.max(0, player.wallet ?? 0) : transferableCount(player, resource);
    const ownCarts = state.carts?.filter(c => c.ownerId === player.id && Math.hypot(c.x - CIVIC_BOARD.x, c.z - CIVIC_BOARD.z) <= 8 && Math.hypot(c.x - player.x, c.z - player.z) <= 5) ?? [];
    let html = '<div class="settlement-panel"><p class="eyebrow">VILLAGE WORKS</p><h2>Build something together.</h2><p>Everyone can contribute. Completed projects benefit the whole village. Contributions are committed to the selected project; no resident owns these improvements.</p>';
    if (!near) html += '<p>Visit the works board beside the Treasury to donate.</p><button data-mark>Mark works board</button>';
    for (const [id, project] of Object.entries(CIVIC_PROJECTS)) {
      const done = works.completed.includes(id), active = works.active === id;
      html += `<section class="menu-section"><div class="menu-section-content"><h3>${esc(project.name)}${done ? ' · Complete' : active ? ' · In progress' : ''}</h3><p>${esc(project.description)}</p>`;
      for (const [resource, goal] of Object.entries(project.cost)) {
        const donated = done ? goal : active ? works.progress[resource] ?? 0 : 0;
        const amount = Math.min(carried(resource), goal - donated);
        html += `<div class="settlement-row"><span>${esc(resource)}: ${donated.toLocaleString()} / ${goal.toLocaleString()}</span>${active && near && donated < goal ? `<button data-donate="${resource}" data-amount="${amount}"${amount > 0 ? '' : ' disabled'}>Donate ${amount.toLocaleString()} carried ${esc(resource)}</button>` : ''}</div>`;
      }
      if (active && near) for (const cart of ownCarts) for (const resource of Object.keys(project.cost)) { const amount = Math.min(cart.storage?.[resource] ?? 0, project.cost[resource] - (works.progress[resource] ?? 0)); if (amount > 0 && resource !== 'gold') html += `<button data-freight="${resource}" data-amount="${amount}" data-cart="${esc(cart.id)}">Deliver ${amount.toLocaleString()} cart ${esc(resource)}</button>`; }
      if (!done && !works.active) html += `<button data-select="${id}" ${!near || project.requires && !works.completed.includes(project.requires) ? 'disabled' : ''}>Start project${project.requires && !works.completed.includes(project.requires) ? ' · prerequisite needed' : ''}</button>`;
      html += '</div></section>';
    }
    html += '<h3>Maintenance & ammunition depot</h3><p>Supplies here fund the mason and completed wall weapons. Project construction uses its own contribution totals above.</p>';
    for (const resource of CIVIC_DEPOT_ITEMS) {
      const room = 10000000 - (works.depot[resource] ?? 0), amount = Math.min(carried(resource), room);
      html += `<div class="settlement-row"><span>${esc(resource)}: ${(works.depot[resource] ?? 0).toLocaleString()}</span>${near ? `<button data-supply="${resource}" data-amount="${amount}"${amount > 0 ? '' : ' disabled'}>Donate ${amount.toLocaleString()} carried ${esc(resource)}</button>` : ''}</div>`;
      if (near && resource !== 'gold') for (const cart of ownCarts) { const freight = Math.min(cart.storage?.[resource] ?? 0, room); if (freight > 0) html += `<button data-supply="${resource}" data-amount="${freight}" data-cart="${esc(cart.id)}">Deliver ${freight.toLocaleString()} cart ${esc(resource)} to depot</button>`; }
    }
    if (works.completed.includes('repair_crew')) html += `<p>Mason: ${esc(works.mason?.status)}</p>`;
    html += '<h3>Village contributors</h3>' + Object.values(works.contributors).map(c => `<p><strong>${esc(c.name)}</strong> · ${Object.entries(c.resources).map(([id, amount]) => `${amount.toLocaleString()} ${esc(id)}`).join(' · ')}</p>`).join('') + '</div>';
    signature = JSON.stringify([works, near, player.inventory, player.wallet, state.carts]);
    openPanel(html, 'civic');
    const host = doc.getElementById('panel-content');
    const mark = host.querySelector('[data-mark]'); if (mark) bind(mark, () => markWaypoint(CIVIC_BOARD));
    for (const button of host.querySelectorAll('[data-select]')) bind(button, () => send({ type: 'action', kind: 'civic_select', projectId: button.dataset.select }));
    for (const button of host.querySelectorAll('[data-donate],[data-freight],[data-supply]')) bind(button, () => send({ type: 'action', kind: button.dataset.supply ? 'civic_supply' : 'civic_donate', resource: button.dataset.supply ?? button.dataset.donate ?? button.dataset.freight, amount: Number(button.dataset.amount), ...(button.dataset.cart ? { cartId: button.dataset.cart } : {}) }));
  }
  function refresh() {
    if (getActivePanel() !== 'civic' || pressed) return;
    const state = getState(), player = getMe(); if (!state || !player) return;
    const near = player.online !== false && !player.downed && !player.mountedHorseId && !player.bedPlotId && Math.hypot(player.x - CIVIC_BOARD.x, player.z - CIVIC_BOARD.z) <= 4;
    if (signature !== JSON.stringify([state.civic, near, player.inventory, player.wallet, state.carts])) show();
  }
  return { show, refresh };
}
