import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingEntrance } from '../shared/access.js';
import { BUILDINGS, PLOTS, RESOURCES, canStand, plotFront, plotSolids } from '../shared/world.js';
import { WORKER_RULES, WORKER_COLORS, WORKER_MAX_XP, workerStats } from '../shared/workers.js';
import { inventoryWeight } from '../shared/content.js';
import { taxedSaleQuote } from '../shared/economy.js';
import { ensureOwnership } from '../server/ownership.js';
import { ensureWorkers, workersAction, workersTick, workersSnapshot } from '../server/workers.js';

const bank = BUILDINGS.find(b => b.id === 'bank'), home = buildingEntrance(bank);
const exchange = buildingEntrance(BUILDINGS.find(b => b.id === 'market'));
const apart = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function fixture() {
  const owner = { id: 'owner', name: 'Owner', role: 'villager', wallet: 1000, online: true, inventory: {}, durability: {}, x: home.x, z: home.z };
  const visitor = { ...owner, id: 'visitor', name: 'Visitor', inventory: {}, durability: {} };
  const v = { id: 'village', status: 'active', day: 1, phase: 'day', clock: 0,
    players: { owner, visitor }, resources: [], guards: [], zombies: [], treasury: 20000,
    policies: { tradeTax: 5 }, stock: { wheat: 40, timber: 40, stone: 40, iron: 40, coal: 40 } };
  ensureOwnership(v); ensureWorkers(v);
  const sim = { awardIncome: (v, p, amount) => { p.wallet += amount; } };
  const act = (action, player = owner) => workersAction(sim, v, player, action);
  const hire = () => { act({ kind: 'worker_hire' }); return v.workers.at(-1); };
  const assign = (w, overrides = {}) => act({ kind: 'worker_assign', workerId: w.id, resource: 'stone', sourcePlotId: null, mode: 'sell', destinationPlotId: null, ...overrides });
  const advance = seconds => { for (let t = 0; t < seconds - 1e-6; t += .1) { v.clock += .1; workersTick(sim, v, .1); } };
  const nodeOnly = (type, count = null) => {
    const node = RESOURCES.find(n => n.type === type && canStand(n.x, n.z + 1.6, .4));
    for (const state of v.resources) { state.available = false; state.regrowAt = 100000; }
    const state = v.resources.find(s => s.id === node.id);
    state.available = true; state.remaining = count ?? (type === 'wheat' ? 1 : type === 'timber' ? 5 : 8);
    return { node, state };
  };
  const atNode = (w, node) => { w.x = node.x; w.z = node.z + 1.6; w.targetNodeId = node.id; };
  const built = (building, index = 0, player = owner) => {
    const plot = v.plots[index]; Object.assign(plot, { ownerId: player.id, building, hp: 500, maxHp: 500 });
    ensureOwnership(v); return plot;
  };
  return { v, owner, visitor, sim, act, hire, assign, advance, nodeOnly, atNode, built };
}

test('hiring is capped, costs wallet gold once, and never uses treasury, bank or credit', () => {
  const { v, owner, act, hire } = fixture();
  owner.bank = 10000; owner.credit = 10000; owner.wallet = 74;
  assert.throws(() => hire(), /75 wallet gold/);
  assert.equal(v.workers.length, 0); assert.equal(owner.wallet, 74);
  owner.wallet = 1000; owner.x = 0;
  assert.throws(() => hire(), /Visit/);
  owner.x = home.x; const a = hire(), b = hire();
  assert.notEqual(a.id, b.id); assert.equal(owner.wallet, 850); assert.equal(v.treasury, 20000);
  assert.equal(owner.bank, 10000); assert.equal(owner.credit, 10000);
  for (let i = 2; i < WORKER_RULES.maxPerPlayer; i++) hire();
  assert.equal(WORKER_RULES.maxPerPlayer, 5);
  assert.throws(() => act({ kind: 'worker_hire', price: 0, limit: 100 }), /at most 5/);
  assert.equal(v.workers.length, 5); assert.equal(owner.wallet, 625);
});

