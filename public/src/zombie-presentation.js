import * as THREE from 'three';
import { createCharacter } from './characters.js';
import { CAVE_AREAS, CAVE_HEIGHTS, groundHeight } from '../../shared/world.js';
import { ENEMY_TYPES, enemyKind, emergenceProgress } from '../../shared/enemies.js';

const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const ease=t=>{t=clamp(t);return t*t*(3-2*t);};
const TAU=Math.PI*2;
const SHAPES={shambler:[1,1,1],runner:[.78,1.06,.80],armored:[1.10,1,1.05],splitter:[1.30,1,1.20],splinter:[.83,.94,.85],siege:[1.26,1,1.13]};
const TINTS={runner:0xbd997f,armored:0x9aa69f,splitter:0xbab88e,splinter:0xb8c38d,siege:0x9caba7};
// Small rigid fittings are shared between living instances; each actor's skin,
// skeleton, cloned palette and transparent effect materials remain its own.
const resourcePool=new Map();
function acquire(key,make,leases){
  let entry=resourcePool.get(key);
  if(!entry){entry={value:make(),users:0};resourcePool.set(key,entry);}
  if(!leases.has(key)){entry.users++;leases.add(key);}
  return entry.value;
}
function release(leases){for(const key of leases){const e=resourcePool.get(key);if(e&&!--e.users){e.value.dispose();resourcePool.delete(key);}}leases.clear();}
function surface(rows,segments,sample){
  const p=[],ix=[];
  for(let y=0;y<=rows;y++)for(let x=0;x<=segments;x++)p.push(...sample(x/segments,y/rows));
  for(let y=0;y<rows;y++)for(let x=0;x<segments;x++){const a=y*(segments+1)+x,b=a+segments+1;ix.push(a,b,a+1,b,b+1,a+1);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setIndex(ix);g.computeVertexNormals();return g;
}
function curve(points,radius=.012){return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),Math.max(8,points.length*4),radius,5,false);}
function hash(value){let h=2166136261;for(const c of String(value??''))h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;}

