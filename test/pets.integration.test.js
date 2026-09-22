import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createApp } from '../server/index.js';
import { Store } from '../server/store.js';
import { accountPetSnapshot, petAccountAction, petVillageAction, petVillageSnapshot, equippedPet } from '../server/pets.js';
import { PET_CATALOG, PET_RULES, PET_RARITY_ODDS, petRarityForRoll } from '../shared/pets.js';
import { BUILDINGS } from '../shared/world.js';
import { buildingEntrance } from '../shared/access.js';

// These are deliberately test-only species, never advertised as finished pets.
const catalog = { fixture_fox: { name: 'Fixture Fox', description: 'A test companion.' }, fixture_owl: { name: 'Fixture Owl', description: 'Another test companion.' } };
async function fixture(t, extra = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'emberwatch-pets-'));
  let now = 1700000000000, app;
  const options = { catalog, now: () => now, choose: () => 0, chooseOffer: () => 0, ...extra };
  async function start() {
    app = createApp({ dataDir, autoTick: false, pets: options });
    app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  }
  await start();
  const alice = await app.store.authenticate('register', 'Pet Keeper Alice', 'pet-test-password'), bob = await app.store.authenticate('register', 'Pet Keeper Bob', 'pet-test-password');
  const villageId = app.simulation.create('Pet Test Watch', app.store.account(alice.playerId)).id;
  app.simulation.join(villageId, app.store.account(alice.playerId)); app.simulation.join(villageId, app.store.account(bob.playerId));
  const village = () => app.simulation.villages.get(villageId);
  function prepareVisit(day = 3, visits = 1) {
    const v = village(); Object.assign(v, { day, phase: 'day' }); Object.assign(v.merchant, { present: true, lastVisitDay: day, visits });
    for (const player of Object.values(v.players)) Object.assign(player, buildingEntrance(BUILDINGS.find(building => building.id === 'merchant')), { wallet: 20000, online: true });
    app.store.saveVillage(v);
  }
  prepareVisit();
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  const snapshot = (session = alice) => petVillageSnapshot(app.store, village(), session.playerId, options);
  const buy = (session = alice, body = {}) => petVillageAction(app.simulation, village(), village().players[session.playerId], { kind: 'pet_buy_egg', requestId: randomUUID(), visitId: snapshot(session).merchant.visitId, ...body }, options);
  async function api(path = '/api/pets', session = alice, body, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, headers: response.headers, data: await response.json() };
  }
  return { get app() { return app; }, get now() { return now; }, dataDir, options, village, prepareVisit, snapshot, buy, api, alice, bob, advance(ms) { now += ms; }, async restart() { await app.close(); await start(); } };
}

test('an explicitly disabled catalog never takes gold or creates placeholder pets', async t => {
  const f = await fixture(t, { catalog: {} }), p = f.village().players[f.alice.playerId];
  const before = p.wallet, snapshot = f.snapshot();
  assert.equal(snapshot.enabled, false); assert.deepEqual(snapshot.eggs, []); assert.deepEqual(snapshot.collection, []); assert.equal(snapshot.merchant.available, false);
  assert.match(snapshot.stagingMessage, /artwork are selected/);
  assert.throws(() => f.buy(f.alice, { visitId: '3:1' }), /being prepared/); assert.equal(p.wallet, before);
  assert.equal(f.app.store.db.prepare('SELECT count(*) AS n FROM pet_eggs').get().n, 0);
  assert.equal(f.app.store.db.prepare('SELECT count(*) AS n FROM pet_merchant_visits').get().n, 0);
});

test('merchant rolls exactly once per visit across reopen and restart, with no egg at night', async t => {
  let rolls = 0;
  const f = await fixture(t, { chooseOffer: () => { rolls++; return 24; } });
  const first = f.snapshot().merchant;
  assert.equal(first.available, true); assert.equal(first.stock, 1); assert.equal(first.price, 5000);
  for (let i = 0; i < 20; i++) assert.deepEqual(f.snapshot().merchant, first);
  assert.equal(rolls, 1);
  await f.restart(); assert.deepEqual(f.snapshot().merchant, first); assert.equal(rolls, 1);
  f.village().phase = 'night'; assert.equal(f.snapshot().merchant.present, false); assert.equal(f.snapshot().merchant.available, false);
  f.prepareVisit(5, 2); f.snapshot(); assert.equal(rolls, 2);
});

