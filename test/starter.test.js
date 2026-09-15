import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { Simulation } from '../server/simulation.js';
import { BUILDINGS } from '../shared/world.js';
import { canEquip } from '../shared/equipment.js';
import { carryCapacity } from '../shared/content.js';

async function fixture(t, role = 'villager') {
  const directory = await mkdtemp(join(tmpdir(), 'emberwatch-starter-'));
  const store = new Store(directory), sim = new Simulation(store);
  t.after(async () => { store.close(); await rm(directory, { recursive:true, force:true }); });
  const session = await store.authenticate('register','NewArrival','starter-test-password'), account = store.account(session.playerId);
  const { id } = sim.create('Empty Hands', account), p = sim.join(id, account, role), v = sim.villages.get(id);
  return { store, sim, account, p, v, near(id) { const b = BUILDINGS.find(b=>b.id===id); p.x=b.x-b.w/2-1;p.z=b.z; }, act(action) {v.clock+=.7;return sim.action(id,p.id,action);} };
}
test('new resident starts with exactly one tool price and no equipment; purchase is authoritative', async t => {
  const f = await fixture(t), {p,v,sim} = f;
  assert.equal(p.wallet,10); assert.equal(p.tool,''); assert.equal(p.backpackTier,0);
  assert.ok(Object.values(p.inventory).every(n=>n===0)); assert.ok(Object.values(p.durability).every(n=>n===0));
  sim.input(v.id,p.id,{x:0,z:0,yaw:0,tool:'sword'}); assert.equal(p.tool,'');
  p.tool='sword'; delete p.durability.sword;
  assert.throws(()=>f.act({kind:'attack'}),/broken/); p.tool='';
  f.near('tools'); f.act({kind:'buyTool',tool:'pickaxe'});
  assert.equal(p.wallet,0); assert.equal(p.durability.pickaxe,100); assert.equal(p.tool,'pickaxe');
  assert.throws(()=>f.act({kind:'buyTool',tool:'axe'}),/gold|credit/); assert.equal(p.durability.axe,0);
  assert.equal(canEquip(p,'axe'),false); assert.equal(canEquip(p,'pickaxe'),true); assert.equal(canEquip(p,''),true);
});
test('rejoin and server recovery preserve gear and wallet; each new run grants once', async t => {
  const f=await fixture(t), {p,v,sim,store,account}=f;
  f.near('tools'); f.act({kind:'buyTool',tool:'axe'}); p.durability.axe=71; sim.saveAll();
  sim.disconnect(v.id,p.id); assert.equal(sim.join(v.id,account).wallet,0);
  const recovered=new Simulation(store), again=recovered.join(v.id,account);
  assert.equal(again.wallet,0); assert.equal(again.durability.axe,71);
  assert.equal(store.initialWallet(p.id,v.id),0);
  assert.throws(()=>recovered.create('Extra Grant',account),/active|reserved/);
  recovered.villages.get(v.id).status='fallen';
  const next=recovered.create('Next Watch',account), newcomer=recovered.join(next.id,account);
  assert.equal(newcomer.wallet,10); assert.equal(newcomer.tool,''); assert.equal(store.initialWallet(p.id,next.id),0);
});
test('dawn respawn loses equipment and pack but preserves savings and offers credit-funded recovery', async t => {
  const f=await fixture(t,'priest'), {p,v,sim,store}=f;
  p.wallet=100;p.inventory.wheat=30;p.durability.axe=80;p.backpackTier=3;store.bank(p.id,65);
  sim.hurtPlayer(v,p,500); assert.throws(()=>f.act({kind:'respawn'}),/dawn/);
  sim.dawn(v); f.act({kind:'respawn'});
  assert.equal(p.wallet,75);assert.equal(p.hp,125);assert.equal(p.maxHp,125);assert.equal(p.tool,'');
  assert.equal(p.backpackTier,0);assert.equal(carryCapacity(p),100);assert.equal(store.account(p.id).bank,65);
  assert.ok(Object.values(p.durability).every(n=>n===0));assert.ok(Object.values(p.inventory).every(n=>n===0));
  p.wallet=0; f.near('bank');f.act({kind:'loan',amount:10});f.near('tools');f.act({kind:'buyTool',tool:'scythe'});
  assert.equal(p.durability.scythe,100);assert.equal(store.account(p.id).credit,0);assert.equal(store.account(p.id).bank,65);
});
