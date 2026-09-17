import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { Simulation } from '../server/simulation.js';
import { careAction, careTick, careSnapshot, ensureCare } from '../server/care-defense.js';
import { towerStats, DEFENSE_UPGRADES } from '../shared/defense.js';
import { barracksCapacity } from '../shared/troops.js';
import { PLOTS } from '../shared/world.js';
import { plotEntrance } from '../shared/access.js';

function towerFixture(level=1) {
  const site=PLOTS.find(p=>p.id==='outpost-1'),owner={id:'wizard',name:'Wizard',online:true,role:'wizard',hp:100,maxHp:100,wallet:1000,...plotEntrance(site,'wizard_tower')};
  const plot={id:site.id,ownerId:owner.id,building:'wizard_tower',hp:450,maxHp:450,level,storage:{sulfur:1,stone:100,iron:100,timber:100,coal:10}};
  const village={id:'wizard-defense',status:'active',clock:100,day:1,phase:'day',players:{wizard:owner},plots:[plot],zombies:[],guards:[],gate:{hp:1200},treasury:1000,stock:{timber:100,stone:100}};
  const hits=[],sim={store:{saveVillage(){}},hitZombie(v,z,damage,credit){hits.push({id:z.id,damage,ownerId:credit?.id});z.hp=Math.max(0,z.hp-damage);},clearAttack:()=>true};
  const zombie=(id,dx,dz=0)=>({id,x:site.x+dx,z:site.z+dz,hp:500,maxHp:500});
  return {site,owner,plot,village,hits,sim,zombie};
}

test('Wizard fire tower consumes exactly one sulfur, deals 34 damage and respects ammunition and cooldown',()=>{
  const f=towerFixture();f.village.zombies=[f.zombie('nearest',8),f.zombie('next',10)];
  const before={...f.plot.storage};careTick(f.sim,f.village,.1);
  assert.deepEqual(f.hits,[{id:'nearest',damage:34,ownerId:'wizard'}]);
  assert.deepEqual(f.plot.storage,{...before,sulfur:0});assert.equal(f.plot.shotCooldown,3);assert.equal(f.plot.lastShot.element,'fire');assert.equal(f.plot.lastShot.segments.length,1);
  f.village.clock+=4;careTick(f.sim,f.village,4);assert.equal(f.hits.length,1);
  f.plot.storage.sulfur=2;careTick(f.sim,f.village,0);assert.equal(f.hits.length,2);assert.equal(f.plot.storage.sulfur,1);
  f.village.clock+=2.99;careTick(f.sim,f.village,2.99);assert.equal(f.hits.length,2);
  f.village.clock+=.02;careTick(f.sim,f.village,.02);assert.equal(f.hits.length,3);assert.equal(f.plot.storage.sulfur,0);
  assert.equal(careSnapshot(f.village,'wizard',f.sim).defenseStatus[0].status,'empty');
});

test('paid Wizard upgrade becomes 42-damage lightning with at most three diminishing hits for one sulfur',()=>{
  const f=towerFixture(),cost=DEFENSE_UPGRADES.wizard_tower;f.plot.storage.sulfur=41;
  careAction(f.sim,f.village,f.owner,{kind:'upgradeDefense',plotId:f.plot.id});
  assert.equal(f.owner.wallet,1000-cost.gold);assert.equal(f.village.treasury,1000+cost.gold);
  assert.equal(f.plot.hp,675);assert.equal(f.plot.maxHp,675);assert.equal(f.plot.level,2);assert.equal(f.plot.storage.sulfur,1);
  assert.equal(towerStats(f.plot).damage,42);
  f.village.zombies=[f.zombie('one',8),f.zombie('two',12),f.zombie('three',16),f.zombie('four',20)];
  f.owner.online=false;careTick(f.sim,f.village,.1);
  assert.deepEqual(f.hits.map(hit=>hit.id),['one','two','three']);
  f.hits.forEach((hit,index)=>assert.ok(Math.abs(hit.damage-42*.65**index)<1e-9));
  assert.equal(f.village.zombies[3].hp,500);assert.equal(f.plot.storage.sulfur,0);assert.equal(f.plot.lastShot.element,'lightning');assert.equal(f.plot.lastShot.segments.length,3);
});

