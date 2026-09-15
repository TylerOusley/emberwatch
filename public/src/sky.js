import * as THREE from 'three';

const TAU=Math.PI*2;
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const ease=(a,b,v)=>{const t=clamp((v-a)/(b-a));return t*t*(3-2*t);};
const palette={
  dayTop:new THREE.Color('#488bc0'),dayHorizon:new THREE.Color('#c4d8cf'),dayLow:new THREE.Color('#a8beb5'),
  nightTop:new THREE.Color('#081529'),nightHorizon:new THREE.Color('#344d65'),nightLow:new THREE.Color('#243b4c'),
  warmTop:new THREE.Color('#8c7896'),warmHorizon:new THREE.Color('#efa46e'),warmLow:new THREE.Color('#b79c88'),
  sunlight:new THREE.Color('#ffe6b9'),sunset:new THREE.Color('#ffb576'),moonlight:new THREE.Color('#b1ccf1'),
  ambientDay:new THREE.Color('#e6eddb'),ambientNight:new THREE.Color('#b7c6e3'),
  dayCloud:new THREE.Color('#f7f0db'),nightCloud:new THREE.Color('#526b83'),warmCloud:new THREE.Color('#f4bc8f'),
  dayCloudShade:new THREE.Color('#99b1bd'),nightCloudShade:new THREE.Color('#283f58'),warmCloudShade:new THREE.Color('#a88994'),
};

