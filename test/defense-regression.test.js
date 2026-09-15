import test from 'node:test';
import assert from 'node:assert/strict';
import { plotEntrance } from '../shared/access.js';
import { Simulation } from '../server/simulation.js';
import { careSnapshot } from '../server/care-defense.js';
import { PLOTS, GUARD_ROAD } from '../shared/world.js';
import { TOWER_STATS, RECRUIT } from '../shared/defense.js';

function fixture() {
  const saved = new Map(), account = { id: 'defender', name: 'Defender', bank: 0 };
  const store = {
    loadVillages: () => [...saved.values()].map(v => structuredClone(v)),
    saveVillage: village => saved.set(village.id, structuredClone(village)),
    transaction: callback => callback(), account: () => account,
    initialWallet: () => 10
  };
  const sim = new Simulation(store);
  const { id } = sim.create('Defensive Village', account);
  const player = sim.join(id, account, 'guard'), village = sim.villages.get(id);
  const act = action => { village.clock += .7; return sim.action(id, player.id, action); };
  return { sim, store, account, village, player, act };
}

test('a normally constructed outer archer tower fires at the zombie road, then requires resupply', () => {
  const { sim, village, player, act } = fixture();
  const site = PLOTS.find(p => p.id === 'outpost-1');
  Object.assign(player, plotEntrance(site, village.plots.find(p => p.id === site.id)));
  player.wallet = 500; player.inventory.timber = 60; player.inventory.stone = 40;
  act({ kind: 'plot_buy', plotId: site.id });
  act({ kind: 'plot_build', plotId: site.id, building: 'archer_tower' });
  const plot = village.plots.find(p => p.id === site.id), arrows = TOWER_STATS.archer_tower.starterAmmo.arrows;
  assert.equal(plot.storage.arrows, arrows, 'construction supplies the initial quiver');
  village.guards = [];
  const zombie = { id: 'on-road', x: 0, z: 31, hp: 1000, maxHp: 1000, speed: 0, cooldown: 100, roadIndex: 3 };
  village.zombies = [zombie];
  const wallet = player.wallet;
  sim.tick(.05);
  assert.equal(zombie.hp, 980, 'real server LOS permits the first automatic shot');
  assert.equal(plot.storage.arrows, arrows - 1); assert.equal(player.wallet, wallet);
  assert.equal(careSnapshot(village, player.id, sim).defenseStatus[0].status, 'firing');
  for (let i = 1; i < arrows; i++) sim.tick(1.61);
  assert.equal(plot.storage.arrows, 0);
  const hp = zombie.hp;
  sim.tick(3); assert.equal(zombie.hp, hp, 'spent ammunition never regenerates for free');
  assert.equal(careSnapshot(village, player.id, sim).defenseStatus[0].status, 'empty');
  Object.assign(player, plotEntrance(site, village.plots.find(p => p.id === site.id))); player.inventory.arrows = 2;
  act({ kind: 'plot_deposit', plotId: site.id, resource: 'arrows', amount: 2 });
  sim.tick(.05); assert.equal(zombie.hp, hp - 20); assert.equal(plot.storage.arrows, 1);
});

test('public watch replacement countdown persists and stops while the village has no online players', () => {
  const { sim, store, account, village, player } = fixture();
  village.phase = 'night'; village.phaseRemaining = 200; village.waveCount = village.spawned = 0;
  village.barracks.wheat = 1;
  const fallen = village.guards[0]; fallen.hp = 0;
  village.guards[1].fedNight = village.day;
  sim.tick(.05);
  const deadline = fallen.respawnAt;
  assert.equal(deadline, village.clock + RECRUIT.respawnSeconds);
  sim.saveAll();
  const restored = new Simulation(store), recovered = restored.villages.get(village.id);
  assert.equal(recovered.guards[0].respawnAt, deadline);
  const pausedClock = recovered.clock;
  restored.tick(1000);
  assert.equal(recovered.clock, pausedClock); assert.equal(recovered.guards[0].hp, 0);
  restored.join(village.id, account, 'guard');
  restored.tick(29.9); assert.equal(recovered.guards[0].hp, 0);
  restored.tick(.1);
  const replacement = recovered.guards.find(g => g.id === fallen.id);
  assert.equal(replacement.hp, 160); assert.equal(recovered.barracks.wheat, 0);
  assert.ok(Math.hypot(replacement.x - GUARD_ROAD[0].x, replacement.z - GUARD_ROAD[0].z) < 1.1, 'the guard returns at the Watch doorway');
  assert.equal(replacement.fedNight, recovered.day); assert.equal(replacement.hungry, false);
  assert.equal(recovered.players[player.id].wallet, player.wallet);
  restored.tick(1); assert.equal(replacement.hungry, false, 'replacement ration covers the deployment');
});
