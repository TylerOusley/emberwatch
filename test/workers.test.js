import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingEntrance } from '../shared/access.js';
import { BUILDINGS, PLOTS, RESOURCES, canStand, plotFront, plotSolids } from '../shared/world.js';
import { WORKER_RULES } from '../shared/workers.js';
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
  assert.throws(() => act({ kind: 'worker_hire', price: 0, limit: 100 }), /at most 2/);
  assert.equal(v.workers.length, 2); assert.equal(owner.wallet, 850);
});

test('orders require ownership and compatible living source/storage buildings', () => {
  const { v, owner, visitor, act, hire, assign, built } = fixture();
  const w = hire(), mine = built('mine'), house = built('house', 1), foreign = built('mine', 2, visitor);
  const original = structuredClone(w);
  assert.throws(() => act({ kind: 'worker_pause', workerId: w.id, paused: false }, visitor), /own workers/);
  assert.throws(() => assign(w, { resource: '__proto__' }), /Choose wheat/);
  assert.throws(() => assign(w, { sourcePlotId: foreign.id }), /you own/);
  assert.throws(() => assign(w, { resource: 'wheat', sourcePlotId: mine.id }), /supplies this resource/);
  assert.throws(() => assign(w, { mode: 'store', destinationPlotId: foreign.id }), /your living buildings/);
  assert.throws(() => assign(w, { sourcePlotId: {} }), /public resources/);
  assert.deepEqual(w, original, 'invalid orders do not silently unpause or replace the assignment');
  assign(w, { sourcePlotId: mine.id, mode: 'store', destinationPlotId: house.id });
  assert.equal(w.paused, false); assert.equal(w.sourcePlotId, mine.id); assert.equal(w.destinationPlotId, house.id);
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

test('wages stop while paused, owner offline, at night, near zombies, or unable to pay', () => {
  for (const reason of ['paused', 'offline', 'night', 'zombie', 'unpaid']) {
    const { v, owner, hire, assign, advance, nodeOnly, atNode } = fixture();
    const w = hire(), { node, state } = nodeOnly('stone'); assign(w); atNode(w, node);
    w.gatherProgress = 3.9; w.cargo.stone = 1;
    if (reason === 'paused') w.paused = true;
    if (reason === 'offline') owner.online = false;
    if (reason === 'night') v.phase = 'night';
    if (reason === 'zombie') v.zombies.push({ x: w.x + 4, z: w.z, hp: 100 });
    if (reason === 'unpaid') owner.wallet = 0;
    const wallet = owner.wallet, before = { x: w.x, z: w.z };
    advance(1);
    assert.equal(owner.wallet, wallet, reason); assert.equal(w.paidWorkSeconds, 0, reason);
    assert.equal(w.cargo.stone, 1, reason); assert.equal(state.remaining, 8, reason);
    assert.equal(w.gatherProgress, 0, reason); assert.ok(apart(w, before) > .1, `${reason}: worker walks home`);
  }
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
  for (const key of ['cargo', 'paidWorkSeconds', 'sourcePlotId', 'destinationPlotId', 'paused', 'status', 'resource', 'mode']) assert.equal(Object.hasOwn(other, key), false, key);
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

test('sixteen hired workers can all deliver at the Resource Exchange without sharing one arrival point', () => {
  const { v, owner, act, advance } = fixture();
  for (let i = 0; i < 8; i++) {
    const p = { ...owner, id: `employer-${i}`, name: `Employer ${i}`, wallet: 1000, inventory: {}, durability: {} }; v.players[p.id] = p;
    for (let j = 0; j < 2; j++) {
      act({ kind: 'worker_hire' }, p); const w = v.workers.at(-1);
      w.cargo.stone = 1;
      act({ kind: 'worker_assign', workerId: w.id, resource: 'stone', sourcePlotId: null, mode: 'sell', destinationPlotId: null }, p);
      const n = i * 2 + j; w.x = 2 + n % 2 * 1.2; w.z = -27.2 + Math.floor(n / 2) * 1.2;
    }
  }
  const stock = v.stock.stone;
  for (let i = 0; i < 700 && v.workers.some(w => w.cargo.stone > 0); i++) {
    advance(.1);
    for (const w of v.workers) if (w.cargo.stone === 0) w.paused = true;
  }
  assert.equal(v.stock.stone, stock + 16); assert.ok(v.workers.every(w => w.cargo.stone === 0));
  assert.ok(v.workers.every(w => canStand(w.x, w.z, .4)));
});
