import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { Simulation } from '../server/simulation.js';
import { ensureSkills } from '../server/skills.js';
import { MAGIC } from '../shared/magic.js';
import { canEquip, ownsStaff } from '../shared/equipment.js';
import { inventoryWeight, carryCapacity, normalizeToolDurability } from '../shared/content.js';
import { PLOTS } from '../shared/world.js';
import { plotEntrance } from '../shared/access.js';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'emberwatch-wizard-staff-')), store = new Store(dir);
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });
  const session = await store.authenticate('register', 'Staff Wizard', 'staff-regression-password');
  const account = store.account(session.playerId), sim = new Simulation(store);
  const { id } = sim.create('Permanent staff', account), v = sim.villages.get(id), p = sim.join(id, account, 'wizard');
  Object.assign(p, { wallet: 1000, x: 0, z: 0, lastAction: -100 });
  v.phaseRemaining = 10000; v.zombies = []; v.guards = [];
  const plot = v.plots[0];
  Object.assign(plot, { ownerId: p.id, building: 'arcane_academy', hp: 700, maxHp: 700 });
  const approach = () => Object.assign(p, plotEntrance(PLOTS[0], plot));
  const action = a => sim.action(id, p.id, a);
  const reclaim = () => action({ kind: 'academy_reclaim_staff', plotId: plot.id });
  return { store, sim, account, v, p, plot, approach, action, reclaim };
}

test('legacy intact and broken staffs migrate once without refreshing mana, cooldown, skills or ordinary tools', () => {
  for (const remaining of [0, 42, 100]) {
    const p = { role: 'wizard', wizardStarterGranted: true, durability: { staff: remaining, axe: 19 }, maxDurability: { staff: 100, axe: 150 }, inventory: {}, mana: 7, staffReadyAt: 25, skills: { wizard_focus: 1 } };
    ensureSkills(p); normalizeToolDurability(p);
    assert.equal(ownsStaff(p), true); assert.equal(canEquip(p, 'staff'), true);
    assert.equal(p.durability.staff, undefined); assert.equal(p.maxDurability.staff, undefined);
    assert.equal(p.durability.axe, 19); assert.equal(p.maxDurability.axe, 150);
    assert.equal(p.mana, 7); assert.equal(p.staffReadyAt, 25); assert.deepEqual(p.skills, { wizard_focus: 1 });
    assert.equal(inventoryWeight(p), 6, 'one staff and one axe each weigh three');
    p.staffOwned = false; p.role = 'villager'; ensureSkills(p); p.role = 'wizard'; ensureSkills(p);
    const restored = JSON.parse(JSON.stringify(p)); ensureSkills(restored);
    assert.equal(ownsStaff(restored), false); assert.equal(canEquip(restored, 'staff'), false);
    assert.equal(restored.mana, 7); assert.equal(restored.staffReadyAt, 25);
  }
  const authoritativeLoss = { role: 'wizard', wizardStarterGranted: true, staffOwned: false, durability: { staff: 90 }, mana: 9 };
  ensureSkills(authoritativeLoss); assert.equal(authoritativeLoss.staffOwned, false); assert.equal(authoritativeLoss.durability.staff, undefined);
});

test('loading a saved broken Wizard restores staff ownership once while preserving the resident state', async t => {
  const f = await fixture(t);
  delete f.p.staffOwned; f.p.durability.staff = 0; f.p.maxDurability.staff = 100;
  Object.assign(f.p, { mana: 7, staffReadyAt: 10, skills: { wizard_focus: 1 }, tool: '' });
  f.store.saveVillage(f.v);
  const reload = new Simulation(f.store), p = reload.join(f.v.id, f.account, 'wizard');
  assert.equal(p.staffOwned, true); assert.equal(p.mana, 7); assert.equal(p.staffReadyAt, 10);
  assert.deepEqual(p.skills, { wizard_focus: 1 }); assert.equal(p.durability.staff, undefined); assert.equal(p.maxDurability.staff, undefined);
  p.staffOwned = false; f.store.saveVillage(reload.villages.get(f.v.id));
  const secondReload = new Simulation(f.store), lost = secondReload.join(f.v.id, f.account, 'wizard');
  assert.equal(lost.staffOwned, false); assert.equal(lost.mana, 7); assert.equal(lost.staffReadyAt, 10);
});

