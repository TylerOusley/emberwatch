import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_SKILLS, roleSkills, craftingCost } from '../shared/skills.js';
import { ROLE_STATS, roleCanBuild } from '../shared/roles.js';
import { RECIPES, BUILDING_TYPES, carryCapacity } from '../shared/content.js';
import { MAGIC, magicMovementMultiplier } from '../shared/magic.js';
import { canEquip } from '../shared/equipment.js';
import { PLOTS } from '../shared/world.js';
import { plotEntrance } from '../shared/access.js';
import { ensureSkills, skillsAction, skillsSnapshot } from '../server/skills.js';
import { ensureRoleStats } from '../server/roles.js';
import { ensureOwnership, ownershipAction } from '../server/ownership.js';
import { magicAttack, magicTick } from '../server/magic.js';
import { academyModel } from '../public/src/skills-ui.js';

function fixture(role = 'villager') {
  const player = { id: 'student', name: 'Student', role, wallet: 10000, hp: 100, maxHp: 100, online: true, inventory: {}, durability: {}, x: 0, z: 0, yaw: 0 };
  const owner = { id: 'teacher', name: 'Teacher', role: 'wizard', wallet: 1000, online: false, hp: 100, maxHp: 100, inventory: {}, durability: {} };
  const village = { id: 'village', day: 1, phase: 'day', players: { student: player, teacher: owner }, treasury: 1000, clock: 0, guards: [], zombies: [], policies: { tradeTax: 5 } };
  ensureOwnership(village);
  const plot = village.plots[0]; Object.assign(plot, { ownerId: owner.id, building: 'arcane_academy', hp: 700, maxHp: 700 });
  Object.assign(player, plotEntrance(PLOTS[0], plot));
  const sim = { awardIncome(v, p, amount) { p.wallet += amount; }, clearAttack: () => true, hitZombie(v, z, amount) { z.hp = Math.max(0, z.hp - amount); }, store: { account: () => ({ debt: 0, credit: 0 }) } };
  const learn = (skill, rank = 1) => skillsAction(sim, village, player, { kind: 'academy_learn', plotId: plot.id, skill, rank });
  return { player, owner, village, plot, sim, learn };
}

test('all six roles have real trees; learned ranks persist while only the current role supplies benefits', () => {
  assert.deepEqual(Object.keys(ROLE_SKILLS).sort(), Object.keys(ROLE_STATS).sort());
  const { player, owner, village, learn } = fixture();
  learn('villager_packing'); learn('villager_packing', 2);
  assert.equal(carryCapacity(player), 200);
  assert.equal(player.wallet, 9400); assert.equal(owner.wallet, 1050); assert.equal(village.treasury, 1550);
  player.role = 'guard'; player.skills.guard_vitality = 2; player.skills.guard_shield = 2; player.skills.guard_command = 2;
  ensureRoleStats(player, { clock: 0 });
  assert.equal(player.maxHp, 130); assert.equal(player.maxShield, 60); assert.equal(carryCapacity(player), 100);
  assert.equal(roleSkills(player).troopCapacityBonus, 2);
  player.role = 'villager'; ensureSkills(player);
  assert.equal(carryCapacity(player), 200); assert.equal(roleSkills(player).troopCapacityBonus, 0);
  const restored = JSON.parse(JSON.stringify(player)); ensureSkills(restored);
  assert.deepEqual(restored.skills, player.skills);
});

