import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettlementUI } from '../public/src/settlement-ui.js';
import { BUILDINGS, PLOTS, plotBedPoint, CAVE_ENTRANCE } from '../shared/world.js';
import { buildingEntrance, plotEntrance } from '../shared/access.js';
import { taxedSaleQuote, taxedPurchaseQuote, foodQuote } from '../shared/economy.js';
import { NOTICEBOARD_POINT } from '../public/src/noticeboard.js';
import { ownershipSnapshot } from '../server/ownership.js';

// A narrow DOM harness verifies displayed quotes and dispatched actions without
// WebGL. It is intentionally not a screenshot or browser rendering test.
function fixture(t, options = {}) {
  const prior = globalThis.document;
  let html = '', openCount = 0, nodes = [], buttons = [], details = [], summaries = [], activePanel = null;
  const fields = new Map(), sent = [];
  const player = { id: 'alice', name: 'Alice', role: 'guard', x: 0, z: 0, wallet: 2000, bank: 80, hp: 70, maxHp: 100, hunger: 50, inventory: { wheat: 10, timber: 0, stone: 0, iron: 0, coal: 0 }, durability: { sword: 100, axe: 75, pickaxe: 100, scythe: 100, hammer: 100 }, tiers: { sword: 'wood', axe: 'wood', pickaxe: 'wood', scythe: 'wood', hammer: 'wood' } };
  const state = { players: [player], plots: [], guards: [], beds: [], stock: { wheat: 100, timber: 100, stone: 100, iron: 100, coal: 100 }, treasury: 2500, policies: { guardWage: 25, priestWage: 25, tradeTax: 10, landTax: 2, exportPriority: 'balanced' }, proposals: [], merchant: { present: true, stock: { iron: 5 }, prices: { iron: 9 } }, stable: { stock: 3 }, loan: { debt: 0, credit: 0, availablePool: 500 }, foodQuotes: Object.fromEntries(['food', 'good_food', 'best_food'].map(id => [id, foodQuote(100, id)])) };
  const content = { contains: e => nodes.includes(e), querySelectorAll: query => query === '[data-settlement-button]' ? buttons : query === '[data-shop-inspect]' ? details : [], querySelector: query => nodes.find(node => node.dataset?.shopFocus && query === `[data-shop-focus="${node.dataset.shopFocus}"]`) };
  const dialog = { open: true, scrollTop: 0, classList: { add() {} } };
  globalThis.document = { activeElement: null, getElementById: id => id === 'panel-content' ? content : id === 'panel-dialog' ? dialog : fields.get(id) || null };
  t.after(() => { globalThis.document = prior; });
  const ui = createSettlementUI({ getState: () => state, getMe: () => player, getActivePanel: () => activePanel, showDeliveries: options.showDeliveries, showInvestments: options.showInvestments, showTavern: options.showTavern, getHotbar: () => ['sword', 'axe', 'pickaxe', 'scythe', 'hammer', 'food', 'bow', 'good_food'], setHotbar() {}, toast() {}, send: value => sent.push(value), openPanel: (next, panel) => {
    html = next; activePanel = panel; openCount++; fields.clear();
    buttons = [...html.matchAll(/<button\b([^>]*)>(.*?)<\/button>/gs)].map(match => {
      const button = { dataset: { settlementButton: match[1].match(/data-settlement-button="(\d+)"/)[1] }, textContent: match[1].match(/aria-label="([^"]*)"/)?.[1] || match[2], get text() { return this.textContent; }, disabled: /\sdisabled(?:\s|$)/.test(match[1]), tagName: 'BUTTON' };
      const focusKey = match[1].match(/data-shop-focus="([^"]+)"/)?.[1]; if (focusKey) { button.dataset.shopFocus = focusKey; button.focus = () => { document.activeElement = button; }; }
      const id = match[1].match(/\bid="([^"]+)"/)?.[1]; if (id) fields.set(id, button);
      return button;
    });
    for (const match of html.matchAll(/<(input|select)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) fields.set(match[3], { tagName: match[1].toUpperCase(), value: match[2].match(/\bvalue="([^"]*)"/)?.[1] || '', max: match[2].match(/\bmax="([^"]*)"/)?.[1] || '' });
    for (const match of html.matchAll(/<select\b[^>]*\bid="([^"]+)"[^>]*>(.*?)<\/select>/gs)) {
      const options = [...match[2].matchAll(/<option\b([^>]*)>/g)];
      fields.get(match[1]).value = (options.find(option => /\sselected(?:\s|$)/.test(option[1])) || options[0])?.[1].match(/\bvalue="([^"]*)"/)?.[1] || '';
    }
    for (const match of html.matchAll(/<(p|span|strong)\b[^>]*\bid="([^"]+)"[^>]*>(.*?)<\/\1>/gs)) fields.set(match[2], { tagName: match[1].toUpperCase(), textContent: match[3] });
    details = [...html.matchAll(/<details\b([^>]*)>/g)].map(match => ({ tagName: 'DETAILS', dataset: { shopInspect: match[1].match(/data-shop-inspect="([^"]+)"/)[1] }, open: /\sopen(?:\s|$)/.test(match[1]) }));
    summaries = [...html.matchAll(/<summary\b([^>]*)>/g)].map(match => ({ tagName: 'SUMMARY', dataset: { shopFocus: match[1].match(/data-shop-focus="([^"]+)"/)[1] }, focus() { document.activeElement = this; } }));
    nodes = [...buttons, ...fields.values(), ...details, ...summaries];
  } });
  return { ui, player, state, sent, fields, visit(kind, id = null) {
    const point = kind === 'plot' || kind === 'church' && id && id !== 'church' ? plotEntrance(PLOTS.find(p => p.id === id), state.plots.find(p => p.id === id)) : buildingEntrance(BUILDINGS.find(b => b.id === kind));
    if (point) Object.assign(player, point);
    ui.show(kind, id);
  }, get html() { return html; }, get openCount() { return openCount; }, get buttons() { return buttons; }, get details() { return details; }, get summaries() { return summaries; }, click(text) { const button = buttons.find(b => b.text === text); assert.ok(button, `Missing button: ${text}`); assert.equal(button.disabled, false, `Disabled button: ${text}`); button.onclick(); } };
}

test('the Wayfarer entrance opens tavern games when the merchant is present or away, day and night', t => {
  const opened = [], f = fixture(t, { showTavern: () => opened.push('tavern') });
  for (const present of [true, false]) for (const phase of ['day', 'night']) {
    f.state.merchant.present = present; f.state.phase = phase;
    f.visit('merchant');
    assert.match(f.html, /THE WAYFARER/); assert.match(f.html, /open day and night/);
    f.click('Play tavern games'); assert.equal(opened.at(-1), 'tavern');
    if (present) { f.click('Buy one · 9g'); assert.equal(f.sent.at(-1).kind, 'merchant_buy'); }
    else assert.equal(f.buttons.some(b => b.text === 'Buy one · 9g'), false);
  }
  assert.equal(opened.length, 4, 'each real menu button invokes the tavern callback');
});

test('market buttons send the tax-inclusive quotes displayed to the player', t => {
  const f = fixture(t); f.visit('market');
  const sale = taxedSaleQuote('wheat', 100, 10, 10).total;
  const purchase = taxedPurchaseQuote('wheat', 100, 10, 10).total;
  f.click(`Sell 10 · ${sale}g`);
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'sell', resource: 'wheat', amount: 10, minTotal: sale });
  f.click(`Buy 10 · ${purchase}g`);
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'buyResource', resource: 'wheat', amount: 10, maxTotal: purchase });
});

