import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

const threeURL=new URL('../node_modules/three/build/three.module.js',import.meta.url).href;
const sharedURL=new URL('../shared/world.js',import.meta.url).href;
const moduleURL=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const plots=readFileSync(new URL('../public/src/plots-world.js',import.meta.url),'utf8').replace("'three'",JSON.stringify(threeURL)).replace("'/shared/world.js'",JSON.stringify(sharedURL)).replace("'./surface-materials.js'",JSON.stringify(new URL('../public/src/surface-materials.js',import.meta.url).href)).replace("'./environment-geometry.js'",JSON.stringify(new URL('../public/src/environment-geometry.js',import.meta.url).href));
const worldSource=readFileSync(new URL('../public/src/world.js',import.meta.url),'utf8').replace("'three'",JSON.stringify(threeURL)).replace("'/shared/world.js'",JSON.stringify(sharedURL)).replace("'./plots-world.js'",JSON.stringify(moduleURL(plots))).replace("'./surface-materials.js'",JSON.stringify(new URL('../public/src/surface-materials.js',import.meta.url).href)).replace("'./environment-geometry.js'",JSON.stringify(new URL('../public/src/environment-geometry.js',import.meta.url).href));
const {createRoadEdging,createWorld}=await import(moduleURL(worldSource));

// Straight road fixtures use four explicit surface corners, so these checks
// exercise rendered pavement footprints independently of the curb algorithm.
function lane(x1,z1,x2,z2,width){
  const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(x1,0,z1),new THREE.Vector3(x2,0,z2)],false,'centripetal');
  const dx=x2-x1,dz=z2-z1,length=Math.hypot(dx,dz),nx=dz/length*width/2,nz=-dx/length*width/2;
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([x1+nx,0,z1+nz,x1-nx,0,z1-nz,x2+nx,0,z2+nz,x2-nx,0,z2-nz],3));
  geometry.setIndex([0,1,2,1,3,2]);
  return {curve,width,geometry};
}
const near=(a,b,tolerance=.02)=>Math.abs(a-b)<tolerance;

test('T junction removes edging across its mouth and keeps the opposite roadside intact',()=>{
  const edges=createRoadEdging([lane(0,-12,0,12,4),lane(0,0,10,0,3)]);
  assert.ok(!edges.some(e=>e.owner===0&&e.x>0&&Math.abs(e.z)<1.5+.44));
  assert.ok(edges.some(e=>e.owner===0&&e.x<0&&Math.abs(e.z)<1));
  assert.ok(!edges.some(e=>e.owner===1&&e.x<2+.44));
  assert.ok(edges.some(e=>e.owner===1&&e.x>4));
});

test('crossroads have clear openings on all four approaches',()=>{
  const edges=createRoadEdging([lane(0,-12,0,12,4),lane(-12,0,12,0,4)]);
  for(const edge of edges){
    if(edge.owner===0)assert.ok(Math.abs(edge.z)>2+.44-1e-5);
    else assert.ok(Math.abs(edge.x)>2+.44-1e-5);
  }
  for(const owner of [0,1])for(const side of [-1,1])assert.ok(edges.some(e=>e.owner===owner&&e.side===side));
});

test('parallel overlaps retain one exposed boundary, while wider roads hide inner curbs',()=>{
  const a=lane(0,-12,0,12,4),b=lane(0,-6,0,18,4);
  const isolated=createRoadEdging([a]);
  const overlap=createRoadEdging([a,b]);
  for(const edge of isolated)assert.ok(overlap.some(other=>near(edge.x,other.x)&&near(edge.z,other.z)));
  assert.ok(overlap.some(e=>e.z>13),'the extension still has roadside edging');
  const wide=createRoadEdging([a,lane(0,-12,0,12,7)]);
  assert.ok(wide.every(e=>Math.abs(e.x)>3.5),'there is no narrower curb running inside the wide road');
  // Reversing a duplicate road must not double its stone count or erase both.
  const reversed=createRoadEdging([a,lane(0,12,0,-12,4)]);
  assert.equal(reversed.filter(e=>Math.abs(e.z)<11).length,isolated.filter(e=>Math.abs(e.z)<11).length);
  for(const [index,edge] of reversed.entries())assert.ok(!reversed.slice(index+1).some(other=>near(edge.x,other.x)&&Math.abs(edge.z-other.z)<.879));
});

test('a paved square clears intersecting roadside stones but leaves distant edging',()=>{
  const geometry=new THREE.CircleGeometry(5,20),square=new THREE.Mesh(geometry);
  square.rotation.x=-Math.PI/2;square.updateMatrix();
  const edges=createRoadEdging([lane(0,-12,0,12,3)],[square]);
  assert.ok(!edges.some(e=>Math.abs(e.z)<4));
  assert.ok(edges.some(e=>Math.abs(e.z)>7));
});

test('the actual village mesh has open street and plot-access junctions',()=>{
  const previousDocument=globalThis.document;
  globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>new Proxy({},{get:()=>()=>{},set:()=>true})})};
  try{
    const scene=new THREE.Scene();createWorld(scene);
    const matrix=new THREE.Matrix4(),position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3(),curbs=[];
    scene.traverse(object=>{
      if(!object.isInstancedMesh)return;
      for(let i=0;i<object.count;i++){
        object.getMatrixAt(i,matrix);matrix.decompose(position,rotation,scale);
        if(near(scale.x,.38,.0001)&&near(scale.y,.13,.0001)&&near(scale.z,.88,.0001)&&near(position.y,.045,.0001))curbs.push({x:position.x,z:position.z});
      }
    });
    assert.ok(curbs.length>1500,'exposed edges remain throughout the full map');
    assert.ok(!curbs.some(e=>near(e.x,3.68)&&Math.abs(e.z-7)<1.7),'food-stand junction');
    assert.ok(!curbs.some(e=>near(e.x,-3.68)&&Math.abs(e.z-8)<1.7),'tool-shop junction');
    assert.ok(!curbs.some(e=>near(e.x,40.78)&&Math.abs(e.z-3)<1.25),'west-facing plot entrance on the east street');
    assert.ok(!curbs.some(e=>Math.hypot(e.x,e.z+66)<7.5),'market square interior');
    assert.ok(curbs.some(e=>near(e.x,37.22)&&e.z<-5&&e.z>-10),'uninterrupted neighborhood edge');
  }finally{globalThis.document=previousDocument;}
});
