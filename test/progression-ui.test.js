import test from 'node:test';
import assert from 'node:assert/strict';
import { createProgressionUI,guideView } from '../public/src/progression-ui.js';
import { BUILDINGS,PLOTS,RESOURCES,CAVE_ENTRANCE } from '../shared/world.js';
import { buildingEntrance,plotEntrance } from '../shared/access.js';
import { freshProgression } from '../shared/progression.js';
function fixture(t) {
  const old=globalThis.document;let html='',opens=0,active=null;const controls=[],sent=[],waypoints=[];
  function parse(value,list){list.length=0;for(const [,tag,attributes,body] of value.matchAll(/<(button|select)\b([^>]*)>(.*?)<\/\1>/gs)) {
    const attrs=Object.fromEntries([...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(([,k,v])=>[k,v]));const dataset=Object.fromEntries(Object.entries(attrs).filter(([k])=>k.startsWith('data-')).map(([k,v])=>[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),v]));
    const options=[...body.matchAll(/<option value="([^"]*)"([^>]*)>/g)];list.push({tagName:tag.toUpperCase(),id:attrs.id,className:attrs.class||'',dataset,disabled:/\sdisabled/.test(attributes),value:options.find(o=>o[2].includes('selected'))?.[1]??options[0]?.[1],text:body});
  }}
  const matches=(c,s)=>s==='select'?c.tagName==='SELECT':s.startsWith('#')?c.id===s.slice(1):s.startsWith('.')?c.className.split(' ').includes(s.slice(1)):s.startsWith('[data-')?Object.hasOwn(c.dataset,s.slice(6,-1).replace(/-([a-z])/g,(_,x)=>x.toUpperCase())):false;
  const content={querySelector:s=>controls.find(c=>matches(c,s)),querySelectorAll:s=>controls.filter(c=>matches(c,s)),contains:el=>controls.includes(el)};
  const guideControls=[],guide={hidden:true,_html:'',set innerHTML(value){this._html=value;parse(value,guideControls);},get innerHTML(){return this._html;},querySelector:s=>guideControls.find(c=>matches(c,s)),replaceChildren(){this._html='';}};
  globalThis.document={activeElement:null,getElementById:id=>id==='panel-content'?content:id==='first-watch-guide'?guide:null};t.after(()=>globalThis.document=old);
  const player={id:'alice',role:'villager',x:0,z:4,tool:'pickaxe'};
  const plot={id:PLOTS[0].id,ownerId:player.id,building:'house',hp:500};
  const progress={...freshProgression({offerGuide:true}),nights:5,canChooseBanner:true};
  const state={players:[player],plots:[plot],progression:progress,cosmetics:{players:{},plots:{},banner:{palette:'natural',crest:'none'}}};
  const ui=createProgressionUI({getState:()=>state,getMe:()=>player,getActivePanel:()=>active,send:m=>sent.push(m),markWaypoint:p=>waypoints.push(p),openPanel(value,kind){html=value;active=kind;opens++;parse(value,controls);}});
  return {ui,player,plot,state,sent,waypoints,guide,content,get html(){return html;},get opens(){return opens;},field:id=>content.querySelector('#'+id),click(id){const c=content.querySelector('#'+id);assert.ok(c);assert.equal(c.disabled,false);c.onclick();}};
}
test('first-watch checklist is optional, compact, server-driven and marks its next destination without a modal',t=>{
  const f=fixture(t);f.ui.refresh();assert.equal(f.opens,0);assert.equal(f.guide.hidden,false);assert.match(f.guide.innerHTML,/aria-expanded="false"/);assert.doesNotMatch(f.guide.innerHTML,/Choose your first tool|<ol/);assert.equal(f.guide.querySelector('.guide-mark'),undefined);
  f.guide.querySelector('.guide-toggle').onclick();assert.match(f.guide.innerHTML,/aria-expanded="true"/);assert.match(f.guide.innerHTML,/Choose your first tool/);assert.match(f.guide.innerHTML,/<ol/);
  f.guide.querySelector('.guide-mark').onclick();assert.deepEqual(f.waypoints[0],{...buildingEntrance(BUILDINGS.find(b=>b.id==='tools')),label:'Oak & Iron'});
  f.guide.querySelector('.guide-dismiss').onclick();assert.deepEqual(f.sent.at(-1),{type:'action',kind:'guide_visibility',dismissed:true});assert.equal(f.state.progression.guide.dismissed,false,'no local progress forgery');
  f.state.progression.guide.dismissed=true;f.ui.refresh();assert.equal(f.guide.hidden,true);f.ui.showGuide();assert.deepEqual(f.sent.at(-1),{type:'action',kind:'guide_visibility',dismissed:false});
  assert.equal(guideView({guide:{dismissed:false,done:['tool','forged']}}).completed,1);f.ui.clear();assert.equal(f.guide.hidden,true);
});
test('appearance controls retain drafts while snapshots arrive and require property entrances',t=>{
  const f=fixture(t);f.ui.show();assert.doesNotMatch(f.html,/value="royal"/);assert.equal(f.field('banner-save').disabled,true);assert.equal(f.content.querySelectorAll('[data-decorate]')[0].disabled,true);
  const palette=f.field('appearance-palette');palette.value='azure';palette.onchange();document.activeElement=palette;
  f.state.progression.guide.done.push('tool');const opens=f.opens;f.ui.refresh();assert.equal(f.opens,opens);assert.equal(f.field('appearance-palette'),palette);
  document.activeElement=null;f.ui.refresh();assert.equal(f.field('appearance-palette').value,'azure');f.field('appearance-crest').value='shield';f.field('appearance-crest').onchange();f.click('appearance-save');assert.deepEqual(f.sent.at(-1),{type:'action',kind:'cosmetic_player',palette:'azure',crest:'shield'});
  const next=f.opens;f.state.cosmetics.players.bob={palette:'forest',crest:'oak'};f.ui.refresh();assert.equal(f.opens,next,'another player’s appearance does not reset this menu');
  Object.assign(f.player,plotEntrance(PLOTS[0],f.plot));f.ui.refresh();const button=f.content.querySelectorAll('[data-decorate]')[0];assert.equal(button.disabled,false);f.field('plot-color-'+f.plot.id).value='ember';button.onclick();assert.deepEqual(f.sent.at(-1),{type:'action',kind:'cosmetic_plot',plotId:f.plot.id,palette:'ember'});
  Object.assign(f.player,buildingEntrance(BUILDINGS.find(b=>b.id==='keep')));f.ui.refresh();assert.equal(f.field('banner-save').disabled,false);f.field('banner-palette').value='azure';f.field('banner-crest').value='shield';f.click('banner-save');assert.deepEqual(f.sent.at(-1),{type:'action',kind:'cosmetic_banner',palette:'azure',crest:'shield'});
});

