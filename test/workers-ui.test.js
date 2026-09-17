import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettlementUI } from '../public/src/settlement-ui.js';
import { WORKER_RULES } from '../shared/workers.js';
import { BUILDINGS, PLOTS } from '../shared/world.js';

import { buildingEntrance } from '../shared/access.js';
const treasuryEntrance = buildingEntrance(BUILDINGS.find(b => b.id === 'bank'));

// Exercise actual control handlers without a WebGL scene. The small DOM adapter
// preserves selected values and focus so incoming worker snapshots are covered.
function fixture(t) {
  const previous = globalThis.document;
  let html = '', buttons = [], activePanel = null, opens = 0;
  const fields = new Map(), sent = [];
  const player = { id: 'alice', name: 'Alice', role: 'guard', x: -10, z: -23, wallet: 200, bank: 50, hp: 100, maxHp: 100, hunger: 70, inventory: {}, durability: {}, tiers: {} };
  const worker = { id: 'hired-one', ownerId: 'alice', name: 'Alice’s worker', x: -10, z: -23, resource: 'timber', sourcePlotId: null, mode: 'sell', destinationPlotId: null, status: 'Waiting for orders', paused: true, cargo: {} };
  Object.assign(player, treasuryEntrance);
  const state = { workers: [worker], players: [player], plots: [], guards: [], stock: {}, treasury: 20000, policies: {}, loan: { credit: 500 } };
  const content = { contains: element => [...fields.values()].includes(element), querySelectorAll: selector => selector === '[data-settlement-button]' ? buttons : [] };
  const dialog = { open: true, scrollTop: 0, classList: { add() {} } };
  globalThis.document = { activeElement: null, getElementById: id => id === 'panel-content' ? content : id === 'panel-dialog' ? dialog : fields.get(id) || null };
  t.after(() => { globalThis.document = previous; });
  const ui = createSettlementUI({ getState: () => state, getMe: () => player, getActivePanel: () => activePanel, getHotbar: () => [], setHotbar() {}, toast() {}, send: payload => sent.push(payload), openPanel(next, kind) {
    html = next; activePanel = kind; opens++; fields.clear();
    buttons = [...html.matchAll(/<button\b([^>]*)>(.*?)<\/button>/gs)].map(([, attributes, text]) => ({ text, dataset: { settlementButton: attributes.match(/data-settlement-button="(\d+)"/)[1] }, disabled: /\sdisabled(?:\s|$)/.test(attributes) }));
    for (const [, id, options] of html.matchAll(/<select\b[^>]*id="([^"]+)"[^>]*>(.*?)<\/select>/gs)) {
      const selected = [...options.matchAll(/<option value="([^"]*)"([^>]*)>/g)].find(([, , attributes]) => /\bselected\b/.test(attributes));
      fields.set(id, { tagName: 'SELECT', value: selected?.[1] ?? options.match(/value="([^"]*)"/)?.[1] ?? '' });
    }
    for (const [, id, attributes] of html.matchAll(/<input\b[^>]*id="([^"]+)"([^>]*)>/g)) fields.set(id, { tagName: 'INPUT', value: attributes.match(/value="([^"]*)"/)?.[1] || '' });
  } });
  return { ui, player, worker, state, fields, sent, get html() { return html; }, get opens() { return opens; }, get buttons() { return buttons; }, button(text) { const found = buttons.find(b => b.text === text); assert.ok(found, `Missing button: ${text}`); return found; }, click(text) { const control = this.button(text); assert.equal(control.disabled, false, `Disabled button: ${text}`); control.onclick(); }, select(id, selected) { const control = fields.get(id); assert.ok(control, `Missing select: ${id}`); control.value = selected; control.onchange(); } };
}

test('worker management shows the active Manager cap, wage rate and trained cargo allowance', t => {
  const f = fixture(t); f.player.role = 'manager'; f.player.skills = { manager_staffing: 2, manager_logistics: 2 };
  f.ui.show('workers'); assert.match(f.html, /1 \/ 10 personal workers/); assert.match(f.html, /1 gold \/ 60 working seconds/);
  assert.match(f.html, /0 \/ 60 weight/);
  f.player.role = 'villager'; f.ui.refresh(); assert.match(f.html, /1 \/ 5 personal workers/); assert.match(f.html, /1 gold \/ 30 working seconds/);
});

