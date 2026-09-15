import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createGuardOrdersUI, createGuardRallies } from '../public/src/guard-orders-ui.js';

function fixture(t) {
  const previous = globalThis.document;
  let html = '', buttons = [], panel = null, opens = 0;
  const sent = [], player = { id: 'alice', role: 'guard', online: true, hp: 100, x: 0, z: 30 };
  const row = { plotId: 'west-1', ownerId: 'alice', mode: 'defend', effectiveMode: 'defend', rally: { x: -2, z: 35 }, livingTroops: 2, recruitedTroops: 3 };
  const state = { guardOrders: [row] };
  const content = { querySelectorAll: selector => selector === '[data-guard-order]' ? buttons : [] };
  globalThis.document = { getElementById: id => id === 'panel-content' ? content : null };
  t.after(() => { globalThis.document = previous; });
  const ui = createGuardOrdersUI({ getState: () => state, getMe: () => player, getActivePanel: () => panel,
    send: message => sent.push(message), openPanel(next, kind) {
      html = next; panel = kind; opens++;
      buttons = [...html.matchAll(/<button\b([^>]*)>(.*?)<\/button>/gs)].map(([, attributes, text]) => ({ text, disabled: /\sdisabled(?:\s|$)/.test(attributes), dataset: {
        guardOrder: attributes.match(/data-guard-order="([^"]*)"/)[1], guardRow: attributes.match(/data-guard-row="([^"]*)"/)[1]
      } }));
    } });
  return { ui, player, row, state, sent, get html() { return html; }, get opens() { return opens; }, get buttons() { return buttons; },
    setPanel(value) { panel = value; }, click(mode) { const button = buttons.find(b => b.dataset.guardOrder === mode); assert.ok(button); button.onclick(); } };
}

test('remote command buttons send only an owned barracks and mode; Hold here sends no forged coordinates', t => {
  const f = fixture(t); f.state.guardOrders.push({ ...f.row, plotId: 'east-1', ownerId: 'bob' }); f.ui.show();
  assert.match(f.html, /2\/3 troops standing/); assert.doesNotMatch(f.html, /East Hearth/);
  assert.match(f.html, /still require visiting the barracks entrance/);
  for (const mode of ['defend', 'hold', 'follow', 'retreat']) {
    f.click(mode); assert.deepEqual(f.sent.at(-1), { type: 'action', kind: 'guard_order', plotId: 'west-1', mode });
  }
  f.player.downed = true; f.click('follow'); assert.equal(f.sent.length, 4, 'a stale open button cannot issue commands after death');
  f.ui.update(); assert.ok(f.buttons.every(button => button.disabled));
  f.player.downed = false; f.state.guardOrders = []; f.ui.update(); assert.match(f.html, /do not own an intact barracks/);
});

test('command updates preserve closed and unrelated panels, then refresh authoritative order status', t => {
  const f = fixture(t); f.ui.show(); const initial = f.opens;
  f.row.rally.x += 1; f.ui.update(); assert.equal(f.opens, initial, 'moving follow markers do not rebuild the command panel');
  f.setPanel(null); f.row.mode = 'follow'; f.ui.update(); assert.equal(f.opens, initial);
  f.setPanel('settlement'); f.ui.update(); assert.equal(f.opens, initial);
  f.ui.show(); assert.match(f.html, /Follow me/);
  f.row.effectiveMode = 'retreat'; f.row.fallback = '<script>blocked</script>'; f.ui.update();
  assert.match(f.html, /&lt;script&gt;blocked&lt;\/script&gt;/); assert.doesNotMatch(f.html, /<script>/);
  const count = f.opens; f.ui.dispose(); f.row.mode = 'hold'; f.ui.update(); f.ui.show(); assert.equal(f.opens, count);
});

test('rally markers filter ownership, reuse geometry, move with snapshots, and dispose removed resources', () => {
  const scene = new THREE.Scene(), rallies = createGuardRallies(scene);
  const own = { plotId: 'west-1', ownerId: 'alice', mode: 'hold', effectiveMode: 'hold', rally: { x: -2, z: 35 } };
  rallies.update({ guardOrders: [own, { ...own, plotId: 'east-1', ownerId: 'bob' }] }, 'alice');
  assert.equal(rallies.group.children.length, 1);
  const marker = rallies.group.children[0], geometries = marker.children.filter(node => node.isMesh).map(node => node.geometry);
  assert.equal(marker.userData.label, 'Hold position'); assert.equal(marker.position.z, 35);
  const material = marker.children[0].material;
  own.rally = { x: 12, z: 45 }; own.effectiveMode = 'retreat'; rallies.update({ guardOrders: [own] }, 'alice');
  assert.equal(rallies.group.children[0], marker); assert.equal(marker.position.x, 12); assert.equal(marker.userData.label, 'Retreat to barracks');
  assert.equal(marker.children[0].geometry, geometries[0]); assert.equal(marker.children[0].material, material);
  let materialDisposals = 0, geometryDisposals = 0;
  material.addEventListener('dispose', () => materialDisposals++);
  for (const geometry of geometries) geometry.addEventListener('dispose', () => geometryDisposals++);
  rallies.update(null, 'alice'); assert.equal(rallies.group.children.length, 0); assert.equal(materialDisposals, 1); assert.equal(geometryDisposals, 0);
  rallies.dispose(); rallies.dispose(); assert.equal(geometryDisposals, 3); assert.equal(scene.children.length, 0);
});
