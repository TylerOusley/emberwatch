import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { TEST_GOLD, TEST_ADMIN_ACCOUNT_IDS } from '../server/admin.js';

const PASSWORD = 'isolated-admin-fixture-password';
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'emberwatch-admin-store-')), opened = new Set();
  const open = (ids = []) => { const store = new Store(directory, { testAdminAccountIds: ids }); opened.add(store); return store; };
  const close = store => { store.close(); opened.delete(store); };
  t.after(async () => { for (const store of opened) store.close(); await rm(directory, { recursive: true, force: true }); });
  const seed = open();
  const first = await seed.authenticate('register', 'TylerAdmin', PASSWORD), second = await seed.authenticate('register', 'Ordinary Resident', PASSWORD);
  return { directory, open, close, seed, adminId: first.playerId, ordinaryId: second.playerId };
}

test('only a configured existing account UUID receives testing access; matching name and forged registration fields do not', async t => {
  const { seed, open, close, adminId, ordinaryId } = await fixture(t);
  assert.equal(seed.isTestAdmin(adminId), false, 'TylerAdmin is an ordinary name without its immutable UUID grant');
  assert.equal(seed.isTestAdmin(TEST_ADMIN_ACCOUNT_IDS[0]), false, 'a configured UUID must actually exist');
  close(seed);
  const configured = [adminId], store = open(configured);
  configured.push(ordinaryId);
  assert.equal(store.isTestAdmin(adminId), true); assert.equal(store.isTestAdmin(ordinaryId), false, 'constructor copies the allowlist');
  for (const candidate of ['TylerAdmin', adminId.toUpperCase(), ordinaryId, { id: adminId, admin: true }, null].filter(value => value !== adminId)) assert.equal(store.isTestAdmin(candidate), false);
  const forged = await store.authenticate('register', 'Forged Admin', PASSWORD, { id: adminId, admin: true });
  assert.notEqual(forged.playerId, adminId); assert.equal(store.isTestAdmin(forged.playerId), false);
  assert.equal(store.account(forged.playerId).bank, 0);
});

test('the initial testing bank grant persists once and does not replenish after spending, login or restart', async t => {
  const { seed, open, close, adminId, ordinaryId } = await fixture(t);
  seed.bank(adminId, 43); seed.issueCredit(adminId, 25); seed.recordSurvivedNight(adminId, 'earlier-watch', 1);
  close(seed);
  let store = open([adminId]);
  assert.equal(store.account(adminId).bank, TEST_GOLD); assert.equal(store.account(ordinaryId).bank, 0);
  assert.equal(store.account(adminId).credit, 25); assert.equal(store.account(adminId).debt, 25); assert.equal(store.progression(adminId).nights, 1);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM test_admin_bank_grants').get().count, 1);
  store.bank(adminId, -700000); close(store);
  store = open([adminId]); assert.equal(store.account(adminId).bank, TEST_GOLD - 700000);
  await store.authenticate('login', 'TylerAdmin', PASSWORD);
  assert.equal(store.account(adminId).bank, TEST_GOLD - 700000);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM test_admin_bank_grants').get().count, 1);
});

test('explicit bank refill tops up idempotently, preserves a larger balance, and denies ordinary or nonexistent accounts', async t => {
  const { seed, open, close, adminId, ordinaryId } = await fixture(t);
  close(seed); const store = open([adminId]);
  store.bank(adminId, -12345);
  assert.deepEqual(store.refillTestBank(adminId), { bank: TEST_GOLD, added: 12345 });
  assert.deepEqual(store.refillTestBank(adminId), { bank: TEST_GOLD, added: 0 });
  store.bank(adminId, 444);
  assert.deepEqual(store.refillTestBank(adminId), { bank: TEST_GOLD + 444, added: 0 });
  for (const id of [ordinaryId, randomUUID(), 'TylerAdmin']) assert.throws(() => store.refillTestBank(id), error => error.statusCode === 403 && /testing funds/.test(error.message));
  assert.equal(store.account(ordinaryId).bank, 0);
});

