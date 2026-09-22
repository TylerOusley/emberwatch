import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPetsUI, petCollectionModel } from '../public/src/pets-ui.js';
import { PET_RULES, PET_CATALOG, PET_RARITIES } from '../shared/pets.js';
import { BUILDINGS } from '../shared/world.js';
import { buildingEntrance } from '../shared/access.js';

const unescape = value => String(value ?? '').replace(/&(?:amp|lt|gt|quot|#39);/g, token => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }[token]));
const memory = () => { const values = new Map(); return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; };
const pet = (extra = {}) => ({ id: 'owl', name: 'Watch owl', description: 'A woodland companion.', available: true, ...extra });
const petState = (extra = {}) => ({ enabled: true, serverNow: 100_000, incubationSeconds: PET_RULES.incubationSeconds, eggs: [], collection: [], equippedId: '', merchant: { available: true, price: 5000, visitId: '10:2', message: 'An egg is available.' }, ...extra });
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function fixture(options = {}) {
  let account = options.account ?? 'alice', panel = null, html = '', buttons = [], images = [], details = [], renders = 0, localNow = 0, timerId = 0;
  const timers = new Map();
  const storage = options.storage === undefined ? memory() : options.storage;
  const requests = [], messages = [], receipts = options.receipts ?? new Map();
  const state = options.state ?? { id: 'village-one', pets: petState(options.pets) };
  const me = { id: account, wallet: 15000, hp: 100, downed: false, ...buildingEntrance(BUILDINGS.find(building => building.id === 'merchant')), ...options.me };
  const accounts = options.accounts ?? { [account]: structuredClone(state.pets) };
  const dialog = { scrollTop: 0 };
  const content = { querySelectorAll: selector => selector === '[data-pet-action]' ? buttons : selector === '[data-pet-thumbnail]' ? images : selector === 'details' ? details : [] };
  const document = { activeElement: null, getElementById: id => id === 'panel-content' ? content : id === 'panel-dialog' ? dialog : null };
  function render(next, nextPanel) {
    html = next; panel = nextPanel; renders++;
    buttons = [...html.matchAll(/<button\b([^>]*)>(.*?)<\/button>/gs)].map(match => ({
      dataset: { petAction: match[1].match(/data-pet-action="(\d+)"/)?.[1], petFocus: unescape(match[1].match(/data-pet-focus="([^"]*)"/)?.[1]) },
      disabled: /\sdisabled(?:\s|$)/.test(match[1]), text: unescape(match[2]),
      focus() { document.activeElement = this; },
    }));
    images = [...html.matchAll(/<img\b([^>]*data-pet-thumbnail[^>]*)>/g)].map(match => ({ src: match[1].match(/src="([^"]*)"/)[1], previousElementSibling: { hidden: false }, hidden: false }));
    details = [...html.matchAll(/<details\b([^>]*)>/g)].map(match => ({ dataset: { persist: match[1].match(/data-persist="([^"]*)"/)?.[1] }, open: false }));
  }
  async function api(path, settings) {
    const who = account, body = settings ? JSON.parse(settings.body) : null;
    requests.push({ path, body, account: who });
    const normal = async () => {
      const pets = accounts[who] ??= petState({ merchant: undefined });
      if (!body) return { pets: structuredClone(pets) };
      if (body.kind === 'pet_equip') pets.equippedId = body.petId;
      if (body.kind === 'pet_buy_egg') {
        const key = `${who}:${body.requestId}`;
        if (!receipts.has(key)) {
          receipts.set(key, { ...body }); me.wallet -= 5000;
          pets.eggs.push({ id: randomUUID(), hatchAt: pets.serverNow + 30 * 60 * 1000 });
        }
      }
      return { pets: structuredClone(pets), message: body.kind === 'pet_equip' ? 'Companion updated.' : 'Egg purchased.' };
    };
    return options.api ? options.api(path, settings, normal, who) : normal();
  }
  const ui = createPetsUI({ api, getState: () => state, getMe: () => me, getAccountKey: () => account,
    getActivePanel: () => panel, openPanel: render, toast: text => messages.push(text), document, storage, makeRequestId: randomUUID,
    clock: () => localNow, schedule: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; }, cancel: id => timers.delete(id) });
  function button(label) { const row = buttons.find(node => node.text === label); assert.ok(row, `Missing button ${label}: ${html}`); return row; }
  return { ui, state, me, accounts, storage, requests, receipts, messages, button, document, dialog, timers,
    get buttons() { return buttons; }, get images() { return images; }, get details() { return details; },
    get html() { return html; }, get renders() { return renders; }, get panel() { return panel; },
    setAccount(next, updatePlayer = true) { account = next; if (updatePlayer) me.id = next; }, close() { panel = null; },
    advance(ms) { localNow += ms; const due = [...timers.entries()].filter(([, timer]) => timer.delay <= ms); for (const [id, timer] of due) if (timers.delete(id)) timer.fn(); },
    async click(label) { const row = button(label); assert.equal(row.disabled, false, `Disabled button ${label}`); return row.onclick(); },
  };
}

test('staged empty catalog shows a collection placeholder without any purchase control', async () => {
  const f = fixture({ pets: { enabled: false, merchant: { available: false } } });
  await f.ui.show();
  assert.match(f.html, /Companions are coming soon/);
  assert.doesNotMatch(f.html, /Buy egg|5,000 gold/);
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].path, '/api/pets');
  for (let i = 0, count = f.renders; i < 20; i++) { f.ui.update(); assert.equal(f.renders, count); }
});

test('egg button follows merchant stock, wallet, counter proximity and recovery immediately', async () => {
  const f = fixture(); await f.ui.show(); assert.equal(f.button('Buy egg').disabled, false);
  f.state.pets.merchant.available = false; f.ui.update(); assert.equal(f.button('Buy egg').disabled, true);
  f.state.pets.merchant.available = true; f.me.wallet = 4999; f.ui.update(); assert.equal(f.button('Buy egg').disabled, true); assert.match(f.html, /Not enough wallet gold/);
  f.me.wallet = 5000; f.ui.update(); assert.equal(f.button('Buy egg').disabled, false);
  f.me.x += 20; f.ui.update(); assert.equal(f.button('Buy egg').disabled, true); assert.match(f.html, /front counter/);
  f.me.x -= 20; f.me.downed = true; f.ui.update(); assert.equal(f.button('Buy egg').disabled, true);
  f.me.downed = false; f.me.hp = 0; f.ui.update(); assert.equal(f.button('Buy egg').disabled, true);
  f.me.hp = 1; f.ui.update(); assert.equal(f.button('Buy egg').disabled, false);
  assert.equal(f.requests.filter(row => row.body).length, 0);
});

test('incubation uses server time, waits for authoritative hatch at zero, then shows the unlock', async () => {
  const f = fixture({ pets: { serverNow: 0, eggs: [{ id: 'egg', hatchAt: 1_800_000 }] } });
  await f.ui.show(); assert.match(f.html, /30:00/);
  f.state.pets.serverNow = 1000; f.ui.update(); assert.match(f.html, /29:59/);
  f.state.pets.serverNow = 1_800_000; f.ui.update(); assert.match(f.html, /Checking the hatch…/); assert.doesNotMatch(f.html, /Equip companion/);
  f.state.pets.serverNow = 1_801_000; f.state.pets.eggs = []; f.state.pets.collection = [pet()]; f.ui.update();
  assert.match(f.html, /Watch owl/); assert.doesNotMatch(f.html, /Checking the hatch|Incubating eggs/);
  assert.equal(f.button('Equip companion').disabled, false);
});

test('collection equips and rests permanent pets and escapes names and descriptions', async () => {
  const f = fixture({ pets: { collection: [pet({ name: '<img onerror=oops>' }), pet({ id: 'retired', name: 'Retired companion', description: '<script>oops</script>', available: false })] } });
  await f.ui.show(); assert.doesNotMatch(f.html, /<img onerror|<script>/); assert.match(f.html, /&lt;script&gt;/);
  assert.equal(f.button('Currently unavailable').disabled, true);
  await f.click('Equip companion'); assert.equal(f.requests.at(-1).body.petId, 'owl'); assert.match(f.html, /Equipped/);
  await f.click('Let rest'); assert.equal(f.requests.at(-1).body.petId, ''); assert.match(f.html, /Permanent unlock/);
  assert.equal(f.accounts.alice.equippedId, ''); assert.equal(f.accounts.alice.collection.length, 2);
});

test('lost purchase response retries the exact saved UUID across close, reload and another village', async () => {
  const f = fixture({ api: async (path, settings, normal) => { const value = await normal(); if (settings) throw new Error('Connection lost'); return value; } });
  await f.ui.show(); await f.click('Buy egg');
  assert.equal(f.receipts.size, 1); assert.equal(f.accounts.alice.eggs.length, 1); assert.equal(f.me.wallet, 10000);
  const original = f.requests.at(-1).body; assert.match(original.requestId, /^[a-f0-9-]{36}$/); assert.equal(original.visitId, '10:2');
  assert.match(f.html, /Check saved purchase/); assert.equal(f.button('Buy egg').disabled, true); f.close();
  const restored = fixture({ storage: f.storage, accounts: f.accounts, receipts: f.receipts,
    state: { id: 'other-village', pets: petState({ merchant: { available: false, visitId: '15:3' } }) }, me: { wallet: 10000, x: 0, z: 0 } });
  await restored.ui.show(); await restored.click('Check saved purchase');
  assert.deepEqual(restored.requests.at(-1).body, original); assert.equal(restored.receipts.size, 1);
  assert.equal(restored.accounts.alice.eggs.length, 1); assert.equal(restored.me.wallet, 10000);
  assert.doesNotMatch(restored.html, /Check saved purchase/); assert.equal(restored.storage.values.size, 0);
});

test('unavailable or failed browser storage prevents a purchase before sending its action', async () => {
  for (const storage of [null, { getItem: () => null, setItem() { throw new Error('Quota exceeded'); }, removeItem() {} }]) {
    const f = fixture({ storage }); await f.ui.show(); await f.click('Buy egg');
    assert.match(f.html, /Enable browser storage/); assert.equal(f.requests.filter(row => row.body).length, 0); assert.equal(f.me.wallet, 15000);
  }
});

test('definite rejected purchases clear receipts while uncertain server failures keep them', async () => {
  for (const status of [400, 403, 404, 409, 500]) {
    const f = fixture({ api: (path, settings, normal) => { if (settings) throw Object.assign(new Error('Rejected purchase'), { status }); return normal(); } });
    await f.ui.show(); await f.click('Buy egg'); const first = f.requests.at(-1).body.requestId;
    if (status === 500) {
      assert.match(f.html, /Check saved purchase/); await f.click('Check saved purchase'); assert.equal(f.requests.at(-1).body.requestId, first);
    } else {
      assert.doesNotMatch(f.html, /Check saved purchase/); assert.equal(f.storage.values.size, 0);
      await f.click('Buy egg'); assert.notEqual(f.requests.at(-1).body.requestId, first);
    }
  }
});

test('late account responses do not reopen closed menus or expose an earlier account collection', async () => {
  let waiting = false, held;
  const f = fixture({ api: (path, settings, normal, who) => {
    if (waiting && who === 'alice') { held = defer(); return held.promise; } return normal();
  } });
  await f.ui.show(); waiting = true;
  const closing = f.click('Refresh collection'); f.close(); held.resolve({ pets: petState({ collection: [pet({ name: 'Alice private owl' })] }) }); await closing;
  assert.equal(f.panel, null);
  const pending = f.ui.show(); f.setAccount('bob', false); f.accounts.bob = petState({ merchant: undefined });
  await f.ui.show(); const count = f.renders;
  assert.doesNotMatch(f.html, /Alice private owl/); assert.equal(f.button('Buy egg').disabled, true);
  held.resolve({ pets: petState({ collection: [pet({ name: 'Alice private owl' })] }) }); await pending;
  assert.equal(f.renders, count); assert.doesNotMatch(f.html, /Alice private owl/);
});

test('account clear keeps saved receipts private and invalidates old menu callbacks', async () => {
  const f = fixture({ api: (path, settings, normal) => { if (settings) throw new Error('Offline'); return normal(); } });
  await f.ui.show(); const oldBuy = f.button('Buy egg');
  await f.click('Buy egg'); const oldRetry = f.button('Check saved purchase'), count = f.requests.length;
  await oldBuy.onclick(); assert.equal(f.requests.length, count);
  f.ui.clear(); f.setAccount('bob', false); f.accounts.bob = petState({ enabled: false }); await f.ui.show();
  const afterSwitch = f.requests.length; await oldRetry.onclick(); assert.equal(f.requests.length, afterSwitch);
  assert.doesNotMatch(f.html, /Check saved purchase/); assert.equal(f.storage.values.has('emberwatch-pets:alice:purchase'), true);
  f.setAccount('alice'); await f.ui.show(); assert.match(f.html, /Check saved purchase/);
});

test('new purchase revalidates eligibility if the snapshot changes before its native click', async () => {
  for (const change of [f => { f.me.wallet = 0; }, f => { f.me.x += 50; }, f => { f.me.downed = true; }, f => { f.state.pets.merchant.available = false; }]) {
    const f = fixture(); await f.ui.show(); const button = f.button('Buy egg'); change(f); await button.onclick();
    assert.equal(f.requests.filter(row => row.body).length, 0); assert.equal(f.storage.values.size, 0); assert.match(f.html, /role="alert"/);
  }
});

test('unrelated worker updates do not redraw and changed merchant stock does even at equal server time', async () => {
  const f = fixture(); await f.ui.show(); const count = f.renders;
  for (let i = 0; i < 100; i++) { f.state.workers = Array.from({ length: 80 }, (_, n) => ({ id: n, x: i + n, cargo: i })); f.ui.update(); }
  assert.equal(f.renders, count);
  f.state.pets.merchant.available = false; f.ui.update(); assert.equal(f.renders, count + 1); assert.equal(f.button('Buy egg').disabled, true);
  f.ui.update(); assert.equal(f.renders, count + 1);
});

test('signed-out collection access sends no requests or account data', async () => {
  const f = fixture(); f.setAccount(null); await f.ui.show(); assert.equal(f.requests.length, 0); assert.equal(f.panel, null); assert.match(f.messages[0], /Sign in/);
});

const completeCollection = () => Object.entries(PET_CATALOG).map(([id, info]) => ({ id, ...info, available: true, unlockedAt: 1 }));

test('all thirteen pet cards use real thumbnails, fixed rarity stats and an equipped-first order', async () => {
  const pets = petState({ collection: completeCollection(), equippedId: 'rabbit' });
  const sorted = petCollectionModel(pets);
  assert.equal(sorted.length, 13); assert.equal(sorted[0].id, 'rabbit');
  assert.deepEqual(sorted.slice(1, 3).map(pet => pet.id), ['dragon', 'vampire_bat']);
  for (const [id, bonus] of [['rabbit', 20], ['marmot', 15], ['squirrel', 25]]) assert.equal(sorted.find(pet => pet.id === id).effect, `+${bonus}% carrying capacity`);
  for (const pet of sorted.filter(pet => pet.attack)) {
    assert.equal(pet.attack.damage, { common: 8, uncommon: 12, rare: 20, epic: 32, legendary: 50 }[pet.rarity]);
    assert.equal(pet.attack.cooldown, 2); assert.equal(pet.thumbnail, `/assets/pets/${pet.assetId}/thumbnail.png`);
  }
  const f = fixture({ pets }); await f.ui.show();
  assert.equal((f.html.match(/data-pet-id=/g) ?? []).length, 13);
  assert.match(f.html, /Equipped companion/); assert.match(f.html, /50 damage · Every 2s/);
  assert.match(f.html, /Restores 2 HP to you per successful hit/); assert.match(f.html, /13 collected/);
  assert.match(f.html, /\/assets\/pets\/vampire_bat\/thumbnail\.png/);
  const vampire = f.html.match(/<article[^>]*data-pet-id="vampire_bat"[\s\S]*?<\/article>/)[0];
  assert.match(vampire, /Legendary/); assert.doesNotMatch(vampire, /data-item="pet_egg"/);
});

test('exact hatch odds and village-shared merchant rules stay visible after completing the collection', async () => {
  const f = fixture({ pets: { collection: completeCollection() } }); await f.ui.show();
  for (const [id, chance] of Object.entries({ common:38, uncommon:30, rare:20, epic:10, legendary:2 })) {
    assert.match(f.html, new RegExp(`data-pet-odds="${id}"><dt>${PET_RARITIES[id].name}</dt><dd>${chance}%`));
  }
  assert.match(f.html, /25% chance to offer one egg per visit, shared by the village/);
  assert.match(f.html, /href="\/assets\/pets\/CREDITS\.html" target="_blank" rel="noopener noreferrer"/);
  assert.match(f.html, /30 real minutes/); assert.match(f.html, /unowned companion is preferred/);
  assert.match(f.html, /does not change these odds/); assert.match(f.html, /duplicate hatch returns 1,000 gold to your bank/);
  assert.equal(f.button('Buy egg').disabled, false);
  await f.click('Buy egg');
  assert.deepEqual(Object.keys(f.requests.at(-1).body).sort(), ['kind', 'requestId', 'villageId', 'visitId']);
  assert.equal(f.requests.at(-1).body.kind, 'pet_buy_egg', 'the client sends no species, rarity or rolled result');
});

test('rarity filters preserve the equipped summary, keyboard focus, scroll and account isolation', async () => {
  const f = fixture({ pets: { collection: completeCollection(), equippedId: 'rabbit' } }); await f.ui.show();
  f.dialog.scrollTop = 450; f.button('Legendary').focus(); await f.click('Legendary');
  assert.equal((f.html.match(/data-pet-id=/g) ?? []).length, 2); assert.match(f.html, /Rabbit/);
  assert.equal(f.document.activeElement.dataset.petFocus, 'filter-legendary'); assert.equal(f.dialog.scrollTop, 450);
  f.me.wallet++; f.ui.update(); assert.equal((f.html.match(/data-pet-id=/g) ?? []).length, 2);
  await f.click('All'); assert.equal((f.html.match(/data-pet-id=/g) ?? []).length, 13);
  f.ui.clear(); f.setAccount('bob', false); f.accounts.bob = petState({ collection: [pet({ id: 'fox', ...PET_CATALOG.fox })] });
  await f.ui.show(); assert.equal((f.html.match(/data-pet-id=/g) ?? []).length, 1);
  assert.doesNotMatch(f.html, /Vampire Bat|Rabbit|Filter pets by rarity/);
});

test('broken thumbnails use a friendly initial fallback and unsafe asset paths are never requested', async () => {
  const f = fixture({ pets: { collection: [pet({ id: 'vampire_bat', ...PET_CATALOG.vampire_bat }), pet({ id: 'custom', name: 'Odd Friend', assetId: '../../private', rarity: 'legendary\" onclick=x' })] } });
  await f.ui.show(); assert.doesNotMatch(f.html, /src="[^\"]*\.\.\/|onclick=x/);
  assert.match(f.html, /pet-portrait-fallback[^>]*>VB/); assert.match(f.html, /pet-portrait-fallback[^>]*>OF/);
  const image = f.images.find(image => image.src.includes('vampire_bat'));
  image.onload(); assert.equal(image.previousElementSibling.hidden, true);
  image.onerror(); assert.equal(image.hidden, true); assert.equal(image.previousElementSibling.hidden, false);
});

test('a disconnected menu advances real incubation time but waits for a server receipt before revealing a pet', async () => {
  const f = fixture({ pets: { serverNow: 100_000, eggs: [{ id: 'egg', hatchAt: 1_900_000 }] } });
  await f.ui.show(); f.advance(60_000); assert.match(f.html, /29:00/);
  f.advance(29 * 60_000); await Promise.resolve(); await Promise.resolve();
  assert.match(f.html, /Checking the hatch/); assert.doesNotMatch(f.html, /data-pet-id=/);
  assert.equal(f.requests.filter(request => request.path === '/api/pets').length, 2);
  const before = f.requests.length; f.advance(1000); assert.equal(f.requests.length, before, 'zero-time hatch polling is bounded');
  f.close(); f.advance(10_000); assert.equal(f.requests.length, before, 'closed panels neither poll nor reopen');
  f.ui.clear(); assert.equal(f.timers.size, 0);
});

test('hatch feedback reports new unlocks and exactly the confirmed duplicate bank credit', async () => {
  const f = fixture(); await f.ui.show();
  const hatch = { eggId: 'new', petId: 'owl', name: 'Owl', rarity: 'rare', hatchedAt: 101_000, duplicate: false, refundGold: 0, refundPaid: true };
  f.state.pets.serverNow = 101_000; f.state.pets.recentHatches = [hatch]; f.state.pets.collection = [pet()]; f.ui.update();
  assert.match(f.html, /Owl · Hatched/); assert.match(f.messages.at(-1), /Owl hatched!/);
  f.ui.update(); assert.equal(f.messages.filter(text => text.includes('Owl hatched!')).length, 1);
  f.state.pets.serverNow++; f.state.pets.recentHatches.unshift({ ...hatch, eggId: 'dup', duplicate: true, refundGold: 1000, refundDestination: 'bank', refundPaid: true }); f.ui.update();
  assert.match(f.html, /Owl · Duplicate/); assert.match(f.html, /1,000 bank gold returned/);
  assert.equal(f.me.wallet, 15000); assert.equal(f.state.pets.collection.length, 1, 'the client does not grant a second pet or mint a refund');
  assert.equal(f.requests.filter(request => request.body).length, 0);
  const count = f.messages.length; f.ui.update(); assert.equal(f.messages.length, count);
  f.state.pets.serverNow++; f.state.pets.recentHatches[0].refundPaid = false; f.state.pets.pendingRefundGold = 1000; f.ui.update();
  assert.match(f.html, /1,000 gold awaiting bank space/); assert.match(f.html, /remains owed to your account/);
});

test('recent hatch history survives refresh and a late account response cannot show private receipts', async () => {
  const hatches = Array.from({ length: 6 }, (_, index) => ({ eggId: String(index), name: `Private owl ${index}`, rarity: 'rare', hatchedAt: index, duplicate: false }));
  const f = fixture({ pets: { recentHatches: hatches } }); await f.ui.show();
  f.details[0].open = true; f.me.wallet++; f.ui.update(); assert.equal(f.details[0].open, true);
  assert.equal(f.messages.length, 0, 'opening historical receipts does not toast each old hatch');
  f.setAccount('bob', false); f.accounts.bob = petState(); await f.ui.show(); assert.doesNotMatch(f.html, /Private owl|Recent hatches/);
});

test('native pointer and keyboard purchase targets survive countdown and balance refreshes', async () => {
  for (const key of [null, 'Enter', ' ']) {
    const f = fixture({ pets: { eggs: [{ id:'incubating', hatchAt:1_900_000 }] } }); await f.ui.show();
    const buy = f.button('Buy egg'), renders = f.renders;
    if (key) buy.onkeydown({ key }); else buy.onpointerdown({ button:0 });
    f.me.wallet++; f.advance(1000); f.ui.update(); assert.equal(f.renders, renders);
    if (key) buy.onkeyup({ key }); else buy.onpointerup();
    f.me.wallet++; f.ui.update(); assert.equal(f.renders, renders);
    await buy.onclick(); assert.equal(f.requests.filter(request => request.body?.kind === 'pet_buy_egg').length, 1);
    await buy.onclick(); assert.equal(f.requests.filter(request => request.body?.kind === 'pet_buy_egg').length, 1, 'detached controls never replay');
  }
});

test('a changed merchant visit or price requires a new review before purchase', async () => {
  for (const change of [f => { f.state.pets.merchant.visitId = '11:3'; }, f => { f.state.pets.merchant.price = 6000; }, f => { f.state.id = 'new-village'; }]) {
    const f = fixture(); await f.ui.show(); const old = f.button('Buy egg'); change(f); await old.onclick();
    assert.equal(f.requests.filter(request => request.body).length, 0); assert.match(f.html, /offer changed/);
    assert.equal(f.storage.values.size, 0);
  }
});

test('stale equip controls reject removed or unavailable pets without changing the collection', async () => {
  const f = fixture({ pets: { collection: [pet()] } }); await f.ui.show(); const equip = f.button('Equip companion');
  f.state.pets.serverNow++; f.state.pets.collection = []; await equip.onclick();
  assert.equal(f.requests.filter(request => request.body).length, 0); assert.match(f.html, /Choose an available companion/);
});

test('a confirmed purchase disables its spent merchant stock before the next village snapshot', async () => {
  const f = fixture(); await f.ui.show(); await f.click('Buy egg');
  assert.equal(f.state.pets.merchant.available, true, 'the simulated village snapshot has not arrived yet');
  assert.equal(f.button('Buy egg').disabled, true); assert.match(f.html, /visit’s egg has been sold/);
  f.state.pets.merchant.visitId = '12:3'; f.ui.update(); assert.equal(f.button('Buy egg').disabled, false);
});

test('a hatch check cannot occupy the API busy state while a purchase click is being completed', async () => {
  const f = fixture({ pets: { eggs: [{ id:'egg', hatchAt:101_000 }] } }); await f.ui.show();
  const buy = f.button('Buy egg'), requests = f.requests.length;
  buy.onpointerdown({ button:0 }); f.advance(1000); assert.equal(f.requests.length, requests);
  buy.onpointerup(); await buy.onclick(); assert.equal(f.requests.at(-1).body.kind, 'pet_buy_egg');
  f.button('Refresh collection').onpointerdown({ button:0 }); f.close(); await f.ui.show();
  assert.match(f.html, /Pets & eggs/); assert.equal(f.button('Refresh collection').disabled, false);
});
