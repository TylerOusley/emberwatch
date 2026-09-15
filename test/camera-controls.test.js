import test from 'node:test';
import assert from 'node:assert/strict';
import { bindCameraLook } from '../public/src/camera-controls.js';

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