test('bank keeps personal gold separate from the illustrated resource market and its delivery counter', t => {
  const delivered = [], f = fixture(t, { showDeliveries: id => delivered.push(id) });
  f.state.requests = { items: [{ id: 'supply', destinationId: 'bank', status: 'open' }] };
  f.visit('bank');
  assert.match(f.html, /data-shop-theme="bank"/); assert.match(f.html, /data-item="gold"/);
  assert.match(f.html, /Protected savings/); assert.match(f.html, /Purchase credit/);
  assert.doesNotMatch(f.html, /trade-amount-|Donate carried resources|>Requested deliveries</);
  f.fields.get('bank-amount').value = '37'; f.click('Deposit');
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'deposit', amount: 37 });
  f.click('Withdraw'); assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'withdraw', amount: 37 });
  f.fields.get('loan-amount').value = '65'; f.click('Borrow purchase credit');
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'loan', amount: 65 });
  f.click('Find resource market'); assert.equal(f.ui.getWaypoint().id, 'market');
  f.ui.show('market'); assert.match(f.html, /BUILDING ENTRANCE/); assert.equal(f.fields.has('trade-amount-wheat'), false);
  f.visit('market'); assert.match(f.html, /data-shop-theme="market"/);
  assert.equal((f.html.match(/class="market-resource-card"/g) || []).length, 6);
  assert.doesNotMatch(f.html, /id="bank-amount"|id="loan-amount"|>Deposit</);
  f.click('Requested deliveries'); assert.deepEqual(delivered, ['bank'], 'saved request destination keys remain compatible');
  f.click('Donate carried resources'); assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'donate' });
});

test('Sell max makes one protected sale, ignores custom quantity drafts and refreshes affordability without losing focus', t => {
  const f = fixture(t); f.player.inventory = { wheat: 40 }; f.player.durability = {}; f.visit('market');
  const input = f.fields.get('trade-amount-wheat'); input.value = '37'; input.oninput();
  const full = taxedSaleQuote('wheat', 100, 40, 10);
  f.state.stock.wheat = 1000; // A snapshot may arrive before the next rendered refresh.
  f.fields.get('trade-max-wheat').onclick();
  assert.equal(f.sent.length, 1);
  assert.deepEqual(f.sent[0], { type: 'action', kind: 'sell', resource: 'wheat', amount: 40, minTotal: full.total });
  assert.equal(input.value, '37');
  document.activeElement = input; const renders = f.openCount;
  f.state.stock.wheat = 100; f.state.treasury = 518; f.player.wallet = 70; f.ui.refresh();
  assert.equal(f.openCount, renders); assert.equal(document.activeElement, input); assert.equal(input.value, '37');
  assert.equal(f.fields.get('trade-max-wheat').textContent, 'Sell max · 10 for 18g');
  assert.match(f.fields.get('trade-max-quote-wheat').textContent, /20g value − 2g tax = 18g received/);
  assert.equal(f.fields.get('market-wallet').textContent, '70 gold'); assert.equal(f.fields.get('market-treasury').textContent, '518 gold');
  f.fields.get('trade-max-wheat').onclick(); assert.equal(f.sent.length, 2);
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'sell', resource: 'wheat', amount: 10, minTotal: 18 });
  input.value = ''; input.oninput(); assert.equal(f.fields.get('trade-max-wheat').disabled, false, 'Sell max is independent of an unfinished custom amount');
  f.state.treasury = 500; f.ui.refresh(); assert.equal(f.fields.get('trade-max-wheat').disabled, true);
  f.fields.get('trade-max-wheat').onclick(); assert.equal(f.sent.length, 2);
  f.state.treasury = 2500; f.player.inventory.wheat = 0; f.ui.refresh(); assert.equal(f.fields.get('trade-max-wheat').disabled, true); assert.equal(f.fields.get('market-donate').disabled, true);
  f.player.inventory.wheat = 4; f.ui.refresh(); const stale = f.fields.get('trade-max-wheat');
  Object.assign(f.player, buildingEntrance(BUILDINGS.find(b => b.id === 'bank'))); stale.onclick();
  assert.equal(f.sent.length, 2); assert.match(f.html, /BUILDING ENTRANCE/);
});

test('illustrated storefronts keep price, gear effects and materials accessible without hover', t => {
  const f = fixture(t), site = PLOTS[0];
  f.visit('tools'); assert.match(f.html, /class="shop-interior-art"/); assert.match(f.html, /data-shop-theme="tools"/);
  const starter = f.html.match(/<article[^>]*data-shop-item="wood_pickaxe"[\s\S]*?<\/article>/)?.[0];
  assert.match(starter, /data-item="pickaxe"/); assert.match(starter, /1 resource \/ swing/); assert.match(starter, /100 uses/);
  assert.match(starter, /<details[^>]*data-shop-inspect=/); assert.match(starter, /<summary[^>]*aria-label="Inspect Wooden pickaxe"/);
  assert.match(starter, /Buy · 10g/); assert.match(f.html, /data-item="backpack"/);
  f.state.plots = [{ id: site.id, ownerId: 'bob', ownerName: '<script>Owner</script>', building: 'tool_shop', hp: 350, maxHp: 350, storage: { stone: 10, timber: 5, iron: 0, coal: 0 } }];
  f.visit('plot', site.id);
  const stone = f.html.match(/<article[^>]*data-shop-item="stone_pickaxe"[\s\S]*?<\/article>/)?.[0], iron = f.html.match(/<article[^>]*data-shop-item="iron_pickaxe"[\s\S]*?<\/article>/)?.[0];
  assert.match(stone, /2 resources \/ swing/); assert.match(stone, /150 uses/); assert.match(stone, /10 stone · 5 timber/); assert.match(stone, /data-item="stone"/); assert.match(stone, /Buy · 35g/);
  assert.match(iron, /3 resources \/ swing/); assert.match(iron, /200 uses/); assert.match(iron, /data-available="false"/); assert.match(iron, /shop needs more materials/); assert.match(iron, /disabled/);
  assert.doesNotMatch(f.html, /<script>Owner/);
  f.state.plots[0].building = 'sword_shop'; f.state.plots[0].storage = { timber: 100, stone: 100, iron: 100, coal: 100 }; f.visit('plot', site.id);
  assert.match(f.html, /data-shop-theme="weapons"/); assert.match(f.html, /20 base \/ hit/); assert.match(f.html, /Each swing uses one durability/);
  f.state.plots[0].building = 'tinker_shop'; f.visit('plot', site.id);
  for (const item of ['bow', 'arrows', 'cart']) assert.match(f.html, new RegExp(`data-item="${item}"`));
  assert.match(f.html, /22 base \/ arrow/); assert.match(f.html, /12 arrows/); assert.match(f.html, /1000 weight/);
});

