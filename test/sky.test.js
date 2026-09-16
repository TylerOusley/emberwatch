import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import { createSkyEnvironment, sampleSkyCycle, SKY_MOON_TEXTURE } from '../public/src/sky.js';

function fixture(){
  const scene=new THREE.Scene();scene.background=new THREE.Color();scene.fog=new THREE.FogExp2();
  const sun=new THREE.DirectionalLight(),skyLight=new THREE.HemisphereLight(),fill=new THREE.DirectionalLight();
  sun.target.position.set(0,0,-30);scene.add(sun,sun.target,skyLight,fill);
  const camera=new THREE.PerspectiveCamera(52,1,.1,360),sky=createSkyEnvironment(scene,{sun,skyLight,fill});
  return {scene,sun,skyLight,fill,camera,sky};
}
const close=(a,b,epsilon=1e-6)=>assert.ok(Math.abs(a-b)<epsilon,`${a} ≈ ${b}`);

test('the hosted NASA lunar map is the documented original 2K JPEG',()=>{
  const bytes=readFileSync(new URL(`../public${SKY_MOON_TEXTURE}`,import.meta.url));
  assert.equal(bytes.length,457942);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'f7130a1822681fa7512d7dcfd40db8c10b9ba4f06777910348698260ed7a2170');
  assert.equal(bytes.readUInt16BE(0),0xffd8);
  let dimensions;
  for(let offset=2;offset<bytes.length;){
    assert.equal(bytes[offset++],255);let marker=bytes[offset++];
    while(marker===255)marker=bytes[offset++];
    if(marker===0xd9||marker===0xda)break;
    const length=bytes.readUInt16BE(offset);
    if([0xc0,0xc1,0xc2].includes(marker)){dimensions=[bytes.readUInt16BE(offset+5),bytes.readUInt16BE(offset+3)];break;}
    offset+=length;
  }
  assert.deepEqual(dimensions,[2048,1024]);
});

test('sun crosses east to west through midday while the moon lights the opposite night arc',()=>{
  const dawn=sampleSkyCycle(0),noon=sampleSkyCycle(.25),dusk=sampleSkyCycle(.5),midnight=sampleSkyCycle(.75);
  close(dawn.sunX,1);close(dawn.sunY,0);close(dusk.sunX,-1);close(dusk.sunY,0);
  assert.ok(noon.sunY>.9&&midnight.sunY<-.9);
  assert.equal(noon.sunOpacity,1);assert.equal(noon.moonOpacity,0);assert.equal(noon.stars,0);
  assert.equal(midnight.sunOpacity,0);assert.equal(midnight.moonOpacity,1);assert.equal(midnight.stars,1);
  assert.equal(noon.nightMix,0);assert.equal(midnight.nightMix,1);
  assert.ok(dawn.twilight>.9&&dusk.twilight>.9);
  assert.equal(noon.twilight,0);assert.equal(midnight.twilight,0);
  assert.ok(midnight.ambientIntensity>=.6&&midnight.moonIntensity>=.3,'night defense retains calibrated ambient and moon lighting');
  assert.ok(noon.ambientIntensity<2&&noon.sunIntensity>3,'daylight has a clear key light instead of flat ambient illumination');
  close(noon.exposure,1.02);close(midnight.exposure,1.12);
});

test('lighting, opacity and celestial travel are continuous at dawn, dusk and the wrapped day boundary',()=>{
  const keys=['sunX','sunY','sunZ','daylight','nightMix','twilight','sunOpacity','moonOpacity','stars','sunIntensity','moonIntensity','ambientIntensity','exposure','fogDensity'];
  for(const phase of [0,.055,.25,.445,.5,.545,.75,1]){
    const before=sampleSkyCycle(phase-1e-6),after=sampleSkyCycle(phase+1e-6);
    for(const key of keys)close(before[key],after[key],.0002);
  }
  for(let i=0;i<=1000;i++){
    const sample=sampleSkyCycle(i/1000);
    close(Math.hypot(sample.sunX,sample.sunY,sample.sunZ),1);
    for(const key of ['daylight','nightMix','twilight','sunOpacity','moonOpacity','stars'])assert.ok(sample[key]>=0&&sample[key]<=1);
  }
  assert.deepEqual(sampleSkyCycle(5.25),sampleSkyCycle(.25));
  assert.deepEqual(sampleSkyCycle(-.25),sampleSkyCycle(.75));
  assert.deepEqual(sampleSkyCycle(NaN),sampleSkyCycle(0));
  assert.deepEqual(sampleSkyCycle(Infinity),sampleSkyCycle(0));
});

