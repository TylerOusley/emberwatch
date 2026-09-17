import * as THREE from 'three';
import { PLOTS, plotFront, seeded, groundHeight } from '/shared/world.js';
import { createSurfaceMaterial } from './surface-materials.js';
import { createWeatheredRockGeometry, createBeveledBlockGeometry } from './environment-geometry.js';

// Harvest rocks are weathered, partly buried beds, with ore colors authored
// into the rock surface itself. No separate nuggets float above the formation.
// One vertex-colored mesh per node also keeps large mining areas inexpensive.
export function mineralOutcropGeometry(type,seed,{width=1.85,depth=1.55,height=.83,rubble=true}={}){
 const random=seeded(seed),positions=[],colors=[];
 const base=new THREE.Color(type==='coal'?'#c1c0b8':type==='iron'?'#cec7b7':'#e1e1d3');
 const pale=new THREE.Color(type==='coal'?'#ddd3bb':'#fff2d5');
 const dark=new THREE.Color(type==='coal'?'#353d40':'#9aab9e');
 const rust=new THREE.Color('#b46d44'),rustLight=new THREE.Color('#e0ad74');
 const sulfur=new THREE.Color('#d3b93f'),sulfurLight=new THREE.Color('#f5e287');
 const soil=new THREE.Color('#b8a68a'),color=new THREE.Color();
 const phase=random()*9,tilt=.13+random()*.14;
 function tint(x,y,z,chip=false){
  const grain=Math.sin(x*24+z*18+y*31)*Math.sin(z*33-x*17+y*9);
  // Sloping deposits pass continuously through the face and exposed top.
  const strata=y+z*tilt+x*.11+Math.sin(x*4.1+phase)*.025;
  const band=Math.sin(strata*37+phase);
  color.copy(base).lerp(band>.55?pale:dark,band>.55?.13:.12);
  if(type==='iron'){
   const seam=Math.abs(Math.sin(strata*11+phase+Math.sin(x*6-z*4)*.18));
   const deposit=1-THREE.MathUtils.smoothstep(seam,.18,.55);
   color.lerp(rust,deposit*.92).lerp(rustLight,deposit*Math.max(0,grain)*.32);
  }else if(type==='coal'){
   const seam=Math.abs(Math.sin(strata*12+phase));
   const deposit=1-THREE.MathUtils.smoothstep(seam,.36,.61);
   color.lerp(dark,deposit*.97);
  }else if(type==='sulfur'){
   const seam=Math.abs(Math.sin(strata*12+phase));
   const deposit=1-THREE.MathUtils.smoothstep(seam,.32,.68);
   color.lerp(sulfur,deposit*.93).lerp(sulfurLight,deposit*Math.max(0,grain)*.35);
  }
  if(y<.12)color.lerp(soil,.35);
  if(chip)color.lerp(pale,.12);
  // Identical coordinates receive identical color: no triangular confetti at
  // shared edges. Texture normals add the fine chipped grain at render time.
  color.multiplyScalar(.95+grain*.045);
  return color.toArray();
 }
 function triangle(a,b,c,chip=false){
  const normal=new THREE.Vector3().subVectors(new THREE.Vector3(...b),new THREE.Vector3(...a)).cross(new THREE.Vector3().subVectors(new THREE.Vector3(...c),new THREE.Vector3(...a)));
  if(normal.lengthSq()<1e-12)return;
  for(const p of [a,b,c]){positions.push(...p);colors.push(...tint(...p,chip));}
 }
 function slab(cx,cz,sx,sz,h,yaw,chip=false){
  // An irregular polygon is sheared along its bedding planes. Chipped ledges
  // interrupt its sides; the uneven upper cap is a broken face, not a sphere.
  const sides=chip?7:21,profiles=chip?[[-.1,1],[.38,.92],[.73,.66]]:[[-.12,1],[.11,1.01],[.31,.88],[.35,.95],[.61,.83],[.65,.89],[.82,.77],[.86,.35]],rings=[];
  const perimeter=Array.from({length:sides},(_,i)=>({a:i/sides*Math.PI*2,r:.76+random()*.25,top:.77+Math.sin(i/sides*Math.PI*2+phase)*.14+random()*.09}));
  const cs=Math.cos(yaw),sn=Math.sin(yaw),shear=(random()-.5)*.27;
  for(const [level,radius] of profiles){
   rings.push(perimeter.map(({a,r,top})=>{
    const lx=Math.cos(a)*r*radius*sx+level*shear,lz=Math.max(-sz*.58,Math.sin(a)*r*radius*sz);
    return [cx+lx*cs+lz*sn,level*h*top+Math.cos(a+phase)*.055*h,cz-lx*sn+lz*cs];
   }));
  }
  for(let row=0;row<rings.length-1;row++)for(let j=0;j<sides;j++){
   const next=(j+1)%sides,a=rings[row][j],b=rings[row][next],c=rings[row+1][j],d=rings[row+1][next];
   triangle(a,c,b,chip);triangle(b,c,d,chip);
  }
  const top=[cx+shear*h*.18,h*(chip?.78:.68),cz];
  for(let j=0;j<sides;j++)triangle(rings.at(-1)[j],top,rings.at(-1)[(j+1)%sides],chip);
 }
 const yaw=(random()-.5)*.8;
 slab(-width*.07,depth*.08,width*.45,depth*.42,height,yaw);
 // Two fractured plates lean into the main bed and share its strata. Their
 // contact edges lie below ground so the formation reads as exposed bedrock.
 slab(width*.24,-depth*.19,width*.25,depth*.30,height*.52,yaw+.16);
 slab(-width*.27,-depth*.25,width*.25,depth*.20,height*.34,yaw-.1);
 if(rubble)for(let i=0;i<7;i++){
  const a=random()*Math.PI*2,s=.035+random()*.065;
  slab(Math.cos(a)*width*(.43+random()*.09),Math.sin(a)*depth*(.39+random()*.08),s*1.3,s,.055+random()*.07,random()*6.28,true);
 }
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.computeVertexNormals();geometry.computeBoundingSphere();
 return geometry;
}

