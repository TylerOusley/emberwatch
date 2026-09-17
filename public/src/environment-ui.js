import { SEASONS, WEATHER, VILLAGE_EVENTS } from '../../shared/environment.js';

const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
export function environmentCountdown(seconds) { const whole = Math.max(0, Math.ceil(Number.isFinite(seconds) ? seconds : 0)); return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`; }
export function environmentHUDModel(state) {
  if (!state) return null;
  const season = SEASONS.find(item => item.id === state.season) ?? SEASONS[0], weather = WEATHER[state.weather] ?? WEATHER.clear;
  const definition = VILLAGE_EVENTS[state.event?.type];
  return {
    season: season.id, seasonLabel: season.label, seasonIcon: season.icon, seasonDescription: season.description, seasonCountdown: environmentCountdown(state.seasonRemaining),
    weather: weather.label, weatherIcon: weather.icon, weatherCountdown: environmentCountdown(state.weatherRemaining),
    nextEventCountdown: environmentCountdown(state.nextEventRemaining),
    event: definition ? { id: state.event.id, label: definition.label, icon: definition.icon, description: definition.description, direction: definition.direction, resources: definition.resources.join(' · '), countdown: environmentCountdown(state.event.remaining) } : null
  };
}
export function createEnvironmentUI(root) {
  let signature = '', announcement = '';
  return {
    update(state) {
      if (!root) return;
      const model = environmentHUDModel(state);
      if (!model) { root.hidden = true; signature = ''; return; }
      root.hidden = false;
      const next = JSON.stringify(model); if (next === signature) return; signature = next;
      const event = model.event;
      const nextAnnouncement = event ? `${event.id}:${event.label}` : '';
      const announce = nextAnnouncement !== announcement; announcement = nextAnnouncement;
      root.innerHTML = `<div class="environment-season environment-${model.season}"><span class="environment-season-icon" aria-hidden="true">${model.seasonIcon}</span><div><strong>${model.seasonLabel}</strong><span>Next season ${model.seasonCountdown}</span></div><div class="environment-weather"><span aria-hidden="true">${model.weatherIcon}</span> ${model.weather}<small>Changes in ${model.weatherCountdown}</small></div></div><p class="environment-season-effect">${escape(model.seasonDescription)}</p>${event ? `<div class="environment-event"><div class="environment-event-heading"><strong><span aria-hidden="true">${event.icon}</span> ${event.label}</strong><span>${event.countdown} left</span></div><p>${escape(event.description)}</p><small>${escape(event.resources)} · ${escape(event.direction)}</small></div>` : `<div class="environment-quiet">Next village event in ${model.nextEventCountdown}</div>`}<span class="environment-sr" role="status">${announce && event ? escape(event.label + '. ' + event.description) : ''}</span>`;
    },
    clear() { if (root) { root.hidden = true; root.replaceChildren(); } signature = ''; announcement = ''; }
  };
}
