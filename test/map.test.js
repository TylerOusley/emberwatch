import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PLOTS, BUILDINGS, WORLD_BOUNDS, GUARD_ROAD, RESOURCES, WALLS, plotFront, plotSolid, plotSolids, plotBedPoint, plotAccessRoute, canStand, moveWithCollision } from '../shared/world.js';

const overlaps=(a,b,padding=0)=>Math.abs(a.x-b.x)<(a.w+b.w)/2+padding&&Math.abs(a.z-b.z)<(a.d+b.d)/2+padding;

test('all 48 deeds have clear footprints and a usable road-facing approach',()=>{
 assert.equal(PLOTS.filter(p=>!p.outside).length,40);assert.equal(PLOTS.filter(p=>p.outside).length,8);
 assert.equal(new Set(PLOTS.map(p=>p.id)).size,PLOTS.length);
 for(const [index,plot] of PLOTS.entries()){
  assert.ok(!PLOTS.slice(index+1).some(other=>overlaps(plot,other)),`${plot.id} overlaps another deed`);
  assert.ok(![...BUILDINGS,...WALLS].some(other=>overlaps(plot,other)),`${plot.id} overlaps permanent architecture`);
  const solid=plotSolid(plot,plot.outside?'archer_tower':'barracks');
  for(const point of plotAccessRoute(plot))assert.ok(canStand(point.x,point.z,.48,[solid]),`${plot.id} has a blocked approach`);
  const front=plotFront(plot,1);assert.ok(canStand(front.x,front.z,.8,[solid]));
  assert.ok(plot.x-plot.w/2>WORLD_BOUNDS.minX&&plot.x+plot.w/2<WORLD_BOUNDS.maxX);
 }
});

test('public resource gathering stays outside plot fences',()=>{
 for(const resource of RESOURCES)assert.ok(!PLOTS.some(plot=>Math.abs(resource.x-plot.x)<plot.w/2+2&&Math.abs(resource.z-plot.z)<plot.d/2+2),`${resource.id} intrudes on a deed`);
 assert.equal(RESOURCES.filter(r=>['stone','iron','coal'].includes(r.type)).length,44);
 assert.ok(RESOURCES.filter(r=>['stone','iron','coal'].includes(r.type)).every(r=>r.caveTier&&r.z< -118),'public minerals now live inside the mountain mine');
});

test('new and saved watch guards can follow their road out of the east-facing barracks',()=>{
 for(const origin of [GUARD_ROAD[0],{x:-22,z:3},{x:-20.5,z:3}]){
  const guard={...origin};
  for(const destination of GUARD_ROAD.slice(1)){
   let steps=0;
   while(Math.hypot(guard.x-destination.x,guard.z-destination.z)>.25&&steps++<1500){
    const length=Math.hypot(destination.x-guard.x,destination.z-guard.z);
    moveWithCollision(guard,(destination.x-guard.x)/length*.1,(destination.z-guard.z)/length*.1);
    assert.ok(canStand(guard.x,guard.z));
   }
   assert.ok(steps<1500,`guard stuck before ${JSON.stringify(destination)}`);
  }
  assert.ok(guard.z>37.5);
 }
});

