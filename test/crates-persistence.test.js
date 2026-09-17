import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { Simulation } from '../server/simulation.js';
import { accountCrateSnapshot, crateAccountAction, crateSnapshot } from '../server/crates.js';
import { CRATE_PRICES, emptyLoadout } from '../shared/crates.js';
import { PLOTS, plotBedPoint } from '../shared/world.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'emberwatch-crates-')), store = new Store(directory);
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  async function register(name) { const session = await store.authenticate('register', name, 'crate-persistence-password'); return store.account(session.playerId); }
  const account = await register('Crate Collector'), other = await register('Other Collector');
  const sim = new Simulation(store), id = account.id;
  const open = (action = {}, index = 0) => crateAccountAction(store, id, { kind: 'crate_open', requestId: randomUUID(), tier: 'basic', currency: 'bank', ...action }, { chooseIndex: () => index, chooseRarity: () => 9999 });
  const loadout = value => crateAccountAction(store, id, { kind: 'crate_loadout', loadout: { ...emptyLoadout(), ...value } });
  const nights = count => { for (let n = 1; n <= count; n++) store.recordSurvivedNight(id, 'verified-prior-run', n); };
  const start = name => { const { id: villageId } = sim.create(name, account), village = sim.villages.get(villageId); return { village, player: sim.join(villageId, account, 'priest') }; };
  return { directory, store, sim, account, other, id, open, loadout, nights, start };
}

test('paid permanent duplicates refund only the actual funding currency and never touch restricted loan credit', async t => {
  const { store, id, open } = await fixture(t);
  store.bank(id, 1000000); store.issueCredit(id, 200); store.crateCredit(id, 50000);
  for (const tier of Object.keys(CRATE_PRICES)) {
    const price = CRATE_PRICES[tier], start = accountCrateSnapshot(store, id);
    const first = open({ tier }).result; assert.equal(first.duplicate, false); assert.equal(first.refund, null);
    const second = open({ tier }).result;
    assert.equal(second.duplicate, true); assert.deepEqual(second.refund, { currency: 'bank', amount: price.bank * .7 });
    const credit = open({ tier, currency: 'credits' }).result;
    assert.deepEqual(credit.refund, { currency: 'credits', amount: price.credits * .7 });
    const end = accountCrateSnapshot(store, id);
    assert.equal(end.bank, start.bank - price.bank * 1.3); assert.equal(end.credits, start.credits - price.credits * .3);
    assert.equal(store.account(id).credit, 200); assert.equal(store.account(id).debt, 200);
  }
});

test('earned crates and Hundredth Watch helmet backfill verified account milestones once and never create bank gold', async t => {
  const { store, id, nights, open } = await fixture(t);
  nights(120);
  const first = accountCrateSnapshot(store, id), second = accountCrateSnapshot(store, id);
  assert.deepEqual(first.earnedCrates, second.earnedCrates); assert.equal(first.earnedCrates.length, 12);
  assert.deepEqual(first.earnedCrates.map(crate => crate.tier), ['basic', 'basic', 'basic', 'rare', 'rare', 'rare', 'epic', 'epic', 'epic', 'legendary', 'legendary', 'legendary']);
  assert.ok(first.unlocks.includes('sunforged_viking_helm'));
  const [a, b] = first.earnedCrates;
  assert.equal(open({ grantId: a.id, tier: 'legendary', currency: 'bank', paid: 100000 }).result.tier, 'basic', 'earned source ignores forged purchase details');
  const duplicate = open({ grantId: b.id }).result;
  assert.deepEqual(duplicate.refund, { currency: 'credits', amount: 70 }); assert.equal(duplicate.funding, 'earned'); assert.equal(duplicate.paid, 0);
  assert.equal(store.account(id).bank, 0); assert.equal(accountCrateSnapshot(store, id).credits, 70);
  assert.equal(accountCrateSnapshot(store, id).earnedCrates.length, 10);
});

test('opening replay, disconnect recovery and changed replay payloads return the same committed result', async t => {
  const { store, directory, id, open } = await fixture(t);
  store.bank(id, 10000); const requestId = randomUUID(), first = open({ requestId }).result;
  const replay = open({ requestId, tier: 'legendary', currency: 'credits' }, 3).result;
  assert.deepEqual(replay, first); assert.equal(store.account(id).bank, 9000); assert.equal(store.crateHistory(id).length, 1);
  const reopened = new Store(directory);
  try {
    const recovered = crateAccountAction(reopened, id, { kind: 'crate_open', requestId, tier: 'basic', currency: 'bank' }, { chooseIndex() { throw new Error('Replay must not roll.'); } });
    assert.deepEqual(recovered.result, first); assert.deepEqual(recovered.crates.history[0], first); assert.equal(recovered.crates.bank, 9000);
  } finally { reopened.close(); }
});

