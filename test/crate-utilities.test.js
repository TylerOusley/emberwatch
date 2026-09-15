import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createUtility } from '../public/src/crate-utilities.js';
import { createCharacter } from '../public/src/characters.js';

const IDS=['foragers_pouch','miners_buckle','deep_delvers_belt','mining_pack','lumber_pack'];
const PACKS=new Set(['mining_pack','lumber_pack']);
const meshes=utility=>utility.parts.flatMap(({object})=>{const result=[];object.traverse(node=>{if(node.isMesh)result.push(node);});return result;});
const materials=mesh=>Array.isArray(mesh.material)?mesh.material:[mesh.material];
function resources(utility) {
  return new Set(meshes(utility).flatMap(mesh=>[mesh.geometry,...materials(mesh),...materials(mesh).flatMap(material=>Object.values(material).filter(value=>value?.isTexture))]));
}
function allocationSnapshot(utility) {
  return meshes(utility).map(mesh=>({mesh,geometry:mesh.geometry,materials:materials(mesh),index:mesh.geometry.index,indexArray:mesh.geometry.index?.array,attributes:Object.fromEntries(Object.entries(mesh.geometry.attributes).map(([name,attribute])=>[name,[attribute,attribute.array]]))}));
}
function assertSameAllocations(utility,before) {
  const after=meshes(utility);assert.equal(after.length,before.length,'updates retain merged draw meshes');
  before.forEach((prior,index)=>{
    assert.equal(after[index],prior.mesh);assert.equal(after[index].geometry,prior.geometry);assert.equal(materials(after[index]).length,prior.materials.length);materials(after[index]).forEach((material,i)=>assert.equal(material,prior.materials[i]));
    assert.equal(prior.geometry.index,prior.index);assert.equal(prior.geometry.index?.array,prior.indexArray);
    assert.deepEqual(Object.keys(prior.geometry.attributes),Object.keys(prior.attributes));
    for(const [name,[attribute,array]] of Object.entries(prior.attributes)){assert.equal(prior.geometry.attributes[name],attribute);assert.equal(attribute.array,array,'tier changes reuse vertex buffers');}
  });
}
function layout(utility) {
  const result=[];
  for(const {object} of utility.parts)object.traverse(node=>{node.updateMatrix();result.push({name:node.name,visible:node.visible,matrix:[...node.matrix.elements]});});
  return result;
}

test('crate utilities accept only their five known IDs and declare fitted torso attachments',()=>{
  for(const id of ['','unknown','__proto__','constructor','toString',null,undefined,42,{},'<script>'])assert.equal(createUtility(id),null);
  for(const id of IDS){
    const utility=createUtility(id);
    try{
      assert.ok(utility.parts.length>0,`${id} has visible attachment parts`);
      assert.equal(typeof utility.setBackpackTier,'function');assert.equal(typeof utility.update,'function');assert.equal(typeof utility.dispose,'function');
      for(const part of utility.parts){
        assert.equal(part.bone,'body');assert.ok(part.object instanceof THREE.Group);assert.equal(part.object.parent,null,'factory does not mutate a scene');
        if(PACKS.has(id))assert.deepEqual(part.hideNames,['worn-backpack'],'specialty packs replace the ordinary pack silhouette');
        else assert.ok(!part.hideNames?.includes('worn-backpack'),'small accessories retain the equipped backpack');
      }
    }finally{utility.dispose();}
  }
});

test('utility geometry is finite, indexed correctly, normalised and bounded to the dwarf torso',()=>{
  for(const id of IDS){
    const utility=createUtility(id);
    try{
      const drawMeshes=meshes(utility),allMaterials=new Set(drawMeshes.flatMap(materials));
      const drawCalls=drawMeshes.reduce((sum,mesh)=>sum+(Array.isArray(mesh.material)?Math.max(1,mesh.geometry.groups.length):1),0);
      assert.ok(drawMeshes.length>0&&drawMeshes.length<=12,`${id}: ${drawMeshes.length} meshes`);
      assert.ok(allMaterials.size<=12&&drawCalls<=12,`${id}: ${drawCalls} draw calls / ${allMaterials.size} materials`);
      for(const tier of [0,1,2,3]){
        utility.setBackpackTier(tier);
        const bounds=new THREE.Box3();
        for(const {object} of utility.parts){object.updateMatrixWorld(true);bounds.union(new THREE.Box3().setFromObject(object));}
        assert.ok(!bounds.isEmpty());
        assert.ok(bounds.min.x>=-.65001&&bounds.max.x<=.65001,`${id} horizontal torso fit: ${bounds.min.x}..${bounds.max.x}`);
        assert.ok(bounds.min.y>=-.70001&&bounds.max.y<=.65001,`${id} hip/shoulder fit: ${bounds.min.y}..${bounds.max.y}`);
        assert.ok(bounds.min.z>=-1.00001&&bounds.max.z<=.50001,`${id} front/back torso fit: ${bounds.min.z}..${bounds.max.z}`);
      }
      for(const mesh of drawMeshes){
        const g=mesh.geometry,p=g.attributes.position,n=g.attributes.normal;
        assert.ok(p?.count>0&&n?.count===p.count,`${id} has position and normal data`);
        for(const attribute of Object.values(g.attributes))assert.ok(attribute.array.every(Number.isFinite),`${id} finite vertex attributes`);
        assert.equal((g.index?.count??p.count)%3,0,`${id} complete triangles`);
        if(g.index)assert.ok(g.index.array.every(i=>Number.isInteger(i)&&i>=0&&i<p.count),`${id} valid triangle indices`);
        for(let i=0;i<n.count;i++){
          const lengthSq=n.getX(i)**2+n.getY(i)**2+n.getZ(i)**2;
          assert.ok(Math.abs(lengthSq-1)<.03,`${id} usable unit normal ${i}: ${lengthSq}`);
        }
        assert.ok(mesh.matrixWorld.elements.every(Number.isFinite));
      }
    }finally{utility.dispose();}
  }
});

