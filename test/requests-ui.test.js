import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestsUI } from '../public/src/requests-ui.js';
import { NOTICEBOARD_POINT, canReadNoticeboard, noticeboardTakesPriority } from '../public/src/noticeboard.js';
import { BUILDINGS, PLOTS, canStand } from '../shared/world.js';
import { buildingEntrance, plotEntrance } from '../shared/access.js';

function fixture() {
  const point = { ...buildingEntrance(BUILDINGS.find(b => b.id === 'market')), id: 'market', name: 'Resource Exchange', kind: 'service' };
  const request = { id: 'request-1', destinationId: 'bank', resource: 'wheat', destinationName: 'Resource Exchange', point, remaining: 12, unitGold: 5, expiresDay: 2, status: 'open', reason: 'The village needs food.', reserved: 60 };
  const p = { id: 'alice', x: 0, z: 0, hp: 100, inventory: { wheat: 8, coal: 6 } }, state = { status: 'active', day: 1, plots: [], requests: { items: [request], reservedGold: 60 } };
  let panel = null, html = '', buttons = [], inputs = [], renders = 0, closes = 0;
  const sent = [], marks = [], dialog = { open: false, scrollTop: 0, classList: { add() {} } };
  const content = { contains: value => inputs.includes(value), querySelectorAll: selector => selector === '[data-request-button]' ? buttons : selector === '[data-request-input]' ? inputs : [] };
  const doc = { activeElement: null, getElementById: id => id === 'panel-content' ? content : id === 'panel-dialog' ? dialog : null };
  const ui = createRequestsUI({ getState: () => state, getMe: () => p, getActivePanel: () => panel, send: action => sent.push(action), markTarget: value => marks.push(value), document: doc,
    closePanel() { panel = null; dialog.open = false; closes++; }, openPanel(next, kind) {
      html = next; panel = kind; renders++; dialog.open = true;
      buttons = [...html.matchAll(/<button\b([^>]*)>(.*?)<\/button>/gs)].map(match => ({ dataset: { requestButton: match[1].match(/data-request-button="(\d+)"/)[1] }, text: match[2], disabled: /\sdisabled(?:\s|$)/.test(match[1]) }));
      inputs = [...html.matchAll(/<input\b([^>]*)>/g)].map(match => ({ tagName: 'INPUT', dataset: { requestInput: match[1].match(/data-request-input="(\d+)"/)[1] }, value: match[1].match(/value="([^"]*)"/)[1] }));
    } });
  return { ui, p, state, request, sent, marks, doc, dialog, get html() { return html; }, get buttons() { return buttons; }, get inputs() { return inputs; }, get renders() { return renders; }, get closes() { return closes; }, close() { panel = null; dialog.open = false; } };
}

test('request board has reachable frontage, rejects reading through the wall, and separates E from the nearby bank door', () => {
  assert.ok(canStand(NOTICEBOARD_POINT.x, NOTICEBOARD_POINT.z));
  assert.equal(canReadNoticeboard(NOTICEBOARD_POINT), true);
  for (const point of [{ x: -13.5, z: -26.25 }, { x: -8, z: -26.25 }, { x: NaN, z: -26.25 }, { x: -11.65, z: Infinity }]) assert.equal(canReadNoticeboard(point), false);
  for (const state of [{ downed: true }, { hp: 0 }, { bedPlotId: 'church' }, { mountedHorseId: 'horse' }, { carriedBy: 'friend' }, { online: false }]) assert.equal(canReadNoticeboard({ ...NOTICEBOARD_POINT, ...state }), false);
  const bank = BUILDINGS.find(b => b.id === 'bank'), candidate = { kind: 'bank', building: bank };
  assert.equal(noticeboardTakesPriority(NOTICEBOARD_POINT, candidate), true);
  assert.equal(noticeboardTakesPriority(buildingEntrance(bank), candidate), false);
  assert.equal(noticeboardTakesPriority({ x: -11.65, z: -24.8 }, candidate), true);
  assert.equal(noticeboardTakesPriority({ x: -11.65, z: -24.55 }, candidate), false);
  assert.equal(noticeboardTakesPriority(NOTICEBOARD_POINT, { kind: 'gather' }), false, 'selected gathering intent retains priority');
});

test('board requires walking up, only marks deliveries, and releases the modal before travel', () => {
  const f = fixture(); f.ui.show(); assert.equal(f.renders, 0); assert.deepEqual(f.marks.at(-1), NOTICEBOARD_POINT); assert.equal(f.dialog.open, false);
  Object.assign(f.p, NOTICEBOARD_POINT); f.ui.show(); assert.match(f.html, /60 gold reserved/); assert.match(f.html, /12 wheat/); assert.match(f.html, /Requested deliveries/);
  assert.match(f.html, /class="request-paper"/); assert.match(f.html, /class="request-wax-seal"/); assert.match(f.html, /data-item="wheat"/);
  assert.equal(f.inputs.length, 0); assert.equal(f.buttons[0].text, 'Mark delivery entrance');
  f.buttons[0].onclick(); assert.deepEqual(f.marks.at(-1), f.request.point); assert.equal(f.dialog.open, false); assert.equal(f.sent.length, 0);
  f.ui.show(); const renders = f.renders; f.p.x = 0; f.ui.update(); assert.equal(f.dialog.open, false); assert.equal(f.renders, renders, 'moving out of range closes instead of reopening a remote board');
  Object.assign(f.p, NOTICEBOARD_POINT); f.ui.show(); f.ui.findBoard(); assert.equal(f.dialog.open, false); assert.deepEqual(f.marks.at(-1), NOTICEBOARD_POINT);
});

test('destination views offer only that entrance’s deliveries and cannot be opened remotely', () => {
  const f = fixture(), watch = BUILDINGS.find(b => b.id === 'barracks'), site = PLOTS.find(p => p.id === 'outpost-1');
  const cannon = { id: site.id, ownerId: 'bob', building: 'cannon', hp: 500 };
  f.state.plots.push(cannon);
  const watchRequest = { ...f.request, id: 'request-2', destinationId: 'barracks', destinationName: 'The Watch', point: { ...buildingEntrance(watch), id: 'barracks' } };
  const cannonRequest = { ...f.request, id: 'request-3', destinationId: site.id, destinationName: site.name, resource: 'coal', ownerId: 'bob', building: 'cannon', point: { ...plotEntrance(site, cannon), id: site.id } };
  f.state.requests.items.push(watchRequest, cannonRequest);
  f.ui.showDestination('bank'); assert.equal(f.renders, 0); assert.equal(f.dialog.open, false); assert.equal(f.marks.at(-1).id, 'market');
  Object.assign(f.p, buildingEntrance(BUILDINGS.find(b => b.id === 'bank')));
  f.ui.showDestination('bank'); assert.equal(f.renders, 0); assert.equal(f.dialog.open, false);
  assert.equal(f.marks.at(-1).id, 'market', 'legacy bank ledger requests direct players to the new market counter');
  for (const request of [f.request, watchRequest, cannonRequest]) {
    Object.assign(f.p, request.point); f.ui.showDestination(request.destinationId);
    assert.match(f.html, /REQUESTED DELIVERIES/); assert.equal(f.inputs.length, 1); assert.equal(f.buttons.length, 1); assert.equal(f.buttons[0].disabled, false);
    f.inputs[0].value = '3'; f.inputs[0].oninput(); f.buttons[0].onclick();
    assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'request_deliver', requestId: request.id, amount: 3 });
    for (const other of [f.request, watchRequest, cannonRequest].filter(r => r !== request)) assert.doesNotMatch(f.html, new RegExp(`<strong>${other.resource[0].toUpperCase()+other.resource.slice(1)} → ${other.destinationName}</strong>`));
  }
  cannon.hp = 0; f.ui.update(); assert.equal(f.dialog.open, false); assert.equal(f.marks.at(-1).id, 'noticeboard');
});

