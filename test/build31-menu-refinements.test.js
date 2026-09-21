import test from 'node:test';
import assert from 'node:assert/strict';
import { createCivicUI } from '../public/src/civic-ui.js';
import { createSkillsUI } from '../public/src/skills-ui.js';
import { CIVIC_BOARD } from '../shared/civic.js';
import { PLOTS } from '../shared/world.js';
import { plotEntrance } from '../shared/access.js';

function harness() {
  let markup = '', active = null, renders = 0, nodes = [], serial = 0;
  const sent = [], scheduled = new Map();
  const matches = (node, query) => query === node.tagName.toLowerCase() || query.startsWith('[data-') && Object.hasOwn(node.attrs, query.slice(1, -1));
  const host = { querySelectorAll: query => nodes.filter(n => query.split(',').some(q => matches(n, q))), querySelector: query => host.querySelectorAll(query)[0] };
  const deps = { getActivePanel: () => active, document: { getElementById: () => host }, send: action => sent.push(action), markWaypoint() {}, schedule: fn => { scheduled.set(++serial, fn); return serial; }, cancel: id => scheduled.delete(id), openPanel(html, panel) {
    markup = html; active = panel; renders++; nodes = [];
    for (const [, tag, attributes] of html.matchAll(/<(button|details|summary)\b([^>]*)>/g)) {
      const attrs = Object.fromEntries([...attributes.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(([, key, value]) => [key, value ?? '']));
      const dataset = Object.fromEntries(Object.entries(attrs).filter(([key]) => key.startsWith('data-')).map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), value]));
      nodes.push({ tagName: tag.toUpperCase(), attrs, dataset, open: Object.hasOwn(attrs, 'open'), disabled: Object.hasOwn(attrs, 'disabled') });
    }
  } };
  return { deps, sent, host, get markup() { return markup; }, get renders() { return renders; }, button: key => host.querySelector(`[data-${key}]`), detail: key => host.querySelectorAll('details').find(n => n.dataset.persist === key) };
}

function civicFixture() {
  const player = { id: 'one', ...CIVIC_BOARD, online: true, inventory: { timber: 100, stone: 60 }, wallet: 500, boundInventory: {} };
  const state = { civic: { active: 'reinforcement', completed: [], progress: {}, depot: {}, contributors: {}, mason: { status: 'ready', paidTime: 2 } }, carts: [{ id: 'own', ownerId: 'one', ...CIVIC_BOARD, storage: { timber: 30 } }, { id: 'other', ownerId: 'two', ...CIVIC_BOARD, storage: { timber: 80 } }] };
  return { player, state };
}

test('works board ignores unrelated cart motion and wage ticks but updates eligible freight', () => {
  const h = harness(), { player, state } = civicFixture();
  const ui = createCivicUI({ ...h.deps, getState: () => state, getMe: () => player }); ui.show(); const before = h.renders;
  state.carts[1].x += 20; state.civic.mason.paidTime += 1; ui.refresh(); assert.equal(h.renders, before);
  state.carts[0].x += 1; ui.refresh(); assert.equal(h.renders, before, 'nearby cart position is not displayed');
  state.carts[0].x += 20; ui.refresh(); assert.equal(h.renders, before + 1); assert.equal(h.button('freight'), undefined);
  assert.match(h.markup, /civic-project is-active/); assert.match(h.markup, /civic-depot-grid/);
});

test('works board preserves disclosure choices and donation presses through native keyboard clicks', () => {
  const h = harness(), { player, state } = civicFixture();
  const ui = createCivicUI({ ...h.deps, getState: () => state, getMe: () => player }); ui.show(); h.detail('civic-contributors').open = true;
  const donate = h.host.querySelectorAll('[data-donate]').find(n => n.dataset.donate === 'timber');
  donate.onkeydown({ key: ' ' }); const before = h.renders;
  player.inventory.timber = 120; ui.refresh(); assert.equal(h.renders, before);
  donate.onkeyup({ key: ' ' }); ui.refresh(); assert.equal(h.renders, before, 'keyup waits for native click');
  donate.onclick(); assert.deepEqual(h.sent[0], { type: 'action', kind: 'civic_donate', resource: 'timber', amount: 100 });
  assert.equal(h.renders, before + 1); assert.equal(h.detail('civic-contributors').open, true);
});

function academyFixture() {
  const plot = { id: PLOTS[0].id, building: 'arcane_academy', ownerId: 'teacher', ownerName: 'Teacher', hp: 700, storage: {} };
  const player = { id: 'wizard', role: 'wizard', ...plotEntrance(PLOTS[0], plot), online: true, hp: 100, wallet: 2000, staffOwned: false, inventory: {}, durability: {}, mana: 20 };
  const state = { status: 'active', players: [player, { id: 'teacher' }], plots: [plot], academy: { mana: 20, manaMax: 100, skills: {}, staffElement: 'fire', stats: { staffElements: ['fire'] } } };
  return { state, player, plot };
}

test('academy keeps staff recovery outside disclosures and preserves pressed controls across mana snapshots', () => {
  const h = harness(), { state, player, plot } = academyFixture();
  const ui = createSkillsUI({ ...h.deps, getState: () => state, getMe: () => player }); ui.show(plot.id);
  assert.match(h.markup, /academy-skill-grid/); assert.ok(h.markup.indexOf('data-academy-reclaim') < h.markup.indexOf('data-persist="academy-staff-help"'));
  h.detail('academy-staff-help').open = true;
  for (const method of ['pointer', 'keyboard']) {
    const reclaim = h.button('academy-reclaim'), before = h.renders;
    if (method === 'pointer') reclaim.onpointerdown({ button: 0 }); else reclaim.onkeydown({ key: 'Enter' });
    state.academy.mana++; ui.update(); assert.equal(h.renders, before);
    if (method === 'pointer') reclaim.onpointerup(); else reclaim.onkeyup({ key: 'Enter' });
    ui.update(); assert.equal(h.renders, before, 'release preserves target until native click'); reclaim.onclick();
    assert.equal(h.sent.at(-1).kind, 'academy_reclaim_staff'); assert.equal(h.renders, before + 1);
    assert.equal(h.detail('academy-staff-help').open, true);
  }
  const renders = h.renders; plot.storage.timber = 30; ui.update(); assert.equal(h.renders, renders, 'unrelated academy cargo does not replace controls');
  player.x += 20; const stale = h.button('academy-reclaim'); stale.onclick(); assert.equal(h.sent.length, 2, 'stale reclaim is revalidated against live access');
});
