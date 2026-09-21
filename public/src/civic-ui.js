import { CIVIC_BOARD, CIVIC_PROJECTS, CIVIC_DEPOT_ITEMS } from '../../shared/civic.js';
import { transferableCount } from '../../shared/content.js';
import { itemArt } from './shop-display.js';
import { capturePanelDetails, restorePanelDetails } from './panel-refresh.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const resourceName = id => id === 'timber' ? 'Wood' : id.replace(/^./, c => c.toUpperCase());
const projectArt = { reinforcement: 'stone', repair_crew: 'hammer', ballista: 'bow', trebuchet: 'stone' };
export function createCivicUI({ getState, getMe, getActivePanel, openPanel, send, markWaypoint, document: doc = globalThis.document, schedule = (fn, ms) => setTimeout(fn, ms), cancel = id => clearTimeout(id) }) {
  let signature = '', pressed = null, releaseTimer = null;
  const host = () => doc.getElementById('panel-content');
  function model() {
    const state = getState(), player = getMe(); if (!state || !player) return null;
    const raw = state.civic ?? {};
    const works = { active: raw.active ?? null, completed: raw.completed ?? [], progress: raw.progress ?? {}, depot: raw.depot ?? {}, contributors: raw.contributors ?? {}, masonStatus: raw.mason?.status };
    const near = player.online !== false && !player.downed && !player.mountedHorseId && !player.bedPlotId && Math.hypot(player.x - CIVIC_BOARD.x, player.z - CIVIC_BOARD.z) <= 4;
    const carried = Object.fromEntries([...new Set([...CIVIC_DEPOT_ITEMS, ...Object.values(CIVIC_PROJECTS).flatMap(p => Object.keys(p.cost))])].map(resource => [resource, resource === 'gold' ? Math.max(0, player.wallet ?? 0) : transferableCount(player, resource)]));
    // Only nearby owned freight can change a visible action. Moving unrelated carts
    // or the mason's ticking wage timer must not replace a donation button.
    const carts = near ? (state.carts ?? []).filter(c => c.ownerId === player.id && Math.hypot(c.x - CIVIC_BOARD.x, c.z - CIVIC_BOARD.z) <= 8 && Math.hypot(c.x - player.x, c.z - player.z) <= 5).map(c => ({ id: c.id, storage: c.storage })) : [];
    return { works, near, carried, carts };
  }
  function release() { cancel(releaseTimer); releaseTimer = null; pressed = null; refresh(); }
  function hold(button) {
    button.onpointerdown = event => { if (event.button === 0 && !button.disabled) { cancel(releaseTimer); releaseTimer = null; pressed = button; } };
    button.onpointerup = button.onpointerleave = () => { cancel(releaseTimer); releaseTimer = schedule(release, 0); };
    button.onpointercancel = release; button.onblur = release;
    button.onkeydown = event => { if ([' ', 'Enter'].includes(event.key) && !button.disabled) { cancel(releaseTimer); releaseTimer = null; pressed = button; } };
    button.onkeyup = event => { if ([' ', 'Enter'].includes(event.key)) { cancel(releaseTimer); releaseTimer = schedule(release, 0); } };
  }
  function bind(button, handler) { hold(button); button.onclick = () => { try { if (!button.disabled) handler(); } finally { release(); } }; }
  function show() {
    const m = model(); if (!m) return;
    const { works, near, carried, carts } = m;
    const saved = getActivePanel() === 'civic' ? capturePanelDetails(host()) : null;
    function projectCard(id) {
      const project = CIVIC_PROJECTS[id], done = works.completed.includes(id), active = works.active === id;
      const contribution = resource => done ? project.cost[resource] : active ? works.progress[resource] ?? 0 : 0;
      const percent = Math.min(100, Math.round(Object.keys(project.cost).reduce((sum, resource) => sum + Math.min(1, contribution(resource) / project.cost[resource]), 0) / Object.keys(project.cost).length * 100));
      let html = `<article class="civic-project${active ? ' is-active' : ''}${done ? ' is-complete' : ''}"><header><div class="refinement-art" aria-hidden="true">${itemArt(projectArt[id])}</div><div><small>${done ? 'Completed' : active ? 'Village is building' : 'Available project'}</small><h3>${esc(project.name)}</h3></div>${active ? `<strong>${percent}%</strong>` : ''}</header><p>${esc(project.description)}</p>`;
      if (active) html += `<div class="civic-progress" role="progressbar" aria-label="${esc(project.name)} contributions" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><i style="width:${percent}%"></i></div>`;
      html += '<div class="civic-costs">';
      for (const [resource, goal] of Object.entries(project.cost)) {
        const donated = contribution(resource), amount = Math.max(0, Math.min(carried[resource], goal - donated));
        html += `<div class="civic-cost"><span class="resource-symbol" aria-hidden="true">${itemArt(resource)}</span><span><small>${resourceName(resource)}</small><strong>${active || done ? `${donated.toLocaleString()} / ` : ''}${goal.toLocaleString()}</strong></span>${active && near && donated < goal ? `<button data-donate="${resource}" data-amount="${amount}"${amount > 0 ? '' : ' disabled'}>Donate ${amount.toLocaleString()} carried ${esc(resource)}</button>` : ''}</div>`;
      }
      html += '</div>';
      if (active && near) for (const cart of carts) for (const resource of Object.keys(project.cost)) { const amount = Math.min(cart.storage?.[resource] ?? 0, project.cost[resource] - (works.progress[resource] ?? 0)); if (amount > 0 && resource !== 'gold') html += `<button class="civic-freight" data-freight="${resource}" data-amount="${amount}" data-cart="${esc(cart.id)}">Deliver ${amount.toLocaleString()} cart ${esc(resource)}</button>`; }
      if (!done && !works.active) {
        const locked = project.requires && !works.completed.includes(project.requires);
        html += `${locked ? `<small class="refinement-note">Requires ${esc(CIVIC_PROJECTS[project.requires].name)}.</small>` : ''}<button class="civic-start" data-select="${id}" ${!near || locked ? 'disabled' : ''}>Start project</button>`;
      }
      return html + '</article>';
    }
    let html = '<div class="settlement-panel civic-menu"><header class="refinement-heading"><p class="eyebrow">VILLAGE WORKS</p><h2>Build together</h2><p>Contribute supplies to permanent improvements for this village.</p></header>';
    if (!near) html += '<div class="refinement-notice"><span>Visit the works board beside the Treasury to donate.</span><button data-mark>Mark works board</button></div>';
    if (CIVIC_PROJECTS[works.active] && !works.completed.includes(works.active)) html += projectCard(works.active);
    const upcoming = Object.keys(CIVIC_PROJECTS).filter(id => id !== works.active && !works.completed.includes(id));
    if (upcoming.length) html += `<div class="civic-project-grid">${upcoming.map(projectCard).join('')}</div>`;
    const completed = works.completed.filter(id => CIVIC_PROJECTS[id]);
    if (completed.length) html += `<details class="refinement-details" data-persist="civic-completed"><summary>Completed projects <span>${completed.length}</span></summary><div class="civic-project-grid">${completed.map(projectCard).join('')}</div></details>`;
    html += '<section class="civic-depot"><h3>Maintenance & ammunition</h3><p>Supply the mason and completed wall weapons.</p><div class="civic-depot-grid">';
    for (const resource of CIVIC_DEPOT_ITEMS) {
      const room = 10000000 - (works.depot[resource] ?? 0), amount = Math.max(0, Math.min(carried[resource], room));
      html += `<article class="civic-depot-item"><div class="refinement-art" aria-hidden="true">${itemArt(resource)}</div><h4>${resourceName(resource)}</h4><strong>${(works.depot[resource] ?? 0).toLocaleString()}</strong>${near ? `<button data-supply="${resource}" data-amount="${amount}"${amount > 0 ? '' : ' disabled'}>Donate ${amount.toLocaleString()} carried ${esc(resource)}</button>` : ''}`;
      if (near && resource !== 'gold') for (const cart of carts) { const freight = Math.min(cart.storage?.[resource] ?? 0, room); if (freight > 0) html += `<button data-supply="${resource}" data-amount="${freight}" data-cart="${esc(cart.id)}">Deliver ${freight.toLocaleString()} cart ${esc(resource)} to depot</button>`; }
      html += '</article>';
    }
    html += '</div>' + (works.completed.includes('repair_crew') ? `<p class="refinement-note">Mason: ${esc(works.masonStatus)}</p>` : '') + '</section>';
    const contributors = Object.values(works.contributors);
    html += `<details class="refinement-details" data-persist="civic-contributors"><summary>Village contributors <span>${contributors.length}</span></summary>${contributors.map(c => `<p><strong>${esc(c.name)}</strong> · ${Object.entries(c.resources).map(([id, amount]) => `${amount.toLocaleString()} ${esc(id)}`).join(' · ')}</p>`).join('') || '<p>Your village’s first contribution starts here.</p>'}</details><details class="refinement-details" data-persist="civic-rules"><summary>How contributions work</summary><p>Contributions are committed to the selected project. No resident owns these improvements; everyone benefits. The maintenance depot is separate from construction contributions.</p></details></div>`;
    signature = JSON.stringify(m);
    openPanel(html, 'civic'); restorePanelDetails(host(), saved);
    const mark = host().querySelector('[data-mark]'); if (mark) bind(mark, () => markWaypoint(CIVIC_BOARD));
    for (const button of host().querySelectorAll('[data-select]')) bind(button, () => send({ type: 'action', kind: 'civic_select', projectId: button.dataset.select }));
    for (const button of host().querySelectorAll('[data-donate],[data-freight],[data-supply]')) bind(button, () => send({ type: 'action', kind: button.dataset.supply ? 'civic_supply' : 'civic_donate', resource: button.dataset.supply ?? button.dataset.donate ?? button.dataset.freight, amount: Number(button.dataset.amount), ...(button.dataset.cart ? { cartId: button.dataset.cart } : {}) }));
    for (const summary of host().querySelectorAll('summary')) if (summary.tagName === 'SUMMARY') hold(summary);
  }
  function refresh() {
    if (getActivePanel() !== 'civic' || pressed || releaseTimer !== null) return;
    const next = model(); if (next && signature !== JSON.stringify(next)) show();
  }
  return { show, refresh };
}
