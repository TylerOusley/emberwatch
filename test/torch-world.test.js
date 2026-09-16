import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {createTorchSystem,torchNightAmount,torchFlicker} from '../public/src/torch-world.js';
import {createCaveWorld} from '../public/src/cave-world.js';
import {BUILDINGS,RESOURCES,PLOTS,groundHeight} from '../shared/world.js';
import {buildingEntrance} from '../shared/access.js';

const threeURL=new URL('../node_modules/three/build/three.module.js',import.meta.url).href,sharedURL=new URL('../shared/world.js',import.meta.url).href;
const moduleURL=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const plots=readFileSync(new URL('../public/src/plots-world.js',import.meta.url),'utf8').replace("'three'",JSON.stringify(threeURL)).replace("'/shared/world.js'",JSON.stringify(sharedURL)).replace("'./surface-materials.js'",JSON.stringify(new URL('../public/src/surface-materials.js',import.meta.url).href)).replace("'./environment-geometry.js'",JSON.stringify(new URL('../public/src/environment-geometry.js',import.meta.url).href));
const source=readFileSync(new URL('../public/src/world.js',import.meta.url),'utf8').replace("'three'",JSON.stringify(threeURL)).replace("'/shared/world.js'",JSON.stringify(sharedURL)).replace("'./plots-world.js'",JSON.stringify(moduleURL(plots))).replace("'./surface-materials.js'",JSON.stringify(new URL('../public/src/surface-materials.js',import.meta.url).href)).replace("'./environment-geometry.js'",JSON.stringify(new URL('../public/src/environment-geometry.js',import.meta.url).href));
const {createWorld}=await import(moduleURL(source));
let world;
const previousDocument=globalThis.document;globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>new Proxy({},{get:()=>()=>{},set:()=>true})})};
try{world=createWorld(new THREE.Scene());}finally{globalThis.document=previousDocument;}

test('outdoor torches fade at dusk and dawn while cave fire stays lit in daylight',()=>{
  const camera=new THREE.PerspectiveCamera();camera.position.set(0,2,4);camera.lookAt(0,2,0);
  const f=[{id:'street',x:0,y:2.65,z:0,mount:'standing'},{id:'cave',x:4,y:2.45,z:0,mount:'wall',alwaysLit:true}];
  const torches=createTorchSystem(new THREE.Scene(),f);
  torches.update(10,0,camera,{x:0,y:0,z:0});assert.equal(torches.flames.material.uniforms.nightAmount.value,0);assert.deepEqual(torches.lights.filter(l=>l.visible).map(l=>l.userData.fixtureId),['cave']);
  torches.update(10,.2,camera,{x:0,y:0,z:0});const dusk=torches.flames.material.uniforms.nightAmount.value;assert.ok(dusk>0&&dusk<1);assert.equal(torches.lights.filter(l=>l.visible).length,2);
  torches.update(10,1,camera,{x:0,y:0,z:0});assert.equal(torches.flames.material.uniforms.nightAmount.value,1);
  torches.update(10,0,camera,{x:0,y:0,z:0});assert.deepEqual(torches.lights.filter(l=>l.visible).map(l=>l.userData.fixtureId),['cave']);
  const attr=torches.flames.geometry.attributes.torchData;assert.equal(attr.getZ(0),0);assert.equal(attr.getZ(4),1);
  assert.ok(torchNightAmount(.25)>torchNightAmount(.1));assert.notEqual(torchFlicker(1,.3),torchFlicker(1.4,.3));torches.dispose();
});

test('all map fire shares a bounded nearest-light pool and dynamic visits reuse flame geometry',()=>{
  const cave=createCaveWorld(),scene=new THREE.Scene(),torches=createTorchSystem(scene,[...world.torchFixtures,...cave.torchFixtures]),camera=new THREE.PerspectiveCamera();
  assert.equal(torches.lights.length,6);assert.ok(torches.lights.every(l=>l.castShadow===false));assert.ok(world.torchFixtures.length>=18);assert.ok(cave.torchFixtures.every(f=>f.alwaysLit));
  let oldLights=0;world.root.traverse(o=>{if(o.isPointLight)oldLights++;});cave.root.traverse(o=>{if(o.isPointLight)oldLights++;});assert.equal(oldLights,0,'no legacy per-lantern light remains');
  const geometry=torches.flames.geometry,baseCount=geometry.drawRange.count;
  torches.update(1,1,camera,{x:0,y:0,z:0},[{id:'visit',x:0,y:2.44,z:0,mount:'existing'}]);assert.equal(geometry.drawRange.count,baseCount+6);assert.ok(torches.lights.some(l=>l.visible&&l.userData.fixtureId==='visit'));
  torches.update(1.2,1,camera,{x:0,y:0,z:0},[]);assert.equal(geometry.drawRange.count,baseCount);assert.equal(torches.flames.geometry,geometry);assert.equal(torches.lights.some(l=>l.visible&&l.userData.fixtureId==='visit'),false);
  camera.position.set(0,-10,-217);torches.update(2,0,camera,{x:0,y:-14,z:-217});assert.ok(torches.lights.some(l=>l.visible));assert.ok(torches.lights.filter(l=>l.visible).every(l=>l.position.y<0&&l.userData.fixtureId.startsWith('cave-')));
  torches.dispose();cave.dispose();
});

