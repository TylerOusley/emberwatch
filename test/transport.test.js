import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingEntrance } from '../shared/access.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../server/store.js';
import { BUILDINGS, PLOTS, plotBedPoint } from '../shared/world.js';
import { TRANSPORT, cartCapacity, mountedTravelSpeed } from '../shared/transport.js';
import { plotEntrance } from '../shared/access.js';
import { careTick, ensureCare } from '../server/care-defense.js';
import { ensureRequests, requestsBeforeAction, requestsAfterAction, requestsTick } from '../server/requests.js';
import { ensureTransport, transportAction, transportTick, transportSnapshot, bankTransfer, spendGold, chargePurchase, availableGold, repayIncome, releaseTransportPassenger } from '../server/transport.js';

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
  assert.throws(() => act(p, { kind: 'loan', amount: 901 }), /Outstanding loans/);
  assert.equal(village.treasury, 2400);
});

test('loan pool and treasury reserve reject unfunded issuance without altering accounts', async t => {
  const { sim, p, village, act, near } = await fixture(t);
  near(p, 'bank'); village.treasury = 1050;
  assert.throws(() => act(p, { kind: 'loan', amount: 100 }), /1,000/);
  assert.equal(sim.store.account(p.id).debt, 0); assert.equal(village.loanPool.lent, 0);
  village.treasury = 2500; village.loanPool.lent = 7980;
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
  p.inventory = { cart: 1, stone: 334 }; act(p, { kind: 'deployCart' });
  const cart = village.carts[0]; assert.equal(p.inventory.cart, 0);
  act(p, { kind: 'cartDeposit', targetId: cart.id, resource: 'stone', amount: 333 });
  assert.equal(cart.storage.stone, 333); assert.equal(p.inventory.stone, 1);
  assert.throws(() => act(p, { kind: 'cartDeposit', targetId: cart.id, resource: 'stone', amount: 1 }), /cart cannot/);
  act(p, { kind: 'cartWithdraw', targetId: cart.id, resource: 'stone', amount: 100 });
  assert.equal(cart.storage.stone, 233); assert.equal(p.inventory.stone, 101);
  other.x = cart.x; other.z = cart.z;
  assert.throws(() => act(other, { kind: 'cartWithdraw', targetId: cart.id, resource: 'stone', amount: 1 }), /another dwarf/);
  assert.equal(transportSnapshot(village, other.id, sim.store).carts[0].storage, undefined);
  assert.deepEqual(transportSnapshot(village, p.id, sim.store).carts[0].storage, { stone: 233 });
  assert.equal(transportSnapshot(village, other.id, sim.store).carts[0].weight, 699);
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
  p.inventory = { cart: 1, arrows: 10100 }; act(p, { kind: 'deployCart' });
  const cart = village.carts[0];
  act(p, { kind: 'cartDeposit', targetId: cart.id, resource: 'arrows', max: true });
  assert.equal(p.inventory.arrows, 100); assert.equal(cart.storage.arrows, 10000);
  assert.throws(() => act(p, { kind: 'cartDeposit', targetId: cart.id, resource: 'arrows', max: true }), /cart cannot/);
  act(p, { kind: 'cartWithdraw', targetId: cart.id, resource: 'arrows', max: true });
  assert.equal(p.inventory.arrows, 10100); assert.equal(cart.storage.arrows, 0);
  assert.equal(p.inventory.arrows + cart.storage.arrows, 10100);
});