test('academy payments are atomic after eligibility checks and duplicate rank requests cannot buy extra levels', () => {
  const f = fixture('manager');
  assert.throws(() => f.learn('manager_staffing'), /Organized crews/);
  assert.throws(() => f.learn('wizard_focus'), /current role/);
  assert.equal(f.player.wallet, 10000);
  f.learn('manager_logistics'); const wallet = f.player.wallet;
  assert.throws(() => f.learn('manager_logistics'), /rank changed/);
  assert.equal(f.player.wallet, wallet);
  f.learn('manager_staffing'); f.learn('manager_staffing', 2);
  assert.equal(roleSkills(f.player).workerLimit, 10); assert.equal(roleSkills(f.player).workerWageSeconds, 60);
  const before = JSON.stringify(f.village);
  f.plot.hp = 0;
  assert.throws(() => f.learn('manager_logistics', 2), /working Arcane Academy/);
  f.plot.hp = 700; assert.equal(JSON.stringify(f.village), before);
  f.player.x += 100;
  assert.throws(() => f.learn('manager_logistics', 2), /entrance/);
});

test('academy UI uses the same saved ranks, fees, prerequisites and local access as the server', () => {
  const { village, player, plot, learn } = fixture('wizard');
  let state = { ...village, ...skillsSnapshot(village, player.id) };
  let model = academyModel(state, player, plot.id);
  assert.equal(model.skills.find(skill => skill.id === 'wizard_focus').price, 275);
  assert.equal(model.skills.find(skill => skill.id === 'wizard_lightning').available, false);
  learn('wizard_focus');
  state = { ...village, ...skillsSnapshot(village, player.id) }; model = academyModel(state, player, plot.id);
  assert.equal(model.skills.find(skill => skill.id === 'wizard_lightning').available, true);
  assert.equal(academyModel(state, player, plot.id, 'guard').skills.every(skill => !skill.available), true);
  plot.hp = 0; assert.equal(academyModel(state, player, plot.id).nearby, false);
});

test('Tinker recipes discount the owner’s workshops for offline visitor purchases; prices remain independent', () => {
  const { player, owner, village, plot, sim } = fixture();
  owner.role = 'tinker'; plot.building = 'tinker_shop'; plot.storage = { sulfur: 18, coal: 9 }; plot.shopPrices = { gunpowder: 37 };
  const entrance = plotEntrance(PLOTS[0], plot); Object.assign(owner, entrance); Object.assign(player, entrance);
  ownershipAction(sim, village, owner, { kind: 'craft_stock', plotId: plot.id, recipe: 'gunpowder', batches: 10 });
  assert.equal(plot.storage.sulfur, 0); assert.equal(plot.storage.coal, 0); assert.equal(plot.storage.gunpowder, 50);
  ownershipAction(sim, village, player, { kind: 'craft_buy', plotId: plot.id, recipe: 'gunpowder', price: 37 });
  assert.equal(player.inventory.gunpowder, 5); assert.equal(player.wallet, 9963); assert.equal(owner.wallet, 1036);
  assert.deepEqual(craftingCost(RECIPES.gunpowder, owner), { sulfur: 2, coal: 1 });
  owner.skills.tinker_efficiency = 2;
  assert.deepEqual(craftingCost(RECIPES.musket, owner), { iron_ingot: 12, timber: 13 });
  plot.shopPrices.musket = 225; plot.storage = { iron: 12, timber: 13 };
  const before = structuredClone({ storage: plot.storage, wallet: player.wallet, ownerWallet: owner.wallet });
  assert.throws(() => ownershipAction(sim, village, player, { kind: 'craft_buy', plotId: plot.id, recipe: 'musket', price: 225 }), /iron_ingot/);
  assert.deepEqual({ storage: plot.storage, wallet: player.wallet, ownerWallet: owner.wallet }, before, 'raw ore cannot replace the discounted ingot ingredients');
  plot.storage.iron_ingot = 12;
  ownershipAction(sim, village, player, { kind: 'craft_buy', plotId: plot.id, recipe: 'musket', price: 225 });
  assert.equal(player.durability.musket, 100); assert.equal(player.wallet, 9738);
  assert.equal(owner.wallet, 1250, 'the offline owner receives their chosen price minus treasury tax');
  assert.deepEqual(plot.storage, { iron: 12, timber: 0, iron_ingot: 0 });
  assert.deepEqual(craftingCost(RECIPES.gunpowder, owner, 10), { sulfur: 16, coal: 8 });
  assert.equal(roleCanBuild('tinker', BUILDING_TYPES.sword_shop), true);
  assert.equal(roleCanBuild('villager', BUILDING_TYPES.sword_shop), false);
});