test('delivery drafts and focused inputs survive snapshots while stale quotas and lost access prevent sends', () => {
  const f = fixture(); Object.assign(f.p, f.request.point); f.ui.showDestination('bank');
  f.inputs[0].value = '4'; f.inputs[0].oninput(); f.doc.activeElement = f.inputs[0]; const input = f.inputs[0], count = f.renders;
  f.p.inventory.wheat = 7; f.ui.update(); assert.equal(f.renders, count); assert.equal(f.inputs[0], input); assert.equal(input.value, '4');
  f.request.remaining = 2; f.ui.update(); assert.ok(f.buttons[0].disabled); assert.equal(f.inputs[0], input);
  f.doc.activeElement = null; f.request.remaining = 12; f.ui.update(); assert.equal(f.inputs[0].value, '4');
  for (const value of ['0', '-1', '1.5', '9', '']) { f.inputs[0].value = value; f.inputs[0].oninput(); assert.ok(f.buttons[0].disabled); }
  f.inputs[0].value = '4'; f.inputs[0].oninput(); const previousClick = f.buttons[0].onclick;
  f.p.x = 0; f.p.z = 0; previousClick(); assert.equal(f.sent.length, 0); assert.equal(f.dialog.open, false);
  Object.assign(f.p, f.request.point); f.ui.showDestination('bank'); assert.equal(f.inputs[0].value, '4');
  f.request.remaining = 2; f.buttons[0].onclick(); assert.equal(f.sent.length, 0); assert.ok(f.buttons[0].disabled);
  const renders = f.renders; f.close(); f.request.remaining = 1; f.ui.update(); assert.equal(f.renders, renders, 'closed request panels stay closed');
});

test('request text is escaped and changing villages clears pending delivery drafts', () => {
  const f = fixture(); f.request.destinationName = '<img src=x onerror=alert(1)>'; f.request.reason = '<script>bad()</script>'; Object.assign(f.p, f.request.point); f.ui.showDestination('bank');
  assert.doesNotMatch(f.html, /<img|<script>/); assert.match(f.html, /&lt;script&gt;/);
  f.inputs[0].value = '2'; f.inputs[0].oninput(); f.ui.clear(); f.ui.showDestination('bank'); assert.equal(f.inputs[0].value, '8');
  f.state.requests.items = []; f.ui.update(); assert.match(f.html, /No funded deliveries are open for this destination/);
});
