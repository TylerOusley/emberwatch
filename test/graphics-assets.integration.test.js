import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {createApp} from '../server/index.js';

test('local graphics assets reach browser clients with their exact bytes and image types',async t=>{
  const dataDir=await mkdtemp(join(tmpdir(),'emberwatch-graphics-http-'));
  const app=createApp({dataDir,autoTick:false,testAdminAccountIds:[]});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  t.after(async()=>{await app.close();await rm(dataDir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${app.server.address().port}`;
  for(const path of ['/assets/surfaces/grass-albedo.jpg','/assets/sky/moon-albedo.jpg']){
    const response=await fetch(base+path);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/jpeg');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
    const actual=Buffer.from(await response.arrayBuffer()),expected=await readFile(new URL('../public'+path,import.meta.url));
    assert.equal(createHash('sha256').update(actual).digest('hex'),createHash('sha256').update(expected).digest('hex'));
  }
  for(const path of ['/src/render-pipeline.js','/src/render-quality.js','/src/surface-materials.js','/src/environment-geometry.js','/graphics-settings.css']){
    const response=await fetch(base+path,{method:'HEAD'});assert.equal(response.status,200,path);assert.match(response.headers.get('content-type'),path.endsWith('.js')?/javascript/:/text\/css/);
  }
  const home=await(await fetch(base)).text();assert.match(home,/PLAYABLE BUILD 18/);assert.match(home,/id="lobby-graphics-button"/);
});
