import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCharacter } from '../public/src/characters.js';

const joint = (actor, name) => actor.group.getObjectByName(name);
const names = ['body','pelvis','leftLeg','rightLeg','leftShin','rightShin','leftFoot','rightFoot','leftArm','rightArm','leftFore','rightFore'];
const angles = actor => names.flatMap(name => joint(actor, name).rotation.toArray().slice(0, 3));
function advance(actor, frames, options, rate = 60) {
  for (let i = 0; i < frames; i++) actor.update(1 / rate, i / rate, options);
}
function ranges(speed) {
  const actor = createCharacter('villager', 1); actor.setTool('');
  advance(actor, 120, { moving: true, speed });
  const values = { knee: [], ankle: [], elbow: [], hips: [], chest: [] };
  for (let i = 0; i < 180; i++) {
    actor.update(1 / 60, i / 60, { moving: true, speed });
    values.knee.push(joint(actor, 'leftShin').rotation.x);
    values.ankle.push(joint(actor, 'leftFoot').rotation.x);
    values.elbow.push(joint(actor, 'leftFore').rotation.x);
    values.hips.push(joint(actor, 'pelvis').rotation.y + joint(actor, 'body').rotation.y);
    values.chest.push(joint(actor, 'body').rotation.y);
  }
  actor.dispose(); return values;
}
const span = values => Math.max(...values) - Math.min(...values);

test('walking articulates knees, ankles and elbows while hips counter the shoulders; running folds the limbs more', () => {
  const walk = ranges(5.4), run = ranges(8);
  assert.ok(span(walk.knee) > .70, 'a swinging knee bends substantially beyond the planted stance');
  assert.ok(span(walk.ankle) > .55, 'feet articulate separately from the calf');
  assert.ok(span(walk.elbow) > .20, 'walking elbows do not remain fixed');
  assert.ok(walk.hips.reduce((sum, value, i) => sum + value * walk.chest[i], 0) < -.1, 'hips and chest counter-rotate');
  assert.ok(Math.max(...run.knee) > Math.max(...walk.knee) + .45, 'running lifts the heel with more knee flexion');
  assert.ok(Math.min(...run.elbow) < Math.min(...walk.elbow) - .4, 'running uses bent arms');
  assert.ok(Math.min(...run.ankle) >= -.851 && Math.max(...run.ankle) <= .551, 'ankles stay within the authored range');
});

test('the support sole stays above ground while the other foot clears it during walking and running', () => {
  for (const speed of [5.4, 8]) {
    const actor = createCharacter('villager', 2); actor.setTool('');
    advance(actor, 120, { moving: true, speed });
    let clearance = 0;
    for (let frame = 0; frame < 180; frame++) {
      actor.update(1 / 60, frame / 60, { moving: true, speed }); actor.group.updateMatrixWorld(true);
      const soles = ['leftFoot', 'rightFoot'].map(name => {
        let lowest = Infinity;
        for (const x of [-.14, .14]) for (const z of [-.135, .316]) {
          const p = new THREE.Vector3(x, -.152, z).applyMatrix4(joint(actor, name).matrixWorld);
          lowest = Math.min(lowest, p.y);
        }
        return lowest;
      });
      assert.ok(Math.min(...soles) > -.005, 'joint movement does not sink a sole through the ground');
      assert.ok(Math.min(...soles) < .065, 'the supporting foot remains near the floor');
      clearance = Math.max(clearance, Math.abs(soles[0] - soles[1]));
    }
    assert.ok(clearance > (speed > 6 ? .08 : .035), 'the returning foot visibly lifts');
    actor.dispose();
  }
});

test('gait follows elapsed movement consistently across frame rates and stops cycling at rest', () => {
  const sample = rate => {
    const actor = createCharacter('villager', 1); actor.setTool('');
    advance(actor, rate * 2, { moving: true, speed: 5.4 }, rate);
    const pose = angles(actor); actor.dispose(); return pose;
  };
  const reference = sample(120);
  for (const rate of [30, 60]) assert.ok(sample(rate).every((v, i) => Math.abs(v - reference[i]) < .065), 'frame rate does not change gait timing');
  const actor = createCharacter('villager', 1); actor.setTool('');
  advance(actor, 120, { moving: true, speed: 8 });
  advance(actor, 180, { moving: false, speed: 0 });
  const atRest = angles(actor);
  advance(actor, 60, { moving: false, speed: 0 });
  assert.ok(angles(actor).every((v, i) => Math.abs(v - atRest[i]) < .003), 'stopping does not leave the legs cycling');
  actor.dispose();
});

test('joint transitions remain continuous for tools, backpacks, carrying, riding, downing and turns', () => {
  for (const role of ['villager', 'guard', 'priest', 'zombie']) {
    const actor = createCharacter(role, 2);
    advance(actor, 60, { moving: true, speed: role === 'zombie' ? 1.75 : 5.4, backpackTier: 3 });
    let previous = angles(actor);
    for (const options of [
      { moving: true, speed: 8, turnRate: 2, tool: 'axe' },
      { moving: true, speed: 5.4, attack: true, tool: 'sword' },
      { moving: true, speed: 3, carrying: true }, { mounted: true },
      { downed: true }, { channeling: true, tool: 'heal' }, {},
    ]) for (let i = 0; i < 40; i++) {
      actor.update(1 / 60, i / 60, options);
      const next = angles(actor);
      assert.ok(next.every(Number.isFinite));
      assert.ok(next.every((v, j) => Math.abs(v - previous[j]) < .55), 'joint transitions do not snap to another pose');
      previous = next;
    }
    if (role !== 'zombie') assert.equal(actor.group.getObjectByName('worn-backpack').parent.name, 'body');
    actor.dispose();
  }
});