test('recovery is free, immediate, idempotent and survives reload with private ownership and cooldown snapshots', async t => {
  const f = await fixture(t); f.approach();
  Object.assign(f.p, { staffOwned: false, tool: '', mana: 7, staffReadyAt: 10, skills: { wizard_focus: 1, wizard_frost: 1 }, staffElement: 'frost', lastAction: f.v.clock });
  const wallet = f.p.wallet, treasury = f.v.treasury, skills = { ...f.p.skills };
  assert.match(f.reclaim(), /free and equipped/);
  assert.equal(f.p.staffOwned, true); assert.equal(f.p.tool, 'staff'); assert.equal(inventoryWeight(f.p), 3);
  assert.equal(f.p.wallet, wallet); assert.equal(f.v.treasury, treasury); assert.equal(f.p.mana, 7); assert.equal(f.p.staffReadyAt, 10);
  assert.deepEqual(f.p.skills, skills); assert.equal(f.p.staffElement, 'frost');
  const once = JSON.stringify(f.p); assert.match(f.reclaim(), /already/); assert.equal(JSON.stringify(f.p), once);
  const own = f.sim.snapshot(f.v, f.p.id), self = own.players.find(p => p.id === f.p.id);
  assert.equal(self.staffOwned, true); assert.equal(self.staffReadyAt, 10); assert.equal(own.academy.staffOwned, true);
  const otherView = f.sim.snapshot(f.v, 'another-resident').players.find(p => p.id === f.p.id);
  assert.equal(otherView.staffOwned, undefined); assert.equal(otherView.staffReadyAt, undefined);
  const reload = new Simulation(f.store), restored = reload.join(f.v.id, f.account, 'wizard');
  assert.equal(restored.staffOwned, true); assert.equal(restored.mana, 7); assert.equal(restored.staffReadyAt, 10);
  assert.equal(restored.durability.staff, undefined); assert.equal(restored.maxDurability.staff, undefined);
});

test('recovery validates life, active village, Wizard role, nearby working resident academy without mutation', async t => {
  const f = await fixture(t); f.approach(); f.p.staffOwned = false; f.p.tool = ''; f.p.mana = 9;
  const reject = (change, restore, pattern) => {
    change(); const before = JSON.stringify(f.p), gold = f.v.treasury;
    assert.throws(f.reclaim, pattern); assert.equal(JSON.stringify(f.p), before); assert.equal(f.v.treasury, gold); restore();
  };
  reject(() => { f.p.downed = true; }, () => { f.p.downed = false; }, /downed/);
  reject(() => { f.p.hp = 0; }, () => { f.p.hp = 100; }, /living wizard/);
  reject(() => { f.p.bedPlotId = 'bed'; }, () => { delete f.p.bedPlotId; }, /bed/);
  reject(() => { f.p.mountedHorseId = 'horse'; }, () => { delete f.p.mountedHorseId; }, /Dismount/);
  reject(() => { f.p.carriedBy = 'companion'; }, () => { delete f.p.carriedBy; }, /put you down/);
  reject(() => { f.p.online = false; }, () => { f.p.online = true; }, /Join/);
  reject(() => { f.v.status = 'fallen'; }, () => { f.v.status = 'active'; }, /fallen/);
  reject(() => { f.p.role = 'villager'; }, () => { f.p.role = 'wizard'; }, /Only wizards/);
  reject(() => { f.p.x += 100; }, f.approach, /entrance/);
  reject(() => { f.plot.hp = 0; }, () => { f.plot.hp = 700; }, /working Arcane Academy/);
  reject(() => { f.plot.ruined = true; }, () => { delete f.plot.ruined; }, /working Arcane Academy/);
  reject(() => { f.plot.rebuilding = true; }, () => { delete f.plot.rebuilding; }, /working Arcane Academy/);
  reject(() => { f.plot.building = 'tinker_shop'; }, () => { f.plot.building = 'arcane_academy'; }, /working Arcane Academy/);
  reject(() => { f.plot.ownerId = 'missing'; }, () => { f.plot.ownerId = f.p.id; }, /resident owner/);
  // A resident's academy keeps its services while its owner is offline.
  f.v.players.teacher = { id: 'teacher', role: 'villager', online: false, hp: 100, wallet: 100, inventory: {}, durability: {} };
  f.plot.ownerId = 'teacher'; f.p.inventory.wheat = carryCapacity(f.p);
  f.reclaim(); assert.equal(inventoryWeight(f.p), carryCapacity(f.p) + 3); assert.equal(f.p.staffOwned, true);
});

