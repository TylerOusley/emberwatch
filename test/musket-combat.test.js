import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Simulation} from '../server/simulation.js';
import {Store} from '../server/store.js';
import {createEnemy} from '../server/enemies.js';
import {PLOTS,plotSolid} from '../shared/world.js';
import {MUSKET} from '../shared/firearms.js';

function fixture(role='villager',provided={}){
  const saved=new Map(),account=provided.account??{id:'marksman',name:'Marksman',bank:0};
  const store=provided.store??{loadVillages:()=>[...saved.values()].map(v=>structuredClone(v)),saveVillage:v=>saved.set(v.id,structuredClone(v)),transaction:fn=>fn(),account:()=>account,initialWallet:()=>10};
  const sim=new Simulation(store),{id}=sim.create('Musket Defense',account),player=sim.join(id,account,role),village=sim.villages.get(id);
  village.clock=10;village.guards=[];village.phaseRemaining=10000;
  Object.assign(player,{x:0,z:40,yaw:0,tool:''});
  Object.assign(player.inventory,{musket:1,musket_ammo:6,arrows:4,bow:1});
  Object.assign(player.durability,{musket:100,bow:100});
  sim.input(id,player.id,{x:0,z:0,yaw:0,tool:'musket'});
  const fire=()=>sim.action(id,player.id,{kind:'attack'});
  return {sim,store,account,player,village,fire};
}
function enemy(village,x=0,z=50,kind='shambler'){
  const zombie=createEnemy(village,kind,{x,z,roadIndex:3});
  Object.assign(zombie,{hp:500,maxHp:500,emergeUntil:0,spawnAt:0,anim:'walk'});village.zombies.push(zombie);return zombie;
}

test('an actual musket attack damages only the nearest visible enemy and spends one shot and durability',()=>{
  const f=fixture(),closest=enemy(f.village),farther=enemy(f.village,.5,52);
  assert.equal(f.player.tool,'musket','normal movement input can equip the crafted weapon');
  assert.match(f.fire(),/Musket shot landed/);
  assert.equal(closest.hp,436);assert.equal(farther.hp,500);
  assert.equal(f.player.inventory.musket_ammo,5);assert.equal(f.player.inventory.arrows,4);
  assert.equal(f.player.durability.musket,99);assert.equal(f.player.durability.bow,100);
  assert.equal(f.player.musketReadyAt,11.6);
  const shot=f.sim.snapshot(f.village,f.player.id).players[0].lastShot;
  assert.equal(shot.kind,'musket');assert.equal(shot.at,10);assert.deepEqual(shot.from,{x:0,z:40});assert.deepEqual(shot.to,{x:closest.x,z:closest.z});
  f.village.clock+=.6;f.player.tool='bow';f.fire();
  assert.equal(closest.hp,414,'existing bow remains a 22-damage alternative');
  assert.equal(f.player.inventory.musket_ammo,5);assert.equal(f.player.inventory.arrows,3);
});

test('musket damage retains the guard combat bonus and enemy armor reduction',()=>{
  const f=fixture('guard'),target=enemy(f.village,0,50,'armored');
  f.fire();
  const expected=64*1.2*(1-target.armor);
  assert.ok(Math.abs(target.hp-(500-expected))<1e-9);
  assert.ok(Math.abs(target.contributors[f.player.id]-expected)<1e-9,'guard credit records actual damage after armor');
});

test('reload cannot be bypassed by another action or equipping again, and invalid shots mutate nothing',()=>{
  const f=fixture(),target=enemy(f.village);f.fire();
  const firstId=f.player.lastShot.id;
  for(const clock of [10.2,10.6]){
    f.village.clock=clock;
    f.sim.input(f.village.id,f.player.id,{x:0,z:0,yaw:0,tool:'bow'});
    f.sim.input(f.village.id,f.player.id,{x:0,z:0,yaw:0,tool:'musket'});
    const before=structuredClone(f.village);
    assert.throws(f.fire,clock===10.2?/Wait for your next action/:/still reloading/);
    assert.deepEqual(f.village,before);
  }
  f.player.tool='bow';f.fire();assert.equal(target.hp,414,'another weapon can act while the musket reloads');
  f.player.tool='musket';
  for(const clock of [11.2,11.599]){
    f.village.clock=clock;const before=structuredClone(f.village);
    assert.throws(f.fire,/still reloading/);assert.deepEqual(f.village,before);
  }
  f.village.clock=11.6;f.fire();
  assert.equal(target.hp,350);assert.equal(f.player.inventory.musket_ammo,4);assert.notEqual(f.player.lastShot.id,firstId);
  f.village.clock=14;
  for(const [change,error]of [[{ammo:0,durability:98},/need musket shot/],[{ammo:4,durability:0},/Buy a musket/]]){
    f.player.inventory.musket_ammo=change.ammo;f.player.durability.musket=change.durability;
    const before=structuredClone(f.village);assert.throws(f.fire,error);assert.deepEqual(f.village,before);
  }
});

