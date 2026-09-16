import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { BUILDINGS, PLOTS, RESOURCES, WALLS, WORLD_BOUNDS, plotBedPoint } from '../shared/world.js';
import { buildingEntrance } from '../shared/access.js';
import { createOrganicTreeGeometry, createWheatGeometry, createMountainGeometry } from '../public/src/environment-geometry.js';

const threeURL=new URL('../node_modules/three/build/three.module.js',import.meta.url).href;
const sharedURL=new URL('../shared/world.js',import.meta.url).href;
const moduleURL=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const plots=readFileSync(new URL('../public/src/plots-world.js',import.meta.url),'utf8').replace("'three'",JSON.stringify(threeURL)).replace("'/shared/world.js'",JSON.stringify(sharedURL)).replace("'./surface-materials.js'",JSON.stringify(new URL('../public/src/surface-materials.js',import.meta.url).href)).replace("'./environment-geometry.js'",JSON.stringify(new URL('../public/src/environment-geometry.js',import.meta.url).href));
const source=readFileSync(new URL('../public/src/world.js',import.meta.url),'utf8').replace("'three'",JSON.stringify(threeURL)).replace("'/shared/world.js'",JSON.stringify(sharedURL)).replace("'./plots-world.js'",JSON.stringify(moduleURL(plots))).replace("'./surface-materials.js'",JSON.stringify(new URL('../public/src/surface-materials.js',import.meta.url).href)).replace("'./environment-geometry.js'",JSON.stringify(new URL('../public/src/environment-geometry.js',import.meta.url).href));
const {createWorld,createWorldDetailLayout,createWorldDetails,carveGroundForCave}=await import(moduleURL(source));
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

test('organic harvest meshes remain deterministic, finite and rooted at the saved resource pivot',()=>{
  for(const pine of [true,false]){
    const first=createOrganicTreeGeometry(315,{pine,height:6}),again=createOrganicTreeGeometry(315,{pine,height:6}),distant=createOrganicTreeGeometry(315,{pine,height:6,detail:.65});
    let triangles=0,distantTriangles=0;
    for(const part of ['trunk','foliage']){
      assert.deepEqual(first[part].attributes.position.array,again[part].attributes.position.array);
      assert.deepEqual(first[part].index.array,again[part].index.array);
      for(const geometry of [first[part],distant[part]]){
        assert.ok(geometry.attributes.position.array.every(Number.isFinite));assert.ok(geometry.attributes.normal.array.every(Number.isFinite));
        assert.ok(geometry.index.array.every(i=>i<geometry.attributes.position.count));
        assert.ok(geometry.boundingBox.min.y>-.2&&geometry.boundingBox.max.y<6.8);
        assert.ok(Math.max(Math.abs(geometry.boundingBox.min.x),Math.abs(geometry.boundingBox.max.x),Math.abs(geometry.boundingBox.min.z),Math.abs(geometry.boundingBox.max.z))<3.7);
      }
      triangles+=first[part].index.count/3;distantTriangles+=distant[part].index.count/3;
      first[part].dispose();again[part].dispose();distant[part].dispose();
    }
    assert.ok(triangles<5500);assert.ok(distantTriangles<triangles*.85,'distant trees retain the branching silhouette at lower detail');
  }
  const crop=createWheatGeometry(722);
  for(const geometry of Object.values(crop)){
    assert.ok(geometry.attributes.position.array.every(Number.isFinite));
    assert.ok(geometry.boundingBox.min.y>=-.015&&geometry.boundingBox.max.y<1.4);
    assert.ok(geometry.index.count/3<1000);geometry.dispose();
  }
});

test('mountain ridges stay inside the previous instance envelope and distant patches can cull independently',()=>{
  for(const seed of [301,324,347,370]){
    const ridge=createMountainGeometry(seed),p=ridge.attributes.position;
    for(let i=0;i<p.count;i++)assert.ok(Math.abs(p.getX(i))<=1&&Math.abs(p.getZ(i))<=1&&p.getY(i)>=-.50001&&p.getY(i)<=.50001);
    assert.ok(p.array.every(Number.isFinite));assert.ok(ridge.attributes.normal.array.every(Number.isFinite));
    assert.ok(ridge.index.count/3<=1200);ridge.dispose();
  }
  const transform=new THREE.Matrix4(),position=new THREE.Vector3();let forestPatches=0,ridgePatches=0;
  world.root.traverse(mesh=>{
    if(!mesh.isInstancedMesh||!mesh.geometry.userData.forest&&!mesh.geometry.userData.distantMountain)return;
    const forest=mesh.geometry.userData.forest,cell=forest?32:64,sectors=new Set();
    for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,transform);position.setFromMatrixPosition(transform);sectors.add(`${Math.floor(position.x/cell)},${Math.floor(position.z/cell)}`);}
    assert.equal(sectors.size,1,'a distant scenery batch never spans the entire village');
    forest?forestPatches++:ridgePatches++;
  });
  assert.ok(forestPatches>16&&ridgePatches>12);
});

