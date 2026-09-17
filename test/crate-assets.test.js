import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CRATE_ITEMS } from '../public/src/crate-catalog.js';
import { createCrateAsset, CRATE_REST_ANCHORS } from '../public/src/crate-assets.js';
import { createCharacter } from '../public/src/characters.js';
import { studioDistance } from '../public/src/crate-framing.js';

test('the complete art catalogue resolves to finite standalone models and shares the real rig anchors',()=>{
  assert.equal(CRATE_ITEMS.length,27);assert.equal(new Set(CRATE_ITEMS.map(i=>i.id)).size,27);
  assert.deepEqual(Object.fromEntries(['basic','rare','epic','legendary','godly','milestone'].map(t=>[t,CRATE_ITEMS.filter(i=>i.tier===t).length])),{basic:5,rare:7,epic:6,legendary:7,godly:1,milestone:1});
  const character=createCharacter('villager',1);character.group.updateMatrixWorld(true);
  // createCharacter samples breathing once on construction; remove that shared
  // vertical offset when comparing its authored bone positions to the rest pose.
  const breath=character.group.getObjectByName('body').position.y-1.04;
  for(const[name,position]of Object.entries(CRATE_REST_ANCHORS)){const point=character.group.getObjectByName(name).getWorldPosition(new THREE.Vector3());point.y-=breath;assert.ok(point.distanceTo(new THREE.Vector3(...position))<1e-6,name);}
  character.dispose();
  for(const item of CRATE_ITEMS){const model=createCrateAsset(item.id),bounds=new THREE.Box3().setFromObject(model.root);assert.ok(!bounds.isEmpty(),item.id);assert.ok([...bounds.min,...bounds.max].every(Number.isFinite));model.update(.14);model.update(.14,{reducedMotion:true});model.dispose();model.dispose();}
  assert.throws(()=>createCrateAsset('__proto__'),/catalogue/);assert.throws(()=>createCrateAsset('padded_cap',{backpackTier:-1}),/backpack/);
});

test('wearing and removing every head item preserves faces, clears coverings and restores exact visibility on all jobs',()=>{
  for(const role of ['villager','guard','priest']){
    const actor=createCharacter(role,1,{equipmentPreview:true});const head=actor.group.getObjectByName('head'),original=[...head.children];
    assert.ok(original.some(o=>o.name==='swept grooved scalp hair'));assert.ok(original.some(o=>o.name==='continuous combed beard'));
    for(const item of CRATE_ITEMS.filter(i=>i.slot==='head')){
      const model=createCrateAsset(item.id);model.fit(actor);assert.ok(model.fitted);
      assert.equal(head.getObjectByName('swept grooved scalp hair').visible,false);assert.equal(head.getObjectByName('continuous combed beard').visible,true);
      for(let i=0;i<20;i++)actor.update(1/60,i/60,{moving:true});actor.group.updateMatrixWorld(true);
      for(const part of model.parts){assert.equal(part.object.parent,head);assert.ok(part.object.matrixWorld.elements.every(Number.isFinite));}
      model.unfit();assert.equal(model.fitted,false);assert.ok(original.every(o=>o.visible));assert.ok(original.every(o=>o.parent===head));model.dispose();
    }
    actor.dispose();
  }
});

test('specialized packs and boots replace only their visible counterparts without disposing the character',()=>{
  const actor=createCharacter('guard',1,{equipmentPreview:true});actor.setBackpackTier(3);
  const originalPack=actor.group.getObjectByName('worn-backpack'),boots=[];actor.group.traverse(o=>{if(o.userData.clothingPart==='boot')boots.push(o);});assert.ok(boots.length);
  for(const id of ['mining_pack','lumber_pack']){const model=createCrateAsset(id,{backpackTier:3});model.fit(actor);assert.equal(originalPack.visible,false);assert.ok(boots.every(o=>o.visible));model.dispose();assert.equal(originalPack.visible,true);assert.ok(originalPack.parent);}
  originalPack.visible=false;
  for(const id of ['stout_leather_boots','guardians_boots']){const model=createCrateAsset(id);model.fit(actor);assert.ok(boots.every(o=>!o.visible));model.dispose();assert.ok(boots.every(o=>o.visible));assert.equal(originalPack.visible,false);}
  const kit=createCrateAsset('hearth_ration_kit');assert.throws(()=>kit.fit(actor),/not wearable/);kit.dispose();actor.dispose();
});

test('model framing contains complete rotated items on narrow and wide viewports',()=>{
  for(const item of CRATE_ITEMS){const model=createCrateAsset(item.id),bounds=new THREE.Box3().setFromObject(model.root),center=bounds.getCenter(new THREE.Vector3()),radius=bounds.getSize(new THREE.Vector3()).length()/2;
    for(const aspect of [.5,.6,1,1.8])for(const yaw of [-.48,1.4,3.6]){
      const camera=new THREE.PerspectiveCamera(33,aspect,.001,100),distance=studioDistance(radius,aspect);camera.position.copy(center).add(new THREE.Vector3(Math.sin(yaw),.22,Math.cos(yaw)).normalize().multiplyScalar(distance));camera.lookAt(center);camera.updateMatrixWorld(true);
      for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){const p=new THREE.Vector3(x,y,z).project(camera);assert.ok(Math.abs(p.x)<=1&&Math.abs(p.y)<=1,`${item.id}/${aspect}: ${p.toArray()}`);}
    }
    model.dispose();
  }
});

test('working-pose camera framing keeps the actual raised pickaxe and moving dwarf inside the view',()=>{
  for(const role of ['villager','guard','priest']){
    const actor=createCharacter(role,1,{equipmentPreview:true}),model=createCrateAsset('sunforged_viking_helm');actor.setTool('pickaxe');model.fit(actor);
    for(let frame=0;frame<60;frame++){
      actor.update(1/30,frame/30,{attack:frame%50<20});actor.group.updateMatrixWorld(true);actor.group.traverse(o=>{if(o.isSkinnedMesh){o.skeleton.update();o.computeBoundingBox();}});
      const bounds=new THREE.Box3().setFromObject(actor.group);
      for(const aspect of [.55,1.4]){
        const camera=new THREE.PerspectiveCamera(33,aspect,.02,80),distance=studioDistance(1.92,aspect);camera.position.set(Math.sin(-.48)*Math.cos(.14)*distance,1.45+Math.sin(.14)*distance,Math.cos(-.48)*Math.cos(.14)*distance);camera.lookAt(0,1.45,0);camera.updateMatrixWorld(true);
        for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){const p=new THREE.Vector3(x,y,z).project(camera);assert.ok(Math.abs(p.x)<=1&&Math.abs(p.y)<=1,`${role}/${frame}/${aspect}`);}
      }
    }
    model.dispose();actor.dispose();
  }
});
