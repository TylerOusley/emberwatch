import * as THREE from 'three';
import { CRATE_ITEMS, CRATE_TIERS, crateItem } from './crate-catalog.js';
import { createCrateAsset } from './crate-assets.js';
import { createCharacter } from './characters.js';
import { studioDistance } from './crate-framing.js';

// Independent art-review page. No account requests, websocket, grants or saves.
const $=id=>document.getElementById(id),canvas=$('art-canvas'),status=$('stage-message');
const reducedMedia=matchMedia('(prefers-reduced-motion: reduce)');
const ui={item:crateItem(location.hash.slice(1))?.id||'dawnsteel_helm',filter:'all',mode:'item',role:'villager',pose:'idle',tool:'pickaxe',backpack:0,reduced:reducedMedia.matches,spin:!reducedMedia.matches,lighting:'studio'};
const tiles=new Map();let renderer=null,studio=null,asset=null,actor=null,carrier=null,frame=0,disposed=false,last=0,time=0,yaw=-.48,pitch=.14,zoom=1,fitRadius=1,targetY=.9,pointer=null;
const camera=new THREE.PerspectiveCamera(33,1,.02,80),target=new THREE.Vector3();

function disposeObjects(root){const gs=new Set(),ms=new Set();root.traverse(o=>{if(o.geometry)gs.add(o.geometry);for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[])ms.add(m);});for(const g of gs)g.dispose();for(const m of ms)m.dispose();root.clear();}
function createStudio(render){
  const scene=new THREE.Scene(),props=new THREE.Group();scene.add(props);
  const hemi=new THREE.HemisphereLight(0xf0e6c6,0x435342,1.8),key=new THREE.DirectionalLight(0xffe3bc,3.1),fill=new THREE.DirectionalLight(0xa2cddd,2.0),rim=new THREE.DirectionalLight(0xffcc8d,1.4);
  key.position.set(-3,5,5);fill.position.set(3,2,1);rim.position.set(1,3,-4);scene.add(hemi,key,fill,rim);
  const floor=new THREE.Mesh(new THREE.CylinderGeometry(1.35,1.40,.10,96),new THREE.MeshStandardMaterial({color:0x26352a,roughness:.63,metalness:.25}));floor.position.y=-.055;props.add(floor);
  for(const radius of[1.335,1.23]){const ring=new THREE.Mesh(new THREE.TorusGeometry(radius,.008,6,100),new THREE.MeshStandardMaterial({color:0x9c8250,metalness:.68,roughness:.38}));ring.rotation.x=Math.PI/2;ring.position.y=.003;props.add(ring);}
  // A small generated studio environment supplies real reflections on metal.
  // It contains only original geometry and is never inserted into the game.
  const room=new THREE.Scene();room.background=new THREE.Color(0x63726a);
  const panels=[[-4,2,0,1,5,5,0xffedca,3.1],[4,1,-1,1,4,4,0xa9d4eb,2.3],[0,6,0,5,.2,5,0xfff5db,4],[0,2,-5,4,4,.2,0x18322b,.8]];
  for(const[x,y,z,w,h,d,color,power]of panels){const material=new THREE.MeshBasicMaterial({color:new THREE.Color(color).multiplyScalar(power),side:THREE.DoubleSide});const panel=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);panel.position.set(x,y,z);room.add(panel);}
  const pmrem=new THREE.PMREMGenerator(render),environment=pmrem.fromScene(room,.035,.1,30);scene.environment=environment.texture;scene.environmentIntensity=.55;pmrem.dispose();disposeObjects(room);
  return {scene,props,environment,setLighting(kind){const night=kind==='night';hemi.intensity=night?.65:1.8;key.color.set(night?0x98bddd:0xffe3bc);key.intensity=night?1.5:3.1;fill.color.set(night?0xffb25f:0xa2cddd);fill.intensity=night?1.1:2;rim.intensity=night?1.8:1.4;scene.environmentIntensity=night?.28:.55;},dispose(){disposeObjects(props);environment.dispose();scene.clear();}};
}
function makeRenderer(surface,width,height){const r=new THREE.WebGLRenderer({canvas:surface,antialias:true,alpha:true,preserveDrawingBuffer:false,powerPreference:'high-performance'});r.setPixelRatio(Math.min(devicePixelRatio||1,2));r.setSize(width,height,false);r.setClearColor(0,0);r.outputColorSpace=THREE.SRGBColorSpace;r.toneMapping=THREE.ACESFilmicToneMapping;r.toneMappingExposure=1.13;return r;}
function tileList(){
  const list=$('item-list');list.replaceChildren();tiles.clear();
  const items=CRATE_ITEMS.filter(item=>ui.filter==='all'||item.tier===ui.filter);$('collection-count').textContent=`${items.length} ${items.length===1?'design':'designs'}`;
  for(const item of items){const button=document.createElement('button');button.type='button';button.className='item-tile';button.dataset.item=item.id;button.style.setProperty('--tier',CRATE_TIERS[item.tier].color);button.setAttribute('aria-label',item.name);button.setAttribute('aria-pressed',String(item.id===ui.item));
    const img=new Image();img.alt='';img.src=`/assets/crate-items/${item.id}.png`;img.loading='lazy';button.append(img);
    const title=document.createElement('strong');title.textContent=item.name;const tier=document.createElement('small');tier.textContent=CRATE_TIERS[item.tier].label.toUpperCase();button.append(title,tier);button.addEventListener('click',()=>selectItem(item.id));list.append(button);tiles.set(item.id,button);
  }
}
function descriptions(){
  const item=crateItem(ui.item),tier=CRATE_TIERS[item.tier];document.documentElement.style.setProperty('--tier',tier.color);
  $('item-name').textContent=item.name;$('stage-name').textContent=item.name;$('item-tier').textContent=tier.label.toUpperCase();$('studio-tier').textContent=`${tier.label.toUpperCase()} COLLECTION`;
  $('item-design').textContent=item.design;$('item-effect').textContent=item.description;$('item-slot').textContent=item.slot==='milestone'?'MILESTONE TROPHY':`${item.slot.toUpperCase()} ${item.wearable?'EQUIPMENT':'DISPLAY'}`;
  $('studio-view').textContent=ui.mode==='character'?'CHARACTER FIT':'ITEM STUDY';$('mode-item').setAttribute('aria-pressed',String(ui.mode==='item'));$('mode-character').setAttribute('aria-pressed',String(ui.mode==='character'));$('mode-character').disabled=!item.wearable;
  $('character-options').hidden=ui.mode!=='character';$('pack-option').hidden=item.slot!=='utility';$('tool-option').hidden=item.slot!=='kit'||item.id==='hearth_ration_kit';
  for(const[id,button]of tiles)button.setAttribute('aria-pressed',String(id===ui.item));
  canvas.setAttribute('aria-label',`${item.name}, ${ui.mode==='character'?ui.role+' fitting':'3D item preview'}. Drag or use arrow keys to rotate. Scroll or use plus and minus to zoom. R resets the view.`);
}
function clearModel(){asset?.dispose();asset=null;actor?.dispose();actor=null;carrier?.removeFromParent();carrier=null;}
function rebuild(){
  if(!studio)return;clearModel();carrier=new THREE.Group();studio.scene.add(carrier);
  asset=createCrateAsset(ui.item,{tool:ui.tool,backpackTier:ui.backpack});
  if(ui.mode==='character'){
    actor=createCharacter(ui.role,1,{equipmentPreview:true});actor.setTool(ui.pose==='strike'?'pickaxe':'');actor.setBackpackTier(ui.backpack);
    asset.fit(actor);carrier.add(actor.group);for(let i=0;i<30;i++)actor.update(1/60,i/60,{moving:false});
    targetY=ui.pose==='strike'?1.45:1.1;fitRadius=ui.pose==='strike'?1.92:1.30;
  }else{
    carrier.add(asset.root);asset.update(0,{reducedMotion:true});asset.root.updateMatrixWorld(true);
    const bounds=new THREE.Box3().setFromObject(asset.root),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3()),scale=1.52/Math.max(size.x,size.y,size.z,.01);
    asset.root.scale.setScalar(scale);asset.root.position.set(-center.x*scale,.035-bounds.min.y*scale,-center.z*scale);targetY=.035+size.y*scale*.5;fitRadius=size.length()*scale*.5;
  }
  yaw=ui.item==='lumber_pack'||ui.item==='mining_pack'?Math.PI+.48:-.48;pitch=.14;zoom=1;descriptions();renderNow();
}
function selectItem(id){if(!crateItem(id))return;ui.item=id;if(!crateItem(id).wearable)ui.mode='item';history.replaceState(null,'',`#${id}`);rebuild();}
function renderNow(){if(!renderer||!studio)return;const width=Math.max(1,canvas.clientWidth),height=Math.max(1,canvas.clientHeight);if(canvas.width!==Math.round(width*renderer.getPixelRatio())||canvas.height!==Math.round(height*renderer.getPixelRatio()))renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();const distance=studioDistance(fitRadius,camera.aspect,camera.fov)*zoom;target.set(0,targetY,0);camera.position.set(Math.sin(yaw)*Math.cos(pitch)*distance,targetY+Math.sin(pitch)*distance,Math.cos(yaw)*Math.cos(pitch)*distance);camera.lookAt(target);renderer.render(studio.scene,camera);}
function animate(now){if(disposed)return;const dt=Math.min((now-last)/1000||0,.05);last=now;if(!document.hidden){if(!ui.reduced){time+=dt;if(ui.spin&&!pointer)yaw+=dt*.17;}if(actor){actor.setTool(ui.pose==='strike'?'pickaxe':'');actor.update(ui.reduced?0:dt,time,{moving:!ui.reduced&&ui.pose==='walk',attack:!ui.reduced&&ui.pose==='strike'&&time%1.65<.6});}asset?.update(time,{reducedMotion:ui.reduced,backpackTier:ui.backpack});renderNow();}frame=requestAnimationFrame(animate);}
function showFailure(error){status.hidden=false;status.textContent=`The 3D studio could not start. This page needs WebGL 2. ${error?.message||''}`;canvas.dataset.ready='error';$('save-render').disabled=true;}