test('actual worker equipment controls send supplied-tool choices and refresh after durability changes', t => {
  const f = fixture(t); Object.assign(f.worker, { x: f.player.x, z: f.player.z });
  f.player.tiers.pickaxe = 'iron'; f.player.durability.pickaxe = 91;
  f.ui.show('workers'); f.click('Supply your iron pickaxe');
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'worker_equip', workerId: f.worker.id, tool: 'pickaxe', tier: 'iron' });
  f.worker.equipment = { pickaxe: { tier: 'iron', durability: 91, maxDurability: 200 } }; f.player.durability.pickaxe = 0; f.ui.refresh();
  assert.match(f.html, /91 \/ 200 durability/); f.click('Recover tool');
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'worker_unequip', workerId: f.worker.id, tool: 'pickaxe' });
  f.worker.equipment.pickaxe.durability = 0; f.ui.refresh(); assert.match(f.html, /using wooden fallback/);
  f.click('Repair · 20g + materials'); assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'worker_repair', workerId: f.worker.id, tool: 'pickaxe' });
});

test('automatic worker maintenance controls submit an owned supply plot and bounded budget', t => {
  const f = fixture(t), plotId = PLOTS[0].id;
  f.state.plots = [{ id: plotId, ownerId: 'alice', building: 'house', hp: 300 }]; f.ui.show('workers'); f.click('Enable 100g budget');
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'worker_maintenance', workerId: f.worker.id, enabled: true, budgetGold: 100, plotId });
  f.worker.maintenanceEnabled = true; f.worker.maintenanceBudgetGold = 80; f.worker.maintenancePlotId = plotId; f.ui.refresh();
  assert.match(f.html, /80 gold remaining/); f.click('Disable automatic repairs');
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'worker_maintenance', workerId: f.worker.id, enabled: false });
});

test('worker management is discoverable from the pack and treasury and shows only the owner’s crew', t => {
  const f = fixture(t);
  f.state.workers.push({ ...f.worker, id: 'other-worker', ownerId: 'bob', name: 'Hidden Bob worker', cargo: { iron: 10 } });
  f.ui.show('inventory'); f.click('Manage workers');
  assert.match(f.html, new RegExp(`1 / ${WORKER_RULES.maxPerPlayer}`)); assert.match(f.html, /1 gold \/ 30 working seconds/);
  assert.match(f.html, /Hiring and wages use your wallet/); assert.doesNotMatch(f.html, /Hidden Bob worker/);
  assert.match(f.html, /while anyone is online in this village, including after you leave/);
  assert.match(f.html, /finish any prepaid work time/); assert.match(f.html, /An empty village pauses all work and wages/);
  f.click(`Hire a worker · ${WORKER_RULES.hireCost}g`);
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'worker_hire' });
  f.ui.show('bank'); f.click('Hire &amp; manage workers'); assert.match(f.html, /HIRED HANDS/);
});

test('worker orders submit the chosen resource, owned source, and destination or treasury sale', t => {
  const f = fixture(t), mineId = PLOTS[0].id, storeId = PLOTS[1].id, foreignId = PLOTS[2].id;
  f.state.plots = [{ id: mineId, ownerId: 'alice', building: 'mine', hp: 300 }, { id: storeId, ownerId: 'alice', building: 'house', hp: 300 }, { id: foreignId, ownerId: 'bob', building: 'mine', hp: 300 }];
  f.ui.show('workers');
  f.select('worker-0-resource', 'iron'); f.select('worker-0-sourcePlotId', mineId);
  assert.doesNotMatch(f.html, new RegExp(`value="${foreignId}"`));
  f.select('worker-0-mode', 'store'); assert.equal(f.button('Apply orders').disabled, true);
  f.select('worker-0-destinationPlotId', storeId); f.click('Apply orders');
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'worker_assign', workerId: f.worker.id, resource: 'iron', sourcePlotId: mineId, mode: 'store', destinationPlotId: storeId });
  f.select('worker-0-sourcePlotId', ''); f.select('worker-0-mode', 'sell'); f.click('Apply orders');
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'worker_assign', workerId: f.worker.id, resource: 'iron', sourcePlotId: null, mode: 'sell', destinationPlotId: null });
});

