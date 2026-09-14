import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettlementUI } from '../public/src/settlement-ui.js';
import { PLOTS } from '../shared/world.js';
import { taxedSaleQuote, taxedPurchaseQuote, foodQuote } from '../shared/economy.js';

// A narrow DOM harness verifies displayed quotes and dispatched actions without
// WebGL. It is intentionally not a screenshot or browser rendering test.
function fixture(t) {
  const prior = globalThis.document;
  let html = '', openCount = 0, nodes = [], buttons = [], activePanel = null;
  const fields = new Map(), sent = [];
  const player = { id: 'alice', name: 'Alice', role: 'guard', x: 0, z: 0, wallet: 2000, bank: 80, hp: 70, maxHp: 100, hunger: 50, inventory: { wheat: 10, timber: 0, stone: 0, iron: 0, coal: 0 }, durability: { sword: 100, axe: 75, pickaxe: 100, scythe: 100, hammer: 100 }, tiers: { sword: 'wood', axe: 'wood', pickaxe: 'wood', scythe: 'wood', hammer: 'wood' } };
  const state = { players: [player], plots: [], guards: [], beds: [], stock: { wheat: 100, timber: 100, stone: 100, iron: 100, coal: 100 }, treasury: 2500, policies: { guardWage: 25, priestWage: 25, tradeTax: 10, landTax: 2, exportPriority: 'balanced' }, proposals: [], merchant: { present: true, stock: { iron: 5 }, prices: { iron: 9 } }, stable: { stock: 3 }, loan: { debt: 0, credit: 0, availablePool: 500 }, foodQuotes: Object.fromEntries(['food', 'good_food', 'best_food'].map(id => [id, foodQuote(100, id)])) };
  const content = { contains: e => nodes.includes(e), querySelectorAll: query => query === '[data-settlement-button]' ? buttons : [] };
  const dialog = { open: true, scrollTop: 0, classList: { add() {} } };
  globalThis.document = { activeElement: null, getElementById: id => id === 'panel-content' ? content : id === 'panel-dialog' ? dialog : fields.get(id) || null };
  t.after(() => { globalThis.document = prior; });
  const ui = createSettlementUI({ getState: () => state, getMe: () => player, getActivePanel: () => activePanel, getHotbar: () => ['sword', 'axe', 'pickaxe', 'scythe', 'hammer', 'food', 'bow', 'good_food'], setHotbar() {}, toast() {}, send: value => sent.push(value), openPanel: (next, panel) => {
    html = next; activePanel = panel; openCount++; fields.clear();
    buttons = [...html.matchAll(/<button\b([^>]*)>(.*?)<\/button>/gs)].map(match => ({ dataset: { settlementButton: match[1].match(/data-settlement-button="(\d+)"/)[1] }, text: match[2], disabled: /\sdisabled(?:\s|$)/.test(match[1]), tagName: 'BUTTON' }));
    for (const match of html.matchAll(/<(input|select)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) fields.set(match[3], { tagName: match[1].toUpperCase(), value: match[2].match(/\bvalue="([^"]*)"/)?.[1] || '' });
    nodes = [...buttons, ...fields.values()];
  } });
  return { ui, player, state, sent, fields, get html() { return html; }, get openCount() { return openCount; }, get buttons() { return buttons; }, click(text) { const button = buttons.find(b => b.text === text); assert.ok(button, `Missing button: ${text}`); assert.equal(button.disabled, false, `Disabled button: ${text}`); button.onclick(); } };
}

test('market buttons send the tax-inclusive quotes displayed to the player', t => {
  const f = fixture(t); f.ui.show('bank');
  const sale = taxedSaleQuote('wheat', 100, 10, 10).total;
  const purchase = taxedPurchaseQuote('wheat', 100, 10, 10).total;
  f.click(`Sell 10 · ${sale}g`);
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'sell', resource: 'wheat', amount: 10, minTotal: sale });
  f.click(`Buy 10 · ${purchase}g`);
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'buyResource', resource: 'wheat', amount: 10, maxTotal: purchase });
});

