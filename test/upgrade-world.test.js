import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { PLOTS, plotSolid } from '../shared/world.js';
import { createCharacter } from '../public/src/characters.js';
import { createDefenseTroopWorld } from '../public/src/defense-troop-world.js';

const moduleSource=readFileSync(new URL('../public/src/plots-world.js',import.meta.url),'utf8').replace("'three'",JSON.stringify(new URL('../node_modules/three/build/three.module.js',import.meta.url).href)).replace("'/shared/world.js'",JSON.stringify(new URL('../shared/world.js',import.meta.url).href)).replace("'./surface-materials.js'",JSON.stringify(new URL('../public/src/surface-materials.js',import.meta.url).href)).replace("'./environment-geometry.js'",JSON.stringify(new URL('../public/src/environment-geometry.js',import.meta.url).href));
const {createPlotsWorld,createCannonImpactPool,mineralOutcropGeometry}=await import('data:text/javascript;base64,'+Buffer.from(moduleSource).toString('base64'));
function canvasDocument(run){const old=globalThis.document;globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>new Proxy({},{get:()=>()=>{},set:()=>true})})};try{return run();}finally{globalThis.document=old;}}
function meshStats(root){let meshes=0,triangles=0,instances=0;root.traverse(object=>{if(!object.isMesh)return;meshes++;triangles+=(object.geometry.index?.count??object.geometry.attributes.position.count)/3*(object.isInstancedMesh?object.count:1);instances+=object.isInstancedMesh?object.count:1;});return{meshes,triangles,instances};}

test('detailed plot structures use shared textured bevels and stay within a full-village render budget',()=>canvasDocument(()=>{
 const scene=new THREE.Scene(),world=createPlotsWorld(scene),types=['house','tool_shop','tinker_shop','sword_shop','church','barracks','archer_tower','cannon','mine','tree_farm','wheat_farm'];
 world.update({id:'material-budget',clock:0,plots:PLOTS.map((p,i)=>({id:p.id,ownerId:'owner',building:types[i%types.length],level:3,hp:100}))});
 const first=world.root.getObjectByName(`plot-${PLOTS[0].id}`),second=world.root.getObjectByName(`plot-${PLOTS[1].id}`),blocks=first.getObjectByName('plot-box-stone');
 assert.equal(blocks.geometry,second.getObjectByName('plot-box-stone').geometry,'every deed reuses structural geometry');
 assert.equal(blocks.material,second.getObjectByName('plot-box-stone').material,'shared PBR materials survive per-deed rebuilding');
 assert.equal(blocks.material.userData.surface.kind,'masonry');assert.equal(first.getObjectByName('plot-box-wood').material.userData.surface.kind,'wood');assert.equal(first.getObjectByName('plot-box-roof').material.userData.surface.kind,'roof');
 blocks.geometry.computeBoundingBox();assert.deepEqual(blocks.geometry.boundingBox.min.toArray(),[-.5,-.5,-.5]);assert.deepEqual(blocks.geometry.boundingBox.max.toArray(),[.5,.5,.5]);
 const normal=blocks.geometry.attributes.normal;assert.ok(Array.from({length:normal.count},(_,i)=>Math.abs(normal.getX(i))>.1&&Math.abs(normal.getZ(i))>.1).some(Boolean),'beveled edges have real diagonal normals');
 for(const plot of PLOTS){const stats=meshStats(world.root.getObjectByName(`plot-${plot.id}`));assert.ok(stats.meshes<=20,JSON.stringify(stats));assert.ok(stats.triangles<13000,JSON.stringify(stats));}
 const stats=meshStats(world.root);assert.ok(stats.triangles<600000,JSON.stringify(stats));assert.ok(stats.meshes<850,JSON.stringify(stats));
 const owned=new Set();world.root.traverse(mesh=>{if(mesh.isMesh){owned.add(mesh.geometry);owned.add(mesh.material);if(mesh.isInstancedMesh&&mesh.instanceColor)assert.ok(mesh.instanceColor.array.every(Number.isFinite));}});
 let disposed=0;for(const resource of owned)resource.addEventListener('dispose',()=>disposed++);world.dispose();assert.equal(disposed,owned.size);world.dispose();assert.equal(disposed,owned.size);
}));