test('25 percent stock boundary is authoritative and failed purchases cannot reroll a visit', async t => {
  const f = await fixture(t, { chooseOffer: () => 25 });
  assert.equal(f.snapshot().merchant.offered, false);
  f.options.chooseOffer = () => 0;
  assert.equal(f.snapshot().merchant.offered, false); assert.throws(() => f.buy(), /no egg left/);
  assert.equal(f.village().players[f.alice.playerId].wallet, 20000);
  f.prepareVisit(5, 2); assert.equal(f.snapshot().merchant.offered, true);
});

test('one shared egg goes to one purchaser; retries cannot duplicate debit or reroll the species', async t => {
  const f = await fixture(t), requestId = randomUUID(), p = f.village().players[f.alice.playerId];
  const action = { requestId, visitId: '3:1', price: 0, speciesId: 'fixture_owl', accountId: f.bob.playerId };
  const message = f.buy(f.alice, action);
  assert.match(message, /30 minutes/); assert.equal(p.wallet, 15000); assert.equal(f.snapshot().merchant.stock, 0);
  for (let i = 0; i < 10; i++) assert.equal(f.buy(f.alice, action), message);
  assert.equal(p.wallet, 15000); assert.equal(f.snapshot().eggs.length, 1); assert.deepEqual(f.snapshot(f.bob).eggs, []);
  assert.equal(f.snapshot().eggs[0].speciesId, undefined, 'the surprise species is not exposed before hatching');
  assert.throws(() => f.buy(f.bob), /no egg left/); assert.equal(f.village().players[f.bob.playerId].wallet, 20000);
  assert.throws(() => f.buy(f.alice, { ...action, visitId: '5:2' }), /already used/);
  const saved = f.app.store.db.prepare('SELECT species_id FROM pet_eggs WHERE account_id=?').get(f.alice.playerId);
  assert.equal(saved.species_id, 'fixture_fox', 'client choice and price are ignored');
});

test('purchase validates proximity, live visit, funds, alive state and request IDs before spending', async t => {
  const f = await fixture(t), p = f.village().players[f.alice.playerId], position = { x: p.x, z: p.z };
  p.x = 0; p.z = 4; assert.throws(() => f.buy(), /Visit the traveling merchant/); Object.assign(p, position);
  p.wallet = 4999; assert.throws(() => f.buy(), /5,000 wallet gold/); p.wallet = 20000;
  p.downed = true; assert.throws(() => f.buy(), /Recover/); p.downed = false;
  assert.throws(() => f.buy(f.alice, { requestId: 'not-a-uuid' }), /Refresh/);
  assert.throws(() => f.buy(f.alice, { visitId: '1:0' }), /visit has changed/);
  f.village().phase = 'night'; assert.throws(() => f.buy(f.alice, { visitId: '3:1' }), /visit has changed/);
  assert.equal(p.wallet, 20000); assert.equal(f.app.store.db.prepare('SELECT count(*) AS n FROM pet_eggs').get().n, 0);
});

test('failed receipt or village persistence rolls back wallet, egg and stock together', async t => {
  const f = await fixture(t), p = f.village().players[f.alice.playerId]; f.snapshot();
  f.app.store.db.exec("CREATE TRIGGER fail_pet_receipt BEFORE INSERT ON pet_purchase_receipts BEGIN SELECT RAISE(ABORT,'save failed'); END;");
  assert.throws(() => f.buy(), /save failed/); assert.equal(p.wallet, 20000); assert.equal(f.snapshot().merchant.stock, 1); assert.deepEqual(f.snapshot().eggs, []);
  f.app.store.db.exec('DROP TRIGGER fail_pet_receipt');
  const save = f.app.store.saveVillage; f.app.store.saveVillage = () => { throw new Error('village save failed'); };
  assert.throws(() => f.buy(), /village save failed/); f.app.store.saveVillage = save;
  assert.equal(p.wallet, 20000); assert.equal(f.snapshot().merchant.stock, 1); assert.deepEqual(f.snapshot().eggs, []);
  assert.equal(f.app.store.db.prepare('SELECT count(*) AS n FROM pet_purchase_receipts').get().n, 0);
  f.buy(); assert.equal(p.wallet, 15000);
});

