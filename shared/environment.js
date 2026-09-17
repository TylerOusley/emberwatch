// All schedules use active village seconds, never wall-clock time.
export const ENVIRONMENT_TIMING = Object.freeze({ seasonSeconds: 3600, firstEventMin: 600, firstEventMax: 900, eventIntervalMin: 2700, eventIntervalMax: 4500, eventDurationMin: 600, eventDurationMax: 900, weatherMin: 240, weatherMax: 480, upkeepSeconds: 60 });
export const SEASONS = Object.freeze([
  Object.freeze({ id: 'spring', label: 'Spring', icon: '❀', description: 'Wheat regrows 20% sooner; trees regrow 10% sooner.' }),
  Object.freeze({ id: 'summer', label: 'Summer', icon: '☀', description: 'Normal crop and mining production.' }),
  Object.freeze({ id: 'autumn', label: 'Autumn', icon: '❧', description: 'Wheat harvests yield 25% more.' }),
  Object.freeze({ id: 'winter', label: 'Winter', icon: '❄', description: 'Wheat regrows 25% slower; public timber and coal upkeep rises 30%.' })
]);
export const WEATHER = Object.freeze({
  clear: Object.freeze({ label: 'Clear skies', icon: '☀' }),
  cloudy: Object.freeze({ label: 'Overcast', icon: '☁' }),
  rain: Object.freeze({ label: 'Rain showers', icon: '☂' }),
  fog: Object.freeze({ label: 'Morning mist', icon: '≋' }),
  snow: Object.freeze({ label: 'Snowfall', icon: '❄' })
});
export const VILLAGE_EVENTS = Object.freeze({
  merchant_caravan: Object.freeze({ label: 'Merchant caravan', icon: '▣', resources: ['wheat', 'timber', 'iron', 'coal'], direction: 'Supply increases; well-stocked market prices may ease.', description: 'A single shipment brings 120 wheat, 100 timber, 60 iron and 50 coal to the public market.', delivery: Object.freeze({ wheat: 120, timber: 100, iron: 60, coal: 50 }) }),
  bumper_harvest: Object.freeze({ label: 'Bumper harvest', icon: '❧', resources: ['wheat'], direction: 'Harvest extra wheat to sell or store.', description: 'Wheat harvests yield 50% more. Combined seasonal and event yields are limited to twice normal.' }),
  rich_ore: Object.freeze({ label: 'Rich ore vein', icon: '◆', resources: ['iron', 'coal'], direction: 'Mine extra iron and coal to sell or store.', description: 'Iron and coal harvests yield 50% more while the rich seam lasts.' }),
  cold_snap: Object.freeze({ label: 'Cold snap', icon: '❄', resources: ['timber', 'coal'], direction: 'Public fuel demand rises; deliveries can relieve shortages.', description: 'Public heating uses 3 extra timber and 1 extra coal each active minute, for at most 15 minutes.', demand: Object.freeze({ timber: 3, coal: 1 }) }),
  village_festival: Object.freeze({ label: 'Village festival', icon: '⚑', resources: ['wheat'], direction: 'Public wheat demand rises; sell grain at the market to replenish it.', description: 'The festival uses 3 public wheat each active minute, for at most 15 minutes.', demand: Object.freeze({ wheat: 3 }) }),
  construction_boom: Object.freeze({ label: 'Construction boom', icon: '⌂', resources: ['timber', 'stone', 'iron'], direction: 'Building supply demand rises; market deliveries replenish supplies.', description: 'Public works use 2 timber, 2 stone and 1 iron each active minute, for at most 15 minutes.', demand: Object.freeze({ timber: 2, stone: 2, iron: 1 }) })
});

export function environmentSeason(state) { return SEASONS.find(season => season.id === state?.season) ?? SEASONS[state?.seasonIndex % SEASONS.length] ?? SEASONS[0]; }
export function environmentYieldMultiplier(state, type) {
  let amount = environmentSeason(state).id === 'autumn' && type === 'wheat' ? 1.25 : 1;
  const event = state?.event?.type;
  if (event === 'bumper_harvest' && type === 'wheat' || event === 'rich_ore' && ['iron', 'coal'].includes(type)) amount *= 1.5;
  return Math.min(2, amount);
}
export function environmentRegrowMultiplier(state, type) {
  // Undefined means the original baseline, for old callers and offline tools.
  if (!state) return 1;
  const season = environmentSeason(state).id;
  if (type === 'wheat') return season === 'spring' ? .8 : season === 'winter' ? 1.25 : 1;
  return type === 'timber' && season === 'spring' ? .9 : 1;
}