test('mineral faces retain deterministic embedded ore seams with continuous shared-vertex color',()=>{
 const geometries=['stone','iron','coal'].map(type=>mineralOutcropGeometry(type,184)),same=mineralOutcropGeometry('stone',184);
 assert.deepEqual(geometries[0].attributes.position.array,same.attributes.position.array);
 assert.notDeepEqual(geometries[0].attributes.color.array,geometries[1].attributes.color.array);assert.notDeepEqual(geometries[1].attributes.color.array,geometries[2].attributes.color.array);
 for(const g of geometries){
  const position=g.attributes.position,color=g.attributes.color,points=new Map();assert.ok(position.count/3<1250,'one bounded mesh per mineral node');
  for(let i=0;i<position.count;i++){const key=[position.getX(i),position.getY(i),position.getZ(i)].join(','),tint=[color.getX(i),color.getY(i),color.getZ(i)];if(points.has(key))assert.deepEqual(tint,points.get(key),'a continuous stone face has no random per-triangle color seam');else points.set(key,tint);}
  for(const attribute of Object.values(g.attributes))assert.ok(attribute.array.every(Number.isFinite));g.dispose();
 }
 same.dispose();
});

test('Arcane Academy and elemental tower models stay bounded, preserve entrances and show actual upgrade changes',()=>canvasDocument(()=>{
 const scene=new THREE.Scene(),world=createPlotsWorld(scene),rows=[{id:PLOTS[0].id,ownerId:'wizard',building:'arcane_academy',level:1,hp:700},{id:PLOTS[1].id,ownerId:'wizard',building:'wizard_tower',level:1,hp:800}],state={id:'wizard-models',clock:0,plots:rows};
 world.update(state,0);scene.updateMatrixWorld(true);
 for(const row of rows){
  const model=scene.getObjectByName(`plot-${row.id}`),stats=meshStats(model);assert.ok(stats.meshes<25);assert.ok(stats.instances>50);
  const local=model.clone();local.position.set(0,0,0);local.rotation.set(0,0,0);const bounds=new THREE.Box3().setFromObject(local),site=PLOTS.find(p=>p.id===row.id),quarter=Math.abs(Math.sin(site.yaw??0))>.5;
  assert.ok(bounds.min.x>=-(quarter?site.d:site.w)/2-.15&&bounds.max.x<=(quarter?site.d:site.w)/2+.15);
  assert.ok(bounds.min.z>=-(quarter?site.w:site.d)/2-.15&&bounds.max.z<=(quarter?site.w:site.d)/2+.15);
  const origin=model.localToWorld(new THREE.Vector3(0,1.3,6.1)),direction=new THREE.Vector3(0,0,-1).transformDirection(model.matrixWorld);
  assert.equal(new THREE.Raycaster(origin,direction,0,1.5).intersectObject(model,true).length,0,'front gate lane stays open');
 }
 const first=scene.getObjectByName(`plot-${rows[1].id}`);assert.ok(first.getObjectByName('plot-sphere-ember'));
 rows[1].level=2;world.update(state,1);const upgraded=scene.getObjectByName(`plot-${rows[1].id}`);
 assert.notEqual(first,upgraded);assert.ok(upgraded.getObjectByName('plot-sphere-storm'));assert.ok(upgraded.getObjectByName('plot-ring-gold'));
 world.update(state,2);assert.equal(scene.getObjectByName(`plot-${rows[1].id}`),upgraded,'steady snapshots reuse the static meshes');
 world.dispose();assert.equal(scene.children.length,0);
}));

