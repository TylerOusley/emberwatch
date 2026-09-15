// Draw the actual Canvas2D minimap without a browser. Optional preview dependency:
// @napi-rs/canvas, resolved from local dependencies or the configured runtime.
// node scripts/preview-minimap.mjs [output.png]
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {createMinimap} from '../public/src/minimap.js';
import {RESOURCES,PLOTS,caveResourceType} from '../shared/world.js';
const local=createRequire(import.meta.url);
let canvasLibrary;try{canvasLibrary=local('@napi-rs/canvas');}catch{
  if(!process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES)throw new Error('Install optional @napi-rs/canvas to render this preview.');
  canvasLibrary=createRequire(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/package.json')('@napi-rs/canvas');
}
const {createCanvas}=canvasLibrary;
globalThis.document={createElement:()=>createCanvas(512,512)};
const moduleURL=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const threeURL=new URL('../node_modules/three/build/three.module.js',import.meta.url).href,sharedURL=new URL('../shared/world.js',import.meta.url).href;
const plots=readFileSync(new URL('../public/src/plots-world.js',import.meta.url),'utf8').replace("'three'",JSON.stringify(threeURL)).replace("'/shared/world.js'",JSON.stringify(sharedURL));
const worldSource=readFileSync(new URL('../public/src/world.js',import.meta.url),'utf8').replace("'three'",JSON.stringify(threeURL)).replace("'/shared/world.js'",JSON.stringify(sharedURL)).replace("'./plots-world.js'",JSON.stringify(moduleURL(plots)));
const {createWorld}=await import(moduleURL(worldSource)),world=createWorld(new THREE.Scene());
const state={players:[{id:'friend',name:'Elowen',online:true,hp:100,x:5,z:1}],guards:[{x:0,z:30,hp:100}],workers:[],zombies:[{x:0,z:38,hp:100},{x:1,z:39,hp:100}],gate:{hp:1200},plots:PLOTS.slice(0,4).map((p,i)=>({id:p.id,ownerId:'me',building:['house','tool_shop','tree_farm','barracks'][i]})),resources:RESOURCES.map(n=>({id:n.id,available:true,type:n.caveTier?caveResourceType(n.caveTier,`preview-cave:${n.id}`,0):n.type}))};
const output=createCanvas(1272,556),c=output.getContext('2d');c.fillStyle='#162e26';c.fillRect(0,0,output.width,output.height);c.fillStyle='#e5ce97';c.font='bold 23px sans-serif';c.fillText('EMBERWATCH / THE NEARBY MAP',29,40);c.fillStyle='#b2c4ad';c.font='15px sans-serif';c.fillText('Actual Canvas2D rendering and village roads · North stays up · The dwarf stays centered',29,68);
const scenarios=[{player:{x:0,z:4},title:'THE VILLAGE SQUARE',copy:'Nearby services, roads, allies and threats',waypoint:{x:18,z:-86,name:'Resource Exchange'}},{player:{x:8,z:-80},title:'THE NORTHERN VILLAGE',copy:'Stables, the exchange and the mine entrance',waypoint:{x:0,z:-118,name:'Mountain mine'}},{player:{x:9,z:-166},title:'THE MINE PASSAGE',copy:'Local chambers, mixed ore and the exit route',waypoint:{x:18,z:-86,name:'Resource Exchange'}}];
for(const [i,scenario]of scenarios.entries()){
  const canvas=createCanvas(360,360),map=createMinimap(canvas),result=map.update({state,ownId:'me',yaw:Math.PI,lanes:world.root.userData.lanes,...scenario});
  const x=27+i*418;c.drawImage(canvas,x+21,87);c.fillStyle='#e5ce97';c.font='bold 16px sans-serif';c.fillText(scenario.title,x,477);c.fillStyle='#b2c4ad';c.font='13px sans-serif';c.fillText(scenario.copy,x,501);c.fillStyle='#ddbd7a';c.fillText(result.waypointLabel,x,527);map.dispose();
}
const path=process.argv[2]||new URL('../docs/previews/minimap.png',import.meta.url);writeFileSync(path,output.toBuffer('image/png'));console.log(String(path));
