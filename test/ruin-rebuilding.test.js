import test from 'node:test';
import assert from 'node:assert/strict';
import { careAction, careTick, careSnapshot, ensureCare } from '../server/care-defense.js';
import { BUILDING_TYPES, TOOL_TIERS } from '../shared/content.js';
import { PLOTS, plotSolids } from '../shared/world.js';
import { plotEntrance } from '../shared/access.js';

function fixture(building = 'cannon') {
  const site = PLOTS.find(p => p.id === 'west-1');
  const owner = { id: 'owner', name: 'Owner', role: 'guard', online: false, inventory: {}, wallet: 500 };
  const helper = { id: 'helper', name: 'Helper', role: 'villager', online: true, downed: false, wallet: 0, tool: 'hammer', tiers: { hammer: 'wood' }, durability: { hammer: 100 }, inventory: { timber: 30, stone: 30 }, repairBonus: 0, ...plotEntrance(site, building) };
  const plot = { id: site.id, ownerId: owner.id, building, hp: 0, maxHp: Math.ceil(BUILDING_TYPES[building].maxHp * 1.5), level: 2, storage: { timber: 123, stone: 87, coal: 7, sulfur: 6, iron: 9, wheat: 12, musket_ammo: 15 }, shopPrices: { musket_ammo: 73 }, rebuildProgress: 0 };
  const village = { id: 'village', clock: 0, day: 1, phase: 'day', players: { owner, helper }, plots: [plot], guards: [], zombies: [], gate: { hp: 1200 }, treasury: 0, stock: { timber: 20, stone: 20 }, barracks: { wheat: 0 } };
  const events = { relocated: 0, hits: 0, saved: 0 };
  const sim = { inputs: new Map(), store: { saveVillage() { events.saved++; } }, relocateBlocked() { events.relocated++; }, clearAttack() { return true; }, hitZombie() { events.hits++; } };
  ensureCare(village);
  const hit = () => careAction(sim, village, helper, { kind: 'repairPlot', plotId: plot.id });
  return { village, plot, helper, owner, site, sim, events, hit };
}

test('every built plot can be reconstructed by a visitor while retaining its owner, level, prices and stock', () => {
  for (const building of Object.keys(BUILDING_TYPES)) {
    const { village, plot, helper, owner, events, hit } = fixture(building);
    const stored = structuredClone(plot.storage), prices = structuredClone(plot.shopPrices), threshold = Math.ceil(plot.maxHp * .35);
    const swings = Math.ceil(threshold / TOOL_TIERS.wood.repair);
    for (let i = 1; i <= swings; i++) {
      hit();
      if (i < swings) {
        assert.equal(plot.hp, 0, `${building} must remain inactive before the structural threshold`);
        assert.equal(plot.rebuildProgress, i * TOOL_TIERS.wood.repair);
      }
    }
    assert.equal(plot.hp, swings * TOOL_TIERS.wood.repair, building);
    assert.equal(plot.rebuildProgress, 0); assert.equal(plot.level, 2); assert.equal(plot.ownerId, owner.id); assert.equal(plot.building, building);
    assert.deepEqual(plot.storage, stored, `${building} must not receive repeated starter stock`); assert.deepEqual(plot.shopPrices, prices);
    assert.equal(helper.inventory.timber, 30 - swings); assert.equal(helper.inventory.stone, 30 - swings); assert.equal(helper.durability.hammer, 100 - swings);
    assert.equal(helper.wallet, 0); assert.equal(helper.repairBonus, 0); assert.equal(village.treasury, 0);
    assert.deepEqual(village.stock, { timber: 20, stone: 20 }); assert.equal(events.relocated, 1);
  }
});

