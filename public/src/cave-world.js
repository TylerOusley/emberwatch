import * as THREE from 'three';
import { CAVE_AREAS, CAVE_HEIGHTS, CAVE_ENTRANCE, CAVE_ROUTE, caveAreaAt, caveTierAt, groundHeight, caveDepthAt } from '../../shared/world.js';
import { createSurfaceMaterial } from './surface-materials.js';
import { createWeatheredRockGeometry, createBeveledBlockGeometry } from './environment-geometry.js';

const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const within=(x,z)=>CAVE_AREAS.some(a=>Math.abs(x-a.x)<a.w/2-1e-7&&Math.abs(z-a.z)<a.d/2-1e-7);
function lines(values,step=2){const sorted=[...new Set(values)].sort((a,b)=>a-b),result=[sorted[0]];for(let i=1;i<sorted.length;i++){const from=sorted[i-1],to=sorted[i],count=Math.ceil((to-from)/step);for(let j=1;j<=count;j++)result.push(from+(to-from)*j/count);}return result;}
// The rectangle union is meshed once, rather than placing overlapping room
// floors. Height breakpoints are explicit grid lines, including every ramp end.
export function createCaveLayout(){
  const xs=lines(CAVE_AREAS.flatMap(a=>[a.x-a.w/2,a.x+a.w/2])),zs=lines([...CAVE_AREAS.flatMap(a=>[a.z-a.d/2,a.z+a.d/2]),...CAVE_HEIGHTS.map(a=>a.z)]);
  const cells=[],raw=[];
  for(let j=0;j<zs.length-1;j++)for(let i=0;i<xs.length-1;i++){
    const x=(xs[i]+xs[i+1])/2,z=(zs[j]+zs[j+1])/2;if(!within(x,z))continue;
    cells.push({x0:xs[i],x1:xs[i+1],z0:zs[j],z1:zs[j+1]});
    for(const [vertical,fixed,a,b,nx,nz]of [[true,xs[i],zs[j],zs[j+1],1,0],[true,xs[i+1],zs[j],zs[j+1],-1,0],[false,zs[j],xs[i],xs[i+1],0,1],[false,zs[j+1],xs[i],xs[i+1],0,-1]]){
      const mid=(a+b)/2,edgeX=vertical?fixed:mid,edgeZ=vertical?mid:fixed;
      if(within(edgeX-nx*.01,edgeZ-nz*.01))continue;
      if(!vertical&&Math.abs(fixed-CAVE_ENTRANCE.z)<1e-5)continue; // the open mouth
      raw.push({vertical,fixed,a,b,nx,nz});
    }
  }
  const walls=[];
  for(const edge of raw.sort((a,b)=>Number(a.vertical)-Number(b.vertical)||a.fixed-b.fixed||a.nx-b.nx||a.nz-b.nz||a.a-b.a)){
    const prior=walls.at(-1);
    if(prior&&prior.vertical===edge.vertical&&prior.fixed===edge.fixed&&prior.nx===edge.nx&&prior.nz===edge.nz&&Math.abs(prior.b-edge.a)<1e-6)prior.b=edge.b;
    else walls.push({...edge});
  }
  return {cells,walls};
}
function coloredGeometry(vertices,colors,smooth=false){
  const g=new THREE.BufferGeometry();
  if(smooth){const unique=new Map(),positions=[],tints=[],indices=[];for(let i=0;i<vertices.length;i+=3){const key=vertices.slice(i,i+3).map(n=>Math.round(n*1e5)).join(':')+':'+colors.slice(i,i+3).map(n=>Math.round(n*100)).join(':');let index=unique.get(key);if(index===undefined){index=positions.length/3;unique.set(key,index);positions.push(...vertices.slice(i,i+3));tints.push(...colors.slice(i,i+3));}indices.push(index);}g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('color',new THREE.Float32BufferAttribute(tints,3));g.setIndex(indices);}
  else{g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));}
  g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();return g;
}

