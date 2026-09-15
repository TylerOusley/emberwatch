import * as THREE from 'three';
import { CAVE_AREAS, CAVE_HEIGHTS, CAVE_ENTRANCE, CAVE_ROUTE, caveAreaAt, caveTierAt, groundHeight, caveDepthAt, seeded } from '../../shared/world.js';

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
function coloredGeometry(vertices,colors){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();return g;}

export function createCaveWorld(scene){
  const root=new THREE.Group();root.name='The Deepworks cave';scene?.add(root);
  const interior=new THREE.Group(),roof=new THREE.Group(),mouth=new THREE.Group();interior.name='cave-interior';roof.name='cave-ceiling';mouth.name='cave-mouth';root.add(interior,roof,mouth);
  const owned=new Set(),materials=new Set(),cache=new Map(),batches=new Map(),random=seeded(127401),layout=createCaveLayout();
  const material=(name,color,extra={})=>{const m=new THREE.MeshStandardMaterial({color,roughness:.94,...extra});m.name=name;materials.add(m);return m;};
  const rock=material('layered-cave-rock',0xffffff,{vertexColors:true}),floorMat=material('cave-floor',0xffffff,{vertexColors:true,roughness:.98}),wood=material('aged-mine-timber',0x6b5035),woodEnd=material('timber-endgrain',0x463d30),iron=material('mine-ironwork',0x4c5453,{metalness:.55,roughness:.62});
  const get=(key,make)=>{if(!cache.has(key)){const g=make();cache.set(key,g);owned.add(g);}return cache.get(key);};
  const box=get('box',()=>new THREE.BoxGeometry(1,1,1)),cylinder=get('cylinder',()=>new THREE.CylinderGeometry(1,1,1,10)),dummy=new THREE.Object3D(),up=new THREE.Vector3(0,1,0);
  const add=(parent,g,mat,name)=>{owned.add(g);const mesh=new THREE.Mesh(g,mat);mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;};
  function batch(parent,g,mat,position,scale=[1,1,1],rotation=[0,0,0]){const key=parent.uuid+g.uuid+mat.uuid;if(!batches.has(key))batches.set(key,{parent,g,mat,transforms:[]});dummy.position.set(...position);dummy.scale.set(...scale);dummy.rotation.set(...rotation);dummy.updateMatrix();batches.get(key).transforms.push(dummy.matrix.clone());}
  function beam(parent,a,b,width=.28,depth=width,mat=wood){const p=new THREE.Vector3(...a),q=new THREE.Vector3(...b),length=p.distanceTo(q);dummy.position.copy(p).add(q).multiplyScalar(.5);dummy.scale.set(width,length,depth);dummy.quaternion.setFromUnitVectors(up,q.sub(p).normalize());dummy.updateMatrix();const key=parent.uuid+box.uuid+mat.uuid;if(!batches.has(key))batches.set(key,{parent,g:box,mat,transforms:[]});batches.get(key).transforms.push(dummy.matrix.clone());}
  const v=[],c=[],rv=[],rc=[],wv=[],wc=[],scratch=new THREE.Color();
  const roofRelief=(x,z)=>.22*Math.sin(x*.46+z*.24)*Math.cos(z*.36)+.17*Math.sin(x*.89-z*.32);
  function tint(x,y,z,floor=false){const depth=clamp(-y/14),grain=Math.sin(x*17.3+y*9.2+z*13.1)*Math.sin(x*5.3-z*7.8),band=Math.sin(y*8+x*.13+z*.21);scratch.set(floor?0x797667:0x777d75).lerp(new THREE.Color(0x444d51),depth*.38);scratch.multiplyScalar(.87+grain*.075+(band>.72?.11:0));return scratch.toArray();}
  function tri(out,col,a,b,d,normal,floor=false){const ab=new THREE.Vector3().subVectors(new THREE.Vector3(...b),new THREE.Vector3(...a)),ac=new THREE.Vector3().subVectors(new THREE.Vector3(...d),new THREE.Vector3(...a));if(ab.cross(ac).dot(new THREE.Vector3(...normal))<0)[b,d]=[d,b];for(const p of[a,b,d]){out.push(...p);col.push(...tint(...p,floor));}}
  for(const cell of layout.cells){
    const points=[[cell.x0,cell.z0],[cell.x1,cell.z0],[cell.x1,cell.z1],[cell.x0,cell.z1]].map(([x,z])=>[x,groundHeight(x,z)+.018,z]);
    tri(v,c,points[0],points[1],points[2],[0,1,0],true);tri(v,c,points[0],points[2],points[3],[0,1,0],true);
    const low=points.map(p=>[p[0],p[1]+6.40+roofRelief(p[0],p[2]),p[2]]),high=points.map(p=>[p[0],p[1]+6.85+roofRelief(p[0],p[2]),p[2]]);
    tri(rv,rc,low[0],low[1],low[2],[0,-1,0]);tri(rv,rc,low[0],low[2],low[3],[0,-1,0]);tri(rv,rc,high[0],high[1],high[2],[0,1,0]);tri(rv,rc,high[0],high[2],high[3],[0,1,0]);
  }
  add(interior,coloredGeometry(v,c),floorMat,'continuous-cave-floor').castShadow=false;
  add(roof,coloredGeometry(rv,rc),rock,'solid-cave-roof');
  for(const edge of layout.walls){
    const breaks=lines([edge.a,edge.b,...(edge.vertical?CAVE_HEIGHTS.map(h=>h.z).filter(z=>z>edge.a&&z<edge.b):[])],1.1),rows=[0,.26,.34,.80,.89,1.40,1.49,2.00,2.10,2.65,2.74,3.35,3.44,4.10,4.19,4.85,4.94,5.45,5.54,6.10,6.19,6.50,7.45];
    function point(t,row){const x=edge.vertical?edge.fixed:t,z=edge.vertical?t:edge.fixed,y=groundHeight(x,z)+rows[row]+(row===0?0:.045*Math.sin(t*.67+Math.floor(row/2)*.8)),bulge=row===0?.025:row===rows.length-1?0:(row%2?.035:.14)+.025*Math.sin(t*2.7+Math.floor(row/2)*5);return [x+edge.nx*bulge,y,z+edge.nz*bulge];}
    for(let i=1;i<breaks.length;i++)for(let j=1;j<rows.length;j++){
      const a=point(breaks[i-1],j-1),b=point(breaks[i],j-1),d=point(breaks[i],j),e=point(breaks[i-1],j);tri(wv,wc,a,b,d,[edge.nx,0,edge.nz]);tri(wv,wc,a,d,e,[edge.nx,0,edge.nz]);
    }
    // Small fractured plates stay against the walls, outside ore approaches.
    for(let t=edge.a+1.7;t<edge.b-1;t+=3.5){const x=edge.vertical?edge.fixed:t,z=edge.vertical?t:edge.fixed;if(Math.abs(x)<6.5&&z>-126)continue;batch(interior,get('wall-fracture',()=>new THREE.IcosahedronGeometry(1,0)),rock,[x-edge.nx*.18,groundHeight(x,z)+.42,z-edge.nz*.18],[.42,.66,.39],[.2,t*.4,.18]);}
  }
  add(interior,coloredGeometry(wv,wc),rock,'inward-facing-cave-walls');
  // Fractured roof lenses and a few short stalactites break up the chamber
  // silhouette. Their lowest points remain above the camera's five-meter cap.
  const roofShelf=get('roof-shelf',()=>{const g=new THREE.IcosahedronGeometry(1,1),p=g.attributes.position,colors=[];for(let i=0;i<p.count;i++)colors.push(...tint(p.getX(i)*4,p.getY(i)*3,p.getZ(i)*4));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));return g;});
  const stalactite=get('short-stalactite',()=>new THREE.ConeGeometry(1,1,7));
  for(const area of CAVE_AREAS.filter(a=>a.kind==='chamber')){
    for(let x=area.x-area.w/2+3;x<area.x+area.w/2-2;x+=5.7)for(let z=area.z-area.d/2+3;z<area.z+area.d/2-2;z+=6.2){
      const y=groundHeight(x,z),ceilingAt=groundHeight(x,z)+.018+6.40+roofRelief(x,z);batch(roof,roofShelf,rock,[x,ceilingAt+.05,z],[1.25,.27,1.65],[.025,x*.09,.04]);
      if(Math.sin(x*7+z*3)>.2)batch(roof,stalactite,rock,[x+.6,groundHeight(x+.6,z-.6)+.018+6.40+roofRelief(x+.6,z-.6)-.17,z-.6],[.19,.54,.22],[0,.4,Math.PI]);
    }
  }
  // A bedrock arch and sloping shoulders frame the doorway from the village.
  const outcrop=get('portal-rock',()=>{
    const g=new THREE.IcosahedronGeometry(1,1),p=g.attributes.position,colors=[];
    for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),rough=1+.07*Math.sin(x*21+y*14+z*13);p.setXYZ(i,x*rough,y*rough,z*rough);colors.push(...tint(x*5,y*4,z*5));}g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.computeVertexNormals();return g;
  });
  for(const side of[-1,1]){
    for(let i=0;i<5;i++)batch(mouth,outcrop,rock,[side*(8.7+i*.84),2.5+i*.23,-120.0-i*2.35],[2.0+i*.10,3.0+i*.14,2.7],[.05,side*.22+i*.19,.03]);
    for(let i=0;i<4;i++)batch(mouth,outcrop,rock,[side*(8.9+i*.5),6.0,-120-i*3.8],[2.5,2.3,3.1],[.12,.1*i,side*.12]);
  }
  const crown=new THREE.Group();crown.name='mouth-rock-crown';mouth.add(crown);
  for(let i=0;i<4;i++)batch(crown,outcrop,rock,[(i-1.5)*2.9,7.6,-123.0],[2.5,1.7,4.8],[0,i*.1,(i-1.5)*.06]);
  const torchFixtures=[];
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
    else for(const side of[-1,1])for(const dz of[-area.d*.30,area.d*.30])wallTorch(area.x+side*(area.w/2-.36),area.z+dz,-side);
  }
  // Hand-cut drainage stones and old pick marks sit around the perimeter only.
  for(let i=0;i<layout.walls.length;i++){const e=layout.walls[i];for(let t=e.a+.65;t<e.b;t+=2.4){const x=(e.vertical?e.fixed:t)+e.nx*.16,z=(e.vertical?t:e.fixed)+e.nz*.16;batch(interior,box,woodEnd,[x,groundHeight(x-e.nx*.16,z-e.nz*.16)+.015,z],[e.vertical?.25:1.1,.03,e.vertical?1.1:.25]);}}
  for(const {parent,g,mat,transforms}of batches.values()){
    // Give simple fracture instances the same authored slate palette.
    if(mat.vertexColors&&!g.attributes.color){const values=[];for(let i=0;i<g.attributes.position.count;i++)values.push(.31,.35,.33);g.setAttribute('color',new THREE.Float32BufferAttribute(values,3));}
    const mesh=new THREE.InstancedMesh(g,mat,transforms.length);mesh.name=`cave-${mat.name}-instances`;transforms.forEach((m,i)=>mesh.setMatrixAt(i,m));mesh.castShadow=true;mesh.receiveShadow=true;mesh.computeBoundingSphere();parent.add(mesh);
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