test('orders require owned compatible sources and living storage destinations', () => {
  const { v, owner, visitor, act, hire, assign, built } = fixture();
  const w = hire(), mine = built('mine'), house = built('house', 1), foreign = built('mine', 2, visitor);
  const original = structuredClone(w);
  assert.throws(() => act({ kind: 'worker_pause', workerId: w.id, paused: false }, visitor), /own workers/);
  assert.throws(() => assign(w, { resource: '__proto__' }), /Choose wheat/);
  assert.throws(() => assign(w, { sourcePlotId: foreign.id }), /you own/);
  assert.throws(() => assign(w, { resource: 'wheat', sourcePlotId: mine.id }), /supplies this resource/);
  assert.throws(() => assign(w, { mode: 'store', destinationPlotId: 'missing' }), /living building/);
  assert.throws(() => assign(w, { sourcePlotId: {} }), /public resources/);
  assert.deepEqual(w, original, 'invalid orders do not silently unpause or replace the assignment');
  assign(w, { sourcePlotId: mine.id, mode: 'store', destinationPlotId: house.id });
  assert.equal(w.paused, false); assert.equal(w.sourcePlotId, mine.id); assert.equal(w.destinationPlotId, house.id);
  assign(w, { sourcePlotId: mine.id, mode: 'store', destinationPlotId: foreign.id });
  assert.equal(w.destinationOwnerId, visitor.id, 'a donation route explicitly records its recipient');
  assert.equal(owner.wallet, 925); assert.equal(v.treasury, 20000);
});

test('workers harvest finite public units at basic yield and consume prepaid work time', () => {
  const { v, owner, hire, assign, advance, nodeOnly, atNode } = fixture();
  const w = hire(), { node, state } = nodeOnly('stone', 2);
  assign(w); atNode(w, node);
  const wallet = owner.wallet;
  advance(3.9); assert.equal(w.cargo.stone, 0); assert.equal(state.remaining, 2);
  advance(.1); assert.equal(w.cargo.stone, 1); assert.equal(state.remaining, 1);
  assert.equal(owner.wallet, wallet - 1); assert.ok(Math.abs(w.paidWorkSeconds - 26) < 1e-6);
  advance(4); assert.equal(w.cargo.stone, 2); assert.equal(state.remaining, 0); assert.equal(state.available, false);
  assert.ok(Math.abs(state.regrowAt - v.clock - 150) < 1e-6);
  assert.equal(inventoryWeight(w.cargo), 6);
  assert.equal(owner.inventory.stone, 0, 'goods stay with the worker until delivery');
  assert.equal(Object.values(owner.durability).reduce((n, d) => n + d, 0), 0, 'employment tools never consume player tools');
});

test('two workers cannot both collect the last shared node unit', () => {
  const { v, hire, assign, advance, nodeOnly, atNode } = fixture();
  const a = hire(), b = hire(), { node, state } = nodeOnly('wheat');
  for (const w of [a, b]) { assign(w, { resource: 'wheat' }); atNode(w, node); w.gatherProgress = 3.9; }
  advance(.1);
  assert.equal(a.cargo.wheat + b.cargo.wheat, 1); assert.equal(state.remaining, 0);
  assert.equal(state.regrowAt, v.clock + 90);
});

test('private workers use their own mine, share its depletion, and retain private regrowth speed', () => {
  const { v, hire, assign, advance, atNode, built } = fixture();
  const plot = built('mine'), w = hire();
  const node = v.plotResources.find(n => n.plotId === plot.id && n.type === 'coal'); node.remaining = 1;
  assign(w, { sourcePlotId: plot.id, resource: 'coal' }); atNode(w, node);
  advance(4);
  assert.equal(w.cargo.coal, 1); assert.equal(node.available, false); assert.equal(node.remaining, 0);
  assert.ok(Math.abs(node.regrowAt - v.clock - 97.5) < 1e-6);
  assert.equal(plot.storage.coal ?? 0, 0, 'the owner is not awarded a duplicate visitor cut');
});

test('workers use level-two regrowth and the expanded destination capacity', () => {
  const { v, hire, assign, advance, atNode, built } = fixture();
  const plot = built('mine'); plot.level = 2;
  const w = hire(), node = v.plotResources.find(node => node.plotId === plot.id && node.type === 'coal'); node.remaining = 1;
  assign(w, { sourcePlotId: plot.id, resource: 'coal' }); atNode(w, node); advance(4);
  assert.equal(w.cargo.coal, 2); assert.ok(Math.abs(node.regrowAt - v.clock - 73.125) < 1e-6);
  plot.storage.stone = 499; w.cargo.stone = 5;
  assign(w, { mode: 'store', destinationPlotId: plot.id }); Object.assign(w, plotFront(PLOTS.find(p => p.id === plot.id), 1));
  advance(.1); assert.equal(plot.storage.stone, 504); assert.equal(plot.storage.coal, 2);
  assert.equal(w.cargo.stone, 0); assert.equal(w.cargo.coal, 0);
});