test('terrain carving preserves smooth interpolated normals without bridging the cave opening',()=>{
  const source=new THREE.BufferGeometry();
  source.setAttribute('position',new THREE.Float32BufferAttribute([-2,0,-2,2,0,-2,-2,0,2],3));
  const normals=[[0,1,0],[.6,.8,0],[0,.8,.6]];
  source.setAttribute('normal',new THREE.Float32BufferAttribute(normals.flat(),3));
  const carved=carveGroundForCave(source,[{x:0,z:0,w:1,d:1}]),p=carved.attributes.position,n=carved.attributes.normal;
  let interpolated=false;
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),z=p.getZ(i),b=(x+2)/4,c=(z+2)/4,a=1-b-c;
    const expected=new THREE.Vector3(...normals[0]).multiplyScalar(a).addScaledVector(new THREE.Vector3(...normals[1]),b).addScaledVector(new THREE.Vector3(...normals[2]),c).normalize();
    assert.ok(expected.distanceTo(new THREE.Vector3().fromBufferAttribute(n,i))<1e-6,'clipping retains the source smooth shading');
    assert.ok(Math.abs(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))-1)<1e-6);
    if(Math.abs(x)===.5||Math.abs(z)===.5)interpolated=true;
  }
  for(let i=0;i<p.count;i+=3){const x=(p.getX(i)+p.getX(i+1)+p.getX(i+2))/3,z=(p.getZ(i)+p.getZ(i+1)+p.getZ(i+2))/3;assert.ok(Math.abs(x)>=.5-1e-6||Math.abs(z)>=.5-1e-6);}
  assert.ok(interpolated);source.dispose();carved.dispose();
});

test('complete village geometry stays within representative camera budgets',()=>{
  world.root.updateMatrixWorld(true);
  function cost(camera){
    const frustum=camera?new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse)):null;
    let calls=0,triangles=0;
    world.root.traverse(mesh=>{
      if(!mesh.isMesh)return;for(let parent=mesh;parent;parent=parent.parent)if(!parent.visible)return;
      if(frustum&&mesh.frustumCulled&&!frustum.intersectsObject(mesh))return;
      const count=mesh.isInstancedMesh?mesh.count:1;if(!count)return;
      calls+=Array.isArray(mesh.material)?mesh.geometry.groups.length:1;
      triangles+=Math.min(mesh.geometry.index?.count??mesh.geometry.attributes.position.count,mesh.geometry.drawRange.count)/3*count;
    });return {calls,triangles};
  }
  const all=cost();assert.ok(all.calls<1200,JSON.stringify(all));assert.ok(all.triangles<1_400_000,JSON.stringify(all));
  for(const [eye,target,budget]of [[[0,6,8],[0,2,-6],650_000],[[0,8,-44],[0,2,-66],525_000],[[0,8,-97],[0,5,-135],450_000]]){
    const camera=new THREE.PerspectiveCamera(60,16/9,.1,540);camera.position.fromArray(eye);camera.lookAt(new THREE.Vector3(...target));camera.updateMatrixWorld();
    const visible=cost(camera);assert.ok(visible.triangles<budget,JSON.stringify({eye,...visible}));assert.ok(visible.calls<460,JSON.stringify({eye,...visible}));
  }
});

test('slate roofs have individual overlapping tiles and preserve hard normals at gable creases',()=>{
  let tiles=0,shells=0;
  world.root.traverse(mesh=>{
    if(!mesh.isMesh)return;
    if(mesh.geometry.userData.roofTiles){assert.ok(mesh.isInstancedMesh);tiles+=mesh.count;assert.equal(mesh.geometry.index.count/3,10);}
    if(mesh.geometry.name!=='flat-faced-gabled-roof')return;
    shells++;const p=mesh.geometry.attributes.position,n=mesh.geometry.attributes.normal;
    assert.equal(mesh.geometry.index,null);
    for(let i=0;i<p.count;i+=3){
      const a=new THREE.Vector3().fromBufferAttribute(p,i),b=new THREE.Vector3().fromBufferAttribute(p,i+1),c=new THREE.Vector3().fromBufferAttribute(p,i+2);
      const face=b.sub(a).cross(c.sub(a)).normalize();
      for(let j=0;j<3;j++)assert.ok(face.distanceTo(new THREE.Vector3().fromBufferAttribute(n,i+j))<1e-6,'roof slope and gable must not share smoothed corner normals');
    }
  });
  assert.ok(shells>=8);assert.ok(tiles>1200&&tiles<3000,'bounded thin tiles replace the broad alternating strips');
});
