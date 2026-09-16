import { CRATE_PRICES, CRATE_POOLS, CRATE_EQUIPMENT, CRATE_RULES, LOADOUT_SLOTS, GATHERING_TOOLS, emptyLoadout, normalizeLoadout, crateMilestoneTier } from '../../shared/crates.js';
import { CRATE_ITEMS, CRATE_TIERS, crateItem } from './crate-catalog.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pretty = value => Math.max(0, Math.floor(Number(value) || 0)).toLocaleString('en-US');
const label = value => String(value).replace(/^./, c => c.toUpperCase());
const image = (id, className = '') => crateItem(id) ? `<img class="${className}" src="/assets/crate-items/${id}.png" alt="${esc(crateItem(id).name)}" loading="lazy" width="400" height="360">` : '';
const slotNames = { head: 'Headwear', body: 'Armor', feet: 'Footwear', utility: 'Utility', kit: 'Starting kit', tool: 'Gathering tool' };
const tierHeroes = { basic: 'padded_cap', rare: 'mining_pack', epic: 'runed_helm', legendary: 'dawnsteel_helm' };
const tierDescriptions = { basic: 'A practical beginning', rare: 'Tools of the trade', epic: 'Forged for the deep', legendary: 'Treasures of the watch' };
const itemDescription = item => item?.id === 'sunforged_viking_helm' ? '6% enemy damage reduction. Last Stand grants a 20-point ward for ten seconds after a surviving hit crosses below 25% health, once per night.' : item?.description || '';
function chestArt(tier = 'basic') {
  const color = CRATE_TIERS[tier]?.color || CRATE_TIERS.basic.color;
  return `<svg viewBox="0 0 240 180" aria-hidden="true" focusable="false" class="crate-chest-art"><ellipse cx="122" cy="155" rx="94" ry="13" fill="#040d0b" opacity=".4"/><path d="M30 72 158 51 214 77 85 101Z" fill="#c39b5c"/><path d="M30 72v65l55 28v-64Z" fill="#635038"/><path d="m85 101 129-24v65L85 165Z" fill="#947047"/><path d="M30 92 85 120 214 96M30 113 85 140 214 116" fill="none" stroke="#392f26" stroke-width="3" opacity=".5"/><path d="m50 62 11-2 56 29v70l-12 2V97Zm105-14 12 3 5 95-13 3-3-86Z" fill="${color}" opacity=".9"/><path d="m29 72 55 29 131-24M29 137l56 29 130-24" fill="none" stroke="${color}" stroke-width="5"/><path d="m117 108 21-4v20l-10 11-11-7Z" fill="#e0c68f"/><circle cx="128" cy="115" r="3" fill="#443927"/><path d="m126 117-1 7h6l-2-7" fill="#443927"/><path d="m40 82 4 2m-4 42 4 2m154-37 5-1m-5 43 5-1" stroke="#efd6a2" stroke-width="4" stroke-linecap="round"/></svg>`;
}
function emptySlotArt(slot) {
  const shapes = { head: 'M20 53V32a28 28 0 0 1 56 0v21l-13 8V38H33v23ZM35 18v12m26-12v12', body: 'm30 12 18 8 18-8 17 22-13 13-7-8v42H33V39l-7 8-13-13Z', feet: 'M21 16h24v38l18 8v18H17V62l4-9Zm36 0h20v37l8 6v17H70', utility: 'M30 26V16q18-14 36 0v10M19 31q28-13 57 0v43q-28 16-57 0Zm0 20h57M42 45h14v15H42Z', kit: 'm15 36 32-19 34 19v42H15Zm0 0h66M47 18v60M17 48h62m-42 4 10 10 11-10', tool: 'M26 80 61 24m-35 1q32-23 51 9M51 23l12 8' };
  return `<svg class="crate-slot-placeholder" viewBox="0 0 96 96" aria-hidden="true" focusable="false"><path d="${shapes[slot] || shapes.utility}" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
const safeStorage = () => { try { return globalThis.localStorage; } catch { return null; } };
const currencyName = currency => currency === 'bank' ? 'bank gold' : 'crate credits';
export function crateOdds(tier) { const count = CRATE_POOLS[tier]?.length || 0; return count ? `1 in ${count} · ${Number((100 / count).toFixed(2))}% each` : ''; }
export function crateResultText(result) {
  if (result.chargeGranted) return 'Phoenix Ember +1 charge. Every Ember adds a charge; repeat drops have no duplicate refund.';
  if (result.duplicate) return `Already unlocked · ${pretty(result.refund?.amount)} ${currencyName(result.refund?.currency)} returned.`;
  return 'Permanently unlocked. Select it for your next new village run.';
}
// Passing cards are decoration. The saved server item occupies the final stop;
// this function never rolls, changes odds, grants gear, or chooses a reward.
export function crateReel(result) {
  const pool = CRATE_POOLS[result.tier] || [result.itemId], stop = 28;
  return { stop, items: Array.from({ length: 34 }, (_, i) => i === stop ? result.itemId : pool[(i * 7 + 3) % pool.length]) };
}

export function createCratesUI({ getMe = () => null, getAccountKey, getActivePanel, openPanel, api, toast = () => {}, onAccountUpdate = () => {},
  document: doc = globalThis.document, storage = safeStorage(), reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  makeRequestId = () => globalThis.crypto.randomUUID(), schedule = (fn, ms) => setTimeout(fn, ms), cancel = id => clearTimeout(id) }) {
  let accountKey = null, data = null, view = 'shop', tier = 'basic', funding = 'bank', busy = false, error = '', success = '', signature = '', handlers = [];
  let pending = null, result = null, spinning = false, timer = null, epoch = 0, loadoutDraft = null, loadoutDirty = false, skipAnimations = false;
  const active = () => getActivePanel() === 'crates';
  const content = () => doc.getElementById('panel-content');
  const key = suffix => `emberwatch-crates:${accountKey}:${suffix}`;
  function store(suffix, value) { if (!storage || !accountKey) { if(value !== null && suffix === 'pending') throw new Error('Local storage unavailable'); return; } if (value === null) storage.removeItem(key(suffix)); else storage.setItem(key(suffix), JSON.stringify(value)); }
  function read(suffix) { try { return JSON.parse(storage?.getItem(key(suffix)) || 'null'); } catch { return null; } }
  function currentAccount() {
    const next = getAccountKey();
    if (next !== accountKey) { clear(); accountKey = next; pending = read('pending'); skipAnimations = read('skip') === true; }
    return Boolean(accountKey);
  }
  const owns = id => data?.unlocks?.includes(id);
  function button(text, fn, disabled = false, className = 'secondary-button', artwork = null, attrs = '') {
    const index = handlers.push(fn) - 1;
    return `<button type="button" class="${className}" data-crate-action="${index}"${artwork ? ` aria-label="${esc(text)}"` : ''}${attrs ? ' ' + attrs : ''}${disabled ? ' disabled' : ''}>${artwork ?? esc(text)}</button>`;
  }
  function setView(next) { if (busy || spinning) return; if(result)try{store('reveal', null);}catch{} view = next; error = ''; success = ''; render(); }
  function setData(next) {
    if (!next) return;
    data = next;
    if (!loadoutDirty) loadoutDraft = normalizeLoadout(next.loadout);
    onAccountUpdate(next);
  }
  function showResult(saved, animate) {
    result = saved; view = 'result'; spinning = Boolean(animate && !skipAnimations && !reducedMotion());
    cancel(timer); timer = null; error = '';
    if (active()) render();
    if (spinning) timer = schedule(finishSpin, 4000);
  }
  function finishSpin() { cancel(timer); timer = null; spinning = false; if (active()) render(); }
  function acceptResponse(response, animate = true) {
    setData(response.crates);
    const saved = response.result || data?.history?.find(item => item.requestId === pending?.requestId);
    if (!saved) throw new Error('Your opening has not been confirmed yet. Check the saved opening.');
    try { if(pending)store('reveal', pending); store('pending', null); } catch {} pending = null; busy = false;
    showResult(saved, animate);
  }
  async function submitOpening(action, { recovery = false } = {}) {
    if (busy || !currentAccount()) return;
    // Record the complete intent before any request. A lost response is retried
    // under this same immutable ID, including across reloads and reconnects.
    if (!recovery) {
      if (pending) { error = 'Check your saved opening before opening another crate.'; render(); return; }
      pending = { kind: 'crate_open', requestId: makeRequestId(), ...action };
      try { store('pending', pending); } catch { pending = null; error = 'Your browser could not save the opening receipt. Enable local storage and try again.'; render(); return; }
    }
    const request = { ...pending }, currentEpoch = epoch;
    busy = true; view = 'result'; result = null; error = ''; success = ''; render();
    try {
      const response = await api('/api/crates/action', { method: 'POST', body: JSON.stringify(request) });
      if (currentEpoch !== epoch) return;
      acceptResponse(response, !recovery);
    } catch (failure) {
      if (currentEpoch !== epoch) return;
      busy = false;
      if (failure.status >= 400 && failure.status < 500 && failure.status !== 408 && failure.status !== 429) { pending = null; try { store('pending', null); } catch {} }
      error = failure.message || 'The connection was interrupted. Check your saved opening to recover the result.';
      if (active()) render();
    }
  }
  async function refresh({ recover = true } = {}) {
    if (!currentAccount() || busy) return;
    const currentEpoch = epoch;
    busy = true; error = ''; if (active()) render();
    try {
      const response = await api('/api/crates');
      if (currentEpoch !== epoch) return;
      setData(response.crates); busy = false;
      const recovery = pending || read('reveal');
      if (recovery && recover) {
        const saved = data.history?.find(item => item.requestId === recovery.requestId);
        if (saved) { acceptResponse({ crates: data, result: saved }, false); return; }
        pending = recovery;
        await submitOpening(pending, { recovery: true }); return;
      }
      if (active()) render();
    } catch (failure) { if (currentEpoch !== epoch) return; busy = false; error = failure.message || 'Could not load your account equipment.'; if (active()) render(); }
  }
  async function saveLoadout() {
    if (busy || pending || !loadoutDraft) return;
    busy = true; error = ''; success = ''; const currentEpoch = epoch, submitted = { ...loadoutDraft }; render();
    try {
      const response = await api('/api/crates/action', { method: 'POST', body: JSON.stringify({ kind: 'crate_loadout', loadout: submitted }) });
      if (currentEpoch !== epoch) return;
      loadoutDirty = false; setData(response.crates); busy = false;
      success = 'Saved for your next new village run. Your current equipment and supplies are unchanged.'; if (active()) render();
    } catch (failure) { if (currentEpoch !== epoch) return; busy = false; error = failure.message || 'Could not save your future loadout.'; if (active()) render(); }
  }
  function itemCard(id, { odds = false } = {}) {
    const item = crateItem(id); if (!item) return '';
    const equipped = Object.values(data?.loadout || {}).includes(id), badge = id === 'phoenix_ember' ? '+1 charge per drop' : owns(id) ? 'Owned' : 'Discover';
    return `<article class="crate-item ${owns(id) ? 'owned' : ''}" style="--crate-color:${CRATE_TIERS[item.tier].color}"><div class="crate-item-art">${image(id)}<span class="crate-item-badge">${esc(badge)}</span>${odds ? `<span class="crate-item-odds">${esc(crateOdds(item.tier))}</span>` : ''}</div><div class="crate-item-body"><p class="crate-item-tier">${esc(CRATE_TIERS[item.tier].label)} · ${esc(slotNames[item.slot] || item.slot)}</p><h3>${esc(item.name)}</h3><p>${esc(itemDescription(item))}</p><span class="crate-owned">${id === 'phoenix_ember' ? `${pretty(data?.charges?.total)} reserve charges · repeats add +1` : equipped ? '✓ Selected for your next run' : owns(id) ? '✓ Permanently owned' : 'Not unlocked'}</span></div></article>`;
  }
  function shop() {
    const prices = CRATE_PRICES[tier], amount = prices[funding], enough = Number(data?.[funding]) >= amount;
    const tabs = Object.keys(CRATE_POOLS).map(id => button(CRATE_TIERS[id].label, () => { tier = id; render(); }, busy || Boolean(pending), `crate-tier crate-tier-card ${tier === id ? 'selected' : ''}`,
      `<span class="crate-tier-art">${chestArt(id)}${image(tierHeroes[id], 'crate-tier-treasure')}</span><span class="crate-tier-name">${esc(CRATE_TIERS[id].label)}</span><span class="crate-tier-count">${CRATE_POOLS[id].length} possible rewards</span><span class="crate-tier-price">${pretty(CRATE_PRICES[id][funding])} ${funding === 'bank' ? 'gold' : 'credits'}</span>`, `aria-pressed="${tier === id}" style="--crate-color:${CRATE_TIERS[id].color}"`)).join('');
    const earned = data.earnedCrates || [];
    const ownedCount = CRATE_POOLS[tier].filter(id => owns(id)).length;
    let html = `<section class="crate-shop"><div class="crate-section-heading"><div><p class="eyebrow">THE QUARTERMASTER’S VAULT</p><h3>Choose your next discovery.</h3></div><span>One crate. One saved reward.</span></div><div class="crate-tier-tabs" aria-label="Crate rarity">${tabs}</div>`;
    html += `<div class="crate-purchase" style="--crate-color:${CRATE_TIERS[tier].color}"><div class="crate-purchase-art">${chestArt(tier)}<span class="crate-purchase-seal">${esc(CRATE_TIERS[tier].label)}</span></div><div class="crate-purchase-copy"><p class="eyebrow">${esc(CRATE_TIERS[tier].label.toUpperCase())} CRATE</p><h3>${tierDescriptions[tier]}</h3><p>One reward · <strong>${esc(crateOdds(tier))}</strong></p><p>All ${CRATE_POOLS[tier].length} listed items are equally likely. Ownership does not change the odds.</p></div><div class="crate-purchase-controls"><label for="crate-funding">Pay with<select id="crate-funding"${busy || pending ? ' disabled' : ''}><option value="bank"${funding === 'bank' ? ' selected' : ''}>Personal bank · ${pretty(prices.bank)} gold</option><option value="credits"${funding === 'credits' ? ' selected' : ''}>Crate credits · ${pretty(prices.credits)}</option></select></label><div class="crate-funds-line"><span>Available</span><strong>${pretty(data[funding])} ${currencyName(funding)}</strong></div>${button(`Open ${CRATE_TIERS[tier].label} · ${pretty(amount)} ${currencyName(funding)}`, () => submitOpening({ tier, currency: funding }), busy || Boolean(pending) || !enough, 'primary-button')}${!enough ? `<p class="crate-shortfall">Need ${pretty(amount - data[funding])} more ${currencyName(funding)}.</p>` : ''}</div><p class="crate-purchase-note">A permanent duplicate returns <strong>${pretty(Math.floor(amount * CRATE_RULES.duplicateReturn))} ${currencyName(funding)} (70%)</strong>. ${tier === 'legendary' ? 'Every Phoenix Ember grants one charge, including repeats, with no refund.' : ''} Wallet gold, village funds, and loan credit are never charged.</p></div>`;
    html += `<div class="crate-section-heading crate-earned-heading"><div><p class="eyebrow">REWARDS FROM YOUR WATCH</p><h3>Earned crates <span>${earned.length}</span></h3></div><span>No payment needed</span></div>`;
    html += earned.length ? '<div class="crate-earned">' + earned.map(grant => `<article class="crate-earned-card" style="--crate-color:${CRATE_TIERS[grant.tier]?.color || CRATE_TIERS.basic.color}"><div class="crate-earned-art">${chestArt(grant.tier)}</div><div><strong>${esc(CRATE_TIERS[grant.tier]?.label)} crate</strong><span class="crate-earned-milestone">Lifetime night ${pretty(grant.milestone)}</span><small>Duplicate: ${pretty(Math.floor(CRATE_PRICES[grant.tier].credits * CRATE_RULES.duplicateReturn))} credits (70%)${grant.tier === 'legendary' ? '; Ember adds a charge instead' : ''}</small></div>${button('Open earned crate', () => submitOpening({ grantId: grant.id }), busy || Boolean(pending))}</article>`).join('') + '</div>' : '<div class="crate-empty-earned">'+chestArt('basic')+'<p>Earn your first crate at ten personally credited lifetime nights. Every ten nights brings another reward.</p>'+button('View milestones', () => setView('milestones'), busy)+'</div>';
    html += `<div class="crate-section-heading"><div><p class="eyebrow">INSIDE THIS CRATE</p><h3>${esc(CRATE_TIERS[tier].label)} reward pool</h3></div><span>${ownedCount} / ${CRATE_POOLS[tier].length} permanently owned · ${esc(crateOdds(tier))}</span></div><div class="crate-item-grid">${CRATE_POOLS[tier].map(id => itemCard(id, { odds: true })).join('')}</div><p class="crate-small">Credits stay with your account and buy crates only. They cannot be converted to gold, traded, or withdrawn.</p></section>`;
    return html;
  }
  function collection() {
    const owned = CRATE_ITEMS.filter(item => owns(item.id) && item.id !== 'phoenix_ember'), total = CRATE_ITEMS.filter(item => item.slot !== 'consumable').length;
    const groups = Object.entries(CRATE_TIERS).map(([id, info]) => ({ id, info, items: owned.filter(item => item.tier === id) })).filter(group => group.items.length);
    return `<div class="crate-section-heading"><div><p class="eyebrow">YOUR PERSONAL ARMORY</p><h3>Your collection · ${owned.length} permanent unlocks</h3><p>Keep your discoveries across every watch. Choose what accompanies your next new village.</p></div>${button('Choose future loadout', () => setView('loadout'), busy)}</div><div class="crate-collection-progress"><strong>${owned.length} <span>/ ${total} permanent items</span></strong><progress value="${owned.length}" max="${total}" aria-label="Permanent collection completion"></progress></div>${groups.map(({ info, items }) => `<div class="crate-collection-group"><h4 style="--crate-color:${info.color}">${esc(info.label)}<span>${items.length} unlocked</span></h4><div class="crate-item-grid">${items.map(item => itemCard(item.id)).join('')}</div></div>`).join('')}${!owned.length ? `<div class="crate-collection-empty"><div>${image('padded_cap')}${image('stout_leather_boots')}${image('foragers_pouch')}</div><h3>A collection starts with one discovery.</h3><p>Your first permanent unlock will appear here. Inspect each tier in Open crates to see its full pool.</p>${button('Explore crates', () => setView('shop'), busy)}</div>` : ''}<div class="crate-ember-reserve"><div>${image('phoenix_ember')}</div><div><p class="eyebrow">PHOENIX EMBER RESERVE</p><h3>${pretty(data.charges?.available)} available · ${pretty(data.charges?.total)} total charges</h3><p>Every Ember drop adds one charge, including repeat drops. Set aside an existing charge in your future loadout for one self-revival in a new run.</p></div></div>${data.history?.length ? '<div class="crate-section-heading"><div><p class="eyebrow">YOUR LAST DISCOVERIES</p><h3>Saved opening history</h3></div><span>Already saved to your account</span></div><div class="crate-history">' + data.history.slice(0, 12).map(saved => `<div><div class="crate-history-art" style="--crate-color:${CRATE_TIERS[saved.tier]?.color || CRATE_TIERS.basic.color}">${image(saved.itemId)}</div><span><strong>${esc(crateItem(saved.itemId)?.name || saved.itemId)}</strong><small>${esc(CRATE_TIERS[saved.tier]?.label)} · ${saved.funding === 'earned' ? 'Earned milestone crate' : pretty(saved.paid) + ' ' + currencyName(saved.funding)} · ${esc(crateResultText(saved))}</small></span>${button('View result', () => showResult(saved, false), busy)}</div>`).join('') + '</div>' : ''}`;
  }
  function loadout() {
    const draft = loadoutDraft || emptyLoadout(), me = getMe(), current = me?.crateEquipment || data.run?.equipment;
    const armor = Math.min(CRATE_RULES.armorCap, ['head', 'body', 'feet'].reduce((total, slot) => total + (CRATE_EQUIPMENT[draft[slot]]?.reduction || 0), 0));
    const utility = crateItem(draft.utility), kit = crateItem(draft.kit);
    const slots = LOADOUT_SLOTS.map(slot => { const item = crateItem(draft[slot]), choices = CRATE_ITEMS.filter(item => item.slot === slot && owns(item.id));
      return `<label class="crate-slot-card ${item ? 'filled' : 'empty'}" style="--crate-color:${CRATE_TIERS[item?.tier]?.color || '#8b9e8f'}"><div class="crate-slot-art">${item ? image(item.id) : emptySlotArt(slot)}<span>${esc(slotNames[slot])}</span></div><div class="crate-slot-copy"><span class="crate-slot-label">${esc(slotNames[slot])}</span><select id="crate-slot-${slot}" data-crate-slot="${slot}" aria-label="${esc(slotNames[slot])} for next new village"${busy ? ' disabled' : ''}><option value="">None</option>${choices.map(item => `<option value="${item.id}"${draft[slot] === item.id ? ' selected' : ''}>${esc(item.name)}</option>`).join('')}</select><small>${esc(item ? itemDescription(item) : choices.length ? 'Choose one of your unlocked items.' : 'Discover an item for this slot in a crate.')}</small></div></label>`; }).join('');
    return `<div class="crate-section-heading"><div><p class="eyebrow">PREPARE FOR A NEW BEGINNING</p><h3>For your next new village</h3></div><span class="crate-draft-badge">${loadoutDirty ? 'Unsaved choices' : 'Loadout saved'}</span></div><p class="crate-important">Saving changes your future loadout only. Returning to an existing village, changing roles, or reconnecting never grants more gear, food, or durability.</p><div class="crate-loadout-summary"><div><span>Enemy damage reduction</span><strong>${Math.round(armor * 100)}%</strong><small>After your shield · 25% maximum</small></div><div><span>Utility benefit</span><strong>${esc(utility?.name || 'No utility selected')}</strong><small>${esc(utility ? itemDescription(utility) : 'Choose one pack, carrying or durability benefit.')}</small></div><div><span>Starting supplies</span><strong>${esc(kit?.name || 'No starting kit')}</strong><small>Granted once in your next new village.</small></div></div><div class="crate-loadout">${slots}<label class="crate-slot-card crate-tool-card"><div class="crate-slot-art">${emptySlotArt('tool')}<span>Gathering tool</span></div><div class="crate-slot-copy"><span class="crate-slot-label">Kit gathering tool</span><select id="crate-slot-tool" data-crate-slot="tool"${busy ? ' disabled' : ''}>${GATHERING_TOOLS.map(tool => `<option value="${tool}"${draft.tool === tool ? ' selected' : ''}>${label(tool)}</option>`).join('')}</select><small>Used only when your chosen starting kit includes a tool.</small></div></label></div><div class="crate-ember-reserve"><div>${image('phoenix_ember')}</div><div><p class="eyebrow">ONE SECOND CHANCE</p><label class="crate-toggle"><input id="crate-reserve-ember" type="checkbox"${draft.reserveEmber ? ' checked' : ''}${busy ? ' disabled' : ''}> Reserve an existing Phoenix Ember for my next new run</label><p>${pretty(data.charges?.available)} unreserved / ${pretty(data.charges?.total)} total charges. A reservation uses an existing charge; it creates no new Ember. At most one self-revival is available per village run.</p><small>An active reservation stays with its village until used, forfeited, or the run ends.</small></div></div><div class="crate-loadout-save"><span>${loadoutDirty ? 'Your current village equipment stays as it is.' : 'Ready for your next new village.'}</span>${button(loadoutDirty ? 'Save future loadout' : 'Future loadout saved', saveLoadout, busy || Boolean(pending) || !loadoutDirty, 'primary-button')}</div><div class="crate-section-heading"><div><p class="eyebrow">WHAT YOU ARE WEARING NOW</p><h3>Current run equipment</h3></div><span>Granted when this run began</span></div>${current ? '<div class="crate-current">' + LOADOUT_SLOTS.filter(slot => slot !== 'kit').map(slot => `<div class="crate-current-slot ${current[slot] ? 'filled' : 'empty'}" style="--crate-color:${CRATE_TIERS[crateItem(current[slot])?.tier]?.color || '#8b9e8f'}"><div class="crate-current-art">${crateItem(current[slot]) ? image(current[slot]) : emptySlotArt(slot)}</div><span>${slotNames[slot]}</span><strong>${esc(crateItem(current[slot])?.name || 'Empty slot')}</strong></div>`).join('') + '</div>' : '<p>You are in the village lobby. Your selected loadout is granted once when you first join a new village; returning to a village never refills it.</p>'}<p class="crate-run-status">${data.run?.forfeited ? 'Current run gear and Ember eligibility were forfeited by manual respawn.' : data.run?.phoenixAvailable ? 'This run has a Phoenix Ember available while downed.' : 'No Phoenix Ember is available in this run.'}</p><details class="crate-details"><summary>Equipment and revival rules</summary><p>Armor reduces enemy damage remaining after your shield, capped at 25%. One utility slot means you choose one carrying, pack, or durability benefit.</p><p>Ordinary revivals preserve physical gear. Manual dawn respawn loses current gear and bound kit supplies, while permanent unlocks remain. Kit food cannot be sold, donated, traded, or stored. Purchased replacement gathering tools receive the Miner’s buckle durability bonus; starting-kit tools do not.</p></details>`;
  }
  function milestones() {
    const nights = Number(data.nights) || 0, next = Math.floor(nights / 10 + 1) * 10;
    return `<h3>${pretty(nights)} lifetime nights credited</h3><p>A night counts when you were online and alive for at least half its actual duration and the keep survived dawn. Village day numbers alone do not count. Milestone rewards pay once per account across villages.</p><div class="crate-milestone-next"><strong>Next: ${pretty(next)} credited nights</strong><span>${esc(CRATE_TIERS[crateMilestoneTier(next)]?.label)} crate${next === 100 ? ' + Sunforged Viking Helm' : ''}</span><progress value="${nights % 10}" max="10" aria-label="Progress toward next crate"></progress></div><table class="crate-milestone-table"><thead><tr><th>Lifetime credited nights</th><th>Reward</th></tr></thead><tbody><tr><td>10 · 20 · 30</td><td>Basic crate at each milestone</td></tr><tr><td>40 · 50 · 60</td><td>Rare crate at each milestone</td></tr><tr><td>70 · 80 · 90</td><td>Epic crate at each milestone</td></tr><tr><td>100, then every ten</td><td>Legendary crate at each milestone</td></tr></tbody></table><div class="crate-helmet">${image('sunforged_viking_helm')}<div><p class="eyebrow">THE HUNDREDTH WATCH</p><h3>Sunforged Viking Helm</h3><p>${owns('sunforged_viking_helm') ? '✓ Permanently earned' : `${pretty(nights)} / 100 lifetime nights`} · Awarded directly at 100 nights, in addition to your Legendary crate.</p><p>6% enemy damage reduction. Last Stand: once each night, surviving an enemy hit that crosses below 25% health grants a 20-point ward for ten seconds. It protects against later hits; it never revives you.</p></div></div>`;
  }
  function opening() {
    if (!result) return `<div class="crate-wait">${chestArt(tier)}<p class="eyebrow">${busy ? 'SEALING YOUR RECEIPT' : 'YOUR CRATE IS SAFE'}</p><h3>${busy ? 'Saving your opening…' : pending ? 'Your saved opening needs a connection.' : 'Ready when you are.'}</h3><p>${busy ? 'Your reward will be revealed after the opening is saved.' : pending ? 'Check the saved opening to recover the same result. This does not buy a second crate.' : 'Choose a crate to open.'}</p>${busy ? '<span class="crate-wait-light" aria-hidden="true"></span>' : ''}</div>`;
    const item = crateItem(result.itemId), color = CRATE_TIERS[result.tier]?.color || CRATE_TIERS.basic.color;
    if (spinning) {
      const reel = crateReel(result);
      return `<div class="crate-opening-stage" style="--crate-color:${color}"><p class="eyebrow">YOUR REWARD IS SAVED</p><h3>Opening ${esc(CRATE_TIERS[result.tier]?.label)} crate</h3><div class="crate-reel" role="img" aria-label="The saved crate reward is being revealed"><div class="crate-reel-pointer" aria-hidden="true"></div><div class="crate-reel-track" style="--crate-stop:${reel.stop * 148}px" aria-hidden="true">${reel.items.map(id => `<div class="crate-reel-card" style="--crate-color:${CRATE_TIERS[crateItem(id)?.tier]?.color || color}">${image(id).replace('loading="lazy"','loading="eager"')}<strong>${esc(crateItem(id)?.name || id)}</strong></div>`).join('')}</div></div><div class="crate-opening-footer"><p>Your reward is already saved. Passing cards are decorative; Skip reveals the same result.</p>${button('Skip animation', finishSpin)}</div></div>`;
    }
    return `<section class="crate-result ${result.duplicate ? 'duplicate' : 'discovered'}" data-reward-id="${esc(result.itemId)}" style="--crate-color:${color}" aria-live="polite"><div class="crate-result-stage"><span class="crate-result-orbit" aria-hidden="true"></span><span class="crate-result-rarity">${esc(CRATE_TIERS[result.tier]?.label)}</span>${image(result.itemId, 'crate-result-image').replace('loading="lazy"','loading="eager"')}<span class="crate-result-slot">${esc(slotNames[item?.slot] || (result.chargeGranted ? 'Self-revival charge' : 'Equipment'))}</span></div><div class="crate-result-copy"><p class="eyebrow">${esc(result.chargeGranted ? 'EMBER CHARGE RECEIVED' : result.duplicate ? 'PERMANENT DUPLICATE' : 'NEW PERMANENT UNLOCK')}</p><h3>${esc(item?.name || result.itemId)}</h3><p class="crate-result-benefit">${esc(itemDescription(item))}</p><div class="crate-result-receipt"><strong>${esc(crateResultText(result))}</strong><p>${result.funding === 'earned' ? 'Earned milestone crate' : `Paid ${pretty(result.paid)} ${currencyName(result.funding)}`} · ${esc(CRATE_TIERS[result.tier]?.label)} · ${esc(crateOdds(result.tier))}</p></div><p>${result.chargeGranted ? 'Keep it in reserve or select Reserve an existing Phoenix Ember for a future new run.' : 'This result does not replace or refill the equipment in your current village.'}</p><div class="panel-actions">${button('Future loadout', () => setView('loadout'), false, 'primary-button')}${button('Open crates', () => setView('shop'))}</div></div></section>`;
  }
  function render() {
    if (!currentAccount()) return;
    handlers = [];
    const nav = [['shop', 'Open crates'], ['collection', 'Collection'], ['loadout', 'Future loadout'], ['milestones', 'Milestones']];
    let html = '<div class="crates-panel"><header class="crate-menu-header"><div class="crate-menu-crest" aria-hidden="true">' + chestArt('legendary') + '</div><div><p class="eyebrow">THE EMBERWATCH ARMORY</p><h2>Crates & equipment</h2><p>Discover lasting gear. Prepare your next watch.</p></div></header>';
    if (data) html += `<div class="crate-balances"><div><span>PERSONAL BANK</span><strong>${pretty(data.bank)} gold</strong></div><div><span>CRATE CREDITS</span><strong>${pretty(data.credits)}</strong></div><div><span>LIFETIME NIGHTS</span><strong>${pretty(data.nights)}</strong></div></div><nav class="crate-nav" aria-label="Crate sections">${nav.map(([id, text]) => button(text, () => setView(id), busy || spinning, view === id ? 'secondary-button selected' : 'secondary-button')).join('')}</nav>`;
    if (error) html += `<p class="crate-error" role="alert">${esc(error)}</p>`;
    if (success) html += `<p class="crate-success" role="status">${esc(success)}</p>`;
    if (pending && !busy) html += `<div class="crate-recovery"><p>One opening is awaiting confirmation. Its original payment and result will be recovered with the same receipt.</p>${button('Check saved opening', () => refresh(), false)}</div>`;
    if (!data) html += `<p>${busy ? 'Loading your saved equipment…' : 'Load your saved equipment and balances.'}</p>${button('Load account', () => refresh(), busy)}`;
    else html += view === 'shop' ? shop() : view === 'collection' ? collection() : view === 'loadout' ? loadout() : view === 'milestones' ? milestones() : opening();
    html += `<footer class="crate-menu-footer"><label class="crate-toggle crate-motion"><input id="crate-skip-motion" type="checkbox"${skipAnimations || reducedMotion() ? ' checked' : ''}> Skip crate animations</label><p class="crate-small">Unlocks, credits, and unused Ember charges stay with your account. No real-money purchase is offered.</p></footer></div>`;
    const scroll = doc.getElementById('panel-dialog')?.scrollTop || 0;
    openPanel(html, 'crates');
    const dialog = doc.getElementById('panel-dialog'); if (dialog) dialog.scrollTop = scroll;
    for (const node of content()?.querySelectorAll('[data-crate-action]') || []) node.onclick = () => { if (!node.disabled) return handlers[Number(node.dataset.crateAction)]?.(); };
    const fundingField = doc.getElementById('crate-funding'); if (fundingField) fundingField.onchange = () => { funding = fundingField.value === 'credits' ? 'credits' : 'bank'; render(); };
    for (const select of content()?.querySelectorAll('[data-crate-slot]') || []) select.onchange = () => { loadoutDraft[select.dataset.crateSlot] = select.value; loadoutDirty = true; render(); doc.getElementById(select.id)?.focus?.({ preventScroll: true }); };
    const reserve = doc.getElementById('crate-reserve-ember'); if (reserve) reserve.onchange = () => { loadoutDraft.reserveEmber = reserve.checked; loadoutDirty = true; render(); doc.getElementById('crate-reserve-ember')?.focus?.({ preventScroll: true }); };
    const skip = doc.getElementById('crate-skip-motion'); if (skip) skip.onchange = () => { skipAnimations = skip.checked; try { store('skip', skipAnimations); } catch {} if (spinning && skipAnimations) finishSpin(); };
    signature = JSON.stringify(data);
  }
  async function show() { if (!currentAccount()) return; if (spinning && result) finishSpin(); render(); await refresh(); }
  function update(snapshot) {
    if (!snapshot || !currentAccount()) return;
    const before = signature; setData(snapshot);
    if (active() && !busy && !spinning && JSON.stringify(data) !== before && !(content()?.contains?.(doc.activeElement) && ['INPUT', 'SELECT', 'TEXTAREA'].includes(doc.activeElement?.tagName))) render();
  }
  function clear() { epoch++; cancel(timer); timer = null; accountKey = null; data = null; pending = null; result = null; busy = false; spinning = false; signature = ''; error = ''; success = ''; loadoutDraft = null; loadoutDirty = false; view = 'shop'; }
  return { show, update, refresh, clear, getSnapshot: () => data };
}
