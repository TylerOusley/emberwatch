import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { civicAction, civicTick, civicSnapshot, ensureCivic } from '../server/civic.js';
import { CIVIC_BOARD } from '../shared/civic.js';
import { stepNpcNavigation } from '../server/navigation.js';
import { Store } from '../server/store.js';
import { Simulation } from '../server/simulation.js';
import { createCivicUI } from '../public/src/civic-ui.js';

function fixture() {
  const player = { id: 'alice', name: 'Alice', online: true, ...CIVIC_BOARD, wallet: 10000, inventory: { timber: 1000, stone: 1000, iron: 1000, arrows: 100 }, boundInventory: {} };
  const village = { id: 'works', players: { alice: player }, gate: { hp: 100, maxHp: 1200 }, keep: { hp: 2000, maxHp: 2000 }, zombies: [], carts: [], clock: 0 };
  ensureCivic(village); return { player, village, sim: {} };
}

test('untrusted project IDs cannot choose inherited properties or permanently lock the board', () => {
  const { player, village, sim } = fixture();
  for (const projectId of ['constructor', '__proto__', 'toString', ['reinforcement'], {}, null]) {
    assert.throws(() => civicAction(sim, village, player, { kind: 'civic_select', projectId }), /unfinished/);
    assert.equal(village.civic.active, null);
  }
  civicAction(sim, village, player, { kind: 'civic_select', projectId: 'reinforcement' });
  assert.equal(village.civic.active, 'reinforcement');
});

test('project and depot donations preserve bound supplies, wallet-only funds, cart ownership and exact remaining costs', () => {
  const { player, village, sim } = fixture();
  civicAction(sim, village, player, { kind: 'civic_select', projectId: 'reinforcement' });
  player.boundInventory.timber = 900;
  civicAction(sim, village, player, { kind: 'civic_donate', resource: 'timber', amount: 'max' });
  assert.equal(player.inventory.timber, 900); assert.equal(village.civic.progress.timber, 100);
  assert.throws(() => civicAction(sim, village, player, { kind: 'civic_donate', resource: 'timber', amount: 1 }), /available/);
  player.boundInventory.arrows = 80;
  civicAction(sim, village, player, { kind: 'civic_supply', resource: 'arrows', amount: 'max' });
  assert.equal(player.inventory.arrows, 80); assert.equal(village.civic.depot.arrows, 20);
  const cart = { id: 'cart', ownerId: 'bob', ...CIVIC_BOARD, storage: { timber: 1000, arrows: 100 } }; village.carts.push(cart);
  assert.throws(() => civicAction(sim, village, player, { kind: 'civic_donate', resource: 'timber', amount: 'max', cartId: cart.id }), /own freight/);
  cart.ownerId = player.id;
  civicAction(sim, village, player, { kind: 'civic_donate', resource: 'timber', amount: 'max', cartId: cart.id });
  assert.equal(cart.storage.timber, 800); assert.equal(village.civic.progress.timber, 300);
  civicAction(sim, village, player, { kind: 'civic_supply', resource: 'arrows', amount: 'max', cartId: cart.id });
  assert.equal(cart.storage.arrows, 0); assert.equal(village.civic.depot.arrows, 120);
  player.wallet = 0; player.credit = 5000; player.bank = 5000;
  assert.throws(() => civicAction(sim, village, player, { kind: 'civic_donate', resource: 'gold', amount: 1 }), /available/);
  village.civic.depot.stone = 9999998;
  civicAction(sim, village, player, { kind: 'civic_supply', resource: 'stone', amount: 'max' });
  assert.equal(village.civic.depot.stone, 10000000); assert.equal(player.inventory.stone, 998);
  assert.throws(() => civicAction(sim, village, player, { kind: 'civic_supply', resource: 'stone', amount: 1 }), /remaining requirement/);
  const snapshot = civicSnapshot(village); snapshot.civic.depot.stone = 1;
  assert.equal(village.civic.depot.stone, 10000000);
});

test('real navigation gets the paid mason to the gate, and exhausted wages stop repair without losing prepaid time on save', () => {
  const { village } = fixture(); village.civic.completed = ['reinforcement', 'repair_crew'];
  village.civic.depot = { gold: 1, timber: 100, stone: 100 };
  const sim = { stepNpc: (entity, target, speed, dt) => stepNpcNavigation(entity, target, speed, dt) };
  for (let i = 0; i < 500; i++) { village.clock += .05; civicTick(sim, village, .05); }
  assert(village.gate.hp > 100); assert(village.civic.mason.z > 12); assert.equal(village.civic.depot.gold, 0);
  const saved = JSON.parse(JSON.stringify(village)); ensureCivic(saved); assert.equal(saved.civic.mason.paidTime, village.civic.mason.paidTime);
  for (let i = 0; i < 1000; i++) { saved.clock += .05; civicTick(sim, saved, .05); }
  const hp = saved.gate.hp, timber = saved.civic.depot.timber;
  for (let i = 0; i < 100; i++) civicTick(sim, saved, .05);
  assert.equal(saved.gate.hp, hp); assert.equal(saved.civic.depot.timber, timber); assert.equal(saved.civic.mason.paidTime, 0);
  assert.match(saved.civic.mason.status, /Waiting/);
});

