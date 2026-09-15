import test from 'node:test';
import assert from 'node:assert/strict';
import { minimapView, mapDestination, createMinimap, drawMapSymbol } from '../public/src/minimap.js';
import { BUILDINGS, RESOURCES, CAVE_ENTRANCE } from '../shared/world.js';

function fixture(){
  const calls=[],attributes={},listeners=new Map();
  const context=new Proxy({createLinearGradient:()=>({addColorStop(){}})}, {get(target,key){return key in target?target[key]:(...args)=>{for(const n of args.filter(x=>typeof x==='number'))assert.ok(Number.isFinite(n),`${key} must not receive NaN`);calls.push([key,...args]);};},set(target,key,value){target[key]=value;calls.push([key,value]);return true;}});
  const canvas={width:360,height:360,getContext:()=>context,setAttribute:(key,value)=>attributes[key]=value,addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:key=>listeners.delete(key),getBoundingClientRect:()=>({left:10,top:20,width:180,height:180})};
  return {canvas,calls,attributes,listeners,context};
}

test('the local map stays centered on the dwarf and nearby landmarks scroll in and out of range',()=>{
  const a=minimapView({x:0,z:4}),b=minimapView({x:0,z:-60});
  assert.equal(a.range,42);assert.equal(a.project({x:0,z:4}).x,180);assert.equal(a.project({x:0,z:4}).y,180);
  const market=BUILDINGS.find(p=>p.id==='market');assert.equal(a.visible(market),false);assert.equal(b.visible(market),true);
  assert.ok(a.project({x:0,z:-5}).y<180,'north remains at the top');
  const clipped=a.project({x:10000,z:4},true);assert.equal(clipped.offscreen,true);assert.ok(clipped.x<360&&clipped.x>180);
  const cave=minimapView({x:9,z:-169});assert.equal(cave.range,25);assert.equal(cave.underground,true);assert.equal(cave.visible({x:0,z:-224}),false,'deepest chamber is not revealed by a whole-mine zoom');
});

test('far targets route through the mine mouth when crossing between village and cave',()=>{
  const deep={x:4,z:-216,name:'Coal seam'};
  assert.equal(mapDestination({x:0,z:4},deep).name,'Enter mountain mine');
  assert.equal(mapDestination({x:4,z:-216},{x:18,z:-86,name:'Resource Exchange'}).name,'Return to village');
  assert.equal(mapDestination({x:4,z:-209},deep).distance,7);
  assert.equal(mapDestination({x:0,z:4},null),null);
});

test('colorful map renders finite geometry, limits landmarks by vicinity, and never injects player names as HTML',()=>{
  const f=fixture(),map=createMinimap(f.canvas),name='<img src=x onerror=attack()>';
  const state={players:[{id:'other',online:true,hp:100,x:3,z:4,name}],guards:[],workers:[],zombies:[],resources:RESOURCES.map(n=>({id:n.id,available:true,type:n.type})),plots:[]};
  const surface=map.update({state,player:{x:0,z:4},ownId:'me'});
  assert.ok(surface.nearby.some(m=>m.name==='The Breadboard'));assert.ok(!surface.nearby.some(m=>m.name==='Resource Exchange'));
  assert.ok(f.attributes['aria-label'].includes(name));assert.equal(f.canvas.innerHTML,undefined);
  assert.ok(f.calls.some(([key,color])=>key==='fillStyle'&&color==='#ead087'),'wheat has a distinct gold color');
  assert.ok(f.calls.some(([key])=>key==='strokeRect'));assert.ok(f.calls.some(([key])=>key==='ellipse'),'landmarks/resources use drawn silhouettes');
  const p=surface.view.project({x:3,z:4});f.listeners.get('pointermove')({clientX:10+p.x/2,clientY:20+p.y/2});assert.ok(f.canvas.title.includes(name));
  const lower=map.update({state,player:{x:4,z:-210},ownId:'me',waypoint:{...CAVE_ENTRANCE,name:'Mine exit'}});assert.equal(lower.view.underground,true);assert.ok(!lower.nearby.some(m=>m.name==='The Breadboard'));
  map.dispose();assert.equal(f.listeners.size,0);
});

test('every structure and service has a bounded icon drawing and unknown entries use a house silhouette',()=>{
  const f=fixture();for(const kind of ['bank','market','tools','food','church','barracks','keep','stable','merchant','house','tool_shop','sword_shop','tinker_shop','mine','tree_farm','wheat_farm','archer_tower','cannon','noticeboard','cave','unknown'])drawMapSymbol(f.context,kind,20,20,24);
  assert.equal(f.calls.filter(([key])=>key==='save').length,f.calls.filter(([key])=>key==='restore').length);
  assert.ok(f.calls.length<1200,'small map icons stay inexpensive');
});
