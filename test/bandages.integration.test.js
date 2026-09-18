import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { Simulation } from '../server/simulation.js';
import { ensureRoleStats } from '../server/roles.js';
import { ensureSkills } from '../server/skills.js';
import { BANDAGE, RESOURCE_WEIGHTS, carryCapacity, inventoryWeight } from '../shared/content.js';
import { ROLE_STATS } from '../shared/roles.js';
import { BUILDINGS } from '../shared/world.js';
import { buildingEntrance } from '../shared/access.js';

async function fixture(t, role = 'villager') {
  const dir = await mkdtemp(join(tmpdir(), 'emberwatch-bandages-')), store = new Store(dir);
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });
  const session = await store.authenticate('register', 'Bandage Buyer', 'bandage-regression-password');
  const account = store.account(session.playerId), sim = new Simulation(store);
  const { id } = sim.create('Bandage counter', account), v = sim.villages.get(id), p = sim.join(id, account, role);
  Object.assign(p, { wallet: 1000, lastAction: -100 });
  v.phaseRemaining = 10000; v.zombies = []; v.guards = [];
  const shop = BUILDINGS.find(building => building.id === 'tools');
  const approach = () => Object.assign(p, buildingEntrance(shop));
  const action = a => { v.clock += 1; return sim.action(id, p.id, a); };
  const buy = () => action({ kind: 'buyBandage' });
  const use = () => action({ kind: 'useBandage' });
  approach();
  return { store, sim, account, v, p, shop, approach, action, buy, use };
}

function rejectsWithoutMutation(f, action, pattern) {
  f.v.clock += 1;
  const before = structuredClone(f.v), accountBefore = f.store.account(f.p.id);
  assert.throws(() => f.sim.action(f.v.id, f.p.id, action), pattern);
  assert.deepEqual(f.v, before);
  assert.deepEqual(f.store.account(f.p.id), accountBefore);
}

test('bandages cost exactly 250 wallet gold for one item and route payment to the treasury', async t => {
  const f = await fixture(t), treasury = f.v.treasury, weight = inventoryWeight(f.p);
  f.store.bank(f.p.id, 1000); f.store.issueCredit(f.p.id, 200);
  const accountBefore = f.store.account(f.p.id);
  assert.deepEqual(BANDAGE, { price: 250, healFraction: .25 });
  assert.ok(Object.isFrozen(BANDAGE)); assert.equal(RESOURCE_WEIGHTS.bandage, 1);
  assert.match(f.action({ kind: 'buyBandage', price: 0, amount: 9999, healFraction: 1 }), /Bandage purchased/);
  assert.equal(f.p.wallet, 750); assert.equal(f.p.inventory.bandage, 1);
  assert.equal(f.v.treasury, treasury + 250); assert.equal(inventoryWeight(f.p), weight + 1);
  assert.deepEqual(f.store.account(f.p.id), accountBefore, 'bank savings, credit and debt are untouched');
  const before = structuredClone(f.v);
  assert.throws(() => f.sim.action(f.v.id, f.p.id, { kind: 'buyBandage' }), /Wait/);
  assert.deepEqual(f.v, before, 'repeat clicks respect ordinary shopping action timing');
  f.buy(); assert.equal(f.p.wallet, 500); assert.equal(f.p.inventory.bandage, 2);
  const snapshot = f.sim.snapshot(f.v, f.p.id).players.find(player => player.id === f.p.id);
  assert.equal(snapshot.inventory.bandage, 2);
});

test('bandage shopping requires the Oak & Iron front counter and existing living, on-foot access rules', async t => {
  const f = await fixture(t), action = { kind: 'buyBandage' };
  Object.assign(f.p, { x: 0, z: 0 }); rejectsWithoutMutation(f, action, /front counter/);
  Object.assign(f.p, { x: f.shop.x, z: f.shop.z }); rejectsWithoutMutation(f, action, /front counter/);
  f.approach(); f.p.mountedHorseId = 'horse'; rejectsWithoutMutation(f, action, /Dismount/); f.p.mountedHorseId = null;
  f.p.downed = true; rejectsWithoutMutation(f, action, /downed/); f.p.downed = false;
  f.p.bedPlotId = 'church'; rejectsWithoutMutation(f, action, /bed/); delete f.p.bedPlotId;
  f.p.online = false; rejectsWithoutMutation(f, action, /Join/); f.p.online = true;
  f.v.status = 'fallen'; rejectsWithoutMutation(f, action, /fallen/); f.v.status = 'active';
  f.buy(); assert.equal(f.p.inventory.bandage, 1);
});

