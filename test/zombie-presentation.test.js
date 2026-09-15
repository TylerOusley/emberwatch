import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ENEMY_TYPES } from '../shared/enemies.js';
import { createZombiePresentation } from '../public/src/zombie-presentation.js';
const entity=(kind,overrides={})=>({id:`test-${kind}`,kind,x:30,z:45,hp:100,spawnAt:10,emergeUntil:12.2,birth:'grave',...overrides});
const meshList=actor=>{const m=[];actor.group.traverse(n=>{if(n.isMesh)m.push(n);});return m;};
function pose(actor,e,time,dt=1/60,options={}){actor.updateFromState(e,time,dt,options);actor.group.updateMatrixWorld(true);actor.group.traverse(n=>{if(n.isSkinnedMesh)n.skeleton.update();});}
function bounds(actor){const b=new THREE.Box3();for(const m of meshList(actor)){if(m.name==='rising-soil'||m.name==='disturbed-grave'||m.name==='enemy-attack-warning')continue;for(let i=0;i<m.geometry.attributes.position.count;i+=7)b.expandByPoint(m.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(m.matrixWorld));}return b;}

test('all six enemy silhouettes retain the sculpted skin rig and finite bounded geometry',()=>{
  const heights={};
  for(const kind of Object.keys(ENEMY_TYPES)){
    const e=entity(kind),a=createZombiePresentation(e,2);a.group.position.set(e.x,0,e.z);a.group.rotation.y=.72;
    for(let i=0;i<60;i++)pose(a,e,20+i/60,1/60,{moving:true,speed:ENEMY_TYPES[kind].speed});
    const meshes=meshList(a);assert.ok(meshes.some(m=>m.isSkinnedMesh),'new silhouettes keep articulated anatomy');
    for(const m of meshes){for(const attr of Object.values(m.geometry.attributes))assert.ok(attr.array.every(Number.isFinite));assert.ok(m.matrixWorld.elements.every(Number.isFinite));}
    const box=bounds(a),size=box.getSize(new THREE.Vector3());heights[kind]=size.y;
    assert.ok(size.y>.6&&size.y<5.4);assert.ok(size.x<4&&size.z<4);assert.ok(box.min.x>26&&box.max.x<34,'skin remains attached away from the origin');
    if(kind==='armored')assert.ok(a.group.getObjectByName('rusted-breastplate'));
    if(kind==='siege')assert.ok(a.group.getObjectByName('carried-gravestone'));
    if(kind==='runner')assert.ok(a.group.getObjectByName('red-neck-wrap'));
    if(kind==='splitter')assert.ok(a.group.getObjectByName('torn-brood-mantle'));
    assert.equal(a.label,ENEMY_TYPES[kind].label);a.dispose();
  }
  assert.ok(heights.siege>heights.shambler*1.55);assert.ok(heights.splitter>heights.shambler*1.25);assert.ok(heights.splinter<heights.shambler*.65);
});

test('grave emergence comes from authoritative progress and late joins never replay it',()=>{
  const e=entity('shambler'),a=createZombiePresentation(e,3),base=a.group.getObjectByName('zombie-character');
  pose(a,e,10);assert.ok(base.position.y<-2,'actor starts underneath the opaque ground');assert.equal(a.group.userData.emergenceProgress,0);
  pose(a,e,11.1);assert.ok(base.position.y<-.8&&base.position.y>-2);assert.equal(a.group.getObjectByName('enemy-ground-effects').visible,true);
  assert.ok(a.group.getObjectByName('leftArm').rotation.x<-1,'a hand reaches up before the torso straightens');
  const midpoint=base.position.y;pose(a,e,11.1,.1);assert.equal(base.position.y,midpoint,'paused village time does not advance emergence');
  const joined=createZombiePresentation(e,3);pose(joined,e,11.1);assert.equal(joined.group.getObjectByName('zombie-character').position.y,midpoint,'late join begins at the same burial depth');
  pose(a,e,12.2);assert.equal(a.group.getObjectByName('enemy-ground-effects').visible,false);assert.ok(base.position.y>-.1);
  pose(joined,e,400);assert.equal(joined.group.getObjectByName('enemy-ground-effects').visible,false,'completed spawn is never replayed');
  a.dispose();joined.dispose();
});