test('siege spending and splash stay outside the gate and obey real donated ammunition and cooldowns', () => {
  const { village } = fixture(); village.civic.completed = ['ballista', 'trebuchet']; village.civic.depot = { arrows: 1, stone: 10, coal: 2 };
  village.zombies = [{ id: 'inside', x: 0, z: 10, hp: 500 }, { id: 'front', x: 8, z: 30, hp: 500 }, { id: 'splash', x: 10, z: 31, hp: 500 }, { id: 'outside', x: 40, z: 60, hp: 500 }];
  const sim = { hitZombie(v, zombie, damage) { zombie.hp -= damage; } };
  civicTick(sim, village, .05);
  assert.equal(village.zombies[0].hp, 500); assert.equal(village.zombies[1].hp, 335); assert.equal(village.zombies[2].hp, 400);
  assert.equal(village.civic.depot.arrows, 0); assert.equal(village.civic.depot.stone, 5); assert.equal(village.civic.depot.coal, 1);
  civicTick(sim, village, 1); assert.equal(village.zombies[1].hp, 335);
  civicTick(sim, village, 12); assert.equal(village.zombies[1].hp, 235); assert.equal(village.civic.depot.stone, 0);
  civicTick(sim, village, 30); assert.equal(village.zombies[1].hp, 235);
});

test('multiplayer staged contributions persist through restart and failed project completion rolls back funds and health', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'emberwatch-civic-review-')), store = new Store(directory, { testAdminAccountIds: [] });
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  const a = await store.authenticate('register', 'Village Builder A', 'cooperative-project-password'), b = await store.authenticate('register', 'Village Builder B', 'cooperative-project-password');
  const sim = new Simulation(store), account = store.account(a.playerId), other = store.account(b.playerId), { id } = sim.create('Village Works', account), village = sim.villages.get(id);
  const first = sim.join(id, account), second = sim.join(id, other);
  for (const p of [first, second]) { Object.assign(p, CIVIC_BOARD); p.wallet = 10000; Object.assign(p.inventory, { timber: 300, stone: 500 }); }
  const act = (player, action) => sim.action(id, player.id, action);
  act(first, { kind: 'civic_select', projectId: 'reinforcement' }); act(first, { kind: 'civic_donate', resource: 'timber', amount: 100 }); act(second, { kind: 'civic_donate', resource: 'timber', amount: 200 });
  const reopened = new Store(directory, { testAdminAccountIds: [] });
  try { const v = new Simulation(reopened).villages.get(id); assert.equal(v.civic.progress.timber, 300); assert.equal(v.civic.contributors[first.id].resources.timber, 100); assert.equal(v.civic.contributors[second.id].resources.timber, 200); } finally { reopened.close(); }
  act(second, { kind: 'civic_donate', resource: 'stone', amount: 500 });
  const checkpoint = structuredClone({ works: village.civic, gate: village.gate, keep: village.keep, wallet: first.wallet }), save = store.saveVillage;
  store.saveVillage = () => { throw new Error('project save failed'); };
  assert.throws(() => act(first, { kind: 'civic_donate', resource: 'gold', amount: 5000 }), /project save failed/); store.saveVillage = save;
  assert.deepEqual({ works: village.civic, gate: village.gate, keep: village.keep, wallet: first.wallet }, checkpoint);
  act(first, { kind: 'civic_donate', resource: 'gold', amount: 5000 }); assert.equal(village.civic.active, null); assert.equal(village.gate.maxHp, checkpoint.gate.maxHp + 1200);
  assert.throws(() => act(first, { kind: 'civic_select', projectId: 'reinforcement' }), /unfinished/);
});

test('civic controls show exact transferable quantities, preserve presses during mason updates and deliver depot freight', () => {
  const { player, village } = fixture(); village.civic.active = 'reinforcement'; player.boundInventory.timber = 900;
  village.carts = [{ id: 'cart', ownerId: player.id, ...CIVIC_BOARD, storage: { arrows: 300 } }];
  let html = '', buttons = [], panel = 'civic', renders = 0; const sent = [], scheduled = new Map(); let serial = 0;
  const host = { querySelector: selector => selector === '[data-mark]' ? buttons.find(b => 'mark' in b.dataset) : null, querySelectorAll: selector => selector === '[data-select]' ? buttons.filter(b => b.dataset.select) : buttons.filter(b => b.dataset.donate || b.dataset.freight || b.dataset.supply) };
  const ui = createCivicUI({ getState: () => village, getMe: () => player, getActivePanel: () => panel, send: action => sent.push(action), markWaypoint() {}, document: { getElementById: () => host }, schedule: fn => { scheduled.set(++serial, fn); return serial; }, cancel: id => scheduled.delete(id), openPanel(value, active) {
    html = value; panel = active; renders++; buttons = [...html.matchAll(/<button\b([^>]*)>(.*?)<\/button>/gs)].map(([, attributes, label]) => ({ label, disabled: /\sdisabled(?:\s|$)/.test(attributes), dataset: Object.fromEntries([...attributes.matchAll(/data-([a-z]+)="([^"]*)"/g)].map(([, key, value]) => [key, value])) }));
  } });
  ui.show(); const donation = buttons.find(b => b.dataset.donate === 'timber'); assert.equal(donation.label, 'Donate 100 carried timber');
  donation.onpointerdown({ button: 0 }); const before = renders; village.civic.mason.paidTime = 30; player.inventory.timber += 5; ui.refresh(); assert.equal(renders, before);
  donation.onpointerup(); donation.onclick(); assert.equal(sent[0].amount, 100, 'the reviewed amount stays fixed even if cargo increases during the press');
  const freight = buttons.find(b => b.dataset.supply === 'arrows' && b.dataset.cart); assert.equal(freight.label, 'Deliver 300 cart arrows to depot'); freight.onclick();
  assert.deepEqual(sent[1], { type: 'action', kind: 'civic_supply', resource: 'arrows', amount: 300, cartId: 'cart' });
});