test('transaction rollback restores deductions, unlocks, earned claims and Phoenix charges after storage failure', async t => {
  const { store, id, open, nights } = await fixture(t);
  store.bank(id, 200000); nights(100); const before = accountCrateSnapshot(store, id), save = store.saveCrateOpening;
  store.saveCrateOpening = () => { throw new Error('Simulated disk failure.'); };
  for (const [action, index] of [[{}, 0], [{ tier: 'legendary' }, 4], [{ grantId: before.earnedCrates[0].id }, 0]]) assert.throws(() => open(action, index), /disk failure/);
  store.saveCrateOpening = save;
  assert.deepEqual(accountCrateSnapshot(store, id), before);
  const result = open().result; assert.equal(result.duplicate, false); assert.equal(store.account(id).bank, 199000);
});

test('ownership, valid slots, currencies and finite balances are enforced on account actions', async t => {
  const { store, id, other, open, loadout, nights } = await fixture(t);
  store.bank(id, 10000); nights(10); const grant = accountCrateSnapshot(store, id).earnedCrates[0];
  assert.throws(() => crateAccountAction(store, other.id, { kind: 'crate_open', requestId: randomUUID(), grantId: grant.id }), /belong/);
  assert.throws(() => open({ currency: 'wallet' }), /personal bank/);
  assert.throws(() => open({ tier: '__proto__' }), /tier/);
  assert.throws(() => open({ requestId: 'x' }), /request ID/);
  assert.throws(() => loadout({ head: 'dawnsteel_helm' }), /Unlock/);
  open(); assert.throws(() => loadout({ body: 'padded_cap' }), /body/);
  assert.throws(() => loadout({ reserveEmber: 'true' }), /whether/);
  assert.throws(() => loadout({ tool: 'sword' }), /axe/);
  assert.throws(() => store.crateCredit(id, Infinity), /Invalid/);
  assert.equal(store.account(id).bank, 9000);
});

test('future loadouts deploy one bound kit per new run, preserve used durability on reconnect and forfeit gear on respawn', async t => {
  const { store, id, sim, open, loadout, start } = await fixture(t);
  store.bank(id, 200000);
  open({ tier: 'epic' }, 3); open({ tier: 'rare' }, 2); open({}, 0);
  loadout({ head: 'padded_cap', utility: 'miners_buckle', kit: 'prospectors_kit', tool: 'scythe' });
  const { village, player } = start('Equipped Run');
  assert.equal(player.crateEquipment.head, 'padded_cap'); assert.equal(player.inventory.good_food, 2); assert.equal(player.boundInventory.good_food, 2);
  assert.equal(player.durability.scythe, 150, 'starting kits keep ordinary durability even with buckle');
  player.durability.scythe = 31; player.inventory.good_food = 1; player.boundInventory.good_food = 1;
  sim.disconnect(village.id, id); sim.join(village.id, store.account(id));
  assert.equal(player.durability.scythe, 31); assert.equal(player.inventory.good_food, 1);
  loadout({}); assert.equal(player.crateEquipment.head, 'padded_cap', 'future choices do not alter current equipment');
  player.downed = true; player.hp = 0; player.respawnAvailable = true; village.clock += .7;
  sim.action(village.id, id, { kind: 'respawn' });
  assert.equal(player.crateEquipment.head, ''); assert.equal(player.inventory.good_food, 0); assert.deepEqual(player.boundInventory, {});
  sim.disconnect(village.id, id); sim.join(village.id, store.account(id));
  assert.equal(player.crateEquipment.head, ''); assert.equal(player.durability.scythe, 0);
  assert.equal(accountCrateSnapshot(store, id).run.forfeited, true); assert.ok(store.crateUnlocks(id).includes('padded_cap'));
});

