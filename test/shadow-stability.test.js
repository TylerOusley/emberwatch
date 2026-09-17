import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {stabilizeDirectionalShadow} from '../public/src/shadow-stability.js';

function shadowSample(direction,focus,{size=2048,radius=48,zoom=1,stabilized=true}={}){
  const light=new THREE.DirectionalLight(),camera=light.shadow.camera;
  camera.left=-radius;camera.right=radius;camera.top=radius;camera.bottom=-radius;camera.zoom=zoom;camera.updateProjectionMatrix();
  light.shadow.mapSize.set(size,size);light.target.position.copy(focus);light.position.copy(focus).addScaledVector(direction,180);
  if(stabilized)assert.equal(stabilizeDirectionalShadow(light),true);
  light.updateMatrixWorld();light.target.updateMatrixWorld();light.shadow.updateMatrices(light);
  const origin=new THREE.Vector3(13,4,-23).applyMatrix4(light.shadow.matrix).multiplyScalar(size);
  return {light,origin};
}

test('walking keeps static world points on the same sun and moon shadow texel grid',()=>{
  for(const direction of [new THREE.Vector3(-.44,.83,.48).normalize(),new THREE.Vector3(.63,.67,-.35).normalize(),new THREE.Vector3(0,1,0)]){
    for(const options of [{size:1024,radius:55},{size:2048,radius:48},{size:4096,radius:62,zoom:1.3}]){
      const first=shadowSample(direction,new THREE.Vector3(0,2,0),options);
      for(let i=1;i<=60;i++){
        const focus=new THREE.Vector3(i*.013,2+Math.sin(i/20)*.04,-i*.007),sample=shadowSample(direction,focus,options);
        const shift=sample.origin.clone().sub(first.origin);
        for(const axis of ['x','y'])assert.ok(Math.abs(shift[axis]-Math.round(shift[axis]))<1e-7,`fractional ${axis} shadow shift: ${shift[axis]}`);
        assert.ok(sample.light.position.clone().sub(sample.light.target.position).distanceTo(direction.clone().multiplyScalar(180))<1e-10,'light direction and shadow depth stay unchanged');
        const displacement=sample.light.target.position.distanceTo(focus);
        assert.ok(displacement<=Math.SQRT2*options.radius/options.size/(options.zoom??1)+1e-9,'focus moves no farther than half a texel along either light axis');
      }
    }
  }
});

test('the previous world-axis rounding shifts angled shadows by fractional texels',()=>{
  const direction=new THREE.Vector3(-.44,.83,.48).normalize(),step=96/2048;
  const before=shadowSample(direction,new THREE.Vector3(0,2,0),{stabilized:false});
  const after=shadowSample(direction,new THREE.Vector3(step,2,step),{stabilized:false});
  const delta=after.origin.clone().sub(before.origin);
  assert.ok(Math.abs(delta.x-Math.round(delta.x))>.01||Math.abs(delta.y-Math.round(delta.y))>.01,'reproduces movement even when world X/Z are rounded');
});

test('shadow stabilization is idempotent and ignores invalid render targets',()=>{
  const {light}=shadowSample(new THREE.Vector3(-.4,.8,.3).normalize(),new THREE.Vector3(3.4,2,-5.6));
  const position=light.position.clone(),target=light.target.position.clone();
  for(let i=0;i<300;i++)stabilizeDirectionalShadow(light);
  assert.ok(position.distanceTo(light.position)<1e-10);assert.ok(target.distanceTo(light.target.position)<1e-10);
  light.shadow.mapSize.x=0;assert.equal(stabilizeDirectionalShadow(light),false);
  assert.equal(stabilizeDirectionalShadow(new THREE.PointLight()),false);
});
