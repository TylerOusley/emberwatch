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
    buttons = [...html.matchAll(/<button\b([^>]*)>(.*?)<\/button>/gs)].map(match => {
      const button = { dataset: { settlementButton: match[1].match(/data-settlement-button="(\d+)"/)[1] }, textContent: match[2], get text() { return this.textContent; }, disabled: /\sdisabled(?:\s|$)/.test(match[1]), tagName: 'BUTTON' };
      const id = match[1].match(/\bid="([^"]+)"/)?.[1]; if (id) fields.set(id, button);
      return button;
    });
    for (const match of html.matchAll(/<(input|select)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) fields.set(match[3], { tagName: match[1].toUpperCase(), value: match[2].match(/\bvalue="([^"]*)"/)?.[1] || '', max: match[2].match(/\bmax="([^"]*)"/)?.[1] || '' });
    for (const match of html.matchAll(/<(p|span)\b[^>]*\bid="([^"]+)"[^>]*>(.*?)<\/\1>/gs)) fields.set(match[2], { tagName: match[1].toUpperCase(), textContent: match[3] });
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

test('new arrivals can choose one wooden tool and see where to buy larger backpacks', t => {
  const f = fixture(t);
  f.player.wallet = 10; f.player.inventory = {}; f.player.durability = {}; f.player.tiers = {};
  f.ui.show('tools');
  assert.match(f.html, /Start with 10 gold and choose your first wooden tool/);
  assert.equal(f.buttons.filter(b => b.text === 'Buy · 10g' && !b.disabled).length, 4);
  assert.ok(f.buttons.filter(b => b.text.startsWith('Equip ·')).every(b => b.disabled));
  f.click('Buy · 10g');
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'buyTool', tool: 'axe' });
  f.ui.show('inventory');
  assert.match(f.html, /0 \/ 100/); assert.doesNotMatch(f.html, /Wooden axe/);
  f.click('Mark the backpack shop');
  assert.equal(f.ui.getWaypoint().id, 'tools');
});

test('backpack shop uses equipped capacity, offers only upgrades, and accepts purchase credit', t => {
  const f = fixture(t);
  f.player.backpackTier = 1; f.player.wallet = 30; f.state.loan.credit = 70;
  f.ui.show('tools');
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
  f.ui.show('bank');
  assert.ok(!f.buttons.find(b => b.text === `Buy 10 · ${price}g`).disabled);
  f.player.inventory.wheat = 195; f.ui.refresh();
  assert.ok(f.buttons.find(b => b.text === `Buy 10 · ${price}g`).disabled);
});

test('barracks preserve recruited slots while showing replacement wheat and countdown', t => {
  const f = fixture(t), id = PLOTS[0].id;
  f.state.plots = [{ id, ownerId: 'alice', building: 'barracks', hp: 650, maxHp: 650, storage: { wheat: 0, timber: 100, iron: 100 } }];
  f.state.guards = [{ id: 'one', plotId: id, hp: 100 }, { id: 'two', plotId: id, hp: 100 }];
  f.state.guardReplacements = [{ guardId: 'three', plotId: id, ownerId: 'alice', remaining: 12, waitingForWheat: true }];
  f.ui.show('plot', id);
  assert.match(f.html, /Recruited slots<\/span><strong>3 \/ 3/);
  assert.match(f.html, /Waiting for 1 wheat in this barracks/);
  assert.ok(f.buttons.find(b => b.text === 'Recruit a guard').disabled);
  f.state.guardReplacements[0].waitingForWheat = false;
  f.state.guardReplacements[0].remaining = 8; f.ui.refresh();
  assert.match(f.html, /Returns in 8 seconds/);
  f.state.guardReplacements = [{ guardId: 'watch', plotId: null, ownerId: null, remaining: 0, waitingForWheat: true }];
  f.ui.show('barracks'); assert.match(f.html, /Waiting for 1 wheat in this barracks/);
});

test('automatic defenses explain ammunition, server firing status, range, and repair needs', t => {
  const f = fixture(t), id = PLOTS[0].id;
  const plot = { id, ownerId: 'alice', building: 'archer_tower', hp: 700, maxHp: 700, storage: {} };
  f.state.plots = [plot];
  f.state.defenseStatus = [{ plotId: id, status: 'empty', range: 22, shotsRemaining: 0 }];
  f.ui.show('plot', id);
  assert.match(f.html, /data-defense-state="empty"/);
  assert.match(f.html, /Out of ammunition/); assert.match(f.html, /player tinker shop or the traveling merchant/);
  assert.match(f.html, /New towers include 20 arrows/);
  plot.storage.arrows = 8;
  f.state.defenseStatus = [{ plotId: id, status: 'firing', range: 26, shotsRemaining: 8 }];
  f.ui.refresh();
  assert.match(f.html, /Engaging zombies/); assert.match(f.html, /26 m/);
  assert.match(f.html, /Shots available<\/span><strong>8/);
  f.state.defenseStatus[0].status = 'out_of_range'; f.ui.refresh();
  assert.match(f.html, /Waiting for targets/);
  plot.hp = 0; f.ui.refresh(); assert.match(f.html, /data-defense-state="destroyed"/);
  plot.hp = 500; plot.building = 'cannon'; plot.storage = { coal: 3, stone: 8 }; f.state.defenseStatus = [];
  f.ui.show('plot', id); assert.match(f.html, /Shots available<\/span><strong>3/);
  assert.match(f.html, /Coal stored/); assert.match(f.html, /Stone stored/);
});

test('treasury accepts a full-pack quantity and displays exact tax before submitting its quote', t => {
  const f = fixture(t);
  f.player.inventory = { wheat: 325 }; f.player.durability = {}; f.player.backpackTier = 2;
  f.ui.show('bank');
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

test('treasury quantity stays focused while live stock changes refresh displayed quotes', t => {
  const f = fixture(t); f.player.inventory.wheat = 40; f.ui.show('bank');
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

test('treasury rejects invalid quantities and prevents buying beyond pack, wallet, or stock', t => {
  const f = fixture(t); f.player.inventory = { wheat: 95 }; f.player.durability = {}; f.ui.show('bank');
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
  f.ui.show('tools');
  assert.match(f.html, /250 total carrying capacity/);
  assert.match(f.html, /400 total capacity · \+150 more weight/);
  assert.match(f.html, /550 total capacity · \+300 more weight/);
  f.player.role = 'guard'; f.ui.refresh();
  assert.match(f.html, /200 total carrying capacity/);
  assert.match(f.html, /350 total capacity · \+150 more weight/);
});

test('starter tools can use approved purchase credit and role cards explain their traits', t => {
  const f = fixture(t); f.player.wallet = 0; f.player.durability = {}; f.state.loan.credit = 10;
  f.ui.show('tools');
  assert.match(f.html, /Purchase credit/);
  f.click('Buy · 10g');
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'buyTool', tool: 'axe' });
  f.ui.show('roles');
  assert.match(f.html, /Carry 50 extra weight/);
  assert.match(f.html, /Gain 40 shield; it recovers 4 per second after 6 seconds/);
  assert.match(f.html, /125 maximum health/);
});
