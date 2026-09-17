import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureEnvironment, tickEnvironment, environmentSnapshot } from '../server/environment.js';
import { ENVIRONMENT_TIMING, SEASONS, VILLAGE_EVENTS, environmentRegrowMultiplier, environmentYieldMultiplier } from '../shared/environment.js';
import { productionHarvest, productionRegrowSeconds, productionYield, productionNodeCapacity } from '../shared/production.js';
import { saleUnitPrice, purchaseQuote } from '../shared/market.js';
import { ensureOwnership, ownershipAction } from '../server/ownership.js';

const fixture = () => ({ id: 'season-test-village', clock: 0, status: 'active', players: { owner: { id: 'owner', online: true, inventory: { wheat: 50, timber: 50 }, wallet: 200 } }, plots: [{ id: 'private', storage: { wheat: 80, coal: 80 } }], stock: { wheat: 2000, timber: 2000, coal: 2000, stone: 2000, iron: 2000 } });
function forceEvent(village, type, duration = 600) {
  const state = ensureEnvironment(village); state.event = { id: 1, type, startedAt: state.elapsed, endsAt: state.elapsed + duration, consumed: {}, delivered: {} };
  state.nextEventAt = state.elapsed + 4500;
  return state;
}

test('environment initializes old villages once and persists exact schedule through reload and empty time', () => {
  const village = fixture(), state = ensureEnvironment(village);
  assert.equal(state.nextSeasonAt, 3600);
  assert.ok(state.nextEventAt >= 600 && state.nextEventAt <= 900);
  tickEnvironment(village, 123.5);
  const before = JSON.stringify(village.environment), restored = JSON.parse(JSON.stringify(village));
  ensureEnvironment(restored); assert.equal(JSON.stringify(restored.environment), before);
  restored.players.owner.online = false; tickEnvironment(restored, 50000);
  assert.equal(JSON.stringify(restored.environment), before);
  restored.players.owner.online = true; tickEnvironment(restored, 10);
  assert.equal(restored.environment.elapsed, 133.5);
  assert.equal(restored.environment.nextEventAt, state.nextEventAt);
});

test('seasons follow the selected one-hour active-time cycle and accept a persisted configurable duration', () => {
  const village = fixture(); ensureEnvironment(village);
  for (const season of ['spring', 'summer', 'autumn', 'winter', 'spring']) {
    assert.equal(environmentSnapshot(village).season, season);
    assert.equal(environmentSnapshot(village).seasonRemaining, 3600);
    tickEnvironment(village, 3600);
  }
  const configured = fixture(); ensureEnvironment(configured, { seasonSeconds: 1800 }); tickEnvironment(configured, 1800);
  assert.equal(environmentSnapshot(configured).season, 'summer');
  assert.equal(environmentSnapshot(configured).seasonSeconds, 1800);
});

test('large and small ticks agree on seasons, weather, events and public consumption', () => {
  const whole = fixture(), sliced = fixture();
  tickEnvironment(whole, 16000);
  for (let i = 0; i < 1600; i++) tickEnvironment(sliced, 10);
  assert.deepEqual(whole.environment, sliced.environment);
  assert.deepEqual(whole.stock, sliced.stock);
});

test('one shared event lasts ten to fifteen minutes and starts every forty-five to seventy-five minutes without recent repeats', () => {
  const village = fixture(), state = ensureEnvironment(village), types = [];
  for (let i = 0; i < 30; i++) {
    tickEnvironment(village, state.nextEventAt - state.elapsed);
    const event = state.event;
    assert.ok(event, `event ${i} starts on its scheduled boundary`);
    assert.ok(event.endsAt - event.startedAt >= 600 && event.endsAt - event.startedAt <= 900);
    assert.ok(state.nextEventAt - event.startedAt >= 2700 && state.nextEventAt - event.startedAt <= 4500);
    assert.ok(!types.slice(-2).includes(event.type)); types.push(event.type);
    assert.equal(environmentSnapshot(village).event.id, event.id);
    tickEnvironment(village, event.endsAt - state.elapsed);
    assert.equal(state.event, null);
  }
  assert.deepEqual(new Set(types), new Set(Object.keys(VILLAGE_EVENTS)));
});

test('caravan delivery happens only once and changes actual stock quotes without adding another price multiplier', () => {
  const village = fixture(); village.stock = { wheat: 20, timber: 20, iron: 20, coal: 20 };
  const state = ensureEnvironment(village); state.seed = 1; state.nextEventAt = 1;
  const beforePrice = saleUnitPrice('iron', village.stock.iron);
  tickEnvironment(village, 1);
  assert.equal(state.event.type, 'merchant_caravan');
  assert.deepEqual(village.stock, { wheat: 140, timber: 120, iron: 80, coal: 70 });
  assert.equal(state.event.delivered.iron, 60);
  assert.ok(saleUnitPrice('iron', village.stock.iron) < beforePrice);
  const restored = JSON.parse(JSON.stringify(village));
  for (let i = 0; i < 10; i++) { ensureEnvironment(restored); environmentSnapshot(restored); }
  assert.deepEqual(restored.stock, village.stock);
  assert.ok(purchaseQuote('iron', restored.stock.iron, 1) > saleUnitPrice('iron', restored.stock.iron));
});

