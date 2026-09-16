// Downed overlays are camera surfaces too; left clicks keep their normal UI action.
// Low-angle orbit stops above the ground; further upward look raises the aim
// point instead of driving the camera below the terrain. Collision rays still
// start at the dwarf's body anchor rather than at that raised sky-view target.
export function placeOrbitCamera(player, yaw, pitch, distance, position, anchor, lookAt) {
  const floor = Number.isFinite(player.y) ? player.y : 0;
  const viewPitch = Math.max(-.95, Math.min(.95, pitch));
  const orbitPitch = Math.max(-.10, viewPitch), horizontal = Math.cos(orbitPitch) * distance;
  anchor.x = lookAt.x = player.x; anchor.z = lookAt.z = player.z;
  anchor.y = floor + 1.45;
  position.x = player.x + Math.sin(yaw) * horizontal;
  position.z = player.z + Math.cos(yaw) * horizontal;
  position.y = Math.max(floor + .5, anchor.y + Math.sin(orbitPitch) * distance);
  lookAt.y = anchor.y + Math.max(0, Math.tan(-viewPitch) - Math.tan(.10)) * horizontal;
}

// Pointer lock keeps the cursor fixed and routes relative movement to the camera.
// The first click captures the mouse; it never also swings a tool. UI buttons
// on downed overlays retain their normal click behavior.
export function bindCameraLook({ surfaces, host, document: doc = host.document, enabled, rotate, onLockChange = () => {}, onError = () => {} }) {
  let disposed = false, pending = false, released = false, reportedLocked = false;
  const reportLock = value => { if (value !== reportedLocked) { reportedLocked = value; onLockChange(value); } };
  const isLocked = () => surfaces.includes(doc?.pointerLockElement);
  function stop() {
    released = true;
    if (isLocked()) doc.exitPointerLock?.();
    reportLock(false);
  }
  function change() {
    if (isLocked() && (disposed || released || !enabled())) return stop();
    pending = false;
    reportLock(isLocked());
  }
  function failed() { pending = false; if (!disposed && !released) onError(); }
  function request(surface = surfaces[0]) {
    if (disposed || !enabled() || isLocked() || pending) return;
    released = false;
    if (!surface?.requestPointerLock) return failed();
    pending = true;
    try { surface.requestPointerLock()?.catch?.(failed); } catch { failed(); }
  }
  const start = event => {
    if (event.button !== 0 || !enabled() || isLocked()) return;
    if (event.target?.closest?.('button, input, select, textarea, a, [contenteditable="true"]')) return;
    event.preventDefault();
    request(event.currentTarget);
  };
  const move = event => {
    if (!enabled()) return stop();
    if (isLocked()) rotate(event.movementX || 0, event.movementY || 0);
  };
  const context = event => event.preventDefault();
  const visibility = () => { if (doc.hidden) stop(); };
  for (const surface of surfaces) {
    surface.addEventListener('mousedown', start);
    surface.addEventListener('contextmenu', context);
  }
  host.addEventListener('mousemove', move);
  host.addEventListener('blur', stop);
  doc?.addEventListener('pointerlockchange', change);
  doc?.addEventListener('pointerlockerror', failed);
  doc?.addEventListener('visibilitychange', visibility);
  return { stop, request, isLocked, dispose() {
    disposed = true; stop();
    for (const surface of surfaces) {
      surface.removeEventListener('mousedown', start);
      surface.removeEventListener('contextmenu', context);
    }
    host.removeEventListener('mousemove', move);
    host.removeEventListener('blur', stop);
    doc?.removeEventListener('pointerlockchange', change);
    doc?.removeEventListener('pointerlockerror', failed);
    doc?.removeEventListener('visibilitychange', visibility);
  } };
}

// A held click follows the selected gathering tool rather than one resource ID.
// When a node is depleted the nearest valid node can become the next target
// without asking the player to release and press again.
export function createHeldGather({ now = () => performance.now(), canContinue, getTarget, use, cooldown = 620 }) {
  let held = null, nextAt = 0;
  const stop = () => { held = null; };
  return {
    start(target) {
      stop();
      if (target && canContinue()) { held = { ...target }; nextAt = now() + cooldown; }
    },
    tick() {
      if (!held) return;
      if (!canContinue()) return stop();
      if (now() < nextAt) return;
      const target = getTarget();
      if (!target || target.tool !== held.tool) return stop();
      nextAt = now() + cooldown;
      if (use(target) === false) stop();
      else held = { ...target };
    },
    stop,
    isActive: () => Boolean(held)
  };
}
