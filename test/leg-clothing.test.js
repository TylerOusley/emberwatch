import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildClothing } from '../public/src/character-clothing.js';
import { createCharacter } from '../public/src/characters.js';

function fixture(role = 'villager', feet = true) {
  const group = new THREE.Group(), rig = {}, own = new Set();
  group.position.set(31, 0, -23); group.rotation.y = 1.3;
  const bone = (name, parent, x, y, z = 0) => {
    const b = new THREE.Bone(); b.name = name; b.position.set(x, y, z); parent.add(b); rig[name] = b; return b;
  };
  const body = bone('body', group, 0, 1.04), pelvis = bone('pelvis', body, 0, 0);
  for (const [side, sign] of [['left', 1], ['right', -1]]) {
    const arm = bone(`${side}Arm`, body, sign * .48, .36);
    bone(`${side}Fore`, arm, 0, -.34);
    const leg = bone(`${side}Leg`, pelvis, sign * .21, -.27);
    const shin = bone(`${side}Shin`, leg, 0, -.35);
    if (feet) bone(`${side}Foot`, shin, 0, -.25, .015);
  }
  const clothing = buildClothing(rig, { role, own });
  return { group, rig, own, clothing, dispose: () => { for (const resource of own) resource.dispose(); } };
}

function point(mesh, i) { return mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld); }
function close(a, b, label) { assert.ok(a.distanceTo(b) < 2e-5, `${label}: ${a.distanceTo(b)}`); }

test('boots retain their calf attachment while their toes and soles follow the ankle pivot', () => {
  const actor = fixture(), { rig } = actor;
  const boots = actor.clothing.skinnedMeshes.filter(m => m.userData.clothingPart === 'boot');
  assert.equal(boots.length, 6, 'three material groups per boot');
  actor.group.updateMatrixWorld(true);
  const inverseFoot = new Map(['left', 'right'].map(side => [side, rig[`${side}Foot`].matrixWorld.clone().invert()]));
  const samples = [];
  for (const mesh of boots) {
    const p = mesh.geometry.attributes.position, weights = mesh.geometry.attributes.skinWeight;
    const side = mesh.parent === rig.leftShin ? 'left' : 'right';
    for (let i = 0; i < p.count; i += 7) {
      if (weights.getY(i) === 0) samples.push({ mesh, i, before: point(mesh, i), foot: false, side });
      if (weights.getY(i) === 1) samples.push({ mesh, i, before: point(mesh, i), foot: true, side });
    }
  }
  assert.ok(samples.some(s => s.foot) && samples.some(s => !s.foot));
  for (const angle of [-.6, .6]) {
    rig.leftFoot.rotation.x = angle; rig.rightFoot.rotation.x = -angle;
    actor.group.updateMatrixWorld(true);
    for (const sample of samples) {
      const expected = sample.before.clone();
      if (sample.foot) expected.applyMatrix4(inverseFoot.get(sample.side)).applyMatrix4(rig[`${sample.side}Foot`].matrixWorld);
      close(point(sample.mesh, sample.i), expected, sample.foot ? 'toe follows foot' : 'shaft stays with calf');
    }
  }
  actor.dispose();
});

test('continuous trousers bend through the knee without separate rigid calf seams in every role', () => {
  for (const role of ['villager', 'guard', 'priest', 'zombie']) {
    const actor = fixture(role);
    const pants = actor.clothing.skinnedMeshes.filter(m => m.userData.clothingPart === 'trousers');
    assert.equal(pants.length, 2);
    for (const mesh of pants) {
      const g = mesh.geometry, p = g.attributes.position, weights = g.attributes.skinWeight;
      assert.ok(Array.from({ length: p.count }, (_, i) => weights.getY(i)).some(w => w > 0 && w < 1));
      assert.ok(p.getY(0) < -.45 && p.getY(p.count - 1) > 0, 'same surface spans calf and upper thigh');
      const connected = new Set([0]), adjacent = Array.from({ length: p.count }, () => []);
      for (let i = 0; i < g.index.count; i += 3) {
        const tri = [g.index.getX(i), g.index.getX(i + 1), g.index.getX(i + 2)];
        for (const a of tri) for (const b of tri) adjacent[a].push(b);
      }
      const pending = [0];
      while (pending.length) for (const next of adjacent[pending.pop()]) if (!connected.has(next)) { connected.add(next); pending.push(next); }
      assert.equal(connected.size, p.count, 'no disconnected upper and lower trouser tubes');
    }
    actor.rig.leftLeg.rotation.x = -.5; actor.rig.rightLeg.rotation.x = .4;
    actor.rig.leftShin.rotation.x = 70 * Math.PI / 180;
    actor.rig.rightShin.rotation.x = 70 * Math.PI / 180;
    actor.rig.leftFoot.rotation.x = -.6; actor.rig.rightFoot.rotation.x = .6;
    actor.group.updateMatrixWorld(true);
    for (const mesh of actor.clothing.skinnedMeshes.filter(m => m.userData.clothingPart)) {
      const g = mesh.geometry, weights = g.attributes.skinWeight, ids = g.attributes.skinIndex;
      for (let i = 0; i < weights.count; i++) {
        const values = [weights.getX(i), weights.getY(i), weights.getZ(i), weights.getW(i)];
        assert.ok(values.every(w => Number.isFinite(w) && w >= 0 && w <= 1));
        assert.ok(Math.abs(values.reduce((a, b) => a + b, 0) - 1) < 1e-6);
        assert.ok(ids.getX(i) < mesh.skeleton.bones.length && ids.getY(i) < mesh.skeleton.bones.length);
        const deformed = point(mesh, i);
        assert.ok(deformed.toArray().every(Number.isFinite));
        assert.ok(deformed.distanceTo(actor.group.position) < 3, 'skin remains attached away from origin');
      }
    }
    actor.dispose();
  }
});