test('eggs hatch once after exactly 30 real minutes including logout and server restart', async t => {
  const f = await fixture(t); f.buy();
  const egg = f.snapshot().eggs[0]; assert.equal(egg.hatchAt - egg.purchasedAt, PET_RULES.incubationSeconds * 1000);
  f.advance(1799999); assert.equal(f.snapshot().eggs[0].remainingSeconds, 1); assert.equal(f.snapshot().collection.length, 0);
  f.village().players[f.alice.playerId].online = false;
  await f.restart(); f.advance(1);
  const hatched = accountPetSnapshot(f.app.store, f.alice.playerId, f.options);
  assert.equal(hatched.eggs.length, 0); assert.equal(hatched.collection.length, 1); assert.equal(hatched.collection[0].id, 'fixture_fox'); assert.equal(hatched.collection[0].unlockedAt, egg.hatchAt);
  for (let i = 0; i < 10; i++) assert.equal(accountPetSnapshot(f.app.store, f.alice.playerId, f.options).collection.length, 1);
  assert.equal(f.app.store.db.prepare('SELECT count(*) AS n FROM pet_unlocks').get().n, 1);
});

test('account collection and equipped pet survive village loss, a new village, respawn data loss and restart', async t => {
  const f = await fixture(t); f.buy(); f.advance(1800000);
  const equipped = petAccountAction(f.app.store, f.alice.playerId, { kind: 'pet_equip', petId: 'fixture_fox' }, f.options);
  assert.equal(equipped.pets.equippedId, 'fixture_fox');
  f.village().players[f.alice.playerId].inventory = {}; f.village().status = 'fallen'; f.app.store.saveVillage(f.village());
  const newId = f.app.simulation.create('Pet Second Watch', f.app.store.account(f.alice.playerId)).id;
  f.app.simulation.join(newId, f.app.store.account(f.alice.playerId));
  assert.equal(petVillageSnapshot(f.app.store, f.app.simulation.villages.get(newId), f.alice.playerId, f.options).equippedId, 'fixture_fox');
  await f.restart(); assert.equal(accountPetSnapshot(f.app.store, f.alice.playerId, f.options).equippedId, 'fixture_fox');
  assert.equal(petAccountAction(f.app.store, f.alice.playerId, { kind: 'pet_equip', petId: '' }, f.options).pets.equippedId, '');
});

test('players cannot equip locked or another account pets and same-rarity eggs prefer unclaimed species', async t => {
  const f = await fixture(t); f.buy();
  assert.throws(() => petAccountAction(f.app.store, f.alice.playerId, { kind: 'pet_equip', petId: 'fixture_fox' }, f.options), /Unlock/);
  f.prepareVisit(5, 2); f.buy();
  const species = f.app.store.db.prepare('SELECT species_id FROM pet_eggs WHERE account_id=? ORDER BY species_id').all(f.alice.playerId).map(row => row.species_id);
  assert.deepEqual(species, ['fixture_fox', 'fixture_owl']);
  f.prepareVisit(7, 3); assert.equal(f.snapshot().merchant.available, true); f.buy();
  f.advance(1800000);
  assert.throws(() => petAccountAction(f.app.store, f.bob.playerId, { kind: 'pet_equip', petId: 'fixture_fox', accountId: f.alice.playerId }, f.options), /Unlock/);
  assert.throws(() => petAccountAction(f.app.store, f.alice.playerId, { kind: 'pet_equip', petId: '__proto__' }, f.options), /Unlock/);
  assert.equal(f.snapshot(f.bob).collection.length, 0);
});

test('pet account API authenticates, protects private collections, and rejects egg buying without a village offer', async t => {
  const f = await fixture(t);
  assert.equal((await f.api('/api/pets', null)).status, 401);
  assert.equal((await f.api('/api/pets/action', null, { kind: 'pet_equip', petId: '' })).status, 401);
  assert.equal((await f.api('/api/pets', f.alice, {}, 'DELETE')).status, 405);
  assert.equal((await f.api('/api/pets/action', f.alice, { kind: 'pet_buy_egg', requestId: randomUUID() })).status, 400);
  f.buy(); f.advance(1800000);
  const mine = await f.api(), theirs = await f.api('/api/pets?accountId=' + f.alice.playerId, f.bob);
  assert.equal(mine.status, 200); assert.equal(mine.data.pets.collection.length, 1); assert.equal(theirs.data.pets.collection.length, 0); assert.equal(mine.headers.get('cache-control'), 'no-store');
  const saved = await f.api('/api/pets/action', f.alice, { kind: 'pet_equip', petId: 'fixture_fox', accountId: f.bob.playerId });
  assert.equal(saved.status, 200); assert.equal(saved.data.pets.equippedId, 'fixture_fox');
  assert.equal((await f.api('/api/pets/action', f.bob, { kind: 'pet_equip', petId: 'fixture_fox', accountId: f.alice.playerId })).status, 400);
});

