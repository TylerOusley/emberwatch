// Downed overlays are camera surfaces too; left clicks keep their normal UI action.
// Low-angle orbit stops above the ground; further upward look raises the aim
// point instead of driving the camera below the terrain. Collision rays still
// start at the dwarf's body anchor rather than at that raised sky-view target.
export function placeOrbitCamera(player, yaw, pitch, distance, position, anchor, lookAt) {
  const viewPitch = Math.max(-.95, Math.min(.95, pitch));
  const orbitPitch = Math.max(-.10, viewPitch), horizontal = Math.cos(orbitPitch) * distance;
  anchor.x = lookAt.x = player.x; anchor.z = lookAt.z = player.z;
  anchor.y = 1.45;
  position.x = player.x + Math.sin(yaw) * horizontal;
  position.z = player.z + Math.cos(yaw) * horizontal;
  position.y = Math.max(.5, anchor.y + Math.sin(orbitPitch) * distance);
  lookAt.y = anchor.y + Math.max(0, Math.tan(-viewPitch) - Math.tan(.10)) * horizontal;
}

export function bindCameraLook({ surfaces, host, enabled, rotate }) {
  let dragging = false;
  const stop = () => { dragging = false; };
  const start = event => {
    if (event.button !== 2 || !enabled()) return;
    dragging = true;
    event.preventDefault();
  };
  const move = event => {
    if (!enabled()) return stop();
    if (dragging) rotate(event.movementX || 0, event.movementY || 0);
  };
  const up = event => { if (event.button === 2) stop(); };
  const context = event => event.preventDefault();
  for (const surface of surfaces) {
    surface.addEventListener('mousedown', start);
    surface.addEventListener('contextmenu', context);
  }
  host.addEventListener('mousemove', move);
  host.addEventListener('mouseup', up);
  host.addEventListener('blur', stop);
  return { stop, dispose() {
    stop();
    for (const surface of surfaces) {
      surface.removeEventListener('mousedown', start);
      surface.removeEventListener('contextmenu', context);
    }
    host.removeEventListener('mousemove', move);
    host.removeEventListener('mouseup', up);
    host.removeEventListener('blur', stop);
  } };
}
