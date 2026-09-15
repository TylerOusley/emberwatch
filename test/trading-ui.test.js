import test from 'node:test';
import assert from 'node:assert/strict';
import { createTradingUI } from '../public/src/trading-ui.js';
import { emptyTradeOffer } from '../shared/trading.js';

function fixture() {
  let html = '', panel = null, buttons = [], inputs = [], renders = 0;
  const sent = [], notices = [], me = { id: 'alice', name: 'Alice', role: 'villager', online: true, hp: 100, x: 0, z: 4, inventory: { timber: 15, stone: 5 }, wallet: 40 };
  const bob = { id: 'bob', name: 'Bob', online: true, hp: 100, x: 1, z: 4 };
  const state = { status: 'active', players: [me, bob], trading: { trade: null, result: null } }, dialog = { scrollTop: 0, classList: { add() {} } };
  const content = { querySelectorAll: selector => selector === '[data-trade-button]' ? buttons : selector === '[data-trade-input]' ? inputs : [] };
  const draftStatus = { textContent: '' };
  const doc = { activeElement: null, getElementById: id => id === 'panel-content' ? content : id === 'panel-dialog' ? dialog : id === 'trade-draft-status' ? draftStatus : inputs.find(input => input.id === id) };
  const ui = createTradingUI({ getMe: () => me, getState: () => state, getActivePanel: () => panel, document: doc, send: value => sent.push(value), toast: value => notices.push(value), openPanel(next, kind) {
    html = next; panel = kind; renders++;
    buttons = [...html.matchAll(/<button\b([^>]*)>(.*?)<\/button>/gs)].map(([, attr, text]) => ({ text, dataset: { tradeButton: attr.match(/data-trade-button="([^"]*)"/)[1] }, disabled: /\sdisabled(?:\s|$)/.test(attr) }));
    inputs = [...html.matchAll(/<input\b([^>]*)>/g)].map(([, attr]) => ({ id: attr.match(/id="([^"]*)"/)[1], value: attr.match(/value="([^"]*)"/)[1], dataset: { tradeInput: attr.match(/data-trade-input="([^"]*)"/)[1] },
      selectionStart: 0, selectionEnd: 0, focus() { doc.activeElement = this; }, setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; } }));
  } });
  function start() {
    state.trading.trade = { id: 'trade-1', status: 'active', inviterId: me.id, playerIds: [me.id, bob.id], players: [{ id: me.id, name: me.name }, { id: bob.id, name: bob.name }], version: 1,
      offers: { alice: emptyTradeOffer(), bob: emptyTradeOffer() }, confirmations: { alice: false, bob: false } };
    ui.show(); return state.trading.trade;
  }
  function click(label) { const button = buttons.find(button => button.text === label); assert.ok(button, label); button.onclick(); }
  function type(id, value) { const input = inputs.find(input => input.dataset.tradeInput === id); input.focus(); input.value = value; input.setSelectionRange(value.length, value.length); input.oninput(); return input; }
  return { ui, me, bob, state, sent, notices, doc, start, click, type, get html() { return html; }, get inputs() { return inputs; }, get buttons() { return buttons; }, get renders() { return renders; }, get draftStatus() { return draftStatus.textContent; }, setPanel(value) { panel = value; } };
}

test('trading lists only eligible nearby players and never opens a modal for unsolicited invitations', () => {
  const f = fixture(); f.state.players.push({ ...f.bob, id: 'distant', name: 'FarAway', x: 20 }, { ...f.bob, id: 'downed', name: 'Fallen', downed: true });
  f.bob.name = '<img onerror="alert(1)">'; f.ui.show(); assert.match(f.html, /&lt;img/); assert.doesNotMatch(f.html, /<img|FarAway|Fallen/);
  f.click('Invite to trade'); assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'trade_invite', targetId: 'bob' });
  f.bob.x = 20; f.click('Invite to trade'); assert.equal(f.sent.length, 1, 'stale buttons recheck proximity'); f.bob.x = 1;
  const trade = f.start(); trade.status = 'invited'; trade.inviterId = 'bob';
  f.setPanel(null); const count = f.renders; f.ui.update(); f.ui.update(); assert.equal(f.renders, count);
  assert.equal(f.notices.filter(text => text.includes('invited you')).length, 1);
  f.ui.show(); f.click('Accept invitation'); assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'trade_accept', tradeId: 'trade-1' });
  f.click('Decline'); assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'trade_cancel', tradeId: 'trade-1' });
});

