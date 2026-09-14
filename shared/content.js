// Shared, inspectable balance values. Prices and recipes are validated again by the server.
export const MAX_PLOTS = 5;
export const PLOT_PRICES = Object.freeze([100, 200, 350, 550, 800]);
export const CARRY_CAPACITY = 100;
export const STORAGE_CAPACITY = 1500;
export const TOOL_TIERS = Object.freeze({
  wood: { name: 'Wooden', yield: 1, durability: 100, swordDamage: 10, repair: 35 },
  stone: { name: 'Stone', yield: 2, durability: 150, swordDamage: 15, repair: 55 },
  iron: { name: 'Iron', yield: 3, durability: 200, swordDamage: 20, repair: 80 }
});
export const BUILDING_TYPES = Object.freeze({
  tool_shop: { name: 'Tool shop', cost: { gold: 40, timber: 20, stone: 10 }, maxHp: 350 },
  tinker_shop: { name: 'Tinker shop', cost: { gold: 60, timber: 25, stone: 15 }, maxHp: 350 },
  mine: { name: 'Mine', cost: { gold: 50, timber: 20, stone: 10 }, maxHp: 450 },
  tree_farm: { name: 'Tree farm', cost: { gold: 25, timber: 10 }, maxHp: 250 },
  wheat_farm: { name: 'Wheat farm', cost: { gold: 20, timber: 10 }, maxHp: 250 },
  house: { name: 'House', cost: { gold: 40, timber: 25, stone: 15 }, maxHp: 500 },
  barracks: { name: 'Barracks', cost: { gold: 100, timber: 35, stone: 25 }, role: 'guard', maxHp: 650, limit: 2 },
  sword_shop: { name: 'Sword shop', cost: { gold: 60, timber: 20, stone: 25 }, role: 'guard', maxHp: 400 },
  church: { name: 'Church', cost: { gold: 100, timber: 30, stone: 40 }, role: 'priest', maxHp: 650 },
  archer_tower: { name: 'Archer tower', cost: { gold: 200, timber: 60, stone: 40 }, maxHp: 700 },
  cannon: { name: 'Cannon defense', cost: { gold: 500, timber: 40, stone: 100, iron: 20 }, maxHp: 900 }
});

const recipes = {};
for (const tier of ['stone', 'iron']) {
  for (const tool of ['axe', 'pickaxe', 'scythe', 'hammer']) {
    recipes[`${tier}_${tool}`] = {
      name: `${TOOL_TIERS[tier].name} ${tool}`, shop: 'tool_shop', tool, tier,
      cost: tier === 'stone' ? { stone: 10, timber: 5 } : { iron: 8, coal: 3, timber: 5 },
      price: tier === 'stone' ? 35 : 75
    };
  }
}
for (const tier of ['wood', 'stone', 'iron']) {
  recipes[`${tier}_sword`] = {
    name: `${TOOL_TIERS[tier].name} sword`, shop: 'sword_shop', tool: 'sword', tier,
    cost: tier === 'wood' ? { timber: 8 } : tier === 'stone' ? { timber: 4, stone: 10 } : { timber: 4, iron: 10, coal: 3 },
    price: tier === 'wood' ? 20 : tier === 'stone' ? 40 : 80
  };
}
recipes.bow = { name: 'Bow', shop: 'tinker_shop', tool: 'bow', tier: 'wood', cost: { timber: 12, iron: 2 }, price: 45 };
recipes.arrows = { name: '12 arrows', shop: 'tinker_shop', item: 'arrows', amount: 12, cost: { timber: 3, stone: 2 }, price: 12 };
recipes.cart = { name: 'Cargo cart', shop: 'tinker_shop', item: 'cart', amount: 1, cost: { timber: 35, iron: 8 }, price: 100 };
export const RECIPES = Object.freeze(recipes);
export const RESOURCE_WEIGHTS = Object.freeze({ timber: 2, stone: 3, wheat: 1, iron: 3, coal: 2, food: 1, good_food: 1, best_food: 1, arrows: .1, cart: 12 });
export const TOOL_WEIGHTS = Object.freeze({ sword: 2, axe: 3, pickaxe: 3, scythe: 2, hammer: 2, bow: 2 });
export function inventoryWeight(value = {}) {
  const inventory = value.inventory ?? value;
  let weight = Object.entries(inventory).reduce((sum, [id, amount]) => sum + (Number.isFinite(amount) && amount > 0 ? amount * (RESOURCE_WEIGHTS[id] ?? 1) : 0), 0);
  if (value.inventory) for (const [id, amount] of Object.entries(value.durability ?? {})) if (amount > 0) weight += TOOL_WEIGHTS[id] ?? 0;
  return Math.round(weight * 100) / 100;
}
