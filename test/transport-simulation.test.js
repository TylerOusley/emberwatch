import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { Simulation } from '../server/simulation.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'emberwatch-rescue-'));
  const store = new Store(directory);
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  const accounts = [];
  for (const name of ['Carriage Driver', 'Rescue Passenger']) {
    const auth = await store.authenticate('register', name, 'rescue-integration-only');
    accounts.push(store.account(auth.playerId));
  }
  const sim = new Simulation(store), { id } = sim.create('Rescue Village', accounts[0]);
  const driver = sim.join(id, accounts[0]), passenger = sim.join(id, accounts[1]), village = sim.villages.get(id);
  Object.assign(driver, { x: 0, z: 35, yaw: 0 }); Object.assign(passenger, { x: 0, z: 35 });
  const cart = { id: 'rescue-cart', ownerId: driver.id, x: 0, z: 33, yaw: 0, horseId: null, storage: { iron: 20 }, upgradeLevel: 1, rescuePlayerIds: [] }; village.carts.push(cart);
  const action = (p, command) => { village.clock += 1; return sim.action(id, p.id, command); };
  const load = () => { sim.hurtPlayer(village, passenger, 1000); action(driver, { kind: 'cartRescueLoad', targetId: cart.id, playerId: passenger.id }); };
  return { store, sim, id, village, driver, passenger, cart, accounts, action, load };
}

test('simulation routes rescue actions, rejects duplicate pickups and clears seats before a dawn respawn', async t => {
  const { sim, id, village, driver, passenger, cart, action, load, store } = await fixture(t);
  load();
  const snap = sim.snapshot(village, driver.id), publicPassenger = snap.players.find(p => p.id === passenger.id);
  assert.equal(publicPassenger.rescueCartId, cart.id); assert.equal(publicPassenger.rescueSlot, 0);
  assert.deepEqual(snap.carts[0].rescuePlayerIds, [passenger.id]);
  assert.throws(() => action(driver, { kind: 'carryPlayer', targetId: passenger.id }), /uncarried/);
  assert.throws(() => action(driver, { kind: 'cartRescueLoad', targetId: cart.id, playerId: passenger.id }), /unseated/);
  assert.deepEqual(cart.rescuePlayerIds, [passenger.id]);
  passenger.respawnAvailable = true;
  action(passenger, { kind: 'respawn' });
  assert.equal(passenger.rescueCartId, null); assert.equal(passenger.rescueSlot, null); assert.deepEqual(cart.rescuePlayerIds, []);
  assert.equal(passenger.downed, false); assert.equal(passenger.x, 0); assert.equal(passenger.z, 4);
  sim.tick(.05); assert.equal(passenger.z, 4, 'cart follow cannot pull a respawned player back');
  assert.equal(store.loadVillages()[0].players[passenger.id].rescueCartId, null);
  assert.equal(cart.storage.iron, 20);
});

test('simulation disconnect releases either a passenger or the driver without moving saved cargo', async t => {
  const { sim, id, village, driver, passenger, cart, accounts, load } = await fixture(t);
  load(); sim.disconnect(id, passenger.id);
  assert.equal(passenger.rescueCartId, null); assert.deepEqual(cart.rescuePlayerIds, []);
  sim.join(id, accounts[1]); Object.assign(passenger, { x: driver.x, z: driver.z });
  village.clock += 1; sim.action(id, driver.id, { kind: 'cartRescueLoad', targetId: cart.id, playerId: passenger.id });
  sim.disconnect(id, driver.id);
  assert.equal(passenger.rescueCartId, null); assert.deepEqual(cart.rescuePlayerIds, []);
  assert.equal(passenger.online, true); assert.equal(passenger.downed, true); assert.equal(cart.storage.iron, 20);
});

test('first join after a server restart has no orphaned rescue seat owned by an offline driver', async t => {
  const { store, id, village, passenger, cart, accounts, load } = await fixture(t);
  load(); store.saveVillage(village);
  const restarted = new Simulation(store), rejoined = restarted.join(id, accounts[1]);
  const savedVillage = restarted.villages.get(id), snapshot = restarted.snapshot(savedVillage, passenger.id);
  assert.equal(rejoined.rescueCartId, null, 'first authoritative snapshot clears stale seat state before a tick');
  assert.deepEqual(snapshot.carts.find(c => c.id === cart.id).rescuePlayerIds, []);
  assert.equal(rejoined.downed, true); assert.equal(snapshot.carts[0].weight, 60);
  assert.equal(store.loadVillages()[0].players[passenger.id].rescueCartId, null);
});
