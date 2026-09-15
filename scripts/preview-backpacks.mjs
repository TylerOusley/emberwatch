// Export the actual four backpack tiers for the existing CPU model renderer.
// node scripts/preview-backpacks.mjs [output.json] [yaw] [idle|walk|mounted|downed]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.resolve(process.argv[2]??'/tmp/emberwatch-backpacks.json');
const yaw=process.argv[3]??'2.75',pose=process.argv[4]??'idle';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'emberwatch-backpack-preview-'));
try {
  const wrapper=path.join(temporary,'backpack-lineup.mjs');
  fs.writeFileSync(wrapper,`import {createCharacter as original} from ${JSON.stringify(pathToFileURL(path.join(repo,'public/src/characters.js')).href)};
export function createCharacter(kind,seed) {
  const actor=original('villager',seed);actor.setBackpackTier(seed-1);actor.setTool('');
  actor.setTool=()=>{};return actor;
}`);
  execFileSync(process.execPath,[path.join(repo,'scripts/preview-characters.mjs'),wrapper,output,yaw,pose],{cwd:repo,stdio:'pipe'});
  const data=JSON.parse(fs.readFileSync(output,'utf8'));
  const labels=['No backpack','Simple backpack','Reinforced backpack','Expedition backpack'];
  for(let i=0;i<data.stats.length;i++)data.stats[i].kind=labels[i];
  data.lineup='backpacks';fs.writeFileSync(output,JSON.stringify(data));
  console.log(JSON.stringify({output,stats:data.stats}));
} finally {fs.rmSync(temporary,{recursive:true,force:true});}