test('legacy cart cargo survives the capacity migration and reinforcement charges exactly once', async t => {
  const { p, other, village, sim, act } = await fixture(t);
  village.carts.push({ id: 'old-cart', ownerId: p.id, x: p.x, z: p.z, yaw: 0, storage: { iron: 99 } });
  ensureTransport(village);
  const cart = village.carts[0];
  assert.equal(cartCapacity(cart), 1000); assert.equal(cart.storage.iron, 99);
  p.wallet = 1000; p.inventory = { timber: 40, iron: 15 };
  assert.throws(() => act(other, { kind: 'cartUpgrade', targetId: cart.id }), /another dwarf/);
  p.boundInventory = { iron: 1 };
  assert.throws(() => act(p, { kind: 'cartUpgrade', targetId: cart.id }), /40 timber/);
  assert.equal(p.wallet, 1000); p.boundInventory = {};
  act(p, { kind: 'cartUpgrade', targetId: cart.id });
  assert.equal(p.wallet, 250); assert.equal(village.treasury, 3250);
  assert.equal(p.inventory.timber, 0); assert.equal(p.inventory.iron, 0);
  assert.equal(cartCapacity(cart), 2000); assert.equal(cart.storage.iron, 99);
  assert.throws(() => act(p, { kind: 'cartUpgrade', targetId: cart.id }), /already/);
  assert.equal(p.wallet, 250);
  const restored = sim.store.loadVillages()[0]; ensureTransport(restored);
  assert.equal(restored.carts[0].upgradeLevel, 1); assert.equal(cartCapacity(restored.carts[0]), 2000);
  assert.equal(transportSnapshot(restored, p.id, sim.store).carts[0].capacity, 2000);
});

test('loaded and rescue carriages receive the same bounded road speed on server and snapshot', async t => {
  const { p, village, sim } = await fixture(t);
  Object.assign(p, { x: 0, z: 35, mountedHorseId: 'horse' });
  village.horses.push({ id: 'horse', ownerId: p.id, riderId: p.id, cartId: 'cart', x: 0, z: 35 });
  const cart = { id: 'cart', ownerId: p.id, horseId: 'horse', x: 0, z: 32, storage: {}, rescuePlayerIds: [] };
  village.carts.push(cart);
  assert.equal(mountedTravelSpeed(village, p), TRANSPORT.horseSpeed);
  cart.storage.timber = 1;
  assert.equal(mountedTravelSpeed(village, p), TRANSPORT.horseSpeed * 1.2);
  assert.equal(mountedTravelSpeed(transportSnapshot(village, p.id, sim.store), p), mountedTravelSpeed(village, p));
  cart.storage.timber = 0; cart.rescuePlayerIds = ['casualty'];
  assert.equal(mountedTravelSpeed(village, p), TRANSPORT.horseSpeed * 1.2);
  p.x = 15; assert.equal(mountedTravelSpeed(village, p), TRANSPORT.horseSpeed);
  Object.assign(p, { x: 0, z: -180 }); assert.equal(mountedTravelSpeed(village, p), TRANSPORT.horseSpeed);
  p.z = 35; village.horses[0].riderId = 'someone-else'; assert.equal(mountedTravelSpeed(village, p), TRANSPORT.horseSpeed);
});

