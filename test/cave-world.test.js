import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {CAVE_AREAS,CAVE_ROUTE,RESOURCES,groundHeight,caveAreaAt,caveResourceType} from '../shared/world.js';
import {createCaveWorld,createCaveLayout} from '../public/src/cave-world.js';
const threeURL=new URL('../node_modules/three/build/three.module.js',import.meta.url).href,sharedURL=new URL('../shared/world.js',import.meta.url).href;
const moduleURL=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const plots=readFileSync(new URL('../public/src/plots-world.js',import.meta.url),'utf8').replace("'three'",JSON.stringify(threeURL)).replace("'/shared/world.js'",JSON.stringify(sharedURL)).replace("'./surface-materials.js'",JSON.stringify(new URL('../public/src/surface-materials.js',import.meta.url).href)).replace("'./environment-geometry.js'",JSON.stringify(new URL('../public/src/environment-geometry.js',import.meta.url).href));
const source=readFileSync(new URL('../public/src/world.js',import.meta.url),'utf8').replace("'three'",JSON.stringify(threeURL)).replace("'/shared/world.js'",JSON.stringify(sharedURL)).replace("'./surface-materials.js'",JSON.stringify(new URL('../public/src/surface-materials.js',import.meta.url).href)).replace("'./environment-geometry.js'",JSON.stringify(new URL('../public/src/environment-geometry.js',import.meta.url).href)).replace("'./plots-world.js'",JSON.stringify(moduleURL(plots)));
const {createWorld}=await import(moduleURL(source));
const previousDocument=globalThis.document;globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>new Proxy({},{get:()=>()=>{},set:()=>true})})};
let world;try{world=createWorld(new THREE.Scene());}finally{globalThis.document=previousDocument;}
const minerals=RESOURCES.filter(n=>n.caveTier);

function rayHits(root,x,y,z,dx,dy,dz,far=Infinity){root.updateMatrixWorld(true);return new THREE.Raycaster(new THREE.Vector3(x,y,z),new THREE.Vector3(dx,dy,dz).normalize(),0,far).intersectObject(root,true);}

test('cave has one continuous floor following the authoritative ramps and all52 public mineral positions',()=>{
  const cave=createCaveWorld(new THREE.Scene()),floor=cave.root.getObjectByName('continuous-cave-floor'),layout=createCaveLayout();
  assert.equal(minerals.length,52);assert.equal(minerals.filter(node=>node.type==='sulfur').length,8);assert.deepEqual(layout,cave.root.userData.layout);
  for(const point of [...minerals,...CAVE_ROUTE.filter(p=>caveAreaAt(p.x,p.z)),...layout.cells.filter((_,i)=>i%17===0).map(c=>({x:(c.x0+c.x1)/2,z:(c.z0+c.z1)/2}))]){
    const hits=rayHits(floor,point.x,30,point.z,0,-1,0);assert.ok(hits.length>0,`${point.x},${point.z} missingfloor`);
    for(const hit of hits)assert.ok(Math.abs(hit.point.y-groundHeight(point.x,point.z)-.018)<1e-4,'rendered floor agrees with server height without stacked floorplanes');
  }
  for(const area of CAVE_AREAS){const y=groundHeight(area.x,area.z);const hits=rayHits(cave.root.getObjectByName('solid-cave-roof'),area.x,y+1,area.z,0,1,0);assert.ok(hits.length>0);assert.ok(hits[0].point.y-y>5.9,'camera envelope has genuine ceiling clearance');}
  cave.dispose();
});

test('terrain is clipped precisely over the cave, side walls face inward and the mouth is open',()=>{
  for(const n of [...minerals,{x:0,z:-124},{x:9,z:-167},{x:4,z:-198}])assert.equal(rayHits(world.ground,n.x,50,n.z,0,-1,0).length,0,'surface triangles cannot cover cave rooms or ramps');
  for(const p of[{x:6.02,z:-124},{x:-6.02,z:-124},{x:14.03,z:-152},{x:35,z:-182},{x:20,z:-216}])assert.ok(rayHits(world.ground,p.x,50,p.z,0,-1,0).length>0,'clipping does not create coarse holes beyond the cave boundary');
  const cave=createCaveWorld(new THREE.Scene()),walls=cave.root.getObjectByName('inward-facing-cave-walls');
  for(const area of CAVE_AREAS)for(const side of[-1,1]){
    const hits=rayHits(walls,area.x,groundHeight(area.x,area.z)+2,area.z,side,0,0);assert.ok(hits.length>0);assert.ok(hits[0].distance>area.w/2-.2&&hits[0].distance<area.w/2+.1,'a real inward face closes each room side');
  }
  assert.equal(rayHits(cave.root,0,1.45,-114,0,0,-1,25).length,0,'rocks and supports leave a dwarf-height approach through the mouth');cave.dispose();
});