test('bandage capacity is checked before charging and exactly one remaining weight fits', async t => {
  const f = await fixture(t);
  f.p.inventory.wheat = carryCapacity(f.p) - inventoryWeight(f.p) - 1;
  f.buy(); assert.equal(inventoryWeight(f.p), carryCapacity(f.p));
  rejectsWithoutMutation(f, { kind: 'buyBandage' }, /pack is full/);
  f.p.hp = 40; f.use(); assert.equal(inventoryWeight(f.p), carryCapacity(f.p) - 1);
  f.buy(); assert.equal(inventoryWeight(f.p), carryCapacity(f.p));
});

test('insufficient wallet gold cannot be replaced by savings or approved purchase credit', async t => {
  const f = await fixture(t); f.p.wallet = 249;
  f.store.bank(f.p.id, 5000); f.store.issueCredit(f.p.id, 200);
  rejectsWithoutMutation(f, { kind: 'buyBandage' }, /wallet gold/);
  f.p.wallet = 250; f.buy(); assert.equal(f.p.wallet, 0); assert.equal(f.p.inventory.bandage, 1);
  assert.equal(f.store.account(f.p.id).bank, 5000); assert.equal(f.store.account(f.p.id).credit, 200);
  f.v.treasury = Number.MAX_SAFE_INTEGER; f.p.wallet = 500;
  rejectsWithoutMutation(f, { kind: 'buyBandage' }, /treasury/);
});

test('every role can use bandages away from shops and healing scales to current maximum HP without restoring other stats', async t => {
  const f = await fixture(t);
  for (const role of Object.keys(ROLE_STATS)) {
    f.p.role = role; f.p.skills = role === 'guard' ? { guard_vitality: 2 } : {};
    ensureSkills(f.p); ensureRoleStats(f.p, { clock: f.v.clock });
    Object.assign(f.p, { hp: 10, shield: 0, mana: 7, hunger: 42, x: 0, z: 0 });
    f.p.inventory.bandage = 2;
    const wallet = f.p.wallet, accountBefore = f.store.account(f.p.id), maxHp = f.p.maxHp;
    f.action({ kind: 'useBandage', healFraction: 1, targetId: 'another-player', amount: 2 });
    assert.equal(f.p.hp, 10 + maxHp * .25, `${role} heals exactly one quarter of maximum HP`);
    if (role === 'priest') assert.equal(f.p.hp, 41.25, '125 max HP receives 31.25 HP without rounding down');
    if (role === 'guard') assert.equal(f.p.hp, 42.5, 'vitality raises the heal to 32.5 for 130 max HP');
    assert.equal(f.p.inventory.bandage, 1); assert.equal(f.p.shield, 0); assert.equal(f.p.mana, 7); assert.equal(f.p.hunger, 42);
    assert.equal(f.p.wallet, wallet); assert.deepEqual(f.store.account(f.p.id), accountBefore);
  }
});

test('bandages clamp healing to maximum HP and do not consume another when already healthy', async t => {
  const f = await fixture(t, 'priest'); f.p.hp = 120; f.p.inventory.bandage = 2;
  assert.match(f.use(), /restored 5 HP/); assert.equal(f.p.hp, 125); assert.equal(f.p.inventory.bandage, 1);
  rejectsWithoutMutation(f, { kind: 'useBandage' }, /full health/);
  f.p.hp = 130; rejectsWithoutMutation(f, { kind: 'useBandage' }, /full health/);
});

