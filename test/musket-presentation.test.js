import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCharacter } from '../public/src/characters.js';

function settle(actor,options={},seconds=1,rate=60) {
  for(let i=0;i<Math.round(seconds*rate);i++)actor.update(1/rate,i/rate,{tool:'musket',...options});
  actor.group.updateMatrixWorld(true);
}
function axis(actor) {
  const tool=actor.group.getObjectByName('held-musket');
  return tool.localToWorld(new THREE.Vector3(0,1,0)).sub(tool.localToWorld(new THREE.Vector3())).normalize();
}

test('muskets point forward, seat the trigger grip, and keep the support hand under the forestock',()=>{
  const actor=createCharacter('villager',2);settle(actor);
  const tool=actor.group.getObjectByName('held-musket'),hand=actor.group.getObjectByName('hand');
  assert.ok(tool.getObjectByName('musket-muzzle'),'the held weapon retains its muzzle socket');
  assert.equal(actor.group.getObjectByName('held-sword'),undefined);
  const grip=tool.localToWorld(new THREE.Vector3()),finger=hand.localToWorld(new THREE.Vector3(0,-.104,.05));
  assert.ok(grip.distanceTo(finger)<1e-8,'trigger grip is seated in the curled fingers');
  const support=tool.localToWorld(new THREE.Vector3(0,.38,0));
  const left=actor.group.getObjectByName('leftFore').localToWorld(new THREE.Vector3(0,-.424,.085));
  assert.ok(support.distanceTo(left)<.04,'off hand supports the wooden forestock');
  assert.ok(axis(actor).z>.999,'barrel follows actor forward, rather than the sword swing');
  for(const options of [{moving:true},{mounted:true},{carrying:true},{downed:true}]) {
    settle(actor,options);
    actor.group.traverse(node=>assert.ok(node.matrixWorld.elements.every(Number.isFinite)));
    assert.equal(tool.visible,!options.mounted&&!options.carrying);
  }
  actor.dispose();
});

test('authoritative musket shot IDs recoil once and joining an old attack does not replay it',()=>{
  const actor=createCharacter();const old={id:'old',kind:'musket',at:3};
  settle(actor,{attack:true,shot:old});const rest=axis(actor);
  assert.ok(rest.y<.001,'first snapshot establishes a silent, stationary baseline');
  const fresh={id:'new',kind:'musket',at:5};
  actor.update(.06,5,{tool:'musket',attack:true,shot:fresh});actor.group.updateMatrixWorld(true);
  assert.ok(axis(actor).y>.01,'new shot gives an upward muzzle kick');
  settle(actor,{attack:true,shot:fresh},2);
  assert.ok(Math.abs(axis(actor).y)<.001,'a sustained attack animation cannot fire again');
  actor.update(.06,7,{tool:'musket',attack:true,shot:{id:'guard',kind:'musket',firedAt:7}});actor.group.updateMatrixWorld(true);
  assert.ok(axis(actor).y>.01,'troop event timestamps use the same recoil');
  actor.dispose();
});

test('musket pose stays consistent across render rates and reuses model assets across equip and role changes',()=>{
  const low=createCharacter('villager',1),high=createCharacter('villager',1);
  settle(low,{moving:true,speed:4},2,30);settle(high,{moving:true,speed:4},2,120);
  assert.ok(axis(low).distanceTo(axis(high))<.015,'render frequency does not change aim direction');
  const originals=[];low.group.getObjectByName('held-musket').traverse(node=>{if(node.isMesh)originals.push([node.geometry,node.material]);});
  let disposed=0;const resources=new Set(originals.flat());for(const resource of resources)resource.addEventListener('dispose',()=>disposed++);
  for(let i=0;i<8;i++){low.setTool('bow');low.setTool('musket');}
  low.setRole('guard');assert.equal(low.group.getObjectByName('guard-shield').visible,false,'riflemen have a free support hand');
  low.setTool('sword');assert.equal(low.group.getObjectByName('guard-shield').visible,true,'swordsmen retain their shields');
  low.dispose();low.dispose();
  assert.equal(disposed,0,'shared weapon assets remain valid for nearby actors');
  settle(high,{attack:1});
  const retained=[];high.group.getObjectByName('held-musket').traverse(node=>{if(node.isMesh)retained.push([node.geometry,node.material]);});
  assert.deepEqual(retained,originals,'equipping and rebuilding share the three immutable batches');
  assert.equal(high.group.getObjectByName('held-musket').children.filter(node=>node.isMesh).length,3);
  high.dispose();assert.equal(disposed,0);
});
