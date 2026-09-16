import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
const threeURL=new URL('../node_modules/three/build/three.module.js',import.meta.url).href;
const sharedURL=new URL('../shared/world.js',import.meta.url).href;
const moduleURL=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const plots=readFileSync(new URL('../public/src/plots-world.js',import.meta.url),'utf8').replace("'three'",JSON.stringify(threeURL)).replace("'/shared/world.js'",JSON.stringify(sharedURL)).replace("'./surface-materials.js'",JSON.stringify(new URL('../public/src/surface-materials.js',import.meta.url).href)).replace("'./environment-geometry.js'",JSON.stringify(new URL('../public/src/environment-geometry.js',import.meta.url).href));
const source=readFileSync(new URL('../public/src/world.js',import.meta.url),'utf8').replace("'three'",JSON.stringify(threeURL)).replace("'/shared/world.js'",JSON.stringify(sharedURL)).replace("'./plots-world.js'",JSON.stringify(moduleURL(plots))).replace("'./surface-materials.js'",JSON.stringify(new URL('../public/src/surface-materials.js',import.meta.url).href)).replace("'./environment-geometry.js'",JSON.stringify(new URL('../public/src/environment-geometry.js',import.meta.url).href));
const {createGateArtwork,createWellArtwork}=await import(moduleURL(source));
function parts(root){const meshes=[];root.traverse(n=>{if(n.isMesh)meshes.push(n);});return meshes;}
function cost(root){return parts(root).reduce((r,m)=>{const triangles=(m.geometry.index?.count??m.geometry.attributes.position.count)/3*(m.isInstancedMesh?m.count:1);return {calls:r.calls+1,triangles:r.triangles+triangles};},{calls:0,triangles:0});}

test('forged gate keeps its original root and full lift range while chains join the moving top to a fixed hoist',()=>{
  const art=createGateArtwork(),{gate,frame}=art;assert.equal(gate.name,'gate-portcullis');assert.equal(gate.position.x,0);assert.equal(gate.position.z,18.7);assert.equal(gate.userData.openAmount,1);
  const chain=frame.getObjectByName('forged-chain-links');assert.ok(chain?.isInstancedMesh);const matrix=new THREE.Matrix4(),p=new THREE.Vector3();let priorCount=0;
  for(const open of [0,.25,.5,.75,1]){
    gate.position.y=.1+open*4.7;art.update();gate.updateMatrixWorld(true);frame.updateMatrixWorld(true);
    const box=new THREE.Box3().setFromObject(gate);assert.ok(box.min.y>=gate.position.y-.001);assert.ok(box.min.x>=-5.7&&box.max.x<=5.7);assert.ok(box.max.z-box.min.z<.7,'thick rails stay within the old gate passage');
    assert.ok(chain.count>0&&chain.count<=80);if(priorCount)assert.ok(chain.count<=priorCount,'lifting the gate shortens the exposed chain');priorCount=chain.count;
    for(let i=0;i<chain.count;i++){chain.getMatrixAt(i,matrix);p.setFromMatrixPosition(matrix);assert.ok(p.y>=gate.userData.chainBottom&&p.y<=gate.userData.chainTop);assert.ok(Math.abs(Math.abs(p.x)-3.93)<1e-5);}
    const version=chain.instanceMatrix.version;art.update();assert.equal(chain.instanceMatrix.version,version,'stationary gates do not rewrite chain matrices');
  }
  gate.visible=false;art.update();assert.equal(chain.parent.visible,false,'broken portcullis also removes its suspended chain');assert.equal(frame.visible,true,'the fixed supports remain architectural detail');art.dispose();
});

test('well walls have real inward facing masonry from every direction and an open water shaft',()=>{
  const art=createWellArtwork(),root=art.root;root.updateMatrixWorld(true);const ray=new THREE.Raycaster();
  for(const height of [.18,.60,.96,1.20])for(let i=0;i<24;i++){
    const angle=i/24*Math.PI*2,dir=new THREE.Vector3(Math.cos(angle),0,Math.sin(angle));ray.set(new THREE.Vector3(8,height,-4),dir);
    const hits=ray.intersectObject(root,true).filter(h=>/stone|mortar/.test(h.object.material.name));
    assert.ok(hits.length>0,`inside wall visible at y=${height}, angle=${angle}`);assert.ok(hits[0].distance>1&&hits[0].distance<1.18,'inner masonry is a thick shaft, not an invisible outer cylinder');
    assert.ok(hits[0].face.normal.dot(dir)<-.6,'inner face normals point into the shaft for ordinary front-face rendering');
  }
  ray.set(new THREE.Vector3(8.65,2,-3.8),new THREE.Vector3(0,-1,0));const hit=ray.intersectObject(root,true)[0];assert.equal(hit.object.material.name,'well-water','the coping leaves the center open');assert.ok(Math.abs(hit.point.y-.055)<1e-5);
  ray.set(new THREE.Vector3(9.32,2,-4.4),new THREE.Vector3(0,-1,0));const rim=ray.intersectObject(root,true)[0];assert.equal(rim.object.material.name,'coping-stone');assert.ok(rim.point.y>1.30&&rim.point.y<1.35,'thick coping has a real top surface');art.dispose();
});

test('gate fittings and well masonry are batched, finite and inexpensive to draw',()=>{
  const gate=createGateArtwork(),well=createWellArtwork();const g=cost(gate.gate),f=cost(gate.frame),w=cost(well.root);
  assert.ok(g.calls+f.calls<=12,JSON.stringify({g,f}));assert.ok(w.calls<=15,JSON.stringify(w));assert.ok(g.triangles+f.triangles<40000,JSON.stringify({g,f}));assert.ok(w.triangles<40000,JSON.stringify(w));
  for(const root of [gate.gate,gate.frame,well.root])for(const mesh of parts(root)){
    for(const a of Object.values(mesh.geometry.attributes))assert.ok(a.array.every(Number.isFinite));
    if(mesh.geometry.index)assert.ok(mesh.geometry.index.array.every(i=>i<mesh.geometry.attributes.position.count));
    assert.equal(mesh.material.side,THREE.FrontSide,'inside walls are modeled rather than hidden by double-sided shading');
  }
  gate.dispose();well.dispose();
});

test('landmark disposal is idempotent and does not destroy a second village model',()=>{
  const first=createGateArtwork(),second=createGateArtwork(),well=createWellArtwork();let disposed=0;
  const resources=new Set([...parts(first.gate),...parts(first.frame),...parts(well.root)].flatMap(m=>[m.geometry,m.material,m.material.bumpMap]).filter(Boolean));
  for(const item of resources)item.addEventListener('dispose',()=>disposed++);
  first.dispose();well.dispose();assert.equal(disposed,resources.size);first.dispose();well.dispose();assert.equal(disposed,resources.size);
  second.gate.position.y=.1;second.update();assert.ok(parts(second.gate).every(m=>m.geometry.attributes.position.count>0));second.dispose();
});
