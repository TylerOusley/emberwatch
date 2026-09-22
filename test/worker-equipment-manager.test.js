import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingEntrance } from '../shared/access.js';
import { BUILDINGS, RESOURCES, canStand } from '../shared/world.js';
import { workerEmployment, workerStats } from '../shared/workers.js';
import { ensureOwnership } from '../server/ownership.js';
import { ensureWorkers, workersAction, workersTick, workersSnapshot } from '../server/workers.js';

const treasury = buildingEntrance(BUILDINGS.find(building => building.id === 'bank'));
function fixture(role = 'villager') {
  const owner = { id: 'owner', name: 'Owner', role, skills: {}, wallet: 10000, online: true, inventory: {}, durability: {}, maxDurability: {}, tiers: {}, ...treasury };
  const resident = { ...owner, id: 'resident', role: 'villager', inventory: {}, durability: {}, tiers: {} };
  const v = { id: 'village', status: 'active', day: 1, phase: 'day', clock: 0, players: { owner, resident }, resources: [], guards: [], zombies: [], treasury: 20000, policies: { tradeTax: 5 }, stock: { wheat: 40, timber: 40, stone: 40, iron: 40, coal: 40, sulfur: 40 } };
  ensureOwnership(v); ensureWorkers(v);
  const sim = { awardIncome: (v, p, amount) => { p.wallet += amount; } };
  const act = (action, player = owner) => workersAction(sim, v, player, action);
  const hire = () => { Object.assign(owner, treasury); act({ kind: 'worker_hire' }); return v.workers.at(-1); };
  const node = RESOURCES.find(candidate => candidate.type === 'stone' && canStand(candidate.x, candidate.z + 1.6, .4));
  for (const state of v.resources) { state.available = state.id === node.id; state.remaining = state.available ? 100 : 0; state.regrowAt = 100000; }
  const state = v.resources.find(state => state.id === node.id);
  const atNode = w => Object.assign(w, { x: node.x, z: node.z + 1.6, targetNodeId: node.id });
  const assign = w => { act({ kind: 'worker_assign', workerId: w.id, resource: 'stone', sourcePlotId: null, mode: 'sell', destinationPlotId: null }); atNode(w); };
  const tick = () => { v.clock += .1; workersTick(sim, v, .1); };
  const harvest = (w, count = 1) => { for (let n = 0; n < count; n++) { atNode(w); w.gatherProgress = workerStats(w, owner).gatherSeconds - .1; tick(); } };
  const supply = (w, tier, durability = 100, tool = 'pickaxe') => {
    // Existing saved workers can still carry gear supplied before the purchase system.
    Object.assign(owner, { x: w.x, z: w.z });
    w.equipment[tool] = { tier, durability, maxDurability: tier === 'iron' ? 200 : 150 };
    ensureWorkers(v);
  };
  const house = () => { const plot = v.plots[0]; Object.assign(plot, { building: 'house', ownerId: owner.id, hp: 500, maxHp: 500 }); ensureOwnership(v); return plot; };
  return { v, owner, resident, act, hire, node, state, atNode, assign, tick, harvest, supply, house };
}

test('Manager hires eight personal workers, training raises the limit to ten, and plot staff remain extra', () => {
  const f = fixture('manager');
  assert.deepEqual(workerEmployment(f.owner), { limit: 8, wageSeconds: 60 });
  for (let i = 0; i < 8; i++) f.hire();
  assert.throws(() => f.hire(), /at most 8/);
  f.owner.skills.manager_staffing = 2;
  f.hire(); f.hire(); assert.throws(() => f.hire(), /at most 10/);
  Object.assign(f.v.plots[0], { ownerId: f.owner.id, building: 'mine', level: 3, hp: 500 }); ensureWorkers(f.v);
  assert.equal(f.v.workers.length, 13);
  assert.equal(f.v.workers.filter(worker => worker.staffPlotId).length, 3);
});

