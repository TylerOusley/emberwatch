// The same geometry, resource locations and collision bounds are used by client and server.
export const CONFIG = Object.freeze({ daySeconds:480, nightSeconds:240, maxResidents:8, speed:5.4, sprintSpeed:8, playerRadius:.48, gateMax:1200, keepMax:2000, repairCap:10 });
export const ROAD = [{x:20,z:103},{x:12,z:84},{x:0,z:65},{x:0,z:38},{x:0,z:18},{x:0,z:-35}];
export const GUARD_ROAD = [{x:-22,z:3},{x:-12,z:3},{x:0,z:3},{x:0,z:15},{x:0,z:25},{x:0,z:38}];
export const BUILDINGS = [
 {id:'keep',kind:'keep',name:'The Hearthkeep',x:0,z:-43,w:16,d:12},
 {id:'barracks',kind:'barracks',name:'The Watch',x:-22,z:-3,w:10,d:9},
 {id:'church',kind:'church',name:'Sanctuary',x:22,z:-14,w:9,d:14},
 {id:'tools',kind:'shop',name:'Oak & Iron',x:-17,z:8,w:8,d:7},
 {id:'food',kind:'food',name:'The Breadboard',x:15,z:7,w:7,d:5},
 {id:'bank',kind:'bank',name:'Village Treasury',x:-18,z:-23,w:10,d:9},
 {id:'house1',kind:'house',name:'Hearthstone Cottage',x:22,z:-35,w:8,d:8},
 {id:'house2',kind:'house',name:'Bramble Cottage',x:-26,z:-39,w:8,d:7}
];
export const WALLS = [
 {x:-22,z:18,w:28,d:2}, {x:22,z:18,w:28,d:2},
 {x:-36,z:-16,w:2,d:70}, {x:36,z:-16,w:2,d:70}, {x:0,z:-50,w:74,d:2}
];
export const SOLIDS = [...BUILDINGS.map(b=>({x:b.x,z:b.z,w:b.w,d:b.d})),...WALLS,{x:8,z:-4,w:3.1,d:3.1},
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
export const TOOLS = [
 {id:'sword',name:'Wooden sword',key:'1',tier:1,durability:100},
 {id:'axe',name:'Wooden axe',key:'2',tier:1,durability:100},
 {id:'pickaxe',name:'Wooden pickaxe',key:'3',tier:1,durability:100},
 {id:'scythe',name:'Wooden scythe',key:'4',tier:1,durability:100},
 {id:'hammer',name:'Wooden hammer',key:'5',tier:1,durability:100},
 {id:'food',name:'Bread',key:'6',tier:1},
 {id:'heal',name:'Priest blessing',key:'7',tier:1}
];
export function canStand(x,z,r=.48){
 if(!Number.isFinite(x)||!Number.isFinite(z)||x < -60+r||x > 60-r||z < -53+r||z > 115-r)return false;
 return !SOLIDS.some(s=>Math.abs(x-s.x)<s.w/2+r&&Math.abs(z-s.z)<s.d/2+r);
}
export function moveWithCollision(p,dx,dz,r=.48){
 const steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.3));
 for(let i=0;i<steps;i++){if(canStand(p.x+dx/steps,p.z,r))p.x+=dx/steps;if(canStand(p.x,p.z+dz/steps,r))p.z+=dz/steps;}
 return p;
}
