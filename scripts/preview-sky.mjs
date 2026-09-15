// Export the actual sky geometry, GLSL and uniform snapshots for offline shader QA.
// node scripts/preview-sky.mjs /tmp/emberwatch-sky.json
import fs from 'node:fs';
import * as THREE from 'three';
import {createSkyEnvironment,sampleSkyCycle} from '../public/src/sky.js';
const output=process.argv[2]||'/tmp/emberwatch-sky.json';
const scene=new THREE.Scene(),sky=createSkyEnvironment(scene);
const camera=new THREE.PerspectiveCamera(84,640/450,.1,360);
const expand=source=>source.replace(/#include\s+<([^>]+)>/g,(_,key)=>expand(THREE.ShaderChunk[key]));
const vertexPrefix=`#version 120\nuniform mat4 modelMatrix,modelViewMatrix,projectionMatrix,viewMatrix;uniform vec3 cameraPosition;attribute vec3 position;attribute vec2 uv;\n`;
const fragmentPrefix=`#version 120\n${THREE.ShaderChunk.colorspace_pars_fragment}\nvec4 linearToOutputTexel(vec4 value){return sRGBTransferOETF(value);}\n`;
const meshes=sky.group.children.map(mesh=>({name:mesh.name,renderOrder:mesh.renderOrder,points:!!mesh.isPoints,transparent:mesh.material.transparent,
  attributes:Object.fromEntries(Object.entries(mesh.geometry.attributes).map(([name,attr])=>[name,{size:attr.itemSize,values:Array.from(attr.array)}])),
  index:mesh.geometry.index?Array.from(mesh.geometry.index.array):null,
  vertex:vertexPrefix+expand(mesh.material.vertexShader),fragment:fragmentPrefix+expand(mesh.material.fragmentShader)}));
const frames=[];
for(const [label,cycle] of [['Sunrise',.015],['Midday',.25],['Sunset',.485],['Moonlit night',.75]]){
 const sample=sampleSkyCycle(cycle), sign=cycle>.5?-1:1;
 const horizontal=new THREE.Vector3(sample.sunX*sign,0,sample.sunZ*sign).normalize();
 camera.position.set(0,0,0);camera.lookAt(horizontal.x,Math.tan(37*Math.PI/180),horizontal.z);camera.updateMatrixWorld(true);
 sky.update(cycle,180,camera);sky.group.updateMatrixWorld(true);
 frames.push({label,cycle,meshes:sky.group.children.map(mesh=>({name:mesh.name,visible:mesh.visible,uniforms:{
  ...Object.fromEntries(Object.entries(mesh.material.uniforms).map(([name,{value}])=>[name,value?.toArray?value.toArray():value])),
  modelMatrix:mesh.matrixWorld.toArray(),modelViewMatrix:new THREE.Matrix4().multiplyMatrices(camera.matrixWorldInverse,mesh.matrixWorld).toArray(),
  projectionMatrix:camera.projectionMatrix.toArray(),viewMatrix:camera.matrixWorldInverse.toArray(),cameraPosition:camera.position.toArray()
 }}))});
}
fs.writeFileSync(output,JSON.stringify({width:640,height:450,meshes,frames}));sky.dispose();console.log(output);