test('native item inspection and keyboard focus survive refreshed stock, then clear between villages', t => {
  const f = fixture(t); f.visit('tools');
  const details = f.details.find(detail => detail.dataset.shopInspect === 'wood_pickaxe'), summary = f.summaries.find(summary => summary.dataset.shopFocus === 'wood_pickaxe');
  details.open = true; details.ontoggle(); summary.focus();
  f.player.wallet += 1; f.ui.refresh();
  assert.equal(f.details.find(detail => detail.dataset.shopInspect === 'wood_pickaxe').open, true);
  assert.equal(document.activeElement, f.summaries.find(summary => summary.dataset.shopFocus === 'wood_pickaxe'));
  const purchase = f.buttons.find(button => button.dataset.shopFocus === 'buy-pack_1-0'); purchase.focus(); f.player.wallet++; f.ui.refresh();
  assert.equal(document.activeElement, f.buttons.find(button => button.dataset.shopFocus === 'buy-pack_1-0'), 'keyboard purchase focus also survives snapshots');
  f.ui.clear(); f.visit('tools'); assert.equal(f.details.find(detail => detail.dataset.shopInspect === 'wood_pickaxe').open, false);
  Object.assign(f.player, { x: 0, z: 0 }); f.ui.refresh(); assert.match(f.html, /BUILDING ENTRANCE/); assert.doesNotMatch(f.html, /shop-interior-art|shop-item-grid/);
});

test('food, stable and traveling wares use illustrated cards while preserving current purchase limits', t => {
  const f = fixture(t); f.visit('food'); assert.match(f.html, /data-shop-theme="food"/);
  for (const id of ['food', 'good_food', 'best_food']) assert.match(f.html, new RegExp(`data-item="${id}"`));
  const meal = f.state.foodQuotes.food; f.click(`Buy · ${meal.price}g`); assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'buyFood', tier: 'food' });
  f.state.stock.wheat = 0; f.ui.refresh(); assert.ok(f.buttons.filter(b => b.text.startsWith('Buy ·')).every(b => b.disabled));
  f.visit('stable'); assert.match(f.html, /data-shop-theme="stable"/); assert.match(f.html, /data-item="horse"/); f.click('Buy a horse · 100g'); assert.equal(f.sent.at(-1).kind, 'buyHorse');
  f.state.stable.stock = 0; f.ui.refresh(); assert.ok(f.buttons.find(b => b.text === 'Buy a horse · 100g').disabled);
  f.visit('merchant'); assert.match(f.html, /data-shop-theme="merchant"/); assert.match(f.html, /data-item="iron"/); f.click('Buy one · 9g'); assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'merchant_buy', resource: 'iron', amount: 1 });
  f.state.merchant.present = false; f.ui.refresh(); assert.doesNotMatch(f.html, /shop-interior-art|merchant_iron/);
  f.ui.show('atlas'); f.click('Find mountain mine'); assert.deepEqual({ x: f.ui.getWaypoint().x, z: f.ui.getWaypoint().z }, { x: CAVE_ENTRANCE.x, z: CAVE_ENTRANCE.z }); assert.match(f.html, /stone above · iron and coal below · sulfur in the deepest chamber/);
});

test('market, public Watch and cannon entrances expose destination-specific requested delivery counters', t => {
  const destinations = [], f = fixture(t, { showDeliveries: id => destinations.push(id) }), site = PLOTS.find(p => p.id === 'outpost-1');
  const cannon = { id: site.id, ownerId: 'bob', ownerName: 'Bob', building: 'cannon', hp: 500, maxHp: 500, storage: {} };
  f.state.plots = [cannon];
  f.state.requests = { items: [{ id: 'one', status: 'open', destinationId: 'bank' }, { id: 'two', status: 'open', destinationId: 'barracks' }, { id: 'three', status: 'open', destinationId: site.id }] };
  for (const [kind, id] of [['market', null], ['barracks', null], ['plot', site.id]]) {
    f.visit(kind, id); assert.match(f.html, /1 funded delivery for this destination/); f.click('Requested deliveries'); assert.equal(destinations.at(-1), id || (kind === 'market' ? 'bank' : kind));
  }
  f.visit('market'); const stale = f.buttons.find(b => b.text === 'Requested deliveries'); const before = destinations.length;
  Object.assign(f.player, { x: 0, z: 0 }); stale.onclick(); assert.equal(destinations.length, before); assert.match(f.html, /BUILDING ENTRANCE/);
  assert.ok(!f.buttons.some(b => b.text === 'Requested deliveries'), 'remote service navigation cannot open a delivery counter');
  f.visit('market'); f.state.requests.items.push({ id: 'four', status: 'open', destinationId: 'bank' }); f.ui.refresh(); assert.match(f.html, /2 funded deliveries for this destination/);
  cannon.building = 'barracks'; f.visit('plot', site.id); assert.ok(!f.buttons.some(b => b.text === 'Requested deliveries'), 'owned barracks are not public request destinations');
  cannon.building = 'cannon'; cannon.hp = 0; f.visit('plot', site.id); assert.ok(!f.buttons.some(b => b.text === 'Requested deliveries'), 'ruined destinations offer no turn-in counter');
  f.ui.show('atlas'); f.click('Find request board'); assert.deepEqual(f.ui.getWaypoint(), NOTICEBOARD_POINT);
});

test('empty owned land exposes storage and construction can use staged materials', t => {
  const f = fixture(t), id = PLOTS[0].id;
  f.state.plots = [{ id, ownerId: 'alice', ownerName: 'Alice', building: null, storage: { timber: 35, stone: 25 }, hp: 0 }];
  f.visit('plot', id);
  assert.match(f.html, /Materials stored on an empty plot/);
  assert.ok(f.buttons.some(b => b.text === 'Store'));
  for (let i = 0; i < 11 && !f.html.includes('data-building-art="barracks"'); i++) f.click('Next building');
  assert.match(f.html, /data-building-art="barracks"/); assert.equal(f.buttons.find(b => b.text === 'Build barracks').disabled, false);
  assert.equal((f.html.match(/class="build-carousel-slide"/g) || []).length, 1);
  f.click('Build barracks'); assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'plot_build', plotId: id, building: 'barracks' });
});

test('building carousel retains its plan and keyboard focus, rechecks stale funds, and confirms conversions', t => {
  const f = fixture(t), id = PLOTS[0].id;
  f.player.inventory = { timber: 500, stone: 500, iron: 500, coal: 500 };
  const plot = { id, ownerId: 'alice', ownerName: 'Alice', building: null, storage: {}, hp: 0 };
  f.state.plots = [plot]; f.visit('plot', id);
  for (let i = 0; i < 11 && !f.html.includes('data-building-art="archer_tower"'); i++) f.click('Next building');
  assert.match(f.html, /no ammunition required/);
  const next = f.buttons.find(b => b.text === 'Next building'); next.focus(); f.player.wallet++; f.ui.refresh();
  assert.match(f.html, /data-building-art="archer_tower"/);
  assert.equal(document.activeElement, f.buttons.find(b => b.text === 'Next building'));
  const construct = f.buttons.find(b => b.text === 'Build archer tower');
  document.activeElement = f.fields.get('storage-amount'); f.player.wallet = 0; f.ui.refresh();
  construct.onclick(); assert.equal(f.sent.length, 0); assert.match(f.html, /more gold/);
  f.player.wallet = 2000; plot.building = 'house'; plot.hp = 600; plot.maxHp = 600;
  f.visit('plot', id); assert.match(f.html, /data-building-art="archer_tower"/);
  plot.storage.wheat = 1; f.ui.refresh();
  assert.equal(f.buttons.find(b => b.text === 'Convert to archer tower').disabled, true); assert.match(f.html, /Empty this building/);
  plot.storage = {}; f.ui.refresh(); f.click('Convert to archer tower');
  assert.equal(f.sent.length, 0); assert.match(f.html, /Replace this building/); assert.match(f.html, /removes your House/);
  f.click('Confirm change');
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'plot_build', plotId: id, building: 'archer_tower', confirm: true });
  f.ui.clear(); plot.building = null; f.visit('plot', id);
  assert.match(f.html, /data-building-art="tool_shop"/); assert.doesNotMatch(f.html, /data-building-art="archer_tower"/);
});

