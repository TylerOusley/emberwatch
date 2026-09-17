export const STARTER_GOLD = 10;
export const FOOD_IDS = ['food', 'good_food', 'best_food'];
const TOOLS = new Set(['sword', 'axe', 'pickaxe', 'scythe', 'hammer', 'bow', 'musket']);

// Empty hands are a real equipment state, shared by the client and server.
export function canEquip(player, item) {
  if (item === '') return true;
  if (!player) return false;
  if (item === 'heal') return player.role === 'priest';
  if (FOOD_IDS.includes(item)) return (player.inventory?.[item] ?? 0) > 0;
  return TOOLS.has(item) && (player.durability?.[item] ?? 0) > 0;
}
