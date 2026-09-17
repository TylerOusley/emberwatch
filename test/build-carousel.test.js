import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDING_TYPES } from '../shared/content.js';
import { ROLE_STATS, roleCanBuild } from '../shared/roles.js';
import { buildingArt,BUILDING_DETAILS,buildOrder,buildingAvailability,createBuildCarousel } from '../public/src/build-carousel.js';
function fixture(){
  const buttons=[];let html='',changes=0;const built=[];
  const options={plotId:'west-1',plot:{id:'west-1',ownerId:'owner',storage:{}},player:{id:'owner',role:'villager',inventory:{timber:1000,stone:1000,iron:1000}},plots:[],funds:1000,site:{outside:false},atEntrance:true};
  const carousel=createBuildCarousel({button(text,callback,disabled,title,className){const id=buttons.length;buttons.push({text,callback,disabled});return `<button type="button" class="${className}" data-test-button="${id}"${disabled?' disabled':''}>${text}</button>`;},onChange(){changes++;render();},onBuild:kind=>built.push(kind)});
  function render(){buttons.length=0;html=carousel.render(options);}
  render();return {carousel,options,buttons,built,render,get html(){return html;},get changes(){return changes;}};
}
test('all catalog buildings have distinct self-contained native illustrations and accurate inspectable details',()=>{
  const kinds=Object.keys(BUILDING_TYPES),art=kinds.map(buildingArt);assert.equal(kinds.length,13);assert.equal(new Set(art).size,kinds.length);
  for(const kind of kinds){const svg=buildingArt(kind);assert.match(svg,/^<svg /);assert.match(svg,/viewBox="0 0 480 300"/);assert.match(svg,new RegExp(`data-building-art="${kind}"`));assert.doesNotMatch(svg,/<(?:script|image|foreignObject|text)\b|href=|url\(|NaN|undefined/);assert.ok(BUILDING_DETAILS[kind].description.length>35);}
  assert.equal(buildingArt('<script>'),'');assert.equal(buildingArt('constructor'),'');assert.equal(buildingAvailability('constructor').available,false);
  assert.match(BUILDING_DETAILS.archer_tower.benefit,/no ammunition required/);assert.match(BUILDING_DETAILS.cannon.benefit,/1 coal and 1 stone/);
});
test('one visible plan has accessible previous/next buttons, wraps through every building and remembers each plot',()=>{
  const f=fixture(),count=Object.keys(BUILDING_TYPES).length;assert.equal((f.html.match(/data-building-art=/g)||[]).length,1);assert.match(f.html,/aria-roledescription="carousel"/);assert.match(f.html,/aria-label="Previous building"/);assert.match(f.html,/aria-label="Next building"/);assert.match(f.html,new RegExp(`1 / ${count}`));assert.match(f.html,/data-shop-focus="building-construct"/);
  const visited=new Set();for(let i=0;i<count;i++){visited.add(f.carousel.getSelection('west-1'));f.buttons.find(b=>b.text==='Next building').callback();}assert.equal(visited.size,count);assert.equal(f.carousel.getSelection('west-1'),'tool_shop');
  f.buttons.find(b=>b.text==='Previous building').callback();const selected=f.carousel.getSelection('west-1');assert.equal(selected,buildOrder('villager').at(-1));
  f.options.funds=0;f.render();assert.equal(f.carousel.getSelection('west-1'),selected);f.options.plotId='east-2';f.options.plot={id:'east-2',ownerId:'owner',storage:{}};f.render();assert.equal(f.carousel.getSelection('east-2'),'tool_shop');
  f.options.plotId='west-1';f.render();assert.equal(f.carousel.getSelection('west-1'),selected);f.carousel.clear();f.render();assert.equal(f.carousel.getSelection('west-1'),'tool_shop');
});
test('role-eligible plans come first while locked plans remain visible with their requirements',()=>{
  for(const role of Object.keys(ROLE_STATS)){const order=buildOrder(role),firstLocked=order.findIndex(id=>!roleCanBuild(role,BUILDING_TYPES[id]));assert.equal(order.length,Object.keys(BUILDING_TYPES).length);assert.ok(order.slice(firstLocked).every(id=>!roleCanBuild(role,BUILDING_TYPES[id])));}
  const f=fixture();while(f.carousel.getSelection('west-1')!=='barracks')f.carousel.move(1);
  assert.match(f.html,/Guard only/);assert.match(f.html,/Guard role required/);assert.equal(f.buttons[0].disabled,true);assert.match(f.html,/limit|0 \/ 2/);
  f.options.player.role='guard';f.render();assert.equal(f.carousel.getSelection('west-1'),'barracks');assert.equal(f.buttons[0].disabled,false);
});
test('availability follows actual construction costs, owner/door rules, barracks limits and safe conversion requirements',()=>{
  const f=fixture(),options=f.options;options.player.role='guard';options.player.inventory={timber:10,stone:5};options.plot.storage={timber:25,stone:20};options.funds=100;
  const ready=buildingAvailability('barracks',options);assert.equal(ready.available,true);assert.deepEqual(Object.fromEntries(ready.costs.map(c=>[c.resource,c.required])),BUILDING_TYPES.barracks.cost);
  options.funds=99;assert.match(buildingAvailability('barracks',options).reasons.join(' '),/1 more gold/);options.funds=100;
  options.atEntrance=false;assert.match(buildingAvailability('barracks',options).reasons.join(' '),/entrance/);options.atEntrance=true;
  options.plots=[{id:'west-1',ownerId:'owner',building:'barracks'},{id:'west-2',ownerId:'owner',building:'barracks'}];assert.equal(buildingAvailability('barracks',options).available,true,'current plot is excluded from the other-barracks count');
  options.plots.push({id:'west-3',ownerId:'owner',building:'barracks'});assert.match(buildingAvailability('barracks',options).reasons.join(' '),/Limit reached/);
  options.plots=[];options.plot.building='house';assert.match(buildingAvailability('barracks',options).reasons.join(' '),/Empty this building/);
  options.plot.storage={};options.player.inventory={timber:100,stone:100};options.patients=[{playerId:'patient'}];assert.match(buildingAvailability('barracks',options).reasons.join(' '),/every church patient/);options.patients=[];
  options.plot.ownerId='other';assert.match(buildingAvailability('barracks',options).reasons.join(' '),/plot owner/);
});
test('build action rechecks current affordability and outside plots disclose exposure without inventing restrictions',()=>{
  const f=fixture();f.options.site.outside=true;f.render();assert.match(f.html,/Outside the wall · exposed/);assert.equal(f.buttons[0].disabled,false);
  const callback=f.buttons[0].callback;f.options.funds=0;callback();assert.deepEqual(f.built,[]);f.options.funds=1000;callback();assert.deepEqual(f.built,['tool_shop']);
  const region={};f.carousel.bind({querySelector:()=>region});let prevented=0;region.onkeydown({key:'ArrowRight',target:{tagName:'BUTTON'},preventDefault(){prevented++;}});assert.equal(f.carousel.getSelection('west-1'),'tinker_shop');assert.equal(prevented,1);
  region.onkeydown({key:'ArrowLeft',target:{tagName:'INPUT'},preventDefault(){prevented++;}});assert.equal(f.carousel.getSelection('west-1'),'tinker_shop');assert.equal(prevented,1);
});