// Irregular mineral-soil aprons visually connect the individual working faces.
// Everything stays ground level: these do not introduce invisible collisions.
export function mineralBedGeometry(seed,width,depth){
 const random=seeded(seed),positions=[],colors=[],indices=[],segments=38;
 const shades=['#7b725c','#8e8570','#807860','#6d7754'].map(hex=>new THREE.Color(hex));
 const perimeter=Array.from({length:segments},()=>.9+random()*.1);
 positions.push(0,-.037,0);colors.push(...shades[0].toArray());
 for(let ring=0;ring<4;ring++)for(let j=0;j<segments;j++){
  const a=j/segments*Math.PI*2,t=[.37,.69,.91,1][ring],radius=perimeter[j]*t;
  // Rounded rectangular work areas join a row of resources without making a
  // rectangular paint swatch or reaching the adjacent streets and buildings.
  const x=Math.sign(Math.cos(a))*Math.abs(Math.cos(a))**.65*width*.5*radius;
  const z=Math.sign(Math.sin(a))*Math.abs(Math.sin(a))**.65*depth*.5*radius;
  positions.push(x,[-.034,-.027,-.045,-.118][ring]+(random()-.5)*.018,z);
  const color=shades[ring].clone().multiplyScalar(.94+random()*.11);colors.push(...color.toArray());
 }
 for(let j=0;j<segments;j++){const next=(j+1)%segments;indices.push(0,1+next,1+j);}
 for(let ring=0;ring<3;ring++)for(let j=0;j<segments;j++){
  const next=(j+1)%segments,a=1+ring*segments+j,b=1+ring*segments+next,c=a+segments,d=b+segments;
  indices.push(a,b,c,b,d,c);
 }
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setIndex(indices);geometry.computeVertexNormals();
 return geometry;
}

// Four draw calls cover every simultaneous blast. Separate per-instance alpha
// lets smoke linger while hot fragments and the pressure ring fade quickly.
export function createCannonImpactPool(parent,{capacity=8}={}){
 const max=Math.max(1,Math.min(16,Number.isInteger(capacity)?capacity:8)),root=new THREE.Group();root.name='cannon-impact-effects';parent.add(root);
 const dummy=new THREE.Object3D(),color=new THREE.Color(),slots=Array.from({length:max},()=>({active:false,start:0,x:0,y:0,z:0,floor:0,radius:3.5,seed:0}));
 let disposed=false,emitted=0;
 function pool(name,geometry,count,{smoke=false}={}){
  const alpha=new THREE.InstancedBufferAttribute(new Float32Array(count),1);geometry.setAttribute('effectAlpha',alpha);
  const material=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,depthWrite:false,toneMapped:false,blending:smoke?THREE.NormalBlending:THREE.AdditiveBlending});
  material.onBeforeCompile=shader=>{
   shader.vertexShader='attribute float effectAlpha; varying float vEffectAlpha;\n'+shader.vertexShader;
   shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvEffectAlpha = effectAlpha;');
   shader.fragmentShader='varying float vEffectAlpha;\n'+shader.fragmentShader;
   shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.a *= vEffectAlpha;');
  };
  material.customProgramCacheKey=()=>`cannon-instance-alpha-${smoke?'smoke':'fire'}`;
  const mesh=new THREE.InstancedMesh(geometry,material,count);mesh.name=name;mesh.count=0;mesh.frustumCulled=false;mesh.renderOrder=smoke?2:3;root.add(mesh);
  return {mesh,alpha,used:0};
 }
 const ring=pool('cannon-pressure-rings',new THREE.TorusGeometry(1,.025,4,40),max);
 const fire=pool('cannon-impact-fire',new THREE.IcosahedronGeometry(1,1),max*3);
 const sparks=pool('cannon-impact-sparks',new THREE.BoxGeometry(1,1,1),max*18);
 const smoke=pool('cannon-impact-smoke',new THREE.IcosahedronGeometry(1,1),max*6,{smoke:true});
 const pools=[ring,fire,sparks,smoke];
 function place(pool,x,y,z,sx,sy,sz,tint,alpha,rx=0,ry=0,rz=0){
  const index=pool.used++;dummy.position.set(x,y,z);dummy.scale.set(sx,sy,sz);dummy.rotation.set(rx,ry,rz);dummy.updateMatrix();
  pool.mesh.setMatrixAt(index,dummy.matrix);pool.mesh.setColorAt(index,color.set(tint));pool.alpha.setX(index,Math.max(0,Math.min(1,alpha)));
 }
 function reset(){for(const slot of slots)slot.active=false;for(const pool of pools){pool.used=0;pool.mesh.count=0;}}
 function emit(position,time,{radius=3.5}={}){
  if(disposed||![position?.x,position?.y,position?.z,time].every(Number.isFinite))return false;
  const slot=slots.find(slot=>!slot.active)??slots.reduce((a,b)=>a.start<=b.start?a:b);
  Object.assign(slot,{active:true,start:time,x:position.x,y:position.y,z:position.z,floor:groundHeight(position.x,position.z),radius:Math.max(.5,Math.min(5,Number.isFinite(radius)?radius:3.5)),seed:++emitted*.731});return true;
 }
 function update(time){
  if(disposed)return;if(!Number.isFinite(time)){reset();return;}
  for(const pool of pools)pool.used=0;
  for(const slot of slots){
   if(!slot.active)continue;const age=time-slot.start;
   if(age<0||age>=1.35){slot.active=false;continue;}
   if(age<.62){const t=age/.62,r=.18+slot.radius*Math.sin(t*Math.PI/2);place(ring,slot.x,slot.floor+.07,slot.z,r,r,r,0xffc579,(1-t)**1.5*.9,Math.PI/2);}
   if(age<.42)for(let i=0;i<3;i++){
    const t=age/.42,a=slot.seed+i*Math.PI*2/3,s=(.26+Math.sin(t*Math.PI)*.80)*(1-i*.12);
    place(fire,slot.x+Math.sin(a)*t*.33,slot.y+.20+t*.45+i*.08,slot.z+Math.cos(a)*t*.33,s,s*(1.05+i*.10),s,i===0?0xffedb0:0xff8a32,(1-t)**1.2*(i? .55:.85),a,t*2,a*.3);
   }
   if(age<.85)for(let i=0;i<18;i++){
    const a=i*2.39996+slot.seed,speed=1.5+(i%5)*.44,up=1.6+(i%4)*.72,t=age/.85,fade=(1-t)**1.1;
    const y=Math.max(slot.floor+.055,slot.y+up*age-5.5*age*age);
    place(sparks,slot.x+Math.sin(a)*speed*age,y,slot.z+Math.cos(a)*speed*age,.037*fade,.13*fade,.036*fade,i%3?0xffa54f:0xffebaa,fade*.95,a,age*7,a*.7);
   }
   if(age>.075)for(let i=0;i<6;i++){
    const t=(age-.075)/1.275,a=slot.seed+i*2.39996,drift=.18+t*(.55+i*.05),s=.20+t*(.58+(i%3)*.11);
    place(smoke,slot.x+Math.sin(a)*drift,slot.y-.08+t*(1.1+(i%3)*.19),slot.z+Math.cos(a)*drift,s,s*.9,s,i%2?0x626360:0x444949,Math.sin(Math.min(1,t)*Math.PI)**.8*.35,a,slot.seed+t*.5,0);
   }
  }
  for(const pool of pools){pool.mesh.count=pool.used;if(pool.used){pool.mesh.instanceMatrix.needsUpdate=true;pool.mesh.instanceColor.needsUpdate=true;pool.alpha.needsUpdate=true;}}
 }
 return {root,emit,update,reset,get stats(){return {active:slots.filter(slot=>slot.active).length,max,emitted,drawCalls:4};},dispose(){if(disposed)return;reset();disposed=true;root.removeFromParent();for(const pool of pools){pool.mesh.dispose();pool.mesh.geometry.dispose();pool.mesh.material.dispose();}root.clear();}};
}

