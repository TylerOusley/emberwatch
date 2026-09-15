import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS, PLOTS, RESOURCES, CAVE_ROUTE, canStand, clearResourceSegment } from '../shared/world.js';
import { buildingEntrance, canUseBuilding } from '../shared/access.js';
import { stepNpcNavigation } from '../server/navigation.js';
import { Simulation } from '../server/simulation.js';

const market = BUILDINGS.find(b => b.id === 'market'), entrance = buildingEntrance(market);
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

test('Resource Exchange keeps every deed, nearby tree approach and service entrance clear', () => {
  assert.deepEqual(entrance, { x: 9.45, z: -86 }); assert.ok(canStand(entrance.x, entrance.z, 1));
  assert.ok(canUseBuilding(entrance, market));
  for (const plot of PLOTS) assert.ok(Math.abs(plot.x - market.x) >= (plot.w + market.w) / 2 + 2.5 || Math.abs(plot.z - market.z) >= (plot.d + market.d) / 2 + 2.5, plot.id);
  for (const building of BUILDINGS) { const point = buildingEntrance(building); assert.ok(canStand(point.x, point.z), building.id); }
  for (const node of RESOURCES.filter(n => distance(n, market) < 25)) {
    for (let i = 0; i < 24; i++) {
      const angle = i * Math.PI / 12, point = { x: node.x + Math.sin(angle) * 1.6, z: node.z + Math.cos(angle) * 1.6 };
      assert.ok(canStand(point.x, point.z, .48), `${node.id} remains harvestable around its full trunk`);
      assert.ok(clearResourceSegment(point, node), `${node.id} remains outside the new facade`);
    }
  }
});

test('workers can reach the exchange from bank and cave without cutting through structures', () => {
  for (const start of [buildingEntrance(BUILDINGS.find(b => b.id === 'bank')), CAVE_ROUTE.at(-1)]) {
    const worker = { ...start, yaw: 0, hp: 100 }, route = [];
    for (let i = 0; i < 2200 && distance(worker, entrance) > .5; i++) {
      const before = { ...worker };
      stepNpcNavigation(worker, entrance, 3.5, .1, []);
      assert.ok(canStand(worker.x, worker.z, .4)); assert.ok(distance(before, worker) <= .36, 'navigation stays continuous');
      route.push({ x: worker.x, z: worker.z });
    }
    assert.ok(canUseBuilding(worker, market), `route from ${start.x},${start.z} arrived at ${worker.x},${worker.z}`);
    if (start.z < -132) assert.ok(route.some(p => p.z > -133 && p.z < -131 && Math.abs(p.x) < 6), 'cave deliveries leave through the north opening');
  }
});

test('rejoining relocates a saved resident and loaded cargo displaced by the new market footprint', () => {
  let saved;
  const account = { id: 'resident', name: 'Resident', bank: 71, debt: 0, credit: 0 };
  const store = { loadVillages: () => saved ? [structuredClone(saved)] : [], saveVillage(v) { saved = structuredClone(v); }, transaction: fn => fn(), initialWallet: () => 10, account: () => account };
  const sim = new Simulation(store), { id } = sim.create('Market migration', account), player = sim.join(id, account), v = sim.villages.get(id);
  Object.assign(player, { x: market.x, z: market.z, wallet: 123 }); player.inventory.coal = 7;
  v.workers.push({ id: 'saved-worker', ownerId: player.id, x: market.x, z: market.z, cargo: { stone: 5 }, paused: true, paidWorkSeconds: 17 });
  const treasury = v.treasury; store.saveVillage(v);
  const restoredSim = new Simulation(store); restoredSim.join(id, account);
  const restored = restoredSim.villages.get(id), resident = restored.players[player.id], worker = restored.workers[0];
  assert.ok(canStand(resident.x, resident.z)); assert.ok(canStand(worker.x, worker.z));
  assert.equal(resident.wallet, 123); assert.equal(resident.inventory.coal, 7); assert.equal(account.bank, 71); assert.equal(restored.treasury, treasury);
  assert.equal(worker.cargo.stone, 5); assert.equal(worker.paidWorkSeconds, 17); assert.equal(restored.plots.length, 48);
});
