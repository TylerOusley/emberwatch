import { itemArt } from './shop-display.js';
import { PET_CATALOG, PET_RARITIES, PET_RARITY_ORDER, PET_RULES, petIncubationRemaining } from '../../shared/pets.js';
import { BUILDINGS } from '../../shared/world.js';
import { canUseBuilding } from '../../shared/access.js';
import { capturePanelDetails, restorePanelDetails } from './panel-refresh.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const number = value => Number(value || 0).toLocaleString('en-US');
const safeStorage = () => { try { return globalThis.localStorage; } catch { return null; } };
const safeAsset = value => typeof value === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(value);
const positive = value => Number.isFinite(value) && value > 0;
const timerText = seconds => seconds > 0 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : 'Checking the hatch…';
const rarityName = rarity => PET_RARITIES[rarity]?.name ?? 'Companion';

// Only owned snapshot entries become collection cards. Catalog fallbacks support
// older snapshots; they never predict the contents of an incubating egg.
export function petCollectionModel(pets, filter = 'all') {
  return (pets?.collection ?? []).map(entry => {
    const info = { ...(PET_CATALOG[entry.id] ?? {}), ...entry };
    const rarity = Object.hasOwn(PET_RARITIES, info.rarity ?? '') ? info.rarity : 'unknown';
    const attack = info.attack && positive(info.attack.damage) && positive(info.attack.cooldown) ? info.attack : null;
    const carryBonus = positive(info.carryBonus) ? info.carryBonus : 0;
    return { ...info, rarity, attack, carryBonus, equipped: pets.equippedId === entry.id,
      thumbnail: safeAsset(info.assetId) ? `/assets/pets/${info.assetId}/thumbnail.png` : null,
      effect: carryBonus ? `+${Math.round(carryBonus * 100)}% carrying capacity` : attack ? `${number(attack.damage)} damage · Every ${number(attack.cooldown)}s` : 'Companion',
      perk: attack?.healOnHit > 0 ? `Restores ${number(attack.healOnHit)} HP to you per successful hit.` : '' };
  }).filter(pet => filter === 'all' || pet.rarity === filter).sort((a, b) => Number(b.equipped) - Number(a.equipped) || PET_RARITY_ORDER.indexOf(b.rarity) - PET_RARITY_ORDER.indexOf(a.rarity) || String(a.name).localeCompare(String(b.name)) || String(a.id).localeCompare(String(b.id)));
}

function portrait(pet) {
  const initials = String(pet.name || 'Companion').trim().split(/\s+/).slice(0, 2).map(word => [...word][0] ?? '').join('').toUpperCase();
  return `<span class="pet-portrait pet-rarity-${pet.rarity}" role="img" aria-label="${esc(pet.name)} illustration"><span class="pet-portrait-fallback" aria-hidden="true">${esc(initials)}</span>${pet.thumbnail ? `<img src="${pet.thumbnail}" alt="" loading="lazy" decoding="async" data-pet-thumbnail>` : ''}</span>`;
}

function hatchMessage(hatch) {
  if (!hatch.duplicate) return `${hatch.name || 'Your companion'} hatched! A permanent companion has joined your collection.`;
  return hatch.refundPaid === false
    ? `${hatch.name || 'Companion'} duplicate · ${number(hatch.refundGold ?? PET_RULES.duplicateRefund)} gold awaiting bank space.`
    : `${hatch.name || 'Companion'} duplicate · ${number(hatch.refundGold ?? PET_RULES.duplicateRefund)} bank gold returned.`;
}

