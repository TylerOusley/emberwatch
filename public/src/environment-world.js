import * as THREE from 'three';

const MAX_PARTICLES = 640;
const SEASON_COLOR = Object.freeze({ spring: '#8dba68', summer: '#c8bd75', autumn: '#c78738', winter: '#e4edf0' });
const SEASON_MIX = Object.freeze({ spring: .14, summer: .08, autumn: .52, winter: .78 });
const smooth = (current, target, dt) => current + (target - current) * (1 - Math.exp(-Math.min(.2, Math.max(0, dt)) * 2));
const rainVertex = `
uniform float weatherTime,snowfall;
varying float particleSeed;
void main(){
  particleSeed=position.x*.1+position.z*.17;
  vec3 p=position;
  p.y=mod(p.y-weatherTime*mix(17.0,2.3,snowfall),24.0);
  p.x+=sin(weatherTime*.7+particleSeed)*snowfall*.6;
  vec4 mvPosition=modelViewMatrix*vec4(p,1.0);
  gl_PointSize=clamp(mix(9.0,5.0,snowfall)*100.0/max(1.0,-mvPosition.z),1.0,14.0);
  gl_Position=projectionMatrix*mvPosition;
}`;
const rainFragment = `
uniform float opacity,snowfall;
uniform vec3 tint;
void main(){
  vec2 p=gl_PointCoord*2.0-1.0;
  float snow=(1.0-smoothstep(.3,1.0,length(p)));
  float rain=(1.0-smoothstep(.06,.2,abs(p.x)))*(1.0-abs(p.y));
  float alpha=mix(rain,snow,snowfall)*opacity;
  if(alpha<.015)discard;
  gl_FragColor=vec4(tint,alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const cloudVertex = `varying vec3 direction;void main(){direction=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
const cloudFragment = `
varying vec3 direction;uniform float cover,weatherTime;uniform vec3 tint;
float noise(vec2 p){return sin(p.x)*sin(p.y)*.5+.5;}
void main(){
  vec3 d=normalize(direction);
  vec2 p=d.xz/max(.15,d.y)*2.0+vec2(weatherTime*.003,weatherTime*.001);
  float cloud=noise(p)*.55+noise(p*2.17+4.0)*.3+noise(p*4.3-2.0)*.15;
  float alpha=cover*smoothstep(-.03,.2,d.y)*(.55+.4*cloud);
  gl_FragColor=vec4(tint*(.8+cloud*.2),alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Two bounded draw calls, no weather lights, no per-frame scene traversal or geometry allocation. */
export function createEnvironmentWorld(scene, { sun = null, skyLight = null } = {}) {
  const group = new THREE.Group(); group.name = 'seasons-and-weather'; scene.add(group);
  const seasonTint = { value: new THREE.Color(SEASON_COLOR.spring) }, seasonAmount = { value: 0 };
  const targetTint = new THREE.Color(), weatherTint = new THREE.Color(), patches = [];
  const seen = new Set();
  scene.traverse(object => {
    if (object.name !== 'village-terrain' && !object.geometry?.userData?.forest) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!material || seen.has(material)) continue;
      if (object.name !== 'village-terrain' && !(material.vertexColors && material.side === THREE.DoubleSide)) continue;
      seen.add(material);
      const compile = material.onBeforeCompile, cacheKey = material.customProgramCacheKey;
      const previousKey = cacheKey.call(material);
      material.onBeforeCompile = function(shader, renderer) {
        compile.call(this, shader, renderer);
        shader.uniforms.environmentSeasonTint = seasonTint; shader.uniforms.environmentSeasonAmount = seasonAmount;
        shader.fragmentShader = 'uniform vec3 environmentSeasonTint;uniform float environmentSeasonAmount;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb=mix(diffuseColor.rgb,environmentSeasonTint,environmentSeasonAmount);');
      };
      material.customProgramCacheKey = () => `${previousKey}:environment-seasons-v1`;
      material.needsUpdate = true; patches.push({ material, compile, cacheKey });
    }
  });
  const positions = new Float32Array(MAX_PARTICLES * 3);
  let seed = 736391;
  const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };
  for (let i = 0; i < MAX_PARTICLES; i++) { positions[i * 3] = (random() - .5) * 44; positions[i * 3 + 1] = random() * 24; positions[i * 3 + 2] = (random() - .5) * 44; }
  const rainGeometry = new THREE.BufferGeometry(); rainGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const rainMaterial = new THREE.ShaderMaterial({ vertexShader: rainVertex, fragmentShader: rainFragment, uniforms: { weatherTime: { value: 0 }, snowfall: { value: 0 }, opacity: { value: 0 }, tint: { value: new THREE.Color('#dceafa') } }, transparent: true, depthWrite: false, fog: false });
  const particles = new THREE.Points(rainGeometry, rainMaterial); particles.name = 'local-weather-particles'; particles.frustumCulled = false; group.add(particles);
  const cloudMaterial = new THREE.ShaderMaterial({ vertexShader: cloudVertex, fragmentShader: cloudFragment, uniforms: { cover: { value: 0 }, weatherTime: { value: 0 }, tint: { value: new THREE.Color('#89959b') } }, transparent: true, side: THREE.BackSide, depthWrite: false, fog: false });
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(260, 24, 12), cloudMaterial); clouds.name = 'weather-overcast'; clouds.renderOrder = -995; clouds.frustumCulled = false; group.add(clouds);
  let wet = 0, cover = 0, mist = 0, snow = 0, disposed = false;
  return {
    group, particles, clouds,
    update(state, { position = { x: 0, y: 0, z: 0 }, caveMix = 0, dt = 1 / 60, time = 0, quality = 'medium', daylight = 1, reducedMotion = false } = {}) {
      if (disposed) return;
      const outdoors = 1 - Math.max(0, Math.min(1, caveMix)), weather = state?.weather ?? 'clear', season = state?.season ?? 'spring';
      const preset = typeof quality === 'string' ? quality : quality.effectivePreset ?? 'medium';
      targetTint.set(SEASON_COLOR[season] ?? SEASON_COLOR.spring);
      seasonTint.value.lerp(targetTint, 1 - Math.exp(-Math.min(.2, dt) * .3));
      seasonAmount.value = smooth(seasonAmount.value, state ? SEASON_MIX[season] ?? 0 : 0, dt);
      wet = smooth(wet, ['rain', 'snow'].includes(weather) ? 1 : 0, dt);
      cover = smooth(cover, weather === 'clear' ? 0 : weather === 'fog' ? .3 : .75, dt);
      mist = smooth(mist, weather === 'fog' ? 1 : weather === 'rain' || weather === 'snow' ? .18 : 0, dt);
      snow = smooth(snow, weather === 'snow' ? 1 : 0, dt);
      group.position.set(position.x ?? 0, position.y ?? 0, position.z ?? 0);
      group.visible = Boolean(state) && outdoors > .01;
      const u = rainMaterial.uniforms;
      u.weatherTime.value = reducedMotion ? 0 : time; u.snowfall.value = snow; u.opacity.value = wet * outdoors * (.35 + snow * .4);
      particles.visible = group.visible && wet > .01 && !reducedMotion;
      rainGeometry.setDrawRange(0, preset === 'low' ? 120 : preset === 'high' || preset === 'ultra' ? MAX_PARTICLES : 320);
      cloudMaterial.uniforms.cover.value = cover * outdoors; cloudMaterial.uniforms.weatherTime.value = reducedMotion ? 0 : time;
      cloudMaterial.uniforms.tint.value.set('#88969c').multiplyScalar(.25 + daylight * .75);
      clouds.visible = group.visible && cover > .01 && preset !== 'low';
      if (state && scene.fog?.isFogExp2) {
        scene.fog.density += outdoors * (mist * .013 + cover * .0015);
        weatherTint.set('#a5b4ba').multiplyScalar(.25 + daylight * .75);
        scene.fog.color.lerp(weatherTint, cover * outdoors * .28);
      }
      if (state && sun) sun.intensity *= 1 - cover * outdoors * .46;
      if (state && skyLight) skyLight.intensity *= 1 - cover * outdoors * .12;
    },
    dispose() {
      if (disposed) return; disposed = true;
      for (const { material, compile, cacheKey } of patches) { material.onBeforeCompile = compile; material.customProgramCacheKey = cacheKey; material.needsUpdate = true; }
      rainGeometry.dispose(); rainMaterial.dispose(); clouds.geometry.dispose(); cloudMaterial.dispose(); scene.remove(group);
    }
  };
}