test('crafting asks before destroying equipped durability and confirms the exact recipe', t => {
  const f = fixture(t), id = PLOTS[0].id;
  f.state.plots = [{ id, ownerId: 'bob', ownerName: 'Bob', building: 'tool_shop', level: 1, storage: { timber: 5, stone: 10 }, hp: 350, maxHp: 350 }];
  f.visit('plot', id); f.click('Buy · 35g');
  assert.equal(f.sent.length, 0);
  assert.match(f.html, /remaining durability will be lost/);
  f.click('Confirm change');
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'craft_buy', plotId: id, recipe: 'stone_axe', price: 35, confirm: true });
});

test('tinker owners set individual bundle prices and craft supplies into storage while visitors see protected quotes', t => {
  const f = fixture(t), id = PLOTS[0].id;
  const plot = { id, ownerId: f.player.id, ownerName: 'Alice', building: 'tinker_shop', level: 1, hp: 350, maxHp: 350, storage: { sulfur: 20, coal: 10, gunpowder: 5, stone: 20, iron: 20, timber: 30 }, shopPrices: { gunpowder: 37, musket: 231 } };
  f.state.plots = [plot]; f.visit('plot', id);
  assert.equal(f.fields.get('shop-price-gunpowder').value, '37');
  assert.equal(f.fields.get('shop-price-musket').value, '231');
  assert.match(f.html, /Craft into storage/); assert.match(f.html, /64 base \/ shot/); assert.match(f.html, /5 ready in stock/);
  const save = f.buttons.find(button => button.dataset.shopFocus === 'buy-gunpowder-1');
  f.fields.get('shop-price-gunpowder').value = '43'; save.onclick();
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'shop_price', plotId: id, recipe: 'gunpowder', price: 43 });
  f.fields.get('shop-batches-gunpowder').value = '3';
  f.buttons.find(button => button.dataset.shopFocus === 'buy-gunpowder-2').onclick();
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'craft_stock', plotId: id, recipe: 'gunpowder', batches: 3 });
  plot.ownerId = 'bob'; f.ui.refresh();
  assert.equal(f.fields.has('shop-price-gunpowder'), false); assert.doesNotMatch(f.html, /Craft into storage/);
  f.click('Buy · 37g'); assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'craft_buy', plotId: id, recipe: 'gunpowder', price: 37 });
});

test('visitors can buy with exactly the offline Tinker owner’s discounted material quote and confirmation matches it', t => {
  const f = fixture(t), id = PLOTS[0].id;
  const owner = { id: 'bob', name: 'Bob', role: 'tinker', online: false, wallet: 1000, skills: { tinker_efficiency: 2 } };
  const plot = { id, ownerId: owner.id, building: 'tool_shop', hp: 350, maxHp: 350, storage: { stone: 8, timber: 4 } };
  const village = { players: { alice: f.player, bob: owner }, plots: [plot], clock: 0 };
  f.state.plots = ownershipSnapshot(village, f.player.id).plots;
  assert.deepEqual(f.state.plots[0].shopCosts.stone_axe, { stone: 8, timber: 4 });
  f.visit('plot', id);
  const buy = f.buttons.find(button => button.dataset.shopFocus === 'buy-stone_axe-0');
  assert.equal(buy.disabled, false); buy.onclick();
  assert.match(f.html, /8 stone/); assert.match(f.html, /4 timber/);
  assert.doesNotMatch(f.html, /10 stone/);
  f.click('Confirm change');
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'craft_buy', plotId: id, recipe: 'stone_axe', price: 35, confirm: true });
  owner.role = 'villager'; f.state.plots = ownershipSnapshot(village, f.player.id).plots; f.visit('plot', id);
  assert.equal(f.buttons.find(button => button.dataset.shopFocus === 'buy-stone_axe-0').disabled, true, 'the newly quoted full recipe exceeds stored materials when the owner changes roles');
});

test('shop price drafts survive blur and snapshots and each price quote remains tied to its rendered item', t => {
  const f = fixture(t), id = PLOTS[0].id;
  const plot = { id, ownerId: f.player.id, building: 'tool_shop', hp: 350, maxHp: 350, storage: { stone: 50, timber: 50 }, shopPrices: {} };
  f.state.plots = [plot]; f.visit('plot', id);
  f.fields.get('shop-price-stone_axe').value = '77'; f.player.wallet++; f.ui.refresh();
  assert.equal(f.fields.get('shop-price-stone_axe').value, '77');
  const quote = f.buttons.find(button => button.dataset.shopFocus === 'buy-stone_axe-0');
  plot.shopPrices.stone_axe = 99; quote.onclick(); f.click('Confirm change');
  assert.equal(f.sent.at(-1).price, 35, 'a price change is left to server quote rejection rather than silently charging the new price');
});

test('permanent sanctuary offers guidance; player churches dispatch paid bed treatment', t => {
  const f = fixture(t), id = PLOTS[0].id;
  f.visit('church', 'church');
  assert.ok(f.buttons.some(b => b.text === 'Find a player church'));
  assert.ok(!f.buttons.some(b => b.text.includes('rest')));
  f.state.plots = [{ id, ownerId: 'bob', ownerName: 'Bob', building: 'church', level: 1, storage: {}, hp: 650, maxHp: 650 }];
  f.state.beds = [{ plotId: id, capacity: 2, patients: [] }];
  f.visit('plot', id); f.click('Pay 8g and rest');
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'churchTreat', plotId: id });
});

test('snapshot refresh preserves an edited amount and escapes resident names', t => {
  const f = fixture(t); f.visit('bank');
  const input = f.fields.get('bank-amount'); input.value = '37'; document.activeElement = input;
  const before = f.openCount; f.player.wallet++; f.ui.refresh();
  assert.equal(f.openCount, before); assert.equal(input.value, '37');
  document.activeElement = null; f.ui.refresh(); assert.ok(f.openCount > before);
  f.state.plots = [{ id: PLOTS[0].id, ownerId: 'bob', ownerName: '<img src=x onerror=alert(1)>', building: 'house', storage: {} }];
  f.visit('plot', PLOTS[0].id);
  assert.doesNotMatch(f.html, /<img src=x/); assert.match(f.html, /&lt;img src=x/);
});

test('all service and plot panel branches render from a complete expansion snapshot', t => {
  const f = fixture(t);
  for (const kind of ['inventory', 'bank', 'market', 'food', 'tools', 'barracks', 'church', 'stable', 'merchant', 'policies', 'roles', 'atlas']) {
    f.visit(kind, kind === 'church' ? 'church' : null); assert.match(f.html, /<h2>/);
  }
  for (const building of ['tool_shop', 'tinker_shop', 'sword_shop', 'house', 'mine', 'tree_farm', 'wheat_farm', 'barracks', 'church', 'archer_tower', 'cannon']) {
    f.state.plots = [{ id: PLOTS[0].id, ownerId: 'alice', ownerName: 'Alice', building, hp: 300, maxHp: 500, level: 1, storage: { timber: 100, stone: 100, iron: 100, coal: 100, wheat: 100, arrows: 100 } }];
    f.visit('plot', PLOTS[0].id); assert.match(f.html, /Building storage/); assert.doesNotMatch(f.html, /\[object Object\]/);
  }
});

