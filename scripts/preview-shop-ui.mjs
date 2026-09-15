// Reproducible offline fixtures from real UI HTML and CSS. No browser or game server required.
// Run from any working directory: node scripts/preview-shop-ui.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSettlementUI } from '../public/src/settlement-ui.js';
import { createRequestsUI } from '../public/src/requests-ui.js';
import { itemArt, shopInterior } from '../public/src/shop-display.js';
import { BUILDINGS, PLOTS } from '../shared/world.js';
import { buildingEntrance, plotEntrance } from '../shared/access.js';
import { NOTICEBOARD_POINT } from '../public/src/noticeboard.js';
import { foodQuote } from '../shared/economy.js';

const root = new URL('../', import.meta.url), output = new URL('docs/previews/',root);
const read = p => readFileSync(new URL(p,root),'utf8');
const esc = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const textOf = value => String(value??'').replace(/<[^>]*>/g,'').replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&quot;','"').replaceAll('&#39;',"'");
const fixturePlayer = () => ({ id:'preview-dwarf',name:'Rowan',role:'guard',x:0,z:0,hp:100,maxHp:100,hunger:42,wallet:140,bank:80,backpackTier:1,inventory:{wheat:12,timber:18,stone:0,iron:0,coal:0},durability:{},tiers:{} });
function fixtureState(player) {
  const point = id => ({...buildingEntrance(BUILDINGS.find(b=>b.id===id)),id,name:BUILDINGS.find(b=>b.id===id).name,kind:'service'});
  const requests=[
    {id:'preview-wheat',destinationId:'bank',resource:'wheat',destinationName:'Village Treasury',point:point('bank'),remaining:24,unitGold:5,expiresDay:5,status:'open',reason:'The village needs wheat for meals before the next watch.',reserved:120},
    {id:'preview-timber',destinationId:'bank',resource:'timber',destinationName:'Village Treasury',point:point('bank'),remaining:30,unitGold:4,expiresDay:5,status:'open',reason:'Replenish timber for repairs before the gate faces another siege.',reserved:120},
  ];
  return {id:'preview-village',status:'active',day:4,phase:'day',players:[player],plots:[],guards:[],beds:[],workers:[],stock:{wheat:100,timber:90,stone:75,iron:24,coal:20},treasury:20000,barracks:{wheat:10},policies:{guardWage:25,priestWage:25,tradeTax:10,landTax:2,exportPriority:'balanced'},proposals:[],merchant:{present:true,stock:{iron:5},prices:{iron:9}},stable:{stock:3},loan:{debt:0,credit:0,availablePool:500},foodQuotes:Object.fromEntries(['food','good_food','best_food'].map(id=>[id,foodQuote(100,id)])),requests:{items:requests,reservedGold:240}};
}
function renderFixture(kind) {
  const player=fixturePlayer(),state=fixtureState(player);
  let html='',activePanel=null;
  const content={contains:()=>false,querySelectorAll:()=>[],querySelector:()=>null};
  const dialog={open:true,scrollTop:0,classList:{add(){}}};
  const doc={activeElement:null,getElementById:id=>id==='panel-content'?content:id==='panel-dialog'?dialog:null};
  const openPanel=(next,panel)=>{html=next;activePanel=panel;};
  const noAction=()=>{throw new Error('Preview generation must not dispatch game actions');};
  const prior=globalThis.document;
  globalThis.document=doc;
  try {
    if(kind==='board'){
      Object.assign(player,NOTICEBOARD_POINT);
      const ui=createRequestsUI({getState:()=>state,getMe:()=>player,getActivePanel:()=>activePanel,openPanel,closePanel(){},send:noAction,markTarget:noAction,document:doc});
      ui.show();
    }else{
      const ui=createSettlementUI({getState:()=>state,getMe:()=>player,getActivePanel:()=>activePanel,openPanel,send:noAction,toast(){},getHotbar:()=>['axe','pickaxe','scythe','hammer','food'],setHotbar:noAction});
      if(kind==='weapons'){
        const site=PLOTS[0],plot={id:site.id,ownerId:'preview-smith',ownerName:'Bram Ironhand',building:'sword_shop',level:1,hp:400,maxHp:400,storage:{timber:18,stone:20,iron:8,coal:3}};
        state.plots=[plot];Object.assign(player,plotEntrance(site,plot));ui.show('plot',plot.id);
      }else{
        if(kind==='tools'){player.wallet=10;player.inventory={};player.backpackTier=0;}
        if(kind==='food')player.inventory.food=1;
        Object.assign(player,buildingEntrance(BUILDINGS.find(b=>b.id===kind)));ui.show(kind);
      }
    }
  }finally{globalThis.document=prior;}
  if(!html.includes('settlement-panel'))throw new Error(`Missing ${kind} fixture HTML`);
  return {html,player,state};
}

