import test from 'node:test';
import assert from 'node:assert/strict';
import { bindCameraLook, placeOrbitCamera, createHeldGather } from '../public/src/camera-controls.js';

test('normal camera orbit still aims at the player', () => {
  const player = { x: 8, z: -12 }, position = {}, anchor = {}, lookAt = {};
  placeOrbitCamera(player, 0, .39, 8.5, position, anchor, lookAt);
  assert.deepEqual(anchor, { x: 8, z: -12, y: 1.45 });
  assert.deepEqual(lookAt, anchor);
  assert.equal(position.x, player.x);
  assert.ok(position.z > player.z && position.y > anchor.y);
  assert.ok(Math.abs(Math.hypot(position.z - anchor.z, position.y - anchor.y) - 8.5) < 1e-10);
});

test('camera follows a descending floor without clamping an underground dwarf to surface height', () => {
  for (const floor of [0, -3, -8, -14]) {
    const position = {}, anchor = {}, lookAt = {};
    placeOrbitCamera({ x: 0, y: floor, z: -180 }, 0, .39, 4.5, position, anchor, lookAt);
    assert.equal(anchor.y, floor + 1.45);
    assert.equal(lookAt.y, anchor.y);
    assert.ok(position.y > floor + .5 && position.y < floor + 4);
    placeOrbitCamera({ x: 0, y: floor, z: -180 }, 0, -.95, 4.5, position, anchor, lookAt);
    assert.ok(position.y >= floor + .5);
  }
});

test('looking up reveals the high sky without putting the camera underground', () => {
  const position = {}, anchor = {}, lookAt = {};
  for (let pitch = -.95; pitch <= .95; pitch += .025) {
    placeOrbitCamera({ x: 3, z: 5 }, .7, pitch, 8.5, position, anchor, lookAt);
    assert.ok(Object.values(position).every(Number.isFinite));
    assert.ok(position.y >= .5);
    assert.equal(anchor.y, 1.45, 'collision rays remain anchored to the player');
  }
  placeOrbitCamera({ x: 0, z: 0 }, 0, -.95, 8.5, position, anchor, lookAt);
  const viewElevation = Math.atan2(lookAt.y - position.y, Math.hypot(position.x, position.z));
  assert.ok(viewElevation > .9, 'upward aim plus the field of view includes the overhead sun');
  assert.ok(lookAt.y > anchor.y);
  const before = { ...position };
  placeOrbitCamera({ x: 0, z: 0 }, 0, -.951, 8.5, position, anchor, lookAt);
  assert.deepEqual(position, before, 'dragging beyond the limit cannot push the camera lower');
});

function event(target, type, values = {}) {
  const e = new Event(type, { cancelable: true });
  Object.assign(e, values); target.dispatchEvent(e); return e;
}
function pointerFixture({ deferred = false } = {}) {
  const world = new EventTarget(), downed = new EventTarget(), host = new EventTarget(), doc = new EventTarget(), turns = [], locks = [];
  let enabled = true, requests = 0;
  doc.pointerLockElement = null;
  doc.exitPointerLock = () => { doc.pointerLockElement = null; event(doc, 'pointerlockchange'); };
  for (const surface of [world, downed]) surface.requestPointerLock = () => { requests++; if (!deferred) { doc.pointerLockElement = surface; event(doc, 'pointerlockchange'); } };
  const control = bindCameraLook({ surfaces: [world, downed], host, document: doc, enabled: () => enabled, rotate: (x, y) => turns.push([x, y]), onLockChange: locked => locks.push(locked) });
  return { world, downed, host, doc, turns, locks, control, get requests() { return requests; }, setEnabled(value) { enabled = value; } };
}

test('a click captures the mouse without swinging; movement needs no held button', () => {
  const f = pointerFixture();
  const click = event(f.world, 'mousedown', { button: 0 });
  assert.equal(click.defaultPrevented, true, 'capture click is consumed before tools');
  assert.equal(f.control.isLocked(), true);
  event(f.host, 'mouseup', { button: 0 });
  event(f.host, 'mousemove', { movementX: 20, movementY: -5 });
  assert.deepEqual(f.turns, [[20, -5]]);
  assert.equal(event(f.world, 'mousedown', { button: 0 }).defaultPrevented, false, 'following clicks use equipment');
  f.doc.exitPointerLock();
  event(f.host, 'mousemove', { movementX: 20 });
  assert.equal(f.turns.length, 1, 'Escape/unlock stops camera movement');
  event(f.world, 'mousedown', { button: 0 });
  assert.equal(f.control.isLocked(), true, 'click resumes capture');
  f.control.dispose();
});

