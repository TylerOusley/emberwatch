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
  const fields = new Map(), sent = [], timers = new Map(); let nextTimer = 0;
  const player = { id: 'alice', name: 'Alice', role: 'guard', x: -10, z: -23, wallet: 200, bank: 50, hp: 100, maxHp: 100, hunger: 70, inventory: {}, durability: {}, tiers: {} };
  const worker = { id: 'hired-one', ownerId: 'alice', name: 'Alice’s worker', x: -10, z: -23, resource: 'timber', sourcePlotId: null, mode: 'sell', destinationPlotId: null, status: 'Waiting for orders', paused: true, cargo: {} };
  Object.assign(player, treasuryEntrance);
  const state = { workers: [worker], players: [player], plots: [], guards: [], stock: {}, treasury: 20000, policies: {}, loan: { credit: 500 } };
  const content = { contains: element => [...fields.values(), ...buttons].includes(element), querySelectorAll: selector => selector === '[data-settlement-button]' ? buttons : [], querySelector: selector => { const id = selector.match(/^#(.+)$/)?.[1]; return id ? fields.get(id) : null; } };
  const dialog = { open: true, scrollTop: 0, classList: { add() {} } };
  globalThis.document = { activeElement: null, getElementById: id => id === 'panel-content' ? content : id === 'panel-dialog' ? dialog : fields.get(id) || null };
  t.after(() => { globalThis.document = previous; });
  const ui = createSettlementUI({ schedule: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; }, cancel: id => timers.delete(id), getState: () => state, getMe: () => player, getActivePanel: () => activePanel, getHotbar: () => [], setHotbar() {}, toast() {}, send: payload => sent.push(payload), openPanel(next, kind) {
    html = next; activePanel = kind; opens++; fields.clear();
    buttons = [...html.matchAll(/<button\b([^>]*)>(.*?)<\/button>/gs)].map(([, attributes, text]) => ({ text, tagName: 'BUTTON', dataset: { settlementButton: attributes.match(/data-settlement-button="(\d+)"/)[1], workerId: attributes.match(/data-worker-id="([^"]+)"/)?.[1] }, ariaPressed: attributes.match(/aria-pressed="([^"]+)"/)?.[1], disabled: /\sdisabled(?:\s|$)/.test(attributes) }));
    for (const [, id, options] of html.matchAll(/<select\b[^>]*id="([^"]+)"[^>]*>(.*?)<\/select>/gs)) {
      const selected = [...options.matchAll(/<option value="([^"]*)"([^>]*)>/g)].find(([, , attributes]) => /\bselected\b/.test(attributes));
      fields.set(id, { tagName: 'SELECT', value: selected?.[1] ?? options.match(/value="([^"]*)"/)?.[1] ?? '' });
    }
    for (const [, id, attributes] of html.matchAll(/<input\b[^>]*id="([^"]+)"([^>]*)>/g)) fields.set(id, { tagName: 'INPUT', value: attributes.match(/value="([^"]*)"/)?.[1] || '', focus() { document.activeElement = this; }, setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; } });
  } });
  return { ui, player, worker, state, fields, sent, timers, flushTimers() { for (const [id, timer] of [...timers]) { timers.delete(id); timer.fn(); } }, roster(id) { const found = buttons.find(button => button.dataset.workerId === id); assert.ok(found, `Missing worker: ${id}`); return found; }, choose(id) { this.roster(id).onclick(); }, search(value) { const input = fields.get('worker-roster-search'); assert.ok(input, 'Missing worker search'); input.value = value; input.oninput(); }, get html() { return html; }, get opens() { return opens; }, get buttons() { return buttons; }, button(text) { const found = buttons.find(b => b.text === text); assert.ok(found, `Missing button: ${text}`); return found; }, click(text) { const control = this.button(text); assert.equal(control.disabled, false, `Disabled button: ${text}`); control.onclick(); }, select(id, selected) { const control = fields.get(id); assert.ok(control, `Missing select: ${id}`); control.value = selected; control.onchange(); } };
}

test('worker management shows the active Manager cap, wage rate and trained cargo allowance', t => {
  const f = fixture(t); f.player.role = 'manager'; f.player.skills = { manager_staffing: 2, manager_logistics: 2 };
  f.ui.show('workers'); assert.match(f.html, /1 \/ 10 personal workers/); assert.match(f.html, /1 gold \/ 60 working seconds/);
  assert.match(f.html, /0 \/ 60 weight/);
  f.player.role = 'villager'; f.ui.refresh(); assert.match(f.html, /1 \/ 5 personal workers/); assert.match(f.html, /1 gold \/ 30 working seconds/);
});

