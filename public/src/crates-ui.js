import { CRATE_PRICES, CRATE_POOLS, CRATE_EQUIPMENT, CRATE_RULES, LOADOUT_SLOTS, GATHERING_TOOLS, emptyLoadout, normalizeLoadout, crateMilestoneTier } from '../../shared/crates.js';
import { CRATE_ITEMS, CRATE_TIERS, crateItem } from './crate-catalog.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pretty = value => Math.max(0, Math.floor(Number(value) || 0)).toLocaleString('en-US');
const label = value => String(value).replace(/^./, c => c.toUpperCase());
const image = (id, className = '') => `<img class="${className}" src="/assets/crate-items/${esc(id)}.png" alt="${esc(crateItem(id)?.name || id)}" loading="lazy" width="180" height="180">`;
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
  function button(text, fn, disabled = false, className = 'secondary-button') {
    const index = handlers.push(fn) - 1;
    return `<button type="button" class="${className}" data-crate-action="${index}"${disabled ? ' disabled' : ''}>${esc(text)}</button>`;
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
    return `<article class="crate-item ${owns(id) ? 'owned' : ''}" style="--crate-color:${CRATE_TIERS[item.tier].color}">${image(id)}<p class="crate-item-tier">${esc(CRATE_TIERS[item.tier].label)} · ${esc(item.slot)}</p><h3>${esc(item.name)}</h3><p>${esc(item.description)}</p><span class="crate-owned">${id === 'phoenix_ember' ? `${pretty(data?.charges?.total)} reserve charges · repeats add +1` : owns(id) ? '✓ Permanently owned' : 'Not unlocked'}</span>${odds ? `<small>${esc(crateOdds(item.tier))}</small>` : ''}</article>`;
  }
  function shop() {
    const prices = CRATE_PRICES[tier], amount = prices[funding], enough = Number(data?.[funding]) >= amount;
    const tabs = Object.keys(CRATE_POOLS).map(id => button(CRATE_TIERS[id].label, () => { tier = id; render(); }, busy || Boolean(pending), `crate-tier ${tier === id ? 'selected' : ''}`)).join('');
    const earned = data.earnedCrates || [];
    return `<section class="crate-shop"><h3>Earned crates <span>${earned.length}</span></h3>${earned.length ? '<div class="crate-earned">' + earned.map(grant => `<div><span><strong>${esc(CRATE_TIERS[grant.tier]?.label)} crate</strong><small>Lifetime night ${pretty(grant.milestone)} · duplicate: ${pretty(Math.floor(CRATE_PRICES[grant.tier].credits * CRATE_RULES.duplicateReturn))} credits${grant.tier === 'legendary' ? '; Ember adds a charge instead' : ''}</small></span>${button('Open earned crate', () => submitOpening({ grantId: grant.id }), busy || Boolean(pending))}</div>`).join('') + '</div>' : '<p>Earn your first crate at ten personally credited lifetime nights.</p>'}<h3>Choose a crate</h3><div class="crate-tier-tabs">${tabs}</div><div class="crate-purchase"><div><p class="eyebrow">${esc(CRATE_TIERS[tier].label.toUpperCase())} CRATE</p><h3>One reward · ${esc(crateOdds(tier))}</h3><p>All ${CRATE_POOLS[tier].length} listed items are equally likely. Ownership does not change the odds.</p></div><label>Pay with<select id="crate-funding"${busy || pending ? ' disabled' : ''}><option value="bank"${funding === 'bank' ? ' selected' : ''}>Personal bank · ${pretty(prices.bank)} gold</option><option value="credits"${funding === 'credits' ? ' selected' : ''}>Crate credits · ${pretty(prices.credits)}</option></select></label>${button(`Open ${CRATE_TIERS[tier].label} · ${pretty(amount)} ${currencyName(funding)}`, () => submitOpening({ tier, currency: funding }), busy || Boolean(pending) || !enough, 'primary-button')}<p class="crate-purchase-note">${enough ? '' : 'Insufficient ' + currencyName(funding) + '. '}A permanent duplicate returns <strong>${pretty(Math.floor(amount * CRATE_RULES.duplicateReturn))} ${currencyName(funding)} (70%)</strong>. ${tier === 'legendary' ? 'Every Phoenix Ember grants one charge, including repeats, with no refund.' : ''} Wallet gold, village funds, and loan credit are never charged.</p></div><div class="crate-item-grid">${CRATE_POOLS[tier].map(id => itemCard(id, { odds: true })).join('')}</div><p class="crate-small">Credits stay with your account and buy crates only. They cannot be converted to gold, traded, or withdrawn.</p></section>`;
  }
  function collection() {
    const owned = CRATE_ITEMS.filter(item => owns(item.id));
    return `<h3>Your collection · ${owned.length} permanent unlocks</h3><p>Owned items stay unlocked when a village falls or you respawn. Newly won items are choices for your next new village, with one item per equipment slot.</p>${button('Choose future loadout', () => setView('loadout'), busy)}<div class="crate-item-grid">${owned.map(item => itemCard(item.id)).join('')}${itemCard('phoenix_ember')}</div>${!owned.length ? '<p>Your first permanent unlock will appear here. Inspect each tier in Open crates to see its full pool.</p>' : ''}${data.history?.length ? '<h3>Saved opening history</h3><div class="crate-history">' + data.history.slice(0, 12).map(saved => `<div><span><strong>${esc(crateItem(saved.itemId)?.name || saved.itemId)}</strong><small>${esc(CRATE_TIERS[saved.tier]?.label)} · ${saved.funding === 'earned' ? 'Earned milestone crate' : pretty(saved.paid) + ' ' + currencyName(saved.funding)} · ${esc(crateResultText(saved))}</small></span>${button('View result', () => showResult(saved, false), busy)}</div>`).join('') + '</div>' : ''}`;
  }
  function loadout() {
    const draft = loadoutDraft || emptyLoadout(), me = getMe();
    const current = me?.crateEquipment || data.run?.equipment;
    return `<h3>For your next new village</h3><p class="crate-important">Saving changes your future loadout only. Returning to an existing village, changing roles, or reconnecting never grants more gear, food, or durability.</p><p>Armor reduces enemy damage remaining after your shield, capped at 25%. One utility slot means you choose one carrying, pack, or durability benefit.</p><div class="crate-loadout">${LOADOUT_SLOTS.map(slot => `<label>${esc(slot === 'kit' ? 'Starting kit' : label(slot))}<select id="crate-slot-${slot}" data-crate-slot="${slot}"${busy ? ' disabled' : ''}><option value="">None</option>${CRATE_ITEMS.filter(item => item.slot === slot && owns(item.id)).map(item => `<option value="${item.id}"${draft[slot] === item.id ? ' selected' : ''}>${esc(item.name)}</option>`).join('')}</select><small>${esc(crateItem(draft[slot])?.description || 'No item selected.')}</small></label>`).join('')}<label>Kit gathering tool<select id="crate-slot-tool" data-crate-slot="tool"${busy ? ' disabled' : ''}>${GATHERING_TOOLS.map(tool => `<option value="${tool}"${draft.tool === tool ? ' selected' : ''}>${label(tool)}</option>`).join('')}</select><small>Used only when your chosen starting kit includes a tool.</small></label></div><label class="crate-toggle"><input id="crate-reserve-ember" type="checkbox"${draft.reserveEmber ? ' checked' : ''}${busy ? ' disabled' : ''}> Reserve an existing Phoenix Ember for my next new run</label><p>${pretty(data.charges?.available)} unreserved / ${pretty(data.charges?.total)} total charges. A reservation uses an existing charge; it creates no new Ember. At most one self-revival is available per village run. An active reservation stays with its village until used, forfeited, or the run ends.</p>${button(loadoutDirty ? 'Save future loadout' : 'Future loadout saved', saveLoadout, busy || Boolean(pending) || !loadoutDirty, 'primary-button')}<h3>Current run equipment</h3>${current ? '<div class="crate-current">' + LOADOUT_SLOTS.filter(slot => slot !== 'kit').map(slot => `<div><span>${label(slot)}</span><strong>${esc(crateItem(current[slot])?.name || 'None')}</strong></div>`).join('') + '</div>' : '<p>You are in the village lobby. Your selected loadout is granted once when you first join a new village; returning to a village never refills it.</p>'}<p>${data.run?.forfeited ? 'Current run gear and Ember eligibility were forfeited by manual respawn.' : data.run?.phoenixAvailable ? 'This run has a Phoenix Ember available while downed.' : 'No Phoenix Ember is available in this run.'}</p><p class="crate-small">Ordinary revivals preserve physical gear. Manual dawn respawn loses current gear and bound kit supplies, while permanent unlocks remain. Kit food cannot be sold, donated, traded, or stored. Purchased replacement gathering tools receive the Miner’s buckle durability bonus; starting-kit tools do not.</p>`;
  }
  function milestones() {
    const nights = Number(data.nights) || 0, next = Math.floor(nights / 10 + 1) * 10;
    return `<h3>${pretty(nights)} lifetime nights credited</h3><p>A night counts when you were online and alive for at least half its actual duration and the keep survived dawn. Village day numbers alone do not count. Milestone rewards pay once per account across villages.</p><div class="crate-milestone-next"><strong>Next: ${pretty(next)} credited nights</strong><span>${esc(CRATE_TIERS[crateMilestoneTier(next)]?.label)} crate${next === 100 ? ' + Sunforged Viking Helm' : ''}</span><progress value="${nights % 10}" max="10" aria-label="Progress toward next crate"></progress></div><table class="crate-milestone-table"><thead><tr><th>Lifetime credited nights</th><th>Reward</th></tr></thead><tbody><tr><td>10 · 20 · 30</td><td>Basic crate at each milestone</td></tr><tr><td>40 · 50 · 60</td><td>Rare crate at each milestone</td></tr><tr><td>70 · 80 · 90</td><td>Epic crate at each milestone</td></tr><tr><td>100, then every ten</td><td>Legendary crate at each milestone</td></tr></tbody></table><div class="crate-helmet">${image('sunforged_viking_helm')}<div><p class="eyebrow">THE HUNDREDTH WATCH</p><h3>Sunforged Viking Helm</h3><p>${owns('sunforged_viking_helm') ? '✓ Permanently earned' : `${pretty(nights)} / 100 lifetime nights`} · Awarded directly at 100 nights, in addition to your Legendary crate.</p><p>6% enemy damage reduction. Last Stand: once each night, surviving an enemy hit that crosses below 25% health grants a 20-point ward for ten seconds. It protects against later hits; it never revives you.</p></div></div>`;
  }
  function opening() {
    if (!result) return `<div class="crate-wait"><span aria-hidden="true">◈</span><h3>${busy ? 'Saving your opening…' : pending ? 'Your saved opening needs a connection.' : 'Ready when you are.'}</h3><p>${busy ? 'Your reward will be revealed after the opening is saved.' : pending ? 'Check the saved opening to recover the same result. This does not buy a second crate.' : 'Choose a crate to open.'}</p></div>`;
    const item = crateItem(result.itemId);
    if (spinning) {
      const reel = crateReel(result);
      return `<h3>Opening ${esc(CRATE_TIERS[result.tier]?.label)} crate</h3><div class="crate-reel" role="img" aria-label="The saved crate reward is being revealed"><div class="crate-reel-pointer" aria-hidden="true"></div><div class="crate-reel-track" style="--crate-stop:${reel.stop * 148}px" aria-hidden="true">${reel.items.map(id => `<div class="crate-reel-card">${image(id).replace('loading="lazy"','loading="eager"')}<strong>${esc(crateItem(id)?.name || id)}</strong></div>`).join('')}</div></div><p>Your reward is already saved. Passing cards are decorative; Skip reveals the same result.</p>${button('Skip animation', finishSpin)}`;
    }
    return `<section class="crate-result" aria-live="polite">${image(result.itemId, 'crate-result-image')}<div><p class="eyebrow">${esc(result.chargeGranted ? 'EMBER CHARGE RECEIVED' : result.duplicate ? 'PERMANENT DUPLICATE' : 'NEW PERMANENT UNLOCK')}</p><h3>${esc(item?.name || result.itemId)}</h3><p>${esc(item?.description || '')}</p><strong>${esc(crateResultText(result))}</strong><p>${result.funding === 'earned' ? 'Earned milestone crate' : `Paid ${pretty(result.paid)} ${currencyName(result.funding)}`} · ${esc(CRATE_TIERS[result.tier]?.label)} · ${esc(crateOdds(result.tier))}</p><p>${result.chargeGranted ? 'Keep it in reserve or select Reserve an existing Phoenix Ember for a future new run.' : 'This result does not replace or refill the equipment in your current village.'}</p><div class="panel-actions">${button('Future loadout', () => setView('loadout'))}${button('Open crates', () => setView('shop'))}</div></div></section>`;
  }
  function render() {
    if (!currentAccount()) return;
    handlers = [];
    const nav = [['shop', 'Open crates'], ['collection', 'Collection'], ['loadout', 'Future loadout'], ['milestones', 'Milestones']];
    let html = '<div class="crates-panel"><p class="eyebrow">YOUR LASTING EQUIPMENT</p><h2>Crates & equipment</h2>';
    if (data) html += `<div class="crate-balances"><div><span>PERSONAL BANK</span><strong>${pretty(data.bank)} gold</strong></div><div><span>CRATE CREDITS</span><strong>${pretty(data.credits)}</strong></div><div><span>LIFETIME NIGHTS</span><strong>${pretty(data.nights)}</strong></div></div><nav class="crate-nav" aria-label="Crate sections">${nav.map(([id, text]) => button(text, () => setView(id), busy || spinning, view === id ? 'secondary-button selected' : 'secondary-button')).join('')}</nav>`;
    if (error) html += `<p class="crate-error" role="alert">${esc(error)}</p>`;
    if (success) html += `<p class="crate-success" role="status">${esc(success)}</p>`;
    if (pending && !busy) html += `<div class="crate-recovery"><p>One opening is awaiting confirmation. Its original payment and result will be recovered with the same receipt.</p>${button('Check saved opening', () => refresh(), false)}</div>`;
    if (!data) html += `<p>${busy ? 'Loading your saved equipment…' : 'Load your saved equipment and balances.'}</p>${button('Load account', () => refresh(), busy)}`;
    else html += view === 'shop' ? shop() : view === 'collection' ? collection() : view === 'loadout' ? loadout() : view === 'milestones' ? milestones() : opening();
    html += `<label class="crate-toggle crate-motion"><input id="crate-skip-motion" type="checkbox"${skipAnimations || reducedMotion() ? ' checked' : ''}> Skip crate animations</label><p class="crate-small">Unlocks, credits, and unused Ember charges stay with your account. No real-money purchase is offered.</p></div>`;
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
