import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CRATE_PRICES, CRATE_POOLS, CRATE_UPGRADES, crateRewardTier, crateRewardOdds } from '../shared/crates.js';
import { Store } from '../server/store.js';
import { Simulation } from '../server/simulation.js';
import { crateAccountAction, crateSnapshot } from '../server/crates.js';
import { activateEmberWard, emberWardStatus, crateEnemyDamage, ensureCrateEffects, crateRespawnEffects } from '../server/crate-effects.js';
import { carryCapacity, inventoryWeight } from '../shared/content.js';

const resident = (id, x = 0, extra = {}) => ({ id, x, z:0, hp:100, maxHp:100, downed:false, online:true, role:'villager', crateEquipment:{ utility:'heart_of_emberwatch' }, ...extra });
const village = players => ({ id:'ember-watch', clock:100, day:3, phase:'night', status:'active', players:Object.fromEntries(players.map(p => [p.id,p])) });

test('every rarity roll has the exact one-step distribution and only actual Legendary crates reach Godly', () => {
  for (const tier of Object.keys(CRATE_PRICES)) {
    const counts = {};
    for (let roll = 0; roll < 10000; roll++) { const reward = crateRewardTier(tier,roll); counts[reward] = (counts[reward] || 0) + 1; }
    assert.deepEqual(counts, { [CRATE_UPGRADES[tier].tier]:CRATE_UPGRADES[tier].percent*100, [tier]:10000-CRATE_UPGRADES[tier].percent*100 });
    const odds = crateRewardOdds(tier);
    assert.ok(Math.abs(odds.reduce((n,row) => n + row.percent,0) - 100) < 1e-8);
    assert.equal(odds.some(row => row.itemId === 'heart_of_emberwatch'), tier === 'legendary');
  }
  for (const roll of [-1,10000,.5,NaN,Infinity,'0']) assert.throws(() => crateRewardTier('basic',roll), /rarity/);
  for (const tier of ['godly','__proto__','constructor','']) assert.throws(() => crateRewardTier(tier,0), /rarity/);
});

async function stored(t) {
  const dir=await mkdtemp(join(tmpdir(),'ember-expansion-')), store=new Store(dir);
  t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
  const session=await store.authenticate('register','Ward Collector','crate-expansion-password'), account=store.account(session.playerId);
  store.bank(account.id,1000000);store.crateCredit(account.id,50000);
  return {dir,store,account};
}

test('upgraded rewards save one receipt, duplicate refunds use purchased tier and recovery never rerolls',async t=>{
  const {store,account,dir}=await stored(t);
  for(const tier of Object.keys(CRATE_PRICES)) {
    const open=(currency='bank')=>crateAccountAction(store,account.id,{kind:'crate_open',tier,currency,requestId:randomUUID()},{chooseRarity:()=>0,chooseIndex:()=>0}).result;
    const first=open(),second=open(),credits=open('credits');
    assert.equal(first.rewardTier,CRATE_UPGRADES[tier].tier);assert.equal(first.tier,tier);assert.equal(first.itemId,CRATE_POOLS[first.rewardTier][0]);
    assert.equal(second.refund.amount,CRATE_PRICES[tier].bank*.7);assert.equal(credits.refund.amount,CRATE_PRICES[tier].credits*.7);
    const reopened=new Store(dir);
    try {
      const replay=crateAccountAction(reopened,account.id,{kind:'crate_open',requestId:first.requestId,tier:'godly',currency:'forged'},{chooseRarity(){throw new Error('Rerolled');},chooseIndex(){throw new Error('Rerolled');}}).result;
      assert.deepEqual(replay,first);
    } finally {reopened.close();}
  }
  assert.throws(()=>crateAccountAction(store,account.id,{kind:'crate_open',tier:'godly',currency:'bank',requestId:randomUUID()}),/tier/);
});

test('rarity or persistence failures roll back price, account unlock and earned grant together',async t=>{
  const {store,account}=await stored(t), before=store.account(account.id).bank;
  const action={kind:'crate_open',tier:'legendary',currency:'bank',requestId:randomUUID()};
  assert.throws(()=>crateAccountAction(store,account.id,action,{chooseRarity:()=>10000}),/rarity/);
  assert.equal(store.account(account.id).bank,before);
  const save=store.saveCrateOpening;store.saveCrateOpening=()=>{throw new Error('Disk failure');};
  assert.throws(()=>crateAccountAction(store,account.id,action,{chooseRarity:()=>0,chooseIndex:()=>0}),/Disk failure/);
  store.saveCrateOpening=save;
  assert.equal(store.account(account.id).bank,before);assert.ok(!store.crateUnlocks(account.id).includes('heart_of_emberwatch'));
  for(let i=1;i<=10;i++)store.recordSurvivedNight(account.id,'earned-watch',i);
  const grants=crateAccountAction(store,account.id,{kind:'crate_loadout',loadout:{}}).crates.earnedCrates;
  const earned=crateAccountAction(store,account.id,{kind:'crate_open',grantId:grants[0].id,requestId:randomUUID()},{chooseRarity:()=>0,chooseIndex:()=>0});
  assert.equal(earned.result.tier,'basic');assert.equal(earned.result.rewardTier,'rare');assert.equal(earned.result.paid,0);assert.equal(store.account(account.id).bank,before);
});

