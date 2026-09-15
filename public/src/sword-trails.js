import * as THREE from 'three';

const MAX_ACTORS=64, SAMPLES=12, STRIDE=7, LIFE=.16, DURATION=.54;
const MAX_VERTICES=MAX_ACTORS*(SAMPLES-1)*6;
const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));

// Samples the existing articulated blade, not an invented arc around the dwarf.
// One dynamic mesh handles every short ribbon; no per-strike scene objects,
// particles, geometry allocation, timers, or gameplay collision are introduced.
export function createSwordTrails(scene) {
  const root=new THREE.Group();root.name='sword-swing-trails';scene.add(root);
  const positions=new Float32Array(MAX_VERTICES*3),uvs=new Float32Array(MAX_VERTICES*2),births=new Float32Array(MAX_VERTICES);
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('uv',new THREE.BufferAttribute(uvs,2).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('born',new THREE.BufferAttribute(births,1).setUsage(THREE.DynamicDrawUsage));
  geometry.setDrawRange(0,0);
  const material=new THREE.ShaderMaterial({
    uniforms:{trailTime:{value:0},trailColor:{value:new THREE.Color('#fff1d1')},trailLife:{value:LIFE}},
    vertexShader:`attribute float born;
varying vec2 vUv;
varying float vBorn;
void main(){vUv=uv;vBorn=born;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`uniform float trailTime;
uniform float trailLife;
uniform vec3 trailColor;
varying vec2 vUv;
varying float vBorn;
void main(){
  float age=clamp((trailTime-vBorn)/trailLife,0.0,1.0);
  float bladeEdge=sin(clamp(vUv.x,0.0,1.0)*3.14159265);
  float alpha=.29*pow(1.0-age,1.8)*pow(max(bladeEdge,0.0),.45)*smoothstep(0.0,.35,vUv.y);
  if(alpha<.004)discard;
  gl_FragColor=vec4(trailColor,alpha);
  #include <colorspace_fragment>
}`,
    transparent:true,depthWrite:false,depthTest:true,side:THREE.DoubleSide,toneMapped:false
  });
  const mesh=new THREE.Mesh(geometry,material);mesh.name='pooled-blade-ribbons';mesh.frustumCulled=false;mesh.renderOrder=2;mesh.visible=false;root.add(mesh);
  const tracks=new Map(),base=new THREE.Vector3(),tip=new THREE.Vector3(),origin=new THREE.Vector3();
  let disposed=false,lastTime=null,vertices=0,strokes=0;
  const visible=node=>{for(let p=node;p;p=p.parent)if(!p.visible)return false;return true;};
  function reset(){tracks.clear();geometry.setDrawRange(0,0);mesh.visible=false;vertices=0;lastTime=null;}
  function track(group,attack,dt){
    const attacking=typeof attack==='number'?attack>0:attack===true;
    return {group,previousAttack:attack,clock:attacking?dt:9,suppress:attacking,sword:null,count:0,samples:new Float64Array(SAMPLES*STRIDE),
      lastRoot:group.getWorldPosition(new THREE.Vector3()),lastTip:new THREE.Vector3(),hasTip:false,seen:false};
  }
  function append(entry,time){
    if(entry.count===SAMPLES){entry.samples.copyWithin(0,STRIDE);entry.count--;}
    const i=entry.count++*STRIDE,s=entry.samples;
    s[i]=base.x;s[i+1]=base.y;s[i+2]=base.z;s[i+3]=tip.x;s[i+4]=tip.y;s[i+5]=tip.z;s[i+6]=time;
  }
  function expire(entry,time){
    let remove=0;while(remove<entry.count&&time-entry.samples[remove*STRIDE+6]>LIFE)remove++;
    if(remove){entry.samples.copyWithin(0,remove*STRIDE);entry.count-=remove;}
  }
  function vertex(s,index,outer,u,along){
    const i=index*STRIDE+(outer?3:0),p=vertices*3,v=vertices*2;
    positions[p]=s[i];positions[p+1]=s[i+1];positions[p+2]=s[i+2];
    births[vertices]=s[index*STRIDE+6];uvs[v]=u;uvs[v+1]=along;vertices++;
  }
  function update({actors,entities=[],ownId,localActionId=0,selected='',dt=0,time=0,active=true,snapshotAt}={}){
    if(disposed)return;
    const stale=Number.isFinite(snapshotAt)&&time-snapshotAt>.65;
    if(!active||stale||globalThis.document?.hidden||!Number.isFinite(time)||!(actors instanceof Map)){reset();return;}
    if(lastTime!==null&&(time<lastTime||time-lastTime>.25))reset();
    lastTime=time;dt=clamp(Number(dt)||0,0,.1);material.uniforms.trailTime.value=time;
    for(const entry of tracks.values())entry.seen=false;
    for(const entity of entities){
      if(entity.role==='zombie')continue;
      const actor=actors.get(entity.id),group=actor?.rig?.group;if(!group)continue;
      const options=actor.motionOptions||{},self=entity.id===ownId;
      const attack=options.attack??(self?localActionId:['attack','attacking'].includes(entity.anim));
      const tool=options.tool??(self?selected:entity.tool??(entity.role==='guard'?'sword':''));
      const toolId=typeof tool==='object'?tool?.id:tool;
      let entry=tracks.get(entity.id);
      if(!entry||entry.group!==group){
        if(!entry&&tracks.size>=MAX_ACTORS)continue;
        entry=track(group,attack,dt);tracks.set(entity.id,entry);
      }else{
        const newAttack=typeof attack==='number'?attack>0&&attack!==entry.previousAttack:attack&&!entry.previousAttack;
        const repeatAttack=attack===true&&entry.clock>=DURATION+.06;
        if(!(options.downed??entity.downed)&&(newAttack||repeatAttack)&&entry.clock>=DURATION*.90){entry.clock=0;entry.suppress=false;entry.count=0;strokes++;}
        entry.previousAttack=attack;entry.clock+=dt;
      }
      entry.seen=true;
      const unavailable=entity.hp<=0||options.downed||entity.downed||entity.bedPlotId||entity.carriedBy||entity.mountedHorseId||entity.carryingId||options.mounted||options.carrying;
      if(toolId!=='sword'||unavailable||!visible(group)){
        entry.count=0;entry.hasTip=false;entry.sword=null;entry.suppress=true;group.getWorldPosition(entry.lastRoot);continue;
      }
      const sword=group.getObjectByName('held-sword');
      if(!sword||!visible(sword)){entry.count=0;entry.hasTip=false;entry.suppress=true;continue;}
      if(entry.sword&&entry.sword!==sword){entry.count=0;entry.hasTip=false;entry.suppress=true;}
      entry.sword=sword;sword.updateWorldMatrix(true,false);
      base.set(0,.30,0).applyMatrix4(sword.matrixWorld);tip.set(0,.97,0).applyMatrix4(sword.matrixWorld);
      group.getWorldPosition(origin);
      const jumped=origin.distanceTo(entry.lastRoot)>1.8||entry.hasTip&&tip.distanceTo(entry.lastTip)>2.4;
      if(jumped||!Number.isFinite(base.x)||!Number.isFinite(base.y)||!Number.isFinite(base.z)||!Number.isFinite(tip.x)||!Number.isFinite(tip.y)||!Number.isFinite(tip.z)){
        entry.count=0;entry.hasTip=false;entry.suppress=true;
      }
      // Anticipation and recovery remain clean. Only the blade's fast cutting
      // phase leaves a faint surface, which fades in less than a fifth second.
      const cutting=entry.clock>=DURATION*.27&&entry.clock<=DURATION*.67&&!entry.suppress;
      if(cutting&&!jumped){
        if(!entry.count||!entry.hasTip||tip.distanceToSquared(entry.lastTip)>.000016)append(entry,time);
      }
      entry.lastTip.copy(tip);entry.lastRoot.copy(origin);entry.hasTip=true;expire(entry,time);
    }
    for(const [id,entry] of tracks)if(!entry.seen)tracks.delete(id);
    vertices=0;
    for(const entry of tracks.values())for(let i=1;i<entry.count;i++){
      const s=entry.samples,old=(i-1)/(entry.count-1),next=i/(entry.count-1);
      vertex(s,i-1,false,0,old);vertex(s,i-1,true,1,old);vertex(s,i,false,0,next);
      vertex(s,i-1,true,1,old);vertex(s,i,true,1,next);vertex(s,i,false,0,next);
    }
    geometry.setDrawRange(0,vertices);mesh.visible=vertices>0;
    for(const name of ['position','uv','born'])geometry.attributes[name].needsUpdate=true;
  }
  return {root,update,reset,
    get debug(){return {tracked:tracks.size,maxActors:MAX_ACTORS,vertices,maxVertices:MAX_VERTICES,strokes,lifetime:LIFE,drawCalls:mesh.visible?1:0};},
    dispose(){if(disposed)return;reset();disposed=true;root.removeFromParent();geometry.dispose();material.dispose();}
  };
}