test('role changes suspend surplus hires without deleting orders, cargo, equipment or prepaid Manager time', () => {
  const f = fixture('manager');
  for (let i = 0; i < 8; i++) { const w = f.hire(); f.assign(w); w.paidWorkSeconds = 43; w.paidWageSeconds = 60; }
  const surplus = f.v.workers[7]; surplus.cargo.stone = 3; f.supply(surplus, 'iron', 37);
  const wallet = f.owner.wallet; f.owner.role = 'guard'; f.tick();
  assert.equal(f.v.workers.length, 8); assert.equal(f.v.workers.filter(worker => worker.roleLimitPaused).length, 3);
  assert.equal(surplus.paidWorkSeconds, 43); assert.equal(surplus.cargo.stone, 3); assert.equal(surplus.resource, 'stone');
  assert.equal(surplus.equipment.pickaxe.durability, 37); assert.equal(f.owner.wallet, wallet);
  assert.throws(() => f.act({ kind: 'worker_pause', workerId: surplus.id, paused: false }), /suspended/);
  f.owner.role = 'manager'; ensureWorkers(f.v);
  assert.equal(surplus.roleLimitPaused, false); assert.equal(surplus.paused, false); assert.equal(surplus.paidWorkSeconds, 43);
});

test('wage buckets preserve their purchased duration across role changes and switch rates only after expiry', () => {
  const f = fixture('manager'), w = f.hire(); f.assign(w); const wallet = f.owner.wallet;
  f.tick(); assert.equal(f.owner.wallet, wallet - 1); assert.ok(Math.abs(w.paidWorkSeconds - 59.9) < 1e-7);
  f.owner.role = 'villager'; f.tick(); assert.ok(Math.abs(w.paidWorkSeconds - 59.8) < 1e-7); assert.equal(w.paidWageSeconds, 60);
  w.paidWorkSeconds = .05; f.tick(); assert.equal(w.paidWorkSeconds, 0);
  f.tick(); assert.equal(w.paidWageSeconds, 30); assert.ok(Math.abs(w.paidWorkSeconds - 29.9) < 1e-7); assert.equal(f.owner.wallet, wallet - 2);
  f.owner.role = 'manager'; ensureWorkers(f.v); assert.ok(Math.abs(w.paidWorkSeconds - 29.9) < 1e-7);
});

test('offline Managers fund work at their role rate, while an empty village preserves wages and equipment', () => {
  const f = fixture('manager'), w = f.hire(); f.assign(w); f.supply(w, 'stone', 30); f.owner.online = false;
  f.harvest(w, 4); assert.equal(w.cargo.stone, 5); assert.equal(w.equipment.pickaxe.durability, 26); assert.ok(w.paidWorkSeconds > 59);
  f.resident.online = false; const before = structuredClone(w), wallet = f.owner.wallet; f.tick();
  assert.deepEqual(w, before); assert.equal(f.owner.wallet, wallet);
});

test('legacy supplied tools preserve actual durability and can still be recovered without duplication', () => {
  const f = fixture(), w = f.hire(); f.supply(w, 'stone', 71);
  assert.deepEqual(w.equipment.pickaxe, { tier: 'stone', durability: 71, maxDurability: 150, workerOnly: false });
  f.owner.durability.pickaxe = 10;
  assert.throws(() => f.act({ kind: 'worker_unequip', workerId: w.id, tool: 'pickaxe' }), /slot is occupied/);
  f.owner.durability.pickaxe = 0; f.owner.inventory.stone = 1000;
  f.act({ kind: 'worker_unequip', workerId: w.id, tool: 'pickaxe' });
  assert.equal(f.owner.durability.pickaxe, 71); assert.equal(f.owner.tiers.pickaxe, 'stone'); assert.equal(w.equipment.pickaxe, undefined);
  assert.throws(() => f.act({ kind: 'worker_unequip', workerId: w.id, tool: 'pickaxe' }), /standard wooden/);
});

