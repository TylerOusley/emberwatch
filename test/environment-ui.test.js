import test from 'node:test';
import assert from 'node:assert/strict';
import { environmentHUDModel, environmentCountdown, createEnvironmentUI } from '../public/src/environment-ui.js';

function fixture() {
  let writes = 0; const fields = new Map();
  const root = {
    hidden: true, markup: '',
    set innerHTML(value) {
      this.markup = value; writes++; fields.clear();
      for (const [, name] of value.matchAll(/data-environment="([^"]+)"/g)) fields.set(name, { textContent: '', hidden: false });
      this.disclosure = { open: false };
    },
    querySelector(selector) { return fields.get(selector.match(/data-environment="([^"]+)"/)?.[1]); },
    replaceChildren() { this.markup = ''; fields.clear(); }
  };
  return { root, fields, get writes() { return writes; }, hud: createEnvironmentUI(root) };
}

test('environment HUD explains active seasonal production, weather and all shared countdowns', () => {
  const model = environmentHUDModel({ season: 'winter', seasonRemaining: 124, weather: 'snow', weatherRemaining: 14.1, nextEventRemaining: 1200, event: { id: 3, type: 'village_festival', remaining: 75 } });
  assert.equal(model.seasonLabel, 'Winter'); assert.match(model.seasonDescription, /30%/);
  assert.equal(model.seasonCountdown, '2:04'); assert.equal(model.weather, 'Snowfall'); assert.equal(model.weatherCountdown, '0:15');
  assert.equal(model.event.countdown, '1:15'); assert.match(model.event.description, /3 public wheat/); assert.match(model.event.direction, /market/);
  assert.equal(environmentCountdown(-2), '0:00'); assert.equal(environmentCountdown(NaN), '0:00');
});

test('compact HUD keeps its disclosure and click target intact during countdown changes', () => {
  const f = fixture(), state = { season: 'autumn', seasonRemaining: 240.8, weather: 'rain', weatherRemaining: 100, nextEventRemaining: 600 };
  f.hud.update(state); assert.equal(f.root.hidden, false); assert.match(f.fields.get('season-description').textContent, /25% more/); assert.equal(f.fields.get('next-event').textContent, 'Next village event in 10:00');
  assert.equal(f.root.disclosure.open, false); assert.equal(f.fields.get('event-chip').hidden, true);
  const disclosure = f.root.disclosure; disclosure.open = true;
  f.hud.update({ ...state, seasonRemaining: 240.2 }); assert.equal(f.writes, 1);
  f.hud.update({ ...state, seasonRemaining: 239 }); assert.equal(f.writes, 1); assert.equal(f.fields.get('season-time').textContent, '3:59');
  assert.equal(f.root.disclosure, disclosure); assert.equal(disclosure.open, true, 'an open explanation survives updates');
  f.hud.clear(); assert.equal(f.root.hidden, true); assert.equal(f.root.markup, '');
  f.hud.update(state); assert.equal(f.writes, 2); assert.equal(f.root.disclosure.open, false);
});

test('active events appear in the top strip and update or expire without rebuilding it', () => {
  const f = fixture(), state = { season: 'winter', weather: 'snow', seasonRemaining: 600, weatherRemaining: 100, nextEventRemaining: 1200 };
  f.hud.update(state);
  const event = { id: 7, type: 'village_festival', remaining: 75 };
  f.hud.update({ ...state, event });
  assert.equal(f.fields.get('event-chip').hidden, false); assert.equal(f.fields.get('event-details').hidden, false);
  assert.equal(f.fields.get('next-event').hidden, true); assert.equal(f.fields.get('event-time').textContent, '1:15');
  assert.match(f.fields.get('event-location').textContent, /market/); assert.match(f.fields.get('announcement').textContent, /festival/i);
  const announcement = f.fields.get('announcement').textContent;
  f.hud.update({ ...state, event: { ...event, remaining: 74 } });
  assert.equal(f.fields.get('event-time').textContent, '1:14'); assert.equal(f.fields.get('announcement').textContent, announcement);
  f.hud.update(state); assert.equal(f.fields.get('event-chip').hidden, true); assert.equal(f.fields.get('event-details').hidden, true); assert.equal(f.fields.get('next-event').hidden, false);
  assert.equal(f.fields.get('announcement').textContent, 'Village event ended.'); assert.equal(f.writes, 1);
  f.hud.update(null); assert.equal(f.root.hidden, true);
});
