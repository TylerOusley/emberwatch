import test from 'node:test';
import assert from 'node:assert/strict';
import { academyModel, createSkillsUI } from '../public/src/skills-ui.js';
import { inventoryHUDModel, createInventoryHUD } from '../public/src/inventory-hud.js';
import { createSettlementUI } from '../public/src/settlement-ui.js';
import { PLOTS } from '../shared/world.js';
import { plotEntrance } from '../shared/access.js';
import { MAGIC } from '../shared/magic.js';
import { carryCapacity, TOOL_WEIGHTS } from '../shared/content.js';

function fixture() {
  const plot = { id: PLOTS[0].id, building: 'arcane_academy', ownerId: 'owner', ownerName: 'Teacher', hp: 700, maxHp: 700, storage: {} };
  const player = { id: 'wizard', role: 'wizard', staffOwned: false, mana: 31, staffElement: 'fire', hp: 100, online: true, inventory: {}, durability: {}, wallet: 0, ...plotEntrance(PLOTS[0], plot) };
  const state = { status: 'active', players: [player, { id: 'owner', online: false }], plots: [plot], guards: [], stock: {}, academy: { mana: 31, manaMax: 100, staffElement: 'fire', stats: { staffElements: ['fire', 'frost', 'lightning'] } } };
  return { player, plot, state };
}

function panelHarness() {
  let html = '', kind = null, buttons = [], renders = 0;
  const sent = [];
  const find = query => query === 'button' ? buttons : /^\[data-/.test(query) ? buttons.filter(button => Object.hasOwn(button.attrs, query.slice(1, -1))) : [];
  const content = { querySelectorAll: find, querySelector: query => find(query)[0], contains: node => buttons.includes(node) };
  const dialog = { open: true, scrollTop: 0, classList: { add() {} } };
  const doc = { activeElement: null, getElementById: id => id === 'panel-content' ? content : id === 'panel-dialog' ? dialog : null };
  const deps = { document: doc, getActivePanel: () => kind, send: action => sent.push(action), openPanel(markup, panel) {
    html = markup; kind = panel; renders++;
    buttons = [...html.matchAll(/<button\b([^>]*)>(.*?)<\/button>/gs)].map(match => {
      const attrs = Object.fromEntries([...match[1].matchAll(/(data-[\w-]+)(?:="([^"]*)")?/g)].map(attr => [attr[1], attr[2] ?? '']));
      const dataset = Object.fromEntries(Object.entries(attrs).map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase()), value]));
      return { attrs, dataset, text: match[2], disabled: /\sdisabled(?:\s|$)/.test(match[1]) };
    });
  } };
  return { deps, doc, sent, button: text => buttons.find(button => button.text === text), get html() { return html; }, get renders() { return renders; } };
}

test('Academy staff reclaim requires an active, accessible Academy and enough carrying room', () => {
  const { state, player, plot } = fixture(), model = () => academyModel(state, player, plot.id);
  assert.equal(model().canReclaimStaff, true, 'an offline owner still supports the Academy');
  for (const property of ['carriedBy', 'bedPlotId', 'mountedHorseId', 'downed']) {
    player[property] = true; assert.equal(model().canReclaimStaff, false, property); delete player[property];
  }
  for (const property of ['ruined', 'rebuilding']) {
    plot[property] = true; assert.equal(model().canReclaimStaff, false, property); delete plot[property];
  }
  plot.hp = 0; assert.equal(model().canReclaimStaff, false); plot.hp = 700;
  player.hp = 0; assert.equal(model().canReclaimStaff, false); player.hp = 100;
  player.online = false; assert.equal(model().canReclaimStaff, false); player.online = true;
  player.x += 20; assert.equal(model().canReclaimStaff, false); player.x -= 20;
  state.status = 'fallen'; assert.equal(model().canReclaimStaff, false); state.status = 'active';
  const owner = state.players.pop(); assert.equal(model().canReclaimStaff, false); state.players.push(owner);
  player.role = 'villager'; assert.equal(model().canReclaimStaff, false); player.role = 'wizard';
  player.inventory.wheat = carryCapacity(player) - TOOL_WEIGHTS.staff;
  assert.equal(model().canReclaimStaff, true, 'exact capacity accepts the staff');
  player.inventory.wheat++; assert.equal(model().canReclaimStaff, false);
  assert.match(model().reclaimReason, /Make room/);
  player.inventory = {}; player.staffOwned = true;
  assert.equal(model().canReclaimStaff, false);
});

