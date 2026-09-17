import test from 'node:test';
import assert from 'node:assert/strict';
import { civicAction, civicTick, ensureCivic } from '../server/civic.js';
import { CIVIC_PROJECTS } from '../shared/civic.js';
import { movePlayer, resetJump } from '../shared/movement.js';
import { canStand } from '../shared/world.js';

function fixture() {
  const p = { id: 'a', name: 'Mason', online: true, x: -10, z: -23, wallet: 100000, inventory: { timber: 10000, stone: 10000, iron: 10000 } };
  const v = { id: 'v', players: { a: p }, gate: { hp: 800, maxHp: 1200 }, keep: { hp: 2000, maxHp: 2000 }, zombies: [], clock: 0 };
  ensureCivic(v); return { p, v, sim: {} };
}
test('shared projects require all contributions once and preserve progress through save', () => {
  const { p, v, sim } = fixture();
  civicAction(sim, v, p, { kind: 'civic_select', projectId: 'reinforcement' });
  for (const [resource, amount] of Object.entries(CIVIC_PROJECTS.reinforcement.cost)) civicAction(sim, v, p, { kind: 'civic_donate', resource, amount });
  assert.equal(v.gate.maxHp, 2400); assert.equal(v.gate.hp, 2000); assert.equal(v.keep.maxHp, 3000);
  const saved = JSON.parse(JSON.stringify(v)); ensureCivic(saved); assert.equal(saved.gate.maxHp, 2400);
  assert.throws(() => civicAction(sim, v, p, { kind: 'civic_select', projectId: 'reinforcement' }));
  assert.throws(() => civicAction(sim, v, p, { kind: 'civic_select', projectId: 'trebuchet' }));
});
test('invalid and remote contributions do not spend; freight delivers only accessible owner cargo', () => {
  const { p, v, sim } = fixture(); civicAction(sim, v, p, { kind: 'civic_select', projectId: 'reinforcement' });
  for (const amount of [-1, 1.5, Infinity, 10001]) assert.throws(() => civicAction(sim, v, p, { kind: 'civic_donate', resource: 'timber', amount }));
  assert.equal(p.inventory.timber, 10000);
  v.carts = [{ id: 'cart', ownerId: 'a', x: -9, z: -23, storage: { timber: 1000 } }];
  civicAction(sim, v, p, { kind: 'civic_donate', resource: 'timber', amount: 'max', cartId: 'cart' });
  assert.equal(v.carts[0].storage.timber, 700); assert.equal(v.civic.progress.timber, 300);
  p.x = 0; assert.throws(() => civicAction(sim, v, p, { kind: 'civic_donate', resource: 'stone', amount: 1 }));
});
test('mason uses real funded time/materials and siege uses donated ammunition', () => {
  const { v } = fixture(); v.civic.completed = ['repair_crew', 'ballista'];
  Object.assign(v.civic.mason, { x: 0, z: 14 }); v.civic.depot = { gold: 1, timber: 2, stone: 2, arrows: 1 };
  v.zombies = [{ id: 'z', x: -8, z: 30, hp: 100 }];
  civicTick({ hitZombie(v, z, damage) { z.hp -= damage; } }, v, 1);
  assert.equal(v.gate.hp, 835); assert.equal(v.civic.depot.gold, 0); assert.equal(v.civic.mason.paidTime, 59);
  assert.equal(v.zombies[0].hp, 35); assert.equal(v.civic.depot.arrows, 0);
  civicTick({}, v, 1); assert.equal(v.zombies[0].hp, 35);
});
test('jump rises and lands authoritatively; holding jump does not bounce', () => {
  const p = { x: 0, z: 4 }; resetJump(p); let peak = 0;
  for (let i = 0; i < 100; i++) { movePlayer(p, 0, 0, .02, true); peak = Math.max(peak, p.y); }
  assert(peak > 1.1 && peak < 1.3); assert.equal(p.y, 0); assert.equal(p.grounded, true);
  movePlayer(p, 0, 0, .02, false); movePlayer(p, 0, 0, .02, true); assert(p.y > 0);
});
test('jump crosses low logs but cannot cross perimeter walls', () => {
  assert.equal(canStand(-66, 106), false);
  const p = { x: -66, z: 104.5 }; resetJump(p);
  for (let i = 0; i < 30; i++) movePlayer(p, 0, .12, .02, i === 0);
  assert(p.z > 107, 'grounded collision must allow a sufficiently high jump across the log');
  const wall = { x: -87, z: -40, y: 10, verticalSpeed: 0 };
  assert.equal(canStand(wall.x, wall.z, .48, [], 20), false, 'wall remains solid at any jump height');
});
