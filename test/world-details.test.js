import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { BUILDINGS, PLOTS, RESOURCES, WALLS, WORLD_BOUNDS, plotBedPoint } from '../shared/world.js';
import { buildingEntrance } from '../shared/access.js';

const threeURL=new URL('../node_modules/three/build/three.module.js',import.meta.url).href;
const sharedURL=new URL('../shared/world.js',import.meta.url).href;
const moduleURL=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const plots=readFileSync(new URL('../public/src/plots-world.js',import.meta.url),'utf8').replace("'three'",JSON.stringify(threeURL)).replace("'/shared/world.js'",JSON.stringify(sharedURL));
const source=readFileSync(new URL('../public/src/world.js',import.meta.url),'utf8').replace("'three'",JSON.stringify(threeURL)).replace("'/shared/world.js'",JSON.stringify(sharedURL)).replace("'./plots-world.js'",JSON.stringify(moduleURL(plots)));
const {createWorld,createWorldDetailLayout,createWorldDetails}=await import(moduleURL(source));
const previousDocument=globalThis.document;
globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>new Proxy({},{get:()=>()=>{},set:()=>true})})};
let world;
try{world=createWorld(new THREE.Scene());}finally{globalThis.document=previousDocument;}
const {detailLayout:layout,detailStats:stats}=world.details.root.userData;
const lanes=world.root.userData.lanes;

test('scenery is deterministic, populated in coherent biomes and preserves resource identities',()=>{
  const before=JSON.stringify(RESOURCES),second=createWorldDetailLayout(lanes);
  assert.deepEqual(second,layout);assert.equal(JSON.stringify(RESOURCES),before);
  assert.ok(layout.length>1800&&layout.length<6500);
  for(const kind of ['grass','fern','shrub','flowers','litter','cover'])assert.ok(layout.some(item=>item.kind===kind),kind);
  for(const zone of ['village','woodland','graveyard'])assert.ok(layout.some(item=>item.zone===zone),zone);
  assert.ok(!layout.some(item=>item.kind==='flowers'&&item.zone==='graveyard'));
  assert.deepEqual([...world.resources.keys()].sort(),RESOURCES.map(item=>item.id).sort());
});

test('full plant footprints clear every building, future plot, doorway, bed and harvest approach',()=>{
  for(const plant of layout){
    const {x,z,radius:r}=plant;
    assert.ok(x-r>=WORLD_BOUNDS.minX&&x+r<=WORLD_BOUNDS.maxX&&z-r>=WORLD_BOUNDS.minZ&&z+r<=WORLD_BOUNDS.maxZ);
    for(const site of [...BUILDINGS,...PLOTS,...WALLS])assert.ok(Math.abs(x-site.x)>=site.w/2+r+.3||Math.abs(z-site.z)>=site.d/2+r+.3,`${plant.kind} overlaps ${site.id??'wall'}`);
    for(const building of BUILDINGS){const door=buildingEntrance(building);assert.ok(Math.hypot(x-door.x,z-door.z)>=r+2,`${building.id} entrance blocked`);}
    const church=BUILDINGS.find(b=>b.id==='church');for(let i=0;i<2;i++){const bed=plotBedPoint(church,i);assert.ok(Math.hypot(x-bed.x,z-bed.z)>=r+2.5,'church bed approach');}
    for(const node of RESOURCES){const room=node.type==='timber'?1.24:node.type==='wheat'?.64:1.94;assert.ok(Math.hypot(x-node.x,z-node.z)>=r+room,`${node.id} gathering ring`);}
    assert.ok(Math.abs(x+14.9)>=6.55+r||Math.abs(z+74.4)>=3.4+r,'parked merchant caravan');
  }
});

test('curved roads, streets and plot access lanes have clear foliage borders',()=>{
  // Independently sample actual lane surfaces densely; include plant radius.
  const points=lanes.flatMap(lane=>lane.curve.getSpacedPoints(Math.ceil(lane.curve.getLength()*3)).map(p=>({x:p.x,z:p.z,width:lane.width})));
  for(const plant of layout)for(const point of points){
    if(Math.abs(plant.x-point.x)>6||Math.abs(plant.z-point.z)>6)continue;
    assert.ok(Math.hypot(plant.x-point.x,plant.z-point.z)>point.width/2+plant.radius+.25,'plant obstructs a rendered lane');
  }
});

test('foliage geometry is finite and instanced with bounded render cost and constant-time wind',()=>{
  assert.equal(stats.drawCalls,7);assert.ok(stats.triangles<250000,JSON.stringify(stats));
  for(const leaf of world.details.root.userData.ivyPlacements){
    const site=BUILDINGS.find(b=>b.id===leaf.building),yaw=site.yaw??0;
    const forward=(leaf.x-site.x)*Math.sin(yaw)+(leaf.z-site.z)*Math.cos(yaw);
    assert.ok(forward<0,'ivy is confined to rear walls');assert.ok(leaf.y<2,'ivy stays low on the facade');
  }
  const before=world.details.root.children.map(mesh=>mesh.instanceMatrix.array.slice());
  for(const mesh of world.details.root.children){
    assert.ok(mesh.isInstancedMesh);assert.equal(mesh.castShadow,false);assert.equal(mesh.userData.resourceId,undefined);
    assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite));assert.ok(mesh.instanceColor.array.every(Number.isFinite));
    assert.ok(mesh.geometry.boundingSphere.radius<1.1,'small decorative plant silhouette');
  }
  for(let i=0;i<600;i++)world.details.update(i/60);
  assert.equal(world.details.time.value,599/60);
  world.details.root.children.forEach((mesh,index)=>assert.deepEqual(mesh.instanceMatrix.array,before[index],'wind does not rewrite thousands of instance transforms'));
  const shader={uniforms:{},vertexShader:'#include <begin_vertex>'};world.details.root.children[0].material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.detailTime,world.details.time);assert.ok(shader.vertexShader.includes('#ifdef USE_INSTANCING'));
  world.details.update(NaN);assert.equal(world.details.time.value,0);
});