export function createZombiePresentation(initial={},seed=hash(initial.id)) {
  const kind=enemyKind(initial);
  const type=ENEMY_TYPES[kind];
  const base=createCharacter('zombie',seed),group=new THREE.Group();group.name=`enemy-${kind}`;group.add(base.group);
  const scale=Number(type.scale)||1,shape=SHAPES[kind];
  const fullScale=new THREE.Vector3(shape[0]*scale,shape[1]*scale,shape[2]*scale);
  base.group.scale.copy(fullScale);
  const joints={};base.group.traverse(n=>{if(n.isBone&&n.name)joints[n.name]=n;});
  const leases=new Set(),owned=new Set(),clonedMaterials=new Map(),restored=[];
  let disposed=false;
  const material=(key,color,metalness=0,roughness=.85,emissive=0)=>acquire(`mat:${key}`,()=>new THREE.MeshStandardMaterial({color,metalness,roughness,emissive,emissiveIntensity:emissive?.50:0,side:THREE.DoubleSide}),leases);
  const fit=(parent,key,build,mat,name)=>{
    const mesh=new THREE.Mesh(acquire(`geo:${key}`,build,leases),mat);mesh.name=name||key;mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
  };
  if(TINTS[kind])base.group.traverse(n=>{
    if(!n.isMesh)return;
    const tint=m=>{if(!clonedMaterials.has(m)){const c=m.clone();c.color?.multiply(new THREE.Color(TINTS[kind]));clonedMaterials.set(m,c);owned.add(c);}return clonedMaterials.get(m);};
    n.material=Array.isArray(n.material)?n.material.map(tint):tint(n.material);
  });
  const rust=material('rust',0x695443,.52,.84),iron=material('iron',0x485355,.62,.58),edge=material('edge',0x849088,.58,.55),leather=material('leather',0x463c2f),moss=material('moss',0x526b3d),glow=material('brood-seams',0xb5c274,.05,.75,0x71812d);
  if(kind==='armored'||kind==='siege'){
    const siege=kind==='siege';
    // Curved breastplate and collar hug the existing tailored torso. The face
    // and hands remain the original continuous sculpted surfaces.
    fit(joints.body,'breastplate',()=>surface(14,24,(u,v)=>{
      const a=(u-.5)*Math.PI*1.30,y=-.20+v*.67;
      const w=.305+.025*Math.sin(v*Math.PI),d=.221+.027*Math.sin(v*Math.PI);
      return [Math.sin(a)*w,y,Math.cos(a)*d+.005];
    }),siege?iron:rust,'rusted-breastplate');
    for(const side of [-1,1]){
      const arm=side===1?joints.leftArm:joints.rightArm;
      fit(arm,'shoulder-shell',()=>surface(8,18,(u,v)=>{
        const a=(u-.5)*Math.PI*1.7,r=.142+.014*Math.sin(v*Math.PI);
        return [Math.sin(a)*r,.095-v*.24,Math.cos(a)*r];
      }),iron,'overlapping-shoulder-plate');
      fit(joints.body,`plate-rim:${side}`,()=>curve([[side*.27,-.20,.18],[side*.30,.08,.17],[side*.28,.34,.17],[side*.16,.46,.16]],.011),edge);
      fit(arm,'plate-rivet',()=>new THREE.SphereGeometry(.017,8,6),edge).position.set(side*.10,-.025,.115);
    }
    fit(joints.head,'broken-helmet',()=>surface(10,28,(u,v)=>{
      const a=u*TAU,phi=v*1.40,r=.273,cut=.012*Math.sin(a*7);
      return [Math.sin(a)*r*Math.sin(phi),.055+Math.cos(phi)*.27+cut,Math.cos(a)*.232*Math.sin(phi)-.015];
    }),iron,'broken-helmet');
    fit(joints.head,'helmet-brow',()=>curve([[-.225,.11,.085],[-.17,.107,.19],[0,.10,.223],[.17,.107,.19],[.225,.11,.085]],.014),edge);
    if(siege){
      // A stone grave slab carried against its back makes the fifth-night
      // attacker recognizable from behind, without changing its skeleton.
      const slabShape=new THREE.Shape();slabShape.moveTo(-.25,-.34);slabShape.lineTo(.25,-.34);slabShape.lineTo(.30,.40);slabShape.quadraticCurveTo(0,.67,-.30,.40);slabShape.closePath();
      const slab=fit(joints.body,'siege-gravestone',()=>new THREE.ExtrudeGeometry(slabShape,{depth:.13,bevelEnabled:true,bevelSize:.025,bevelThickness:.025,bevelSegments:2}),material('grave-slab',0x7c8279,.05,.95),'carried-gravestone');slab.position.set(0,.08,-.40);
      for(const side of [-1,1])fit(joints.body,`siege-strap:${side}`,()=>curve([[side*.19,-.2,.24],[side*.24,.23,.24],[side*.21,.48,.10],[side*.23,.53,-.29],[side*.20,-.22,-.41]],.025),leather,'slab-harness');
    }
  }
  if(kind==='splitter'||kind==='splinter'){
    const small=kind==='splinter';
    fit(joints.body,`brood-mantle:${small}`,()=>surface(20,32,(u,v)=>{
      const a=u*TAU,y=-.38+v*.91;
      const bulge=Math.sin(v*Math.PI),w=.18+.205*bulge,d=.145+.135*bulge;
      const fold=1+.023*Math.sin(a*9+v*3),hem=(1-v)**8*(.018+Math.sin(a*7)*.028);
      return [Math.sin(a)*w*fold,y+hem,Math.cos(a)*d*fold];
    }),moss,'torn-brood-mantle');
    for(const side of [-1,1])fit(joints.body,`brood-seam:${side}`,()=>curve([[side*.07,-.25,.22],[side*.11,-.08,.28],[side*.08,.03,.285],[side*.17,.19,.27],[side*.12,.31,.23]],small?.007:.010),glow,'glowing-mantle-seam');
    if(!small)for(const side of [-1,1])fit(joints.body,`brood-rag:${side}`,()=>surface(8,4,(u,v)=>[side*(.21+u*.08),-.24-v*.29,.12+.03*Math.sin(v*4+u*3)]),leather,'trailing-brood-rag');
  }
  if(kind==='runner'){
    const red=material('runner-wrap',0x884e39);
    fit(joints.body,'runner-wrap',()=>surface(3,28,(u,v)=>[Math.sin(u*TAU)*.135,.49+v*.09,Math.cos(u*TAU)*.135]),red,'red-neck-wrap');
    fit(joints.body,'runner-rag',()=>surface(10,4,(u,v)=>[-.035+u*.08,.47-v*.30,-.14-v*.18+Math.sin(v*5)*.02]),red,'trailing-red-wrap');
  }
  const effects=new THREE.Group();effects.name='enemy-ground-effects';group.add(effects);
  const dirtMat=new THREE.MeshStandardMaterial({color:0x594b34,roughness:1,transparent:true,opacity:1,depthWrite:false});owned.add(dirtMat);
  const dustMat=new THREE.PointsMaterial({color:kind==='splinter'?0xc5c18b:0xaa9270,size:.20,transparent:true,opacity:0,depthWrite:false,sizeAttenuation:true});owned.add(dustMat);
  dustMat.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>', 'float dustRadius=length(gl_PointCoord-vec2(.5)); if(dustRadius>.5)discard; diffuseColor.a*=1.0-smoothstep(.08,.5,dustRadius);\n#include <alphatest_fragment>');};
  const soil=new THREE.InstancedMesh(acquire('geo:soil-clod',()=>new THREE.IcosahedronGeometry(1,0),leases),dirtMat,12);soil.name='rising-soil';soil.instanceMatrix.setUsage(THREE.DynamicDrawUsage);soil.frustumCulled=false;effects.add(soil);
  const dustGeo=new THREE.BufferGeometry();dustGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(18*3),3));owned.add(dustGeo);const dust=new THREE.Points(dustGeo,dustMat);dust.name='grave-dust';dust.frustumCulled=false;effects.add(dust);
  const patchMat=new THREE.MeshBasicMaterial({color:0x332c22,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide});owned.add(patchMat);
  const patch=new THREE.Mesh(acquire('geo:grave-patch',()=>new THREE.CircleGeometry(1,24),leases),patchMat);patch.name='disturbed-grave';patch.rotation.x=-Math.PI/2;patch.position.y=.018;effects.add(patch);
  const warningMat=new THREE.MeshBasicMaterial({color:0xff9a4c,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide});owned.add(warningMat);
  const warning=new THREE.Mesh(acquire('geo:slam-warning',()=>new THREE.RingGeometry(.978,1,48),leases),warningMat);warning.name='enemy-attack-warning';warning.rotation.x=-Math.PI/2;warning.position.y=.035;group.add(warning);
  const fillMat=new THREE.MeshBasicMaterial({color:0xea4638,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide});owned.add(fillMat);
  const warningFill=new THREE.Mesh(acquire('geo:grave-patch',()=>new THREE.CircleGeometry(1,24),leases),fillMat);warningFill.name='enemy-attack-footprint';warningFill.rotation.x=-Math.PI/2;warningFill.position.y=.030;group.add(warningFill);
  const markerCenter={x:0,z:0,height:0};
  const outlineTerrain={flat:warning.geometry,geometry:null,key:null},fillTerrain={flat:warningFill.geometry,geometry:null,key:null};
  const matrix=new THREE.Matrix4(),rotation=new THREE.Quaternion(),pos=new THREE.Vector3(),size=new THREE.Vector3(),euler=new THREE.Euler();
  const birthSeed=(seed%997)*.017;
  const solePoint=new THREE.Vector3();
  function groundFeet(){
    base.group.updateMatrixWorld(true);let lowest=Infinity;
    for(const foot of [joints.leftFoot,joints.rightFoot])for(const x of [-.14,.14])for(const z of [-.135,.316]){solePoint.set(x,-.152,z).applyMatrix4(foot.matrixWorld);lowest=Math.min(lowest,solePoint.y);}
    base.group.position.y+=group.position.y+.018-lowest;
  }
  function markerPosition(entity,slam=false){
    const x=entity[slam?'lastSlamX':'windupX'],z=entity[slam?'lastSlamZ':'windupZ'];
    const targetX=Number.isFinite(x)?x:group.position.x,targetZ=Number.isFinite(z)?z:group.position.z;
    const dx=targetX-group.position.x,dz=targetZ-group.position.z,c=Math.cos(group.rotation.y),s=Math.sin(group.rotation.y);
    // The committed target can sit farther up/down a ramp than its attacker.
    const floor=groundHeight(targetX,targetZ),height=floor-group.position.y;
    markerCenter.x=targetX;markerCenter.z=targetZ;markerCenter.height=floor;
    warning.position.set(c*dx-s*dz,height+.035,s*dx+c*dz);
    // Keep the terrain samples in world compass directions even while the
    // attacker's interpolated yaw changes around this committed footprint.
    warning.rotation.z=-group.rotation.y;
  }
  function conformMarker(mesh,cache){
    const radius=mesh.scale.x,{x,z,height}=markerCenter;
    if(!(radius>0))return;
    if(cache.key&&Math.abs(cache.key.x-x)<1e-6&&Math.abs(cache.key.z-z)<1e-6&&cache.key.radius===radius){mesh.geometry=cache.geometry||cache.flat;return;}
    const source=cache.flat.attributes.position,nearCave=CAVE_AREAS.some(area=>Math.abs(x-area.x)<=area.w/2+radius&&Math.abs(z-area.z)<=area.d/2+radius);
    let uneven=false;
    if(nearCave)for(let i=0;i<source.count;i++)if(Math.abs(groundHeight(x+source.getX(i)*radius,z-source.getY(i)*radius)-height)>1e-5){uneven=true;break;}
    cache.key={x,z,radius};
    if(cache.geometry){owned.delete(cache.geometry);cache.geometry.dispose();cache.geometry=null;}
    if(!uneven){mesh.geometry=cache.flat;return;}
    const positions=[],uvs=[],indices=[],index=cache.flat.index,knots=CAVE_HEIGHTS.map(row=>(z-row.z)/radius).filter(y=>y>-1&&y<1).sort((a,b)=>a-b);
    // Split triangles at the ramp/landing breaks before lifting them. Merely
    // moving a circle's rim would leave its triangle interiors under a ramp.
    function clipped(poly,line,below){
      const out=[];
      for(let i=0;i<poly.length;i++){
        const a=poly[i],b=poly[(i+1)%poly.length],inside=below?a[1]<=line:a[1]>=line,next=below?b[1]<=line:b[1]>=line;
        if(inside)out.push(a);
        if(inside!==next){const t=(line-a[1])/(b[1]-a[1]);out.push([a[0]+(b[0]-a[0])*t,line]);}
      }
      return out;
    }
    for(let i=0;i<(index?index.count:source.count);i+=3){
      let pieces=[[0,1,2].map(j=>{const n=index?index.getX(i+j):i+j;return [source.getX(n),source.getY(n)];})];
      for(const line of knots){
        const next=[];
        for(const poly of pieces){
          let low=Infinity,high=-Infinity;for(const point of poly){low=Math.min(low,point[1]);high=Math.max(high,point[1]);}
          if(low<line-1e-9&&high>line+1e-9)next.push(clipped(poly,line,true),clipped(poly,line,false));else next.push(poly);
        }pieces=next;
      }
      for(const poly of pieces){
        const first=positions.length/3;
        for(const [px,py]of poly){positions.push(px,py,(groundHeight(x+px*radius,z-py*radius)-height)/radius);uvs.push(px*.5+.5,py*.5+.5);}
        for(let j=1;j<poly.length-1;j++)indices.push(first,first+j,first+j+1);
      }
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();
    cache.geometry=geometry;owned.add(geometry);mesh.geometry=geometry;
  }
  function rememberRotation(joint,x=0,y=0,z=0){restored.push([joint,joint.rotation.x,joint.rotation.y,joint.rotation.z]);joint.rotation.x+=x;joint.rotation.y+=y;joint.rotation.z+=z;}
  function restore(){for(const [joint,x,y,z]of restored)joint.rotation.set(x,y,z);restored.length=0;}
  function updateBirth(entity,time,progress){
    const split=entity.birth==='split',active=progress<1&&Number.isFinite(entity.spawnAt);
    effects.visible=active;effects.position.set(0,0,0);soil.visible=true;patch.visible=true;base.group.position.y=0;base.group.scale.copy(fullScale);
    if(!active)return;
    const rise=ease(progress),lift=split?Math.sin(progress*Math.PI)*.20:-(2.6*fullScale.y)*(1-rise);
    base.group.position.y=lift;
    if(split)base.group.scale.multiplyScalar(.64+.36*rise);
    else{
      const struggle=Math.sin(progress*Math.PI),reach=Math.sin(ease(progress)*Math.PI);
      rememberRotation(joints.body,.60*(1-rise),0,.10*Math.sin(progress*13)*struggle);
      rememberRotation(joints.head,-.32*(1-rise));
      rememberRotation(joints.leftArm,-2.45*reach,0,.18*struggle);
      rememberRotation(joints.rightArm,-2.20*reach,0,-.23*struggle);
      rememberRotation(joints.leftFore,-.48*struggle);rememberRotation(joints.rightFore,-.65*struggle);
      rememberRotation(joints.leftLeg,-.34*struggle);rememberRotation(joints.rightShin,.42*struggle);
    }
    const fade=Math.sin(progress*Math.PI)**.6,spread=(split?.25:.18)+rise*(split?1.35:.88)*scale;
    patch.scale.setScalar((split?.55:.75)*scale*(.80+rise*.20));patchMat.opacity=(split?.24:.65)*fade;
    dirtMat.opacity=.9*fade;dustMat.opacity=.42*fade;
    for(let i=0;i<12;i++){
      const angle=i/12*TAU+birthSeed,phase=(i%3)*.09;
      const burst=clamp((progress-phase)/(1-phase)),radius=spread*(.64+(i%4)*.15);
      pos.set(Math.cos(angle)*radius,.035+Math.sin(burst*Math.PI)*(split?.45:.30)+(i%2)*.025,Math.sin(angle)*radius);
      euler.set(burst*4+i,angle,burst*3);rotation.setFromEuler(euler);const s=(.045+(i%4)*.017)*scale;size.set(s*1.35,s*.65,s);
      matrix.compose(pos,rotation,size);soil.setMatrixAt(i,matrix);
    }
    soil.instanceMatrix.needsUpdate=true;
    const p=dustGeo.attributes.position;for(let i=0;i<p.count;i++){const a=i/p.count*TAU+birthSeed,r=spread*(.75+(i%5)*.09);p.setXYZ(i,Math.cos(a)*r,.05+rise*(.38+(i%4)*.15)*scale,Math.sin(a)*r);}p.needsUpdate=true;
  }
  function updateFromState(entity,worldTime,dt,options={}){
    if(disposed)return;
    restore();const time=Number.isFinite(worldTime)?worldTime:0,alive=!(Number.isFinite(entity.hp)&&entity.hp<=0);
    const progress=emergenceProgress(entity,time),emerging=progress<1;
    const windup=alive&&Number.isFinite(entity.windupUntil)&&entity.windupUntil>time&&Number.isFinite(entity.windupStartedAt);
    base.update(dt,time,{...options,moving:!emerging&&!windup&&options.moving,attack:!emerging&&!windup&&options.attack,tool:''});
    // Additive poses are restored before the next base animation update, so
    // broad shoulders / faster gait never accumulate rotation over frames.
    if(!emerging){
      const phase=time*(kind==='runner'?11:kind==='splinter'?14:4)+(seed%17);
      if(kind==='runner'||kind==='splinter'){
        const moving=options.moving?1:0;
        rememberRotation(joints.body,.17*moving,0,Math.sin(phase)*.035*moving);
        rememberRotation(joints.head,-.12*moving);
        rememberRotation(joints.leftArm,Math.sin(phase)*.33*moving);
        rememberRotation(joints.rightArm,-Math.sin(phase)*.33*moving);
        rememberRotation(joints.leftFore,-.28*moving);rememberRotation(joints.rightFore,-.28*moving);
        rememberRotation(joints.leftLeg,Math.sin(phase)*.18*moving);rememberRotation(joints.rightLeg,-Math.sin(phase)*.18*moving);
      }else if(kind==='splitter'||kind==='siege'){
        rememberRotation(joints.leftArm,0,0,.13);rememberRotation(joints.rightArm,0,0,-.13);
        rememberRotation(joints.body,.05);
      }
    }
    updateBirth(entity,time,progress);
    warning.visible=false;warningFill.visible=false;warningMat.opacity=0;fillMat.opacity=0;
    const heavy=kind==='splitter'||kind==='siege';
    if(!emerging&&windup){
      const p=ease((time-entity.windupStartedAt)/Math.max(.001,entity.windupUntil-entity.windupStartedAt));
      rememberRotation(joints.body,(heavy?-.28:-.10)*p);rememberRotation(joints.head,.14*p);
      rememberRotation(joints.leftArm,(heavy?-2.05:-.36)*p);rememberRotation(joints.rightArm,(heavy?-2.15:-1.0)*p);
      rememberRotation(joints.leftFore,-.25*p);rememberRotation(joints.rightFore,-.22*p);
      warning.visible=true;markerPosition(entity);warning.scale.setScalar(Number(entity.windupRadius)||1.45);conformMarker(warning,outlineTerrain);
      warningMat.opacity=.20+p*.28;warningMat.color.set(0xd14c40).lerp(new THREE.Color(0xff4436),p);
      warningFill.visible=true;warningFill.position.copy(warning.position);warningFill.position.y-=.005;warningFill.scale.copy(warning.scale);warningFill.rotation.copy(warning.rotation);conformMarker(warningFill,fillTerrain);
      fillMat.opacity=.045+.055*p+.008*Math.sin(p*TAU*2);
    }else if(alive&&!emerging&&Number.isFinite(entity.lastSlamAt)&&time>=entity.lastSlamAt&&time-entity.lastSlamAt<.48){
      const p=(time-entity.lastSlamAt)/.48,impact=1-ease(p),radius=Number(entity.lastSlamRadius)||Number(entity.windupRadius)||1.45;
      rememberRotation(joints.body,(heavy?.38:.18)*impact);rememberRotation(joints.leftArm,(heavy?-.85:-.45)*impact);rememberRotation(joints.rightArm,-.90*impact);
      warning.visible=true;markerPosition(entity,true);warning.scale.setScalar(radius);conformMarker(warning,outlineTerrain);warningMat.color.set(0xffb18d);warningMat.opacity=.40*(1-p);
      // The attack footprint stays at the exact server radius. Dust rises at
      // the confirmed contact, without falsely advertising a larger hit area.
      effects.visible=true;effects.position.copy(warning.position);effects.position.y-=.035;soil.visible=false;patch.visible=false;
      dustMat.opacity=(heavy?.42:.24)*(1-p);const vertices=dustGeo.attributes.position;
      for(let i=0;i<vertices.count;i++){const angle=i/vertices.count*TAU+birthSeed,r=radius*(.38+.50*p)*(1+(i%3)*.06);vertices.setXYZ(i,Math.cos(angle)*r,.07+p*(heavy?.95:.48)*(1+(i%4)*.2),Math.sin(angle)*r);}vertices.needsUpdate=true;
    }
    if(!alive){effects.visible=false;warning.visible=false;warningFill.visible=false;}
    if(!emerging)groundFeet();
    group.userData.emergenceProgress=progress;
    group.userData.kind=kind;
  }
  function dispose(){if(disposed)return;disposed=true;restore();base.dispose();for(const r of owned)r.dispose();owned.clear();release(leases);group.clear();}
  updateFromState(initial,Number(initial.emergeUntil)||Number(initial.spawnAt)||0,0);
  return {group,updateFromState,dispose,label:type.label||kind,labelHeight:2.65*fullScale.y,kind};
}
