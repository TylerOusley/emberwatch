import * as THREE from 'three';
import { troopType } from '../../shared/troops.js';
import { groundHeight } from '../../shared/world.js';

const COVERS=new Set(['swept grooved scalp hair','forged helmet and cheek protection','rolled helmet edge','draped linen hood','cloth opening seam','soft stitched leather cap']);

// A lightweight fitted veteran kit shares its geometry between recruited troops.
// Only the troop's saved strength / barracks tier selects it; player cosmetics
// and crate ownership are independent and never read by this renderer.
export function createDefenseTroopWorld(scene=null){
 const records=new Map(),geometries=new Set(),materials=new Set(),unitTemplates=new Map(),seenShots=new Map(),shots=[];
 let templates=null,disposed=false,shotAssets=null,shotVillage=null;
 function buildTemplates(){
  if(templates)return;templates=new Map();
  const steel=new THREE.MeshStandardMaterial({color:0xa7bac0,metalness:.7,roughness:.46}),gold=new THREE.MeshStandardMaterial({color:0xd1aa57,metalness:.66,roughness:.5});materials.add(steel);materials.add(gold);
  const base={box:new THREE.BoxGeometry(1,1,1),cap:new THREE.SphereGeometry(1,14,7,0,Math.PI*2,0,Math.PI*.52),ring:new THREE.TorusGeometry(1,.065,4,16)},batches=new Map(),dummy=new THREE.Object3D();
  function add(bone,geometry,mat,position=[0,0,0],scale=[1,1,1],rotation=[0,0,0]){
   const key=`${bone}:${mat.uuid}`;if(!batches.has(key))batches.set(key,{bone,mat,positions:[],normals:[]});
   dummy.position.set(...position);dummy.scale.set(...scale);dummy.rotation.set(...rotation);dummy.updateMatrix();
   const transformed=geometry.clone().applyMatrix4(dummy.matrix),flat=transformed.index?transformed.toNonIndexed():transformed;
   batches.get(key).positions.push(...flat.attributes.position.array);batches.get(key).normals.push(...flat.attributes.normal.array);
   if(flat!==transformed)flat.dispose();transformed.dispose();
  }
  function trim(bone,points,radius=.012){const geometry=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),Math.max(8,points.length*3),radius,4,false);add(bone,geometry,gold);geometry.dispose();}
  add('head',base.cap,steel,[0,.16,-.055],[.35,.27,.315]);
  add('head',base.ring,gold,[0,.16,-.055],[.35,.315,.35],[Math.PI/2,0,0]);
  add('head',base.box,gold,[0,.025,.28],[.047,.29,.037]);
  add('head',base.box,gold,[0,.447,-.07],[.068,.10,.38]);
  for(const side of[-1,1])add('head',base.box,steel,[side*.293,.069,-.015],[.048,.18,.30],[0,0,side*.11]);
  const rows=[[-.17,.36,.335],[.10,.46,.375],[.38,.37,.34]],positions=[],indices=[];
  for(const[y,w,d]of rows)for(let i=0;i<=10;i++){const a=(i/10-.5)*Math.PI;positions.push(Math.sin(a)*w,y,.05+Math.cos(a)*d);}
  for(let row=0;row<2;row++)for(let i=0;i<10;i++){const a=row*11+i,b=a+11;indices.push(a,a+1,b,a+1,b+1,b);}
  const plate=new THREE.BufferGeometry();plate.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));plate.setIndex(indices);plate.computeVertexNormals();add('body',plate,steel);plate.dispose();
  for(const[y,w,d]of[rows[0],rows[2]])trim('body',Array.from({length:9},(_,i)=>{const a=(i/8-.5)*Math.PI;return[Math.sin(a)*w,y,.067+Math.cos(a)*d];}),.014);
  for(const side of[-1,1])trim('body',[[side*.26,.30,.36],[side*.12,.13,.431],[0,.20,.438]],.013);
  add('body',base.box,gold,[0,.045,.437],[.10,.10,.027],[0,0,Math.PI/4]);
  for(const side of[-1,1]){
   const arm=side===1?'leftArm':'rightArm',shin=side===1?'leftShin':'rightShin';
   add(arm,base.cap,steel,[side*.035,.015,0],[.235,.145,.245]);
   add(arm,base.box,gold,[side*.035,.072,.235],[.27,.045,.037]);
   add(shin,base.box,steel,[0,-.055,.169],[.225,.295,.045]);
   add(shin,base.box,gold,[0,-.055,.197],[.036,.265,.027]);
  }
  for(const{bone,mat,positions,normals}of batches.values()){
   if(!templates.has(bone)){const group=new THREE.Group();group.name=`upgraded-watch-${bone}`;templates.set(bone,group);}
   const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.computeBoundingSphere();geometries.add(geometry);
   const mesh=new THREE.Mesh(geometry,mat);mesh.castShadow=mesh.receiveShadow=true;templates.get(bone).add(mesh);
  }
  for(const geometry of Object.values(base))geometry.dispose();
 }
 function remove(record){for(const part of record.parts)part.removeFromParent();for(const {object,visible}of record.hidden)object.visible=visible;}
 function unitKit(type){
  if(unitTemplates.has(type))return unitTemplates.get(type);
  const color=type==='archer'?0x456845:0x705142,cloth=new THREE.MeshStandardMaterial({color,roughness:.96}),leather=new THREE.MeshStandardMaterial({color:0x563927,roughness:.85});materials.add(cloth);materials.add(leather);
  const box=new THREE.BoxGeometry(1,1,1),cap=new THREE.SphereGeometry(1,10,6,0,Math.PI*2,0,Math.PI*.55);geometries.add(box);geometries.add(cap);
  const head=new THREE.Group(),body=new THREE.Group();head.name=`${type}-headgear`;body.name=`${type}-supplies`;
  const hat=new THREE.Mesh(cap,cloth);hat.position.set(0,.18,-.045);hat.scale.set(.35,.3,.32);head.add(hat);
  const strap=new THREE.Mesh(box,leather);strap.position.set(0,.13,.404);strap.scale.set(.075,.6,.025);strap.rotation.z=-.57;body.add(strap);
  const pouch=new THREE.Mesh(box,leather);pouch.position.set(type==='archer'?.23:-.28,type==='archer'?.08:-.15,type==='archer'?-.34:.29);pouch.scale.set(type==='archer'?.19:.22,type==='archer'?.62:.20,.16);body.add(pouch);
  if(type==='archer')for(let i=0;i<3;i++){const shaft=new THREE.Mesh(box,cloth);shaft.position.set(.17+i*.06,.51,-.34);shaft.scale.set(.025,.36,.025);body.add(shaft);}
  for(const part of[head,body])part.traverse(object=>{if(object.isMesh)object.castShadow=object.receiveShadow=true;});
  const kit=new Map([['head',head],['body',body]]);unitTemplates.set(type,kit);return kit;
 }
 function removePlayer(id){const record=records.get(id);if(record){remove(record);records.delete(id);}seenShots.delete(id);}
 function clear(){for(const record of records.values())remove(record);records.clear();seenShots.clear();for(const shot of shots)shot.group.removeFromParent();shots.length=0;shotVillage=null;}
 function updateShots(state,time){
  if(!scene)return;
  if(shotVillage!==state.id){seenShots.clear();for(const shot of shots)shot.group.removeFromParent();shots.length=0;shotVillage=state.id;}
  const live=new Set();
  for(const entity of[...(state.guards??[]),...(state.players??[])]){
   live.add(entity.id);const shot=entity.lastShot,previous=seenShots.get(entity.id);seenShots.set(entity.id,shot?.id??null);
   if(!shot||previous===undefined||previous===shot.id||!['bow','musket'].includes(shot.kind)||!(state.clock-(shot.at??shot.firedAt)>=0)||state.clock-(shot.at??shot.firedAt)>.8)continue;
   const from={x:shot.from?.x??shot.fromX,z:shot.from?.z??shot.fromZ},to={x:shot.to?.x??shot.x,z:shot.to?.z??shot.z};
   if(![from.x,from.z,to.x,to.z].every(Number.isFinite))continue;
   if(!shotAssets){
    const box=new THREE.BoxGeometry(1,1,1),sphere=new THREE.SphereGeometry(1,6,4),arrow=new THREE.MeshBasicMaterial({color:0xa97842}),tracer=new THREE.MeshBasicMaterial({color:0xffd490}),smoke=new THREE.MeshBasicMaterial({color:0xb9b4a7,transparent:true,opacity:.38,depthWrite:false});
    geometries.add(box);geometries.add(sphere);for(const material of[arrow,tracer,smoke])materials.add(material);shotAssets={box,sphere,arrow,tracer,smoke};
   }
   if(shots.length>=32){const oldest=shots.shift();oldest.group.removeFromParent();}
   const group=new THREE.Group();group.name=`ranged-shot-${entity.id}`;
   const mesh=new THREE.Mesh(shotAssets.box,shot.kind==='bow'?shotAssets.arrow:shotAssets.tracer);group.add(mesh);
   const start=new THREE.Vector3(from.x,shot.fromY??groundHeight(from.x,from.z)+1.35,from.z),end=new THREE.Vector3(to.x,shot.y??groundHeight(to.x,to.z)+.9,to.z);
   let smoke=null;if(shot.kind==='musket'){smoke=new THREE.Mesh(shotAssets.sphere,shotAssets.smoke);smoke.position.copy(start);group.add(smoke);}
   scene.add(group);shots.push({group,mesh,smoke,start,end,kind:shot.kind,born:time});
  }
  for(const id of seenShots.keys())if(!live.has(id))seenShots.delete(id);
  for(let i=shots.length-1;i>=0;i--){
   const shot=shots[i],age=time-shot.born,duration=shot.kind==='bow'?.35:.4;
   if(age<0||age>=duration){shot.group.removeFromParent();shots.splice(i,1);continue;}
   if(shot.kind==='bow'){
    shot.mesh.position.lerpVectors(shot.start,shot.end,Math.min(1,age/.3));shot.mesh.lookAt(shot.end);shot.mesh.scale.set(.025,.025,.8);
   }else{
    shot.mesh.visible=age<.1;shot.mesh.position.copy(shot.start).lerp(shot.end,.5);shot.mesh.lookAt(shot.end);shot.mesh.scale.set(.025,.025,shot.start.distanceTo(shot.end));shot.smoke.scale.setScalar(.1+age*1.2);shot.smoke.position.y=shot.start.y+age*.5;
   }
  }
 }
 function update(state={},actors=new Map(),_time=0){
  if(disposed)return;
  const plots=new Map((Array.isArray(state.plots)?state.plots:Object.values(state.plots??{})).map(plot=>[plot.id,plot])),live=new Set();
  for(const guard of state.guards??[]){
   const plot=plots.get(guard.plotId),type=troopType(guard),upgraded=guard.plotId&&(guard.troopLevel===undefined?(guard.maxHp>=220||plot?.building==='barracks'&&plot.level>=2):guard.troopLevel>=2),key=`${type}:${Boolean(upgraded)}`;
   const group=actors.get(guard.id)?.rig?.group,body=group?.getObjectByName('body');
   if((!upgraded&&type==='sword')||!(guard.hp>0)||!body?.isBone)continue;
   live.add(guard.id);let record=records.get(guard.id);
   if(record?.body===body&&record.key===key)continue;
   if(record){remove(record);records.delete(guard.id);}if(upgraded)buildTemplates();
   const parts=[...(upgraded?templates:[]),...(type==='sword'?[]:unitKit(type))];
   if(!parts.every(([name])=>group.getObjectByName(name)?.isBone))continue;
   record={body,key,parts:[],hidden:[]};
   group.getObjectByName('head').traverse(object=>{if(COVERS.has(object.name)){record.hidden.push({object,visible:object.visible});object.visible=false;}});
   for(const[bone,template]of parts){if(upgraded&&type!=='sword'&&bone==='head'&&template.name.endsWith('headgear'))continue;const part=template.clone(true);group.getObjectByName(bone).add(part);record.parts.push(part);}
   records.set(guard.id,record);
  }
  for(const[id,record]of records)if(!live.has(id)){remove(record);records.delete(id);}
  updateShots(state,_time);
 }
 return{update,clear,removePlayer,get stats(){return{troops:records.size,shots:shots.length,geometries:geometries.size,materials:materials.size};},dispose(){if(disposed)return;clear();disposed=true;for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();geometries.clear();materials.clear();templates?.clear();unitTemplates.clear();}};
}