test('worker drafts survive status snapshots and incoming movement does not replace the form', t => {
  const f = fixture(t); f.ui.show('workers'); f.ui.refresh();
  const opens = f.opens; f.worker.x += .1; f.worker.z += .1; f.ui.refresh(); assert.equal(f.opens, opens);
  f.select('worker-0-resource', 'coal');
  const resource = f.fields.get('worker-0-resource'); document.activeElement = resource;
  f.worker.status = 'Returning to treasury'; f.player.wallet--; f.ui.refresh();
  assert.equal(document.activeElement, resource); assert.equal(resource.value, 'coal');
  document.activeElement = null; f.ui.refresh(); assert.equal(f.fields.get('worker-0-resource').value, 'coal');
  assert.match(f.html, /Returning to treasury/); assert.match(f.html, /Order changes have not been applied/);
  f.click('Apply orders'); assert.equal(f.sent.at(-1).resource, 'coal');
  f.worker.resource = 'coal'; f.ui.refresh(); assert.doesNotMatch(f.html, /Order changes have not been applied/);
});

test('missing or incompatible buildings retain the selected order and require an explicit replacement', t => {
  const f = fixture(t), id = PLOTS[0].id;
  f.worker.resource = 'stone'; f.worker.sourcePlotId = id; f.worker.mode = 'store'; f.worker.destinationPlotId = id;
  f.state.plots = [{ id, ownerId: 'alice', building: 'mine', hp: 300 }]; f.ui.show('workers');
  f.select('worker-0-resource', 'wheat');
  assert.equal(f.fields.get('worker-0-sourcePlotId').value, id); assert.equal(f.button('Apply orders').disabled, true);
  assert.match(f.html, /Unavailable ·/);
  f.select('worker-0-sourcePlotId', ''); assert.equal(f.button('Apply orders').disabled, false);
  f.state.plots[0].hp = 0; f.ui.refresh();
  assert.equal(f.fields.get('worker-0-destinationPlotId').value, id); assert.equal(f.button('Apply orders').disabled, true);
  assert.equal(f.sent.length, 0);
});

test('worker controls enforce wallet hiring, crew limits, proximity, partial collection and reviewed dismissal', t => {
  const f = fixture(t); f.ui.show('workers');
  f.player.wallet = WORKER_RULES.hireCost - 1; f.ui.refresh(); assert.equal(f.button(`Hire a worker · ${WORKER_RULES.hireCost}g`).disabled, true);
  f.player.wallet = 200; for (let i = 1; i < WORKER_RULES.maxPerPlayer; i++) f.state.workers.push({ ...f.worker, id: `worker-${i}` }); f.ui.refresh(); assert.equal(f.button('Worker limit reached').disabled, true);
  f.state.workers.splice(1); f.player.x = 10; f.ui.refresh(); assert.equal(f.button(`Hire a worker · ${WORKER_RULES.hireCost}g`).disabled, true);
  f.click('Mark the treasury'); assert.equal(f.ui.getWaypoint().id, 'bank');
  f.click('Find worker'); assert.deepEqual(f.ui.getWaypoint(), { kind: 'worker', id: f.worker.id, name: f.worker.name, x: f.worker.x, z: f.worker.z });
  Object.assign(f.player, treasuryEntrance); f.worker.paused = false; f.worker.cargo = { stone: 10 }; f.player.inventory = { wheat: 97 }; f.ui.refresh();
  f.click('Collect carried supplies'); assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'worker_collect', workerId: f.worker.id });
  assert.equal(f.button('Dismiss worker').disabled, true);
  f.player.inventory.wheat = 100; f.ui.refresh(); assert.equal(f.button('Collect carried supplies').disabled, true);
  f.worker.cargo = {}; f.worker.x = 20; f.ui.refresh(); assert.equal(f.button('Dismiss worker').disabled, true);
  f.click('Pause &amp; return to treasury'); assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'worker_pause', workerId: f.worker.id, paused: true });
  f.worker.x = -10; f.worker.paused = true; f.ui.refresh(); f.click('Dismiss worker');
  assert.match(f.html, /no hiring refund/); assert.notEqual(f.sent.at(-1).kind, 'worker_dismiss');
  f.click('Confirm change'); assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'worker_dismiss', workerId: f.worker.id });
});