test('Ember Ward shields living nearby allies once without healing, buildings or chained refills',()=>{
  const wearer=resident('wearer'),near=resident('near',8,{hp:40,crateEquipment:{}}),far=resident('far',8.01),dead=resident('dead',2,{hp:0,downed:true}),offline=resident('offline',1,{online:false});
  const v=village([wearer,near,far,dead,offline]);v.keep={hp:70};
  assert.equal(activateEmberWard(v,wearer),2);assert.equal(near.hp,40);assert.equal(v.keep.hp,70);assert.equal(dead.hp,0);assert.equal(far.emberWard,undefined);assert.equal(offline.emberWard,undefined);
  assert.equal(crateEnemyDamage(v,near,70),20);assert.equal(near.emberWard,0);assert.equal(near.emberWardUntil,110);
  v.clock=102;far.x=9;
  assert.equal(activateEmberWard(v,far),1,'near is in range but its depleted ward cannot refill');
  assert.equal(near.emberWard,0);assert.equal(near.emberWardUntil,110);
  assert.throws(()=>activateEmberWard(v,wearer),/already protected/);
  assert.throws(()=>activateEmberWard(v,near),/Equip/);
  v.clock=110;ensureCrateEffects(v,wearer);assert.equal(wearer.emberWard,0);assert.equal(emberWardStatus(v,wearer).used,true);
});

test('Ember Ward respects armor, never triggers automatically and preserves spent nights through role and gear changes',()=>{
  const wearer=resident('wearer');const v=village([wearer]);
  assert.equal(crateEnemyDamage(v,wearer,150),150,'equipping the Heart alone does not protect a lethal hit');
  activateEmberWard(v,wearer);wearer.crateEquipment.head='padded_cap';
  assert.equal(crateEnemyDamage(v,wearer,100),48);assert.equal(wearer.emberWard,0);
  wearer.crateEquipment={};wearer.role='wizard';v.clock=120;
  const restored=JSON.parse(JSON.stringify(wearer));restored.crateEquipment.utility='heart_of_emberwatch';v.players.wearer=restored;
  assert.throws(()=>activateEmberWard(v,restored),/already protected/);
  crateRespawnEffects(restored);restored.crateEquipment.utility='heart_of_emberwatch';assert.throws(()=>activateEmberWard(v,restored),/already protected/);
  v.phase='day';v.day++;assert.throws(()=>activateEmberWard(v,restored),/night/);
  v.phase='night';assert.equal(activateEmberWard(v,restored),1);
  v.day--;v.clock+=11;assert.throws(()=>activateEmberWard(v,restored),/already protected/,'day rollback cannot grant another use');
});

test('Heart deployment, activation and failure recovery use existing durable village transaction',async t=>{
  const {store,account}=await stored(t);
  crateAccountAction(store,account.id,{kind:'crate_open',tier:'legendary',currency:'bank',requestId:randomUUID()},{chooseRarity:()=>0,chooseIndex:()=>0});
  crateAccountAction(store,account.id,{kind:'crate_loadout',loadout:{utility:'heart_of_emberwatch'}});
  const sim=new Simulation(store),{id}=sim.create('Heart watch',account),v=sim.villages.get(id),p=sim.join(id,account);
  v.phase='night';v.day=3;v.clock=100;
  const saved=store.saveVillage;store.saveVillage=()=>{throw new Error('Ward disk failure');};
  assert.throws(()=>sim.action(id,p.id,{kind:'ember_ward'}),/Ward disk failure/);store.saveVillage=saved;
  assert.equal(p.emberWardUsedDay??0,0);assert.equal(p.emberWard??0,0);
  sim.action(id,p.id,{kind:'ember_ward'});assert.equal(p.emberWard,50);
  sim.disconnect(id,p.id);sim.join(id,store.account(p.id));
  v.clock+=11;assert.equal(crateSnapshot(sim,v,p.id).emberWardStatus.used,true);
  assert.throws(()=>sim.action(id,p.id,{kind:'ember_ward'}),/already protected/);
  const reloaded=new Simulation(store),restored=reloaded.villages.get(id);reloaded.join(id,store.account(p.id));
  assert.equal(restored.players[p.id].emberWardUsedDay,3);
});

test('new hauling and crafting accessories apply real capacity and material-weight effects',()=>{
  const p=resident('carrier',0,{backpackTier:0,inventory:{wheat:10,iron:10,sulfur:10,gunpowder:10}});
  p.crateEquipment.utility='harvest_satchel';assert.equal(inventoryWeight({...p,inventory:{wheat:10}}),8);
  p.crateEquipment.utility='tinkers_pouch';assert.equal(inventoryWeight({...p,inventory:{iron:10,sulfur:10,gunpowder:10}}),39);
  p.crateEquipment.utility='arcanists_seal';assert.equal(carryCapacity(p),175);assert.equal(inventoryWeight({...p,inventory:{sulfur:10,gunpowder:10}}),11);
  p.crateEquipment.utility='caravan_harness';assert.equal(carryCapacity(p),230);
});
