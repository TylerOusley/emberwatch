import * as THREE from 'three';
import { PLOTS, plotFront, seeded } from '/shared/world.js';

// Plot buildings share the village's warm timber, pale stone and blue roofs.
// Each deed is one batched group, replaced only when its structure changes.
export function createPlotsWorld(parent){
 const root=new THREE.Group();root.name='Village neighborhoods';parent.add(root);
 const geometries={box:new THREE.BoxGeometry(1,1,1),cylinder:new THREE.CylinderGeometry(1,1,1,8),cone:new THREE.ConeGeometry(1,1,6),rock:new THREE.IcosahedronGeometry(1,0)};
 const colors={stone:'#8b9484',pale:'#d8c495',wood:'#805b38',dark:'#3a3028',roof:'#315b61',trim:'#aa8051',iron:'#344047',glass:'#edbc69',cloth:'#ac6249',purple:'#766080',leaf:'#64854a',dirt:'#6d593c',gold:'#d9b452'};
 const materials=Object.fromEntries(Object.entries(colors).map(([id,color])=>[id,new THREE.MeshStandardMaterial({color,roughness:.9,...(id==='glass'?{emissive:color,emissiveIntensity:.3}:{})})]));
 const records=new Map(),shots=new Map(),dummy=new THREE.Object3D();
 const shotDirection=new THREE.Vector3(),forward=new THREE.Vector3(0,0,1);
 let renderTime=0;
 const labels={tool_shop:'TOOLS',tinker_shop:'TINKER',sword_shop:'ARMORY',mine:'MINE',tree_farm:'GROVE',wheat_farm:'FIELD',house:'HEARTH',barracks:'WATCH',church:'SANCTUARY',archer_tower:'ARCHER POST',cannon:'CANNON'};
 function textSign(text,group,x,y,z,width=3){
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#342d25';ctx.fillRect(0,0,512,128);ctx.strokeStyle='#ae8c58';ctx.lineWidth=7;ctx.strokeRect(7,7,498,114);ctx.fillStyle='#edddb7';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='600 40px Georgia';ctx.fillText(text,256,64,475);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const material=new THREE.MeshStandardMaterial({map:texture,roughness:1,side:THREE.DoubleSide});
  const sign=new THREE.Mesh(new THREE.PlaneGeometry(width,width/4),material);sign.position.set(x,y,z);group.add(sign);
 }
 function build(plot,state){
  const group=new THREE.Group();group.name=`plot-${plot.id}`;group.position.set(plot.x,0,plot.z);group.rotation.y=plot.yaw??0;root.add(group);
  group.userData={plotId:plot.id,front:plotFront(plot),building:state?.building??null,ruined:Boolean(state?.building&&state.hp<=0)};
  const batch=new Map();
  function add(shape,material,x,y,z,sx,sy,sz,rx=0,ry=0,rz=0){
   const key=shape+':'+material;if(!batch.has(key))batch.set(key,{shape,material,transforms:[]});
   dummy.position.set(x,y,z);dummy.scale.set(sx,sy,sz);dummy.rotation.set(rx,ry,rz);dummy.updateMatrix();batch.get(key).transforms.push(dummy.matrix.clone());
  }
  const box=(m,x,y,z,w,h,d,ry=0,rz=0)=>add('box',m,x,y,z,w,h,d,0,ry,rz);
  const cylinder=(m,x,y,z,r,h)=>add('cylinder',m,x,y,z,r,h,r);
  const quarter=Math.abs(Math.sin(plot.yaw??0))>.5,w=quarter?plot.d:plot.w,d=quarter?plot.w:plot.d;
  // A wide opening at the lane-facing edge keeps interaction and entry clear.
  for(const side of [-1,1]){
   for(const x of [-w/2,w/2])box('wood',x,.48,side*d/2,.12,.96,.12);
   for(const y of [.34,.69])box('trim',side*w/2,y,0,.09,.08,d);
   for(const y of [.34,.69])box('trim',side*(w/4+.85),y,d/2,w/2-1.7,.08,.09);
  }
  for(const y of [.34,.69])box('trim',0,y,-d/2,w,.08,.09);
  box('dark',-w/2+.75,.85,d/2,.1,1.7,.1);
  textSign(state?.ownerId?(group.userData.ruined?'RUINS':labels[state.building]??'OWNED PLOT'):plot.id.replace('outpost-','OUTPOST ').replace('west-','WEST ').replace('east-','EAST ').toUpperCase(),group,-w/2+1.05,1.6,d/2+.07,2.15);
  const type=state?.building;
  function window(x,y,z){box('dark',x,y,z,.94,1.22,.13);box('glass',x,y,z+.09,.74,.98,.035);box('wood',x,y,z+.13,.075,1.03,.06);box('wood',x,y,z+.13,.8,.07,.06);}
  function roof(bw,bd,height,rise=2.3){
   const slope=Math.hypot(bw/2+.45,rise),angle=Math.atan2(rise,bw/2+.45);
   for(const side of [-1,1]){
    box('roof',side*(bw/4+.225),height+rise/2,0,slope,.18,bd+1.05,0,-side*angle);
    box('dark',side*(bw/2+.46),height,0,.18,.3,bd+1.15);
   }
   box('roof',0,height+rise+.08,0,.32,.24,bd+1.18);
   box('trim',0,height+.1,bd/2+.13,bw,.18,.16);
  }
  function building(bw=7,bd=6,h=4.3,style='pale'){
   box('stone',0,.35,0,bw+.1,.7,bd+.1);box(style,0,h/2+.4,0,bw,h,bd);
   for(const x of [-bw/2+.13,0,bw/2-.13])box('dark',x,h/2+.45,bd/2+.05,.19,h,.16);
   for(const y of [.9,2.8,h+.38])box('wood',0,y,bd/2+.09,bw,.17,.18);
   box('dark',0,1.6,bd/2+.1,1.6,2.5,.15);for(let i=0;i<5;i++)box('wood',-.64+i*.32,1.6,bd/2+.2,.27,2.3,.07);
   box('iron',0,1.1,bd/2+.25,1.5,.12,.06);box('iron',0,2.4,bd/2+.25,1.5,.12,.06);
   box('stone',0,.12,bd/2+.45,2,.24,.8);window(-bw*.31,2,bd/2+.15);window(bw*.31,2,bd/2+.15);roof(bw,bd,h+.5,bw*.32);
   box('stone',bw*.3,h+1.3,-bd*.24,.75,3.2,.8);box('dark',bw*.3,h+2.92,-bd*.24,.82,.09,.85);
   if(type!=='house')textSign(labels[type]??'WORKSHOP',group,0,3.5,bd/2+.25,Math.min(3.3,bw-1));
  }
  function workbench(z=4.15){
   box('trim',0,1,z,4.4,.16,1.2);for(const x of [-1.9,1.9])box('dark',x,.47,z,.2,.94,.8);
  }
  if(group.userData.ruined){
   box('dark',0,.025,0,6,.05,6);
   const random=seeded(Array.from(plot.id).reduce((sum,char)=>sum+char.charCodeAt(0),0));
   for(let i=0;i<15;i++)add('rock',i%3?'stone':'dark',(random()-.5)*5,.2+random()*.3,(random()-.5)*5,.45+random()*.5,.3+random()*.4,.45+random()*.5,0,random()*3);
   for(const side of [-1,1])box('dark',side*2.1,.85,-1.8,.25,1.7,.28,0,side*.18);
   box('wood',0,.24,.4,4.8,.18,.3,.35);
  }else if(['tool_shop','tinker_shop','sword_shop','house'].includes(type)){
   building();
   if(type!=='house'){
    workbench();
    for(const side of [-1,1])box('dark',side*2.3,1.8,4.55,.1,3.6,.1);
    for(let i=0;i<8;i++)box(i%2?'gold':'cloth',-2.16+i*.62,3.6,4.2,.63,.08,2.1);
    for(let i=0;i<4;i++){
     const x=-1.5+i;
     if(type==='sword_shop'){box('iron',x,1.6,4.2,.13,1.1,.08,0,-.25);box('gold',x,1.15,4.2,.45,.1,.1);}
     else if(type==='tinker_shop'){cylinder('iron',x,1.25,4.2,.22,.26);box('trim',x,1.43,4.2,.06,.5,.06);}
     else{box('trim',x,1.4,4.2,.09,.7,.09);box('iron',x+.16,1.65,4.2,.47,.22,.13);}
    }
   }else{
    for(const side of [-1,1]){box('wood',side*2.2,.58,4,1.2,.8,.8);for(let f=0;f<3;f++)add('rock',f%2?'gold':'cloth',side*2.2-.3+f*.3,1.12,4,.18,.23,.16);}
   }
  }else if(type==='barracks'){
   building(8,6,4.7,'stone');
   for(const side of [-1,1]){
    box('cloth',side*3,3.2,3.2,.9,2.1,.06);
    box('dark',side*3,1.1,4.7,1.8,.12,.22);
    for(let i=0;i<4;i++){const x=side*3-.6+i*.4;cylinder('trim',x,1.1,4.7,.045,2.2);add('cone','iron',x,2.3,4.7,.11,.3,.11);}
   }
  }else if(type==='church'){
   building(7,6,5.2,'stone');
   box('stone',-2.15,4.8,-1.7,2.1,9.6,2.1);add('cone','roof',-2.15,11.1,-1.7,1.8,3.3,1.8,0,Math.PI/4);
   box('gold',-2.15,13.4,-1.7,.12,1.45,.12);box('gold',-2.15,13.55,-1.7,.8,.12,.12);
   for(const side of [-1,1]){box('purple',side*2.8,3.2,3.2,.75,1.7,.04);for(let row=0;row<((state?.level??1)>=2?2:1);row++){const bz=4.2+row*1.8;box('wood',side*2.5,.42,bz,1.4,.34,1.7);box('pale',side*2.5,.7,bz,1.28,.22,1.6);box('trim',side*2.5,.98,bz-.8,1.4,.6,.13);box('pale',side*2.5,.87,bz-.5,1.15,.17,.4);}}
  }else if(type==='mine'){
   for(let i=0;i<7;i++)add('rock',i%2?'stone':'dark',-3.8+i*1.22,1.25+(i%3)*.25,-2.1-(i%2)*.6,1.7,2+(i%3)*.35,1.65,0,i*.7);
   box('dark',0,1.5,-.8,3.4,3,.08);for(const x of [-1.6,1.6])box('wood',x,1.5,-.62,.3,3,.35);box('trim',0,3.02,-.61,3.7,.4,.43);
   for(const x of [-.55,.55])box('iron',x,.05,1.3,.065,.06,4.2);for(let i=0;i<6;i++)box('wood',0,.025,-.5+i*.65,1.55,.08,.17);
   textSign('MINE',group,0,3.12,-.34,2.15);
  }else if(type==='wheat_farm'||type==='tree_farm'){
   box('dirt',0,-.03,0,w-1,.06,d-1.2);
   if(type==='wheat_farm')for(let i=0;i<8;i++)box('dark',-w/2+.8+i*(w-1.6)/7,.025,0,.08,.04,d-1.5);
   // Actual crops and trees are stateful harvest nodes supplied by the server.
   else{box('wood',-w/2+1,.4,-d/2+1,1.3,.8,1);box('trim',-w/2+1,.83,-d/2+1,1.4,.08,1.1);}
  }else if(type==='archer_tower'){
   for(const x of [-1.7,1.7])for(const z of [-1.7,1.7]){box('stone',x,.35,z,.6,.7,.6);box('wood',x,3.2,z,.38,6.4,.38);}
   for(const z of [-1.7,1.7])for(const side of [-1,1])box('trim',0,3,z,.2,6.7,.19,0,side*.51);
   box('dark',0,6.1,0,4.4,.35,4.4);for(const x of [-2,2])box('trim',x,6.8,0,.12,.65,4.3);for(const z of [-2,2])box('trim',0,6.8,z,4.3,.65,.12);
   roof(4.1,4.1,8.7,1.7);for(const x of [-1.9,1.9])for(const z of [-1.9,1.9])box('wood',x,7.5,z,.18,2.7,.18);
   // Archer silhouette makes the automatic defense immediately recognizable.
   box('cloth',0,7.1,0,.65,1,.42);add('rock','pale',0,7.95,0,.32,.34,.3);box('iron',0,8.17,0,.72,.12,.62);box('wood',.55,7.5,.2,.09,1.05,.1,0,.24);
   for(let i=0;i<9;i++)box('trim',0,.42+i*.61,2.18,1,.09,.16);for(const x of [-.58,.58])box('wood',x,3.1,2.18,.1,6.2,.12);
  }else if(type==='cannon'){
   box('stone',0,.17,0,4.4,.34,4.4);box('wood',0,.68,0,2.6,.48,2.7);for(const x of [-1.3,1.3])for(const z of [-.8,.8])add('cylinder','dark',x,.65,z,.64,.2,.64,0,0,Math.PI/2);
   const turret=new THREE.Group();turret.name='aiming-cannon';turret.position.y=1.28;group.add(turret);
   const barrel=new THREE.Mesh(new THREE.CylinderGeometry(.43,.43,3.5,10),materials.iron);barrel.position.set(0,0,.6);barrel.rotation.x=Math.PI/2-.13;barrel.castShadow=true;barrel.userData.sharedMaterial=true;turret.add(barrel);
   const muzzle=new THREE.Mesh(new THREE.CylinderGeometry(.34,.34,.04,10),materials.dark);muzzle.position.set(0,.24,2.32);muzzle.rotation.x=Math.PI/2;muzzle.userData.sharedMaterial=true;turret.add(muzzle);
   for(let i=0;i<6;i++)add('rock','iron',-1.7+(i%2)*.42,.5+Math.floor(i/4)*.32,-1.6+Math.floor(i/2)*.4,.22,.22,.22);
  }
  for(const {shape,material,transforms} of batch.values()){
   const mesh=new THREE.InstancedMesh(geometries[shape],materials[material],transforms.length);transforms.forEach((matrix,index)=>mesh.setMatrixAt(index,matrix));mesh.castShadow=true;mesh.receiveShadow=true;mesh.computeBoundingSphere();group.add(mesh);
  }
  return group;
 }
 function remove(group){
  group.traverse(object=>{if(!object.isMesh)return;if(object.isInstancedMesh){object.dispose();return;}object.geometry.dispose();if(!object.userData.sharedMaterial){object.material.map?.dispose();object.material.dispose();}});root.remove(group);
 }
 function update(state={},time=renderTime){
  renderTime=time;
  const rows=Array.isArray(state.plots)?state.plots:Object.values(state.plots||{}),states=new Map(rows.map(plot=>[plot.id,plot]));
  for(const plot of PLOTS){
   const value=states.get(plot.id),ruined=Boolean(value?.building&&value.hp<=0),key=[value?.ownerId??'',value?.building??'',value?.level??0,ruined].join(':');
   let record=records.get(plot.id);
   if(record?.key!==key){if(record)remove(record.group);record={key,group:build(plot,value)};records.set(plot.id,record);}
   const shot=value?.lastShot;
   if(!ruined&&shot&&Number.isFinite(shot.x)&&Number.isFinite(shot.z)&&Number.isFinite(shot.until)){
    const turret=record.group.getObjectByName('aiming-cannon');
    if(turret)turret.rotation.y=Math.atan2(shot.x-plot.x,shot.z-plot.z)-(plot.yaw??0);
    let effect=shots.get(plot.id);
    if(!effect){
     const group=new THREE.Group();group.name=`shot-${plot.id}`;root.add(group);
     const projectile=new THREE.Mesh(value.building==='cannon'?geometries.rock:geometries.box,value.building==='cannon'?materials.iron:materials.gold);
     projectile.scale.set(...(value.building==='cannon'?[.24,.24,.24]:[.065,.065,.95]));group.add(projectile);
     const flash=new THREE.Mesh(geometries.rock,materials.glass);group.add(flash);
     effect={group,projectile,flash,seen:null,start:new THREE.Vector3(),target:new THREE.Vector3(),started:-1,duration:.55,cannon:value.building==='cannon'};shots.set(plot.id,effect);
    }
    const cannon=value.building==='cannon';
    if(effect.cannon!==cannon){effect.cannon=cannon;effect.projectile.geometry=cannon?geometries.rock:geometries.box;effect.projectile.material=cannon?materials.iron:materials.gold;effect.projectile.scale.set(...(cannon?[.24,.24,.24]:[.065,.065,.95]));effect.seen=null;}
    if(effect.seen!==shot.until){
     effect.seen=shot.until;
     if(shot.until>=(state.clock??shot.until)-.6){
      effect.started=time;effect.start.set(plot.x,effect.cannon?1.55:7.7,plot.z);effect.target.set(shot.x,.9,shot.z);
      shotDirection.copy(effect.target).sub(effect.start).normalize();if(effect.cannon)effect.start.addScaledVector(shotDirection,2.05);
      effect.duration=Math.max(.18,Math.min(.6,effect.start.distanceTo(effect.target)/45));effect.flash.position.copy(effect.start);
     }
    }
   }
  }
  for(const [plotId,effect] of shots){
   const value=states.get(plotId),elapsed=(time-effect.started)/effect.duration;
   effect.group.visible=Boolean(value?.building&&value.hp>0&&effect.started>=0&&elapsed>=0&&elapsed<1);
   if(!effect.group.visible)continue;
   effect.projectile.position.lerpVectors(effect.start,effect.target,elapsed);effect.projectile.position.y+=Math.sin(elapsed*Math.PI)*(effect.cannon ? .22 : 1.1);
   shotDirection.copy(effect.target).sub(effect.projectile.position).normalize();effect.projectile.quaternion.setFromUnitVectors(forward,shotDirection);
   effect.flash.visible=effect.cannon&&elapsed<.27;effect.flash.scale.setScalar(.75*(1-elapsed));
  }
 }

 update();
 return {root,update,dispose(){for(const record of records.values())remove(record.group);for(const effect of shots.values())root.remove(effect.group);shots.clear();for(const geometry of Object.values(geometries))geometry.dispose();for(const material of Object.values(materials))material.dispose();parent.remove(root);}};
}
