import * as THREE from 'three';
import { LOW_OBSTACLES } from '../../shared/elevation.js';
import { CIVIC_BOARD, CIVIC_PROJECTS, CIVIC_SIEGE } from '../../shared/civic.js';
import { groundHeight } from '../../shared/world.js';
import { createSurfaceMaterial } from './surface-materials.js';
import { createBeveledBlockGeometry } from './environment-geometry.js';
import { createCharacter } from './characters.js';

// Supplemental scenery follows the same low-obstacle and civic state used by
// the server. Assets are built once; snapshots only move existing objects.
export function createCivicWorld(scene){
  const root=new THREE.Group();root.name='Emberwatch village works';scene?.add(root);
  const geometries=new Set(),materials=new Set(),textures=new Set(),batches=new Map(),dummy=new THREE.Object3D(),up=new THREE.Vector3(0,1,0);
  const own=g=>{geometries.add(g);return g;},material=m=>{materials.add(m);return m;};
  const box=own(createBeveledBlockGeometry()),plainBox=own(new THREE.BoxGeometry(1,1,1)),cylinder=own(new THREE.CylinderGeometry(1,1,1,16)),sphere=own(new THREE.IcosahedronGeometry(1,1)),disc=own(new THREE.CircleGeometry(1,24)),ring=own(new THREE.TorusGeometry(1,.06,5,24));
  const wood=material(createSurfaceMaterial('wood',{color:0x96744b,worldScale:1.6})),darkWood=material(createSurfaceMaterial('wood',{color:0x574634,worldScale:1.7})),stone=material(createSurfaceMaterial('rock',{color:0xa2aa97,worldScale:1.8})),cutWood=material(new THREE.MeshStandardMaterial({color:0xc4a172,roughness:.97})),iron=material(new THREE.MeshStandardMaterial({color:0x4f605f,metalness:.72,roughness:.46})),rope=material(new THREE.MeshStandardMaterial({color:0xbdab7d,roughness:.94})),brass=material(new THREE.MeshStandardMaterial({color:0xd9b45a,metalness:.55,roughness:.52}));
  function part(parent,g,mat,position,scale=[1,1,1],rotation=[0,0,0]){
    const key=parent.uuid+g.uuid+mat.uuid;if(!batches.has(key))batches.set(key,{parent,g,mat,transforms:[]});
    dummy.position.set(...position);dummy.scale.set(...scale);dummy.rotation.set(...rotation);dummy.updateMatrix();batches.get(key).transforms.push(dummy.matrix.clone());
  }
  function beam(parent,a,b,width=.15,depth=width,mat=wood){
    const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b);dummy.position.copy(start).add(end).multiplyScalar(.5);dummy.scale.set(width,start.distanceTo(end),depth);dummy.quaternion.setFromUnitVectors(up,end.sub(start).normalize());dummy.updateMatrix();
    const key=parent.uuid+box.uuid+mat.uuid;if(!batches.has(key))batches.set(key,{parent,g:box,mat,transforms:[]});batches.get(key).transforms.push(dummy.matrix.clone());
  }
  function flush(){for(const {parent,g,mat,transforms}of batches.values()){const mesh=new THREE.InstancedMesh(g,mat,transforms.length);transforms.forEach((matrix,i)=>mesh.setMatrixAt(i,matrix));mesh.castShadow=mesh.receiveShadow=true;mesh.computeBoundingSphere();parent.add(mesh);}batches.clear();}
  const obstacles=new Map();
  for(const obstacle of LOW_OBSTACLES){
    const group=new THREE.Group();group.name=`traversable-${obstacle.id}`;group.position.set(obstacle.x,0,obstacle.z);group.userData.obstacle={...obstacle};root.add(group);obstacles.set(obstacle.id,group);
    if(obstacle.kind==='log'){
      part(group,cylinder,darkWood,[0,obstacle.height/2,0],[obstacle.height/2,obstacle.w,obstacle.d/2],[0,0,Math.PI/2]);
      for(const side of[-1,1]){
        part(group,disc,cutWood,[side*obstacle.w/2,obstacle.height/2,0],[obstacle.d*.44,obstacle.height*.44,1],[0,side*Math.PI/2,0]);
        // End grain lies inside the bark envelope; jumping uses its exact top.
        for(const size of[.24,.52,.76])part(group,ring,darkWood,[side*(obstacle.w/2-.002),obstacle.height/2,0],[obstacle.d*.4*size,obstacle.height*.4*size,.025],[0,side*Math.PI/2,0]);
      }
    }else part(group,box,stone,[0,obstacle.height/2,0],[obstacle.w,obstacle.height,obstacle.d]);
  }

  const board=new THREE.Group();board.name='Village works board';board.position.set(CIVIC_BOARD.x,0,CIVIC_BOARD.z);root.add(board);
  for(const side of[-1,1]){part(board,box,darkWood,[side*1.35,1.7,0],[.18,3.4,.19]);part(board,box,iron,[side*1.35,.25,0],[.22,.4,.23]);}
  part(board,box,wood,[0,2.32,0],[2.95,1.75,.17]);part(board,box,darkWood,[0,3.3,0],[3.25,.17,.54]);
  const progress=new THREE.Group();progress.name='village-project-progress';board.add(progress);part(progress,plainBox,brass,[.5,0,0],[1,.10,.04]);progress.position.set(-1.24,1.57,.12);progress.scale.x=0;
  const canvas=typeof document!=='undefined'?document.createElement('canvas'):null,context=canvas?.getContext?.('2d');let boardKey=null;
  if(canvas){canvas.width=768;canvas.height=448;}
  const labelTexture=context?new THREE.CanvasTexture(canvas):new THREE.DataTexture(new Uint8Array([52,43,31,255]),1,1);labelTexture.colorSpace=THREE.SRGBColorSpace;labelTexture.needsUpdate=true;textures.add(labelTexture);
  const faceMaterial=material(new THREE.MeshStandardMaterial({map:labelTexture,roughness:.98})),face=new THREE.Mesh(own(new THREE.PlaneGeometry(2.62,1.48)),faceMaterial);face.position.set(0,2.37,.10);board.add(face);
  function paintBoard(works){
    const project=CIVIC_PROJECTS[works?.active],ratio=project?Object.entries(project.cost).reduce((sum,[item,cost])=>sum+Math.min(1,(works.progress?.[item]??0)/cost),0)/Object.keys(project.cost).length:0;
    progress.scale.x=ratio*2.48;const key=`${works?.active}:${Math.floor(ratio*100)}:${works?.completed?.join(',')}`;if(key===boardKey)return;boardKey=key;
    board.userData.project=project?.name??'Choose a village project';board.userData.progress=ratio;
    if(!context)return;
    context.fillStyle='#342b1f';context.fillRect(0,0,768,448);context.textAlign='center';context.fillStyle='#f1d9a1';context.font='bold 65px Georgia';context.fillText('VILLAGE WORKS',384,96);
    context.font='38px Georgia';context.fillText(project?.name??'Build a stronger village',384,179,704);context.fillStyle='#c9b998';context.font='31px Georgia';context.fillText(project?`${Math.floor(ratio*100)}% of contributions supplied`:'Pool materials, gold and supplies',384,246,704);context.fillText('Everyone can contribute',384,311,704);
    context.fillStyle='#e3bc63';context.font='27px Georgia';context.fillText(`${works?.completed?.length??0} / 4 village improvements completed`,384,378,704);labelTexture.needsUpdate=true;
  }
  const depot=new THREE.Group();depot.name='works-supply-depot';depot.position.set(CIVIC_BOARD.x+2.4,0,CIVIC_BOARD.z-1.2);root.add(depot);
  for(let i=0;i<2;i++){part(depot,box,wood,[i*.78,.43,-i*.38],[.7,.85,.72]);for(const side of[-1,1])part(depot,box,iron,[i*.78+side*.26,.43,-i*.38],[.06,.88,.75]);}

  const reinforcement=new THREE.Group();reinforcement.name='reinforced-gatehouse-masonry';root.add(reinforcement);
  for(const side of[-1,1]){part(reinforcement,box,stone,[side*5.75,2.5,19.9],[.7,5,1.1]);for(const y of[.7,2.2,4.2])part(reinforcement,box,iron,[side*5.75,y,20.49],[.82,.19,.12]);}
  const engines=new Map();
  function engine(kind){
    const site=CIVIC_SIEGE[kind],group=new THREE.Group();group.name=`civic-${kind}`;group.position.set(site.x,8.85,site.z);root.add(group);
    for(let i=0;i<8;i++)part(group,box,wood,[(i-3.5)*.47,0,0],[.45,.17,3.9]);
    for(const side of[-1,1]){part(group,box,iron,[side*1.72,.02,0],[.13,.23,3.8]);part(group,box,darkWood,[side*1.4,.34,0],[.26,.50,2.9]);}
    const turret=new THREE.Group();turret.name=`${kind}-aim`;group.add(turret);let arm=null;
    if(kind==='ballista'){
      part(turret,cylinder,iron,[0,.78,0],[.32,1.35,.32]);part(turret,box,darkWood,[0,1.5,0],[.35,.3,3.25]);
      for(const side of[-1,1]){
        beam(turret,[side*.20,1.5,.65],[side*1.2,1.58,.92],.16,.23);beam(turret,[side*1.2,1.58,.92],[side*1.82,1.49,1.24],.13,.2);
        beam(turret,[side*1.82,1.49,1.24],[0,1.52,-.95],.032,.032,rope);part(turret,cylinder,iron,[side*.7,1.46,.63],[.12,.55,.12]);
        beam(turret,[side*.9,.4,-.7],[0,1.35,0],.18,.18,darkWood);
      }
      beam(turret,[0,1.73,-.9],[0,1.73,1.55],.07,.07,cutWood);for(const side of[-1,1])beam(turret,[0,1.73,1.6],[side*.16,1.73,1.24],.07,.07,iron);
    }else{
      for(const side of[-1,1]){beam(turret,[side*1.05,.4,-1.35],[side*1.05,3.2,0],.22,.24);beam(turret,[side*1.05,.4,1.35],[side*1.05,3.2,0],.22,.24);}
      beam(turret,[-1.3,3.2,0],[1.3,3.2,0],.19,.19,iron);
      arm=new THREE.Group();arm.name='trebuchet-throwing-arm';arm.position.y=3.2;arm.rotation.x=-.60;turret.add(arm);
      beam(arm,[0,0,-1.1],[0,0,3.15],.20,.25);beam(arm,[0,0,-1.1],[0,-.8,-1.1],.11,.11,iron);part(arm,box,stone,[0,-1.17,-1.1],[1.10,.85,.85]);
      for(const side of[-1,1])beam(arm,[side*.10,0,3.15],[side*.17,-.55,3.6],.035,.035,rope);part(arm,sphere,stone,[0,-.57,3.6],[.26,.22,.26]);
    }
    const projectile=new THREE.Mesh(kind==='ballista'?plainBox:sphere,kind==='ballista'?cutWood:stone);projectile.name=`${kind}-projectile`;projectile.scale.set(...(kind==='ballista'?[.09,.09,1.5]:[.32,.32,.32]));projectile.castShadow=true;projectile.visible=false;root.add(projectile);
    const record={group,turret,arm,projectile,seen:null,born:-100,start:new THREE.Vector3(site.x,kind==='ballista'?10.58:12.1,site.z),end:new THREE.Vector3(),duration:kind==='ballista'?.75:1.4};engines.set(kind,record);return record;
  }
  for(const kind of Object.keys(CIVIC_SIEGE))engine(kind);
  flush();let mason=null,villageId=null,disposed=false;
  function update(state={},dt=1/60,time=0){
    if(disposed)return;
    // The main render loop passes null while in the lobby and after leaving.
    // Treat that as an empty village so completed works and effects also reset.
    state??={};const works=state.civic??{},completed=new Set(works.completed??[]),changedVillage=villageId!==state.id;villageId=state.id;dt=Math.max(0,Math.min(.1,Number(dt)||0));
    paintBoard(works);depot.visible=Object.values(works.depot??{}).some(value=>value>0);reinforcement.visible=completed.has('reinforcement');
    for(const [kind,record]of engines){
      record.group.visible=completed.has(kind);const shot=works.siege?.[kind]?.lastShot;
      if(changedVillage){record.seen=shot?.id??null;record.born=-100;record.projectile.visible=false;}
      else if(record.group.visible&&shot?.id&&shot.id!==record.seen){
        record.seen=shot.id;const shotAge=(state.clock??0)-shot.at;if(Number.isFinite(shot.x)&&Number.isFinite(shot.z)&&shotAge>=0&&shotAge<2){record.end.set(shot.x,groundHeight(shot.x,shot.z)+.6,shot.z);record.born=time;record.turret.rotation.y=Math.atan2(shot.x-record.start.x,shot.z-record.start.z);}
      }
      const age=time-record.born,fraction=Math.max(0,Math.min(1,age/record.duration));record.projectile.visible=record.group.visible&&age>=0&&age<record.duration;
      if(record.projectile.visible){record.projectile.position.lerpVectors(record.start,record.end,fraction);record.projectile.position.y+=Math.sin(fraction*Math.PI)*(kind==='ballista'?1.5:12);record.projectile.lookAt(record.end);}
      if(record.arm)record.arm.rotation.x=age>=0&&age<1.8?-.60+Math.sin(Math.min(1,age/.3)*Math.PI/2)*1.5*Math.max(0,1-(age-.3)/1.5):-.60;
    }
    if(completed.has('repair_crew')&&works.mason){
      if(!mason){mason=createCharacter('villager',2718);mason.group.name='village-repair-mason';mason.setClothingColor('#776e4a');mason.setTool({id:'hammer',tier:2});root.add(mason.group);}
      const data=works.mason;if(Number.isFinite(data.x)&&Number.isFinite(data.z)){
        const oldX=mason.group.position.x,oldZ=mason.group.position.z,snap=changedVillage||Math.hypot(oldX-data.x,oldZ-data.z)>12,blend=snap?1:1-Math.exp(-dt*14);mason.group.position.x+=(data.x-oldX)*blend;mason.group.position.z+=(data.z-oldZ)*blend;mason.group.position.y=groundHeight(mason.group.position.x,mason.group.position.z);
        const dx=mason.group.position.x-oldX,dz=mason.group.position.z-oldZ,moving=!snap&&Math.hypot(dx,dz)>.005;if(moving)mason.group.rotation.y=Math.atan2(dx,dz);
        mason.update(dt,time,{tool:'hammer',tier:2,moving,speed:3,attack:!moving&&String(data.status).startsWith('Repairing')});
      }
      mason.group.visible=true;
    }else if(mason)mason.group.visible=false;
  }
  update();
  function dispose(){if(disposed)return;disposed=true;root.removeFromParent();mason?.dispose();root.traverse(node=>{if(node.isInstancedMesh)node.dispose();});for(const geometry of geometries)geometry.dispose();for(const mat of materials)mat.dispose();for(const texture of textures)texture.dispose();root.clear();}
  return {root,obstacles,board,engines,update,dispose};
}
