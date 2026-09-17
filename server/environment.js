import { ENVIRONMENT_TIMING as TIMING, SEASONS, WEATHER, VILLAGE_EVENTS, environmentSeason, environmentYieldMultiplier, environmentRegrowMultiplier } from '../shared/environment.js';

const finite = (value, fallback) => Number.isFinite(value) && value >= 0 ? value : fallback;
const seedFor = id => { let seed = 2166136261; for (const char of String(id ?? 'village')) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619); return seed >>> 0 || 1; };
function roll(state) { let seed = state.seed >>> 0 || 1; seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; state.seed = seed >>> 0; return state.seed / 4294967296; }
const interval = (state, min, max) => min + Math.floor(roll(state) * (max - min + 1));

export function ensureEnvironment(village, { seasonSeconds = TIMING.seasonSeconds } = {}) {
  const fresh = !village.environment || typeof village.environment !== 'object';
  const state = village.environment ??= {};
  state.version = 1; state.elapsed = finite(state.elapsed, 0); state.seed = Number.isInteger(state.seed) ? state.seed >>> 0 || 1 : seedFor(village.id);
  state.seasonSeconds = finite(state.seasonSeconds, seasonSeconds) || TIMING.seasonSeconds;
  state.seasonIndex = Number.isInteger(state.seasonIndex) && state.seasonIndex >= 0 ? state.seasonIndex % 4 : 0;
  state.nextSeasonAt = finite(state.nextSeasonAt, state.elapsed + state.seasonSeconds);
  state.weather = Object.hasOwn(WEATHER, state.weather ?? '') ? state.weather : 'clear';
  if (!Number.isFinite(state.nextWeatherAt)) state.nextWeatherAt = state.elapsed + interval(state, TIMING.weatherMin, TIMING.weatherMax);
  if (!Number.isFinite(state.nextEventAt)) state.nextEventAt = state.elapsed + interval(state, TIMING.firstEventMin, TIMING.firstEventMax);
  state.nextUpkeepAt = finite(state.nextUpkeepAt, state.elapsed + TIMING.upkeepSeconds);
  state.recentEvents = Array.isArray(state.recentEvents) ? state.recentEvents.filter(type => Object.hasOwn(VILLAGE_EVENTS, type)).slice(-2) : [];
  state.eventSerial = Number.isSafeInteger(state.eventSerial) && state.eventSerial >= 0 ? state.eventSerial : 0;
  state.event = state.event && Object.hasOwn(VILLAGE_EVENTS, state.event.type) && Number.isFinite(state.event.endsAt) ? state.event : null;
  state.upkeepRemainders ??= {}; state.totalPublicUse ??= {}; state.lastEvent ??= null;
  if (fresh) state.initializedAt = village.clock ?? 0;
  return state;
}

function chooseWeather(state) {
  const options = state.seasonIndex === 3 ? ['snow', 'snow', 'cloudy', 'fog', 'clear'] : state.seasonIndex === 0 ? ['rain', 'rain', 'cloudy', 'clear', 'fog'] : state.seasonIndex === 1 ? ['clear', 'clear', 'cloudy', 'rain'] : ['cloudy', 'rain', 'fog', 'clear'];
  const different = options.filter(type => type !== state.weather);
  state.weather = different[Math.floor(roll(state) * different.length)];
  state.nextWeatherAt = state.elapsed + interval(state, TIMING.weatherMin, TIMING.weatherMax);
}

function beginEvent(village, state) {
  const candidates = Object.keys(VILLAGE_EVENTS).filter(type => !state.recentEvents.includes(type) && !(type === 'cold_snap' && state.seasonIndex === 1));
  const seasonal = state.seasonIndex === 3 ? 'cold_snap' : state.seasonIndex === 2 || state.seasonIndex === 0 ? 'bumper_harvest' : 'village_festival';
  if (candidates.includes(seasonal)) candidates.push(seasonal);
  const type = candidates[Math.floor(roll(state) * candidates.length)], definition = VILLAGE_EVENTS[type];
  const event = state.event = { id: ++state.eventSerial, type, startedAt: state.elapsed, endsAt: state.elapsed + interval(state, TIMING.eventDurationMin, TIMING.eventDurationMax), delivered: {}, consumed: {} };
  state.nextEventAt = state.elapsed + interval(state, TIMING.eventIntervalMin, TIMING.eventIntervalMax);
  state.recentEvents = [...state.recentEvents, type].slice(-2);
  village.stock ??= {};
  // Only a transition to a new event delivers goods; save/load and snapshots do not.
  for (const [resource, amount] of Object.entries(definition.delivery ?? {})) {
    const stock = finite(village.stock[resource], 0), accepted = Math.min(amount, Number.MAX_SAFE_INTEGER - stock);
    village.stock[resource] = stock + accepted; event.delivered[resource] = accepted;
  }
  return { kind: 'event_started', event: type, text: `${definition.label}: ${definition.description}` };
}