test('two rescue stretchers retain the real players and release safely on revive, disconnect and respawn', async t => {
  const { p, other, village, sim, act } = await fixture(t);
  p.inventory = { cart: 1 }; act(p, { kind: 'deployCart' });
  const cart = village.carts[0]; cart.storage.iron = 20;
  Object.assign(other, { downed: true, hp: 0, carryingId: null, carriedBy: p.id, x: p.x, z: p.z }); p.carryingId = other.id;
  const second = { ...other, id: 'second', name: 'Second', carriedBy: null }, third = { ...other, id: 'third', name: 'Third', carriedBy: null };
  village.players.second = second; village.players.third = third;
  act(p, { kind: 'cartRescueLoad', targetId: cart.id, playerId: other.id });
  assert.equal(p.carryingId, null); assert.equal(other.carriedBy, null); assert.equal(other.rescueCartId, cart.id);
  assert.throws(() => act(p, { kind: 'cartRescueLoad', targetId: cart.id, playerId: other.id }), /unseated/);
  act(p, { kind: 'cartRescueLoad', targetId: cart.id, playerId: second.id });
  assert.throws(() => act(p, { kind: 'cartRescueLoad', targetId: cart.id, playerId: third.id }), /occupied/);
  cart.x += 2; transportTick(sim, village, 0);
  assert.equal(other.x, cart.x - .46); assert.equal(second.x, cart.x + .46);
  assert.equal(cart.storage.iron, 20);
  other.downed = false; transportTick(sim, village, 0);
  assert.equal(other.rescueCartId, null); assert.deepEqual(cart.rescuePlayerIds, [second.id]);
  second.online = false; transportTick(sim, village, 0);
  assert.equal(second.rescueCartId, null); assert.deepEqual(cart.rescuePlayerIds, []);
  second.online = true; Object.assign(second, { x: p.x, z: p.z });
  act(p, { kind: 'cartRescueLoad', targetId: cart.id, playerId: second.id });
  releaseTransportPassenger(village, second, { place: false });
  Object.assign(second, { downed: false, x: 0, z: 4 }); transportTick(sim, village, 0);
  assert.equal(second.x, 0); assert.equal(second.z, 4); assert.deepEqual(cart.rescuePlayerIds, []);
  Object.assign(third, { x: p.x, z: p.z }); act(p, { kind: 'cartRescueLoad', targetId: cart.id, playerId: third.id });
  p.online = false; transportTick(sim, village, 0);
  assert.equal(third.rescueCartId, null, 'disconnecting driver leaves passengers accessible to other rescuers');
  assert.deepEqual(cart.rescuePlayerIds, []); assert.equal(cart.storage.iron, 20);
});

test('carriage bed handoff uses available church beds, normal treatment fees and completion', async t => {
  const { p, other, village, sim, act } = await fixture(t);
  village.clock = 0; village.guards = []; village.zombies = []; village.barracks = { wheat: 0 }; village.gate = { hp: 1200 };
  p.inventory = { cart: 1 }; act(p, { kind: 'deployCart' });
  const cart = village.carts[0]; Object.assign(other, { downed: true, hp: 0, maxHp: 100 });
  act(p, { kind: 'cartRescueLoad', targetId: cart.id, playerId: other.id });
  const site = PLOTS.find(p => p.id === 'west-1');
  const plot = { id: site.id, building: 'church', ownerId: other.id, hp: 300, maxHp: 300, level: 1, storage: {}, patients: [] }; village.plots.push(plot);
  ensureCare(village);
  assert.throws(() => act(p, { kind: 'cartRescueTreat', targetId: cart.id, playerId: other.id, plotId: plot.id }), /Park beside/);
  Object.assign(p, plotEntrance(site, plot)); Object.assign(cart, { x: p.x + 1, z: p.z }); transportTick(sim, village, 0);
  plot.patients = [{ playerId: 'occupied-1', bedIndex: 0 }, { playerId: 'occupied-2', bedIndex: 1 }];
  assert.throws(() => act(p, { kind: 'cartRescueTreat', targetId: cart.id, playerId: other.id, plotId: plot.id }), /occupied/);
  assert.equal(other.rescueCartId, cart.id); assert.equal(p.wallet, 200);
  plot.patients = [];
  act(p, { kind: 'cartRescueTreat', targetId: cart.id, playerId: other.id, plotId: plot.id });
  assert.equal(other.rescueCartId, null); assert.equal(other.bedPlotId, plot.id); assert.equal(p.wallet, 180);
  assert.deepEqual(cart.rescuePlayerIds, []); assert.equal(plot.patients.length, 1);
  assert.deepEqual({ x: other.x, z: other.z }, plotBedPoint(site, 0));
  assert.throws(() => act(p, { kind: 'cartRescueTreat', targetId: cart.id, playerId: other.id, plotId: plot.id }), /not riding/);
  village.clock = 20; careTick(sim, village, .1);
  assert.equal(other.downed, false); assert.equal(other.hp, 45); assert.equal(other.bedPlotId, null); assert.equal(other.wallet, 220);
});