test('ordinary respawn loses the staff, role changes cannot regenerate it, and Academy recovery restores it', async t => {
  const f = await fixture(t); f.p.downed = true; f.p.respawnAvailable = true;
  f.action({ kind: 'respawn' }); assert.equal(f.p.staffOwned, false); assert.equal(canEquip(f.p, 'staff'), false);
  f.p.mana = 6; f.p.staffReadyAt = f.v.clock + 5;
  // Leave the Academy with another resident so changing roles does not remove it.
  f.v.players.teacher = { id: 'teacher', name: 'Teacher', role: 'wizard', online: false, hp: 100, wallet: 0, inventory: {}, durability: {} };
  f.plot.ownerId = 'teacher';
  f.v.clock += 1; f.action({ kind: 'role_change', role: 'villager' });
  f.v.clock += 1; f.action({ kind: 'role_change', role: 'wizard' });
  assert.equal(f.p.staffOwned, false); assert.equal(f.p.mana, 6); assert.equal(f.p.staffReadyAt, 5);
  f.approach(); f.reclaim(); assert.equal(f.p.staffOwned, true); assert.equal(f.p.mana, 6); assert.equal(f.p.staffReadyAt, 5);
});

test('all three spells cast repeatedly below full mana, stop without enough mana, and resume at their spell cost', async t => {
  const f = await fixture(t); Object.assign(f.p.skills, { wizard_frost: 1, wizard_lightning: 1 });
  for (const element of ['fire', 'frost', 'lightning']) {
    const spell = MAGIC[element];
    Object.assign(f.p, { mana: 100, staffElement: element, staffReadyAt: 0, lastAction: -100, tool: 'staff' });
    let casts = 0, prior = Infinity;
    while (f.p.mana >= spell.mana) {
      const mana = f.p.mana; f.action({ kind: 'attack' }); casts++;
      assert.equal(f.p.mana, mana - spell.mana); assert.ok(f.p.mana < prior); prior = f.p.mana;
      const after = JSON.stringify(f.p);
      assert.throws(() => f.action({ kind: 'attack' }), /Wait|recovering/); assert.equal(JSON.stringify(f.p), after);
      f.sim.tick(spell.cooldown + 1e-6);
      assert.ok(casts < 20, 'casting drains mana faster than its regeneration');
    }
    assert.ok(casts >= 5); const before = JSON.stringify(f.p);
    assert.throws(() => f.action({ kind: 'attack' }), /mana/); assert.equal(JSON.stringify(f.p), before);
    f.sim.tick((spell.mana - f.p.mana) / MAGIC.manaRegen + 1e-6);
    assert.ok(f.p.mana >= spell.mana && f.p.mana < spell.mana + .001);
    f.action({ kind: 'attack' }); assert.ok(f.p.mana < .001); assert.equal(f.p.staffOwned, true);
    // Exact equality works too, with no hidden full-bar condition.
    f.sim.tick(spell.cooldown + 1e-6); f.p.mana = spell.mana; f.action({ kind: 'attack' }); assert.equal(f.p.mana, 0);
  }
  assert.equal(f.p.durability.staff, undefined); assert.equal(f.p.maxDurability.staff, undefined);
  f.sim.tick(1); f.p.staffOwned = false; f.p.mana = 100; const before = JSON.stringify(f.p);
  assert.throws(() => f.action({ kind: 'attack' }), /Reclaim/); assert.equal(JSON.stringify(f.p), before);
});

test('more than the former durability limit of casts never wears out a staff and crafting restores only missing staffs', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 110; i++) {
    f.p.mana = 100; f.v.clock += 1;
    f.action({ kind: 'attack' }); assert.equal(f.p.staffOwned, true); assert.equal(f.p.durability.staff, undefined);
  }
  f.plot.building = 'tinker_shop'; f.plot.storage = { timber: 100, iron_ingot: 100, sulfur: 100 }; f.approach();
  const buy = () => f.action({ kind: 'craft_buy', plotId: f.plot.id, recipe: 'staff', price: 60, confirm: true });
  f.v.clock += 1; const wallet = f.p.wallet, storage = { ...f.plot.storage };
  assert.throws(buy, /already have a permanent staff/); assert.equal(f.p.wallet, wallet); assert.deepEqual(f.plot.storage, storage);
  f.p.staffOwned = false; f.p.tool = ''; f.p.mana = 7; const ready = f.p.staffReadyAt;
  buy(); assert.equal(f.p.staffOwned, true); assert.equal(canEquip(f.p, 'staff'), true); assert.equal(inventoryWeight(f.p), 3);
  assert.equal(f.p.mana, 7); assert.equal(f.p.staffReadyAt, ready); assert.equal(f.p.durability.staff, undefined);
  assert.deepEqual(f.plot.storage, { timber: 88, iron_ingot: 97, sulfur: 96 });
});