test('empty owned land exposes storage and construction can use staged materials', t => {
  const f = fixture(t), id = PLOTS[0].id;
  f.state.plots = [{ id, ownerId: 'alice', ownerName: 'Alice', building: null, storage: { timber: 35, stone: 25 }, hp: 0 }];
  f.ui.show('plot', id);
  assert.match(f.html, /Materials stored on an empty plot/);
  assert.ok(f.buttons.some(b => b.text === 'Store'));
  const barracks = f.html.match(/<section class="building-card"><strong>Barracks<\/strong>(.*?)<\/section>/s)?.[1];
  assert.ok(barracks); assert.doesNotMatch(barracks, /\sdisabled/);
});

test('crafting asks before destroying equipped durability and confirms the exact recipe', t => {
  const f = fixture(t), id = PLOTS[0].id;
  f.state.plots = [{ id, ownerId: 'bob', ownerName: 'Bob', building: 'tool_shop', level: 1, storage: { timber: 5, stone: 10 }, hp: 350, maxHp: 350 }];
  f.ui.show('plot', id); f.click('Buy · 35g');
  assert.equal(f.sent.length, 0);
  assert.match(f.html, /remaining durability will be lost/);
  f.click('Confirm change');
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'craft_buy', plotId: id, recipe: 'stone_axe', confirm: true });
});

test('permanent sanctuary offers guidance; player churches dispatch paid bed treatment', t => {
  const f = fixture(t), id = PLOTS[0].id;
  f.ui.show('church', 'church');
  assert.ok(f.buttons.some(b => b.text === 'Find a player church'));
  assert.ok(!f.buttons.some(b => b.text.includes('rest')));
  f.state.plots = [{ id, ownerId: 'bob', ownerName: 'Bob', building: 'church', level: 1, storage: {}, hp: 650, maxHp: 650 }];
  f.state.beds = [{ plotId: id, capacity: 2, patients: [] }];
  f.ui.show('plot', id); f.click('Pay 8g and rest');
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'churchTreat', plotId: id });
});

test('snapshot refresh preserves an edited amount and escapes resident names', t => {
  const f = fixture(t); f.ui.show('bank');
  const input = f.fields.get('bank-amount'); input.value = '37'; document.activeElement = input;
  const before = f.openCount; f.player.wallet++; f.ui.refresh();
  assert.equal(f.openCount, before); assert.equal(input.value, '37');
  document.activeElement = null; f.ui.refresh(); assert.ok(f.openCount > before);
  f.state.plots = [{ id: PLOTS[0].id, ownerId: 'bob', ownerName: '<img src=x onerror=alert(1)>', building: 'house', storage: {} }];
  f.ui.show('plot', PLOTS[0].id);
  assert.doesNotMatch(f.html, /<img src=x/); assert.match(f.html, /&lt;img src=x/);
});

test('all service and plot panel branches render from a complete expansion snapshot', t => {
  const f = fixture(t);
  for (const kind of ['inventory', 'bank', 'food', 'tools', 'barracks', 'church', 'stable', 'merchant', 'policies', 'roles', 'atlas']) {
    f.ui.show(kind, kind === 'church' ? 'church' : null); assert.match(f.html, /<h2>/);
  }
  for (const building of ['tool_shop', 'tinker_shop', 'sword_shop', 'house', 'mine', 'tree_farm', 'wheat_farm', 'barracks', 'church', 'archer_tower', 'cannon']) {
    f.state.plots = [{ id: PLOTS[0].id, ownerId: 'alice', ownerName: 'Alice', building, hp: 300, maxHp: 500, level: 1, storage: { timber: 100, stone: 100, iron: 100, coal: 100, wheat: 100, arrows: 100 } }];
    f.ui.show('plot', PLOTS[0].id); assert.match(f.html, /Building storage/); assert.doesNotMatch(f.html, /\[object Object\]/);
  }
});
