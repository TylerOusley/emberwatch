import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {createApp} from '../server/index.js';
import {PET_CATALOG} from '../shared/pets.js';

test('local graphics and recorded audio assets reach clients with exact bytes and MIME types',async t=>{
  const dataDir=await mkdtemp(join(tmpdir(),'emberwatch-graphics-http-'));
  const app=createApp({dataDir,autoTick:false,testAdminAccountIds:[]});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  t.after(async()=>{await app.close();await rm(dataDir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const pets=Object.values(PET_CATALOG).flatMap(pet=>[`/assets/pets/${pet.assetId}/model.glb`,`/assets/pets/${pet.assetId}/thumbnail.png`]);
  for(const path of ['/assets/surfaces/grass-albedo.jpg','/assets/sky/moon-albedo.jpg',...['pickaxe-rock-1','pickaxe-rock-2','pickaxe-rock-3','pickaxe-rock-4','wood-chop'].map(name=>`/assets/audio/${name}.mp3`),...pets]){
    const response=await fetch(base+path);assert.equal(response.status,200,path);assert.equal(response.headers.get('content-type'),path.endsWith('.mp3')?'audio/mpeg':path.endsWith('.glb')?'model/gltf-binary':path.endsWith('.png')?'image/png':'image/jpeg');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
    const actual=Buffer.from(await response.arrayBuffer()),expected=await readFile(new URL('../public'+path,import.meta.url));
    assert.equal(createHash('sha256').update(actual).digest('hex'),createHash('sha256').update(expected).digest('hex'));
  }
  for(const path of ['/src/render-pipeline.js','/src/render-quality.js','/src/surface-materials.js','/src/environment-geometry.js','/graphics-settings.css']){
    const response=await fetch(base+path,{method:'HEAD'});assert.equal(response.status,200,path);assert.match(response.headers.get('content-type'),path.endsWith('.js')?/javascript/:/text\/css/);
  }
  const home=await(await fetch(base)).text();assert.match(home,/PLAYABLE BUILD 32/);assert.match(home,/id="lobby-graphics-button"/);assert.match(home,/id="environment-hud"/);assert.match(home,/href="\/environment.css"/);
  assert.match(home,/"three\/addons\/":"\/vendor\/three-addons\/"/);
  for(const path of ['/vendor/three-addons/loaders/GLTFLoader.js','/vendor/three-addons/utils/SkeletonUtils.js','/vendor/three-addons/utils/BufferGeometryUtils.js']){
    const response=await fetch(base+path);assert.equal(response.status,200,path);assert.match(response.headers.get('content-type'),/javascript/);
    const expected=await readFile(new URL('../node_modules/three/examples/jsm/'+path.slice('/vendor/three-addons/'.length),import.meta.url),'utf8');
    assert.equal(await response.text(),expected,path);
  }
  for(const path of ['/vendor/three-addons/..%2f..%2f..%2fpackage.json','/vendor/three-addons/%00.js']){
    assert.equal((await fetch(base+path)).status,403,path);
  }
  const credits=await fetch(base+'/assets/pets/CREDITS.html');assert.equal(credits.status,200);assert.match(credits.headers.get('content-type'),/text\/html/);
  const creditText=await credits.text();for(const pet of Object.values(PET_CATALOG))assert.ok(creditText.includes(pet.name),pet.name);
});