test('tool purchases validate ownership and price but do not require proximity or carried tools', () => {
  const f = fixture(), w = f.hire(); f.owner.x = w.x + 10;
  const buy = { kind: 'worker_buy_tool', workerId: w.id, tool: 'pickaxe', tier: 'stone' };
  assert.throws(() => f.act(buy, f.resident), /own workers/);
  f.owner.wallet = 29; assert.throws(() => f.act(buy), /30 wallet gold/);
  assert.deepEqual(w.equipment, {});
  f.owner.wallet = 130; f.act(buy);
  assert.equal(f.owner.wallet, 100); assert.deepEqual(w.equipment.pickaxe, { tier: 'stone', durability: 150, maxDurability: 150, workerOnly: true });
  assert.throws(() => f.act(buy), /already has a usable/);
  f.act({ ...buy, tier: 'iron' }); assert.equal(f.owner.wallet, 0); assert.equal(w.equipment.pickaxe.durability, 200);
  assert.throws(() => f.act({ kind: 'worker_unequip', workerId: w.id, tool: 'pickaxe' }), /cannot be recovered/);
  assert.deepEqual(f.owner.durability, {});
});

for (const [tier, count, expected] of [['stone', 4, 5], ['iron', 4, 6]]) test(`${tier} tools add the exact worker yield bonus while consuming one finite node unit and durability per harvest`, () => {
  const f = fixture(), w = f.hire(); f.assign(w); f.supply(w, tier, 100);
  f.harvest(w, count); assert.equal(w.cargo.stone, expected); assert.equal(f.state.remaining, 100 - count);
  assert.equal(w.equipment.pickaxe.durability, 100 - count); assert.equal(w.workXp, count); assert.equal(workerStats(w).gatherSeconds, 4);
});

test('broken gear falls back to wood and earned fractional yield survives changing tools and save reload', () => {
  const f = fixture(), w = f.hire(); f.assign(w); f.supply(w, 'iron', 1); f.harvest(w);
  assert.equal(w.cargo.stone, 1); assert.equal(w.equipment.pickaxe.durability, 0); assert.equal(w.toolYieldRemainders.stone, .5);
  f.harvest(w); assert.equal(w.cargo.stone, 2); assert.equal(w.toolYieldRemainders.stone, .5);
  const restored = JSON.parse(JSON.stringify(f.v)); ensureWorkers(restored);
  assert.equal(restored.workers[0].toolYieldRemainders.stone, .5);
  f.supply(w, 'iron', 1); f.harvest(w); assert.equal(w.cargo.stone, 4); assert.equal(w.toolYieldRemainders.stone, 0);
});

test('obsolete equipment and maintenance commands reject stale clients without spending or moving tools', () => {
  const f = fixture(), w = f.hire(); f.supply(w, 'iron', 1);
  const wallet = f.owner.wallet, treasury = f.v.treasury;
  for (const kind of ['worker_equip', 'worker_repair', 'worker_maintenance']) {
    assert.throws(() => f.act({ kind, workerId: w.id, tool: 'pickaxe', tier: 'iron', enabled: true, budgetGold: 100 }), /Refresh the game/);
  }
  assert.equal(f.owner.wallet, wallet); assert.equal(f.v.treasury, treasury); assert.equal(w.equipment.pickaxe.durability, 1);
});

test('old capped wallet maintenance never migrates into bank spending and the replacement switch requires a boolean', () => {
  const f = fixture(), w = f.hire(), plot = f.house(); f.assign(w); f.supply(w, 'iron', 1);
  Object.assign(plot.storage, { iron: 8, coal: 4, timber: 4 }); f.owner.inventory.iron = 777;
  Object.assign(w, { maintenanceEnabled: true, maintenanceBudgetGold: 100, maintenancePlotId: plot.id });
  ensureWorkers(f.v);
  assert.equal(w.autoReplaceEnabled, false); assert.equal(w.maintenanceEnabled, undefined); assert.equal(w.maintenanceBudgetGold, undefined); assert.equal(w.maintenancePlotId, undefined);
  f.harvest(w, 2);
  assert.equal(w.equipment.pickaxe.durability, 0); assert.equal(plot.storage.iron, 8); assert.equal(f.owner.inventory.iron, 777);
  assert.throws(() => f.act({ kind: 'worker_auto_replace', workerId: w.id, enabled: 'true' }), /whether/);
  f.act({ kind: 'worker_auto_replace', workerId: w.id, enabled: true }); assert.equal(w.autoReplaceEnabled, true);
  f.act({ kind: 'worker_auto_replace', workerId: w.id, enabled: false }); assert.equal(w.autoReplaceEnabled, false);
});