test('opening UI or losing focus releases capture and cannot leave camera movement active', () => {
  const f = pointerFixture();
  event(f.world, 'mousedown', { button: 0 });
  f.setEnabled(false); event(f.host, 'mousemove', { movementX: 20 });
  assert.equal(f.control.isLocked(), false);
  f.setEnabled(true); event(f.host, 'mousemove', { movementX: 20 });
  assert.equal(f.turns.length, 0);
  event(f.world, 'mousedown', { button: 0 }); event(f.host, 'blur');
  assert.equal(f.control.isLocked(), false);
  event(f.world, 'mousedown', { button: 0 }); f.doc.hidden = true; event(f.doc, 'visibilitychange');
  assert.equal(f.control.isLocked(), false);
  f.control.dispose(); event(f.world, 'mousedown', { button: 0 });
  assert.equal(f.control.isLocked(), false);
});

test('late pointer-lock success after a menu opens is released and overlay buttons remain usable', () => {
  const f = pointerFixture({ deferred: true });
  event(f.world, 'mousedown', { button: 0 }); f.control.stop();
  f.doc.pointerLockElement = f.world; event(f.doc, 'pointerlockchange');
  assert.equal(f.control.isLocked(), false);
  const buttonEvent = new Event('mousedown', { cancelable: true });
  Object.defineProperties(buttonEvent, { button: { value: 0 }, target: { value: { closest: () => true } } });
  f.downed.dispatchEvent(buttonEvent);
  assert.equal(buttonEvent.defaultPrevented, false);
  assert.equal(f.requests, 1, 'respawn button does not capture the mouse');
  f.control.dispose();
});

test('held gathering respects cooldown and never catches up in bursts after a slow frame', () => {
  let now = 0, allowed = true, target = { id: 'iron', tool: 'pickaxe' };
  const uses = [];
  const hold = createHeldGather({ now: () => now, canContinue: () => allowed, getTarget: () => target, use: value => uses.push(value.id) });
  hold.start(target);
  for (now = 0; now < 620; now += 20) hold.tick();
  assert.deepEqual(uses, []);
  hold.tick(); assert.deepEqual(uses, ['iron']);
  now = 10000; hold.tick(); hold.tick(); assert.deepEqual(uses, ['iron', 'iron']);
  allowed = false; hold.tick(); allowed = true; now += 1000; hold.tick();
  assert.equal(uses.length, 2, 'unlock/UI/blur interruption requires a fresh click');
});

test('depletion pauses a held gather, a new matching node continues it, and tool changes or mouse release stop it', () => {
  let now = 0, target = { id: 'stone', tool: 'pickaxe' };
  const uses = [];
  const hold = createHeldGather({ now: () => now, canContinue: () => true, getTarget: () => target, use: value => uses.push(value.id) });
  hold.start(target); target = { id: 'coal', tool: 'pickaxe' }; now += 620; hold.tick();
  assert.deepEqual(uses, ['coal']); assert.equal(hold.isActive(), true, 'the same hold follows a new matching node');
  target = { id: 'coal', tool: 'axe' }; now += 620; hold.tick(); assert.equal(hold.isActive(), false);
  target = { id: 'stone', tool: 'pickaxe' }; hold.start(target); target = null; now += 620; hold.tick(); assert.equal(hold.isActive(), false);
  target = { id: 'stone', tool: 'pickaxe' }; hold.start(target); hold.stop(); now += 620; hold.tick();
  assert.deepEqual(uses, ['coal']);
});


test('mouse movement inside menus reports one release and does not flood network input', () => {
  const f = pointerFixture();
  event(f.world, 'mousedown', { button: 0 });
  f.setEnabled(false);
  for (let i = 0; i < 250; i++) event(f.host, 'mousemove', { movementX: 2 });
  assert.deepEqual(f.locks, [true, false]);
  f.control.stop(); event(f.host, 'blur');
  assert.deepEqual(f.locks, [true, false]);
  f.control.dispose();
});
