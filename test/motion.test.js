import test from 'node:test';
import assert from 'node:assert/strict';
import { PoseBuffer } from '../public/src/motion.js';

const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be near ${expected}`);
const push = (buffer, time, x, z = 0, yaw = 0, anim = 'walk') => buffer.push({ x, z, yaw, anim }, time);

test('remote pose playback moves continuously between 10 Hz snapshots', () => {
  const buffer = new PoseBuffer();
  assert.equal(buffer.sample(0), null);
  for (let time = 0; time <= 400; time += 100) push(buffer, time, time / 200);
  let previous = 0;
  for (let now = 120; now < 520; now += 16) {
    const pose = buffer.sample(now);
    near(pose.x, (now - 120) / 200);
    near(pose.speed, 5);
    assert.ok(pose.x >= previous);
    previous = pose.x;
  }
});

test('jittered snapshot arrivals follow their timestamps and preserve road corners', () => {
  const buffer = new PoseBuffer();
  push(buffer, 0, 0);
  push(buffer, 80, .4);
  push(buffer, 210, 1);
  push(buffer, 300, 1, .5);
  const straight = buffer.sample(265); // Playback time 145 ms, halfway through the second segment.
  near(straight.x, .7);
  near(straight.z, 0);
  assert.ok(straight.speed > 4 && straight.speed < 6);
  const corner = buffer.sample(375);
  near(corner.x, 1);
  near(corner.z, .25);
  const beforeCorner = buffer.sample(330 - .001), afterCorner = buffer.sample(330 + .001);
  assert.ok(Math.hypot(beforeCorner.x - afterCorner.x, beforeCorner.z - afterCorner.z) < .001);
  assert.ok(Math.abs(beforeCorner.speed - afterCorner.speed) < .001, 'animation speed stays continuous at a moving corner');
});

test('yaw interpolation crosses the pi boundary by the shortest route', () => {
  const buffer = new PoseBuffer();
  push(buffer, 0, 0, 0, Math.PI - .1);
  push(buffer, 100, .5, 0, -Math.PI + .1);
  const pose = buffer.sample(170);
  near(Math.abs(pose.yaw), Math.PI);
  assert.ok(Math.abs(buffer.sample(145).yaw) > 3);
  assert.ok(Math.abs(buffer.sample(195).yaw) > 3);
});

test('stationary poses and stalled connections stop feet without extrapolating', () => {
  const buffer = new PoseBuffer();
  push(buffer, 0, 0);
  push(buffer, 100, .5);
  push(buffer, 200, .5);
  const stationary = buffer.sample(270);
  near(stationary.x, .5);
  assert.equal(stationary.speed, 0);
  assert.equal(stationary.anim, 'idle');
  push(buffer, 300, 1);
  for (const now of [420, 700, 2000]) {
    const stalled = buffer.sample(now);
    near(stalled.x, 1);
    assert.equal(stalled.speed, 0);
    assert.equal(stalled.anim, 'idle');
  }
  push(buffer, 400, 1, 0, 0, 'attack');
  assert.equal(buffer.sample(450).anim, 'idle', 'future action metadata is not applied before its playback time');
  assert.equal(buffer.sample(520).anim, 'attack');
  assert.equal(buffer.sample(1500).anim, 'idle', 'a connection loss does not leave an endless attack');
});

test('teleports and long packet gaps snap immediately and never interpolate the missing path', () => {
  const buffer = new PoseBuffer();
  push(buffer, 0, 0);
  push(buffer, 100, .5);
  push(buffer, 200, 40, -8, 1, 'idle');
  assert.deepEqual(buffer.sample(200), { x: 40, z: -8, yaw: 1, anim: 'idle', speed: 0 });
  push(buffer, 300, 40.5, -8);
  near(buffer.sample(370).x, 40.25);
  push(buffer, 1401, 43, -8, 0, 'idle');
  near(buffer.sample(1401).x, 43);
  assert.equal(buffer.sample(1401).speed, 0);
  buffer.clear();
  assert.equal(buffer.sample(1500), null);
});

test('bad packets cannot corrupt bounded playback history and metadata changes at snapshot time', () => {
  const buffer = new PoseBuffer();
  for (let time = 0; time <= 1900; time += 100) push(buffer, time, time / 200);
  assert.equal(buffer.frames.length, 8);
  push(buffer, 1800, -50);
  buffer.push({ x: NaN, z: 0 }, 1950);
  buffer.push({ x: 1, z: Infinity }, 1950);
  push(buffer, NaN, 1);
  near(buffer.sample(2020).x, 9.5);
  push(buffer, 1900, 9.6, 0, 0, 'gather');
  assert.equal(buffer.frames.length, 8);
  near(buffer.sample(2020).x, 9.6);
  assert.equal(buffer.sample(2019).anim, 'walk');
  assert.equal(buffer.sample(2020).anim, 'gather');
});
