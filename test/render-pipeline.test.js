import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createRenderPipeline,createSkyReflection} from '../public/src/render-pipeline.js';

function fixture({hdr=true,colorSamples=[4,2],depthSamples=[4,2]}={}){
  const calls=[],gl={RENDERBUFFER:1,RGBA16F:2,DEPTH_COMPONENT24:3,SAMPLES:4,getInternalformatParameter(_target,type){return type===2?colorSamples:depthSamples;}};
  let width=960,height=540;
  const renderer={extensions:{has:()=>hdr},getContext:()=>gl,capabilities:{maxSamples:4},info:{reset(){calls.push('reset');}},getDrawingBufferSize:v=>v.set(width,height),setRenderTarget:t=>calls.push(t),render:(s,c)=>calls.push([s,c])};
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),pipeline=createRenderPipeline(renderer,scene,camera);
  return {renderer,scene,camera,pipeline,calls,size(w,h){width=w;height=h;}};
}
test('presentation draws the scene exactly once then resolves to the screen',()=>{
  const f=fixture();f.pipeline.configure({postProcessing:true,samples:4,contactShadows:true,bloom:true});
  const target=f.pipeline.target;assert.equal(target.samples,4);assert.equal(target.width,960);assert.equal(target.depthTexture.type,THREE.UnsignedIntType);assert.equal(target.texture.type,THREE.HalfFloatType);
  f.pipeline.render();assert.equal(f.calls.filter(x=>Array.isArray(x)&&x[0]===f.scene).length,1);assert.equal(f.calls.filter(Array.isArray).length,2);assert.equal(f.calls.at(-2),null);f.pipeline.dispose();
});
test('HDR multisampling uses the intersection supported by color and depth formats',()=>{
  const f=fixture({colorSamples:[2],depthSamples:[4,2]});f.pipeline.configure({postProcessing:true,samples:4});assert.equal(f.pipeline.target.samples,2);
  const noMatch=fixture({colorSamples:[4],depthSamples:[2]});noMatch.pipeline.configure({postProcessing:true,samples:4});assert.equal(noMatch.pipeline.target.samples,0);f.pipeline.dispose();noMatch.pipeline.dispose();
});
test('low detail and unsupported HDR use one direct render with no extra target',()=>{
  for(const f of [fixture(),fixture({hdr:false})]){
    f.pipeline.configure({postProcessing:!f.renderer.extensions.has(),samples:4});f.pipeline.render();assert.equal(f.pipeline.target,null);assert.equal(f.calls.filter(Array.isArray).length,1);f.pipeline.dispose();
  }
});
test('target resizing reuses its object; each attachment resize or release occurs once',()=>{
  const f=fixture();f.pipeline.configure({postProcessing:true,samples:2});const first=f.pipeline.target;let disposed=0;first.addEventListener('dispose',()=>disposed++);
  f.size(1280,720);f.pipeline.resize();assert.equal(f.pipeline.target,first);assert.equal(first.width,1280);f.pipeline.configure({postProcessing:true,samples:2});assert.equal(disposed,1);
  f.pipeline.configure({postProcessing:false});assert.equal(disposed,2);f.pipeline.dispose();f.pipeline.dispose();assert.equal(disposed,2);const count=f.calls.length;f.pipeline.render();assert.equal(f.calls.length,count);
});
test('reflection gracefully stays absent on renderers without float targets',()=>{
  const f=fixture({hdr:false});const reflection=createSkyReflection(f.renderer,f.scene);reflection.update(1,0);assert.equal(f.scene.environment,null);reflection.dispose();f.pipeline.dispose();
});