test('failed hatching or equip writes return no false success and retry preserves the original egg', async t => {
  const f = await fixture(t); f.buy(); f.advance(1800000);
  f.app.store.db.exec("CREATE TRIGGER fail_pet_hatch BEFORE INSERT ON pet_unlocks BEGIN SELECT RAISE(ABORT,'private hatch detail'); END;");
  const failed = await f.api(); assert.equal(failed.status, 500); assert.doesNotMatch(failed.data.error, /private hatch detail/);
  assert.equal(f.app.store.db.prepare('SELECT hatched_at FROM pet_eggs WHERE account_id=?').get(f.alice.playerId).hatched_at, null);
  f.app.store.db.exec('DROP TRIGGER fail_pet_hatch'); assert.equal((await f.api()).data.pets.collection.length, 1);
  f.app.store.db.exec("CREATE TRIGGER fail_pet_equip BEFORE INSERT ON pet_accounts BEGIN SELECT RAISE(ABORT,'private equip detail'); END;");
  const equip = await f.api('/api/pets/action', f.alice, { kind: 'pet_equip', petId: 'fixture_fox' });
  assert.equal(equip.status, 500); assert.doesNotMatch(equip.data.error, /private equip detail/); assert.equal((await f.api()).data.pets.equippedId, '');
  f.app.store.db.exec('DROP TRIGGER fail_pet_equip');
});

test('default merchant secret keeps an uncommitted visit roll identical after rollback and restart', async t => {
  const f = await fixture(t, { chooseOffer: undefined });
  let first;
  assert.throws(() => f.app.store.transaction(() => { first = f.snapshot().merchant.offered; throw new Error('rollback'); }), /rollback/);
  assert.equal(f.app.store.db.prepare('SELECT count(*) AS n FROM pet_merchant_visits').get().n, 0);
  await f.restart(); assert.equal(f.snapshot().merchant.offered, first);
});

test('hundreds of routine village snapshots reuse bounded reads and stable server time', async t => {
  const f = await fixture(t);
  const prepare = f.app.store.db.prepare.bind(f.app.store.db); let reads = 0;
  f.app.store.db.prepare = sql => { reads++; return prepare(sql); };
  f.snapshot(); const initial = reads, firstNow = f.snapshot().serverNow;
  for (let i = 0; i < 200; i++) { f.advance(1); assert.equal(f.snapshot().serverNow, firstNow); }
  assert.equal(reads, initial, 'active catalog broadcasts reuse account and merchant snapshots');
  f.advance(1000); f.snapshot(); assert.ok(reads - initial <= 10, 'one bounded account refresh after a second');
  f.options.catalog = {}; f.snapshot(); const disabled = reads;
  for (let i = 0; i < 200; i++) f.snapshot();
  assert.equal(reads, disabled, 'default disabled catalog performs no routine broadcast queries');
});

test('snapshot cache sees another database connection changes within one second', async t => {
  const f = await fixture(t); f.buy(); f.advance(1800000); assert.equal(f.snapshot().equippedId, '');
  const second = new Store(f.dataDir); t.after(() => second.close());
  petAccountAction(second, f.alice.playerId, { kind: 'pet_equip', petId: 'fixture_fox' }, f.options);
  f.advance(1000); assert.equal(f.snapshot().equippedId, 'fixture_fox');
});