test('level-three workers gather triple yield with one experience point and preserve whole batches at cargo/storage limits', () => {
  const { v, owner, hire, assign, advance, atNode, built } = fixture();
  const plot = built('mine'); plot.level = 3;
  const w = hire(), node = v.plotResources.find(node => node.plotId === plot.id && node.type === 'stone'); node.remaining = 1;
  assign(w, { sourcePlotId: plot.id }); atNode(w, node); advance(4);
  assert.equal(w.cargo.stone, 3); assert.equal(w.workXp, 1); assert.equal(node.remaining, 0);
  assert.ok(Math.abs(node.regrowAt - v.clock - 48.75) < 1e-6);
  Object.assign(node, { available: true, remaining: 1 });
  w.cargo.stone = 11; w.delivering = false; atNode(w, node); advance(.1);
  assert.equal(w.delivering, true); assert.equal(w.cargo.stone, 11); assert.equal(node.remaining, 1, 'insufficient room for all three units starts a delivery without consuming the node');
  w.cargo.stone = 0; plot.storage.stone = 999;
  assign(w, { sourcePlotId: plot.id, mode: 'store', destinationPlotId: plot.id }); atNode(w, node);
  const wallet = owner.wallet, wages = w.paidWorkSeconds; advance(4);
  assert.equal(w.cargo.stone, 0); assert.equal(node.remaining, 1); assert.equal(w.workXp, 1);
  assert.equal(owner.wallet, wallet); assert.equal(w.paidWorkSeconds, wages); assert.match(w.status, /Storage full/);
});

test('cargo is delivered physically, fills only available storage, and survives full or demolished destinations', () => {
  const { v, owner, hire, assign, advance, built } = fixture();
  const plot = built('house'), w = hire();
  plot.storage.stone = 499; w.cargo.stone = 4;
  assign(w, { mode: 'store', destinationPlotId: plot.id });
  advance(.1); assert.equal(plot.storage.stone, 499, 'remote orders do not teleport cargo');
  const target = plotFront(PLOTS.find(p => p.id === plot.id), 1); Object.assign(w, target);
  advance(.1); assert.equal(plot.storage.stone, 500); assert.equal(w.cargo.stone, 3);
  const wallet = owner.wallet, paid = w.paidWorkSeconds;
  advance(5); assert.equal(owner.wallet, wallet); assert.equal(w.paidWorkSeconds, paid, 'waiting for storage costs no wages');
  assert.match(w.status, /Storage full/);
  plot.building = null; plot.hp = 0; advance(.1);
  assert.equal(w.cargo.stone, 3); assert.match(w.status, /storage building/);
  const restored = built('house'); restored.storage.stone = 497;
  Object.assign(w, target); advance(.1);
  assert.equal(restored.storage.stone, 500); assert.equal(w.cargo.stone, 0);
});

test('automatic sales use current bulk tax quotes and the normal debt income path', () => {
  const { v, owner, sim, hire, assign, advance } = fixture();
  const w = hire(); w.cargo.stone = 5; v.stock.stone = 24;
  assign(w); Object.assign(w, exchange);
  const quote = taxedSaleQuote('stone', 24, 5, 5), wallet = owner.wallet, treasury = v.treasury;
  let awarded = null;
  sim.awardIncome = (v, p, amount) => { awarded = amount; p.wallet += amount - 2; v.treasury += 2; };
  advance(.1);
  assert.equal(awarded, quote.total); assert.equal(v.stock.stone, 29); assert.equal(w.cargo.stone, 0);
  assert.equal(owner.wallet, wallet + quote.total - 2); assert.equal(v.treasury, treasury - quote.total + 2);
});

