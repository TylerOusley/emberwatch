import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestsUI } from '../public/src/requests-ui.js';
import { BUILDINGS } from '../shared/world.js';
import { buildingEntrance } from '../shared/access.js';

function fixture() {
  const point = { ...buildingEntrance(BUILDINGS.find(b => b.id === 'bank')), id: 'bank', name: 'Village Treasury', kind: 'service' };
  const request = { id: 'request-1', destinationId: 'bank', resource: 'wheat', destinationName: 'Village Treasury', point, remaining: 12, unitGold: 5, expiresDay: 2, status: 'open', reason: 'The village needs food.', reserved: 60 };
  const p = { id: 'alice', x: 0, z: 0, inventory: { wheat: 8 } }, state = { status: 'active', plots: [], requests: { items: [request], reservedGold: 60 } };
  let panel = null, html = '', buttons = [], inputs = [], renders = 0;
  const sent = [], marks = [], dialog = { scrollTop: 0, classList: { add() {} } };
  const content = { querySelectorAll: selector => selector === '[data-request-button]' ? buttons : selector === '[data-request-input]' ? inputs : [] };
  const doc = { getElementById: id => id === 'panel-content' ? content : id === 'panel-dialog' ? dialog : null };
  const ui = createRequestsUI({ getState: () => state, getMe: () => p, getActivePanel: () => panel, send: action => sent.push(action), markTarget: value => marks.push(value), document: doc, openPanel(next, kind) {
    html = next; panel = kind; renders++;
    buttons = [...html.matchAll(/<button\b([^>]*)>(.*?)<\/button>/gs)].map(match => ({ dataset: { requestButton: match[1].match(/data-request-button="(\d+)"/)[1] }, text: match[2], disabled: /\sdisabled(?:\s|$)/.test(match[1]) }));
    inputs = [...html.matchAll(/<input\b([^>]*)>/g)].map(match => ({ dataset: { requestInput: match[1].match(/data-request-input="(\d+)"/)[1] }, value: match[1].match(/value="([^"]*)"/)[1] }));
  } });
  return { ui, p, state, request, sent, marks, get html() { return html; }, get buttons() { return buttons; }, get inputs() { return inputs; }, get renders() { return renders; }, close() { panel = null; } };
}

test('noticeboard can be read remotely and marks the doorway but disables remote deliveries', () => {
  const f = fixture(); f.ui.show(); assert.match(f.html, /60 gold reserved/); assert.match(f.html, /12 wheat/);
  assert.ok(f.buttons[0].disabled); f.buttons[1].onclick(); assert.deepEqual(f.marks[0], f.request.point); assert.equal(f.sent.length, 0);
  Object.assign(f.p, f.request.point); f.ui.update(); assert.equal(f.buttons[0].disabled, false);
  f.inputs[0].value = '3'; f.inputs[0].oninput(); f.buttons[0].onclick();
  assert.deepEqual(f.sent[0], { type: 'action', kind: 'request_deliver', requestId: 'request-1', amount: 3 });
});

test('quantity drafts survive snapshots while moving away, stale quotas and invalid amounts prevent sends', () => {
  const f = fixture(); Object.assign(f.p, f.request.point); f.ui.show();
  f.inputs[0].value = '4'; f.inputs[0].oninput(); f.ui.update(); assert.equal(f.inputs[0].value, '4');
  for (const value of ['0', '-1', '1.5', '9', '']) { f.inputs[0].value = value; f.inputs[0].oninput(); assert.ok(f.buttons[0].disabled); }
  f.inputs[0].value = '4'; f.inputs[0].oninput(); const previousClick = f.buttons[0].onclick;
  f.p.x = 0; f.p.z = 0; previousClick(); assert.equal(f.sent.length, 0); assert.ok(f.buttons[0].disabled);
  Object.assign(f.p, f.request.point); f.ui.update(); f.request.remaining = 2; f.buttons[0].onclick(); assert.equal(f.sent.length, 0); assert.ok(f.buttons[0].disabled);
  const renders = f.renders; f.close(); f.request.remaining = 1; f.ui.update(); assert.equal(f.renders, renders, 'closing the board does not reopen it on updates');
});

test('request text is escaped and changing villages clears pending delivery drafts', () => {
  const f = fixture(); f.request.destinationName = '<img src=x onerror=alert(1)>'; f.request.reason = '<script>bad()</script>'; Object.assign(f.p, f.request.point); f.ui.show();
  assert.doesNotMatch(f.html, /<img|<script>/); assert.match(f.html, /&lt;script&gt;/);
  f.inputs[0].value = '2'; f.inputs[0].oninput(); f.ui.clear(); f.ui.show(); assert.equal(f.inputs[0].value, '8');
  f.state.requests.items = []; f.ui.update(); assert.match(f.html, /No funded deliveries/);
});
