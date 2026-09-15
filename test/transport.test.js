import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingEntrance } from '../shared/access.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../server/store.js';
import { BUILDINGS } from '../shared/world.js';
import { ensureTransport, transportAction, transportTick, transportSnapshot, bankTransfer, spendGold, chargePurchase, availableGold, repayIncome } from '../server/transport.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'emberwatch-transport-'));
  const sim = { store: new Store(directory), inputs: new Map(), notice() {} };
  t.after(async () => { sim.store.close(); await rm(directory, { recursive: true, force: true }); });
  async function player(name) {
    const session = await sim.store.authenticate('register', name, 'protected-test-password');
    return { id: session.playerId, name, wallet: 200, inventory: {}, durability: {}, online: true, downed: false, x: 0, z: 35, yaw: 0 };
  }
  const p = await player('Rider'), other = await player('Neighbor');
  const village = { id: 'transport-village', treasury: 2500, players: { [p.id]: p, [other.id]: other }, plots: [] };
  ensureTransport(village);
  function act(who, action) { return sim.store.transaction(() => { const result = transportAction(sim, village, who, action); sim.store.saveVillage(village); return result; }); }
  const near = (who, id) => { const building = BUILDINGS.find(b => b.id === id); Object.assign(who, buildingEntrance(building)); };
  return { directory, sim, p, other, village, act, near };
}

test('legacy accounts migrate in place, keeping protected savings', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'emberwatch-legacy-loans-'));
  const legacy = new DatabaseSync(join(directory, 'emberwatch.sqlite'));
  legacy.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,salt TEXT NOT NULL,password_hash TEXT NOT NULL,bank INTEGER NOT NULL DEFAULT 0,starter_granted INTEGER NOT NULL DEFAULT 0); INSERT INTO accounts VALUES('old','Original','salt','hash',713,1)");
  legacy.close();
  const store = new Store(directory);
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  assert.deepEqual({ ...store.account('old') }, { id: 'old', name: 'Original', bank: 713, starter_granted: 1, debt: 0, credit: 0, repayment_remainder: 0 });
});

test('loans fund approved purchases and preserve debt, credit and bank across restart', async t => {
  const { directory, sim, p, other, village, act, near } = await fixture(t);
  near(p, 'bank'); sim.store.bank(p.id, 77); p.wallet = 20;
  act(p, { kind: 'loan', amount: 100 });
  assert.equal(village.treasury, 2400); assert.equal(p.wallet, 20);
  assert.equal(availableGold(sim, p), 120);
  assert.throws(() => chargePurchase(sim, village, p, 30), /wallet/);
  assert.equal(sim.store.account(p.id).credit, 100, 'ordinary payments cannot use credit');
  sim.store.transaction(() => { spendGold(sim, village, p, 65); sim.store.saveVillage(village); });
  assert.equal(p.wallet, 0); assert.equal(sim.store.account(p.id).credit, 55);
  sim.store.close(); sim.store = new Store(directory);
  assert.equal(sim.store.account(p.id).debt, 100);
  assert.equal(sim.store.account(p.id).credit, 55);
  assert.equal(sim.store.account(p.id).bank, 77);
  assert.equal(sim.store.loadVillages()[0].loanPool.lent, 100);
  assert.equal(transportSnapshot(village, other.id, sim.store).loan.debt, 0);
  assert.equal(transportSnapshot(village, other.id, sim.store).loan.credit, 0);
  assert.throws(() => act(p, { kind: 'loan', amount: 101 }), /Outstanding loans/);
  assert.equal(village.treasury, 2400);
});

test('loan pool and treasury reserve reject unfunded issuance without altering accounts', async t => {
  const { sim, p, village, act, near } = await fixture(t);
  near(p, 'bank'); village.treasury = 1050;
  assert.throws(() => act(p, { kind: 'loan', amount: 100 }), /1,000/);
  assert.equal(sim.store.account(p.id).debt, 0); assert.equal(village.loanPool.lent, 0);
  village.treasury = 2500; village.loanPool.lent = 480;
  assert.throws(() => act(p, { kind: 'loan', amount: 100 }), /pool/);
  assert.equal(sim.store.account(p.id).credit, 0);
  assert.throws(() => sim.store.transaction(() => { sim.store.transaction(() => sim.store.issueCredit(p.id, 100)); throw new Error('rollback'); }), /rollback/);
  assert.equal(sim.store.account(p.id).debt, 0, 'nested approved-purchase failure rolls back durable debt');
});

test('repayments collect 20 percent of cumulative income without touching savings', async t => {
  const { sim, p, village, act, near } = await fixture(t);
  near(p, 'bank'); act(p, { kind: 'loan', amount: 100 }); sim.store.bank(p.id, 81);
  let earned = 0;
  for (let i = 0; i < 15; i++) earned += repayIncome(sim, village, p, 1);
  assert.equal(earned, 12); assert.equal(sim.store.account(p.id).debt, 97); assert.equal(village.treasury, 2403);
  assert.equal(sim.store.account(p.id).bank, 81);
  assert.equal(repayIncome(sim, village, p, 600), 503, 'final repayment is capped at remaining debt');
  assert.equal(sim.store.account(p.id).debt, 0); assert.equal(village.treasury, 2500);
  assert.equal(repayIncome(sim, village, p, 10), 10);
});