test('HTTP concurrent purchases have one receipt and recover after disconnect, downing, movement or restart', async t => {
  const f = await fixture(t), p = f.village().players[f.alice.playerId];
  const body = { kind: 'pet_buy_egg', villageId: f.village().id, visitId: f.snapshot().merchant.visitId, requestId: randomUUID() };
  const replies = await Promise.all(Array.from({ length: 6 }, () => f.api('/api/pets/action', f.alice, body)));
  for (const reply of replies) assert.equal(reply.status, 200, JSON.stringify(reply.data));
  assert.equal(p.wallet, 15000); assert.equal(new Set(replies.map(reply => reply.data.result.eggId)).size, 1);
  assert.equal(replies[0].data.requestId, body.requestId);
  Object.assign(p, { online: false, downed: true, hp: 0, x: 0, z: 0, mountedHorseId: 'test-horse' }); f.village().status = 'fallen';
  const recovered = await f.api('/api/pets/action', f.alice, body);
  assert.equal(recovered.status, 200); assert.deepEqual(recovered.data.result, replies[0].data.result); assert.equal(p.wallet, 15000);
  await f.restart(); assert.equal((await f.api('/api/pets/action', f.alice, body)).status, 200);
  assert.equal((await f.api('/api/pets/action', f.alice, { ...body, visitId: '9:4' })).status, 409);
  assert.equal((await f.api('/api/pets/action', f.bob, { ...body, accountId: f.alice.playerId })).status, 400);
});

test('different players racing the same HTTP egg stock produce only one paid egg', async t => {
  const f = await fixture(t), body = { kind: 'pet_buy_egg', villageId: f.village().id, visitId: f.snapshot().merchant.visitId };
  const replies = await Promise.all([f.api('/api/pets/action', f.alice, { ...body, requestId: randomUUID() }), f.api('/api/pets/action', f.bob, { ...body, requestId: randomUUID() })]);
  assert.deepEqual(replies.map(reply => reply.status).sort(), [200, 400]);
  assert.equal(f.app.store.db.prepare('SELECT count(*) AS n FROM pet_eggs').get().n, 1);
  assert.equal(f.village().players[f.alice.playerId].wallet + f.village().players[f.bob.playerId].wallet, 35000);
});

test('pet HTTP gameplay rejections are definite 400 errors without a charge or receipt', async t => {
  const f = await fixture(t), player = f.village().players[f.alice.playerId];
  const body = { kind: 'pet_buy_egg', villageId: f.village().id, visitId: f.snapshot().merchant.visitId, requestId: randomUUID() };
  for (const [field, value, message] of [['downed', true, /You are downed/], ['mountedHorseId', 'fixture-horse', /Dismount/], ['bedPlotId', 'fixture-bed', /Leave your church bed/]]) {
    player[field] = value;
    const rejected = await f.api('/api/pets/action', f.alice, body);
    assert.equal(rejected.status, 400); assert.match(rejected.data.error, message);
    delete player[field];
  }
  f.village().status = 'fallen';
  const fallen = await f.api('/api/pets/action', f.alice, body);
  assert.equal(fallen.status, 400); assert.match(fallen.data.error, /keep has fallen/);
  assert.equal(player.wallet, 20000);
  assert.equal(f.app.store.db.prepare('SELECT count(*) AS n FROM pet_purchase_receipts').get().n, 0);
  assert.equal(f.app.store.db.prepare('SELECT count(*) AS n FROM pet_eggs').get().n, 0);
  f.village().status = 'active';
  const purchased = await f.api('/api/pets/action', f.alice, body);
  assert.equal(purchased.status, 200); assert.equal(player.wallet, 15000);
});

test('pet HTTP persistence and post-commit response failures remain retryable 500 errors', async t => {
  const f = await fixture(t), player = f.village().players[f.alice.playerId];
  const body = { kind: 'pet_buy_egg', villageId: f.village().id, visitId: f.snapshot().merchant.visitId, requestId: randomUUID() };
  f.app.store.db.exec("CREATE TRIGGER fail_pet_receipt_api BEFORE INSERT ON pet_purchase_receipts BEGIN SELECT RAISE(ABORT,'private persistence detail'); END;");
  const failed = await f.api('/api/pets/action', f.alice, body);
  assert.equal(failed.status, 500); assert.doesNotMatch(failed.data.error, /private persistence detail/);
  assert.equal(player.wallet, 20000); assert.equal(f.snapshot().merchant.stock, 1);
  assert.equal(f.app.store.db.prepare('SELECT count(*) AS n FROM pet_purchase_receipts').get().n, 0);
  f.app.store.db.exec('DROP TRIGGER fail_pet_receipt_api');

  const prepare = f.app.store.db.prepare.bind(f.app.store.db);
  f.app.store.db.prepare = sql => {
    if (sql.startsWith('SELECT id,species_id,purchased_at') && !f.app.store.transactionDepth && prepare('SELECT count(*) AS n FROM pet_purchase_receipts').get().n > 0) throw new Error('private response read detail');
    return prepare(sql);
  };
  const uncertain = await f.api('/api/pets/action', f.alice, body);
  f.app.store.db.prepare = prepare;
  assert.equal(uncertain.status, 500); assert.doesNotMatch(uncertain.data.error, /private response read detail/);
  assert.equal(player.wallet, 15000, 'the purchase committed before response loading failed');
  assert.equal(f.app.store.db.prepare('SELECT count(*) AS n FROM pet_purchase_receipts').get().n, 1);
  const recovered = await f.api('/api/pets/action', f.alice, body);
  assert.equal(recovered.status, 200); assert.equal(recovered.data.requestId, body.requestId);
  assert.equal(player.wallet, 15000); assert.equal(f.app.store.db.prepare('SELECT count(*) AS n FROM pet_eggs').get().n, 1);
});

