// Diagnostic only: real Three.js PBR shaders and downloaded game maps, rendered
// by software EGL. This is not an in-game screenshot or browser layout check.
// node scripts/preview-surface-materials.mjs /tmp/surfaces.json
// python3 scripts/render-surface-materials.py /tmp/surfaces.json docs/previews/surface-materials.jpg
import * as THREE from 'three';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureThreeProgram } from './verify-graphics-shaders.mjs';
import { SURFACE_KINDS, createSurfaceMaterial } from '../public/src/surface-materials.js';

const width=260,height=270;
const camera=new THREE.PerspectiveCamera(38,width/height,.1,100);
camera.position.set(3.5,2.7,5.6);camera.lookAt(0,0,0);camera.zoom=1.35;camera.updateProjectionMatrix();camera.updateMatrixWorld();
const identity=new THREE.Matrix4(),normalMatrix=new THREE.Matrix3().getNormalMatrix(camera.matrixWorldInverse);
const sun=new THREE.Vector3(-.4,.8,.6).normalize().transformDirection(camera.matrixWorldInverse);
const up=new THREE.Vector3(0,1,0).transformDirection(camera.matrixWorldInverse);
const directory=fileURLToPath(new URL('../public/assets/surfaces/',import.meta.url));
const geometries=[new THREE.SphereGeometry(1,56,40),new THREE.BoxGeometry(1.6,1.6,1.6)];
const meshes=geometries.map((geometry,index)=>({
  attributes:Object.fromEntries(Object.entries(geometry.attributes).map(([name,attribute])=>[name,{size:attribute.itemSize,values:Array.from(attribute.array)}])),
  index:Array.from(geometry.index.array),
  instanceMatrix:new THREE.Matrix4().compose(new THREE.Vector3(),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),index?.22:0),new THREE.Vector3(1,index?.8:1,index?1.2:1)).elements
}));
const frames=[];
let program;
for(const kind of SURFACE_KINDS){
  const material=createSurfaceMaterial(kind);
  const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms)};
  material.onBeforeCompile(shader,{});
  program??=captureThreeProgram('surface-pbr-diagnostic',shader,{instancing:true,numDirLights:1,numHemiLights:1,toneMapping:THREE.ACESFilmicToneMapping,outputColorSpace:THREE.SRGBColorSpace});
  const uniforms={
    modelMatrix:identity.elements,modelViewMatrix:camera.matrixWorldInverse.elements,viewMatrix:camera.matrixWorldInverse.elements,
    projectionMatrix:camera.projectionMatrix.elements,normalMatrix:normalMatrix.elements,cameraPosition:camera.position.toArray(),
    isOrthographic:{integer:0},receiveShadow:{integer:0},diffuse:material.color.toArray(),opacity:1,roughness:material.roughness,metalness:material.metalness,
    emissive:[0,0,0],ambientLightColor:[.035,.035,.035],toneMappingExposure:1,
    'directionalLights[0].direction':sun.toArray(),'directionalLights[0].color':[2.8,2.55,2.3],
    'hemisphereLights[0].direction':up.toArray(),'hemisphereLights[0].skyColor':[.55,.68,.84],'hemisphereLights[0].groundColor':[.17,.13,.09],
    surfaceWorldScale:shader.uniforms.surfaceWorldScale.value,surfaceNormalStrength:shader.uniforms.surfaceNormalStrength.value,
    surfaceColorStrength:1,surfaceReliefEnabled:1,
    surfaceAlbedo:{texture:resolve(directory,`${kind}-albedo.jpg`),srgb:true,unit:0},
    surfaceNormal:{texture:resolve(directory,`${kind}-normal.jpg`),unit:1},
    surfaceRoughness:{texture:resolve(directory,`${kind}-roughness.jpg`),unit:2}
  };
  frames.push({kind,uniforms});material.dispose();
}
writeFileSync(process.argv[2]||'/tmp/emberwatch-surfaces.json',JSON.stringify({width,height,program,meshes,frames}));
for(const geometry of geometries)geometry.dispose();
console.log(`Exported ${frames.length} actual PBR surface materials with two diagnostic geometries.`);