test('mining guide leads beginners to the cave mouth and follows actual ore rolls underground',t=>{
  const f=fixture(t);f.state.progression.guide.done=['tool'];f.ui.refresh();f.guide.querySelector('.guide-toggle').onclick();f.guide.querySelector('.guide-mark').onclick();
  assert.deepEqual(f.waypoints.at(-1),{...CAVE_ENTRANCE,label:'Mountain mine entrance'});
  const node=RESOURCES.find(n=>n.caveTier==='middle'&&n.type!=='stone');
  Object.assign(f.player,{x:node.x+1,z:node.z});f.state.resources=RESOURCES.map(n=>({id:n.id,type:n.id===node.id?'stone':n.type,available:n.id===node.id}));
  f.guide.querySelector('.guide-mark').onclick();assert.deepEqual(f.waypoints.at(-1),{x:node.x,z:node.z,label:'Gather stone'});
});


test('guide expansion survives progress updates and reopening from the menu reveals the next step',t=>{
  const f=fixture(t);f.ui.refresh();const collapsed=f.guide.innerHTML;
  f.state.players.push({id:'bob',online:true});f.ui.refresh();assert.equal(f.guide.innerHTML,collapsed);
  f.guide.querySelector('.guide-toggle').onclick();
  f.state.progression.guide.done.push('tool');f.ui.refresh();assert.match(f.guide.innerHTML,/aria-expanded="true"/);assert.match(f.guide.innerHTML,/1\/5/);assert.match(f.guide.innerHTML,/guide-mark/);
  f.guide.querySelector('.guide-toggle').onclick();assert.match(f.guide.innerHTML,/aria-expanded="false"/);assert.equal(f.guide.querySelector('.guide-mark'),undefined);
  f.state.progression.guide.dismissed=true;f.ui.refresh();f.ui.showGuide();f.state.progression.guide.dismissed=false;f.ui.refresh();assert.equal(f.guide.hidden,false);assert.match(f.guide.innerHTML,/aria-expanded="true"/);
  f.ui.clear();f.ui.refresh();assert.match(f.guide.innerHTML,/aria-expanded="false"/);
});