test('worker tool purchases work remotely without player equipment and submit explicit tool and tier choices', t => {
  const f = fixture(t);
  Object.assign(f.worker, { x: 60, z: 60 });
  f.player.inventory = {}; f.player.tiers = {}; f.player.durability = {};
  f.ui.show('workers'); f.click('Tools');
  for (const tool of ['axe', 'pickaxe', 'scythe']) {
    for (const [tier, cost] of [['stone', 30], ['iron', 100]]) {
      f.click(`Buy ${tier} ${tool} · ${cost}g`);
      assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'worker_buy_tool', workerId: f.worker.id, tool, tier });
    }
  }
  assert.match(f.html, /wallet/i);
  assert.match(f.html, /without a refund/i);
  assert.doesNotMatch(f.html, /Supply your|Carry a crafted|Repair ·|repair materials|gold remaining|g budget/i);
});

test('purchase controls refresh for wallet, equipped tier and broken-tool snapshots', t => {
  const f = fixture(t);
  f.player.wallet = 29; f.player.bank = 1000;
  f.ui.show('workers'); f.click('Tools'); f.ui.refresh();
  assert.equal(f.button('Buy stone axe · 30g').disabled, true);
  assert.equal(f.button('Buy iron axe · 100g').disabled, true);
  f.player.wallet = 30; f.ui.refresh();
  assert.equal(f.button('Buy stone axe · 30g').disabled, false);
  assert.equal(f.button('Buy iron axe · 100g').disabled, true);
  f.player.wallet = 100; f.ui.refresh();
  assert.equal(f.button('Buy iron axe · 100g').disabled, false);
  f.worker.equipment = { axe: { tier: 'stone', durability: 60, maxDurability: 100, workerOnly: true } };
  f.ui.refresh();
  assert.match(f.html, /60 \/ 100 durability/);
  const equipped = f.buttons.find(button => /stone axe equipped/i.test(button.text));
  assert.ok(equipped, 'the equipped tier is clearly marked'); assert.equal(equipped.disabled, true);
  assert.equal(f.button('Buy iron axe · 100g').disabled, false);
  f.worker.equipment.axe.durability = 0; f.ui.refresh();
  assert.match(f.html, /using wooden fallback/);
  assert.equal(f.button('Buy stone axe · 30g').disabled, false, 'a broken matching tier can be replaced');
});

test('automatic replacement uses bank savings and can be enabled before enough funds are available', t => {
  const f = fixture(t);
  Object.assign(f.worker, { x: 60, z: 60, equipment: { axe: { tier: 'iron', durability: 0, maxDurability: 200, workerOnly: true } } });
  f.player.wallet = 0; f.player.bank = 12;
  f.ui.show('workers'); f.click('Tools'); f.ui.refresh();
  assert.match(f.html, /Auto-replacement/);
  assert.match(f.html, /Bank|bank/); assert.match(f.html, /12/);
  f.click('Enable auto-replacement');
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'worker_auto_replace', workerId: f.worker.id, enabled: true });
  f.worker.autoReplaceEnabled = true; f.ui.refresh();
  assert.match(f.html, /waiting|not enough|insufficient/i);
  assert.equal(f.button('Disable auto-replacement').disabled, false);
  const opens = f.opens;
  f.player.bank = 1234; f.ui.refresh();
  assert.equal(f.opens, opens + 1, 'bank-only updates refresh the current tools view');
  assert.match(f.html, /1,234|1234/);
  f.click('Disable auto-replacement');
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'worker_auto_replace', workerId: f.worker.id, enabled: false });
  f.worker.autoReplaceEnabled = false; f.ui.refresh();
  assert.equal(f.button('Enable auto-replacement').disabled, false, 'a toggle-only snapshot refreshes the control');
  assert.equal(f.state.plots.length, 0, 'automatic replacement does not require a supply building');
});

