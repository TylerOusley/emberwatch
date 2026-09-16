// Export the actual current world for offline Mesa inspection. No browser or
// alternate art is involved. Geometry stays indexed and instances stay shared.
// node scripts/preview-world.mjs /tmp/emberwatch-world.json
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';

const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'..');
const moduleURL=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const sourceURL=relative=>new URL(relative,import.meta.url).href;
function sourceModule(filename,overrides={}){
  let source=fs.readFileSync(path.join(root,'public/src',filename),'utf8');
  const imports={'three':sourceURL('../node_modules/three/build/three.module.js'),'/shared/world.js':sourceURL('../shared/world.js'),...overrides};
  return moduleURL(source.replace(/from\s+(['"])([^'"]+)\1/g,(all,quote,name)=>{
    const target=imports[name]??(name.startsWith('.')?new URL(name,sourceURL('../public/src/'+filename)).href:null);
    return target?'from '+JSON.stringify(target):all;
  }));
}
const plots=sourceModule('plots-world.js');
const {createWorld}=await import(sourceModule('world.js',{'./plots-world.js':plots}));
const {createCaveWorld}=await import(sourceURL('../public/src/cave-world.js'));

// Keep the actual signs' drawing instructions for the offline renderer.
const previousDocument=globalThis.document;
globalThis.document={createElement:()=>{
  const canvas={width:0,height:0,commands:[]};
  const state={fillStyle:'#000000',strokeStyle:'#000000',lineWidth:1,font:'10px sans-serif',textAlign:'start',textBaseline:'alphabetic'};
  canvas.getContext=()=>new Proxy(state,{get(target,key){return key in target?target[key]:(...args)=>canvas.commands.push({op:key,args,state:{...state}});},set(target,key,value){target[key]=value;return true;}});
  return canvas;
}};
const scene=new THREE.Scene();let world;
try{world=createWorld(scene);createCaveWorld(scene);world.update(1,0,{});}finally{globalThis.document=previousDocument;}
scene.updateMatrixWorld(true);
const geometries=[],materials=[],draws=[],canvases={},geometryIds=new Map(),materialIds=new Map();
const pack=values=>Buffer.from(values.buffer,values.byteOffset,values.byteLength).toString('base64');
function geometryId(geometry){
  if(geometryIds.has(geometry.uuid))return geometryIds.get(geometry.uuid);
  if(!geometry.attributes.normal)geometry.computeVertexNormals();
  const attributes={};
  for(const key of ['position','normal','color','uv']){
    const attr=geometry.attributes[key];if(!attr)continue;
    const values=new Float32Array(attr.count*attr.itemSize);
    for(let i=0;i<attr.count;i++)for(let j=0;j<attr.itemSize;j++)values[i*attr.itemSize+j]=attr.getComponent(i,j);
    if(!values.every(Number.isFinite))throw new Error(`Nonfinite ${key} in ${geometry.name}.`);
    attributes[key]={size:attr.itemSize,data:pack(values)};
  }
  const indices=geometry.index?Uint32Array.from(geometry.index.array):Uint32Array.from({length:geometry.attributes.position.count},(_,i)=>i);
  const id=geometries.length;geometryIds.set(geometry.uuid,id);
  geometries.push({name:geometry.name,attributes,index:pack(indices),count:indices.length,vertices:geometry.attributes.position.count});return id;
}
function materialId(material){
  if(materialIds.has(material.uuid))return materialIds.get(material.uuid);
  const id=materials.length;materialIds.set(material.uuid,id);
  const canvas=material.map?.image?.commands?material.map.uuid:null;
  if(canvas)canvases[canvas]={width:material.map.image.width,height:material.map.image.height,commands:material.map.image.commands};
  materials.push({name:material.name,color:material.color?.toArray()??[1,1,1],vertexColors:!!material.vertexColors,emissive:material.emissive?.clone().multiplyScalar(material.emissiveIntensity??1).toArray()??[0,0,0],roughness:material.roughness??1,metalness:material.metalness??0,opacity:material.transparent?material.opacity:1,side:material.side??0,flat:!!material.flatShading,surface:material.userData.surface??null,canvas});return id;
}
let triangleInstances=0,instanceCount=0;
scene.traverse(mesh=>{
  if(!mesh.isMesh||!mesh.geometry?.attributes.position)return;
  for(let ancestor=mesh;ancestor;ancestor=ancestor.parent)if(!ancestor.visible)return;
  const count=mesh.isInstancedMesh?mesh.count:1;if(!count)return;
  const matrices=new Float32Array(count*16),colors=new Float32Array(count*3).fill(1),matrix=new THREE.Matrix4(),color=new THREE.Color();
  for(let i=0;i<count;i++){
    if(mesh.isInstancedMesh){mesh.getMatrixAt(i,matrix);matrix.premultiply(mesh.matrixWorld);if(mesh.instanceColor){mesh.getColorAt(i,color);colors.set(color.toArray(),i*3);}}
    else matrix.copy(mesh.matrixWorld);
    matrices.set(matrix.elements,i*16);
  }
  const geometry=geometryId(mesh.geometry),g=geometries[geometry],start=Math.max(0,mesh.geometry.drawRange.start),end=Math.min(g.count,start+mesh.geometry.drawRange.count);
  const groups=Array.isArray(mesh.material)?mesh.geometry.groups:[{start:0,count:g.count,materialIndex:0}];
  for(const group of groups){
    const material=Array.isArray(mesh.material)?mesh.material[group.materialIndex]:mesh.material;
    if(!material||material.visible===false||material.opacity<=0)continue;
    const offset=Math.max(start,group.start),length=Math.min(end,group.start+group.count)-offset;if(length<=0)continue;
    draws.push({name:mesh.name,geometry,material:materialId(material),count,matrices:pack(matrices),colors:pack(colors),offset,length,castShadow:!!mesh.castShadow});
    triangleInstances+=length/3*count;instanceCount+=count;
  }
});
const width=1080,height=660,sun=new THREE.Vector3(-.44,.83,.48).normalize();
const frames=[
  {label:'THE VILLAGE',caption:'Textured stone, timber architecture, cobbled lanes and the surrounding landscape.',eye:[29,17,15],target:[-3,3,-22],fov:62,shadowRadius:95},
  {label:'AT STREET LEVEL',caption:'The actual shops, well and watch buildings beside the main road.',eye:[4.3,3.8,12.5],target:[-1,3,-24],fov:72,shadowRadius:62},
  {label:'THE WOODLAND',caption:'Individual leaves, bending branches, exposed roots and fine terrain texture.',eye:[-16,4,77],target:[-30,3,52],fov:64,shadowRadius:48},
  {label:'THE MOUNTAIN APPROACH',caption:'Layered mine stonework and eroded ridgelines beyond the northern gate.',eye:[17,8,-95],target:[0,4.5,-121],fov:66,shadowRadius:80}
].map(frame=>{
  const camera=new THREE.PerspectiveCamera(frame.fov,width/height,.15,850);camera.position.set(...frame.eye);camera.lookAt(...frame.target);camera.updateMatrixWorld(true);
  const radius=frame.shadowRadius,light=new THREE.OrthographicCamera(-radius,radius,radius,-radius,.1,650);light.position.copy(new THREE.Vector3(...frame.target).addScaledVector(sun,260));light.lookAt(...frame.target);light.updateMatrixWorld(true);
  return {...frame,vp:new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse).toArray(),lightVP:new THREE.Matrix4().multiplyMatrices(light.projectionMatrix,light.matrixWorldInverse).toArray()};
});
const stats={geometries:geometries.length,materials:materials.length,draws:draws.length,instanceCount,uniqueVertices:geometries.reduce((sum,g)=>sum+g.vertices,0),uniqueTriangles:geometries.reduce((sum,g)=>sum+g.count/3,0),triangleInstances};
const output=process.argv[2]??'/tmp/emberwatch-world.json';
fs.writeFileSync(output,JSON.stringify({format:1,width,height,assetRoot:path.join(root,'public/assets/surfaces'),sun:sun.toArray(),geometries,materials,draws,canvases,frames,stats}));
console.log(JSON.stringify({output,bytes:fs.statSync(output).size,...stats}));
