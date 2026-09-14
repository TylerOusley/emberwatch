// Export the original Three.js model geometry for an offline CPU review render.
// Run from the repository root: node scripts/preview-characters.mjs [source.js] [output.json] [yaw]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL,fileURLToPath} from 'node:url';
const repo=process.env.EMBERWATCH_REPO || (fs.existsSync(path.resolve('public/src/characters.js')) ? process.cwd() : path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'));
const threeUrl=pathToFileURL(path.join(repo,'node_modules/three/build/three.module.js')).href;
const THREE=await import(threeUrl);
const source=process.argv[2]||path.join(repo,'public/src/characters.js');
const output=process.argv[3]||'/tmp/emberwatch-preview.json';
const code=fs.readFileSync(source,'utf8').replace("from 'three'", `from '${threeUrl}'`);
const tempDir=fs.mkdtempSync(path.join(os.tmpdir(),'emberwatch-character-preview-'));
const modulePath=path.join(tempDir,'characters.mjs');
fs.writeFileSync(modulePath,code);
let createCharacter;
try {({createCharacter}=await import(pathToFileURL(modulePath).href));}
finally {fs.rmSync(tempDir,{recursive:true,force:true});}
const triangles=[], stats=[];
for(const [i,kind] of ['villager','guard','priest','zombie'].entries()) {
  const actor=createCharacter(kind,i+1);
  // Same reproducible three-quarter standing pose before and after the edit.
  actor.setTool(kind==='villager'?'axe':kind==='guard'?{id:'sword',tier:3}:kind==='priest'?'heal':'');
  for(let t=0;t<60;t++) actor.update(1/60,t/60,{moving:false});
  actor.group.rotation.y=Number(process.argv[4]||'-.28');
  actor.group.position.x=(i-1.5)*2.20;
  actor.group.updateMatrixWorld(true);
  let meshCount=0, triangleCount=0;
  actor.group.traverse(m=>{
    if(!m.isMesh || !m.visible)return;
    let parent=m.parent;while(parent){if(!parent.visible)return;parent=parent.parent;}
    meshCount++;
    const g=m.geometry,ix=g.index,p=g.attributes.position,n=g.attributes.normal;
    const normalMatrix=new THREE.Matrix3().getNormalMatrix(m.matrixWorld);
    for(let j=0;j<(ix?ix.count:p.count);j+=3){
      const ps=[],ns=[];
      for(let k=0;k<3;k++){
        const index=ix?ix.getX(j+k):j+k;
        ps.push(new THREE.Vector3().fromBufferAttribute(p,index).applyMatrix4(m.matrixWorld).toArray());
        ns.push(new THREE.Vector3().fromBufferAttribute(n,index).applyMatrix3(normalMatrix).normalize().toArray());
      }
      const face=new THREE.Vector3().subVectors(new THREE.Vector3(...ps[1]),new THREE.Vector3(...ps[0])).cross(new THREE.Vector3().subVectors(new THREE.Vector3(...ps[2]),new THREE.Vector3(...ps[0]))).normalize();
      if(m.material.flatShading)for(let k=0;k<3;k++)ns[k]=face.toArray();
      triangles.push({p:ps,n:ns,c:m.material.color.toArray(),e:m.material.emissive?.clone().multiplyScalar(m.material.emissiveIntensity||0).toArray()||[0,0,0],metal:m.material.metalness||0,rough:m.material.roughness||1,actor:i});triangleCount++;
    }
  });
  stats.push({kind,meshes:meshCount,triangles:triangleCount});
  actor.dispose();
}
fs.writeFileSync(output,JSON.stringify({triangles,stats}));
console.log(JSON.stringify({output,stats}));
