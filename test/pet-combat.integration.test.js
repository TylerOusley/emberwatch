import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../server/store.js';
import { Simulation } from '../server/simulation.js';
import { petAccountAction } from '../server/pets.js';
import { syncPetCompanions, tickPetCompanions, petCompanionsSnapshot } from '../server/pet-companions.js';
import { PET_CATALOG } from '../shared/pets.js';
import { carryCapacity } from '../shared/content.js';
import { carryStatus } from '../shared/encumbrance.js';
import { canStand, plotSolids } from '../shared/world.js';

async function fixture(t, species = 'wolf') {
  const dir = await mkdtemp(join(tmpdir(), 'emberwatch-pet-combat-'));
  const f = { store: new Store(dir) };
  t.after(async () => { f.store.close(); await rm(dir, { recursive: true, force: true }); });
  const session = await f.store.authenticate('register', 'Companion keeper', 'pet-combat-test-password');
  f.id = session.playerId; f.sim = new Simulation(f.store);
  f.v = f.sim.villages.get(f.sim.create('Companion watch', f.store.account(f.id)).id);
  f.p = f.sim.join(f.v.id, f.store.account(f.id));
  Object.assign(f.p, { x: 0, z: 4, hp: 100, maxHp: 100, wallet: 1000, inventory: {}, durability: {}, yaw: 0 });
  f.v.guards = []; f.v.phaseRemaining = 10000;
  f.equip = id => {
    if (id && !f.store.db.prepare('SELECT 1 FROM pet_unlocks WHERE account_id=? AND species_id=?').get(f.id, id)) {
      const egg = randomUUID();
      f.store.db.prepare('INSERT INTO pet_eggs(id,account_id,species_id,catalog_version,purchased_at,hatch_at,hatched_at) VALUES(?,?,?,?,?,?,?)').run(egg, f.id, id, 2, 1, 2, 2);
      f.store.db.prepare('INSERT INTO pet_unlocks(account_id,species_id,egg_id,unlocked_at) VALUES(?,?,?,?)').run(f.id, id, egg, 2);
    }
    petAccountAction(f.store, f.id, { kind: 'pet_equip', petId: id }); syncPetCompanions(f.sim, f.v);
  };
  f.equip(species);
  f.actor = () => f.v.petActors[0];
  f.enemy = (hp = 100, x = f.actor().x, z = f.actor().z + 1) => {
    const zombie = { id: randomUUID(), kind: 'shambler', x, z, yaw: 0, hp, maxHp: hp, armor: 0, speed: 0, cooldown: 100, roadIndex: 0 };
    f.v.zombies.push(zombie); return zombie;
  };
  f.advance = dt => { f.v.clock += dt; tickPetCompanions(f.sim, f.v, dt); };
  return f;
}

test('one authenticated utility companion increases carry allowance without stacking or discarding items', async t => {
  const f = await fixture(t, 'rabbit'); f.p.inventory.wheat = 180;
  assert.equal(carryCapacity(f.p), 180); assert.equal(carryStatus(f.p).encumbered, false);
  f.equip('squirrel'); assert.equal(carryCapacity(f.p), 187.5); assert.equal(f.v.petActors.length, 1);
  f.equip('marmot'); assert.equal(carryCapacity(f.p), 172.5); assert.equal(carryStatus(f.p).encumbered, true);
  f.equip(''); assert.equal(carryCapacity(f.p), 150); assert.equal(f.p.inventory.wheat, 180); assert.equal(f.v.petActors.length, 0);
  f.p.petSpeciesId = 'squirrel'; syncPetCompanions(f.sim, f.v);
  assert.equal(f.p.petSpeciesId, ''); assert.equal(carryCapacity(f.p), 150, 'saved fields never grant an unowned or unequipped pet');
});

