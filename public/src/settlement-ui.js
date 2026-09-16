import { BUILDING_TYPES, RECIPES, TOOL_TIERS, RESOURCE_WEIGHTS, BACKPACKS, carryCapacity, MAX_PLOTS, PLOT_PRICES, TOOL_WEIGHTS, inventoryWeight, resourceWeight, boundInventoryCount, transferableCount, acquiredToolDurability } from '../../shared/content.js';
import { BUILDINGS, PLOTS, CAVE_ENTRANCE } from '../../shared/world.js';
import { buildingEntrance, plotEntrance, canUseBuilding, canUsePlot, canUseChurchBed } from '../../shared/access.js';
import { RESOURCE_MARKET, TREASURY_RESERVE, MAX_TRADE_AMOUNT } from '../../shared/market.js';
import { FOOD, POLICIES, taxedSaleQuote, taxedPurchaseQuote, maxSaleQuote } from '../../shared/economy.js';
import { CHURCH, RECRUIT, DEFENSE_UPGRADES, TOWER_STATS, bedCapacity } from '../../shared/defense.js';
import { ROLE_STATS } from '../../shared/roles.js';
import { WORKER_RULES, WORKER_RESOURCES, WORKER_ATTRIBUTES, WORKER_COLORS, WORKER_MAX_XP, workerStats } from '../../shared/workers.js';
import { NOTICEBOARD_POINT } from './noticeboard.js';
import { itemArt, shopInterior } from './shop-display.js';
import { TRANSPORT } from '../../shared/transport.js';
import { createBuildCarousel, buildingAvailability, buildingArt } from './build-carousel.js';
import { transferLimit } from '../../shared/transfers.js';
import { ownedCartCount } from '../../shared/cart-ownership.js';
import { plotStorageCapacity } from '../../shared/production.js';
import { PRODUCTION_UPGRADES, productionNodeCapacity, productionRegrowSeconds, productionStats, productionUpgrade, productionYield } from '../../shared/production.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = value => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });
const label = id => ({ food: 'Bread', good_food: 'Hearty meal', best_food: 'Feast', arrows: 'Arrows', cart: 'Cargo cart' }[id] || String(id).replaceAll('_', ' ').replace(/^./, c => c.toUpperCase()));
const costText = cost => Object.entries(cost || {}).map(([id, count]) => `${num(count)} ${id}`).join(' · ');
const resources = ['timber', 'stone', 'wheat', 'iron', 'coal'];
const equipment = ['sword', 'axe', 'pickaxe', 'scythe', 'hammer', 'bow'];
const gap = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const hasCost = (stock, cost) => Object.entries(cost || {}).every(([id, amount]) => id === 'gold' || (stock?.[id] || 0) >= amount);

