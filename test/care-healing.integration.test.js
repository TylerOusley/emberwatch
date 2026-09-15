import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.js';
import { PLOTS } from '../shared/world.js';
import { plotEntrance } from '../shared/access.js';

async function fixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'emberwatch-blessings-'));
  const app = createApp({ dataDir, autoTick: false });
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  async function account(name) {
    const session = await app.store.authenticate('register', name, 'a-blessing-test-password');
    return app.store.accountFromToken(session.token);
  }
  const healer = await account('Town Healer'), captain = await account('Guard Captain');
  const { id } = app.simulation.create('Blessed Watch', healer), village = app.simulation.villages.get(id);
  const priest = app.simulation.join(id, healer, 'priest'), guardPlayer = app.simulation.join(id, captain, 'guard');
  const plot = village.plots.find(plot => plot.id === 'west-1');
  Object.assign(plot, { ownerId: guardPlayer.id, building: 'barracks', level: 1, hp: 800, maxHp: 800, storage: { timber: 100, iron: 100 } });
  Object.assign(guardPlayer, plotEntrance(PLOTS.find(site => site.id === plot.id), 'barracks'), { wallet: 500 });
  app.simulation.action(id, guardPlayer.id, { kind: 'recruitGuard', plotId: plot.id });
  const recruit = village.guards.find(guard => guard.ownerId === guardPlayer.id), watchman = village.guards.find(guard => !guard.plotId);
  Object.assign(priest, { x: 0, z: 0 });
  for (const guard of [watchman, recruit]) Object.assign(guard, { x: 1, z: 0, hp: 100, attackUntil: 1000 });
  const action = (actor, message) => { village.clock += .7; return app.simulation.action(id, actor.id, message); };
  return { app, village, priest, guardPlayer, watchman, recruit, action };
}

test('priests heal both public watchmen and another resident’s recruited guards, with capped real-health rewards', async t => {
  const { app, village, priest, guardPlayer, watchman, recruit, action } = await fixture(t);
  for (const guard of [watchman, recruit]) {
    action(priest, { kind: 'heal', targetId: guard.id });
    assert.equal(priest.healing.targetKind, 'guard'); assert.equal(priest.healing.revive, false);
    app.simulation.tick(1.9); assert.equal(guard.hp, 100, 'blessing must complete its channel');
    app.simulation.tick(.11); assert.equal(guard.hp, 130); assert.equal(priest.healing, null);
    const observed = app.simulation.snapshot(village, guardPlayer.id).guards.find(item => item.id === guard.id);
    assert.equal(observed.hp, 130, 'other residents see guard healing');
  }
  assert.equal(priest.jobBonus, 1); assert.equal(priest.healingProgress, 10);
  recruit.hp = recruit.maxHp - 1;
  action(priest, { kind: 'heal', targetId: recruit.id }); app.simulation.tick(2.01);
  assert.equal(recruit.hp, recruit.maxHp); assert.equal(priest.healingProgress, 11, 'no reward for overhealing');
  assert.deepEqual(priest.revivedThisNight, []);
  assert.throws(() => action(guardPlayer, { kind: 'heal', targetId: watchman.id }), /Only priests/);
});

test('guard blessings cancel on distance or death and cannot revive paid replacement slots', async t => {
  const { app, priest, watchman, recruit, action } = await fixture(t);
  action(priest, { kind: 'heal', targetId: watchman.id }); watchman.x = 10;
  app.simulation.tick(2.01); assert.equal(watchman.hp, 100); assert.equal(priest.healing, null);
  action(priest, { kind: 'heal', targetId: recruit.id }); recruit.hp = 0;
  app.simulation.tick(2.01); assert.equal(recruit.hp, 0); assert.equal(priest.healing, null);
  assert.throws(() => action(priest, { kind: 'heal', targetId: recruit.id }), /living town guard/);
  assert.equal(priest.jobBonus, 0); assert.equal(priest.healingProgress, 0);
});

test('a priest can immediately put down a carried dwarf anywhere without a selected target', async t => {
  const { app, village, priest, guardPlayer, action } = await fixture(t);
  Object.assign(guardPlayer, { x: priest.x + 1, z: priest.z });
  app.simulation.hurtPlayer(village, guardPlayer, guardPlayer.hp + guardPlayer.shield);
  guardPlayer.inventory.iron = 11;
  action(priest, { kind: 'carryPlayer', targetId: guardPlayer.id });
  assert.equal(priest.carryingId, guardPlayer.id);
  priest.x = 0; priest.z = -40;
  const clock = village.clock;
  app.simulation.action(village.id, priest.id, { kind: 'dropPlayer' });
  assert.equal(village.clock, clock, 'putting down needs no action cooldown or world tick');
  assert.equal(priest.carryingId, null); assert.equal(guardPlayer.carriedBy, null);
  assert.equal(guardPlayer.x, priest.x); assert.equal(guardPlayer.z, priest.z);
  assert.equal(guardPlayer.downed, true); assert.equal(guardPlayer.inventory.iron, 11);
});
