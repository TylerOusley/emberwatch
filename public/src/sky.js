import * as THREE from 'three';

const TAU=Math.PI*2;
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const ease=(a,b,v)=>{const t=clamp((v-a)/(b-a));return t*t*(3-2*t);};
export const SKY_MOON_TEXTURE='/assets/sky/moon-albedo.jpg';
const palette={
  dayTop:new THREE.Color('#367cb3'),dayHorizon:new THREE.Color('#c1d0d5'),dayLow:new THREE.Color('#a4b4ba'),
  nightTop:new THREE.Color('#060d1c'),nightHorizon:new THREE.Color('#273a51'),nightLow:new THREE.Color('#1d2b38'),
  warmTop:new THREE.Color('#7d829b'),warmHorizon:new THREE.Color('#e5ae88'),warmLow:new THREE.Color('#a99a91'),
  sunlight:new THREE.Color('#fff3de'),sunset:new THREE.Color('#ffb475'),moonlight:new THREE.Color('#bfcde0'),
  ambientDay:new THREE.Color('#dae5ed'),ambientNight:new THREE.Color('#96aac5'),
  groundDay:new THREE.Color('#575449'),groundNight:new THREE.Color('#272e3b'),
  dayCloud:new THREE.Color('#f7f7ee'),nightCloud:new THREE.Color('#66778b'),warmCloud:new THREE.Color('#edb795'),
  dayCloudShade:new THREE.Color('#879daf'),nightCloudShade:new THREE.Color('#162234'),warmCloudShade:new THREE.Color('#716f81'),
};

/** 0 = sunrise, .25 = noon, .5 = sunset, .75 = midnight. No wall clock or gameplay mutation.
 * exposure is the suggested world ACES exposure; sky shaders manage their own radiance.
 */
export function sampleSkyCycle(cycle,out={}){
  const phase=((Number.isFinite(cycle)?cycle:0)%1+1)%1,angle=phase*TAU,height=Math.sin(angle)*.94;
  out.cycle=phase;out.sunX=Math.cos(angle);out.sunY=height;out.sunZ=Math.sin(angle)*Math.sqrt(1-.94*.94);
  out.daylight=ease(-.12,.18,height);out.nightMix=1-out.daylight;
  out.twilight=(1-ease(.04,.38,Math.abs(height)))*ease(-.25,.02,height);
  out.sunOpacity=ease(-.095,-.02,height);out.moonOpacity=ease(-.095,-.02,-height);
  out.stars=1-ease(-.22,-.055,height);
  out.sunIntensity=3.8*ease(-.02,.32,height);
  out.moonIntensity=.36*ease(-.025,.27,-height);
  out.ambientIntensity=.68+out.daylight*1.04;
  out.exposure=1.12-out.daylight*.10;
  out.fogDensity=.0035+out.nightMix*.0008+out.twilight*.0006;
  out.label=phase<.055||phase>=.96?'Dawn':phase<.22?'Morning':phase<.30?'Midday':phase<.445?'Afternoon':phase<.545?'Sunset':phase<.71?'Night':phase<.80?'Midnight':'Late night';
  return out;
}

