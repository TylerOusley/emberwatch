import test from 'node:test';
import assert from 'node:assert/strict';
import { canRallyAt, guardOrdersAction, guardOrdersSnapshot, guardDirective, guardOrderCanEngage } from '../server/guard-orders.js';
import { PLOTS, plotFront, canStand, plotSolids } from '../shared/world.js';
import { stepNpcNavigation } from '../server/navigation.js';
import { Simulation } from '../server/simulation.js';

const gap = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function fixture() {
  const site = PLOTS.find(p => p.id === 'west-1');
  const player = { id: 'alice', role: 'guard', online: true, hp: 100, x: -39, z: 3, yaw: 0 };
  const plot = { id: site.id, ownerId: player.id, building: 'barracks', hp: 800, storage: { wheat: 10 } };
  const guard = { id: 'troop-one', ownerId: player.id, plotId: plot.id, slot: 1, ...plotFront(site, 1), hp: 160, roadIndex: 3 };
  const village = { status: 'active', clock: 42, players: { alice: player }, plots: [plot], guards: [guard], treasury: 20000 };
  const order = mode => guardOrdersAction({}, village, player, { kind: 'guard_order', plotId: plot.id, mode });
  return { player, plot, guard, village, order };
}

test('troop commands require a living guard who owns an intact barracks', () => {
  const f = fixture(), command = { kind: 'guard_order', plotId: f.plot.id, mode: 'hold' };
  assert.equal(guardOrdersAction({}, f.village, f.player, { kind: 'gather' }), null);
  for (const patch of [{ role: 'priest' }, { role: 'villager' }, { online: false }, { downed: true }, { hp: 0 }, { mountedHorseId: 'horse' }, { bedPlotId: 'church' }, { id: 'bob' }]) {
    assert.throws(() => guardOrdersAction({}, f.village, { ...f.player, ...patch }, command));
    assert.equal(f.plot.guardOrder, undefined);
  }
  for (const patch of [{ hp: 0 }, { ownerId: 'bob' }, { building: 'house' }]) {
    assert.throws(() => guardOrdersAction({}, { ...f.village, plots: [{ ...f.plot, ...patch }] }, f.player, command));
  }
  assert.throws(() => f.order('constructor'));
  assert.throws(() => guardOrdersAction({}, { ...f.village, status: 'fallen' }, f.player, command));
  f.order('hold'); assert.equal(f.plot.guardOrder.mode, 'hold');
});

test('Hold here uses authoritative coordinates and rejects solid, non-finite or disconnected terrain', () => {
  const f = fixture();
  guardOrdersAction({}, f.village, f.player, { kind: 'guard_order', plotId: f.plot.id, mode: 'hold', x: 100000, z: Infinity });
  assert.deepEqual(f.plot.guardOrder, { mode: 'hold', ownerId: f.player.id, x: f.player.x, z: f.player.z });
  for (const point of [{ x: NaN, z: 0 }, { x: 0, z: Infinity }, { x: 200, z: 90 }, { x: 60, z: 18 }, { x: -50, z: 3 }, { x: 96, z: -80 }, { x: 0, z: -140 }]) {
    assert.equal(canRallyAt(f.village, point), false);
    assert.throws(() => guardOrdersAction({}, f.village, { ...f.player, ...point }, { kind: 'guard_order', plotId: f.plot.id, mode: 'hold' }));
  }
  assert.equal(canRallyAt(f.village, { x: 45, z: 70 }), true);
  assert.equal(canRallyAt(f.village, { x: 0, z: 18 }), true);
});

