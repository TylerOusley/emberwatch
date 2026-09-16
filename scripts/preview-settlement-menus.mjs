// Real settlement UI rendered into a standalone review fixture; no game actions.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createSettlementUI } from '../public/src/settlement-ui.js';
import { BUILDINGS, PLOTS } from '../shared/world.js';
import { buildingEntrance, plotEntrance } from '../shared/access.js';
import { workerStats } from '../shared/workers.js';
const root = new URL('../', import.meta.url);
function fixture(kind) {
  const player = { id:'rowan',name:'Rowan',role:'guard',wallet:460,bank:1280,hp:62,maxHp:100,hunger:42,x:0,z:0,backpackTier:1,
    inventory:{timber:24,stone:18,iron:12,coal:8,wheat:16,food:3,good_food:1,arrows:24},boundInventory:{food:2},tiers:{axe:'iron',pickaxe:'stone',sword:'iron',scythe:'wood',hammer:'wood'},
    durability:{axe:146,pickaxe:122,sword:165,scythe:84,hammer:52,bow:0},maxDurability:{axe:200,pickaxe:150,sword:200,scythe:100,hammer:100} };
  const plot = {id:PLOTS[0].id,ownerId:player.id,ownerName:'Rowan',building:kind==='barracks'?'barracks':kind==='church'?'church':kind==='cannon'?'cannon':'mine',level:1,hp:450,maxHp:450,storage:{timber:80,stone:100,iron:40,coal:18,wheat:24},allowVisitors:true};
  if(kind==='mine'){plot.level=2;plot.hp=625;plot.maxHp=675;}
  if(kind==='cannon'){plot.hp=900;plot.maxHp=900;}
  if(kind==='church'||kind==='barracks'){plot.hp=650;plot.maxHp=650;}
  const worker={id:'bram',ownerId:player.id,name:'Bram Stonehand',x:0,z:0,resource:'stone',sourcePlotId:plot.id,mode:'store',destinationPlotId:plot.id,status:'Returning with a full haul',paused:false,cargo:{stone:15,iron:3},level:6,workXp:135,upgradePoints:2,attributes:{gathering:2,speed:1,carry:0},color:'#4c86a4'};
  Object.assign(worker,workerStats(worker));
  const state={status:'active',players:[player,{id:'patient',name:'Elin',hp:34,maxHp:100}],plots:[plot],workers:[worker],guards:[{id:'troop1',plotId:plot.id,ownerId:player.id,hp:132,maxHp:160,hungry:false}],guardReplacements:[{plotId:plot.id,ownerId:player.id,remaining:18,waitingForWheat:false}],beds:[{plotId:plot.id,capacity:2,patients:[{playerId:'patient',remaining:7,revive:false}]}],
    stock:{timber:135,stone:94,wheat:68,iron:26,coal:21},treasury:15840,barracks:{wheat:24},policies:{tradeTax:5,landTax:2},loan:{debt:80,credit:30,maxDebt:200,availablePool:500,repaymentPercent:20},requests:{items:[]},carts:[],horses:[],defenseStatus:[{plotId:plot.id,status:'ready',range:26,shotsRemaining:18}]};
  let markup=''; const content={contains:()=>false,querySelectorAll:()=>[],querySelector:()=>null}, dialog={open:true,scrollTop:0,classList:{add(){}}};
  const prior=globalThis.document;globalThis.document={activeElement:null,getElementById:id=>id==='panel-content'?content:id==='panel-dialog'?dialog:null};
  const send=()=>{throw new Error('Preview must never send actions');};
  try {
    const ui=createSettlementUI({getState:()=>state,getMe:()=>player,getActivePanel:()=> 'settlement',openPanel:next=>markup=next,send,toast(){},getHotbar:()=>['sword','axe','pickaxe','scythe','hammer','food','good_food','arrows'],setHotbar:send,showRequests(){},showInvestments(){},showTavern(){}});
    if(['mine','church','barracks','cannon'].includes(kind)){Object.assign(player,plotEntrance(PLOTS[0],plot));ui.show('plot',plot.id);}
    else{if(kind==='bank'||kind==='workers')Object.assign(player,buildingEntrance(BUILDINGS.find(building=>building.id==='bank')));ui.show(kind);}
  } finally {globalThis.document=prior;}
  return markup;
}
const labels={inventory:'Your pack',bank:'Treasury',workers:'Worker management',mine:'Level 2 mine',church:'Church care',barracks:'Barracks',cannon:'Cannon defense'};
const fixtures=Object.fromEntries(Object.keys(labels).map(kind=>[kind,fixture(kind)]));
let css=['public/style.css','public/chat.css','public/settlement.css','public/watch.css','public/build-carousel.css'].map(path=>readFileSync(new URL(path,root),'utf8')).join('\n');
css=css.replace(/url\((['"]?)(\/fonts\/[^)'"\s]+)\1\)/g,(_,quote,path)=>`url(data:font/ttf;base64,${readFileSync(new URL('public'+path,root)).toString('base64')})`);
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Emberwatch · Build 17 settlement menus</title><style>${css}\nbody{overflow:auto;min-height:100vh;background:radial-gradient(ellipse at 25% 0,#40533d,#102a20 70%)}.preview-heading{max-width:940px;margin:auto;padding:28px 24px 18px}.preview-heading h1{font-size:23px;margin:7px 0 10px}.preview-heading p{font-size:11px;color:#b7c5ae;line-height:1.8}.preview-heading nav{display:flex;flex-wrap:wrap;gap:7px}.preview-heading button{border:1px solid #bca66b77;background:#263e2c;color:#e5d19f;padding:10px;border-radius:5px;font-size:11px}.preview-heading button[aria-pressed=true]{background:#c4a668;color:#183124}#panel-dialog{position:relative;margin:0 auto 30px;max-height:none;max-width:calc(100vw - 32px)}#panel-dialog::backdrop{display:none}</style></head><body><header class="preview-heading"><p class="eyebrow">EMBERWATCH · BUILD 17</p><h1>Life inside the village.</h1><p>Illustrated settlement menus rendered from the actual game UI and CSS. Fixture balances are for review; no actions are sent.</p><nav>${Object.entries(labels).map(([id,label])=>`<button data-preview="${id}" aria-pressed="${id==='inventory'}">${label}</button>`).join('')}</nav></header><dialog open id="panel-dialog" class="settlement-dialog"><div id="panel-content">${fixtures.inventory}</div></dialog>${Object.entries(fixtures).map(([id,html])=>`<template id="fixture-${id}">${html}</template>`).join('')}<script>for(const button of document.querySelectorAll('[data-preview]'))button.onclick=()=>{document.getElementById('panel-content').replaceChildren(document.getElementById('fixture-'+button.dataset.preview).content.cloneNode(true));for(const other of document.querySelectorAll('[data-preview]'))other.setAttribute('aria-pressed',String(other===button));window.scrollTo(0,0);};document.getElementById('panel-content').addEventListener('click',event=>{if(event.target.closest('button'))event.preventDefault();});</script></body></html>`;
mkdirSync(new URL('docs/previews/',root),{recursive:true});writeFileSync(new URL('docs/previews/settlement-build17.html',root),html);
console.log('Generated docs/previews/settlement-build17.html');