test('worker names and statuses are escaped and clearing the UI drops an old village’s drafts', t => {
  const f = fixture(t); f.worker.name = '<img src=x onerror=alert(1)>'; f.worker.status = '<script>bad</script>';
  f.ui.show('workers'); assert.doesNotMatch(f.html, /<img src=x|<script>/); assert.match(f.html, /&lt;img src=x/);
  f.select('worker-0-resource', 'iron'); f.ui.clear(); f.ui.show('workers');
  assert.equal(f.fields.get('worker-0-resource').value, 'timber');
});

test('worker training and colors show current progress and submit explicit owner actions', t => {
  const f = fixture(t);
  Object.assign(f.worker, { level: 1, workXp: 24, upgradePoints: 0, attributes: { gathering: 0, speed: 0, carry: 0 }, color: '#71865b' });
  f.ui.show('workers');
  assert.match(f.html, /work day and night/); assert.match(f.html, /24 \/ 25 harvests/);
  assert.equal(f.button('+1 rank · 1 point').disabled, true);
  f.worker.workXp = 25; f.worker.level = 2; f.worker.upgradePoints = 1; f.ui.refresh();
  f.click('+1 rank · 1 point');
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'worker_upgrade', workerId: f.worker.id, attribute: 'gathering' });
  f.worker.attributes.gathering = 1; f.worker.upgradePoints = 0; f.ui.refresh();
  assert.match(f.html, /3.6 seconds \/ harvest/); assert.equal(f.button('+1 rank · 1 point').disabled, true);
  f.click('Ocean');
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'worker_color', workerId: f.worker.id, color: '#4c86a4' });
  f.worker.color = '#4c86a4'; f.ui.refresh(); assert.equal(f.button('✓ Ocean').disabled, true);
});

test('worker hiring requires the player entrance while returning workers can wait in the forecourt', t => {
  const f = fixture(t), bank = BUILDINGS.find(b => b.id === 'bank');
  f.ui.show('workers');
  f.player.x = bank.x - bank.w / 2 - 1;
  f.click(`Hire a worker · ${WORKER_RULES.hireCost}g`);
  assert.equal(f.sent.length, 0);
  assert.equal(f.button(`Hire a worker · ${WORKER_RULES.hireCost}g`).disabled, true);
  f.click('Apply orders'); assert.equal(f.sent.at(-1).kind, 'worker_assign');
  Object.assign(f.player, treasuryEntrance);
  Object.assign(f.worker, { x: bank.x, z: bank.z - bank.d / 2 - 1 });
  f.ui.refresh(); f.click('Dismiss worker');
  f.click('Confirm change'); assert.equal(f.sent.at(-1).kind, 'worker_dismiss');
  f.ui.show('workers'); f.click('Dismiss worker');
  f.player.x = bank.x - bank.w / 2 - 1; f.click('Confirm change');
  assert.equal(f.sent.length, 2); assert.match(f.html, /BUILDING ENTRANCE/);
});

test('illustrated worker training compares numeric next-rank effects while retaining five crew places', t => {
  const f = fixture(t); f.worker.attributes = { gathering: 2, speed: 1, carry: 0 }; f.worker.upgradePoints = 1; f.worker.level = 4;
  f.ui.show('workers');
  assert.match(f.html, /data-worker-portrait=/); assert.match(f.html, /1 \/ 5 personal workers/);
  assert.match(f.html, /3.2 seconds \/ harvest/); assert.match(f.html, /2.8 seconds \/ harvest/);
  assert.match(f.html, /3.3 movement speed/); assert.match(f.html, /3.6 movement speed/);
  assert.match(f.html, /40 cargo capacity/); assert.match(f.html, /50 cargo capacity/);
  assert.match(f.html, /Rank 2 \/ 5/); f.click('+1 rank · 1 point');
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'worker_upgrade', workerId: f.worker.id, attribute: 'gathering' });
});

