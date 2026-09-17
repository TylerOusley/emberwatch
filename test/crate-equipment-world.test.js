import test from 'node:test';
import assert from 'node:assert/strict';
import { createCharacter } from '../public/src/characters.js';
import { createCrateEquipmentWorld } from '../public/src/crate-equipment-world.js';
import { createPlayerCosmetic } from '../public/src/cosmetics.js';

function parts(rig, id) {
  const found = [];
  rig.group.traverse(object => {
    if (object.name === `crate-headwear-${id}` || object.userData.crateArmor === id || object.userData.utilityId === id) found.push(object);
  });
  return found;
}
function resources(objects) {
  const found = new Set();
  for (const root of objects) root.traverse(object => {
    if (object.geometry) found.add(object.geometry);
    for (const material of object.material ? Array.isArray(object.material) ? object.material : [object.material] : []) {
      found.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) found.add(value);
    }
  });
  return found;
}
function fixture(role = 'villager', equipment = {}) {
  const rig = createCharacter(role, 1), player = { id: 'one', role, online: true, backpackTier: 1, crateEquipment: equipment };
  rig.setBackpackTier(player.backpackTier);
  return { rig, player, state: { players: [player] }, actors: new Map([[player.id, { rig }]]), world: createCrateEquipmentWorld() };
}

test('Ember Ward aura follows an ally without crate gear and expires without leaking meshes', () => {
  const f = fixture(); Object.assign(f.player, { hp:100, emberWard:50, emberWardUntil:110 }); f.state.clock=100;
  f.world.update(f.state,f.actors,0);
  const aura=f.rig.group.getObjectByName('ember-ward-shield');assert.ok(aura);assert.equal(aura.parent,f.rig.group);
  let freed=0;for(const resource of [aura.geometry,aura.material])resource.addEventListener('dispose',()=>freed++);
  f.player.emberWard=20;f.world.update(f.state,f.actors,2);assert.equal(f.rig.group.getObjectByName('ember-ward-shield'),aura);
  f.state.clock=110;f.world.update(f.state,f.actors,10);assert.equal(aura.parent,null);assert.equal(freed,2);
  f.world.dispose();assert.equal(freed,2);f.rig.dispose();
});

test('live rigs keep removable head covers separate while faces and original honor choices remain intact', () => {
  for (const role of ['villager', 'guard', 'priest']) {
    const f = fixture(role, { head: 'dawnsteel_helm' }), head = f.rig.group.getObjectByName('head');
    const original = head.children.map(object => ({ object, visible: object.visible }));
    const hair = head.getObjectByName('swept grooved scalp hair');
    assert.ok(hair?.userData.removableEquipment, `${role} live hair remains separately hideable`);
    const sash = createPlayerCosmetic({ palette: 'ember', crest: 'flame' }, role);f.rig.group.getObjectByName('body').add(sash);
    f.world.update(f.state, f.actors, 0);
    assert.equal(hair.visible, false);
    for (const { object, visible } of original) assert.equal(object.visible, object.userData.removableEquipment ? false : visible);
    assert.deepEqual(sash.userData.choice, { palette: 'ember', crest: 'flame' });assert.ok(sash.parent);
    f.player.crateEquipment = {};f.world.update(f.state, f.actors, 1);
    for (const { object, visible } of original) assert.equal(object.visible, visible, 'removing gear restores the exact original visibility');
    assert.ok(sash.parent);assert.deepEqual(f.world.stats, { players: 0, assets: 0 });
    f.world.dispose();for (const resource of resources([sash])) resource.dispose();sash.removeFromParent();f.rig.dispose();
  }
});