function consumePublicStock(village, state) {
  village.stock ??= {};
  const fuel = state.seasonIndex === 3 ? 1.3 : 1;
  const eventDemand = VILLAGE_EVENTS[state.event?.type]?.demand ?? {};
  const demand = { timber: fuel, coal: .5 * fuel };
  for (const [resource, amount] of Object.entries(eventDemand)) demand[resource] = (demand[resource] ?? 0) + amount;
  for (const [resource, amount] of Object.entries(demand)) {
    const accrued = amount + finite(state.upkeepRemainders[resource], 0), whole = Math.floor(accrued + 1e-9);
    state.upkeepRemainders[resource] = Math.max(0, accrued - whole);
    const consumed = Math.min(Math.floor(finite(village.stock[resource], 0)), whole);
    village.stock[resource] = finite(village.stock[resource], 0) - consumed;
    state.totalPublicUse[resource] = (state.totalPublicUse[resource] ?? 0) + consumed;
    if (state.event && eventDemand[resource]) state.event.consumed[resource] = (state.event.consumed[resource] ?? 0) + Math.min(consumed, eventDemand[resource]);
  }
}

/** Return announcements for the simulation's existing village notice channel. */
export function tickEnvironment(village, dt, { active = Object.values(village.players ?? {}).some(player => player.online) } = {}) {
  const state = ensureEnvironment(village), notices = [];
  if (!active || !Number.isFinite(dt) || dt <= 0 || village.status === 'fallen') return notices;
  const target = state.elapsed + dt;
  // Process exact boundaries in order, so large simulation steps and small steps agree.
  while (true) {
    const next = Math.min(state.nextSeasonAt, state.nextWeatherAt, state.nextEventAt, state.nextUpkeepAt, state.event?.endsAt ?? Infinity);
    if (next > target) break;
    state.elapsed = Math.max(state.elapsed, next);
    // Consumption at the end of an event belongs to that event; the start boundary does not.
    if (state.nextUpkeepAt <= state.elapsed) { consumePublicStock(village, state); state.nextUpkeepAt += TIMING.upkeepSeconds; }
    if (state.event && state.event.endsAt <= state.elapsed) {
      state.lastEvent = state.event; notices.push({ kind: 'event_ended', event: state.event.type, text: `${VILLAGE_EVENTS[state.event.type].label} has ended. Normal event production and demand resume.` }); state.event = null;
    }
    if (state.nextSeasonAt <= state.elapsed) {
      state.seasonIndex = (state.seasonIndex + 1) % 4; state.nextSeasonAt += state.seasonSeconds;
      if (state.seasonIndex !== 3 && state.weather === 'snow') state.weather = 'cloudy';
      notices.push({ kind: 'season', text: `${SEASONS[state.seasonIndex].label} begins. ${SEASONS[state.seasonIndex].description}` });
    }
    if (state.nextWeatherAt <= state.elapsed) chooseWeather(state);
    if (state.nextEventAt <= state.elapsed) {
      if (!state.event) notices.push(beginEvent(village, state));
      else state.nextEventAt = state.event.endsAt;
    }
  }
  state.elapsed = target;
  return notices;
}

export function environmentSnapshot(village) {
  const state = ensureEnvironment(village), season = environmentSeason(state), event = state.event;
  return {
    season: season.id, seasonLabel: season.label, seasonDescription: season.description, seasonSeconds: state.seasonSeconds,
    seasonRemaining: Math.max(0, state.nextSeasonAt - state.elapsed), elapsed: state.elapsed,
    weather: state.weather, weatherLabel: WEATHER[state.weather].label, weatherRemaining: Math.max(0, state.nextWeatherAt - state.elapsed),
    nextEventRemaining: Math.max(0, state.nextEventAt - state.elapsed),
    event: event ? { id: event.id, type: event.type, label: VILLAGE_EVENTS[event.type].label, description: VILLAGE_EVENTS[event.type].description, direction: VILLAGE_EVENTS[event.type].direction, resources: [...VILLAGE_EVENTS[event.type].resources], remaining: Math.max(0, event.endsAt - state.elapsed), delivered: { ...event.delivered }, consumed: { ...event.consumed } } : null,
    production: Object.fromEntries(['wheat', 'timber', 'stone', 'iron', 'coal', 'sulfur'].map(type => [type, { yield: environmentYieldMultiplier(state, type), regrow: environmentRegrowMultiplier(state, type) }])),
    publicUpkeep: { timber: state.seasonIndex === 3 ? 1.3 : 1, coal: state.seasonIndex === 3 ? .65 : .5, intervalSeconds: TIMING.upkeepSeconds }
  };
}
