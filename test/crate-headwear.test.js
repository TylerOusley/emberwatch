import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {buildHead} from '../public/src/character-head.js';
import {createHeadwear} from '../public/src/crate-headwear.js';

const IDS=['padded_cap','iron_coif','runed_helm','dawnsteel_helm','sunforged_viking_helm'];
const ROLES=['villager','guard','priest'];
const OLD_COVERS=new Set([
  'swept grooved scalp hair','soft stitched leather cap',
  'forged helmet and cheek protection','rolled helmet edge',
  'draped linen hood','cloth opening seam'
]);
const renderables=root=>{const result=[];root.traverse(object=>{if(object.isMesh||object.isPoints)result.push(object);});return result;};
const materials=object=>Array.isArray(object.material)?object.material:[object.material];
const roots=appearance=>appearance.parts.map(part=>part.object);
function ownedResources(appearance){
  const result=new Set();
  for(const root of roots(appearance))for(const object of renderables(root)){
    result.add(object.geometry);
    for(const material of materials(object)){
      result.add(material);
      for(const value of Object.values(material))if(value?.isTexture)result.add(value);
    }
  }
  return result;
}
function fittedHead(id,role){
  // Fresh buildHead preserves the original scalp/role-cover names. Testing the
  // already-batched createCharacter head would miss an overlapping old hood.
  const bone=new THREE.Bone();bone.name='head';
  const own=new Set();buildHead(bone,{role,variation:1,own});
  const original=[...bone.children],appearance=createHeadwear(id);
  for(const part of appearance.parts){
    assert.equal(part.bone,'head');
    for(const object of original)if(part.hideNames.includes(object.name))object.visible=false;
    bone.add(part.object);
  }
  bone.updateMatrixWorld(true);
  return {bone,original,appearance,dispose(){appearance.dispose();for(const resource of own)resource.dispose();}};
}
function intersect(root,origin,direction){
  return new THREE.Raycaster(origin,direction,0,2).intersectObject(root,true);
}
function withDoubleSided(objects,run){
  const saved=new Map();
  for(const object of objects)for(const material of materials(object))if(!saved.has(material)){saved.set(material,material.side);material.side=THREE.DoubleSide;}
  try{return run();}finally{for(const [material,side]of saved)material.side=side;}
}
function motionSnapshot(appearance){
  const result=[];
  for(const root of roots(appearance))root.traverse(object=>{
    for(let ancestor=object;ancestor;ancestor=ancestor.parent)if(!ancestor.visible)return;
    result.push({name:object.name,visible:object.visible,position:object.position.toArray(),rotation:object.quaternion.toArray(),scale:object.scale.toArray(),vertices:object.geometry?.attributes.position?Array.from(object.geometry.attributes.position.array):null});
  });
  return result;
}

test('all five headwear pieces have finite fitted geometry and at most twelve material batches',()=>{
  for(const id of IDS){
    const appearance=createHeadwear(id);
    try{
      assert.ok(appearance.parts.length>0,`${id} provides visible parts`);
      let batches=0,vertices=0;
      for(const part of appearance.parts){
        assert.equal(part.bone,'head');assert.ok(part.object.isObject3D);
        assert.ok(Array.isArray(part.hideNames));
        for(const object of renderables(part.object)){
          const geometry=object.geometry,position=geometry.attributes.position;
          vertices+=position.count;batches+=materials(object).length;
          for(const [name,attribute]of Object.entries(geometry.attributes))assert.ok(attribute.array.every(Number.isFinite),`${id}: finite ${name}`);
          if(geometry.index)assert.ok(geometry.index.array.every(index=>index>=0&&index<position.count),`${id}: valid indices`);
          for(const material of materials(object))if(material.vertexColors)assert.equal(geometry.attributes.color?.count,position.count,`${id}: complete colors`);
          assert.ok(object.matrix.elements.every(Number.isFinite));
        }
      }
      assert.ok(vertices>100,`${id} contains authored surfaces`);
      assert.ok(batches<=12,`${id} uses ${batches} material batches`);
      appearance.update(17.3);appearance.update(Number.NaN);
      for(const root of roots(appearance))for(const object of renderables(root)){
        assert.ok(object.position.toArray().every(Number.isFinite));
        assert.ok(object.geometry.attributes.position.array.every(Number.isFinite));
      }
    }finally{appearance.dispose();}
  }
});

