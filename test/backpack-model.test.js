import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCharacter } from '../public/src/characters.js';

const pack=actor=>actor.group.getObjectByName('worn-backpack');
const meshes=root=>{const out=[];root.traverse(m=>{if(m.isMesh)out.push(m);});return out;};
function settle(actor,options={}) {
  for(let i=0;i<40;i++)actor.update(1/60,i/60,options);
  actor.group.updateMatrixWorld(true);
}

test('backpack tiers produce distinct curved equipment and tier zero has no pack',()=>{
  const actor=createCharacter('villager',1),sizes=[];
  assert.equal(pack(actor),undefined);
  for(const tier of [1,2,3]) {
    actor.update(0,0,{backpackTier:tier});actor.group.updateMatrixWorld(true);
    const worn=pack(actor);
    assert.equal(worn.userData.backpackTier,tier);assert.equal(worn.parent.name,'body');
    const items=meshes(worn),bounds=new THREE.Box3().setFromObject(worn);
    assert.ok(items.length>0&&items.length<=6,'details batch into a bounded number of draw calls');
    assert.ok(bounds.min.z<-.50,'a visible bag rests behind the torso');
    assert.ok(bounds.max.z<.31,'shoulder straps remain fitted to the chest');
    assert.ok(bounds.min.y>.5&&bounds.max.y<1.85,'pack fits between the hips and shoulders');
    sizes.push(bounds.getSize(new THREE.Vector3()));
    for(const {geometry:g} of items) {
      for(const a of Object.values(g.attributes))assert.ok(a.array.every(Number.isFinite));
      if(g.index)assert.ok(g.index.array.every(i=>i<g.attributes.position.count));
      assert.ok(g.attributes.normal.count===g.attributes.position.count);
    }
  }
  assert.ok(sizes[1].z>sizes[0].z&&sizes[2].z>sizes[1].z,'higher tiers have progressively deeper storage');
  assert.ok(sizes[2].y>sizes[1].y,'expedition bedroll changes the silhouette');
  actor.setBackpackTier(0);assert.equal(pack(actor),undefined);
  for(const invalid of [-1,4,1.5,'3',null,Infinity]) {
    actor.setBackpackTier(2);actor.setBackpackTier(invalid);assert.equal(pack(actor),undefined);
  }
  actor.dispose();
});

test('worn packs follow the torso through motion and role changes without rebuilding every frame',()=>{
  const actor=createCharacter('villager',2);
  actor.group.position.set(32,0,-47);actor.group.rotation.y=1.4;
  actor.setBackpackTier(3);const original=pack(actor);
  for(const options of [{moving:true},{mounted:true},{carrying:true},{downed:true},{}]) {
    settle(actor,{...options,backpackTier:3});
    assert.equal(pack(actor),original,'state updates reuse the equipped mesh');
    assert.equal(original.visible,true,'worn storage remains visible when riding or downed');
    const body=actor.group.getObjectByName('body');
    const relative=new THREE.Matrix4().copy(body.matrixWorld).invert().multiply(original.matrixWorld);
    assert.ok(relative.elements.every((v,i)=>Math.abs(v-(i%5===0?1:0))<1e-9),'pack stays anchored to the torso');
    assert.ok(meshes(original).every(m=>m.matrixWorld.elements.every(Number.isFinite)));
  }
  for(const role of ['guard','priest','villager']) {
    actor.setRole(role);settle(actor);
    assert.equal(pack(actor).userData.backpackTier,3,'role swaps retain equipped storage');
    assert.equal(pack(actor).parent.name,'body');
  }
  actor.setRole('zombie');assert.equal(pack(actor),undefined,'zombie NPCs never wear player storage');
  actor.setRole('villager');assert.equal(pack(actor).userData.backpackTier,3);
  actor.dispose();
});

test('cached backpack geometry survives another actor unequipping, changing role, and disposing',()=>{
  const first=createCharacter('villager',1),second=createCharacter('villager',2);
  first.setBackpackTier(2);second.setBackpackTier(2);
  const shared=new Set(meshes(pack(second)).map(m=>m.geometry));
  assert.ok(meshes(pack(first)).every(m=>shared.has(m.geometry)),'actors share cached pack geometry');
  let disposed=0;const listener=()=>disposed++;
  for(const g of shared)g.addEventListener('dispose',listener);
  first.setBackpackTier(3);first.setRole('guard');first.setBackpackTier(0);
  first.dispose();first.dispose();assert.equal(disposed,0);
  settle(second,{moving:true});
  assert.ok(meshes(pack(second)).every(m=>m.matrixWorld.elements.every(Number.isFinite)));
  second.dispose();assert.equal(disposed,0,'shared cached assets outlive individual actors');
  for(const g of shared)g.removeEventListener('dispose',listener);
});
