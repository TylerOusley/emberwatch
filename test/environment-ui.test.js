import test from 'node:test';
import assert from 'node:assert/strict';
import { environmentHUDModel, environmentCountdown, createEnvironmentUI } from '../public/src/environment-ui.js';

test('environment HUD explains active seasonal production, weather and all shared countdowns', () => {
  const model = environmentHUDModel({ season: 'winter', seasonRemaining: 124, weather: 'snow', weatherRemaining: 14.1, nextEventRemaining: 1200, event: { id: 3, type: 'village_festival', remaining: 75 } });
  assert.equal(model.seasonLabel, 'Winter'); assert.match(model.seasonDescription, /30%/);
  assert.equal(model.seasonCountdown, '2:04'); assert.equal(model.weather, 'Snowfall'); assert.equal(model.weatherCountdown, '0:15');
  assert.equal(model.event.countdown, '1:15'); assert.match(model.event.description, /3 public wheat/); assert.match(model.event.direction, /market/);
  assert.equal(environmentCountdown(-2), '0:00'); assert.equal(environmentCountdown(NaN), '0:00');
});

test('HUD does not rebuild between whole-second countdown changes and clears on village leave', () => {
  let writes = 0; const root = { hidden: true, set innerHTML(value) { this.markup = value; writes++; }, replaceChildren() { this.markup = ''; } };
  const hud = createEnvironmentUI(root), state = { season: 'autumn', seasonRemaining: 240.8, weather: 'rain', weatherRemaining: 100, nextEventRemaining: 600 };
  hud.update(state); assert.equal(root.hidden, false); assert.match(root.markup, /25% more/); assert.match(root.markup, /Next village event in 10:00/);
  hud.update({ ...state, seasonRemaining: 240.2 }); assert.equal(writes, 1);
  hud.update({ ...state, seasonRemaining: 239 }); assert.equal(writes, 2);
  hud.clear(); assert.equal(root.hidden, true); assert.equal(root.markup, '');
});
