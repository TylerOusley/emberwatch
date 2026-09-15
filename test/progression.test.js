import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { Simulation } from '../server/simulation.js';
import { progressionDawn, progressionSnapshot } from '../server/progression.js';
import { BUILDINGS,PLOTS,RESOURCES } from '../shared/world.js';
import { buildingEntrance,plotEntrance } from '../shared/access.js';
async function fixture(t) {
  const directory=await mkdtemp(join(tmpdir(),'emberwatch-progression-'));const store=new Store(directory),sim=new Simulation(store,{daySeconds:80,nightSeconds:40});
  t.after(async()=>{store.close();await rm(directory,{recursive:true,force:true});});
  async function register(name){const session=await store.authenticate('register',name,'watch-test-password');return store.account(session.playerId);}
  const account=await register('First Watch'),second=await register('Late Watch');const {id}=sim.create('Honor Village',account),v=sim.villages.get(id),p=sim.join(id,account);
  const act=(action,player=p)=>{v.clock+=.7;return sim.action(v.id,player.id,action);};
  const near=(id,player=p)=>Object.assign(player,buildingEntrance(BUILDINGS.find(b=>b.id===id)));
  const advance=seconds=>{for(let i=0;i<seconds*10;i++)sim.tick(.1);};
  return {directory,store,sim,account,second,v,p,act,near,advance};
}
test('nights require observed online living participation; late joining and downed time do not grant honors',async t=>{
  const f=await fixture(t),{sim,v,p,store}=f;sim.startNight(v);f.advance(25);
  const late=sim.join(v.id,f.second);f.advance(15.1);
  assert.equal(v.phase,'day');assert.equal(store.progression(p.id).nights,1);assert.equal(store.progression(late.id).nights,0);
  assert.deepEqual(store.progression(p.id).unlocked,['first_watch']);
  const watch=v.progression.watch;watch.awarded=false;progressionDawn(sim,v,1);assert.equal(store.progression(p.id).nights,1,'SQLite ledger prevents duplicate dawn credit');
  sim.startNight(v);p.downed=true;p.hp=0;f.advance(40.1);assert.equal(store.progression(p.id).nights,1,'downed spectators do not accrue participation');
  assert.equal(store.progression(late.id).nights,1);
});
test('recovery, fallen village and a new run retain personal honors and selected appearance without credit for joining a late village',async t=>{
  const f=await fixture(t),{sim,v,p,store}=f;sim.startNight(v);f.advance(40.1);f.act({kind:'cosmetic_player',palette:'ember',crest:'flame'});
  sim.disconnect(v.id,p.id);const recovered=new Simulation(store,{nightSeconds:40});const again=recovered.join(v.id,f.account);
  assert.deepEqual(again.accountProgression.selected,{palette:'ember',crest:'flame'});assert.equal(again.accountProgression.nights,1);
  recovered.villages.get(v.id).status='fallen';const next=recovered.create('New Honor Village',f.account),nextVillage=recovered.villages.get(next.id);nextVillage.day=99;
  const newcomer=recovered.join(next.id,f.account);assert.equal(newcomer.accountProgression.nights,1);assert.equal(recovered.snapshot(nextVillage,p.id).cosmetics.players[p.id].crest,'flame');
});
test('account progression migration preserves existing money and dismisses guide for established accounts',async t=>{
  const f=await fixture(t),{store,p}=f;store.bank(p.id,71);store.issueCredit(p.id,23);
  store.db.prepare('DELETE FROM account_progression WHERE account_id=?').run(p.id);
  assert.equal(store.progression(p.id).guide.dismissed,true);assert.equal(store.progression(f.second.id).guide.dismissed,false);
  const other=new Store(f.directory);try{assert.equal(other.account(p.id).bank,71);assert.equal(other.account(p.id).debt,23);assert.equal(other.progression(p.id).nights,0);}finally{other.close();}
});
test('cosmetic choices validate unlocks, ownership, founder privilege and door access without changing stats',async t=>{
  const f=await fixture(t),{sim,v,p,store}=f;const other=sim.join(v.id,f.second);
  assert.throws(()=>f.act({kind:'cosmetic_player',palette:'royal',crest:'crown'}),/Earn/);
  for(let night=1;night<=5;night++)store.recordSurvivedNight(p.id,v.id,night);
  sim.disconnect(v.id,p.id);sim.join(v.id,f.account);p.wallet=1000;
  const before={hp:p.hp,maxHp:p.maxHp,wallet:p.wallet,inventory:structuredClone(p.inventory),treasury:v.treasury};
  f.act({kind:'cosmetic_player',palette:'azure',crest:'shield'});
  const plot=v.plots[0];Object.assign(plot,{ownerId:p.id,building:'house',hp:500,maxHp:500});
  assert.throws(()=>f.act({kind:'cosmetic_plot',plotId:plot.id,palette:'ember'}),/entrance|front gate/);
  Object.assign(p,plotEntrance(PLOTS.find(site=>site.id===plot.id),plot));f.act({kind:'cosmetic_plot',plotId:plot.id,palette:'ember'});assert.equal(plot.cosmeticPalette,'ember');
  assert.throws(()=>f.act({kind:'cosmetic_plot',plotId:plot.id,palette:'natural'},other),/own/);
  assert.throws(()=>f.act({kind:'cosmetic_banner',palette:'natural',crest:'none'},other),/founder/);
  assert.throws(()=>f.act({kind:'cosmetic_banner',palette:'azure',crest:'shield'}),/entrance/);
  f.near('keep');f.act({kind:'cosmetic_banner',palette:'azure',crest:'shield'});assert.deepEqual(v.progression.banner,{palette:'azure',crest:'shield'});
  assert.throws(()=>f.act({kind:'cosmetic_player',palette:'__proto__',crest:'none'}),/Earn/);
  assert.deepEqual({hp:p.hp,maxHp:p.maxHp,wallet:p.wallet,inventory:p.inventory,treasury:v.treasury},before);
});
test('snapshots expose chosen appearance while another account’s unlock ledger and tutorial remain private',async t=>{
  const f=await fixture(t),{sim,v,p,store}=f;const other=sim.join(v.id,f.second);store.recordSurvivedNight(p.id,v.id,1);sim.disconnect(v.id,p.id);sim.join(v.id,f.account);f.act({kind:'cosmetic_player',palette:'ember',crest:'flame'});
  const snapshot=sim.snapshot(v,other.id);assert.equal(snapshot.progression.nights,0);assert.deepEqual(snapshot.progression.unlocked,[]);assert.deepEqual(snapshot.cosmetics.players[p.id],{palette:'ember',crest:'flame'});
  assert.equal(snapshot.players.find(row=>row.id===p.id).accountProgression,undefined);assert.doesNotMatch(JSON.stringify(snapshot),/watch_achievements|startedAt.*seconds/);
  assert.equal(progressionSnapshot(sim,v,p.id).progression.canChooseBanner,true);
});
test('guide checks successful purchases, harvesting, trade and arrival; clients cannot claim completion',async t=>{
  const f=await fixture(t),{v,p,store}=f;assert.equal(store.progression(p.id).guide.dismissed,false);
  assert.throws(()=>f.act({kind:'buyTool',tool:'pickaxe'}),/Visit/);assert.deepEqual(store.progression(p.id).guide.done,[]);
  f.near('tools');f.act({kind:'buyTool',tool:'pickaxe'});const node=RESOURCES.find(n=>n.type==='stone');Object.assign(p,{x:node.x,z:node.z});f.act({kind:'gather',targetId:node.id});
  f.near('bank');f.act({kind:'sell',resource:'stone',amount:1,minTotal:1});p.wallet=100;f.near('food');f.act({kind:'buyFood',tier:'food'});
  Object.assign(p,{x:0,z:12.1});f.advance(.2);assert.deepEqual(new Set(store.progression(p.id).guide.done),new Set(['tool','gather','sell','food','gate']));
  f.act({kind:'guide_visibility',dismissed:true,done:['forged'],nights:99});assert.equal(store.progression(p.id).nights,0);assert.equal(store.progression(p.id).guide.dismissed,true);
  p.downed=true;f.act({kind:'guide_visibility',dismissed:false});assert.equal(store.progression(p.id).guide.dismissed,false);
});
test('early-clear credit uses half the observed shortened night and rejects last-second joins or a zero-length night',async t=>{
  const f=await fixture(t),{sim,v,p,store}=f;sim.startNight(v);f.advance(8);const late=sim.join(v.id,f.second);f.advance(2);
  progressionDawn(sim,v,1,{earlyClear:true});assert.equal(store.progression(p.id).nights,1);assert.equal(store.progression(late.id).nights,0);
  v.day=2;sim.startNight(v);progressionDawn(sim,v,2,{earlyClear:true});assert.equal(store.progression(p.id).nights,1,'instant force-dawn cannot unlock rewards');
  v.day=3;sim.startNight(v);f.advance(10);progressionDawn(sim,v,3);assert.equal(store.progression(p.id).nights,1,'ordinary dawn still requires half the scheduled night');
});
