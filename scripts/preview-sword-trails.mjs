// Export the actual articulated sword and pooled ribbon GLSL for offline GL QA.
// node scripts/preview-sword-trails.mjs /tmp/emberwatch-sword-trails.json
import fs from 'node:fs';
import * as THREE from 'three';
import {createCharacter} from '../public/src/characters.js';
import {createSwordTrails} from '../public/src/sword-trails.js';
const scene=new THREE.Scene(),rig=createCharacter('guard',3),trails=createSwordTrails(scene);scene.add(rig.group);
const actor={rig,motionOptions:{}},actors=new Map([['guard',actor]]),entities=[{id:'guard',role:'guard',hp:100,tool:'sword'}];
const camera=new THREE.PerspectiveCamera(42,640/480,.1,100);camera.position.set(-3,2.4,5);camera.lookAt(0,1.25,.1);camera.updateMatrixWorld();
const expand=source=>source.replace(/#include\s+<([^>]+)>/g,(_,key)=>expand(THREE.ShaderChunk[key]));
const vertexPrefix='#version 120\nuniform mat4 modelViewMatrix,projectionMatrix;attribute vec3 position;attribute vec2 uv;\n';
const fragmentPrefix=`#version 120\n${THREE.ShaderChunk.colorspace_pars_fragment}\nvec4 linearToOutputTexel(vec4 v){return sRGBTransferOETF(v);}\n`;
const bodyVertex=vertexPrefix+'attribute vec3 normal;attribute vec3 vertexColor;varying vec3 vColor;void main(){float l=.42+.6*max(0.0,dot(normalize(normal),normalize(vec3(-.5,.8,1.0))));vColor=vertexColor*l;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}';
const bodyFragment=fragmentPrefix+'varying vec3 vColor;void main(){gl_FragColor=linearToOutputTexel(vec4(vColor,1.0));}';
const boneMatrix=new THREE.Matrix4(),skinMatrix=new THREE.Matrix4(),normalSkin=new THREE.Matrix3(),skinIndex=new THREE.Vector4(),skinWeight=new THREE.Vector4();
function skinNormal(mesh,index,normal){
  skinIndex.fromBufferAttribute(mesh.geometry.attributes.skinIndex,index);skinWeight.fromBufferAttribute(mesh.geometry.attributes.skinWeight,index);skinMatrix.elements.fill(0);
  for(let i=0;i<4;i++){const w=skinWeight.getComponent(i);if(!w)continue;boneMatrix.fromArray(mesh.skeleton.boneMatrices,skinIndex.getComponent(i)*16);for(let j=0;j<16;j++)skinMatrix.elements[j]+=boneMatrix.elements[j]*w;}
  skinMatrix.premultiply(mesh.bindMatrixInverse).multiply(mesh.bindMatrix);return normal.applyMatrix3(normalSkin.setFromMatrix4(skinMatrix));
}
let time=0;
const advance=attack=>{time+=1/60;actor.motionOptions={attack,tool:{id:'sword',tier:3}};rig.update(1/60,time,actor.motionOptions);trails.update({actors,entities,ownId:'guard',localActionId:attack,selected:'sword',dt:1/60,time,snapshotAt:time});};
for(let i=0;i<90;i++)advance(0);
const frames=[];
for(let i=1;i<=42;i++){
  advance(1);if(![7,14,21,42].includes(i))continue;
  scene.updateMatrixWorld(true);rig.group.traverse(m=>{if(m.isSkinnedMesh)m.skeleton.update();});
  const meshes=[];
  rig.group.traverse(m=>{
    if(!m.isMesh||!m.visible)return;for(let p=m.parent;p;p=p.parent)if(!p.visible)return;
    if(Array.isArray(m.material))throw Error('Preview requires explicit material groups');
    const g=m.geometry,p=g.attributes.position,n=g.attributes.normal,c=g.attributes.color,normalMatrix=new THREE.Matrix3().getNormalMatrix(m.matrixWorld);
    const positions=[],normals=[],colors=[],base=m.material.color||new THREE.Color('white');
    for(let j=0;j<p.count;j++){
      const v=new THREE.Vector3().fromBufferAttribute(p,j),vn=new THREE.Vector3().fromBufferAttribute(n,j);
      if(m.isSkinnedMesh){m.applyBoneTransform(j,v);skinNormal(m,j,vn);}v.applyMatrix4(m.matrixWorld);vn.applyMatrix3(normalMatrix).normalize();
      positions.push(...v.toArray());normals.push(...vn.toArray());colors.push(base.r*(m.material.vertexColors&&c?c.getX(j):1),base.g*(m.material.vertexColors&&c?c.getY(j):1),base.b*(m.material.vertexColors&&c?c.getZ(j):1));
    }
    meshes.push({vertex:bodyVertex,fragment:bodyFragment,transparent:false,points:false,index:g.index?Array.from(g.index.array):null,
      attributes:{position:{size:3,values:positions},normal:{size:3,values:normals},vertexColor:{size:3,values:colors}},
      uniforms:{modelViewMatrix:camera.matrixWorldInverse.toArray(),projectionMatrix:camera.projectionMatrix.toArray()}});
  });
  const ribbon=trails.root.children[0],count=ribbon.geometry.drawRange.count;
  if(count)meshes.push({vertex:vertexPrefix+expand(ribbon.material.vertexShader),fragment:fragmentPrefix+expand(ribbon.material.fragmentShader),transparent:true,points:false,index:null,
    attributes:Object.fromEntries(Object.entries(ribbon.geometry.attributes).map(([name,a])=>[name,{size:a.itemSize,values:Array.from(a.array.subarray(0,count*a.itemSize))}])),
    uniforms:{...Object.fromEntries(Object.entries(ribbon.material.uniforms).map(([name,{value}])=>[name,value?.toArray?value.toArray():value])),modelViewMatrix:camera.matrixWorldInverse.toArray(),projectionMatrix:camera.projectionMatrix.toArray()}});
  frames.push({label:({7:'Windup',14:'Cutting arc',21:'Follow-through',42:'Recovered'})[i],meshes});
}
fs.writeFileSync(process.argv[2]||'/tmp/emberwatch-sword-trails.json',JSON.stringify({width:640,height:480,frames}));trails.dispose();rig.dispose();
