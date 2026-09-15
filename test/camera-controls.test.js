import test from 'node:test';
import assert from 'node:assert/strict';
import { bindCameraLook, placeOrbitCamera } from '../public/src/camera-controls.js';

test('normal camera orbit still aims at the player', () => {
  const player = { x: 8, z: -12 }, position = {}, anchor = {}, lookAt = {};
  placeOrbitCamera(player, 0, .39, 8.5, position, anchor, lookAt);
  assert.deepEqual(anchor, { x: 8, z: -12, y: 1.45 });
  assert.deepEqual(lookAt, anchor);
  assert.equal(position.x, player.x);
  assert.ok(position.z > player.z && position.y > anchor.y);
  assert.ok(Math.abs(Math.hypot(position.z - anchor.z, position.y - anchor.y) - 8.5) < 1e-10);
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
test('right-drag works on the downed overlay while left-click respawn remains available', () => {
  const world = new EventTarget(), downed = new EventTarget(), host = new EventTarget(), turns = [];
  let enabled = true, respawns = 0;
  const control = bindCameraLook({ surfaces: [world, downed], host, enabled: () => enabled, rotate: (x,y) => turns.push([x,y]) });
  downed.addEventListener('mousedown', e => { if(e.button === 0 && !e.defaultPrevented) respawns++; });
  event(downed, 'mousedown', { button: 2 }); event(host, 'mousemove', { movementX: 20, movementY: -5 });
  assert.deepEqual(turns, [[20,-5]]);
  event(host, 'mouseup', { button: 2 }); event(host, 'mousemove', { movementX: 20 });
  event(downed, 'mousedown', { button: 0 }); assert.equal(respawns, 1); assert.equal(turns.length, 1);
  event(world, 'mousedown', { button: 2 }); enabled = false; event(host, 'mousemove', { movementX: 20 });
  enabled = true; event(host, 'mousemove', { movementX: 20 }); assert.equal(turns.length, 1, 'opening chat/dialog cancels the drag');
  event(world, 'mousedown', { button: 2 }); event(host, 'blur'); event(host, 'mousemove', { movementX: 20 });
  assert.equal(turns.length, 1, 'tab changes cannot leave the camera dragging');
  control.dispose(); event(downed, 'mousedown', { button: 2 }); event(host, 'mousemove', { movementX: 20 });
  assert.equal(turns.length, 1);
});
