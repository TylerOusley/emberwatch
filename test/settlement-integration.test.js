import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingEntrance, plotEntrance } from '../shared/access.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createApp } from '../server/index.js';
import { economyDawn, exportReserves } from '../server/economy.js';
import { BUILDINGS, PLOTS, RESOURCES, canStand, plotSolids } from '../shared/world.js';

async function fixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'emberwatch-settlement-'));
  let app = createApp({ dataDir, autoTick: false });
  await listen(app);
  const fixture = { dataDir, get app() { return app; }, get base() { return `http://127.0.0.1:${app.server.address().port}`; },
    async reload() { await app.close(); app = createApp({ dataDir, autoTick: false }); await listen(app); return app; } };
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  return fixture;
}
async function listen(app) { app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening'); }
async function account(app, name) {
  const session = await app.store.authenticate('register', name, 'integration-test-password');
  return { session, user: app.store.accountFromToken(session.token) };
}
async function residents(app, role = 'villager') {
  const founder = await account(app, 'SettlementFounder'), guest = await account(app, 'SettlementGuest');
  const { id } = app.simulation.create('Integrated Settlement', founder.user);
  const owner = app.simulation.join(id, founder.user, role), visitor = app.simulation.join(id, guest.user, 'villager');
  // These mature settlement scenarios start after both residents have earned
  // some gold; starter allowance and first-tool purchases have their own tests.
  owner.wallet = visitor.wallet = 50;
  return { founder, guest, village: app.simulation.villages.get(id), owner, visitor };
}
const act = (app, village, player, action) => { village.clock += .7; return app.simulation.action(village.id, player.id, action); };
const atPlot = (player, village, site = PLOTS[0]) => Object.assign(player, plotEntrance(site, village.plots.find(p => p.id === site.id)));
const atBank = player => Object.assign(player, buildingEntrance(BUILDINGS.find(b => b.id === 'bank')));
async function waitFor(fn, timeout = 2500) {
  const end = performance.now() + timeout;
  while (performance.now() < end) { const value = fn(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw new Error('Timed out waiting for multiplayer state.');
}
async function socket(base, session, villageId) {
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/socket'), messages = [];
  ws.on('message', bytes => messages.push(JSON.parse(bytes.toString())));
  await once(ws, 'open');
  ws.send(JSON.stringify({ type: 'join', token: session.token, villageId, role: 'villager' }));
  await waitFor(() => messages.some(m => m.type === 'state'));
  return { ws, messages };
}

test('real loans, plot construction, stocked multiplayer crafting and tier yields survive SQLite restart', async t => {
  const f = await fixture(t), { app } = f;
  const { founder, guest, village: v, owner, visitor } = await residents(app);
  atBank(owner); act(app, v, owner, { kind: 'loan', amount: 200 });
  assert.equal(app.store.account(owner.id).credit, 200); assert.equal(owner.wallet, 50);
  atPlot(owner, v); act(app, v, owner, { kind: 'plot_buy', plotId: PLOTS[0].id });
  assert.equal(owner.wallet, 0); assert.equal(app.store.account(owner.id).credit, 150);
  // Seed gathered materials; the actual transfer, construction, purchase and
  // resulting harvest still use the same authoritative actions as the client.
  owner.inventory.timber = 20; owner.inventory.stone = 10;
  act(app, v, owner, { kind: 'plot_deposit', plotId: PLOTS[0].id, resource: 'timber', amount: 20 });
  act(app, v, owner, { kind: 'plot_deposit', plotId: PLOTS[0].id, resource: 'stone', amount: 10 });
  visitor.x = PLOTS[0].x; visitor.z = PLOTS[0].z; atPlot(owner, v);
  act(app, v, owner, { kind: 'plot_build', plotId: PLOTS[0].id, building: 'tool_shop' });
  assert.equal(app.store.account(owner.id).credit, 110);
  for (const player of [owner, visitor]) assert.ok(canStand(player.x, player.z, .48, plotSolids(v.plots)), 'construction moves every obstructed dwarf outside the new building');
  atPlot(owner, v); owner.inventory.timber = 5; owner.inventory.stone = 10;
  act(app, v, owner, { kind: 'plot_deposit', plotId: PLOTS[0].id, resource: 'timber', amount: 5 });
  act(app, v, owner, { kind: 'plot_deposit', plotId: PLOTS[0].id, resource: 'stone', amount: 10 });
  atPlot(visitor, v);
  act(app, v, visitor, { kind: 'craft_buy', plotId: PLOTS[0].id, recipe: 'stone_pickaxe', confirm: true });
  assert.equal(visitor.wallet, 15); assert.equal(visitor.tiers.pickaxe, 'stone'); assert.equal(visitor.durability.pickaxe, 150);
  assert.equal(owner.wallet, 28, 'shop earnings repay six gold of debt before reaching the owner wallet');
  assert.equal(app.store.account(owner.id).debt, 194);
  const ore = RESOURCES.find(node => node.type === 'iron'); visitor.x = ore.x; visitor.z = ore.z; visitor.tool = 'pickaxe';
  const actualMineral=v.resources.find(node=>node.id===ore.id).type, initialMineral=visitor.inventory[actualMineral];
  act(app, v, visitor, { kind: 'gather', targetId: ore.id });
  assert.equal(visitor.inventory[actualMineral], initialMineral+2); assert.equal(visitor.durability.pickaxe, 149);
  const villageId = v.id, ownerId = owner.id, visitorId = visitor.id;
  app.simulation.saveAll(); await f.reload();
  const recovered = f.app.simulation.villages.get(villageId);
  assert.equal(recovered.plots[0].ownerId, ownerId); assert.equal(recovered.plots[0].building, 'tool_shop');
  assert.equal(recovered.plots[0].storage.stone, 0); assert.equal(recovered.players[visitorId].tiers.pickaxe, 'stone');
  assert.equal(recovered.players[visitorId].inventory[actualMineral], initialMineral+2); assert.equal(recovered.players[visitorId].durability.pickaxe, 149);
  assert.equal(f.app.store.account(ownerId).credit, 110); assert.equal(f.app.store.account(ownerId).debt, 194);
  assert.equal(recovered.players[visitorId].online, false);
  const before = recovered.clock; f.app.simulation.tick(180); assert.equal(recovered.clock, before, 'saved settlement pauses without online residents');
  assert.equal(f.app.simulation.join(villageId, f.app.store.accountFromToken(guest.session.token)).id, visitorId);
  assert.equal(f.app.store.accountFromToken(founder.session.token).id, ownerId);
});

test('failed post-purchase persistence rolls back account credit and every village mutation', async t => {
  const { app } = await fixture(t), { village: v, owner } = await residents(app);
  atBank(owner); act(app, v, owner, { kind: 'loan', amount: 200 }); atPlot(owner, v);
  app.simulation.saveAll();
  const durableBefore = JSON.stringify(app.store.loadVillages()[0]), accountBefore = app.store.account(owner.id);
  v.clock += .7; const before = structuredClone(v), originalSave = app.store.saveVillage;
  app.store.saveVillage = function () { throw new Error('Injected disk write failure'); };
  try { assert.throws(() => app.simulation.action(v.id, owner.id, { kind: 'plot_buy', plotId: PLOTS[0].id }), /disk write/); }
  finally { app.store.saveVillage = originalSave; }
  assert.deepEqual(v, before, 'failed action restores the existing in-memory village object');
  assert.deepEqual(app.store.account(owner.id), accountBefore, 'SQL transaction also restores spent restricted credit');
  assert.equal(JSON.stringify(app.store.loadVillages()[0]), durableBefore);
  act(app, v, owner, { kind: 'plot_buy', plotId: PLOTS[0].id });
  assert.equal(v.plots[0].ownerId, owner.id); assert.equal(app.store.account(owner.id).credit, 150);
});

test('changing jobs accrues only each role active time and cannot duplicate dawn earnings', async t => {
  const { app } = await fixture(t), { village: v, owner } = await residents(app, 'guard');
  v.phaseRemaining = 10000;
  app.simulation.tick(180);
  assert.equal(owner.wageAccrued, 6.25);
  act(app, v, owner, { kind: 'role_change', role: 'villager' }); app.simulation.tick(180);
  assert.equal(owner.wageAccrued, 6.25, 'a villager interval does not earn a guard wage');
  act(app, v, owner, { kind: 'role_change', role: 'priest' }); app.simulation.tick(360);
  assert.equal(owner.wageAccrued, 18.75);
  const wallet = owner.wallet; app.simulation.dawn(v);
  assert.equal(owner.wallet, wallet + 18); assert.equal(owner.wageAccrued, 0);
  act(app, v, owner, { kind: 'role_change', role: 'guard' }); app.simulation.dawn(v);
  assert.equal(owner.wallet, wallet + 18, 'another role switch does not pay old participation a second time');
});

test('saved merchant policies export their percentage after SQLite restart without repeating a visit', async t => {
  const cases = [
    ['conserve', { wheat: 1000, timber: 2001, stone: 3002 }],
    ['balanced', { wheat: 2001, timber: 4003, stone: 6005 }],
    ['trade', { wheat: 4003, timber: 8007, stone: 12011 }]
  ];
  for (const [policy, sold] of cases) await t.test(policy, async t => {
    const f = await fixture(t), { village: v } = await residents(f.app);
    v.policies.exportPriority = policy;
    v.day = 2; v.phase = 'night'; v.economy.lastDawn = 2;
    v.stable.stock = 3;
    const reserves = exportReserves(v);
    const before = { wheat: reserves.wheat + 4003, timber: reserves.timber + 8007, stone: reserves.stone + 12011 };
    Object.assign(v.stock, before);
    f.app.simulation.saveAll();

    await f.reload();
    const recovered = f.app.simulation.villages.get(v.id);
    assert.equal(recovered.policies.exportPriority, policy, 'existing saved policy needs no migration');
    f.app.simulation.dawn(recovered);
    assert.equal(recovered.day, 3);
    assert.equal(recovered.merchant.visits, 1);
    assert.equal(recovered.merchant.lastVisitDay, 3);
    for (const resource of Object.keys(sold)) {
      assert.equal(recovered.stock[resource], before[resource] - sold[resource], 'percentage applies to surplus, with whole-unit rounding');
      assert.ok(recovered.stock[resource] >= reserves[resource], 'saved policy retains protected reserves');
    }
    assert.equal(recovered.economy.lastExportGold, sold.wheat + 2 * sold.timber + 2 * sold.stone);

    const stock = structuredClone(recovered.stock), treasury = recovered.treasury;
    const merchant = structuredClone(recovered.merchant), exportGold = recovered.economy.lastExportGold;
    await f.reload();
    const afterVisit = f.app.simulation.villages.get(v.id);
    economyDawn(f.app.simulation, afterVisit);
    assert.deepEqual(afterVisit.stock, stock, 'restart cannot sell the same visit twice');
    assert.equal(afterVisit.treasury, treasury);
    assert.equal(afterVisit.economy.lastExportGold, exportGold);
    assert.deepEqual(afterVisit.merchant, merchant);
  });
});

test('an owned rear barracks dispatches troops through a fully built neighborhood and the single gate', async t => {
  const { app } = await fixture(t), { village: v, owner } = await residents(app, 'guard');
  const site = PLOTS.find(plot => plot.id === 'west-20'); assert.ok(site);
  owner.wallet = 600; atPlot(owner, v, site);
  act(app, v, owner, { kind: 'plot_buy', plotId: site.id });
  // A mature-map collision fixture fills every other deed footprint. This
  // deliberately stress-tests paths independently of eight-resident finances.
  for (const plot of v.plots) if (plot.id !== site.id) Object.assign(plot, { ownerId: owner.id, building: 'house', hp: 500, maxHp: 500 });
  const plot = v.plots.find(p => p.id === site.id);
  plot.storage = { timber: 40, stone: 25, iron: 2, wheat: 2 };
  act(app, v, owner, { kind: 'plot_build', plotId: site.id, building: 'barracks' });
  atPlot(owner, v, site); act(app, v, owner, { kind: 'recruitGuard', plotId: site.id });
  const guard = v.guards.find(g => g.plotId === site.id); assert.ok(guard);
  let passedGate = false; v.phaseRemaining = 10000;
  for (let i = 0; i < 2200; i++) {
    app.simulation.tick(.05);
    assert.ok(canStand(guard.x, guard.z, .39, plotSolids(v.plots)), 'the guard stays outside every building and wall');
    if (guard.z > 18 && Math.abs(guard.x) < 5) passedGate = true;
  }
  assert.ok(passedGate, `troop must pass the gate; stopped at ${guard.x.toFixed(1)}, ${guard.z.toFixed(1)}`);
  assert.ok(Math.hypot(guard.x - guard.post.x, guard.z - guard.post.z) < 1, 'troop reaches its assigned defense post');
});

test('real WebSocket residents receive the same plot mutations and only their own loan balances', async t => {
  const f = await fixture(t), { app } = f, { village: v, founder, guest, owner, visitor } = await residents(app);
  atBank(owner); act(app, v, owner, { kind: 'loan', amount: 200 }); atPlot(owner, v);
  const a = await socket(f.base, founder.session, v.id), b = await socket(f.base, guest.session, v.id);
  t.after(() => { a.ws.terminate(); b.ws.terminate(); });
  v.clock += .7;
  a.ws.send(JSON.stringify({ type: 'action', kind: 'plot_buy', plotId: PLOTS[0].id }));
  await waitFor(() => v.plots[0].ownerId === owner.id);
  app.broadcast();
  const aState = await waitFor(() => a.messages.find(m => m.type === 'state' && m.state.plots[0].ownerId === owner.id)?.state);
  const bState = await waitFor(() => b.messages.find(m => m.type === 'state' && m.state.plots[0].ownerId === owner.id)?.state);
  assert.equal(aState.plots.length, 48); assert.deepEqual(aState.plots, bState.plots);
  assert.deepEqual([aState.loan.debt, aState.loan.credit], [200, 150]);
  assert.deepEqual([bState.loan.debt, bState.loan.credit], [0, 0]);
  const other = bState.players.find(p => p.id === owner.id);
  assert.equal(other.wallet, undefined); assert.equal(other.bank, undefined); assert.equal(other.inventory, undefined); assert.equal(other.loan, undefined); assert.equal(other.credit, undefined);
  assert.equal(aState.players.find(p => p.id === visitor.id).wallet, undefined);
});
