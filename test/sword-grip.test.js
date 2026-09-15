import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCharacter } from '../public/src/characters.js';

const point=(object,x=0,y=0,z=0)=>object.localToWorld(new THREE.Vector3(x,y,z));
function settle(actor,options={}) {
  for(let i=0;i<90;i++)actor.update(1/60,i/60,options);
  actor.group.updateMatrixWorld(true);
}

test('sword grip follows the finger curl, with crossguard past the thumb and blade leading forward',()=>{
  for(const role of ['villager','guard','priest'])for(const tier of [1,2,3]) {
    const actor=createCharacter(role,2);
    settle(actor,{tool:{id:'sword',tier}});
    const sword=actor.group.getObjectByName('held-sword'),hand=actor.group.getObjectByName('hand');
    const hilt=point(sword),guard=point(sword,0,.13),pommel=point(sword,0,-.15),tip=point(sword,0,.97);
    const thumbAxis=point(hand,1).sub(point(hand)).normalize();
    const bladeAxis=tip.clone().sub(hilt).normalize();
    assert.ok(bladeAxis.dot(thumbAxis)>.999,'hilt crosses the palm along the curled fingers');
    assert.ok(guard.clone().sub(point(hand)).dot(thumbAxis)>.115,'guard clears the thumb side');
    assert.ok(pommel.clone().sub(point(hand)).dot(thumbAxis)<-.12,'pommel clears the little finger');
    const inHand=hand.worldToLocal(hilt.clone());
    assert.ok(inHand.y<-.08&&inHand.y>-.13,'grip sits in the finger opening below the palm');
    assert.ok(inHand.z>.025&&inHand.z<.07,'grip is enclosed by the curled fingers');
    assert.ok(bladeAxis.z>.90&&bladeAxis.y>.1&&bladeAxis.y<.5,'idle blade points ahead in a low guard');
    actor.dispose();
  }
});

test('striking keeps the sword in the same skinned hand grip, and stowing restores other poses',()=>{
  const actor=createCharacter('guard',3);
  actor.group.position.set(28,0,-37);actor.group.rotation.y=1.2;
  settle(actor,{tool:{id:'sword',tier:3}});
  const hand=actor.group.getObjectByName('hand'),sword=actor.group.getObjectByName('held-sword');
  const bindGrip=hand.worldToLocal(point(sword));
  const restTip=point(sword,0,.97);
  let travel=0;
  for(let i=0;i<90;i++) {
    actor.update(1/60,i/60,{attack:i===0?1:0,tool:{id:'sword',tier:3}});
    actor.group.updateMatrixWorld(true);
    const grip=hand.worldToLocal(point(sword));
    assert.ok(grip.distanceTo(bindGrip)<1e-8,'hilt never slides through the hand during a strike');
    assert.ok(sword.matrixWorld.elements.every(Number.isFinite));
    travel=Math.max(travel,point(sword,0,.97).distanceTo(restTip));
  }
  assert.ok(travel>.6,'blade performs a visible strike instead of staying fixed');
  assert.ok(point(sword,0,.97).distanceTo(restTip)<.025,'recovery returns to the low guard');
  settle(actor,{mounted:true});
  assert.equal(sword.visible,false);
  assert.ok(Math.abs(hand.rotation.y)<.005,'riding does not leave the sword wrist twist');
  settle(actor,{tool:'axe'});
  assert.ok(Math.abs(hand.rotation.y)<.001,'switching tools restores the existing gathering hand pose');
  settle(actor,{tool:''});
  assert.equal(actor.group.getObjectByName('held-sword'),undefined);
  actor.dispose();
});