test('plot staff are counted separately and never use a personal hiring place', t => {
  const f = fixture(t), id = PLOTS[0].id;
  for (let i = 1; i < 4; i++) f.state.workers.push({ ...f.worker, id: `personal-${i}` });
  f.state.plots = [{ id, ownerId: 'alice', building: 'mine', hp: 300, level: 2 }];
  for (let i = 0; i < 2; i++) f.state.workers.push({ ...f.worker, id: `plot-${i}`, staffPlotId: id, staffRole: 'gatherer', resource: 'stone', sourcePlotId: id, destinationPlotId: id, mode: 'store' });
  f.ui.show('workers'); assert.match(f.html, /4 \/ 5 personal workers · 2 plot staff/);
  assert.match(f.html, /arrive paused with no hiring fee/); assert.equal(f.button(`Hire a worker · ${WORKER_RULES.hireCost}g`).disabled, false);
  assert.equal(f.buttons.filter(button => button.text === 'Dismiss worker').length, 4, 'active staff cannot be dismissed and regenerated');
});

test('transporter form submits an owned storage source and percentage with its fixed destination', t => {
  const f = fixture(t), destination = PLOTS[0].id, source = PLOTS[1].id, foreign = PLOTS[2].id;
  Object.assign(f.worker, { staffPlotId: destination, staffRole: 'transporter', resource: null, sourcePlotId: null, mode: 'store', destinationPlotId: destination, targetPercent: 50 });
  f.state.plots = [{ id: destination, ownerId: 'alice', building: 'tinker_shop', hp: 300 }, { id: source, ownerId: 'alice', building: 'house', hp: 300 }, { id: foreign, ownerId: 'bob', building: 'mine', hp: 300 }];
  f.ui.show('workers'); assert.equal(f.button('Apply orders').disabled, true); assert.equal(f.button('Resume work').disabled, true);
  assert.match(f.html, /Fetch from owned storage/); assert.doesNotMatch(f.html, new RegExp(`value="${foreign}"`));
  assert.equal(f.fields.has('worker-0-mode'), false); assert.equal(f.fields.has('worker-0-destinationPlotId'), false);
  f.select('worker-0-resource', 'arrows'); f.select('worker-0-sourcePlotId', source); f.select('worker-0-targetPercent', '35');
  f.worker.status = 'Waiting'; f.ui.refresh(); assert.equal(f.fields.get('worker-0-targetPercent').value, '35');
  f.click('Apply orders'); assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'worker_assign', workerId: f.worker.id, sourcePlotId: source, destinationPlotId: destination, mode: 'store', resource: 'arrows', targetPercent: 35 });
  for (const invalid of ['0', '101', '1.5']) { f.select('worker-0-targetPercent', invalid); assert.equal(f.button('Apply orders').disabled, true); }
});

test('inactive plot staff show retained cargo, disable work and allow nearby collection', t => {
  const f = fixture(t), id = PLOTS[0].id;
  Object.assign(f.worker, { staffPlotId: id, staffRole: 'gatherer', staffRetired: true, resource: 'stone', sourcePlotId: id, mode: 'store', destinationPlotId: id, cargo: { stone: 3 } });
  Object.assign(f.player, { x: f.worker.x, z: f.worker.z });
  f.state.plots = [{ id, ownerId: 'alice', building: null, hp: 0 }]; f.ui.show('workers');
  assert.match(f.html, /Inactive plot staff/); assert.match(f.html, /Cargo stays safe/); assert.match(f.html, /0 plot staff/);
  assert.equal(f.button('Apply orders').disabled, true); assert.equal(f.button('Resume work').disabled, true);
  f.click('Collect carried supplies'); assert.equal(f.sent.at(-1).kind, 'worker_collect');
});