test('workers keep cargo at the old treasury and behind the exchange until they physically reach its counter', () => {
  const { v, hire, assign, advance } = fixture(), w = hire(); w.cargo.stone = 1; assign(w);
  const stock = v.stock.stone; Object.assign(w, home); advance(.1);
  assert.equal(w.cargo.stone, 1); assert.equal(v.stock.stone, stock);
  const market = BUILDINGS.find(b => b.id === 'market'); Object.assign(w, { x: market.x + market.w / 2 + 1, z: market.z });
  advance(.1); assert.equal(w.cargo.stone, 1); assert.equal(v.stock.stone, stock);
  for (let i = 0; i < 600 && w.cargo.stone; i++) advance(.1);
  assert.equal(w.cargo.stone, 0); assert.equal(v.stock.stone, stock + 1);
});

test('partial sales preserve the treasury reserve and unsold cargo without idle wage drain', () => {
  const { v, owner, hire, assign, advance } = fixture();
  const w = hire(); w.cargo.iron = 5; v.stock.iron = 0; v.treasury = 514;
  assign(w, { resource: 'iron' }); Object.assign(w, exchange);
  const wallet = owner.wallet;
  advance(.1);
  assert.equal(v.stock.iron, 2); assert.equal(v.treasury, 500); assert.equal(w.cargo.iron, 3);
  assert.equal(owner.wallet, wallet + 14);
  const paid = w.paidWorkSeconds; advance(6);
  assert.equal(w.paidWorkSeconds, paid); assert.equal(w.cargo.iron, 3); assert.equal(owner.wallet, wallet + 14);
  assert.match(w.status, /cargo kept/);
  v.treasury = 1000; advance(.1);
  assert.equal(w.cargo.iron, 0); assert.equal(v.stock.iron, 5);
});

test('wages stop while paused, the village is empty, or the owner cannot pay', () => {
  for (const reason of ['paused', 'empty', 'unpaid']) {
    const { v, owner, visitor, hire, assign, advance, nodeOnly, atNode } = fixture();
    const w = hire(), { node, state } = nodeOnly('stone'); assign(w); atNode(w, node);
    w.gatherProgress = 3.9; w.cargo.stone = 1;
    if (reason === 'paused') w.paused = true;
    if (reason === 'empty') owner.online = visitor.online = false;
    if (reason === 'unpaid') owner.wallet = 0;
    const wallet = owner.wallet, before = { x: w.x, z: w.z };
    advance(1);
    assert.equal(owner.wallet, wallet, reason); assert.equal(w.paidWorkSeconds, 0, reason);
    assert.equal(w.cargo.stone, 1, reason); assert.equal(state.remaining, 8, reason);
    if (reason === 'empty') { assert.equal(w.gatherProgress, 3.9); assert.equal(apart(w, before), 0, 'an empty village freezes movement and progress'); }
    else { assert.equal(w.gatherProgress, 0, reason); assert.ok(apart(w, before) > .1, `${reason}: worker walks home`); }
  }
});

test('workers harvest through night and nearby zombies while consuming wages normally', () => {
  const { v, owner, hire, assign, advance, nodeOnly, atNode } = fixture();
  const w = hire(), { node, state } = nodeOnly('stone', 3); assign(w); atNode(w, node);
  v.phase = 'night'; v.zombies.push({ x: w.x + 4, z: w.z, hp: 100 });
  const wallet = owner.wallet; advance(8);
  assert.equal(w.cargo.stone, 2); assert.equal(state.remaining, 1);
  assert.equal(w.workXp, 2); assert.equal(owner.wallet, wallet - 1);
  assert.ok(Math.abs(w.paidWorkSeconds - 22) < 1e-6);
  assert.match(w.status, /Gathering/);
});

test('a fractional prepaid wage remainder cannot pin a worker after assignment or resume', () => {
  for (const command of ['assignment', 'resume']) {
    const { owner, act, hire, assign, advance } = fixture(), w = hire();
    assign(w);
    // Collision sliding and crowd separation charge actual travel, so the
    // final prepaid slice need not be a whole simulation tick.
    w.paidWorkSeconds = .0001;
    if (command === 'assignment') assign(w, { resource: 'iron' });
    else {
      act({ kind: 'worker_pause', workerId: w.id, paused: true });
      act({ kind: 'worker_pause', workerId: w.id, paused: false });
    }
    const start = { x: w.x, z: w.z }, wallet = owner.wallet;
    advance(2);
    assert.ok(apart(w, start) > 3, `${command}: the worker resumes ordinary travel`);
    assert.equal(owner.wallet, wallet - WORKER_RULES.wageGold, `${command}: only one new wage block is purchased`);
    assert.ok(w.paidWorkSeconds > 27 && w.paidWorkSeconds < WORKER_RULES.wageSeconds);
    assert.equal(w.workXp, 0, 'walking cannot grant harvests or experience');
  }
});