export function createCaveWorld(scene){
  const root=new THREE.Group();root.name='The Deepworks cave';scene?.add(root);
  const interior=new THREE.Group(),roof=new THREE.Group(),mouth=new THREE.Group();interior.name='cave-interior';roof.name='cave-ceiling';mouth.name='cave-mouth';root.add(interior,roof,mouth);
  const owned=new Set(),materials=new Set(),cache=new Map(),batches=new Map(),layout=createCaveLayout();
  const surfaceKinds={'layered-cave-rock':'rock','cave-floor':'earth','aged-mine-timber':'wood','timber-endgrain':'wood','cut-portal-stone':'masonry'};
  const material=(name,color,extra={})=>{const m=surfaceKinds[name]?createSurfaceMaterial(surfaceKinds[name],{color,roughness:.94,worldScale:name==='cave-floor'?3.2:name==='layered-cave-rock'?2.8:2,normalStrength:name==='layered-cave-rock'?.8:.5,colorStrength:.75,...extra}):new THREE.MeshStandardMaterial({color,roughness:.94,...extra});m.name=name;materials.add(m);return m;};
  const rock=material('layered-cave-rock',0xffffff,{vertexColors:true}),floorMat=material('cave-floor',0xffffff,{vertexColors:true,roughness:.94}),wood=material('aged-mine-timber',0xc3ae8d),woodEnd=material('timber-endgrain',0x958775),iron=material('mine-ironwork',0x687273,{metalness:.68,roughness:.46});
  const masonry=material('cut-portal-stone',0xe1dfce),brass=material('mine-brass-inlay',0xc2a267,{metalness:.72,roughness:.35});
  const get=(key,make)=>{if(!cache.has(key)){const g=make();cache.set(key,g);owned.add(g);}return cache.get(key);};
  const box=get('box',createBeveledBlockGeometry),cylinder=get('cylinder',()=>new THREE.CylinderGeometry(1,1,1,16)),dummy=new THREE.Object3D(),up=new THREE.Vector3(0,1,0);
  const add=(parent,g,mat,name)=>{owned.add(g);const mesh=new THREE.Mesh(g,mat);mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;};
  function batch(parent,g,mat,position,scale=[1,1,1],rotation=[0,0,0]){const key=parent.uuid+g.uuid+mat.uuid;if(!batches.has(key))batches.set(key,{parent,g,mat,transforms:[]});dummy.position.set(...position);dummy.scale.set(...scale);dummy.rotation.set(...rotation);dummy.updateMatrix();batches.get(key).transforms.push(dummy.matrix.clone());}
  function beam(parent,a,b,width=.28,depth=width,mat=wood){const p=new THREE.Vector3(...a),q=new THREE.Vector3(...b),length=p.distanceTo(q);dummy.position.copy(p).add(q).multiplyScalar(.5);dummy.scale.set(width,length,depth);dummy.quaternion.setFromUnitVectors(up,q.sub(p).normalize());dummy.updateMatrix();const key=parent.uuid+box.uuid+mat.uuid;if(!batches.has(key))batches.set(key,{parent,g:box,mat,transforms:[]});batches.get(key).transforms.push(dummy.matrix.clone());}
  const v=[],c=[],rv=[],rc=[],wv=[],wc=[],scratch=new THREE.Color();
  const roofRelief=(x,z)=>.21*Math.sin(x*.46+z*.24)*Math.cos(z*.36)+.17*Math.sin(x*.89-z*.32);
  // Distance from the actual irregular perimeter produces a vaulted roof.
  // Wide workings rise above narrow passages; low-frequency folded strata
  // keep adjacent cells continuous rather than making isolated noisy tiles.
  function wallDistance(x,z){let distance=Infinity;for(const e of layout.walls){const t=e.vertical?z:x,along=Math.max(e.a-t,0,t-e.b),across=(e.vertical?x:z)-e.fixed;distance=Math.min(distance,Math.hypot(along,across));}return distance;}
  const ceilingHeight=(x,z)=>6.45+Math.min(3.6,wallDistance(x,z)*.62)+roofRelief(x,z)+.30*Math.sin(z*.09+x*.07)**2;
  function tint(x,y,z,floor=false){const depth=clamp(-y/14),grain=Math.sin(x*17.3+y*9.2+z*13.1)*Math.sin(x*5.3-z*7.8),band=Math.sin(y*2.2+x*.22+z*.16+Math.sin(x*.19-z*.11)*1.6),damp=Math.sin(x*.12+z*.24)*Math.sin(z*.065-y*.11);scratch.set(floor?0xb6aa90:0xb8c2b7).lerp(new THREE.Color(0x78918e),depth*.3);scratch.multiplyScalar(.94+grain*.035+(band>.72?.085:band<-.6?-.09:0)-(damp>.48?.13:0));return scratch.toArray();}
  function tri(out,col,a,b,d,normal,floor=false){const ab=new THREE.Vector3().subVectors(new THREE.Vector3(...b),new THREE.Vector3(...a)),ac=new THREE.Vector3().subVectors(new THREE.Vector3(...d),new THREE.Vector3(...a));if(ab.cross(ac).dot(new THREE.Vector3(...normal))<0)[b,d]=[d,b];for(const p of[a,b,d]){out.push(...p);col.push(...tint(...p,floor));}}
  for(const cell of layout.cells){
    const points=[[cell.x0,cell.z0],[cell.x1,cell.z0],[cell.x1,cell.z1],[cell.x0,cell.z1]].map(([x,z])=>[x,groundHeight(x,z)+.018,z]);
    tri(v,c,points[0],points[1],points[2],[0,1,0],true);tri(v,c,points[0],points[2],points[3],[0,1,0],true);
    const low=points.map(p=>[p[0],p[1]+ceilingHeight(p[0],p[2]),p[2]]),high=points.map(p=>[p[0],p[1]+ceilingHeight(p[0],p[2])+.45,p[2]]);
    tri(rv,rc,low[0],low[1],low[2],[0,-1,0]);tri(rv,rc,low[0],low[2],low[3],[0,-1,0]);tri(rv,rc,high[0],high[1],high[2],[0,1,0]);tri(rv,rc,high[0],high[2],high[3],[0,1,0]);
  }
  add(interior,coloredGeometry(v,c),floorMat,'continuous-cave-floor').castShadow=false;
  add(roof,coloredGeometry(rv,rc,true),rock,'solid-cave-roof');
  for(const edge of layout.walls){
    const breaks=lines([edge.a,edge.b,...(edge.vertical?CAVE_HEIGHTS.map(h=>h.z).filter(z=>z>edge.a&&z<edge.b):[])],1.1),rows=[0,.05,.13,.23,.35,.48,.59,.70,.80,.90,1,1.08];
    function point(t,row){
      const x=edge.vertical?edge.fixed:t,z=edge.vertical?t:edge.fixed,f=rows[row],height=ceilingHeight(x,z),y=groundHeight(x,z)+height*f+(row===0||f>=1?0:Math.sin(f*Math.PI)*(.18*Math.sin(x*.36+z*.23+f*2)+.12*Math.sin(x*.93-z*.12))),fold=(.50+.35*Math.sin(x*.37+z*.25+f*5)+.25*Math.sin(x*.91-z*.17-f*8))*Math.sin(Math.min(1,f)*Math.PI),bulge=row===0?.02:(f<.34?.04+.035*Math.sin(x*.8+z*.37+f*2):.06-Math.max(0,fold));
      let nx=edge.nx,nz=edge.nz;
      // Shared corner displacement rounds the upper shoulders into the rock.
      // Both meeting faces use the same coordinate-based fold, avoiding the
      // old straight posts and tiny cracks from independent edge noise.
      for(const end of[edge.a,edge.b]){const blend=Math.max(0,1-Math.abs(t-end)/1.8)**2;if(!blend)continue;const ex=edge.vertical?edge.fixed:end,ez=edge.vertical?end:edge.fixed;for(const other of layout.walls){if(other===edge||other.vertical===edge.vertical)continue;const joined=other.vertical?Math.abs(other.fixed-ex)<1e-6&&(Math.abs(other.a-ez)<1e-6||Math.abs(other.b-ez)<1e-6):Math.abs(other.fixed-ez)<1e-6&&(Math.abs(other.a-ex)<1e-6||Math.abs(other.b-ex)<1e-6);if(joined){nx+=other.nx*blend;nz+=other.nz*blend;}}}
      return [x+nx*bulge,y,z+nz*bulge];
    }
    for(let i=1;i<breaks.length;i++)for(let j=1;j<rows.length;j++){
      const a=point(breaks[i-1],j-1),b=point(breaks[i],j-1),d=point(breaks[i],j),e=point(breaks[i-1],j);tri(wv,wc,a,b,d,[edge.nx,0,edge.nz]);tri(wv,wc,a,d,e,[edge.nx,0,edge.nz]);
    }
    // Small fractured plates stay against the walls, outside ore approaches.
    for(let t=edge.a+1.7;t<edge.b-1;t+=3.5){const x=edge.vertical?edge.fixed:t,z=edge.vertical?t:edge.fixed;if(Math.abs(x)<6.5&&z>-126)continue;batch(interior,get('wall-fracture',()=>createWeatheredRockGeometry(913,{detail:1})),rock,[x-edge.nx*.18,groundHeight(x,z)+.42,z-edge.nz*.18],[.42,.66,.39],[.2,t*.4,.18]);}
    for(let t=edge.a+2.1;t<edge.b-1.4;t+=6.3){
      const x=edge.vertical?edge.fixed:t,z=edge.vertical?t:edge.fixed;if(z>-132)continue;
      batch(interior,get('wall-buttress',()=>createWeatheredRockGeometry(729,{detail:1})),rock,[x-edge.nx*.10,groundHeight(x,z)+3.35,z-edge.nz*.10],edge.vertical?[.85,.95,1.55]:[1.55,.95,.85],[.08,Math.sin(t)*.1,.07]);
      // Narrow damp fault seams interrupt the broad strata. Both triangles
      // join the rock, with enough physical offset to avoid depth flashing.
      const high=groundHeight(x,z)+4.9,low=groundHeight(x,z)+.50,offset=.095,a=[x+edge.nx*offset,high,z+edge.nz*offset],b=[a[0]+(edge.vertical?0:.21),high-.65,a[2]+(edge.vertical?.21:0)],d=[a[0]+(edge.vertical?0:.08),low,a[2]+(edge.vertical?.08:0)],before=wc.length;
      tri(wv,wc,a,b,d,[edge.nx,0,edge.nz]);for(let i=before;i<wc.length;i++)wc[i]*=.60;
    }
  }
  add(interior,coloredGeometry(wv,wc,true),rock,'inward-facing-cave-walls');
  // Real irregular arch undersides span each change in working width. They
  // close into the roof above, never enter the player's saved floor, and keep
  // at least 5.1 m of clearance below the rock even at their lowest shoulders.
  const av=[],ac=[],archways=[
    {x:0,z:-140,width:12},{x:9,z:-162,width:10},{x:9,z:-174,width:10},{x:4,z:-193,width:10},{x:4,z:-206,width:10},
    {x:-14,z:-150,width:10,vertical:true},{x:-21,z:-152,width:7,vertical:true},{x:14,z:-147,width:8,vertical:true},
    {x:-1,z:-178,width:8,vertical:true},{x:33,z:-181,width:12,vertical:true},{x:40,z:-184,width:7,vertical:true},
    {x:-19,z:-216,width:14,vertical:true},{x:19,z:-223,width:10,vertical:true}
  ];
  for(const arch of archways){
    const segments=Math.ceil(arch.width/.55),depth=1.8;
    function archPoint(u,side,top=false){const along=(u-.5)*arch.width,across=side*(depth/2+(top?1.65:0)),x=arch.x+(arch.vertical?across:along),z=arch.z+(arch.vertical?along:across),ridge=5.26+2.00*Math.sin(u*Math.PI)**.65+.14*Math.sin(u*13+arch.z*.17)*Math.sin(u*Math.PI),height=top?Math.max(ridge+.35,ceilingHeight(x,z)+.20):ridge;return[x,groundHeight(x,z)+height,z];}
    for(let i=0;i<segments;i++){
      const u=i/segments,next=(i+1)/segments,a=archPoint(u,-1),b=archPoint(next,-1),d=archPoint(next,1),e=archPoint(u,1);
      tri(av,ac,a,b,d,[0,-1,0]);tri(av,ac,a,d,e,[0,-1,0]);
      for(const side of[-1,1]){const p=archPoint(u,side),q=archPoint(next,side),r=archPoint(next,side,true),s=archPoint(u,side,true),normal=arch.vertical?[side,0,0]:[0,0,side];tri(av,ac,p,q,r,normal);tri(av,ac,p,r,s,normal);}
    }
  }
  add(roof,coloredGeometry(av,ac,true),rock,'sculpted-working-archways');
  // Fractured roof lenses and a few short stalactites break up the chamber
  // silhouette. Their lowest points remain above the camera's five-meter cap.
  const roofShelf=get('roof-shelf',()=>{const g=createWeatheredRockGeometry(891,{detail:1}),p=g.attributes.position,colors=[];for(let i=0;i<p.count;i++)colors.push(...tint(p.getX(i)*4,p.getY(i)*3,p.getZ(i)*4));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));return g;});
  const stalactite=get('short-stalactite',()=>{const g=new THREE.CylinderGeometry(.025,1,1,9,5),p=g.attributes.position;for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),groove=1+.08*Math.sin(Math.atan2(z,x)*5+y*9);p.setXYZ(i,x*groove+.06*(y+.5),y,z*groove);}g.computeVertexNormals();return g;});
  for(const area of CAVE_AREAS.filter(a=>a.kind==='chamber')){
    for(let x=area.x-area.w/2+3;x<area.x+area.w/2-2;x+=5.7)for(let z=area.z-area.d/2+3;z<area.z+area.d/2-2;z+=6.2){
      const ceilingAt=groundHeight(x,z)+.018+ceilingHeight(x,z);batch(roof,roofShelf,rock,[x,ceilingAt+.15,z],[1.25,.42,1.65],[.025,x*.09,.04]);
      if(Math.sin(x*7+z*3)>.2)batch(roof,stalactite,rock,[x+.6,groundHeight(x+.6,z-.6)+.018+ceilingHeight(x+.6,z-.6)-.10,z-.6],[.22,.72,.25],[0,.4,Math.PI]);
    }
  }
  // Recessed bedrock shoulders support a deliberate hewn-stone facade. All
  // ground-level architecture remains outside the shared twelve-meter ramp.
  const outcrop=get('portal-rock',()=>{
    const g=createWeatheredRockGeometry(814,{detail:2}),p=g.attributes.position,colors=[];
    for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),rough=1+.065*Math.sin(x*5+y*3-z*4)+.025*Math.sin(x*21+y*14+z*13);p.setXYZ(i,x*rough,y*rough,z*rough);colors.push(...tint(x*5,y*4,z*5));}g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.computeVertexNormals();return g;
  });
  const crown=new THREE.Group();crown.name='mouth-rock-crown';mouth.add(crown);
  // One continuous eroded mountain grows directly out of the mouth. Its
  // foothills widen only behind the village wall, preserving every deed and
  // exterior lane. A carved arch, rather than a separate protruding tube,
  // exposes the timber frame four metres inside the mountain face.
  const mv=[],mc=[],ridgeRows=[[-118,14,15],[-124,14,19],[-133,25,24],[-146,45,33],[-163,63,43],[-184,76,52],[-207,85,44],[-232,94,29],[-253,102,8]];
  const ridgePoint=(row,u)=>{const[z,width,height]=row,x=u*width,edge=1-Math.abs(u)**1.4,fold=1+.13*Math.sin(x*.12+z*.045)+.07*Math.sin(x*.29-z*.09);return[x,Math.max(0,height*edge*fold),z];};
  for(let j=1;j<ridgeRows.length;j++)for(let i=0;i<48;i++){
    const u=i/24-1,next=(i+1)/24-1,a=ridgePoint(ridgeRows[j-1],u),b=ridgePoint(ridgeRows[j-1],next),d=ridgePoint(ridgeRows[j],next),e=ridgePoint(ridgeRows[j],u);tri(mv,mc,a,b,d,[0,1,0]);tri(mv,mc,a,d,e,[0,1,0]);
  }
  for(let i=0;i<48;i++){
    const u=i/24-1,next=(i+1)/24-1,a=ridgePoint(ridgeRows[0],u),b=ridgePoint(ridgeRows[0],next),bottom=x=>Math.abs(x)<6.05?6.85+1.5*(1-(Math.abs(x)/6.05)**1.6):0;
    const d=[b[0],bottom(b[0]),-118],e=[a[0],bottom(a[0]),-118];tri(mv,mc,a,b,d,[0,0,1]);tri(mv,mc,a,d,e,[0,0,1]);
  }
  const mountain=add(crown,coloredGeometry(mv,mc,true),rock,'continuous-mouth-mountain');mountain.userData.recessedEntrance=true;
  for(const side of[-1,1]){
    for(let i=0;i<4;i++)batch(mouth,outcrop,rock,[side*(9.5+i*.65),2.25+i*.60,-119.5-i*3.4],[2.7+i*.14,2.9+i*.23,3.2],[.03,side*.13+i*.15,side*.07]);
  }
  for(let i=0;i<9;i++){const a=i/8*Math.PI;batch(crown,outcrop,rock,[Math.cos(a)*6.9,6.2+Math.sin(a)*2.1,-118.6],[1.5,1.05,2.0],[.03,a*.13,a-.8]);}
  // Shared bevel geometry catches the light on individual masonry joints.
  const dressedBlock=get('dressed-portal-block',()=>{
    const shape=new THREE.Shape();shape.moveTo(-.46,-.46);shape.lineTo(.46,-.46);shape.lineTo(.46,.46);shape.lineTo(-.46,.46);shape.closePath();
    const g=new THREE.ExtrudeGeometry(shape,{depth:.92,bevelEnabled:true,bevelThickness:.04,bevelSize:.04,bevelSegments:1,steps:1});g.translate(0,0,-.46);return g;
  });
  const frame=new THREE.Group(),archFrame=new THREE.Group();frame.name='recessed-mine-frame';archFrame.name='recessed-portal-arch';frame.position.z=archFrame.position.z=-4;mouth.add(frame);crown.add(archFrame);
  for(const side of[-1,1]){
    const x=side*7.25;
    for(let row=0;row<6;row++)batch(frame,dressedBlock,masonry,[x,.48+row*.88,-119.05],[2.12,.85,1.85]);
    for(const [height,width,depth]of [[.18,2.43,2.0],[5.40,2.48,2.08]])batch(frame,dressedBlock,masonry,[x,height,-119.06],[width,.29,depth]);
    // Broad buttresses anchor the frame without scattered boulders at its feet.
    for(let row=0;row<4;row++)batch(frame,dressedBlock,masonry,[side*(9.35-row*.12),.50+row*.93,-120.65-row*.10],[2.0-row*.12,.91,3.7]);
    const timberX=side*6.33;
    beam(frame,[timberX,.12,-120.22],[timberX,5.55,-120.22],.43,.48);
    for(const y of[.47,2.70,5.10]){
      batch(frame,box,iron,[timberX,y,-120.22],[.49,.19,.54]);
      batch(frame,cylinder,brass,[timberX,y,-119.92],[.07,.06,.07],[Math.PI/2,0,0]);
    }
    beam(archFrame,[timberX,4.70,-120.22],[timberX-side*.82,5.56,-120.22],.25,.28);
    for(const y of[.80,4.65])batch(frame,dressedBlock,iron,[side*7.25,y,-118.085],[.50,.50,.065],[0,0,Math.PI/4]);
  }
  for(let i=0;i<13;i++){const a=i/12*Math.PI;batch(archFrame,dressedBlock,masonry,[Math.cos(a)*7.05,5.1+Math.sin(a)*2.8,-119.02],[1.14,.86,1.65],[0,0,a-Math.PI/2]);}
  beam(archFrame,[-6.38,5.58,-120.22],[6.38,5.58,-120.22],.35,.54);
  // The broad nameplate and crossed picks make the destination legible from
  // the village. Inlaid letter strokes are actual mesh geometry, not a texture.
  batch(archFrame,dressedBlock,woodEnd,[0,6.14,-117.99],[5.75,.91,.18]);
  for(const y of[5.75,6.53])batch(archFrame,box,brass,[0,y,-117.885],[5.43,.035,.045]);
  const glyphs={D:[[0,0,0,1],[0,1,.72,1],[.72,1,1,.78],[1,.78,1,.22],[1,.22,.72,0],[.72,0,0,0]],E:[[0,0,0,1],[0,1,1,1],[0,.5,.78,.5],[0,0,1,0]],P:[[0,0,0,1],[0,1,1,1],[1,1,1,.53],[1,.53,0,.53]],W:[[0,1,.20,0],[.20,0,.5,.47],[.5,.47,.80,0],[.80,0,1,1]],O:[[0,.15,0,.85],[0,.85,.18,1],[.18,1,.82,1],[.82,1,1,.85],[1,.85,1,.15],[1,.15,.82,0],[.82,0,.18,0],[.18,0,0,.15]],R:[[0,0,0,1],[0,1,1,1],[1,1,1,.53],[1,.53,0,.53],[.47,.53,1,0]],K:[[0,0,0,1],[0,.45,1,1],[.3,.62,1,0]],S:[[1,1,0,1],[0,1,0,.53],[0,.53,1,.53],[1,.53,1,0],[1,0,0,0]]};
  [...'DEEPWORKS'].forEach((letter,i)=>{for(const [x0,y0,x1,y1]of glyphs[letter])beam(archFrame,[-2.24+i*.51+x0*.36,5.90+y0*.49,-117.86],[-2.24+i*.51+x1*.36,5.90+y1*.49,-117.86],.043,.039,brass);});
  batch(archFrame,dressedBlock,iron,[0,7.51,-119.30],[1.32,1.32,.15],[0,0,Math.PI/4]);
  for(const side of[-1,1]){
    beam(archFrame,[side*.47,7.05,-119.18],[-side*.40,7.88,-119.18],.075,.085,wood);
    beam(archFrame,[-side*.68,7.61,-119.14],[-side*.44,7.91,-119.14],.085,.085,brass);
    beam(archFrame,[-side*.44,7.91,-119.14],[-side*.08,8.03,-119.14],.085,.085,brass);
  }
  // Low sleepers and two continuous rails follow the authoritative slope;
  // decorative track never introduces a raised collision step in the ramp.
  for(let z=-117.3;z>=-140;z-=1.75){
    const y=groundHeight(0,z);batch(mouth,box,woodEnd,[0,y+.035,z],[3.13,.055,.25]);
    for(const x of[-1.12,1.12])batch(mouth,box,iron,[x,y+.075,z],[.25,.035,.31]);
  }
  for(const x of[-1.12,1.12])for(const [from,to]of [[-116.5,-118],[-118,-140.5]])beam(mouth,[x,groundHeight(x,from)+.092,from],[x,groundHeight(x,to)+.092,to],.105,.10,iron);
  const torchFixtures=[];
  for(const side of[-1,1])torchFixtures.push({id:`cave-portal-torch-${side}`,x:side*7.25,y:2.8,z:-121.90,mount:'wall',nx:0,nz:1,alwaysLit:true,height:1.02});
  // Underground torches remain lit through daytime for safe navigation.
  function wallTorch(x,z,side=1){torchFixtures.push({id:`cave-torch-${torchFixtures.length}`,x:x+side*.12,y:groundHeight(x,z)+2.45,z:z+.20,mount:'wall',nx:side,nz:0,alwaysLit:true,height:.82});}
  for(const area of CAVE_AREAS){
    if(area.kind==='ramp')for(let z=area.z+area.d/2-2;z>area.z-area.d/2+1;z-=7.3){
      const y=groundHeight(area.x,z),half=area.w/2;
      for(const side of[-1,1]){const x=area.x+side*(half+.08);beam(interior,[x,y,z],[x,y+5.65,z],.32,.38);for(const h of[.35,4.85])batch(interior,box,iron,[x,y+h,z],[.37,.14,.42]);beam(interior,[x,y+4.48,z],[x-side*1.05,y+5.55,z],.20,.22);}
      beam(interior,[area.x-half-.3,y+5.6,z],[area.x+half+.3,y+5.6,z],.33,.42);wallTorch(area.x-half+.40,z,1);
      // Cross sleepers indicate the slope without becoming collision steps.
      for(let j=0;j<3;j++){const zz=z-j*1.7;if(!caveAreaAt(area.x,zz))continue;batch(interior,box,woodEnd,[area.x,groundHeight(area.x,zz)+.029,zz],[area.w-.7,.045,.18]);}
    }
    else if(area.kind==='chamber')for(const side of[-1,1])for(const dz of[-area.d*.30,area.d*.30]){const x=area.x+side*(area.w/2-.36),z=area.z+dz;if(!within(x+side*.7,z))wallTorch(x,z,-side);}
    else if(area.id.endsWith('working')){const x=area.x-area.w/2+.36;wallTorch(x,area.z,1);}
  }
  // Mine survey markers guide the main descent; a yellow crystal and downward
  // arrow identify the sulfur workings without adding fake harvestable veins.
  const marker=new THREE.Group();marker.name='sulfur-route-markers';interior.add(marker);
  for(const [x,z]of [[4.7,-154],[8.3,-185],[.4,-208]]){
    const y=groundHeight(x,z);beam(interior,[x,y,z],[x,y+2.6,z],.15,.16);
    batch(interior,box,woodEnd,[x,y+2.2,z],[.76,.73,.14]);
    batch(interior,box,brass,[x-.12,y+2.30,z+.095],[.18,.28,.07],[0,0,.35]);
    beam(interior,[x+.18,y+2.40,z+.10],[x+.18,y+2.02,z+.10],.04,.04,brass);
    for(const side of[-1,1])beam(interior,[x+.18,y+2.02,z+.10],[x+.18+side*.10,y+2.14,z+.10],.04,.04,brass);
  }
  // Hand-cut drainage stones and old pick marks sit around the perimeter only.
  for(let i=0;i<layout.walls.length;i++){const e=layout.walls[i];for(let t=e.a+.65;t<e.b;t+=2.4){const x=(e.vertical?e.fixed:t)+e.nx*.16,z=(e.vertical?t:e.fixed)+e.nz*.16;batch(interior,box,woodEnd,[x,groundHeight(x-e.nx*.16,z-e.nz*.16)+.015,z],[e.vertical?.25:1.1,.03,e.vertical?1.1:.25]);}}
  for(const {parent,g,mat,transforms}of batches.values()){
    // Give simple fracture instances the same authored slate palette.
    if(mat.vertexColors&&!g.attributes.color){const values=[];for(let i=0;i<g.attributes.position.count;i++)values.push(.66,.73,.67);g.setAttribute('color',new THREE.Float32BufferAttribute(values,3));}
    const mesh=new THREE.InstancedMesh(g,mat,transforms.length);mesh.name=`cave-${mat.name}-instances`;transforms.forEach((m,i)=>{mesh.setMatrixAt(i,m);mesh.setColorAt(i,new THREE.Color().setScalar(.91+.09*(.5+.5*Math.sin(m.elements[12]*12+m.elements[13]*5+m.elements[14]*7))));});mesh.castShadow=true;mesh.receiveShadow=true;mesh.computeBoundingSphere();parent.add(mesh);
  }
  let disposed=false;
  function update(player,camera,time=0){
    if(disposed)return {inside:false,caveMix:0};
    const p=player&&Number.isFinite(player.x)&&Number.isFinite(player.z)?player:CAVE_ENTRANCE;
    const depth=caveDepthAt(p.x,p.z),inside=Boolean(caveAreaAt(p.x,p.z))&&depth>.16,caveMix=clamp(depth/3);
    const ceiling=groundHeight(p.x,p.z)+5.35,cam=camera?.position;
    const cutaway=inside&&cam&&(!caveAreaAt(cam.x,cam.z)||cam.y>groundHeight(cam.x,cam.z)+6.05);
    roof.visible=!cutaway;crown.visible=!cutaway;
    return {inside,caveMix,depth,tier:caveTierAt(p.x,p.z),ceilingY:ceiling,cutaway:Boolean(cutaway)};
  }
  root.userData.layout=layout;root.userData.route=CAVE_ROUTE;
  update(null,null,0);
  function dispose(){if(disposed)return;disposed=true;root.removeFromParent();root.traverse(n=>{if(n.isInstancedMesh)n.dispose();});for(const g of owned)g.dispose();for(const m of materials)m.dispose();root.clear();}
  return {root,interior,roof,mouth,torchFixtures,update,dispose};
}
