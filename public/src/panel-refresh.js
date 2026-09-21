// Snapshot updates must not replace a control between its native press and click,
// or while a player is typing / choosing from a native select popup.
export function createPanelRefreshGuard({ root, document: doc = globalThis.document, window: win = globalThis.window,
  schedule = fn => setTimeout(fn, 0), cancel = id => clearTimeout(id) }) {
  let pressed = null, timer = null, pending = null, disposed = false;
  const listeners = [];
  const contains = node => Boolean(node && root?.contains(node));
  const editor = () => contains(doc?.activeElement) && (['INPUT', 'TEXTAREA', 'SELECT'].includes(doc.activeElement.tagName) || doc.activeElement.isContentEditable);
  const control = node => {
    const element = node?.closest?.('button,input,select,textarea,summary,a[href],[role="button"],label');
    return contains(element) && !element.disabled ? element : null;
  };
  const deferred = () => Boolean(pressed || timer !== null || editor());
  function flush() {
    if (disposed || deferred() || !pending) return;
    const refresh = pending; pending = null; refresh();
  }
  function release() { cancel(timer); timer = null; pressed = null; flush(); }
  function afterEvent() { cancel(timer); timer = schedule(release); }
  function begin(event) {
    if (event.type === 'pointerdown' && event.button !== 0) return;
    if (event.type === 'keydown' && ![' ', 'Enter'].includes(event.key)) return;
    const node = control(event.target); if (!node) return;
    cancel(timer); timer = null; pressed = node;
  }
  function listen(target, type, handler) {
    target?.addEventListener?.(type, handler, true);
    listeners.push(() => target?.removeEventListener?.(type, handler, true));
  }
  listen(root, 'pointerdown', begin); listen(root, 'keydown', begin);
  // Defer through the native click (which follows pointerup / keyup). The
  // timer also recovers cancelled or released-outside controls without a click.
  listen(win, 'pointerup', afterEvent);
  listen(win, 'keyup', event => { if ([' ', 'Enter'].includes(event.key)) afterEvent(); });
  listen(root, 'click', afterEvent); listen(root, 'focusout', afterEvent);
  listen(win, 'pointercancel', release); listen(win, 'blur', release);
  return {
    request(refresh) { if (disposed) return; pending = refresh; flush(); },
    reset() { cancel(timer); timer = null; pressed = null; pending = null; },
    dispose() { this.reset(); disposed = true; for (const remove of listeners) remove(); }
  };
}

export function capturePanelDetails(host) {
  return new Map([...(host?.querySelectorAll?.('details') ?? [])].map((node, index) => [
    node.dataset?.persist ?? (node.id || `${node.querySelector?.('summary')?.textContent ?? ''}:${index}`), node.open
  ]));
}

export function restorePanelDetails(host, saved) {
  if (!saved) return;
  [...(host?.querySelectorAll?.('details') ?? [])].forEach((node, index) => {
    const key = node.dataset?.persist ?? (node.id || `${node.querySelector?.('summary')?.textContent ?? ''}:${index}`);
    if (saved.has(key)) node.open = saved.get(key);
  });
}
