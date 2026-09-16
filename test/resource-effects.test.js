import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';

// Load the browser entry using the same Three.js module and shared world data.
// The actual controller runs without a GPU; no rendering methods are mocked.
const threeURL=new URL('../node_modules/three/build/three.module.js',import.meta.url).href;
const sharedURL=new URL('../shared/world.js',import.meta.url).href;
const moduleURL=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const plots=readFileSync(new URL('../public/src/plots-world.js',import.meta.url),'utf8').replace("'three'",JSON.stringify(threeURL)).replace("'/shared/world.js'",JSON.stringify(sharedURL)).replace("'./surface-materials.js'",JSON.stringify(new URL('../public/src/surface-materials.js',import.meta.url).href)).replace("'./environment-geometry.js'",JSON.stringify(new URL('../public/src/environment-geometry.js',import.meta.url).href));
const world=readFileSync(new URL('../public/src/world.js',import.meta.url),'utf8').replace("'three'",JSON.stringify(threeURL)).replace("'/shared/world.js'",JSON.stringify(sharedURL)).replace("'./plots-world.js'",JSON.stringify(moduleURL(plots))).replace("'./surface-materials.js'",JSON.stringify(new URL('../public/src/surface-materials.js',import.meta.url).href)).replace("'./environment-geometry.js'",JSON.stringify(new URL('../public/src/environment-geometry.js',import.meta.url).href));
const {createResourceEffects}=await import(moduleURL(world));

function setup(type='timber',id=`${type}-test`){
 const scene=new THREE.Scene(),effects=createResourceEffects(scene),object=new THREE.Mesh(new THREE.BoxGeometry(.4,4,.4),new THREE.MeshStandardMaterial());
 object.position.set(10,.025,15);object.rotation.y=.51;object.scale.set(.9,1.1,.8);object.userData.resourceHeight=4;scene.add(object);
 effects.register({id,type,seed:45},object);
 const node={id,available:true,remaining:type==='wheat'?1:type==='timber'?5:8};
 const baseline={position:object.position.clone(),quaternion:object.quaternion.clone(),scale:object.scale.clone()};
 return {scene,effects,object,node,baseline};
}
function close(actual,expected){assert.ok(actual.distanceTo(expected)<1e-9,`${actual.toArray()} differs from ${expected.toArray()}`);}
function finite(scene){scene.updateMatrixWorld(true);scene.traverse(object=>{assert.ok(object.matrixWorld.elements.every(Number.isFinite));if(object.isInstancedMesh)assert.ok(object.instanceMatrix.array.every(Number.isFinite));});}

test('initial snapshots establish resource baselines without replaying old harvests',()=>{
 for(const type of ['timber','stone','iron','coal','wheat']){
  const {effects,object,node}=setup(type);
  effects.beginSnapshot({id:'village',clock:42});effects.observe({...node,available:false,remaining:0},0);effects.update(.1);
  assert.equal(object.visible,false);assert.equal(effects.stats.events,0);assert.equal(effects.stats.ghosts,0);assert.equal(effects.stats.particles,0);
  effects.dispose();
 }
});

test('confirmed chops shudder the tree once and original transforms recover without drift',()=>{
 const {scene,effects,object,node,baseline}=setup();
 effects.observe(node,0);effects.observe({...node,remaining:4},.1,[{online:true,anim:'gather',x:8,z:15}]);effects.update(.14);
 assert.equal(effects.stats.events,1);assert.ok(effects.stats.particles>0);assert.ok(object.quaternion.angleTo(baseline.quaternion)>.001);assert.equal(object.visible,true);
 for(let i=0;i<120;i++){effects.observe({...node,remaining:4},.15+i/60);effects.update(.15+i/60);}
 assert.equal(effects.stats.events,1,'unchanged render frames do not retrigger a hit');
 assert.ok(object.quaternion.angleTo(baseline.quaternion)<1e-9);close(object.position,baseline.position);close(object.scale,baseline.scale);finite(scene);effects.dispose();
});