// Plot buildings share the village's warm timber, pale stone and blue roofs.
// Each deed is one batched group, replaced only when its structure changes.
export function createPlotsWorld(parent){
 const root=new THREE.Group();root.name='Village neighborhoods';parent.add(root);
 const geometries={box:createBeveledBlockGeometry(),cylinder:new THREE.CylinderGeometry(1,1,1,16),cone:new THREE.ConeGeometry(1,1,12),rock:createWeatheredRockGeometry(17,{detail:1}),sphere:new THREE.SphereGeometry(1,12,8),ring:new THREE.TorusGeometry(1,.055,4,16),bow:new THREE.TorusGeometry(1,.06,4,16,Math.PI*.85),barrel:new THREE.LatheGeometry([new THREE.Vector2(0,-.5),new THREE.Vector2(.85,-.5),new THREE.Vector2(.96,-.32),new THREE.Vector2(1,0),new THREE.Vector2(.96,.32),new THREE.Vector2(.85,.5),new THREE.Vector2(0,.5)],16)};
 const colors={stone:'#deddd0',pale:'#fff2d7',wood:'#c1a17a',dark:'#615349',roof:'#629391',trim:'#e4c295',iron:'#58666c',glass:'#edbc69',cloth:'#ac6249',purple:'#766080',leaf:'#64854a',dirt:'#e0cdae',gold:'#d9b452',ember:'#ff9a45',storm:'#b7a4ff'};
 const surfaces={stone:'masonry',pale:'plaster',wood:'wood',dark:'wood',roof:'roof',trim:'wood',dirt:'earth'};
 const materials=Object.fromEntries(Object.entries(colors).map(([id,color])=>[id,surfaces[id]?createSurfaceMaterial(surfaces[id],{color,worldScale:id==='roof'?2:id==='stone'?1.8:2.4,normalStrength:id==='pale'?.16:.55}):new THREE.MeshStandardMaterial({color,roughness:id==='iron'?.5:id==='gold'?.4:.86,metalness:['iron','gold'].includes(id)?.62:0,...(id==='glass'?{emissive:color,emissiveIntensity:.3,roughness:.24}:{})})]));
 materials.geology=createSurfaceMaterial('rock',{color:'#ffffff',vertexColors:true,worldScale:1.6,normalStrength:.68});
 materials.mineralSoil=createSurfaceMaterial('earth',{color:'#fff1d1',vertexColors:true,worldScale:2.3,normalStrength:.32});
 for(const id of ['ember','storm']){materials[id].emissive.set(colors[id]);materials[id].emissiveIntensity=.8;materials[id].roughness=.35;}
 const records=new Map(),shots=new Map(),dummy=new THREE.Object3D(),impacts=createCannonImpactPool(root);
 const shotDirection=new THREE.Vector3(),forward=new THREE.Vector3(0,0,1);
 let renderTime=0,baselineEffects=true,villageId=null,lastClock=null,disposed=false;
 const labels={tool_shop:'TOOLS',tinker_shop:'TINKER',sword_shop:'ARMORY',mine:'MINE',tree_farm:'GROVE',wheat_farm:'FIELD',house:'HEARTH',barracks:'WATCH',church:'SANCTUARY',archer_tower:'ARCHER POST',cannon:'CANNON',arcane_academy:'ARCANE ACADEMY',wizard_tower:'WIZARD TOWER'};
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
  const level=Math.max(1,Math.min(3,Number.isInteger(state?.level)?state.level:1));group.userData.level=level;
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
  textSign(state?.ownerId?(group.userData.ruined?'RUINS':`${labels[state.building]??'OWNED PLOT'}${level>=2?level===3?' III':' II':''}`):plot.id.replace('outpost-','OUTPOST ').replace('west-','WEST ').replace('east-','EAST ').toUpperCase(),group,-w/2+1.05,1.6,d/2+.07,2.15);
  const type=state?.building;
  function window(x,y,z){
   box('dark',x,y,z,1.04,1.34,.15);box('glass',x,y,z+.09,.77,1.06,.035);
   for(const side of[-1,1]){box('trim',x+side*.46,y,z+.14,.105,1.36,.13);box('wood',x+side*.67,y,z+.015,.27,1.17,.08);for(const yy of[-.44,.44])box('dark',x+side*.67,y+yy,z+.065,.27,.07,.055);}
   for(const yy of[-.66,.66])box('trim',x,y+yy,z+.14,1.14,.13,.20);
   box('wood',x,y,z+.15,.055,1.09,.06);box('wood',x,y+.02,z+.15,.8,.055,.06);
   for(const side of[-1,1])box('iron',x+side*.20,y,z+.145,.025,1.12,.024,0,side*.35);
   box('stone',x,y-.76,z+.13,1.20,.15,.33);
  }
  function roof(bw,bd,height,rise=2.3){
   const slope=Math.hypot(bw/2+.45,rise),angle=Math.atan2(rise,bw/2+.45);
   for(const side of [-1,1]){
    box('roof',side*(bw/4+.225),height+rise/2,0,slope,.18,bd+1.05,0,-side*angle);
    box('dark',side*(bw/2+.46),height,0,.18,.3,bd+1.15);
    // A shallow pitch change lifts each overlapping lip off the next course;
    // coplanar tops otherwise compete for depth as the camera moves.
    const rows=Math.ceil(slope/.58),columns=Math.ceil((bd+1.0)/.75),tileWidth=(bd+1.0)/columns;
    for(let row=0;row<rows;row++)for(let column=0;column<columns;column++){
     const t=(row+.5)/rows,x=side*(bw/2+.45)*t,y=height+rise*(1-t)+.135;
     box('roof',x,y,-(bd+1)/2+(column+.5)*tileWidth,slope/rows+.055,.06,tileWidth-.023,0,-side*(angle-.035));
    }
    for(const end of[-1,1])box('trim',side*(bw/4+.225),height+rise/2+.07,end*(bd/2+.57),slope+.08,.15,.13,0,-side*angle);
   }
   box('roof',0,height+rise+.08,0,.32,.24,bd+1.18);
   box('trim',0,height+.1,bd/2+.13,bw,.18,.16);
  }
  function building(bw=7,bd=6,h=4.3,style='pale'){
   box('stone',0,.35,0,bw+.1,.7,bd+.1);box(style,0,h/2+.4,0,bw,h,bd);
   // Ashlar courses, corner quoins and inset side-frame panels sit against the
   // original shell: they do not enlarge the solid or occupy the entry lane.
   for(const side of[-1,1]){
    for(let i=0;i<Math.ceil(bw);i++)box('stone',-bw/2+(i+.5)*bw/Math.ceil(bw),.38,side*(bd/2+.032),bw/Math.ceil(bw)-.035,.54,.075);
    for(let i=0;i<Math.ceil(bd);i++)box('stone',side*(bw/2+.027),.38,-bd/2+(i+.5)*bd/Math.ceil(bd),.065,.54,bd/Math.ceil(bd)-.035);
    for(const end of[-1,1])for(let row=0;row<Math.floor(h/.55);row++)box('stone',side*(bw/2-.14),.84+row*.55,end*(bd/2-.035),row%2?.33:.46,.28,.17);
    box('wood',side*(bw/2+.02),2.55,0,.09,.13,bd-.25);
    for(const zz of[-bd*.30,bd*.30])box('dark',side*(bw/2+.025),h/2+.5,zz,.075,h-.3,.12);
   }
   for(const x of [-bw/2+.13,0,bw/2-.13])box('dark',x,h/2+.45,bd/2+.05,.19,h,.16);
   for(const y of [.9,2.8,h+.38])box('wood',0,y,bd/2+.09,bw,.17,.18);
   box('dark',0,1.6,bd/2+.1,1.6,2.5,.15);for(let i=0;i<5;i++)box('wood',-.64+i*.32,1.6,bd/2+.2,.27,2.3,.07);
   box('iron',0,1.1,bd/2+.25,1.5,.12,.06);box('iron',0,2.4,bd/2+.25,1.5,.12,.06);
   for(const x of[-.69,.69])for(const y of[1.1,2.4])add('cylinder','gold',x,y,bd/2+.30,.045,.035,.045,Math.PI/2);
   add('ring','iron',.45,1.58,bd/2+.30,.105,.105,.105);
   for(const side of[-1,1])box('stone',side*.91,1.59,bd/2+.13,.19,2.65,.24);
   box('stone',0,2.98,bd/2+.14,2.02,.22,.28);
   box('stone',0,.12,bd/2+.45,2,.24,.8);window(-bw*.31,2,bd/2+.15);window(bw*.31,2,bd/2+.15);roof(bw,bd,h+.5,bw*.32);
   box('stone',bw*.3,h+1.3,-bd*.24,.75,3.2,.8);box('dark',bw*.3,h+2.92,-bd*.24,.82,.09,.85);
   for(let row=0;row<5;row++)box('pale',bw*.3,h+1+row*.37,-bd*.24+.411,.78,.055,.08);
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
    box(level>=2?'roof':'cloth',side*3,3.2,3.2,.9,2.1,.06);
    box('dark',side*3,1.1,4.7,1.8,.12,.22);
    for(let i=0;i<4;i++){const x=side*3-.6+i*.4;cylinder('trim',x,1.1,4.7,.045,2.2);add('cone','iron',x,2.3,4.7,.11,.3,.11);}
   }
   if(level>=2){
    // Shallow masonry relief reads beyond the wall faces, inside the existing
    // roof and step envelope; the shared solid and door approach stay the same.
    for(const x of [-3.76,3.76])for(const z of [-2.77,2.77]){
     box('pale',x,2.58,z,.74,5.16,.74);box('stone',x,5.22,z,.84,.22,.84);
     for(const y of[.62,2.55,4.75])box('iron',x,y,z,.79,.13,.79);
    }
    for(const side of[-1,1]){
     box('gold',side*3,4.20,3.26,.91,.11,.065);box('gold',side*3,2.20,3.26,.91,.11,.065);
     box('gold',side*3,3.3,3.27,.11,.94,.07);box('gold',side*3,3.46,3.27,.56,.10,.07);
     box('iron',side*.92,1.68,3.28,.14,2.72,.11);
    }
    box('iron',0,3.0,3.27,2,.16,.13);box('gold',0,3.11,3.31,.42,.17,.07);
   }
  }else if(type==='church'){
   building(7,6,5.2,'stone');
   box('stone',-2.15,4.8,-1.7,2.1,9.6,2.1);add('cone','roof',-2.15,11.1,-1.7,1.8,3.3,1.8,0,Math.PI/4);
   box('gold',-2.15,13.4,-1.7,.12,1.45,.12);box('gold',-2.15,13.55,-1.7,.8,.12,.12);
   for(const side of [-1,1]){box('purple',side*2.8,3.2,3.2,.75,1.7,.04);for(let row=0;row<((state?.level??1)>=2?2:1);row++){const bz=4.2+row*1.8;box('wood',side*2.5,.42,bz,1.4,.34,1.7);box('pale',side*2.5,.7,bz,1.28,.22,1.6);box('trim',side*2.5,.98,bz-.8,1.4,.6,.13);box('pale',side*2.5,.87,bz-.5,1.15,.17,.4);}}
   if(level>=2){
    for(const x of[-3.38,3.38])for(const z of[-2.76,2.76]){
     box('pale',x,2.5,z,.54,5,.64);box('gold',x,4.77,z,.58,.12,.68);
     box('stone',x,.34,z,.64,.68,.74);
    }
    // A rose window, gilded spire and fitted bed blankets distinguish care II.
    add('cylinder','gold',0,4.77,3.13,.64,.11,.64,Math.PI/2);
    add('cylinder','glass',0,4.77,3.21,.53,.055,.53,Math.PI/2);
    for(let i=0;i<6;i++)box('gold',0,4.77,3.25,.036,1.05,.055,0,i*Math.PI/3);
    box('gold',0,8.08,0,.12,.16,7.1);
    for(const side of[-1,1])box('gold',-2.15+side*.90,9.58,-1.7,.12,.18,2.0);
    add('cylinder','gold',-2.15,8.1,-.59,.55,.085,.55,Math.PI/2);
    add('cylinder','dark',-2.15,8.1,-.53,.45,.07,.45,Math.PI/2);
    box('gold',-2.15,8.18,-.47,.047,.52,.04,0,-.35);box('gold',-2.02,8.1,-.47,.28,.044,.04);
    for(const side of[-1,1])for(const bz of[4.2,6.0]){box('purple',side*2.5,.825,bz+.22,1.29,.025,1.07);box('gold',side*2.5,.843,bz+.32,.085,.017,.70);}
   }
  }else if(type==='arcane_academy'){
   building(7,6,4.3,'stone');
   // An observatory dome, brass armillary and open teaching lecterns distinguish
   // the academy while leaving the existing seven-by-six entrance clear.
   cylinder('stone',0,5.75,-.65,1.67,2.2);
   add('sphere','purple',0,6.88,-.65,1.75,1.3,1.75);
   for(const y of [5.15,6.75])cylinder('gold',0,y,-.65,1.78,.13);
   for(let i=0;i<8;i++){const a=i*Math.PI/4;box('gold',Math.sin(a)*1.60,6.1,-.65+Math.cos(a)*1.60,.08,1.02,.08);}
   cylinder('gold',0,8.37,-.65,.055,1.2);
   add('ring','gold',0,8.7,-.65,.58,.58,.58,.45,.3,.25);
   add('ring','gold',0,8.7,-.65,.57,.57,.57,-.6,1.3,-.4);
   add('sphere','storm',0,8.7,-.65,.17,.17,.17);
   for(const side of[-1,1]){
    box('purple',side*2.70,3.15,3.2,.65,1.9,.055);box('gold',side*2.70,3.82,3.26,.71,.12,.08);
    add('ring','gold',side*2.70,3.22,3.27,.2,.25,.2);
    box('wood',side*2.63,.67,3.77,.14,1.34,.14);box('trim',side*2.63,1.39,3.77,1.05,.12,.66);
    for(const page of[-1,1])box('pale',side*2.63+page*.22,1.48,3.79,.45,.06,.51,0,page*.12);
    box('purple',side*2.63,1.44,3.79,1.01,.04,.57);
   }
  }else if(type==='wizard_tower'){
   const power=level>=2?'storm':'ember';
   cylinder('stone',0,.25,0,2,.5);cylinder('stone',0,3.05,0,1.58,5.8);
   for(const y of [.66,2.45,4.48,5.88])cylinder('pale',0,y,0,1.68,.20);
   for(let i=0;i<8;i++){
    const a=i*Math.PI/4,x=Math.sin(a),z=Math.cos(a);
    box('stone',x*1.55,2.9,z*1.55,.26,5.3,.26,a);
    box('gold',x*1.63,4.85,z*1.63,.12,.70,.10,a);
    box('stone',x*1.72,6.50,z*1.72,.43,.85,.43,a);
   }
   cylinder('iron',0,6.18,0,1.93,.22);cylinder('gold',0,6.39,0,1.77,.12);
   add('sphere',power,0,7.15,0,.68,.85,.68);
   if(level>=2){
    add('ring','gold',0,7.15,0,1.12,1.12,1.12,.65,.2,.45);
    add('ring','iron',0,7.15,0,1.15,1.15,1.15,-.50,1.35,-.30);
    for(const side of[-1,1])add('rock','storm',side*.91,7.35,0,.18,.60,.18,0,0,side*.5);
   }else{
    for(let i=0;i<3;i++){const a=i*Math.PI*2/3;add('cone','ember',Math.sin(a)*.27,7.91,Math.cos(a)*.27,.22,.95,.22,0,a,.16);}
   }
   box('dark',0,1.36,1.61,.98,2.14,.10);box('wood',0,1.36,1.68,.77,1.91,.045);box('gold',0,1.45,1.74,.09,.46,.03);
   textSign(level>=2?'STORM SPIRE':'EMBER SPIRE',group,0,3.13,1.74,2.4);
  }else if(type==='mine'){
   const mineralSeed=Array.from(plot.id).reduce((sum,char)=>sum*31+char.charCodeAt(0)|0,421);
   const floor=new THREE.Mesh(mineralBedGeometry(mineralSeed,w-.5,d-1),materials.mineralSoil);floor.name='excavated-mine-floor';floor.receiveShadow=true;floor.userData.sharedMaterial=true;group.add(floor);
   // A low, continuous exposed bench replaces the heap of round boulders.
   // The open forecourt still contains the six authoritative harvest anchors.
   const bench=new THREE.Mesh(mineralOutcropGeometry('stone',mineralSeed,{width:w-1.5,depth:3.1,height:1.05*(state.production?.resourceScale??(level===3?1.16:level===2?1.08:1))}),materials.geology);bench.position.z=-3.15;bench.name='mine-bedrock';bench.castShadow=true;bench.receiveShadow=true;bench.userData.sharedMaterial=true;group.add(bench);
   for(const x of [-1.65,1.65])box('wood',x,.83,-1.55,.22,1.66,.25);box('trim',0,1.69,-1.55,3.6,.24,.29);
   // Retaining braces and a hand winch make this an excavated working mine.
   for(const side of [-1,1]){box('wood',side*3.4,.48,-2.2,.16,.96,.2);box('trim',side*3.4,.32,-1.91,.13,.76,.14,0,side*.15);}
   box('dark',-3.4,.09,.2,1.25,.18,1.4);for(const x of [-3.88,-2.92])box('wood',x,.58,.2,.16,.98,.18);
   add('cylinder','wood',-3.4,.94,.2,.18,.98,.18,0,0,Math.PI/2);box('iron',-2.81,1.1,.2,.1,.48,.1);
   for(const x of [-.55,.55])box('iron',x,.05,1.3,.065,.06,4.2);for(let i=0;i<6;i++)box('wood',0,.025,-.5+i*.65,1.55,.08,.17);
   if(state.level>=2){
    // The upgraded gantry stays behind the shared harvest anchors.
    for(const x of [-1.65,1.65]){box('dark',x,1.8,-2.3,.3,3.6,.34);box('iron',x,.7,-2.3,.36,.16,.4);box('iron',x,3.2,-2.3,.36,.16,.4);}
    box('wood',0,3.62,-2.3,3.7,.3,.4);add('cylinder','iron',0,3.3,-2.3,.34,.18,.34,Math.PI/2);
    box('trim',0,2.45,-2.24,.045,1.55,.045);box('iron',0,1.67,-2.24,.65,.25,.6);
    for(const side of [-1,1]){box('wood',side*3.6,1.1,-3.1,.14,2.2,.14);box('glass',side*3.6,2.12,-3.1,.26,.38,.26);}
    box('dark',3.4,.26,-.5,1.1,.52,1.15);box('trim',3.4,.55,-.5,1.2,.1,1.25);
   }
   if(level>=3){
    // A twin hoist, stone engine house and ore bins develop the unused rear.
    for(const x of[-3.5,3.5]){box('stone',x,.42,-4.5,.7,.84,.85);box('iron',x,2.5,-4.5,.31,5,.38);}
    box('iron',0,4.95,-4.5,7.45,.35,.45);box('gold',0,5.18,-4.5,7.5,.11,.47);
    for(const x of[-1.55,1.55]){add('cylinder','iron',x,4.48,-4.35,.48,.23,.48,Math.PI/2);box('dark',x,3.05,-4.17,.045,2.35,.045);box('iron',x,1.90,-4.17,.80,.29,.65);}
    box('stone',2.90,1.06,-5.88,1.65,2.12,1.45);box('roof',2.90,2.21,-5.88,1.86,.19,1.66);
    cylinder('iron',3.08,3.14,-5.94,.20,1.7);cylinder('gold',3.08,3.94,-5.94,.25,.15);
    for(const x of[-2.9,-1.5,-.1]){box('wood',x,.48,-5.93,1.15,.94,1.15);box('iron',x,.92,-5.93,1.2,.12,1.2);add('rock',x< -2?'stone':x< -1?'trim':'dark',x,.94,-5.93,.48,.34,.46);}
   }
   textSign(level===3?'MINE III':level===2?'MINE II':'MINE',group,0,1.71,-1.37,1.8);
  }else if(type==='wheat_farm'||type==='tree_farm'){
   box('dirt',0,-.03,0,w-1,.06,d-1.2);
   if(type==='wheat_farm')for(let i=0;i<8;i++)box('dark',-w/2+.8+i*(w-1.6)/7,.025,0,.08,.04,d-1.5);
   // Actual crops and trees are stateful harvest nodes supplied by the server.
   else{box('wood',-w/2+1,.4,-d/2+1,1.3,.8,1);box('trim',-w/2+1,.83,-d/2+1,1.4,.08,1.1);}
   if(state.level>=2){
    if(type==='wheat_farm'){
     // Rain barrels feed narrow irrigation channels along the fence line.
     add('barrel','wood',w/2-.9,.68,-d/2+.8,.42,1.3,.42);for(const y of [.2,1.12])add('ring','iron',w/2-.9,y,-d/2+.8,.42,.42,.42,Math.PI/2);
     for(const side of [-1,1]){box('stone',side*(w/2-.65),.08,0,.24,.16,d-1.2);box('roof',side*(w/2-.65),.17,0,.13,.025,d-1.4);}
     box('wood',0,.48,-d/2+.65,2.5,.82,.6);box('gold',0,.94,-d/2+.65,2.6,.12,.7);
    }else{
     // A raised saw table and bound logs distinguish a working level-two grove.
     const bz=-d/2+.8;box('trim',.6,1.05,bz,3.3,.16,.9);
     for(const x of [-.7,1.9])box('dark',x,.5,bz,.15,1,.65);
     for(const x of [-.25,.25,.75])add('cylinder','wood',x,1.32,bz,.2,2.2,.2,0,0,Math.PI/2);
     box('iron',1.65,1.23,bz,.08,.55,.8,0,-.2);box('wood',1.65,1.6,bz,.15,.16,1);
    }
   }
   if(level>=3){
    if(type==='wheat_farm'){
     const px=-w/2+1.25,pz=-d/2+1.5;
     for(const x of[px-.42,px+.42]){box('stone',x,.22,pz,.4,.44,.55);box('wood',x,1.93,pz,.13,3.86,.17);}
     box('trim',px,3.94,pz,1.13,.18,.28);add('cylinder','iron',px,3.95,pz+.18,.18,.21,.18,Math.PI/2);
     for(let i=0;i<4;i++){const a=i*Math.PI/2;box('trim',px+Math.sin(a)*.42,3.95+Math.cos(a)*.42,pz+.30,.095,.94,.09,0,-a);box('roof',px+Math.sin(a)*.63,3.95+Math.cos(a)*.63,pz+.32,.34,.55,.04,0,-a);}
     cylinder('stone',w/2-1.3,1.02,-d/2+1.15,.72,2.04);add('cone','roof',w/2-1.3,2.29,-d/2+1.15,.85,.66,.85);
     box('wood',.15,.82,-d/2+1,3.10,1.64,1.40);box('roof',.15,1.72,-d/2+1,3.25,.16,1.55);
     for(const x of[-1.08,.15,1.38])box('gold',x,.85,-d/2+1.74,.075,1.45,.05);
    }else{
     const bz=-d/2+1.20;
     for(const x of[-3.2,3.2])for(const z of[bz-.6,bz+.6]){box('stone',x,.2,z,.36,.4,.36);box('dark',x,1.62,z,.14,3.24,.16);}
     box('roof',0,3.36,bz,6.75,.17,2.12,0,.025);box('gold',0,3.49,bz,6.8,.09,2.15);
     add('cylinder','iron',2.0,1.75,bz,.69,.12,.69,0,0,Math.PI/2);add('cylinder','gold',2.08,1.75,bz,.14,.16,.14,0,0,Math.PI/2);
     for(let i=0;i<5;i++)add('cylinder','wood',-1.4+(i%3)*.46,.45+Math.floor(i/3)*.43,bz-.15,.24,1.60,.24,Math.PI/2);
     for(const x of[-2.9,2.9])box('iron',x,1.2,bz,.08,.12,1.55);
    }
   }
  }else if(type==='archer_tower'){
   for(const x of [-1.7,1.7])for(const z of [-1.7,1.7]){box('stone',x,.35,z,.6,.7,.6);box('wood',x,3.2,z,.38,6.4,.38);}
   for(const z of [-1.7,1.7])for(const side of [-1,1])box('trim',0,3,z,.2,6.7,.19,0,side*.51);
   box('dark',0,6.1,0,4.4,.35,4.4);for(const x of [-2,2])box('trim',x,6.8,0,.12,.65,4.3);for(const z of [-2,2])box('trim',0,6.8,z,4.3,.65,.12);
   roof(4.1,4.1,8.7,1.7);for(const x of [-1.9,1.9])for(const z of [-1.9,1.9])box('wood',x,7.5,z,.18,2.7,.18);
   // Archer silhouette makes the automatic defense immediately recognizable.
   add('barrel','cloth',0,7.1,0,.34,1,.25);add('sphere','pale',0,7.95,0,.29,.34,.28);add('sphere','iron',0,8.10,-.015,.32,.25,.30);box('iron',0,8.06,.22,.66,.07,.16);
   add('bow','wood',.38,7.46,.28,.28,.59,.28,0,0,-Math.PI*.425);box('trim',.63,7.46,.28,.018,1.07,.018);
   for(const side of[-1,1]){cylinder('dark',side*.16,6.48,0,.11,.55);add('barrel','cloth',side*.35,7.32,.14,.14,.56,.13,0,0,side*.78);}
   for(let i=0;i<9;i++)box('trim',0,.42+i*.61,2.18,1,.09,.16);for(const x of [-.58,.58])box('wood',x,3.1,2.18,.1,6.2,.12);
   if(level>=2){
    box('stone',0,1.4,0,3.82,2.8,3.82);box('pale',0,2.9,0,3.94,.22,3.94);
    for(const x of[-1.70,1.70])for(const z of[-1.70,1.70])for(const y of[3.35,4.85,5.85])box('iron',x,y,z,.45,.13,.45);
    for(const side of[-1,1])for(let i=0;i<5;i++){const along=-1.72+i*.86;box('stone',side*2.02,7.10,along,.27,.55,.47);box('stone',along,7.10,side*2.02,.47,.55,.27);}
    for(const side of[-1,1]){box('roof',side*1.28,5.3,2.13,.72,1.30,.07);box('gold',side*1.28,5.45,2.18,.09,.74,.04);box('gold',side*1.28,5.65,2.18,.47,.075,.04);}
    box('gold',0,10.52,0,.20,.12,5.22);box('iron',0,8.17,0,.78,.20,.68);
   }
  }else if(type==='cannon'){
   box('stone',0,.17,0,4.4,.34,4.4);box('wood',0,.68,0,2.6,.48,2.7);for(const x of [-1.3,1.3])for(const z of [-.8,.8])add('cylinder','dark',x,.65,z,.64,.2,.64,0,0,Math.PI/2);
   const turret=new THREE.Group();turret.name='aiming-cannon';turret.position.y=1.28;group.add(turret);
   const barrel=new THREE.Mesh(new THREE.LatheGeometry([[0,-1.75],[.38,-1.63],[.52,-1.45],[.53,-1.23],[.48,-.6],[.43,.7],[.39,1.18],[.42,1.52],[.49,1.61],[.48,1.75],[.32,1.75],[.32,1.50]].map(([r,y])=>new THREE.Vector2(r,y)),24),materials.iron);barrel.position.set(0,0,.6);barrel.rotation.x=Math.PI/2-.13;barrel.castShadow=true;barrel.userData.sharedMaterial=true;turret.add(barrel);
   const muzzle=new THREE.Mesh(new THREE.CylinderGeometry(.32,.32,.04,24),materials.dark);muzzle.position.set(0,.24,2.32);muzzle.rotation.x=Math.PI/2;muzzle.userData.sharedMaterial=true;turret.add(muzzle);
   for(let i=0;i<6;i++)add('sphere','iron',-1.7+(i%2)*.42,.5+Math.floor(i/4)*.32,-1.6+Math.floor(i/2)*.4,.22,.22,.22);
   for(const x of[-1.42,1.42])for(const z of[-.8,.8]){
    add('ring','iron',x,.65,z,.56,.56,.56,0,Math.PI/2);
    for(let spoke=0;spoke<4;spoke++)add('box','trim',x,.65,z,.085,1.03,.075,spoke*Math.PI/4,0,0);
    add('cylinder','iron',x,.65,z,.12,.09,.12,0,0,Math.PI/2);
   }
   if(level>=2){
    for(const side of[-1,1]){box('stone',side*1.80,.65,-.2,.40,1.15,3.8);box('pale',side*1.80,1.27,-.2,.49,.15,3.86);}
    box('stone',0,.68,-1.91,3.8,1.1,.35);box('gold',0,1.28,-1.91,3.9,.10,.39);
    for(const x of[-1.3,1.3])for(const z of[-.8,.8])add('cylinder','iron',x,.65,z,.66,.24,.66,0,0,Math.PI/2);
    for(const z of[-.68,.62,1.67]){
     const ring=new THREE.Mesh(new THREE.TorusGeometry(.465,.055,6,16),materials.gold);ring.position.set(0,(z-.6)*Math.sin(.13),z);ring.rotation.x=-.13;ring.castShadow=true;ring.userData.sharedMaterial=true;turret.add(ring);
    }
    const brace=new THREE.Mesh(new THREE.BoxGeometry(1.42,.28,.96),materials.iron);brace.position.set(0,-.17,-.34);brace.castShadow=true;brace.userData.sharedMaterial=true;turret.add(brace);
   }
  }
  for(const {shape,material,transforms} of batch.values()){
   const mesh=new THREE.InstancedMesh(geometries[shape],materials[material],transforms.length);mesh.name=`plot-${shape}-${material}`;
   transforms.forEach((matrix,index)=>{mesh.setMatrixAt(index,matrix);const e=matrix.elements,range=material==='roof'?.23:material==='stone'?.11:.07,variation=1-range+range*(.5+.5*Math.sin(e[12]*19.7+e[13]*13.9+e[14]*7.3));mesh.setColorAt(index,new THREE.Color().setScalar(variation));});
   mesh.castShadow=true;mesh.receiveShadow=true;mesh.computeBoundingSphere();group.add(mesh);
  }
  return group;
 }
 function remove(group){
  group.traverse(object=>{if(!object.isMesh)return;if(object.isInstancedMesh){object.dispose();return;}object.geometry.dispose();if(!object.userData.sharedMaterial){object.material.map?.dispose();object.material.dispose();}});root.remove(group);
 }
 function resetEffects(){for(const effect of shots.values())root.remove(effect.group);shots.clear();impacts.reset();baselineEffects=true;lastClock=null;}
 function update(state={},time=renderTime){
  if(disposed)return;
  renderTime=time;
  const nextVillage=state.id??null;
  if(nextVillage!==villageId||Number.isFinite(lastClock)&&Number.isFinite(state.clock)&&state.clock<lastClock){resetEffects();villageId=nextVillage;}
  const rows=Array.isArray(state.plots)?state.plots:Object.values(state.plots||{}),states=new Map(rows.map(plot=>[plot.id,plot]));
  for(const plot of PLOTS){
   const value=states.get(plot.id),ruined=Boolean(value?.building&&value.hp<=0),key=[value?.ownerId??'',value?.building??'',value?.level??0,ruined].join(':');
   let record=records.get(plot.id);
   if(record?.key!==key){if(record)remove(record.group);record={key,group:build(plot,value)};records.set(plot.id,record);}
   const shot=value?.lastShot;
   if(!ruined&&value?.building!=='wizard_tower'&&shot&&Number.isFinite(shot.x)&&Number.isFinite(shot.z)&&Number.isFinite(shot.until)){
    const turret=record.group.getObjectByName('aiming-cannon');
    if(turret)turret.rotation.y=Math.atan2(shot.x-plot.x,shot.z-plot.z)-(plot.yaw??0);
    let effect=shots.get(plot.id);
    if(!effect){
     const group=new THREE.Group();group.name=`shot-${plot.id}`;root.add(group);
     const projectile=new THREE.Mesh(value.building==='cannon'?geometries.rock:geometries.box,value.building==='cannon'?materials.iron:materials.gold);
     projectile.scale.set(...(value.building==='cannon'?[.24,.24,.24]:[.065,.065,.95]));group.add(projectile);
     const flash=new THREE.Mesh(geometries.rock,materials.glass);group.add(flash);
     effect={group,projectile,flash,seen:null,start:new THREE.Vector3(),target:new THREE.Vector3(),started:-1,duration:.55,cannon:value.building==='cannon',pendingImpact:false};shots.set(plot.id,effect);
    }
    const cannon=value.building==='cannon';
    if(effect.cannon!==cannon){effect.cannon=cannon;effect.projectile.geometry=cannon?geometries.rock:geometries.box;effect.projectile.material=cannon?materials.iron:materials.gold;effect.projectile.scale.set(...(cannon?[.24,.24,.24]:[.065,.065,.95]));effect.seen=null;effect.pendingImpact=false;}
    const shotId=shot.id??shot.until;
    if(effect.seen!==shotId){
     effect.seen=shotId;
     if(!baselineEffects&&shot.until>=(state.clock??shot.until)-.6){
      effect.started=time;effect.pendingImpact=cannon;effect.start.set(plot.x,effect.cannon?1.55:7.7,plot.z);effect.target.set(shot.x,Number.isFinite(shot.y)?shot.y:groundHeight(shot.x,shot.z)+.9,shot.z);
      shotDirection.copy(effect.target).sub(effect.start).normalize();if(effect.cannon)effect.start.addScaledVector(shotDirection,2.05);
      effect.duration=Math.max(.18,Math.min(.6,effect.start.distanceTo(effect.target)/45));effect.flash.position.copy(effect.start);
     }
    }
   }
  }
  for(const [plotId,effect] of shots){
   const value=states.get(plotId),elapsed=(time-effect.started)/effect.duration;
   if(effect.pendingImpact&&elapsed>=1){
    effect.pendingImpact=false;
    if(value?.building==='cannon'&&value.hp>0&&time-effect.started<=effect.duration+.30)impacts.emit(effect.target,effect.started+effect.duration);
   }
   if(!value?.building||value.hp<=0)effect.pendingImpact=false;
   effect.group.visible=Boolean(value?.building&&value.hp>0&&effect.started>=0&&elapsed>=0&&elapsed<1);
   if(!effect.group.visible)continue;
   effect.projectile.position.lerpVectors(effect.start,effect.target,elapsed);effect.projectile.position.y+=Math.sin(elapsed*Math.PI)*(effect.cannon ? .22 : 1.1);
   shotDirection.copy(effect.target).sub(effect.projectile.position).normalize();effect.projectile.quaternion.setFromUnitVectors(forward,shotDirection);
   effect.flash.visible=effect.cannon&&elapsed<.27;effect.flash.scale.setScalar(.75*(1-elapsed));
  }
  impacts.update(time);
  if(Number.isFinite(state.clock)){baselineEffects=false;lastClock=state.clock;}
 }

 update();
 return {root,update,resetEffects,impactEffects:impacts,dispose(){if(disposed)return;disposed=true;resetEffects();impacts.dispose();for(const record of records.values())remove(record.group);records.clear();for(const geometry of Object.values(geometries))geometry.dispose();for(const material of Object.values(materials))material.dispose();parent.remove(root);}};
}