test('fractional prepaid wages permit normal cargo delivery without changing sale accounting', () => {
  const { v, owner, hire, assign, advance } = fixture(), w = hire();
  w.cargo.stone = 1; assign(w);
  Object.assign(w, { x: exchange.x - 3, z: exchange.z }); w.paidWorkSeconds = .0001;
  const stock = v.stock.stone, wallet = owner.wallet, treasury = v.treasury;
  const quote = taxedSaleQuote('stone', stock, 1, 5);
  for (let i = 0; i < 40 && w.cargo.stone; i++) advance(.1);
  assert.equal(w.cargo.stone, 0, 'the carried resource reaches the exchange');
  assert.equal(v.stock.stone, stock + 1);
  assert.equal(v.treasury, treasury - quote.total);
  assert.equal(owner.wallet, wallet + quote.total - WORKER_RULES.wageGold);
  assert.equal(w.workXp, 0);
});

test('a worker with fractional wages replans around a storage building without paying while blocked', () => {
  const { v, owner, hire, assign, advance, built } = fixture();
  const plot = built('house', 7), site = PLOTS.find(p => p.id === plot.id), w = hire();
  w.cargo.stone = 1; assign(w, { mode: 'store', destinationPlotId: plot.id });
  Object.assign(w, { x: site.x - 3.400001, z: site.z, paidWorkSeconds: .000005 });
  const start = { x: w.x, z: w.z }, wallet = owner.wallet;
  advance(.2);
  assert.equal(apart(w, start), 0, 'the initial path is blocked by the actual house footprint');
  assert.equal(w.paidWorkSeconds, .000005); assert.equal(owner.wallet, wallet);
  for (let i = 0; i < 150 && w.cargo.stone; i++) {
    const previous = { x: w.x, z: w.z }; advance(.1);
    assert.ok(canStand(w.x, w.z, .4, plotSolids(v.plots)));
    assert.ok(apart(w, previous) <= WORKER_RULES.speed * .1 * 1.15 + 1e-6);
  }
  assert.equal(w.cargo.stone, 0, 'elapsed tick time permits a detour and physical delivery');
  assert.equal(plot.storage.stone, 1); assert.equal(w.workXp, 0);
  assert.equal(owner.wallet, wallet - WORKER_RULES.wageGold);
});

test('returning a paused worker keeps a fractional prepaid wage balance intact', () => {
  const { owner, act, hire, assign, advance } = fixture(), w = hire();
  assign(w); w.paidWorkSeconds = .0001; w.x = -8; w.z = -35;
  w.cargo.stone = 2;
  act({ kind: 'worker_pause', workerId: w.id, paused: true });
  const before = { x: w.x, z: w.z }, wallet = owner.wallet;
  advance(2);
  assert.ok(apart(w, before) > 3, 'the free return trip uses the full simulation timestep');
  assert.equal(owner.wallet, wallet); assert.equal(w.paidWorkSeconds, .0001);
  assert.equal(w.cargo.stone, 2); assert.equal(w.workXp, 0);
});

test('only completed harvests earn points; spending a point improves gathering and cannot be repeated', () => {
  const { v, visitor, act, hire, assign, advance, nodeOnly, atNode } = fixture();
  const w = hire(), { node } = nodeOnly('stone', 4); assign(w); atNode(w, node); w.workXp = 24;
  advance(3.9); assert.equal(w.workXp, 24); assert.equal(w.upgradePoints, 0);
  assert.throws(() => act({ kind: 'worker_upgrade', workerId: w.id, attribute: 'gathering' }), /earns an upgrade point/);
  advance(.1); assert.equal(w.workXp, 25); assert.equal(w.upgradePoints, 1); assert.equal(w.level, 2);
  assert.throws(() => act({ kind: 'worker_upgrade', workerId: w.id, attribute: 'gathering' }, visitor), /own workers/);
  assert.throws(() => act({ kind: 'worker_upgrade', workerId: w.id, attribute: '__proto__' }), /Choose gathering/);
  act({ kind: 'worker_upgrade', workerId: w.id, attribute: 'gathering' });
  assert.equal(w.attributes.gathering, 1); assert.equal(w.upgradePoints, 0);
  assert.throws(() => act({ kind: 'worker_upgrade', workerId: w.id, attribute: 'carry' }), /earns an upgrade point/);
  advance(3.5); assert.equal(w.cargo.stone, 1);
  advance(.1); assert.equal(w.cargo.stone, 2); assert.equal(w.workXp, 26);
  act({ kind: 'worker_pause', workerId: w.id, paused: true }); advance(5);
  assert.equal(w.workXp, 26, 'returning and idle time never grants experience');
  ensureWorkers(v); assert.equal(w.upgradePoints, 0, 'normalization never reissues spent points');
});