test('approved catalog contains all thirteen species and exactly one hundred fixed rarity buckets', async t => {
  assert.equal(Object.keys(PET_CATALOG).length, 13);
  assert.deepEqual(PET_RARITY_ODDS, { common: 38, uncommon: 30, rare: 20, epic: 10, legendary: 2 });
  const counts = {};
  for (let roll = 0; roll < 100; roll++) { const rarity = petRarityForRoll(roll); counts[rarity] = (counts[rarity] ?? 0) + 1; }
  assert.deepEqual(counts, PET_RARITY_ODDS);
  for (const [roll, rarity] of [[0, 'common'], [37, 'common'], [38, 'uncommon'], [67, 'uncommon'], [68, 'rare'], [87, 'rare'], [88, 'epic'], [97, 'epic'], [98, 'legendary'], [99, 'legendary']]) assert.equal(petRarityForRoll(roll), rarity);
  for (const bad of [-1, 100, 0.5, NaN, Infinity, '38']) assert.throws(() => petRarityForRoll(bad), /whole number/);
  assert.equal(PET_CATALOG.rabbit.carryBonus, .2); assert.equal(PET_CATALOG.marmot.carryBonus, .15); assert.equal(PET_CATALOG.squirrel.carryBonus, .25);
  for (const [id, pet] of Object.entries(PET_CATALOG)) {
    assert.equal(pet.assetId, id); assert.ok(pet.name && pet.description);
    if (pet.attack) { assert.equal(pet.attack.cooldown, 2); assert.equal(pet.attack.range, pet.attack.kind === 'ranged' ? 10 : pet.flying ? 2.7 : 2.2); }
  }
  assert.equal(PET_CATALOG.vampire_bat.attack.healOnHit, 2); assert.equal(PET_CATALOG.dragon.flying, false);
  const f = await fixture(t, { catalog: PET_CATALOG, chooseRarity: () => 0 });
  assert.equal(f.snapshot().enabled, true); assert.equal(f.snapshot().merchant.available, true);
  f.buy(); f.advance(1800000); const hatched = f.snapshot();
  assert.equal(hatched.collection[0].id, 'rabbit'); assert.equal(hatched.collection[0].rarity, 'common'); assert.equal(hatched.collection[0].assetId, 'rabbit');
  const equipped = await f.api('/api/pets/action', f.alice, { kind: 'pet_equip', petId: 'rabbit' });
  assert.equal(equipped.status, 200); assert.equal(f.village().players[f.alice.playerId].petSpeciesId, 'rabbit', 'REST equipment synchronizes active village carry metadata immediately');
  assert.deepEqual(equippedPet(f.app.store, f.alice.playerId, f.options), { id: 'rabbit', ...PET_CATALOG.rabbit });
});