test('the dressed entrance preserves broad body clearance and has paired front-facing always-lit torches',()=>{
  const cave=createCaveWorld(new THREE.Scene());
  for(const x of[-4.8,-2.4,0,2.4,4.8])for(const z of[-116,-118,-120,-123,-128,-136]){
    const from=new THREE.Vector3(x,groundHeight(x,z)+1.45,z),to=new THREE.Vector3(x,groundHeight(x,z-2)+1.45,z-2),direction=to.clone().sub(from);
    assert.equal(rayHits(cave.root,...from.toArray(),...direction.toArray(),direction.length()).length,0,`the usable ramp remains clear at ${x}, ${z}`);
  }
  const front=cave.torchFixtures.filter(f=>f.id.startsWith('cave-portal-torch'));
  assert.equal(front.length,2);assert.equal(front[0].x,-front[1].x);
  assert.ok(front.every(f=>f.nz===1&&f.nx===0&&f.alwaysLit));
  const camera=new THREE.PerspectiveCamera();camera.position.set(0,8,-124);
  assert.equal(cave.update({x:0,z:-126},camera).cutaway,true);
  assert.equal(cave.root.getObjectByName('mouth-rock-crown').visible,false,'portal lintel shares the roof cutaway instead of obscuring the player');
  cave.dispose();
});

test('server resource type controls ore artwork and regrowth only rebuilds when actual type changes',()=>{
  const descriptor=minerals.find(n=>n.caveTier==='middle'),id=descriptor.id,initial=world.resources.get(id),actualType=caveResourceType('middle',descriptor.seed,0);
  const row={...descriptor,type:actualType,available:true,remaining:8,roll:0};world.update(0,0,{id:'cave-art-test',clock:0,resources:[row]});const first=world.resources.get(id);
  assert.equal(first.userData.resourceType,actualType);assert.equal(first.position.y,groundHeight(row.x,row.z));
  const geo=first.geometry;world.update(.1,0,{id:'cave-art-test',clock:.1,resources:[{...row,roll:1}]});assert.equal(world.resources.get(id).geometry,geo,'same-type regrowth does not allocate a new mineral mesh');
  world.update(.2,0,{id:'cave-art-test',clock:.2,resources:[{...row,remaining:0,available:false}]});assert.ok(world.resourceEffects.stats.ghosts>0);
  let disposed=0;geo.addEventListener('dispose',()=>disposed++);const nextType=actualType==='coal'?'iron':'coal';
  world.update(.3,0,{id:'cave-art-test',clock:.3,resources:[{...row,type:nextType,roll:2}]});const next=world.resources.get(id);
  assert.notEqual(next.geometry,geo);assert.equal(next.userData.resourceType,nextType);assert.equal(next.position.y,groundHeight(row.x,row.z));assert.equal(disposed,1);assert.equal(world.resourceEffects.stats.ghosts,0,'stale crumbling copies clear before their old geometry is disposed');
  assert.notEqual(next.geometry.attributes.color.array.toString(),geo.attributes.color.array.toString(),'coal and iron use visibly different embedded strata');
  const oldNames=['Sanctuary quarry','Western iron cut','Eastern coal bed','Outer mineral shelf'];for(const name of oldNames)assert.equal(world.root.getObjectByName(name),undefined);
});

test('mining feedback stays underground instead of snapping particles to the surface',()=>{
  world.resetResourceEffects();const n=minerals.find(n=>n.caveTier==='deep'),row={...n,type:'coal',available:true,remaining:8};
  world.update(1,0,{id:'underground-effects',clock:1,resources:[row]});world.update(1.1,0,{id:'underground-effects',clock:1.1,resources:[{...row,remaining:7}]});
  const pool=world.resourceEffects.root.getObjectByName('harvest-chips'),matrix=new THREE.Matrix4(),p=new THREE.Vector3();assert.ok(pool.count>0);
  for(let i=0;i<pool.count;i++){pool.getMatrixAt(i,matrix);p.setFromMatrixPosition(matrix);assert.ok(p.y< -10&&p.y>=groundHeight(n.x,n.z),'chips begin near the mined face belowground');}
  world.update(1.55,0,{id:'underground-effects',clock:1.55,resources:[{...row,remaining:7}]});for(let i=0;i<pool.count;i++){pool.getMatrixAt(i,matrix);p.setFromMatrixPosition(matrix);assert.ok(p.y< -10,'particlegravity never teleports chips onto y=0');}
});

