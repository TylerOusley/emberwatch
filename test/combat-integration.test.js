import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingEntrance, plotEntrance } from '../shared/access.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.js';
import { BUILDINGS, PLOTS, canStand, plotSolids } from '../shared/world.js';
import { carryCapacity, inventoryWeight } from '../shared/content.js';

async function fixture(t, role = 'villager', companion = false) {
  const dataDir = await mkdtemp(join(tmpdir(), 'emberwatch-combat-'));
  const app = createApp({ dataDir, autoTick: false });
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  const session = await app.store.authenticate('register', 'CombatFounder', 'combat-integration-password');
  const account = app.store.accountFromToken(session.token);
  const { id } = app.simulation.create('Combat Regression', account);
  const player = app.simulation.join(id, account, role), village = app.simulation.villages.get(id);
  village.guards = []; village.phaseRemaining = 10000;
  let target;
  if (companion) {
    const other = await app.store.authenticate('register', 'CombatCompanion', 'combat-integration-password');
    target = app.simulation.join(id, app.store.accountFromToken(other.token), 'villager');
  }
  return { app, sim: app.simulation, village, player, target };
}
const enemy = (id, x, z) => ({ id, x, z, yaw: Math.PI, hp: 65, maxHp: 65, anim: 'idle', roadIndex: 4, cooldown: 0, elite: false, speed: 1.75 });

test('a zombie cannot strike a dwarf through the intact gate, but can strike after the gate falls', async t => {
  const { sim, village, player } = await fixture(t);
  Object.assign(player, { x: 0, z: 17.5 });
  village.zombies = [enemy('gate-attacker', 0, 19.1)];
  for (let i = 0; i < 18; i++) sim.tick(.05);
  assert.equal(player.hp, 100, 'an in-range zombie must respect the closed gate');
  assert.equal(village.gate.hp, village.gate.maxHp - 8, 'the zombie attacks the gate instead of becoming stuck targeting the protected dwarf');
  village.gate.hp = 0;
  for (let i = 0; i < 34; i++) sim.tick(.05);
  assert.equal(player.hp, 91, 'the same target is damageable once the intervening gate is gone');
});

test('a two-second healing channel cannot become a fast revival when its target is downed', async t => {
  const { sim, village, player, target } = await fixture(t, 'priest', true);
  Object.assign(player, { x: 0, z: 4 });
  Object.assign(target, { x: 1, z: 4, hp: 50 });
  sim.action(village.id, player.id, { kind: 'heal', targetId: target.id });
  assert.equal(player.healing.revive, false);
  sim.tick(.5); sim.hurtPlayer(village, target, 100);
  sim.tick(1.6);
  assert.equal(target.downed, true); assert.equal(target.hp, 0);
  assert.equal(player.healing, null); assert.equal(player.jobBonus, 0, 'a cancelled healing channel earns no revival bonus');
  sim.action(village.id, player.id, { kind: 'heal', targetId: target.id });
  assert.equal(player.healing.revive, true);
  sim.tick(4.9);
  assert.equal(target.downed, true, 'the replacement revival must run for its full five seconds');
  sim.tick(.2);
  assert.equal(target.downed, false); assert.equal(target.hp, 45); assert.equal(player.jobBonus, 5);
});

test('a full pack accepts a replacement wooden tool and persists its purchase', async t => {
  const { app, sim, village, player } = await fixture(t);
  const shop = BUILDINGS.find(b => b.id === 'tools');
  Object.assign(player, buildingEntrance(shop));
  player.durability.pickaxe = 0;
  player.inventory.wheat = carryCapacity(player) - inventoryWeight(player);
  assert.equal(inventoryWeight(player), carryCapacity(player));
  app.store.saveVillage(village);
  const wallet = player.wallet, treasury = village.treasury;
  sim.action(village.id, player.id, { kind: 'buyTool', tool: 'pickaxe' });
  assert.equal(player.durability.pickaxe, 100);
  assert.equal(inventoryWeight(player), carryCapacity(player) + 3);
  assert.equal(player.wallet, wallet - 10); assert.equal(village.treasury, treasury + 10);
  assert.equal(app.store.loadVillages()[0].players[player.id].durability.pickaxe, 100);
});

test('constructing a plot building relocates a zombie out of the new collision footprint', async t => {
  const { app, sim, village, player } = await fixture(t);
  const site = PLOTS[0]; Object.assign(player, plotEntrance(site, village.plots.find(p => p.id === site.id))); player.wallet = 500;
  sim.action(village.id, player.id, { kind: 'plot_buy', plotId: site.id });
  const plot = village.plots.find(p => p.id === site.id);
  // Seed gathered construction supplies; ownership, payment, construction,
  // relocation and persistence all use the real authoritative action path.
  plot.storage = { timber: 20, stone: 10 };
  const zombie = enemy('construction-obstruction', site.x, site.z);
  village.zombies.push(zombie); village.clock += .7;
  sim.action(village.id, player.id, { kind: 'plot_build', plotId: site.id, building: 'tool_shop' });
  assert.equal(plot.building, 'tool_shop');
  assert.ok(canStand(zombie.x, zombie.z, .4, plotSolids(village.plots)), 'the zombie is outside every active solid');
  assert.ok(Math.hypot(zombie.x - site.x, zombie.z - site.z) > 3, 'construction cannot imprison an enemy at its previous center position');
  assert.equal(zombie.hp, 65, 'relocation does not kill or award credit for the enemy');
  const saved = app.store.loadVillages().find(v => v.id === village.id).zombies.find(z => z.id === zombie.id);
  assert.equal(saved.x, zombie.x); assert.equal(saved.z, zombie.z);
});
