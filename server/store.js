import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { STARTER_GOLD } from '../shared/equipment.js';
const scrypt = promisify(scryptCallback);
const digest = token => createHash('sha256').update(token).digest('hex');

export class Store {
  constructor(directory) {
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(join(directory, 'emberwatch.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE COLLATE NOCASE,salt TEXT NOT NULL,password_hash TEXT NOT NULL,bank INTEGER NOT NULL DEFAULT 0 CHECK(bank>=0),starter_granted INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS villages(id TEXT PRIMARY KEY,state TEXT NOT NULL,updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS starter_grants(account_id TEXT NOT NULL REFERENCES accounts(id),village_id TEXT NOT NULL REFERENCES villages(id),PRIMARY KEY(account_id,village_id));`);
    // Account credit is restricted purchasing power, never protected savings or
    // spendable wallet gold. Migrate existing Railway databases without a reset.
    const columns = new Set(this.db.prepare('PRAGMA table_info(accounts)').all().map(column => column.name));
    for (const name of ['debt', 'credit', 'repayment_remainder']) {
      if (!columns.has(name)) this.db.exec(`ALTER TABLE accounts ADD COLUMN ${name} INTEGER NOT NULL DEFAULT 0 CHECK(${name}>=0)`);
    }
    this.transactionDepth = 0;
  }
  transaction(fn) {
    const depth = this.transactionDepth++, savepoint = `nested_${depth}`;
    try {
      this.db.exec(depth ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE');
      try { const result = fn(); this.db.exec(depth ? `RELEASE SAVEPOINT ${savepoint}` : 'COMMIT'); return result; }
      catch (error) { this.db.exec(depth ? `ROLLBACK TO SAVEPOINT ${savepoint}` : 'ROLLBACK'); if (depth) this.db.exec(`RELEASE SAVEPOINT ${savepoint}`); throw error; }
    } finally { this.transactionDepth--; }
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
  initialWallet(id, villageId = null) {
    if (villageId) {
      const result = this.db.prepare('INSERT OR IGNORE INTO starter_grants(account_id,village_id) VALUES(?,?)').run(id, villageId);
      this.db.prepare('UPDATE accounts SET starter_granted=1 WHERE id=?').run(id);
      return result.changes ? STARTER_GOLD : 0;
    }
    const account = this.account(id);
    if (account.starter_granted) return 0;
    this.db.prepare('UPDATE accounts SET starter_granted=1 WHERE id=?').run(id);
    return STARTER_GOLD;
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
  saveVillage(village) { this.db.prepare('INSERT INTO villages VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,updated=excluded.updated').run(village.id, JSON.stringify(village), Date.now()); }
  loadVillages() { return this.db.prepare('SELECT state FROM villages').all().map(row => JSON.parse(row.state)); }
  close() { this.db.close(); }
}
