import * as THREE from 'three';

// Small, locally hosted CC0 PBR library. See docs/GRAPHICS-ASSETS.md for sources.
// World projection keeps texel density stable on differently scaled instances
// and on authored rocks/terrain that have no UV attribute.
export const SURFACE_KINDS = Object.freeze(['grass','earth','rock','cobble','wood','masonry','roof']);
const DEFINITIONS = Object.freeze({
  grass:{worldScale:6,normalStrength:.42,roughness:.98},
  earth:{worldScale:3,normalStrength:.5,roughness:.98},
  rock:{worldScale:3,normalStrength:.65,roughness:.96},
  cobble:{worldScale:3,normalStrength:.6,roughness:.94},
  wood:{worldScale:2,normalStrength:.36,roughness:.93},
  masonry:{worldScale:3,normalStrength:.55,roughness:.96},
  roof:{worldScale:3,normalStrength:.5,roughness:.95}
});
const ALIASES=Object.freeze({soil:'earth',dirt:'earth',path:'cobble',cobbles:'cobble',stone:'masonry',plaster:'rock',timber:'wood'});
const maps=new Map(),materials=new WeakMap();
const quality={anisotropy:4,normalMaps:true};
const reliefEnabled={value:1};
const browserAvailable=()=>typeof window!=='undefined'&&typeof document!=='undefined'&&typeof document.createElementNS==='function';
const clamp=(value,min,max,fallback)=>Number.isFinite(value)?Math.max(min,Math.min(max,value)):fallback;

function canonicalKind(kind){
  const resolved=ALIASES[kind]??kind;
  if(!Object.hasOwn(DEFINITIONS,resolved))throw new RangeError(`Unknown surface material: ${kind}`);
  return resolved;
}

function configureTexture(texture,role){
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  texture.minFilter=THREE.LinearMipmapLinearFilter;
  texture.magFilter=THREE.LinearFilter;
  texture.generateMipmaps=true;
  texture.anisotropy=quality.anisotropy;
  texture.colorSpace=role==='albedo'?THREE.SRGBColorSpace:THREE.NoColorSpace;
  texture.needsUpdate=true;
  return texture;
}

function mapRecord(kind,role){
  const key=`${kind}-${role}`;
  if(!maps.has(key)){
    // Ready-to-render pixels prevent black materials while images load, and
    // remain useful if a request fails or the scene is constructed in Node.
    const bytes=role==='normal'?[128,128,255,255]:[255,255,255,255];
    const fallback=configureTexture(new THREE.DataTexture(new Uint8Array(bytes),1,1,THREE.RGBAFormat),role);
    fallback.name=`surface:${key}:fallback`;
    maps.set(key,{kind,role,url:`/assets/surfaces/${key}.jpg`,uniform:{value:fallback},fallback,status:'idle'});
  }
  const record=maps.get(key);
  if(record.status==='idle'&&browserAvailable()){
    record.status='loading';
    try{
      const pending=new THREE.TextureLoader().load(record.url,texture=>{
        texture.name=`surface:${key}`;
        record.uniform.value=configureTexture(texture,role);
        record.status='ready';
      },undefined,()=>{record.status='failed';record.pending?.dispose();record.pending=null;});
      record.pending=pending;
    }catch{
      record.status='failed';
    }
  }
  return record;
}

/** Renderer capability should clamp anisotropy before passing it here. */
export function configureSurfaceTextures({anisotropy=quality.anisotropy,normalMaps=quality.normalMaps}={}){
  quality.anisotropy=Math.round(clamp(anisotropy,1,16,quality.anisotropy));
  quality.normalMaps=Boolean(normalMaps);reliefEnabled.value=quality.normalMaps?1:0;
  for(const record of maps.values()){
    if(record.uniform.value.anisotropy!==quality.anisotropy)configureTexture(record.uniform.value,record.role);
  }
  return {...quality};
}

