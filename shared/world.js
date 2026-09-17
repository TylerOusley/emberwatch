// The same geometry, resource locations and collision bounds are used by client and server.
import { CAVE_SOLIDS, caveSlot } from './caves.js';
import { LOW_OBSTACLES } from './elevation.js';
export { CAVE_AREAS, CAVE_HEIGHTS, CAVE_ROUTE, CAVE_ENTRANCE, CAVE_SOLIDS, caveAreaAt, caveTierAt, caveDepthAt, groundHeight, caveSlot, caveResourceType, caveTravelWaypoint } from './caves.js';
export const CONFIG = Object.freeze({ daySeconds:480, nightSeconds:240, maxResidents:8, speed:5.4, sprintSpeed:8, playerRadius:.48, gateMax:1200, keepMax:2000, repairCap:10 });
export const ROAD = [{x:20,z:103},{x:12,z:84},{x:0,z:65},{x:0,z:38},{x:0,z:18},{x:0,z:-35}];
export const GUARD_ROAD = [{x:-15.5,z:-3},{x:-12,z:3},{x:0,z:3},{x:0,z:15},{x:0,z:25},{x:0,z:38}];
export const BUILDINGS = [
 {id:'keep',kind:'keep',name:'The Hearthkeep',x:0,z:-43,w:16,d:12},
 {id:'barracks',kind:'barracks',name:'The Watch',x:-22,z:-3,w:10,d:9},
 {id:'church',kind:'church',name:'Sanctuary',x:22,z:-14,w:9,d:14},
 {id:'tools',kind:'shop',name:'Oak & Iron',x:-17,z:8,w:8,d:7},
 {id:'food',kind:'food',name:'The Breadboard',x:15,z:7,w:7,d:5},
 {id:'bank',kind:'bank',name:'Village Treasury',x:-18,z:-23,w:10,d:9},
 {id:'house1',kind:'house',name:'Hearthstone Cottage',x:22,z:-35,w:8,d:8},
 {id:'house2',kind:'house',name:'Bramble Cottage',x:-26,z:-39,w:8,d:7},
 {id:'stable',kind:'stable',name:'Hearthside Stables',x:19,z:-66,w:10,d:8},
 {id:'merchant',kind:'merchant',name:'The Wayfarer',x:-18,z:-67,w:10,d:7},
 {id:'market',kind:'market',name:'Resource Exchange',x:18,z:-86,w:12,d:9}
];
const buildingFacing={keep:0,barracks:Math.PI/2,tools:Math.PI/2,food:-Math.PI/2,bank:Math.PI/2,church:-Math.PI/2,house1:-Math.PI/2,house2:Math.PI/2,stable:-Math.PI/2,merchant:Math.PI/2,market:-Math.PI/2};
for(const building of BUILDINGS)building.yaw=buildingFacing[building.id]??0;
export const WORLD_BOUNDS = Object.freeze({minX:-112,maxX:112,minZ:-234,maxZ:128});
export const WALLS = [
 {x:-47.5,z:18,w:79,d:2}, {x:47.5,z:18,w:79,d:2},
 {x:-87,z:-57,w:2,d:152}, {x:87,z:-57,w:2,d:152}, {x:-47,z:-132,w:82,d:2}, {x:47,z:-132,w:82,d:2}
];
// Forty home plots fit a full eight-dwarf village at five deeds per resident.
// Each frontage opens onto a continuous neighborhood lane; exterior deeds are
// separate defensive positions and share the same ownership limit.
export const PLOTS=[];
for(const side of [-1,1])for(let column=0;column<2;column++)for(let row=0;row<10;row++){
 const district=side<0?'West':'East',number=column*10+row+1;
 PLOTS.push({id:`${side<0?'west':'east'}-${number}`,name:`${district} Hearth ${number}`,
  x:side*(column?72:50),z:3-row*14,w:14,d:10,outside:false,yaw:-side*Math.PI/2});
}
for(const [index,position] of [[-13,31],[13,31],[-13,63],[13,63],[-22,78],[29,78],[-13,99],[43,94]].entries()){
 const [x,z]=position;
 PLOTS.push({id:`outpost-${index+1}`,name:`Outer Watch ${index+1}`,x,z,w:10,d:10,outside:true,yaw:x<0?Math.PI/2:-Math.PI/2});
}
export function plotFront(plot,inset=0){
 const yaw=plot.yaw??0,half=Math.abs(Math.sin(yaw))>.5?plot.w/2:plot.d/2;
 return {x:plot.x+Math.sin(yaw)*(half-inset),z:plot.z+Math.cos(yaw)*(half-inset)};
}
export function plotSolid(plot,building){
 const footprint={house:[7,6],tool_shop:[7,6],tinker_shop:[7,6],sword_shop:[7,6],
  barracks:[8,6],church:[7,6],archer_tower:[4,4],cannon:[3.8,3.8],arcane_academy:[7,6],wizard_tower:[4,4]}[building];
 if(!footprint)return null;
 const quarter=Math.abs(Math.sin(plot.yaw??0))>.5;
 return {x:plot.x,z:plot.z,w:quarter?footprint[1]:footprint[0],d:quarter?footprint[0]:footprint[1]};
}
export function plotBedPoint(site,index=0){
 const yaw=site.yaw??0,x=index%2?2.5:-2.5,z=(site.id==='church'?6.2:4.2)+Math.floor(index/2)*1.8;
 return {x:site.x+Math.cos(yaw)*x+Math.sin(yaw)*z,z:site.z-Math.sin(yaw)*x+Math.cos(yaw)*z};
}
export function plotSolids(states=[]){
 const rows=Array.isArray(states)?states:Object.values(states||{});
 return rows.flatMap(state=>{const plot=PLOTS.find(p=>p.id===state.id),solid=plot&&state.building&&!(state.hp<=0)&&plotSolid(plot,state.building);return solid?[solid]:[];});
}
export function plotAccessRoute(plot){
 const front=plotFront(plot,1);
 if(plot.outside)return [front,{x:0,z:plot.z},{x:0,z:35}];
 const side=plot.x<0?-1:1,lane=side*(Math.abs(plot.x)>60?61:39);
 return [front,{x:lane,z:plot.z},{x:lane,z:14},{x:0,z:14},{x:0,z:25},{x:0,z:35}];
}
export const SOLIDS = [...BUILDINGS.map(b=>({x:b.x,z:b.z,w:b.w,d:b.d})),...WALLS,...CAVE_SOLIDS,{x:8,z:-4,w:3.1,d:3.1},
 {x:-8,z:18,w:4.5,d:5}, {x:8,z:18,w:4.5,d:5}];