test('inactive workers cannot buy or enable replacement but can always switch it off', t => {
  const f = fixture(t); f.ui.show('workers'); f.click('Tools');
  for (const flag of ['staffRetired', 'roleLimitPaused']) {
    f.worker[flag] = true; f.worker.autoReplaceEnabled = false; f.ui.refresh();
    assert.equal(f.button('Buy stone axe · 30g').disabled, true);
    assert.equal(f.button('Buy iron pickaxe · 100g').disabled, true);
    assert.equal(f.button('Enable auto-replacement').disabled, true);
    f.worker.autoReplaceEnabled = true; f.ui.refresh(); f.click('Disable auto-replacement');
    assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'worker_auto_replace', workerId: f.worker.id, enabled: false });
    f.worker[flag] = false;
  }
  Object.assign(f.worker, { staffRole: 'transporter', x: f.player.x, z: f.player.z, equipment: { pickaxe: { tier: 'iron', durability: 91, maxDurability: 200 }, axe: { tier: 'stone', durability: 60, maxDurability: 100, workerOnly: true } } });
  f.player.durability = {}; f.ui.refresh();
  assert.match(f.html, /Transporters move stored goods/);
  assert.match(f.html, /91 \/ 200 durability/);
  assert.doesNotMatch(f.html, /60 \/ 100 durability/, 'purchased gathering gear stays hidden for transporters');
  assert.equal(f.buttons.filter(button => button.text === 'Recover tool').length, 1);
  f.click('Recover tool');
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'worker_unequip', workerId: f.worker.id, tool: 'pickaxe' });
  assert.equal(f.buttons.some(button => /^Buy (?:stone|iron) /.test(button.text)), false);
  f.click('Disable auto-replacement');
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'worker_auto_replace', workerId: f.worker.id, enabled: false });
  f.worker.autoReplaceEnabled = false; f.ui.refresh();
  assert.equal(f.buttons.some(button => button.text === 'Enable auto-replacement'), false, 'transporters cannot enable automatic tool purchases');
});

test('purchased worker tools cannot be recovered but older player-supplied gear retains recovery', t => {
  const f = fixture(t);
  Object.assign(f.worker, { x: f.player.x, z: f.player.z, equipment: { pickaxe: { tier: 'iron', durability: 91, maxDurability: 200, workerOnly: true } } });
  f.ui.show('workers'); f.click('Tools');
  assert.equal(f.buttons.some(button => button.text === 'Recover tool'), false);
  delete f.worker.equipment.pickaxe.workerOnly; f.ui.refresh();
  f.click('Recover tool');
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'worker_unequip', workerId: f.worker.id, tool: 'pickaxe' });
  f.worker.x += 30; f.ui.refresh(); assert.equal(f.button('Recover tool').disabled, true);
  f.worker.x = f.player.x; f.player.durability.pickaxe = 15; f.ui.refresh();
  assert.equal(f.button('Recover tool').disabled, true, 'recovery still requires an empty matching player slot');
});

test('dismissal reviews purchased-tool loss while protecting previously supplied gear', t => {
  const f = fixture(t);
  f.worker.equipment = { axe: { tier: 'stone', durability: 60, maxDurability: 100, workerOnly: true } };
  f.ui.show('workers'); f.click('Dismiss worker');
  assert.match(f.html, /Purchased worker tools are discarded without a refund/);
  assert.equal(f.sent.length, 0, 'opening the review does not dismiss the worker');
  f.click('Confirm change');
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'worker_dismiss', workerId: f.worker.id });
  delete f.worker.equipment.axe.workerOnly; f.ui.show('workers');
  assert.equal(f.button('Dismiss worker').disabled, true, 'older player-owned gear must be recovered before dismissal');
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

