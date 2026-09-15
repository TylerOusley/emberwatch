// Downed overlays are camera surfaces too; left clicks keep their normal UI action.
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