test('attribute caps, carry space, movement and saved progression use server-owned values', () => {
  const { v, act, hire, assign, advance, nodeOnly, atNode } = fixture();
  const w = hire(); w.workXp = WORKER_MAX_XP;
  for (const attribute of ['gathering', 'speed', 'carry']) for (let i = 0; i < 5; i++) act({ kind: 'worker_upgrade', workerId: w.id, attribute, points: 100 });
  assert.deepEqual(workerStats(w), { gatherSeconds: 2, speed: 4.5, carryCapacity: 90 });
  assert.equal(w.upgradePoints, 0); assert.equal(w.level, 16);
  assert.throws(() => act({ kind: 'worker_upgrade', workerId: w.id, attribute: 'carry' }), /fully upgraded/);
  const { node } = nodeOnly('stone'); assign(w); atNode(w, node); w.cargo.stone = 27;
  advance(2); assert.equal(w.cargo.stone, 28, 'upgraded worker gathers beyond the old 40 weight capacity');
  assert.equal(w.workXp, WORKER_MAX_XP);
  const color = WORKER_COLORS[3].value; act({ kind: 'worker_color', workerId: w.id, color });
  const restored = JSON.parse(JSON.stringify(v)); ensureWorkers(restored);
  assert.deepEqual(restored.workers[0].attributes, w.attributes); assert.equal(restored.workers[0].color, color);
  assert.equal(restored.workers[0].workXp, WORKER_MAX_XP); assert.equal(restored.workers[0].upgradePoints, 0);
  assert.deepEqual(restored.workers[0].cargo, w.cargo);
});

test('worker color changes are owner-only, allowlisted, and shared without private progression', () => {
  const { v, owner, visitor, act, hire } = fixture(); const w = hire(), wallet = owner.wallet;
  const color = WORKER_COLORS[2].value;
  assert.throws(() => act({ kind: 'worker_color', workerId: w.id, color }, visitor), /own workers/);
  assert.throws(() => act({ kind: 'worker_color', workerId: w.id, color: 'red;url(x)' }), /clothing colors/);
  act({ kind: 'worker_color', workerId: w.id, color });
  const other = workersSnapshot(v, 'visitor').workers[0];
  assert.equal(other.color, color); assert.equal(owner.wallet, wallet);
  for (const key of ['attributes', 'upgradePoints', 'workXp']) assert.equal(Object.hasOwn(other, key), false);
  delete w.attributes; delete w.workXp; delete w.color; w.upgradePoints = 999;
  const cargo = { ...w.cargo }; ensureWorkers(v);
  assert.equal(w.level, 1); assert.equal(w.upgradePoints, 0); assert.equal(w.color, WORKER_COLORS[0].value);
  assert.deepEqual(w.cargo, cargo, 'legacy migration retains earned cargo');
});

test('save/reload preserves remaining wages, cargo and elapsed gathering without a reconnect reward', () => {
  const f = fixture(), w = f.hire(), { node } = f.nodeOnly('stone'); f.assign(w); f.atNode(w, node);
  f.advance(2);
  const saved = JSON.parse(JSON.stringify(f.v)); ensureWorkers(saved);
  const restored = saved.workers[0], p = saved.players.owner;
  assert.equal(restored.gatherProgress, w.gatherProgress); assert.equal(restored.paidWorkSeconds, w.paidWorkSeconds);
  assert.deepEqual(restored.cargo, w.cargo); const wallet = p.wallet;
  for (let i = 0; i < 20; i++) { saved.clock += .1; workersTick(f.sim, saved, .1); }
  assert.equal(restored.cargo.stone, 1); assert.equal(p.wallet, wallet);
  assert.ok(Math.abs(restored.paidWorkSeconds - 26) < 1e-6);
  const oldVillage = { players: {} }; ensureWorkers(oldVillage); assert.deepEqual(oldVillage.workers, []);
});

