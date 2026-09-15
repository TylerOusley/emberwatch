import test from 'node:test';
import assert from 'node:assert/strict';
import { constrainCaveCamera, localDwarfOccludesCamera } from '../public/src/cave-camera.js';
import { placeOrbitCamera } from '../public/src/camera-controls.js';
import { CAVE_ROUTE, CAVE_SOLIDS, caveAreaAt, groundHeight } from '../shared/world.js';

test('underground orbit stays above ramps and inside rock walls across every yaw and pitch', () => {
  for (let segment = 1; segment < CAVE_ROUTE.length; segment++) for (let part = 0; part <= 10; part++) {
    const a=CAVE_ROUTE[segment-1],b=CAVE_ROUTE[segment],t=part/10;
    const player={x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t};player.y=groundHeight(player.x,player.z);
    for(let yaw=0;yaw<Math.PI*2;yaw+=.31)for(const pitch of [-.95,.39,.95]){
      const position={},anchor={},lookAt={};placeOrbitCamera(player,yaw,pitch,4.5,position,anchor,lookAt);constrainCaveCamera(anchor,position,lookAt);
      assert.ok(Object.values(position).every(Number.isFinite));
      assert.ok(position.y>=groundHeight(position.x,position.z)+.27);
      assert.ok(!CAVE_SOLIDS.some(s=>Math.abs(position.x-s.x)<s.w/2+.2&&Math.abs(position.z-s.z)<s.d/2+.2));
      if(caveAreaAt(position.x,position.z)&&position.z< -122)assert.ok(position.y<=groundHeight(position.x,position.z)+4.86);
      if(caveAreaAt(player.x,player.z))assert.ok(lookAt.y<=player.y+4.6);
    }
  }
});

test('a smoothed camera cannot cut through a chamber corner or remain above the cave roof', () => {
  const anchor={x:9,y:groundHeight(9,-168)+1.45,z:-168};
  for(const prior of [{x:0,y:24,z:-160},{x:-8,y:-1,z:-157},{x:19,y:-8,z:-183}]){
    const camera={...prior};constrainCaveCamera(anchor,camera);
    assert.ok(caveAreaAt(camera.x,camera.z));
    assert.ok(camera.y<=groundHeight(camera.x,camera.z)+4.86);
    const length=Math.hypot(camera.x-anchor.x,camera.y-anchor.y,camera.z-anchor.z);
    assert.ok(length>0,'valid headroom remains around the dwarf');
  }
  const camera={x:0,y:24,z:50};constrainCaveCamera({x:0,y:1.45,z:4},camera);assert.deepEqual(camera,{x:0,y:24,z:50});
});

test('a wall-compressed camera hides the local body only until normal viewing distance returns', () => {
  const player={x:13.5,z:-151,y:-3},position={},anchor={},lookAt={};
  placeOrbitCamera(player,Math.PI/2,.39,4.5,position,anchor,lookAt);constrainCaveCamera(anchor,position,lookAt);
  assert.ok(localDwarfOccludesCamera(position,player),'camera is inside the dwarf shoulder beside the rock wall');
  player.x=10;placeOrbitCamera(player,Math.PI/2,.39,4.5,position,anchor,lookAt);constrainCaveCamera(anchor,position,lookAt);
  assert.equal(localDwarfOccludesCamera(position,player),false,'body restores on moving away from the wall');
});
