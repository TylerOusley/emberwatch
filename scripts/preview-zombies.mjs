// Export actual sculpted enemy geometry and authoritative emergence poses.
// node scripts/preview-zombies.mjs [output.json] [lineup|emergence]
import fs from 'node:fs';
import * as THREE from 'three';
import { createZombiePresentation } from '../public/src/zombie-presentation.js';
import { ENEMY_TYPES } from '../shared/enemies.js';
const output=process.argv[2]||'/tmp/emberwatch-zombies.json';
const mode=process.argv[3]||'lineup';
if(!['lineup','emergence'].includes(mode))throw new Error('Unknown preview mode');
const triangles=[],stats=[];
const yaw=-.23,spacing=mode==='lineup'?2.4:2.2,pose=mode;
const boneMatrix=new THREE.Matrix4(),skinMatrix=new THREE.Matrix4(),normalSkin=new THREE.Matrix3();
const skinIndex=new THREE.Vector4(),skinWeight=new THREE.Vector4();
function skinNormal(mesh,index,normal) {
  skinIndex.fromBufferAttribute(mesh.geometry.attributes.skinIndex,index);
  skinWeight.fromBufferAttribute(mesh.geometry.attributes.skinWeight,index);
  skinMatrix.elements.fill(0);
  for(let i=0;i<4;i++) {
    const weight=skinWeight.getComponent(i);
    if(weight===0)continue;
    boneMatrix.fromArray(mesh.skeleton.boneMatrices,skinIndex.getComponent(i)*16);
    for(let j=0;j<16;j++)skinMatrix.elements[j]+=boneMatrix.elements[j]*weight;
  }
  // Match Three.js skinnormal_vertex: w=0, weighted bone matrices, and both
  // bind matrices, followed by the object's world normal matrix below.
  skinMatrix.premultiply(mesh.bindMatrixInverse).multiply(mesh.bindMatrix);
  return normal.applyMatrix3(normalSkin.setFromMatrix4(skinMatrix));
}
const subjects=mode==='lineup'
 ? Object.keys(ENEMY_TYPES).map(kind=>({kind,label:ENEMY_TYPES[kind].label,time:20}))
 : [.12,.43,.72,1].map((progress,i)=>({kind:'shambler',label:['Disturbed soil','Breaking through','Climbing free','Ready to walk'][i],time:10+progress*2.2}));
for(const [i,{kind,label,time}] of subjects.entries()) {
  const e={id:`preview-${i}`,kind,hp:100,birth:'grave',spawnAt:10,emergeUntil:12.2};
  const actor=createZombiePresentation(e,i+1);
  for(let t=0;t<60;t++)actor.updateFromState(e,time,1/60,{moving:false});
  actor.group.rotation.y=yaw;
  actor.group.position.x=(i-(subjects.length-1)/2)*spacing;
  actor.group.updateMatrixWorld(true);
  actor.group.traverse(m=>{if(m.isSkinnedMesh)m.skeleton.update();});
  let meshCount=0,triangleCount=0,skinnedMeshes=0;
  const bounds=new THREE.Box3();
  const exportMeshes=[];
  actor.group.traverse(m=>{
    if(!m.isMesh||!m.visible)return;
    for(let parent=m.parent;parent;parent=parent.parent)if(!parent.visible)return;
    if(m.isInstancedMesh){
      const local=new THREE.Matrix4();
      for(let k=0;k<m.count;k++){m.getMatrixAt(k,local);const proxy=new THREE.Mesh(m.geometry,m.material);proxy.matrixWorld.multiplyMatrices(m.matrixWorld,local);exportMeshes.push(proxy);}
    }else exportMeshes.push(m);
  });
  if(mode==='emergence'){
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(2.0,2.0),new THREE.MeshStandardMaterial({color:0x67583e,roughness:1}));
    floor.rotation.x=-Math.PI/2;floor.position.set(actor.group.position.x,-.004,0);floor.updateMatrixWorld();exportMeshes.push(floor);
  }
  for(const m of exportMeshes){
    if(!m.isMesh || !m.visible)continue;
    const g=m.geometry,ix=g.index,p=g.attributes.position;
    if(!p)continue;
    if(!g.attributes.normal)g.computeVertexNormals();
    const n=g.attributes.normal,colors=g.attributes.color;
    const normalMatrix=new THREE.Matrix3().getNormalMatrix(m.matrixWorld);
    const reflected=m.matrixWorld.determinant()<0;
    const positions=[],normals=[],vertexColors=[];
    for(let index=0;index<p.count;index++) {
      const v=new THREE.Vector3().fromBufferAttribute(p,index);
      const vn=new THREE.Vector3().fromBufferAttribute(n,index);
      if(m.isSkinnedMesh) {m.applyBoneTransform(index,v);skinNormal(m,index,vn);}
      v.applyMatrix4(m.matrixWorld);vn.applyMatrix3(normalMatrix).normalize();
      if(!v.toArray().every(Number.isFinite)||!vn.toArray().every(Number.isFinite))throw new Error(`Non-finite ${kind} geometry at vertex ${index}.`);
      positions.push(v.toArray());normals.push(vn.toArray());bounds.expandByPoint(v);
      if(colors)vertexColors.push([colors.getX(index),colors.getY(index),colors.getZ(index)]);
    }
    let visibleTriangles=0;
    const maxCount=ix?ix.count:p.count;
    const start=Math.max(0,g.drawRange.start),end=Math.min(maxCount,start+g.drawRange.count);
    for(let j=start;j+2<end;j+=3) {
      const group=Array.isArray(m.material)?g.groups.find(entry=>j>=entry.start&&j<entry.start+entry.count):null;
      if(Array.isArray(m.material)&&!group)continue;
      const mat=Array.isArray(m.material)?m.material[group.materialIndex]:m.material;
      if(!mat||mat.visible===false||mat.opacity<=0)continue;
      const indices=[0,1,2].map(k=>ix?ix.getX(j+k):j+k);
      if(reflected)[indices[1],indices[2]]=[indices[2],indices[1]];
      const ps=indices.map(index=>positions[index]),ns=indices.map(index=>normals[index]);
      const face=new THREE.Vector3().subVectors(new THREE.Vector3(...ps[1]),new THREE.Vector3(...ps[0])).cross(new THREE.Vector3().subVectors(new THREE.Vector3(...ps[2]),new THREE.Vector3(...ps[0]))).normalize();
      if(mat.flatShading)for(let k=0;k<3;k++)ns[k]=face.toArray();
      const base=mat.color?.toArray()??[1,1,1];
      const cs=indices.map(index=>mat.vertexColors&&colors?vertexColors[index].map((component,channel)=>component*base[channel]):base);
      triangles.push({p:ps,n:ns,c:cs,e:mat.emissive?.clone().multiplyScalar(mat.emissiveIntensity??1).toArray()??[0,0,0],metal:mat.metalness??0,rough:mat.roughness??1,side:mat.side??THREE.FrontSide,opacity:mat.transparent?mat.opacity:1,actor:i});
      visibleTriangles++;
    }
    if(visibleTriangles){meshCount++;triangleCount+=visibleTriangles;if(m.isSkinnedMesh)skinnedMeshes++;}
  }
  stats.push({kind:label,meshes:meshCount,skinnedMeshes,triangles:triangleCount,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()}});
  actor.dispose();
}
fs.writeFileSync(output,JSON.stringify({format:2,yaw,spacing,pose,lineup:mode,previewScale:mode==='lineup'?155:260,triangles,stats}));
console.log(JSON.stringify({output,stats}));