test('worker controls enforce hiring and proximity while allowing full-cargo collection into an encumbered pack', t => {
  const f = fixture(t); f.ui.show('workers');
  f.player.wallet = WORKER_RULES.hireCost - 1; f.ui.refresh(); assert.equal(f.button(`Hire a worker · ${WORKER_RULES.hireCost}g`).disabled, true);
  f.player.wallet = 200; for (let i = 1; i < WORKER_RULES.maxPerPlayer; i++) f.state.workers.push({ ...f.worker, id: `worker-${i}` }); f.ui.refresh(); assert.equal(f.button('Worker limit reached').disabled, true);
  f.state.workers.splice(1); f.player.x = 10; f.ui.refresh(); assert.equal(f.button(`Hire a worker · ${WORKER_RULES.hireCost}g`).disabled, true);
  f.click('Mark the treasury'); assert.equal(f.ui.getWaypoint().id, 'bank');
  f.click('Find worker'); assert.deepEqual(f.ui.getWaypoint(), { kind: 'worker', id: f.worker.id, name: f.worker.name, x: f.worker.x, z: f.worker.z });
  Object.assign(f.player, treasuryEntrance); f.worker.paused = false; f.worker.cargo = { stone: 10 }; f.player.inventory = { wheat: 97 }; f.ui.refresh();
  f.click('Collect carried supplies'); assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'worker_collect', workerId: f.worker.id });
  assert.equal(f.button('Dismiss worker').disabled, true);
  f.player.inventory.wheat = 100; f.ui.refresh(); assert.equal(f.button('Collect carried supplies').disabled, false);
  f.click('Collect carried supplies'); assert.equal(f.sent.at(-1).kind, 'worker_collect');
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
  f.ui.show('workers'); f.click('Training');
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
  f.ui.show('workers'); f.click('Training');
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
  assert.equal(f.buttons.filter(button => button.text === 'Dismiss worker').length, 1, 'only the selected personal worker has dismissal controls');
  f.choose('plot-0'); assert.equal(f.buttons.filter(button => button.text === 'Dismiss worker').length, 0, 'active staff cannot be dismissed and regenerated');
});