test('Wizard chains skip dead targets, respect sight along each hop and do not fire through blocked approaches',()=>{
  const f=towerFixture(2),dead=f.zombie('dead',7);dead.hp=0;
  f.village.zombies=[dead,f.zombie('one',8),f.zombie('blocked',10),f.zombie('two',12),f.zombie('too-far',18)];
  f.sim.clearAttack=(v,from,to)=>to.id!=='blocked';
  careTick(f.sim,f.village,.1);assert.deepEqual(f.hits.map(h=>h.id),['one','two']);
  f.plot.storage.sulfur=1;f.plot.shotCooldown=0;f.sim.clearAttack=()=>false;
  careTick(f.sim,f.village,1);assert.equal(f.hits.length,2);assert.equal(f.plot.storage.sulfur,1);
  f.plot.hp=0;f.sim.clearAttack=()=>true;careTick(f.sim,f.village,1);assert.equal(f.hits.length,2);assert.equal(f.plot.storage.sulfur,1);
});

async function fixture(t) {
  const dir=await mkdtemp(join(tmpdir(),'emberwatch-skill-defense-')),store=new Store(dir);
  t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
  const accounts=[];for(const name of ['Skill Captain','Skill Wizard','Skill Healer']) {const session=await store.authenticate('register',name,'skill-defense-password');accounts.push(store.account(session.playerId));}
  const sim=new Simulation(store),{id}=sim.create('Skilled defense',accounts[0]),v=sim.villages.get(id);
  const captain=sim.join(id,accounts[0],'guard'),wizard=sim.join(id,accounts[1],'wizard'),priest=sim.join(id,accounts[2],'priest');
  for(const p of [captain,wizard,priest])Object.assign(p,{wallet:10000,x:0,z:0});
  v.guards=[];v.zombies=[];v.stock.timber=100;v.stock.stone=100;v.phase='day';v.phaseRemaining=10000;
  const build=(id,building,owner,level=1)=>{const plot=v.plots.find(p=>p.id===id);Object.assign(plot,{ownerId:owner.id,building,level,hp:600,maxHp:600,storage:{timber:1000,stone:1000,iron:1000,wheat:1000,sulfur:100,arrows:100,musket_ammo:100}});return plot;};
  const approach=(p,plot)=>Object.assign(p,plotEntrance(PLOTS.find(site=>site.id===plot.id),plot.building));
  const action=(p,a)=>{v.clock+=.7;return sim.action(id,p.id,a);};
  return {dir,store,sim,v,captain,wizard,priest,accounts,build,approach,action};
}

test('learned Guard command capacity appears in the same action snapshot, including upgraded and offline-owned barracks',async t=>{
  const f=await fixture(t),barracks=f.build('west-1','barracks',f.captain),academy=f.build('west-2','arcane_academy',f.wizard);
  f.captain.skills.guard_vitality=1;f.approach(f.captain,academy);
  for(const rank of [1,2]) {
    f.action(f.captain,{kind:'academy_learn',plotId:academy.id,skill:'guard_command',rank});
    const visible=f.sim.snapshot(f.v,f.wizard.id).plots.find(p=>p.id===barracks.id);
    assert.equal(barracksCapacity(visible),3+rank,'first snapshot after learning must match the recruit limit');
  }
  barracks.level=2;f.sim.disconnect(f.v.id,f.captain.id);
  assert.equal(barracksCapacity(f.sim.snapshot(f.v,f.wizard.id).plots.find(p=>p.id===barracks.id)),8);
});

test('learned barracks capacity enforces five and eight paid slots without charging a rejected recruit',async t=>{
  const f=await fixture(t),plot=f.build('west-1','barracks',f.captain);f.captain.skills.guard_command=2;f.approach(f.captain,plot);
  for(let i=0;i<5;i++)f.action(f.captain,{kind:'recruitGuard',plotId:plot.id,unitType:['sword','archer','musketeer'][i%3]});
  const wallet=f.captain.wallet,stock=structuredClone(plot.storage);
  assert.throws(()=>f.action(f.captain,{kind:'recruitGuard',plotId:plot.id}),/5 recruited/);assert.equal(f.captain.wallet,wallet);assert.deepEqual(plot.storage,stock);
  f.action(f.captain,{kind:'upgradeDefense',plotId:plot.id});
  for(let i=0;i<3;i++)f.action(f.captain,{kind:'recruitGuard',plotId:plot.id,unitType:'archer'});
  assert.equal(f.v.guards.length,8);assert.equal(new Set(f.v.guards.map(g=>g.slot)).size,8);
  assert.throws(()=>f.action(f.captain,{kind:'recruitGuard',plotId:plot.id}),/8 recruited/);
});