for(const button of document.querySelectorAll('[data-tier]'))button.addEventListener('click',()=>{ui.filter=button.dataset.tier;document.querySelectorAll('[data-tier]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));tileList();});
$('mode-item').addEventListener('click',()=>{ui.mode='item';rebuild();});$('mode-character').addEventListener('click',()=>{if(crateItem(ui.item).wearable){ui.mode='character';rebuild();}});
for(const[key,id]of[['role','role'],['pose','pose'],['tool','kit-tool'],['backpack','backpack']])$(id).addEventListener('change',()=>{ui[key]=key==='backpack'?Number($(id).value):$(id).value;rebuild();});
$('lighting').addEventListener('change',()=>{ui.lighting=$('lighting').value;studio?.setLighting(ui.lighting);renderNow();});
function rotationLabel(){$('rotate-toggle').textContent=ui.spin?'Pause rotation':'Rotate item';$('rotate-toggle').setAttribute('aria-pressed',String(ui.spin));}
$('rotate-toggle').addEventListener('click',()=>{ui.spin=!ui.spin;if(ui.spin&&ui.reduced){ui.reduced=false;$('reduced-motion').checked=false;}rotationLabel();});
$('reduced-motion').checked=ui.reduced;$('reduced-motion').addEventListener('change',()=>{ui.reduced=$('reduced-motion').checked;if(ui.reduced){ui.spin=false;rotationLabel();}asset?.update(time,{reducedMotion:ui.reduced});renderNow();});
$('reset-view').addEventListener('click',()=>rebuild());
canvas.addEventListener('pointerdown',event=>{if(event.button!==0)return;pointer={id:event.pointerId,x:event.clientX,y:event.clientY};canvas.setPointerCapture(event.pointerId);canvas.focus();});
canvas.addEventListener('pointermove',event=>{if(!pointer||pointer.id!==event.pointerId)return;yaw-=(event.clientX-pointer.x)*.009;pitch=THREE.MathUtils.clamp(pitch+(event.clientY-pointer.y)*.006,-.35,1.10);pointer.x=event.clientX;pointer.y=event.clientY;renderNow();});
const endDrag=()=>{pointer=null;};canvas.addEventListener('pointerup',endDrag);canvas.addEventListener('pointercancel',endDrag);canvas.addEventListener('lostpointercapture',endDrag);
canvas.addEventListener('wheel',event=>{event.preventDefault();zoom=THREE.MathUtils.clamp(zoom*Math.exp(event.deltaY*.001),.45,2.3);renderNow();},{passive:false});
canvas.addEventListener('keydown',event=>{let used=true;if(event.key==='ArrowLeft')yaw+=.13;else if(event.key==='ArrowRight')yaw-=.13;else if(event.key==='ArrowUp')pitch=Math.min(1.1,pitch+.08);else if(event.key==='ArrowDown')pitch=Math.max(-.35,pitch-.08);else if(['+','='].includes(event.key))zoom=Math.max(.45,zoom-.07);else if(event.key==='-')zoom=Math.min(2.3,zoom+.07);else if(event.key.toLowerCase()==='r')rebuild();else used=false;if(used){event.preventDefault();renderNow();}});
$('save-render').addEventListener('click',()=>{if(!renderer)return;renderNow();canvas.toBlob(blob=>{if(!blob)return;const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`emberwatch-${ui.item}-${ui.mode}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},'image/png');});
window.addEventListener('hashchange',()=>{const item=crateItem(location.hash.slice(1));if(item)selectItem(item.id);});
function cleanup(){if(disposed)return;disposed=true;cancelAnimationFrame(frame);clearModel();studio?.dispose();renderer?.dispose();renderer?.forceContextLoss();}
window.addEventListener('pagehide',event=>{if(!event.persisted)cleanup();});
window.addEventListener('pageshow',event=>{if(event.persisted)last=performance.now();});
tileList();rotationLabel();descriptions();
try{renderer=makeRenderer(canvas,Math.max(1,canvas.clientWidth),Math.max(1,canvas.clientHeight));studio=createStudio(renderer);rebuild();status.hidden=true;canvas.dataset.ready='true';last=performance.now();frame=requestAnimationFrame(animate);}catch(error){console.error(error);showFailure(error);}