test('split offspring burst above ground and settle without grave replay',()=>{
  const e=entity('splinter',{birth:'split',spawnAt:20,emergeUntil:20.65}),a=createZombiePresentation(e,4),base=a.group.getObjectByName('zombie-character');
  pose(a,e,20);const initialScale=base.scale.y;assert.equal(base.position.y,0);
  pose(a,e,20.325);assert.ok(base.position.y>.15);assert.ok(base.scale.y>initialScale);assert.ok(a.group.getObjectByName('enemy-ground-effects').visible);
  pose(a,e,21);assert.equal(a.group.getObjectByName('enemy-ground-effects').visible,false);assert.ok(base.scale.y>initialScale*1.5);a.dispose();
});

test('siege windup warns at the fixed server contact and clears on cancellation',()=>{
  const e=entity('siege',{windupStartedAt:30,windupUntil:31.65,windupX:0,windupZ:18,windupRadius:3.2}),a=createZombiePresentation(e,5);
  a.group.position.set(2,0,20);a.group.rotation.y=1.4;pose(a,e,31);
  const marker=a.group.getObjectByName('enemy-attack-warning'),p=marker.getWorldPosition(new THREE.Vector3());
  assert.ok(marker.visible);assert.equal(marker.scale.x,3.2);assert.ok(Math.hypot(p.x,p.z-18)<1e-5,'ring follows structure contact despite actor yaw/position');
  assert.ok(a.group.getObjectByName('leftArm').rotation.x<-1.5,'both arms visibly raise during windup');
  pose(a,{...e,windupUntil:null,windupStartedAt:null},31.1);assert.equal(marker.visible,false,'a cancelled attack immediately removes the footprint');
  pose(a,{...e,windupUntil:null,windupStartedAt:null,lastSlamAt:32,lastSlamX:0,lastSlamZ:18,lastSlamRadius:3.2},32.1);assert.ok(marker.visible,'short impact pulse follows the confirmed server slam');
  pose(a,{...e,windupUntil:null,lastSlamAt:32},33);assert.equal(marker.visible,false);a.dispose();
});

test('running and hulking overlays do not accumulate joint errors or sink supporting feet',()=>{
  for(const kind of ['runner','splinter','splitter','siege']){
    const e=entity(kind),a=createZombiePresentation(e,6);a.group.position.set(-20,0,50);
    for(let i=0;i<240;i++){
      pose(a,e,50+i/60,1/60,{moving:i<180,speed:ENEMY_TYPES[kind].speed});
      let lowest=Infinity;for(const name of ['leftFoot','rightFoot'])for(const x of [-.14,.14])for(const z of [-.135,.316])lowest=Math.min(lowest,new THREE.Vector3(x,-.152,z).applyMatrix4(a.group.getObjectByName(name).matrixWorld).y);
      assert.ok(lowest>-.001&&lowest<.035,'cosmetic proportion and posture changes keep a foot grounded');
      for(const name of ['body','leftArm','rightArm','leftLeg','rightLeg'])assert.ok(a.group.getObjectByName(name).rotation.toArray().slice(0,3).every(n=>Math.abs(n)<3.2),'additive rotation remains bounded');
    }
    a.dispose();
  }
});

test('disposing one enemy releases its effects once and preserves another actor sharing fittings',()=>{
  const e=entity('armored'),a=createZombiePresentation(e,1),b=createZombiePresentation(e,1);
  const fitting=a.group.getObjectByName('rusted-breastplate').geometry;
  assert.equal(fitting,b.group.getObjectByName('rusted-breastplate').geometry);
  let fittingDisposed=0,dustDisposed=0;fitting.addEventListener('dispose',()=>fittingDisposed++);
  a.group.getObjectByName('grave-dust').geometry.addEventListener('dispose',()=>dustDisposed++);
  a.dispose();a.dispose();assert.equal(fittingDisposed,0);assert.equal(dustDisposed,1);
  pose(b,e,20);assert.ok(meshList(b).every(m=>m.matrixWorld.elements.every(Number.isFinite)));
  b.dispose();assert.equal(fittingDisposed,1);
});