test('sky recenters with the camera without shifting directional light shadows or celestial bearings',()=>{
  const {sky,camera,sun}=fixture();camera.position.set(25,12,-90);sky.update(.13,200,camera);sky.group.updateMatrixWorld(true);
  const sunDisc=sky.group.getObjectByName('sun-disc'),moonDisc=sky.group.getObjectByName('moon-disc');
  const initialLight=sun.position.clone(),localBearing=sunDisc.position.clone().normalize();
  const viewNormal=new THREE.Vector3(0,0,1).applyQuaternion(sunDisc.quaternion);
  assert.ok(viewNormal.dot(localBearing)<-.999,'celestial planes face the camera at sphere center');
  close(sunDisc.position.distanceTo(moonDisc.position),592);
  camera.position.set(-85,3,115);sky.update(.13,200,camera);sky.group.updateMatrixWorld(true);
  assert.deepEqual(sky.group.position.toArray(),camera.position.toArray());
  assert.deepEqual(sun.position.toArray(),initialLight.toArray());
  close(sunDisc.getWorldPosition(new THREE.Vector3()).distanceTo(camera.position),296);
  assert.ok(sky.group.children.every(mesh=>mesh.geometry&&mesh.material),'all sky elements are bounded real meshes or point geometry');
  assert.equal(sky.group.children.length,6);
  sky.dispose();
});

test('cloud drift and stars use the supplied simulation clock and remain stable while it is paused',()=>{
  const {sky,camera}=fixture();sky.update(.75,100,camera);
  const cloud=sky.group.getObjectByName('low-cloud-deck'),high=sky.group.getObjectByName('high-cloud-deck'),stars=sky.group.getObjectByName('night-stars');
  assert.equal(cloud.material.uniforms.time.value,100);assert.equal(high.material.uniforms.time.value,100);
  assert.notEqual(cloud.material.uniforms.layer.value,high.material.uniforms.layer.value);
  const positions=stars.geometry.attributes.position.array.slice();
  for(let i=0;i<30;i++)sky.update(.75,100,camera);
  assert.equal(cloud.material.uniforms.time.value,100);assert.equal(stars.material.uniforms.time.value,100);
  sky.update(.75,110,camera);assert.equal(cloud.material.uniforms.time.value,110);
  assert.deepEqual(stars.geometry.attributes.position.array,positions);
  assert.equal(stars.visible,true);assert.equal(sky.group.getObjectByName('sun-disc').visible,false);assert.equal(sky.group.getObjectByName('moon-disc').visible,true);
  sky.update(.25,500,camera);assert.equal(stars.visible,false);assert.equal(sky.group.getObjectByName('moon-disc').visible,false);
  sky.dispose();
});

test('all owned sky geometry and materials are disposed exactly once without deleting scene lights',()=>{
  const {sky,scene,sun}=fixture();const geometries=new Set(),materials=new Set();
  sky.group.traverse(object=>{if(object.geometry)geometries.add(object.geometry);if(object.material)materials.add(object.material);});
  let geometryDisposals=0,materialDisposals=0;
  for(const geometry of geometries)geometry.addEventListener('dispose',()=>geometryDisposals++);
  for(const material of materials)material.addEventListener('dispose',()=>materialDisposals++);
  sky.dispose();sky.dispose();
  assert.equal(geometryDisposals,geometries.size);assert.equal(materialDisposals,materials.size);
  assert.equal(scene.getObjectByName('living-sky'),undefined);assert.ok(scene.children.includes(sun));
});

test('sky reuses bounded assets and uniform objects for arbitrary clocks, camera jumps and nonfinite input',()=>{
  const {sky,camera,scene}=fixture(),meshes=[...sky.group.children],references=meshes.map(mesh=>({geometry:mesh.geometry,material:mesh.material,uniforms:Object.values(mesh.material.uniforms).map(u=>u.value)}));
  for(let frame=0;frame<600;frame++){
    camera.position.set(frame%2?85:-85,frame%7,-frame*3);const sample=sky.update(frame/81,frame*16,camera);sky.group.updateMatrixWorld(true);
    close(scene.fog.density,sample.fogDensity);assert.equal(sky.group.children.length,6);
  }
  camera.position.x=Infinity;sky.update(NaN,Infinity,camera);sky.group.updateMatrixWorld(true);
  for(const [i,mesh]of meshes.entries()){
    assert.equal(mesh.geometry,references[i].geometry);assert.equal(mesh.material,references[i].material);assert.ok(mesh.matrixWorld.elements.every(Number.isFinite));
    for(const [j,{value}]of Object.values(mesh.material.uniforms).entries()){
      if(typeof value==='number')assert.ok(Number.isFinite(value));
      else assert.equal(value,references[i].uniforms[j],'vector, color and texture uniforms keep stable identity');
    }
    assert.equal(mesh.material.toneMapped,true,'HDR and direct paths share the scene tone mapping contract');
  }
  const moon=sky.group.getObjectByName('moon-disc');assert.ok(moon.scale.x<5,'lunar plane is small at its 296m distance, including edge padding');
  sky.dispose();
});