test('new arrivals can choose one wooden tool and see where to buy larger backpacks', t => {
  const f = fixture(t);
  f.player.wallet = 10; f.player.inventory = {}; f.player.durability = {}; f.player.tiers = {};
  f.visit('tools');
  assert.match(f.html, /Start with 10 gold and choose your first wooden tool/);
  assert.equal(f.buttons.filter(b => b.text === 'Buy · 10g' && !b.disabled).length, 4);
  assert.ok(f.buttons.filter(b => b.text.startsWith('Equip ·')).every(b => b.disabled));
  f.click('Buy · 10g');
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'buyTool', tool: 'axe' });
  f.visit('inventory');
  assert.match(f.html, /0 \/ 100/); assert.doesNotMatch(f.html, /Wooden axe/);
  f.click('Mark the backpack shop');
  assert.equal(f.ui.getWaypoint().id, 'tools');
});

test('backpack shop uses equipped capacity, offers only upgrades, and accepts purchase credit', t => {
  const f = fixture(t);
  f.player.backpackTier = 1; f.player.wallet = 30; f.state.loan.credit = 70;
  f.visit('tools');
  assert.match(f.html, /\/ 200/); assert.match(f.html, /Simple backpack/);
  assert.ok(!f.buttons.some(b => b.text === 'Equip · 40g'));
  assert.ok(f.buttons.find(b => b.text === 'Equip · 200g').disabled);
  f.click('Equip · 100g');
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'buyBackpack', tier: 2 });
  f.player.backpackTier = 2; f.ui.refresh();
  assert.match(f.html, /\/ 350/);
  assert.ok(!f.buttons.some(b => b.text === 'Equip · 100g'));
});

test('resource purchase controls allow upgraded backpack capacity and stop at its actual limit', t => {
  const f = fixture(t);
  f.player.inventory = { wheat: 150 }; f.player.durability = {}; f.player.backpackTier = 1;
  const price = taxedPurchaseQuote('wheat', 100, 10, 10).total;
  f.visit('market');
  assert.ok(!f.buttons.find(b => b.text === `Buy 10 · ${price}g`).disabled);
  f.player.inventory.wheat = 195; f.ui.refresh();
  assert.ok(f.buttons.find(b => b.text === `Buy 10 · ${price}g`).disabled);
});

test('barracks preserve recruited slots while showing replacement wheat and countdown', t => {
  const f = fixture(t), id = PLOTS[0].id;
  f.state.plots = [{ id, ownerId: 'alice', building: 'barracks', hp: 650, maxHp: 650, storage: { wheat: 0, timber: 100, iron: 100 } }];
  f.state.guards = [{ id: 'one', plotId: id, hp: 100 }, { id: 'two', plotId: id, hp: 100 }];
  f.state.guardReplacements = [{ guardId: 'three', plotId: id, ownerId: 'alice', remaining: 12, waitingForWheat: true }];
  f.visit('plot', id);
  assert.match(f.html, /Recruited slots<\/span><strong>3 \/ 3/);
  assert.match(f.html, /Waiting for 1 wheat in this barracks/);
  assert.ok(f.buttons.find(b => b.text === 'Recruit Swordsman · 35g').disabled);
  f.state.guardReplacements[0].waitingForWheat = false;
  f.state.guardReplacements[0].remaining = 8; f.ui.refresh();
  assert.match(f.html, /Returns in 8 seconds/);
  f.state.guardReplacements = [{ guardId: 'watch', plotId: null, ownerId: null, remaining: 0, waitingForWheat: true }];
  f.visit('barracks'); assert.match(f.html, /Waiting for 1 wheat in this barracks/);
});

test('owned barracks expose ranged recruitment, per-soldier training and ammunition status', t => {
  const f = fixture(t), id = PLOTS[0].id;
  f.state.plots = [{ id, ownerId: f.player.id, building: 'barracks', level: 2, hp: 975, maxHp: 975, storage: { wheat: 10, timber: 100, iron: 100, arrows: 0, musket_ammo: 10 } }];
  f.state.guards = [{ id: 'archer-1', plotId: id, unitType: 'archer', troopLevel: 1, hp: 110, maxHp: 120 }];
  f.visit('plot', id);
  assert.match(f.html, /Recruited slots<\/span><strong>1 \/ 6/);
  assert.match(f.html, /Archer · Level 1/); assert.match(f.html, /Out of ammunition · restock this barracks/);
  assert.match(f.html, /Training: 55 gold · 10 timber · 3 iron → 160 health · 25 damage/);
  f.click('Recruit Musketeer · 70g');
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'recruitGuard', plotId: id, unitType: 'musketeer' });
  f.click('Train Archer · 55g');
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'upgradeTroop', plotId: id, guardId: 'archer-1' });
  f.state.guards[0].troopLevel = 2; f.player.wallet -= 55; f.ui.refresh();
  assert.match(f.html, /Archer · Level 2/); assert.equal(f.buttons.some(b => b.text === 'Train Archer · 55g'), false);
});

test('automatic defenses explain ammunition, server firing status, range, and repair needs', t => {
  const f = fixture(t), id = PLOTS[0].id;
  const plot = { id, ownerId: 'alice', building: 'archer_tower', hp: 700, maxHp: 700, storage: {} };
  f.state.plots = [plot];
  f.state.defenseStatus = [{ plotId: id, status: 'empty', range: 22, shotsRemaining: 0 }];
  f.visit('plot', id);
  assert.match(f.html, /data-defense-state="ready"/);
  assert.match(f.html, /without arrows or other ammunition/);
  assert.match(f.html, /Shots available<\/span><strong>Unlimited/);
  plot.storage.arrows = 8;
  f.state.defenseStatus = [{ plotId: id, status: 'firing', range: 26, shotsRemaining: 8 }];
  f.ui.refresh();
  assert.match(f.html, /Engaging zombies/); assert.match(f.html, /26 m/);
  assert.match(f.html, /Shots available<\/span><strong>Unlimited/);
  f.state.defenseStatus[0].status = 'out_of_range'; f.ui.refresh();
  assert.match(f.html, /Waiting for targets/);
  plot.hp = 0; f.visit('plot', id); assert.match(f.html, /data-defense-state="destroyed"/);
  plot.hp = 500; plot.building = 'cannon'; plot.storage = { coal: 3, stone: 8 }; f.state.defenseStatus = [];
  f.visit('plot', id); assert.match(f.html, /Shots available<\/span><strong>3/);
  assert.match(f.html, /Coal stored/); assert.match(f.html, /Stone stored/);
});

test('market accepts a full-pack quantity and displays exact tax before submitting its quote', t => {
  const f = fixture(t);
  f.player.inventory = { wheat: 325 }; f.player.durability = {}; f.player.backpackTier = 2;
  f.visit('market');
  const input = f.fields.get('trade-amount-wheat'), sale = taxedSaleQuote('wheat', 100, 325, 10);
  input.value = '325'; input.oninput();
  assert.equal(f.fields.get('trade-sell-quote-wheat').textContent, `Sell: receive ${sale.total}g (${sale.gross}g value − ${sale.tax}g tax).`);
  f.click(`Sell 325 · ${sale.total}g`);
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'sell', resource: 'wheat', amount: 325, minTotal: sale.total });
  f.player.inventory.wheat = 0; f.state.stock.wheat = 500;
  input.value = '137'; input.oninput();
  const purchase = taxedPurchaseQuote('wheat', 500, 137, 10);
  assert.equal(f.fields.get('trade-buy-quote-wheat').textContent, `Buy: pay ${purchase.total}g (${purchase.subtotal}g price + ${purchase.tax}g tax).`);
  f.click(`Buy 137 · ${purchase.total}g`);
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'buyResource', resource: 'wheat', amount: 137, maxTotal: purchase.total });
});

