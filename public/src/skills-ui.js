import { ROLE_SKILLS, SKILLS, ACADEMY_COMMISSION, skillLevel } from '../../shared/skills.js';
import { PLOTS } from '../../shared/world.js';
import { canUsePlot, plotEntrance } from '../../shared/access.js';
import { carryCapacity, inventoryWeight, TOOL_WEIGHTS } from '../../shared/content.js';
import { ownsStaff } from '../../shared/equipment.js';
import { MAGIC } from '../../shared/magic.js';
import { icon } from './icons.js';
import { capturePanelDetails, restorePanelDetails } from './panel-refresh.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const title = value => String(value ?? '').replace(/^./, char => char.toUpperCase());
export function academyModel(state, player, plotId, previewRole = player?.role) {
  const academy = state?.academy ?? {}, learner = { ...player, skills: academy.skills ?? player?.skills ?? {} };
  const plot = state?.plots?.find(item => item.id === plotId), site = PLOTS.find(item => item.id === plotId);
  const residents = Object.values(state?.players ?? {});
  const operational = plot?.building === 'arcane_academy' && plot.hp > 0 && !plot.ruined && !plot.rebuilding && residents.some(resident => resident.id === plot.ownerId);
  const nearby = operational && canUsePlot(player, site, plot);
  const standing = player?.online !== false && !player?.downed && !player?.carriedBy && !player?.bedPlotId && !player?.mountedHorseId && player?.hp > 0;
  const staffOwned = ownsStaff(player), staffRoom = inventoryWeight(player) + (staffOwned ? 0 : TOOL_WEIGHTS.staff) <= carryCapacity(player) + 1e-6;
  const element = academy.staffElement ?? player?.staffElement ?? 'fire', spell = MAGIC[element] ?? MAGIC.fire;
  const reclaimReason = player?.role !== 'wizard' ? 'Only wizards can reclaim a staff.' : staffOwned ? 'Your staff is already in your pack.' : state?.status !== 'active' ? 'Reclaim your staff in an active village.' : !operational ? 'A working Arcane Academy is needed.' : !nearby ? 'Visit the academy entrance to reclaim your staff.' : !standing ? 'Stand at the academy entrance while alive, unmounted and free to act.' : !staffRoom ? `Make room for ${TOOL_WEIGHTS.staff} weight in your pack.` : '';
  return { plot, nearby, operational, role: previewRole, mana: Math.floor(academy.mana ?? player?.mana ?? 0), manaMax: academy.manaMax ?? player?.manaMax ?? 100, element, elements: academy.stats?.staffElements ?? [],
    staffOwned, staffRoom, canReclaimStaff: !reclaimReason, reclaimReason, spellMana: spell.mana, spellCooldown: spell.cooldown,
    skills: (ROLE_SKILLS[previewRole] ?? []).map(skill => {
      const rank = skillLevel(learner, skill.id), price = rank < skill.maxRank ? skill.prices[rank] + ACADEMY_COMMISSION : null;
      const prerequisite = skill.requires && !skillLevel(learner, skill.requires) ? SKILLS[skill.requires].name : null;
      return { ...skill, rank, price, prerequisite, available: Boolean(nearby && standing && previewRole === player?.role && !prerequisite && price !== null && player.wallet >= price) };
    }) };
}