test('plot freight bypasses the pack while preserving capacity, ownership and complete cargo totals', async t => {
  const { p, other, village, act } = await fixture(t);
  p.inventory = { cart: 1 }; act(p, { kind: 'deployCart' });
  const cart = village.carts[0], site = PLOTS.find(p => p.id === 'west-1');
  const plot = { id: site.id, building: 'mine', ownerId: p.id, hp: 300, level: 1, storage: { stone: 500 } }; village.plots.push(plot);
  Object.assign(p, plotEntrance(site, plot)); Object.assign(cart, { x: p.x + 1, z: p.z });
  act(p, { kind: 'cartPlotLoad', targetId: cart.id, plotId: plot.id, resource: 'stone', max: true });
  assert.equal(cart.storage.stone, 333); assert.equal(plot.storage.stone, 167); assert.equal(p.inventory.stone ?? 0, 0);
  assert.throws(() => act(p, { kind: 'cartPlotLoad', targetId: cart.id, plotId: plot.id, resource: 'stone', amount: 1 }), /full/);
  plot.ownerId = other.id;
  assert.throws(() => act(p, { kind: 'cartPlotLoad', targetId: cart.id, plotId: plot.id, resource: 'stone', amount: 1 }), /Only the plot owner/);
  act(p, { kind: 'cartPlotUnload', targetId: cart.id, plotId: plot.id, resource: 'stone', amount: 100 });
  assert.equal(cart.storage.stone, 233); assert.equal(plot.storage.stone, 267);
  p.z += 10;
  assert.throws(() => act(p, { kind: 'cartPlotUnload', targetId: cart.id, plotId: plot.id, resource: 'stone', max: true }), /closer/);
  assert.equal(cart.storage.stone + plot.storage.stone, 500);
});

test('withdrawing bulk cannon stock cannot manufacture a paid shortage after dawn or reload', async t => {
  const { p, village, sim, act } = await fixture(t);
  Object.assign(village, { clock: 0, status: 'active', day: 1, phase: 'day', stock: { wheat: 100, timber: 100, stone: 100 }, barracks: { wheat: 20 }, guards: [], policies: { guardWage: 25, priestWage: 25 } });
  p.inventory = { cart: 1 }; act(p, { kind: 'deployCart' });
  const cart = village.carts[0], site = PLOTS[0];
  const plot = { id: site.id, ownerId: p.id, building: 'cannon', hp: 900, maxHp: 900, level: 1, storage: { coal: 8, stone: 8 } }; village.plots.push(plot);
  Object.assign(p, plotEntrance(site, plot)); Object.assign(cart, { x: p.x + 1, z: p.z });
  ensureRequests(village); requestsTick(sim, village);
  const action = { kind: 'cartPlotLoad', targetId: cart.id, plotId: plot.id, resource: 'coal', max: true }, before = requestsBeforeAction(village);
  act(p, action); requestsAfterAction(village, before, action);
  assert.equal(village.requests.ledger[`${plot.id}:coal`].withdrawn, 8);
  village.day++; village.requests = JSON.parse(JSON.stringify(village.requests)); requestsTick(sim, village);
  assert.equal(village.requests.items.filter(r => r.status === 'open' && r.destinationId === plot.id).length, 0);
  const restore = { kind: 'cartPlotUnload', targetId: cart.id, plotId: plot.id, resource: 'coal', max: true }, prior = requestsBeforeAction(village);
  act(p, restore); requestsAfterAction(village, prior, restore);
  assert.equal(village.requests.ledger[`${plot.id}:coal`].withdrawn, 0);
  plot.storage.coal = 0; requestsTick(sim, village);
  assert.ok(village.requests.items.some(r => r.status === 'open' && r.resource === 'coal'), 'actual firing creates a genuine funded need');
});
