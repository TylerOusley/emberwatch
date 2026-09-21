import test from 'node:test';
import assert from 'node:assert/strict';
import { createPanelRefreshGuard, capturePanelDetails, restorePanelDetails } from '../public/src/panel-refresh.js';

function fixture() {
  const target = () => { const listeners = new Map(); return {
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    fire(type, event = {}) { for (const fn of listeners.get(type) ?? []) fn({ type, ...event }); }
  }; };
  const root = target(), win = target(), doc = { activeElement: null }, nodes = new Set(), timers = new Map();
  let serial = 0;
  root.contains = node => nodes.has(node);
  const guard = createPanelRefreshGuard({ root, window: win, document: doc,
    schedule(fn) { timers.set(++serial, fn); return serial; }, cancel(id) { timers.delete(id); } });
  const node = tagName => { const n = { tagName, closest() { return n; } }; nodes.add(n); return n; };
  return { root, win, doc, guard, node, timers, flush() { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } } };
}

test('busy snapshots keep a pressed menu control through pointerup and its native click', () => {
  const f = fixture(), button = f.node('BUTTON'); let renders = 0, received = 0, snapshot = 0;
  const refresh = () => { renders++; received = snapshot; };
  f.root.fire('pointerdown', { target: button, button: 0 });
  for (let i = 0; i < 100; i++) { snapshot++; f.guard.request(refresh); }
  assert.equal(renders, 0);
  f.win.fire('pointerup'); snapshot++; f.guard.request(refresh);
  assert.equal(renders, 0, 'pointerup cannot replace the pending click target');
  let actions = 0;
  f.root.fire('click', { target: button }); actions++; snapshot++; f.guard.request(refresh);
  assert.equal(renders, 0, 'capture-phase click waits for the actual action handler');
  f.flush(); assert.equal(actions, 1); assert.equal(renders, 1); assert.equal(received, 102);
});

test('Enter and Space activation preserve their controls until click finishes', () => {
  for (const key of ['Enter', ' ']) {
    const f = fixture(), button = f.node('BUTTON'); let renders = 0;
    f.root.fire('keydown', { target: button, key }); f.guard.request(() => renders++);
    f.win.fire('keyup', { key }); assert.equal(renders, 0);
    f.root.fire('click', { target: button }); assert.equal(renders, 0);
    f.flush(); assert.equal(renders, 1);
  }
});

test('native select and typed drafts survive snapshots and refresh after leaving the editor', () => {
  for (const tag of ['SELECT', 'INPUT', 'TEXTAREA']) {
    const f = fixture(), input = f.node(tag); let renders = 0;
    f.doc.activeElement = input; f.guard.request(() => renders++); assert.equal(renders, 0);
    f.win.fire('pointerup'); f.flush(); assert.equal(renders, 0, 'select popup can remain active after pointer release');
    const button = f.node('BUTTON'); f.root.fire('pointerdown', { target: button, button: 0 });
    f.doc.activeElement = button; f.root.fire('focusout'); f.guard.request(() => renders++);
    assert.equal(renders, 0, 'blur into a submit button must not interrupt its click');
    f.win.fire('pointerup'); f.root.fire('click', { target: button }); f.flush(); assert.equal(renders, 1);
  }
});

test('cancelled pointers, keyboard focus loss and release outside the dialog recover deferred updates', () => {
  for (const ending of ['pointercancel', 'blur', 'pointerup']) {
    const f = fixture(), button = f.node('BUTTON'); let renders = 0;
    f.root.fire('pointerdown', { target: button, button: 0 }); f.guard.request(() => renders++);
    f.win.fire(ending); f.flush(); assert.equal(renders, 1, ending);
    f.guard.request(() => renders++); assert.equal(renders, 2, 'later snapshots are not blocked');
  }
});

test('explicit panel navigation drops obsolete queued refreshes and disposal removes handlers', () => {
  const f = fixture(), button = f.node('BUTTON'); let renders = 0;
  f.root.fire('pointerdown', { target: button, button: 0 }); f.guard.request(() => renders++);
  f.guard.reset(); f.flush(); assert.equal(renders, 0);
  f.guard.request(() => renders++); assert.equal(renders, 1);
  f.guard.dispose(); f.root.fire('pointerdown', { target: button, button: 0 }); f.guard.request(() => renders++);
  f.flush(); assert.equal(renders, 1); assert.equal(f.timers.size, 0);
});

test('disclosure choices survive replacement without opening unrelated sections', () => {
  const detail = (id, open) => ({ id, open, dataset: {}, querySelector() { return { textContent: id }; } });
  const saved = capturePanelDetails({ querySelectorAll: () => [detail('rules', true), detail('history', false)] });
  const fresh = [detail('history', true), detail('rules', false), detail('new-section', false)];
  restorePanelDetails({ querySelectorAll: () => fresh }, saved);
  assert.deepEqual(fresh.map(n => n.open), [false, true, false]);
});