test('admin new-village starting wallets receive ten million once per village; ordinary and legacy grants remain ten', async t => {
  const { seed, open, close, adminId, ordinaryId } = await fixture(t);
  close(seed); const store = open([adminId]);
  assert.equal(store.initialWallet(adminId), 10, 'the legacy account-only grant remains unchanged');
  assert.equal(store.initialWallet(adminId), 0);
  for (const id of ['first-village', 'second-village']) {
    store.saveVillage({ id });
    assert.equal(store.initialWallet(adminId, id), TEST_GOLD); assert.equal(store.initialWallet(adminId, id), 0);
    assert.equal(store.initialWallet(ordinaryId, id), 10); assert.equal(store.initialWallet(ordinaryId, id), 0);
  }
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM starter_grants').get().count, 4);
  assert.throws(() => store.initialWallet(randomUUID(), 'first-village'), /Sign in/);
  assert.throws(() => store.initialWallet(randomUUID()), /Sign in/);
});

test('allowlist removal revokes refill and future admin wallets, while reauthorization does not repeat the initial bank grant', async t => {
  const { seed, open, close, adminId } = await fixture(t);
  close(seed); let store = open([adminId]); store.bank(adminId, -250); close(store);
  store = open([]); assert.equal(store.isTestAdmin(adminId), false);
  assert.throws(() => store.refillTestBank(adminId), error => error.statusCode === 403);
  store.saveVillage({ id: 'after-revocation' }); assert.equal(store.initialWallet(adminId, 'after-revocation'), 10);
  assert.equal(store.account(adminId).bank, TEST_GOLD - 250); close(store);
  store = open([adminId]); assert.equal(store.isTestAdmin(adminId), true); assert.equal(store.account(adminId).bank, TEST_GOLD - 250);
});

test('startup seeding rolls back its unique claim if updating the bank fails, so a later successful startup can grant it', async t => {
  const { directory, seed, open, close, adminId } = await fixture(t);
  seed.bank(adminId, 73);
  seed.db.exec(`CREATE TRIGGER reject_testing_seed BEFORE UPDATE OF bank ON accounts WHEN NEW.bank = 10000000 BEGIN SELECT RAISE(ABORT, 'seed write failed'); END;`);
  close(seed);
  assert.throws(() => new Store(directory, { testAdminAccountIds: [adminId] }), /seed write failed/);
  const inspector = open();
  assert.equal(inspector.account(adminId).bank, 73); assert.equal(inspector.db.prepare('SELECT COUNT(*) AS count FROM test_admin_bank_grants').get().count, 0);
  inspector.db.exec('DROP TRIGGER reject_testing_seed'); close(inspector);
  const succeeded = open([adminId]); assert.equal(succeeded.account(adminId).bank, TEST_GOLD);
  assert.equal(succeeded.db.prepare('SELECT COUNT(*) AS count FROM test_admin_bank_grants').get().count, 1);
});

test('refill participates in an outer transaction and failed wallet claims leave no partially recorded starter grant', async t => {
  const { seed, open, close, adminId } = await fixture(t);
  close(seed); const store = open([adminId]); store.bank(adminId, -29);
  assert.throws(() => store.transaction(() => { store.refillTestBank(adminId); throw new Error('village save failed'); }), /village save failed/);
  assert.equal(store.account(adminId).bank, TEST_GOLD - 29);
  store.saveVillage({ id: 'failed-wallet-claim' });
  store.db.exec(`CREATE TRIGGER reject_starter_marker BEFORE UPDATE OF starter_granted ON accounts BEGIN SELECT RAISE(ABORT, 'starter marker failed'); END;`);
  assert.throws(() => store.initialWallet(adminId, 'failed-wallet-claim'), /starter marker failed/);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM starter_grants').get().count, 0);
  assert.equal(store.account(adminId).starter_granted, 0);
  store.db.exec('DROP TRIGGER reject_starter_marker'); assert.equal(store.initialWallet(adminId, 'failed-wallet-claim'), TEST_GOLD);
});

test('admin configuration rejects names and a missing allowlisted UUID cannot create a grant or an account', async t => {
  const { directory, seed, open, close } = await fixture(t);
  close(seed);
  for (const ids of ['TylerAdmin', ['TylerAdmin'], [null], {}]) assert.throws(() => new Store(directory, { testAdminAccountIds: ids }), /exact account UUIDs/);
  const missing = randomUUID(), store = open([missing]);
  assert.equal(store.isTestAdmin(missing), false); assert.equal(store.account(missing), undefined);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM test_admin_bank_grants').get().count, 0);
});
