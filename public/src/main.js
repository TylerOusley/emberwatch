import * as THREE from 'three';
import { createWorld } from './world.js';
import { createCaveWorld } from './cave-world.js';
import { createMinimap } from './minimap.js';
import { createTorchSystem } from './torch-world.js';
import { constrainCaveCamera, localDwarfOccludesCamera } from './cave-camera.js';
import { createSkyEnvironment, sampleSkyCycle } from './sky.js';
import { createWorldClock } from './world-clock.js';
import { createCharacter } from './characters.js';
import { createZombiePresentation } from './zombie-presentation.js';
import { createNoticeboard, noticeboardTakesPriority } from './noticeboard.js';
import { createRequestsUI } from './requests-ui.js';
import { createGuardOrdersUI, createGuardRallies } from './guard-orders-ui.js';
import { createGameAudio, createFootstepSurface } from './audio.js';
import { createProgressionUI } from './progression-ui.js';
import { createCosmeticsWorld } from './cosmetics.js';
import { createSwordTrails } from './sword-trails.js';
import { icon } from './icons.js';
import { PoseBuffer } from './motion.js';
import { createVillageChat } from './chat.js';
import { createGameConnection } from './connection.js';
import { createTradingUI } from './trading-ui.js';
import { createCratesUI } from './crates-ui.js';
import { createInventoryHUD } from './inventory-hud.js';
import { createVillageFinanceUI } from './village-finance-ui.js';
import { createDefenseTroopWorld } from './defense-troop-world.js';
import { createRenderQuality, createGraphicsUI } from './render-quality.js';
import { createRenderPipeline, createSkyReflection } from './render-pipeline.js';
import { configureSurfaceTextures } from './surface-materials.js';
import { itemArt } from './shop-display.js';
import { buildingArt } from './build-carousel.js';
import { createCrateEquipmentWorld } from './crate-equipment-world.js';
import { chooseInteraction, choosePlotInteraction, nearestGatherable, nearestHealingTarget, directCompanionInteraction } from './interactions.js';
import { CONFIG, BUILDINGS, ROAD, RESOURCES, TOOLS, WALLS, PLOTS, WORLD_BOUNDS, caveAreaAt, caveDepthAt, groundHeight, resolveResource, plotSolids, moveWithCollision } from '/shared/world.js';
import { TOOL_TIERS, carryCapacity, inventoryWeight } from '/shared/content.js';
import { productionYield } from '/shared/production.js';
import { TRANSPORT } from '/shared/transport.js';
import { createSettlementUI } from './settlement-ui.js';
import { createTransportWorld } from './transport-world.js';
import { canEquip, FOOD_IDS } from '/shared/equipment.js';
import { bindCameraLook, placeOrbitCamera, createHeldGather } from './camera-controls.js';

