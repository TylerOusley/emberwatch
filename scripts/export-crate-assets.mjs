// Export the original artwork catalogue at its documented rest anchors.
// Run: node scripts/export-crate-assets.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CRATE_ITEMS } from '../public/src/crate-catalog.js';
import { createCrateAsset, CRATE_REST_ANCHORS } from '../public/src/crate-assets.js';

const repo = fileURLToPath(new URL('../', import.meta.url));
const destination = join(repo, 'public/assets/crate-items');
const baseRequire = createRequire(import.meta.url);
let canvas;
try { canvas = baseRequire('@napi-rs/canvas'); }
catch (error) {
  const runtime = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
  if (!runtime) throw new Error('The export needs the installed @napi-rs/canvas package (or CODEX_PRIMARY_RUNTIME_NODE_MODULES). No packages are installed by this script.', { cause:error });
  canvas = createRequire(join(runtime,'package.json'))('@napi-rs/canvas');
}

// Three's binary exporter uses FileReader for Blob buffers. The adapters are
// confined to this Node process; no browser, display server or network is used.
class NodeFileReader {
  result = null; error = null;
  readAsArrayBuffer(blob) { this.read(blob, false); }
  readAsDataURL(blob) { this.read(blob, true); }
  read(blob, dataURL) {
    blob.arrayBuffer().then(buffer => {
      this.result = dataURL ? `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buffer).toString('base64')}` : buffer;
      this.onload?.({ target:this }); this.onloadend?.({ target:this });
    }, error => { this.error=error;this.onerror?.({target:this});this.onloadend?.({target:this}); });
  }
}
class NodeOffscreenCanvas {
  constructor(width,height) { this.canvas=canvas.createCanvas(width,height); }
  get width() { return this.canvas.width; }
  set width(value) { this.canvas.width=value; }
  get height() { return this.canvas.height; }
  set height(value) { this.canvas.height=value; }
  getContext(...args) { return this.canvas.getContext(...args); }
  async convertToBlob({type='image/png'}={}) {
    if(type!=='image/png')throw new Error(`Unexpected export image format: ${type}`);
    return new Blob([this.canvas.toBuffer('image/png')],{type});
  }
}
const previousGlobals = new Map();
for(const [key,value] of Object.entries({FileReader:NodeFileReader,OffscreenCanvas:NodeOffscreenCanvas,ImageData:canvas.ImageData,self:globalThis,
  createImageBitmap:async blob=>{const image=await canvas.loadImage(Buffer.from(await blob.arrayBuffer()));image.close=()=>{};return image;}})) {
  previousGlobals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));
  Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
}

