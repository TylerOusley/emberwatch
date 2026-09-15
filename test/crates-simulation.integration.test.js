import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { Simulation } from '../server/simulation.js';
import { emptyLoadout } from '../shared/crates.js';
import { BUILDINGS } from '../shared/world.js';
import { buildingEntrance } from '../shared/access.js';

async function fixture(t, {loadout = {}, role = 'guard', ember = false} = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'emberwatch-crate-simulation-'));
  const store = new Store(directory), sim = new Simulation(store);
  t.after(async () => { store.close(); await rm(directory, { recursive:true, force:true }); });
  const session = await store.authenticate('register', 'Crate Watcher', 'test-crate-password');
  const account = store.account(session.playerId);
  for (const id of Object.values(loadout)) if (typeof id === 'string' && id && !['axe','pickaxe','scythe'].includes(id)) store.unlockCrateItem(account.id, id, 'test-fixture');
  store.saveCrateLoadout(account.id, { ...emptyLoadout(), ...loadout, reserveEmber:ember });
  if (ember) store.grantEmber(account.id, 'test-ember-source');
  const {id} = sim.create('Crate Defense', account), village = sim.villages.get(id), player = sim.join(id, account, role);
  const action = input => { village.clock += .6; return sim.action(id, player.id, input); };
  return {store, sim, account, village, player, action};
}

test('deployed armor receives the actual enemy hit after shield and stays private except visible gear', async t => {
  const {sim,store,village:v,player:p} = await fixture(t, {loadout:{head:'dawnsteel_helm',body:'runeforged_cuirass',feet:'guardians_boots',utility:'deep_delvers_belt'}});
  p.shield = 20; const hp = p.hp;
  sim.hurtPlayer(v,p,60);
  assert.equal(p.shield,0); assert.equal(p.hp,hp-30,'40 shield overflow receives25% reduction once');
  const otherSession = await store.authenticate('register', 'Crate Observer', 'test-crate-password');
  const other = sim.join(v.id,store.account(otherSession.playerId));
  const snapshot = sim.snapshot(v,other.id), observed = snapshot.players.find(row=>row.id===p.id);
  assert.deepEqual(observed.crateEquipment,p.crateEquipment);
  for(const key of ['boundInventory','maxDurability','lastStandWard','bank','inventory'])assert.equal(observed[key],undefined);
  assert.deepEqual(snapshot.crates.unlocks,[],'private account collection belongs to viewer only');
});

test('Last Stand survives save/rejoin without refreshing, and dawn respawn forfeits physical armor',async t=>{
  const {sim,store,account,village:v,player:p,action} = await fixture(t,{loadout:{head:'sunforged_viking_helm'}});
  p.shield=0;p.hp=30;sim.hurtPlayer(v,p,10);
  assert.equal(p.hp,20.6);assert.equal(p.lastStandWard,20);
  sim.disconnect(v.id,p.id);sim.join(v.id,account);assert.equal(p.lastStandWard,20);
  sim.hurtPlayer(v,p,10);assert.ok(Math.abs(p.lastStandWard-10.6)<1e-8);assert.equal(p.hp,20.6);
  v.clock+=11;p.hp=30;sim.hurtPlayer(v,p,10);assert.equal(p.lastStandWard,0,'same cycle cannot trigger again');
  sim.hurtPlayer(v,p,1000);p.respawnAvailable=true;action({kind:'respawn'});
  assert.equal(p.crateEquipment.head,'');assert.equal(store.crateRun(p.id,v.id).forfeited,true);
  sim.disconnect(v.id,p.id);sim.join(v.id,account);assert.equal(p.crateEquipment.head,'');
  assert.ok(store.crateUnlocks(p.id).includes('sunforged_viking_helm'));
});

test('Phoenix is available while downed, preserves belongings, blocks hits and breaks protection on an accepted attack',async t=>{
  const {sim,store,village:v,player:p} = await fixture(t,{ember:true,loadout:{kit:'tradesmans_kit'}});
  p.inventory.iron=7;p.wallet=135;p.hunger=37;p.durability.sword=20;
  sim.hurtPlayer(v,p,1000);const pack=structuredClone(p.inventory),tools=structuredClone(p.durability);
  sim.action(v.id,p.id,{kind:'phoenix_revive'});
  assert.equal(p.hp,40);assert.equal(p.downed,false);assert.equal(p.wallet,135);assert.equal(p.hunger,37);
  assert.deepEqual(p.inventory,pack);assert.deepEqual(p.durability,tools);assert.equal(store.crateCharges(p.id).total,0);
  sim.hurtPlayer(v,p,1000);assert.equal(p.hp,40,'protection prevents immediate downing');
  assert.throws(()=>sim.action(v.id,p.id,{kind:'phoenix_revive'}),/only while downed/);
  assert.throws(()=>sim.action(v.id,p.id,{kind:'attack'}),/Wait/,'tool cooldown still controls combat');
  v.clock+=.6;p.tool='sword';sim.action(v.id,p.id,{kind:'attack'});assert.equal(p.phoenixProtectedUntil,0);
  sim.hurtPlayer(v,p,1000);assert.equal(p.downed,true);
  assert.throws(()=>sim.action(v.id,p.id,{kind:'phoenix_revive'}),/No Phoenix/);
});

test('failed revival and failed first deployment roll back both authoritative player state and SQLite',async t=>{
  const {sim,store,account,village:v,player:p} = await fixture(t,{ember:true,loadout:{kit:'master_expedition_kit'}});
  sim.hurtPlayer(v,p,1000);store.saveVillage(v);const before=structuredClone(p),original=store.saveVillage;
  store.saveVillage=()=>{throw new Error('injected save failure');};
  assert.throws(()=>sim.action(v.id,p.id,{kind:'phoenix_revive'}),/injected/);
  assert.deepEqual(p,before);assert.equal(store.crateCharges(p.id).reserved,1);assert.equal(store.crateRun(p.id,v.id).phoenixStatus,'reserved');
  store.saveVillage=original;v.status='fallen';store.saveVillage(v);
  const next=sim.create('Rollback Expedition',account),nextVillage=sim.villages.get(next.id);
  store.saveVillage=()=>{throw new Error('injected join failure');};
  assert.throws(()=>sim.join(next.id,account),/injected/);assert.equal(nextVillage.players[p.id],undefined);assert.equal(store.crateRun(p.id,next.id),null);
  store.saveVillage=original;const nextPlayer=sim.join(next.id,account);
  assert.equal(nextPlayer.inventory.best_food,2);assert.equal(nextPlayer.durability.pickaxe,200);assert.equal(store.crateCharges(p.id).reserved,1);
});

test('buckle acquisition in the live simulation persists actual tool maximum without refilling on rejoin',async t=>{
  const {sim,store,account,village:v,player:p,action} = await fixture(t,{loadout:{utility:'miners_buckle'}});
  Object.assign(p,buildingEntrance(BUILDINGS.find(b=>b.id==='tools')));
  action({kind:'buyTool',tool:'pickaxe'});assert.equal(p.durability.pickaxe,110);assert.equal(p.maxDurability.pickaxe,110);
  p.durability.pickaxe=77;sim.disconnect(v.id,p.id);
  const restored=new Simulation(store),again=restored.join(v.id,account);
  assert.equal(again.durability.pickaxe,77);assert.equal(again.maxDurability.pickaxe,110);
});