test('musket range, facing, buildings, owned plots and closed gates constrain actual damage',()=>{
  const plotSite=PLOTS.find(plot=>!plot.outside),solid=plotSolid(plotSite,'house');
  const cases=[
    {name:'exact maximum range',from:[0,40,0],to:[0,40+MUSKET.range],hit:true},
    {name:'beyond maximum range',from:[0,40,0],to:[0,40+MUSKET.range+.001],hit:false},
    {name:'enemy behind player',from:[0,40,0],to:[0,30],hit:false},
    {name:'communal shop blocks line of sight',from:[-17,14,Math.PI],to:[-17,2],hit:false},
    {name:'owned house blocks line of sight',from:[solid.x,solid.z+solid.d/2+1,Math.PI],to:[solid.x,solid.z-solid.d/2-1],hit:false,plot:true},
    {name:'intact gate blocks a shot',from:[0,14,0],to:[0,22],hit:false},
    {name:'breached gate admits a shot',from:[0,14,0],to:[0,22],hit:true,breach:true}
  ];
  for(const scenario of cases){
    const f=fixture();Object.assign(f.player,{x:scenario.from[0],z:scenario.from[1],yaw:scenario.from[2]});
    if(scenario.breach)f.village.gate.hp=0;
    if(scenario.plot)Object.assign(f.village.plots.find(plot=>plot.id===plotSite.id),{ownerId:f.player.id,building:'house',level:1,hp:400,maxHp:400});
    const target=enemy(f.village,...scenario.to);f.fire();
    assert.equal(target.hp,scenario.hit?436:500,scenario.name);
    assert.equal(f.player.inventory.musket_ammo,5,`${scenario.name}: firing still spends ammunition`);
    assert.equal(f.player.durability.musket,99,`${scenario.name}: firing still wears the weapon`);
  }
});

test('SQLite recovery preserves spent ammunition, damage and reload time; failed commits restore all shot state',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'emberwatch-musket-')),store=new Store(directory);
  t.after(async()=>{store.close();await rm(directory,{recursive:true,force:true});});
  const session=await store.authenticate('register','Musket Keeper','musket-test-password'),account=store.account(session.playerId);
  const f=fixture('villager',{store,account}),target=enemy(f.village);f.fire();
  const shot=structuredClone(f.player.lastShot),saved=store.loadVillages().find(v=>v.id===f.village.id);
  assert.equal(saved.players[account.id].inventory.musket_ammo,5);assert.equal(saved.zombies[0].hp,436);
  const recovered=new Simulation(store),v=recovered.villages.get(f.village.id);
  assert.equal(v.players[account.id].online,false);
  const player=recovered.join(v.id,account),fire=()=>recovered.action(v.id,account.id,{kind:'attack'});
  assert.equal(player.tool,'musket');assert.equal(player.durability.musket,99);assert.equal(player.musketReadyAt,11.6);
  assert.deepEqual(player.lastShot,shot);assert.equal(v.zombies.find(z=>z.id===target.id).hp,436);
  v.clock=10.6;assert.throws(fire,/still reloading/);assert.equal(player.inventory.musket_ammo,5);
  v.clock=11.6;store.saveVillage(v);
  const before=structuredClone(v),savedBefore=store.loadVillages(),save=store.saveVillage;
  store.saveVillage=()=>{throw new Error('injected musket commit failure');};
  try{assert.throws(fire,/injected musket commit failure/);}finally{store.saveVillage=save;}
  assert.deepEqual(v,before);assert.deepEqual(store.loadVillages(),savedBefore,'failed shot never partially persists ammo or damage');
  fire();assert.equal(player.inventory.musket_ammo,4);assert.equal(player.durability.musket,98);
  assert.equal(v.zombies.find(z=>z.id===target.id).hp,372);
  const final=store.loadVillages().find(row=>row.id===v.id);assert.equal(final.players[account.id].inventory.musket_ammo,4);assert.equal(final.zombies[0].hp,372);
});
