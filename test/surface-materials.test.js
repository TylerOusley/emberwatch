import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {SURFACE_KINDS,createSurfaceMaterial,applySurface,configureSurfaceTextures,surfaceTextures,surfaceTextureStatus} from '../public/src/surface-materials.js';

const compile=material=>{
  const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};
  material.onBeforeCompile(shader);return shader;
};
function jpegSize(bytes){
  let offset=2;
  while(offset<bytes.length){
    assert.equal(bytes[offset++],255);let marker=bytes[offset++];
    while(marker===255)marker=bytes[offset++];
    if(marker===0xd9||marker===0xda)break;
    const length=bytes.readUInt16BE(offset);
    if([0xc0,0xc1,0xc2].includes(marker))return {width:bytes.readUInt16BE(offset+5),height:bytes.readUInt16BE(offset+3)};
    offset+=length;
  }
  throw Error('No JPEG image dimensions found');
}

test('downloaded maps are complete original 1K JPEGs with recorded hashes and a bounded download budget',()=>{
  const directory=new URL('../public/assets/surfaces/',import.meta.url),manifest=JSON.parse(readFileSync(new URL('manifest.json',directory)));
  assert.equal(manifest.license,'CC0-1.0');assert.equal(manifest.files.length,SURFACE_KINDS.length*3);
  assert.equal(new Set(manifest.files.map(file=>file.file)).size,manifest.files.length);
  let total=0;
  for(const kind of SURFACE_KINDS)assert.deepEqual(manifest.files.filter(file=>file.kind===kind).map(file=>file.role).sort(),['albedo','normal','roughness']);
  for(const file of manifest.files){
    const bytes=readFileSync(new URL(file.file,directory));total+=bytes.length;
    assert.equal(bytes.length,file.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);
    assert.deepEqual(jpegSize(bytes),{width:1024,height:1024});
    assert.ok(file.url.startsWith('https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/'));
  }
  assert.ok(total<15_000_000,`Surface download size ${total}`);
});

test('material factories run without document or window and provide valid neutral image fallbacks',()=>{
  assert.equal(typeof document,'undefined');assert.equal(typeof window,'undefined');
  for(const kind of SURFACE_KINDS){
    const material=createSurfaceMaterial(kind,{color:'#b5c6aa',flatShading:true,vertexColors:true});
    assert.ok(material.isMeshStandardMaterial);assert.equal(material.vertexColors,true);assert.equal(material.flatShading,true);
    const shader=compile(material),albedo=shader.uniforms.surfaceAlbedo.value,normal=shader.uniforms.surfaceNormal.value,roughness=shader.uniforms.surfaceRoughness.value;
    assert.equal(albedo.colorSpace,THREE.SRGBColorSpace);assert.equal(normal.colorSpace,THREE.NoColorSpace);assert.equal(roughness.colorSpace,THREE.NoColorSpace);
    assert.deepEqual([...albedo.image.data],[255,255,255,255]);assert.deepEqual([...normal.image.data],[128,128,255,255]);
    assert.equal(albedo.wrapS,THREE.RepeatWrapping);assert.equal(normal.minFilter,THREE.LinearMipmapLinearFilter);
    material.dispose();
  }
  assert.ok(surfaceTextureStatus().every(record=>record.status==='idle'));
});

test('instanced world projection replaces UV color and roughness sampling without taking over authored geometry',()=>{
  const material=createSurfaceMaterial('rock',{worldScale:2.5,normalStrength:.4});const shader=compile(material);
  assert.ok(shader.vertexShader.includes('instanceMatrix * surfacePosition'));
  assert.ok(shader.vertexShader.includes('modelMatrix * surfacePosition'));
  assert.ok(shader.vertexShader.includes('inverseTransformDirection(transformedNormal, viewMatrix)'));
  assert.ok(shader.fragmentShader.includes('surfacePoint = vSurfaceWorldPosition / surfaceWorldScale'));
  assert.ok(!shader.fragmentShader.includes('#include <map_fragment>'));
  assert.ok(!shader.fragmentShader.includes('#include <roughnessmap_fragment>'));
  assert.ok(shader.fragmentShader.includes('#include <normal_fragment_maps>'),'pre-existing normal/bump materials keep their base normal');
  assert.ok(shader.fragmentShader.includes('surfaceBaseNormal = inverseTransformDirection(normal,viewMatrix)'));
  assert.equal(shader.uniforms.surfaceWorldScale.value,2.5);assert.equal(shader.uniforms.surfaceNormalStrength.value,.4);
  material.dispose();
});

test('changing kind or scale updates already compiled uniform bindings, without nested shader patches',()=>{
  const material=createSurfaceMaterial('wood',{color:'#abc123'}),shader=compile(material),before=shader.uniforms.surfaceAlbedo.value;
  applySurface(material,'rock',{worldScale:8,normalStrength:.8});
  assert.notEqual(shader.uniforms.surfaceAlbedo.value,before);assert.equal(shader.uniforms.surfaceWorldScale.value,8);
  assert.equal(shader.uniforms.surfaceNormalStrength.value,.8);assert.equal(material.color.getHexString(),'abc123');
  const second=compile(material);assert.equal(second.vertexShader.split('varying vec3 vSurfaceWorldPosition;').length,2);
  assert.equal(shader.uniforms.surfaceAlbedo,second.uniforms.surfaceAlbedo);material.dispose();
});