test('hold and follow fight within their rally leash; retreat does not chase into the horde', () => {
  const f = fixture(); Object.assign(f.player, { x: 0, z: 38 }); Object.assign(f.guard, { x: 0, z: 42 }); f.order('hold');
  const directive = guardDirective(f.village, f.guard);
  assert.equal(guardOrderCanEngage(f.guard, { x: 0, z: 45, hp: 20 }, directive), true);
  assert.equal(guardOrderCanEngage(f.guard, { x: 0, z: 50, hp: 20 }, directive), false, 'nearby target outside rally leash is ignored');
  assert.equal(guardOrderCanEngage(f.guard, { x: 0, z: 45, hp: 0 }, directive), false);
  f.order('retreat');
  assert.equal(guardOrderCanEngage(f.guard, { x: 0, z: 44, hp: 20 }, guardDirective(f.village, f.guard)), false);
  Object.assign(f.guard, { x: -39, z: 14 }); Object.assign(f.player, { x: -39, z: 14 }); f.order('hold');
  assert.equal(guardOrderCanEngage(f.guard, { x: -39, z: 21, hp: 20 }, guardDirective(f.village, f.guard)), false, 'wall separation takes priority over attack range');
});

test('follow retreats safely when the owner falls, leaves, mounts, or enters unreachable side terrain', () => {
  const f = fixture(); f.order('follow');
  let directive = guardDirective(f.village, f.guard);
  assert.equal(directive.mode, 'follow'); assert.ok(gap(directive.anchor, f.player) < 4);
  for (const patch of [{ online: false }, { downed: true }, { hp: 0 }, { mountedHorseId: 'horse' }, { bedPlotId: 'church' }, { role: 'villager' }, { x: 96, z: -80 }]) {
    const village = { ...f.village, players: { alice: { ...f.player, ...patch } } };
    directive = guardDirective(village, f.guard);
    assert.equal(directive.mode, 'retreat'); assert.equal(directive.requestedMode, 'follow');
    assert.equal(directive.fallback, 'Owner unavailable'); assert.ok(gap(directive.anchor, plotFront(PLOTS.find(p => p.id === f.plot.id), 1)) < .1);
  }
  assert.equal(guardDirective(f.village, f.guard).mode, 'follow', 'valid owner return resumes the saved follow order');
});

test('saved barracks orders survive reload and replacements; snapshots reveal only the owner’s rallies', () => {
  const f = fixture(); f.order('hold');
  const restored = JSON.parse(JSON.stringify(f.village));
  const replacement = { ...restored.guards[0], id: 'replacement', x: -44, z: 3 };
  assert.deepEqual(guardDirective(restored, replacement).anchor, { x: f.player.x, z: f.player.z });
  const snapshot = guardOrdersSnapshot(restored, 'alice');
  assert.equal(snapshot.guardOrders.length, 1); assert.equal(snapshot.guardOrders[0].mode, 'hold');
  assert.equal(snapshot.guardOrders[0].livingTroops, 1);
  assert.deepEqual(guardOrdersSnapshot(restored, 'bob'), { guardOrders: [] });
  restored.players.bob = { id: 'bob', role: 'guard' }; assert.deepEqual(guardOrdersSnapshot(restored, 'bob'), { guardOrders: [] });
  restored.players.alice.role = 'priest'; assert.deepEqual(guardOrdersSnapshot(restored, 'alice'), { guardOrders: [] });
  assert.equal(f.village.treasury, 20000); assert.deepEqual(f.plot.storage, { wheat: 10 }, 'issuing remote orders buys or consumes nothing');
});

test('public Watch and old saves keep their original road defense behavior', () => {
  const f = fixture(), watch = { id: 'watch-0', hp: 160, x: 0, z: 35 };
  assert.equal(guardDirective(f.village, f.guard), null);
  f.order('follow'); assert.equal(guardDirective(f.village, watch), null);
  assert.equal(guardOrderCanEngage(watch, { x: 0, z: 40, hp: 10 }, null), true);
  assert.equal(guardOrderCanEngage({ ...watch, z: 54 }, { x: 0, z: 56, hp: 10 }, null), false);
  f.order('defend'); assert.equal(guardDirective(f.village, f.guard), null);
  f.plot.guardOrder = { mode: 'hold', ownerId: 'previous-owner', x: 0, z: 80 };
  assert.equal(guardDirective(f.village, f.guard), null, 'orders from a previous owner cannot redirect troops');
});