test('every zombie attack shows a fixed faint footprint with the actual server radius',()=>{
  for(const [kind,type]of Object.entries(ENEMY_TYPES)){
    const e=entity(kind,{windupStartedAt:30,windupUntil:31,windupX:7,windupZ:9,windupRadius:.85+type.scale});
    const a=createZombiePresentation(e,8);a.group.position.set(6,0,10);a.group.rotation.y=.7;pose(a,e,30.5);
    const outline=a.group.getObjectByName('enemy-attack-warning'),fill=a.group.getObjectByName('enemy-attack-footprint');
    assert.ok(outline.visible&&fill.visible);assert.equal(outline.scale.x,e.windupRadius);assert.equal(fill.scale.x,e.windupRadius);assert.ok(fill.material.opacity>.03&&fill.material.opacity<.12,'ground remains visible through a faint red fill');
    a.group.position.x+=.15;a.group.rotation.y=1;pose(a,e,30.8);const p=outline.getWorldPosition(new THREE.Vector3());assert.ok(Math.hypot(p.x-7,p.z-9)<1e-5,'network smoothing does not drag the committed hit area');
    pose(a,{...e,windupUntil:null,lastSlamAt:31,lastSlamX:7,lastSlamZ:9,lastSlamRadius:e.windupRadius},31.1);assert.equal(outline.scale.x,e.windupRadius,'impact never claims damage beyond the real hit area');assert.ok(a.group.getObjectByName('enemy-ground-effects').visible);
    pose(a,{...e,windupUntil:null,lastSlamAt:31},32);assert.equal(outline.visible,false);assert.equal(a.group.getObjectByName('enemy-ground-effects').visible,false);pose(a,{...e,hp:0},30.7);assert.equal(outline.visible,false,'death cancels the advertised attack');a.dispose();
  }
});

test('warning, footprint and confirmed impact dust use the target floor height on a cave ramp', async () => {
  const { groundHeight } = await import('../shared/world.js');
  for (const kind of ['shambler', 'siege']) {
    const e = entity(kind, { x: 0, z: -130, windupStartedAt: 30, windupUntil: 31, windupX: 0, windupZ: -136, windupRadius: 1.5 });
    const a = createZombiePresentation(e, 12);a.group.position.set(e.x, groundHeight(e.x, e.z), e.z);a.group.rotation.y = 1.1;pose(a, e, 30.5);
    const outline = a.group.getObjectByName('enemy-attack-warning'), fill = a.group.getObjectByName('enemy-attack-footprint');
    const targetHeight = groundHeight(e.windupX, e.windupZ);
    assert.notEqual(targetHeight, a.group.position.y, 'target and attacker occupy different ramp heights');
    assert.ok(Math.abs(outline.getWorldPosition(new THREE.Vector3()).y - targetHeight - .035) < 1e-8);
    assert.ok(Math.abs(fill.getWorldPosition(new THREE.Vector3()).y - targetHeight - .030) < 1e-8);
    const hit = { ...e, windupUntil: null, lastSlamAt: 31, lastSlamX: e.windupX, lastSlamZ: e.windupZ, lastSlamRadius: 1.5 };
    pose(a, hit, 31.1);
    const effects = a.group.getObjectByName('enemy-ground-effects'), center = effects.getWorldPosition(new THREE.Vector3());
    assert.ok(Math.abs(center.x - e.windupX) < 1e-8 && Math.abs(center.z - e.windupZ) < 1e-8);
    assert.ok(Math.abs(center.y - targetHeight) < 1e-8, 'impact dust rises from the target floor');
    a.dispose();
  }
});