const fixtures=Object.fromEntries(['tools','weapons','food','board'].map(id=>[id,renderFixture(id)]));
const labels={tools:'Starter tools',weapons:'Player sword shop',food:'Food counter',board:'Village request board'};
let css=['public/style.css','public/chat.css','public/settlement.css','public/watch.css'].map(read).join('\n');
css=css.replace(/url\((['"]?)(\/fonts\/[^)'"\s]+)\1\)/g,(_all,_quote,url)=>`url(data:font/ttf;base64,${readFileSync(new URL('public'+url,root)).toString('base64')})`);
if(/url\((?!data:)/.test(css))throw new Error('Unexpected external CSS dependency in self-contained fixture');
const previewCSS=`body{overflow:auto;min-height:100vh;background:radial-gradient(ellipse at 50% 0,#3b4936,#13261f 70%)}.preview-header{max-width:1000px;margin:0 auto;padding:24px 24px 18px}.preview-header h1{font-size:23px;letter-spacing:0;margin:4px 0 10px}.preview-header p{max-width:850px;font-size:12px;line-height:1.8;color:#bdc7b4}.preview-header nav{display:flex;gap:8px;flex-wrap:wrap}.preview-header nav button{border:1px solid #c8ae6b77;background:#213629;color:#e6d3a4;padding:10px 13px;border-radius:4px;font-size:12px}.preview-header nav button[aria-pressed=true]{background:#c8ac6b;color:#182e24}.preview-status{min-height:24px;margin:10px 0 0!important;color:#dec38c!important}#panel-dialog{position:relative;margin:0 auto 32px;max-height:none;max-width:calc(100vw - 32px)}.preview-frame-label{font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#b9c5aa}html{color-scheme:dark}`;
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'"><title>Emberwatch · Shop UI fixtures</title><style>${css}\n${previewCSS}</style></head><body><header class="preview-header"><p class="preview-frame-label">Emberwatch · Offline interface fixture</p><h1>Step inside. Browse the counter.</h1><p>Generated from the actual settlement and request UI modules, with the current game CSS and embedded fonts. This is a static fixture, not a live game or a browser test result. Inspect-item disclosures work; purchasing, deliveries, and travel send no actions. The surrounding page only arranges the preview.</p><nav aria-label="Preview fixtures">${Object.keys(fixtures).map((id,i)=>`<button type="button" data-preview="${id}" aria-pressed="${i===0}">${labels[id]}</button>`).join('')}</nav><p class="preview-status" id="preview-status" aria-live="polite">Starter tools · Fixture values, no live actions.</p></header><dialog open id="panel-dialog" class="settlement-dialog" aria-label="Shop fixture"><div id="panel-content">${fixtures.tools.html}</div></dialog>${Object.entries(fixtures).map(([id,f])=>`<template id="fixture-${id}">${f.html}</template>`).join('')}<script>
const content=document.getElementById('panel-content');
for(const button of document.querySelectorAll('[data-preview]'))button.addEventListener('click',()=>{content.replaceChildren(document.getElementById('fixture-'+button.dataset.preview).content.cloneNode(true));for(const b of document.querySelectorAll('[data-preview]'))b.setAttribute('aria-pressed',String(b===button));document.getElementById('preview-status').textContent=button.textContent+' · Fixture values, no live actions.';});
content.addEventListener('click',event=>{const button=event.target.closest('button');if(button){event.preventDefault();document.getElementById('preview-status').textContent='Preview only — no purchase, delivery, travel or inventory action was sent.';}});
</script></body></html>`;

// Companion vector composition: uses the actual artwork and facts parsed from UI
// cards, while arranging them explicitly in SVG. It is not a CSS/browser raster.
const svgText=(x,y,value,size=16,color='#e7d4a6',extra='')=>`<text x="${x}" y="${y}" font-family="DejaVu Sans,sans-serif" font-size="${size}" fill="${color}" ${extra}>${esc(value)}</text>`;
const rectangle=(x,y,w,h,fill,extra='')=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${extra}/>`;
const art=(body,x,y,w,h)=>`<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 240 180">${body.replace(/^<svg[^>]*>/,'').replace(/<\/svg>$/,'')}</svg>`;
const wrapped=(value,max=32)=>{const lines=[];let current='';for(const word of value.split(/\s+/)){if((current+' '+word).trim().length>max&&current){lines.push(current);current='';}current+=(current?' ':'')+word;}if(current)lines.push(current);return lines;};
const textLines=(value,x,y,width=32,size=15,color='#bbc8b0',lineHeight=22)=>wrapped(value,width).map((v,i)=>svgText(x,y+i*lineHeight,v,size,color)).join('');
function parseCards(markup) {
  return [...markup.matchAll(/<article class="shop-item"([^>]*)>([\s\S]*?)<\/article>/g)].map(([,attributes,body])=>({
    id:attributes.match(/data-shop-item="([^"]+)"/)[1],available:attributes.includes('data-available="true"'),name:textOf(body.match(/<h4>(.*?)<\/h4>/)?.[1]),
    facts:[...body.matchAll(/<dt>(.*?)<\/dt><dd>(.*?)<\/dd>/g)].map(m=>[textOf(m[1]),textOf(m[2])]),
    status:textOf(body.match(/class="shop-item-status">(.*?)<\/p>/)?.[1]),buy:textOf(body.match(/<button[^>]*>(.*?)<\/button>/)?.[1]),
    art:body.match(/<svg[^>]*class="shop-item-illustration"[^>]*>[\s\S]*?<\/svg>/)?.[0],
  }));
}
const cards=parseCards(fixtures.weapons.html);
if(cards.length!==3||cards.some(c=>!c.art||!c.facts.length))throw new Error('Sword shop preview card extraction failed');
let svg='<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1090" viewBox="0 0 1600 1090">'+rectangle(0,0,1600,1090,'#11251e');
svg+=svgText(30,38,'EMBERWATCH · THE VILLAGE COUNTERS',20,'#ecd3a0','letter-spacing="2"')+svgText(30,67,'Artwork/layout preview — not a browser screenshot. Actual shop art and current UI fixture facts.',14,'#aebfa8');
svg+=rectangle(30,90,910,940,'#203228','rx="8" stroke="#a88c55" stroke-width="2"')+`<svg x="31" y="91" width="908" height="305" viewBox="0 0 1400 480" preserveAspectRatio="xMidYMid slice">${shopInterior('weapons').replace(/^<svg[^>]*>/,'').replace(/<\/svg>$/,'')}</svg>`;
svg+=svgText(60,432,'BRAM IRONHAND’S SWORD SHOP',13,'#ccae70','letter-spacing="2"')+svgText(60,470,'Crafted to order.',30,'#f0d9a7')+svgText(60,500,'Choose a sword. Inspect its damage, durability and required materials.',15,'#bbcab5');
for(let i=0;i<cards.length;i++){
 const c=cards[i],x=59+i*287,y=528;
 svg+=rectangle(x,y,260,436,'#2d4032','rx="7" stroke="#8e875955"')+rectangle(x+1,y+1,258,160,'#3d4934','rx="6"')+art(c.art,x+5,y+1,250,160)+svgText(x+17,y+191,c.name,18,'#f4dfaf');
 c.facts.forEach(([label,value],j)=>{svg+=svgText(x+17,y+222+j*49,label.toUpperCase(),10,'#9ead97','letter-spacing="1"')+svgText(x+17,y+243+j*49,value,15,'#e5cf9d');});
 svg+=svgText(x+17,y+328,'▸ Inspect item',13,'#dab974')+textLines(c.status,x+17,y+354,29,12,'#bac7ac',18)+rectangle(x+17,y+389,226,32,c.available?'#c7a768':'#3d4b3b','rx="3" stroke="#9a987077"')+svgText(x+130,y+411,c.buy,13,c.available?'#15291f':'#abb79d','text-anchor="middle"');
}
svg+=svgText(60,999,'Every purchase uses this shop’s stock. Iron is short in this fixture.',13,'#c1bc9a');
svg+=rectangle(964,90,606,940,'#513b27','rx="5" stroke="#9c7644" stroke-width="7"');
for(let y=112;y<1030;y+=56)svg+=`<path d="M970 ${y}H1565" stroke="#241b1477" stroke-width="2"/>`;
svg+=svgText(994,130,'VILLAGE REQUEST BOARD',13,'#d9b772','letter-spacing="2"')+textLines('Supplies for the next watch.',994,171,32,27,'#f1d9a8',36)+textLines('Anyone can help. Bring supplies to the marked delivery entrance.',994,231,62,14,'#decaab',23)+svgText(994,292,`${fixtures.board.state.requests.reservedGold} gold reserved for these requests`,15,'#ead4a8');
fixtures.board.state.requests.items.forEach((r,i)=>{
 const x=993+i*279,y=324,w=254;
 svg+=`<g transform="rotate(${i?.65:-.6} ${x+w/2} ${y+297})">`+rectangle(x+4,y+7,w,616,'#24190f66')+rectangle(x,y,w,616,'#e3ce9c','stroke="#b09260"');
 svg+=`<circle cx="${x+w/2}" cy="${y+2}" r="6" fill="#c7ad72" stroke="#725732"/>`+art(itemArt(r.resource),x+42,y+18,170,112);
 const seal=fixtures.board.html.match(/<span class="request-wax-seal"[^>]*>(<svg[\s\S]*?<\/svg>)/)?.[1];
 if(seal)svg+=`<svg x="${x+w-53}" y="${y+103}" width="42" height="42" viewBox="0 0 60 60">${seal.replace(/^<svg[^>]*>/,'').replace(/<\/svg>$/,'')}</svg>`;
 svg+=svgText(x+18,y+157,'BY ORDER OF THE STEWARD',9,'#795b35','letter-spacing=".8"')+svgText(x+18,y+189,r.resource[0].toUpperCase()+r.resource.slice(1),22,'#3d2f1d')+svgText(x+18,y+216,r.destinationName,14,'#574129')+textLines(r.reason,x+18,y+249,28,13,'#684d30',21);
 let factY=y+342;
 for(const [name,val] of [['Still needed',`${r.remaining} ${r.resource}`],['Payment',`${r.unitGold} gold each`],['You carry',`${fixtures.board.player.inventory[r.resource]||0}`]]){
  svg+=rectangle(x+18,factY-19,w-36,37,'#f6e5bb','stroke="#ae916044"')+svgText(x+26,factY-3,name,10,'#79623f')+svgText(x+w-27,factY+5,val,12,'#392a19','text-anchor="end"');factY+=46;
 }
 svg+=svgText(x+18,y+492,`Expires at dawn on day ${r.expiresDay}.`,11,'#6d5233')+rectangle(x+18,y+542,w-36,43,'#685132','stroke="#89653a"')+svgText(x+w/2,y+568,'Mark delivery entrance',12,'#ffeac0','text-anchor="middle"')+'</g>';
});
svg+=textLines('Mark a destination here. Deliver supplies at that entrance to collect the posted payment.',994,986,65,12,'#d8c4a3',18)+svgText(30,1061,'Offline fixtures preserve the game’s prices, stock shortages and posted rewards. No purchases or deliveries occur here.',13,'#aabc9f')+'</svg>';
mkdirSync(output,{recursive:true});writeFileSync(new URL('shop-ui.html',output),html);writeFileSync(new URL('shop-counter.svg',output),svg);
console.log(`Generated ${fileURLToPath(new URL('shop-ui.html',output))} (${html.length} characters)`);
console.log(`Generated ${fileURLToPath(new URL('shop-counter.svg',output))} (${svg.length} characters)`);
console.log('Fixtures: tools, weapons, food, board. Actual UI modules rendered; no game actions dispatched.');