test('clothing supports older rigs without ankle bones', () => {
  const actor = fixture('guard', false);
  assert.equal(actor.clothing.skinnedMeshes.filter(m => m.userData.clothingPart === 'boot').length, 0);
  assert.equal(actor.clothing.skinnedMeshes.filter(m => m.userData.clothingPart === 'trousers').length, 2);
  actor.dispose();
});

test('short tunic hems follow the stepping thigh while their top stays attached to the torso', () => {
  const actor = fixture(), mesh = actor.clothing.skinnedMeshes.find(m => m.userData.clothingPart === 'shortTunic');
  assert.ok(mesh);
  actor.group.updateMatrixWorld(true);
  const p = mesh.geometry.attributes.position;
  const top = [], hem = [], inverseLeg = actor.rig.leftLeg.matrixWorld.clone().invert();
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) >= -.29) top.push({ i, before: point(mesh, i) });
    if (p.getY(i) < -.42 && p.getX(i) > .34) hem.push({ i, before: point(mesh, i) });
  }
  assert.ok(top.length > 0 && hem.length > 0);
  actor.rig.leftLeg.rotation.x = -.8; actor.rig.rightLeg.rotation.x = .8;
  actor.group.updateMatrixWorld(true);
  for (const sample of top) close(point(mesh, sample.i), sample.before, 'tunic top stays with torso');
  for (const sample of hem) {
    const expected = sample.before.clone().applyMatrix4(inverseLeg).applyMatrix4(actor.rig.leftLeg.matrixWorld);
    const moved = point(mesh, sample.i);
    assert.ok(moved.distanceTo(sample.before) > .07, 'side hem moves far enough to clear the stepping thigh');
    assert.ok(moved.distanceTo(expected) < .025, 'hem closely follows the thigh beneath it');
  }
  actor.dispose();
});

test('trouser waists and overlapping upper apron layers stay inside the torso during hip counterrotation', () => {
  const actor = fixture();
  actor.group.updateMatrixWorld(true);
  const pinned = [];
  for (const mesh of actor.clothing.skinnedMeshes) {
    const part = mesh.userData.clothingPart, p = mesh.geometry.attributes.position;
    if (part !== 'trousers' && !part?.startsWith('apron')) continue;
    for (let i = 0; i < p.count; i++) {
      if (part === 'trousers' ? p.getY(i) > .064 : p.getY(i) >= -.29) pinned.push({ mesh, i, before: point(mesh, i) });
    }
  }
  assert.ok(pinned.some(p => p.mesh.userData.clothingPart === 'trousers'));
  assert.ok(pinned.some(p => p.mesh.userData.clothingPart === 'apronPocket'));
  actor.rig.pelvis.rotation.set(.18, .2, .14);
  actor.rig.leftLeg.rotation.x = -.8; actor.rig.rightLeg.rotation.x = .8;
  actor.group.updateMatrixWorld(true);
  for (const sample of pinned) close(point(sample.mesh, sample.i), sample.before, 'overlapping waist stays torso-bound');
  actor.dispose();
});

test('articulated clothing skeletons are released once on role replacement and actor disposal', () => {
  const actor = createCharacter('guard', 4), old = [];
  actor.group.traverse(m => { if (m.isSkinnedMesh && m.userData.clothingPart) old.push(m.skeleton); });
  assert.ok(old.length >= 2);
  const releases = new Map();
  for (const skeleton of old) {
    const dispose = skeleton.dispose.bind(skeleton);
    skeleton.dispose = () => { releases.set(skeleton, (releases.get(skeleton) || 0) + 1); dispose(); };
  }
  actor.setRole('priest');
  for (const skeleton of old) assert.equal(releases.get(skeleton), 1);
  actor.dispose(); actor.dispose();
  for (const skeleton of old) assert.equal(releases.get(skeleton), 1);
});