test('a depleted tree falls as a temporary visual, then regrows from its exact authored pose',()=>{
 const {scene,effects,object,node,baseline}=setup();effects.observe({...node,remaining:1},0);effects.observe({...node,available:false,remaining:0},.1);effects.update(.7);
 assert.equal(object.visible,false,'the depleted source is no longer rendered as an available node');
 const falling=effects.root.getObjectByName(`harvest-timber-${node.id}`);assert.ok(falling);assert.ok(falling.quaternion.angleTo(baseline.quaternion)>.3);assert.equal(falling.geometry,object.geometry,'temporary visual shares source geometry');
 effects.update(1.5);assert.equal(effects.stats.ghosts,0);
 effects.observe(node,1.6);effects.update(1.6);assert.equal(object.visible,true);assert.ok(object.quaternion.angleTo(baseline.quaternion)<1e-9);close(object.position,baseline.position);close(object.scale,baseline.scale);finite(scene);effects.dispose();
});

test('stone and ore lose volume, emit chips, and crumble only after confirmed depletion',()=>{
 for(const type of ['stone','iron','coal']){
  const {scene,effects,object,node,baseline}=setup(type);effects.observe(node,0);effects.observe({...node,remaining:3},.1);effects.update(.2);
  assert.ok(object.visible);assert.ok(object.scale.y<baseline.scale.y);assert.ok(effects.stats.particles>0);
  effects.observe({...node,available:false,remaining:0},.3);effects.update(.65);
  const crumbling=effects.root.getObjectByName(`harvest-${type}-${node.id}`);assert.ok(crumbling);assert.ok(crumbling.scale.y<baseline.scale.y*.6);assert.equal(object.visible,false);
  effects.update(1.2);assert.equal(effects.stats.ghosts,0);effects.observe(node,1.3);effects.update(1.3);close(object.scale,baseline.scale);finite(scene);effects.dispose();
 }
});

test('private wheat cuts quickly and deleting a private resource clears its temporary visual',()=>{
 const {effects,object,node}=setup('wheat','plot:west-1:0');effects.observe(node,0);effects.observe({...node,available:false,remaining:0},.1);effects.update(.2);
 assert.equal(object.visible,false);assert.equal(effects.stats.ghosts,1);
 effects.remove(node.id);assert.equal(effects.stats.ghosts,0);effects.update(2);assert.equal(effects.stats.particles,0);effects.dispose();
});

test('reconnect resets, village changes, and stale clock jumps never replay missed harvests',()=>{
 const {effects,object,node,baseline}=setup();
 effects.beginSnapshot({id:'a',clock:1});effects.observe(node,0);
 effects.reset();effects.beginSnapshot({id:'a',clock:1.2});effects.observe({...node,remaining:3},.2);effects.update(.2);assert.equal(effects.stats.events,0);
 effects.beginSnapshot({id:'a',clock:10});effects.observe({...node,available:false,remaining:0},.3);effects.update(.3);assert.equal(effects.stats.events,0);assert.equal(effects.stats.ghosts,0);
 effects.beginSnapshot({id:'b',clock:1});effects.observe(node,.4);effects.update(.4);assert.equal(object.visible,true);close(object.position,baseline.position);
 effects.observe({...node,remaining:4},.5);effects.update(.55);assert.equal(effects.stats.events,1,'new live events still work after reset');
 effects.reset();assert.equal(effects.stats.particles,0);assert.equal(effects.stats.ghosts,0);close(object.position,baseline.position);effects.dispose();
});

test('simultaneous harvesting uses bounded pools and cleans up without disposing shared node geometry',()=>{
 const scene=new THREE.Scene(),effects=createResourceEffects(scene,{maxParticles:48,maxGhosts:4}),geometry=new THREE.BoxGeometry(1,1,1),material=new THREE.MeshStandardMaterial();let disposed=0;geometry.addEventListener('dispose',()=>disposed++);
 for(let i=0;i<70;i++){
  const node={id:`stone-${i}`,type:'stone',seed:i,remaining:1,available:true},object=new THREE.Mesh(geometry,material);object.position.x=i;scene.add(object);effects.register(node,object);effects.observe(node,0);effects.observe({...node,remaining:0,available:false},.1);
 }
 effects.update(.3);assert.equal(effects.stats.events,70);assert.ok(effects.stats.ghosts<=4);assert.ok(effects.stats.particles<=48);assert.equal(effects.stats.particleCapacity,48);finite(scene);
 effects.update(2);assert.equal(effects.stats.ghosts,0);assert.equal(effects.stats.particles,0);effects.dispose();assert.equal(disposed,0,'finishing effects must not free resource geometry');
});
