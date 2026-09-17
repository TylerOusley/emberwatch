// Academy learning belongs to the resident for this village run. Changing roles,
// reconnecting, respawning or losing the academy never removes learned ranks.
export const ACADEMY_COMMISSION = 25;
const branch = (id, role, name, description, prices, requires = null) => Object.freeze({ id, role, name, description, prices: Object.freeze(prices), maxRank: prices.length, requires });
export const ROLE_SKILLS = Object.freeze({
  villager: Object.freeze([
    branch('villager_packing', 'villager', 'Deep pockets', '+25 carrying capacity per rank.', [150, 400]),
    branch('villager_provisions', 'villager', 'Trail provisions', 'Hunger drains 10% more slowly per rank.', [150, 400])
  ]),
  guard: Object.freeze([
    branch('guard_vitality', 'guard', 'Veteran endurance', '+15 maximum health per rank; preserves your current health percentage.', [200, 500]),
    branch('guard_shield', 'guard', 'Bulwark', '+10 regenerating shield per rank.', [200, 500]),
    branch('guard_command', 'guard', 'Watch captain', '+1 troop slot in each owned barracks per rank.', [400, 900], 'guard_vitality')
  ]),
  priest: Object.freeze([
    branch('priest_blessing', 'priest', 'Restorative blessing', 'Field blessings restore 15% more health per rank.', [200, 500]),
    branch('priest_revive', 'priest', 'Steady hands', 'Field revivals take 10% less time per rank.', [200, 500], 'priest_blessing')
  ]),
  manager: Object.freeze([
    branch('manager_logistics', 'manager', 'Organized crews', '+10 worker cargo capacity and 10% faster gathering per rank.', [250, 650]),
    branch('manager_staffing', 'manager', 'Workforce planning', '+1 personal worker slot per rank, up to 10.', [400, 900], 'manager_logistics')
  ]),
  tinker: Object.freeze([
    branch('tinker_efficiency', 'tinker', 'Efficient patterns', 'Another 5% material saving per rank in your shops, up to 20%.', [250, 650]),
    branch('tinker_maintenance', 'tinker', 'Master repairs', 'Hammer repairs restore 15% more health per rank.', [250, 650], 'tinker_efficiency')
  ]),
  wizard: Object.freeze([
    branch('wizard_focus', 'wizard', 'Arcane focus', '+15 maximum mana and 10% staff damage per rank.', [250, 650]),
    branch('wizard_frost', 'wizard', 'Frost attunement', 'Unlock frost bolts that slow one enemy by 35% for 3 seconds.', [400], 'wizard_focus'),
    branch('wizard_lightning', 'wizard', 'Storm attunement', 'Unlock lightning that chains to at most 3 enemies with diminishing damage.', [800], 'wizard_focus')
  ])
});
export const SKILLS = Object.freeze(Object.fromEntries(Object.values(ROLE_SKILLS).flat().map(skill => [skill.id, skill])));
export function skillLevel(player, id) {
  const definition = SKILLS[id], saved = player?.skills?.[id];
  return definition && Number.isSafeInteger(saved) && saved > 0 ? Math.min(definition.maxRank, saved) : 0;
}
export function roleSkills(player = {}) {
  const rank = id => SKILLS[id]?.role === player.role ? skillLevel(player, id) : 0;
  return {
    extraCapacity: rank('villager_packing') * 25,
    hungerMultiplier: 1 - rank('villager_provisions') * .1,
    maxHpBonus: rank('guard_vitality') * 15,
    extraShield: rank('guard_shield') * 10,
    troopCapacityBonus: rank('guard_command'),
    healMultiplier: 1 + rank('priest_blessing') * .15,
    reviveSecondsMultiplier: 1 - rank('priest_revive') * .1,
    workerLimit: player.role === 'manager' ? 8 + rank('manager_staffing') : 5,
    workerWageSeconds: player.role === 'manager' ? 60 : 30,
    workerCargoBonus: rank('manager_logistics') * 10,
    workerGatherMultiplier: 1 + rank('manager_logistics') * .1,
    tinkerCraftDiscount: player.role === 'tinker' ? .1 + rank('tinker_efficiency') * .05 : 0,
    repairMultiplier: 1 + rank('tinker_maintenance') * .15,
    manaMax: 100 + rank('wizard_focus') * 15,
    staffDamageMultiplier: 1 + rank('wizard_focus') * .1,
    staffElements: player.role === 'wizard' ? ['fire', ...(rank('wizard_frost') ? ['frost'] : []), ...(rank('wizard_lightning') ? ['lightning'] : [])] : []
  };
}
// Round costs up, never down. A one-material recipe still needs that material;
// stocking larger batches exposes fractional savings without free ingredients.
export function craftingCost(recipe, owner, batches = 1) {
  const percent = Math.round(roleSkills(owner).tinkerCraftDiscount * 100);
  return Object.fromEntries(Object.entries(recipe.cost).map(([id, quantity]) => [id, Math.max(1, Math.ceil(quantity * batches * (100 - percent) / 100))]));
}
