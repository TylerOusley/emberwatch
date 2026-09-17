import * as THREE from 'three';
import { crateItem } from './crate-catalog.js';
import { createHeadwear } from './crate-headwear.js';
import { createArmor } from './crate-armor.js';
import { createUtility } from './crate-utilities.js';
import { createKit } from './crate-kits.js';

// Rest anchors use the existing dwarf rig. Every model is authored in the local
// coordinates of its attachment bone; animation remains the character's job.
export const CRATE_REST_ANCHORS=Object.freeze({head:[0,1.80,.01],body:[0,1.04,0],leftShin:[.21,.42,0],rightShin:[-.21,.42,0],leftFoot:[.21,.17,.015],rightFoot:[-.21,.17,.015],hand:[-.48,.76,.035]});

export function createCrateAsset(id,{tool='pickaxe',backpackTier=0}={}) {
  const item=crateItem(id);if(!item)throw new Error('Choose an item from the artwork catalogue.');
  if(!['axe','pickaxe','scythe'].includes(tool))throw new Error('Choose an axe, pickaxe or scythe.');
  if(!Number.isInteger(backpackTier)||backpackTier<0||backpackTier>3)throw new Error('Choose a backpack tier from 0 to 3.');
  const model=item.slot==='head'?createHeadwear(id):['body','feet'].includes(item.slot)?createArmor(id):item.slot==='utility'?createUtility(id):createKit(id==='steadfast_crew_kit'?'prospectors_kit':id,{tool});
  const root=new THREE.Group();root.name=`crate-art-${id}`;root.userData.itemId=id;root.userData.artworkOnly=true;
  const mounts=[],hidden=[];let fitted=null,disposed=false;
  for(const part of model.parts){
    if(!part.object?.isObject3D||part.bone&&!CRATE_REST_ANCHORS[part.bone]){model.dispose();throw new Error('Invalid artwork attachment.');}
    const anchor=new THREE.Group();anchor.name=`display-anchor-${part.bone||'item'}`;
    if(part.bone)anchor.position.fromArray(CRATE_REST_ANCHORS[part.bone]);
    anchor.add(part.object);root.add(anchor);mounts.push({part,anchor});
  }
  model.setBackpackTier?.(backpackTier);
  function unfit(){
    for(const {part,anchor}of mounts)anchor.add(part.object);
    for(const record of hidden)record.object.visible=record.visible;
    hidden.length=0;fitted=null;root.updateMatrixWorld(true);
  }
  function fit(character){
    if(disposed)throw new Error('This artwork has been disposed.');
    if(!item.wearable)throw new Error('This item is a display bundle, not wearable equipment.');
    const actor=character?.group||character;if(!actor?.isObject3D)throw new Error('Provide a character model.');
    const destinations=mounts.map(({part})=>actor.getObjectByName(part.bone));
    if(destinations.some(b=>!b?.isBone))throw new Error('The character is missing an equipment bone.');
    unfit();
    const names=new Set(model.parts.flatMap(part=>part.hideNames||[]));
    // Keep original geometry alive so unequipping can restore it exactly.
    actor.traverse(object=>{
      if(names.has(object.name)||item.slot==='feet'&&object.userData?.clothingPart==='boot'){
        hidden.push({object,visible:object.visible});object.visible=false;
      }
    });
    mounts.forEach(({part},i)=>destinations[i].add(part.object));fitted=actor;actor.updateMatrixWorld(true);return root;
  }
  return {id,item,root,parts:model.parts,fit,unfit,
    update(time,options={}){if(!disposed)model.update?.(Number.isFinite(time)?time:0,options);},
    setBackpackTier(tier){if(!disposed&&Number.isInteger(tier)&&tier>=0&&tier<=3)model.setBackpackTier?.(tier);},
    get fitted(){return !!fitted;},
    dispose(){if(disposed)return;unfit();disposed=true;root.removeFromParent();model.dispose();root.clear();},
  };
}
