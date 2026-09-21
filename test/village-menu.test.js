import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the real menu entry points without starting WebGL or a live account.
function fixture() {
  const main = readFileSync(new URL('../public/src/main.js', import.meta.url), 'utf8');
  const source = main.slice(main.indexOf('function villageMenuCard('), main.indexOf('function showBuildStatus('));
  let html = '', buttons = new Map(); const calls = [];
  const action = name => () => calls.push(name), panel = name => ({ show: action(name) });
  const context = {
    joined: true, me: { wallet: 100, backpackTier: 0 }, state: { day: 10, players: [{ online: true }] }, muted: false,
    itemArt: id => `<svg data-item="${id}"></svg>`, buildingArt: id => `<svg data-building="${id}"></svg>`, pretty: String,
    $: id => buttons.get(id), openPanel(next) { html = next; buttons = new Map([...html.matchAll(/<button\b[^>]*\bid="([^"]+)"[^>]*>/g)].map(([, id]) => [id, {}])); },
    showInventory: action('inventory'), settlement: { show: id => calls.push(id) }, guardOrders: panel('troops'), crates: panel('crates'),
    civic: panel('civic'), skills: panel('skills'), trading: panel('trading'), feedback: panel('feedback'), graphicsUI: panel('graphics'),
    villageFinance: { showInvestments: action('investments'), showTavern: action('tavern'), showTavernStats: action('stats') },
    showHelp: action('help'), progression: { ...panel('honors'), showGuide: action('guide') }, dialog: { close: action('close') },
    gameAudio: { setMuted: action('sound') }, showBuildStatus: action('updates'), requests: { findBoard: action('requests') }, leave: action('leave'), action: id => calls.push(id), panelAction() {}
  };
  vm.runInNewContext(source + '\nshowMenu();', context);
  return { calls, get html() { return html; }, click(id) { assert.ok(buttons.has(id), `Missing ${id}`); buttons.get(id).onclick(); } };
}

test('village menu shows small groups while retaining every primary destination', () => {
  const f = fixture();
  assert.equal((f.html.match(/class="village-menu-card"/g) ?? []).length, 5);
  assert.doesNotMatch(f.html, /id="menu-tavern"|id="menu-feedback"/);
  for (const id of ['pack', 'workers', 'atlas', 'orders', 'crates']) f.click(`menu-${id}`);
  assert.deepEqual(f.calls, ['inventory', 'workers', 'atlas', 'troops', 'crates']);
  f.click('menu-tab-village'); assert.equal((f.html.match(/class="village-menu-card"/g) ?? []).length, 6);
  for (const id of ['civic', 'academy', 'trading', 'investments', 'tavern', 'tavern-stats']) f.click(`menu-${id}`);
  assert.deepEqual(f.calls.slice(5), ['civic', 'skills', 'trading', 'investments', 'tavern', 'stats']);
});

test('Settings and help opens feedback and preserves graphics, guide, role and audio credit access', () => {
  const f = fixture(); f.click('menu-tab-settings');
  assert.match(f.html, /aria-pressed="true">Settings & help/);
  assert.match(f.html, /href="\/assets\/audio\/CREDITS.html"/);
  for (const id of ['feedback', 'graphics', 'help', 'honors', 'role', 'guide']) f.click(`menu-${id}`);
  assert.deepEqual(f.calls, ['feedback', 'graphics', 'help', 'honors', 'roles', 'guide', 'close']);
  f.click('menu-requests'); f.click('build-status'); f.click('leave-button');
  assert.deepEqual(f.calls.slice(-3), ['requests', 'updates', 'leave']);
});