test('upgraded defenses and production tiers develop distinct geometry without changing plot footprints or entry lanes',()=>canvasDocument(()=>{
 const scene=new THREE.Scene(),world=createPlotsWorld(scene),types=['barracks','church','archer_tower','cannon','mine','tree_farm','wheat_farm'];
 const rows=types.map((building,i)=>({id:PLOTS[i].id,ownerId:'owner',building,level:1,hp:100,maxHp:100})),state={id:'visual-upgrades',clock:0,plots:rows};
 world.update(state,0);const initial=rows.map(row=>scene.getObjectByName(`plot-${row.id}`)),one=initial.map(meshStats),footprints=rows.map((row,i)=>plotSolid(PLOTS[i],row.building));
 for(const row of rows)row.level=2;world.update(state,1);
 for(const[row,i]of rows.map((row,i)=>[row,i])){
  const upgraded=scene.getObjectByName(`plot-${row.id}`);assert.notEqual(upgraded,initial[i]);assert.ok(meshStats(upgraded).instances>one[i].instances,`${row.building} gains actual visible construction`);assert.equal(upgraded.userData.level,2);
  assert.deepEqual(plotSolid(PLOTS[i],row.building),footprints[i]);
 }
 const two=rows.slice(4).map(row=>meshStats(scene.getObjectByName(`plot-${row.id}`)));
 for(const row of rows.slice(4))row.level=3;world.update(state,2);scene.updateMatrixWorld(true);
 for(const[row,i]of rows.slice(4).map((row,i)=>[row,i])){
  const upgraded=scene.getObjectByName(`plot-${row.id}`);assert.equal(upgraded.userData.level,3);assert.ok(meshStats(upgraded).instances>two[i].instances,`${row.building} III adds a developed rear work area`);
  const origin=upgraded.localToWorld(new THREE.Vector3(0,1.3,6.1)),direction=new THREE.Vector3(0,0,-1).transformDirection(upgraded.matrixWorld);
  assert.equal(new THREE.Raycaster(origin,direction,0,1.5).intersectObject(upgraded,true).length,0,'front entrance stays open');
  const local=upgraded.clone();local.position.set(0,0,0);local.rotation.set(0,0,0);const bounds=new THREE.Box3().setFromObject(local),site=PLOTS.find(p=>p.id===row.id),quarter=Math.abs(Math.sin(site.yaw??0))>.5,halfWidth=(quarter?site.d:site.w)/2,halfDepth=(quarter?site.w:site.d)/2;
  assert.ok(bounds.min.x>=-halfWidth-.12&&bounds.max.x<=halfWidth+.12&&bounds.min.z>=-halfDepth-.12&&bounds.max.z<=halfDepth+.12,`${row.building} III equipment stays within its deed fence`);
 }
 const active=scene.getObjectByName(`plot-${rows[0].id}`);world.update(state,3);assert.equal(scene.getObjectByName(`plot-${rows[0].id}`),active,'unchanged snapshots reuse the model');
 world.root.traverse(object=>{if(!object.isMesh)return;for(const attribute of Object.values(object.geometry.attributes))assert.ok(attribute.array.every(Number.isFinite));if(object.isInstancedMesh)assert.ok(object.instanceMatrix.array.every(Number.isFinite));});
 world.dispose();world.dispose();assert.equal(scene.children.length,0);
}));

test('cannon bursts use the exact impact point, stay capped, fade fully, and release all owned resources once',()=>{
 const scene=new THREE.Scene(),pool=createCannonImpactPool(scene,{capacity:3}),point={x:7,y:.9,z:39},matrix=new THREE.Matrix4(),position=new THREE.Vector3();
 assert.equal(pool.emit({x:NaN,y:0,z:0},0),false);
 for(let i=0;i<12;i++)assert.equal(pool.emit(point,i*.01),true);
 assert.equal(pool.stats.active,3);assert.equal(pool.stats.max,3);pool.update(.22);
 const rings=pool.root.getObjectByName('cannon-pressure-rings');assert.equal(rings.count,3);rings.getMatrixAt(0,matrix);position.setFromMatrixPosition(matrix);assert.equal(position.x,point.x);assert.equal(position.z,point.z);assert.ok(Math.abs(position.y-.07)<1e-6);
 assert.ok(pool.root.getObjectByName('cannon-impact-fire').count>0);assert.ok(pool.root.getObjectByName('cannon-impact-sparks').count>0);assert.ok(pool.root.getObjectByName('cannon-impact-smoke').count>0);
 const resources=new Set();pool.root.traverse(object=>{if(!object.isMesh)return;resources.add(object.geometry);resources.add(object.material);assert.ok(object.instanceMatrix.array.every(Number.isFinite));assert.ok(object.geometry.attributes.effectAlpha.array.every(value=>Number.isFinite(value)&&value>=0&&value<=1));});
 assert.equal(meshStats(pool.root).meshes,4);pool.update(2);assert.equal(pool.stats.active,0);assert.ok(pool.root.children.every(mesh=>mesh.count===0));
 let disposed=0;for(const resource of resources)resource.addEventListener('dispose',()=>disposed++);
 pool.dispose();pool.dispose();assert.equal(disposed,resources.size);assert.equal(scene.children.length,0);assert.equal(pool.emit(point,3),false);
});