/** Shared cache ownership: dispose materials normally; do not dispose these maps per scene. */
export function surfaceTextures(){return [...maps.values()].map(record=>record.uniform.value);}
export function surfaceTextureStatus(){return [...maps.values()].map(({kind,role,url,status})=>({kind,role,url,status}));}

const VERTEX_DECLARATIONS=`
varying vec3 vSurfaceWorldPosition;
varying vec3 vSurfaceWorldNormal;
`;
const VERTEX_POSITION=`
#include <project_vertex>
vec4 surfacePosition = vec4(transformed, 1.0);
#ifdef USE_BATCHING
  surfacePosition = batchingMatrix * surfacePosition;
#endif
#ifdef USE_INSTANCING
  surfacePosition = instanceMatrix * surfacePosition;
#endif
vSurfaceWorldPosition = (modelMatrix * surfacePosition).xyz;
vSurfaceWorldNormal = inverseTransformDirection(transformedNormal, viewMatrix);
`;
const FRAGMENT_DECLARATIONS=`
varying vec3 vSurfaceWorldPosition;
varying vec3 vSurfaceWorldNormal;
uniform sampler2D surfaceAlbedo;
uniform sampler2D surfaceNormal;
uniform sampler2D surfaceRoughness;
uniform float surfaceWorldScale;
uniform float surfaceNormalStrength;
uniform float surfaceReliefEnabled;
uniform float surfaceColorStrength;

vec3 surfaceWeights(vec3 n) {
  vec3 w = pow(abs(n), vec3(4.0));
  return w / max(w.x + w.y + w.z, 0.00001);
}
vec4 surfaceSample(sampler2D imageMap, vec3 p, vec3 n, vec3 w) {
  vec3 s = step(vec3(0.0), n) * 2.0 - 1.0;
  vec4 x = texture2D(imageMap, vec2(-s.x * p.z, p.y));
  vec4 y = texture2D(imageMap, vec2(p.x, -s.y * p.z));
  vec4 z = texture2D(imageMap, vec2(s.z * p.x, p.y));
  return x * w.x + y * w.y + z * w.z;
}
vec3 surfaceGradient(vec3 p, vec3 n, vec3 w) {
  vec3 s = step(vec3(0.0), n) * 2.0 - 1.0;
  vec3 x = texture2D(surfaceNormal, vec2(-s.x * p.z, p.y)).xyz * 2.0 - 1.0;
  vec3 y = texture2D(surfaceNormal, vec2(p.x, -s.y * p.z)).xyz * 2.0 - 1.0;
  vec3 z = texture2D(surfaceNormal, vec2(s.z * p.x, p.y)).xyz * 2.0 - 1.0;
  // Decode tangent-space slopes into each projection's world-space basis.
  // Projecting their blend onto the true face tangent plane preserves a
  // smooth mesh's normal when the source normal texture is neutral.
  x.xy /= max(x.z, 0.35); y.xy /= max(y.z, 0.35); z.xy /= max(z.z, 0.35);
  vec3 gradient = vec3(0.0, x.y, -s.x*x.x)*w.x
                +vec3(y.x, 0.0, -s.y*y.y)*w.y
                +vec3(s.z*z.x, z.y, 0.0)*w.z;
  return gradient - n * dot(gradient, n);
}
`;
const MAP_FRAGMENT=`
vec3 surfaceProjectionNormal = normalize(vSurfaceWorldNormal);
#ifdef FLAT_SHADED
  surfaceProjectionNormal = normalize(cross(dFdx(vSurfaceWorldPosition),dFdy(vSurfaceWorldPosition)));
#endif
vec3 surfaceBlend = surfaceWeights(surfaceProjectionNormal);
vec3 surfacePoint = vSurfaceWorldPosition / surfaceWorldScale;
vec3 surfaceTexel = surfaceSample(surfaceAlbedo,surfacePoint,surfaceProjectionNormal,surfaceBlend).rgb;
diffuseColor.rgb *= mix(vec3(1.0),surfaceTexel,surfaceColorStrength);
`;
const NORMAL_FRAGMENT=`
#include <normal_fragment_maps>
if(surfaceReliefEnabled > 0.5 && surfaceNormalStrength > 0.0) {
  vec3 surfaceBaseNormal = inverseTransformDirection(normal,viewMatrix);
  vec3 surfaceSlope = surfaceGradient(surfacePoint,surfaceProjectionNormal,surfaceBlend);
  surfaceSlope -= surfaceBaseNormal * dot(surfaceSlope,surfaceBaseNormal);
  vec3 surfaceDetailedNormal = normalize(surfaceBaseNormal + surfaceSlope * surfaceNormalStrength);
  normal = normalize((viewMatrix * vec4(surfaceDetailedNormal,0.0)).xyz);
}
`;