test('torch holders and flame anchors avoid building doors, plots and harvesting positions',()=>{
  const cave=createCaveWorld();
  for(const f of world.torchFixtures){
    assert.equal(f.y,groundHeight(f.x,f.z)+2.65);
    for(const b of BUILDINGS){const e=buildingEntrance(b);assert.ok(Math.hypot(f.x-e.x,f.z-e.z)>1,`${f.id} obstructs ${b.id} counter`);assert.ok(Math.abs(f.x-b.x)>b.w/2+.23||Math.abs(f.z-b.z)>b.d/2+.23,`${f.id} clips ${b.id}`);}
    for(const p of PLOTS)assert.ok(Math.abs(f.x-p.x)>p.w/2+.23||Math.abs(f.z-p.z)>p.d/2+.23,`${f.id} clips a deed`);
    for(const n of RESOURCES)assert.ok(Math.hypot(f.x-n.x,f.z-n.z)>1.1,`${f.id} blocks ${n.id}`);
  }
  for(const f of cave.torchFixtures){
    const height=f.y-groundHeight(f.x,f.z),portal=f.id.startsWith('cave-portal-torch-');
    if(portal){
      assert.ok(height>2.65&&height<3,'facade sconces sit higher on the dressed entrance pillars');
      assert.ok(Math.abs(f.x)>6.5,'front-facing holders stay outside the twelve-meter ramp');
      assert.equal(f.nz,1);assert.equal(f.nx,0);
    }else assert.ok(height>2.3&&height<2.7,'interior holders follow the descending cave floor');
    for(const n of RESOURCES.filter(n=>n.caveTier))assert.ok(Math.hypot(f.x-n.x,f.z-n.z)>1.1,'wall torches leave mineral approaches free');
  }
  cave.dispose();
});

test('Resource Exchange has a road-facing counter and connected clear approach without reducing the map',()=>{
  const b=BUILDINGS.find(b=>b.id==='market'),art=world.root.getObjectByName('building-market'),front=buildingEntrance(b);
  assert.equal(PLOTS.length,48);assert.equal(RESOURCES.filter(n=>n.caveTier).length,44);assert.ok(art);assert.deepEqual({x:front.x,z:front.z},{x:9.45,z:-86});
  assert.ok(art.userData.direction.x<-.99);assert.equal(art.userData.front.x,12);
  assert.ok(world.root.userData.lanes.some(l=>l.curve.getPoint(0).distanceTo(new THREE.Vector3(0,.014,-86))<.001&&l.curve.getPoint(1).distanceTo(new THREE.Vector3(9.45,.014,-86))<.001),'exchange spur terminates at the authoritative counter approach');
  world.root.updateMatrixWorld(true);
  const eye=new THREE.Vector3(front.x,1.15,front.z),hits=new THREE.Raycaster(eye,new THREE.Vector3(1,0,0),0,1.5).intersectObject(world.root,true);
  assert.ok(hits.length>0&&hits[0].distance>.35&&hits[0].distance<1.0,'physical counter meets the approach without covering the player');
});

test('torch artwork is batched, finite and releases owned geometry exactly once',()=>{
  const torches=createTorchSystem(new THREE.Scene(),world.torchFixtures),resources=new Set();let calls=0;
  torches.root.traverse(n=>{if(!n.isMesh)return;calls++;resources.add(n.geometry);resources.add(n.material);for(const a of Object.values(n.geometry.attributes))assert.ok(a.array.every(Number.isFinite));});
  assert.ok(calls<=10,`${calls} calls for all outdoor holders and flames`);assert.equal(torches.root.children.filter(n=>n.name==='animated-torch-flames').length,1);
  let disposed=0;for(const r of resources)r.addEventListener('dispose',()=>disposed++);torches.dispose();assert.equal(disposed,resources.size);torches.dispose();assert.equal(disposed,resources.size);
});
