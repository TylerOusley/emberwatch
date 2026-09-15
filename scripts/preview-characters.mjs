// Export actual Three.js geometry for a deterministic offline CPU review render.
// node scripts/preview-characters.mjs [source.js] [output.json] [yaw] [idle|walk|strike|mounted|carry|downed]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL,fileURLToPath} from 'node:url';
const repo=process.env.EMBERWATCH_REPO || (fs.existsSync(path.resolve('public/src/characters.js')) ? process.cwd() : path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'));
const threeUrl=pathToFileURL(path.join(repo,'node_modules/three/build/three.module.js')).href;
const THREE=await import(threeUrl);
const source=path.resolve(process.argv[2]||path.join(repo,'public/src/characters.js'));
const output=process.argv[3]||'/tmp/emberwatch-preview.json';
let createCharacter;
// Import the current source in place: its head, body and clothing modules must
// keep their relative imports and resolve exactly as they do in the game.
if(source.startsWith(`${path.resolve(repo)}${path.sep}`)) {
  ({createCharacter}=await import(pathToFileURL(source).href));
} else {
  // A saved single-file baseline in /tmp has no node_modules ancestor. This
  // compatibility copy changes imports only, never its geometry or materials.
  const tempDir=fs.mkdtempSync(path.join(os.tmpdir(),'emberwatch-character-preview-'));
  try {
    const code=fs.readFileSync(source,'utf8').replace(/(from\s*|import\s*)(['"])([^'"]+)\2/g,(match,prefix,quote,specifier)=>{
      const target=specifier==='three' ? threeUrl : specifier.startsWith('.') ? pathToFileURL(path.resolve(path.dirname(source),specifier)).href : specifier;
      return `${prefix}${quote}${target}${quote}`;
    });
    const modulePath=path.join(tempDir,'characters.mjs');
    fs.writeFileSync(modulePath,code);
    ({createCharacter}=await import(pathToFileURL(modulePath).href));
  } finally { fs.rmSync(tempDir,{recursive:true,force:true}); }
}
const triangles=[],stats=[];
const yaw=Number(process.argv[4]??'-.28'),spacing=2.20;
const pose=process.argv[5]??'idle';
const poses={idle:{},walk:{moving:true},strike:{attack:true},mounted:{mounted:true},carry:{carrying:true},downed:{downed:true}};
if(!Object.hasOwn(poses,pose))throw new Error(`Unknown preview pose: ${pose}`);
if(!Number.isFinite(yaw))throw new Error('Preview yaw must be a finite number.');
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
for(const [i,kind] of ['villager','guard','priest','zombie'].entries()) {
  const actor=createCharacter(kind,i+1);
  actor.setTool(kind==='villager'?'axe':kind==='guard'?{id:'sword',tier:3}:kind==='priest'?'heal':'');
  for(let t=0;t<60;t++)actor.update(1/60,t/60,{moving:false});
  if(pose!=='idle')for(let t=0;t<(pose==='strike'?18:60);t++)actor.update(1/60,1+t/60,poses[pose]);
  actor.group.rotation.y=yaw;
  actor.group.position.x=(i-1.5)*spacing;
  actor.group.updateMatrixWorld(true);
  actor.group.traverse(m=>{if(m.isSkinnedMesh)m.skeleton.update();});
  let meshCount=0,triangleCount=0,skinnedMeshes=0;
  const bounds=new THREE.Box3();
  actor.group.traverse(m=>{
    if(!m.isMesh || !m.visible)return;
    for(let parent=m.parent;parent;parent=parent.parent)if(!parent.visible)return;
    const g=m.geometry,ix=g.index,p=g.attributes.position;
    if(!p)return;
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
  });
  stats.push({kind,meshes:meshCount,skinnedMeshes,triangles:triangleCount,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()}});
  actor.dispose();
}
fs.writeFileSync(output,JSON.stringify({format:2,yaw,spacing,pose,triangles,stats}));
console.log(JSON.stringify({output,stats}));
