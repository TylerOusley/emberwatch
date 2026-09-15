// Export runtime flame GLSL, attributes, uniforms, and exact torch holders.
// node scripts/preview-torches.mjs [output.json]
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {createTorchSystem,TORCH_VERTEX_SHADER,TORCH_FRAGMENT_SHADER} from '../public/src/torch-world.js';
const output=process.argv[2]||'/tmp/emberwatch-torches.json';
const width=720,height=650,scene=new THREE.Scene();
const fixtures=[
  {id:'outdoor-standing',x:-.72,y:2.65,z:0,mount:'standing',alwaysLit:false},
  {id:'cave-wall',x:.72,y:2.65,z:0,mount:'wall',alwaysLit:true,nx:0,nz:1}
];
const system=createTorchSystem(scene,fixtures),camera=new THREE.OrthographicCamera(-2.18,2.18,3.76,-.18,.1,50);
camera.position.set(3.2,2.4,10);camera.lookAt(0,1.79,0);camera.updateMatrixWorld(true);
// Center an orthographic viewing window on the camera's look target.
camera.top=1.97;camera.bottom=-1.97;camera.left=-1.97*width/height;camera.right=1.97*width/height;camera.updateProjectionMatrix();
const expand=source=>source.replace(/#include\s+<([^>]+)>/g,(_,key)=>expand(THREE.ShaderChunk[key]));
const vertexPrefix='#version 120\nuniform mat4 modelMatrix,modelViewMatrix,projectionMatrix,viewMatrix;uniform vec3 cameraPosition;attribute vec3 position;attribute vec2 uv;\n';
const fragmentPrefix=`#version 120\n${THREE.ShaderChunk.colorspace_pars_fragment}\nvec4 linearToOutputTexel(vec4 value){return sRGBTransferOETF(value);}\n`;
const holderVertex=`#version 120
attribute vec3 position,normal;
uniform mat4 modelViewMatrix,projectionMatrix;
varying vec3 vNormal;
void main(){vNormal=normal;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const holderFragment=`#version 120
uniform vec3 baseColor;
uniform float ambient;
varying vec3 vNormal;
vec3 srgb(vec3 c){return mix(c*12.92,1.055*pow(max(c,vec3(0.)),vec3(1./2.4))-.055,step(vec3(.0031308),c));}
void main(){vec3 n=normalize(vNormal);float key=max(0.,dot(n,normalize(vec3(-.45,.80,.65))));float fill=max(0.,dot(n,normalize(vec3(.7,.2,-.4))));vec3 c=baseColor*(ambient+key*.72+fill*.13);gl_FragColor=vec4(srgb(c),1.);}`;
system.root.updateMatrixWorld(true);
const meshes=[],holders=[],matrix=new THREE.Matrix4();
system.root.traverse(mesh=>{
  if(!mesh.isMesh||mesh===system.flames)return;
  const positions=[],normals=[],g=mesh.geometry,index=g.index,normal=g.attributes.normal;
  for(let i=0;i<(mesh.isInstancedMesh?mesh.count:1);i++){
    const world=mesh.matrixWorld.clone();if(mesh.isInstancedMesh){mesh.getMatrixAt(i,matrix);world.multiply(matrix);}
    const normalMatrix=new THREE.Matrix3().getNormalMatrix(world);
    for(let j=0;j<(index?index.count:g.attributes.position.count);j++){
      const vertex=index?index.getX(j):j;
      positions.push(...new THREE.Vector3().fromBufferAttribute(g.attributes.position,vertex).applyMatrix4(world).toArray());
      normals.push(...new THREE.Vector3().fromBufferAttribute(normal,vertex).applyMatrix3(normalMatrix).normalize().toArray());
    }
  }
  const name=`holder-${holders.length}`;
  meshes.push({name,renderOrder:0,points:false,transparent:false,depthWrite:true,depthTest:true,side:mesh.material.side,attributes:{position:{size:3,values:positions},normal:{size:3,values:normals}},index:null,vertex:holderVertex,fragment:holderFragment});
  holders.push({name,color:mesh.material.color.toArray()});
});
const flames=system.flames,g=flames.geometry;
meshes.push({name:'runtime-flames',renderOrder:flames.renderOrder,points:false,transparent:flames.material.transparent,depthWrite:flames.material.depthWrite,depthTest:flames.material.depthTest,side:flames.material.side,
  attributes:Object.fromEntries(Object.entries(g.attributes).map(([name,a])=>[name,{size:a.itemSize,values:Array.from(a.array)}])),
  index:Array.from(g.index.array).slice(g.drawRange.start,g.drawRange.start+g.drawRange.count),
  vertex:vertexPrefix+expand(flames.material.vertexShader),fragment:fragmentPrefix+expand(flames.material.fragmentShader)});
const identity=new THREE.Matrix4(),frames=[];
for(const [label,time,nightMix,background,ambient] of [
  ['DAY / outdoor off, cave lit',3.7,0,[.22,.30,.33],.36],
  ['DUSK / outdoor flames kindle',3.7,.16,[.11,.13,.17],.24],
  ['NIGHT / frame A',3.7,1,[.018,.026,.038],.16],
  ['NIGHT / frame B (+0.4 seconds)',4.1,1,[.018,.026,.038],.16]
]){
  system.update(time,nightMix,camera,{x:0,y:1,z:4});system.root.updateMatrixWorld(true);
  const matrices={modelMatrix:identity.toArray(),modelViewMatrix:camera.matrixWorldInverse.toArray(),projectionMatrix:camera.projectionMatrix.toArray(),viewMatrix:camera.matrixWorldInverse.toArray(),cameraPosition:camera.position.toArray()};
  const items=holders.map(holder=>({name:holder.name,visible:true,uniforms:{...matrices,baseColor:holder.color,ambient}}));
  items.push({name:'runtime-flames',visible:true,uniforms:{...matrices,...Object.fromEntries(Object.entries(flames.material.uniforms).map(([name,{value}])=>[name,value?.toArray?value.toArray():value]))}});
  frames.push({label,time,nightMix,background,meshes:items,lightCount:system.lights.filter(light=>light.visible&&light.intensity>0).length});
}
const hashes={vertex:createHash('sha256').update(TORCH_VERTEX_SHADER).digest('hex'),fragment:createHash('sha256').update(TORCH_FRAGMENT_SHADER).digest('hex')};
fs.writeFileSync(output,JSON.stringify({width,height,meshes,frames,runtimeShaderHashes:hashes,fixtureLabels:['Outdoor standing torch','Cave wall torch']}));
system.dispose();console.log(JSON.stringify({output,holderBatches:holders.length,frames:frames.map(({label,lightCount})=>({label,lightCount})),runtimeShaderHashes:hashes}));
