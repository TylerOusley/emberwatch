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

test('real simulation fires trained barracks muskets, snapshots the shot and persists ammunition and troop type', () => {
  const { sim, store, account, village, player, act } = fixture();
  const plot = village.plots.find(p => p.id === 'outpost-1'), site = PLOTS.find(p => p.id === plot.id);
  Object.assign(plot, { ownerId: player.id, building: 'barracks', level: 2, hp: 975, maxHp: 975, storage: { timber: 100, iron: 100, wheat: 10, musket_ammo: 2 } });
  Object.assign(player, plotEntrance(site, plot)); player.wallet = 1000;
  village.guards = [];
  act({ kind: 'recruitGuard', plotId: plot.id, unitType: 'musketeer' });
  const guard = village.guards[0];
  act({ kind: 'upgradeTroop', plotId: plot.id, guardId: guard.id });
  Object.assign(guard, { x: 0, z: 35, yaw: 0 });
  const zombie = { id: 'ranged-target', x: 0, z: 49, hp: 1000, maxHp: 1000, speed: 0, cooldown: 100, roadIndex: 3 };
  village.zombies = [zombie];
  sim.tick(.05);
  assert.equal(zombie.hp, 936); assert.equal(plot.storage.musket_ammo, 1);
  const shot = sim.snapshot(village, player.id).guards.find(g => g.id === guard.id);
  assert.equal(shot.unitType, 'musketeer'); assert.equal(shot.troopLevel, 2); assert.equal(shot.tool, 'musket'); assert.equal(shot.lastShot.kind, 'musket');
  sim.saveAll();
  const restored = new Simulation(store), recovered = restored.villages.get(village.id);
  restored.join(village.id, account, 'guard');
  const loaded = recovered.guards.find(g => g.id === guard.id);
  assert.equal(loaded.troopLevel, 2); assert.equal(loaded.unitType, 'musketeer'); assert.equal(loaded.damage, 64);
  assert.equal(recovered.plots.find(p => p.id === plot.id).storage.musket_ammo, 1);
  restored.tick(.05); assert.equal(recovered.zombies[0].hp, 936, 'saved cooldown prevents a second immediate shot');
  const restoredPlot = recovered.plots.find(p => p.id === plot.id);
  restoredPlot.storage.musket_ammo = 0; restoredPlot.guardOrder = { ownerId: player.id, mode: 'follow' };
  Object.assign(recovered.players[player.id], { x: 0, z: 42, yaw: 0 });
  loaded.attackUntil = 0; const beforeZ = loaded.z;
  restored.tick(.05);
  assert.ok(loaded.z > beforeZ, 'an empty musket continues following orders despite a distant enemy');
});

test('new and saved empty archer towers fire without resupply and preserve stored arrows', () => {
  const { sim, store, village, player, act, account } = fixture();
  const site = PLOTS.find(p => p.id === 'outpost-1');
  Object.assign(player, plotEntrance(site, village.plots.find(p => p.id === site.id)));
  player.wallet = 500; player.inventory.timber = 60; player.inventory.stone = 40;
  act({ kind: 'plot_buy', plotId: site.id });
  act({ kind: 'plot_build', plotId: site.id, building: 'archer_tower' });
  const plot = village.plots.find(p => p.id === site.id);
  assert.equal(plot.storage.arrows ?? 0, 0, 'construction no longer grants a quiver');
  village.guards = [];
  const zombie = { id: 'on-road', x: 0, z: 31, hp: 1000, maxHp: 1000, speed: 0, cooldown: 100, roadIndex: 3 };
  village.zombies = [zombie];
  const wallet = player.wallet;
  sim.tick(.05);
  assert.equal(zombie.hp, 980, 'real server LOS permits the first automatic shot');
  assert.equal(plot.storage.arrows ?? 0, 0); assert.equal(player.wallet, wallet);
  assert.equal(careSnapshot(village, player.id, sim).defenseStatus[0].status, 'firing');
  for (let i = 0; i < 24; i++) sim.tick(1.61);
  assert.equal(zombie.hp, 500, 'firing continues beyond the old starter quiver');
  assert.equal(careSnapshot(village, player.id, sim).defenseStatus[0].unlimitedAmmo, true);
  sim.saveAll();
  const restored = new Simulation(store), recovered = restored.villages.get(village.id);
  restored.join(village.id, account, 'guard');
  restored.tick(1.61);
  assert.equal(recovered.zombies[0].hp, 480, 'a saved empty tower fires after reconnect');
  const savedPlot = recovered.plots.find(p => p.id === site.id);
  savedPlot.storage.arrows = 7;
  restored.tick(1.61);
  assert.equal(recovered.zombies[0].hp, 460); assert.equal(savedPlot.storage.arrows, 7, 'old ammunition remains withdrawable cargo');
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