test('cave cutaway, always-lit torch anchors and geometry stay bounded and dispose cleanly',()=>{
  const scene=new THREE.Scene(),cave=createCaveWorld(scene),camera=new THREE.PerspectiveCamera();
  const outside=cave.update({x:0,z:-110},camera,0);assert.equal(outside.inside,false);assert.equal(outside.caveMix,0);assert.equal(cave.roof.visible,true);
  camera.position.set(0,-9,-217);const inside=cave.update({x:0,z:-217},camera,1);assert.equal(inside.inside,true);assert.equal(inside.caveMix,1);assert.equal(cave.roof.visible,true,'the real ceiling remains visible from inside');
  camera.position.y=3;assert.equal(cave.update({x:0,z:-217},camera,1).cutaway,true);assert.equal(cave.roof.visible,false,'above-ceiling camera can see its player without opaque roof obstruction');
  assert.ok(cave.torchFixtures.length>12);assert.ok(cave.torchFixtures.every(f=>f.alwaysLit&&f.mount==='wall'));assert.equal(cave.root.children.filter(n=>n.isPointLight).length,0,'the shared torch system owns the only nearest-light pool');let calls=0,triangles=0;const resources=new Set();
  cave.root.traverse(m=>{if(!m.isMesh)return;calls++;triangles+=(m.geometry.index?.count??m.geometry.attributes.position.count)/3*(m.isInstancedMesh?m.count:1);for(const a of Object.values(m.geometry.attributes))assert.ok(a.array.every(Number.isFinite));resources.add(m.geometry);resources.add(m.material);});
  assert.ok(calls<28,`${calls} cave draw calls`);assert.ok(triangles<130000,`${triangles} cave triangles`);let disposed=0;for(const resource of resources)resource.addEventListener('dispose',()=>disposed++);
  cave.dispose();assert.equal(disposed,resources.size);cave.dispose();assert.equal(disposed,resources.size);assert.ok(!scene.children.includes(cave.root));
});

test('cave geology, continuous floor and dressed entrance use repeatable world-scale surface detail',()=>{
 const cave=createCaveWorld(new THREE.Scene()),wall=cave.root.getObjectByName('inward-facing-cave-walls'),floor=cave.root.getObjectByName('continuous-cave-floor');
 assert.equal(wall.material.userData.surface.kind,'rock');assert.equal(floor.material.userData.surface.kind,'earth');
 assert.equal(wall.material.userData.surface.projection,'world-triplanar');assert.equal(wall.material.vertexColors,true);
 const portal=cave.mouth.getObjectByName('cave-cut-portal-stone-instances'),timber=cave.mouth.getObjectByName('cave-aged-mine-timber-instances');
 assert.equal(portal.material.userData.surface.kind,'masonry');assert.equal(timber.material.userData.surface.kind,'wood');
 assert.ok(portal.instanceColor.array.some(value=>value!==portal.instanceColor.array[0]),'stone courses receive slight material variation in the same draw call');
 const buffers=[];cave.root.traverse(m=>{if(m.isMesh)buffers.push([m,m.geometry,m.material]);});
 const camera=new THREE.PerspectiveCamera();camera.position.set(0,8,-124);for(let frame=0;frame<120;frame++)cave.update({x:0,z:-126},camera,frame/60);
 for(const[mesh,geometry,material]of buffers){assert.equal(mesh.geometry,geometry);assert.equal(mesh.material,material);}
 cave.dispose();
});


test('ceiling shelves and stalactites join actual roof geometry and clear the camera envelope',()=>{
  const cave=createCaveWorld(new THREE.Scene()),ceiling=cave.root.getObjectByName('solid-cave-roof'),matrix=new THREE.Matrix4(),p=new THREE.Vector3();let checked=0;
  cave.root.updateMatrixWorld(true);
  for(const mesh of cave.roof.children.filter(m=>m.isInstancedMesh))for(let i=0;i<mesh.count;i++){
    mesh.getMatrixAt(i,matrix);matrix.premultiply(mesh.matrixWorld);let attached=false;
    const attr=mesh.geometry.attributes.position;
    for(let j=0;j<attr.count;j++){
      p.fromBufferAttribute(attr,j).applyMatrix4(matrix);if(!caveAreaAt(p.x,p.z))continue;
      assert.ok(p.y>groundHeight(p.x,p.z)+5.45,'ceiling detail stays above the full orbit clearance');
      const hits=rayHits(ceiling,p.x,groundHeight(p.x,p.z)+3,p.z,0,1,0);if(hits[0]&&p.y>=hits[0].point.y-.015)attached=true;
    }
    assert.ok(attached,'rock detail must intersect its ceiling rather than float below it');checked++;
  }
  assert.ok(checked>20);cave.dispose();
});
