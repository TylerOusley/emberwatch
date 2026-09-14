// Tunable defense and treatment costs. Resources come from the building's
// storage; repair supplies come from the shared village stock instead.
export const CHURCH = Object.freeze({ healFee: 8, reviveFee: 20, healSeconds: 10, reviveSeconds: 20, reviveHp: 45 });
export const RECRUIT = Object.freeze({ gold: 35, resources: Object.freeze({ timber: 5, iron: 2 }), capacity: 3 });
export const DEFENSE_UPGRADES = Object.freeze({
  church: { gold: 120, resources: { timber: 30, stone: 30 } },
  barracks: { gold: 150, resources: { timber: 30, stone: 25, iron: 15 } },
  archer_tower: { gold: 180, resources: { timber: 35, stone: 25, iron: 10 } },
  cannon: { gold: 250, resources: { timber: 20, stone: 50, iron: 25 } }
});
export const TOWER_STATS = Object.freeze({
  archer_tower: { range: 22, damage: 20, cooldown: 1.6, ammo: { arrows: 1 } },
  cannon: { range: 26, damage: 48, cooldown: 4, splash: 3.5, ammo: { coal: 1, stone: 1 } }
});
export const bedCapacity = plot => (plot.level ?? 1) >= 2 ? 4 : 2;
