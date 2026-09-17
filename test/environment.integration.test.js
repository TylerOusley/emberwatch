import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { Simulation } from '../server/simulation.js';

test('simulation shares seasons and events across players and SQLite restart preserves paused timers and one-time stock deliveries', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'emberwatch-environment-'));
  let store = new Store(directory);
  try {
    const first = await store.authenticate('register', 'SeasonsOwner', 'test-season-password'), second = await store.authenticate('register', 'SeasonsGuest', 'test-season-password');
    const owner = store.account(first.playerId), guest = store.account(second.playerId);
    let sim = new Simulation(store, { daySeconds: 10000, nightSeconds: 10000 });
    const villageId = sim.create('Seasonal Valley', owner).id;
    sim.join(villageId, owner); sim.join(villageId, guest);
    let village = sim.villages.get(villageId);
    village.environment.seed = 1; village.environment.nextEventAt = 2;
    const stockBefore = { ...village.stock };
    sim.tick(2);
    assert.equal(village.environment.event.type, 'merchant_caravan');
    assert.equal(village.stock.iron, stockBefore.iron + 60);
    assert.deepEqual(sim.snapshot(village, owner.id).environment, sim.snapshot(village, guest.id).environment);
    sim.disconnect(villageId, owner.id); sim.tick(3);
    assert.equal(village.environment.elapsed, 5, 'one remaining player keeps the common clock moving');
    sim.disconnect(villageId, guest.id);
    const saved = structuredClone(village.environment), deliveredStock = { ...village.stock };
    sim.tick(10000);
    assert.deepEqual(village.environment, saved, 'empty village pauses season and event duration');
    sim.saveAll(); store.close(); store = new Store(directory); sim = new Simulation(store, { daySeconds: 10000, nightSeconds: 10000 });
    village = sim.villages.get(villageId);
    assert.deepEqual(village.environment, saved); assert.deepEqual(village.stock, deliveredStock);
    sim.tick(1000); assert.deepEqual(village.environment, saved, 'restarting an empty village cannot advance or reset schedules');
    sim.join(villageId, store.account(owner.id)); sim.tick(3);
    assert.equal(village.environment.elapsed, 8);
    assert.equal(village.environment.event.id, saved.event.id);
    assert.equal(village.environment.event.endsAt, saved.event.endsAt);
    assert.equal(village.environment.nextEventAt, saved.nextEventAt);
    assert.equal(village.environment.nextSeasonAt, saved.nextSeasonAt);
    assert.deepEqual(village.stock, deliveredStock, 'rejoining cannot duplicate the caravan shipment');
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