const domeVertex=`
  varying vec3 vDirection;
  void main(){vDirection=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}
`;
const gradientFragment=`
  varying vec3 vDirection;
  uniform vec3 topColor,horizonColor,lowColor,sunDirection;
  uniform float twilight,daylight;
  void main(){
    vec3 d=normalize(vDirection);float h=max(0.0,d.y),mu=clamp(dot(d,sunDirection),-1.0,1.0);
    // Analytic optical air mass, wavelength-dependent extinction, Rayleigh
    // angular scattering and a forward Mie lobe. No marching or sky lookup.
    float airMass=1.0/(h+.15*pow(max(.001,1.0-h),1.3));
    vec3 extinction=exp(-vec3(.085,.17,.34)*airMass);
    float rayleigh=.75*(1.0+mu*mu);
    vec3 blue=topColor*(.74+rayleigh*.26)*(vec3(.73)+extinction*.27);
    float haze=pow(1.0-h,4.2);
    vec3 color=mix(blue,horizonColor,haze);
    float toward=pow(max(0.0,dot(d,normalize(vec3(sunDirection.x,.06,sunDirection.z)))),7.0);
    vec3 sunset=vec3(.86,.32,.095);
    color=mix(color,sunset,twilight*toward*pow(1.0-h,2.1)*.53);
    float mie=.014/pow(max(.006,1.0+.86*.86-2.0*.86*mu),1.5);
    vec3 solarTint=mix(vec3(1.0,.97,.88),vec3(1.0,.47,.18),twilight*.8);
    color+=solarTint*min(.38,mie*.045)*daylight*(1.0-haze*.28);
    // Subtle scattered moonlight; the solid lunar surface is a separate mesh.
    float moonGlow=pow(max(0.0,-mu),150.0)*.012*(1.0-daylight);
    color+=vec3(.58,.68,.86)*moonGlow;
    // The anti-solar twilight belt stays subdued instead of warming the whole dome.
    float belt=exp(-pow((d.y-.085)*9.0,2.0))*pow(max(0.0,-mu),2.0)*twilight;
    color=mix(color,vec3(.21,.15,.23),belt*.16);
    color=mix(color,lowColor,1.0-smoothstep(-.24,.012,d.y));
    gl_FragColor=vec4(max(vec3(0.0),color),1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
const discVertex=`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
const sunFragment=`
  varying vec2 vUv;uniform vec3 tint;uniform float opacity;
  void main(){
    float r=length(vUv*2.0-1.0);
    // 2.88 m solid diameter at 296 m = .557 degrees. The broad plane contains
    // only transparent aureole, never an oversized solid disc or flare sprite.
    float disk=1.0-smoothstep(.057,.063,r);
    float aureole=(exp(-r*21.0)*.33+exp(-r*6.5)*.055)*(1.0-smoothstep(.75,1.0,r));
    float alpha=max(disk,aureole)*opacity;if(alpha<.001)discard;
    vec3 core=mix(tint,vec3(1.0,.995,.96),.65);
    gl_FragColor=vec4(mix(tint,core,disk),alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
const moonFragment=`
  varying vec2 vUv;uniform float opacity,moonReady;uniform sampler2D moonMap;
  float basin(vec2 p,vec2 c,vec2 size){return exp(-dot((p-c)/size,(p-c)/size)*2.0);}
  void main(){
    vec2 p=(vUv*2.0-1.0)/.80;float r=length(p);
    float edge=1.0-smoothstep(.985,1.0,r);if(edge*opacity<.001)discard;
    float z=sqrt(max(0.0,1.0-dot(p,p)));
    // Reproject NASA's longitude/latitude map onto the visible lunar hemisphere.
    vec2 mapUv=vec2(atan(p.x,z)/6.28318530718+.5,asin(clamp(p.y,-1.0,1.0))/3.14159265359+.5);
    vec3 albedo=texture2D(moonMap,mapUv).rgb;
    float maria=basin(p,vec2(-.23,.22),vec2(.52,.43))+basin(p,vec2(.28,.35),vec2(.32,.40))+basin(p,vec2(.1,-.2),vec2(.26,.2));
    vec3 fallback=vec3(.38,.375,.36)*(1.0-clamp(maria*.30,0.0,.43));
    albedo=mix(fallback,albedo,moonReady);
    // The retained opposite-sun orbit is near full phase. Soft limb darkening
    // and a slight terminator reveal a solid surface without a glowing rim.
    float lambert=max(0.0,dot(vec3(p,z),normalize(vec3(-.12,.08,1.0))));
    float light=.32+.68*pow(lambert,.38);
    vec3 color=clamp(albedo*1.35,vec3(.015),vec3(.78))*light*vec3(1.0,.985,.94);
    gl_FragColor=vec4(color,edge*opacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
const cloudFragment=`
  varying vec3 vDirection;
  uniform float time,layer,nightMix,twilight;
  uniform vec3 cloudColor,shadeColor,sunDirection;
  float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
  float cloud(vec2 p){return noise(p)*.54+noise(p*2.03+vec2(13.4,7.2))*.27+noise(p*4.11-vec2(8.7,3.1))*.13+noise(p*8.3)*.06;}
  void main(){
    vec3 d=normalize(vDirection);float horizon=smoothstep(.005,.17,d.y);if(horizon<=0.0)discard;
    vec2 p=d.xz/(d.y+.21);
    float coverage,density,shade;
    if(layer>.5){
      // Wind-stretched high ice clouds, separate from the lower cumulus deck.
      p=p*vec2(1.15,6.5)+vec2(time*.0022,time*.0008)+vec2(17.0,9.0);
      p.x+=noise(p*.48)*1.1;
      density=noise(p)*.63+noise(p*2.8)*.25+noise(p*6.1)*.12;
      coverage=smoothstep(.48,.77,density)*.35;shade=.12;
    }else{
      p=p*2.6+vec2(time*.006,time*.0014);
      vec2 warp=vec2(noise(p*.52),noise(p*.52+vec2(21.0,4.0)))-.5;
      p+=warp*.75;density=cloud(p);
      coverage=smoothstep(.45,.69,density);
      float lightDensity=cloud(p-sunDirection.xz*.14);
      shade=clamp(.44+(density-lightDensity)*5.0+(density-.53)*1.25,.08,.88);
    }
    float alpha=coverage*horizon*(layer>.5?.60:.90);if(alpha<.003)discard;
    vec3 color=mix(cloudColor,shadeColor,shade);
    float toward=max(0.0,dot(d,sunDirection));
    float silver=pow(toward,14.0)*pow(1.0-coverage,2.0);
    color+=cloudColor*silver*.45*(1.0-nightMix);
    float moonRim=pow(max(0.0,-dot(d,sunDirection)),28.0)*(1.0-coverage)*nightMix;
    color+=vec3(.065,.079,.10)*moonRim;
    gl_FragColor=vec4(color,alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
const starVertex=`
  attribute float sparkle;varying float vSparkle,vWarmth;uniform float time;
  void main(){vSparkle=(.47+sparkle*.53)*(.94+.06*sin(sparkle*35.0+time*.42));vWarmth=fract(sparkle*37.13);gl_PointSize=.85+pow(sparkle,5.0)*1.65;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}
`;
const starFragment=`
  varying float vSparkle,vWarmth;uniform float opacity;
  void main(){float r=length(gl_PointCoord*2.0-1.0);float a=(1.0-smoothstep(.05,1.0,r))*opacity*vSparkle;if(a<.004)discard;gl_FragColor=vec4(mix(vec3(.69,.79,1.0),vec3(1.0,.87,.68),vWarmth),a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Six draw calls inside the 360 m far plane. One local lunar texture; no hot allocations.
 * An optional moonTexture is borrowed (caller owns disposal), useful for offline QA.
 */
export function createSkyEnvironment(scene,{sun,skyLight,fill,moonTexture}={}){
  const group=new THREE.Group();group.name='living-sky';scene.add(group);
  const geometries=new Set(),materials=new Set(),textures=new Set(),sample={},direction=new THREE.Vector3(),origin=new THREE.Vector3(),forward=new THREE.Vector3(0,0,1);
  const ownGeo=g=>(geometries.add(g),g),ownMat=m=>(materials.add(m),m);
  let disposed=false;
  const sphere=ownGeo(new THREE.SphereGeometry(1,40,24));
  const shader=(fragmentShader,uniforms,extra={})=>ownMat(new THREE.ShaderMaterial({vertexShader:domeVertex,fragmentShader,uniforms,depthWrite:false,fog:false,toneMapped:true,...extra}));
  const colorUniform=()=>({value:new THREE.Color()});
  const gradient=shader(gradientFragment,{topColor:colorUniform(),horizonColor:colorUniform(),lowColor:colorUniform(),sunDirection:{value:direction},twilight:{value:0},daylight:{value:1}},{side:THREE.BackSide});
  const dome=new THREE.Mesh(sphere,gradient);dome.name='sky-gradient';dome.scale.setScalar(310);dome.renderOrder=-1000;dome.frustumCulled=false;group.add(dome);
  const discGeo=ownGeo(new THREE.PlaneGeometry(1,1));
  const sunMaterial=shader(sunFragment,{tint:colorUniform(),opacity:{value:1}},{vertexShader:discVertex,transparent:true});
  const sunDisc=new THREE.Mesh(discGeo,sunMaterial);sunDisc.name='sun-disc';sunDisc.scale.set(48,48,1);sunDisc.renderOrder=-999;sunDisc.frustumCulled=false;group.add(sunDisc);
  const fallback=new THREE.DataTexture(new Uint8Array([128,128,128,255]),1,1);fallback.needsUpdate=true;textures.add(fallback);
  const moonMaterial=shader(moonFragment,{opacity:{value:0},moonMap:{value:moonTexture??fallback},moonReady:{value:moonTexture?1:0}},{vertexShader:discVertex,transparent:true});
  const moonDisc=new THREE.Mesh(discGeo,moonMaterial);moonDisc.name='moon-disc';moonDisc.scale.set(4.2,4.2,1);moonDisc.renderOrder=-998;moonDisc.frustumCulled=false;group.add(moonDisc);
  if(!moonTexture&&typeof document!=='undefined'&&typeof document.createElementNS==='function'){
    try{
      const loaded=new THREE.TextureLoader().load(SKY_MOON_TEXTURE,texture=>{
        if(disposed)return;moonMaterial.uniforms.moonMap.value=texture;moonMaterial.uniforms.moonReady.value=1;
      },undefined,()=>{/* Keep the bounded, deterministic lunar fallback if offline. */});
      loaded.colorSpace=THREE.SRGBColorSpace;loaded.wrapS=THREE.RepeatWrapping;loaded.userData.source=SKY_MOON_TEXTURE;textures.add(loaded);
    }catch{/* A blocked image API also keeps the sky playable with its fallback. */}
  }
  const starPositions=[],sparkle=[];let seed=72119;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<620;i++){const y=.025+random()*.975,a=random()*TAU,r=Math.sqrt(1-y*y);starPositions.push(Math.cos(a)*r*302,y*302,Math.sin(a)*r*302);sparkle.push(random());}
  const starGeo=ownGeo(new THREE.BufferGeometry());starGeo.setAttribute('position',new THREE.Float32BufferAttribute(starPositions,3));starGeo.setAttribute('sparkle',new THREE.Float32BufferAttribute(sparkle,1));
  const starMaterial=shader(starFragment,{time:{value:0},opacity:{value:0}},{vertexShader:starVertex,transparent:true});
  const stars=new THREE.Points(starGeo,starMaterial);stars.name='night-stars';stars.renderOrder=-999.5;stars.frustumCulled=false;group.add(stars);
  const cloudLayers=[];
  for(let layer=0;layer<2;layer++){
    const material=shader(cloudFragment,{time:{value:0},layer:{value:layer},nightMix:{value:0},twilight:{value:0},cloudColor:colorUniform(),shadeColor:colorUniform(),sunDirection:{value:direction}},{side:THREE.BackSide,transparent:true});
    const mesh=new THREE.Mesh(sphere,material);mesh.name=layer?'high-cloud-deck':'low-cloud-deck';mesh.scale.setScalar(layer?292:285);mesh.renderOrder=layer?-997:-996;mesh.frustumCulled=false;group.add(mesh);cloudLayers.push(mesh);
  }
  function update(cycle,time,camera){
    if(disposed)return sample;
    sampleSkyCycle(cycle,sample);
    const seconds=Number.isFinite(time)?Math.min(1e7,Math.max(0,time)):0;
    if(camera&&Number.isFinite(camera.position.x)&&Number.isFinite(camera.position.y)&&Number.isFinite(camera.position.z))group.position.copy(camera.position);
    direction.set(sample.sunX,sample.sunY,sample.sunZ);
    gradient.uniforms.topColor.value.copy(palette.nightTop).lerp(palette.dayTop,sample.daylight).lerp(palette.warmTop,sample.twilight*.26);
    gradient.uniforms.horizonColor.value.copy(palette.nightHorizon).lerp(palette.dayHorizon,sample.daylight).lerp(palette.warmHorizon,sample.twilight*.60);
    gradient.uniforms.lowColor.value.copy(palette.nightLow).lerp(palette.dayLow,sample.daylight).lerp(palette.warmLow,sample.twilight*.32);
    gradient.uniforms.twilight.value=sample.twilight;gradient.uniforms.daylight.value=sample.daylight;
    if(scene.background?.isColor)scene.background.copy(gradient.uniforms.horizonColor.value);
    if(scene.fog){scene.fog.color.copy(gradient.uniforms.horizonColor.value);if(scene.fog.isFogExp2)scene.fog.density=sample.fogDensity;}
    sunDisc.position.copy(direction).multiplyScalar(296);moonDisc.position.copy(direction).multiplyScalar(-296);
    // Inward local bearings avoid stale parent matrices after a camera teleport.
    origin.copy(sunDisc.position).negate();sunDisc.quaternion.setFromUnitVectors(forward,origin.normalize());
    origin.copy(moonDisc.position).negate();moonDisc.quaternion.setFromUnitVectors(forward,origin.normalize());
    sunDisc.visible=sample.sunOpacity>.001;moonDisc.visible=sample.moonOpacity>.001;
    sunMaterial.uniforms.opacity.value=sample.sunOpacity;sunMaterial.uniforms.tint.value.copy(palette.sunlight).lerp(palette.sunset,sample.twilight*.66);
    moonMaterial.uniforms.opacity.value=sample.moonOpacity;
    starMaterial.uniforms.opacity.value=sample.stars*.55;starMaterial.uniforms.time.value=seconds;stars.visible=sample.stars>.001;
    for(const cloud of cloudLayers){const u=cloud.material.uniforms;u.time.value=seconds;u.nightMix.value=sample.nightMix;u.twilight.value=sample.twilight;u.cloudColor.value.copy(palette.nightCloud).lerp(palette.dayCloud,sample.daylight).lerp(palette.warmCloud,sample.twilight*.72);u.shadeColor.value.copy(palette.nightCloudShade).lerp(palette.dayCloudShade,sample.daylight).lerp(palette.warmCloudShade,sample.twilight*.52);}
    if(sun){sun.color.copy(palette.sunlight).lerp(palette.sunset,sample.twilight*.82);sun.intensity=sample.sunIntensity;origin.copy(sun.target.position);sun.position.copy(origin).addScaledVector(direction,180);}
    if(skyLight){skyLight.color.copy(palette.ambientNight).lerp(palette.ambientDay,sample.daylight);skyLight.groundColor.copy(palette.groundNight).lerp(palette.groundDay,sample.daylight);skyLight.intensity=sample.ambientIntensity;}
    if(fill){fill.color.copy(palette.moonlight);fill.intensity=.055+sample.moonIntensity;fill.position.copy(fill.target.position).addScaledVector(direction,-170);fill.position.y=Math.max(fill.position.y,25);}
    return sample;
  }
  function dispose(){if(disposed)return;disposed=true;scene.remove(group);for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();for(const texture of textures)texture.dispose();}
  update(.17,0);
  return {group,update,dispose};
}
