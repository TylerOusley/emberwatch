import * as THREE from 'three';
import { COSMETIC_PALETTES, cosmeticChoice } from '../../shared/progression.js';
import { PLOTS } from '../../shared/world.js';

function material(color) { return new THREE.MeshStandardMaterial({color,roughness:.9,metalness:0,side:THREE.DoubleSide}); }
function disposeGroup(group) {
  const geometries=new Set(),materials=new Set();
  group.traverse(o=>{if(o.isMesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});
  group.removeFromParent();for(const geometry of geometries)geometry.dispose();for(const mat of materials)mat.dispose();
}
export function createCrest(crest='none',size=1) {
  const group=new THREE.Group();group.name=`earned-crest-${crest}`;
  if(crest==='none')return group;
  const shapes={
    flame:[[-.20,-.38],[-.37,-.12],[-.32,.13],[-.14,.34],[-.07,.05],[.13,.49],[.34,.19],[.38,-.10],[.21,-.36]],
    shield:[[-.40,.39],[.40,.39],[.36,-.02],[.21,-.25],[0,-.47],[-.21,-.25],[-.36,-.02]],
    oak:[[0,-.43],[-.10,-.20],[-.32,-.19],[-.18,-.01],[-.38,.10],[-.17,.16],[-.23,.33],[0,.46],[.23,.33],[.17,.16],[.38,.10],[.18,-.01],[.32,-.19],[.10,-.20]],
    crown:[[-.40,-.26],[-.44,.29],[-.21,.03],[0,.40],[.21,.03],[.44,.29],[.40,-.26]]
  };
  const points=shapes[crest];if(!points)return group;
  const shape=new THREE.Shape();points.forEach(([x,y],i)=>i?shape.lineTo(x*size,y*size):shape.moveTo(x*size,y*size));shape.closePath();
  const mesh=new THREE.Mesh(new THREE.ShapeGeometry(shape),material(0xe8ca82));mesh.name='crest-symbol';group.add(mesh);
  return group;
}
export function createPlayerCosmetic(choice={},role='villager') {
  choice=cosmeticChoice(choice);
  const root=new THREE.Group();root.name='earned-player-appearance';root.userData.choice=choice;
  if(choice.palette!=='natural') {
    // The diagonal sash follows the upper torso's curved surface and its body
    // bone; it never changes the shared shirt, armor, or skin material.
    const positions=[],indices=[],segments=48,armored=role==='guard';
    for(let i=0;i<=segments;i++)for(let edge=0;edge<2;edge++) {
      const a=i/segments*Math.PI*2,x=Math.sin(a)*(armored?.455:.438),forward=Math.cos(a);
      // The villager apron has a flatter chest than the underlying tunic.
      const z=role==='villager'&&forward>0?.337*Math.pow(forward,.35):forward*(armored?.338:.302);
      positions.push(x,.13+x*.50+(edge? .07:-.07),z);
    }
    for(let i=0;i<segments;i++){const a=i*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();
    const sash=new THREE.Mesh(geometry,material(COSMETIC_PALETTES[choice.palette].color));sash.name='earned-colored-sash';sash.castShadow=true;sash.receiveShadow=true;root.add(sash);
  }
  if(choice.crest!=='none') {
    const badge=new THREE.Mesh(new THREE.CircleGeometry(.125,16),material(0x3c392e));badge.position.set(.11,.15,role==='guard'?.345:role==='villager'?.345:.311);root.add(badge);
    const crest=createCrest(choice.crest,.205);crest.position.copy(badge.position);crest.position.z+=.009;root.add(crest);
  }
  return root;
}
function coloredClone(object,color,replacements) {
  const original=object.material,copy=original.clone();copy.color.setHex(color);object.material=copy;
  replacements.push({object,original,copy});return copy;
}
function restoreRecord(record) {
  if(!record)return;
  for(const {object,original,copy} of record.replacements??[]) {if(object.material===copy)object.material=original;copy.dispose();}
  for(const {object,visible} of record.hidden??[])object.visible=visible;
  for(const extra of record.extras??[])disposeGroup(extra);
  if(record.group)disposeGroup(record.group);
}
function pennant(palette) {
  const group=new THREE.Group();group.name='earned-property-pennant';
  const pole=new THREE.Mesh(new THREE.CylinderGeometry(.035,.045,2.9,6),material(0x5b4330));pole.position.y=1.45;group.add(pole);
  const shape=new THREE.Shape();shape.moveTo(.04,2.78);shape.lineTo(.90,2.70);shape.lineTo(.48,2.30);shape.lineTo(.04,2.24);shape.closePath();
  const cloth=new THREE.Mesh(new THREE.ShapeGeometry(shape),material(COSMETIC_PALETTES[palette].color));cloth.name='earned-property-cloth';group.add(cloth);return group;
}
export function createCosmeticsWorld(scene) {
  const root=new THREE.Group();root.name='earned-world-appearance';scene.add(root);
  const players=new Map(),plots=new Map();let banner=null,disposed=false,keepModel=null;
  function playerAppearance(state,actors) {
    const live=new Set();
    for(const player of state.players??[]) {
      const actor=actors.get(player.id),body=actor?.rig?.group?.getObjectByName('body');if(!body||player.role==='zombie')continue;
      const choice=cosmeticChoice(state.cosmetics?.players?.[player.id]),key=JSON.stringify([choice,player.role]);
      live.add(player.id);let record=players.get(player.id);
      if(record?.key!==key||record?.body!==body) {
        restoreRecord(record);const group=createPlayerCosmetic(choice,player.role);body.add(group);record={key,body,group};players.set(player.id,record);
      }
    }
    for(const [id,record] of players)if(!live.has(id)){restoreRecord(record);players.delete(id);}
  }
  function plotAppearance(state) {
    const live=new Set();
    for(const plot of state.plots??[]) {
      const palette=cosmeticChoice({palette:state.cosmetics?.plots?.[plot.id]}).palette;
      if(!plot.ownerId||!plot.building||plot.hp<=0||palette==='natural')continue;
      const cached=plots.get(plot.id);const model=cached?.model?.parent?cached.model:scene.getObjectByName(`plot-${plot.id}`),site=PLOTS.find(p=>p.id===plot.id);if(!model||!site)continue;
      live.add(plot.id);const key=`${palette}/${plot.building}/${plot.ownerId}`;let record=plots.get(plot.id);
      if(record?.key!==key||record?.model!==model) {
        restoreRecord(record);record={key,model,replacements:[],extras:[]};
        // Plot architecture batches trim into its own instanced material. Clone
        // only that material per owned plot; neighboring buildings stay intact.
        model.traverse(object=>{if(object.isInstancedMesh&&object.material?.color?.getHex()===0xaa8051)coloredClone(object,COSMETIC_PALETTES[palette].color,record.replacements);});
        const group=pennant(palette),quarter=Math.abs(Math.sin(site.yaw??0))>.5,w=quarter?site.d:site.w,d=quarter?site.w:site.d;
        const localX=w/2-.65,localZ=d/2-.15,yaw=site.yaw??0;
        group.position.set(site.x+localX*Math.cos(yaw)+localZ*Math.sin(yaw),0,site.z-localX*Math.sin(yaw)+localZ*Math.cos(yaw));group.rotation.y=yaw;root.add(group);record.extras.push(group);plots.set(plot.id,record);
      }
    }
    for(const [id,record] of plots)if(!live.has(id)){restoreRecord(record);plots.delete(id);}
  }
  function keepAppearance(state) {
    const choice=cosmeticChoice(state.cosmetics?.banner),key=JSON.stringify(choice);
    if(!keepModel?.parent)scene.traverse(o=>{if(o.userData?.buildingId==='keep')keepModel=o;});const model=keepModel;
    if(banner?.key===key&&banner?.model===model)return;
    restoreRecord(banner);banner=null;if(!model||choice.palette==='natural'&&choice.crest==='none')return;
    banner={key,model,replacements:[],hidden:[],extras:[]};
    model.traverse(o=>{
      // Authored keep banners have a five-point cloth shield plus its original
      // cross emblem; retain cloth motion and replace only its decoration.
      if(!o.isGroup)return;
      const cloth=o.children.find(c=>c.isMesh&&!c.isInstancedMesh&&c.geometry?.getAttribute('position')?.count===5);
      if(!cloth)return;
      if(choice.palette!=='natural')coloredClone(cloth,COSMETIC_PALETTES[choice.palette].color,banner.replacements);
      for(const child of o.children)if(child!==cloth&&child.isMesh){banner.hidden.push({object:child,visible:child.visible});child.visible=false;}
      if(choice.crest!=='none') {
        cloth.geometry.computeBoundingBox();const box=cloth.geometry.boundingBox,size=Math.min(box.max.x-box.min.x,(box.max.y-box.min.y)*.65);
        const symbol=createCrest(choice.crest,size*.8);symbol.position.z=.075;o.add(symbol);banner.extras.push(symbol);
      }
    });
  }
  function clear() {
    for(const record of players.values())restoreRecord(record);players.clear();
    for(const record of plots.values())restoreRecord(record);plots.clear();restoreRecord(banner);banner=null;
  }
  return {root,update(state={},actors=new Map()){if(disposed)return;playerAppearance(state,actors);plotAppearance(state);keepAppearance(state);},clear,
    dispose(){if(disposed)return;disposed=true;clear();root.removeFromParent();},
    get stats(){return {players:players.size,plots:plots.size,banners:banner?.replacements.length??0};}};
}
