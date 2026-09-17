// Shared, inspectable balance values. Prices and recipes are validated again by the server.
import { ROLE_STATS } from './roles.js';
import { equippedItem, GATHERING_TOOLS } from './crates.js';
import { roleSkills } from './skills.js';
export const MAX_PLOTS = 8;
export const PLOT_PRICES = Object.freeze([100, 200, 350, 550, 800, 1100, 1450, 1850]);
export const CARRY_CAPACITY = 100;
export const BACKPACKS = Object.freeze([
  Object.freeze({ tier: 0, name: 'Pockets', capacity: CARRY_CAPACITY, price: 0 }),
  Object.freeze({ tier: 1, name: 'Simple backpack', capacity: 200, price: 40 }),
  Object.freeze({ tier: 2, name: 'Reinforced backpack', capacity: 350, price: 100 }),
  Object.freeze({ tier: 3, name: 'Expedition backpack', capacity: 500, price: 200 })
]);
// Equipped capacity comes from the saved tier, never a capacity sent by a client.
export function carryCapacity(player = {}) {
  const equipmentCapacity = (Number.isInteger(player.backpackTier) ? BACKPACKS[player.backpackTier] : null)?.capacity ?? CARRY_CAPACITY;
  return equipmentCapacity + (ROLE_STATS[player.role]?.extraCapacity ?? 0) + roleSkills(player).extraCapacity + (equippedItem(player, 'utility')?.capacity ?? 0);
}
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
  sword_shop: { name: 'Sword shop', cost: { gold: 60, timber: 20, stone: 25 }, role: 'guard', roles: ['guard', 'tinker'], maxHp: 400 },
  church: { name: 'Church', cost: { gold: 100, timber: 30, stone: 40 }, role: 'priest', maxHp: 650 },
  archer_tower: { name: 'Archer tower', cost: { gold: 200, timber: 60, stone: 40 }, maxHp: 700 },
  cannon: { name: 'Cannon defense', cost: { gold: 500, timber: 40, stone: 100, iron: 20 }, maxHp: 900 },
  arcane_academy: { name: 'Arcane Academy', cost: { gold: 350, timber: 70, stone: 100, iron: 20 }, role: 'wizard', maxHp: 700 },
  wizard_tower: { name: 'Wizard tower', cost: { gold: 600, timber: 50, stone: 120, iron: 25, sulfur: 20 }, role: 'wizard', maxHp: 800 }
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
recipes.gunpowder = { name: '5 gunpowder', shop: 'tinker_shop', item: 'gunpowder', amount: 5, cost: { sulfur: 2, coal: 1 }, price: 20, stockable: true };
recipes.musket = { name: 'Musket', shop: 'tinker_shop', tool: 'musket', tier: 'wood', cost: { iron: 14, timber: 16 }, price: 180 };
recipes.musket_ammo = { name: '8 musket shots', shop: 'tinker_shop', item: 'musket_ammo', amount: 8, cost: { stone: 4, gunpowder: 2 }, price: 24, stockable: true };
recipes.cart = { name: 'Cargo cart', shop: 'tinker_shop', item: 'cart', amount: 1, cost: { timber: 35, iron: 8 }, price: 100 };
recipes.staff = { name: 'Fire staff', shop: 'tinker_shop', tool: 'staff', tier: 'wood', cost: { timber: 12, iron: 3, sulfur: 4 }, price: 60 };
export const RECIPES = Object.freeze(recipes);
export const SHOP_PRICE_LIMIT = 10000;
export const SHOP_CRAFT_BATCH_LIMIT = 100;
export function shopPrice(plot, recipeId) {
  const recipe = typeof recipeId === 'string' && Object.hasOwn(RECIPES, recipeId) ? RECIPES[recipeId] : null;
  if (!recipe || recipe.shop !== plot?.building) return null;
  const saved = plot.shopPrices?.[recipeId];
  return Number.isSafeInteger(saved) && saved >= 1 && saved <= SHOP_PRICE_LIMIT ? saved : recipe.price;
}
export const RESOURCE_WEIGHTS = Object.freeze({ timber: 2, stone: 3, wheat: 1, iron: 3, coal: 2, sulfur: 2, gunpowder: .2, musket_ammo: .2, food: 1, good_food: 1, best_food: 1, arrows: .1, cart: 12 });
export const TOOL_WEIGHTS = Object.freeze({ sword: 2, axe: 3, pickaxe: 3, scythe: 2, hammer: 2, bow: 2, musket: 5, staff: 3 });
export function resourceWeight(player, id) {
  return (RESOURCE_WEIGHTS[id] ?? 1) * (equippedItem(player, 'utility')?.weights?.[id] ?? 1);
}
export function boundInventoryCount(player, id) {
  const count = player?.inventory?.[id] ?? 0, bound = player?.boundInventory?.[id] ?? 0;
  return Number.isSafeInteger(count) && count > 0 && Number.isSafeInteger(bound) && bound > 0 ? Math.min(count, bound) : 0;
}
export function transferableCount(player, id) {
  const count = player?.inventory?.[id] ?? 0;
  return Number.isSafeInteger(count) && count >= 0 ? count - boundInventoryCount(player, id) : 0;
}
export function acquiredToolDurability(player, tool, tier = 'wood', { starter = false } = {}) {
  const base = TOOL_TIERS[tier]?.durability ?? TOOL_TIERS.wood.durability;
  const multiplier = !starter && GATHERING_TOOLS.includes(tool) ? equippedItem(player, 'utility')?.gatheringDurability ?? 1 : 1;
  return Math.round(base * multiplier);
}
// Recovery fills metadata only. Equipping a buckle never repairs an existing tool.
export function normalizeToolDurability(player) {
  if (!player.maxDurability || typeof player.maxDurability !== 'object' || Array.isArray(player.maxDurability)) player.maxDurability = {};
  for (const tool of Object.keys(TOOL_WEIGHTS)) {
    if (Number.isSafeInteger(player.maxDurability[tool]) && player.maxDurability[tool] > 0) continue;
    const base = TOOL_TIERS[player.tiers?.[tool]]?.durability ?? TOOL_TIERS.wood.durability;
    const remaining = Number.isSafeInteger(player.durability?.[tool]) ? player.durability[tool] : 0;
    player.maxDurability[tool] = Math.max(base, remaining);
  }
  return player.maxDurability;
}
export function inventoryWeight(value = {}) {
  const inventory = value.inventory ?? value;
  let weight = Object.entries(inventory).reduce((sum, [id, amount]) => sum + (Number.isFinite(amount) && amount > 0 ? amount * resourceWeight(value.inventory ? value : null, id) : 0), 0);
  if (value.inventory) for (const [id, amount] of Object.entries(value.durability ?? {})) if (amount > 0) weight += TOOL_WEIGHTS[id] ?? 0;
  return Math.round(weight * 100) / 100;
}