test('market quantity stays focused while live stock changes refresh displayed quotes', t => {
  const f = fixture(t); f.player.inventory.wheat = 40; f.visit('market');
  const input = f.fields.get('trade-amount-wheat'); input.value = '37'; input.oninput();
  document.activeElement = input;
  const before = f.openCount; f.state.stock.wheat = 20; f.ui.refresh();
  assert.equal(f.openCount, before); assert.equal(document.activeElement, input); assert.equal(input.value, '37');
  assert.equal(f.fields.get('trade-buy-wheat').disabled, true);
  assert.match(f.fields.get('trade-buy-quote-wheat').textContent, /village has only 20 wheat/);
  const sale = taxedSaleQuote('wheat', 20, 37, 10);
  f.click(`Sell 37 · ${sale.total}g`);
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'sell', resource: 'wheat', amount: 37, minTotal: sale.total });
  document.activeElement = null; f.ui.refresh();
  assert.equal(f.fields.get('trade-amount-wheat').value, '37');
});

test('market rejects invalid quantities and prevents buying beyond pack, wallet, or stock', t => {
  const f = fixture(t); f.player.inventory = { wheat: 95 }; f.player.durability = {}; f.visit('market');
  const input = f.fields.get('trade-amount-wheat');
  for (const raw of ['', '0', '-1', '1.5', '10001', 'Infinity']) {
    input.value = raw; input.oninput();
    assert.ok(f.fields.get('trade-sell-wheat').disabled); assert.ok(f.fields.get('trade-buy-wheat').disabled);
    f.fields.get('trade-sell-wheat').onclick(); f.fields.get('trade-buy-wheat').onclick();
  }
  assert.equal(f.sent.length, 0);
  input.value = '6'; input.oninput();
  assert.match(f.fields.get('trade-buy-quote-wheat').textContent, /room for 5 more wheat/);
  assert.ok(f.fields.get('trade-buy-wheat').disabled);
  input.value = '5'; f.player.wallet = 0; input.oninput();
  assert.match(f.fields.get('trade-buy-quote-wheat').textContent, /not have enough gold/);
  f.player.wallet = 2000; f.state.stock.wheat = 3; input.oninput();
  assert.match(f.fields.get('trade-buy-quote-wheat').textContent, /village has only 3 wheat/);
  f.state.treasury = 500; input.oninput();
  assert.ok(f.fields.get('trade-sell-wheat').disabled);
  assert.match(f.fields.get('trade-sell-quote-wheat').textContent, /treasury cannot pay/);
});

test('backpack totals include the villager carrying bonus while upgrades retain their added capacity', t => {
  const f = fixture(t); f.player.role = 'villager'; f.player.backpackTier = 1;
  f.visit('tools');
  assert.match(f.html, /250 total carrying capacity/);
  assert.match(f.html, /400 total capacity · \+150 more weight/);
  assert.match(f.html, /550 total capacity · \+300 more weight/);
  f.player.role = 'guard'; f.ui.refresh();
  assert.match(f.html, /200 total carrying capacity/);
  assert.match(f.html, /350 total capacity · \+150 more weight/);
});

test('starter tools can use approved purchase credit and role cards explain their traits', t => {
  const f = fixture(t); f.player.wallet = 0; f.player.durability = {}; f.state.loan.credit = 10;
  f.visit('tools');
  assert.match(f.html, /Purchase credit/);
  f.click('Buy · 10g');
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'buyTool', tool: 'axe' });
  f.visit('roles');
  assert.match(f.html, /Carry 50 extra weight/);
  assert.match(f.html, /Gain 40 shield; it recovers 4 per second after 6 seconds/);
  assert.match(f.html, /125 maximum health/);
});

test('services and owned buildings require their entrances, while the atlas remains remote', t => {
  const f = fixture(t);
  for (const kind of ['bank', 'market', 'food', 'tools', 'barracks', 'church', 'stable', 'merchant']) {
    const site = BUILDINGS.find(b => b.id === kind);
    Object.assign(f.player, { x: site.x, z: site.z });
    f.ui.show(kind, kind === 'church' ? 'church' : null);
    assert.match(f.html, /BUILDING ENTRANCE/);
    assert.equal(f.buttons.length, 1);
    f.click('Mark entrance');
    assert.deepEqual({ x: f.ui.getWaypoint().x, z: f.ui.getWaypoint().z }, buildingEntrance(site));
    f.visit(kind, kind === 'church' ? 'church' : null);
    assert.doesNotMatch(f.html, /BUILDING ENTRANCE/);
  }
  const site = PLOTS[0], plot = { id: site.id, ownerId: 'alice', building: 'tool_shop', hp: 300, storage: {} };
  f.state.plots = [plot];
  Object.assign(f.player, { x: site.x, z: site.z });
  f.ui.show('plot', site.id); assert.match(f.html, /BUILDING ENTRANCE/);
  assert.doesNotMatch(f.html, /Building storage/);
  f.visit('plot', site.id); assert.match(f.html, /Building storage/);
  f.player.x = 100; f.player.z = 100; f.ui.show('atlas');
  assert.match(f.html, /VILLAGE ATLAS/);
  const serviceRows = BUILDINGS.filter(b => b.kind !== 'house');
  f.buttons.filter(button => button.text === 'Mark')[serviceRows.length].onclick();
  assert.deepEqual({ x: f.ui.getWaypoint().x, z: f.ui.getWaypoint().z }, plotEntrance(site, plot));
  assert.equal(f.ui.getWaypoint().kind, 'plot');
  plot.building = null;
  const openLandPoint = { x: f.ui.getWaypoint().x, z: f.ui.getWaypoint().z };
  plot.building = 'house';
  const housePoint = { x: f.ui.getWaypoint().x, z: f.ui.getWaypoint().z };
  assert.deepEqual(housePoint, plotEntrance(site, plot));
  assert.notDeepEqual(housePoint, openLandPoint);
  f.buttons.filter(button => button.text === 'Mark')[serviceRows.findIndex(b => b.id === 'bank')].onclick();
  assert.deepEqual({ x: f.ui.getWaypoint().x, z: f.ui.getWaypoint().z }, buildingEntrance(BUILDINGS.find(b => b.id === 'bank')));
});

test('walking away invalidates focused service controls and pending purchase confirmations', t => {
  const f = fixture(t); f.visit('bank');
  const staleDeposit = f.buttons.find(b => b.text === 'Deposit');
  document.activeElement = f.fields.get('bank-amount');
  f.player.x = -24; staleDeposit.onclick();
  assert.equal(f.sent.length, 0); assert.match(f.html, /BUILDING ENTRANCE/);
  f.visit('bank'); document.activeElement = f.fields.get('bank-amount');
  f.player.x = -24; f.ui.refresh();
  assert.match(f.html, /BUILDING ENTRANCE/); assert.equal(f.fields.has('bank-amount'), false);
  document.activeElement = null;
  const id = PLOTS[0].id;
  f.state.plots = [{ id, ownerId: 'bob', building: 'tool_shop', hp: 350, storage: { timber: 5, stone: 10 } }];
  f.visit('plot', id); f.click('Buy · 35g');
  f.player.x = PLOTS[0].x; f.click('Confirm change');
  assert.equal(f.sent.length, 0); assert.match(f.html, /BUILDING ENTRANCE/);
});

