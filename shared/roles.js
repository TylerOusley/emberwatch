// Role traits remain independent of earned equipment and can be rebalanced here.
export const ROLE_STATS = Object.freeze({
  guard: Object.freeze({ maxHp: 100, maxShield: 40, shieldDelay: 6, shieldRegen: 4, extraCapacity: 0 }),
  priest: Object.freeze({ maxHp: 125, maxShield: 0, shieldDelay: 0, shieldRegen: 0, extraCapacity: 0 }),
  villager: Object.freeze({ maxHp: 100, maxShield: 0, shieldDelay: 0, shieldRegen: 0, extraCapacity: 50 }),
  manager: Object.freeze({ maxHp: 100, maxShield: 0, shieldDelay: 0, shieldRegen: 0, extraCapacity: 0 }),
  tinker: Object.freeze({ maxHp: 100, maxShield: 0, shieldDelay: 0, shieldRegen: 0, extraCapacity: 0 }),
  wizard: Object.freeze({ maxHp: 100, maxShield: 0, shieldDelay: 0, shieldRegen: 0, extraCapacity: 0 })
});
export const ROLE_DESCRIPTIONS = Object.freeze({
  villager: 'Gather, build and trade with 50 extra carrying capacity.',
  guard: 'Command barracks, build sword shops and defend with a regenerating shield.',
  priest: 'Heal and revive allies, build churches and earn care pay.',
  manager: 'Lead 8 personal workers plus plot staff; pay 1 gold per 60 worked seconds.',
  tinker: 'Own tool, tinker and sword shops; recipes use up to 10% fewer materials for every customer.',
  wizard: 'Start with a fire staff. Build Arcane Academies and sulfur-fed wizard towers.'
});
export function roleCanBuild(role, type) { return !type?.role || type.role === role || type.roles?.includes(role) === true; }