test('Academy renders spell costs and free recovery, rechecks stale clicks and refreshes after reclaim', () => {
  const { state, player, plot } = fixture(), h = panelHarness();
  const ui = createSkillsUI({ ...h.deps, getState: () => state, getMe: () => player });
  ui.show(plot.id);
  assert.match(h.html, new RegExp(`Each cast costs ${MAGIC.fire.mana} mana with a ${MAGIC.fire.cooldown} second cooldown`));
  const reclaim = h.button('Reclaim staff · Free');
  assert.equal(reclaim.disabled, false); reclaim.onclick();
  assert.deepEqual(h.sent, [{ type: 'action', kind: 'academy_reclaim_staff', plotId: plot.id }]);
  player.x += 20; reclaim.onclick(); assert.equal(h.sent.length, 1, 'moving away invalidates a rendered button');
  player.x -= 20; player.staffOwned = true; ui.update();
  assert.equal(h.button('Reclaim staff · Free'), undefined);
  assert.match(h.html, /Unbreakable · Mana powered/);
  assert.match(h.html, /31 \/ 100 mana/, 'recovery display does not invent a mana refill');
  state.academy.staffElement = 'lightning'; ui.update();
  assert.match(h.html, new RegExp(`Each cast costs ${MAGIC.lightning.mana} mana with a ${MAGIC.lightning.cooldown} second cooldown`));
  player.role = 'guard'; ui.update(); assert.doesNotMatch(h.html, /Your staff|data-academy-reclaim/);
});

test('inventory HUD tracks permanent staff ownership without a durability count', () => {
  const { player } = fixture(); player.staffOwned = true;
  const staff = inventoryHUDModel(player).tools.find(item => item.id === 'staff');
  assert.equal(staff.label, 'Arcane staff'); assert.equal(staff.unbreakable, true); assert.equal(staff.uses, null);
  let writes = 0;
  const root = { hidden: true, set innerHTML(markup) { this.markup = markup; writes++; }, querySelector: () => ({}), replaceChildren() {} };
  const hud = createInventoryHUD(root); hud.update(player);
  assert.match(root.markup, /Arcane staff · 1 carried · Unbreakable · Mana powered/);
  assert.doesNotMatch(root.markup, /uses remaining/);
  hud.update({ ...player, x: 500 }); assert.equal(writes, 1);
  player.staffOwned = false; hud.update(player); assert.equal(writes, 2);
  assert.doesNotMatch(root.markup, /Arcane staff/);
});

test('pack, Academy plot and shop honor permanent staff ownership after snapshot changes', t => {
  const { state, player, plot } = fixture(), h = panelHarness();
  const previous = globalThis.document; globalThis.document = h.doc; t.after(() => { globalThis.document = previous; });
  const ui = createSettlementUI({ ...h.deps, getState: () => state, getMe: () => player, getHotbar: () => [], setHotbar() {}, toast() {} });
  ui.show('plot', plot.id); const reclaim = h.button('Reclaim staff · Free'); reclaim.onclick();
  assert.equal(h.sent.at(-1).kind, 'academy_reclaim_staff');
  player.staffOwned = true; ui.refresh(); assert.equal(h.button('Reclaim staff · Free'), undefined);
  ui.show('inventory'); ui.refresh(); const before = h.renders;
  reclaim.onclick(); assert.equal(h.sent.length, 1, 'a detached Academy control cannot act after leaving its screen');
  assert.match(h.html, /Mana powered · No durability wear/);
  assert.doesNotMatch(h.html, /Staff durability|Arcane staff<\/h4><p>\d/);
  player.staffOwned = false; ui.refresh(); assert.equal(h.renders, before + 1);
  assert.match(h.html, /Missing · Reclaim for free at an Arcane Academy/);
  plot.building = 'tinker_shop'; plot.storage = { timber: 100, iron: 100, sulfur: 100 }; player.wallet = 1000;
  Object.assign(player, plotEntrance(PLOTS[0], plot)); ui.show('plot', plot.id);
  let card = h.html.match(/<article class="shop-item" data-shop-item="staff"[\s\S]*?<\/article>/)[0];
  assert.match(card, /Unbreakable wizard staff/); assert.match(card, /Mana/);
  assert.doesNotMatch(card, /durability|harvest|resources per swing/);
  player.staffOwned = true; ui.refresh();
  card = h.html.match(/<article class="shop-item" data-shop-item="staff"[\s\S]*?<\/article>/)[0];
  assert.match(card, /You already own an unbreakable staff/);
  assert.match(card, /data-available="false"/);
  player.staffOwned = false; player.role = 'guard'; ui.refresh();
  card = h.html.match(/<article class="shop-item" data-shop-item="staff"[\s\S]*?<\/article>/)[0];
  assert.match(card, /Only wizards can use or purchase a staff/);
  assert.match(card, /data-available="false"/);
});
