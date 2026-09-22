import { createHmac, randomInt, randomUUID } from 'node:crypto';
import { PET_CATALOG, PET_CATALOG_VERSION, PET_RULES, PET_RARITIES, PET_RARITY_ODDS, PET_STAGING_MESSAGE, petIncubationRemaining, petRarityForRoll } from '../shared/pets.js';
import { BUILDINGS } from '../shared/world.js';
import { canUseBuilding } from '../shared/access.js';

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
const own = (value, key) => typeof key === 'string' && Object.hasOwn(value, key);
const snapshotCaches = new WeakMap();
const boundedSet = (map, key, value) => { map.delete(key); map.set(key, value); if (map.size > 256) map.delete(map.keys().next().value); };
function cacheFor(store, now) {
  let cache = snapshotCaches.get(store);
  if (!cache) { cache = { accounts: new Map(), visits: new Map(), checkedAt: -Infinity, dataVersion: null }; snapshotCaches.set(store, cache); }
  if (now < cache.checkedAt || now - cache.checkedAt >= 1000) {
    const version = store.db.prepare('PRAGMA data_version').get().data_version;
    if (cache.dataVersion !== null && cache.dataVersion !== version) { cache.accounts.clear(); cache.visits.clear(); }
    cache.dataVersion = version; cache.checkedAt = now;
  }
  return cache;
}
function invalidate(store, accountId, merchant = false) {
  const cache = snapshotCaches.get(store);
  cache?.accounts.delete(accountId);
  if (merchant) cache?.visits.clear();
}