test('transporter form keeps sources owned and allows a chosen delivery destination with percentage', t => {
  const f = fixture(t), destination = PLOTS[0].id, source = PLOTS[1].id, foreign = PLOTS[2].id;
  Object.assign(f.worker, { staffPlotId: destination, staffRole: 'transporter', resource: null, sourcePlotId: null, mode: 'store', destinationPlotId: destination, targetPercent: 50 });
  f.state.plots = [{ id: destination, ownerId: 'alice', building: 'tinker_shop', hp: 300 }, { id: source, ownerId: 'alice', building: 'house', hp: 300 }, { id: foreign, ownerId: 'bob', building: 'mine', hp: 300 }];
  f.ui.show('workers'); assert.equal(f.button('Apply orders').disabled, true); assert.equal(f.button('Resume work').disabled, true);
  assert.match(f.html, /Fetch from owned storage/); assert.doesNotMatch(f.html.match(/id="worker-0-sourcePlotId"[^>]*>(.*?)<\/select>/s)[1], new RegExp(`value="${foreign}"`));
  assert.match(f.html.match(/id="worker-0-destinationPlotId"[^>]*>(.*?)<\/select>/s)[1], new RegExp(`value="${foreign}"`));
  assert.equal(f.fields.has('worker-0-mode'), false); assert.equal(f.fields.has('worker-0-destinationPlotId'), true);
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

test('a large crew has one order editor and keeps tools and training behind selected-worker tabs', t => {
  const f = fixture(t);
  for (let i = 1; i < 28; i++) f.state.workers.push({ ...f.worker, id: `crew-${i}`, name: `Worker ${i + 1}`, cargo: {} });
  f.ui.show('workers');
  assert.equal(f.buttons.filter(button => button.dataset.workerId).length, 28);
  assert.equal([...f.fields.keys()].filter(id => /^worker-\d+-resource$/.test(id)).length, 1);
  assert.equal(f.buttons.filter(button => button.text === 'Apply orders').length, 1);
  assert.equal(f.buttons.some(button => /Buy (?:stone|iron)|\+1 rank|Enable auto-replacement/.test(button.text)), false);
  assert.equal(f.roster(f.worker.id).ariaPressed, 'true');
  f.choose('crew-18'); assert.equal(f.roster('crew-18').ariaPressed, 'true');
  assert.equal(f.roster(f.worker.id).ariaPressed, 'false'); assert.ok(f.fields.has('worker-18-resource'));
  f.click('Training'); assert.equal(f.fields.has('worker-18-resource'), false);
  assert.equal(f.buttons.filter(button => button.text === '+1 rank · 1 point').length, 3);
  f.choose('crew-19'); assert.ok(f.fields.has('worker-19-resource'), 'selecting a different worker returns to Orders');
  assert.equal(f.buttons.some(button => button.text === '+1 rank · 1 point'), false);
});

test('searching and reordering the roster still sends orders to the selected worker ID', t => {
  const f = fixture(t);
  f.worker.name = 'Alpha';
  const second = { ...f.worker, id: 'beta', name: 'Beta', cargo: {} };
  f.state.workers.push({ ...f.worker, id: 'outsider', ownerId: 'bob' }, second);
  f.ui.show('workers'); f.search('Beta');
  assert.deepEqual(f.buttons.filter(button => button.dataset.workerId).map(button => button.dataset.workerId), ['beta']);
  f.select('worker-1-resource', 'iron'); f.click('Apply orders');
  assert.equal(f.sent.at(-1).workerId, 'beta'); assert.equal(f.sent.at(-1).resource, 'iron');
  f.state.workers.reverse(); f.ui.refresh();
  assert.ok(f.fields.has('worker-0-resource')); assert.equal(f.fields.get('worker-0-resource').value, 'iron');
  f.click('Apply orders'); assert.equal(f.sent.at(-1).workerId, 'beta');
  f.search(''); f.choose(f.worker.id); f.click('Apply orders');
  assert.equal(f.sent.at(-1).workerId, f.worker.id); assert.equal(f.sent.at(-1).resource, 'timber');
});

test('unsent orders stay with each worker through selection, tabs and live status updates', t => {
  const f = fixture(t), second = { ...f.worker, id: 'second', name: 'Second worker', resource: 'wheat', cargo: {} };
  f.state.workers.push(second); f.ui.show('workers'); f.select('worker-0-resource', 'coal');
  f.choose(second.id); assert.equal(f.fields.get('worker-1-resource').value, 'wheat');
  f.select('worker-1-resource', 'stone'); f.click('Tools'); f.worker.status = 'Going to public forest'; f.ui.refresh();
  f.click('Orders'); assert.equal(f.fields.get('worker-1-resource').value, 'stone');
  f.choose(f.worker.id); assert.equal(f.fields.get('worker-0-resource').value, 'coal');
  f.click('Apply orders'); assert.equal(f.sent.at(-1).workerId, f.worker.id); assert.equal(f.sent.at(-1).resource, 'coal');
  f.choose(second.id); f.click('Apply orders'); assert.equal(f.sent.at(-1).workerId, second.id); assert.equal(f.sent.at(-1).resource, 'stone');
});

test('type and status filters combine with search and recover from an empty result', t => {
  const f = fixture(t), mineId = PLOTS[0].id, storeId = PLOTS[1].id;
  f.worker.name = 'Personal woodcutter';
  f.state.plots = [{ id: mineId, ownerId: 'alice', building: 'mine', hp: 300 }, { id: storeId, ownerId: 'alice', building: 'house', hp: 300 }];
  f.state.workers.push(
    { ...f.worker, id: 'miner', name: 'Mountain miner', staffPlotId: mineId, staffRole: 'gatherer', resource: 'stone', sourcePlotId: mineId, destinationPlotId: mineId, mode: 'store', paused: false, status: 'Gathering stone', cargo: {} },
    { ...f.worker, id: 'hauler', name: 'Supply hauler', staffPlotId: storeId, staffRole: 'transporter', resource: 'stone', sourcePlotId: mineId, destinationPlotId: storeId, mode: 'store', paused: false, status: 'Delivering stone', cargo: {} }
  );
  const visible = () => f.buttons.filter(button => button.dataset.workerId).map(button => button.dataset.workerId);
  f.ui.show('workers'); f.select('worker-roster-type', 'gatherer'); assert.deepEqual(visible(), ['miner']);
  f.select('worker-roster-filter', 'working'); assert.deepEqual(visible(), ['miner']);
  f.select('worker-roster-filter', 'paused'); assert.deepEqual(visible(), []);
  assert.equal(f.buttons.some(button => button.text === 'Apply orders'), false, 'empty results expose no unrelated editor');
  f.select('worker-roster-filter', 'all'); f.select('worker-roster-type', 'transporter'); assert.deepEqual(visible(), ['hauler']);
  f.search('missing worker'); assert.deepEqual(visible(), []);
  f.search('SUPPLY'); assert.deepEqual(visible(), ['hauler'], 'worker search ignores case');
  f.search(''); f.select('worker-roster-type', 'personal'); assert.deepEqual(visible(), [f.worker.id]);
  f.worker.paused = false; f.ui.refresh(); f.select('worker-roster-filter', 'attention'); assert.deepEqual(visible(), [f.worker.id], 'a worker waiting for orders needs attention');
});

test('clearing the UI resets search, filters, selection, tab and unsent worker orders', t => {
  const f = fixture(t), second = { ...f.worker, id: 'second', name: 'Second worker', cargo: {} };
  f.state.workers.push(second); f.ui.show('workers'); f.choose(second.id); f.select('worker-1-resource', 'iron');
  f.select('worker-roster-filter', 'paused'); f.select('worker-roster-type', 'personal'); f.search('Second'); f.click('Tools');
  f.ui.clear(); f.ui.show('workers');
  assert.equal(f.fields.get('worker-roster-search').value, '');
  assert.equal(f.fields.get('worker-roster-filter').value, 'all'); assert.equal(f.fields.get('worker-roster-type').value, 'all');
  assert.equal(f.roster(f.worker.id).ariaPressed, 'true'); assert.ok(f.fields.has('worker-0-resource'));
  f.choose(second.id); assert.equal(f.fields.get('worker-1-resource').value, 'timber');
});

test('worker order clicks survive live snapshots through pointer and keyboard release without replay', t => {
  const f = fixture(t);
  for (const key of [null, ' ', 'Enter']) {
    f.ui.show('workers'); f.select('worker-0-resource', 'coal');
    const button = f.button('Apply orders'); document.activeElement = button;
    if (key) button.onkeydown?.({ key }); else button.onpointerdown?.({ button: 0 });
    f.player.wallet++; f.worker.status = `Working ${key || 'pointer'}`; f.ui.refresh();
    assert.ok(f.buttons.includes(button), 'the pressed control remains attached until its native click');
    if (key) button.onkeyup?.({ key }); else button.onpointerup?.();
    f.state.treasury++; f.ui.refresh(); assert.ok(f.buttons.includes(button));
    const before = f.sent.length; button.onclick();
    assert.equal(f.sent.length, before + 1); assert.equal(f.sent.at(-1).workerId, f.worker.id); assert.equal(f.sent.at(-1).resource, 'coal');
    f.flushTimers(); assert.equal(f.sent.length, before + 1, 'timer cleanup cannot replay a command');
  }
});

test('detached worker controls and cancelled presses cannot act on a different selection', t => {
  const f = fixture(t), second = { ...f.worker, id: 'second', name: 'Second worker', cargo: {} };
  f.state.workers.push(second); f.ui.show('workers');
  const oldApply = f.button('Apply orders'); f.choose(second.id); oldApply.onclick(); assert.equal(f.sent.length, 0);
  const button = f.button('Apply orders'); button.onpointerdown?.({ button: 0 });
  f.player.wallet++; f.ui.refresh(); button.onpointercancel?.(); f.ui.refresh();
  assert.equal(f.sent.length, 0); assert.ok(!f.buttons.includes(button));
  button.onclick(); assert.equal(f.sent.length, 0);
  const current = f.button('Apply orders'); current.onpointerdown?.({ button: 0 }); current.onpointerup?.();
  f.ui.clear(); assert.equal(f.timers.size, 0); current.onclick(); assert.equal(f.sent.length, 0);
});

test('typing a transporter target updates its draft without replacing Apply when the field blurs', t => {
  const f = fixture(t), destination = PLOTS[0].id, source = PLOTS[1].id;
  Object.assign(f.worker, { staffPlotId: destination, staffRole: 'transporter', resource: 'stone', sourcePlotId: source, mode: 'store', destinationPlotId: destination, targetPercent: 50 });
  f.state.plots = [{ id: destination, ownerId: 'alice', building: 'tinker_shop', hp: 300 }, { id: source, ownerId: 'alice', building: 'house', hp: 300 }];
  f.ui.show('workers');
  let input = f.fields.get('worker-0-targetPercent'); input.value = '35'; input.oninput();
  input = f.fields.get('worker-0-targetPercent');
  assert.equal(input.value, '35'); assert.equal(document.activeElement, input, 'typing retains focus in the number field');
  const apply = f.button('Apply orders'), opens = f.opens;
  apply.onpointerdown({ button: 0 }); input.onchange(); document.activeElement = apply;
  assert.equal(f.opens, opens, 'blur with the unchanged draft must not rebuild the form');
  assert.ok(f.buttons.includes(apply), 'Apply is still attached when the native click follows blur');
  apply.onpointerup(); apply.onclick();
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'worker_assign', workerId: f.worker.id, resource: 'stone', sourcePlotId: source, mode: 'store', destinationPlotId: destination, targetPercent: 35 });
});