test('only a newly observed cannon arrival explodes; snapshots, reconnects and long-hidden frames cannot replay impacts',()=>canvasDocument(()=>{
 const scene=new THREE.Scene(),world=createPlotsWorld(scene),site=PLOTS.find(p=>p.id==='outpost-1'),plot={id:site.id,ownerId:'owner',building:'cannon',level:2,hp:100,lastShot:{id:'one',x:0,y:.9,z:38,until:10.35}},state={id:'battle',clock:10,plots:[plot]};
 world.update(state,0);world.update(state,1);assert.equal(world.impactEffects.stats.emitted,0,'joining consumes the stored shot as a baseline');
 state.clock=14;plot.lastShot={...plot.lastShot,id:'two',until:14.35};world.update(state,2);assert.equal(scene.getObjectByName(`shot-${plot.id}`).visible,true);
 world.update(state,2.40);assert.equal(world.impactEffects.stats.emitted,1);assert.equal(world.impactEffects.stats.active,1);assert.equal(scene.getObjectByName(`shot-${plot.id}`).visible,false);
 world.update(state,2.50);assert.equal(world.impactEffects.stats.emitted,1);world.update(state,4);assert.equal(world.impactEffects.stats.active,0);
 state.clock=18;plot.lastShot={...plot.lastShot,id:'three',until:18.35};world.update(state,5);world.update(state,8);assert.equal(world.impactEffects.stats.emitted,1,'a tab returning several seconds later does not replay a blast');
 world.resetEffects();world.update(state,8.1);world.update(state,8.6);assert.equal(world.impactEffects.stats.emitted,1,'reconnect baselines a recent saved shot');
 state.clock=22;plot.lastShot={...plot.lastShot,id:'four',until:22.35};world.update(state,9);world.resetEffects();world.update(state,9.1);world.update(state,9.7);assert.equal(world.impactEffects.stats.emitted,1,'reconnect clears in-flight cosmetic impacts');
 state.id='another-battle';world.update(state,10);world.update(state,11);assert.equal(world.impactEffects.stats.emitted,1);
 state.clock=26;plot.building='archer_tower';plot.lastShot={...plot.lastShot,id:'arrow',until:26.35};world.update(state,12);world.update(state,12.7);assert.equal(world.impactEffects.stats.emitted,1,'arrows do not explode');world.dispose();
}));

test('veteran troop armor follows bones, shares bounded resources and restores original helmets on removal',()=>{
 const rigs=[createCharacter('guard',1),createCharacter('guard',2)],actors=new Map([['a',{rig:rigs[0]}],['b',{rig:rigs[1]}]]),world=createDefenseTroopWorld();
 const state={plots:[{id:'barracks',building:'barracks',level:2}],guards:[{id:'a',plotId:'barracks',hp:220,maxHp:220},{id:'b',plotId:'barracks',hp:160,maxHp:220}]};
 world.update(state,actors,0);assert.equal(world.stats.troops,2);assert.ok(world.stats.geometries<=12);assert.equal(world.stats.materials,2);
 const first=rigs[0].group.getObjectByName('upgraded-watch-head'),second=rigs[1].group.getObjectByName('upgraded-watch-head');assert.ok(first&&second);assert.equal(first.children[0].geometry,second.children[0].geometry);
 assert.equal(rigs[0].group.getObjectByName('forged helmet and cheek protection').visible,false);
 for(let frame=0;frame<30;frame++){rigs[0].update(1/30,frame/30,{moving:true,attack:frame%20<8});world.update(state,actors,frame/30);rigs[0].group.updateMatrixWorld(true);assert.equal(rigs[0].group.getObjectByName('upgraded-watch-head'),first);assert.ok(first.matrixWorld.elements.every(Number.isFinite));}
 const resources=new Set();first.traverse(object=>{if(object.isMesh){resources.add(object.geometry);resources.add(object.material);}});let disposed=0;for(const resource of resources)resource.addEventListener('dispose',()=>disposed++);
 state.guards[0].hp=0;world.update(state,actors,2);assert.equal(first.parent,null);assert.equal(rigs[0].group.getObjectByName('forged helmet and cheek protection').visible,true);assert.equal(disposed,0,'remaining troops retain shared armor resources');
 rigs[1].setRole('priest');world.update(state,actors,3);assert.equal(rigs[1].group.getObjectByName('upgraded-watch-head').parent,rigs[1].group.getObjectByName('head'));assert.equal(second.parent,null);
 world.removePlayer('b');assert.equal(world.stats.troops,0);rigs[1].dispose();assert.equal(disposed,0,'actor disposal cannot dispose armor still used by other troops');
 world.clear();assert.equal(disposed,0);world.dispose();world.dispose();assert.equal(disposed,resources.size);rigs[0].dispose();
});
