export const PET_RARITIES = Object.freeze({
  common: Object.freeze({ name: 'Common', chance: 38 }),
  uncommon: Object.freeze({ name: 'Uncommon', chance: 30 }),
  rare: Object.freeze({ name: 'Rare', chance: 20 }),
  epic: Object.freeze({ name: 'Epic', chance: 10 }),
  legendary: Object.freeze({ name: 'Legendary', chance: 2 })
});
export const PET_RARITY_ORDER = Object.freeze(Object.keys(PET_RARITIES));
export const PET_RARITY_ODDS = Object.freeze(Object.fromEntries(PET_RARITY_ORDER.map(id => [id, PET_RARITIES[id].chance])));
const melee = (damage, flying = false, healOnHit = 0) => Object.freeze({ kind: 'melee', damage, cooldown: 2, range: flying ? 2.7 : 2.2, ...(healOnHit ? { healOnHit } : {}) });
const ranged = (damage, projectile) => Object.freeze({ kind: 'ranged', damage, cooldown: 2, range: 10, projectile });
const pet = (id, name, rarity, description, attack = null, carryBonus = 0, flying = false) => Object.freeze({ name, rarity, description, assetId: id, flying, attack, carryBonus });
export const PET_CATALOG = Object.freeze({
  rabbit: pet('rabbit', 'Rabbit', 'common', 'A faithful pack companion. Increases your carry capacity by 20%.', null, .20),
  marmot: pet('marmot', 'Marmot', 'common', 'A sturdy little helper. Increases your carry capacity by 15%.', null, .15),
  husky: pet('husky', 'Husky', 'common', 'Bites nearby enemies for 8 damage every 2 seconds.', melee(8)),
  shiba: pet('shiba', 'Shiba', 'common', 'Bites nearby enemies for 8 damage every 2 seconds.', melee(8)),
  fox: pet('fox', 'Fox', 'uncommon', 'Strikes nearby enemies for 12 damage every 2 seconds.', melee(12)),
  boar: pet('boar', 'Boar', 'uncommon', 'Gores nearby enemies for 12 damage every 2 seconds.', melee(12)),
  squirrel: pet('squirrel', 'Undead Squirrel', 'uncommon', 'An unusual pack companion. Increases your carry capacity by 25%.', null, .25),
  wolf: pet('wolf', 'Wolf', 'rare', 'Bites nearby enemies for 20 damage every 2 seconds.', melee(20)),
  owl: pet('owl', 'Owl', 'rare', 'Fires a gust of wind for 20 damage every 2 seconds.', ranged(20, 'wind'), 0, true),
  frost_bat: pet('frost_bat', 'Frost Bat', 'epic', 'Fires a frost bolt for 32 damage every 2 seconds.', ranged(32, 'frost'), 0, true),
  griffin: pet('griffin', 'Griffin', 'epic', 'Swoops at nearby enemies for 32 damage every 2 seconds.', melee(32, true), 0, true),
  dragon: pet('dragon', 'Dragon', 'legendary', 'Breathes fire for 50 damage every 2 seconds.', ranged(50, 'fire')),
  vampire_bat: pet('vampire_bat', 'Vampire Bat', 'legendary', 'Bites for 50 damage every 2 seconds and heals you for 2 health on each successful hit.', melee(50, true, 2), 0, true)
});
export const PET_CATALOG_VERSION = 2;
export const PET_RULES = Object.freeze({ incubationSeconds: 30 * 60, merchantChancePercent: 25, eggPrice: 5000, eggsPerVisit: 1, duplicateRefund: 1000 });
export const PET_STAGING_MESSAGE = 'Pet companions are being prepared. Egg sales will open after the pets and their artwork are selected.';

// Exactly 100 equally likely buckets; collection ownership never changes these.
export function petRarityForRoll(roll) {
  if (!Number.isInteger(roll) || roll < 0 || roll >= 100) throw new Error('Pet rarity roll must be a whole number from 0 to 99.');
  let threshold = 0;
  for (const rarity of PET_RARITY_ORDER) { threshold += PET_RARITIES[rarity].chance; if (roll < threshold) return rarity; }
}

export function petIncubationRemaining(hatchAt, serverNow) {
  return Math.max(0, Math.ceil((hatchAt - serverNow) / 1000));
}