test('collection is owner-only, nearby and capacity-bounded; dismissal cannot lose cargo', () => {
  const { owner, visitor, act, hire, assign } = fixture();
  const w = hire(); w.cargo.stone = 4;
  assert.throws(() => act({ kind: 'worker_collect', workerId: w.id }, visitor), /own workers/);
  owner.x = 30; assert.throws(() => act({ kind: 'worker_collect', workerId: w.id }), /closer/);
  Object.assign(owner, { x: w.x, z: w.z }); owner.inventory.wheat = 146;
  act({ kind: 'worker_collect', workerId: w.id });
  assert.equal(owner.inventory.stone, 1); assert.equal(w.cargo.stone, 3);
  assert.throws(() => act({ kind: 'worker_collect', workerId: w.id }), /pack is full/);
  Object.assign(owner, home); Object.assign(w, home);
  assert.throws(() => act({ kind: 'worker_dismiss', workerId: w.id }), /cargo/);
  owner.inventory = {}; act({ kind: 'worker_collect', workerId: w.id }); assert.equal(w.cargo.stone, 0);
  assign(w); w.x = 30; assert.throws(() => act({ kind: 'worker_dismiss', workerId: w.id }), /return to the treasury/);
  Object.assign(w, home); const wallet = owner.wallet;
  act({ kind: 'worker_dismiss', workerId: w.id }); assert.equal(owner.wallet, wallet, 'no hire or prepaid wage refund');
});

test('worker snapshots show shared actors but keep cargo, wage time and orders with their owner', () => {
  const { v, hire } = fixture(); const w = hire(); w.cargo.iron = 4; w.paidWorkSeconds = 12;
  const own = workersSnapshot(v, 'owner').workers[0], other = workersSnapshot(v, 'visitor').workers[0];
  assert.equal(own.cargo.iron, 4); assert.equal(own.paidWorkSeconds, 12); assert.equal(own.backpackTier, 1);
  for (const key of ['cargo', 'paidWorkSeconds', 'sourcePlotId', 'destinationPlotId', 'destinationOwnerId', 'paused', 'status', 'resource', 'mode']) assert.equal(Object.hasOwn(other, key), false, key);
  own.cargo.iron = 20; assert.equal(w.cargo.iron, 4, 'snapshots do not expose mutable ledger objects');
});

test('workers walk around plot buildings without teleporting or harvesting from across a wall', () => {
  const { v, hire, assign, advance, built } = fixture();
  const plot = built('house', 7), m = PLOTS.find(p => p.id === plot.id), w = hire();
  w.cargo.stone = 1; assign(w, { mode: 'store', destinationPlotId: plot.id });
  const target = plotFront(m, 1); w.x = m.x - 7; w.z = m.z;
  const solids = plotSolids(v.plots);
  for (let i = 0; i < 350 && w.cargo.stone > 0; i++) {
    const old = { x: w.x, z: w.z }; advance(.1);
    assert.ok(canStand(w.x, w.z, .4, solids)); assert.ok(apart(w, old) <= WORKER_RULES.speed * .1 * 1.15 + 1e-6);
  }
  assert.equal(plot.storage.stone, 1); assert.ok(apart(w, target) < .8);
  // A private node placed just outside the sidewall models a blocked resource.
  const mine = built('mine', 8); const node = v.plotResources.find(n => n.plotId === mine.id);
  node.x = 88.1; node.z = -80; node.remaining = 8;
  for (const other of v.plotResources) if (other !== node) other.available = false;
  assign(w, { sourcePlotId: mine.id }); w.x = 85.4; w.z = -80; w.gatherProgress = 3.9;
  advance(4); assert.equal(node.remaining, 8); assert.equal(w.cargo.stone, 0);
  assert.ok(canStand(w.x, w.z, .4, plotSolids(v.plots)));
});

