export const MAGIC = Object.freeze({ manaRegen: 8, staffDurability: 100, range: 23,
  fire: Object.freeze({ name: 'Fire', damage: 24, mana: 15, cooldown: 1.8, burnDamage: 3, burnSeconds: 3, color: 0xff873b }),
  frost: Object.freeze({ name: 'Frost', damage: 20, mana: 15, cooldown: 1.8, slowMultiplier: .65, slowSeconds: 3, color: 0x88dfff }),
  lightning: Object.freeze({ name: 'Lightning', damage: 22, mana: 22, cooldown: 2.2, chainRange: 5, chainTargets: 3, chainFalloff: .6, color: 0xb9a1ff })
});
export function magicMovementMultiplier(entity, clock) { return Number.isFinite(entity?.magicSlowUntil) && entity.magicSlowUntil > clock ? MAGIC.frost.slowMultiplier : 1; }