test('transporter training offers movement and carrying upgrades and measures progress in deliveries', t => {
  const f = fixture(t), destination = PLOTS[0].id;
  Object.assign(f.worker, { staffPlotId: destination, staffRole: 'transporter', resource: 'stone', mode: 'store', destinationPlotId: destination, level: 2, upgradePoints: 2, workXp: 27 });
  f.state.plots = [{ id: destination, ownerId: 'alice', building: 'tinker_shop', hp: 300 }];
  f.ui.show('workers'); f.click('Training');
  assert.match(f.html, /2 \/ 25 deliveries/); assert.doesNotMatch(f.html, /seconds \/ harvest/);
  const upgrades = f.buttons.filter(button => button.text === '+1 rank · 1 point');
  assert.equal(upgrades.length, 2);
  upgrades[0].onclick(); assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'worker_upgrade', workerId: f.worker.id, attribute: 'speed' });
  upgrades[1].onclick(); assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'worker_upgrade', workerId: f.worker.id, attribute: 'carry' });
});

test('all-mine orders require an owned mine and expose donation destinations with owner labels', t => {
  const f = fixture(t), mine = PLOTS[0].id, donor = PLOTS[1].id, foreignMine = PLOTS[2].id;
  f.state.plots = [{ id: mine, ownerId: 'alice', building: 'mine', hp: 300 }, { id: donor, ownerId: 'bob', ownerName: 'Bob', building: 'tinker_shop', hp: 300 }, { id: foreignMine, ownerId: 'bob', building: 'mine', hp: 300 }];
  f.ui.show('workers'); f.select('worker-0-resource', 'mine_all');
  assert.equal(f.button('Apply orders').disabled, true, 'all ores cannot use public gathering grounds');
  assert.match(f.html, /All mine resources/); assert.match(f.html, /stone, iron, coal and sulfur/);
  assert.doesNotMatch(f.html.match(/id="worker-0-sourcePlotId"[^>]*>(.*?)<\/select>/s)[1], new RegExp(`value="${foreignMine}"`));
  f.select('worker-0-sourcePlotId', mine); f.select('worker-0-mode', 'store'); f.select('worker-0-destinationPlotId', donor);
  assert.match(f.html, /Bob · Donation/); assert.match(f.html, /Donation to Bob/); assert.match(f.html, /cannot take them back/);
  f.click('Apply orders');
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'worker_assign', workerId: f.worker.id, resource: 'mine_all', sourcePlotId: mine, mode: 'store', destinationPlotId: donor });
  f.state.plots[0].ownerId = 'bob'; f.ui.refresh(); assert.equal(f.button('Apply orders').disabled, true);
});