test('melee has a visible windup, exact two-second cadence, and ordinary kill/assist attribution', async t => {
  const f = await fixture(t), zombie = f.enemy(45), wallet = f.p.wallet;
  f.advance(.1); assert.equal(zombie.hp, 45); assert.equal(f.actor().anim, 'attack');
  const first = petCompanionsSnapshot(f.v).petActors[0]; assert.equal(first.lastAttack.kind, 'melee'); assert.ok(first.lastAttack.impactAt > first.lastAttack.at);
  f.advance(.35); assert.equal(zombie.hp, 25); assert.equal(zombie.contributors[f.id], 20);
  f.advance(1); assert.equal(zombie.hp, 25);
  f.advance(.7); assert.equal(zombie.hp, 25); f.advance(.35); assert.equal(zombie.hp, 5);
  f.advance(2); f.advance(.35); assert.equal(zombie.hp, 0); assert.equal(f.p.wallet, wallet + 100); assert.equal(f.p.combatRewards.kills, 1);
  const next = f.enemy(50); f.advance(2); f.advance(.35);
  f.v.players.helper = { id: 'helper', name: 'Helper', wallet: 0, hp: 100, maxHp: 100, online: false, inventory: {}, durability: {}, role: 'guard' };
  f.sim.hitZombie(f.v, next, 100, f.v.players.helper);
  assert.equal(f.p.combatRewards.assists, 1); assert.equal(f.p.wallet, wallet + 200);
});

test('impact revalidates range, walls and dead targets; missed vampire hits never heal or revive', async t => {
  const f = await fixture(t, 'vampire_bat'); f.p.hp = 50;
  const zombie = f.enemy(100); f.advance(.1); zombie.x += 20; f.advance(.4);
  assert.equal(zombie.hp, 100); assert.equal(f.p.hp, 50);
  zombie.x = f.actor().x; zombie.z = f.actor().z + 1; f.advance(2); zombie.hp = 0; f.advance(.4);
  assert.equal(f.p.hp, 50);
  const living = f.enemy(100); f.advance(2); f.advance(.4); assert.equal(living.hp, 50); assert.equal(f.p.hp, 52);
  f.p.hp = 99; f.advance(2); f.advance(.4); assert.equal(living.hp, 0); assert.equal(f.p.hp, 100);
  f.p.downed = true; f.p.hp = 0; f.advance(3); assert.equal(f.v.petActors.length, 0); assert.equal(f.p.hp, 0);
});

test('ranged intent waits for travel and cannot fire or land through the intact gate', async t => {
  const f = await fixture(t, 'dragon'); Object.assign(f.p, { x: 0, z: 14 }); Object.assign(f.actor(), { x: 0, z: 16 });
  const zombie = f.enemy(100, 0, 20); f.advance(.1); assert.equal(f.actor().pending, null); assert.equal(zombie.hp, 100);
  f.v.gate.hp = 0; f.advance(.1); assert.equal(f.actor().lastAttack.projectile, 'fire');
  f.advance(.35); assert.equal(zombie.hp, 100, 'projectile flight is not instant damage');
  f.v.gate.hp = 1200; f.advance(.3); assert.equal(zombie.hp, 100);
  f.v.gate.hp = 0; f.advance(2); f.advance(.65); assert.equal(zombie.hp, 50);
});

test('owner travel, mounting and quick equip swaps cancel attacks without resetting the shared cooldown', async t => {
  const f = await fixture(t, 'wolf'), zombie = f.enemy(); f.advance(.1);
  const ready = f.p.petReadyAt; f.equip('dragon'); assert.equal(f.p.petReadyAt, ready);
  f.advance(.1); assert.equal(f.actor().pending, null); assert.equal(zombie.hp, 100);
  f.advance(2); assert.ok(f.actor().pending); f.p.x = 30; f.advance(.7);
  assert.equal(zombie.hp, 100); assert.equal(f.actor().pending, null); assert.ok(Math.hypot(f.actor().x - f.p.x, f.actor().z - f.p.z) < 2);
  const nearby = f.enemy(); f.p.mountedHorseId = 'horse'; f.advance(3); assert.equal(nearby.hp, 100); assert.equal(f.actor().pending, null);
});