test('horse sale is finite, unique per owner, and only its owner can ride', async t => {
  const { p, other, village, sim, act, near } = await fixture(t);
  near(p, 'stable'); near(other, 'stable'); village.stable.stock = 2;
  act(p, { kind: 'buyHorse' }); act(other, { kind: 'buyHorse' });
  assert.equal(village.stable.stock, 0); assert.equal(village.treasury, 2700);
  const [horse, neighborHorse] = village.horses;
  assert.ok(Math.hypot(horse.x - neighborHorse.x, horse.z - neighborHorse.z) >= 2);
  assert.throws(() => act(other, { kind: 'mountHorse', targetId: horse.id }), /another dwarf/);
  p.x = horse.x; p.z = horse.z; act(p, { kind: 'mountHorse', targetId: horse.id });
  assert.equal(p.mountedHorseId, horse.id); p.x -= 1;
  transportTick(sim, village, .1); assert.equal(horse.x, p.x); assert.equal(horse.moving, true);
  p.online = false; transportTick(sim, village, .1);
  assert.equal(horse.riderId, null); assert.equal(p.mountedHorseId, null);
  village.stable.stock = 1; p.online = true; near(p, 'stable');
  assert.throws(() => act(p, { kind: 'buyHorse' }), /already own/);
  assert.equal(village.stable.stock, 1);
});

test('cart inventory transfers conserve cargo, respect weight and keep storage private', async t => {
  const { p, other, village, sim, act } = await fixture(t);
  p.inventory = { cart: 1, stone: 101 }; act(p, { kind: 'deployCart' });
  const cart = village.carts[0]; assert.equal(p.inventory.cart, 0);
  act(p, { kind: 'cartDeposit', targetId: cart.id, resource: 'stone', amount: 100 });
  assert.equal(cart.storage.stone, 100); assert.equal(p.inventory.stone, 1);
  assert.throws(() => act(p, { kind: 'cartDeposit', targetId: cart.id, resource: 'stone', amount: 1 }), /cart cannot/);
  assert.throws(() => act(p, { kind: 'cartWithdraw', targetId: cart.id, resource: 'stone', amount: 33 }), /pack cannot/);
  act(p, { kind: 'cartWithdraw', targetId: cart.id, resource: 'stone', amount: 32 });
  assert.equal(cart.storage.stone, 68); assert.equal(p.inventory.stone, 33);
  other.x = cart.x; other.z = cart.z;
  assert.throws(() => act(other, { kind: 'cartWithdraw', targetId: cart.id, resource: 'stone', amount: 1 }), /another dwarf/);
  assert.equal(transportSnapshot(village, other.id, sim.store).carts[0].storage, undefined);
  assert.deepEqual(transportSnapshot(village, p.id, sim.store).carts[0].storage, { stone: 68 });
  assert.equal(transportSnapshot(village, other.id, sim.store).carts[0].weight, 204);
});

test('riding is blocked while carrying or occupying a church bed', async t => {
  const { p, village, act, near } = await fixture(t);
  near(p, 'stable'); village.stable.stock = 1; act(p, { kind: 'buyHorse' });
  const horse = village.horses[0]; p.x = horse.x; p.z = horse.z;
  for (const flag of ['carryingId', 'carriedBy', 'bedPlotId']) {
    p[flag] = 'other'; assert.throws(() => act(p, { kind: 'mountHorse', targetId: horse.id }), /carrying or treatment/); p[flag] = null;
  }
  assert.equal(horse.riderId, null);
});

test('bank exact and all transfers use current balances and conserve wallet plus protected savings', async t => {
  const { sim, p, village, near } = await fixture(t);
  near(p, 'bank'); sim.store.bank(p.id, 77); sim.store.issueCredit(p.id, 100, 200);
  const total = p.wallet + sim.store.account(p.id).bank, treasury = village.treasury;
  bankTransfer(sim, village, p, { kind: 'deposit', amount: 10 });
  assert.equal(p.wallet, 190); assert.equal(sim.store.account(p.id).bank, 87);
  bankTransfer(sim, village, p, { kind: 'deposit', max: true });
  assert.equal(p.wallet, 0); assert.equal(sim.store.account(p.id).bank, total);
  assert.throws(() => bankTransfer(sim, village, p, { kind: 'deposit', max: true }), /empty/);
  bankTransfer(sim, village, p, { kind: 'withdraw', amount: 10 });
  assert.equal(p.wallet, 10);
  bankTransfer(sim, village, p, { kind: 'withdraw', max: true });
  assert.equal(p.wallet, total); assert.equal(sim.store.account(p.id).bank, 0);
  for (const amount of [-1, 1.5, '10', NaN, total + 1]) assert.throws(() => bankTransfer(sim, village, p, { kind: 'deposit', amount }));
  assert.equal(p.wallet, total); assert.equal(sim.store.account(p.id).bank, 0);
  assert.equal(village.treasury, treasury); assert.equal(sim.store.account(p.id).credit, 100); assert.equal(sim.store.account(p.id).debt, 100);
  assert.equal(sim.store.loadVillages()[0].players[p.id].wallet, total);
  Object.assign(p, { x: 0, z: 40 }); assert.throws(() => bankTransfer(sim, village, p, { kind: 'deposit', max: true }), /Visit/);
});

test('cart maximum transfers stop at capacity and apply current source counts without duplication', async t => {
  const { p, village, act } = await fixture(t);
  p.inventory = { cart: 1, arrows: 3100 }; act(p, { kind: 'deployCart' });
  const cart = village.carts[0];
  act(p, { kind: 'cartDeposit', targetId: cart.id, resource: 'arrows', max: true });
  assert.equal(p.inventory.arrows, 100); assert.equal(cart.storage.arrows, 3000);
  assert.throws(() => act(p, { kind: 'cartDeposit', targetId: cart.id, resource: 'arrows', max: true }), /cart cannot/);
  act(p, { kind: 'cartWithdraw', targetId: cart.id, resource: 'arrows', max: true });
  assert.equal(p.inventory.arrows, 1000); assert.equal(cart.storage.arrows, 2100);
  assert.equal(p.inventory.arrows + cart.storage.arrows, 3100);
});