export function seeded(seed=42){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const random=seeded(3248);
export const RESOURCES=[];
function node(type,x,z){RESOURCES.push({id:type+'-'+RESOURCES.length,type,x,z,seed:Math.floor(random()*10000)});}
for(const [x,z] of [[-29,10],[-30,-15],[-28,-25],[30,7],[31,-3],[9,-31],[-8,-31],[-10,-18],[-29,-32],[29,-43],[-31,1]])node('timber',x,z);
for(let i=0;i<36;i++){const side=i%2?1:-1;node('timber',side*(17+random()*37),30+random()*58);}
// Keep the quarry clear of the sanctuary, cottages and wall, with room to
// approach every outcrop. Consume the same two position samples before node()
// so existing resource IDs, appearance seeds and saved depletion states survive.
for(let i=0;i<12;i++)node('stone',30.2+(i%2)*2.5+(random()-.5)*.24,-29+Math.floor(i/2)*2.5+(random()-.5)*.24);
for(let i=0;i<30;i++)node('wheat',-29+(i%6)*.8,-13+Math.floor(i/6)*.8);
for(let i=0;i<48;i++)node('wheat',18+(i%8)*.85,45+Math.floor(i/8)*.85);
// Append new gather sites without changing any of the original resource IDs.
// Iron and coal are available publicly; private mines offer safer convenience.
for(let i=0;i<10;i++)node('iron',-30+(i%5)*2.5,-79-Math.floor(i/5)*3);
for(let i=0;i<8;i++)node('coal',19+(i%4)*2.5,-81-Math.floor(i/4)*3);
for(let i=0;i<14;i++)node(i%2?'coal':'iron',-58+(i%7)*3,95+Math.floor(i/7)*3);
for(let i=0;i<36;i++)node('wheat',51+(i%9)*.85,52+Math.floor(i/9)*.85);
for(let i=0;i<22;i++)node('timber',(i%2?1:-1)*(93+random()*9),-115+random()*119);
for(let i=0;i<22;i++)node('timber',(i%2?1:-1)*(60+random()*35),28+random()*65);
for(let i=0;i<16;i++)node('timber',(i%2?1:-1)*(17+(i%4)*3.2),-96-Math.floor(i/4)*7);
// Trees can regrow naturally around the village but never inside a deed or on
// its entrance. Saved depletion uses identity, so moving an outcrop is safe.
for(const resource of RESOURCES){
 if(!PLOTS.some(p=>Math.abs(resource.x-p.x)<p.w/2+2.5&&Math.abs(resource.z-p.z)<p.d/2+2.5))continue;
 const sign=resource.x<0?-1:1;
 resource.x=sign*(96+(Number(resource.id.split('-').at(-1))%5)*2);
 resource.z=24+(Number(resource.id.split('-').at(-1))%16)*5;
}
// Reposition minerals after original deterministic generation: every resource
// identity/type/appearance seed and all non-mineral positions remain intact.
let caveIndex=0;
for(const resource of RESOURCES)if(['stone','iron','coal'].includes(resource.type))Object.assign(resource,caveSlot(caveIndex++));
// Dedicated sulfur veins append identities without moving or rerolling any
// existing outcrop. Interleaved deep-chamber positions keep them accessible.
for(let i=0;i<8;i++){
 node('sulfur',i%2?11:-11,-210-Math.floor(i/2)*6);
 Object.assign(RESOURCES.at(-1),{caveTier:'deep',depth:14});
}
export function resolveResource(resource,state){
 return resource?.caveTier?{...resource,type:state?.type??resource.type,roll:state?.roll??0}:resource;
}
export function clearResourceSegment(from,to,extraSolids=[]){
 for(const s of [...SOLIDS,...extraSolids]){
  let low=0,high=1;
  for(const [start,delta,center,half] of [[from.x,to.x-from.x,s.x,s.w/2],[from.z,to.z-from.z,s.z,s.d/2]]){
   if(Math.abs(delta)<1e-9){if(Math.abs(start-center)>half){low=1;high=0;break;}}
   else{const a=(center-half-start)/delta,b=(center+half-start)/delta;low=Math.max(low,Math.min(a,b));high=Math.min(high,Math.max(a,b));}
  }
  if(low<=high&&high>1e-7&&low<1-1e-7)return false;
 }
 return true;
}
export const TOOLS = [
 {id:'sword',name:'Wooden sword',key:'1',tier:1,durability:100},
 {id:'axe',name:'Wooden axe',key:'2',tier:1,durability:100},
 {id:'pickaxe',name:'Wooden pickaxe',key:'3',tier:1,durability:100},
 {id:'scythe',name:'Wooden scythe',key:'4',tier:1,durability:100},
 {id:'hammer',name:'Wooden hammer',key:'5',tier:1,durability:100},
 {id:'food',name:'Bread',key:'6',tier:1},
 {id:'heal',name:'Priest blessing',key:'7',tier:1}
];
export function canStand(x,z,r=.48,extraSolids=[],feetY=0){
 if(!Number.isFinite(x)||!Number.isFinite(z)||x < WORLD_BOUNDS.minX+r||x > WORLD_BOUNDS.maxX-r||z < WORLD_BOUNDS.minZ+r||z > WORLD_BOUNDS.maxZ-r)return false;
 return ![...SOLIDS,...extraSolids,...LOW_OBSTACLES.filter(s=>feetY<s.height-.04)].some(s=>Math.abs(x-s.x)<s.w/2+r&&Math.abs(z-s.z)<s.d/2+r);
}
export function moveWithCollision(p,dx,dz,r=.48,extraSolids=[],feetY=0){
 const steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.3));
 for(let i=0;i<steps;i++){if(canStand(p.x+dx/steps,p.z,r,extraSolids,feetY))p.x+=dx/steps;if(canStand(p.x,p.z+dz/steps,r,extraSolids,feetY))p.z+=dz/steps;}
 return p;
}