test('tier changes sanitize invalid tiers and reuse all mesh, geometry and material allocations',()=>{
  for(const id of IDS){
    const utility=createUtility(id),baseline=createUtility(id),before=allocationSnapshot(utility);
    try{
      baseline.setBackpackTier(0);baseline.update(0,{});const zero=layout(baseline);
      for(const tier of [0,1,2,3,3,2,0]){utility.setBackpackTier(tier);utility.update(0,{});assertSameAllocations(utility,before);}
      for(const invalid of [-1,4,1.5,'3',null,undefined,NaN,Infinity]){
        utility.setBackpackTier(3);utility.setBackpackTier(invalid);utility.update(0,{});
        assert.deepEqual(layout(utility),zero,`${id}: invalid tier ${String(invalid)} resolves to the tier-zero appearance`);
        assertSameAllocations(utility,before);
      }
      for(let frame=0;frame<25;frame++){utility.update(frame/30,{moving:true,mounted:frame%2===0});assertSameAllocations(utility,before);}
    }finally{utility.dispose();baseline.dispose();}
  }
});

test('utility instances own their resources and dispose exactly once without affecting neighbours',()=>{
  for(const id of IDS){
    const first=createUtility(id),second=createUtility(id),scene=new THREE.Group();
    const owned=resources(first),neighbour=resources(second),counts=new Map([...owned].map(resource=>[resource,0]));
    const secondBefore=allocationSnapshot(second);let neighbourDisposals=0;
    for(const resource of owned){assert.ok(!neighbour.has(resource),`${id} does not share disposable resources across instances`);resource.addEventListener('dispose',()=>counts.set(resource,counts.get(resource)+1));}
    for(const resource of neighbour)resource.addEventListener('dispose',()=>neighbourDisposals++);
    for(const {object} of [...first.parts,...second.parts])scene.add(object);
    first.dispose();
    assert.ok(first.parts.every(({object})=>object.parent===null),'disposal detaches every attachment root');
    assert.ok([...counts.values()].every(count=>count===1),'each owned material, geometry and texture is disposed once');
    const disposedLayout=layout(first);
    first.dispose();first.setBackpackTier(3);first.update(25,{moving:true});first.update(NaN,null);
    assert.deepEqual(layout(first),disposedLayout,'calls after disposal have no side effects');
    assert.ok([...counts.values()].every(count=>count===1));assert.equal(neighbourDisposals,0);
    second.setBackpackTier(2);second.update(.5,{moving:true});assertSameAllocations(second,secondBefore);
    assert.ok(second.parts.every(({object})=>object.parent===scene),'neighbour stays mounted');
    second.dispose();second.dispose();assert.equal(neighbourDisposals,neighbour.size);assert.equal(scene.children.length,0);
  }
});

test('specialty packs stay mounted through a real dwarf’s gait, riding and downed poses',()=>{
  for(const id of PACKS){
    const actor=createCharacter('guard',1),utility=createUtility(id);
    actor.group.position.set(18,0,-31);actor.group.rotation.y=1.1;actor.setBackpackTier(2);
    const body=actor.group.getObjectByName('body'),normalPack=actor.group.getObjectByName('worn-backpack');
    assert.ok(body&&normalPack);const normalParent=normalPack.parent;
    for(const part of utility.parts)body.add(part.object);
    const before=allocationSnapshot(utility);
    try{
      for(const pose of [{moving:true},{mounted:true},{downed:true},{carrying:true},{}]){
        for(let frame=0;frame<10;frame++){actor.update(1/60,frame/60,{...pose,backpackTier:2});utility.update(frame/60,pose);}
        actor.group.updateMatrixWorld(true);
        assertSameAllocations(utility,before);
        for(const part of utility.parts){
          assert.equal(part.object.parent,body);assert.equal(part.object.visible,true);
          const relative=new THREE.Matrix4().copy(body.matrixWorld).invert().multiply(part.object.matrixWorld);
          assert.ok(relative.elements.every((value,i)=>Math.abs(value-part.object.matrix.elements[i])<1e-8),'utility follows body-space motion without a world-space offset');
        }
        assert.ok(meshes(utility).every(mesh=>mesh.matrixWorld.elements.every(Number.isFinite)));
        assert.equal(normalPack.parent,normalParent,'decorative factory does not detach normal equipment itself');
      }
      utility.dispose();assert.ok(utility.parts.every(({object})=>object.parent===null));assert.equal(normalPack.parent,normalParent);
    }finally{utility.dispose();actor.dispose();}
  }
});