test('Wizard starter equipment and mana are granted once, and staff attunement requires learned skills', () => {
  const { player, village, sim } = fixture('wizard');
  assert.equal(player.staffOwned, true); assert.equal(player.durability.staff, undefined); assert.equal(canEquip(player, 'staff'), true);
  player.staffOwned = false; player.mana = 7; player.role = 'villager'; ensureSkills(player);
  assert.equal(canEquip(player, 'staff'), false);
  player.role = 'wizard'; ensureSkills(player);
  assert.equal(player.staffOwned, false); assert.equal(player.mana, 7);
  assert.throws(() => skillsAction(sim, village, player, { kind: 'staff_element', element: 'lightning' }), /Learn/);
  player.skills.wizard_lightning = 1;
  skillsAction(sim, village, player, { kind: 'staff_element', element: 'lightning' });
  assert.equal(player.staffElement, 'lightning');
  const laterWizard = fixture().player;
  assert.equal(laterWizard.mana, 0); laterWizard.role = 'wizard'; ensureSkills(laterWizard);
  assert.equal(laterWizard.mana, 100, 'the first Wizard role grants mana even when another role was chosen at join');
});

test('staff spells enforce mana, cooldown, ownership and the same line of sight as ranged combat', () => {
  const { player, village, sim } = fixture('wizard');
  Object.assign(player, { x: 0, z: 0, yaw: 0, tool: 'staff' });
  const target = { id: 'z', x: 0, z: 10, hp: 100 }; village.zombies = [target];
  sim.clearAttack = () => false;
  magicAttack(sim, village, player, { kind: 'attack' });
  assert.equal(target.hp, 100); assert.equal(player.mana, 85); assert.equal(player.staffOwned, true); assert.equal(player.durability.staff, undefined);
  assert.throws(() => magicAttack(sim, village, player, { kind: 'attack' }), /recovering/);
  village.clock = 2; sim.clearAttack = () => true;
  magicAttack(sim, village, player, { kind: 'attack' });
  assert.equal(target.hp, 76);
  village.clock = 5; magicTick(sim, village, 3);
  assert.equal(target.hp, 67); magicTick(sim, village, 3); assert.equal(target.hp, 67, 'same elapsed interval cannot repeat burn damage');
  village.clock = 6; player.mana = 0;
  assert.throws(() => magicAttack(sim, village, player, { kind: 'attack' }), /mana/);
});

test('frost expiration and bounded lightning chains survive saved state and cannot jump through walls', () => {
  const { player, village, sim } = fixture('wizard');
  Object.assign(player, { x: 0, z: 0, tool: 'staff', staffElement: 'frost', skills: { wizard_frost: 1, wizard_lightning: 1 } });
  village.zombies = Array.from({ length: 4 }, (_, i) => ({ id: String(i), x: i * 2, z: 10, hp: 100 }));
  magicAttack(sim, village, player, { kind: 'attack' });
  assert.equal(magicMovementMultiplier(JSON.parse(JSON.stringify(village.zombies[0])), 2), .65);
  assert.equal(magicMovementMultiplier(village.zombies[0], 3), 1);
  player.staffElement = 'lightning'; village.clock = 3;
  magicAttack(sim, village, player, { kind: 'attack' });
  assert.deepEqual(village.zombies.map(z => Number(z.hp.toFixed(2))), [58, 86.8, 92.08, 100]);
  assert.equal(player.lastShot.segments.length, MAGIC.lightning.chainTargets);
  village.clock = 6; player.mana = 100; sim.clearAttack = (v, from) => from === player;
  magicAttack(sim, village, player, { kind: 'attack' });
  assert.equal(player.lastShot.segments.length, 1);
});
