import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Simulation } from '../server/simulation.js';
import { Store } from '../server/store.js';
import { ensureCaves } from '../server/caves.js';
import { BUILDINGS, RESOURCES, SOLIDS, caveResourceType, groundHeight, canStand, resolveResource } from '../shared/world.js';
import { buildingEntrance, canUseBuilding } from '../shared/access.js';

function fixture() {
  const saved = new Map(), account = { id: 'miner', name: 'Miner', bank: 73 };
  const store = { loadVillages: () => [...saved.values()].map(v => structuredClone(v)), saveVillage: v => saved.set(v.id, structuredClone(v)), transaction: fn => fn(), account: () => account, initialWallet: () => 10 };
  const sim = new Simulation(store), { id } = sim.create('Deep Hearth', account), player = sim.join(id, account), village = sim.villages.get(id);
  village.guards = [];
  const act = action => { village.clock += .7; return sim.action(id, player.id, action); };
  return { sim, store, account, village, player, act };
}
const minerals = RESOURCES.filter(node => node.caveTier);

test('upper cave always supplies stone and deeper deterministic rolls follow their weighted pools', () => {
  for (const tier of ['upper', 'middle', 'deep']) {
    const counts = { stone: 0, iron: 0, coal: 0 };
    for (let roll = 0; roll < 20000; roll++) counts[caveResourceType(tier, 'pool-test', roll)]++;
    if (tier === 'upper') assert.deepEqual(counts, { stone: 20000, iron: 0, coal: 0 });
    else for (const [type, fraction] of Object.entries(tier === 'middle' ? { stone: .4, iron: .3, coal: .3 } : { stone: .2, iron: .4, coal: .4 })) assert.ok(Math.abs(counts[type] / 20000 - fraction) < .018, `${tier} ${type}`);
  }
  assert.equal(caveResourceType('deep', 'saved-seed', 17), caveResourceType('deep', 'saved-seed', 17));
});

test('village snapshots agree on actual mineral type, position, depth and roll without changing static identity', () => {
  const { sim, village, player } = fixture(), originalTypes = new Map(RESOURCES.map(node => [node.id, node.type]));
  const second = sim.join(village.id, { id: 'companion', name: 'Companion' });
  const first = sim.snapshot(village, player.id).resources, other = sim.snapshot(village, second.id).resources;
  assert.deepEqual(first, other);
  for (const meta of minerals) {
    const node = first.find(n => n.id === meta.id), state = village.resources.find(n => n.id === meta.id);
    assert.equal(node.type, state.type); assert.equal(node.x, meta.x); assert.equal(node.z, meta.z); assert.equal(node.depth, -groundHeight(meta.x, meta.z)); assert.equal(node.caveTier, meta.caveTier); assert.equal(node.roll, 0);
    assert.equal(meta.type, originalTypes.get(meta.id)); if (meta.caveTier === 'upper') assert.equal(node.type, 'stone');
  }
  assert.ok(!Object.hasOwn(first.find(n => n.id.startsWith('timber-')), 'roll'));
  assert.equal(sim.snapshot(village, player.id).caveSeed, undefined);
});

test('mineral regeneration rerolls once only after depletion and its timer, with pause/rejoin/reload retaining the roll', () => {
  const { sim, store, account, village, player } = fixture(), meta = minerals.find(n => n.caveTier === 'deep'), state = village.resources.find(n => n.id === meta.id);
  const initial = state.type, seed = village.caveSeed;
  Object.assign(state, { available: false, remaining: 0, regrowAt: 2 });
  sim.tick(1.9); assert.equal(state.type, initial); assert.equal(state.roll, 0);
  sim.disconnect(village.id, player.id); sim.tick(100); assert.equal(village.clock, 1.9);
  const restart = new Simulation(store), restored = restart.villages.get(village.id); restart.join(village.id, account);
  const node = restored.resources.find(n => n.id === meta.id);
  assert.equal(restored.caveSeed, seed); assert.equal(node.type, initial); assert.equal(node.roll, 0); assert.equal(node.available, false);
  restart.tick(.2); assert.equal(node.available, true); assert.equal(node.remaining, 8); assert.equal(node.roll, 1);
  assert.equal(node.type, caveResourceType(meta.caveTier, `${seed}:${meta.id}`, 1));
  const rolled = node.type; restart.tick(150); ensureCaves(restored); assert.equal(node.roll, 1); assert.equal(node.type, rolled, 'available mineral never rerolls on a timer or migration');
  restart.disconnect(restored.id, player.id); restart.join(restored.id, account); assert.equal(node.roll, 1); assert.equal(node.type, rolled);
});

test('wood, stone and iron picks harvest every actual cave mineral at equal action speed and one/two/three yield', () => {
  const { village, player, act } = fixture(), meta = minerals.find(n => n.caveTier === 'deep' && n.type === 'iron'), state = village.resources.find(n => n.id === meta.id);
  Object.assign(player, { x: meta.x, z: meta.z + 1.6, tool: 'pickaxe' }); player.durability.pickaxe = 100;
  for (const [tier, count] of [['wood', 1], ['stone', 2], ['iron', 3]]) for (const type of ['stone', 'iron', 'coal']) {
    player.tiers.pickaxe = tier; Object.assign(state, { type, available: true, remaining: 8 });
    player.inventory.stone = player.inventory.iron = player.inventory.coal = 0;
    const durability = player.durability.pickaxe;
    act({ kind: 'gather', targetId: meta.id, resource: 'gold', amount: 999 });
    assert.equal(player.inventory[type], count); assert.equal(state.remaining, 7); assert.equal(player.durability.pickaxe, durability - 1); assert.equal(player.inventory.gold, undefined);
    assert.equal(player.animationUntil - village.clock, .5);
  }
});