export function createSkillsUI({ getState, getMe, getActivePanel, openPanel, send, markWaypoint = () => {}, document: doc = globalThis.document, schedule = fn => setTimeout(fn, 0), cancel = id => clearTimeout(id) }) {
  let selectedPlotId = null, previewRole = null, signature = '', pressed = false, releaseTimer = null;
  const content = () => doc.getElementById('panel-content');
  const model = () => academyModel(getState(), getMe(), selectedPlotId, previewRole ?? getMe()?.role);
  const locations = () => (getState()?.plots ?? []).filter(plot => plot.building === 'arcane_academy').map(plot => ({ id: plot.id, name: plot.name, ownerName: plot.ownerName, usable: plot.hp > 0 && !plot.ruined && !plot.rebuilding }));
  function snapshot(m = model()) { const { plot, ...display } = m; return JSON.stringify([display, plot?.id, plot?.ownerName, getMe()?.wallet, getMe()?.role, locations()]); }
  function release() { cancel(releaseTimer); releaseTimer = null; pressed = false; update(); }
  function hold(node) {
    node.onpointerdown = event => { if ((event?.button ?? 0) === 0 && !node.disabled) { cancel(releaseTimer); releaseTimer = null; pressed = true; } };
    node.onpointerup = node.onpointerleave = () => { cancel(releaseTimer); releaseTimer = schedule(release); };
    node.onpointercancel = node.onblur = release;
    node.onkeydown = event => { if ([' ', 'Enter'].includes(event.key) && !node.disabled) { cancel(releaseTimer); releaseTimer = null; pressed = true; } };
    node.onkeyup = event => { if ([' ', 'Enter'].includes(event.key)) { cancel(releaseTimer); releaseTimer = schedule(release); } };
  }
  function render() {
    const state = getState(), player = getMe(); if (!state || !player) return;
    const saved = getActivePanel() === 'academy' ? capturePanelDetails(content()) : null;
    const m = model();
    const skillButtons = m.skills.map(skill => `<article class="academy-skill-card"><header><span class="academy-skill-art" aria-hidden="true">${icon(skill.role)}</span><div><small>Rank ${skill.rank} / ${skill.maxRank}</small><h3>${esc(skill.name)}</h3></div></header><p>${esc(skill.description)}</p>${skill.prerequisite ? `<p class="academy-prerequisite">Requires ${esc(skill.prerequisite)} rank 1.</p>` : ''}${skill.price === null ? '<strong class="academy-learned">✓ Fully learned</strong>' : `<button class="academy-learn" data-academy-learn="${skill.id}" data-rank="${skill.rank + 1}" ${skill.available ? '' : 'disabled'}>Learn rank ${skill.rank + 1} · ${skill.price}g</button>`}<details class="refinement-details" data-persist="academy-ranks-${skill.id}"><summary>Rank prices</summary><div class="academy-ranks">${skill.prices.map((price, index) => `<span class="status-pill" aria-label="Rank ${index + 1}${index < skill.rank ? ' learned' : ''}">${index < skill.rank ? '✓' : index + 1} · ${price + ACADEMY_COMMISSION}g</span>`).join(' → ')}</div></details></article>`).join('');
    const places = locations().map(plot => `<button data-academy-place="${esc(plot.id)}" aria-pressed="${selectedPlotId === plot.id}">${esc(plot.name ?? plot.id)} · ${esc(plot.ownerName ?? 'Academy')} ${plot.usable ? '' : '(unavailable)'}</button>`).join('');
    const attunements = player.role === 'wizard' ? `<section class="academy-staff"><header><span class="academy-skill-art" aria-hidden="true">${icon('wizard')}</span><div><h3>Your staff</h3><p>${m.mana} / ${m.manaMax} mana · ${esc(title(m.element))}</p></div><span class="academy-cast-cost">${m.spellMana} mana / cast</span></header><p>${m.staffOwned ? 'Unbreakable · Mana powered. Your staff is in your pack.' : 'Your staff is missing. Reclaim it here for free.'}</p>${m.staffOwned ? '' : `<button data-academy-reclaim ${m.canReclaimStaff ? '' : 'disabled'}>Reclaim staff · Free</button>${m.reclaimReason ? `<p class="refinement-note">${esc(m.reclaimReason)}</p>` : ''}`}<div class="academy-elements" aria-label="Staff element">${m.elements.map(element => `<button data-academy-element="${element}" aria-pressed="${element === m.element}" ${element === m.element ? 'disabled' : ''}>${esc(title(element))}</button>`).join('')}</div><details class="refinement-details" data-persist="academy-staff-help"><summary>Mana & staff recovery</summary><p>Each cast costs ${m.spellMana} mana with a ${m.spellCooldown} second cooldown. Cast again when the cooldown ends and you have enough mana for that spell. Mana recovers while you are alive and active.</p><p>Reclaiming a staff keeps your current mana, cooldown and learned skills.</p></details></section>` : '';
    openPanel(`<div class="academy-menu academy-compact"><header class="refinement-heading"><p class="eyebrow">THE ARCANE ACADEMY</p><h2>Learn new skills</h2><p>Upgrade your role. Every listed price includes the ${ACADEMY_COMMISSION}g academy commission.</p><strong class="academy-wallet">Wallet ${Math.floor(player.wallet ?? 0).toLocaleString()}g</strong></header>${m.nearby ? `<p class="refinement-note">Learning at ${esc(m.plot.ownerName ?? 'your village')}'s academy.</p>` : `<div class="refinement-notice"><span>${m.operational ? 'Visit this academy’s entrance to purchase a lesson.' : 'A working Arcane Academy is needed to learn skills.'}</span>${m.operational ? '<button data-academy-mark>Mark academy entrance</button>' : ''}</div>`}<details class="refinement-details" data-persist="academy-locations"><summary>Academy locations <span>${locations().length}</span></summary><div class="panel-actions">${places || '<p>No academy has been built yet.</p>'}</div></details>${attunements}<nav class="academy-role-tabs" aria-label="Role skill trees">${Object.keys(ROLE_SKILLS).map(role => `<button data-academy-role="${role}" aria-pressed="${m.role === role}" ${m.role === role ? 'disabled' : ''}>${title(role)}${player.role === role ? ' · you' : ''}</button>`).join('')}</nav>${m.role !== player.role ? '<p class="refinement-note">Preview only. Change roles to learn and use these skills.</p>' : ''}<div class="academy-skill-grid">${skillButtons}</div><details class="refinement-details" data-persist="academy-rules"><summary>How lessons work</summary><p>Lessons remain learned throughout this village run, including after a role change, respawn or academy destruction. Only your current role’s skills are active.</p><p>Skill ranks must be learned in order. Branches show their prerequisites. Lessons spend wallet gold; the academy owner earns the fixed commission and the village treasury receives the lesson fee.</p></details></div>`, 'academy');
    restorePanelDetails(content(), saved);
    for (const node of content()?.querySelectorAll('[data-academy-learn]') ?? []) node.onclick = () => { const live = model().skills.find(skill => skill.id === node.dataset.academyLearn); if (live?.available) send({ type: 'action', kind: 'academy_learn', plotId: selectedPlotId, skill: live.id, rank: live.rank + 1 }); };
    for (const node of content()?.querySelectorAll('[data-academy-role]') ?? []) node.onclick = () => { previewRole = node.dataset.academyRole; render(); };
    for (const node of content()?.querySelectorAll('[data-academy-place]') ?? []) node.onclick = () => { selectedPlotId = node.dataset.academyPlace; render(); };
    for (const node of content()?.querySelectorAll('[data-academy-element]') ?? []) node.onclick = () => send({ type: 'action', kind: 'staff_element', element: node.dataset.academyElement });
    const reclaim = content()?.querySelector('[data-academy-reclaim]');
    if (reclaim) reclaim.onclick = () => { if (model().canReclaimStaff) send({ type: 'action', kind: 'academy_reclaim_staff', plotId: selectedPlotId }); };
    const marker = content()?.querySelector('[data-academy-mark]');
    if (marker) marker.onclick = () => { const current = model(), entrance = plotEntrance(PLOTS.find(site => site.id === selectedPlotId), current.plot); if (entrance) markWaypoint({ ...entrance, label: 'Arcane Academy', kind: 'plot', id: selectedPlotId }); };
    for (const node of content()?.querySelectorAll('button') ?? []) {
      hold(node); const action = node.onclick;
      node.onclick = () => { try { if (!node.disabled) action?.(); } finally { release(); } };
    }
    for (const summary of content()?.querySelectorAll('summary') ?? []) if (summary.tagName === 'SUMMARY') hold(summary);
    signature = snapshot(m);
  }
  function update() {
    if (getActivePanel() !== 'academy' || pressed || releaseTimer !== null) return;
    if (getMe() && snapshot() !== signature) render();
  }
  return {
    show(plotId = null) { selectedPlotId = plotId ?? getState()?.plots?.find(plot => plot.building === 'arcane_academy' && plot.hp > 0)?.id ?? null; previewRole = getMe()?.role; render(); },
    update, render,
    clear() { cancel(releaseTimer); releaseTimer = null; selectedPlotId = null; previewRole = null; signature = ''; pressed = false; }
  };
}
