import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createArmor} from '../public/src/crate-armor.js';
import {createCharacter} from '../public/src/characters.js';
const items=['riveted_vest','tempered_cuirass','runeforged_cuirass','stout_leather_boots','guardians_boots'];
const meshes=armor=>{const found=[];for(const {object} of armor.parts)object.traverse(o=>{if(o.isMesh)found.push(o);});return found;};
function equip(actor,armor){for(const p of armor.parts){const bone=actor.group.getObjectByName(p.bone);assert.ok(bone,p.bone);bone.add(p.object);}}
test('crate armor has complete bounded smooth geometry, detached attachment groups and distinct material designs',()=>{
  const appearances=[];
  for(const id of items){const armor=createArmor(id),surfaces=meshes(armor);assert.ok(surfaces.length>0&&surfaces.length<=12,id);assert.ok(armor.parts.every(p=>p.object.parent===null));
    assert.deepEqual(armor.parts.map(p=>p.bone),id.endsWith('boots')?['leftFoot','leftShin','rightFoot','rightShin']:['body']);
    let triangles=0;for(const mesh of surfaces){const g=mesh.geometry;for(const a of Object.values(g.attributes))assert.ok(a.array.every(Number.isFinite),id);assert.equal(g.attributes.normal.count,g.attributes.position.count);assert.equal(g.attributes.color.count,g.attributes.position.count);assert.ok(g.boundingSphere.radius>0&&Number.isFinite(g.boundingSphere.radius));triangles+=g.attributes.position.count/3;assert.equal(mesh.material.flatShading,false);}
    assert.ok(triangles<30000,id);appearances.push(surfaces.map(m=>[m.material.color.getHex(),m.geometry.attributes.position.count]));armor.dispose();
  }
  assert.equal(new Set(appearances.map(JSON.stringify)).size,items.length);assert.throws(()=>createArmor('unknown'),/Unknown crate armor/);
});
test('cuirasses fit real villager, guard and priest torso bones without changing existing clothing or crossing hip joints',()=>{
  for(const role of ['villager','guard','priest'])for(const id of items.slice(0,3)) {
    const actor=createCharacter(role,2),originals=[];actor.group.traverse(o=>{if(o.isMesh)originals.push({object:o,geometry:o.geometry,material:o.material,visible:o.visible});});
    const armor=createArmor(id);equip(actor,armor);const body=actor.group.getObjectByName('body'),local=new THREE.Box3().setFromObject(armor.parts[0].object);
    // The model initially stands at body y=1.04; the armor stops above hips.
    assert.ok(local.min.y>.77&&local.max.y<1.57,id);assert.ok(local.min.x>-.48&&local.max.x<.48,id);
    for(const options of [{moving:true,speed:5.4},{moving:true,speed:8},{attack:1,tool:'sword'},{mounted:true},{downed:true}]){
      for(let i=0;i<16;i++)actor.update(1/60,i/60,options);actor.group.updateMatrixWorld(true);
      assert.equal(armor.parts[0].object.parent,body);assert.ok(meshes(armor).every(o=>o.matrixWorld.elements.every(Number.isFinite)));
    }
    for(const before of originals){assert.equal(before.object.geometry,before.geometry);assert.equal(before.object.material,before.material);assert.equal(before.object.visible,before.visible);}
    armor.dispose();assert.ok(actor.group.getObjectByName('body'));actor.dispose();
  }
});
test('boot pairs use separate shin cuffs and foot shoes that articulate with real ankles while keeping grounded soles',()=>{
  for(const role of ['villager','guard','priest'])for(const id of items.slice(3)) {
    const actor=createCharacter(role,2),armor=createArmor(id);equip(actor,armor);actor.group.updateMatrixWorld(true);
    const rest=new THREE.Box3();for(const {object} of armor.parts)rest.union(new THREE.Box3().setFromObject(object));assert.ok(rest.min.y>=-.003&&rest.max.y<.6,`${role}/${id}: ${rest.min.y},${rest.max.y}`);
    const left=armor.parts.find(p=>p.bone==='leftFoot').object,cuff=armor.parts.find(p=>p.bone==='leftShin').object;
    const qShoe=new THREE.Quaternion(),qCuff=new THREE.Quaternion();let sawFlex=false;
    for(let i=0;i<80;i++){actor.update(1/60,i/60,{moving:true,speed:8});actor.group.updateMatrixWorld(true);left.getWorldQuaternion(qShoe);cuff.getWorldQuaternion(qCuff);if(qShoe.angleTo(qCuff)>.04)sawFlex=true;assert.ok(meshes(armor).every(o=>o.matrixWorld.elements.every(Number.isFinite)));}
    assert.ok(sawFlex,'shoe rotates independently of its shin cuff');assert.equal(left.parent.name,'leftFoot');assert.equal(cuff.parent.name,'leftShin');armor.dispose();actor.dispose();
  }
});
test('each item owns its resources, reduced motion fixes the glow, and disposal is idempotent and isolated',()=>{
  const first=createArmor('runeforged_cuirass'),second=createArmor('runeforged_cuirass'),left=meshes(first),right=meshes(second);assert.ok(left.every(m=>right.every(n=>m.material!==n.material&&m.geometry!==n.geometry)));
  const glow=left.map(m=>m.material).find(m=>m.emissive?.getHex()>0);assert.ok(glow);first.update(0);const atZero=glow.emissiveIntensity;first.update(2);assert.notEqual(glow.emissiveIntensity,atZero);first.update(12,{reducedMotion:true});const fixed=glow.emissiveIntensity;first.update(14,{reducedMotion:true});assert.equal(glow.emissiveIntensity,fixed);
  const resources=new Set(left.flatMap(m=>[m.geometry,m.material,...(m.material.bumpMap?[m.material.bumpMap]:[])])),counts=new Map([...resources].map(r=>[r,0]));for(const r of resources)r.addEventListener('dispose',()=>counts.set(r,counts.get(r)+1));let otherDisposals=0;for(const m of right)m.geometry.addEventListener('dispose',()=>otherDisposals++);
  first.dispose();first.dispose();assert.ok([...counts.values()].every(n=>n===1));assert.equal(otherDisposals,0);second.update(1);assert.ok(right.every(m=>m.geometry.attributes.position.count>0));second.dispose();
});
