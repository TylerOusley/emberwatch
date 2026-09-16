import * as THREE from 'three';

const clamp=v=>Math.max(0,Math.min(1,v));
// Match the dusk band of the authoritative sky, without frame-count timers.
export function torchNightAmount(nightMix){const t=clamp(((Number(nightMix)||0)-.025)/.45);return t*t*(3-2*t);}
export function torchFlicker(time,seed=0){return .94+.055*Math.sin(time*9.7+seed*6.1)+.025*Math.sin(time*17.3+seed*2.8);}

export const TORCH_VERTEX_SHADER=`
attribute vec4 torchData;
varying vec2 vUv;
varying vec4 vTorch;
uniform vec3 cameraRight;
void main(){
  vUv=uv;vTorch=torchData;
  vec3 p=position+cameraRight*(uv.x-.5)*torchData.y*.78+vec3(0.,uv.y*torchData.y,0.);
  gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
}`;
export const TORCH_FRAGMENT_SHADER=`
uniform float time;
uniform float nightAmount;
varying vec2 vUv;
varying vec4 vTorch;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.)),f.x),f.y);}
void main(){
  float lit=mix(nightAmount,1.,vTorch.z)*vTorch.w;
  if(lit<.001)discard;
  float y=vUv.y,x=(vUv.x-.5)*2.,t=time*1.85+vTorch.x*19.;
  float flow=noise(vec2(x*3.2+vTorch.x,y*4.5-t));
  float fine=noise(vec2(x*7.1,y*9.8-t*1.8));
  float bend=sin(y*6.-t*2.1)*(.035+y*.105)+sin(t*2.7)*y*.07;
  float width=.54*pow(max(0.,1.-y),.72)+.055;
  float edge=abs(x-bend)+(flow-.5)*(.18+y*.34)+(fine-.5)*.09;
  float body=1.-smoothstep(width-.12,width+.06,edge);
  float tip=1.-smoothstep(.69+flow*.21,.96,y);
  float foot=smoothstep(0.,.06,y);
  float alpha=body*tip*foot*lit;
  if(alpha<.008)discard;
  float heat=clamp((1.-edge/max(width,.01))*(1.-y*.64),0.,1.);
  vec3 color=mix(vec3(.83,.065,.008),vec3(1.,.43,.035),smoothstep(.03,.55,heat));
  color=mix(color,vec3(1.,.92,.50),smoothstep(.60,.92,heat));
  gl_FragColor=vec4(color*(1.15+heat*.45),alpha*.94);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// Fixture y is the flame base. Cave brackets use inward nx/nz; travelling
// carriage fixtures use 'existing' because their model owns the timber/iron.
export function createTorchSystem(scene,fixtures=[],{maxLights=6}={}){
  const root=new THREE.Group();root.name='living-torches';scene?.add(root);
  const staticFixtures=fixtures.map((f,i)=>({...f,id:f.id??`torch-${i}`,height:f.height??.82,seed:(i*.61803398875)%1,alwaysLit:Boolean(f.alwaysLit)}));
  const geometries=new Set(),materials=new Set(),batches=new Map(),dummy=new THREE.Object3D();
  const geo=g=>(geometries.add(g),g),material=(color,extra={})=>{const m=new THREE.MeshStandardMaterial({color,roughness:.89,...extra});materials.add(m);return m;};
  const wood=material(0x614227),char=material(0x231d19),iron=material(0x404340,{metalness:.68,roughness:.55}),stone=material(0x747b67);
  const box=geo(new THREE.BoxGeometry(1,1,1)),shaft=geo(new THREE.CylinderGeometry(1,.84,1,9)),head=geo(new THREE.CylinderGeometry(.72,1,1,9)),ring=geo(new THREE.TorusGeometry(1,.16,5,10));
  function part(g,m,p,s,rotation=[0,0,0]){const key=g.uuid+m.uuid;if(!batches.has(key))batches.set(key,{g,m,transforms:[]});dummy.position.set(...p);dummy.scale.set(...s);dummy.rotation.set(...rotation);dummy.updateMatrix();batches.get(key).transforms.push(dummy.matrix.clone());}
  for(const f of staticFixtures){
    if(f.mount==='existing')continue;
    const standing=f.mount!=='wall',nx=f.nx??0,nz=f.nz??1,baseY=standing?f.y-2.65:f.y-.83;
    part(shaft,wood,[f.x,(baseY+f.y-.13)/2,f.z],[standing?.115:.076,f.y-.13-baseY,standing?.115:.076]);
    if(standing){part(shaft,stone,[f.x,baseY+.11,f.z],[.25,.22,.25]);for(const h of[.43,1.7])part(ring,iron,[f.x,baseY+h,f.z],[.125,.125,.125],[Math.PI/2,0,0]);}
    else{
      // Bracket reaches back into its support; no floating torch box or glass.
      const yaw=Math.atan2(nx,nz);
      part(box,iron,[f.x-nx*.47,f.y-.57,f.z-nz*.47],[.17,.47,.14],[0,yaw,0]);
      part(box,iron,[f.x-nx*.255,f.y-.70,f.z-nz*.255],[.085,.085,.56],[0,yaw,0]);
    }
    part(head,char,[f.x,f.y-.095,f.z],[.17,.24,.17]);
    for(const h of[-.22,-.065])part(ring,iron,[f.x,f.y+h,f.z],[.17,.17,.17],[Math.PI/2,0,0]);
    for(let i=0;i<4;i++){const a=i*Math.PI/2;part(box,iron,[f.x+Math.cos(a)*.14,f.y-.13,f.z+Math.sin(a)*.14],[.035,.35,.035]);}
  }
  for(const {g,m,transforms}of batches.values()){const mesh=new THREE.InstancedMesh(g,m,transforms.length);mesh.name='torch-holder-instances';transforms.forEach((matrix,i)=>mesh.setMatrixAt(i,matrix));mesh.castShadow=false;mesh.receiveShadow=true;mesh.computeBoundingSphere();root.add(mesh);}
  const capacity=staticFixtures.length+8,positions=new Float32Array(capacity*12),uvs=new Float32Array(capacity*8),data=new Float32Array(capacity*16),indices=[];
  for(let i=0;i<capacity;i++){uvs.set([0,0,1,0,1,1,0,1],i*8);const b=i*4;indices.push(b,b+1,b+2,b,b+2,b+3);}
  const flameGeometry=geo(new THREE.BufferGeometry());flameGeometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));flameGeometry.setAttribute('uv',new THREE.BufferAttribute(uvs,2));flameGeometry.setAttribute('torchData',new THREE.BufferAttribute(data,4).setUsage(THREE.DynamicDrawUsage));flameGeometry.setIndex(indices);
  const uniforms={time:{value:0},nightAmount:{value:0},cameraRight:{value:new THREE.Vector3(1,0,0)}};
  const flameMaterial=new THREE.ShaderMaterial({uniforms,vertexShader:TORCH_VERTEX_SHADER,fragmentShader:TORCH_FRAGMENT_SHADER,transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.NormalBlending,toneMapped:false});materials.add(flameMaterial);
  const flames=new THREE.Mesh(flameGeometry,flameMaterial);flames.name='animated-torch-flames';flames.frustumCulled=false;flames.renderOrder=3;root.add(flames);
  const lights=Array.from({length:Math.max(0,Math.min(8,Math.floor(maxLights)))},()=>{const light=new THREE.PointLight(0xffa74f,0,16,2);light.castShadow=false;root.add(light);return light;});
  let active=staticFixtures,previousDynamic='',disposed=false;
  function writeFlames(){
    positions.fill(0);data.fill(0);
    active.forEach((f,i)=>{for(let j=0;j<4;j++){positions.set([f.x,f.y,f.z],i*12+j*3);data.set([f.seed??((i*.618)%1),f.height??.82,f.alwaysLit?1:0,f.visible===false?0:1],i*16+j*4);}});
    flameGeometry.attributes.position.needsUpdate=true;flameGeometry.attributes.torchData.needsUpdate=true;flameGeometry.setDrawRange(0,active.length*6);
  }
  writeFlames();
  function update(time=0,nightMix=0,camera,viewer,dynamicFixtures=[]){
    if(disposed)return;
    uniforms.time.value=Number.isFinite(time)?time:0;uniforms.nightAmount.value=torchNightAmount(nightMix);
    if(camera?.matrixWorld){camera.updateMatrixWorld();uniforms.cameraRight.value.setFromMatrixColumn(camera.matrixWorld,0);uniforms.cameraRight.value.y=0;if(uniforms.cameraRight.value.lengthSq()>.0001)uniforms.cameraRight.value.normalize();else uniforms.cameraRight.value.set(1,0,0);}
    const dynamic=dynamicFixtures.slice(0,8).filter(f=>Number.isFinite(f.x)&&Number.isFinite(f.y)&&Number.isFinite(f.z)),key=dynamic.map(f=>`${f.id}:${f.x}:${f.y}:${f.z}:${f.visible!==false}`).join('|');
    if(key!==previousDynamic){previousDynamic=key;active=[...staticFixtures,...dynamic];writeFlames();}
    const p=viewer&&Number.isFinite(viewer.x)&&Number.isFinite(viewer.z)?viewer:camera?.position??{x:0,y:0,z:0};
    const ranked=active.map(f=>({f,d:Math.hypot(f.x-p.x,f.y-(p.y??0),f.z-p.z),lit:f.visible===false?0:f.alwaysLit?1:uniforms.nightAmount.value})).filter(f=>f.lit>.001&&f.d<30).sort((a,b)=>a.d-b.d);
    // Keep every pool slot visible to Three, even when it emits no light.
    // Changing the visible light count changes every lit material's shader key,
    // causing compilation hitches as cave torches enter/leave the selection radius.
    for(let i=0;i<lights.length;i++){
      const light=lights[i],entry=ranked[i];
      if(!entry){light.intensity=0;light.userData.fixtureId=undefined;continue;}
      const f=entry.f;light.position.set(f.x,f.y+.28,f.z);light.intensity=(f.alwaysLit?19:23)*entry.lit*torchFlicker(uniforms.time.value,f.seed??i);light.userData.fixtureId=f.id;
    }
  }
  function dispose(){if(disposed)return;disposed=true;root.removeFromParent();root.traverse(n=>{if(n.isInstancedMesh)n.dispose();});for(const g of geometries)g.dispose();for(const m of materials)m.dispose();root.clear();}
  return {root,flames,lights,fixtures:staticFixtures,update,dispose};
}
