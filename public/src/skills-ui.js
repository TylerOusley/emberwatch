import { ROLE_SKILLS, SKILLS, ACADEMY_COMMISSION, skillLevel } from '../../shared/skills.js';
import { PLOTS } from '../../shared/world.js';
import { canUsePlot, plotEntrance } from '../../shared/access.js';
import { carryCapacity, inventoryWeight, TOOL_WEIGHTS } from '../../shared/content.js';
import { ownsStaff } from '../../shared/equipment.js';
import { MAGIC } from '../../shared/magic.js';

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

export function createSkillsUI({ getState, getMe, getActivePanel, openPanel, send, markWaypoint = () => {}, document: doc = globalThis.document }) {
  let selectedPlotId = null, previewRole = null, signature = '', pressed = false;
  const content = () => doc.getElementById('panel-content');
  const model = () => academyModel(getState(), getMe(), selectedPlotId, previewRole ?? getMe()?.role);
  function render() {
    const state = getState(), player = getMe(); if (!state || !player) return;
    const m = model(), skillButtons = m.skills.map(skill => `<article class="menu-section academy-branch"><div class="menu-section-content"><header><span class="menu-tier">${esc(title(skill.role))} · Rank ${skill.rank} / ${skill.maxRank}</span><h3>${esc(skill.name)}</h3><p>${esc(skill.description)}</p></header><div class="academy-ranks">${skill.prices.map((price, index) => `<span class="status-pill" aria-label="Rank ${index + 1}${index < skill.rank ? ' learned' : ''}">${index < skill.rank ? '✓' : index + 1} · ${price + ACADEMY_COMMISSION}g</span>`).join(' → ')}</div>${skill.prerequisite ? `<p>Requires ${esc(skill.prerequisite)} rank 1.</p>` : ''}${skill.price === null ? '<p class="status-pill">Fully learned</p>' : `<button class="primary" data-academy-learn="${skill.id}" data-rank="${skill.rank + 1}" ${skill.available ? '' : 'disabled'}>Learn rank ${skill.rank + 1} · ${skill.price}g</button>`}</div></article>`).join('');
    const academies = state.plots.filter(plot => plot.building === 'arcane_academy');
    const locations = academies.map(plot => `<button data-academy-place="${esc(plot.id)}">${esc(plot.name ?? plot.id)} · ${esc(plot.ownerName ?? 'Academy')} ${plot.hp > 0 ? '' : '(ruined)'}</button>`).join('');
    const attunements = player.role === 'wizard' ? `<section class="menu-section"><div class="menu-section-content"><h3>Your staff</h3><p>${m.staffOwned ? 'Unbreakable · Mana powered. Your staff is in your pack.' : 'Your staff is missing. Reclaim it here for free.'}</p><p>${m.mana} / ${m.manaMax} mana · ${esc(title(m.element))} attunement. Each cast costs ${m.spellMana} mana with a ${m.spellCooldown} second cooldown. Cast again when the cooldown ends and you have enough mana for that spell. Mana recovers while you are alive and active.</p>${m.staffOwned ? '' : `<button data-academy-reclaim ${m.canReclaimStaff ? '' : 'disabled'}>Reclaim staff · Free</button>${m.reclaimReason ? `<p>${esc(m.reclaimReason)}</p>` : ''}<p>Reclaiming a staff keeps your current mana, cooldown and learned skills.</p>`}<div class="panel-actions">${m.elements.map(element => `<button data-academy-element="${element}" ${element === m.element ? 'disabled' : ''}>${esc(title(element))}</button>`).join('')}</div></div></section>` : '';
    openPanel(`<div class="academy-menu"><header class="menu-heading"><p class="menu-eyebrow">THE ARCANE ACADEMY</p><h2>Knowledge for every calling.</h2><p>Lessons remain learned throughout this village run, including after a role change, respawn or academy destruction. Only your current role’s skills are active.</p></header><div class="menu-stats"><span>Wallet: <strong>${Math.floor(player.wallet ?? 0)}g</strong></span><span>Academy commission: <strong>${ACADEMY_COMMISSION}g per lesson</strong></span></div><p>${m.nearby ? `Learning at ${esc(m.plot.ownerName ?? 'your village')}'s academy. The listed price includes its commission.` : m.operational ? 'Visit this academy’s entrance to purchase a lesson.' : 'A wizard must build and maintain an Arcane Academy before lessons can be purchased.'}</p>${m.operational && !m.nearby ? '<button data-academy-mark>Mark academy entrance</button>' : ''}<div class="panel-actions">${locations || '<p>No academy has been built yet.</p>'}</div><nav class="panel-actions" aria-label="Role skill trees">${Object.keys(ROLE_SKILLS).map(role => `<button data-academy-role="${role}" ${m.role === role ? 'disabled' : ''}>${title(role)}${player.role === role ? ' · current' : ''}</button>`).join('')}</nav>${m.role !== player.role ? '<p>You are previewing another role. Change roles to learn and use these skills.</p>' : ''}${skillButtons}${attunements}<p class="menu-footnote">Skill ranks must be learned in order. Branches show their prerequisites. Lessons spend wallet gold; the academy owner earns the fixed commission and the village treasury receives the lesson fee.</p></div>`, 'academy');
    for (const node of content()?.querySelectorAll('[data-academy-learn]') ?? []) node.onclick = () => { const live = model().skills.find(skill => skill.id === node.dataset.academyLearn); if (live?.available) send({ type: 'action', kind: 'academy_learn', plotId: selectedPlotId, skill: live.id, rank: live.rank + 1 }); };
    for (const node of content()?.querySelectorAll('[data-academy-role]') ?? []) node.onclick = () => { previewRole = node.dataset.academyRole; render(); };
    for (const node of content()?.querySelectorAll('[data-academy-place]') ?? []) node.onclick = () => { selectedPlotId = node.dataset.academyPlace; render(); };
    for (const node of content()?.querySelectorAll('[data-academy-element]') ?? []) node.onclick = () => send({ type: 'action', kind: 'staff_element', element: node.dataset.academyElement });
    const reclaim = content()?.querySelector('[data-academy-reclaim]');
    if (reclaim) reclaim.onclick = () => { if (model().canReclaimStaff) send({ type: 'action', kind: 'academy_reclaim_staff', plotId: selectedPlotId }); };
    const marker = content()?.querySelector('[data-academy-mark]');
    if (marker) marker.onclick = () => { const current = model(), entrance = plotEntrance(PLOTS.find(site => site.id === selectedPlotId), current.plot); if (entrance) markWaypoint({ ...entrance, label: 'Arcane Academy', kind: 'plot', id: selectedPlotId }); };
    for (const node of content()?.querySelectorAll('button') ?? []) { node.onpointerdown = () => { pressed = true; }; node.onpointerup = node.onpointercancel = node.onpointerleave = () => { pressed = false; }; }
    signature = JSON.stringify([m, player.wallet, player.role]);
  }
  function update() {
    if (getActivePanel() !== 'academy' || pressed) return;
    const player = getMe(); if (!player) return;
    if (JSON.stringify([model(), player.wallet, player.role]) !== signature) render();
  }
  return {
    show(plotId = null) { selectedPlotId = plotId ?? getState()?.plots?.find(plot => plot.building === 'arcane_academy' && plot.hp > 0)?.id ?? null; previewRole = getMe()?.role; render(); },
    update, render,
    clear() { selectedPlotId = null; previewRole = null; signature = ''; pressed = false; }
  };
}
