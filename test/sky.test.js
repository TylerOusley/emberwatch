import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSkyEnvironment, sampleSkyCycle } from '../public/src/sky.js';

function fixture(){
  const scene=new THREE.Scene();scene.background=new THREE.Color();scene.fog=new THREE.FogExp2();
  const sun=new THREE.DirectionalLight(),skyLight=new THREE.HemisphereLight(),fill=new THREE.DirectionalLight();
  sun.target.position.set(0,0,-30);scene.add(sun,sun.target,skyLight,fill);
  const camera=new THREE.PerspectiveCamera(52,1,.1,360),sky=createSkyEnvironment(scene,{sun,skyLight,fill});
  return {scene,sun,skyLight,fill,camera,sky};
}
const close=(a,b,epsilon=1e-6)=>assert.ok(Math.abs(a-b)<epsilon,`${a} ≈ ${b}`);

test('sun crosses east to west through midday while the moon lights the opposite night arc',()=>{
  const dawn=sampleSkyCycle(0),noon=sampleSkyCycle(.25),dusk=sampleSkyCycle(.5),midnight=sampleSkyCycle(.75);
  close(dawn.sunX,1);close(dawn.sunY,0);close(dusk.sunX,-1);close(dusk.sunY,0);
  assert.ok(noon.sunY>.9&&midnight.sunY<-.9);
  assert.equal(noon.sunOpacity,1);assert.equal(noon.moonOpacity,0);assert.equal(noon.stars,0);
  assert.equal(midnight.sunOpacity,0);assert.equal(midnight.moonOpacity,1);assert.equal(midnight.stars,1);
  assert.equal(noon.nightMix,0);assert.equal(midnight.nightMix,1);
  assert.ok(dawn.twilight>.9&&dusk.twilight>.9);
  assert.equal(noon.twilight,0);assert.equal(midnight.twilight,0);
  assert.ok(midnight.ambientIntensity>=.85&&midnight.moonIntensity>=.35,'night defense retains ambient and moon lighting');
});

test('lighting, opacity and celestial travel are continuous at dawn, dusk and the wrapped day boundary',()=>{
  const keys=['sunX','sunY','sunZ','daylight','nightMix','twilight','sunOpacity','moonOpacity','stars','sunIntensity','moonIntensity','ambientIntensity'];
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
