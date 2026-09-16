import * as THREE from 'three';

// One scene draw and one full-screen resolve. The optional contact shading reads
// the existing depth buffer; it never draws all characters a second time.
export const presentationVertex = `
  varying vec2 vUv;
  void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}
`;
export const presentationFragment = `
  varying vec2 vUv;
  uniform sampler2D sceneColor,sceneDepth;
  uniform mat4 inverseProjection;
  uniform vec2 texel;
  uniform float contactStrength,bloomStrength,edgeSmoothing;
  vec3 viewPosition(vec2 uv,float depth){
    vec4 p=inverseProjection*vec4(uv*2.0-1.0,depth*2.0-1.0,1.0);
    return p.xyz/p.w;
  }
  vec3 highlight(vec2 uv){return max(texture2D(sceneColor,uv).rgb-vec3(1.4),vec3(0.0));}
  // Directional edge filtering is a fallback for GPUs without multisampled
  // half-float targets. Along-edge samples preserve fine surface detail.
  vec3 smoothEdge(vec3 center){
    vec3 weights=vec3(.299,.587,.114);
    float nw=dot(texture2D(sceneColor,vUv+texel*vec2(-1.0,1.0)).rgb,weights);
    float ne=dot(texture2D(sceneColor,vUv+texel*vec2(1.0,1.0)).rgb,weights);
    float sw=dot(texture2D(sceneColor,vUv+texel*vec2(-1.0,-1.0)).rgb,weights);
    float se=dot(texture2D(sceneColor,vUv+texel*vec2(1.0,-1.0)).rgb,weights);
    float mid=dot(center,weights),lo=min(mid,min(min(nw,ne),min(sw,se))),hi=max(mid,max(max(nw,ne),max(sw,se)));
    if(hi-lo<max(.035,hi*.12))return center;
    vec2 along=vec2(-((nw+ne)-(sw+se)),(nw+sw)-(ne+se));
    float stabilizer=max((nw+ne+sw+se)*.03125,.0078125);
    along=clamp(along/(min(abs(along.x),abs(along.y))+stabilizer),vec2(-6.0),vec2(6.0))*texel;
    vec3 nearColor=(texture2D(sceneColor,vUv-along/6.0).rgb+texture2D(sceneColor,vUv+along/6.0).rgb)*.5;
    vec3 wideColor=nearColor*.5+(texture2D(sceneColor,vUv-along*.5).rgb+texture2D(sceneColor,vUv+along*.5).rgb)*.25;
    float wideLuma=dot(wideColor,weights);
    return wideLuma<lo||wideLuma>hi?nearColor:wideColor;
  }
  void main(){
    vec3 color=texture2D(sceneColor,vUv).rgb;
    if(edgeSmoothing>0.5)color=smoothEdge(color);
    float depth=texture2D(sceneDepth,vUv).r;
    // Derivatives are computed for every fragment before any divergent branch.
    vec3 p=viewPosition(vUv,depth);
    vec3 normal=normalize(cross(dFdx(p),dFdy(p)));
    if(dot(normal,-p)<0.0)normal=-normal;
    if(contactStrength>0.0&&depth<.99998&&-p.z<65.0){
      float radius=clamp(44.0/max(1.0,-p.z),2.0,18.0);
      float occlusion=0.0;
      for(int i=0;i<8;i++){
        float angle=float(i)*2.39996323;
        vec2 offset=vec2(cos(angle),sin(angle))*radius*(.35+.65*float(i+1)/8.0)*texel;
        vec2 uv=vUv+offset;
        float d=texture2D(sceneDepth,uv).r;
        vec3 delta=viewPosition(uv,d)-p;
        float distanceToSample=length(delta);
        float inBounds=step(0.0,uv.x)*step(uv.x,1.0)*step(0.0,uv.y)*step(uv.y,1.0);
        float facing=max(0.0,dot(normal,delta/max(distanceToSample,.001))-.16);
        occlusion+=facing*(1.0-smoothstep(.12,1.35,distanceToSample))*inBounds*step(d,.99998);
      }
      color*=1.0-min(.22,occlusion*contactStrength/8.0);
    }
    if(bloomStrength>0.0){
      vec3 glow=highlight(vUv+texel*vec2(2.5,0.0))+highlight(vUv-texel*vec2(2.5,0.0));
      glow+=highlight(vUv+texel*vec2(0.0,2.5))+highlight(vUv-texel*vec2(0.0,2.5));
      color+=min(glow,vec3(8.0))*bloomStrength*.25;
    }
    gl_FragColor=vec4(max(color,vec3(0.0)),1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createRenderPipeline(renderer,scene,camera){
  const screen=new THREE.Scene(),screenCamera=new THREE.Camera(),size=new THREE.Vector2();
  const uniforms={sceneColor:{value:null},sceneDepth:{value:null},inverseProjection:{value:camera.projectionMatrixInverse},texel:{value:new THREE.Vector2(1,1)},contactStrength:{value:0},bloomStrength:{value:0},edgeSmoothing:{value:0}};
  const material=new THREE.ShaderMaterial({vertexShader:presentationVertex,fragmentShader:presentationFragment,uniforms,depthTest:false,depthWrite:false,toneMapped:true});
  const geometry=new THREE.PlaneGeometry(2,2),quad=new THREE.Mesh(geometry,material);quad.frustumCulled=false;screen.add(quad);
  const supportsHDR=Boolean(renderer.extensions?.has('EXT_color_buffer_float'));
  const gl=renderer.getContext?.();
  let supportedSamples=[0];
  if(supportsHDR&&gl?.getInternalformatParameter){
    const colors=Array.from(gl.getInternalformatParameter(gl.RENDERBUFFER,gl.RGBA16F,gl.SAMPLES)||[]);
    const depths=Array.from(gl.getInternalformatParameter(gl.RENDERBUFFER,gl.DEPTH_COMPONENT24,gl.SAMPLES)||[]);
    supportedSamples.push(...colors.filter(n=>depths.includes(n)));
  }
  let target=null,enabled=false,disposed=false,sampleCount=0;
  function dropTarget(){if(target){target.dispose();target=null;}}
  function configure(settings={}){
    if(disposed)return;
    enabled=Boolean(settings.postProcessing&&supportsHDR);
    uniforms.contactStrength.value=settings.contactShadows?.85:0;
    uniforms.bloomStrength.value=settings.bloom?.09:0;
    const requestedSamples=Math.min(renderer.capabilities?.maxSamples??0,Math.max(0,Math.floor(settings.samples??0)));
    const nextSamples=Math.max(...supportedSamples.filter(n=>n<=requestedSamples));
    if(!enabled){dropTarget();return;}
    if(target&&sampleCount!==nextSamples)dropTarget();
    sampleCount=nextSamples;
    uniforms.edgeSmoothing.value=sampleCount?0:1;
    if(!target){
      target=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:true,stencilBuffer:false,samples:sampleCount});
      target.texture.name='village-hdr-color';target.texture.colorSpace=THREE.LinearSRGBColorSpace;
      target.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);target.depthTexture.name='village-contact-depth';
      target.resolveDepthBuffer=true;
      uniforms.sceneColor.value=target.texture;uniforms.sceneDepth.value=target.depthTexture;
    }
    resize();
  }
  function resize(){
    if(!target||disposed)return;
    renderer.getDrawingBufferSize(size);
    const width=Math.max(1,Math.floor(size.x)),height=Math.max(1,Math.floor(size.y));
    if(target.width!==width||target.height!==height)target.setSize(width,height);
    uniforms.texel.value.set(1/width,1/height);
  }
  function render(){
    if(disposed)return;
    renderer.info.reset();
    if(!enabled||!target){renderer.setRenderTarget(null);renderer.render(scene,camera);return;}
    renderer.setRenderTarget(target);renderer.render(scene,camera);
    renderer.setRenderTarget(null);renderer.render(screen,screenCamera);
  }
  function dispose(){if(disposed)return;disposed=true;dropTarget();geometry.dispose();material.dispose();}
  return {configure,resize,render,dispose,get enabled(){return enabled;},get target(){return target;}};
}

/** A small sky reflection probe gives iron, leather and water a natural sheen. */
export function createSkyReflection(renderer,scene){
  if(!renderer.extensions?.has('EXT_color_buffer_float'))return {update(){},dispose(){}};
  const width=128,height=64,data=new Float32Array(width*height*4);
  const skyTop=new THREE.Color('#97b9d0'),horizon=new THREE.Color('#dad3b8'),ground=new THREE.Color('#444839');
  const color=new THREE.Color();
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const latitude=Math.cos((y+.5)/height*Math.PI);
    color.copy(latitude>=0?horizon:ground);
    if(latitude>=0)color.lerp(skyTop,Math.pow(latitude,.45));
    const offset=(y*width+x)*4;data[offset]=color.r;data[offset+1]=color.g;data[offset+2]=color.b;data[offset+3]=1;
  }
  const texture=new THREE.DataTexture(data,width,height,THREE.RGBAFormat,THREE.FloatType);
  texture.mapping=THREE.EquirectangularReflectionMapping;texture.colorSpace=THREE.LinearSRGBColorSpace;texture.needsUpdate=true;
  const generator=new THREE.PMREMGenerator(renderer),reflection=generator.fromEquirectangular(texture);
  texture.dispose();generator.dispose();scene.environment=reflection.texture;
  return {update(daylight,caveMix=0){scene.environmentIntensity=THREE.MathUtils.lerp(.055,.28,daylight)*(1-caveMix*.78);},dispose(){if(scene.environment===reflection.texture)scene.environment=null;reflection.dispose();}};
}
