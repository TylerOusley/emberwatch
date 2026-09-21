import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { STARTER_GOLD } from '../shared/equipment.js';
import { freshProgression, normalizeProgression } from '../shared/progression.js';
import { emptyLoadout } from '../shared/crates.js';
import { TEST_GOLD, TEST_ADMIN_ACCOUNT_IDS } from './admin.js';
import { createTavernStats, addTavernStatsRow, tavernStatsSnapshot } from './tavern-stats.js';
import { installFeedbackSchema } from './feedback.js';
const scrypt = promisify(scryptCallback);
const digest = token => createHash('sha256').update(token).digest('hex');

export class Store {
  #testAdminAccountIds;
  #tavernStats = new Map();
  #tavernStatsReads = [];
  constructor(directory, { testAdminAccountIds = TEST_ADMIN_ACCOUNT_IDS } = {}) {
    if ((!Array.isArray(testAdminAccountIds) && !(testAdminAccountIds instanceof Set)) || [...testAdminAccountIds].some(id => typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))) throw new Error('Testing administrators must be configured using exact account UUIDs.');
    this.#testAdminAccountIds = new Set(testAdminAccountIds);
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(join(directory, 'emberwatch.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE COLLATE NOCASE,salt TEXT NOT NULL,password_hash TEXT NOT NULL,bank INTEGER NOT NULL DEFAULT 0 CHECK(bank>=0),starter_granted INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS villages(id TEXT PRIMARY KEY,state TEXT NOT NULL,updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS starter_grants(account_id TEXT NOT NULL REFERENCES accounts(id),village_id TEXT NOT NULL REFERENCES villages(id),PRIMARY KEY(account_id,village_id));
      CREATE TABLE IF NOT EXISTS account_progression(account_id TEXT PRIMARY KEY REFERENCES accounts(id),state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS watch_achievements(account_id TEXT NOT NULL REFERENCES accounts(id),village_id TEXT NOT NULL,night INTEGER NOT NULL,PRIMARY KEY(account_id,village_id,night));`);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS crate_accounts(account_id TEXT PRIMARY KEY REFERENCES accounts(id),credits INTEGER NOT NULL DEFAULT 0 CHECK(credits>=0 AND credits<=9007199254740991),loadout TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS crate_unlocks(account_id TEXT NOT NULL REFERENCES accounts(id),item_id TEXT NOT NULL,source TEXT NOT NULL,PRIMARY KEY(account_id,item_id));
      CREATE TABLE IF NOT EXISTS crate_grants(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),tier TEXT NOT NULL,milestone INTEGER NOT NULL,result_id TEXT,UNIQUE(account_id,milestone));
      CREATE TABLE IF NOT EXISTS crate_openings(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),request_id TEXT NOT NULL,result TEXT NOT NULL,created INTEGER NOT NULL,UNIQUE(account_id,request_id));
      CREATE TABLE IF NOT EXISTS crate_runs(account_id TEXT NOT NULL REFERENCES accounts(id),village_id TEXT NOT NULL REFERENCES villages(id),state TEXT NOT NULL,PRIMARY KEY(account_id,village_id));
      CREATE TABLE IF NOT EXISTS crate_charges(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),source_id TEXT NOT NULL UNIQUE,state TEXT NOT NULL CHECK(state IN ('available','reserved','consumed')),village_id TEXT);
      CREATE TABLE IF NOT EXISTS test_admin_bank_grants(account_id TEXT PRIMARY KEY REFERENCES accounts(id),granted_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS village_finance_positions(village_id TEXT NOT NULL REFERENCES villages(id),account_id TEXT NOT NULL REFERENCES accounts(id),state TEXT NOT NULL,PRIMARY KEY(village_id,account_id));
      CREATE TABLE IF NOT EXISTS village_finance_receipts(village_id TEXT NOT NULL REFERENCES villages(id),account_id TEXT NOT NULL REFERENCES accounts(id),request_id TEXT NOT NULL,kind TEXT NOT NULL,receipt TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(village_id,account_id,request_id));
      CREATE INDEX IF NOT EXISTS village_finance_receipts_tavern_account ON village_finance_receipts(account_id) WHERE kind='tavern_bet';
      CREATE INDEX IF NOT EXISTS village_finance_receipts_tavern_recent ON village_finance_receipts(village_id,account_id,created DESC) WHERE kind='tavern_bet';
      CREATE INDEX IF NOT EXISTS village_finance_receipts_investment_recent ON village_finance_receipts(village_id,account_id,created DESC) WHERE kind<>'tavern_bet';
      CREATE TABLE IF NOT EXISTS village_finance_dawns(village_id TEXT NOT NULL REFERENCES villages(id),day INTEGER NOT NULL,report TEXT NOT NULL,PRIMARY KEY(village_id,day));`);
    installFeedbackSchema(this.db);
    // Account credit is restricted purchasing power, never protected savings or
    // spendable wallet gold. Migrate existing Railway databases without a reset.
    const columns = new Set(this.db.prepare('PRAGMA table_info(accounts)').all().map(column => column.name));
    for (const name of ['debt', 'credit', 'repayment_remainder']) {
      if (!columns.has(name)) this.db.exec(`ALTER TABLE accounts ADD COLUMN ${name} INTEGER NOT NULL DEFAULT 0 CHECK(${name}>=0)`);
    }
    this.transactionDepth = 0;
    try {
      this.transaction(() => {
        for (const id of this.#testAdminAccountIds) {
          if (!this.account(id)) continue;
          const grant = this.db.prepare('INSERT OR IGNORE INTO test_admin_bank_grants(account_id,granted_at) VALUES(?,?)').run(id, Date.now());
          if (grant.changes) this.refillTestBank(id);
        }
      });
    } catch (error) { this.db.close(); throw error; }
  }
  transaction(fn) {
    const depth = this.transactionDepth++, savepoint = `nested_${depth}`, statsReads = new Set();
    this.#tavernStatsReads.push(statsReads);
    try {
      this.db.exec(depth ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE');
      try { const result = fn(); this.db.exec(depth ? `RELEASE SAVEPOINT ${savepoint}` : 'COMMIT'); return result; }
      catch (error) { for (const id of statsReads) this.#tavernStats.delete(id); this.db.exec(depth ? `ROLLBACK TO SAVEPOINT ${savepoint}` : 'ROLLBACK'); if (depth) this.db.exec(`RELEASE SAVEPOINT ${savepoint}`); throw error; }
    } finally { this.#tavernStatsReads.pop(); this.transactionDepth--; }
  }
  async authenticate(mode, name, password) {
    if (!['register', 'login'].includes(mode)) throw new Error('Choose register or login.');
    if (typeof name !== 'string' || !/^[a-zA-Z0-9_ -]{3,24}$/.test(name.trim())) throw new Error('Use a name with 3–24 letters, numbers, spaces, underscores or hyphens.');
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw new Error('Use a password between 8 and 128 characters.');
    name = name.trim();
    let account = this.db.prepare('SELECT * FROM accounts WHERE name=?').get(name);
    if (mode === 'register') {
      if (account) throw new Error('That name is already registered.');
      const salt = randomBytes(16).toString('hex');
      const hash = (await scrypt(password, salt, 64)).toString('hex');
      const id = randomUUID();
      try { this.db.prepare('INSERT INTO accounts(id,name,salt,password_hash) VALUES(?,?,?,?)').run(id, name, salt, hash); }
      catch { throw new Error('That name is already registered.'); }
      account = this.db.prepare('SELECT * FROM accounts WHERE id=?').get(id);
      this.saveProgression(id, freshProgression({ offerGuide:true }));
    } else {
      // Run the same expensive operation even for unknown account names.
      const candidate = await scrypt(password, account?.salt ?? '00000000000000000000000000000000', 64);
      const expected = account ? Buffer.from(account.password_hash, 'hex') : Buffer.alloc(64);
      if (!timingSafeEqual(candidate, expected) || !account) throw new Error('Name or password is incorrect.');
    }
    const token = randomBytes(32).toString('hex');
    this.db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
    this.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token), account.id, Date.now() + 30 * 86400000);
    return { token, playerId: account.id, name: account.name };
  }
  accountFromToken(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
    return this.db.prepare('SELECT a.id,a.name,a.bank,a.starter_granted,a.debt,a.credit FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires>?').get(digest(token), Date.now()) ?? null;
  }
  account(id) { return this.db.prepare('SELECT id,name,bank,starter_granted,debt,credit,repayment_remainder FROM accounts WHERE id=?').get(id); }
  isTestAdmin(id) { return typeof id === 'string' && this.#testAdminAccountIds.has(id) && Boolean(this.account(id)); }
  refillTestBank(id) {
    if (!this.isTestAdmin(id)) throw Object.assign(new Error('This account cannot use testing funds.'), { statusCode: 403 });
    return this.transaction(() => {
      const account = this.account(id);
      if (!Number.isSafeInteger(account?.bank) || account.bank < 0) throw new Error('Your bank balance cannot be refilled.');
      const added = Math.max(0, TEST_GOLD - account.bank);
      if (added) this.bank(id, added);
      return { bank: account.bank + added, added };
    });
  }
  initialWallet(id, villageId = null) {
    return this.transaction(() => {
      const account = this.account(id);
      if (!account) throw new Error('Sign in before claiming starting gold.');
      if (villageId) {
        const result = this.db.prepare('INSERT OR IGNORE INTO starter_grants(account_id,village_id) VALUES(?,?)').run(id, villageId);
        this.db.prepare('UPDATE accounts SET starter_granted=1 WHERE id=?').run(id);
        return result.changes ? this.isTestAdmin(id) ? TEST_GOLD : STARTER_GOLD : 0;
      }
      if (account.starter_granted) return 0;
      this.db.prepare('UPDATE accounts SET starter_granted=1 WHERE id=?').run(id);
      return STARTER_GOLD;
    });
  }
  bank(id, difference) {
    const result = this.db.prepare('UPDATE accounts SET bank=bank+? WHERE id=? AND bank+?>=0').run(difference, id, difference);
    if (!result.changes) throw new Error('Insufficient savings.');
  }
  issueCredit(id, amount, maximum = 200) {
    if (!Number.isSafeInteger(amount) || amount < 1 || !Number.isSafeInteger(maximum) || maximum < 1) throw new Error('Choose a whole-gold loan amount.');
    const result = this.db.prepare('UPDATE accounts SET debt=debt+?,credit=credit+? WHERE id=? AND debt+?<=?').run(amount, amount, id, amount, maximum);
    if (!result.changes) throw new Error(`Outstanding loans may not exceed ${maximum} gold.`);
  }
  spendCredit(id, amount) {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Invalid purchase credit amount.');
    if (!amount) return;
    const result = this.db.prepare('UPDATE accounts SET credit=credit-? WHERE id=? AND credit>=?').run(amount, id, amount);
    if (!result.changes) throw new Error('You do not have enough approved purchase credit.');
  }
  repayDebt(id, amount, remainder) {
    if (!Number.isSafeInteger(amount) || amount < 0 || (remainder !== undefined && (!Number.isSafeInteger(remainder) || remainder < 0 || remainder >= 100))) throw new Error('Invalid debt repayment.');
    const account = this.account(id);
    if (!account || amount > account.debt) throw new Error('Repayment exceeds your outstanding debt.');
    this.db.prepare('UPDATE accounts SET debt=debt-?,repayment_remainder=? WHERE id=?').run(amount, amount === account.debt ? 0 : remainder ?? account.repayment_remainder, id);
  }
  progression(id) {
    const row = this.db.prepare('SELECT state FROM account_progression WHERE account_id=?').get(id);
    if (!row) return freshProgression(); // Existing residents opt in through Help.
    try { return normalizeProgression(JSON.parse(row.state)); } catch { return freshProgression(); }
  }
  saveProgression(id, state) {
    const clean = normalizeProgression(state);
    this.db.prepare('INSERT INTO account_progression(account_id,state) VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET state=excluded.state').run(id, JSON.stringify(clean));
    return clean;
  }
  recordSurvivedNight(id, villageId, night) {
    if (typeof villageId !== 'string' || !villageId || !Number.isSafeInteger(night) || night < 1) throw new Error('Invalid survived night.');
    return this.transaction(() => {
      const result = this.db.prepare('INSERT OR IGNORE INTO watch_achievements(account_id,village_id,night) VALUES(?,?,?)').run(id, villageId, night);
      const progress = this.progression(id);
      if (result.changes) { progress.nights++; this.saveProgression(id, progress); }
      return { awarded:Boolean(result.changes), progress:this.progression(id) };
    });
  }
  crateAccount(id) {
    if (!this.account(id)) throw new Error('Sign in to view your crates.');
    const existing = this.readCrateAccount(id);
    if (existing) return existing;
    this.db.prepare('INSERT OR IGNORE INTO crate_accounts(account_id,loadout) VALUES(?,?)').run(id, JSON.stringify(emptyLoadout()));
    return this.readCrateAccount(id);
  }
  readCrateAccount(id) {
    const row = this.db.prepare('SELECT credits,loadout FROM crate_accounts WHERE account_id=?').get(id);
    return row ? { credits: row.credits, loadout: JSON.parse(row.loadout) } : null;
  }
  crateCredit(id, difference) {
    if (!Number.isSafeInteger(difference)) throw new Error('Invalid crate credit amount.');
    const account = this.crateAccount(id);
    if (!Number.isSafeInteger(account.credits + difference) || account.credits + difference < 0) throw new Error('Insufficient crate credits or credit balance is full.');
    const result = this.db.prepare('UPDATE crate_accounts SET credits=credits+? WHERE account_id=? AND credits+? BETWEEN 0 AND 9007199254740991').run(difference, id, difference);
    if (!result.changes) throw new Error('Insufficient crate credits.');
  }
  saveCrateLoadout(id, loadout) { this.crateAccount(id); this.db.prepare('UPDATE crate_accounts SET loadout=? WHERE account_id=?').run(JSON.stringify(loadout), id); }
  crateUnlocks(id) { return this.db.prepare('SELECT item_id FROM crate_unlocks WHERE account_id=? ORDER BY item_id').all(id).map(row => row.item_id); }
  unlockCrateItem(id, itemId, source) { return Boolean(this.db.prepare('INSERT OR IGNORE INTO crate_unlocks(account_id,item_id,source) VALUES(?,?,?)').run(id, itemId, source).changes); }
  crateOpening(id, requestId) { const row = this.db.prepare('SELECT result FROM crate_openings WHERE account_id=? AND request_id=?').get(id, requestId); return row ? JSON.parse(row.result) : null; }
  crateOpeningById(id, openingId) { const row = this.db.prepare('SELECT result FROM crate_openings WHERE account_id=? AND id=?').get(id, openingId); return row ? JSON.parse(row.result) : null; }
  crateHistory(id) { return this.db.prepare('SELECT result FROM crate_openings WHERE account_id=? ORDER BY created DESC,rowid DESC LIMIT 30').all(id).map(row => JSON.parse(row.result)); }
  saveCrateOpening(id, result) { this.db.prepare('INSERT INTO crate_openings(id,account_id,request_id,result,created) VALUES(?,?,?,?,?)').run(result.id, id, result.requestId, JSON.stringify(result), result.createdAt); }
  grantCrate(id, tier, milestone) { this.db.prepare('INSERT OR IGNORE INTO crate_grants(id,account_id,tier,milestone) VALUES(?,?,?,?)').run(randomUUID(), id, tier, milestone); }
  lastCrateMilestone(id) { return this.db.prepare('SELECT COALESCE(MAX(milestone),0) AS milestone FROM crate_grants WHERE account_id=?').get(id).milestone; }
  activeCrateVillage(id) {
    for (const row of this.db.prepare('SELECT id,state FROM villages').all()) { const village = JSON.parse(row.state); if (village.status === 'active' && village.players?.[id]) return row.id; }
    return null;
  }
  crateGrant(id, grantId) { return this.db.prepare('SELECT id,tier,milestone,result_id AS resultId FROM crate_grants WHERE account_id=? AND id=?').get(id, grantId) ?? null; }
  earnedCrates(id) { return this.db.prepare('SELECT id,tier,milestone FROM crate_grants WHERE account_id=? AND result_id IS NULL ORDER BY milestone').all(id); }
  openCrateGrant(id, grantId, resultId) {
    if (!this.db.prepare('UPDATE crate_grants SET result_id=? WHERE account_id=? AND id=? AND result_id IS NULL').run(resultId, id, grantId).changes) throw new Error('That earned crate has already been opened.');
  }
  crateRun(id, villageId) { const row = this.db.prepare('SELECT state FROM crate_runs WHERE account_id=? AND village_id=?').get(id, villageId); return row ? JSON.parse(row.state) : null; }
  saveCrateRun(id, villageId, state) { this.db.prepare('INSERT INTO crate_runs(account_id,village_id,state) VALUES(?,?,?) ON CONFLICT(account_id,village_id) DO UPDATE SET state=excluded.state').run(id, villageId, JSON.stringify(state)); }
  grantEmber(id, openingId) { this.db.prepare("INSERT INTO crate_charges(id,account_id,source_id,state) VALUES(?,?,?,'available')").run(randomUUID(), id, openingId); }
  crateCharges(id) {
    const rows = this.db.prepare('SELECT state,COUNT(*) AS count FROM crate_charges WHERE account_id=? GROUP BY state').all(id), counts = Object.fromEntries(rows.map(row => [row.state, row.count]));
    return { total: (counts.available ?? 0) + (counts.reserved ?? 0), available: counts.available ?? 0, reserved: counts.reserved ?? 0 };
  }
  reserveEmber(id, villageId) {
    if (this.db.prepare("SELECT id FROM crate_charges WHERE account_id=? AND state='reserved'").get(id)) return null;
    const charge = this.db.prepare("SELECT id FROM crate_charges WHERE account_id=? AND state='available' ORDER BY rowid LIMIT 1").get(id);
    if (!charge) return null;
    this.db.prepare("UPDATE crate_charges SET state='reserved',village_id=? WHERE id=? AND state='available'").run(villageId, charge.id);
    return charge.id;
  }
  emberReserved(id, villageId, chargeId) { return Boolean(this.db.prepare("SELECT id FROM crate_charges WHERE id=? AND account_id=? AND village_id=? AND state='reserved'").get(chargeId, id, villageId)); }
  consumeEmber(id, villageId, chargeId) {
    if (!this.db.prepare("UPDATE crate_charges SET state='consumed' WHERE id=? AND account_id=? AND village_id=? AND state='reserved'").run(chargeId, id, villageId).changes) throw new Error('No Phoenix Ember is reserved for this run.');
  }
  releaseEmber(id, villageId) { this.db.prepare("UPDATE crate_charges SET state='available',village_id=NULL WHERE account_id=? AND village_id=? AND state='reserved'").run(id, villageId); }
  releaseEndedEmbers(id) {
    for (const { village_id: villageId } of this.db.prepare("SELECT DISTINCT village_id FROM crate_charges WHERE account_id=? AND state='reserved'").all(id)) {
      const row = this.db.prepare('SELECT state FROM villages WHERE id=?').get(villageId), village = row ? JSON.parse(row.state) : null;
      if (village?.status === 'active' && village.keep?.hp > 0) continue;
      this.releaseEmber(id, villageId);
      const run = this.crateRun(id, villageId);
      if (run) { run.phoenixStatus = 'released'; this.saveCrateRun(id, villageId, run); }
    }
  }
  financePosition(villageId, accountId) {
    const row = this.db.prepare('SELECT state FROM village_finance_positions WHERE village_id=? AND account_id=?').get(villageId, accountId);
    return row ? JSON.parse(row.state) : { principal: 0, earnings: 0, lots: [], remainder: 0 };
  }
  financePositions(villageId) { return this.db.prepare('SELECT account_id,state FROM village_finance_positions WHERE village_id=? ORDER BY account_id').all(villageId).map(row => ({ id: row.account_id, ...JSON.parse(row.state) })); }
  saveFinancePosition(villageId, accountId, state) { this.db.prepare('INSERT INTO village_finance_positions(village_id,account_id,state) VALUES(?,?,?) ON CONFLICT(village_id,account_id) DO UPDATE SET state=excluded.state').run(villageId, accountId, JSON.stringify(state)); }
  financeReceipt(villageId, accountId, requestId) {
    const row = this.db.prepare('SELECT receipt FROM village_finance_receipts WHERE village_id=? AND account_id=? AND request_id=?').get(villageId, accountId, requestId);
    return row ? JSON.parse(row.receipt) : null;
  }
  saveFinanceReceipt(villageId, accountId, receipt) { this.db.prepare('INSERT INTO village_finance_receipts(village_id,account_id,request_id,kind,receipt,created) VALUES(?,?,?,?,?,?)').run(villageId, accountId, receipt.requestId, receipt.kind, JSON.stringify(receipt), receipt.createdAt); }
  tavernStats(villageId, accountId) {
    if (!this.account(accountId)) return null;
    let stats = this.#tavernStats.get(accountId);
    let advanced = false;
    const markRead = () => {
      if (advanced) return;
      advanced = true;
      // An inner commit is still provisional until every enclosing transaction
      // commits. Unchanged cache reads never need rollback invalidation.
      for (const reads of this.#tavernStatsReads) reads.add(accountId);
    };
    if (!stats) { stats = createTavernStats(); markRead(); }
    // Receipts are append-only. Load historical records once, then read only
    // later rowids using the account index, including writes from other Store
    // connections. Rollback evicts only cursors advanced in that transaction.
    const rows = this.db.prepare("SELECT rowid,village_id,receipt FROM village_finance_receipts WHERE account_id=? AND kind='tavern_bet' AND rowid>? ORDER BY rowid");
    rows.setReadBigInts(true);
    for (const row of rows.iterate(accountId, stats.cursor)) { markRead(); addTavernStatsRow(stats, row); }
    this.#tavernStats.delete(accountId); this.#tavernStats.set(accountId, stats);
    if (this.#tavernStats.size > 256) this.#tavernStats.delete(this.#tavernStats.keys().next().value);
    return tavernStatsSnapshot(stats, villageId);
  }
  financeReceipts(villageId, accountId, tavern = false) {
    const comparison = tavern ? '=' : '<>';
    return this.db.prepare(`SELECT receipt FROM village_finance_receipts WHERE village_id=? AND account_id=? AND kind ${comparison} 'tavern_bet' ORDER BY created DESC,rowid DESC LIMIT 20`).all(villageId, accountId).map(row => JSON.parse(row.receipt));
  }
  financeDawn(villageId, day) { const row = this.db.prepare('SELECT report FROM village_finance_dawns WHERE village_id=? AND day=?').get(villageId, day); return row ? JSON.parse(row.report) : null; }
  latestFinanceDawn(villageId) { const row = this.db.prepare('SELECT report FROM village_finance_dawns WHERE village_id=? ORDER BY day DESC LIMIT 1').get(villageId); return row ? JSON.parse(row.report) : null; }
  saveFinanceDawn(villageId, day, report) { this.db.prepare('INSERT INTO village_finance_dawns(village_id,day,report) VALUES(?,?,?)').run(villageId, day, JSON.stringify(report)); }
  saveVillage(village) { this.db.prepare('INSERT INTO villages VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,updated=excluded.updated').run(village.id, JSON.stringify(village), Date.now()); }
  loadVillages() { return this.db.prepare('SELECT state FROM villages').all().map(row => JSON.parse(row.state)); }
  close() { this.db.close(); }
}