test('authored buildings face their lanes, and plotted structures render all supported types',async()=>{
 // Structural scene validation works without a GPU; this is deliberately not
 // a screenshot test. It catches geometry, entrances and invalid transforms.
 const THREE=await import('three');
 const sharedURL=new URL('../shared/world.js',import.meta.url).href;
 const threeURL=new URL('../node_modules/three/build/three.module.js',import.meta.url).href;
 const asModule=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
 const plotSource=readFileSync(new URL('../public/src/plots-world.js',import.meta.url),'utf8').replace("'three'",JSON.stringify(threeURL)).replace("'/shared/world.js'",JSON.stringify(sharedURL)).replace("'./surface-materials.js'",JSON.stringify(new URL('../public/src/surface-materials.js',import.meta.url).href)).replace("'./environment-geometry.js'",JSON.stringify(new URL('../public/src/environment-geometry.js',import.meta.url).href));
 const worldSource=readFileSync(new URL('../public/src/world.js',import.meta.url),'utf8').replace("'three'",JSON.stringify(threeURL)).replace("'/shared/world.js'",JSON.stringify(sharedURL)).replace("'./plots-world.js'",JSON.stringify(asModule(plotSource))).replace("'./surface-materials.js'",JSON.stringify(new URL('../public/src/surface-materials.js',import.meta.url).href)).replace("'./environment-geometry.js'",JSON.stringify(new URL('../public/src/environment-geometry.js',import.meta.url).href));
 const noop=()=>{},previousDocument=globalThis.document;
 globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>new Proxy({},{get:()=>noop,set:()=>true})})};
 try{
  const {createWorld}=await import(asModule(worldSource));
  const scene=new THREE.Scene(),world=createWorld(scene);
  const watch=scene.getObjectByName('building-barracks');
  assert.ok(Math.abs(watch.userData.front.x+17)<1e-8);assert.ok(Math.abs(watch.userData.front.z+3)<1e-8);assert.ok(Math.abs(watch.userData.direction.x-1)<1e-8);
  for(const building of BUILDINGS){
   const {front,direction}=scene.getObjectByName(`building-${building.id}`).userData;
   assert.ok(canStand(front.x+direction.x*2.3,front.z+direction.z*2.3),`${building.id} entrance blocked`);
  }
  const types=['tool_shop','tinker_shop','mine','tree_farm','wheat_farm','house','barracks','sword_shop','church','archer_tower','cannon'];
  const state={resources:[],plots:types.map((building,index)=>({id:PLOTS[index].id,ownerId:'dwarf',building,level:2,hp:100,maxHp:100})),clock:10,plotResources:[{id:'test-wheat',type:'wheat',x:PLOTS[4].x,z:PLOTS[4].z,available:true},{id:'test-iron',type:'iron',x:PLOTS[2].x,z:PLOTS[2].z,available:true}]};
  world.update(1,.5,state);scene.updateMatrixWorld(true);
  assert.ok(world.resources.get('test-wheat').visible);assert.ok(world.resources.get('test-iron').visible);
  state.plotResources[0].available=false;world.update(1.1,.5,state);assert.equal(world.resources.get('test-wheat').visible,false);
  for(let index=0;index<4;index++){const point=plotBedPoint(PLOTS[8],index);assert.ok(canStand(point.x,point.z,.48,[plotSolid(PLOTS[8],'church')]));}
  const cannon=state.plots.at(-1);cannon.lastShot={x:0,z:38,until:10.4};
  world.update(1.2,.5,state);assert.ok(scene.getObjectByName(`shot-${cannon.id}`).visible);
  world.update(1.9,.5,state);assert.equal(scene.getObjectByName(`shot-${cannon.id}`).visible,false);
  cannon.hp=0;world.update(2,.5,state);assert.equal(scene.getObjectByName(`plot-${cannon.id}`).userData.ruined,true);assert.equal(plotSolids([cannon]).length,0);
  state.plotResources=[];world.update(2.1,.5,state);assert.equal(world.resources.has('test-wheat'),false);assert.equal(world.resources.has('test-iron'),false);
  for(const [index,building] of types.entries())assert.equal(scene.getObjectByName(`plot-${PLOTS[index].id}`).userData.building,building);
  for(const [index,lane] of world.root.userData.lanes.entries()){
   const samples=lane.curve.getSpacedPoints(Math.ceil(lane.curve.getLength()*3));
   const solids=PLOTS.map(plot=>plotSolid(plot,plot.outside?'archer_tower':'barracks'));
   for(const point of samples)assert.ok(canStand(point.x,point.z,.48,solids),`lane ${index} blocked at ${point.x.toFixed(1)},${point.z.toFixed(1)}`);
  }
  scene.traverse(object=>{assert.ok(object.matrixWorld.elements.every(Number.isFinite));if(object.isInstancedMesh)assert.ok(object.instanceMatrix.array.every(Number.isFinite));});
 }finally{globalThis.document=previousDocument;}
});
