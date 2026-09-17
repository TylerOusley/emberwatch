import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LOW_OBSTACLES } from '../shared/elevation.js';
import { createCivicWorld } from '../public/src/civic-world.js';

test('jumpable logs and climbing steps exactly match shared collision dimensions and top heights',()=>{
  const world=createCivicWorld(new THREE.Scene());world.root.updateMatrixWorld(true);
  for(const obstacle of LOW_OBSTACLES){
    const object=world.obstacles.get(obstacle.id),bounds=new THREE.Box3().setFromObject(object),size=bounds.getSize(new THREE.Vector3());
    assert.ok(Math.abs(size.x-obstacle.w)<1e-5,`${obstacle.id} width`);assert.ok(Math.abs(size.z-obstacle.d)<1e-5,`${obstacle.id} depth`);
    assert.ok(Math.abs(bounds.min.y)<1e-5);assert.ok(Math.abs(bounds.max.y-obstacle.height)<1e-5,`${obstacle.id} player landing height`);
  }
  world.dispose();
});

test('village works reveal only completed engines and animate fresh authoritative shots once',()=>{
  const scene=new THREE.Scene(),world=createCivicWorld(scene),state={id:'first',clock:10,civic:{completed:['reinforcement','ballista'],depot:{},siege:{ballista:{lastShot:{id:'old',at:10,x:0,z:40}}}}};
  world.update(state,.1,10);const ballista=world.engines.get('ballista'),trebuchet=world.engines.get('trebuchet');assert.equal(ballista.group.visible,true);assert.equal(trebuchet.group.visible,false);assert.equal(ballista.projectile.visible,false,'joining cannot replay an old shot');
  state.clock=11;state.civic.siege.ballista.lastShot={id:'new',at:11,x:4,z:41};world.update(state,.1,11);assert.equal(ballista.projectile.visible,true);const first=ballista.projectile.position.clone();
  world.update(state,.1,11.35);assert.ok(ballista.projectile.position.distanceTo(first)>1);world.update(state,.1,12);assert.equal(ballista.projectile.visible,false,'repeated snapshots do not restart projectiles');
  world.update({id:'second',clock:0,civic:{completed:[],siege:{}}},.1,12.1);assert.equal(ballista.group.visible,false);assert.equal(ballista.projectile.visible,false);
  world.dispose();assert.equal(scene.children.includes(world.root),false);
});

test('the communal board tracks contribution progress and the mason follows saved positions',()=>{
  const world=createCivicWorld(),state={id:'works',clock:2,civic:{active:'reinforcement',progress:{timber:150,stone:250,gold:2500},completed:['repair_crew'],mason:{x:-10,z:-23,status:'All structures repaired'},depot:{timber:2}}};
  world.update(state,.1,2);assert.equal(world.board.userData.progress,.5);assert.equal(world.board.userData.project,'Reinforced gate and keep');
  const mason=world.root.getObjectByName('village-repair-mason');assert.ok(mason);assert.equal(mason.position.x,-10);assert.equal(mason.position.z,-23);
  state.civic.mason.x=-9.8;state.civic.mason.status='Repairing the gate';world.update(state,.1,2.1);assert.ok(mason.position.x>-10&&mason.position.x<=-9.8);
  const resources=new Set();world.root.traverse(m=>{if(m.isMesh&&!mason.getObjectById(m.id)){resources.add(m.geometry);resources.add(m.material);}});let disposed=0;for(const resource of resources)resource.addEventListener('dispose',()=>disposed++);world.dispose();const count=disposed;world.dispose();assert.equal(disposed,count);assert.ok(count>0);
});