export function createPetsUI({ api, getState = () => null, getMe = () => null, getAccountKey = () => getMe()?.id,
  getActivePanel, openPanel, toast = () => {}, document: doc = globalThis.document, storage = safeStorage(),
  makeRequestId = () => globalThis.crypto.randomUUID(), clock = () => globalThis.performance?.now() ?? Date.now(),
  schedule = (fn, ms) => setTimeout(fn, ms), cancel = id => clearTimeout(id) }) {
  let owner = null, generation = 0, viewRevision = 0, data = null, pending = null, busy = false, error = '', success = '', signature = '', callbacks = [];
  let rarityFilter = 'all', pressed = null, releaseTimer = null, redrawPending = false, tickTimer = null, lastHatchCheck = -Infinity;
  let serverAnchor = null, localAnchor = 0, seenHatches = null;
  const completedVisits = new Set();
  const active = () => getActivePanel() === 'pets';
  const content = () => doc.getElementById('panel-content');
  const storageKey = () => `emberwatch-pets:${owner}:purchase`;
  const current = (account, token) => account === owner && account === getAccountKey() && token === generation;
  function savePending(next) {
    try {
      if (!storage) throw new Error();
      if (next) storage.setItem(storageKey(), JSON.stringify(next)); else storage.removeItem(storageKey());
    } catch {
      if (next) throw new Error('Enable browser storage before buying an egg so an interrupted purchase can be recovered.');
    }
    pending = next;
  }
  function account() {
    const next = getAccountKey();
    if (next !== owner) {
      clear(); owner = next;
      try {
        const saved = JSON.parse(storage?.getItem(storageKey()) ?? 'null');
        if (saved?.kind === 'pet_buy_egg' && typeof saved.requestId === 'string' && typeof saved.villageId === 'string' && typeof saved.visitId === 'string') pending = saved;
      } catch {}
    }
    return Boolean(owner);
  }
  function button(label, callback, disabled = false, primary = false, key = label, extra = '') {
    const id = callbacks.push(callback) - 1;
    return `<button type="button" data-pet-action="${id}" data-pet-focus="${esc(key)}"${disabled || busy ? ' disabled' : ''}${primary ? ' class="pet-primary"' : ''} ${extra}>${esc(label)}</button>`;
  }
  // A previous village can briefly remain while a different account signs in.
  const liveSnapshot = () => getMe()?.id === owner ? getState()?.pets : null;
  function merchantOffer(pets = snapshot()) {
    const offer = liveSnapshot()?.merchant ?? pets?.merchant;
    return offer && completedVisits.has(`${getState()?.id}/${offer.visitId}`) ? { ...offer, available: false, stock: 0, message: 'This visit’s egg has been sold.' } : offer;
  }
  const atMerchant = () => {
    const me = getMe();
    return Boolean(me?.id === owner && canUseBuilding(me, BUILDINGS.find(building => building.id === 'merchant')) && !me.downed && me.hp > 0);
  };
  function snapshot() {
    const live = liveSnapshot();
    return live && (!data || live.serverNow > data.serverNow) ? live : data;
  }
  function serverTime(pets) {
    if (!Number.isFinite(pets?.serverNow)) return 0;
    if (serverAnchor === null || pets.serverNow > serverAnchor) { serverAnchor = pets.serverNow; localAnchor = clock(); }
    return serverAnchor + Math.max(0, clock() - localAnchor);
  }
  const eggsNow = pets => (pets?.eggs ?? []).map(egg => ({ ...egg, remaining: petIncubationRemaining(egg.hatchAt, serverTime(pets)) }));
  const renderSignature = pets => JSON.stringify([pets?.enabled, pets?.collection, pets?.equippedId, pets?.recentHatches, pets?.pendingRefundGold,
    eggsNow(pets).map(egg => [egg.id, egg.remaining]), merchantOffer(pets), getMe()?.wallet, atMerchant(), pending, busy, error, success, rarityFilter]);
  function observeHatches(pets) {
    if (!pets) return;
    const receipts = pets?.recentHatches ?? [];
    if (seenHatches) for (const hatch of receipts) {
      const key = `${hatch.eggId}:${hatch.refundPaid !== false}`;
      if (!seenHatches.has(key)) toast(hatchMessage(hatch));
    }
    seenHatches = new Set(receipts.map(hatch => `${hatch.eggId}:${hatch.refundPaid !== false}`));
  }
  function queueTick() {
    cancel(tickTimer); tickTimer = null;
    if (!active() || !snapshot()?.eggs?.length) return;
    const who = owner;
    tickTimer = schedule(() => {
      tickTimer = null;
      if (!active() || who !== owner || who !== getAccountKey()) return;
      update();
      if (!busy && !pressed && releaseTimer === null && eggsNow(snapshot()).some(egg => egg.remaining === 0) && clock() - lastHatchCheck >= 5000) {
        lastHatchCheck = clock(); void load();
      }
      queueTick();
    }, 1000);
  }
  function release() {
    cancel(releaseTimer); releaseTimer = null; pressed = null;
    if (redrawPending) { redrawPending = false; render(); }
  }
  function hold(node) {
    node.onpointerdown = event => { if ((event?.button ?? 0) === 0 && !node.disabled) { cancel(releaseTimer); releaseTimer = null; pressed = node; } };
    node.onkeydown = event => { if ([' ', 'Enter'].includes(event.key) && !node.disabled) { cancel(releaseTimer); releaseTimer = null; pressed = node; } };
    const later = () => { cancel(releaseTimer); releaseTimer = schedule(release, 0); };
    node.onpointerup = node.onpointerleave = later;
    node.onkeyup = event => { if ([' ', 'Enter'].includes(event.key)) later(); };
    node.onpointercancel = node.onblur = release;
  }
  function render() {
    if (!active()) return;
    if (pressed || releaseTimer !== null) { redrawPending = true; return; }
    const details = capturePanelDetails(content()), focusedKey = doc.activeElement?.dataset?.petFocus;
    const dialog = doc.getElementById('panel-dialog'), scroll = dialog?.scrollTop ?? 0;
    callbacks = [];
    const pets = snapshot(), me = getMe(), offer = merchantOffer(pets);
    observeHatches(pets);
    let html = `<section class="pets-menu"><header class="pets-heading"><span>${itemArt('pet_egg')}</span><div><p class="eyebrow">YOUR COMPANIONS</p><h2>Pets & eggs</h2><p>Your collection stays with your account. Equip one companion at a time.</p></div></header>`;
    if (error) html += `<p class="pet-notice error" role="alert">${esc(error)}</p>`;
    if (success) html += `<p class="pet-notice" role="status">${esc(success)}</p>`;
    if (pending) html += `<div class="pet-notice"><p>A previous egg purchase needs its saved result checked. Checking it will not buy a second egg.</p>${button('Check saved purchase', () => purchase(), false, true)}</div>`;
    if (!pets) html += '<p role="status">Loading your companions…</p>';
    else {
      if (!pets.enabled) html += '<div class="pet-empty"><h3>Companions are coming soon.</h3><p>Your eggs and permanent pet collection will appear here.</p></div>';
      const collection = petCollectionModel(pets), equipped = collection.find(pet => pet.equipped);
      if (equipped) html += `<section class="pet-equipped pet-rarity-${equipped.rarity}" aria-label="Equipped companion">${portrait(equipped)}<div><span class="pet-tag">Equipped · ${rarityName(equipped.rarity)}</span><h3>${esc(equipped.name)}</h3><strong>${esc(equipped.effect)}</strong>${equipped.perk ? `<p>${esc(equipped.perk)}</p>` : ''}</div>${button('Let rest', () => equip(''), false, false, 'rest')}</section>`;
      else if (pets.enabled) html += '<p class="pet-equipped-empty">No companion equipped. Choose a hatched pet below.</p>';
      const eggs = eggsNow(pets);
      if (eggs.length) {
        html += `<h3>Incubating eggs <span>${eggs.length}</span></h3><div class="pet-eggs">`;
        for (const egg of eggs) {
          const progress = Math.max(0, Math.min(100, (1 - egg.remaining / PET_RULES.incubationSeconds) * 100));
          html += `<article class="pet-egg-card"><span class="pet-egg-art">${itemArt('pet_egg')}</span><div><h4>Mysterious egg</h4><strong class="pet-countdown" aria-label="Time until hatch">${timerText(egg.remaining)}</strong><progress max="100" value="${progress}" aria-label="Egg incubation progress"></progress></div></article>`;
        }
        html += '</div><p class="pet-help">The 30-minute timer continues while you are away and between villages. Your companion is revealed when it hatches.</p>';
      }
      const hatches = [...(pets.recentHatches ?? [])].sort((a, b) => b.hatchedAt - a.hatchedAt || String(a.eggId).localeCompare(String(b.eggId)));
      if (hatches.length) {
        const receipts = rows => rows.map(hatch => `<li class="${hatch.duplicate ? 'is-duplicate' : ''}"><strong>${esc(hatch.name || 'Companion')} ${hatch.duplicate ? '· Duplicate' : '· Hatched'}</strong><span>${esc(hatch.duplicate ? hatchMessage(hatch).split(' · ').slice(1).join(' · ') : `${rarityName(hatch.rarity)} · Permanent unlock`)}</span></li>`).join('');
        html += `<section class="pet-hatches"><h3>Recent hatches</h3><ul>${receipts(hatches.slice(0, 3))}</ul>${hatches.length > 3 ? `<details data-persist="pet-hatch-history"><summary>Earlier hatches · ${hatches.length - 3}</summary><ul>${receipts(hatches.slice(3))}</ul></details>` : ''}</section>`;
      }
      if (pets.pendingRefundGold > 0) html += `<p class="pet-notice" role="status">${number(pets.pendingRefundGold)} gold from duplicate hatches is awaiting bank space. It remains owed to your account.</p>`;
      if (pets.enabled || collection.length) {
        html += `<h3>Your pets <span>${collection.length} collected</span></h3>`;
        if (collection.length > 6) html += `<nav class="pet-filters" aria-label="Filter pets by rarity">${[['all', 'All'], ...PET_RARITY_ORDER.map(id => [id, rarityName(id)])].map(([id, name]) => button(name, () => { rarityFilter = id; render(); }, false, false, `filter-${id}`, `aria-pressed="${rarityFilter === id}"`)).join('')}</nav>`;
        else rarityFilter = 'all';
        const visible = petCollectionModel(pets, rarityFilter);
        html += '<div class="pet-grid">';
        for (const pet of visible) {
          html += `<article class="pet-card pet-rarity-${pet.rarity}${pet.equipped ? ' is-equipped' : ''}" data-pet-id="${esc(pet.id)}">${portrait(pet)}<span class="pet-tag">${rarityName(pet.rarity)} · ${pet.equipped ? 'Equipped' : 'Permanent unlock'}</span><h4>${esc(pet.name)}</h4><strong class="pet-effect">${esc(pet.effect)}</strong>${pet.attack ? `<small>${pet.attack.kind === 'ranged' ? 'Ranged' : 'Melee'}${pet.flying ? ' · Flying' : ''}${positive(pet.attack.range) ? ` · ${number(pet.attack.range)}m range` : ''}</small>` : '<small>Carry companion</small>'}${pet.perk ? `<p class="pet-perk">${esc(pet.perk)}</p>` : ''}${!pet.attack && !pet.carryBonus && pet.description ? `<p>${esc(pet.description)}</p>` : ''}${button(pet.equipped ? 'Equipped' : pet.available ? 'Equip companion' : 'Currently unavailable', () => equip(pet.id), pet.equipped || !pet.available, !pet.equipped, `equip-${pet.id}`)}</article>`;
        }
        if (!visible.length) html += `<div class="pet-empty"><p>${collection.length ? 'No collected companions of this rarity yet.' : 'No companions hatched yet. Check the traveling merchant for an egg.'}</p></div>`;
        html += '</div>';
      }
      if (pets.enabled) {
        const nearby = atMerchant(), canBuy = offer?.available && nearby && me.wallet >= offer.price && !pending;
        const expectedOffer = { villageId: getState()?.id, visitId: offer?.visitId, price: offer?.price };
        html += `<section class="pet-merchant"><div><p class="eyebrow">TRAVELING MERCHANT</p><h3>Mysterious egg · ${number(offer?.price ?? PET_RULES.eggPrice)} gold</h3><p>${esc(offer?.message || 'Look for an egg on a future merchant visit.')}</p><small>${!nearby ? 'Visit the merchant’s front counter to buy.' : offer?.available && me.wallet < offer.price ? 'Not enough wallet gold.' : 'Egg purchases use wallet gold.'}</small></div>${button('Buy egg', () => purchase(expectedOffer), !canBuy, true)}</section>`;
        html += `<section class="pet-odds"><h3>Every mysterious egg has the same odds</h3><dl>${PET_RARITY_ORDER.map(id => `<div class="pet-rarity-${id}" data-pet-odds="${id}"><dt>${rarityName(id)}</dt><dd>${PET_RARITIES[id].chance}%</dd></div>`).join('')}</dl><p>The merchant has a ${PET_RULES.merchantChancePercent}% chance to offer one egg per visit, shared by the village. Eggs hatch after 30 real minutes.</p><details data-persist="pet-odds-help"><summary>How hatches and duplicates work</summary><p>Within the rolled rarity, an unowned companion is preferred. Completing a rarity does not change these odds: a duplicate hatch returns ${number(PET_RULES.duplicateRefund)} gold to your bank.</p></details></section>`;
      }
    }
    html += `<footer class="pet-footer">${button('Refresh collection', () => load())}<span>One equipped pet · Permanent collection<br><a href="/assets/pets/CREDITS.html" target="_blank" rel="noopener noreferrer">Pet art credits ↗</a></span></footer></section>`;
    openPanel(html, 'pets');
    if (dialog) dialog.scrollTop = scroll;
    restorePanelDetails(content(), details);
    const renderedOwner = owner, revision = ++viewRevision;
    for (const node of content()?.querySelectorAll('[data-pet-action]') ?? []) {
      const callback = callbacks[Number(node.dataset.petAction)];
      hold(node);
      node.onclick = () => {
        try { if (!node.disabled && active() && revision === viewRevision && renderedOwner === owner && renderedOwner === getAccountKey()) return callback?.(); }
        finally { release(); }
      };
      if (focusedKey && node.dataset.petFocus === focusedKey) node.focus?.({ preventScroll: true });
    }
    for (const node of content()?.querySelectorAll('[data-pet-thumbnail]') ?? []) {
      node.onload = () => { if (node.previousElementSibling) node.previousElementSibling.hidden = true; };
      node.onerror = () => { node.hidden = true; if (node.previousElementSibling) node.previousElementSibling.hidden = false; };
      if (node.complete && node.naturalWidth > 0) node.onload();
    }
    signature = renderSignature(pets); queueTick();
  }
  async function load() {
    if (busy || !account()) return;
    const token = ++generation, who = owner;
    busy = true; error = ''; render();
    try { const result = await api('/api/pets'); if (current(who, token)) data = result.pets; }
    catch (failure) { if (current(who, token)) error = failure.message || 'Your companions could not be loaded.'; }
    finally { if (current(who, token)) { busy = false; render(); } }
  }
  async function equip(petId) {
    if (busy || !account()) return;
    if (petId && !snapshot()?.collection?.some(pet => pet.id === petId && pet.available)) { error = 'Choose an available companion from your collection.'; render(); return; }
    await mutate({ kind: 'pet_equip', petId });
  }
  async function purchase(expected = null) {
    if (busy || !account()) return;
    if (!pending) {
      const village = getState(), pets = liveSnapshot(), offer = merchantOffer();
      if (!pets?.enabled || !offer?.available || !village?.id) { error = 'Check the current merchant egg offer.'; render(); return; }
      if (expected && (expected.villageId !== village.id || expected.visitId !== offer.visitId || expected.price !== offer.price)) { error = 'The merchant offer changed. Review it before buying an egg.'; render(); return; }
      if (!atMerchant()) { error = 'Visit the merchant’s front counter after recovering to buy an egg.'; render(); return; }
      if (getMe().wallet < offer.price) { error = 'Not enough wallet gold.'; render(); return; }
      try { savePending({ kind: 'pet_buy_egg', villageId: village.id, visitId: offer.visitId, requestId: makeRequestId() }); }
      catch (failure) { error = failure.message; render(); return; }
    }
    await mutate(pending);
  }
  async function mutate(action) {
    const token = ++generation, who = owner;
    busy = true; error = ''; success = ''; render();
    try {
      const result = await api('/api/pets/action', { method: 'POST', body: JSON.stringify(action) });
      if (!current(who, token)) return;
      data = result.pets; success = result.message || 'Companions updated.';
      if (action.kind === 'pet_buy_egg') { completedVisits.add(`${action.villageId}/${action.visitId}`); savePending(null); }
      toast(success);
    } catch (failure) {
      if (!current(who, token)) return;
      error = failure.message || 'The request did not finish. Check its saved result before buying again.';
      // Definite validation failures have no committed purchase. Uncertain
      // responses retain the exact receipt through close, reconnect and reload.
      if (action.kind === 'pet_buy_egg' && [400, 403, 404, 409].includes(failure.status)) savePending(null);
    } finally { if (current(who, token)) { busy = false; render(); } }
  }
  function update() {
    if (!active() || !account() || busy) return;
    if (renderSignature(snapshot()) !== signature) render();
  }
  function clear() {
    generation++; viewRevision++; cancel(tickTimer); cancel(releaseTimer); tickTimer = null; releaseTimer = null;
    owner = null; data = null; pending = null; busy = false; error = ''; success = ''; signature = ''; callbacks = [];
    rarityFilter = 'all'; pressed = null; redrawPending = false; serverAnchor = null; localAnchor = 0; seenHatches = null; lastHatchCheck = -Infinity; completedVisits.clear();
  }
  return {
    show() { if (!account()) { toast('Sign in to view your companions.'); return; } cancel(releaseTimer); releaseTimer = null; pressed = null; redrawPending = false; data = liveSnapshot() ?? data; openPanel('', 'pets'); render(); return load(); },
    update, clear
  };
}
