// Barracks share their recruited slots across all unit types. Building upgrades
// add room; individual training determines each soldier's combat strength.
export const TROOP_TYPES = Object.freeze({
  sword: Object.freeze({ name: 'Swordsman', tool: 'sword', gold: 35, resources: Object.freeze({ timber: 5, iron: 2 }), hp: 160, veteranHp: 220, damage: 14, veteranDamage: 18, range: 2.1, cooldown: 1.05, ammo: null, upgrade: Object.freeze({ gold: 50, resources: Object.freeze({ timber: 8, iron: 4 }) }) }),
  archer: Object.freeze({ name: 'Archer', tool: 'bow', gold: 45, resources: Object.freeze({ timber: 8, iron: 2 }), hp: 120, veteranHp: 160, damage: 18, veteranDamage: 25, range: 22, cooldown: 1.8, ammo: 'arrows', upgrade: Object.freeze({ gold: 55, resources: Object.freeze({ timber: 10, iron: 3 }) }) }),
  musketeer: Object.freeze({ name: 'Musketeer', tool: 'musket', gold: 70, resources: Object.freeze({ timber: 8, iron: 6 }), hp: 130, veteranHp: 180, damage: 48, veteranDamage: 64, range: 30, cooldown: 3.3, ammo: 'musket_ammo', upgrade: Object.freeze({ gold: 75, resources: Object.freeze({ timber: 6, iron: 8 }) }) })
});
export const barracksCapacity = plot => (plot?.level ?? 1) >= 2 ? 6 : 3;
export const troopType = guard => Object.hasOwn(TROOP_TYPES, guard?.unitType) ? guard.unitType : 'sword';
export function troopStats(guard) {
  const definition = TROOP_TYPES[troopType(guard)], level = guard?.troopLevel >= 2 ? 2 : 1;
  return { ...definition, level, hp: level === 2 ? definition.veteranHp : definition.hp, damage: level === 2 ? definition.veteranDamage : definition.damage };
}