test('owner snapshots expose replacement settings and tools while other players receive only visible tiers', () => {
  const f = fixture('manager'), w = f.hire(); f.supply(w, 'stone', 37);
  const mine = f.v.plots[1]; Object.assign(mine, { building: 'mine', ownerId: f.owner.id, hp: 400, level: 1 });
  const own = workersSnapshot(f.v, f.owner.id).workers.find(worker => worker.id === w.id), other = workersSnapshot(f.v, f.resident.id).workers.find(worker => worker.id === w.id);
  assert.equal(own.equipment.pickaxe.durability, 37); assert.equal(own.employment.wageSeconds, 60); assert.equal(other.tiers.pickaxe, 'stone');
  assert.equal(own.autoReplaceEnabled, false); assert.equal(other.equipment, undefined); assert.equal(other.autoReplaceEnabled, undefined); assert.equal(own.maintenanceBudgetGold, undefined);
  const restored = JSON.parse(JSON.stringify(f.v)); ensureWorkers(restored); assert.deepEqual(restored.workers[0].equipment, w.equipment);
});

test('active Manager logistics improve cargo and gathering and turn off when the owner changes role', () => {
  const f = fixture('manager'), w = f.hire(); f.owner.skills.manager_logistics = 2;
  assert.equal(workerStats(w, f.owner).carryCapacity, 60); assert.equal(workerStats(w, f.owner).gatherSeconds, 4 / 1.2);
  f.owner.role = 'guard'; assert.equal(workerStats(w, f.owner).carryCapacity, 40); assert.equal(workerStats(w, f.owner).gatherSeconds, 4);
});

test('a full village of eighty trained Manager hires can sell cargo and return within treasury dismissal range', () => {
  const f = fixture('manager');
  for (let i = 0; i < 8; i++) {
    const owner = { ...f.owner, id: `manager-${i}`, name: `Manager ${i}`, wallet: 1000, skills: { manager_staffing: 2, manager_logistics: 2 }, inventory: {}, durability: {} }; f.v.players[owner.id] = owner;
    for (let j = 0; j < 10; j++) {
      f.act({ kind: 'worker_hire' }, owner); const worker = f.v.workers.at(-1); worker.cargo.stone = 1;
      f.act({ kind: 'worker_assign', workerId: worker.id, resource: 'stone', sourcePlotId: null, mode: 'sell', destinationPlotId: null }, owner);
      const n = i * 10 + j; worker.x = 2 + n % 4 * 1.2; worker.z = -34 + Math.floor(n / 4) * 1.2;
    }
    owner.online = false;
  }
  const stock = f.v.stock.stone;
  for (let i = 0; i < 1600 && f.v.workers.some(worker => worker.cargo.stone > 0); i++) {
    f.tick(); for (const worker of f.v.workers) if (worker.cargo.stone === 0) worker.paused = true;
  }
  assert.equal(f.v.stock.stone, stock + 80, f.v.workers.filter(worker => worker.cargo.stone > 0).map(worker => `${worker.status} at ${worker.x},${worker.z}`).join('; ')); assert.ok(f.v.workers.every(worker => worker.cargo.stone === 0));
  for (let i = 0; i < 1200 && f.v.workers.some(worker => worker.status !== 'Paused'); i++) f.tick();
  for (const worker of [...f.v.workers]) {
    const owner = f.v.players[worker.ownerId]; Object.assign(owner, treasury);
    assert.doesNotThrow(() => f.act({ kind: 'worker_dismiss', workerId: worker.id }, owner), `${worker.name}: ${worker.status} at ${worker.x},${worker.z}`);
  }
  assert.equal(f.v.workers.length, 0);
});