test('festival, construction and cold snap have bounded real public demand and never take private goods', () => {
  for (const [type, expected] of [
    ['village_festival', { wheat: 30, timber: 10, coal: 5 }],
    ['construction_boom', { timber: 30, coal: 5, stone: 20, iron: 10 }],
    ['cold_snap', { timber: 40, coal: 15 }]
  ]) {
    const village = fixture(), state = forceEvent(village, type), privateBefore = JSON.stringify({ players: village.players, plots: village.plots });
    tickEnvironment(village, 600);
    assert.equal(state.event, null);
    for (const [resource, amount] of Object.entries(expected)) assert.equal(village.stock[resource], 2000 - amount, `${type} ${resource}`);
    assert.equal(JSON.stringify({ players: village.players, plots: village.plots }), privateBefore);
    const after = { ...village.stock }; tickEnvironment(village, 60);
    for (const resource of ['wheat', 'iron', 'stone']) assert.equal(village.stock[resource], after[resource]);
  }
  const empty = fixture(); empty.stock = { wheat: 1, timber: 1, coal: 0 }; forceEvent(empty, 'cold_snap'); tickEnvironment(empty, 900);
  assert.ok(Object.values(empty.stock).every(amount => Number.isSafeInteger(amount) && amount >= 0));
});

test('winter public fuel use rises thirty percent and fractional consumption survives a restart', () => {
  const village = fixture(), state = ensureEnvironment(village); state.seasonIndex = 3; state.nextEventAt = 10000;
  tickEnvironment(village, 600);
  assert.equal(village.stock.timber, 1987); assert.equal(village.stock.coal, 1994);
  const loaded = JSON.parse(JSON.stringify(village)); tickEnvironment(loaded, 600);
  assert.equal(loaded.stock.timber, 1974); assert.equal(loaded.stock.coal, 1987);
  assert.equal(environmentSnapshot(loaded).publicUpkeep.coal, .65);
});

test('seasonal production keeps baseline mining and applies interval and yield effects once', () => {
  assert.equal(productionRegrowSeconds('wheat'), 90);
  assert.equal(productionRegrowSeconds('wheat', null, { seasonIndex: 0 }), 72);
  assert.equal(productionRegrowSeconds('timber', null, { seasonIndex: 0 }), 135);
  assert.equal(productionRegrowSeconds('wheat', null, { seasonIndex: 3 }), 112.5);
  for (let seasonIndex = 0; seasonIndex < 4; seasonIndex++) {
    for (const type of ['stone', 'iron', 'coal', 'sulfur']) assert.equal(environmentRegrowMultiplier({ seasonIndex }, type), 1);
  }
  assert.equal(environmentYieldMultiplier({ seasonIndex: 2 }, 'wheat'), 1.25);
  assert.equal(environmentYieldMultiplier({ seasonIndex: 2, event: { type: 'bumper_harvest' } }, 'wheat'), 1.875);
  assert.equal(environmentYieldMultiplier({ seasonIndex: 1, event: { type: 'rich_ore' } }, 'iron'), 1.5);
  assert.equal(environmentYieldMultiplier({ seasonIndex: 1, event: { type: 'rich_ore' } }, 'sulfur'), 1);
  assert.equal(productionNodeCapacity('sulfur', { building: 'mine', level: 3 }), 16);
});

test('one-unit worker harvests receive fractional bonuses without fractional inventory or lost upgrade bonuses', () => {
  let remainder = 0, total = 0;
  for (let i = 0; i < 4; i++) { const harvest = productionHarvest(1, null, 'wheat', { seasonIndex: 2 }, remainder); total += harvest.yield; remainder = harvest.remainder; assert.ok(Number.isSafeInteger(harvest.yield)); }
  assert.equal(total, 5); assert.equal(remainder, 0);
  const plot = { building: 'mine', level: 3 }, boosted = productionHarvest(2, plot, 'iron', { event: { type: 'rich_ore' } });
  assert.equal(boosted.yield, productionYield(2, plot) * 1.5);
  assert.deepEqual(productionHarvest(1, null, 'wheat', null, NaN), { yield: 1, remainder: 0 });
});

test('failed player harvests preserve seasonal carry and successful gathers use season regrowth', () => {
  const village = fixture(), player = village.players.owner;
  Object.assign(player, { role: 'villager', tool: 'scythe', durability: { scythe: 100 }, tiers: { scythe: 'wood' }, inventory: {}, environmentYieldRemainders: { wheat: .75 } });
  village.guards = []; village.plots = []; village.environment = { seasonIndex: 2 };
  ensureOwnership(village);
  const plot = village.plots[0]; Object.assign(plot, { ownerId: player.id, building: 'wheat_farm', level: 1, hp: 100, maxHp: 100 }); ensureOwnership(village);
  const node = village.plotResources.find(item => item.type === 'wheat'); Object.assign(player, { x: node.x, z: node.z });
  player.inventory.stone = 1000;
  assert.throws(() => ownershipAction({}, village, player, { kind: 'gather', targetId: node.id }), /pack is full/);
  assert.equal(player.environmentYieldRemainders.wheat, .75); assert.equal(node.remaining, 1);
  player.inventory.stone = 0;
  ownershipAction({}, village, player, { kind: 'gather', targetId: node.id });
  assert.equal(player.inventory.wheat, 2); assert.equal(player.environmentYieldRemainders.wheat, 0);
  assert.equal(node.regrowAt, productionRegrowSeconds('wheat', plot, village.environment));
});

test('environment snapshots expose explanations and cloned event data without disclosing the random seed', () => {
  const village = fixture(); forceEvent(village, 'construction_boom'); const snapshot = environmentSnapshot(village);
  assert.equal(snapshot.seasonDescription, SEASONS[0].description);
  assert.match(snapshot.event.description, /2 timber, 2 stone and 1 iron/);
  assert.equal(snapshot.seed, undefined); snapshot.event.consumed.iron = 500;
  assert.equal(village.environment.event.consumed.iron, undefined);
  assert.equal(ENVIRONMENT_TIMING.seasonSeconds, 3600);
});