test('far outside sources and deep interior storage route through the shared gate in both directions', () => {
  const { v, hire, assign, advance, built } = fixture();
  const outsideIndex = PLOTS.findIndex(p => p.id === 'outpost-8'), interiorIndex = PLOTS.findIndex(p => p.id === 'east-20');
  const mine = built('mine', outsideIndex), house = built('house', interiorIndex), w = hire();
  const outside = PLOTS[outsideIndex]; w.x = outside.x - 4; w.z = outside.z;
  w.cargo.coal = 1;
  assign(w, { resource: 'coal', sourcePlotId: mine.id, mode: 'store', destinationPlotId: house.id });
  let crossedIn = false;
  for (let i = 0; i < 1800 && !(house.storage.coal > 0); i++) {
    const old = { x: w.x, z: w.z }; advance(.1);
    if (old.z >= 18 && w.z < 18) { crossedIn = true; assert.ok(Math.abs(w.x) < 4, 'inbound worker uses the gate'); }
    assert.ok(canStand(w.x, w.z, .4, plotSolids(v.plots)));
    assert.ok(apart(w, old) <= WORKER_RULES.speed * .1 * 1.15 + 1e-6);
  }
  assert.equal(house.storage.coal, 1, `inbound worker reached its distant store: ${w.status} at ${w.x}, ${w.z}`);
  assert.ok(crossedIn);
  let crossedOut = false;
  for (let i = 0; i < 1800 && w.cargo.coal === 0; i++) {
    const old = { x: w.x, z: w.z }; advance(.1);
    if (old.z < 18 && w.z >= 18) { crossedOut = true; assert.ok(Math.abs(w.x) < 4, 'outbound worker uses the gate'); }
    assert.ok(canStand(w.x, w.z, .4, plotSolids(v.plots)));
  }
  assert.ok(crossedOut); assert.equal(w.cargo.coal, 1, `worker reached the distant private mine: ${w.status} at ${w.x}, ${w.z}`);
});

test('unreachable sidewall woodland is left for players instead of trapping hired workers', () => {
  const { v, owner, hire, assign, advance } = fixture(); const w = hire();
  for (const state of v.resources) state.available = false;
  const node = RESOURCES.find(n => n.type === 'timber' && n.x < -90 && n.z < 18);
  const state = v.resources.find(s => s.id === node.id); state.available = true; state.remaining = 5;
  assign(w, { resource: 'timber' }); w.x = -84; w.z = node.z;
  const wallet = owner.wallet; advance(5);
  assert.equal(w.cargo.timber, 0); assert.equal(state.remaining, 5); assert.equal(owner.wallet, wallet);
  assert.match(w.status, /Waiting for resources/);
});

for (const ownersOnline of [true, false]) test(`forty hired workers can deliver and return with their owners ${ownersOnline ? 'online' : 'offline and another resident present'}`, () => {
  const { v, owner, act, advance } = fixture();
  for (let i = 0; i < 8; i++) {
    const p = { ...owner, id: `employer-${i}`, name: `Employer ${i}`, wallet: 1000, inventory: {}, durability: {} }; v.players[p.id] = p;
    for (let j = 0; j < WORKER_RULES.maxPerPlayer; j++) {
      act({ kind: 'worker_hire' }, p); const w = v.workers.at(-1);
      w.cargo.stone = 1;
      act({ kind: 'worker_assign', workerId: w.id, resource: 'stone', sourcePlotId: null, mode: 'sell', destinationPlotId: null }, p);
      const n = i * WORKER_RULES.maxPerPlayer + j; w.x = 2 + n % 4 * 1.2; w.z = -27.2 + Math.floor(n / 4) * 1.2;
    }
    p.online = ownersOnline;
  }
  const stock = v.stock.stone;
  for (let i = 0; i < 700 && v.workers.some(w => w.cargo.stone > 0); i++) {
    advance(.1);
    for (const w of v.workers) if (w.cargo.stone === 0) w.paused = true;
  }
  assert.equal(v.stock.stone, stock + 40); assert.ok(v.workers.every(w => w.cargo.stone === 0));
  assert.ok(v.workers.every(w => canStand(w.x, w.z, .4)));
  for (let i = 0; i < 600 && v.workers.some(w => w.status !== 'Paused'); i++) advance(.1);
  for (const w of [...v.workers]) {
    const p = v.players[w.ownerId]; Object.assign(p, home);
    assert.doesNotThrow(() => act({ kind: 'worker_dismiss', workerId: w.id }, p), `${w.name} returns in dismissal range (${w.x}, ${w.z}; ${w.status})`);
  }
  assert.equal(v.workers.length, 0);
});