test('the entire warning outline and fill conform to ramps and landing breaks without changing the hit radius', async () => {
  const { groundHeight } = await import('../shared/world.js');
  const radius = 3.2;
  for (const target of [{ x: 9, z: -168 }, { x: 4, z: -198 }, { x: 9, z: -162 }, { x: 9, z: -174 }, { x: 4, z: -193 }, { x: 4, z: -207 }]) {
    const e = entity('siege', { x: target.x, z: target.z + 1, windupStartedAt: 30, windupUntil: 31, windupX: target.x, windupZ: target.z, windupRadius: radius });
    const actor = createZombiePresentation(e, 31);actor.group.position.set(e.x, groundHeight(e.x, e.z), e.z);actor.group.rotation.y = 1.13;pose(actor, e, 30.5);
    const meshes = [['enemy-attack-warning', .035], ['enemy-attack-footprint', .030]];
    for (const [name, offset] of meshes) {
      const mesh = actor.group.getObjectByName(name), geometry = mesh.geometry, attribute = geometry.attributes.position;
      const points = Array.from({ length: attribute.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(attribute, i).applyMatrix4(mesh.matrixWorld));
      for (const point of points) {
        const r = Math.hypot(point.x - target.x, point.z - target.z);
        assert.ok(r <= radius + 1e-6, 'height correction never expands the advertised hit area');
        if(name === 'enemy-attack-warning')assert.ok(r >= radius * .97, 'outline remains on the true circle rim');
        assert.ok(Math.abs(point.y - groundHeight(point.x, point.z) - offset) < 2e-6, `${name} vertex stays above its own floor`);
      }
      // A flat fan with raised rim vertices can still cut through a landing.
      // Sample inside every triangle as well as checking the circumference.
      const index = geometry.index;
      for (let i = 0; i < index.count; i += 3) {
        const a=points[index.getX(i)],b=points[index.getX(i+1)],c=points[index.getX(i+2)];
        for (const weights of [[1/3,1/3,1/3],[.1,.4,.5]]) {
          const point = new THREE.Vector3().addScaledVector(a,weights[0]).addScaledVector(b,weights[1]).addScaledVector(c,weights[2]);
          assert.ok(Math.abs(point.y - groundHeight(point.x, point.z) - offset) < 2e-6, `${name} triangle does not disappear into a ramp/landing seam`);
        }
      }
    }
    const ring = actor.group.getObjectByName('enemy-attack-warning'), terrain = ring.geometry;
    actor.group.rotation.y = -2.24;actor.group.position.x += .17;pose(actor,e,30.7);
    assert.equal(ring.geometry, terrain, 'changing attacker yaw/position reuses the committed terrain mesh');
    actor.dispose();
  }
});

test('terrain warning geometry is private, restores pooled flat meshes, and is disposed exactly once', async () => {
  const { groundHeight } = await import('../shared/world.js');
  const flat = entity('shambler', { windupStartedAt: 30, windupUntil: 31, windupX: 0, windupZ: 10, windupRadius: 1.45 });
  const first = createZombiePresentation(flat, 42), second = createZombiePresentation(flat, 43);
  pose(first,flat,30.2);pose(second,flat,30.2);
  const firstRing=first.group.getObjectByName('enemy-attack-warning'),secondRing=second.group.getObjectByName('enemy-attack-warning');
  const firstFill=first.group.getObjectByName('enemy-attack-footprint'),secondFill=second.group.getObjectByName('enemy-attack-footprint');
  const pooledRing=firstRing.geometry,pooledFill=firstFill.geometry,flatRing=Array.from(pooledRing.attributes.position.array),flatFill=Array.from(pooledFill.attributes.position.array);
  assert.equal(secondRing.geometry,pooledRing);assert.equal(secondFill.geometry,pooledFill);
  const rampA={...flat,windupX:9,windupZ:-168,windupRadius:3.2},rampB={...flat,windupX:4,windupZ:-198,windupRadius:2};
  first.group.position.set(9,groundHeight(9,-168),-168);pose(first,rampA,30.4);
  const ringA=firstRing.geometry,fillA=firstFill.geometry;assert.notEqual(ringA,pooledRing);assert.notEqual(fillA,pooledFill);
  second.group.position.set(4,groundHeight(4,-198),-198);pose(second,rampB,30.4);
  assert.notEqual(secondRing.geometry,ringA);assert.notEqual(secondFill.geometry,fillA);
  assert.deepEqual(Array.from(pooledRing.attributes.position.array),flatRing);assert.deepEqual(Array.from(pooledFill.attributes.position.array),flatFill);
  assert.equal(first.group.getObjectByName('disturbed-grave').geometry,pooledFill,'grave emergence retains its unmodified shared patch');
  let ringDisposals=0,fillDisposals=0;ringA.addEventListener('dispose',()=>ringDisposals++);fillA.addEventListener('dispose',()=>fillDisposals++);
  first.group.position.set(0,0,10);pose(first,flat,30.6);assert.equal(firstRing.geometry,pooledRing);assert.equal(firstFill.geometry,pooledFill);
  assert.equal(ringDisposals,1);assert.equal(fillDisposals,1);
  first.dispose();assert.equal(ringDisposals,1);assert.equal(fillDisposals,1);
  const otherRing=secondRing.geometry;let otherDisposals=0;otherRing.addEventListener('dispose',()=>otherDisposals++);
  second.dispose();second.dispose();assert.equal(otherDisposals,1);
});
