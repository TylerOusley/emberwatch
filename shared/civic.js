export const CIVIC_BOARD = Object.freeze({ x: -10, z: -23, name: 'Village works board' });
export const CIVIC_PROJECTS = Object.freeze({
  reinforcement: { name: 'Reinforced gate and keep', description: '+1,200 gate health and +1,000 keep health.', cost: { timber: 300, stone: 500, gold: 5000 } },
  repair_crew: { name: 'Village repair crew', description: 'A dedicated mason repairs the gate and keep using donated supplies and one gold per minute worked.', requires: 'reinforcement', cost: { timber: 400, stone: 600, iron: 100, gold: 10000 } },
  ballista: { name: 'Gatehouse ballista', description: '65 damage, 40 m range, one arrow every 5 seconds. Donate ammunition to the works depot.', requires: 'reinforcement', cost: { timber: 1000, stone: 500, iron: 300, gold: 15000 } },
  trebuchet: { name: 'Wall trebuchet', description: '100 damage in a 5 m burst, 52 m range, five stone and one coal every 12 seconds.', requires: 'ballista', cost: { timber: 1500, stone: 2000, iron: 500, gold: 30000 } }
});
export const CIVIC_DEPOT_ITEMS = Object.freeze(['gold', 'timber', 'stone', 'coal', 'arrows']);
export const CIVIC_SIEGE = Object.freeze({
  ballista: { x: -8, z: 18, range: 40, damage: 65, cooldown: 5, ammo: { arrows: 1 } },
  trebuchet: { x: 8, z: 18, range: 52, damage: 100, cooldown: 12, splash: 5, ammo: { stone: 5, coal: 1 } }
});
