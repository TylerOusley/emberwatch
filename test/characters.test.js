import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCharacter } from '../public/src/characters.js';

function meshes(actor) { const result=[];actor.group.traverse(m=>{if(m.isMesh)result.push(m);});return result; }
function pose(actor, options) {
  for(let i=0;i<36;i++)actor.update(1/60,i/60,options);
  actor.group.updateMatrixWorld(true);
  for(const mesh of meshes(actor))if(mesh.isSkinnedMesh)mesh.skeleton.update();
}

test('worker clothing colors replace only that actor material and survive a role rebuild', () => {
  const first = createCharacter('villager', 2), second = createCharacter('villager', 2);
  const geometry = meshes(first).map(mesh => mesh.geometry), secondMaterials = meshes(second).map(mesh => [mesh.material, mesh.material.color?.getHexString()]);
  first.setTool('axe'); first.setClothingColor('#9772ae');
  assert.ok(meshes(first).filter(mesh => mesh.material.color?.getHexString() === '9772ae').length >= 3, 'tunic and sleeves use the chosen color');
  assert.deepEqual(meshes(second).map(mesh => [mesh.material, mesh.material.color?.getHexString()]), secondMaterials, 'nearby workers keep their own colors');
  assert.ok(geometry.filter(item => meshes(first).some(mesh => mesh.geometry === item)).length > geometry.length - 10, 'recoloring does not rebuild clothing');
  first.setClothingColor('#478d80'); assert.ok(meshes(first).some(mesh => mesh.material.color?.getHexString() === '478d80'));
  assert.equal(meshes(first).filter(mesh => mesh.material.color?.getHexString() === '9772ae').length, 0);
  first.setRole('priest'); assert.ok(meshes(first).some(mesh => mesh.material.color?.getHexString() === '478d80'));
  first.setClothingColor(undefined); assert.equal(meshes(first).filter(mesh => mesh.material.color?.getHexString() === '478d80').length, 0);
  first.dispose(); second.dispose();
});

test('sculpted actors retain valid geometry and normalized bone influences in every role',()=>{
  for(const role of ['villager','guard','priest','zombie'])for(let seed=1;seed<=4;seed++) {
    const actor=createCharacter(role,seed);
    const parts=meshes(actor);
    assert.ok(parts.some(m=>m.isSkinnedMesh),'exposed anatomy is deformable');
    for(const m of parts) {
      const g=m.geometry;
      for(const attribute of Object.values(g.attributes))assert.ok(attribute.array.every(Number.isFinite));
      if(g.index)assert.ok(g.index.array.every(i=>i<g.attributes.position.count));
      if(m.material.vertexColors)assert.equal(g.attributes.color.count,g.attributes.position.count);
      if(!m.isSkinnedMesh)continue;
      const w=g.attributes.skinWeight,ix=g.attributes.skinIndex;
      for(let i=0;i<w.count;i++) {
        const weights=[w.getX(i),w.getY(i),w.getZ(i),w.getW(i)];
        assert.ok(weights.every(v=>v>=0&&v<=1));
        assert.ok(Math.abs(weights.reduce((a,b)=>a+b,0)-1)<1e-5);
        assert.ok([ix.getX(i),ix.getY(i),ix.getZ(i),ix.getW(i)].every(v=>v<m.skeleton.bones.length));
      }
    }
    actor.dispose();
  }
});

test('deformed vertices remain finite through tool, riding, carrying and downed poses away from origin',()=>{
  for(const role of ['villager','guard','priest','zombie']) {
    const actor=createCharacter(role,3);
    actor.group.position.set(32,0,-47);actor.group.rotation.y=1.4;
    for(const options of [{moving:true,tool:'axe'},{attack:true,tool:'bow'},{channeling:true,tool:'heal'},{mounted:true},{carrying:true},{downed:true},{}]) {
      pose(actor,options);
      const bounds=new THREE.Box3();
      for(const m of meshes(actor)) {
        assert.ok(m.matrixWorld.elements.every(Number.isFinite));
        for(let i=0;i<m.geometry.attributes.position.count;i+=31) {
          const p=m.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(m.matrixWorld);
          assert.ok(p.toArray().every(Number.isFinite));bounds.expandByPoint(p);
        }
      }
      assert.ok(bounds.min.x>28&&bounds.max.x<36,'skin stays with its actor');
      assert.ok(bounds.min.z>-51&&bounds.max.z<-43,'skin is not transformed twice');
      assert.ok(bounds.getSize(new THREE.Vector3()).length()<6,'pose bounds remain bounded');
    }
    actor.dispose();
  }
});

test('role changes dispose owned skeletons while shared geometry remains usable by another actor',()=>{
  const first=createCharacter('guard',1),second=createCharacter('guard',1);
  const secondGeometry=new Set(meshes(second).map(m=>m.geometry));
  const shared=meshes(first).filter(m=>secondGeometry.has(m.geometry)).map(m=>m.geometry);
  assert.ok(shared.length>0);
  let sharedDisposed=0,skeletonDisposed=0;
  const onDispose=()=>sharedDisposed++;
  for(const g of shared)g.addEventListener('dispose',onDispose);
  const skeletons=new Set(meshes(first).filter(m=>m.isSkinnedMesh).map(m=>m.skeleton));
  for(const skeleton of skeletons) {
    const dispose=skeleton.dispose.bind(skeleton);
    skeleton.dispose=()=>{skeletonDisposed++;dispose();};
  }
  first.setRole('priest');
  assert.equal(skeletonDisposed,skeletons.size);
  assert.equal(sharedDisposed,0);
  first.dispose();first.dispose();
  assert.equal(skeletonDisposed,skeletons.size);
  pose(second,{attack:true,tool:{id:'sword',tier:3}});
  assert.ok(meshes(second).every(m=>m.matrixWorld.elements.every(Number.isFinite)));
  second.dispose();
  assert.equal(sharedDisposed,0);
  for(const g of shared)g.removeEventListener('dispose',onDispose);
});