test('existing residents migrate without retrospective supplies and failed first deployment does not claim grants', async t => {
  const { store, id, sim, open, loadout, start } = await fixture(t);
  store.bank(id, 2000); open({}, 3); loadout({ kit: 'hearth_ration_kit' });
  const { village, player } = start('Existing Resident');
  store.db.prepare('DELETE FROM crate_runs WHERE account_id=? AND village_id=?').run(id, village.id);
  player.inventory.food = 0; player.boundInventory = {};
  sim.disconnect(village.id, id); sim.join(village.id, store.account(id));
  assert.equal(player.inventory.food, 0); assert.equal(store.crateRun(id, village.id).loadout.kit, '');
  village.status = 'fallen'; store.saveVillage(village);
  const { id: nextId } = sim.create('Failed Deployment', store.account(id)), next = sim.villages.get(nextId), save = store.saveVillage;
  store.saveVillage = () => { throw new Error('Deployment disk failure'); };
  assert.throws(() => sim.join(nextId, store.account(id)), /disk failure/); store.saveVillage = save;
  assert.equal(next.players[id], undefined); assert.equal(store.crateRun(id, nextId), null);
  const joined = sim.join(nextId, store.account(id)); assert.equal(joined.inventory.food, 2); assert.equal(joined.wallet, 10);
});

test('Phoenix repeat drops grant real charges, stale revivals cost nothing, and failed save rolls back consumption and rescue', async t => {
  const { store, id, sim, open, loadout, start } = await fixture(t);
  store.bank(id, 300000); const a = open({ tier: 'legendary' }, 4).result, b = open({ tier: 'legendary' }, 4).result;
  for (const result of [a, b]) { assert.equal(result.chargeGranted, true); assert.equal(result.duplicate, false); assert.equal(result.refund, null); }
  assert.equal(store.crateCharges(id).available, 2); assert.ok(!store.crateUnlocks(id).includes('phoenix_ember'));
  loadout({ reserveEmber: true }); const { village, player } = start('Phoenix Watch');
  assert.equal(accountCrateSnapshot(store, id).run.phoenixAvailable, true); assert.deepEqual(store.crateCharges(id), { total: 2, available: 1, reserved: 1 });
  assert.throws(() => sim.action(village.id, id, { kind: 'phoenix_revive' }), /downed/); assert.equal(store.crateCharges(id).total, 2);
  Object.assign(player, { downed: true, hp: 0, hunger: 37, wallet: 73 }); player.inventory.iron = 14; player.durability.axe = 55;
  const before = structuredClone(player), save = store.saveVillage;
  store.saveVillage = () => { throw new Error('Phoenix disk failure'); };
  assert.throws(() => sim.action(village.id, id, { kind: 'phoenix_revive' }), /disk failure/); store.saveVillage = save;
  assert.deepEqual(player, before); assert.equal(store.crateCharges(id).total, 2); assert.equal(accountCrateSnapshot(store, id).run.phoenixAvailable, true);
  sim.action(village.id, id, { kind: 'phoenix_revive' });
  assert.equal(player.hp, Math.ceil(player.maxHp * .4)); assert.equal(player.downed, false);
  assert.deepEqual([player.hunger, player.wallet, player.inventory.iron, player.durability.axe], [37, 73, 14, 55]);
  assert.equal(player.phoenixProtectedUntil, village.clock + 3); assert.equal(store.crateCharges(id).total, 1);
  assert.throws(() => sim.action(village.id, id, { kind: 'phoenix_revive' }), /downed/);
  player.downed = true; player.hp = 0;
  assert.throws(() => sim.action(village.id, id, { kind: 'phoenix_revive' }), /No Phoenix/);
  sim.disconnect(village.id, id); sim.join(village.id, store.account(id));
  assert.equal(accountCrateSnapshot(store, id).run.phoenixAvailable, false); assert.equal(store.crateCharges(id).total, 1);
});

test('manual respawn and an ended village release an unused Ember without refreshing the same run', async t => {
  const { store, id, sim, open, loadout, start } = await fixture(t);
  store.bank(id, 100000); open({ tier: 'legendary' }, 4); loadout({ reserveEmber: true });
  const { village, player } = start('Unused Phoenix');
  player.downed = true; player.hp = 0; player.respawnAvailable = true; village.clock += .7;
  sim.action(village.id, id, { kind: 'respawn' });
  assert.equal(store.crateCharges(id).available, 1); assert.equal(accountCrateSnapshot(store, id).run.phoenixAvailable, false);
  sim.disconnect(village.id, id); sim.join(village.id, store.account(id)); assert.equal(store.crateCharges(id).reserved, 0);
  village.status = 'fallen'; store.saveVillage(village); const second = start('Next Phoenix');
  assert.equal(store.crateCharges(id).reserved, 1); assert.equal(accountCrateSnapshot(store, id).run.phoenixAvailable, true);
  second.village.status = 'fallen'; store.saveVillage(second.village);
  assert.equal(accountCrateSnapshot(store, id).charges.available, 1, 'ended run releases its unused reservation');
});

