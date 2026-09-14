import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
const digest = token => createHash('sha256').update(token).digest('hex');

export class Store {
  constructor(directory) {
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(join(directory, 'emberwatch.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE COLLATE NOCASE,salt TEXT NOT NULL,password_hash TEXT NOT NULL,bank INTEGER NOT NULL DEFAULT 0 CHECK(bank>=0),starter_granted INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS villages(id TEXT PRIMARY KEY,state TEXT NOT NULL,updated INTEGER NOT NULL);`);
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
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
    return this.db.prepare('SELECT a.id,a.name,a.bank,a.starter_granted FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires>?').get(digest(token), Date.now()) ?? null;
  }
  account(id) { return this.db.prepare('SELECT id,name,bank,starter_granted FROM accounts WHERE id=?').get(id); }
  initialWallet(id) {
    const account = this.account(id);
    if (account.starter_granted) return 0;
    this.db.prepare('UPDATE accounts SET starter_granted=1 WHERE id=?').run(id);
    return 50;
  }
  bank(id, difference) {
    const result = this.db.prepare('UPDATE accounts SET bank=bank+? WHERE id=? AND bank+?>=0').run(difference, id, difference);
    if (!result.changes) throw new Error('Insufficient savings.');
  }
  saveVillage(village) { this.db.prepare('INSERT INTO villages VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,updated=excluded.updated').run(village.id, JSON.stringify(village), Date.now()); }
  loadVillages() { return this.db.prepare('SELECT state FROM villages').all().map(row => JSON.parse(row.state)); }
  close() { this.db.close(); }
}