/** 0 = sunrise, .25 = noon, .5 = sunset, .75 = midnight. No wall clock or gameplay mutation. */
export function sampleSkyCycle(cycle,out={}){
  const phase=((Number.isFinite(cycle)?cycle:0)%1+1)%1,angle=phase*TAU;
  const height=Math.sin(angle)*.94;
  out.cycle=phase;out.sunX=Math.cos(angle);out.sunY=height;out.sunZ=Math.sin(angle)*Math.sqrt(1-.94*.94);
  out.daylight=ease(-.12,.18,height);out.nightMix=1-out.daylight;
  out.twilight=(1-ease(.04,.38,Math.abs(height)))*ease(-.25,.02,height);
  out.sunOpacity=ease(-.095,-.02,height);out.moonOpacity=ease(-.095,-.02,-height);
  out.stars=1-ease(-.22,-.055,height);
  out.sunIntensity=3.3*ease(-.02,.32,height);
  out.moonIntensity=.40*ease(-.025,.27,-height);
  out.ambientIntensity=.88+out.daylight*1.62;
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
  uniform float twilight;
  void main(){
    vec3 d=normalize(vDirection);float h=max(0.0,d.y);
    vec3 color=mix(horizonColor,topColor,pow(smoothstep(0.0,1.0,h),.43));
    color=mix(color,lowColor,(1.0-smoothstep(-.3,.015,d.y)));
    // The warm horizon follows the sun; the opposite horizon stays cooler.
    float glow=pow(max(0.0,dot(d,normalize(vec3(sunDirection.x,.04,sunDirection.z)))),9.0);
    color=mix(color,vec3(1.0,.54,.255),glow*twilight*.28);
    gl_FragColor=vec4(color,1.0);
    #include <colorspace_fragment>
  }
`;
const discVertex=`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
const sunFragment=`
  varying vec2 vUv;uniform vec3 tint;uniform float opacity;
  void main(){
    float r=length(vUv*2.0-1.0);
    float disk=1.0-smoothstep(.327,.341,r);
    float halo=pow(max(0.0,1.0-r),4.0)*.44;
    float alpha=max(disk,halo)*opacity;if(alpha<.001)discard;
    gl_FragColor=vec4(mix(tint,tint*vec3(1.0,.985,.87),disk*.25),alpha);
    #include <colorspace_fragment>
  }
`;
const moonFragment=`
  varying vec2 vUv;uniform float opacity;
  float crater(vec2 p,vec2 center,float radius){float r=length(p-center)/radius;return -exp(-r*r*3.8)*.22+exp(-pow((r-.83)*6.0,2.0))*.10;}
  void main(){
    vec2 p=(vUv*2.0-1.0)/.69;float radius=length(p);float edge=1.0-smoothstep(.98,1.0,radius);
    float halo=pow(max(0.0,1.0-length(vUv*2.0-1.0)),4.0)*.14;
    float alpha=max(edge,halo)*opacity;if(alpha<.001)discard;
    float z=sqrt(max(0.0,1.0-dot(p,p)));
    float light=.64+.36*max(0.0,dot(vec3(p,z),normalize(vec3(-.45,.3,1.0))));
    float marks=crater(p,vec2(-.29,.26),.28)+crater(p,vec2(.3,-.18),.25)+crater(p,vec2(-.02,-.43),.17)+crater(p,vec2(.44,.4),.12)+crater(p,vec2(-.5,-.13),.13);
    vec3 color=vec3(.74,.83,.91)*clamp(light+marks,.32,1.1);
    gl_FragColor=vec4(color,alpha);
    #include <colorspace_fragment>
  }
`;
const cloudFragment=`
  varying vec3 vDirection;
  uniform float time,layer,nightMix,twilight;
  uniform vec3 cloudColor,shadeColor,sunDirection;
  float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
  float cloud(vec2 p){return noise(p)*.61+noise(p*2.09+vec2(13.4,7.2))*.27+noise(p*4.21-vec2(8.7,3.1))*.12;}
  void main(){
    vec3 d=normalize(vDirection);float horizon=smoothstep(.015,.18,d.y);
    if(horizon<=0.0)discard;
    // Project onto two high cloud decks, with different scales and wind speeds.
    vec2 p=d.xz/(d.y+.23)*(3.2+layer*1.5);
    p+=vec2(time*(.009-layer*.004),time*(.002+layer*.0006))+vec2(layer*17.0,layer*9.0);
    float density=cloud(p);float coverage=smoothstep(.46+layer*.035,.73+layer*.015,density);
    float alpha=coverage*horizon*(.84-layer*.24);if(alpha<.008)discard;
    float lit=clamp((density-.42)*2.0,0.0,1.0);
    vec3 color=mix(cloudColor,shadeColor,lit*.56);
    float rim=(1.0-coverage)*pow(max(0.0,dot(d,sunDirection)),5.0);
    color=mix(color,cloudColor*1.12,rim*.48*(1.0-nightMix));
    gl_FragColor=vec4(color,alpha);
    #include <colorspace_fragment>
  }
`;
const starVertex=`
  attribute float sparkle;varying float vSparkle;uniform float time;
  void main(){vSparkle=.8+.2*sin(sparkle*35.0+time*.65);gl_PointSize=1.25+sparkle*1.7;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}
`;
const starFragment=`
  varying float vSparkle;uniform float opacity;
  void main(){float r=length(gl_PointCoord*2.0-1.0);float a=(1.0-smoothstep(.1,1.0,r))*opacity*vSparkle;if(a<.005)discard;gl_FragColor=vec4(.78,.85,1.0,a);#include <colorspace_fragment>}
`.replace(';#include',';\n#include').replace('<colorspace_fragment>}','<colorspace_fragment>\n}');

/** All sky meshes stay inside the existing 360 m far plane. Six draw calls, no texture requests. */
export function createSkyEnvironment(scene,{sun,skyLight,fill}={}){
  const group=new THREE.Group();group.name='living-sky';scene.add(group);
  const geometries=new Set(),materials=new Set(),sample={},direction=new THREE.Vector3(),origin=new THREE.Vector3();
  const ownGeo=g=>(geometries.add(g),g),ownMat=m=>(materials.add(m),m);
  const sphere=ownGeo(new THREE.SphereGeometry(1,32,20));
  const shader=(fragmentShader,uniforms,extra={})=>ownMat(new THREE.ShaderMaterial({vertexShader:domeVertex,fragmentShader,uniforms,depthWrite:false,fog:false,toneMapped:false,...extra}));
  const colorUniform=()=>({value:new THREE.Color()});
  const gradient=shader(gradientFragment,{topColor:colorUniform(),horizonColor:colorUniform(),lowColor:colorUniform(),sunDirection:{value:direction},twilight:{value:0}},{side:THREE.BackSide});
  const dome=new THREE.Mesh(sphere,gradient);dome.name='sky-gradient';dome.scale.setScalar(310);dome.renderOrder=-1000;dome.frustumCulled=false;group.add(dome);
  const discGeo=ownGeo(new THREE.PlaneGeometry(1,1));
  const sunMaterial=shader(sunFragment,{tint:colorUniform(),opacity:{value:1}},{vertexShader:discVertex,transparent:true});
  const sunDisc=new THREE.Mesh(discGeo,sunMaterial);sunDisc.name='sun-disc';sunDisc.scale.set(42,42,1);sunDisc.renderOrder=-999;group.add(sunDisc);
  const moonMaterial=shader(moonFragment,{opacity:{value:0}},{vertexShader:discVertex,transparent:true});
  const moonDisc=new THREE.Mesh(discGeo,moonMaterial);moonDisc.name='moon-disc';moonDisc.scale.set(23,23,1);moonDisc.renderOrder=-998;group.add(moonDisc);
  // Deterministic hemisphere distribution keeps the same constellations for everyone.
  const starPositions=[],sparkle=[];let seed=72119;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<420;i++){const y=.035+random()*.965,a=random()*TAU,r=Math.sqrt(1-y*y);starPositions.push(Math.cos(a)*r*302,y*302,Math.sin(a)*r*302);sparkle.push(random());}
  const starGeo=ownGeo(new THREE.BufferGeometry());starGeo.setAttribute('position',new THREE.Float32BufferAttribute(starPositions,3));starGeo.setAttribute('sparkle',new THREE.Float32BufferAttribute(sparkle,1));
  const starMaterial=shader(starFragment,{time:{value:0},opacity:{value:0}},{vertexShader:starVertex,transparent:true});
  const stars=new THREE.Points(starGeo,starMaterial);stars.name='night-stars';stars.renderOrder=-999.5;stars.frustumCulled=false;group.add(stars);
  const cloudLayers=[];
  for(let layer=0;layer<2;layer++){
    const material=shader(cloudFragment,{time:{value:0},layer:{value:layer},nightMix:{value:0},twilight:{value:0},cloudColor:colorUniform(),shadeColor:colorUniform(),sunDirection:{value:direction}},{side:THREE.BackSide,transparent:true});
    const mesh=new THREE.Mesh(sphere,material);mesh.name=layer?'high-cloud-deck':'low-cloud-deck';mesh.scale.setScalar(layer?292:285);mesh.renderOrder=layer?-997:-996;mesh.frustumCulled=false;group.add(mesh);cloudLayers.push(mesh);
  }
  let disposed=false;
  function update(cycle,time,camera){
    if(disposed)return sample;
    sampleSkyCycle(cycle,sample);
    const seconds=Number.isFinite(time)?Math.max(0,time):0;
    if(camera)group.position.copy(camera.position);
    direction.set(sample.sunX,sample.sunY,sample.sunZ);
    gradient.uniforms.topColor.value.copy(palette.nightTop).lerp(palette.dayTop,sample.daylight).lerp(palette.warmTop,sample.twilight*.35);
    gradient.uniforms.horizonColor.value.copy(palette.nightHorizon).lerp(palette.dayHorizon,sample.daylight).lerp(palette.warmHorizon,sample.twilight*.75);
    gradient.uniforms.lowColor.value.copy(palette.nightLow).lerp(palette.dayLow,sample.daylight).lerp(palette.warmLow,sample.twilight*.4);
    gradient.uniforms.twilight.value=sample.twilight;
    if(scene.background?.isColor)scene.background.copy(gradient.uniforms.horizonColor.value);
    if(scene.fog){scene.fog.color.copy(gradient.uniforms.horizonColor.value);if(scene.fog.isFogExp2)scene.fog.density=.0055+sample.nightMix*.0012;}
    sunDisc.position.copy(direction).multiplyScalar(296);moonDisc.position.copy(direction).multiplyScalar(-296);
    // Face the center in local space, independent of the camera's yaw or translation.
    sunDisc.lookAt(group.position);moonDisc.lookAt(group.position);
    sunDisc.visible=sample.sunOpacity>.001;moonDisc.visible=sample.moonOpacity>.001;
    sunMaterial.uniforms.opacity.value=sample.sunOpacity;sunMaterial.uniforms.tint.value.copy(palette.sunlight).lerp(palette.sunset,sample.twilight*.52);
    moonMaterial.uniforms.opacity.value=sample.moonOpacity;
    starMaterial.uniforms.opacity.value=sample.stars*.88;starMaterial.uniforms.time.value=seconds;stars.visible=sample.stars>.001;
    for(const cloud of cloudLayers){const u=cloud.material.uniforms;u.time.value=seconds;u.nightMix.value=sample.nightMix;u.twilight.value=sample.twilight;u.cloudColor.value.copy(palette.nightCloud).lerp(palette.dayCloud,sample.daylight).lerp(palette.warmCloud,sample.twilight*.7);u.shadeColor.value.copy(palette.nightCloudShade).lerp(palette.dayCloudShade,sample.daylight).lerp(palette.warmCloudShade,sample.twilight*.6);}
    if(sun){sun.color.copy(palette.sunlight).lerp(palette.sunset,sample.twilight*.8);sun.intensity=sample.sunIntensity;origin.copy(sun.target.position);sun.position.copy(origin).addScaledVector(direction,180);}
    if(skyLight){skyLight.color.copy(palette.ambientNight).lerp(palette.ambientDay,sample.daylight);skyLight.groundColor.set('#354552');skyLight.intensity=sample.ambientIntensity;}
    if(fill){fill.color.copy(palette.moonlight);fill.intensity=.22+sample.moonIntensity;fill.position.copy(fill.target.position).addScaledVector(direction,-170);fill.position.y=Math.max(fill.position.y,25);}
    return sample;
  }
  function dispose(){if(disposed)return;disposed=true;scene.remove(group);for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();}
  update(.17,0);
  return {group,update,dispose};
}