test('equipping each item clears old role coverings and leaves every face, eye and beard intact',()=>{
  for(const id of IDS)for(const role of ROLES){
    const fitted=fittedHead(id,role);
    try{
      const hiddenNames=new Set(fitted.appearance.parts.flatMap(part=>part.hideNames));
      assert.ok(hiddenNames.has('swept grooved scalp hair'),`${id} clears scalp hair`);
      for(const object of fitted.original){
        if(OLD_COVERS.has(object.name))assert.equal(object.visible,false,`${role}/${id}: old ${object.name} is hidden`);
        else assert.equal(object.visible,true,`${role}/${id}: ${object.name} remains visible`);
      }
      assert.equal(fitted.original.filter(object=>object.name==='almond eye surface'&&object.visible).length,2);
      assert.ok(fitted.original.some(object=>object.name==='continuous combed beard'&&object.visible));
    }finally{fitted.dispose();}
  }
});

test('headwear surrounds the actual skull without cutting through the crown in any playable role',()=>{
  for(const id of IDS)for(const role of ROLES){
    const fitted=fittedHead(id,role);
    try{
      const skull=fitted.original.find(object=>object.name==='continuous sculpted face and skull');
      const hatMeshes=roots(fitted.appearance).flatMap(renderables).filter(object=>object.isMesh);
      withDoubleSided([skull,...hatMeshes],()=>{
        for(const y of [.16,.215,.26])for(let segment=0;segment<12;segment++){
          const angle=segment/12*Math.PI*2,origin=new THREE.Vector3(0,y,-.04),direction=new THREE.Vector3(Math.sin(angle),0,Math.cos(angle));
          const skin=intersect(skull,origin,direction)[0];assert.ok(skin,'sample intersects real skull');
          const gear=new THREE.Raycaster(origin,direction,0,1).intersectObjects(hatMeshes,false)[0];
          assert.ok(gear,`${role}/${id}: missing crown coverage at y=${y}, angle=${segment}`);
          assert.ok(gear.distance>=skin.distance+.0004,`${role}/${id}: crown intersects skull at y=${y}, angle=${segment}; skin=${skin.distance}, gear=${gear.distance}`);
          assert.ok(gear.distance-skin.distance<.20,`${role}/${id}: shell sits implausibly far above the skull`);
        }
      });
    }finally{fitted.dispose();}
  }
});

test('both real eye surfaces remain visible from the front under every item and role',()=>{
  for(const id of IDS)for(const role of ROLES){
    const fitted=fittedHead(id,role);
    try{
      const hats=roots(fitted.appearance).flatMap(renderables).filter(object=>object.isMesh);
      const eyes=fitted.original.filter(object=>object.name==='almond eye surface');
      withDoubleSided([...hats,...eyes],()=>{
        for(const eye of eyes){
          eye.geometry.computeBoundingBox();const bounds=eye.geometry.boundingBox;
          for(const fraction of [.30,.50,.70]){
            const x=THREE.MathUtils.lerp(bounds.min.x,bounds.max.x,fraction),y=(bounds.min.y+bounds.max.y)/2;
            const ray=new THREE.Raycaster(new THREE.Vector3(x,y,1),new THREE.Vector3(0,0,-1),0,2);
            const visibleEye=ray.intersectObject(eye,false)[0];assert.ok(visibleEye,'sample reaches actual eye geometry');
            const helmet=ray.intersectObjects(hats,false)[0];
            assert.ok(!helmet||helmet.distance>=visibleEye.distance-.0001,`${role}/${id} obscures an eye at x=${x}`);
          }
        }
      });
    }finally{fitted.dispose();}
  }
});

