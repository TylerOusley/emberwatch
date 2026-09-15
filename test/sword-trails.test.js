import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createCharacter} from '../public/src/characters.js';
import {createSwordTrails} from '../public/src/sword-trails.js';

function fixture(role='guard'){
  const scene=new THREE.Scene(),rig=createCharacter(role,3);scene.add(rig.group);
  const actor={rig,motionOptions:{}},actors=new Map([['dwarf',actor]]),trails=createSwordTrails(scene);
  let time=0;
  function frame(options={},extra={}){
    time+=1/60;actor.motionOptions={tool:'sword',attack:0,...options};rig.update(1/60,time,actor.motionOptions);
    trails.update({actors,entities:[{id:'dwarf',role,hp:100,anim:'idle',tool:'sword',...extra.entity}],ownId:'dwarf',selected:'sword',localActionId:actor.motionOptions.attack,dt:1/60,time,snapshotAt:time,...extra});
    return time;
  }
  function dispose(){trails.dispose();rig.dispose();}
  for(let i=0;i<60;i++)frame();
  return {scene,rig,actor,actors,trails,frame,dispose};
}

test('the visible ribbon follows the actual articulated sword blade and fades immediately after its cutting phase',()=>{
  const f=fixture(),mesh=f.trails.root.children[0];f.rig.group.position.set(3,0,-7);f.rig.group.rotation.y=.7;f.frame();
  let visibleFrames=0,maxVertices=0,firstTime=null,lastVisible=null;
  for(let i=0;i<65;i++){
    const time=f.frame({attack:1});
    if(!mesh.visible)continue;
    visibleFrames++;firstTime??=i/60;lastVisible=i/60;maxVertices=Math.max(maxVertices,f.trails.debug.vertices);
    const attribute=mesh.geometry.attributes.position,count=mesh.geometry.drawRange.count;
    assert.ok(Array.from(attribute.array.subarray(0,count*3)).every(Number.isFinite));
    if(i/60<.34){
      const sword=f.rig.group.getObjectByName('held-sword'),tip=sword.localToWorld(new THREE.Vector3(0,.97,0)),base=sword.localToWorld(new THREE.Vector3(0,.30,0));
      assert.ok(new THREE.Vector3().fromBufferAttribute(attribute,count-2).distanceTo(tip)<1e-5,'outer edge uses the real blade tip');
      assert.ok(new THREE.Vector3().fromBufferAttribute(attribute,count-1).distanceTo(base)<1e-5,'inner edge follows the blade rather than orbiting the player');
    }
  }
  assert.ok(visibleFrames>8);assert.ok(firstTime>=.14&&firstTime<.22);assert.ok(lastVisible<.56);
  assert.ok(maxVertices>12&&maxVertices<=66);assert.equal(mesh.visible,false);assert.equal(f.trails.debug.vertices,0);f.dispose();
});

test('tools, bows, hidden swords and unavailable players never emit blade trails',()=>{
  for(const tool of ['axe','pickaxe','scythe','hammer','bow','heal','']){
    const f=fixture();for(let i=0;i<40;i++){f.frame({attack:1,tool});assert.equal(f.trails.debug.vertices,0,tool);}f.dispose();
  }
  for(const mode of [{downed:true},{mounted:true},{carrying:true}]){
    const f=fixture();for(let i=0;i<35;i++){f.frame({attack:1,...mode});assert.equal(f.trails.debug.vertices,0);}f.dispose();
  }
  const f=fixture();for(let i=0;i<14;i++)f.frame({attack:1});assert.ok(f.trails.debug.vertices>0);
  f.frame({attack:1,tool:'bow'});assert.equal(f.trails.debug.vertices,0,'switching tools removes the old ribbon');f.dispose();
});

test('newly joined attacks are suppressed and sustained NPC attacks produce bounded separate strokes',()=>{
  const f=fixture();f.trails.reset();
  for(let i=0;i<35;i++){f.frame({attack:true},{ownId:'someone-else'});assert.equal(f.trails.debug.vertices,0,'no partial attack is replayed on join');}
  let seen=false;
  for(let i=0;i<80;i++){f.frame({attack:true},{ownId:'someone-else'});seen||=f.trails.debug.vertices>0;assert.ok(f.trails.debug.vertices<=66);}
  assert.ok(seen);assert.ok(f.trails.debug.strokes>=2&&f.trails.debug.strokes<=3,'held attack repeats at the existing rig cadence');
  for(let i=0;i<50;i++)f.frame({attack:false},{ownId:'someone-else'});assert.equal(f.trails.debug.vertices,0);f.dispose();
});

test('stale streams, pauses, teleports and cleanup cannot leave a permanent or long stretched ribbon',()=>{
  const f=fixture();for(let i=0;i<15;i++)f.frame({attack:1});assert.ok(f.trails.debug.vertices>0);
  f.rig.group.position.x+=100;f.frame({attack:1});assert.equal(f.trails.debug.vertices,0);
  for(let i=0;i<60;i++)f.frame({attack:1});for(let i=0;i<15;i++)f.frame({attack:2});assert.ok(f.trails.debug.vertices>0);
  f.frame({attack:2},{snapshotAt:0});assert.equal(f.trails.debug.vertices,0);assert.equal(f.trails.debug.tracked,0);
  for(let i=0;i<60;i++)f.frame({attack:2});for(let i=0;i<15;i++)f.frame({attack:3});assert.ok(f.trails.debug.vertices>0);
  f.frame({attack:3},{active:false});assert.equal(f.trails.debug.vertices,0);
  const mesh=f.trails.root.children[0];let geometries=0,materials=0;mesh.geometry.addEventListener('dispose',()=>geometries++);mesh.material.addEventListener('dispose',()=>materials++);
  f.trails.dispose();f.trails.dispose();assert.equal(geometries,1);assert.equal(materials,1);assert.equal(f.trails.root.parent,null);f.frame({attack:4});assert.equal(f.trails.debug.vertices,0);f.rig.dispose();
});

test('all ribbons share one bounded mesh and zombie presentations are excluded',()=>{
  const f=fixture();f.trails.reset();const entities=Array.from({length:90},(_,i)=>({id:`guard-${i}`,role:'guard',hp:100,tool:'sword',anim:'idle'}));
  const actors=new Map(entities.map(e=>[e.id,f.actor]));actors.set('zombie',f.actor);entities.unshift({id:'zombie',role:'zombie',hp:100,anim:'attack'});
  for(let i=0;i<20;i++){
    f.actor.motionOptions={attack:i>0,tool:'sword'};f.rig.update(1/60,i/60,f.actor.motionOptions);
    f.trails.update({actors,entities,dt:1/60,time:i/60,snapshotAt:i/60});
    assert.ok(f.trails.debug.tracked<=64);assert.ok(f.trails.debug.vertices<=f.trails.debug.maxVertices);
  }
  assert.equal(f.trails.debug.tracked,64);assert.equal(f.trails.debug.drawCalls,1);assert.equal(f.trails.root.children.length,1);
  f.trails.update({actors:new Map(),entities:[],dt:1/60,time:.34});assert.equal(f.trails.debug.vertices,0);assert.equal(f.trails.debug.tracked,0);f.dispose();
});