test('gathering through an intervening rock wall fails without consuming resources, durability or inventory', () => {
  const { village, player, act } = fixture(), meta = minerals.find(n => n.caveTier === 'deep'), state = village.resources.find(n => n.id === meta.id);
  Object.assign(player, { x: meta.x + 1.6, z: meta.z, tool: 'pickaxe' }); player.durability.pickaxe = 20;
  // Exercise the same thin-wall arrangement that future chamber details may
  // add, with a valid standing point on either side of the collision wall.
  const wall = { x: meta.x + .8, z: meta.z, w: .2, d: 3, cave: true }; SOLIDS.push(wall);
  try {
    assert.ok(canStand(player.x, player.z)); const before = structuredClone(state), inventory = structuredClone(player.inventory);
    assert.throws(() => act({ kind: 'gather', targetId: meta.id }), /around the wall/);
    assert.deepEqual(state, before); assert.deepEqual(player.inventory, inventory); assert.equal(player.durability.pickaxe, 20);
  } finally { SOLIDS.splice(SOLIDS.indexOf(wall), 1); }
});

test('a hired worker mines the current rolled mineral and carries it physically out of the cave to sell', () => {
  const { sim, village, player, act } = fixture(), meta = minerals.find(n => n.caveTier === 'deep' && n.type === 'iron');
  for (const state of village.resources) { state.available = false; state.regrowAt = 10000; }
  const node = village.resources.find(n => n.id === meta.id); Object.assign(node, { available: true, remaining: 1, type: 'coal', roll: 5 });
  Object.assign(player, buildingEntrance(BUILDINGS.find(b => b.id === 'bank'))); player.wallet = 1000;
  act({ kind: 'worker_hire' }); const worker = village.workers[0];
  act({ kind: 'worker_assign', workerId: worker.id, resource: 'coal', sourcePlotId: null, mode: 'sell', destinationPlotId: null });
  assert.equal(meta.type, 'iron'); assert.equal(resolveResource(meta, node).type, 'coal');
  const coal = village.stock.coal, iron = village.stock.iron; let deepest = 0, entered = false, returned = false;
  for (let i = 0; i < 1500 && village.stock.coal === coal; i++) {
    sim.tick(.2); assert.ok(canStand(worker.x, worker.z, .4), 'worker never crosses mountain rock');
    deepest = Math.min(deepest, groundHeight(worker.x, worker.z));
    if (worker.z < -132) entered = true;
    if (entered && worker.z > -118) returned = true;
  }
  assert.ok(entered && returned); assert.ok(deepest <= -13); assert.equal(node.remaining, 0); assert.equal(village.stock.coal, coal + 1); assert.equal(village.stock.iron, iron);
  assert.equal(worker.cargo.coal, 0); assert.equal(worker.cargo.iron, 0);
  assert.ok(canUseBuilding(worker, BUILDINGS.find(b => b.id === 'market')), 'cave cargo reaches the exchange counter before sale');
});

test('SQLite migration preserves old depletion, account gold and plot ownership while persisting cave rolls across restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'emberwatch-cave-')), store = new Store(directory);
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  const session = await store.authenticate('register', 'Cave Founder', 'cave-migration-password'), account = store.account(session.playerId);
  const sim = new Simulation(store), { id } = sim.create('Old Quarry', account), player = sim.join(id, account), village = sim.villages.get(id);
  delete village.caveSeed;
  for (const state of village.resources) { delete state.type; delete state.roll; delete state.caveVersion; }
  const oldId = minerals[0].id, oldState = village.resources.find(n => n.id === oldId); Object.assign(oldState, { available: false, remaining: 0, regrowAt: 333 });
  const plot = village.plots[0]; Object.assign(plot, { ownerId: player.id, building: 'house', hp: 231, maxHp: 500 }); plot.storage.iron = 7;
  player.wallet = 123; store.bank(player.id, 73); store.saveVillage(village);
  const recovered = new Simulation(store), restored = recovered.villages.get(id); recovered.join(id, account);
  const migrated = restored.resources.find(n => n.id === oldId); assert.equal(migrated.available, false); assert.equal(migrated.remaining, 0); assert.equal(migrated.regrowAt, 333); assert.equal(migrated.type, 'stone');
  assert.equal(restored.players[player.id].wallet, 123); assert.equal(store.account(player.id).bank, 73); assert.equal(restored.plots[0].ownerId, player.id); assert.equal(restored.plots[0].hp, 231); assert.equal(restored.plots[0].storage.iron, 7);
  const types = restored.resources.filter(n => n.caveVersion).map(n => [n.id, n.type, n.roll]), seed = restored.caveSeed;
  recovered.disconnect(id, player.id); const again = new Simulation(store); again.join(id, account);
  assert.deepEqual(again.villages.get(id).resources.filter(n => n.caveVersion).map(n => [n.id, n.type, n.roll]), types); assert.equal(again.villages.get(id).caveSeed, seed);
});