test('rarity-first purchases preserve exact odds even after every species is unlocked', async t => {
  let roll = 0;
  const f = await fixture(t, { catalog: PET_CATALOG, chooseRarity: () => roll });
  for (const [speciesId, pet] of Object.entries(PET_CATALOG)) {
    const eggId = randomUUID();
    f.app.store.db.prepare('INSERT INTO pet_eggs(id,account_id,species_id,rarity,catalog_version,purchased_at,hatch_at,hatched_at) VALUES(?,?,?,?,?,?,?,?)').run(eggId, f.alice.playerId, speciesId, pet.rarity, 2, f.now - 1800000, f.now, f.now);
    f.app.store.db.prepare('INSERT INTO pet_unlocks(account_id,species_id,egg_id,unlocked_at) VALUES(?,?,?,?)').run(f.alice.playerId, speciesId, eggId, f.now);
  }
  for (roll = 0; roll < 100; roll++) {
    f.prepareVisit(3 + roll * 2, roll + 1);
    assert.equal(f.snapshot().merchant.available, true, 'complete collectors may still buy the one egg type');
    f.buy();
  }
  const eggs = f.app.store.db.prepare('SELECT species_id,rarity FROM pet_eggs WHERE account_id=? AND hatched_at IS NULL').all(f.alice.playerId), counts = {};
  for (const egg of eggs) { assert.equal(PET_CATALOG[egg.species_id].rarity, egg.rarity); counts[egg.rarity] = (counts[egg.rarity] ?? 0) + 1; }
  assert.deepEqual(counts, PET_RARITY_ODDS);
  assert.equal(f.snapshot().eggs.length, 100); assert.equal(f.snapshot().eggs[0].rarity, undefined);
  assert.equal(f.snapshot(f.bob).eggs.length, 0);
});

test('unowned preference stays inside the rolled tier and never upgrades a completed tier', async t => {
  let roll = 0;
  const f = await fixture(t, { catalog: PET_CATALOG, chooseRarity: () => roll });
  for (let i = 0; i < 5; i++) { f.prepareVisit(3 + i * 2, i + 1); f.buy(); }
  const commons = f.app.store.db.prepare('SELECT species_id,rarity FROM pet_eggs WHERE account_id=? ORDER BY rowid').all(f.alice.playerId);
  assert.equal(new Set(commons.slice(0, 4).map(egg => egg.species_id)).size, 4);
  assert.ok(commons.every(egg => egg.rarity === 'common'));
  assert.equal(commons[4].species_id, 'rabbit', 'the fifth common roll is a common duplicate');
  roll = 98; f.prepareVisit(13, 6); f.buy();
  const legendary = f.app.store.db.prepare('SELECT species_id,rarity FROM pet_eggs WHERE account_id=? ORDER BY rowid DESC LIMIT 1').get(f.alice.playerId);
  assert.equal(legendary.rarity, 'legendary'); assert.equal(legendary.species_id, 'dragon');
});

test('duplicate hatch refunds exactly one thousand bank gold once across reads, connections and restart', async t => {
  const f = await fixture(t, { catalog: { rabbit: PET_CATALOG.rabbit }, chooseRarity: () => 0 });
  f.buy(); f.prepareVisit(5, 2); f.buy(); f.advance(1800000);
  const pets = f.snapshot(); assert.equal(pets.collection.length, 1); assert.equal(pets.recentHatches.length, 2); assert.equal(pets.pendingRefundGold, 0);
  const duplicate = pets.recentHatches.find(hatch => hatch.duplicate);
  assert.equal(duplicate.petId, 'rabbit'); assert.equal(duplicate.rarity, 'common'); assert.equal(duplicate.refundGold, 1000); assert.equal(duplicate.refundDestination, 'bank'); assert.equal(duplicate.refundPaid, true);
  assert.equal(pets.recentHatches.find(hatch => !hatch.duplicate).refundGold, 0); assert.equal(f.app.store.account(f.alice.playerId).bank, 1000);
  for (let i = 0; i < 5; i++) { f.advance(1000); f.snapshot(); }
  const second = new Store(f.dataDir); accountPetSnapshot(second, f.alice.playerId, f.options); second.close();
  await f.restart(); accountPetSnapshot(f.app.store, f.alice.playerId, f.options);
  assert.equal(f.app.store.account(f.alice.playerId).bank, 1000); assert.equal(f.app.store.db.prepare('SELECT count(*) AS n FROM pet_hatches').get().n, 2);
  assert.deepEqual(f.snapshot(f.bob).recentHatches, []);
});

