import { SEASONS, WEATHER, VILLAGE_EVENTS } from '../../shared/environment.js';

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
  let signature = '', announcement = '', mounted = false;
  const field = name => root.querySelector(`[data-environment="${name}"]`);
  function write(name, value) { const element = field(name); if (element.textContent !== value) element.textContent = value; }
  function mount() {
    if (mounted) return;
    // Keep the summary and native disclosure alive while countdowns tick. Replacing
    // them every second can swallow a click or close the details mid-read.
    root.innerHTML = `<details class="environment-disclosure"><summary aria-label="Season, weather and village event details"><span class="environment-chip"><span data-environment="season-icon" aria-hidden="true"></span><span data-environment="season"></span></span><span class="environment-chip environment-weather"><span data-environment="weather-icon" aria-hidden="true"></span><span data-environment="weather"></span></span><span class="environment-chip environment-event-chip" data-environment="event-chip" hidden><span data-environment="event-icon" aria-hidden="true"></span><span data-environment="event-label"></span><small data-environment="event-time"></small></span><span class="environment-expand" aria-hidden="true">⌄</span></summary><div class="environment-details"><p class="environment-season-effect" data-environment="season-description"></p><div class="environment-timers"><span>Next season <strong data-environment="season-time"></strong></span><span>Weather changes <strong data-environment="weather-time"></strong></span></div><div class="environment-event" data-environment="event-details" hidden><strong data-environment="event-heading"></strong><p data-environment="event-description"></p><small data-environment="event-location"></small></div><p class="environment-quiet" data-environment="next-event"></p></div></details><span class="environment-sr" role="status" aria-live="polite" data-environment="announcement"></span>`;
    mounted = true;
  }
  return {
    update(state) {
      if (!root) return;
      const model = environmentHUDModel(state);
      if (!model) { root.hidden = true; signature = ''; return; }
      root.hidden = false;
      const next = JSON.stringify(model); if (next === signature) return; signature = next;
      mount();
      const event = model.event;
      const nextAnnouncement = event ? `${event.id}:${event.label}` : '';
      const announce = nextAnnouncement !== announcement; announcement = nextAnnouncement;
      write('season-icon', model.seasonIcon); write('season', model.seasonLabel); write('season-description', model.seasonDescription); write('season-time', model.seasonCountdown);
      write('weather-icon', model.weatherIcon); write('weather', model.weather); write('weather-time', model.weatherCountdown);
      field('event-chip').hidden = !event; field('event-details').hidden = !event;
      write('event-icon', event?.icon ?? ''); write('event-label', event?.label ?? ''); write('event-time', event?.countdown ?? '');
      write('event-heading', event ? `${event.label} · ${event.countdown} left` : ''); write('event-description', event?.description ?? ''); write('event-location', event ? `${event.resources} · ${event.direction}` : '');
      field('next-event').hidden = Boolean(event); write('next-event', `Next village event in ${model.nextEventCountdown}`);
      if (announce) write('announcement', event ? `${event.label}. ${event.description}` : 'Village event ended.');
    },
    clear() { if (root) { root.hidden = true; root.replaceChildren(); } signature = ''; announcement = ''; mounted = false; }
  };
}