test('crown surfaces and closed coif links face outward with their runtime material settings',()=>{
  for(const id of IDS){
    const appearance=createHeadwear(id);
    try{
      const meshes=roots(appearance).flatMap(renderables).filter(object=>object.userData.sculpted);
      for(const root of roots(appearance))root.updateMatrixWorld(true);
      // Do not make materials double-sided here: an inside-out shell must fail
      // from outside, even if an inner lining happens to remain visible.
      for(const y of [.16,.215,.26])for(let segment=0;segment<12;segment++){
        const angle=segment/12*Math.PI*2,outward=new THREE.Vector3(Math.sin(angle),0,Math.cos(angle));
        const origin=new THREE.Vector3(0,y,-.04).addScaledVector(outward,1);
        const hits=new THREE.Raycaster(origin,outward.clone().negate(),0,1).intersectObjects(meshes,false);
        assert.ok(hits.length>0,`${id}: missing outward face at y=${y}, angle=${segment}`);
        assert.ok(hits[0].face.normal.dot(outward)>0,`${id}: outward-facing surface normal`);
      }
      if(id==='iron_coif'){
        const links=meshes.filter(mesh=>mesh.userData.details?.includes('interwoven chain links'));
        assert.ok(links.length>0,'actual interlocking ring geometry is present');
        for(const mesh of links){
          // Signed volume of closed surfaces is positive for outward winding.
          // This checks the authored toroids without copying their parameterization.
          const g=mesh.geometry,p=g.attributes.position,index=g.index,a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
          let volume=0;
          for(let i=0;i<(index?.count??p.count);i+=3){
            a.fromBufferAttribute(p,index?index.getX(i):i);b.fromBufferAttribute(p,index?index.getX(i+1):i+1);c.fromBufferAttribute(p,index?index.getX(i+2):i+2);
            volume+=a.dot(b.cross(c))/6;
          }
          assert.ok(volume>1e-6,`${mesh.material.name}: ring exteriors have positive signed volume`);
        }
      }
    }finally{appearance.dispose();}
  }
});

test('headwear disposal is independent and idempotent, including attached parts and textures',()=>{
  for(const id of IDS){
    const first=createHeadwear(id),peer=createHeadwear(id),parent=new THREE.Bone();
    for(const root of roots(first))parent.add(root);
    const firstResources=ownedResources(first),peerResources=ownedResources(peer),disposed=new Map();
    let peerDisposed=0;
    for(const resource of firstResources){disposed.set(resource,0);resource.addEventListener('dispose',()=>disposed.set(resource,disposed.get(resource)+1));}
    for(const resource of peerResources)resource.addEventListener('dispose',()=>peerDisposed++);
    try{
      first.dispose();first.dispose();
      for(const [resource,count]of disposed)assert.equal(count,1,`${id}: owned ${resource.type??resource.constructor.name} disposed once`);
      assert.equal(peerDisposed,0,`${id}: another player keeps their headwear resources`);
      assert.equal(parent.children.length,0,`${id}: detached from the head bone`);
      peer.update(23.4);
      for(const root of roots(peer))assert.ok(renderables(root).length>0);
    }finally{peer.dispose();}
  }
});

test('legendary sparkle motion freezes when reduced motion is requested',()=>{
  const appearance=createHeadwear('sunforged_viking_helm');
  try{
    appearance.update(1);const movingA=motionSnapshot(appearance);
    appearance.update(2.7);const movingB=motionSnapshot(appearance);
    assert.notDeepEqual(movingB,movingA,'legendary sparkle geometry moves during normal playback');
    appearance.update(4,{reducedMotion:true});const stillA=motionSnapshot(appearance);
    appearance.update(40,{reducedMotion:true});const stillB=motionSnapshot(appearance);
    assert.deepEqual(stillB,stillA,'reduced motion holds sparkle positions and transforms still');
  }finally{appearance.dispose();}
});