test('ground companions follow around obstacles and cave walls without becoming combat targets', async t => {
  const f = await fixture(t, 'rabbit'); Object.assign(f.actor(), { x: 4, z: -4 }); Object.assign(f.p, { x: 12, z: -4 });
  const solids = plotSolids(f.v.plots);
  for (let i = 0; i < 120; i++) { f.advance(.1); assert.equal(canStand(f.actor().x, f.actor().z, .4, solids), true); }
  assert.ok(Math.hypot(f.actor().x - f.p.x, f.actor().z - f.p.z) < 3);
  Object.assign(f.p, { x: -2, z: -180 }); f.advance(.1);
  assert.equal(canStand(f.actor().x, f.actor().z, .4, solids), true);
  assert.equal('hp' in petCompanionsSnapshot(f.v).petActors[0], false);
});

test('saved cooldown and equipped unlock survive simulation reload and spawning into a different village', async t => {
  const f = await fixture(t), zombie = f.enemy(); f.advance(.1); const ready = f.p.petReadyAt;
  f.sim.saveAll(); f.sim = new Simulation(f.store); f.v = f.sim.villages.get(f.v.id); f.p = f.sim.join(f.v.id, f.store.account(f.id));
  syncPetCompanions(f.sim, f.v); assert.equal(f.p.petReadyAt, ready); assert.equal(f.p.petSpeciesId, 'wolf');
  f.equip('dragon'); f.advance(.1); assert.equal(f.actor().pending, null); assert.equal(f.v.zombies.find(z => z.id === zombie.id).hp, 100);
  f.v.status = 'fallen';
  const other = f.sim.create('Second companion watch', f.store.account(f.id)); const p = f.sim.join(other.id, f.store.account(f.id));
  const village = f.sim.villages.get(other.id); syncPetCompanions(f.sim, village);
  assert.equal(p.petSpeciesId, 'dragon'); assert.equal(village.petActors.length, 1);
});

test('vampire impact, lethal reward, healing and consumed windup commit or roll back together', async t => {
  const f = await fixture(t, 'vampire_bat'), zombie = f.enemy(10); f.p.hp = 99;
  f.advance(.1); const pending = structuredClone(f.actor().pending), wallet = f.p.wallet;
  f.sim.saveAll(); const saved = f.store.loadVillages();
  const save = f.store.saveVillage.bind(f.store); let writes = 0;
  f.store.saveVillage = village => { if (++writes === 2) throw new Error('impact persistence failed'); save(village); };
  assert.throws(() => f.advance(.4), /impact persistence failed/);
  assert.equal(zombie.hp, 10); assert.equal(f.p.hp, 99); assert.equal(f.p.wallet, wallet);
  assert.deepEqual(f.actor().pending, pending); assert.deepEqual(f.store.loadVillages(), saved);
  f.store.saveVillage = save; f.advance(.1);
  assert.equal(zombie.hp, 0); assert.equal(f.p.hp, 100); assert.equal(f.p.wallet, wallet + 100); assert.equal(f.actor().pending, null);
  const reloaded = new Simulation(f.store), p = reloaded.villages.get(f.v.id).players[f.id];
  assert.equal(p.hp, 100); assert.equal(p.wallet, wallet + 100); assert.equal(p.combatRewards.kills, 1);
  f.advance(3); assert.equal(f.p.wallet, wallet + 100);
});

test('actual simulation ticks synchronize utility before movement and share combat snapshots without private egg data', async t => {
  const f = await fixture(t, 'rabbit'); f.p.inventory.wheat = 175;
  f.sim.input(f.v.id, f.id, { x: 1, z: 0, yaw: 0, sprint: true });
  const start = f.p.x; f.sim.tick(.1); assert.ok(f.p.x - start > .7);
  const snapshot = f.sim.snapshot(f.v, f.id); assert.equal(snapshot.petActors.length, 1);
  assert.equal(snapshot.players.find(p => p.id === f.id).petSpeciesId, 'rabbit');
  assert.equal(snapshot.petActors[0].pending, undefined); assert.equal(snapshot.petActors[0].eggs, undefined);
  f.equip('wolf'); f.sim.inputs.clear(); const zombie = f.enemy(40);
  f.sim.tick(.1); assert.equal(zombie.hp, 40); f.sim.tick(.4); assert.equal(zombie.hp, 20);
});