test('bandages never revive, heal invalid health states or bypass mounted and church treatment restrictions', async t => {
  const f = await fixture(t); f.p.inventory.bandage = 2;
  f.p.hp = 0; f.p.downed = true; rejectsWithoutMutation(f, { kind: 'useBandage' }, /downed/); f.p.downed = false;
  for (const hp of [0, -1, NaN, Infinity]) {
    f.p.hp = hp; rejectsWithoutMutation(f, { kind: 'useBandage' }, /living dwarf/);
  }
  f.p.hp = 10;
  for (const maxHp of [0, -1, NaN, Infinity]) {
    f.p.maxHp = maxHp; rejectsWithoutMutation(f, { kind: 'useBandage' }, /living dwarf/);
  }
  f.p.maxHp = 100;
  f.p.mountedHorseId = 'horse'; rejectsWithoutMutation(f, { kind: 'useBandage' }, /Dismount/); f.p.mountedHorseId = null;
  f.p.bedPlotId = 'church'; rejectsWithoutMutation(f, { kind: 'useBandage' }, /bed/);
  assert.equal(f.p.inventory.bandage, 2); assert.equal(f.p.hp, 10);
});

test('using bandages requires a positive whole carried count and cannot reuse an exhausted stack', async t => {
  const f = await fixture(t); f.p.hp = 10;
  for (const count of [0, -1, .5, NaN, Infinity, '2']) {
    f.p.inventory.bandage = count; rejectsWithoutMutation(f, { kind: 'useBandage' }, /Buy a bandage/);
  }
  f.p.inventory.bandage = 1; f.use(); assert.equal(f.p.hp, 35); assert.equal(f.p.inventory.bandage, 0);
  rejectsWithoutMutation(f, { kind: 'useBandage' }, /Buy a bandage/);
});

test('older inventories migrate to zero bandages while purchased and consumed counts survive SQLite reload', async t => {
  const f = await fixture(t); assert.equal(f.p.inventory.bandage, 0);
  delete f.p.inventory.bandage; f.p.inventory.wheat = 12; f.store.saveVillage(f.v);
  let reload = new Simulation(f.store), restored = reload.join(f.v.id, f.account, 'villager');
  assert.equal(restored.inventory.bandage, 0); assert.equal(restored.inventory.wheat, 12); assert.equal(restored.wallet, 1000);
  Object.assign(restored, buildingEntrance(f.shop));
  reload.action(f.v.id, restored.id, { kind: 'buyBandage' });
  reload = new Simulation(f.store); restored = reload.join(f.v.id, f.account, 'villager');
  assert.equal(restored.inventory.bandage, 1); assert.equal(restored.wallet, 750);
  restored.hp = 40; reload.villages.get(f.v.id).clock += 1;
  reload.action(f.v.id, restored.id, { kind: 'useBandage' });
  const after = new Simulation(f.store).villages.get(f.v.id).players[restored.id];
  assert.equal(after.hp, 65); assert.equal(after.inventory.bandage, 0); assert.equal(after.wallet, 750);
});

for (const kind of ['buyBandage', 'useBandage']) test(`${kind} rolls back the complete action when saving fails after SQLite writes`, async t => {
  const f = await fixture(t);
  if (kind === 'useBandage') { f.p.inventory.bandage = 1; f.p.hp = 40; }
  f.store.bank(f.p.id, 500); f.store.issueCredit(f.p.id, 200);
  f.v.clock += 1; f.store.saveVillage(f.v);
  const before = structuredClone(f.v), accountBefore = f.store.account(f.p.id), savedBefore = f.store.loadVillages();
  const originalSave = f.store.saveVillage;
  f.store.saveVillage = function (village) { originalSave.call(this, village); throw new Error('Injected bandage disk write failure'); };
  try { assert.throws(() => f.sim.action(f.v.id, f.p.id, { kind }), /disk write failure/); }
  finally { f.store.saveVillage = originalSave; }
  assert.deepEqual(f.v, before, 'rollback restores HP, bandages, wallet, treasury and all other village state');
  assert.deepEqual(f.store.account(f.p.id), accountBefore);
  assert.deepEqual(f.store.loadVillages(), savedBefore, 'the already-written SQLite state is rolled back too');
  const recovered = new Simulation(f.store).villages.get(f.v.id).players[f.p.id];
  assert.equal(recovered.hp, f.p.hp); assert.equal(recovered.inventory.bandage, f.p.inventory.bandage); assert.equal(recovered.wallet, f.p.wallet);
  f.sim.action(f.v.id, f.p.id, { kind });
  assert.equal(f.p.inventory.bandage, kind === 'buyBandage' ? 1 : 0);
  assert.equal(f.p.wallet, kind === 'buyBandage' ? 750 : 1000);
  assert.equal(f.p.hp, kind === 'buyBandage' ? 100 : 65);
});
