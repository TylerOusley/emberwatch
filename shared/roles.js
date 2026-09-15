// Role traits remain independent of earned equipment and can be rebalanced here.
export const ROLE_STATS = Object.freeze({
  guard: Object.freeze({ maxHp: 100, maxShield: 40, shieldDelay: 6, shieldRegen: 4, extraCapacity: 0 }),
  priest: Object.freeze({ maxHp: 125, maxShield: 0, shieldDelay: 0, shieldRegen: 0, extraCapacity: 0 }),
  villager: Object.freeze({ maxHp: 100, maxShield: 0, shieldDelay: 0, shieldRegen: 0, extraCapacity: 50 })
});
