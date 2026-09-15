import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCharacter } from '../public/src/characters.js';
import { createCrest,createPlayerCosmetic,createCosmeticsWorld } from '../public/src/cosmetics.js';
import { COSMETIC_PALETTES } from '../shared/progression.js';
import { PLOTS } from '../shared/world.js';
const meshes=root=>{const out=[];root.traverse(o=>{if(o.isMesh)out.push(o);});return out;};
test('earned sashes and distinct crests use fitted finite geometry for every playable role',()=>{
  for(const role of ['guard','priest','villager'])for(const crest of ['flame','shield','oak','crown']) {
    const actor=createCharacter(role,1),appearance=createPlayerCosmetic({palette:'ember',crest},role);actor.group.getObjectByName('body').add(appearance);
    actor.update(.1,1,{moving:true});actor.group.updateMatrixWorld(true);
    const bounds=new THREE.Box3().setFromObject(appearance);assert.ok(bounds.min.y>.8&&bounds.max.y<1.6);assert.ok(bounds.max.z<.5);
    assert.ok(meshes(appearance).length<=3);
    for(const mesh of meshes(appearance)){assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite));assert.ok(mesh.geometry.index?.array.every(i=>i<mesh.geometry.attributes.position.count)??true);}
    actor.dispose();
  }
  const signatures=['flame','shield','oak','crown'].map(id=>JSON.stringify(meshes(createCrest(id))[0].geometry.attributes.position.array));assert.equal(new Set(signatures).size,4);
  assert.equal(meshes(createPlayerCosmetic()).length,0);assert.equal(meshes(createPlayerCosmetic({palette:'invalid',crest:'invalid'})).length,0);
});
test('appearance follows actual body bone across gait, role rebuilds and removal without mutating shared clothing',()=>{
  const scene=new THREE.Scene(),rig=createCharacter('guard',1),neighbor=createCharacter('guard',1);scene.add(rig.group,neighbor.group);
  const originals=meshes(neighbor.group).map(m=>[m.material,m.material.color?.getHex()]);const state={players:[{id:'one',role:'guard'}],cosmetics:{players:{one:{palette:'azure',crest:'shield'}}}},actors=new Map([['one',{rig}]]),cosmetics=createCosmeticsWorld(scene);
  cosmetics.update(state,actors);const first=rig.group.getObjectByName('earned-player-appearance');assert.equal(first.parent.name,'body');
  for(let i=0;i<20;i++){rig.update(.05,i*.05,{moving:true});cosmetics.update(state,actors);assert.equal(rig.group.getObjectByName('earned-player-appearance'),first);}
  for(const [m,color] of originals)assert.equal(m.color?.getHex(),color);
  rig.setRole('priest');state.players[0].role='priest';cosmetics.update(state,actors);const replacement=rig.group.getObjectByName('earned-player-appearance');assert.notEqual(replacement,first);assert.equal(first.parent,null);assert.equal(replacement.parent.name,'body');
  let disposed=0;meshes(replacement)[0].material.addEventListener('dispose',()=>disposed++);cosmetics.clear();cosmetics.clear();assert.equal(disposed,1);assert.equal(replacement.parent,null);assert.equal(cosmetics.stats.players,0);
  cosmetics.dispose();rig.dispose();neighbor.dispose();
});
test('property trim and keep banners clone materials, update only selected plots and restore originals on reset',()=>{
  const scene=new THREE.Scene(),base=new THREE.MeshStandardMaterial({color:0xaa8051}),geometry=new THREE.BoxGeometry(),site=PLOTS[0];
  const plot=new THREE.Group();plot.name=`plot-${site.id}`;const trim=new THREE.InstancedMesh(geometry,base,1);plot.add(trim);scene.add(plot);
  const other=new THREE.InstancedMesh(geometry,base,1);scene.add(other);
  const keep=new THREE.Group();keep.userData.buildingId='keep';const banner=new THREE.Group();const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([-.5,1,0,.5,1,0,.5,-.5,0,0,-1,0,-.5,-.5,0],3));g.setIndex([0,1,2,0,2,3,0,3,4]);
  const bannerBase=new THREE.MeshStandardMaterial({color:0x777777}),cloth=new THREE.Mesh(g,bannerBase),cross=new THREE.Mesh(geometry,base);banner.add(cloth,cross);keep.add(banner);scene.add(keep);
  const state={players:[],plots:[{id:site.id,ownerId:'one',building:'house',hp:500}],cosmetics:{plots:{[site.id]:'ember'},banner:{palette:'azure',crest:'shield'}}};
  const cosmetics=createCosmeticsWorld(scene);cosmetics.update(state);assert.notEqual(trim.material,base);assert.equal(trim.material.color.getHex(),COSMETIC_PALETTES.ember.color);assert.equal(other.material,base);assert.equal(base.color.getHex(),0xaa8051);
  assert.notEqual(cloth.material,bannerBase);assert.equal(cloth.material.color.getHex(),COSMETIC_PALETTES.azure.color);assert.equal(cross.visible,false);assert.ok(banner.getObjectByName('earned-crest-shield'));
  const clone=trim.material;let disposal=0;clone.addEventListener('dispose',()=>disposal++);cosmetics.update(state);assert.equal(trim.material,clone);
  state.plots[0].hp=0;cosmetics.update(state);assert.equal(trim.material,base);assert.equal(disposal,1);assert.equal(cosmetics.stats.plots,0);
  cosmetics.dispose();assert.equal(cloth.material,bannerBase);assert.equal(cross.visible,true);assert.equal(banner.getObjectByName('earned-crest-shield'),undefined);assert.equal(scene.getObjectByName('earned-world-appearance'),undefined);
});
