// Sample the actual animated Three.js meshes, including skin deformation.
// node scripts/preview-locomotion.mjs [characters.js] [output-directory]
//   --role=villager --tool= --tier=1 --backpack=0 --speed=5.4 --seconds=1.4 --frames=28
// The indexed topology is written once; each frame contains float32 positions
// and normals. Nothing is reconstructed from a silhouette or skeleton drawing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2), positional=args.filter(a=>!a.startsWith('--'));
const option=(key,fallback)=>args.find(a=>a.startsWith(`--${key}=`))?.slice(key.length+3)??fallback;
const source=path.resolve(positional[0]??path.join(repo,'public/src/characters.js'));
const output=path.resolve(positional[1]??'/tmp/emberwatch-locomotion');
const role=option('role','villager'), tool=option('tool','');
const tier=Number(option('tier','1')),backpackTier=Number(option('backpack','0'));
const speed=Number(option('speed',role==='zombie'?'1.75':'5.4'));
const seconds=Number(option('seconds','1.4')), frames=Number(option('frames','28'));
if(!['villager','guard','priest','zombie'].includes(role)||!Number.isFinite(speed)||speed<0||!Number.isFinite(seconds)||seconds<=0||!Number.isInteger(frames)||frames<2||frames>240||!Number.isInteger(tier)||tier<1||tier>3||!Number.isInteger(backpackTier)||backpackTier<0||backpackTier>3)throw new Error('Invalid locomotion preview settings.');
const THREE=await import(pathToFileURL(path.join(repo,'node_modules/three/build/three.module.js')).href);
let temporary;
let modulePath=source;
if(!source.startsWith(`${repo}${path.sep}`)) {
  // Saved baselines retain their own geometry modules. Only dependency
  // resolution changes; all sampled geometry and animation remains original.
  temporary=fs.mkdtempSync(path.join(os.tmpdir(),'emberwatch-motion-module-'));
  for(const name of fs.readdirSync(path.dirname(source)))if(name.endsWith('.js'))fs.copyFileSync(path.join(path.dirname(source),name),path.join(temporary,name));
  fs.writeFileSync(path.join(temporary,'package.json'),'{"type":"module"}');
  fs.symlinkSync(path.join(repo,'node_modules'),path.join(temporary,'node_modules'),'dir');
  modulePath=path.join(temporary,path.basename(source));
}
const {createCharacter}=await import(pathToFileURL(modulePath).href);
const actor=createCharacter(role,1);
actor.setTool({id:tool,tier});
if(backpackTier)actor.setBackpackTier(backpackTier);
const options={moving:true,speed};
let time=0;
// Let startup easing settle before sampling a continuous locomotion clip.
for(let i=0;i<120;i++){time+=1/60;actor.update(1/60,time,options);}
actor.group.updateMatrixWorld(true);
const meshes=[], indices=[], colors=[], materials=[];
let vertexCount=0;
actor.group.traverse(mesh=>{
  if(!mesh.isMesh)return;
  for(let node=mesh;node;node=node.parent)if(!node.visible)return;
  const geometry=mesh.geometry, position=geometry.attributes.position;
  if(!position)return;
  if(!geometry.attributes.normal)geometry.computeVertexNormals();
  const offset=vertexCount, attributeColors=geometry.attributes.color;
  meshes.push({mesh,offset});
  for(let i=0;i<position.count;i++)colors.push(attributeColors?attributeColors.getX(i):1,attributeColors?attributeColors.getY(i):1,attributeColors?attributeColors.getZ(i):1);
  vertexCount+=position.count;
  const index=geometry.index, count=index?index.count:position.count;
  const end=Math.min(count,geometry.drawRange.start+geometry.drawRange.count);
  const reflected=mesh.matrixWorld.determinant()<0;
  for(let start=geometry.drawRange.start;start+2<end;start+=3) {
    const group=Array.isArray(mesh.material)?geometry.groups.find(g=>start>=g.start&&start<g.start+g.count):null;
    if(Array.isArray(mesh.material)&&!group)continue;
    const material=Array.isArray(mesh.material)?mesh.material[group.materialIndex]:mesh.material;
    if(!material||!material.visible||material.opacity<=0)continue;
    const face=[0,1,2].map(i=>offset+(index?index.getX(start+i):start+i));
    if(reflected)[face[1],face[2]]=[face[2],face[1]];
    indices.push(...face);
    const color=material.color?.toArray()??[1,1,1];
    const emissive=material.emissive?.clone().multiplyScalar(material.emissiveIntensity??1).toArray()??[0,0,0];
    materials.push(...color,...emissive,material.metalness??0,material.roughness??1,material.transparent?material.opacity:1,material.side??0,material.flatShading?1:0,material.vertexColors&&attributeColors?1:0);
  }
});
fs.mkdirSync(output,{recursive:true});
const writeArray=(filename,array)=>fs.writeFileSync(path.join(output,filename),Buffer.from(array.buffer,array.byteOffset,array.byteLength));
writeArray('indices.u32',new Uint32Array(indices));
writeArray('colors.f32',new Float32Array(colors));
writeArray('materials.f32',new Float32Array(materials));
const position=new THREE.Vector3(), normal=new THREE.Vector3();
const indices4=new THREE.Vector4(),weights4=new THREE.Vector4();
const bone=new THREE.Matrix4(),skin=new THREE.Matrix4(),skinNormal=new THREE.Matrix3(),worldNormal=new THREE.Matrix3();
const bounds=new THREE.Box3();
for(let frame=0;frame<frames;frame++) {
  if(frame>0) {
    const substeps=Math.ceil((seconds/frames)*60), dt=seconds/frames/substeps;
    for(let i=0;i<substeps;i++){time+=dt;actor.update(dt,time,options);}
  }
  actor.group.updateMatrixWorld(true);
  actor.group.traverse(mesh=>{if(mesh.isSkinnedMesh)mesh.skeleton.update();});
  const values=new Float32Array(vertexCount*6);
  for(const {mesh,offset} of meshes) {
    const attributes=mesh.geometry.attributes;
    worldNormal.getNormalMatrix(mesh.matrixWorld);
    for(let i=0;i<attributes.position.count;i++) {
      position.fromBufferAttribute(attributes.position,i);
      normal.fromBufferAttribute(attributes.normal,i);
      if(mesh.isSkinnedMesh) {
        mesh.applyBoneTransform(i,position);
        indices4.fromBufferAttribute(attributes.skinIndex,i);
        weights4.fromBufferAttribute(attributes.skinWeight,i);
        skin.elements.fill(0);
        for(let k=0;k<4;k++) {
          const weight=weights4.getComponent(k);
          if(!weight)continue;
          bone.fromArray(mesh.skeleton.boneMatrices,indices4.getComponent(k)*16);
          for(let j=0;j<16;j++)skin.elements[j]+=bone.elements[j]*weight;
        }
        skin.premultiply(mesh.bindMatrixInverse).multiply(mesh.bindMatrix);
        normal.applyMatrix3(skinNormal.setFromMatrix4(skin));
      }
      position.applyMatrix4(mesh.matrixWorld);
      normal.applyMatrix3(worldNormal).normalize();
      if(![position.x,position.y,position.z,normal.x,normal.y,normal.z].every(Number.isFinite))throw new Error(`Non-finite vertex in frame ${frame}.`);
      position.toArray(values,(offset+i)*3);
      normal.toArray(values,vertexCount*3+(offset+i)*3);
      bounds.expandByPoint(position);
    }
  }
  writeArray(`frame-${String(frame).padStart(3,'0')}.f32`,values);
}
const manifest={format:1,role,tool,tier,backpackTier,speed,seconds,frames,fps:frames/seconds,vertices:vertexCount,triangles:indices.length/3,meshes:meshes.length,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},source:path.basename(source)};
fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2));
actor.dispose();
if(temporary)fs.rmSync(temporary,{recursive:true,force:true});
console.log(JSON.stringify({output,...manifest}));