export function installPetSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pet_configuration(name TEXT PRIMARY KEY,value TEXT NOT NULL);
    INSERT OR IGNORE INTO pet_configuration(name,value) VALUES('merchant_seed',lower(hex(randomblob(32))));
    CREATE TABLE IF NOT EXISTS pet_merchant_visits(
      village_id TEXT NOT NULL REFERENCES villages(id), visit_id TEXT NOT NULL,
      offered INTEGER NOT NULL CHECK(offered IN(0,1)), price INTEGER NOT NULL CHECK(price>0),
      stock INTEGER NOT NULL CHECK(stock BETWEEN 0 AND 1), PRIMARY KEY(village_id,visit_id));
    CREATE TABLE IF NOT EXISTS pet_eggs(
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), species_id TEXT NOT NULL,
      rarity TEXT NOT NULL DEFAULT 'common', catalog_version INTEGER NOT NULL, purchased_at INTEGER NOT NULL, hatch_at INTEGER NOT NULL,
      hatched_at INTEGER, CHECK(hatch_at>=purchased_at));
    CREATE INDEX IF NOT EXISTS pet_eggs_account_hatch ON pet_eggs(account_id,hatched_at,hatch_at);
    CREATE TABLE IF NOT EXISTS pet_unlocks(
      account_id TEXT NOT NULL REFERENCES accounts(id), species_id TEXT NOT NULL,
      egg_id TEXT NOT NULL REFERENCES pet_eggs(id), unlocked_at INTEGER NOT NULL,
      PRIMARY KEY(account_id,species_id));
    CREATE TABLE IF NOT EXISTS pet_accounts(
      account_id TEXT PRIMARY KEY REFERENCES accounts(id), equipped_id TEXT,
      FOREIGN KEY(account_id,equipped_id) REFERENCES pet_unlocks(account_id,species_id));
    CREATE TABLE IF NOT EXISTS pet_purchase_receipts(
      account_id TEXT NOT NULL REFERENCES accounts(id), request_id TEXT NOT NULL,
      village_id TEXT NOT NULL REFERENCES villages(id), visit_id TEXT NOT NULL,
      receipt TEXT NOT NULL, PRIMARY KEY(account_id,request_id));
    CREATE TABLE IF NOT EXISTS pet_hatches(
      egg_id TEXT PRIMARY KEY REFERENCES pet_eggs(id), account_id TEXT NOT NULL REFERENCES accounts(id),
      species_id TEXT NOT NULL, rarity TEXT NOT NULL, hatched_at INTEGER NOT NULL,
      duplicate INTEGER NOT NULL CHECK(duplicate IN(0,1)), refund_gold INTEGER NOT NULL CHECK(refund_gold>=0),
      refund_paid INTEGER NOT NULL CHECK(refund_paid IN(0,1)));
    CREATE INDEX IF NOT EXISTS pet_hatches_account_recent ON pet_hatches(account_id,hatched_at DESC);
    CREATE INDEX IF NOT EXISTS pet_hatches_pending_refunds ON pet_hatches(account_id) WHERE refund_paid=0;
  `);
  if (!db.prepare('PRAGMA table_info(pet_eggs)').all().some(column => column.name === 'rarity')) db.exec("ALTER TABLE pet_eggs ADD COLUMN rarity TEXT NOT NULL DEFAULT 'common'");
}

function settings(options = {}) {
  const catalog = options.catalog ?? PET_CATALOG, now = options.now?.() ?? Date.now();
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog) || Object.entries(catalog).some(([id, pet]) => !/^[a-z][a-z0-9_]{0,63}$/.test(id) || !pet || typeof pet.name !== 'string' || !pet.name.trim() || (pet.rarity !== undefined && !own(PET_RARITIES, pet.rarity)))) throw new Error('Invalid configured pet catalog.');
  if (!Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - PET_RULES.incubationSeconds * 1000) throw new Error('Invalid pet service clock.');
  return { catalog, now, choose: options.choose ?? randomInt, chooseRarity: options.chooseRarity ?? options.choose ?? randomInt, chooseOffer: options.chooseOffer };
}

function requireAccount(store, accountId) {
  if (!store.account(accountId)) fail('Sign in to manage your pets.', 401);
}

function hatchReady(store, accountId, now) {
  const ready = store.db.prepare('SELECT id,species_id,rarity,hatch_at FROM pet_eggs WHERE account_id=? AND hatched_at IS NULL AND hatch_at<=? ORDER BY hatch_at,id').all(accountId, now);
  const pending = store.db.prepare('SELECT 1 FROM pet_hatches WHERE account_id=? AND refund_paid=0 LIMIT 1').get(accountId);
  if (!ready.length && !pending) return;
  store.transaction(() => {
    for (const egg of ready) {
      // Another connection may have hatched the same egg since the first read.
      if (!store.db.prepare('SELECT 1 FROM pet_eggs WHERE id=? AND account_id=? AND hatched_at IS NULL').get(egg.id, accountId)) continue;
      const unlocked = store.db.prepare('INSERT OR IGNORE INTO pet_unlocks(account_id,species_id,egg_id,unlocked_at) VALUES(?,?,?,?)').run(accountId, egg.species_id, egg.id, egg.hatch_at).changes;
      store.db.prepare('INSERT INTO pet_hatches(egg_id,account_id,species_id,rarity,hatched_at,duplicate,refund_gold,refund_paid) VALUES(?,?,?,?,?,?,?,?)').run(egg.id, accountId, egg.species_id, egg.rarity, egg.hatch_at, unlocked ? 0 : 1, unlocked ? 0 : PET_RULES.duplicateRefund, unlocked ? 1 : 0);
      store.db.prepare('UPDATE pet_eggs SET hatched_at=? WHERE id=? AND account_id=? AND hatched_at IS NULL').run(egg.hatch_at, egg.id, accountId);
    }
    let bank = store.account(accountId)?.bank;
    for (const refund of store.db.prepare('SELECT egg_id,refund_gold FROM pet_hatches WHERE account_id=? AND refund_paid=0 ORDER BY hatched_at,egg_id').all(accountId)) {
      // A full bank cannot erase a refund or block a hatch. Keep the durable
      // unpaid receipt and try again once the account has room for all 1,000.
      if (!Number.isSafeInteger(bank) || bank < 0 || refund.refund_gold > Number.MAX_SAFE_INTEGER - bank) continue;
      store.bank(accountId, refund.refund_gold);
      store.db.prepare('UPDATE pet_hatches SET refund_paid=1 WHERE egg_id=? AND account_id=? AND refund_paid=0').run(refund.egg_id, accountId);
      bank += refund.refund_gold;
    }
  });
}

function accountSnapshot(store, accountId, { catalog, now }) {
  const eggRows = store.db.prepare('SELECT id,species_id,purchased_at,hatch_at FROM pet_eggs WHERE account_id=? AND hatched_at IS NULL ORDER BY purchased_at,id').all(accountId);
  const eggs = eggRows.map(row => ({ id: row.id, purchasedAt: row.purchased_at, hatchAt: row.hatch_at, remainingSeconds: petIncubationRemaining(row.hatch_at, now) }));
  const collection = store.db.prepare('SELECT species_id,unlocked_at FROM pet_unlocks WHERE account_id=? ORDER BY unlocked_at,species_id').all(accountId).map(row => ({ id: row.species_id, name: catalog[row.species_id]?.name ?? 'Companion', description: catalog[row.species_id]?.description ?? '', rarity: catalog[row.species_id]?.rarity ?? 'common', assetId: catalog[row.species_id]?.assetId ?? row.species_id, flying: catalog[row.species_id]?.flying ?? false, attack: catalog[row.species_id]?.attack ?? null, carryBonus: catalog[row.species_id]?.carryBonus ?? 0, available: own(catalog, row.species_id), unlockedAt: row.unlocked_at }));
  const equippedId = store.db.prepare('SELECT equipped_id FROM pet_accounts WHERE account_id=?').get(accountId)?.equipped_id ?? '';
  const recentHatches = store.db.prepare('SELECT * FROM pet_hatches WHERE account_id=? ORDER BY hatched_at DESC,egg_id DESC LIMIT 20').all(accountId).map(row => ({ eggId: row.egg_id, petId: row.species_id, name: catalog[row.species_id]?.name ?? 'Companion', rarity: row.rarity, assetId: catalog[row.species_id]?.assetId ?? row.species_id, hatchedAt: row.hatched_at, duplicate: Boolean(row.duplicate), refundGold: row.refund_gold, refundDestination: 'bank', refundPaid: Boolean(row.refund_paid) }));
  const pendingRefundGold = store.db.prepare('SELECT COALESCE(SUM(refund_gold),0) AS amount FROM pet_hatches WHERE account_id=? AND refund_paid=0').get(accountId).amount;
  return { enabled: Object.keys(catalog).length > 0, stagingMessage: Object.keys(catalog).length ? '' : PET_STAGING_MESSAGE, serverNow: Math.floor(now / 1000) * 1000, incubationSeconds: PET_RULES.incubationSeconds, eggs, collection, equippedId, canCollect: Object.keys(catalog).length > 0, rarityOdds: PET_RARITY_ODDS, duplicateRefund: PET_RULES.duplicateRefund, recentHatches, pendingRefundGold };
}

export function accountPetSnapshot(store, accountId, options = {}) {
  const config = settings(options), cache = cacheFor(store, config.now), cached = cache.accounts.get(accountId);
  if (cached?.catalog === config.catalog && config.now >= cached.createdAt && config.now < cached.expiresAt) {
    if (cached.missing) fail('Sign in to manage your pets.', 401);
    return cached.snapshot;
  }
  try { requireAccount(store, accountId); }
  catch (error) {
    if (error.statusCode === 401 && !store.transactionDepth) boundedSet(cache.accounts, accountId, { catalog: config.catalog, createdAt: config.now, expiresAt: (Math.floor(config.now / 1000) + 1) * 1000, missing: true });
    throw error;
  }
  hatchReady(store, accountId, config.now);
  const snapshot = accountSnapshot(store, accountId, config);
  // Never expose a cache created inside a transaction that could still roll back.
  if (!store.transactionDepth) boundedSet(cache.accounts, accountId, { catalog: config.catalog, createdAt: config.now, expiresAt: Math.min((Math.floor(config.now / 1000) + 1) * 1000, ...snapshot.eggs.map(egg => egg.hatchAt)), snapshot });
  return snapshot;
}

// Combat/weight synchronization shares the same bounded, one-second account
// cache; equipping invalidates it immediately. This reveals no private egg data.
export function equippedPet(store, accountId, options = {}) {
  if (!store?.db) return null;
  try {
    const id = accountPetSnapshot(store, accountId, options).equippedId, catalog = options.catalog ?? PET_CATALOG;
    return id && own(catalog, id) ? { id, ...catalog[id] } : null;
  } catch (error) { if (error.statusCode === 401) return null; throw error; }
}

export function petAccountAction(store, accountId, action, options = {}) {
  requireAccount(store, accountId);
  if (action?.kind !== 'pet_equip') fail('Choose a pet to equip or put away. Buy eggs from the traveling merchant in your village.');
  const config = settings(options), petId = action.petId;
  if (typeof petId !== 'string') fail('Choose one of your unlocked pets.');
  invalidate(store, accountId);
  return store.transaction(() => {
    hatchReady(store, accountId, config.now);
    if (petId && (!own(config.catalog, petId) || !store.db.prepare('SELECT 1 FROM pet_unlocks WHERE account_id=? AND species_id=?').get(accountId, petId))) fail('Unlock this pet before equipping it.');
    store.db.prepare('INSERT INTO pet_accounts(account_id,equipped_id) VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET equipped_id=excluded.equipped_id').run(accountId, petId || null);
    return { pets: accountSnapshot(store, accountId, config), message: petId ? `${config.catalog[petId].name} is now your companion.` : 'Your companion is resting.' };
  });
}

function visitId(village) {
  const merchant = village.merchant;
  return village.status === 'active' && village.phase === 'day' && merchant?.present && merchant.lastVisitDay === village.day && Number.isSafeInteger(merchant.visits) && merchant.visits > 0 ? `${merchant.lastVisitDay}:${merchant.visits}` : null;
}

function merchantVisit(store, village, config) {
  const id = visitId(village);
  if (!id || !Object.keys(config.catalog).length) return null;
  const cache = cacheFor(store, config.now), key = `${village.id}/${id}`;
  if (!store.transactionDepth && cache.visits.has(key)) return cache.visits.get(key);
  let row = store.db.prepare('SELECT * FROM pet_merchant_visits WHERE village_id=? AND visit_id=?').get(village.id, id);
  if (!row) store.transaction(() => {
    // Re-read under the write lock: opening menus in two sessions cannot reroll stock.
    row = store.db.prepare('SELECT * FROM pet_merchant_visits WHERE village_id=? AND visit_id=?').get(village.id, id);
    if (row) return;
    // A durable secret makes the roll stable even if a later purchase fails and
    // its outer village transaction rolls back the offer's first INSERT.
    const seed = store.db.prepare("SELECT value FROM pet_configuration WHERE name='merchant_seed'").get().value;
    const maximum = config.chooseOffer ? 100 : 256;
    const roll = config.chooseOffer ? config.chooseOffer(maximum) : createHmac('sha256', seed).update(`${village.id}\0${id}`).digest()[0];
    if (!Number.isInteger(roll) || roll < 0 || roll >= maximum) throw new Error('Unable to determine this merchant visit.');
    const offered = Number(roll < maximum * PET_RULES.merchantChancePercent / 100);
    store.db.prepare('INSERT INTO pet_merchant_visits(village_id,visit_id,offered,price,stock) VALUES(?,?,?,?,?)').run(village.id, id, offered, PET_RULES.eggPrice, offered ? PET_RULES.eggsPerVisit : 0);
    row = store.db.prepare('SELECT * FROM pet_merchant_visits WHERE village_id=? AND visit_id=?').get(village.id, id);
  });
  if (!store.transactionDepth) boundedSet(cache.visits, key, row);
  return row;
}

function speciesForRarity(store, accountId, catalog, rarity) {
  const claimed = new Set(store.db.prepare('SELECT species_id FROM pet_eggs WHERE account_id=? UNION SELECT species_id FROM pet_unlocks WHERE account_id=?').all(accountId, accountId).map(row => row.species_id));
  const pool = Object.keys(catalog).filter(id => (catalog[id].rarity ?? 'common') === rarity), unowned = pool.filter(id => !claimed.has(id));
  // Never search another rarity: the advertised odds stay fixed even when a
  // tier is complete. Duplicates hatch for a separately recorded bank refund.
  return unowned.length ? unowned : pool;
}

export function petVillageSnapshot(store, village, viewerId, options = {}) {
  if (!store.db || !Object.hasOwn(village.players, viewerId)) return null;
  const config = settings(options), pets = accountPetSnapshot(store, viewerId, { ...options, now: () => config.now });
  const visit = merchantVisit(store, village, config);
  const canCollect = pets.canCollect;
  return { ...pets, merchant: { present: Boolean(visitId(village)), visitId: visit?.visit_id ?? null, offered: Boolean(visit?.offered), stock: visit?.stock ?? 0, price: visit?.price ?? PET_RULES.eggPrice, canCollect, available: Boolean(visit?.stock && canCollect), message: !pets.enabled ? PET_STAGING_MESSAGE : !visit ? 'Look for an egg when the traveling merchant visits.' : !visit.offered ? 'The merchant has no egg on this visit.' : !visit.stock ? 'This visit’s egg has been sold.' : 'One mysterious egg can hatch any rarity after 30 minutes. Duplicates return 1,000 gold to your bank.' } };
}

export function petPurchaseReceipt(store, accountId, action) {
  if (!uuid(action?.requestId) || typeof action.villageId !== 'string' || typeof action.visitId !== 'string') fail('Refresh the merchant offer before buying an egg.');
  const previous = store.db.prepare('SELECT village_id,visit_id,receipt FROM pet_purchase_receipts WHERE account_id=? AND request_id=?').get(accountId, action.requestId);
  if (!previous) return null;
  if (previous.village_id !== action.villageId || previous.visit_id !== action.visitId) fail('That purchase request was already used for another visit.', 409);
  return JSON.parse(previous.receipt);
}

export function petVillageAction(sim, village, player, action, options = {}) {
  if (!['pet_buy_egg', 'pet_equip'].includes(action?.kind)) return null;
  if (!player?.online || !Object.hasOwn(village.players, player.id)) fail('Join a village first.');
  if (action.kind === 'pet_equip') return petAccountAction(sim.store, player.id, action, options).message;
  requireAccount(sim.store, player.id);
  if (!uuid(action.requestId) || typeof action.visitId !== 'string') fail('Refresh the merchant offer before buying an egg.');
  const walletBefore = player.wallet, store = sim.store;
  invalidate(store, player.id, true);
  try { return store.transaction(() => {
    const previous = petPurchaseReceipt(store, player.id, { ...action, villageId: village.id });
    if (previous) return previous.message;
    const config = settings(options);
    if (!Object.keys(config.catalog).length) fail(PET_STAGING_MESSAGE);
    if (village.status !== 'active' || player.downed || player.hp <= 0) fail('Recover before buying an egg.');
    if (!canUseBuilding(player, BUILDINGS.find(building => building.id === 'merchant'))) fail('Visit the traveling merchant to buy an egg.');
    const visit = merchantVisit(store, village, config);
    if (!visit || action.visitId !== visit.visit_id) fail('The merchant visit has changed. Check the current egg offer.');
    if (!visit.offered || !visit.stock) fail('This merchant visit has no egg left.');
    if (!Number.isSafeInteger(player.wallet) || player.wallet < visit.price) fail(`You need ${visit.price.toLocaleString('en-US')} wallet gold for this egg.`);
    const rarity = petRarityForRoll(config.chooseRarity(100)), candidates = speciesForRarity(store, player.id, config.catalog, rarity);
    if (!candidates.length) throw new Error('The configured pet catalog has no species for the selected rarity.');
    const selected = config.choose(candidates.length);
    if (!Number.isInteger(selected) || selected < 0 || selected >= candidates.length) throw new Error('Unable to select this egg.');
    const eggId = randomUUID(), hatchAt = config.now + PET_RULES.incubationSeconds * 1000;
    if (!store.db.prepare('UPDATE pet_merchant_visits SET stock=stock-1 WHERE village_id=? AND visit_id=? AND stock>0').run(village.id, visit.visit_id).changes) fail('This merchant visit’s egg was just sold.');
    store.db.prepare('INSERT INTO pet_eggs(id,account_id,species_id,rarity,catalog_version,purchased_at,hatch_at) VALUES(?,?,?,?,?,?,?)').run(eggId, player.id, candidates[selected], rarity, PET_CATALOG_VERSION, config.now, hatchAt);
    player.wallet -= visit.price;
    const message = 'Bought a mysterious egg. It will hatch in 30 minutes and stays with your account in every village.';
    const receipt = { requestId: action.requestId, eggId, paid: visit.price, purchasedAt: config.now, hatchAt, message };
    store.db.prepare('INSERT INTO pet_purchase_receipts(account_id,request_id,village_id,visit_id,receipt) VALUES(?,?,?,?,?)').run(player.id, action.requestId, village.id, visit.visit_id, JSON.stringify(receipt));
    store.saveVillage(village);
    return message;
  }); } catch (error) { player.wallet = walletBefore; throw error; }
}
