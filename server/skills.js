import { PLOTS } from '../shared/world.js';
import { canUsePlot } from '../shared/access.js';
import { ROLE_SKILLS, SKILLS, ACADEMY_COMMISSION, skillLevel, roleSkills } from '../shared/skills.js';
import { ownsStaff } from '../shared/equipment.js';
import { ensureRoleStats } from './roles.js';

export function ensureSkills(player) {
  if (!player.skills || typeof player.skills !== 'object' || Array.isArray(player.skills)) player.skills = {};
  for (const id of Object.keys(player.skills)) {
    const rank = skillLevel(player, id);
    if (!rank) delete player.skills[id]; else player.skills[id] = rank;
  }
  // Upgrade saved Build 27 staffs, including broken ones, exactly once. A saved
  // false means the permanent staff was subsequently lost and must be reclaimed.
  const legacyStaff = Object.hasOwn(player.durability ?? {}, 'staff');
  if (typeof player.staffOwned !== 'boolean') {
    player.staffOwned = legacyStaff || (player.role === 'wizard' && player.wizardStarterGranted === true);
    if (legacyStaff && player.role === 'wizard') player.wizardStarterGranted = true;
  }
  if (player.durability) delete player.durability.staff;
  if (player.maxDurability) delete player.maxDurability.staff;
  if (player.role === 'wizard' && player.wizardStarterGranted !== true) {
    // Only the first choice of Wizard grants starter equipment and mana.
    player.staffOwned = true; player.wizardStarterGranted = true;
    player.mana = 100;
    if (!player.tool) player.tool = 'staff';
  }
  const stats = roleSkills(player);
  if (!Number.isFinite(player.mana) || player.mana < 0) player.mana = player.wizardStarterGranted ? 100 : 0;
  player.mana = Math.min(stats.manaMax, player.mana);
  player.manaMax = stats.manaMax;
  if (!['fire', 'frost', 'lightning'].includes(player.staffElement)) player.staffElement = 'fire';
  if (player.role === 'wizard' && !stats.staffElements.includes(player.staffElement)) player.staffElement = 'fire';
  return player;
}

export function skillsAction(sim, village, player, action) {
  if (!['academy_learn', 'academy_reclaim_staff', 'staff_element'].includes(action.kind)) return null;
  ensureSkills(player);
  if (action.kind === 'staff_element') {
    if (player.role !== 'wizard') throw new Error('Only wizards can attune a staff.');
    if (!roleSkills(player).staffElements.includes(action.element)) throw new Error('Learn this staff element at an Arcane Academy first.');
    player.staffElement = action.element;
    return `Your staff is attuned to ${action.element}.`;
  }
  const plot = village.plots.find(item => item.id === action.plotId), site = PLOTS.find(item => item.id === plot?.id);
  if (!plot || plot.building !== 'arcane_academy' || !(plot.hp > 0) || plot.ruined === true || plot.rebuilding === true || !plot.ownerId) throw new Error('Visit a working Arcane Academy to use its services.');
  if (!canUsePlot(player, site, plot)) throw new Error('Visit the Arcane Academy entrance to use its services.');
  const owner = village.players[plot.ownerId];
  if (!owner) throw new Error('This academy has no resident owner.');
  if (action.kind === 'academy_reclaim_staff') {
    if (player.role !== 'wizard') throw new Error('Only wizards can reclaim a staff.');
    if (village.status !== 'active' || !player.online || player.downed || !(player.hp > 0)) throw new Error('A living wizard in an active village can reclaim a staff.');
    if (player.bedPlotId || player.mountedHorseId || player.carriedBy) throw new Error('Leave your bed, dismount, or have your companion put you down before reclaiming your staff.');
    if (ownsStaff(player)) return 'You already have your permanent staff.';
    player.staffOwned = true; player.tool = 'staff';
    return 'Your permanent staff has been restored for free and equipped.';
  }
  const definition = SKILLS[action.skill], current = skillLevel(player, action.skill);
  if (!definition || definition.role !== player.role) throw new Error('Choose a skill from your current role’s tree.');
  if (current >= definition.maxRank) throw new Error('This skill is already fully learned.');
  if (action.rank !== current + 1) throw new Error('Your skill rank changed. Review the next rank and try again.');
  if (definition.requires && !skillLevel(player, definition.requires)) throw new Error(`Learn ${SKILLS[definition.requires].name} first.`);
  const fee = definition.prices[current] + ACADEMY_COMMISSION;
  if (!Number.isSafeInteger(player.wallet) || player.wallet < fee) throw new Error(`This lesson costs ${fee} wallet gold, including the academy’s ${ACADEMY_COMMISSION} gold commission.`);
  if (!Number.isSafeInteger(village.treasury + fee) || !Number.isSafeInteger(owner.wallet + (owner.id === player.id ? -definition.prices[current] : ACADEMY_COMMISSION))) throw new Error('The academy cannot accept another lesson payment.');
  player.wallet -= fee; village.treasury += definition.prices[current];
  if (owner.id === player.id) owner.wallet += ACADEMY_COMMISSION;
  else {
    if (typeof sim.awardIncome === 'function') sim.awardIncome(village, owner, ACADEMY_COMMISSION);
    else owner.wallet += ACADEMY_COMMISSION;
    owner.cycleServiceIncome = (owner.cycleServiceIncome ?? 0) + ACADEMY_COMMISSION;
  }
  player.skills[action.skill] = current + 1;
  ensureSkills(player); ensureRoleStats(player, { clock: village.clock });
  return `${definition.name} rank ${current + 1} learned. This lesson stays with you throughout this village run.`;
}

export function skillsSnapshot(village, viewerId) {
  const player = village.players[viewerId];
  if (!player) return { academy: null };
  ensureSkills(player);
  const stats = roleSkills(player);
  return { academy: { skills: { ...player.skills }, role: player.role, stats, commission: ACADEMY_COMMISSION,
    mana: player.mana, manaMax: player.manaMax, staffElement: player.staffElement, staffOwned: ownsStaff(player),
    tree: (ROLE_SKILLS[player.role] ?? []).map(skill => ({ id: skill.id, rank: skillLevel(player, skill.id), nextPrice: skill.prices[skillLevel(player, skill.id)] === undefined ? null : skill.prices[skillLevel(player, skill.id)] + ACADEMY_COMMISSION })) } };
}
