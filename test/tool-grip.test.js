import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCharacter } from '../public/src/characters.js';

const tools=['axe','pickaxe','hammer','scythe'];
const point=(object,x=0,y=0,z=0)=>object.localToWorld(new THREE.Vector3(x,y,z));
const axis=(object,x,y,z)=>point(object,x,y,z).sub(point(object)).normalize();
const tips={axe:[.38,.64,0],pickaxe:[.42,.52,0],hammer:[.23,.62,0],scythe:[.89,.75,0]};
function settle(actor,options={}) {
  for(let i=0;i<90;i++)actor.update(1/60,i/60,options);
  actor.group.updateMatrixWorld(true);
}
function gripInHand(tool,hand) {
  return hand.worldToLocal(point(tool,0,-.08,0));
}

test('working tools sit inside the curled fingers with upright shafts and heads facing forward',()=>{
  for(const role of ['villager','guard','priest'])for(const id of tools)for(const tier of [1,2,3]) {
    const actor=createCharacter(role,2);
    settle(actor,{tool:{id,tier}});
    const tool=actor.group.getObjectByName(`held-${id}`),hand=actor.group.getObjectByName('hand');
    const grip=gripInHand(tool,hand);
    assert.ok(Math.abs(grip.x)<.025,`${role} ${id} grip centered across the fingers`);
    assert.ok(grip.y<-.08&&grip.y>-.13,`${role} ${id} grip below the palm`);
    assert.ok(grip.z>.025&&grip.z<.07,`${role} ${id} grip enclosed by the fingers`);
    const shaft=axis(tool,0,1,0),head=axis(tool,1,0,0);
    assert.ok(shaft.dot(axis(hand,1,0,0))>.999,`${id} shaft follows the finger curl`);
    assert.ok(shaft.y>.9,`${id} shaft carried upright`);
    assert.ok(head.z>.9,`${id} working end points ahead rather than across the torso`);
    assert.ok(Math.abs(head.x)<.25,`${id} head does not span the character's chest`);
    actor.dispose();
  }
});

test('working tool grips stay closed through walking, strikes and recovery',()=>{
  for(const id of tools) {
    const actor=createCharacter('villager',3);
    actor.group.position.set(28,0,-37);actor.group.rotation.y=1.2;
    settle(actor,{tool:{id,tier:3}});
    const tool=actor.group.getObjectByName(`held-${id}`),hand=actor.group.getObjectByName('hand');
    const bindGrip=gripInHand(tool,hand),restTip=point(tool,...tips[id]);
    let travel=0,previousRotation=tool.getWorldQuaternion(new THREE.Quaternion());
    for(let i=0;i<90;i++) {
      actor.update(1/60,i/60,{attack:i===0?1:0});
      actor.group.updateMatrixWorld(true);
      assert.ok(gripInHand(tool,hand).distanceTo(bindGrip)<1e-8,`${id} does not slide through the fist`);
      assert.ok(tool.matrixWorld.elements.every(Number.isFinite),`${id} strike has finite transforms`);
      const tip=point(tool,...tips[id]);
      const rotation=tool.getWorldQuaternion(new THREE.Quaternion());
      // Bound the change in orientation rather than endpoint speed: a long
      // scythe blade legitimately travels farther than a short hammer head.
      assert.ok(rotation.angleTo(previousRotation)<Math.PI/6,`${id} rotates continuously without snapping`);
      travel=Math.max(travel,tip.distanceTo(restTip));previousRotation=rotation;
    }
    assert.ok(travel>.35,`${id} makes a visible working stroke`);
    assert.ok(point(tool,...tips[id]).distanceTo(restTip)<.03,`${id} returns to its carry pose`);
    settle(actor,{moving:true});
    assert.ok(gripInHand(tool,hand).distanceTo(bindGrip)<1e-8,`${id} remains gripped during walking`);
    settle(actor,{mounted:true});
    assert.equal(tool.visible,false,`${id} is stowed while riding`);
    settle(actor,{carrying:true});
    assert.equal(tool.visible,false,`${id} is stowed while carrying a player`);
    actor.dispose();
  }
});

test('working ends reach their targets with a level scythe blade and forward bow aim',()=>{
  for(const id of ['pickaxe','bow','scythe']) {
    const actor=createCharacter('villager',2);
    settle(actor,{tool:id});
    // Sample the contact part of the existing 0.54-second action, after the
    // elbow has extended from anticipation but before returning to rest.
    for(let i=0;i<21;i++)actor.update(1/60,1.5+i/60,{attack:i===0?1:0});
    actor.group.updateMatrixWorld(true);
    const tool=actor.group.getObjectByName(`held-${id}`);
    if(id==='pickaxe') {
      const tip=point(tool,...tips.pickaxe);
      assert.ok(tip.y>.15&&tip.y<1,'pickaxe descends to a low ore deposit');
      assert.ok(tip.z>.8,'mining stroke reaches ahead of the player');
    } else if(id==='scythe') {
      const tip=point(tool,...tips.scythe),blade=axis(tool,1,0,0);
      assert.ok(tip.y>.15&&tip.y<.9,'scythe sweeps through the lower stalks');
      assert.ok(Math.abs(blade.y)<.2,'scythe cutting blade stays approximately horizontal');
    } else {
      const arrow=axis(tool,1,0,0);
      assert.ok(arrow.z>.9&&Math.abs(arrow.y)<.25,'drawn arrow points at a target ahead rather than skyward');
      const hand=actor.group.getObjectByName('hand'),grip=hand.worldToLocal(point(tool,.28,0,0));
      assert.ok(Math.abs(grip.x)<.025&&grip.y<-.08&&grip.y>-.13&&grip.z>.025&&grip.z<.07,'bow handle is enclosed by the fingers');
    }
    actor.dispose();
  }
});