test('multi-digit draft editing survives snapshots and focused input restoration without sending unsaved values', () => {
  const f = fixture(), trade = f.start();
  const input = f.type('timber', '1'); f.me.wallet = 39; f.ui.update();
  assert.equal(f.doc.activeElement.dataset.tradeInput, 'timber'); assert.notEqual(f.doc.activeElement, input); assert.equal(f.doc.activeElement.value, '1'); assert.equal(f.doc.activeElement.selectionStart, 1);
  f.type('timber', '10'); f.ui.update(); assert.equal(f.doc.activeElement.value, '10'); assert.match(f.draftStatus, /unsaved changes/);
  f.click('Confirm this exchange'); assert.equal(f.sent.length, 0);
  f.click('Update offer'); assert.equal(f.sent.at(-1).kind, 'trade_offer'); assert.equal(f.sent.at(-1).offer.resources.timber, 10);
  trade.offers.alice = structuredClone(f.sent.at(-1).offer); trade.version++; f.ui.update(); assert.match(f.draftStatus, /saved/);
  f.click('Confirm this exchange'); assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'trade_confirm', tradeId: 'trade-1', version: 2 });
});

test('partner offer revisions refresh immediately while preserving your drafts; confirm never approves an unseen revision', () => {
  const f = fixture(), trade = f.start(); trade.offers.bob.gold = 5; f.ui.update();
  f.type('timber', '10'); trade.offers.bob.gold = 8; trade.version++; f.ui.update();
  assert.equal(f.doc.activeElement.value, '10'); assert.match(f.html, /Offer revision 2/); assert.match(f.html, /<strong>8<\/strong>/);
  f.click('Discard edits'); const oldConfirm = f.buttons.find(button => button.text === 'Confirm this exchange');
  trade.offers.bob.gold = 1; trade.version++; oldConfirm.onclick();
  assert.equal(f.sent.length, 0); assert.match(f.notices.at(-1), /offer changed/);
  f.click('Confirm this exchange'); assert.equal(f.sent.at(-1).version, 3);
});

test('invalid quantities disable saving, Max uses current owned amounts, and equipped items are omitted', () => {
  const f = fixture(); f.start();
  for (const value of ['16', '-1', '1.2', '1e2', 'abc', '9999999']) { f.type('timber', value); f.click('Update offer'); assert.equal(f.sent.length, 0); }
  f.me.inventory.timber = 10; f.ui.update(); f.click('Max'); f.click('Update offer');
  assert.equal(f.sent.at(-1).offer.resources.timber, 10);
  assert.equal(f.inputs.some(input => ['cart', 'bow', 'sword'].includes(input.dataset.tradeInput)), false);
  assert.match(f.html, /Equipment, carts, savings and purchase credit stay with their owner/);
});

test('closed panels stay closed, completion notifies once, and ended trades drop stale draft values', () => {
  const f = fixture(); f.start(); f.type('timber', '10'); f.setPanel('settlement'); const count = f.renders;
  f.state.trading = { trade: null, result: { id: 'trade-1', status: 'completed', message: 'Trade complete.' } };
  f.ui.update(); f.ui.update(); assert.equal(f.renders, count); assert.equal(f.notices.filter(text => text === 'Trade complete.').length, 1);
  f.ui.show(); assert.match(f.html, /Trade complete/); const trade = f.start(); trade.id = 'trade-2'; f.ui.update();
  assert.equal(f.inputs.find(input => input.dataset.tradeInput === 'timber').value, '0');
  f.me.downed = true; f.ui.update(); f.click('Cancel trade'); assert.equal(f.sent.at(-1).kind, 'trade_cancel');
});