test('the headless lunar fallback owns its texture while an injected lunar map remains caller-owned',()=>{
  const scene=new THREE.Scene(),fallbackSky=createSkyEnvironment(scene),fallback=fallbackSky.group.getObjectByName('moon-disc').material.uniforms.moonMap.value;let fallbackDisposals=0;
  assert.ok(fallback.isDataTexture);fallback.addEventListener('dispose',()=>fallbackDisposals++);fallbackSky.dispose();fallbackSky.dispose();assert.equal(fallbackDisposals,1);
  const moonTexture=new THREE.Texture();let borrowedDisposals=0;moonTexture.addEventListener('dispose',()=>borrowedDisposals++);
  const sky=createSkyEnvironment(scene,{moonTexture}),uniforms=sky.group.getObjectByName('moon-disc').material.uniforms;
  assert.equal(uniforms.moonMap.value,moonTexture);assert.equal(uniforms.moonReady.value,1);sky.dispose();assert.equal(borrowedDisposals,0);moonTexture.dispose();assert.equal(borrowedDisposals,1);
});

test('lunar loading is local, keeps a usable fallback on failure and cannot revive a disposed sky',()=>{
  const originalDocument=globalThis.document,images=[];
  globalThis.document={createElementNS:()=>{const listeners=new Map(),image={addEventListener:(type,listener)=>listeners.set(type,listener),removeEventListener:type=>listeners.delete(type),complete(type){listeners.get(type)?.call(image,{target:image});}};images.push(image);return image;}};
  const skies=[];
  try{
    const scene=new THREE.Scene(),sky=createSkyEnvironment(scene);skies.push(sky);const u=sky.group.getObjectByName('moon-disc').material.uniforms,fallback=u.moonMap.value;
    assert.equal(images[0].src,SKY_MOON_TEXTURE);assert.equal(u.moonReady.value,0);images[0].complete('load');
    const loaded=u.moonMap.value;assert.notEqual(loaded,fallback);assert.equal(loaded.colorSpace,THREE.SRGBColorSpace);assert.equal(u.moonReady.value,1);
    let releases=0;loaded.addEventListener('dispose',()=>releases++);sky.dispose();sky.dispose();assert.equal(releases,1);
    const failed=createSkyEnvironment(scene);skies.push(failed);const failedUniforms=failed.group.getObjectByName('moon-disc').material.uniforms;
    images[1].complete('error');assert.equal(failedUniforms.moonReady.value,0);assert.ok(failedUniforms.moonMap.value.isDataTexture);
    const late=createSkyEnvironment(scene);skies.push(late);const lateUniforms=late.group.getObjectByName('moon-disc').material.uniforms,previous=lateUniforms.moonMap.value;
    late.dispose();images[2].complete('load');assert.equal(lateUniforms.moonReady.value,0);assert.equal(lateUniforms.moonMap.value,previous);assert.equal(scene.children.includes(late.group),false);
  }finally{for(const sky of skies)sky.dispose();globalThis.document=originalDocument;}
});

test('a blocked image API leaves all six sky layers and the lunar fallback usable',()=>{
  const originalDocument=globalThis.document;
  globalThis.document={createElementNS(){throw Error('Image loading unavailable');}};
  let sky;
  try{
    const scene=new THREE.Scene();sky=createSkyEnvironment(scene);
    assert.equal(sky.group.children.length,6);sky.update(.75,60);
    const moon=sky.group.getObjectByName('moon-disc');
    assert.equal(moon.visible,true);assert.equal(moon.material.uniforms.moonReady.value,0);
    assert.ok(moon.material.uniforms.moonMap.value.isDataTexture);
  }finally{sky?.dispose();globalThis.document=originalDocument;}
});