export function createSettlementUI({ getState, getMe, getActivePanel, openPanel, send, toast, getHotbar, setHotbar, showDeliveries = null, showRequests = null, showInvestments = null, showTavern = null }) {
  let current = null, signature = '', handlers = [], waypoint = null, renderedAccess = '';
  const tradeAmounts = new Map(), displayedTrades = new Map();
  const transferDrafts = new Map();
  let renderedDraftKey = null;
  const transferFields = ['storage-resource', 'storage-amount', 'bank-amount', 'loan-amount'];
  const draftKey = () => `${current?.kind}:${current?.id || ''}`;
  const transferDraft = () => { const key = draftKey(); if (!transferDrafts.has(key)) transferDrafts.set(key, {}); return transferDrafts.get(key); };
  function captureTransferDrafts() {
    if (!renderedDraftKey) return;
    const draft = transferDrafts.get(renderedDraftKey) || {};
    for (const id of transferFields) { const field = document.getElementById(id); if (field) draft[id] = field.value; }
    transferDrafts.set(renderedDraftKey, draft);
  }
  const workerDrafts = new Map();
  const inspections = new Set();
  const buildCarousel = createBuildCarousel({ button, onChange: () => render(), onBuild: buildSelected });
  const content = () => document.getElementById('panel-content');
  const me = () => getMe();
  const state = () => getState();
  const wallet = () => me()?.wallet || 0;
  const money = () => (me()?.wallet || 0) + (state()?.loan?.credit || 0);
  const plots = () => state()?.plots || [];
  const owned = () => plots().filter(p => p.ownerId === me()?.id);
  const carriedText = id => `${num(me()?.inventory?.[id])} carried${boundInventoryCount(me(), id) ? ` · ${num(transferableCount(me(), id))} transferable · ${num(boundInventoryCount(me(), id))} kit-bound (eat only)` : ''}`;
  const head = (kicker, title, copy = '') => `<p class="eyebrow">${esc(kicker)}</p><h2>${esc(title)}</h2>${copy ? `<p>${esc(copy)}</p>` : ''}`;
  const row = (name, detail, control = '') => `<div class="settlement-row"><div><strong>${esc(name)}</strong>${detail ? `<small>${esc(detail)}</small>` : ''}</div>${control}</div>`;
  const stat = (name, value) => `<div><span>${esc(name)}</span><strong>${esc(value)}</strong></div>`;
  const stats = values => `<div class="settlement-stats">${values.map(([name, value]) => stat(name, value)).join('')}</div>`;
  const tierBadge = (level, total) => `<span class="menu-tier">Tier ${num(level)}${total ? ` / ${num(total)}` : ''}</span>`;
  const meter = (value, maximum, name) => `<div class="menu-meter" role="meter" aria-label="${esc(name)}" aria-valuemin="0" aria-valuemax="${Math.max(1, maximum)}" aria-valuenow="${Math.max(0, Math.min(maximum, value))}"><span style="width:${Math.max(0, Math.min(100, value / Math.max(1, maximum) * 100))}%"></span></div>`;
  function menuHero(art, kicker, title, copy, badge = '') {
    return `<header class="menu-hero"><div class="menu-hero-art">${art}${badge}</div><div class="menu-hero-copy">${head(kicker, title, copy)}</div></header>`;
  }
  function menuSection(title, copy, body, art = '') {
    return `<section class="menu-section">${art ? `<div class="menu-section-art">${art}</div>` : ''}<div class="menu-section-content"><header><h3>${esc(title)}</h3>${copy ? `<p>${esc(copy)}</p>` : ''}</header>${body}</div></section>`;
  }
  function costCards(cost, available) {
    return `<div class="menu-costs" aria-label="Upgrade cost">${Object.entries(cost).map(([id, count]) => `<div class="menu-cost${(available?.[id] || 0) < count ? ' short' : ''}">${itemArt(id)}<span><strong>${num(count)} ${esc(id)}</strong><small>${num(available?.[id])} available</small></span></div>`).join('')}</div>`;
  }
  function comparison(rows, next = true) {
    return `<div class="upgrade-comparison"><div class="upgrade-comparison-head"><span>Attribute</span><span>Current</span><span>${next ? 'Next tier' : 'Maximum tier'}</span></div>${rows.map(([name, before, after]) => `<div class="upgrade-comparison-row"><span>${esc(name)}</span><strong>${esc(before)}</strong><strong>${esc(after ?? before)}</strong></div>`).join('')}</div>`;
  }
  function workerPortrait(color = WORKER_COLORS[0].value) {
    const chosen = WORKER_COLORS.some(option => option.value === color) ? color : WORKER_COLORS[0].value;
    return `<svg viewBox="0 0 240 220" aria-hidden="true" focusable="false" data-worker-portrait="${chosen}"><circle cx="120" cy="103" r="84" fill="#ceb779" opacity=".12"/><ellipse cx="120" cy="204" rx="65" ry="9" fill="#122b23"/><path d="M79 188v19h35v-26m12 0v26h36v-19" fill="#44352c"/><path d="M65 112q-15 18-12 49l20 7 10-34m87-22q15 18 12 49l-20 7-10-34" fill="${chosen}"/><circle cx="64" cy="167" r="13" fill="#d3a878"/><circle cx="176" cy="167" r="13" fill="#d3a878"/><path d="M82 96q-11 36-12 91q50 18 100 0q-1-55-12-91Z" fill="${chosen}"/><path d="M82 118v64q38 12 76 0v-64" fill="#705638"/><path d="M83 143h75v14H83Z" fill="#382e27"/><rect x="109" y="141" width="24" height="19" rx="3" fill="#ccb16c"/><rect x="115" y="146" width="12" height="9" fill="#594730"/><ellipse cx="120" cy="76" rx="40" ry="39" fill="#d3a878"/><path d="M82 80q-3 45 38 63q41-18 38-63l-21 20h-34Z" fill="#9a6b43"/><path d="M97 102l23 23 23-23M111 111l9 25 9-25" fill="none" stroke="#c29359" stroke-width="5"/><path d="M79 64q1-37 40-41q40 3 43 41Z" fill="#4c5b47"/><path d="M77 63q42-12 86 0v10H77Z" fill="${chosen}"/><circle cx="104" cy="80" r="4" fill="#24352c"/><circle cx="137" cy="80" r="4" fill="#24352c"/><ellipse cx="120" cy="91" rx="10" ry="7" fill="#e0b280"/><path d="M58 194L190 77" stroke="#725036" stroke-width="9" stroke-linecap="round"/><path d="M164 71q24-7 45 10l-9 11q-19-15-36-5Z" fill="#97a4a0" stroke="#4b615a" stroke-width="3"/></svg>`;
  }
  function itemCard({ id, item, tier = 'wood', name, tag = '', facts = [], copy = '', extra = '', controls = '', status = '', available = true }) {
    const key = String(id), details = `shop-inspect-${key}`, insight = facts.map(([name, value]) => `${name}: ${value}`).join(' · ');
    let actionIndex = 0;
    controls = controls.replace(/<button /g, () => `<button data-shop-focus="buy-${esc(key)}-${actionIndex++}" `);
    return `<article class="shop-item" data-shop-item="${esc(key)}" data-available="${available}"><div class="shop-item-art">${itemArt(item, { tier })}<span class="shop-item-tag">${esc(tag)}</span><div class="shop-item-insight" aria-hidden="true">${esc(insight)}</div></div><div class="shop-item-body"><h4>${esc(name)}</h4><dl class="shop-item-facts">${facts.map(([title, value]) => `<div><dt>${esc(title)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl><details class="shop-item-details" data-shop-inspect="${esc(key)}" ${inspections.has(key) ? 'open' : ''}><summary data-shop-focus="${esc(key)}" aria-label="Inspect ${esc(name)}" aria-controls="${esc(details)}">Inspect item</summary><div id="${esc(details)}"><p>${esc(copy)}</p>${extra}</div></details>${status ? `<p class="shop-item-status">${esc(status)}</p>` : ''}<div class="shop-item-actions">${controls}</div></div></article>`;
  }
  function gearFacts(id, tier = 'wood') {
    const quality = TOOL_TIERS[tier] || TOOL_TIERS.wood;
    return [[id === 'sword' || id === 'bow' ? 'Damage' : id === 'hammer' ? 'Repair' : 'Yield', id === 'sword' ? `${quality.swordDamage} base / hit` : id === 'bow' ? '22 base / arrow' : id === 'hammer' ? `${quality.repair} health / swing` : `${quality.yield} ${quality.yield === 1 ? 'resource' : 'resources'} / swing`], ['Durability', `${acquiredToolDurability(me(), id, tier)} uses`]];
  }
  function materialDisplay(cost, stored) {
    return '<div class="shop-materials"><strong>Workshop materials</strong><p>' + esc(costText(cost)) + '</p><div>' + Object.entries(cost).map(([id, amount]) => `<span class="shop-material ${(stored?.[id] || 0) < amount ? 'short' : ''}">${itemArt(id)}<span>${num(amount)} ${esc(id)}<small>${num(stored?.[id])} stored</small></span></span>`).join('') + '</div></div>';
  }
  function shopTheme() {
    if (['tools', 'food', 'stable', 'bank', 'market'].includes(current?.kind)) return current.kind;
    if (current?.kind === 'merchant') return state()?.merchant?.present ? 'merchant' : null;
    if (current?.kind === 'plot') return { tool_shop: 'tools', sword_shop: 'weapons', tinker_shop: 'tinker' }[plots().find(p => p.id === current.id)?.building] || null;
    return null;
  }
  function button(text, onClick, disabled = false, title = '', className = 'secondary-button') {
    const id = handlers.push(onClick) - 1;
    return `<button type="button" class="${className}" data-settlement-button="${id}" ${disabled ? 'disabled' : ''} ${title ? `title="${esc(title)}"` : ''}>${esc(text)}</button>`;
  }
  function command(text, kind, extra = {}, disabled = false, title = '') {
    return button(text, () => {
      if (kind === 'worker_hire' && !atTreasury(me())) { render(); return; }
      send({ type: 'action', kind, ...extra });
    }, disabled, title);
  }
  function choices(id, values, selected) {
    if (transferFields.includes(id)) selected = transferDraft()[id] ?? selected;
    return `<select id="${id}">${values.map(([value, text]) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select>`;
  }
  function quantity(id, max = 100, value = 1) {
    if (transferFields.includes(id)) value = transferDraft()[id] ?? value;
    return `<input id="${id}" type="number" inputmode="numeric" min="1" max="${Math.max(1, max)}" value="${esc(value)}" aria-label="Amount">`;
  }
  const value = id => document.getElementById(id)?.value;
  const amount = id => Number(value(id));
  function wire() {
    for (const b of content().querySelectorAll('[data-settlement-button]')) b.onclick = () => {
      if (b.disabled) return;
      if (accessMode(panelAccess()) !== renderedAccess) { render(); return; }
      handlers[Number(b.dataset.settlementButton)]?.();
    };
    const policyInput=document.getElementById('policy-name');
    if(policyInput)policyInput.onchange=()=>{const info=POLICIES[policyInput.value],field=document.getElementById('policy-value');field.min=info.min;field.max=info.max;field.step=info.step;field.value=state().policies?.[policyInput.value]??info.initial;};
    for (const select of content().querySelectorAll('[data-hotbar-slot]')) select.onchange = () => setHotbar(Number(select.dataset.hotbarSlot), select.value);
    for (const detail of content().querySelectorAll('[data-shop-inspect]')) detail.ontoggle = () => {
      if (detail.open) inspections.add(detail.dataset.shopInspect); else inspections.delete(detail.dataset.shopInspect);
    };
    buildCarousel.bind(content());
    for (const id of transferFields) {
      const field = document.getElementById(id);
      if (field) field[id === 'storage-resource' ? 'onchange' : 'oninput'] = () => { transferDraft()[id] = field.value; updateTransfers(); };
    }
    updateTransfers();
    for (const resource of Object.keys(RESOURCE_MARKET)) {
      const input = document.getElementById(`trade-amount-${resource}`);
      if (input) input.oninput = () => { tradeAmounts.set(resource, input.value); updateTrade(resource); };
    }
    if (current?.kind === 'workers') ownWorkers().forEach((worker, index) => {
      for (const field of ['resource', 'sourcePlotId', 'mode', 'destinationPlotId']) {
        const input = document.getElementById(`worker-${index}-${field}`);
        if (input) input.onchange = () => {
          const draft = workerDraft(worker);
          draft.order[field] = input.value || null; draft.dirty = true;
          render();
        };
      }
    });
  }
  function show(kind, id = null) {
    if (!me() || !state()) return;
    current = { kind, id }; signature = ''; render();
  }
  function confirm(title, detail, kind, extra) {
    current = { kind: 'confirm', title, detail, action: kind, extra, source: current }; render();
  }
  function panelAccess(panel = current) {
    if (!panel || !me() || !state()) return null;
    if (panel.kind === 'confirm') {
      const access = panel.action === 'worker_dismiss' ? serviceAccess('bank') : panelAccess(panel.source);
      return access?.treatment ? { ...access, allowed: access.entrance, treatment: false } : access;
    }
    if (panel.kind === 'plot' || (panel.kind === 'church' && panel.id && panel.id !== 'church')) {
      const site = PLOTS.find(p => p.id === panel.id), plot = plots().find(p => p.id === panel.id);
      if (!site) return null;
      const treatment = plot?.building === 'church' && (me().bedPlotId === site.id ||
        canUseChurchBed(me(), site, plot));
      const atDoor = canUsePlot(me(), site, plot);
      return { allowed: atDoor || treatment, entrance: atDoor, treatment: Boolean(treatment && (!atDoor || panel.kind === 'church' || me().bedPlotId)),
        point: { ...plotEntrance(site, plot), id: site.id, name: site.name || site.id, kind: 'plot' } };
    }
    if (['bank', 'market', 'food', 'tools', 'barracks', 'church', 'stable', 'merchant'].includes(panel.kind)) return serviceAccess(panel.kind);
    return null;
  }
  function serviceAccess(id) {
    const building = BUILDINGS.find(b => b.id === id);
    return building ? { allowed: canUseBuilding(me(), building), point: { ...building, ...buildingEntrance(building), kind: 'service' } } : null;
  }
  const accessMode = access => !access ? 'remote' : !access.allowed ? 'blocked' : access.treatment ? 'treatment' : 'entrance';
  function entranceGuidance(access) {
    return head('BUILDING ENTRANCE', `Go to ${access.point.name}.`, 'Stand at the entrance to use this building. The minimap marker shows where to approach.') +
      button('Mark entrance', () => { waypoint = { ...access.point }; toast(access.point.name + ' entrance marked on your minimap.'); });
  }
  function render() {
    if (!current || !me() || !state()) return;
    captureTransferDrafts();
    handlers = [];
    const builders = { inventory: pack, bank, market, food, tools, workers, barracks: watch, church, stable, merchant, policies, roles, plot, cart, horse, atlas, confirm: confirmation };
    const access = panelAccess();
    renderedAccess = accessMode(access);
    const body = access && !access.allowed ? entranceGuidance(access) : access?.treatment && current.kind !== 'confirm' ? church(current.id) : builders[current.kind]?.(current.id) || '';
    if (!body) return;
    const dialog = document.getElementById('panel-dialog'), theme = (!access || access.allowed) && shopTheme();
    const focus = content()?.contains?.(document.activeElement) ? document.activeElement?.dataset?.shopFocus : null;
    const scroll = dialog.scrollTop;
    openPanel(theme ? `<div class="settlement-panel storefront" data-shop-theme="${theme}"><div class="storefront-scene">${shopInterior(theme)}<span class="shop-scene-caption">${theme === 'bank' ? 'The vault · Your gold, kept safe' : 'Step inside · Browse the counter'}</span></div><div class="storefront-content">${body}</div></div>` : `<div class="settlement-panel">${body}</div>`, 'settlement');
    renderedDraftKey = draftKey();
    dialog.classList.add('settlement-dialog'); wire(); dialog.scrollTop = scroll;
    if (focus) content().querySelector?.(`[data-shop-focus="${focus}"]`)?.focus({ preventScroll: true });
  }
  function refresh() {
    if (!current || getActivePanel() !== 'settlement' || !document.getElementById('panel-dialog').open) return;
    // Leaving an entrance must invalidate service controls even while editing a quantity.
    if (accessMode(panelAccess()) !== renderedAccess) { render(); return; }
    // Network snapshots must not reset a quantity or selection while it is being edited.
    if (content().contains(document.activeElement) && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
      updateTransfers();
      if (current.kind === 'market') { for (const resource of Object.keys(RESOURCE_MARKET)) updateTrade(resource); updateMarketSummary(); }
      return;
    }
    const p = me(), s = state();
    if (!p || !s) return;
    const next = JSON.stringify([p.wallet, p.bank, p.role, p.wageAccrued,p.jobBonus,p.repairBonus, p.inventory, p.boundInventory, p.crateEquipment, p.durability, p.maxDurability, p.tiers, p.backpackTier, p.hp, Math.floor(p.hunger), p.carryingId, p.bedPlotId, p.mountedHorseId, s.stock, s.treasury, s.plots, s.requests, s.policies, s.proposals, s.merchant, s.stable, s.loan, s.landDebt, s.foodQuotes, s.beds, s.barracks, s.defenseStatus, s.guardReplacements, s.guards.map(g => [g.id, g.hp > 0, g.hungry]), s.carts?.map(c => [c.id, c.storage, c.horseId]), s.horses?.map(h => [h.id, h.riderId, h.cartId]), ownWorkers().map(w => [w.id, w.name, w.resource, w.sourcePlotId, w.mode, w.destinationPlotId, w.status, w.paused, w.cargo, w.workXp, w.upgradePoints, w.attributes, w.color]), current.kind === 'policies' ? atCouncil() : null, current.kind === 'workers' ? [atTreasury(p), ownWorkers().map(w => [gap(p, w) <= 3.3, workerAtTreasury(w)])] : null]);
    if (next !== signature) { signature = next; render(); }
  }
  function pack() {
    const p = me(), s = state(), backpack = BACKPACKS[p.backpackTier] || BACKPACKS[0];
    let html = menuHero(itemArt('backpack', { tier: backpack.tier }), 'YOUR PACK', 'Ready for the next watch.', 'Your supplies, working tools and village earnings in one place.', tierBadge(backpack.tier, 3));
    html += stats([['Carried weight', `${num(inventoryWeight(p))} / ${carryCapacity(p)}`], ['Carrying gear', backpack.name], ['Wallet', `${num(p.wallet)} gold`], ['Plots', `${owned().length} / ${MAX_PLOTS}`]]) + meter(inventoryWeight(p), carryCapacity(p), 'Carrying capacity used');
    html += '<div class="panel-actions">' + button('Mark the backpack shop', () => markService('tools')) + button('Manage workers', () => show('workers')) + button('Village atlas', () => show('atlas')) + button('Change role', () => show('roles')) + '</div><p class="menu-footnote">Buy larger backpacks at Oak &amp; Iron, the village starter tool shop.</p>';
    html += '<h3>Carried supplies</h3><div class="pack-supplies">' + Object.keys(RESOURCE_WEIGHTS).map(id => `<article class="pack-supply" data-supply="${id}"><div>${itemArt(id)}</div><strong>${num(p.inventory?.[id])}</strong><span>${esc(label(id))}</span><small>${num(resourceWeight(p, id))} weight each${resourceWeight(p, id) < RESOURCE_WEIGHTS[id] ? ' with your equipped pack' : ''}</small>${boundInventoryCount(p, id) ? `<small class="bound-supply">${esc(carriedText(id))}</small>` : ''}</article>`).join('') + '</div>';
    if (p.inventory?.cart) html += command('Place your cargo cart', 'deployCart');
    if (p.carryingId) html += command('Put down the carried dwarf', 'dropPlayer');
    if (p.mountedHorseId) html += command('Dismount your horse', 'dismountHorse');
    html += '<h3>Equipment</h3><div class="pack-equipment">' + equipment.map(id => {
      const tier = TOOL_TIERS[p.tiers?.[id] || 'wood'], durability = p.durability?.[id] || 0, maximum = p.maxDurability?.[id] || tier.durability;
      return `<article class="pack-tool" data-equipped="${durability > 0}"><div class="pack-tool-art">${itemArt(id, { tier: p.tiers?.[id] || 'wood' })}</div><div><span class="menu-tier">${durability > 0 ? esc(tier.name) : 'Empty slot'}</span><h4>${esc(label(id))}</h4><p>${durability > 0 ? `${num(durability)} / ${num(maximum)} uses remaining${['axe', 'pickaxe', 'scythe'].includes(id) ? ` · ${tier.yield} resources per swing` : ''}` : 'Not equipped'}</p>${meter(durability, maximum, `${label(id)} durability`)}</div></article>`;
    }).join('') + '</div>';
    const options = [...equipment, 'food', 'good_food', 'best_food', ...(p.role === 'priest' ? ['heal'] : [])];
    html += menuSection('Your eight hotbar slots', 'Choose which equipment and food each number selects. A tool’s current tier is equipped automatically.', '<div class="hotbar-editor">' + getHotbar().map((selected, index) => `<label>Slot ${index + 1}<select data-hotbar-slot="${index}">${options.map(id => `<option value="${id}" ${id === selected ? 'selected' : ''}>${id === 'heal' ? 'Priest blessing' : label(id)}</option>`).join('')}</select></label>`).join('') + '</div>');
    html += menuSection('Your dawn earnings', 'Accrued pay arrives at dawn. Performance and repair bonuses are separate from your role wage.', stats([['Accrued role wage', `${num(p.wageAccrued)} gold`], ['Performance bonus', `${num(p.jobBonus)} / 25 gold`], ['Pending repair pay', `${num(p.repairBonus)} / 10 gold`]]), itemArt('gold'));
    html += '<h3>The village</h3>' + stats(resources.map(id => [label(id), num(s.stock?.[id])]));
    return html;
  }
  function bank() {
    const p = me(), s = state(), loan = s.loan || {};
    let html = head('VILLAGE BANK', 'Keep something for tomorrow.', 'Protect your savings between runs or arrange purchase credit with the vault keeper.') + stats([['Wallet', `${num(p.wallet)} gold`], ['Protected savings', `${num(p.bank)} gold`]]);
    html += '<section class="bank-counter"><div class="bank-counter-art">' + itemArt('gold') + '</div><div><h3>Your savings</h3><p>Deposited gold carries into another run. Enter an exact amount or transfer all available gold.</p><label for="bank-amount">Gold to transfer</label><div class="transfer-form">' + quantity('bank-amount', Math.max(p.wallet, p.bank), 10) + transferButton('bank-deposit', 'Deposit', () => sendBank(false, false)) + transferButton('bank-withdraw', 'Withdraw', () => sendBank(true, false)) + transferButton('bank-deposit-max', 'Deposit all', () => sendBank(false, true)) + transferButton('bank-withdraw-max', 'Withdraw all', () => sendBank(true, true)) + '</div><p id="bank-transfer-status" aria-live="polite"></p></div></section>';
    html += '<section class="bank-credit menu-section"><div class="menu-section-art">' + buildingArt('tool_shop') + '</div><div class="menu-section-content"><h3>Purchase credit</h3><p>Credit pays for eligible purchases. It cannot be withdrawn or deposited as savings. Debt follows your account between runs; ' + num(loan.repaymentPercent ?? 20) + '% of earnings repays it.</p>' + stats([['Debt', `${num(loan.debt)} gold`], ['Unspent credit', `${num(loan.credit)} gold`], ['Credit limit', `${num(loan.maxDebt || 200)} gold`]]) + '<label for="loan-amount">Gold to borrow or repay</label><div class="transfer-form">' + quantity('loan-amount', loan.maxDebt || 200, 100) + button('Borrow purchase credit', () => send({ type: 'action', kind: 'loan', amount: amount('loan-amount') }), (loan.debt || 0) >= (loan.maxDebt || 200) || (loan.availablePool || 0) < 1) + button('Repay from wallet', () => send({ type: 'action', kind: 'repayLoan', amount: amount('loan-amount') }), !loan.debt || !p.wallet) + '</div></div></section>';
    if (s.landDebt) html += `<p class="settlement-warning">Outstanding land tax: ${num(s.landDebt)} gold.</p>` + command('Pay land tax from wallet', 'pay_land_debt', {}, wallet() < 1);
    html += '<p>Buy, sell and donate resources at the Resource Exchange. Funded village supply requests are delivered there too.</p><div class="panel-actions">' + button('Find resource market', () => markService('market')) + button('Hire & manage workers', () => show('workers')) + button('Village policies & votes', () => show('policies')) + '</div>';
    html += '<div class="menu-service-links">';
    if (showInvestments) html += menuSection('Invest in your future', 'Review investment choices and manage your holdings.', button('Open investments', () => showInvestments()), itemArt('gold'));
    if (showTavern) html += menuSection('The village tavern', 'Visit the tavern counter for its games and services.', button('Visit tavern', () => showTavern()), itemArt('food'));
    if (showRequests) html += menuSection('The task board', 'Help fund the next watch by completing village supply requests.', button('Open task board', () => showRequests()), itemArt('wheat'));
    html += '</div>';
    return html;
  }
  function market() {
    const p = me(), s = state(), tax = s.policies?.tradeTax || 0;
    let html = head('RESOURCE EXCHANGE', 'Bring your haul to the counter.', 'Trade shared village supplies with the market keeper. Prices follow village stock; every bundle includes its changing unit prices and tax.');
    html += '<div class="settlement-stats market-summary">' + [['Wallet', 'market-wallet', `${num(p.wallet)} gold`], ['Village treasury', 'market-treasury', `${num(s.treasury)} gold`], ['Carried weight', 'market-carry', `${num(inventoryWeight(p))} / ${carryCapacity(p)}`], ['Trading tax', 'market-tax', `${num(tax)}%`]].map(([name, id, text]) => `<div><span>${esc(name)}</span><strong id="${id}">${esc(text)}</strong></div>`).join('') + '</div>';
    html += deliveries('bank');
    html += `<p>Enter a whole quantity to buy or sell. “Sell max” sells the largest bundle of that resource the treasury can currently afford, preserving its ${TREASURY_RESERVE} gold reserve.</p><div class="market-resource-grid">`;
    for (const [resource, info] of Object.entries(RESOURCE_MARKET)) {
      if (!tradeAmounts.has(resource)) tradeAmounts.set(resource, '10');
      const trade = quoteTrade(resource); displayedTrades.set(resource, trade);
      html += `<section class="market-resource-card" data-market-resource="${resource}"><div class="market-resource-art">${itemArt(resource)}<span id="trade-weight-${resource}">${num(resourceWeight(p, resource))} weight each</span></div><div class="market-resource-body"><div class="market-heading"><h3>${esc(info.label)}</h3><span id="trade-stock-${resource}">${esc(trade.stockText)}</span></div>`;
      html += `<label class="trade-quantity" for="trade-amount-${resource}">Quantity ${quantity(`trade-amount-${resource}`, trade.maxAmount, tradeAmounts.get(resource)).replace('aria-label="Amount"', `aria-label="${esc(info.label)} quantity" aria-describedby="trade-limit-${resource}"`)}</label><p class="trade-limit" id="trade-limit-${resource}">${esc(trade.limitText)}</p>`;
      html += `<div class="trade-quotes"><p id="trade-sell-quote-${resource}">${esc(trade.sellText)}</p><p id="trade-buy-quote-${resource}">${esc(trade.buyText)}</p></div><div class="market-buttons">`;
      for (const direction of ['sell', 'buy']) html += button(trade[direction + 'Button'], () => submitTrade(resource, direction), !trade[direction + 'Allowed'], trade[direction + 'Reason']).replace('<button ', `<button id="trade-${direction}-${resource}" data-shop-focus="trade-${direction}-${resource}" `);
      html += button(trade.maxButton, () => submitMaxTrade(resource), !trade.maxAllowed, trade.maxReason, 'secondary-button market-sell-max').replace('<button ', `<button id="trade-max-${resource}" data-shop-focus="trade-max-${resource}" `);
      html += `</div><p class="trade-max-quote" id="trade-max-quote-${resource}">${esc(trade.maxText)}</p></div></section>`;
    }
    html += '</div><section class="market-donation"><h3>Support the village</h3><p>Donate all raw resources in your pack without payment. For a posted reward, use “Requested deliveries” before making a donation.</p>' + command('Donate carried resources', 'donate', {}, !resources.some(id => transferableCount(p, id) > 0)).replace('<button ', '<button id="market-donate" ') + '</section>';
    return html + '<div class="panel-actions">' + button('Find bank', () => markService('bank')) + '</div>';
  }
  function updateMarketSummary() {
    const p = me(), s = state();
    for (const [id, text] of [['market-wallet', `${num(p.wallet)} gold`], ['market-treasury', `${num(s.treasury)} gold`], ['market-carry', `${num(inventoryWeight(p))} / ${carryCapacity(p)}`], ['market-tax', `${num(s.policies?.tradeTax || 0)}%`]]) {
      const node = document.getElementById(id); if (node) node.textContent = text;
    }
    const donate = document.getElementById('market-donate'); if (donate) donate.disabled = !resources.some(id => transferableCount(p, id) > 0);
  }
  const ownWorkers = () => (state()?.workers || []).filter(worker => worker.ownerId === me()?.id);
  const atTreasury = player => canUseBuilding(player, BUILDINGS.find(b => b.id === 'bank'));
  // Workers wait and sell around the treasury forecourt, not at the resident doorway.
  function workerAtTreasury(player) {
    const bank = BUILDINGS.find(b => b.id === 'bank');
    return Math.hypot(Math.max(0, Math.abs(player.x - bank.x) - bank.w / 2), Math.max(0, Math.abs(player.z - bank.z) - bank.d / 2)) <= 3.5;
  }
  const workerOrder = worker => ({ resource: worker.resource || 'timber', sourcePlotId: worker.sourcePlotId || null, mode: worker.mode || 'sell', destinationPlotId: worker.destinationPlotId || null });
  function workerDraft(worker) {
    const order = workerOrder(worker);
    let draft = workerDrafts.get(worker.id);
    if (!draft || !draft.dirty || JSON.stringify(draft.order) === JSON.stringify(order)) {
      draft = { order, dirty: false }; workerDrafts.set(worker.id, draft);
    }
    return draft;
  }
  function workerPlotName(id) {
    const place = PLOTS.find(p => p.id === id), plot = plots().find(p => p.id === id);
    return `${place?.name || id} · ${BUILDING_TYPES[plot?.building]?.name || 'Unavailable building'}${plot?.level >= 2 ? ` · Level ${plot.level}` : ''}`;
  }
  function workerSourcePlots(resource) {
    const building = { timber: 'tree_farm', wheat: 'wheat_farm', stone: 'mine', iron: 'mine', coal: 'mine' }[resource];
    return owned().filter(p => p.building === building && p.hp > 0);
  }
  function workerSelect(id, caption, options, selected) {
    if (selected && !options.some(([key]) => key === selected)) options.push([selected, `Unavailable · ${workerPlotName(selected)}`]);
    return `<label for="${id}">${esc(caption)} ${choices(id, options, selected || '')}</label>`;
  }
  function workers() {
    const p = me(), crew = ownWorkers(), destinations = owned().filter(plot => plot.building && plot.hp > 0);
    const nearBank = atTreasury(p), full = crew.length >= WORKER_RULES.maxPerPlayer;
    let html = menuHero(workerPortrait(), 'HIRED HANDS', 'Build your village crew.', 'Choose a gathering ground, train each worker and decide where every haul goes.', `<span class="menu-tier">${crew.length} / ${WORKER_RULES.maxPerPlayer} workers</span>`) + stats([['Your workers', `${crew.length} / ${WORKER_RULES.maxPerPlayer}`], ['Hire cost', `${WORKER_RULES.hireCost} gold`], ['Wages', `${WORKER_RULES.wageGold} gold / ${WORKER_RULES.wageSeconds} working seconds`], ['Wallet', `${num(p.wallet)} gold`]]);
    html += `<p>Workers start with ${WORKER_RULES.carryCapacity} cargo capacity and work day and night while you are online. Hiring and wages use your wallet; work stops when you cannot pay. Sales follow village prices and tax, with proceeds paid to you. Every ${WORKER_RULES.xpPerPoint} completed harvests earns one upgrade point. Spend points below to train each worker.</p>`;
    html += command(full ? 'Worker limit reached' : `Hire a worker · ${WORKER_RULES.hireCost}g`, 'worker_hire', {}, full || !nearBank || wallet() < WORKER_RULES.hireCost, !nearBank ? 'Visit the Village Treasury entrance to hire a worker.' : wallet() < WORKER_RULES.hireCost ? 'Hiring uses wallet gold.' : '');
    if (!nearBank) html += '<p>Visit the Village Treasury entrance to hire or dismiss workers.</p>' + button('Mark the treasury', () => markService('bank'));
    if (!crew.length) html += '<p>Your hired workers will appear here. Manage their orders from your pack at any time.</p>';
    crew.forEach((worker, index) => {
      const draft = workerDraft(worker), order = draft.order, sources = workerSourcePlots(order.resource);
      const sourceValid = !order.sourcePlotId || sources.some(plot => plot.id === order.sourcePlotId);
      const destinationValid = order.mode === 'sell' || destinations.some(plot => plot.id === order.destinationPlotId);
      const weight = inventoryWeight(worker.cargo || {}), nearWorker = gap(p, worker) <= 3.3, ability = workerStats(worker);
      const room = carryCapacity(p) - inventoryWeight(p), canCollect = WORKER_RESOURCES.some(resource => worker.cargo?.[resource] > 0 && resourceWeight(p, resource) <= room + 1e-8);
      const cargoText = WORKER_RESOURCES.filter(resource => worker.cargo?.[resource] > 0).map(resource => `${num(worker.cargo[resource])} ${resource}`).join(' · ') || 'Empty';
      const currentSource = worker.sourcePlotId ? workerPlotName(worker.sourcePlotId) : 'Public gathering grounds';
      const currentDestination = worker.mode === 'store' ? workerPlotName(worker.destinationPlotId) : 'Sell to the village';
      html += `<section class="worker-card" data-worker-card="${esc(worker.id)}"><header class="worker-card-heading"><div class="worker-card-portrait">${workerPortrait(worker.color)}</div><div><span class="menu-tier">Level ${worker.level || 1} · ${worker.paused ? 'Paused' : 'On duty'}</span><h3>${esc(worker.name || `Worker ${index + 1}`)}</h3><p>${esc(worker.status || 'Waiting for orders')}</p><small>${esc(worker.resource ? `${label(worker.resource)} · ${currentSource} → ${currentDestination}` : 'No resource assigned yet.')}</small></div><div class="worker-assignment-art">${itemArt(worker.resource || 'timber')}</div></header>`;
      html += '<div class="worker-card-body">' + row('Carried supplies', `${cargoText} · ${num(weight)} / ${ability.carryCapacity} weight`) + meter(weight, ability.carryCapacity, 'Worker cargo capacity');
      html += stats([['Level', worker.level || 1], ['Upgrade points', worker.upgradePoints || 0], ['Next point', (worker.workXp || 0) >= WORKER_MAX_XP ? 'Training complete' : `${(worker.workXp || 0) % WORKER_RULES.xpPerPoint} / ${WORKER_RULES.xpPerPoint} harvests`]]);
      html += '<h4>Worker attributes</h4><div class="worker-training">';
      for (const [attribute, rule] of Object.entries(WORKER_ATTRIBUTES)) {
        const rank = worker.attributes?.[attribute] || 0;
        const next = workerStats({ ...worker, attributes: { ...worker.attributes, [attribute]: Math.min(WORKER_RULES.maxAttributeRank, rank + 1) } });
        const metric = stats => attribute === 'gathering' ? `${num(stats.gatherSeconds)} seconds / harvest` : attribute === 'speed' ? `${num(stats.speed)} movement speed` : `${stats.carryCapacity} cargo capacity`;
        html += `<article class="worker-training-card"><span class="menu-tier">Rank ${rank} / ${WORKER_RULES.maxAttributeRank}</span><h5>${esc(rule.name)}</h5><p><small>Current</small><strong>${esc(metric(ability))}</strong></p><p><small>${rank >= WORKER_RULES.maxAttributeRank ? 'Maximum rank' : 'Next rank'}</small><strong>${esc(metric(next))}</strong></p>` + command(rank >= WORKER_RULES.maxAttributeRank ? 'Fully trained' : '+1 rank · 1 point', 'worker_upgrade', { workerId: worker.id, attribute }, rank >= WORKER_RULES.maxAttributeRank || !(worker.upgradePoints > 0)) + '</article>';
      }
      html += '</div><h4>Clothing color</h4><div class="worker-color-options">';
      for (const color of WORKER_COLORS) {
        const selected = (worker.color || WORKER_COLORS[0].value) === color.value;
        html += command(`${selected ? '✓ ' : ''}${color.name}`, 'worker_color', { workerId: worker.id, color: color.value }, selected, `Choose ${color.name.toLowerCase()} worker clothing`).replace('<button ', `<button aria-pressed="${selected}" style="border-left:8px solid ${color.value}" `);
      }
      html += '</div><h4>Work orders</h4>';
      html += '<div class="worker-order-grid">' + workerSelect(`worker-${index}-resource`, 'Resource', WORKER_RESOURCES.map(resource => [resource, label(resource)]), order.resource);
      html += workerSelect(`worker-${index}-sourcePlotId`, 'Gather from', [['', 'Public gathering grounds'], ...sources.map(plot => [plot.id, workerPlotName(plot.id)])], order.sourcePlotId);
      html += workerSelect(`worker-${index}-mode`, 'Deliver the haul', [['sell', 'Sell to the village'], ['store', 'Store in my building']], order.mode);
      if (order.mode === 'store') html += workerSelect(`worker-${index}-destinationPlotId`, 'Store at', [['', 'Choose a building'], ...destinations.map(plot => [plot.id, workerPlotName(plot.id)])], order.destinationPlotId);
      html += '</div><p>Applying orders starts or resumes work. Pausing calls the worker back with their cargo and stops wages.</p>';
      if (!sourceValid || !destinationValid) html += '<p class="settlement-warning">Choose an available gathering ground and delivery building. Your current orders remain until you apply a change.</p>';
      if (draft.dirty) html += '<p>Order changes have not been applied yet.</p>';
      html += '<div class="panel-actions">' + button('Apply orders', () => {
        draft.order = { ...order, destinationPlotId: order.mode === 'store' ? order.destinationPlotId : null };
        send({ type: 'action', kind: 'worker_assign', workerId: worker.id, ...draft.order });
      }, !sourceValid || !destinationValid);
      html += command(worker.paused ? 'Resume work' : 'Pause & return to treasury', 'worker_pause', { workerId: worker.id, paused: !worker.paused });
      html += button('Find worker', () => { waypoint = { kind: 'worker', id: worker.id, name: worker.name || 'Your worker', x: worker.x, z: worker.z }; toast('Your worker is marked on the minimap.'); });
      html += command('Collect carried supplies', 'worker_collect', { workerId: worker.id }, !canCollect || !nearWorker, !nearWorker ? 'Stand next to this worker to collect supplies.' : 'Take as much as your pack can hold. The worker keeps any remainder.');
      html += button('Dismiss worker', () => confirm('Dismiss this worker?', 'There is no hiring refund. You and the worker must be at the treasury, and the worker must have an empty pack before leaving.', 'worker_dismiss', { workerId: worker.id }), !nearBank || !workerAtTreasury(worker) || weight > 0, weight > 0 ? 'Collect or deliver the carried supplies first.' : 'You and the worker must be at the treasury. Pause work to call them back.');
      html += '</div></div></section>';
    });
    return html + '<div class="panel-actions">' + button('Back to your pack', () => show('inventory')) + '</div>';
  }
  function quoteTrade(resource) {
    const p = me(), s = state(), stock = s.stock?.[resource] || 0, carried = transferableCount(p, resource);
    const count = Number(tradeAmounts.get(resource)), valid = Number.isSafeInteger(count) && count >= 1 && count <= MAX_TRADE_AMOUNT;
    const room = Math.max(0, Math.floor((carryCapacity(p) - inventoryWeight(p) + 1e-8) / resourceWeight(p, resource)));
    let maximum = { amount: 0, quote: { gross: 0, tax: 0, total: 0 } };
    try { maximum = maxSaleQuote({ resource, stock, carried, treasury: s.treasury, percent: s.policies?.tradeTax || 0 }); } catch {}
    const sellMax = maximum.amount, buyMax = Math.min(stock, room, MAX_TRADE_AMOUNT);
    let sale = null, purchase = null;
    if (valid) {
      try { sale = taxedSaleQuote(resource, stock, count, s.policies?.tradeTax || 0); } catch {}
      try { purchase = taxedPurchaseQuote(resource, stock, count, s.policies?.tradeTax || 0); } catch {}
    }
    const invalidReason = `Enter a whole quantity from 1 to ${num(MAX_TRADE_AMOUNT)}.`;
    const sellReason = !valid ? invalidReason : count > carried ? `You carry only ${num(carried)} ${resource}.` : !sale ? 'A sale quote is unavailable.' : sale.total > s.treasury - TREASURY_RESERVE ? 'The treasury cannot pay this amount while preserving its reserve.' : '';
    const buyReason = !valid ? invalidReason : count > stock ? `The village has only ${num(stock)} ${resource}.` : count > room ? `Your pack has room for ${num(room)} more ${resource}.` : !purchase ? 'A purchase quote is unavailable.' : purchase.total > wallet() ? 'You do not have enough gold for this quantity.' : '';
    const maxReason = carried < 1 ? `You carry no ${resource}.` : !sellMax ? 'The treasury cannot buy any while preserving its reserve.' : '';
    return {
      count, sale, purchase, maxAmount: Math.max(1, sellMax, buyMax), sellAllowed: !sellReason, buyAllowed: !buyReason, sellReason, buyReason,
      maximum, maxAllowed: !maxReason, maxReason, maxButton: sellMax ? `Sell max · ${num(sellMax)} for ${num(maximum.quote.total)}g` : 'Sell max',
      maxText: sellMax ? `Max sale: ${num(sellMax)} ${resource} · ${num(maximum.quote.gross)}g value − ${num(maximum.quote.tax)}g tax = ${num(maximum.quote.total)}g received.${sellMax < carried ? ' Treasury funds or the trade limit leave the rest in your pack.' : ''}` : maxReason,
      stockText: `${carriedText(resource)} · ${num(stock)} in village`, limitText: `Can sell up to ${num(sellMax)} with treasury funds · Can buy up to ${num(buyMax)} with current stock and pack space.`,
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
    write(`trade-weight-${resource}`, `${num(resourceWeight(me(), resource))} weight each`);
    write(`trade-stock-${resource}`, trade.stockText); write(`trade-limit-${resource}`, trade.limitText);
    for (const direction of ['sell', 'buy']) {
      write(`trade-${direction}-quote-${resource}`, trade[direction + 'Text']);
      const control = document.getElementById(`trade-${direction}-${resource}`);
      if (control) { control.textContent = trade[direction + 'Button']; control.disabled = !trade[direction + 'Allowed']; control.title = trade[direction + 'Reason']; }
    }
    write(`trade-max-quote-${resource}`, trade.maxText);
    const maximum = document.getElementById(`trade-max-${resource}`);
    if (maximum) { maximum.textContent = trade.maxButton; maximum.disabled = !trade.maxAllowed; maximum.title = trade.maxReason; }
  }
  function submitTrade(resource, direction) {
    // Submit the exact quote that was displayed. A newer, less favorable server
    // price is rejected through minTotal/maxTotal rather than silently accepted.
    const trade = displayedTrades.get(resource);
    if (!trade?.[direction + 'Allowed'] || Number(value(`trade-amount-${resource}`)) !== trade.count) return;
    send({ type: 'action', kind: direction === 'sell' ? 'sell' : 'buyResource', resource, amount: trade.count, ...(direction === 'sell' ? { minTotal: trade.sale.total } : { maxTotal: trade.purchase.total }) });
  }
  function submitMaxTrade(resource) {
    // This is one quoted sale, independent of the custom quantity draft.
    // Keep its displayed minimum payout so a stale quote cannot pay less.
    const trade = displayedTrades.get(resource);
    if (!trade?.maxAllowed || !trade.maximum.amount) return;
    send({ type: 'action', kind: 'sell', resource, amount: trade.maximum.amount, minTotal: trade.maximum.quote.total });
  }
  function food() {
    const s = state(), p = me();
    let html = head('THE BREADBOARD', 'Something warm for the road.', 'Meals go into your pack. Equip one on your hotbar or eat it here whenever you need it.') + stats([['Hunger', `${num(p.hunger)} / 100`], ['Village wheat', num(s.stock?.wheat)]]) + '<div class="shop-item-grid">';
    for (const id of ['food', 'good_food', 'best_food']) {
      const item = s.foodQuotes?.[id] || FOOD[id]; if (!item) continue;
      const full = inventoryWeight(p) + resourceWeight(p, id) > carryCapacity(p) + 1e-8, stocked = (s.stock?.wheat || 0) >= item.wheat;
      const canBuy = wallet() >= item.price && stocked && !full;
      let controls = command(`Buy · ${item.price}g`, 'buyFood', { tier: id }, !canBuy);
      if (p.inventory?.[id]) controls += command('Eat ' + label(id).toLowerCase(), 'eat', { tier: id }, p.hunger >= 100);
      html += itemCard({ id, item: id, name: item.label || label(id), tag: id === 'food' ? 'Fresh bread' : id === 'good_food' ? 'Hearty meal' : 'Village feast',
        facts: [['Hunger', `+${item.hunger}`], ['In your pack', num(p.inventory?.[id])], ...(boundInventoryCount(p, id) ? [['Transferable', num(transferableCount(p, id))], ['Kit-bound', `${num(boundInventoryCount(p, id))} · eat only`]] : [])],
        copy: `Restores ${item.hunger} hunger when eaten · uses ${item.wheat} village wheat · ${carriedText(id)}. Each meal weighs ${num(resourceWeight(p, id))}. Buy now and eat later; buying never consumes it automatically.${boundInventoryCount(p, id) ? ' Kit food is eaten first and cannot be stored, sold, donated or traded.' : ''}`,
        status: !stocked ? 'The village needs more wheat.' : full ? 'Make room in your pack.' : wallet() < item.price ? 'Not enough wallet gold.' : `${item.wheat} wheat from village stores`, controls, available: canBuy });
    }
    return html + '</div>';
  }
  function tools() {
    const p = me(), backpack = BACKPACKS[p.backpackTier] || BACKPACKS[0];
    let html = head('OAK & IRON', 'Tools for the job. Room for the haul.', 'Start with 10 gold and choose your first wooden tool. An axe gathers timber, a pickaxe mines stone and ore, and a scythe harvests wheat. Hammers repair structures using village supplies.') + stats([['Wallet', `${num(p.wallet)} gold`], ...(state().loan?.credit > 0 ? [['Purchase credit', `${num(state().loan.credit)} gold`]] : []), ['Carried weight', `${num(inventoryWeight(p))} / ${carryCapacity(p)}`]]) + '<h3>Wooden tools · 10 gold each</h3><div class="shop-item-grid">';
    for (const id of ['axe', 'pickaxe', 'scythe', 'hammer']) {
      const owned = p.durability?.[id] > 0, full = inventoryWeight(p) + TOOL_WEIGHTS[id] > carryCapacity(p), available = money() >= 10 && !owned && !full;
      const use = { axe: 'Chop trees for timber.', pickaxe: 'Mine every stone, iron and coal outcrop.', scythe: 'Harvest individual wheat stalks.', hammer: 'Repair damaged structures using timber or stone from village supplies.' }[id];
      html += itemCard({ id: `wood_${id}`, item: id, tier: 'wood', name: 'Wooden ' + id, tag: 'Starter equipment', facts: gearFacts(id),
        copy: `${use} ${TOOL_WEIGHTS[id]} carrying weight. Wooden tools need no workshop materials. All tiers swing at the same speed.`,
        status: owned ? `${num(p.durability[id])} / ${num(p.maxDurability?.[id] || TOOL_TIERS[p.tiers?.[id] || 'wood'].durability)} uses remain · replace it once broken` : full ? 'Make room in your pack.' : money() < 10 ? 'Not enough gold or purchase credit.' : `${acquiredToolDurability(p, id)} durability · ${id === 'hammer' ? 'repairs damaged structures' : 'one resource per swing'}`,
        controls: command('Buy · 10g', 'buyTool', { tool: id }, !available), available });
    }
    html += '</div><p>Wooden tools need no materials. Stocked player tool shops craft stone and iron tools for higher yields at the same swing speed.</p><h3>Backpacks</h3><p>Equip a larger backpack to carry more tools, food, and resources. Upgrades replace your current bag. Each price is the full purchase price.</p><div class="shop-item-grid">';
    html += itemCard({ id: 'equipped_pack', item: 'backpack', tier: backpack.tier, name: backpack.name, tag: 'Equipped', facts: [['Carry capacity', `${carryCapacity(p)} total`], ['Upgrade level', `${backpack.tier} / 3`]],
      copy: `${carryCapacity(p)} total carrying capacity. Includes carrying bonuses from your role and deployed crate gear. Backpacks have no durability wear.`, controls: '<span class="status-pill">Equipped</span>' });
    for (const pack of BACKPACKS.filter(pack => pack.tier > backpack.tier)) {
      const capacity = carryCapacity({ ...p, backpackTier: pack.tier }), available = money() >= pack.price;
      html += itemCard({ id: `pack_${pack.tier}`, item: 'backpack', tier: pack.tier, name: pack.name, tag: 'Carry upgrade', facts: [['Carry capacity', `${capacity} total`], ['Extra room', `+${capacity - carryCapacity(p)}`]],
        copy: `${capacity} total capacity · +${capacity - carryCapacity(p)} more weight. Includes bonuses from your role and deployed crate gear. No durability wear; replaces the equipped bag. The price is the full purchase price, not an upgrade difference.`,
        status: available ? 'Wear it on your dwarf’s back.' : 'Not enough gold or purchase credit.', controls: command(`Equip · ${pack.price}g`, 'buyBackpack', { tier: pack.tier }, !available), available });
    }
    html += '</div>';
    if (backpack.tier === BACKPACKS.at(-1).tier) html += '<p>Your expedition backpack provides the largest carrying capacity.</p>';
    return html + '<div class="panel-actions">' + button('Find a player tool shop', () => show('atlas')) + '</div>';
  }
  function watch() {
    const replacements = (state().guardReplacements || []).filter(g => !g.plotId && !g.ownerId);
    return menuHero(buildingArt('barracks'), 'THE WATCH', 'One gate. Every dwarf helps.', 'The public watch marches from this barracks to the road outside the gate. Any role may defend with a sword or bow.') + stats([['Village watch', num(state().guards.filter(g => !g.ownerId && g.hp > 0).length)], ['Awaiting replacement', num(replacements.length)], ['Stored wheat', num(state().barracks?.wheat)]]) + deliveries('barracks') + menuSection('Keep the watch supplied', `Each deployed troop eats one wheat each night. Hungry troops deal less damage. Fallen guards return after ${RECRUIT.respawnSeconds} seconds if the barracks has ${RECRUIT.respawnWheat} wheat per replacement. Guards can build up to two owned barracks, each with ${RECRUIT.capacity} recruited troops.`, replacementRows(replacements) + command('Donate carried wheat', 'donate', { targetId: 'barracks' }, !transferableCount(me(), 'wheat')), itemArt('wheat')) + '<div class="panel-actions">' + button('Your land', () => show('atlas')) + '</div>';
  }
  function deliveries(id) {
    if (typeof showDeliveries !== 'function') return '';
    const count = (state().requests?.items || []).filter(request => request.status === 'open' && request.destinationId === id).length;
    return '<div class="requested-deliveries">' + row('Steward requests', `${count} funded ${count === 1 ? 'delivery' : 'deliveries'} for this destination. Use the posted request to earn its payment.`, button('Requested deliveries', () => showDeliveries(id))) + '</div>';
  }
  function replacementRows(replacements, destroyed = false) {
    return replacements.map((g, index) => row(`Fallen guard ${index + 1}`, destroyed ? 'Waiting for barracks repairs' : g.waitingForWheat ? `Waiting for ${RECRUIT.respawnWheat} wheat in this barracks${g.remaining > 0 ? ` · ${Math.ceil(g.remaining)} seconds preparation remaining` : ''}` : `Returns in ${Math.ceil(g.remaining)} seconds · costs ${RECRUIT.respawnWheat} stored wheat`)).join('');
  }
  function markService(kind) {
    const service = BUILDINGS.find(b => b.id === kind);
    if (!service) return;
    waypoint = { ...service, ...buildingEntrance(service), kind: 'service' };
    toast(service.name + ' marked on your minimap.');
  }
  function church(id = 'church', embedded = false) {
    if (id === 'church') return menuHero(buildingArt('church'), 'THE SANCTUARY', 'Find care in the village.', 'Priests can heal and revive nearby allies with their blessing. Automatic paid beds are available at churches built by priest players.') + menuSection('Care when you need it', 'A priest can bless wounded dwarfs and town guards in the field. For automatic treatment, visit a player church.', button('Find a player church', () => show('atlas')), workerPortrait('#9772ae'));
    const p = me(), plot = plots().find(plot => plot.id === id), beds = (state().beds || []).find(b => b.plotId === id), patients = beds?.patients || [], capacity = beds?.capacity || bedCapacity(plot || {}), busy = patients.length >= capacity;
    let html = embedded ? '' : menuHero(buildingArt('church'), 'SANCTUARY BEDS', 'A place to recover.', 'Church beds offer paid care even while the priest is away.', tierBadge(plot?.level || 1, 2));
    html += stats([['Beds occupied', `${patients.length} / ${capacity}`], ['Healing', `${CHURCH.healFee}g · ${CHURCH.healSeconds}s`], ['Revival', `${CHURCH.reviveFee}g · ${CHURCH.reviveSeconds}s`]]) + '<div class="care-beds">';
    for (let index = 0; index < capacity; index++) {
      const patient = patients[index];
      html += `<article class="care-bed" data-occupied="${Boolean(patient)}"><span class="menu-tier">Bed ${index + 1}</span><strong>${esc(patient ? state().players.find(v => v.id === patient.playerId)?.name || 'Recovering dwarf' : 'Ready for a guest')}</strong><small>${patient ? `${patient.revive ? 'Reviving' : 'Healing'} · ${Math.ceil(patient.remaining)} seconds remaining` : 'Available for healing or revival'}</small></article>`;
    }
    html += '</div>';
    if (p.bedPlotId) return html + menuSection('Your treatment', 'Stay until treatment completes, or leave the bed when you are ready.', command('Leave your bed', 'churchLeave'), itemArt('food'));
    html += '<div class="care-options">' + menuSection('Rest and recover', `Restore your health in ${CHURCH.healSeconds} seconds.`, stats([['Current health', `${num(p.hp)} / ${num(p.maxHp)}`], ['Treatment fee', `${CHURCH.healFee} gold`]]) + command(`Pay ${CHURCH.healFee}g and rest`, 'churchTreat', { plotId: id }, busy || p.hp >= p.maxHp || wallet() < CHURCH.healFee));
    html += menuSection('Revive a companion', `A carried dwarf returns with up to ${CHURCH.reviveHp} health after ${CHURCH.reviveSeconds} seconds.`, stats([['Treatment fee', `${CHURCH.reviveFee} gold`], ['Companion', p.carryingId ? 'Ready for a bed' : 'Carry a fallen dwarf']]) + (p.carryingId ? command(`Place carried dwarf in bed · ${CHURCH.reviveFee}g`, 'churchTreat', { plotId: id, targetId: p.carryingId }, busy || wallet() < CHURCH.reviveFee) : '<p class="menu-footnote">Pick up a fallen companion and bring them to the church.</p>')) + '</div>';
    return html;
  }
  function stable() {
    const horse = state().horses?.find(h => h.ownerId === me().id), available = Boolean(state().stable?.stock) && wallet() >= TRANSPORT.horseCost;
    const controls = horse ? button('Mark on map', () => { waypoint = { id: horse.id, kind: 'horse', name: 'Your horse' }; toast('Your horse is marked on the minimap.'); }) : command('Buy a horse · 100g', 'buyHorse', {}, !available);
    return head('THE VILLAGE STABLE', 'A companion for the road.', 'The steward restocks an empty stable when the merchant visits and the treasury can afford it. Each dwarf may own one horse.') + stats([['Horses for sale', `${num(state().stable?.stock)} / 3`]]) + '<div class="shop-item-grid shop-single-item">' + itemCard({ id: 'horse', item: 'horse', name: horse ? 'Your horse' : 'Village riding horse', tag: horse ? 'Your companion' : 'Stable bred', facts: [['Travel speed', `${TRANSPORT.horseSpeed} / second`], ['Ownership', 'One per dwarf']],
      copy: `Approach your horse to ride or attach a cart. A horse can pull your cargo cart with ${TRANSPORT.cartCapacity} storage capacity. Dismount before shopping, working or fighting.`, status: horse ? 'Approach your horse to ride or attach a cart.' : !state().stable?.stock ? 'The stable is waiting for new horses.' : !available ? 'Not enough wallet gold.' : 'Ready for a new rider.', controls, available: Boolean(horse) || available }) + '</div>';
  }
  function horse(id) {
    const h = state().horses?.find(v => v.id === id);
    if (!h) return head('STABLE', 'Your horse is no longer here.');
    const cart = state().carts?.find(c => c.ownerId === me().id && gap(c, h) <= 4);
    let html = menuHero(itemArt('horse'), 'YOUR HORSE', 'Travel farther. Bring more home.', 'Ride your horse or attach a nearby cargo cart for a longer supply run.');
    html += h.riderId === me().id ? command('Dismount', 'dismountHorse') : command('Ride your horse', 'mountHorse', { targetId: h.id }, Boolean(h.riderId));
    if (h.cartId) html += command('Detach cargo cart', 'attachCart', { targetId: h.cartId, horseId: null });
    else if (cart) html += command('Attach nearby cargo cart', 'attachCart', { targetId: cart.id, horseId: h.id });
    return html;
  }
  function cart(id) {
    const c = state().carts?.find(v => v.id === id);
    if (!c) return head('CARGO CART', 'This cart is no longer here.');
    let html = menuHero(itemArt('cart'), 'CARGO CART', 'Bring supplies back together.', 'Cart storage is separate from your carrying capacity. Attach the cart to your horse to transport its contents.') + stats([['Stored weight', `${num(inventoryWeight(c.storage || {}))} / ${TRANSPORT.cartCapacity}`]]) + meter(inventoryWeight(c.storage || {}), TRANSPORT.cartCapacity, 'Cart capacity used');
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
    if (m.present) {
      html += '<div class="shop-item-grid">';
      for (const [resource, stock] of Object.entries(m.stock || {})) {
        const weight = resourceWeight(me(), resource), full = inventoryWeight(me()) + weight > carryCapacity(me()) + 1e-8, price = m.prices?.[resource];
        const available = stock > 0 && Number.isFinite(price) && wallet() >= price && !full;
        html += itemCard({ id: `merchant_${resource}`, item: resource, name: label(resource), tag: 'Traveling wares', facts: [['Available', num(stock)], ['Carried', num(me().inventory?.[resource])]],
          copy: `${num(stock)} available · ${carriedText(resource)}. One unit weighs ${num(weight)}. Purchase transfers one item to your inventory for the listed wallet-gold price.`,
          status: stock < 1 ? 'Sold out for this visit.' : full ? 'Make room in your pack.' : !available ? 'Not enough wallet gold.' : 'Available during this visit.',
          controls: command(`Buy one · ${num(price)}g`, 'merchant_buy', { resource, amount: 1 }, !available), available });
      }
      html += '</div>';
    }
    html += '<h3>The steward’s last decision</h3><p>' + esc(state().steward?.lastDecision || 'The steward is watching village supplies.') + '</p>';
    return html;
  }
  const atCouncil = () => BUILDINGS.some(b => ['bank', 'keep'].includes(b.id) && canUseBuilding(me(), b));
  function policies() {
    const s = state(), canPropose = atCouncil();
    let html = head('VILLAGE COUNCIL', 'A voice for every dwarf.', 'A majority vote goes to the steward for an affordability and fairness review. Approved policies take effect at the next dawn.') + stats([['Guard wage', `${num(s.policies?.guardWage)}g`], ['Priest wage', `${num(s.policies?.priestWage)}g`], ['Trade tax', `${num(s.policies?.tradeTax)}%`], ['Base land tax', `${num(s.policies?.landTax)}g`]]);
    html += '<p>Wages are paid at dawn and depend on participation. Performance pay is additional. Full-cycle land tax is the base tax multiplied by the square of your plot count, prorated by your time online.</p><h3>Propose a change</h3><div class="policy-form"><label>Policy' + choices('policy-name', [['guardWage', 'Guard daily wage'], ['priestWage', 'Priest daily wage'], ['tradeTax', 'Trade tax %'], ['landTax', 'Land tax base']]) + '</label><label>New value' + quantity('policy-value', 60, 25).replace('min="1"', 'min="10" step="5"') + '</label>' + button('Submit proposal', () => { if (!atCouncil()) { render(); return; } send({ type: 'action', kind: 'propose_policy', policy: value('policy-name'), value: amount('policy-value') }); }, !canPropose) + '</div><div class="transfer-form">' + choices('export-priority', [['conserve', 'Conserve supplies'], ['balanced', 'Balanced reserves'], ['trade', 'Export more surplus']], s.policies?.exportPriority) + button('Propose resource priority', () => { if (!atCouncil()) { render(); return; } send({ type: 'action', kind: 'propose_policy', policy: 'exportPriority', value: value('export-priority') }); }, !canPropose) + '</div><h3>Votes & decisions</h3>';
    if (!canPropose) html += '<p>Visit the Treasury or Hearthkeep entrance to submit a proposal. You can read the council and vote from anywhere.</p>' + button('Mark the treasury', () => markService('bank'));
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
    const preferred = transferable.find(resource => transferableCount(me(), resource) > 0 || stored[resource] > 0) || transferable[0];
    let html = '<section class="storage-counter"><header><h4>Supply shelves</h4><p>Choose an item, then move an exact quantity or everything that fits.</p></header><div class="storage-grid">' + transferable.filter(r => stored[r] > 0 || me().inventory?.[r] > 0 || resources.includes(r)).map(r => `<div><div class="storage-item-art">${itemArt(r)}</div><span>${esc(label(r))}</span><strong>${num(stored[r])} stored</strong><small>${esc(carriedText(r))}</small></div>`).join('') + '</div><div class="storage-transfer-controls"><label for="storage-resource">Resource or item</label><div class="transfer-form">' + choices('storage-resource', transferable.map(resource => [resource, label(resource)]), preferred) + '<label for="storage-amount">Amount ' + quantity('storage-amount', 1000000, 1) + '</label>';
    html += transferButton('storage-store', 'Store', () => sendStorage(false, false)) + transferButton('storage-store-max', 'Store max', () => sendStorage(false, true));
    if (owner) html += transferButton('storage-take', 'Take', () => sendStorage(true, false)) + transferButton('storage-take-max', 'Take max', () => sendStorage(true, true));
    return html + '</div><p id="storage-transfer-status" aria-live="polite"></p></div></section>';
  }
  function transferButton(id, text, callback) { return button(text, callback).replace('<button ', `<button id="${id}" `); }
  function bankLimits() {
    const p = me(), count = amount('bank-amount'), valid = Number.isSafeInteger(count) && count > 0 && count <= 1000000;
    return { count, deposit: valid && count <= p.wallet, withdraw: valid && count <= p.bank, depositMax: p.wallet > 0, withdrawMax: p.bank > 0 };
  }
  function sendBank(withdrawing, maximum) {
    const limits = bankLimits(), allowed = limits[(withdrawing ? 'withdraw' : 'deposit') + (maximum ? 'Max' : '')];
    if (!allowed) { updateTransfers(); return; }
    send({ type: 'action', kind: withdrawing ? 'withdraw' : 'deposit', ...(maximum ? { max: true } : { amount: limits.count }) });
  }
  function storageLimits() {
    const isCart = current?.kind === 'cart', container = isCart ? state().carts?.find(cart => cart.id === current.id) : plots().find(plot => plot.id === current?.id);
    if (!container) return null;
    const resource = value('storage-resource'), stored = container.storage || {}, count = amount('storage-amount');
    let storeMax = transferLimit(me(), stored, resource, isCart ? TRANSPORT.cartCapacity : plotStorageCapacity(container));
    if (resource === 'cart' && container.ownerId !== me().id) {
      const recipient = state().players?.find(player => player.id === container.ownerId);
      if (recipient) storeMax = Math.min(storeMax, Math.max(0, TRANSPORT.maxCarts - ownedCartCount(state(), recipient)));
    }
    const takeMax = container.ownerId === me().id ? transferLimit(stored, me(), resource, carryCapacity(me())) : 0;
    const valid = Number.isSafeInteger(count) && count > 0 && count <= 1000000;
    return { resource, container, stored, isCart, count, storeMax, takeMax, store: valid && count <= storeMax, take: valid && count <= takeMax };
  }
  function sendStorage(withdrawing, maximum) {
    const limits = storageLimits();
    if (!limits || !limits[(withdrawing ? 'take' : 'store') + (maximum ? 'Max' : '')]) { updateTransfers(); return; }
    send({ type: 'action', kind: limits.isCart ? withdrawing ? 'cartWithdraw' : 'cartDeposit' : withdrawing ? 'plot_withdraw' : 'plot_deposit',
      ...(limits.isCart ? { targetId: limits.container.id } : { plotId: limits.container.id }), resource: limits.resource, ...(maximum ? { max: true } : { amount: limits.count }) });
  }
  function updateTransfers() {
    const enable = (id, allowed) => { const control = document.getElementById(id); if (control) control.disabled = !allowed; };
    if (document.getElementById('bank-amount')) {
      const limits = bankLimits();
      for (const [id, allowed] of [['bank-deposit', limits.deposit], ['bank-withdraw', limits.withdraw], ['bank-deposit-max', limits.depositMax], ['bank-withdraw-max', limits.withdrawMax]]) enable(id, allowed);
      const status = document.getElementById('bank-transfer-status');
      if (status) status.textContent = `${num(me().wallet)} gold available to deposit · ${num(me().bank)} gold available to withdraw. Transfers never use purchase credit.`;
    }
    if (document.getElementById('storage-resource')) {
      const limits = storageLimits(); if (!limits) return;
      for (const [id, allowed] of [['storage-store', limits.store], ['storage-take', limits.take], ['storage-store-max', limits.storeMax], ['storage-take-max', limits.takeMax]]) enable(id, allowed);
      const status = document.getElementById('storage-transfer-status');
      if (status) status.textContent = `${label(limits.resource)}: ${carriedText(limits.resource)} · ${num(limits.stored[limits.resource])} stored. Store up to ${num(limits.storeMax)}${limits.container.ownerId === me().id ? ` · take up to ${num(limits.takeMax)}` : ''}. Max uses the space available when the transfer completes. Stored items use their full weight.`;
    }
  }
  function buildOptions(id) {
    const site = PLOTS.find(p => p.id === id), plot = plots().find(p => p.id === id);
    return { plotId: id, site, plot, player: me(), plots: plots(), funds: money(), atEntrance: Boolean(site && plot && canUsePlot(me(), site, plot)), patients: state().beds?.find(bed => bed.plotId === id)?.patients || [] };
  }
  function buildSelected(building) {
    if (current?.kind !== 'plot') return;
    const options = buildOptions(current.id), p = options.plot, info = BUILDING_TYPES[building];
    if (!p || !info || !buildingAvailability(building, options).available) { render(); return; }
    if (p.building) confirm('Replace this building?', `This removes your ${BUILDING_TYPES[p.building].name} and any deployed troops. Empty storage and finish church treatments first. Building the ${info.name} costs ${costText(info.cost)}.`, 'plot_build', { plotId: p.id, building, confirm: true });
    else send({ type: 'action', kind: 'plot_build', plotId: p.id, building });
  }
  function structureUpgrade(plot, title, rows, upgrade, maximumLevel, owner, action) {
    const production = action === 'upgradeProduction', level = plot.level || 1;
    const available = { gold: wallet(), ...Object.fromEntries(Object.keys(RESOURCE_WEIGHTS).map(resource => [resource, (plot.storage?.[resource] || 0) + (production ? me().inventory?.[resource] || 0 : 0)])) };
    const cost = upgrade ? { gold: upgrade.gold, ...upgrade.resources } : {};
    const stocked = Object.entries(cost).every(([resource, count]) => available[resource] >= count);
    const label = !upgrade ? 'Fully upgraded' : production ? `Upgrade production to level ${upgrade.level}` : plot.building === 'church' ? 'Upgrade to four beds' : 'Upgrade to level 2';
    let html = `<section class="structure-upgrade" data-upgrade-building="${esc(plot.building)}"><header><div>${buildingArt(plot.building)}</div><div>${tierBadge(level, maximumLevel)}<h3>${esc(production ? `Production · Level ${level}` : title)}</h3><p>${upgrade ? `Current tier ${level} → Next tier ${upgrade.level}` : 'Maximum tier reached'}</p></div></header>` + comparison(rows, Boolean(upgrade));
    if (upgrade) html += '<h4>Upgrade cost</h4>' + costCards(cost, available) + `<p class="menu-footnote">${production ? 'Uses wallet gold and materials from this plot’s storage, then your pack. Harvest yield reflects your current tool tier.' : 'Uses wallet gold and materials stored in this building.'}</p>`;
    if (owner) html += '<footer>' + `<p class="upgrade-readiness">${!upgrade ? 'All improvements are already active.' : plot.hp <= 0 ? 'Repair this building first.' : !stocked ? 'Gather the missing gold or materials to upgrade.' : 'Ready to improve this building.'}</p>` + command(label, action, { plotId: plot.id }, !upgrade || !stocked || plot.hp <= 0) + '</footer>';
    return html + '</section>';
  }
  function plot(id) {
    const place = PLOTS.find(p => p.id === id), p = plots().find(p => p.id === id) || { id }, mine = p.ownerId === me().id;
    if (!place) return head('LAND REGISTRY', 'That plot is unavailable.');
    const type = BUILDING_TYPES[p.building], title = type?.name || 'Open plot';
    let html = menuHero(type ? buildingArt(p.building) : itemArt('timber'), place.outside ? 'BEYOND THE WALL · EXPOSED LAND' : 'VILLAGE LAND', `${place.name || id} · ${title}`, place.outside ? 'Outside plots offer forward defenses and access to rich gathering grounds. Buildings here are exposed to the horde.' : 'One building or land use per plot. Use its entrance to buy, build, trade, or manage it.', type ? tierBadge(p.level || 1, Object.hasOwn(PRODUCTION_UPGRADES, p.building) ? 3 : DEFENSE_UPGRADES[p.building] ? 2 : null) : '<span class="menu-tier">Land available</span>');
    if (!p.ownerId) {
      const count = owned().length, price = PLOT_PRICES[count];
      html += stats([['Your land', `${count} / ${MAX_PLOTS}`], ['Purchase', price === undefined ? 'Plot limit reached' : `${price} gold`], ['Total daily tax after purchase', `${num((state().policies?.landTax ?? 2) * (count + 1) ** 2)} gold`]]);
      html += command(price ? `Buy this plot · ${price}g` : 'Plot limit reached', 'plot_buy', { plotId: id }, price === undefined || money() < price);
      return html;
    }
    html += stats([['Owner', p.ownerName || 'Village resident'], ['Building health', p.building ? `${num(p.hp)} / ${num(p.maxHp)}` : 'Unbuilt'], ['Level', num(p.level || 1)]]);
    if (p.building === 'cannon' && p.hp > 0) html += deliveries(id);
    if (p.building && p.hp > 0 && p.hp < p.maxHp) html += command('Repair with equipped hammer', 'repairPlot', { plotId: id }, !me().durability?.hammer, 'Consumes shared village repair supplies and hammer durability.');
    if (['mine', 'wheat_farm', 'tree_farm'].includes(p.building)) html += '<p>' + (mine ? 'Your harvest is yours. When visitors harvest, their output is split 80% to them and 20% into your storage over time.' : p.allowVisitors ? 'Visitors may gather here. Your share is 80%; the owner receives the remaining 20% over time.' : 'This owner has closed harvesting to visitors.') + '</p>' + (mine ? command(p.allowVisitors ? 'Close visitor harvesting' : 'Allow visitor harvesting', 'plot_access', { plotId: id, allowVisitors: !p.allowVisitors }) : '');
    const recipes = Object.entries(RECIPES).filter(([, r]) => r.shop === p.building);
    if (recipes.length) {
      html += '<h3>Crafted to order</h3><p>Each purchase uses this shop’s stored materials. Payment goes to its owner. Equipment replaces your current item of that type.</p><div class="shop-item-grid">';
      for (const [recipe, r] of recipes) {
        const stocked = hasCost(p.storage, r.cost), owned = r.tool && me().durability?.[r.tool] > 0;
        const addedWeight = r.tool ? owned ? 0 : TOOL_WEIGHTS[r.tool] : resourceWeight(me(), r.item) * r.amount;
        const cartOwned = r.item === 'cart' && ownedCartCount(state(), me()) >= TRANSPORT.maxCarts;
        const full = inventoryWeight(me()) + addedWeight > carryCapacity(me()), available = stocked && (mine ? wallet() : money()) >= r.price && p.hp > 0 && !full && !cartOwned;
        const facts = r.tool ? gearFacts(r.tool, r.tier) : r.item === 'arrows' ? [['Bundle', `${r.amount} arrows`], ['Use', 'One per bow shot']] : [['Storage', `${TRANSPORT.cartCapacity} weight`], ['Ownership', 'One cart per dwarf']];
        const copy = r.tool ? r.tool === 'sword' ? 'A forward sweep can hit several enemies. Guards deal 20% extra damage. Each swing uses one durability. Replacing a sword discards the equipped weapon.' : r.tool === 'bow' ? 'A ranged shot consumes one carried arrow and one durability. Guards deal 20% extra damage. Aim toward your enemy.' : r.tool === 'hammer' ? 'Restores damaged structures using the village’s repair materials. Each repair uses one durability.' : 'Every tool tier can gather every matching resource. Higher tiers give more resources at the same swing speed. Each harvest uses one durability.' : r.item === 'arrows' ? 'A bundle for your bow. These go into your inventory and weigh 0.1 each. Archer towers do not need arrows.' : 'Place this cart, then attach it to your horse to move stored supplies. Cart storage is separate from your pack.';
        const controls = button(`Buy · ${r.price}g`, () => { if (r.tool && me().durability?.[r.tool] > 0) confirm('Replace your equipped item?', `${r.name} costs ${r.price} gold and uses ${costText(r.cost)} from this shop. Your existing ${r.tool} and its remaining durability will be lost.`, 'craft_buy', { plotId: id, recipe, confirm: true }); else send({ type: 'action', kind: 'craft_buy', plotId: id, recipe }); }, !available, !stocked ? 'The shop needs more materials.' : 'Crafts from shop storage.');
        html += itemCard({ id: recipe, item: r.tool || r.item, tier: r.tier, name: r.name, tag: r.tier ? TOOL_TIERS[r.tier].name + ' quality' : 'Workshop supply', facts, copy,
          extra: materialDisplay(r.cost, p.storage), controls, available,
          status: p.hp <= 0 ? 'Workshop needs rebuilding.' : cartOwned ? 'You already own a cargo cart, packed, stored or deployed.' : !stocked ? 'The shop needs more materials.' : full ? 'Make room in your pack.' : !available ? 'Not enough purchase funds.' : owned ? `Replaces your current ${r.tool} · ${num(me().durability[r.tool])} durability left` : 'Materials ready · crafted when purchased' });
      }
      html += '</div>';
    }
    if (p.building === 'church') html += church(id, true);
    if (p.building === 'barracks') {
      const troops = state().guards.filter(g => g.plotId === id && g.hp > 0);
      const replacements = (state().guardReplacements || []).filter(g => g.plotId === id);
      html += '<h3>Barracks troops</h3>' + stats([['Recruited slots', `${troops.length + replacements.length} / ${RECRUIT.capacity}`], ['Living troops', num(troops.length)], ['Awaiting replacement', num(replacements.length)], ['Hungry troops', num(troops.filter(g => g.hungry).length)], ['Stored wheat', num(p.storage?.wheat)]]) + '<div class="barracks-roster">' + Array.from({ length: RECRUIT.capacity }, (_, index) => {
        const troop = troops[index], replacing = index >= troops.length && index < troops.length + replacements.length;
        return `<article class="barracks-slot"><div>${troop || replacing ? workerPortrait('#71808f') : itemArt('sword')}</div><span class="menu-tier">Troop ${index + 1}</span><strong>${troop ? `${num(troop.hp)} / ${num(troop.maxHp || (p.level >= 2 ? 220 : 160))} health` : replacing ? 'Awaiting replacement' : 'Open recruit slot'}</strong><small>${troop ? troop.hungry ? 'Hungry · supply wheat' : 'Fed and ready' : replacing ? 'Stock wheat to reinforce' : `${RECRUIT.gold} gold to recruit`}</small></article>`;
      }).join('') + '</div>' + `<p>Each deployed troop consumes one stored wheat per night. Unfed troops deal 25% less damage. Fallen troops keep their recruited slot and return after ${RECRUIT.respawnSeconds} seconds when this barracks has ${RECRUIT.respawnWheat} wheat per replacement. Replacements cost no gold.</p>` + replacementRows(replacements, p.hp <= 0) + '<p>Recruiting an additional slot costs ' + costText({gold:RECRUIT.gold,...RECRUIT.resources}) + '.</p>';
      if (mine) html += command('Recruit a guard', 'recruitGuard', { plotId: id }, troops.length + replacements.length >= RECRUIT.capacity || wallet() < RECRUIT.gold || !hasCost(p.storage, RECRUIT.resources) || p.hp <= 0);
    }
    if (TOWER_STATS[p.building]) {
      const tower = TOWER_STATS[p.building], status = state().defenseStatus?.find(d => d.plotId === id);
      const ammunition = Object.entries(tower.ammo).map(([resource, cost]) => [label(resource) + ' stored', num(p.storage?.[resource])]);
      const unlimited = Object.keys(tower.ammo).length === 0;
      const shots = unlimited ? null : status?.shotsRemaining ?? Math.min(...Object.entries(tower.ammo).map(([resource, cost]) => Math.floor((p.storage?.[resource] || 0) / cost)));
      const condition = p.hp <= 0 ? 'destroyed' : !unlimited && shots < 1 ? 'empty' : unlimited && status?.status === 'empty' ? 'ready' : status?.status || 'ready';
      const descriptions = {
        ready: ['Ready', 'Automatically fires when a zombie enters range.'],
        firing: ['Engaging zombies', 'A zombie is in range and the defense is attacking.'],
        blocked: ['Shot blocked', 'Nearby terrain or buildings block the shot. A target needs a clear line of fire.'],
        out_of_range: ['Waiting for targets', 'The zombies are outside this defense’s firing range.'],
        empty: ['Out of ammunition', 'Add ammunition to Building storage below to resume firing.'],
        destroyed: ['Destroyed', 'The owner must empty its storage, remove the ruined building, and rebuild.']
      };
      const [name, detail] = descriptions[condition] || descriptions.ready;
      html += '<h3>Automatic defense</h3><div class="defense-state" data-defense-state="' + esc(condition) + '"><strong>' + esc(name) + '</strong><p>' + esc(detail) + '</p></div>' + stats([['Damage per shot', num(tower.damage * ((p.level || 1) >= 2 ? 1.5 : 1))], ['Firing range', `${num(status?.range ?? tower.range)} m`], ['Shot interval', `${num(tower.cooldown)} seconds`], ['Shots available', unlimited ? 'Unlimited' : num(shots)], ...ammunition]);
      html += '<p>' + (p.building === 'archer_tower' ? 'Archer towers fire automatically without arrows or other ammunition. Keep the tower repaired and upgrade it when you can.' : 'Each shot consumes one stored stone and one stored coal. Gather both with a pickaxe and place them in this building’s storage.') + '</p>';
    }
    if (Object.hasOwn(PRODUCTION_UPGRADES, p.building || '')) {
      const upgrade = productionUpgrade(p), currentStats = productionStats(p), next = upgrade ? { ...p, level: upgrade.level } : p, nextStats = productionStats(next);
      const produced = p.building === 'mine' ? ['stone', 'iron', 'coal'] : [p.building === 'tree_farm' ? 'timber' : 'wheat'];
      const rows = produced.map(resource => { const tool = resource === 'timber' ? 'axe' : resource === 'wheat' ? 'scythe' : 'pickaxe', base = TOOL_TIERS[me().tiers?.[tool] || 'wood'].yield; return [`${label(resource)} / swing`, num(productionYield(base, p)), num(productionYield(base, next))]; });
      rows.push(...produced.map(resource => [`${label(resource)} harvests / node`, num(productionNodeCapacity(resource, p)), num(productionNodeCapacity(resource, next))]), ['Resource regrowth', `${num(productionRegrowSeconds(produced[0], p))} seconds`, `${num(productionRegrowSeconds(produced[0], next))} seconds`], ['Storage capacity', `${num(plotStorageCapacity(p))} weight`, `${num(plotStorageCapacity(next))} weight`], ['Building health', num(p.maxHp || Math.round(type.maxHp * currentStats.healthMultiplier)), num(Math.round(type.maxHp * nextStats.healthMultiplier))]);
      html += structureUpgrade(p, 'Production', rows, upgrade, 3, mine, 'upgradeProduction');
    }
    if (DEFENSE_UPGRADES[p.building]) {
      const level = p.level || 1, upgrade = level < 2 ? { ...DEFENSE_UPGRADES[p.building], level: 2 } : null;
      const rows = [['Building health', num(p.maxHp), num(p.maxHp + (upgrade ? Math.ceil(p.maxHp * .5) : 0))]];
      if (p.building === 'church') rows.push(['Treatment beds', num(bedCapacity(p)), '4']);
      if (p.building === 'barracks') rows.push(['Troop health', level >= 2 ? '220' : '160', '220'], ['Troop damage', level >= 2 ? '18' : '14', '18']);
      if (TOWER_STATS[p.building]) { const tower = TOWER_STATS[p.building]; rows.push(['Damage per shot', num(tower.damage * (level >= 2 ? 1.5 : 1)), num(tower.damage * 1.5)], ['Firing range', `${tower.range} m`, `${tower.range} m`]); }
      html += structureUpgrade(p, 'Building upgrade', rows, upgrade, 2, mine, 'upgradeDefense');
    }
    if (mine || p.building) html += '<h3>Building storage</h3><p>Capacity: ' + num(inventoryWeight(p.storage||{})) + ' / ' + num(plotStorageCapacity(p)) + ' weight. Materials stored on an empty plot can fund its construction.</p>' + storage(p.storage || {}, id, false, mine);
    if (mine) {
      html += '<h3>' + (p.building ? 'Convert this plot' : 'Choose a building') + '</h3><p>Browse one building plan at a time. Construction uses gold and this plot’s materials before supplies in your pack. Converting removes the existing structure.</p>' + buildCarousel.render(buildOptions(id));
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
    html += row(NOTICEBOARD_POINT.name, `${Math.round(gap(NOTICEBOARD_POINT, me()))} m · treasury east wall · press E to read`, button('Find request board', () => { waypoint = { ...NOTICEBOARD_POINT }; toast('Request board marked on your minimap. Close the atlas to walk there.'); }));
    html += row('Mountain mine', `${Math.round(gap(CAVE_ENTRANCE, me()))} m to entrance · stone on the upper level · mixed iron and coal below`, button('Find mountain mine', () => { waypoint = { ...CAVE_ENTRANCE, id: 'mountain-mine', kind: 'cave', name: 'Mountain mine entrance' }; toast('Mountain mine entrance marked on your minimap.'); }));
    for (const b of BUILDINGS.filter(b => !['house'].includes(b.kind))) html += row(b.name, `${Math.round(gap(buildingEntrance(b), me()))} m to entrance`, button('Mark', () => markService(b.id)));
    html += '</div><h3>Plots & player businesses</h3><div class="atlas-list">';
    for (const place of PLOTS) {
      const p = plots().find(p => p.id === place.id), type = BUILDING_TYPES[p?.building];
      html += row(`${place.name || place.id}${p?.ownerId === me().id ? ' · yours' : ''}`, `${type?.name || 'Open plot'}${p?.ownerId ? ' · ' + (p.ownerName || 'Village resident') : ''} · ${place.outside ? 'outside' : 'inside'} · ${Math.round(gap(plotEntrance(place, p), me()))} m to entrance`, button('Mark', () => { waypoint = { ...plotEntrance(place, p), id: place.id, name: place.name || place.id, kind: 'plot' }; toast((place.name || place.id) + ' marked on your minimap.'); }));
    }
    return html + '</div>';
  }
  function getWaypoint() {
    if (waypoint?.kind === 'plot') {
      const site = PLOTS.find(p => p.id === waypoint.id);
      if (site) Object.assign(waypoint, plotEntrance(site, plots().find(p => p.id === site.id)));
    }
    return waypoint;
  }
  return { show, refresh, getWaypoint, setWaypoint: point => { if (point && Number.isFinite(point.x) && Number.isFinite(point.z)) waypoint = { ...point }; }, clear: () => { current = null; waypoint = null; signature = ''; renderedAccess = ''; renderedDraftKey = null; transferDrafts.clear(); tradeAmounts.clear(); displayedTrades.clear(); workerDrafts.clear(); inspections.clear(); buildCarousel.clear(); } };
}