test('church bedside panels preserve treatment and leaving bed without exposing plot storage', t => {
  const f = fixture(t), site = PLOTS[0];
  f.state.plots = [{ id: site.id, ownerId: 'alice', building: 'church', level: 2, hp: 650, maxHp: 650, storage: {} }];
  f.state.beds = [{ plotId: site.id, capacity: 4, patients: [] }];
  Object.assign(f.player, plotBedPoint(site, 2));
  f.ui.show('church', site.id);
  assert.match(f.html, /SANCTUARY BEDS/); assert.doesNotMatch(f.html, /Building storage|Convert this plot/);
  f.click('Pay 8g and rest');
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'churchTreat', plotId: site.id });
  f.player.bedPlotId = site.id; f.ui.refresh();
  f.click('Leave your bed'); assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'churchLeave' });
  f.ui.show('plot', site.id);
  assert.match(f.html, /Leave your bed/); assert.doesNotMatch(f.html, /Building storage/);
});

test('council voting remains remote but submitting a proposal needs a council entrance', t => {
  const f = fixture(t);
  f.state.proposals = [{ id: 'vote-one', policy: 'guardWage', value: 30, proposerName: 'Bob', yes: 0, no: 0, required: 1, status: 'voting', canVote: true }];
  f.ui.show('policies');
  assert.equal(f.buttons.find(b => b.text === 'Submit proposal').disabled, true);
  assert.match(f.html, /vote from anywhere/);
  f.click('Vote yes'); assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'vote_policy', proposalId: 'vote-one', approve: true });
  Object.assign(f.player, buildingEntrance(BUILDINGS.find(b => b.id === 'keep'))); f.ui.refresh();
  assert.equal(f.buttons.find(b => b.text === 'Submit proposal').disabled, false);
  f.player.x = 100; f.click('Submit proposal');
  assert.equal(f.sent.length, 1);
  assert.equal(f.buttons.find(b => b.text === 'Submit proposal').disabled, true);
});

test('council and merchant show percentage exports and submit the saved policy choice', t => {
  const f = fixture(t);
  Object.assign(f.player, buildingEntrance(BUILDINGS.find(b => b.id === 'keep')));
  f.state.proposals = [{ id: 'export-vote', policy: 'exportPriority', value: 'trade', proposerName: 'Bob', yes: 1, no: 0, required: 2, status: 'approved', effectiveDay: 3 }];
  f.ui.show('policies');
  assert.equal(f.fields.get('export-priority').value, 'balanced');
  assert.match(f.html, /Conserve · 25% of surplus/);
  assert.match(f.html, /Balanced · 50% of surplus/);
  assert.match(f.html, /Merchant export policy → Trade · 100% of surplus/);
  assert.match(f.html, /after food and repair reserves/);
  assert.match(f.html, /no unit cap/);
  f.fields.get('export-priority').value = 'trade'; f.click('Propose resource priority');
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'propose_policy', policy: 'exportPriority', value: 'trade' });
  f.visit('merchant');
  assert.match(f.html, /current council policy sells 50%/);
  assert.match(f.html, /round down to whole units/);
  f.state.policies.exportPriority = 'trade'; f.ui.refresh();
  assert.match(f.html, /current council policy sells 100%/);
  f.state.policies.exportPriority = 'conserve'; f.ui.refresh();
  assert.match(f.html, /current council policy sells 25%/);
});

test('storage preserves typed 10 and its selected resource after focus moves to a button and a snapshot rerenders', t => {
  const f = fixture(t), site = PLOTS[0];
  f.player.inventory.stone = 25;
  f.state.plots = [{ id: site.id, ownerId: f.player.id, building: 'house', hp: 500, maxHp: 500, storage: { stone: 4 } }];
  f.visit('plot', site.id);
  const resource = f.fields.get('storage-resource'), input = f.fields.get('storage-amount');
  resource.value = 'stone'; resource.onchange(); input.value = '10'; input.oninput();
  document.activeElement = f.fields.get('storage-store');
  f.player.hunger--; f.ui.refresh();
  assert.equal(f.fields.get('storage-resource').value, 'stone');
  assert.equal(f.fields.get('storage-amount').value, '10');
  f.click('Store');
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'plot_deposit', plotId: site.id, resource: 'stone', amount: 10 });
  f.fields.get('storage-amount').value = ''; f.fields.get('storage-amount').oninput();
  assert.equal(f.fields.get('storage-store').disabled, true);
  f.click('Store max');
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'plot_deposit', plotId: site.id, resource: 'stone', max: true });
  f.click('Take max');
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'plot_withdraw', plotId: site.id, resource: 'stone', max: true });
  f.fields.get('storage-amount').value = '1.5'; f.fields.get('storage-amount').oninput();
  assert.equal(f.fields.get('storage-take').disabled, true, 'fractional quantities cannot silently round down');
});

test('bank quantities survive snapshots after blur and all buttons ignore unfinished drafts', t => {
  const f = fixture(t); f.visit('bank');
  const field = f.fields.get('bank-amount'); field.value = '37'; field.oninput();
  document.activeElement = f.fields.get('bank-deposit'); f.player.wallet++; f.ui.refresh();
  assert.equal(f.fields.get('bank-amount').value, '37');
  f.click('Deposit'); assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'deposit', amount: 37 });
  f.fields.get('bank-amount').value = ''; f.fields.get('bank-amount').oninput();
  f.click('Deposit all'); assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'deposit', max: true });
  f.click('Withdraw all'); assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'withdraw', max: true });
  f.player.bank = 0; document.activeElement = f.fields.get('bank-amount'); f.ui.refresh();
  assert.equal(f.fields.get('bank-withdraw-max').disabled, true);
});

test('equipped resource packs update market limits and worker collection at exact carrying boundaries', t => {
  const f = fixture(t);
  f.player.inventory = { wheat: 76 }; f.player.durability = {}; f.player.crateEquipment = { utility: 'mining_pack' };
  f.visit('market');
  assert.equal(f.fields.get('trade-weight-stone').textContent, '2.4 weight each');
  assert.equal(f.fields.get('trade-buy-stone').disabled, false, 'ten discounted stone fit exactly');
  const input = f.fields.get('trade-amount-stone'); document.activeElement = input;
  f.player.crateEquipment = {}; f.ui.refresh();
  assert.equal(f.fields.get('trade-weight-stone').textContent, '3 weight each');
  assert.equal(f.fields.get('trade-buy-stone').disabled, true);
  assert.match(f.fields.get('trade-buy-quote-stone').textContent, /room for 8 more stone/);
  document.activeElement = null;
  f.player.inventory = { wheat: 97, arrows: 6 }; f.player.crateEquipment.utility = 'mining_pack';
  f.state.workers = [{ id: 'worker-one', ownerId: f.player.id, x: f.player.x, z: f.player.z, cargo: { stone: 1 }, resource: 'stone' }];
  f.ui.show('workers');
  f.click('Collect carried supplies');
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'worker_collect', workerId: 'worker-one' });
  f.player.crateEquipment = {}; f.ui.refresh();
  assert.equal(f.buttons.find(button => button.text === 'Collect carried supplies').disabled, true);
});