test('partial reconstruction survives reload, leaves no solid building and cannot fire before completion', () => {
  const context = fixture(), { village, plot, sim, helper, site, hit, events } = context;
  village.zombies.push({ id: 'target', x: site.x + 10, z: site.z, hp: 100 });
  hit(); assert.equal(plot.hp, 0); assert.equal(plotSolids(village.plots).length, 0);
  careTick(sim, village, .5); assert.equal(events.hits, 0); assert.equal(plot.storage.coal, 7);
  const loaded = JSON.parse(JSON.stringify(village)); ensureCare(loaded);
  const savedPlot = loaded.plots[0], savedHelper = loaded.players.helper;
  assert.equal(savedPlot.rebuildProgress, 35);
  while (!savedPlot.hp) careAction(sim, loaded, savedHelper, { kind: 'repairPlot', plotId: savedPlot.id });
  assert.equal(plotSolids(loaded.plots).length, 1, 'solid building returns only after reconstruction');
  careTick(sim, loaded, .5);
  assert.equal(events.hits, 1); assert.equal(savedPlot.storage.coal, 6); assert.equal(savedPlot.storage.stone, 86);
  assert.equal(careSnapshot(loaded, helper.id, sim).defenseStatus[0].status, 'firing');
});

test('reconstruction uses carried material first, then shared stock, and rejects unaffordable work without progress', () => {
  const { village, plot, helper, hit } = fixture('house');
  helper.inventory = { timber: 1, stone: 1 }; helper.tiers.hammer = 'iron';
  hit(); assert.equal(plot.rebuildProgress, 80); assert.equal(village.stock.timber, 20);
  hit(); assert.equal(plot.rebuildProgress, 160); assert.equal(village.stock.timber, 19); assert.equal(village.stock.stone, 19);
  helper.inventory = { timber: 1, stone: 1 }; helper.boundInventory = { timber: 1, stone: 1 }; village.stock = { timber: 0, stone: 0 };
  const before = JSON.stringify({ plot, helper });
  assert.throws(hit, /one timber and one stone/);
  assert.equal(JSON.stringify({ plot, helper }), before, 'bound kit supplies and all reconstruction state remain untouched');
});

test('a nearby working hammer and standing helper are required; empty demolished plots cannot be resurrected', () => {
  const { village, plot, helper, hit } = fixture();
  village.plots.push({ id: 'bed', building: 'church', ownerId: 'owner', hp: 300, patients: [{ playerId: helper.id }] });
  for (const [field, value, message] of [['downed', true, /living/], ['online', false, /living/], ['tool', 'pickaxe', /working hammer/], ['mountedHorseId', 'horse', /Dismount/], ['carryingId', 'other', /companion/], ['bedPlotId', 'bed', /church bed/]]) {
    const before = helper[field]; helper[field] = value;
    assert.throws(hit, message); helper[field] = before;
  }
  helper.durability.hammer = 0; assert.throws(hit, /working hammer/); helper.durability.hammer = 100;
  helper.x += 30; assert.throws(hit, /closer/); helper.x -= 30;
  assert.equal(plot.hp, 0); assert.equal(plot.rebuildProgress, 0); assert.equal(helper.inventory.timber, 30);
  plot.building = null; assert.throws(hit, /standing building/);
  assert.equal(plot.hp, 0); assert.equal(helper.durability.hammer, 100);
});

test('ruined barracks retain paid troop identities, upgrades and dead slots, then resume funded replacements', () => {
  const { village, plot, sim, owner, hit } = fixture('barracks');
  village.guards.push(
    { id: 'veteran', plotId: plot.id, ownerId: owner.id, slot: 0, unitType: 'musketeer', troopLevel: 2, hp: 180, x: 0, z: 0 },
    { id: 'casualty', plotId: plot.id, ownerId: owner.id, slot: 1, unitType: 'archer', troopLevel: 2, hp: 0, x: 0, z: 0, respawnAt: 5 }
  );
  const wheat = plot.storage.wheat;
  village.clock = 100; careTick(sim, village, .5);
  assert.equal(village.guards.length, 2); assert.equal(village.guards[1].hp, 0); assert.equal(plot.storage.wheat, wheat);
  while (!plot.hp) hit();
  careTick(sim, village, .5);
  assert.deepEqual(village.guards.map(g => [g.id, g.slot, g.unitType, g.troopLevel]), [['veteran', 0, 'musketeer', 2], ['casualty', 1, 'archer', 2]]);
  assert.equal(village.guards[1].hp, 160); assert.equal(plot.storage.wheat, wheat - 1);
  plot.building = null; careTick(sim, village, .5);
  assert.equal(village.guards.length, 0, 'intentional demolition still ends that barracks roster');
});
