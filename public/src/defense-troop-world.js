import * as THREE from 'three';

const COVERS=new Set(['swept grooved scalp hair','forged helmet and cheek protection','rolled helmet edge','draped linen hood','cloth opening seam','soft stitched leather cap']);

// A lightweight fitted veteran kit shares its geometry between recruited troops.
// Only the troop's saved strength / barracks tier selects it; player cosmetics
// and crate ownership are independent and never read by this renderer.
export function createDefenseTroopWorld(){
 const records=new Map(),geometries=new Set(),materials=new Set();let templates=null,disposed=false;
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
 function removePlayer(id){const record=records.get(id);if(record){remove(record);records.delete(id);}}
 function clear(){for(const record of records.values())remove(record);records.clear();}
 function update(state={},actors=new Map(),_time=0){
  if(disposed)return;
  const plots=new Map((Array.isArray(state.plots)?state.plots:Object.values(state.plots??{})).map(plot=>[plot.id,plot])),live=new Set();
  for(const guard of state.guards??[]){
   const plot=plots.get(guard.plotId),upgraded=guard.plotId&&(guard.maxHp>=220||plot?.building==='barracks'&&plot.level>=2);
   const group=actors.get(guard.id)?.rig?.group,body=group?.getObjectByName('body');
   if(!upgraded||!(guard.hp>0)||!body?.isBone)continue;
   live.add(guard.id);let record=records.get(guard.id);
   if(record?.body===body)continue;
   if(record){remove(record);records.delete(guard.id);}buildTemplates();
   if(![...templates.keys()].every(name=>group.getObjectByName(name)?.isBone))continue;
   record={body,parts:[],hidden:[]};
   group.getObjectByName('head').traverse(object=>{if(COVERS.has(object.name)){record.hidden.push({object,visible:object.visible});object.visible=false;}});
   for(const[bone,template]of templates){const part=template.clone(true);group.getObjectByName(bone).add(part);record.parts.push(part);}
   records.set(guard.id,record);
  }
  for(const[id,record]of records)if(!live.has(id)){remove(record);records.delete(id);}
 }
 return{update,clear,removePlayer,get stats(){return{troops:records.size,geometries:geometries.size,materials:materials.size};},dispose(){if(disposed)return;clear();disposed=true;for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();geometries.clear();materials.clear();templates?.clear();}};
}