test('surface materials retain prior shader extensions and independently editable tints',()=>{
  let calls=0;const material=new THREE.MeshStandardMaterial({roughness:.72,metalness:.1});
  material.onBeforeCompile=shader=>{calls++;shader.uniforms.existing={value:3};};material.customProgramCacheKey=()=> 'prior-material';
  assert.equal(applySurface(material,'masonry'),material);const shader=compile(material);
  assert.equal(calls,1);assert.equal(shader.uniforms.existing.value,3);assert.ok(material.customProgramCacheKey().includes('prior-material'));
  assert.equal(material.roughness,.72);assert.equal(material.metalness,.1);
  const first=createSurfaceMaterial('wood','#ffffff'),second=createSurfaceMaterial('wood','#888888');
  assert.notEqual(first,second);assert.notEqual(first.color,second.color);assert.equal(compile(first).uniforms.surfaceAlbedo.value,compile(second).uniforms.surfaceAlbedo.value);
  let disposed=0;compile(first).uniforms.surfaceAlbedo.value.addEventListener('dispose',()=>disposed++);
  first.dispose();assert.equal(disposed,0,'one village does not dispose textures in use by another');second.dispose();material.dispose();
});

test('quality changes cover shared custom samplers and relief without new texture records',()=>{
  const material=createSurfaceMaterial('grass'),shader=compile(material),count=surfaceTextures().length;
  configureSurfaceTextures({anisotropy:8,normalMaps:false});
  assert.equal(shader.uniforms.surfaceReliefEnabled.value,0);assert.ok(surfaceTextures().every(texture=>texture.anisotropy===8));
  configureSurfaceTextures({anisotropy:2,normalMaps:true});assert.equal(shader.uniforms.surfaceReliefEnabled.value,1);
  assert.equal(surfaceTextures().length,count);assert.ok(surfaceTextures().every(texture=>texture.anisotropy===2));
  configureSurfaceTextures({anisotropy:4});material.dispose();
});

test('browser maps load once per kind and complete or fail without replacing valid shader bindings',()=>{
  const previousLoad=THREE.TextureLoader.prototype.load,requests=[];
  globalThis.window={};globalThis.document={createElementNS(){}};
  THREE.TextureLoader.prototype.load=function(url,onLoad,onProgress,onError){const texture=new THREE.Texture();requests.push({url,onLoad,onError,texture});return texture;};
  try{
    const first=createSurfaceMaterial('wood'),second=createSurfaceMaterial('wood'),shader=compile(first),other=compile(second);
    assert.equal(requests.length,3);assert.ok(requests.every(request=>request.url.startsWith('/assets/surfaces/wood-')));
    const before=shader.uniforms.surfaceAlbedo.value;
    const albedo=requests.find(request=>request.url.includes('albedo'));albedo.onLoad(albedo.texture);
    assert.notEqual(shader.uniforms.surfaceAlbedo.value,before);assert.equal(shader.uniforms.surfaceAlbedo.value,other.uniforms.surfaceAlbedo.value);
    assert.equal(shader.uniforms.surfaceAlbedo.value.colorSpace,THREE.SRGBColorSpace);
    const normalBefore=shader.uniforms.surfaceNormal.value;requests.find(request=>request.url.includes('normal')).onError();
    assert.equal(shader.uniforms.surfaceNormal.value,normalBefore);assert.ok(normalBefore.image.data,'a failed request retains a usable neutral map');
    requests.find(request=>request.url.includes('roughness')).onLoad(requests.find(request=>request.url.includes('roughness')).texture);
    createSurfaceMaterial('wood').dispose();assert.equal(requests.length,3,'failure does not cause a per-object retry storm');
    assert.equal(surfaceTextureStatus().find(record=>record.kind==='wood'&&record.role==='normal').status,'failed');
    first.dispose();second.dispose();
  }finally{THREE.TextureLoader.prototype.load=previousLoad;delete globalThis.window;delete globalThis.document;}
});

test('material input validation and aliases keep surface parameters finite and constrained',()=>{
  assert.throws(()=>createSurfaceMaterial('imaginary'),RangeError);assert.throws(()=>applySurface(new THREE.MeshBasicMaterial(),'rock'),TypeError);
  for(const [alias,kind] of [['soil','earth'],['path','cobble'],['stone','masonry'],['timber','wood'],['plaster','rock']]){
    const material=createSurfaceMaterial(alias,{worldScale:-4,normalStrength:Infinity});
    assert.equal(material.userData.surface.kind,kind);assert.ok(material.userData.surface.worldScale>0);assert.ok(Number.isFinite(material.userData.surface.normalStrength));material.dispose();
  }
});