test('a full bank keeps the duplicate refund pending and pays it once when room is available', async t => {
  const f = await fixture(t, { catalog: { rabbit: PET_CATALOG.rabbit }, chooseRarity: () => 0 });
  f.buy(); f.prepareVisit(5, 2); f.buy(); f.app.store.bank(f.alice.playerId, Number.MAX_SAFE_INTEGER - 500); f.advance(1800000);
  let pets = f.snapshot(); assert.equal(pets.eggs.length, 0); assert.equal(pets.collection.length, 1); assert.equal(pets.pendingRefundGold, 1000);
  assert.equal(pets.recentHatches.find(hatch => hatch.duplicate).refundPaid, false); assert.equal(f.app.store.account(f.alice.playerId).bank, Number.MAX_SAFE_INTEGER - 500);
  await f.restart(); pets = accountPetSnapshot(f.app.store, f.alice.playerId, f.options); assert.equal(pets.pendingRefundGold, 1000);
  f.app.store.bank(f.alice.playerId, -500); f.advance(1000); pets = f.snapshot();
  assert.equal(pets.pendingRefundGold, 0); assert.equal(pets.recentHatches.find(hatch => hatch.duplicate).refundPaid, true); assert.equal(f.app.store.account(f.alice.playerId).bank, Number.MAX_SAFE_INTEGER);
  f.advance(1000); f.snapshot(); assert.equal(f.app.store.account(f.alice.playerId).bank, Number.MAX_SAFE_INTEGER);
});

test('failed duplicate refund persistence rolls back bank gold and hatching for a clean retry', async t => {
  const f = await fixture(t, { catalog: { rabbit: PET_CATALOG.rabbit }, chooseRarity: () => 0 });
  f.buy(); f.prepareVisit(5, 2); f.buy(); f.advance(1800000);
  f.app.store.db.exec("CREATE TRIGGER fail_refund_paid BEFORE UPDATE OF refund_paid ON pet_hatches WHEN NEW.refund_paid=1 BEGIN SELECT RAISE(ABORT,'private refund detail'); END;");
  const failed = await f.api(); assert.equal(failed.status, 500); assert.doesNotMatch(failed.data.error, /private refund detail/);
  assert.equal(f.app.store.account(f.alice.playerId).bank, 0); assert.equal(f.app.store.db.prepare('SELECT count(*) AS n FROM pet_hatches').get().n, 0);
  assert.equal(f.app.store.db.prepare('SELECT count(*) AS n FROM pet_eggs WHERE hatched_at IS NULL').get().n, 2);
  f.app.store.db.exec('DROP TRIGGER fail_refund_paid');
  const recovered = await f.api(); assert.equal(recovered.status, 200); assert.equal(recovered.data.pets.collection.length, 1); assert.equal(f.app.store.account(f.alice.playerId).bank, 1000);
});

test('equipped companion lookups tolerate missing residents without repeated database reads or dirty caches', async t => {
  const f = await fixture(t), missingId = randomUUID();
  const prepare = f.app.store.db.prepare.bind(f.app.store.db); let reads = 0;
  f.app.store.db.prepare = sql => { reads++; return prepare(sql); };
  assert.equal(equippedPet(f.app.store, missingId, f.options), null); const first = reads;
  for (let i = 0; i < 200; i++) assert.equal(equippedPet(f.app.store, missingId, f.options), null);
  assert.equal(reads, first);
  f.buy(); f.advance(1800000); assert.equal(equippedPet(f.app.store, f.alice.playerId, f.options), null);
  assert.throws(() => f.app.store.transaction(() => {
    petAccountAction(f.app.store, f.alice.playerId, { kind: 'pet_equip', petId: 'fixture_fox' }, f.options);
    assert.equal(equippedPet(f.app.store, f.alice.playerId, f.options).id, 'fixture_fox');
    throw new Error('Roll back uncommitted equip');
  }), /Roll back/);
  assert.equal(equippedPet(f.app.store, f.alice.playerId, f.options), null);
});

test('existing incubation rows migrate without resetting their hatch deadlines or charging again', async t => {
  const f = await fixture(t); f.buy(); const egg = f.snapshot().eggs[0];
  // The first staged schema stored species and timestamps without rarity.
  f.app.store.db.exec('ALTER TABLE pet_eggs DROP COLUMN rarity');
  await f.restart();
  const restored = accountPetSnapshot(f.app.store, f.alice.playerId, f.options);
  assert.equal(restored.eggs[0].id, egg.id); assert.equal(restored.eggs[0].hatchAt, egg.hatchAt);
  assert.equal(f.village().players[f.alice.playerId].wallet, 15000);
  f.advance(1800000); const hatched = accountPetSnapshot(f.app.store, f.alice.playerId, f.options);
  assert.equal(hatched.recentHatches[0].rarity, 'common'); assert.equal(hatched.recentHatches[0].duplicate, false); assert.equal(hatched.collection[0].id, 'fixture_fox');
});