test('rally blocked by new construction falls back home without walking into the building', () => {
  const f = fixture(), site = PLOTS.find(p => p.id === 'east-2');
  Object.assign(f.player, { x: site.x, z: site.z }); f.order('hold');
  f.village.plots.push({ id: site.id, ownerId: 'bob', building: 'house', hp: 300 });
  const directive = guardDirective(f.village, f.guard);
  assert.equal(directive.mode, 'retreat'); assert.equal(directive.fallback, 'Rally point blocked');
  assert.ok(canStand(directive.anchor.x, directive.anchor.z, .4, plotSolids(f.village.plots)));
});

test('ordered troops walk out through the gate and back home without crossing walls or teleporting', () => {
  const f = fixture(), solids = plotSolids(f.village.plots); Object.assign(f.player, { x: 25, z: 45 }); f.order('hold');
  let crossedOut = false, crossedIn = false;
  function walk(seconds, outbound) {
    for (let i = 0; i < seconds / .05; i++) {
      const directive = guardDirective(f.village, f.guard), before = { x: f.guard.x, z: f.guard.z };
      if (gap(f.guard, directive.anchor) < .25) return;
      stepNpcNavigation(f.guard, directive.destination, 3, .05, [f.guard], solids);
      assert.ok(canStand(f.guard.x, f.guard.z, .4, solids), 'all positions respect collision');
      assert.ok(gap(before, f.guard) <= 3 * .05 * 1.15 + 1e-8, 'no teleport');
      if ((before.z < 18) !== (f.guard.z < 18)) {
        assert.ok(Math.abs(f.guard.x) < 4, 'the shared gate is the only wall crossing');
        if (outbound) crossedOut = true; else crossedIn = true;
      }
    }
    assert.fail('Troop did not reach its ordered destination');
  }
  walk(90, true); assert.equal(crossedOut, true);
  f.order('retreat'); walk(90, false); assert.equal(crossedIn, true);
  assert.ok(gap(f.guard, plotFront(PLOTS.find(p => p.id === f.plot.id), 1)) < .25);
});

test('real simulation dispatches, saves, restores and snapshots guard orders without taking over the public Watch', () => {
  const saved = new Map(), account = { id: 'alice', name: 'Alice', bank: 0 };
  const store = { loadVillages: () => [...saved.values()].map(v => structuredClone(v)), saveVillage: v => saved.set(v.id, structuredClone(v)),
    transaction: fn => fn(), account: () => account, initialWallet: () => 10 };
  const sim = new Simulation(store), { id } = sim.create('Orders Test', account), player = sim.join(id, account, 'guard'), village = sim.villages.get(id);
  const plot = village.plots.find(p => p.id === 'west-1'); Object.assign(plot, { ownerId: player.id, building: 'barracks', hp: 800, storage: { wheat: 10 } });
  const guard = { id: 'recruited', ownerId: player.id, plotId: plot.id, slot: 1, ...plotFront(PLOTS.find(p => p.id === plot.id), 1), hp: 160, maxHp: 160, cooldown: 0, roadIndex: 0 };
  village.guards.push(guard); village.clock += 1; Object.assign(player, { x: 0, z: 35 });
  sim.action(id, player.id, { kind: 'guard_order', plotId: plot.id, mode: 'hold' });
  assert.equal(saved.get(id).plots.find(p => p.id === plot.id).guardOrder.mode, 'hold');
  assert.equal(sim.snapshot(village, player.id).guardOrders[0].mode, 'hold');
  assert.equal(sim.snapshot(village, 'not-the-owner').guardOrders.length, 0);
  const restored = new Simulation(store), loaded = restored.villages.get(id), clock = loaded.clock;
  restored.tick(10); assert.equal(loaded.clock, clock, 'orders do not run a paused empty village');
  restored.join(id, account, 'guard');
  const commanded = loaded.guards.find(g => g.id === guard.id), before = { x: commanded.x, z: commanded.z };
  restored.tick(.05); assert.ok(gap(commanded, before) > 0, 'integrated tick obeys the saved rally order');
  assert.equal(guardDirective(loaded, loaded.guards.find(g => g.id === 'watch-0')), null);
  assert.equal(guardDirective(loaded, commanded).requestedMode, 'hold');
});
