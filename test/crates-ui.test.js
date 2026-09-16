import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCratesUI, crateOdds, crateReel, crateResultText } from '../public/src/crates-ui.js';
import { CRATE_POOLS, CRATE_PRICES, LOADOUT_SLOTS, emptyLoadout } from '../shared/crates.js';
import { CRATE_TIERS, crateItem } from '../public/src/crate-catalog.js';

const clone = value => structuredClone(value);
const plainText = value => value.replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|#39);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }[entity])).replace(/\s+/g, ' ').trim();
function elementsWithClass(html, className) {
  const matches = [...html.matchAll(/<([a-z][a-z0-9-]*)\b[^>]*class="([^"]*)"[^>]*>/g)].filter(match => match[2].split(/\s+/).includes(className));
  return matches.map(match => html.slice(match.index, html.indexOf(`</${match[1]}>`, match.index) + match[1].length + 3));
}
function assertRealItemImage(html, expectedId) {
  const images = [...html.matchAll(/<img\b([^>]*)>/g)];
  assert.ok(images.length, 'Artwork must use an image');
  const image = expectedId ? images.find(match => match[1].includes(`src="/assets/crate-items/${expectedId}.png"`)) : images[0];
  assert.ok(image, `Missing artwork for ${expectedId || 'item'}`);
  const source = image[1].match(/\bsrc="([^"]+)"/)?.[1];
  assert.match(source, /^\/assets\/crate-items\/[a-z0-9_]+\.png$/);
  assert.match(image[1], /\balt="[^"]*"/);
  const png = readFileSync(new URL(`../public${source}`, import.meta.url));
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), `Invalid PNG: ${source}`);
  assert.ok(png.readUInt32BE(16) > 32 && png.readUInt32BE(20) > 32, `Artwork is too small: ${source}`);
}
function memory() { const values = new Map(); return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; }
function snapshot() { return { nights: 99, bank: 200000, credits: 20000, unlocks: ['padded_cap', 'mining_pack'], loadout: emptyLoadout(), earnedCrates: [{ id: 'grant-basic', tier: 'basic', milestone: 10 }], history: [], charges: { total: 2, available: 1, reserved: 1 }, run: { villageId: 'v1', forfeited: false, phoenixAvailable: true } }; }
function fixture(options = {}) {
  const data = options.data || snapshot(), storage = options.storage === undefined ? memory() : options.storage, requests = [], accountUpdates = [], timers = new Map(), fields = new Map();
  let account = options.account || 'alice', html = '', panel = null, buttons = [], selects = [], nodes = [], renders = 0, nextId = 0, nextTimer = 0;
  const me = { id: account, crateEquipment: { head: 'iron_coif', body: '', feet: '', utility: '' }, inventory: { food: 4 } };
  const content = { contains: node => nodes.includes(node), querySelectorAll: selector => selector === '[data-crate-action]' ? buttons : selector === '[data-crate-slot]' ? selects.filter(select => select.dataset.crateSlot) : [] };
  const dialog = { scrollTop: 0 }, doc = { activeElement: null, getElementById: id => id === 'panel-content' ? content : id === 'panel-dialog' ? dialog : fields.get(id) || null };
  function render(next, nextPanel) {
    html = next; panel = nextPanel; renders++; fields.clear();
    buttons = [...html.matchAll(/<button\b([^>]*)>(.*?)<\/button>/gs)].map(match => ({ tagName: 'BUTTON', dataset: { crateAction: match[1].match(/data-crate-action="(\d+)"/)[1] }, text: plainText(match[1].match(/\baria-label="([^"]*)"/)?.[1] ?? match[2]), disabled: /\sdisabled(?:\s|$)/.test(match[1]) }));
    selects = [...html.matchAll(/<select\b([^>]*)>(.*?)<\/select>/gs)].map(match => {
      const choices = [...match[2].matchAll(/<option\b([^>]*)>(.*?)<\/option>/gs)];
      const selected = choices.find(choice => /\sselected(?:\s|$)/.test(choice[1])) || choices[0];
      const node = { tagName: 'SELECT', id: match[1].match(/id="([^"]+)"/)[1], dataset: { crateSlot: match[1].match(/data-crate-slot="([^"]+)"/)?.[1] }, value: selected?.[1].match(/value="([^"]*)"/)?.[1] || '', choices: choices.map(choice => choice[1].match(/value="([^"]*)"/)?.[1]), focus() { doc.activeElement = node; } };
      fields.set(node.id, node); return node;
    });
    for (const match of html.matchAll(/<input\b([^>]*)>/g)) { const node = { tagName: 'INPUT', id: match[1].match(/id="([^"]+)"/)[1], checked: /\schecked(?:\s|$)/.test(match[1]), focus() { doc.activeElement = node; } }; fields.set(node.id, node); }
    nodes = [...buttons, ...fields.values()];
  }
  const defaultApi = async (path, settings) => {
    if (!settings) return { crates: clone(data) };
    const action = JSON.parse(settings.body);
    if (action.kind === 'crate_loadout') { data.loadout = clone(action.loadout); return { crates: clone(data) }; }
    let result = data.history.find(item => item.requestId === action.requestId);
    if (!result) {
      const tier = action.tier || data.earnedCrates.find(grant => grant.id === action.grantId).tier;
      const funding = action.grantId ? 'earned' : action.currency, paid = funding === 'earned' ? 0 : CRATE_PRICES[tier][funding];
      if (funding !== 'earned') data[funding] -= paid;
      const itemId = options.resultId || CRATE_POOLS[tier][0];
      result = { id: 'result-' + action.requestId, requestId: action.requestId, tier, funding, paid, itemId, duplicate: data.unlocks.includes(itemId), refund: null, chargeGranted: itemId === 'phoenix_ember' };
      if (!data.unlocks.includes(itemId) && itemId !== 'phoenix_ember') data.unlocks.push(itemId);
      if (result.chargeGranted) data.charges.total++;
      data.history.unshift(result); data.earnedCrates = data.earnedCrates.filter(grant => grant.id !== action.grantId);
    }
    return { crates: clone(data), result: clone(result) };
  };
  const api = async (path, settings) => { const action = settings ? JSON.parse(settings.body) : null; requests.push({ path, action }); return options.api ? options.api(path, settings, defaultApi) : defaultApi(path, settings); };
  const ui = createCratesUI({ getMe: () => me, getAccountKey: () => account, getActivePanel: () => panel, openPanel: render, api, onAccountUpdate: next => accountUpdates.push({ account, data: clone(next) }), document: doc, storage, reducedMotion: () => Boolean(options.reducedMotion), makeRequestId: () => `request-${++nextId}`, schedule: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; }, cancel: id => timers.delete(id) });
  return { ui, data, me, storage, requests, accountUpdates, timers, fields, doc, get account() { return account; }, get html() { return html; }, get buttons() { return buttons; }, get renders() { return renders; }, setAccount(value) { account = value; me.id = value; }, close() { panel = null; }, async click(text) { const button = buttons.find(b => b.text === text); assert.ok(button, `Missing button: ${text}`); assert.equal(button.disabled, false, `Disabled button: ${text}`); return button.onclick(); }, field(id, value) { const field = fields.get(id); assert.ok(field, `Missing field ${id}`); if (typeof value === 'boolean') field.checked = value; else field.value = value; return field.onchange(); } };
}

test('tier pools are transparent 4/6/4/5 and the reel stop is exactly the committed result', () => {
  assert.equal(crateOdds('basic'), '1 in 4 · 25% each'); assert.equal(crateOdds('rare'), '1 in 6 · 16.67% each'); assert.equal(crateOdds('legendary'), '1 in 5 · 20% each');
  assert.equal(Object.values(CRATE_POOLS).flat().length, 19);
  for (const [tier, items] of Object.entries(CRATE_POOLS)) for (const itemId of items) { const reel = crateReel({ tier, itemId }); assert.equal(reel.items[reel.stop], itemId); assert.ok(reel.items.every(id => items.includes(id))); }
  assert.match(crateResultText({ chargeGranted: true, duplicate: true, refund: { amount: 70000, currency: 'bank' } }), /no duplicate refund/);
});

test('purchase view exposes currency-specific duplicate refunds and expanded item odds before purchase', async () => {
  const f = fixture(); await f.ui.show();
  assert.match(f.html, /700 bank gold \(70%\)/); assert.match(f.html, /Wallet gold, village funds, and loan credit are never charged/);
  await f.click('Rare'); assert.equal((f.html.match(/class="crate-item /g) || []).length, 6); assert.match(f.html, /16\.67% each/);
  f.field('crate-funding', 'credits'); assert.match(f.html, /700 crate credits \(70%\)/);
  await f.click('Legendary'); assert.match(f.html, /Every Phoenix Ember grants one charge, including repeats, with no refund/);
  assert.equal((f.html.match(/class="crate-item /g) || []).length, 5);
});

test('receipt is saved before the request; double click and Skip reveal one saved outcome', async () => {
  let resolve;
  const f = fixture({ api: async (path, settings, defaultApi) => { if (!settings) return defaultApi(path, settings); assert.ok([...f.storage.values.keys()].some(key => key.endsWith(':pending'))); await new Promise(done => { resolve = done; }); return defaultApi(path, settings); } });
  await f.ui.show(); const button = f.buttons.find(b => b.text === 'Open Basic · 1,000 bank gold');
  const pending = button.onclick(); button.onclick();
  assert.equal(f.requests.filter(request => request.action).length, 1); assert.match(f.html, /Saving your opening/); assert.doesNotMatch(f.html, /crate-reel-track/);
  resolve(); await pending;
  assert.match(f.html, /crate-reel-track/); assert.equal([...f.timers.values()][0].delay, 4000);
  await f.click('Skip animation'); assert.match(f.html, /Padded cap/); assert.doesNotMatch(f.html, /crate-reel-track/); assert.equal(f.timers.size, 0); assert.equal(f.data.bank, 199000); assert.equal(f.data.history.length, 1);
});

test('reduced motion shows the identical saved result with no reel or timer', async () => {
  const f = fixture({ reducedMotion: true, resultId: 'stout_leather_boots' }); await f.ui.show(); await f.click('Open Basic · 1,000 bank gold');
  assert.match(f.html, /Stout leather boots/); assert.match(f.html, /NEW PERMANENT UNLOCK/); assert.doesNotMatch(f.html, /crate-reel-track/); assert.equal(f.timers.size, 0);
});

test('a dropped response keeps its receipt and recovers the committed result without buying again', async () => {
  let fail = true;
  const f = fixture({ api: async (path, settings, defaultApi) => { const response = await defaultApi(path, settings); if (settings && fail) { fail = false; throw new Error('Network interrupted'); } return response; } });
  await f.ui.show(); await f.click('Open Basic · 1,000 bank gold');
  assert.match(f.html, /Check saved opening/); assert.ok([...f.storage.values.keys()].some(key => key.endsWith(':pending')));
  const reloaded = fixture({ data: f.data, storage: f.storage }); await reloaded.ui.show();
  assert.match(reloaded.html, /Padded cap/); assert.doesNotMatch(reloaded.html, /crate-reel-track/); assert.equal(reloaded.requests.filter(request => request.action).length, 0); assert.equal(reloaded.data.bank, 199000);
});

test('reloading during a reel restores the unrevealed saved result until it is acknowledged', async () => {
  const f = fixture(); await f.ui.show(); await f.click('Open Basic · 1,000 bank gold');
  assert.ok([...f.storage.values.keys()].some(key => key.endsWith(':reveal')));
  const reloaded = fixture({ data: f.data, storage: f.storage }); await reloaded.ui.show();
  assert.match(reloaded.html, /Padded cap/); assert.equal(reloaded.data.history.length, 1); await reloaded.click('Open crates');
  assert.ok(![...f.storage.values.keys()].some(key => key.endsWith(':reveal')));
});

test('transient unsaved attempts reuse the request ID while permanent validation failures clear it', async () => {
  let failed = false;
  const f = fixture({ reducedMotion: true, api: async (path, settings, defaultApi) => { if (settings && !failed) { failed = true; throw new Error('Connection lost'); } return defaultApi(path, settings); } });
  await f.ui.show(); await f.click('Open Basic · 1,000 bank gold'); await f.click('Check saved opening');
  const opens = f.requests.filter(request => request.action?.kind === 'crate_open'); assert.equal(opens.length, 2); assert.equal(opens[0].action.requestId, opens[1].action.requestId); assert.equal(f.data.bank, 199000);
  const denied = fixture({ api: async (path, settings, defaultApi) => { if (settings) throw Object.assign(new Error('Insufficient bank gold'), { status: 400 }); return defaultApi(path, settings); } });
  await denied.ui.show(); await denied.click('Open Basic · 1,000 bank gold'); assert.match(denied.html, /Insufficient bank gold/); assert.ok(![...denied.storage.values.keys()].some(key => key.endsWith(':pending'))); assert.doesNotMatch(denied.html, /Check saved opening/);
});

test('future loadout offers owned slots and saves without changing the current run or supplies', async () => {
  const f = fixture(), current = clone(f.me); await f.ui.show(); await f.click('Future loadout');
  assert.deepEqual(f.fields.get('crate-slot-head').choices, ['', 'padded_cap']); assert.deepEqual(f.fields.get('crate-slot-utility').choices, ['', 'mining_pack']);
  f.field('crate-slot-head', 'padded_cap'); f.field('crate-slot-utility', 'mining_pack'); f.field('crate-slot-tool', 'scythe'); f.field('crate-reserve-ember', true);
  await f.click('Save future loadout'); const sent = f.requests.at(-1).action;
  assert.deepEqual(sent, { kind: 'crate_loadout', loadout: { ...emptyLoadout(), head: 'padded_cap', utility: 'mining_pack', tool: 'scythe', reserveEmber: true } });
  assert.deepEqual(f.me, current); assert.match(f.html, /Saved for your next new village run/); assert.match(f.html, /Iron coif/); assert.match(f.html, /never grants more gear, food, or durability/);
});

test('live balances refresh while a button is focused and draft selection survives snapshots', async () => {
  const f = fixture(); await f.ui.show(); f.doc.activeElement = f.buttons[0];
  f.data.bank = 1234; f.ui.update(clone(f.data)); assert.match(f.html, /1,234 gold/);
  await f.click('Future loadout'); f.field('crate-slot-utility', 'mining_pack');
  const select = f.fields.get('crate-slot-utility'); f.doc.activeElement = select; const renders = f.renders;
  f.data.bank = 3000; f.ui.update(clone(f.data)); assert.equal(f.renders, renders); assert.equal(select.value, 'mining_pack');
  f.field('crate-slot-tool', 'axe'); assert.equal(f.fields.get('crate-slot-utility').value, 'mining_pack');
});

test('milestones describe lifetime credit and direct hundredth-watch helmet award', async () => {
  const f = fixture(); await f.ui.show(); await f.click('Milestones');
  assert.match(f.html, /99 lifetime nights credited/); assert.match(f.html, /Next: 100 credited nights/); assert.match(f.html, /Legendary crate \+ Sunforged Viking Helm/); assert.match(f.html, /crosses below 25% health/);
});

test('storage failure blocks a purchase before funds are sent and a different account never replays another receipt', async () => {
  const f = fixture({ storage: null }); await f.ui.show(); await f.click('Open Basic · 1,000 bank gold');
  assert.match(f.html, /could not save the opening receipt/); assert.equal(f.requests.filter(request => request.action).length, 0);
  const saved = memory(); saved.setItem('emberwatch-crates:alice:pending', JSON.stringify({ kind: 'crate_open', requestId: 'old', tier: 'basic', currency: 'bank' }));
  const other = fixture({ storage: saved }); other.setAccount('bob'); await other.ui.show(); assert.equal(other.requests.filter(request => request.action).length, 0);
});

test('all four rarity choices and every pool reward use real illustrated assets with accessible tier selection', async () => {
  const f = fixture(); await f.ui.show();
  const tiers = elementsWithClass(f.html, 'crate-tier-card');
  assert.equal(tiers.length, 4);
  for (const card of tiers) { assertRealItemImage(card); assert.match(card, /aria-label="(?:Basic|Rare|Epic|Legendary)"/); assert.match(card, /aria-pressed="(?:true|false)"/); }
  for (const [tier, pool] of Object.entries(CRATE_POOLS)) {
    await f.click(CRATE_TIERS[tier].label);
    const cards = elementsWithClass(f.html, 'crate-item'); assert.equal(cards.length, pool.length);
    for (const id of pool) assertRealItemImage(cards.find(card => card.includes(`src="/assets/crate-items/${id}.png"`)), id);
    assert.match(f.html, new RegExp(`${pool.length} listed items are equally likely`));
    assert.match(f.html, /class="crate-purchase-controls"/); assert.match(f.html, /Available/);
    assert.ok(f.buttons.some(button => button.text === `Open ${CRATE_TIERS[tier].label} · ${CRATE_PRICES[tier].bank.toLocaleString('en-US')} bank gold`));
  }
});

test('future loadout renders selected gear next to its control and current equipment stays separately illustrated', async () => {
  const f = fixture(); await f.ui.show(); await f.click('Future loadout');
  assert.equal(elementsWithClass(f.html, 'crate-slot-card').length, LOADOUT_SLOTS.length + 1);
  assert.equal(elementsWithClass(f.html, 'crate-current-slot').length, 4);
  assert.match(f.html, /class="crate-slot-placeholder"/); assertRealItemImage(f.html, 'iron_coif');
  f.field('crate-slot-head', 'padded_cap'); f.field('crate-slot-utility', 'mining_pack');
  const slots = elementsWithClass(f.html, 'crate-slot-card');
  assertRealItemImage(slots.find(card => card.includes('data-crate-slot="head"')), 'padded_cap');
  assertRealItemImage(slots.find(card => card.includes('data-crate-slot="utility"')), 'mining_pack');
  assert.match(f.html, /Enemy damage reduction<\/span><strong>2%/);
  assert.match(f.html, /Unsaved choices/); assert.equal(f.me.crateEquipment.head, 'iron_coif');
});

test('saved results show the actual reward, payment and odds; unrecognized result text cannot create an asset request', async () => {
  const f = fixture({ reducedMotion: true, resultId: 'runed_helm' }); await f.ui.show(); await f.click('Epic'); await f.click('Open Epic · 50,000 bank gold');
  const result = elementsWithClass(f.html, 'crate-result')[0]; assertRealItemImage(result, 'runed_helm');
  assert.match(result, /data-reward-id="runed_helm"/); assert.match(result, /Paid 50,000 bank gold/); assert.match(result, /1 in 4 · 25% each/);
  assert.match(f.html, /class="crate-result-stage"/); assert.match(f.html, /class="crate-result-receipt"/);
  const unsafe = fixture({ reducedMotion: true, resultId: '"><img src=x onerror=alert(1)>' }); await unsafe.ui.show(); await unsafe.click('Open Basic · 1,000 bank gold');
  assert.doesNotMatch(unsafe.html, /<img src=x|src="\/assets\/crate-items\/&quot;/);
  assert.match(unsafe.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('an account switch isolates in-flight openings, loadout drafts and saved receipts', async () => {
  let release;
  const bob = snapshot(); bob.bank = 17; bob.unlocks = []; bob.earnedCrates = [];
  const f = fixture({ api: async (path, settings, fallback) => {
    if (f.account === 'bob') return { crates: clone(bob) };
    if (settings) { await new Promise(resolve => { release = resolve; }); return fallback(path, settings); }
    return fallback(path, settings);
  } });
  await f.ui.show(); await f.click('Future loadout'); f.field('crate-slot-head', 'padded_cap'); await f.click('Open crates');
  const original = f.buttons.find(button => button.text === 'Open Basic · 1,000 bank gold').onclick();
  f.setAccount('bob'); await f.ui.show(); const updates = f.accountUpdates.length;
  release(); await original;
  assert.equal(f.accountUpdates.length, updates, 'an old response never updates the next account');
  assert.equal(f.ui.getSnapshot().bank, 17); assert.doesNotMatch(f.html, /crate-result-stage/);
  assert.ok(f.storage.values.has('emberwatch-crates:alice:pending'));
  assert.equal(f.storage.values.has('emberwatch-crates:bob:pending'), false);
  await f.click('Future loadout'); assert.equal(f.fields.get('crate-slot-head').value, ''); assert.equal(f.fields.get('crate-slot-head').choices.length, 1);
});

test('responsive armory stylesheet preserves reduced motion and fixed saved-result reel alignment', () => {
  const css = readFileSync(new URL('../public/crates-menu.css', import.meta.url), 'utf8');
  assert.match(css, /@media\(max-width:680px\)/); assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css, /animation:none!important/); assert.match(css, /50% - 68px - var\(--crate-stop\)/);
  assert.match(css, /:focus-visible/); assert.doesNotMatch(css, /url\(https?:/);
});