test('four deployed slots follow gait and role rebuilds without recreating their artwork or exposing new base backpacks', () => {
  const gear = { head: 'sunforged_viking_helm', body: 'runeforged_cuirass', feet: 'guardians_boots', utility: 'mining_pack' };
  const f = fixture('guard', gear);f.world.update(f.state, f.actors, 0);
  assert.deepEqual(f.world.stats, { players: 1, assets: 4 });
  const originalParts = Object.values(gear).flatMap(id => parts(f.rig, id)), originalResources = resources(originalParts);
  let disposed = 0;for (const resource of originalResources) resource.addEventListener('dispose', () => disposed++);
  for (let frame = 0; frame < 30; frame++) {
    f.rig.update(1 / 30, frame / 30, { moving: true, attack: frame % 20 < 8, tool: 'pickaxe' });
    f.world.update(f.state, f.actors, frame / 30, { reducedMotion: true });
    f.rig.group.updateMatrixWorld(true);
    assert.deepEqual(Object.values(gear).flatMap(id => parts(f.rig, id)), originalParts, 'snapshots and animation frames reuse all four assets');
    assert.ok(originalParts.every(part => part.parent.isBone && part.matrixWorld.elements.every(Number.isFinite)));
  }
  const oldBody = f.rig.group.getObjectByName('body');
  f.player.role = 'priest';f.rig.setRole('priest');f.world.update(f.state, f.actors, 2);
  assert.notEqual(f.rig.group.getObjectByName('body'), oldBody);
  assert.deepEqual(Object.values(gear).flatMap(id => parts(f.rig, id)), originalParts, 'role rebuild refits the same resources to fresh bones');
  assert.equal(f.rig.group.getObjectByName('swept grooved scalp hair').visible, false);
  assert.equal(f.rig.group.getObjectByName('draped linen hood').visible, false);
  assert.equal(f.rig.group.getObjectByName('worn-backpack').visible, false);
  const oldPack = f.rig.group.getObjectByName('worn-backpack');
  f.player.backpackTier = 3;f.rig.setBackpackTier(3);f.world.update(f.state, f.actors, 3);
  const newPack = f.rig.group.getObjectByName('worn-backpack');assert.notEqual(newPack, oldPack);assert.equal(newPack.visible, false);
  assert.equal(parts(f.rig, 'mining_pack')[0].userData.backpackTier, 3);assert.equal(disposed, 0);
  f.world.clear();f.world.clear();assert.equal(disposed, originalResources.size, 'owned geometry, materials, and textures dispose exactly once');
  assert.equal(newPack.visible, true);assert.equal(f.rig.group.getObjectByName('draped linen hood').visible, true);
  f.world.dispose();f.rig.dispose();
});

test('slot replacements dispose before hiding the same base cover and do not affect another player', () => {
  const f = fixture('villager', { head: 'padded_cap', utility: 'mining_pack' }), neighbor = createCharacter('villager', 1);
  const two = { id: 'two', role: 'villager', online: true, crateEquipment: { head: 'padded_cap' } };
  f.state.players.push(two);f.actors.set(two.id, { rig: neighbor });f.world.update(f.state, f.actors, 0);
  const replaced = resources(parts(f.rig, 'padded_cap')), retained = resources(parts(neighbor, 'padded_cap'));
  let replacementsDisposed = 0, retainedDisposed = 0;
  for (const resource of replaced) resource.addEventListener('dispose', () => replacementsDisposed++);
  for (const resource of retained) resource.addEventListener('dispose', () => retainedDisposed++);
  f.player.crateEquipment = { head: 'dawnsteel_helm', utility: 'lumber_pack' };f.world.update(f.state, f.actors, 1);
  assert.equal(replacementsDisposed, replaced.size);assert.equal(retainedDisposed, 0);
  assert.equal(f.rig.group.getObjectByName('swept grooved scalp hair').visible, false);
  assert.equal(f.rig.group.getObjectByName('worn-backpack').visible, false);
  f.player.online = false;f.world.update(f.state, f.actors, 2);
  assert.equal(f.rig.group.getObjectByName('worn-backpack').visible, true);assert.equal(retainedDisposed, 0);
  assert.deepEqual(f.world.stats, { players: 1, assets: 1 });
  f.world.dispose();assert.equal(retainedDisposed, retained.size);f.rig.dispose();neighbor.dispose();
});

test('only public deployed wearable slots on real players appear, and reconnecting to a new rig releases the old art', () => {
  const f = fixture('villager', { head: 'hearth_ration_kit', body: 'phoenix_ember', feet: 'padded_cap', utility: '__proto__' });
  f.state.crates = { loadout: { head: 'sunforged_viking_helm' }, unlocks: ['sunforged_viking_helm'] };
  f.state.workers = [{ id: 'worker', role: 'villager', crateEquipment: { head: 'dawnsteel_helm' } }];
  const worker = createCharacter('villager', 2);f.actors.set('worker', { rig: worker });
  f.world.update(f.state, f.actors, 0);assert.deepEqual(f.world.stats, { players: 0, assets: 0 });
  f.player.crateEquipment = { head: 'dawnsteel_helm' };f.world.update(f.state, f.actors, 1);
  const before = resources(parts(f.rig, 'dawnsteel_helm'));let disposed = 0;for (const resource of before) resource.addEventListener('dispose', () => disposed++);
  const replacement = createCharacter('villager', 1);f.actors.set(f.player.id, { rig: replacement });f.world.update(f.state, f.actors, 2);
  assert.equal(disposed, before.size);assert.equal(parts(f.rig, 'dawnsteel_helm').length, 0);assert.equal(parts(replacement, 'dawnsteel_helm').length, 1);
  assert.equal(parts(worker, 'dawnsteel_helm').length, 0);
  f.world.dispose();f.world.update(f.state, f.actors, 3);assert.deepEqual(f.world.stats, { players: 0, assets: 0 });
  f.rig.dispose();replacement.dispose();worker.dispose();
});
