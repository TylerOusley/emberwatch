import test from 'node:test';
import assert from 'node:assert/strict';
import { itemArt, shopInterior } from '../public/src/shop-display.js';

const items=['axe','pickaxe','scythe','hammer','sword','bow','arrows','cart','backpack','food','good_food','best_food','horse','wheat','timber','stone','iron','coal'];
const themes=['tools','weapons','tinker','food','merchant','stable'];
function safeSVG(svg) {
  assert.match(svg,/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg,/aria-hidden="true"/);
  assert.match(svg,/focusable="false"/);
  assert.match(svg,/<\/svg>$/);
  assert.doesNotMatch(svg,/<(?:script|foreignObject|image|style)\b|\son\w+=|\b(?:href|id)=|url\(|NaN|Infinity|undefined/);
  assert.equal((svg.match(/<svg\b/g)||[]).length,(svg.match(/<\/svg>/g)||[]).length);
}

test('all catalog items have self-contained decorative art with bounded stable markup',()=>{
  const drawings=items.map(id=>itemArt(id));
  assert.equal(new Set(drawings).size,items.length,'every item has its own recognizable drawing');
  items.forEach((id,i)=>{safeSVG(drawings[i]);assert.match(drawings[i],new RegExp(`data-item="${id}"`));assert.equal(itemArt(id),drawings[i]);assert.ok(drawings[i].length<16000);});
  for(const resource of ['wheat','timber','stone','iron','coal'])assert.equal(itemArt('resource',{resource}),itemArt(resource));
});

test('tool quality and all four backpack upgrades are visually distinct',()=>{
  for(const id of ['axe','pickaxe','scythe','hammer','sword']){
    const tiers=['wood','stone','iron'].map(tier=>itemArt(id,{tier}).replace(/data-tier="[^"]*"/,''));
    assert.equal(new Set(tiers).size,3,`${id} changes material as well as its tier label`);
  }
  const levels=[0,1,2,3].map(level=>itemArt('backpack',{level}));
  assert.equal(new Set(levels.map(s=>s.replace(/data-tier="[^"]*"/,''))).size,4);
  for(let i=0;i<4;i++)assert.equal(itemArt('backpack',{tier:i}),levels[i]);
  assert.equal(itemArt('backpack',{level:3.9}),levels[3]);
  assert.equal(itemArt('backpack',{level:Infinity}),levels[0]);
  assert.equal(itemArt('backpack',{level:-5}),levels[0]);
});

test('untrusted item, material and room inputs never enter SVG markup',()=>{
  for(const input of ['<script>alert(1)</script>','" onload="alert(1)','__proto__','constructor','toString','',null,{},42]){
    assert.equal(itemArt(input),itemArt('backpack'));
    assert.equal(itemArt('axe',{tier:input}),itemArt('axe',{tier:'wood'}));
    assert.equal(shopInterior(input),shopInterior('tools'));
    safeSVG(itemArt('resource',{resource:input,tier:input,level:input}));
  }
  assert.equal(itemArt('axe',null),itemArt('axe'));
});

test('six shop interiors can coexist without SVG ID collisions or remote dependencies',()=>{
  const views=themes.map(theme=>shopInterior(theme));
  assert.equal(new Set(views).size,6);
  for(let i=0;i<views.length;i++){
    safeSVG(views[i]);assert.match(views[i],/viewBox="0 0 1400 480"/);
    assert.match(views[i],new RegExp(`data-shop-theme="${themes[i]}"`));
    assert.equal(shopInterior(themes[i]),views[i]);assert.ok(views[i].length<100000);
  }
  safeSVG(views.join(''));
});