test('transporter donation route still withdraws only from an owned source and rejects a ruined destination', t => {
  const f = fixture(t), home = PLOTS[0].id, source = PLOTS[1].id, destination = PLOTS[2].id;
  Object.assign(f.worker, { staffPlotId: home, staffRole: 'transporter', resource: 'stone', sourcePlotId: source, mode: 'store', destinationPlotId: home, targetPercent: 30 });
  f.state.plots = [{ id: home, ownerId: 'alice', building: 'tinker_shop', hp: 300 }, { id: source, ownerId: 'alice', building: 'house', hp: 300 }, { id: destination, ownerId: 'bob', ownerName: '<Bob>', building: 'cannon', hp: 300 }];
  f.ui.show('workers'); f.select('worker-0-destinationPlotId', destination);
  assert.match(f.html, /Donation to &lt;Bob&gt;/); assert.doesNotMatch(f.html, /Donation to <Bob>/);
  f.select('worker-0-sourcePlotId', home); f.click('Apply orders');
  assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'worker_assign', workerId: f.worker.id, resource: 'stone', sourcePlotId: home, mode: 'store', destinationPlotId: destination, targetPercent: 30 });
  assert.doesNotMatch(f.html.match(/id="worker-0-sourcePlotId"[^>]*>(.*?)<\/select>/s)[1], new RegExp(`value="${destination}"`));
  f.state.plots[2].ruined = true; f.ui.refresh(); assert.equal(f.button('Apply orders').disabled, true);
});

test('mine-all equipment marks the pickaxe as the current tool', t => {
  const f = fixture(t); f.worker.resource = 'mine_all'; f.ui.show('workers'); f.click('Tools');
  assert.match(f.html, /Pickaxe · current assignment/); assert.match(f.html, /data-item="pickaxe"/);
});