test('bound starter food shows its transferable remainder and storage max cannot include it', t => {
  const f = fixture(t), site = PLOTS[0];
  f.player.inventory = { food: 5 }; f.player.boundInventory = { food: 3 }; f.player.durability = {};
  f.state.plots = [{ id: site.id, ownerId: f.player.id, building: 'house', hp: 500, maxHp: 500, storage: {} }];
  f.visit('inventory'); assert.match(f.html, /5 carried · 2 transferable · 3 kit-bound \(eat only\)/);
  f.visit('food'); assert.match(f.html, /Kit food is eaten first/); assert.match(f.html, /Transferable<\/dt><dd>2/);
  f.visit('plot', site.id);
  assert.equal(f.fields.get('storage-resource').value, 'food');
  const quantity = f.fields.get('storage-amount'); quantity.value = '4'; quantity.oninput();
  assert.equal(f.fields.get('storage-store').disabled, true);
  assert.match(f.fields.get('storage-transfer-status').textContent, /Store up to 2/);
  f.click('Store max'); assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'plot_deposit', plotId: site.id, resource: 'food', max: true });
  document.activeElement = quantity; f.player.boundInventory.food = 5; f.ui.refresh();
  assert.equal(f.fields.get('storage-store-max').disabled, true);
  assert.match(f.fields.get('storage-transfer-status').textContent, /0 transferable · 5 kit-bound/);
});

test('tool cards show purchase durability while carried tools retain their saved durability maximum', t => {
  const f = fixture(t), site = PLOTS[0]; f.player.crateEquipment = { utility: 'miners_buckle' };
  f.player.durability.pickaxe = 90;
  f.visit('inventory'); assert.match(f.html, /90 \/ 100 uses remaining/);
  f.player.maxDurability = { pickaxe: 110 }; f.ui.refresh(); assert.match(f.html, /90 \/ 110 uses remaining/);
  f.visit('tools');
  assert.match(f.html.match(/<article[^>]*data-shop-item="wood_pickaxe"[\s\S]*?<\/article>/)[0], /110 uses/);
  assert.match(f.html.match(/<article[^>]*data-shop-item="wood_hammer"[\s\S]*?<\/article>/)[0], /100 uses/);
  f.state.plots = [{ id: site.id, ownerId: 'bob', building: 'tool_shop', hp: 350, storage: { stone: 100, timber: 100, coal: 100, iron: 100 } }];
  f.visit('plot', site.id);
  assert.match(f.html.match(/<article[^>]*data-shop-item="stone_pickaxe"[\s\S]*?<\/article>/)[0], /165 uses/);
});

test('pack and merchant displays use deployed gear and keep stored resource weights undiscounted', t => {
  const f = fixture(t), site = PLOTS[0];
  f.player.inventory = { wheat: 97, arrows: 6 }; f.player.durability = {}; f.player.crateEquipment = { utility: 'mining_pack' };
  f.visit('merchant'); assert.match(f.html, /One unit weighs 2.4/); f.click('Buy one · 9g');
  f.player.crateEquipment = { utility: 'foragers_pouch' }; f.visit('inventory'); assert.match(f.html, /97.6 \/ 115/);
  f.player.crateEquipment = { utility: 'deep_delvers_belt' }; f.ui.refresh(); assert.match(f.html, /97.6 \/ 140/);
  f.player.crateEquipment = { utility: 'lumber_pack' }; f.player.inventory = { timber: 5 }; f.ui.refresh();
  assert.match(f.html, /1.6 weight each with your equipped pack/); assert.match(f.html, /8 \/ 100/);
  f.state.plots = [{ id: site.id, ownerId: f.player.id, building: 'house', hp: 500, storage: { timber: 5 } }];
  f.visit('plot', site.id); assert.match(f.html, /Capacity: 10 \/ 1,500 weight/);
});

test('production upgrade cards compare current and next numeric benefits through the third tier', t => {
  const f = fixture(t), site = PLOTS[0];
  const plot = { id: site.id, ownerId: f.player.id, ownerName: 'Alice', building: 'mine', level: 1, hp: 450, maxHp: 450, storage: { timber: 100, stone: 100, iron: 100 } };
  f.state.plots = [plot]; f.visit('plot', site.id);
  assert.match(f.html, /data-building-art="mine"/); assert.match(f.html, /Current tier 1 → Next tier 2/);
  assert.match(f.html, /Stone \/ swing<\/span><strong>1<\/strong><strong>2<\/strong>/);
  assert.match(f.html, /Stone harvests \/ node<\/span><strong>8<\/strong><strong>12<\/strong>/);
  assert.match(f.html, /Storage capacity<\/span><strong>1,500 weight<\/strong><strong>2,000 weight<\/strong>/);
  assert.match(f.html, /150 gold/); f.click('Upgrade production to level 2');
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'upgradeProduction', plotId: site.id });
  Object.assign(plot, { level: 2, hp: 675, maxHp: 675 }); f.ui.refresh();
  assert.match(f.html, /Current tier 2 → Next tier 3/);
  assert.match(f.html, /Stone \/ swing<\/span><strong>2<\/strong><strong>3<\/strong>/);
  assert.match(f.html, /Stone harvests \/ node<\/span><strong>12<\/strong><strong>16<\/strong>/);
  assert.match(f.html, /Storage capacity<\/span><strong>2,000 weight<\/strong><strong>3,000 weight<\/strong>/);
  assert.match(f.html, /Building health<\/span><strong>675<\/strong><strong>900<\/strong>/);
  assert.match(f.html, /300 gold/); f.click('Upgrade production to level 3');
  Object.assign(plot, { level: 3, hp: 900, maxHp: 900 }); f.ui.refresh();
  assert.match(f.html, /Tier 3 \/ 3/); assert.match(f.html, /Maximum tier reached/);
  assert.equal(f.buttons.find(button => button.text === 'Fully upgraded').disabled, true);
});

test('defense upgrade cards show numeric health, beds, troop strength and tower damage with material costs', t => {
  const f = fixture(t), site = PLOTS[0];
  for (const [building, hp, metric, current, next] of [['church', 650, 'Treatment beds', 2, 4], ['barracks', 650, 'Troop capacity', 3, 6], ['archer_tower', 700, 'Damage per shot', 20, 30], ['cannon', 900, 'Damage per shot', 48, 72]]) {
    f.state.plots = [{ id: site.id, ownerId: f.player.id, building, level: 1, hp, maxHp: hp, storage: { timber: 100, stone: 100, iron: 100 } }];
    f.visit('plot', site.id);
    assert.match(f.html, new RegExp(`${metric}</span><strong>${current}</strong><strong>${next}</strong>`));
    assert.match(f.html, new RegExp(`Building health</span><strong>${hp.toLocaleString('en-US')}</strong><strong>${(hp * 1.5).toLocaleString('en-US')}</strong>`));
    assert.match(f.html, /class="menu-costs" aria-label="Upgrade cost"/);
    assert.match(f.html, /Current tier 1 → Next tier 2/);
  }
});

test('illustrated treasury service links invoke their supplied panels and retain normal bank controls', t => {
  const opened = [], f = fixture(t, { showInvestments: () => opened.push('investments'), showTavern: () => opened.push('tavern') });
  f.visit('bank'); f.click('Open investments'); f.click('Visit tavern');
  assert.deepEqual(opened, ['investments', 'tavern']); assert.match(f.html, /data-building-art="tool_shop"/);
  f.fields.get('bank-amount').value = '10'; f.fields.get('bank-amount').oninput(); f.click('Deposit');
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'deposit', amount: 10 });
});