// Weld only vertices whose complete attributes are exactly equal. Quantized
// welding would slightly change fine stitches or smooth normals at a seam.
function exactIndexedCopy(source) {
  const result=source.clone();
  if(source.index)return result;
  const attributes=Object.entries(source.attributes),rows=[],seen=new Map(),indices=[];
  for(const [,attribute] of attributes)assert.ok(!attribute.isInterleavedBufferAttribute,'Artwork exports use ordinary buffer attributes.');
  for(let i=0;i<source.attributes.position.count;i++) {
    const key=attributes.map(([,a])=>Array.from(a.array.subarray(i*a.itemSize,(i+1)*a.itemSize)).join(',')).join('|');
    let index=seen.get(key);
    if(index===undefined) { index=rows.length;seen.set(key,index);rows.push(i); }
    indices.push(index);
  }
  for(const [name,attribute] of attributes) {
    const values=new attribute.array.constructor(rows.length*attribute.itemSize);
    rows.forEach((sourceIndex,index)=>values.set(attribute.array.subarray(sourceIndex*attribute.itemSize,(sourceIndex+1)*attribute.itemSize),index*attribute.itemSize));
    result.setAttribute(name,new THREE.BufferAttribute(values,attribute.itemSize,attribute.normalized));
  }
  result.setIndex(indices);result.computeBoundingBox();result.computeBoundingSphere();return result;
}
function stats(root) {
  root.updateMatrixWorld(true);
  const box=new THREE.Box3(),materials=new Set(),images=new Set();let meshes=0,triangles=0,vertices=0,bumpMaterials=0;
  root.traverseVisible(object=>{
    if(!object.isMesh)return;
    meshes++; const g=object.geometry;
    triangles+=(g.index?.count??g.attributes.position.count)/3;vertices+=g.attributes.position.count;
    if(!g.boundingBox)g.computeBoundingBox();box.union(g.boundingBox.clone().applyMatrix4(object.matrixWorld));
    for(const material of Array.isArray(object.material)?object.material:[object.material]) {
      if(materials.has(material))continue;materials.add(material);
      if(material.bumpMap)bumpMaterials++;
      for(const value of Object.values(material))if(value?.isTexture)images.add(value.source);
    }
  });
  assert.ok(!box.isEmpty());
  const array=v=>v.toArray().map(n=>+n.toFixed(6));
  return {meshes,triangles,vertices,materials:materials.size,images:images.size,bumpMaterials,
    bounds:{min:array(box.min),max:array(box.max),size:array(box.getSize(new THREE.Vector3())),center:array(box.getCenter(new THREE.Vector3()))}};
}
function inspectGLB(arrayBuffer) {
  const buffer=Buffer.from(arrayBuffer);
  assert.equal(buffer.readUInt32LE(0),0x46546c67,'GLB magic');assert.equal(buffer.readUInt32LE(4),2,'glTF 2.0');assert.equal(buffer.readUInt32LE(8),buffer.length,'GLB file length');
  const chunks=[];let offset=12;
  while(offset<buffer.length) {
    const length=buffer.readUInt32LE(offset),type=buffer.readUInt32LE(offset+4);assert.equal(length%4,0,'aligned chunk');offset+=8;
    assert.ok(offset+length<=buffer.length,'chunk bounds');chunks.push({type,data:buffer.subarray(offset,offset+length)});offset+=length;
  }
  assert.equal(offset,buffer.length);assert.equal(chunks.length,2);assert.equal(chunks[0].type,0x4e4f534a);assert.equal(chunks[1].type,0x004e4942);
  const json=JSON.parse(chunks[0].data.toString('utf8').trim());assert.equal(json.asset.version,'2.0');assert.equal(json.buffers.length,1);
  assert.ok(!json.buffers[0].uri,'buffer is embedded');assert.ok(json.buffers[0].byteLength<=chunks[1].data.length);
  for(const view of json.bufferViews??[])assert.ok((view.byteOffset??0)+view.byteLength<=json.buffers[0].byteLength,'buffer view stays inside GLB');
  for(const image of json.images??[]) { assert.ok(!image.uri,'images are embedded');assert.equal(image.mimeType,'image/png');assert.ok(Number.isInteger(image.bufferView)); }
  assert.equal(json.animations?.length??0,0,'procedural effects are not baked clips');
  return json;
}
function disposeLoaded(root) {
  const geometries=new Set(),materials=new Set(),textures=new Set();
  root.traverse(object=>{if(object.geometry)geometries.add(object.geometry);for(const material of object.material?(Array.isArray(object.material)?object.material:[object.material]):[])materials.add(material);});
  for(const material of materials)for(const value of Object.values(material))if(value?.isTexture)textures.add(value);
  for(const texture of textures) { texture.image?.close?.();texture.dispose(); }
  for(const material of materials)material.dispose();for(const geometry of geometries)geometry.dispose();root.clear();
}
const animationNote='Procedural sparkle, ember drift and glow modulation remain in the JavaScript factories. GLBs contain static authored geometry/materials at rest, with reduced-motion effects and no animation clips.';
const exporter=new GLTFExporter();
const manager=new THREE.LoadingManager();
manager.setURLModifier(url=>{if(!url.startsWith('blob:'))throw new Error(`Unexpected external GLB dependency: ${url}`);return url;});
const loader=new GLTFLoader(manager),items=[];
try {
  await mkdir(destination,{recursive:true});
  assert.equal(CRATE_ITEMS.length,20,'Export the complete 19-item crate catalogue plus milestone helmet.');
  for(const item of CRATE_ITEMS) {
    const asset=createCrateAsset(item.id,{tool:'pickaxe',backpackTier:0}),copies=new Set();let clone,loaded;
    try {
      asset.update(0,{reducedMotion:true});asset.root.updateMatrixWorld(true);
      const source=stats(asset.root);
      clone=asset.root.clone(true);
      clone.traverse(object=>{
        if(!object.isMesh)return;
        object.geometry=exactIndexedCopy(object.geometry);copies.add(object.geometry);
      });
      const indexed=stats(clone);assert.equal(indexed.triangles,source.triangles);assert.deepEqual(indexed.bounds,source.bounds);
      const glb=await exporter.parseAsync(clone,{binary:true,onlyVisible:true,trs:true,includeCustomExtensions:true,maxTextureSize:4096});
      const json=inspectGLB(glb);
      loaded=await loader.parseAsync(glb,'');
      const reloaded=stats(loaded.scene);
      assert.equal(reloaded.meshes,indexed.meshes,`${item.id}: mesh round-trip`);assert.equal(reloaded.triangles,indexed.triangles,`${item.id}: triangle round-trip`);
      assert.equal(reloaded.bumpMaterials,indexed.bumpMaterials,`${item.id}: bump materials round-trip`);
      for(const side of ['min','max'])for(let i=0;i<3;i++)assert.ok(Math.abs(reloaded.bounds[side][i]-indexed.bounds[side][i])<.00002,`${item.id}: fitted bounds round-trip`);
      const path=`/assets/crate-items/${item.id}.glb`;
      await writeFile(join(destination,`${item.id}.glb`),Buffer.from(glb));
      items.push({id:item.id,name:item.name,tier:item.tier,slot:item.slot,wearable:item.wearable,path,byteLength:glb.byteLength,
        bounds:indexed.bounds,triangles:indexed.triangles,meshes:indexed.meshes,materials:indexed.materials,vertices:indexed.vertices,
        sourceVertices:source.vertices,embeddedImages:json.images?.length??0,extensionsUsed:json.extensionsUsed??[],
        attachments:asset.parts.map(part=>({bone:part.bone??null,anchor:part.bone?CRATE_REST_ANCHORS[part.bone]:[0,0,0],hideNames:part.hideNames??[]})),
        animationNote});
      console.log(`${item.id}: ${glb.byteLength} bytes · ${indexed.triangles} triangles · ${indexed.meshes} meshes · round-trip OK`);
    } finally {
      if(loaded)disposeLoaded(loaded.scene);for(const geometry of copies)geometry.dispose();clone?.clear();asset.dispose();
    }
  }
  const totalBytes=items.reduce((sum,item)=>sum+item.byteLength,0),totalTriangles=items.reduce((sum,item)=>sum+item.triangles,0);
  const manifest={version:1,artworkOnly:true,itemCount:items.length,crateItemCount:19,milestoneItemCount:1,generator:'scripts/export-crate-assets.mjs',
    format:'glTF 2.0 binary',coordinates:{units:'metres',up:'+Y',front:'+Z',space:'dwarf rest anchors; standalone kits centered locally'},
    defaults:{tool:'pickaxe',backpackTier:0,reducedMotion:true},validation:'All GLBs checked structurally and loaded through GLTFLoader; mesh counts, triangle counts, bounds and bump material counts verified.',
    animationNote,totalBytes,totalTriangles,items};
  await writeFile(join(destination,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log(`Exported ${items.length} GLBs: ${totalBytes} bytes (${(totalBytes/1048576).toFixed(2)} MiB), ${totalTriangles} triangles. Manifest: ${join(destination,'manifest.json')}`);
} finally {
  for(const [key,descriptor] of previousGlobals)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
}