test('crate account migrations preserve existing savings, restricted loan balances and cosmetic progression', async t => {
  const { store, directory, id, nights } = await fixture(t);
  store.bank(id, 4321); store.issueCredit(id, 75); nights(5);
  const before = store.account(id), progress = store.progression(id), reopened = new Store(directory);
  try {
    accountCrateSnapshot(reopened, id);
    assert.deepEqual(reopened.account(id), before); assert.deepEqual(reopened.progression(id), progress);
    assert.equal(reopened.crateAccount(id).credits, 0);
  } finally { reopened.close(); }
});

test('live crate snapshots perform no writes or transaction acquisition', async t => {
  const { store, sim, id, start } = await fixture(t), { village } = start('Read Only Snapshot');
  const before = store.db.prepare('SELECT total_changes() AS changes').get().changes;
  const transaction = store.transaction;
  store.transaction = () => { throw new Error('Snapshot acquired a transaction.'); };
  try { for (let i = 0; i < 10; i++) assert.equal(crateSnapshot(sim, village, id).crates.nights, 0); }
  finally { store.transaction = transaction; }
  assert.equal(store.db.prepare('SELECT total_changes() AS changes').get().changes, before);
});

test('restoring an older village cannot restore forfeited kit supplies, but later purchased tools remain', async t => {
  const { store, id, sim, open, loadout, start } = await fixture(t);
  store.bank(id, 10000); open({ tier: 'rare' }, 3); loadout({ kit: 'tradesmans_kit', tool: 'axe' });
  const { village, player } = start('Stale Kit Snapshot');
  player.inventory.food += 3; // Three ordinary purchased loaves are not bound.
  const old = structuredClone(player);
  player.downed = true; player.hp = 0; player.respawnAvailable = true; village.clock += .7;
  sim.action(village.id, id, { kind: 'respawn' });
  Object.assign(player, old); sim.join(village.id, store.account(id));
  assert.equal(player.inventory.food, 3, 'only the two bound loaves are removed');
  assert.equal(player.durability.axe, 0); assert.deepEqual(player.boundInventory, {}); assert.deepEqual(player.boundKitTools, {});
  player.durability.axe = 83; player.maxDurability.axe = 100; // Normal replacement has no bound-kit marker.
  sim.disconnect(village.id, id); sim.join(village.id, store.account(id));
  assert.equal(player.durability.axe, 83);
});

test('Phoenix releases carrying links and church beds, preserves position, and refunds treatment escrow once', async t => {
  const { store, id, sim, other, open, loadout, start } = await fixture(t);
  store.bank(id, 200000); open({ tier: 'legendary' }, 4); open({ tier: 'legendary' }, 4); loadout({ reserveEmber: true });
  for (const bed of [false, true]) {
    const { village, player } = start(bed ? 'Bed Phoenix' : 'Carried Phoenix');
    const rescuer = sim.join(village.id, other), point = plotBedPoint(PLOTS.find(site => site.id === 'west-1'), 0);
    Object.assign(player, point, { downed: true, hp: 0 }); Object.assign(rescuer, point, { wallet: 100 });
    sim.action(village.id, rescuer.id, { kind: 'carryPlayer', targetId: id });
    const plot = village.plots.find(plot => plot.id === 'west-1');
    if (bed) {
      Object.assign(plot, { ownerId: rescuer.id, building: 'church', level: 1, hp: 300, maxHp: 300 }); village.clock += .7;
      sim.action(village.id, rescuer.id, { kind: 'churchTreat', plotId: plot.id, targetId: id });
      assert.equal(rescuer.wallet, 80); assert.equal(player.bedPlotId, plot.id);
    } else assert.equal(rescuer.carryingId, id);
    const position = { x: player.x, z: player.z };
    sim.action(village.id, id, { kind: 'phoenix_revive' });
    assert.deepEqual({ x: player.x, z: player.z }, position); assert.equal(player.carriedBy, null); assert.equal(rescuer.carryingId, null); assert.equal(player.bedPlotId, null);
    assert.equal(rescuer.wallet, 100); if (bed) assert.equal(plot.patients.length, 0);
    assert.throws(() => sim.action(village.id, id, { kind: 'phoenix_revive' }), /downed/); assert.equal(rescuer.wallet, 100);
    village.status = 'fallen'; store.saveVillage(village);
  }
  assert.equal(store.crateCharges(id).total, 0);
});
