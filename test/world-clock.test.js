import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldClock } from '../public/src/world-clock.js';
import { Simulation } from '../server/simulation.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} should equal ${b}`);
const state = (phase, progress, extra = {}) => {
  const phaseDuration = phase === 'day' ? 480 : 240, clock = 700;
  return { id: 'village', phase, phaseDuration, phaseRemaining: phaseDuration * (1 - progress),
    phaseEndsAt: clock + phaseDuration * (1 - progress), clock, clockRunning: true, ...extra };
};

test('joining at sunrise, noon, sunset and midnight uses the village phase rather than browser age', () => {
  for (const [phase, progress, expected] of [['day', 0, 0], ['day', .5, .25], ['night', 0, .5], ['night', .5, .75]]) {
    const first = createWorldClock(), late = createWorldClock();
    first.ingest(state(phase, progress), 1000); late.ingest(state(phase, progress), 91000);
    near(first.sample(1000).cycle, expected); near(late.sample(91000).cycle, expected);
  }
});

test('fractional server deadlines produce smooth sky movement despite rounded HUD countdowns', () => {
  const clock = createWorldClock();
  clock.ingest(state('day', 0, { clock: 12.05, phaseRemaining: 468, phaseEndsAt: 480 }), 1000);
  near(clock.sample(1000).cycle, 12.05 / 480 * .5);
  near(clock.sample(1050).cycle, 12.10 / 480 * .5);
  clock.ingest(state('day', 0, { clock: 12.15, phaseRemaining: 468, phaseEndsAt: 480 }), 1100);
  near(clock.sample(1150).cycle, 12.20 / 480 * .5);
});

test('stale streams stop extrapolating and only server snapshots change day or night', () => {
  const clock = createWorldClock(); clock.ingest(state('day', .5), 0);
  near(clock.sample(300).time, clock.sample(30000).time);
  clock.ingest(state('day', 1 - .1 / 480), 1000);
  const end = clock.sample(9000); near(end.cycle, .5); assert.equal(end.phase, 'day');
  clock.ingest(state('night', 0), 9000); near(clock.sample(9000).cycle, end.cycle);
  clock.ingest(state('night', 1), 10000); near(clock.sample(10000).cycle, 1);
  clock.ingest(state('day', 0), 10100); near(clock.sample(10100).cycle, 0);
});

test('paused and fallen runs freeze, reconnects use saved time, and custom phase lengths are respected', () => {
  const clock = createWorldClock();
  clock.ingest(state('night', .2, { clockRunning: false }), 1000);
  assert.deepEqual(clock.sample(1000), clock.sample(50000));
  clock.reset(); assert.equal(clock.sample(0), null);
  clock.ingest(state('day', 0, { clock: 100, phaseDuration: 60, phaseEndsAt: 130 }), 50000);
  near(clock.sample(50000).cycle, .25);
  clock.ingest({ phase: 'night', clock: 400, phaseRemaining: 120, status: 'fallen' }, 100);
  near(clock.sample(10000).cycle, .75);
  assert.equal(clock.ingest({ phase: 'bad', clock: 1 }, 100), false);
});

test('server snapshots expose configured deadlines without changing saved clocks or paused simulation', () => {
  const account = { id: 'dwarf', name: 'Dwarf', bank: 0 };
  const store = { loadVillages: () => [], saveVillage() {}, transaction: fn => fn(), account: () => account, initialWallet: () => 10 };
  const sim = new Simulation(store, { daySeconds: 80, nightSeconds: 40 });
  const { id } = sim.create('Skywatch', account), village = sim.villages.get(id);
  const empty = sim.snapshot(village, account.id);
  assert.equal(empty.phaseDuration, 80); assert.equal(empty.phaseEndsAt, 80); assert.equal(empty.clockRunning, false);
  sim.tick(5); assert.equal(village.clock, 0);
  const player = sim.join(id, account); sim.tick(.15);
  const running = sim.snapshot(village, player.id);
  near(running.phaseEndsAt, 80); assert.equal(running.clockRunning, true); near(running.clock, .15);
  sim.startNight(village);
  const night = sim.snapshot(village, player.id);
  assert.equal(night.phaseDuration, 40); near(night.phaseEndsAt, 40.15);
  village.status = 'fallen'; assert.equal(sim.snapshot(village, player.id).clockRunning, false);
});