/** Apply UV-independent local textures to an existing standard/physical material. */
export function applySurface(material,kind,options={}){
  if(!material?.isMeshStandardMaterial)throw new TypeError('Surface textures require MeshStandardMaterial or MeshPhysicalMaterial.');
  const canonical=canonicalKind(kind),defaults=DEFINITIONS[canonical];
  const worldScale=clamp(options.worldScale,.05,500,defaults.worldScale);
  const normalStrength=clamp(options.normalStrength,0,2,kind==='plaster'?.12:defaults.normalStrength);
  const colorStrength=clamp(options.colorStrength,0,1,kind==='plaster'?.12:1);
  let state=materials.get(material);
  if(!state){
    const prior=material.onBeforeCompile,priorKey=material.customProgramCacheKey();
    state={prior,priorKey,uniforms:{},records:{}};materials.set(material,state);
    // Uniform objects stay stable even if an existing material changes kind
    // after compilation; asynchronous image completion updates their values.
    for(const [key,role] of [['surfaceAlbedo','albedo'],['surfaceNormal','normal'],['surfaceRoughness','roughness']]){
      state.uniforms[key]={get value(){return state.records[role].uniform.value;}};
    }
    material.onBeforeCompile=function(shader,renderer){
      state.prior.call(this,shader,renderer);
      Object.assign(shader.uniforms,state.uniforms);
      shader.vertexShader=VERTEX_DECLARATIONS+shader.vertexShader.replace('#include <project_vertex>',VERTEX_POSITION);
      shader.fragmentShader=FRAGMENT_DECLARATIONS+shader.fragmentShader
        .replace('#include <map_fragment>',MAP_FRAGMENT)
        .replace('#include <normal_fragment_maps>',NORMAL_FRAGMENT)
        .replace('#include <roughnessmap_fragment>',`float roughnessFactor = roughness * surfaceSample(surfaceRoughness,surfacePoint,surfaceProjectionNormal,surfaceBlend).g;`);
    };
    material.customProgramCacheKey=()=>`emberwatch-surface-v1:${state.priorKey}`;
  }
  state.records.albedo=mapRecord(canonical,'albedo');
  state.records.normal=mapRecord(canonical,'normal');
  state.records.roughness=mapRecord(canonical,'roughness');
  for(const [key,value] of Object.entries({surfaceWorldScale:worldScale,surfaceNormalStrength:normalStrength,surfaceColorStrength:colorStrength})){
    if(state.uniforms[key])state.uniforms[key].value=value;else state.uniforms[key]={value};
  }
  state.uniforms.surfaceReliefEnabled=reliefEnabled;
  material.userData.surface={kind:canonical,worldScale,normalStrength,colorStrength,projection:'world-triplanar'};
  material.needsUpdate=true;
  return material;
}

/** Unique material instances share the bounded texture cache, never their tint. */
export function createSurfaceMaterial(kind,options={}){
  if(typeof options==='string'||typeof options==='number'||options?.isColor)options={color:options};
  const {worldScale,normalStrength,colorStrength,...standard}=options;
  const canonical=canonicalKind(kind),defaults=DEFINITIONS[canonical];
  const material=new THREE.MeshStandardMaterial({color:0xffffff,roughness:defaults.roughness,...standard});
  material.name=`surface:${kind}`;
  return applySurface(material,kind,{worldScale,normalStrength,colorStrength});
}