test('Priest lessons increase real healed health and shorten an authoritative field revival to four seconds',async t=>{
  const f=await fixture(t);Object.assign(f.priest.skills,{priest_blessing:2,priest_revive:2});
  Object.assign(f.captain,{x:1,z:0,hp:40});
  f.action(f.priest,{kind:'heal',targetId:f.captain.id});f.sim.tick(2.01);assert.equal(f.captain.hp,79);assert.equal(f.priest.healingProgress,39);
  Object.assign(f.captain,{hp:0,downed:true,respawnAvailable:false});
  const notice=f.action(f.priest,{kind:'heal',targetId:f.captain.id});assert.equal(f.priest.healing.until-f.v.clock,4);assert.match(notice,/4 seconds/);
  f.sim.tick(3.99);assert.equal(f.captain.downed,true);f.sim.tick(.02);assert.equal(f.captain.downed,false);assert.equal(f.captain.hp,58.5);assert.equal(f.priest.jobBonus,5);
  f.captain.hp=99;f.action(f.priest,{kind:'heal',targetId:f.captain.id});f.sim.tick(2.01);assert.equal(f.captain.hp,100);assert.equal(f.priest.healingProgress,40);
});

test('Tinker repair lessons increase gate and ruin work by 30 percent while consuming one ordinary repair payment',async t=>{
  const f=await fixture(t);f.action(f.wizard,{kind:'role_change',role:'tinker'});const p=f.wizard;
  p.skills.tinker_maintenance=2;p.tool='hammer';p.tiers.hammer='iron';p.durability.hammer=100;
  Object.assign(p,{x:0,z:16});f.v.gate.hp=100;const timber=f.v.stock.timber,stone=f.v.stock.stone;
  f.action(p,{kind:'repair',targetId:'gate'});assert.equal(f.v.gate.hp,204);assert.equal(f.v.stock.timber,timber-1);assert.equal(f.v.stock.stone,stone);assert.equal(p.durability.hammer,99);
  const ruin=f.build('west-1','archer_tower',f.captain);ruin.hp=0;f.approach(p,ruin);const retained={level:ruin.level,storage:structuredClone(ruin.storage),ownerId:ruin.ownerId};
  f.action(p,{kind:'repairPlot',plotId:ruin.id});assert.equal(ruin.hp,0);assert.equal(ruin.rebuildProgress,104);assert.equal(p.durability.hammer,98);
  f.action(p,{kind:'repairPlot',plotId:ruin.id});assert.equal(ruin.hp,0);assert.equal(ruin.rebuildProgress,208);
  f.action(p,{kind:'repairPlot',plotId:ruin.id});assert.equal(ruin.hp,312);assert.equal(ruin.rebuildProgress,0);assert.deepEqual({level:ruin.level,storage:ruin.storage,ownerId:ruin.ownerId},retained);
  const oldHp=ruin.hp;f.action(p,{kind:'repairPlot',plotId:ruin.id});assert.equal(ruin.hp,oldHp+104);
});

test('Wizard tower passes real collision checks and exposes actual firing state to other residents',async t=>{
  const f=await fixture(t),plot=f.build('outpost-1','wizard_tower',f.wizard,2),site=PLOTS.find(p=>p.id===plot.id);plot.storage.sulfur=1;
  f.v.zombies=[{id:'front',x:site.x,z:site.z+8,hp:100,maxHp:100},{id:'next',x:site.x,z:site.z+12,hp:100,maxHp:100},{id:'third',x:site.x,z:site.z+16,hp:100,maxHp:100}];
  careTick(f.sim,f.v,.1);assert.equal(plot.storage.sulfur,0);assert.equal(f.v.zombies[0].hp,58);assert.ok(Math.abs(f.v.zombies[1].hp-72.7)<1e-8);assert.ok(Math.abs(f.v.zombies[2].hp-82.255)<1e-8);
  const snapshot=f.sim.snapshot(f.v,f.captain.id);assert.equal(snapshot.plots.find(p=>p.id===plot.id).lastShot.element,'lightning');assert.equal(snapshot.defenseStatus.find(p=>p.plotId===plot.id).shotsRemaining,0);
});