const $=id=>document.getElementById(id);
const reducedMotionQuery=window.matchMedia('(prefers-reduced-motion: reduce)');
const escapeHTML=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pretty=n=>Math.max(0,Math.floor(Number(n)||0)).toLocaleString();
let state=null, me=null, ownId=null, selected='', role='villager', mode='register', auth=null, villageId=null, villages=[], requestedVillageName=null;
let joined=false, connecting=false, lastStateAt=0, cameraYaw=0, cameraPitch=.39, cameraDistance=8.5, tour=false, muted=false;
let cameraLook=null,heldGather=null,cosmeticsWorld=null,crateEquipmentWorld=null,swordTrails=null,defenseTroopWorld=null;
let localActionId=0, lastToolUse=-Infinity, interaction=null, activePanel=null, dynamicSolids=[], resumeMouseAfterPanel=false;
let hotbar=['sword','axe','pickaxe','scythe','hammer','food','bow','good_food'],savedHotbar=false;
try{const saved=JSON.parse(localStorage.getItem('emberwatch-hotbar')||'null');if(Array.isArray(saved)&&saved.length===8&&saved.every(id=>['sword','axe','pickaxe','scythe','hammer','bow','food','good_food','best_food','heal'].includes(id))){hotbar=saved;savedHotbar=true;}}catch{}
const poseTracks=new Map(),worldClock=createWorldClock();
const keys=new Set(), actors=new Map(), desired={x:0,z:0,yaw:Math.PI}, predicted={x:0,z:4};
const dialog=$('panel-dialog');
const chat=createVillageChat({host:$('village-chat'),send,ownId:()=>ownId,onFocusChange:()=>{keys.clear();desired.x=desired.z=0;cameraLook?.stop();sendInput();}});
const settlement=createSettlementUI({getState:()=>state,getMe:()=>me,getActivePanel:()=>activePanel,openPanel,send,toast,showDeliveries:id=>requests.showDestination(id),showRequests:()=>requests.show(),showInvestments:()=>villageFinance.showInvestments(),showTavern:()=>villageFinance.showTavern(),getHotbar:()=>hotbar,setHotbar:(slot,id)=>{hotbar[slot]=id;savedHotbar=true;try{localStorage.setItem('emberwatch-hotbar',JSON.stringify(hotbar));}catch{}renderHotbar();}});
const trading=createTradingUI({getState:()=>state,getMe:()=>me,getActivePanel:()=>dialog.open?activePanel:null,openPanel,send,toast});
const crates=createCratesUI({getMe:()=>me,getAccountKey:()=>auth?.playerId||auth?.name||null,getActivePanel:()=>dialog.open?activePanel:null,openPanel,api,toast,onAccountUpdate:snapshot=>{if(state){state.crates=snapshot;if(me)me.bank=snapshot.bank;}}});
const inventoryHUD=createInventoryHUD($('pack-hud'),{onOpen:showInventory});
const villageFinance=createVillageFinanceUI({getState:()=>state,getMe:()=>me,getActivePanel:()=>dialog.open?activePanel:null,openPanel,send,toast,isConnected:()=>connection.status==='connected',markWaypoint:point=>settlement.setWaypoint(point)});
const renderQuality=createRenderQuality();let qualitySettings=renderQuality.getSettings();
const graphicsUI=createGraphicsUI({openPanel,getActivePanel:()=>dialog.open?activePanel:null,getSettings:()=>renderQuality.getSettings(),setSettings:value=>renderQuality.setSettings(value),getRendererInfo:()=>renderer?.info.render});
$('lobby-graphics-button').onclick=()=>graphicsUI.show();
const gameAudio=createGameAudio();muted=gameAudio.muted;
const requests=createRequestsUI({getState:()=>state,getMe:()=>me,getActivePanel:()=>dialog.open?activePanel:null,openPanel,closePanel:()=>{dialog.close();activePanel=null;$('world').focus({preventScroll:true});},send,markTarget:point=>{settlement.setWaypoint(point);toast((point.name||'Delivery entrance')+' marked on the minimap.');}});
const guardOrders=createGuardOrdersUI({getState:()=>state,getMe:()=>me,getActivePanel:()=>dialog.open?activePanel:null,openPanel,send});
const progression=createProgressionUI({getState:()=>state,getMe:()=>me,getActivePanel:()=>dialog.open?activePanel:null,openPanel,send,markWaypoint:point=>{settlement.setWaypoint({...point,name:point.label||point.name});toast((point.label||point.name||'Guide destination')+' marked on the minimap.');}});
window.addEventListener('pointerdown',()=>gameAudio.unlock(),{passive:true});
window.addEventListener('keydown',()=>gameAudio.unlock(),{passive:true});
try{auth=JSON.parse(sessionStorage.getItem('emberwatch-session')||'null');}catch{}
const roles={guard:{name:'Guard',description:'40 shield · regenerates after six seconds without damage',icon:'guard'},priest:{name:'Priest',description:'125 health · heal and revive allies',icon:'priest'},villager:{name:'Villager',description:'150 base carrying capacity · 50 extra with every backpack',icon:'villager'}};
const toolDescriptions={sword:'Sweep enemies in front of you',axe:'Gather timber',pickaxe:'Gather stone',scythe:'Harvest wheat',hammer:'Restore the gate',food:'Restore your hunger',heal:'Heal or revive an ally'};
for(const [id,r] of Object.entries(roles)){
  const b=document.createElement('button');b.type='button';b.innerHTML=icon(r.icon)+r.name;b.dataset.role=id;b.role='radio';b.title=r.description;b.setAttribute('aria-checked',id===role);b.classList.toggle('active',id===role);
  b.onclick=()=>{role=id;document.querySelectorAll('[data-role]').forEach(e=>{e.classList.toggle('active',e.dataset.role===id);e.setAttribute('aria-checked',e.dataset.role===id);});};$('role-options').append(b);
}
const foodIds=FOOD_IDS;
const itemName=id=>!id?'Empty hands':foodIds.includes(id)?({food:'Bread',good_food:'Hearty meal',best_food:'Feast'}[id]):id==='heal'?'Priest blessing':`${TOOL_TIERS[me?.tiers?.[id]||'wood']?.name||'Wooden'} ${id}`;
function renderHotbar(){
 $('hotbar').replaceChildren();hotbar.forEach((id,index)=>{const b=document.createElement('button');b.className='slot';b.dataset.tool=id;b.title=itemName(id)+' ('+(index+1)+')';b.setAttribute('aria-label',b.title);b.innerHTML=`<span class="slot-key">${index+1}</span>${icon(foodIds.includes(id)?'food':id)}${['sword','axe','pickaxe','scythe','hammer','bow'].includes(id)?'<span class="durability"><i></i></span><span class="slot-tier"></span>':'<span class="slot-count"></span>'}`;b.onclick=()=>selectTool(id);$('hotbar').append(b);});updateHotbar();
}
function updateHotbar(){
 for(const b of document.querySelectorAll('[data-tool]')){const id=b.dataset.tool,tier=TOOL_TIERS[me?.tiers?.[id]||'wood'],bar=b.querySelector('.durability i'),durability=me?.durability?.[id]??(me?0:100);b.classList.toggle('active',id===selected);b.classList.toggle('disabled',!canEquip(me,id));b.setAttribute('aria-disabled',String(!canEquip(me,id)));b.classList.toggle('empty',me&&(foodIds.includes(id)?!me.inventory?.[id]:id==='heal'?false:!durability));if(bar)bar.style.width=Math.min(100,Math.max(0,durability/(me?.maxDurability?.[id]||tier?.durability||100)*100))+'%';const count=b.querySelector('.slot-count');if(count)count.textContent=foodIds.includes(id)?pretty(me?.inventory?.[id]):'';const badge=b.querySelector('.slot-tier');if(badge)badge.textContent=!canEquip(me,id)?'':me?.tiers?.[id]==='iron'?'III':me?.tiers?.[id]==='stone'?'II':'I';b.title=itemName(id)+(canEquip(me,id)?'':' · Not in your inventory');}
 $('tool-caption').textContent=itemName(selected).toUpperCase()+' · '+(!selected?'Buy your first tool at Oak & Iron':foodIds.includes(selected)?'Eat when you need it':selected==='bow'?'Aim toward an enemy · uses arrows':toolDescriptions[selected]||'');
}
function selectTool(id){heldGather?.stop();if(!canEquip(me,id)){toast(id==='heal'?'Only priests can use a blessing.':'You do not have this item. Visit Oak & Iron for wooden tools.');return;}selected=id;updateHotbar();sendInput();}
renderHotbar();
document.querySelectorAll('[data-auth]').forEach(b=>b.onclick=()=>{mode=b.dataset.auth;crates.clear();auth=null;sessionStorage.removeItem('emberwatch-session');$('password').required=true;$('password').placeholder='At least 8 characters';$('password').autocomplete=mode==='login'?'current-password':'new-password';$('join-button').innerHTML='ENTER THE VILLAGE <span>→</span>';document.querySelectorAll('[data-auth]').forEach(e=>e.classList.toggle('active',e===b));});
if(auth){$('name').value=auth.name;$('password').required=false;$('password').placeholder='Session saved on this tab';$('join-button').innerHTML='RETURN TO THE VILLAGE <span>→</span>';mode='resume';}
async function api(path,options={}){const response=await fetch(path,{...options,headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth.token}:{}),...options.headers}});const data=await response.json();if(!response.ok){const error=new Error(data.error||data.message||'The request could not be completed.');error.status=response.status;throw error;}return data;}
async function loadVillages(){try{const data=await api('/api/villages');villages=data.villages||[];const before=$('village-select').value;$('village-select').replaceChildren();for(const v of villages){const o=document.createElement('option');o.value=v.id;o.textContent=`${v.name} · Day ${v.day} · ${v.online} online · ${v.residents}/8 residents${v.status==='fallen'?' · Fallen':''}`;$('village-select').append(o);}if(!villages.length){const o=document.createElement('option');o.value='';o.textContent='Found a new village';$('village-select').append(o);requestedVillageName='Emberwatch';}else if(villages.some(v=>v.id===before))$('village-select').value=before;updateVillageDetail();}catch(e){$('form-error').textContent='Cannot reach the game server. '+e.message;}}
function updateVillageDetail(){const v=villages.find(v=>v.id===$('village-select').value);$('village-detail').textContent=v?`${v.online} online · ${Math.max(0,v.residents-v.online)} offline · ${8-v.residents} resident spaces`:'Your watch starts on day one.';}
$('village-select').onchange=()=>{requestedVillageName=null;updateVillageDetail();};$('refresh-villages').onclick=loadVillages;
$('new-village').onclick=()=>{openPanel('<p class="eyebrow">A NEW BEGINNING</p><h2>Found a village</h2><p>Anyone can join an available village. Each village has eight resident places, including residents who are offline.</p><label for="village-name-input">Village name</label><input id="village-name-input" class="create-village-input" maxlength="28" placeholder="The Northern Watch"><button id="confirm-village" class="primary-button">CHOOSE THIS VILLAGE →</button>');$('confirm-village').onclick=()=>{requestedVillageName=$('village-name-input').value.trim()||'The Northern Watch';const option=document.createElement('option');option.value='__new';option.textContent='New village: '+requestedVillageName;$('village-select').append(option);$('village-select').value='__new';updateVillageDetail();dialog.close();};};
async function authenticateAccount(){if(auth)return auth;auth=await api('/api/auth',{method:'POST',body:JSON.stringify({mode,name:$('name').value.trim(),password:$('password').value})});sessionStorage.setItem('emberwatch-session',JSON.stringify(auth));$('password').value='';$('password').required=false;$('password').placeholder='Session saved on this tab';$('join-button').innerHTML='ENTER THE VILLAGE <span>→</span>';return auth;}
$('lobby-crates-button').onclick=async()=>{if(connecting)return;if(!auth&&(!$('name').reportValidity()||!$('password').reportValidity()))return;connecting=true;$('join-button').disabled=true;$('lobby-crates-button').disabled=true;$('form-error').textContent='';try{await authenticateAccount();await crates.show();}catch(error){$('form-error').textContent=error.message;}finally{connecting=false;$('join-button').disabled=false;$('lobby-crates-button').disabled=false;}};
$('join-form').onsubmit=async e=>{e.preventDefault();if(connecting)return;connecting=true;$('join-button').disabled=true;$('form-error').textContent='';try{
  await authenticateAccount();
  let v=$('village-select').value;if(requestedVillageName||!v||v==='__new'){const data=await api('/api/villages',{method:'POST',body:JSON.stringify({name:requestedVillageName||'Emberwatch'})});v=data.village?.id||data.id;await loadVillages();}
  villageId=v;connect();
}catch(error){$('form-error').textContent=error.message;connecting=false;$('join-button').disabled=false;if(/session|token|expired|unauthor/i.test(error.message)){auth=null;sessionStorage.removeItem('emberwatch-session');$('password').required=true;}}};
const connection=createGameConnection({url:()=>`${location.protocol==='https:'?'wss':'ws'}://${location.host}/socket`,join:()=>{let resumeToken=null;try{resumeToken=sessionStorage.getItem('emberwatch-resume:'+villageId);}catch{}return {token:auth.token,villageId,role,statePatches:true,resumeToken};},onMessage:receiveMessage,onStatus:(status,detail={})=>{
 if(status==='connected'){chat.setConnected(true);$('connection').innerHTML='<i></i> CONNECTED';return;}
 chat.setConnected(false);keys.clear();heldGather?.stop();cameraLook?.stop();desired.x=desired.z=0;world?.plots?.resetEffects?.();gameAudio.reset();$('phoenix-button').disabled=true;
 if(status==='reconnecting'){if(joined){$('connection').textContent='RECONNECTING';toast(detail.message||'Rejoining the same village…',true);}return;}
 if(status==='failed'){if(joined)leave();connecting=false;$('join-button').disabled=false;$('form-error').textContent=detail.message||'Unable to join this village.';if(detail.code==='SESSION_EXPIRED'){auth=null;sessionStorage.removeItem('emberwatch-session');$('password').required=true;$('password').placeholder='Sign in again';}return;}
 if(status==='connecting')$('connection').textContent='CONNECTING';
}});
function connect(){connection.connect();}
function receiveMessage(m){const financeHandled=villageFinance.receive(m);if(m.type==='welcome'){
  if(m.resumeToken)try{sessionStorage.setItem('emberwatch-resume:'+villageId,m.resumeToken);}catch{}ownId=m.id||m.playerId;joined=true;connecting=false;chat.setConnected(true);$('join-button').disabled=false;$('lobby').hidden=true;$('hud').hidden=false;$('connection').innerHTML='<i></i> CONNECTED';$('village-name').textContent=villages.find(v=>v.id===villageId)?.name||requestedVillageName||'Emberwatch';requestedVillageName=null;toast('Click the scene to look around. Hold click to gather; E mounts or dismounts your horse.');lastStateAt=performance.now();$('world').focus({preventScroll:true});
}else if(m.type==='state'){if(!m.patch){poseTracks.clear();world?.resetResourceEffects?.();world?.plots?.resetEffects?.();gameAudio.reset();swordTrails?.reset();}state=m.patch?{...state,...m.state}:m.state;if(m.state.plots||!m.patch)dynamicSolids=plotSolids(state.plots||[]);lastStateAt=performance.now();worldClock.ingest(state,lastStateAt);for(const entity of [...state.players,...state.guards,...state.zombies,...(state.workers||[])]){if(entity.id===ownId)continue;let track=poseTracks.get(entity.id);if(!track){track=new PoseBuffer();poseTracks.set(entity.id,track);}track.push(entity,lastStateAt);}const prior=me;me=state.players.find(p=>p.id===ownId);if(me&&((!prior?.downed&&me.downed)||state.status==='fallen'))cameraLook?.stop();if(!m.patch&&me){predicted.x=me.x;predicted.z=me.z;desired.yaw=me.yaw??Math.PI;heldGather?.stop();}if(me&&!prior){selected=canEquip(me,me.tool)?me.tool:'';predicted.x=me.x;predicted.z=me.z;desired.yaw=me.yaw??Math.PI;cameraYaw=0;role=me.role;if(!savedHotbar&&me.role==='priest'){hotbar[7]='heal';renderHotbar();}}$('connection').innerHTML='<i></i> CONNECTED';if(me){if(prior&&prior.role!==me.role&&!savedHotbar){hotbar[7]=me.role==='priest'?'heal':'good_food';renderHotbar();}if(!canEquip(me,selected))selected='';if(!selected&&canEquip(me,me.tool))selected=me.tool;updateHUD();}}else if(['chat','chatHistory','typing'].includes(m.type)){chat.receive(m);}else if((m.type==='error'||m.type==='notice')&&!financeHandled){toast(m.message,m.type==='error');}}
function send(message){return connection.send(message);}
function inputBlocked(){return dialog.open||chat.isFocused()||['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)||document.activeElement?.isContentEditable;}
function gatherNodes(){const current=new Map((state?.resources||[]).map(n=>[n.id,n]));return [...RESOURCES.map(n=>resolveResource(n,current.get(n.id))),...(state?.plotResources||[])];}
function gatherStates(){return [...(state?.resources||[]),...(state?.plotResources||[])];}
function calculateInput(){let r=Number(keys.has('KeyD'))-Number(keys.has('KeyA')),f=Number(keys.has('KeyW'))-Number(keys.has('KeyS'));if(connection.status!=='connected'||inputBlocked()||me?.downed||me?.carriedBy||me?.bedPlotId||state?.status==='fallen')r=f=0;const length=Math.hypot(r,f)||1;r/=length;f/=length;desired.x=r*Math.cos(cameraYaw)-f*Math.sin(cameraYaw);desired.z=-r*Math.sin(cameraYaw)-f*Math.cos(cameraYaw);if(Math.hypot(desired.x,desired.z)>.1)desired.yaw=Math.atan2(desired.x,desired.z);}
setInterval(()=>{if(joined){calculateInput();sendInput();}},66);
function sendInput(){if(joined)send({type:'input',x:desired.x,z:desired.z,yaw:desired.yaw,sprint:keys.has('ShiftLeft')||keys.has('ShiftRight'),tool:foodIds.includes(selected)?'food':selected});}
function action(kind,extra={}){if(connection.status!=='connected'||!joined||!me||(me.downed&&kind!=='churchLeave')||dialog.open&&['attack','gather','repair'].includes(kind))return;sendInput();send({type:'action',kind,...extra});}
function useTool({targetId=null,quiet=false}={}){
 if(connection.status!=='connected'||!joined||!me||me.downed||inputBlocked()||me.carriedBy||me.bedPlotId)return;
 if(!selected||!canEquip(me,selected)){toast('Choose an owned tool from your hotbar. Buy your first tool at Oak & Iron.');return;}
 const now=performance.now();if(now-lastToolUse<580)return;
 if(foodIds.includes(selected)){lastToolUse=now;action('eat',{tier:selected});return;}
 if(me.mountedHorseId||me.carryingId){toast('Dismount or put down your companion before using equipment.');return;}
 const face=target=>{desired.yaw=Math.atan2(target.x-me.x,target.z-me.z);};
 const swing=()=>{lastToolUse=now;localActionId++;};
 if(selected==='sword'||selected==='bow'){if(selected==='bow')desired.yaw=cameraYaw+Math.PI;swing();action('attack');sound('swing');}
 else if(selected==='hammer'){
   const choices=[{id:'gate',x:0,z:18,...state.gate},{id:'keep',...BUILDINGS.find(b=>b.id==='keep'),...state.keep},...(state.plots||[]).filter(p=>p.building).map(p=>({...PLOTS.find(v=>v.id===p.id),...p,plot:true}))];
   const target=choices.filter(p=>p.hp<p.maxHp).sort((a,b)=>distance(a,me)-distance(b,me))[0];
   if(!target||distance(target,me)>(target.plot?12:target.id==='gate'?9:14)){toast('Move beside a damaged structure to repair it.');return;}
   face(target);swing();action(target.plot?'repairPlot':'repair',target.plot?{plotId:target.id}:{targetId:target.id});sound('tap');
 }else if(selected==='heal'){
   if((me.healRemaining??0)>0)return;
   const target=nearestHealingTarget(me,state.players,state.guards);
   if(target&&distance(target,me)<=3.5){face(target);swing();action('heal',{targetId:target.id});}else toast('Stand beside a wounded ally or town guard to offer a blessing.');
 }else{
   const type={axe:'timber',pickaxe:'stone',scythe:'wheat'}[selected];
   const target=nearestGatherable(me,selected,gatherNodes(),gatherStates());
   if(target&&distance(target,me)<=3.3&&(!targetId||target.id===targetId)){face(target);swing();action('gather',{targetId:target.id});sound('tap');return true;}
   else if(!quiet)toast('Move closer to '+({timber:'a tree',stone:'a stone outcrop',wheat:'a wheat stalk'}[type])+'.');
 }
}
function distance(a,b){return Math.hypot(a.x-b.x,a.z-b.z);}
function updateInteraction(){
 if(!me||me.downed||inputBlocked()||me.bedPlotId||me.carriedBy){$('interaction').hidden=true;interaction=null;return;}
 const candidate=chooseInteraction(me,selected,gatherNodes(),gatherStates(),BUILDINGS),companion=directCompanionInteraction(me,state.horses||[]);interaction=null;
 const churchBed=me.carryingId&&choosePlotInteraction(me,PLOTS,state.plots);
 if(churchBed?.atBed)interaction={kind:'church',id:churchBed.site.id,title:'Bring your companion to a church bed',subtitle:'Press E for treatment · G to put down'};
 else if(companion)interaction=companion;
 else if(noticeboardTakesPriority(me,candidate))interaction={kind:'noticeboard',title:'Village request board',subtitle:'Read funded requests · Mark a delivery entrance'};
 else if(candidate?.kind==='gather')interaction={...candidate,title:{timber:'Chop this tree',stone:'Mine this outcrop',iron:'Mine this iron',coal:'Mine this coal',wheat:'Harvest this wheat'}[candidate.resource.type],subtitle:`${productionYield(TOOL_TIERS[me.tiers?.[selected]||'wood'].yield,state.plots?.find(p=>p.id===candidate.resource.plotId))} resources per swing · Tool durability ${pretty(me.durability?.[selected])}`};
 else if(candidate?.kind==='repair'&&state.gate.hp<state.gate.maxHp)interaction={...candidate,title:'Repair the gate',subtitle:`${pretty(state.gate.hp)} / ${pretty(state.gate.maxHp)} health · Uses village supplies`};
 else if(candidate?.building){const b=candidate.building;interaction={kind:b.kind,id:b.id,title:b.name,subtitle:{bank:'Protect your savings and manage loans',market:'Buy and sell village resources · Sell max',shop:'Buy basic wooden tools',food:'Buy meals to carry and eat later',church:'Priest care and the church registry',barracks:'Feed and inspect the village watch',stable:'Buy horses and prepare for travel',merchant:state.merchant?.present?'Tavern games & traveling merchant · Open day and night':'Tavern games are open · Merchant returns on his next visit',keep:'Village policies and council votes'}[b.kind]};}
 if(!interaction){const carried=me.carryingId;const downed=!carried&&state.players.filter(p=>p.online&&p.downed&&!p.carriedBy&&!p.bedPlotId&&p.id!==ownId&&distance(me,p)<=2.5).sort((a,b)=>distance(me,a)-distance(me,b))[0];
  if(downed)interaction={kind:'carry',id:downed.id,title:'Carry '+downed.name,subtitle:'Bring this dwarf to a player church · G to put down'};
  else {const cart=state.carts?.find(c=>c.ownerId===ownId&&distance(me,c)<=3);const plot=choosePlotInteraction(me,PLOTS,state.plots);if(cart)interaction={kind:'cart',id:cart.id,title:'Your cargo cart',subtitle:'Store supplies or attach to a horse'};else if(plot){const owned=plot.state;interaction={kind:plot.atBed?'church':'plot',id:plot.site.id,title:plot.atBed?'Church beds':plot.site.name,subtitle:plot.atBed?'Rest or bring a fallen dwarf for treatment':owned?.ownerId===ownId?'Build, stock, and manage your plot':owned?.ownerId?'Visit this player’s plot':'Buy this plot and choose a building'};}}
 }
 $('interaction').hidden=!interaction;if(interaction){$('interaction-title').textContent=interaction.title;$('interaction-subtitle').textContent=interaction.subtitle;}
}
function interact(){heldGather?.stop();updateInteraction();if(!interaction)return;if(['dropPlayer','dismountHorse'].includes(interaction.kind)){action(interaction.kind);return;}if(interaction.kind==='mountHorse'){action('mountHorse',{targetId:interaction.id});return;}if(['repair','gather'].includes(interaction.kind)){useTool();return;}if(interaction.kind==='noticeboard'){requests.show();return;}if(interaction.kind==='carry'){action('carryPlayer',{targetId:interaction.id});return;}const panels={bank:'bank',market:'market',shop:'tools',food:'food',church:'church',barracks:'barracks',stable:'stable',merchant:'merchant',keep:'policies',plot:'plot',horse:'horse',cart:'cart'};if(panels[interaction.kind])settlement.show(panels[interaction.kind],interaction.id);}
let lastToast='',lastToastAt=0;
function toast(message,error=false){if(!message)return;const now=performance.now();if(message===lastToast&&now-lastToastAt<4500)return;lastToast=message;lastToastAt=now;const e=document.createElement('div');e.className='toast'+(error?' error':'');e.textContent=message;$('toast-area').append(e);while($('toast-area').children.length>2)$('toast-area').firstChild.remove();setTimeout(()=>e.remove(),4500);}
function openPanel(content,panel=null){chat.close();resumeMouseAfterPanel=joined&&connection.status==='connected';activePanel=panel;dialog.classList.toggle('settlement-dialog',['settlement','requests','guard-orders','progression','trading','crates','investments','tavern','village-menu','graphics'].includes(panel));keys.clear();desired.x=desired.z=0;sendInput();cameraLook?.stop();$('panel-content').innerHTML=content;if(!dialog.open)dialog.showModal();}
function panelAction(id,kind,extra={},refresh=null){$(id).onclick=()=>{send({type:'action',kind,...extra});if(refresh)setTimeout(refresh,160);};}
function showInventory(){settlement.show('inventory');}
function showBank(){settlement.show('bank');}
function updateBank(){settlement.refresh();requests.update();guardOrders.update();progression.refresh();trading.update();crates.update(state?.crates);}
function showShop(){settlement.show('tools');}
function showFood(){settlement.show('food');}
function showWatch(){settlement.show('barracks');}
function showHelp(){openPanel(`<p class="eyebrow">YOUR FIRST WATCH</p><h2>Know your way around.</h2><div class="help-grid"><kbd>W A S D</kbd><span>Move through the village</span><kbd>Mouse</kbd><span>Click the scene once to capture the mouse, then move it to look around</span><kbd>Shift</kbd><span>Sprint while your hunger allows</span><kbd>Left click</kbd><span>Use your equipment; hold to keep mining, chopping, or harvesting</span><kbd>1–8 / Scroll</kbd><span>Select a tool or item</span><kbd>E</kbd><span>Mount or dismount your horse, put down a companion, read the board, or use nearby buildings</span><kbd>Enter</kbd><span>Open village chat and type; Enter again to send</span><kbd>T</kbd><span>Toggle the village chat panel</span><kbd>I</kbd><span>Check your pack and village supplies</span><kbd>G</kbd><span>Put down a carried dwarf, leave a bed, or dismount</span><kbd>M</kbd><span>Village atlas and player plots</span><kbd>R</kbd><span>Commands for your barracks troops</span><kbd>H</kbd><span>Open these controls</span><kbd>F</kbd><span>Toggle fullscreen</span><kbd>Esc</kbd><span>Release the mouse and open the menu; click the scene to resume looking</span></div><h3>Prepare, then stand together.</h3><p>Start with 10 gold and empty hands. Buy one wooden tool at Oak & Iron. Use an axe on trees, a pickaxe in the mountain mine at the north end of the village, and a scythe on wheat. Stone is guaranteed in the upper mine; iron and coal appear farther down. Sell or donate at the Resource Exchange north of the stables. Bank your gold at the treasury. Watch hunger below your health bar. At night, your sword sweeps enemies in front of you. Move outside red circles before attacks land, or use a hammer to repair the gate. A priest’s blessing can save a fallen ally.</p><p>Read the request board on the treasury’s east wall. Mark a delivery entrance, then press E at that destination and choose Requested deliveries to receive the posted payment. The board icon marks where to find the board.</p>`);}
function villageMenuCard(id,title,description,art){return `<button id="${id}" class="village-menu-card"><span class="village-menu-art">${art}</span><span><strong>${title}</strong><small>${description}</small></span><b aria-hidden="true">↗</b></button>`;}
function showMenu(){
 if(!joined)return;
 openPanel(`<div class="village-menu"><header class="village-menu-heading"><div><p class="eyebrow">THE WATCH CONTINUES</p><h2>Your village. Your next move.</h2><p>${state?.players?.filter(p=>p.online).length||0} residents online · Day ${state?.day||1} · ${pretty(me?.wallet)} gold in your wallet</p></div><span>${buildingArt('house')}</span></header>
 <div class="village-menu-grid">
 ${villageMenuCard('menu-pack','Your inventory','Every supply, tool and carrying slot',itemArt('backpack',{level:me?.backpackTier||0}))}
 ${villageMenuCard('menu-crates','Crates & equipment','Open rewards and prepare your next run','<img src="/assets/crate-items/dawnsteel_helm.png" alt="">')}
 ${villageMenuCard('menu-workers','Your workers','Hire, train and direct up to five workers',itemArt('pickaxe'))}
 ${villageMenuCard('menu-investments','Village investments','Invest, collect dividends or reinvest',itemArt('gold'))}
 ${villageMenuCard('menu-tavern','The Wayfarer tavern','Coin flip and roulette · Bet wallet gold',buildingArt('house'))}
 ${villageMenuCard('menu-atlas','Village atlas','Find resources and manage up to eight plots',buildingArt('mine'))}
 ${villageMenuCard('menu-trading','Player trading','Swap supplies and gold with a neighbor',itemArt('timber'))}
 ${villageMenuCard('menu-orders','Guard commands','Direct your troops and inspect the watch',buildingArt('barracks'))}
 ${villageMenuCard('menu-honors','Honors & appearance','Your milestones and earned styles','<img src="/assets/crate-items/sunforged_viking_helm.png" alt="">')}
 </div>
 ${me?.testAdmin?'<div class="panel-row"><span>Admin testing<br><small>Top up wallet and bank to 10,000,000 gold each.</small></span><button id="admin-refill-gold">Refill test gold</button></div>':''}
 ${state?.devTools?'<div class="panel-row"><span>Local development control</span><button id="start-night">Start night</button></div>':''}
 <div class="village-menu-footer"><button id="sound-toggle">Sound ${muted?'off':'on'}</button><button id="menu-help">Controls</button><button id="menu-graphics">Graphics</button><button id="build-status">What’s new</button><button id="menu-role">Change role</button><button id="menu-requests">Request board</button><button id="menu-guide">First-watch guide</button><button id="leave-button">Leave village</button></div></div>`,'village-menu');
 $('sound-toggle').onclick=()=>{muted=!muted;gameAudio.setMuted(muted);showMenu();};
 $('menu-help').onclick=showHelp;$('menu-graphics').onclick=()=>graphicsUI.show();$('build-status').onclick=showBuildStatus;$('menu-pack').onclick=showInventory;
 $('menu-crates').onclick=()=>crates.show();$('menu-trading').onclick=()=>trading.show();$('menu-workers').onclick=()=>settlement.show('workers');
 $('menu-investments').onclick=()=>villageFinance.showInvestments();$('menu-tavern').onclick=()=>villageFinance.showTavern();
 $('menu-role').onclick=()=>settlement.show('roles');$('menu-atlas').onclick=()=>settlement.show('atlas');
 $('menu-requests').onclick=()=>requests.findBoard();$('menu-orders').onclick=()=>guardOrders.show();
 $('menu-honors').onclick=()=>progression.show();$('menu-guide').onclick=()=>{progression.showGuide();dialog.close();};
 $('leave-button').onclick=leave;
 if($('admin-refill-gold'))panelAction('admin-refill-gold','admin_refill_gold');
 if($('start-night'))panelAction('start-night','startNight',{},()=>dialog.close());
}
function showBuildStatus(){
 const feature=(art,title,copy)=>`<article class="build-feature"><span>${art}</span><div><h3>${title}</h3><p>${copy}</p></div></article>`;
 openPanel(`<div class="village-menu"><header class="village-menu-heading"><div><p class="eyebrow">FIRST LIGHT · BUILD 24</p><h2>Tavern bets stay responsive.</h2><p>Changing village balances no longer interrupt a button press at the tavern. Clear stake guidance explains when a bet is unavailable.</p></div><span>${itemArt('gold')}</span></header><div class="build-feature-grid">
 ${feature(buildingArt('house'),'Reliable tavern controls','Wallet and treasury updates keep your button press intact. The tavern explains stake limits beside Place bet, and checks current funds before accepting a wager.')}
 ${feature(itemArt('gold'),'Merchant exports by percentage','Choose Conserve (25%), Balanced (50%) or Trade (100%) through the Village Council. The steward sets aside food and repair reserves first, then sells that share of the remaining wheat, timber and stone.')}
 ${feature(buildingArt('mine'),'Stable mine lighting','Nearby torches reuse one fixed light pool as you enter and leave the mine, avoiding repeated lighting shader changes at the entrance. Cave lighting, mining and camera collision stay intact.')}
 ${feature(itemArt('gold'),'Quick Sell your haul','Sell every eligible carried raw resource in one protected transaction while the treasury keeps its emergency reserve. Personal loans now allow up to 1,000 gold of outstanding purchase credit.')}
 ${feature(itemArt('cart'),'A working carriage chest','The cart has an attached rear storage chest. Press E at the cart to open its real cargo inventory; the lid opens with the panel and E closes it again.')}
 ${feature(buildingArt('house'),'Merchant bargains','Each merchant visit brings a different pair of specialist goods at a 20–30% discount. Stock stays fixed for the visit, preventing menu rerolls.')}
 ${feature(itemArt('pickaxe'),'Worker movement restored','Workers correctly finish their prepaid work time and renew wages. Finding a route around an obstacle keeps running at normal speed, so an almost-empty wage balance cannot leave a worker stuck. Existing workers keep their orders and cargo.')}
 ${feature(buildingArt('barracks'),'Balanced defense rewards','The village night-defense award now tops out at 5,000 gold for one defended night, regardless of the number of residents.')}
 ${feature(itemArt('pickaxe'),'Keep gathering','Hold the mouse button while moving between nearby matching nodes. Mining, chopping and wheat harvesting continue without another click. Close a menu and mouse capture returns immediately.')}
 ${feature(buildingArt('keep'),'A guide you can follow','The first-watch tutorial now uses illustrated step cards, a progress meter, a visual checklist and map markers for every destination.')}
 ${feature(buildingArt('tree_farm'),'A richer landscape','Explore textured stone, timber and earth, organic woodland, layered mountain ridges and more detailed village structures.')}
 ${feature(buildingArt('church'),'From sunlight to moonlight','A detailed lunar surface, atmospheric sun, softer cloud layers and sharper nearby shadows change with the village day. Choose your preferred detail level in Graphics.')}
 ${feature(itemArt('backpack'),'Your pack, at a glance','The corner inventory shows every carried resource and provision, with tools, equipment and carrying weight. Open I for full inventory controls.')}
 ${feature('<img src="/assets/crate-items/dawnsteel_helm.png" alt="">','See the rewards','Browse illustrated crate tiers and equipment cards. Inspect odds, costs and bonuses, then open a saved reward or choose your next run’s loadout.')}
 ${feature(buildingArt('mine'),'Build a bigger operation','Own up to eight plots and hire five workers. Upgrade mines, tree farms and wheat farms through level 3 for higher yield, larger reserves, quicker regrowth and more storage.')}
 ${feature(buildingArt('cannon'),'Upgrades you can see','Compare each upgrade’s exact benefits before buying. Improved structures and troops gain visible reinforcements; cannon impacts burst into fire, sparks and smoke.')}
 ${feature(itemArt('gold'),'Invest in your village','Visit the treasury to contribute wallet gold. Eligible investments earn 1% per completed village day when funds are available. Collect earnings or reinvest them to grow your future dividends.')}
 ${feature(buildingArt('house'),'A seat at The Wayfarer','The tavern is open day and night for coin flip and European roulette. Your stake comes from your wallet; winnings and losses settle with the village treasury.')}
 </div><p class="build-feature-note">Bank savings and permanent crate unlocks survive between villages. Investments belong to their village; read the treasury’s withdrawal and payout rules before contributing.</p></div>`,'village-menu');
}
function leave(){graphicsUI.clear();inventoryHUD.clear();villageFinance.clear();defenseTroopWorld?.clear();world?.plots?.resetEffects?.();crateEquipmentWorld?.clear();crates.clear();cosmeticsWorld?.clear();swordTrails?.reset();gameAudio.reset();trading.clear();heldGather?.stop();progression.clear();requests.clear();guardOrders.clear?.();worldClock.reset();world?.resetResourceEffects?.();selected='';cameraLook.stop();settlement.clear();chat.reset();chat.setConnected(false);connection.close();joined=false;connecting=false;state=null;me=null;ownId=null;keys.clear();dialog.close();$('lobby').hidden=false;$('hud').hidden=true;$('join-button').disabled=false;for(const a of actors.values()){scene.remove(a.rig.group);a.rig.dispose();a.label?.remove();}actors.clear();poseTracks.clear();localActionId=0;lastToolUse=-Infinity;loadVillages();}
document.querySelector('.close-dialog').onclick=()=>dialog.close();dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
$('help-button').onclick=showHelp;$('menu-button').onclick=showMenu;$('inventory-button').onclick=showInventory;$('interaction').onclick=interact;$('new-run-button').onclick=leave;
$('map-button').onclick=()=>settlement.show('atlas');$('requests-button').onclick=()=>requests.findBoard();$('orders-button').onclick=()=>guardOrders.show();
$('respawn-button').onclick=()=>send({type:'action',kind:'respawn'});
$('phoenix-button').onclick=()=>{if(me?.downed&&state?.crates?.run?.phoenixAvailable&&connection.status==='connected'){send({type:'action',kind:'phoenix_revive'});$('phoenix-button').disabled=true;}};
$('tour-button').onclick=()=>{tour=!tour;$('welcome')?.classList.toggle('tour',tour);$('tour-button').textContent=tour?'Return to the village view ↙':'Explore the view ↗';};
function updateHUD(){inventoryHUD.update(me);villageFinance.update();const night=state.phase==='night';$('day-label').textContent=(night?'NIGHT ':'DAY ')+state.day;$('phase-icon').textContent=night?'☾':'☀';$('phase-label').textContent=sampleSkyCycle(worldClock.sample(performance.now())?.cycle??(night?.75:.25)).label;const seconds=Math.max(0,Math.ceil(state.phaseRemaining));$('clock').textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
 $('objective-title').textContent=night?(state.siegeNight?'The siege is here':'Hold the gate together'):'Make ready for nightfall';$('objective-text').textContent=night?'Move out of red attack warnings. Keep the Hearthkeep standing and protect your allies.':'Gather supplies and check the noticeboard. Prepare the village for darkness.';$('threat-label').textContent=night?`${state.zombies.length} zombies on the road`:(state.day%5===0?'Siege night ahead · prepare for the Gravebreaker':'The graveyard stirs at dusk');
 const siege=state.zombies.find(z=>z.kind==='siege'&&z.hp>0);$('siege-health').hidden=!siege;if(siege){$('siege-hp').textContent=pretty(siege.hp)+' / '+pretty(siege.maxHp);$('siege-bar').style.width=Math.max(0,siege.hp/siege.maxHp*100)+'%';}
 $('orders-button').hidden=me.role!=='guard';const openRequests=state.requests?.items?.filter(r=>r.status==='open').length||0;$('requests-button').title='Find request board · '+openRequests+' open';
 for(const type of ['gate','keep']){const s=state[type];$(`${type}-text`).textContent=pretty(s.hp)+' / '+pretty(s.maxHp);$(`${type}-bar`).style.width=Math.max(0,s.hp/s.maxHp*100)+'%';}
 $('player-name').textContent=me.name;$('player-role').textContent=me.role.toUpperCase();$('role-portrait').innerHTML=icon(me.role);$('wallet').textContent=pretty(me.wallet);$('hp-text').textContent=pretty(me.hp)+' / '+pretty(me.maxHp);$('hp-bar').style.width=Math.max(0,me.hp/me.maxHp*100)+'%';$('shield-status').hidden=!(me.maxShield>0);$('shield-text').textContent=pretty(me.shield)+' / '+pretty(me.maxShield);$('shield-bar').style.width=(me.maxShield?Math.max(0,me.shield/me.maxShield*100):0)+'%';$('supplies').innerHTML=['timber','stone','wheat'].map(r=>`<span title="${r}">${icon(r)}${pretty(me.inventory?.[r])}</span>`).join('');
 const hunger=Math.max(0,Math.min(100,Math.floor(me.hunger??100)));$('hunger-text').textContent=hunger+' / 100';$('hunger-bar').style.width=hunger+'%';$('hunger-meter').setAttribute('aria-valuenow',hunger);$('hunger-meter').classList.toggle('low',hunger<=25);$('hunger-label').textContent=hunger===0?'HUNGER · EAT TO SPRINT':hunger<=25?'HUNGER · LOW':'HUNGER';updateBank();
 const online=state.players.filter(p=>p.online).length;$('residents-label').textContent=online+' ONLINE · '+(state.players.length-online)+' OFFLINE';$('location-label').textContent=caveAreaAt(me.x,me.z)?`${caveAreaAt(me.x,me.z).tier.toUpperCase()} MINE · ${Math.round(caveDepthAt(me.x,me.z))} M BELOW` :me.z>23?'BEYOND THE GATE':Math.abs(me.x)>36?'THE HEARTH DISTRICTS':me.z<-55?'NORTHERN VILLAGE':'VILLAGE SQUARE';
 $('carry-status').textContent=`PACK ${inventoryWeight(me)} / ${carryCapacity(me)}`+(me.carryingId?' · CARRYING A DWARF · E / G TO PUT DOWN':me.mountedHorseId?' · MOUNTED · E / G TO DISMOUNT':me.bedPlotId?' · RECOVERING IN BED · G TO LEAVE':me.carriedBy?' · AN ALLY IS CARRYING YOU':'');
 updateHotbar();
 const phoenixAvailable=Boolean(state.crates?.run?.phoenixAvailable);$('phoenix-button').hidden=!phoenixAvailable;$('phoenix-button').disabled=!me.downed||!phoenixAvailable||connection.status!=='connected'||state.status==='fallen';$('phoenix-status').textContent=phoenixAvailable?'Reserve Ember: revive at 40% health, keeping your equipment, supplies and wallet. One use this run.':state.crates?.run?.forfeited?'Phoenix eligibility was forfeited by manual respawn. Permanent unlocks remain.':'No Phoenix Ember is equipped for this run.';
 $('downed').hidden=!me.downed||state.status==='fallen';$('fallen').hidden=state.status!=='fallen';$('respawn-button').disabled=!me.respawnAvailable;$('respawn-button').textContent=me.respawnAvailable?'RESPAWN · LOSE INVENTORY & 25% WALLET':'WAITING FOR DAWN';$('downed-message').textContent=me.respawnAvailable?'Dawn has arrived. You may respawn now, or keep waiting for a priest to save your belongings.':'A priest can bring you back. You can choose to respawn when dawn arrives.';
}
window.addEventListener('keydown',e=>{const typing=['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)||e.target.isContentEditable;if(e.code==='KeyF'&&!typing&&!e.repeat){e.preventDefault();if(document.fullscreenElement)document.exitFullscreen();else document.documentElement.requestFullscreen().catch(()=>{});return;}if(dialog.open&&e.code==='KeyE'&&!typing&&!e.repeat&&settlement.getCurrent()?.kind==='cart'){e.preventDefault();dialog.close();activePanel=null;$('world').focus({preventScroll:true});return;}if(dialog.open||chat.isFocused()||typing)return;if(!joined)return;if(e.code==='Enter'||e.code==='NumpadEnter'){e.preventDefault();if(!e.repeat)chat.focus();return;}if(e.code==='KeyT'){e.preventDefault();if(!e.repeat)chat.toggle();return;}if(['Space','Tab'].includes(e.code))e.preventDefault();keys.add(e.code);calculateInput();sendInput();if(e.repeat)return;if(/^Digit[1-8]$/.test(e.code))selectTool(hotbar[Number(e.code.at(-1))-1]);if(e.code==='KeyR')guardOrders.show();if(e.code==='KeyI')showInventory();if(e.code==='KeyM')settlement.show('atlas');if(e.code==='KeyG'){if(me?.carryingId)action('dropPlayer');else if(me?.mountedHorseId)action('dismountHorse');else if(me?.bedPlotId)action('churchLeave');}if(e.code==='KeyE')interact();if(e.code==='KeyH')showHelp();if(e.code==='Escape')showMenu();});
window.addEventListener('keyup',e=>{keys.delete(e.code);calculateInput();sendInput();});window.addEventListener('blur',()=>{keys.clear();cameraLook?.stop();desired.x=desired.z=0;sendInput();});
cameraLook=bindCameraLook({surfaces:[$('world'),$('downed'),$('fallen')],host:window,enabled:()=>joined&&connection.status==='connected'&&!inputBlocked(),rotate:(x,y)=>{cameraYaw-=x*.005;cameraPitch=THREE.MathUtils.clamp(cameraPitch+y*.003,-.95,.95);},onLockChange:locked=>{document.body.classList.toggle('mouse-captured',locked);if(!locked){heldGather?.stop();keys.clear();desired.x=desired.z=0;sendInput();}},onError:()=>toast('Mouse capture was unavailable. Click the scene to try again.',true)});
const gatherTarget=()=>{if(!me)return null;const target=nearestGatherable(me,selected,gatherNodes(),gatherStates());return target?{id:target.id,tool:selected}:null;};
heldGather=createHeldGather({canContinue:()=>joined&&connection.status==='connected'&&!!me&&!me.downed&&!me.carriedBy&&!me.bedPlotId&&!me.carryingId&&!me.mountedHorseId&&!inputBlocked()&&cameraLook.isLocked()&&canEquip(me,selected)&&performance.now()-lastStateAt<1500,getTarget:gatherTarget,use:target=>useTool({targetId:target.id,quiet:true})});
$('world').addEventListener('mousedown',e=>{if(e.button!==0||e.defaultPrevented||!cameraLook.isLocked()||!joined||inputBlocked())return;const target=gatherTarget();useTool();if(target)heldGather.start(target);});
window.addEventListener('mouseup',e=>{if(e.button===0)heldGather.stop();},true);
window.addEventListener('pointercancel',()=>heldGather.stop());
document.addEventListener('pointerdown',e=>{if(e.target!==$('world'))heldGather.stop();},true);
dialog.addEventListener('close',()=>{activePanel=null;heldGather.stop();$('world').focus({preventScroll:true});if(resumeMouseAfterPanel&&joined&&connection.status==='connected')cameraLook.request($('world'));resumeMouseAfterPanel=false;});
$('world').addEventListener('wheel',e=>{if(!joined||inputBlocked())return;e.preventDefault();const usable=hotbar.filter(id=>canEquip(me,id));if(!usable.length)return;let i=usable.indexOf(selected);selectTool(usable[(i+(e.deltaY>0?1:-1)+usable.length)%usable.length]);},{passive:false});
function sound(kind){gameAudio.play(kind==='tap'?selected==='axe'?'wood':selected==='scythe'?'gather':selected==='hammer'?'repair':'stone':kind,{position:me||predicted});}

let scene,renderer,camera,world,sun,skyLight,nightMix=0;
function fail(error){$('loading').hidden=true;$('fatal').hidden=false;$('fatal-message').textContent='A WebGL-capable desktop browser is required. '+(error.message||error);console.error(error);}
async function boot(){
 scene=new THREE.Scene();scene.background=new THREE.Color('#b5c9bd');scene.fog=new THREE.FogExp2('#b5c9bd',.006);
 renderer=new THREE.WebGLRenderer({canvas:$('world'),antialias:true,powerPreference:'high-performance'});renderer.info.autoReset=false;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.14;
 camera=new THREE.PerspectiveCamera(52,innerWidth/innerHeight,.1,360);camera.position.set(33,24,50);camera.lookAt(0,3,-8);
 skyLight=new THREE.HemisphereLight('#e6eddb','#354542',2.5);scene.add(skyLight);sun=new THREE.DirectionalLight('#ffe3ad',3.3);sun.position.set(-75,140,90);sun.target.position.set(0,0,-30);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-48;sun.shadow.camera.right=48;sun.shadow.camera.top=48;sun.shadow.camera.bottom=-48;sun.shadow.camera.near=1;sun.shadow.camera.far=400;sun.shadow.bias=-.00012;sun.shadow.normalBias=.025;scene.add(sun,sun.target);
 const fill=new THREE.DirectionalLight('#bddce1',.5);fill.position.set(40,25,-45);scene.add(fill,fill.target);
 const pipeline=createRenderPipeline(renderer,scene,camera),reflection=createSkyReflection(renderer,scene);
 renderQuality.apply(renderer,{sun,fill,camera});
 const applyQuality=()=>{qualitySettings=renderQuality.getSettings();configureSurfaceTextures({anisotropy:Math.min(qualitySettings.anisotropy,renderer.capabilities.getMaxAnisotropy()),normalMaps:qualitySettings.effectivePreset!=='low'});pipeline.configure(qualitySettings);graphicsUI.update();};
 renderQuality.subscribe(applyQuality);
 world=createWorld(scene);const cave=createCaveWorld(scene),torches=createTorchSystem(scene,[...world.torchFixtures,...cave.torchFixtures]),caveFog=new THREE.Color('#20292d'),caveAmbient=new THREE.Color('#9dacae');const transportWorld=createTransportWorld(scene),sky=createSkyEnvironment(scene,{sun,skyLight,fill}),guardRallies=createGuardRallies(scene);createNoticeboard(scene);cosmeticsWorld=createCosmeticsWorld(scene);crateEquipmentWorld=createCrateEquipmentWorld();defenseTroopWorld=createDefenseTroopWorld();swordTrails=createSwordTrails(scene);gameAudio.setSurfaceResolver(createFootstepSurface(world.root.userData.lanes));
 const menuActors=[];for(const [kind,x,z,yaw] of [['guard',-2,24,0],['guard',2,28,.15],['villager',-4,6,-.5],['priest',8,-7,-1]]){const rig=createCharacter(kind,menuActors.length+1);rig.group.position.set(x,0,z);rig.group.rotation.y=yaw;scene.add(rig.group);menuActors.push(rig);}
 const dustGeo=new THREE.BufferGeometry(),dustPositions=new Float32Array(80*3);for(let i=0;i<80;i++){dustPositions[i*3]=(Math.random()-.5)*70;dustPositions[i*3+1]=Math.random()*7+.8;dustPositions[i*3+2]=Math.random()*80-40;}dustGeo.setAttribute('position',new THREE.BufferAttribute(dustPositions,3));const dustMat=new THREE.PointsMaterial({color:'#ffe7ac',size:.075,transparent:true,opacity:.45,depthWrite:false});const dust=new THREE.Points(dustGeo,dustMat);scene.add(dust);
 const clock=new THREE.Clock(),camTarget=new THREE.Vector3(),camDesired=new THREE.Vector3(),camAnchor=new THREE.Vector3();let elapsed=0,netElapsed=0,interactionElapsed=0;
 function frame(){heldGather?.tick();const rawDt=clock.getDelta(),dt=Math.min(rawDt,.05);elapsed+=rawDt;requestAnimationFrame(frame);menuActors.forEach((r,i)=>{r.group.visible=!joined;r.update(dt,elapsed,{moving:false,tool:i<2?'sword':i===3?'heal':'axe'});});
   const skyTime=joined?worldClock.sample(performance.now()):null;let ownMotionSpeed=0,frameEntities=[];
   if(joined&&me){
     let right=Number(keys.has('KeyD'))-Number(keys.has('KeyA')),forward=Number(keys.has('KeyW'))-Number(keys.has('KeyS'));if(connection.status!=='connected'||inputBlocked()||me.downed||me.carriedBy||me.bedPlotId||state.status==='fallen')right=forward=0;const len=Math.hypot(right,forward)||1;right/=len;forward/=len;desired.x=right*Math.cos(cameraYaw)-forward*Math.sin(cameraYaw);desired.z=-right*Math.sin(cameraYaw)-forward*Math.cos(cameraYaw);if(Math.hypot(desired.x,desired.z)>.1)desired.yaw=Math.atan2(desired.x,desired.z);
     const sprint=(keys.has('ShiftLeft')||keys.has('ShiftRight'))&&(me.hunger??100)>0;let speed=me.mountedHorseId?TRANSPORT.horseSpeed:sprint?CONFIG.sprintSpeed:CONFIG.speed;if(me.carryingId)speed=CONFIG.speed*.55;if(inventoryWeight(me)>carryCapacity(me))speed*=.65;if(Math.hypot(predicted.x-me.x,predicted.z-me.z)>3){predicted.x=me.x;predicted.z=me.z;}else {predicted.x=THREE.MathUtils.lerp(predicted.x,me.x,1-Math.exp(-dt*4));predicted.z=THREE.MathUtils.lerp(predicted.z,me.z,1-Math.exp(-dt*4));}if(performance.now()-lastStateAt<1500)moveWithCollision(predicted,desired.x*speed*dt,desired.z*speed*dt,me.mountedHorseId?.8:CONFIG.playerRadius,dynamicSolids);
     interactionElapsed+=dt;if(interactionElapsed>.15){interactionElapsed=0;updateInteraction();drawMap();}
     const activeIds=new Set();const entities=frameEntities=[...state.players.filter(p=>p.online),...state.guards.map(g=>({...g,role:'guard'})),...state.zombies.map(z=>({...z,role:'zombie'})),...(state.workers||[])];
     for(const entity of entities){activeIds.add(entity.id);let a=actors.get(entity.id);if(!a){const rig=entity.role==='zombie'?createZombiePresentation(entity,hash(entity.id)):createCharacter(entity.role||'villager',hash(entity.id));scene.add(rig.group);rig.group.position.set(entity.x,groundHeight(entity.x,entity.z),entity.z);const label=document.createElement('div');label.className='nameplate'+(entity.role==='zombie'?' enemy':'');label.innerHTML='<span></span><i><b></b></i><div class="speech-bubble" hidden></div>';$('nameplates').append(label);a={rig,label,role:entity.role,lastX:entity.x,lastZ:entity.z};actors.set(entity.id,a);}if(a.role!==entity.role){a.rig.setRole?.(entity.role);a.role=entity.role;}a.rig.setClothingColor?.(entity.color);
       const group=a.rig.group,isMe=entity.id===ownId,pose=isMe?null:poseTracks.get(entity.id)?.sample(performance.now());
       const x=isMe?predicted.x:(pose?.x??entity.x),z=isMe?predicted.z:(pose?.z??entity.z);
       if(isMe){group.position.x=THREE.MathUtils.lerp(group.position.x,x,1-Math.exp(-dt*28));group.position.z=THREE.MathUtils.lerp(group.position.z,z,1-Math.exp(-dt*28));}
       else{group.position.x=x;group.position.z=z;}
       group.position.y=groundHeight(group.position.x,group.position.z)+(entity.mountedHorseId?1.35:entity.carriedBy?1.25:entity.bedPlotId ? .45 : 0);
       const yaw=isMe?desired.yaw:(pose?.yaw??entity.yaw??0);let d=yaw-group.rotation.y;d=Math.atan2(Math.sin(d),Math.cos(d));group.rotation.y+=d*(1-Math.exp(-dt*14));
       const renderedSpeed=Math.hypot(group.position.x-a.lastX,group.position.z-a.lastZ)/Math.max(rawDt,.001);a.lastX=group.position.x;a.lastZ=group.position.z;
       if(isMe)ownMotionSpeed=renderedSpeed;
       const motionSpeed=isMe?Math.min(speed,renderedSpeed):(pose?.speed??0),moving=motionSpeed>.12&&!entity.downed&&entity.hp>0&&!entity.mountedHorseId&&!entity.carriedBy&&!entity.bedPlotId;
       const remoteAnim=pose?.anim??entity.anim;
       const motionOptions={moving,speed:motionSpeed,attack:isMe?localActionId:['attack','attacking','gather','repair'].includes(remoteAnim),channeling:isMe?(me.healRemaining??0)>0:remoteAnim==='heal',downed:entity.downed||entity.hp<=0||Boolean(entity.bedPlotId),mounted:!!entity.mountedHorseId,carrying:!!entity.carryingId,carriedBy:entity.carriedBy,turnRate:d*(1-Math.exp(-dt*14))/Math.max(dt,.001),backpackTier:entity.backpackTier??0,tier:{wood:1,stone:2,iron:3}[entity.tiers?.[isMe?selected:entity.tool]]||1,tool:isMe?(foodIds.includes(selected)?'food':selected):entity.tool??(entity.role==='zombie'?'':'sword')};
       a.motionOptions=motionOptions;
       if(entity.role==='zombie')a.rig.updateFromState(entity,skyTime?.time??state.clock,dt,motionOptions);else a.rig.update(dt,elapsed,motionOptions);

     }for(const [id,a] of actors)if(!activeIds.has(id)){defenseTroopWorld.removePlayer(id);crateEquipmentWorld.removePlayer(id);scene.remove(a.rig.group);a.rig.dispose();a.label?.remove();actors.delete(id);poseTracks.delete(id);}
     transportWorld.update(state,dt,new Map(state.players.filter(p=>p.online&&p.mountedHorseId).map(p=>{const g=actors.get(p.id)?.rig.group;return [p.id,g?{x:g.position.x,z:g.position.z,yaw:g.rotation.y}:{x:p.x,z:p.z,yaw:p.yaw}];})),settlement.getCurrent()?.kind==='cart'&&dialog.open?settlement.getCurrent().id:null);
     placeOrbitCamera({...predicted,y:groundHeight(predicted.x,predicted.z)},cameraYaw,cameraPitch,caveAreaAt(predicted.x,predicted.z)?Math.min(cameraDistance,4.5):cameraDistance,camDesired,camAnchor,camTarget);
     // Keep the camera in front of solid building/wall bounds without mesh raycast overhead.
     for(let t=1;t>0.18;t-=.08){const p=camAnchor.clone().lerp(camDesired,t);if(cameraBlocked(p)){camDesired.copy(camAnchor.clone().lerp(camDesired,Math.max(.18,t-.1)));}}
     constrainCaveCamera(camAnchor,camDesired,camTarget);camera.position.lerp(camDesired,1-Math.exp(-dt*10));constrainCaveCamera(camAnchor,camera.position,camTarget);const localDwarf=actors.get(ownId)?.rig.group;if(localDwarf)localDwarf.visible=!localDwarfOccludesCamera(camera.position,{x:localDwarf.position.x,z:localDwarf.position.z});camera.lookAt(camTarget);camera.updateMatrixWorld();for(const entity of entities){const a=actors.get(entity.id);if(!a)continue;const v=a.rig.group.position.clone();v.y+=a.rig.labelHeight??2.8;const far=distance(entity,predicted)>20;v.project(camera);const bubble=chat.bubbleFor(entity.id),bubbleElement=a.label.querySelector('.speech-bubble');bubbleElement.hidden=!bubble;if(bubble){bubbleElement.textContent=bubble.typing?'…':bubble.text;bubbleElement.classList.toggle('typing',bubble.typing);}a.label.classList.toggle('self',entity.id===ownId);a.label.hidden=(entity.id===ownId&&!bubble)||far||v.z>1||v.z<0||Math.abs(v.x)>1||Math.abs(v.y)>1;if(!a.label.hidden){a.label.style.transform=`translate(${(v.x*.5+.5)*innerWidth}px,${(-v.y*.5+.5)*innerHeight}px) translate(-50%,-100%)`;a.label.querySelector('span').textContent=entity.name||a.rig.label||(entity.role==='zombie'?'Restless dead':'Village watch');a.label.querySelector('b').style.width=Math.max(0,entity.hp/entity.maxHp*100)+'%';}}if(connection.status==='connected'&&performance.now()-lastStateAt>2000)$('connection').textContent='WAITING FOR SERVER';
   }else{transportWorld.update(state||{},dt);const angle=Math.sin(elapsed*.025)*(tour?.35:.08),radius=tour?63:55;camDesired.set(Math.sin(.63+angle)*radius,tour?30:24,Math.cos(.63+angle)*radius);camera.position.lerp(camDesired,.012);camera.lookAt(0,3,-8);}
   const shadowStep=(qualitySettings.shadowRadius*2)/Math.max(1,qualitySettings.shadowMapSize),focusX=joined&&me?predicted.x:0,focusZ=joined&&me?predicted.z:-12;
   sun.target.position.set(Math.round(focusX/shadowStep)*shadowStep,groundHeight(focusX,focusZ)+2,Math.round(focusZ/shadowStep)*shadowStep);fill.target.position.copy(sun.target.position);
   const skySample=sky.update(skyTime?.cycle??.22,skyTime?.time??elapsed,camera);nightMix=skySample.nightMix;
   const moonShadows=skySample.moonIntensity>skySample.sunIntensity;
   for(const light of [sun,fill]){const casts=Boolean(qualitySettings.shadows&&(light===fill?moonShadows:!moonShadows));if(light.castShadow&&!casts&&light.shadow.map){light.shadow.map.dispose();light.shadow.map=null;}light.castShadow=casts;}
   const caveSample=cave.update(joined&&me?predicted:null,camera,elapsed),caveMix=caveSample.caveMix;world.setCaveView(caveSample.inside);scene.background.lerp(caveFog,caveMix);scene.fog.color.lerp(caveFog,caveMix);scene.fog.density=THREE.MathUtils.lerp(scene.fog.density,.026,caveMix);skyLight.color.lerp(caveAmbient,caveMix);skyLight.intensity=THREE.MathUtils.lerp(skyLight.intensity,1.05,caveMix);sun.intensity*=1-caveMix*.98;fill.intensity=THREE.MathUtils.lerp(fill.intensity,.3,caveMix);sky.group.visible=caveMix<.98;dust.visible=caveMix<.5;
   renderer.toneMappingExposure=THREE.MathUtils.lerp(skySample.exposure??1.02,1.12,caveMix);reflection.update(skySample.daylight,caveMix);
   torches.update(elapsed,nightMix,camera,joined&&me?{...predicted,y:groundHeight(predicted.x,predicted.z)}:null,transportWorld.torchFixtures);
   dustMat.opacity=.22+nightMix*.4;dust.rotation.y=elapsed*.006;
   world.update(elapsed,nightMix,state||{});guardRallies.update(joined?state:null,ownId);cosmeticsWorld.update(joined?state||{}:{},actors);defenseTroopWorld.update(joined?state||{}:{},actors,elapsed);crateEquipmentWorld.update(joined?state||{}:{},actors,elapsed,{reducedMotion:reducedMotionQuery.matches});
   swordTrails.update({actors,entities:frameEntities,ownId,localActionId,selected,dt,time:performance.now()/1000,snapshotAt:lastStateAt/1000,active:joined&&connection.status==='connected'});
   gameAudio.update({state:joined?state:null,me,position:predicted,speed:ownMotionSpeed,dt,time:performance.now()/1000,snapshotAt:lastStateAt/1000,connected:joined&&connection.status==='connected',camera});
   pipeline.render();renderQuality.sampleFrame(rawDt,{active:joined&&connection.status==='connected'&&!document.hidden&&!dialog.open});
 }
 function cameraBlocked(p){return [...BUILDINGS,...dynamicSolids].some(b=>Math.abs(p.x-b.x)<b.w/2+.5&&Math.abs(p.z-b.z)<b.d/2+.5&&p.y<9)||WALLS.some(b=>Math.abs(p.x-b.x)<b.w/2+.5&&Math.abs(p.z-b.z)<b.d/2+.5&&p.y<5.3);}
 window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderQuality.resize();pipeline.resize();});
 $('loading').hidden=true;await loadVillages();frame();
 // Read-only inspection hook for local visual/network QA; exposes no account tokens or mutations.
 window.__emberwatch={get state(){return state;},get me(){return me;},get rendererInfo(){return renderer.info.render;},get graphics(){return {...renderQuality.getSettings(),postProcessingActive:pipeline.enabled};},get controls(){return {pressed:[...keys],desired:{...desired},joined,pointerLocked:cameraLook.isLocked(),gathering:heldGather.isActive()};}};
}
function hash(s){let h=0;for(const c of String(s))h=(Math.imul(h,31)+c.charCodeAt(0))|0;return Math.abs(h);}
let nearbyMap;
function drawMap(){
 if(!me||!state)return;
 nearbyMap??=createMinimap($('minimap'));
 let waypoint=settlement.getWaypoint();
 if(waypoint?.kind==='worker')waypoint=state.workers?.find(w=>w.id===waypoint.id)||null;
 if(waypoint?.kind==='horse')waypoint=state.horses?.find(h=>h.id===waypoint.id)?{...state.horses.find(h=>h.id===waypoint.id),name:'Your horse'}:null;
 const result=nearbyMap.update({state,player:predicted,ownId,yaw:desired.yaw,waypoint,lanes:world?.root.userData.lanes});
 $('waypoint-label').textContent=result.waypointLabel;
}
boot().catch(fail);
