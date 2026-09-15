import * as THREE from 'three';
import { buildBody } from './character-body.js';
import { buildHead } from './character-head.js';
import { buildClothing } from './character-clothing.js';

// Original sculpted characters: continuous skin, shaped faces and tailored
// garments deform around the existing gameplay rig. Tools retain rigid batching.
const geometryCache = new Map();
const materialCache = new Map();
const TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;
const smooth = t => t * t * (3 - 2 * t);

// Additive shoulder, elbow, wrist, torso, and support-arm poses. Each action
// eases from the current gait through anticipation, contact, and recovery.
// Wrist rotation lets the working end of a tool travel forward at contact.
const WORK_TOOLS = new Set(['axe','pickaxe','hammer','scythe']);
const UPRIGHT_TOOLS = new Set([...WORK_TOOLS,'bow','staff','heal']);
const REST_ACTION = new Array(12).fill(0);
const ACTION_POSES = {
  axe: [
    [-1.85,-.15,-.20,1.15,-.15,0,-.12,-.035,-.22,-.035,-.38,-.24],
    [-.78,.14,-.06,.60,1.30,0,.12,.10,.23,.025,-.56,-.16],
    [-.42,.18,.05,.60,.85,0,.16,.07,.16,.015,-.28,-.08],
  ],
  pickaxe: [
    [-2.0,-.05,-.12,1.35,-.10,0,-.08,-.055,-.10,0,-.68,-.36],
    [-.82,.04,-.03,.85,1.38,0,.05,.16,.10,0,-.72,-.20],
    [-.42,.06,.01,.92,.86,0,.08,.10,.08,0,-.35,-.12],
  ],
  hammer: [
    [-.78,-.06,-.08,.45,-.23,0,-.05,-.02,-.09,0,-.20,-.12],
    [-.60,.04,-.03,.65,1.18,0,.03,.065,.09,0,-.27,-.08],
    [-.36,.05,.02,.50,.58,0,.06,.035,.06,0,-.14,-.05],
  ],
  scythe: [
    [-.40,-.50,-.22,1.12,.88,-.12,.10,.035,-.48,-.035,-.38,-.24],
    [-.25,.32,.15,.92,1.30,.12,.10,.085,.42,.04,-.58,-.14],
    [-.25,.46,.22,1.00,1.12,.16,.10,.06,.55,.035,-.35,-.08],
  ],
  sword: [
    [-1.18,-.26,-.38,-.40,-.18,0,-.35,-.025,-.20,-.025,-.28,-.22],
    [-.86,.28,.23,-.03,1.0,.10,.37,.07,.27,.03,-.47,-.20],
    [-.42,.37,.35,.03,.65,.15,.48,.045,.34,.025,-.22,-.10],
  ],
  bow: [
    [-1.23,-.04,-.04,1.16,0,0,0,-.02,-.08,0,-1.1,-1.0],
    [-1.23,.04,-.04,1.18,0,0,0,.025,.04,0,-.72,-.35],
    [-.95,.04,-.04,.94,0,0,0,0,.04,0,-.65,-.45],
  ],
  zombie: [
    [.16,-.08,-.08,-.16,0,0,0,-.045,-.10,-.02,.13,-.08],
    [-.48,.10,.04,.12,0,0,0,.14,.12,.035,-.62,.10],
    [-.18,.08,.03,.04,0,0,0,.065,.08,.02,-.26,.04],
  ],
};
function actionPose(profile, phase, target) {
  const stops = [0,.30,.52,.72,1];
  let segment = 0;
  while (segment < 3 && phase > stops[segment + 1]) segment++;
  const from = segment === 0 ? REST_ACTION : profile[segment - 1];
  const to = segment === 3 ? REST_ACTION : profile[segment];
  const amount = smooth(clamp((phase - stops[segment]) / (stops[segment + 1] - stops[segment]),0,1));
  for (let i = 0; i < target.length; i++) target[i] = from[i] + (to[i] - from[i]) * amount;
}
function poseJoint(joint, x, y, z, amount) {
  joint.rotation.x += (x - joint.rotation.x) * amount;
  joint.rotation.y += (y - joint.rotation.y) * amount;
  joint.rotation.z += (z - joint.rotation.z) * amount;
}
function material(color, metalness = 0, roughness = .8, emissive = 0) {
  const key = `${color}/${metalness}/${roughness}/${emissive}`;
  if (!materialCache.has(key)) materialCache.set(key, new THREE.MeshStandardMaterial({ color, metalness, roughness, emissive, emissiveIntensity: emissive ? .65 : 0 }));
  return materialCache.get(key);
}
function geometry(type) {
  if (geometryCache.has(type)) return geometryCache.get(type);
  let g;
  if (type === 'round') g = new THREE.SphereGeometry(1, 12, 8);
  else if (type === 'chunk') g = new THREE.IcosahedronGeometry(1, 0);
  else if (type === 'cylinder') g = new THREE.CylinderGeometry(1, 1, 1, 12);
  else if (type === 'cone') g = new THREE.ConeGeometry(1, 1, 10);
  else if (type === 'ring') g = new THREE.TorusGeometry(1, .13, 6, 16);
  else if (type === 'shield') {
    const s = new THREE.Shape();
    s.moveTo(-.35, .38); s.lineTo(.35,.38); s.lineTo(.34,-.04); s.lineTo(0,-.46); s.lineTo(-.34,-.04); s.closePath();
    g = new THREE.ExtrudeGeometry(s, { depth:.075, bevelEnabled:true, bevelSize:.025, bevelThickness:.025, bevelSegments:1, steps:1 });
  } else if (type === 'axe') {
    const s = new THREE.Shape();
    s.moveTo(-.04,.12); s.lineTo(.31,.26); s.lineTo(.38,.07); s.lineTo(.35,-.21); s.lineTo(.05,-.08); s.closePath();
    g = new THREE.ExtrudeGeometry(s, { depth:.065, bevelEnabled:true, bevelSize:.02, bevelThickness:.01, bevelSegments:1 });
  } else if (type === 'scythe') {
    const s = new THREE.Shape();
    s.moveTo(0,0); s.quadraticCurveTo(.46,.24,.91,-.23); s.quadraticCurveTo(.41,.08,.03,-.12); s.closePath();
    g = new THREE.ExtrudeGeometry(s, { depth:.025, bevelEnabled:false, curveSegments:5 });
  } else if (type === 'sword') {
    const s = new THREE.Shape();
    s.moveTo(-.075,0); s.lineTo(.075,0); s.lineTo(.065,.62); s.lineTo(0,.8); s.lineTo(-.065,.62); s.closePath();
    g = new THREE.ExtrudeGeometry(s, { depth:.038, bevelEnabled:true, bevelSize:.016, bevelThickness:.014, bevelSegments:1 });
  } else g = new THREE.BoxGeometry(1,1,1);
  geometryCache.set(type,g); return g;
}
function mesh(parent, type, mat, x,y,z, sx=1,sy=1,sz=1, rx=0,ry=0,rz=0) {
  const m = new THREE.Mesh(geometry(type), mat);
  m.position.set(x,y,z); m.scale.set(sx,sy,sz); m.rotation.set(rx,ry,rz);
  m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
function pivot(parent,x=0,y=0,z=0) { const p = new THREE.Group(); p.position.set(x,y,z); parent.add(p); return p; }

// Merge rigid detail without an additional loader or an external model dependency.
function mergeRigid(root, owned) {
  for (const child of [...root.children]) if (child.isGroup || child.isBone) mergeRigid(child,owned);
  const batches = new Map();
  for (const child of root.children) if (child.isMesh && !child.isSkinnedMesh && !child.userData.tailored) {
    if (!batches.has(child.material)) batches.set(child.material,[]);
    batches.get(child.material).push(child);
  }
  for (const [mat, sources] of batches) {
    if (sources.length < 2) continue;
    const positions=[], normals=[], colors=[], uvs=[];
    const useColors=sources.some(m=>m.geometry.attributes.color),useUV=sources.some(m=>m.geometry.attributes.uv);
    for (const source of sources) {
      source.updateMatrix();
      const transformed = source.geometry.clone().applyMatrix4(source.matrix);
      const flat = transformed.index ? transformed.toNonIndexed() : transformed;
      positions.push(...flat.attributes.position.array); normals.push(...flat.attributes.normal.array);
      if(useColors) {
        if(flat.attributes.color)colors.push(...flat.attributes.color.array);
        else for(let i=0;i<flat.attributes.position.count;i++)colors.push(1,1,1);
      }
      if(useUV) {
        if(flat.attributes.uv)uvs.push(...flat.attributes.uv.array);
        else for(let i=0;i<flat.attributes.position.count;i++)uvs.push(0,0);
      }
      if (flat !== transformed) flat.dispose(); transformed.dispose(); root.remove(source);
      if(owned.delete(source.geometry))source.geometry.dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
    if(useColors)g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    if(useUV)g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
    g.computeBoundingSphere(); owned.add(g);
    const m = new THREE.Mesh(g,mat); m.castShadow = true; m.receiveShadow = true; root.add(m);
  }
}

function makeTool(id, tier=1) {
  const g = new THREE.Group();
  const wood = material(0x946038), grain=material(0xc69459), grip=material(0x49372c);
  const head = tier >= 3 ? material(0xadc2c6,.7,.35) : tier === 2 ? material(0x8b9695,.08,.95) : material(0xc99963);
  if (id === 'sword') {
    mesh(g,'cylinder',grip,0,0,0,.029,.22,.029);
    mesh(g,'round',grain,0,-.15,0,.065,.065,.06);
    mesh(g,'box',wood,0,.13,0,.32,.07,.09);
    mesh(g,'sword',head,0,.17,-.018);
    mesh(g,'box',grain,0,.45,.047,.015,.51,.012);
  } else if (id === 'axe' || id === 'pickaxe' || id === 'scythe' || id === 'hammer') {
    const height = id === 'scythe' ? 1.32 : .95;
    mesh(g,'cylinder',wood,0,height*.24,0,.031,height,.031);
    mesh(g,'cylinder',grip,0,-.08,0,.032,.24,.032);
    if (id === 'axe') {
      mesh(g,'axe',head,-.025,.64,-.035);
      mesh(g,'box',grip,0,.66,.015,.12,.17,.115);
      mesh(g,'box',grain,.345,.65,.012,.025,.21,.08,0,0,.05);
    } else if (id === 'pickaxe') {
      mesh(g,'box',head,0,.63,0,.61,.09,.10,0,0,-.08);
      mesh(g,'cone',head,-.34,.56,0,.067,.28,.065,0,0,2.55);
      mesh(g,'cone',head,.34,.52,0,.065,.32,.065,0,0,-2.50);
      mesh(g,'box',grip,0,.63,0,.14,.17,.13);
    } else if (id === 'scythe') {
      mesh(g,'scythe',head,-.02,.98,-.02,1,1,1);
      mesh(g,'box',wood,-.14,.2,0,.27,.06,.07);
      mesh(g,'box',grip,0,.94,0,.09,.13,.11);
    } else {
      mesh(g,'box',head,0,.62,0,.43,.28,.27);
      mesh(g,'box',grain,-.215,.62,0,.03,.29,.28);
      mesh(g,'box',grain,.215,.62,0,.03,.29,.28);
      mesh(g,'box',grip,0,.62,0,.09,.3,.285);
    }
  } else if (id === 'bow') {
    for (let i=0;i<8;i++) {
      const a=-Math.PI/2+i*Math.PI/8,b=a+Math.PI/8;
      const x1=.28*Math.cos(a),y1=.65*Math.sin(a),x2=.28*Math.cos(b),y2=.65*Math.sin(b);
      mesh(g,'cylinder',wood,(x1+x2)/2,(y1+y2)/2,0,.032,Math.hypot(x2-x1,y2-y1),.032,0,0,-Math.atan2(x2-x1,y2-y1));
    }
    mesh(g,'cylinder',material(0xe1d5b5),0,0,0,.009,1.3,.009);
    mesh(g,'cylinder',grip,.28,0,0,.032,.23,.032);
    mesh(g,'cylinder',grain,.35,0,.025,.012,.70,.012,0,0,-Math.PI/2);
    mesh(g,'cone',head,.76,0,.025,.035,.12,.035,0,0,-Math.PI/2);
  } else if (id === 'food') {
    mesh(g,'round',material(0xc6863f),0,.08,.03,.17,.1,.32);
    for(let i=0;i<3;i++) mesh(g,'box',material(0xf1c580),0,.17,-.10+i*.11,.19,.018,.02,0,.3,0);
  } else if (id === 'heal' || id === 'staff') {
    const brass=material(0xc3a360,.45,.5), glow=material(0x97eac6,.1,.4,0x438d6b);
    mesh(g,'cylinder',wood,0,.26,0,.031,1.48,.031);
    mesh(g,'cylinder',brass,0,.81,0,.045,.14,.045);
    mesh(g,'ring',brass,0,1.02,0,.16,.2,.16);
    mesh(g,'chunk',glow,0,1.02,0,.072,.11,.072);
    mesh(g,'cone',brass,0,1.24,0,.055,.11,.055);
  }
  return g;
}

export function createCharacter(kind='villager', seed=1) {
  const group = new THREE.Group();
  const visual = pivot(group);
  const owned = new Set();
  let rig, role=kind, toolId='', toolTier=1, heldTool, attackClock=9, previousAttack=false, disposed=false;
  let walkPhase=(Number(seed)||1)*1.173, idleTime=0, downAmount=0, moveAmount=0, motionSpeed=0, spellAmount=0, mountAmount=0, carryAmount=0;
  const actionOffsets = new Float64Array(12);
  const variation = Math.abs(Math.trunc(Number(seed)||1)) % 4;
  const skin = material([0xdba779,0xc38d65,0xe9bc8e,0xa87354][variation]);
  const beard = material([0x6b4029,0x9a6137,0xc6a77d,0x4b3730][variation]);
  const dark=material(0x302b29), brass=material(0xc9a25b,.55,.5), iron=material(0x809da2,.65,.45);

  function build() {
    visual.clear();
    for (const resource of owned) resource.dispose(); owned.clear();
    const zombie=role === 'zombie';
    const bone=(parent,x=0,y=0,z=0)=>{const b=new THREE.Bone();b.position.set(x,y,z);parent.add(b);return b;};
    const body=bone(visual,0,zombie?1.10:1.04,0);
    const head=bone(body,0,zombie?.81:.76,.01);
    const leftArm=bone(body,zombie?.35:.48,.36,0),rightArm=bone(body,zombie?-.35:-.48,.36,0);
    const leftFore=bone(leftArm,0,-.34,0),rightFore=bone(rightArm,0,-.34,0);
    const hand=bone(rightFore,0,-.30,.035);
    const leftLeg=bone(body,zombie?.17:.21,-.27,0),rightLeg=bone(body,zombie?-.17:-.21,-.27,0);
    const leftShin=bone(leftLeg,0,-.35,0),rightShin=bone(rightLeg,0,-.35,0);
    rig={body,head,leftArm,rightArm,leftFore,rightFore,hand,leftLeg,rightLeg,leftShin,rightShin,zombie};
    for(const [name,joint] of Object.entries(rig))if(joint?.isBone)joint.name=name;
    attackClock=9; previousAttack=false; spellAmount=0;
    const clothes=material(role==='guard'?0x364b5e:role==='priest'?0xb6ab91:role==='zombie'?0x50584f:0x4d6456);
    const actualSkin=zombie?material([0x87917b,0x7d8a79,0x93917a,0x738779][variation],0,.92):skin;
    const palette={skin:actualSkin,hair:beard,cloth:clothes,leather:material(0x66503a),iron,brass,dark};
    buildBody(visual,rig,{skin:actualSkin,own:owned});
    buildHead(head,{role,variation,palette,own:owned});
    buildClothing(rig,{role,variation,palette,own:owned});
    mergeRigid(visual,owned);
    if(role==='guard') {
      const shield=pivot(leftFore,.045,-.12,.20);
      mesh(shield,'shield',brass,0,0,0,.90,.94,1);
      mesh(shield,'shield',clothes,0,.018,.078,.78,.80,.38);
      mesh(shield,'box',brass,0,.02,.133,.045,.38,.022);
      mesh(shield,'box',brass,0,.07,.136,.23,.040,.022);
      mesh(shield,'round',iron,0,.045,.15,.065,.065,.035);
      mergeRigid(shield,owned);
    }
    toolId=''; heldTool=null;
    if(!zombie) setTool(role==='priest'?'heal':'sword');
  }

  function setTool(tool) {
    let id=typeof tool==='object'&&tool ? tool.id : tool;
    const tier=typeof tool==='object'&&tool ? Number(tool.tier)||1 : 1;
    id=id||'';
    if(rig.zombie || (id===toolId && tier===toolTier)) return;
    if(heldTool) { rig.hand.remove(heldTool); heldTool.traverse(n=>{if(n.isMesh && owned.has(n.geometry)){owned.delete(n.geometry);n.geometry.dispose();}}); }
    toolId=id; toolTier=tier;
    heldTool=makeTool(id,tier);
    heldTool.name=`held-${id || 'empty'}`;
    if(id==='sword' || UPRIGHT_TOOLS.has(id)) {
      // Align every shaft with the finger curl, then offset the actual grip
      // (working handles at y=-.08; bow at x=.28) into the closed hand.
      // The elbow and wrist turn together below; rotating only a tool head
      // would still leave its handle cutting through the sculpted fingers.
      heldTool.position.set(WORK_TOOLS.has(id)?.08:0,id==='bow'?.176:-.104,.050);
      heldTool.rotation.set(0,0,-Math.PI/2,'ZYX');
    } else {
      heldTool.position.set(-.025,-.045,.07);
      heldTool.rotation.set(.65,0,id==='staff'||id==='heal'?.16:.28);
    }
    rig.hand.add(heldTool);
    mergeRigid(heldTool,owned);
  }
  function setRole(next) {
    if(!['villager','guard','priest','zombie'].includes(next) || next===role) return;
    const previousTool=toolId, previousTier=toolTier;
    role=next; build();
    if(previousTool && next!=='zombie') setTool({id:previousTool,tier:previousTier});
  }
  build();

  function update(dt,time, options={}) {
    if(disposed) return;
    const {moving=false,speed=5.4,attack=false,downed=false,tool,channeling=false,mounted=false,carrying=false,tier=1}=options;
    dt=clamp(Number(dt)||0,0,.1);
    idleTime+=dt;
    if(tool!==undefined) setTool(typeof tool==='object'?tool:{id:tool,tier});
    if(heldTool) heldTool.visible=!mounted&&!carrying;
    mountAmount+=((mounted&&!downed?1:0)-mountAmount)*(1-Math.exp(-dt*12));
    carryAmount+=((carrying&&!downed?1:0)-carryAmount)*(1-Math.exp(-dt*12));
    const duration=rig.zombie?1.30:.54;
    const newAttack=typeof attack==='number' ? attack>0 && attack!==previousAttack : attack && !previousAttack;
    const repeatAttack=attack===true && attackClock>=duration+.06;
    // Finish a strike before starting another; rapid clicks cannot snap the
    // shoulder back to its windup. Numbered events and held NPC attacks work.
    if(!downed && (newAttack || repeatAttack) && attackClock>=duration*.90) attackClock=0;
    previousAttack=attack;
    attackClock+=dt;
    const requestedSpeed=Number.isFinite(Number(speed))?Math.max(0,Number(speed)):5.4;
    const locomotion=moving && !downed && !mounted;
    moveAmount+=((locomotion?1:0)-moveAmount)*(1-Math.exp(-dt*9));
    const nominalSpeed=rig.zombie?1.75:5.4;
    const speedTarget=locomotion?Math.min(requestedSpeed,nominalSpeed*1.65):0;
    const speedBlend=1-Math.exp(-dt*10);
    // Integrate the smoothed speed analytically so different render rates do
    // not accumulate different gait phases over the same traveled distance.
    const strideDistance=speedTarget*dt+(motionSpeed-speedTarget)*speedBlend/10;
    motionSpeed+=(speedTarget-motionSpeed)*speedBlend;
    downAmount+=((downed?1:0)-downAmount)*(1-Math.exp(-dt*8));
    walkPhase=(walkPhase+strideDistance*(rig.zombie?4.1:9.0)/nominalSpeed)%TAU;
    const s=Math.sin(walkPhase), c=Math.cos(walkPhase), breath=Math.sin(idleTime*2.2+variation);
    const stride=moveAmount*clamp(motionSpeed/nominalSpeed,.30,1.15);
    const liftLeft=Math.pow(Math.max(0,-s),2), liftRight=Math.pow(Math.max(0,s),2);
    const stepRise=(1-Math.cos(walkPhase*2))*.5;
    const casting=toolId==='heal'||toolId==='staff';
    const spellTarget=!downed && casting && (channeling || attack===true || attackClock<.54) ? 1 : 0;
    spellAmount+=(spellTarget-spellAmount)*(1-Math.exp(-dt*(spellTarget?9:7)));
    const active=!casting && attackClock<duration && !downed;
    actionOffsets.fill(0);
    if(active) actionPose(ACTION_POSES[rig.zombie?'zombie':toolId]||ACTION_POSES.sword,attackClock/duration,actionOffsets);
    const a=actionOffsets, alive=1-downAmount;
    const attackWeight=active?Math.sin(Math.PI*clamp(attackClock/duration,0,1)):0;
    const armStride=stride*(1-attackWeight*.85)*(1-spellAmount*.85);
    const settle=1-Math.exp(-dt*25);
    if(toolId==='scythe' && heldTool) {
      // Roll around the circular shaft while reaping, so the cutting blade
      // sweeps parallel to the field. ZYX keeps this roll about the shaft's
      // own axis and leaves its grip centered inside the fingers.
      const phase=clamp(attackClock/duration,0,1);
      const reap=active?smooth(clamp(phase/.30,0,1))*(1-smooth(clamp((phase-.72)/.28,0,1))):0;
      heldTool.rotation.y+=(Math.PI/2*reap-heldTool.rotation.y)*settle;
    }
    visual.rotation.z=-Math.PI*.49*downAmount;
    visual.position.y=.70*downAmount;
    visual.position.z=0;
    if(rig.zombie) {
      rig.body.position.y+=(1.10+(stepRise*.030*stride+breath*.009)*alive-rig.body.position.y)*settle;
      poseJoint(rig.body,.17+s*.025*stride+a[7],s*.045*stride+a[8],.065+s*.045*stride+a[9],settle);
      poseJoint(rig.head,-.09+breath*.020-a[7]*.35,c*.045*stride,.10+Math.sin(idleTime*1.4+variation)*.025,settle);
      poseJoint(rig.leftLeg,s*.30*stride,0,0,settle);
      poseJoint(rig.rightLeg,-s*.37*stride,0,0,settle);
      poseJoint(rig.leftShin,.08+liftLeft*.27*stride,0,0,settle);
      poseJoint(rig.rightShin,.06+liftRight*.32*stride,0,0,settle);
      poseJoint(rig.leftArm,(-.50+c*.10*armStride+a[10])*alive,0,.10+breath*.025,settle);
      poseJoint(rig.rightArm,(-.75-c*.13*armStride+a[0])*alive,a[1],-.12+a[2],settle);
      poseJoint(rig.leftFore,(-.14-breath*.025+a[11])*alive,0,0,settle);
      poseJoint(rig.rightFore,(-.18+breath*.030+a[3])*alive,0,0,settle);
    } else {
      rig.body.position.y+=(1.04+(stepRise*.040*stride+breath*.008)*alive-rig.body.position.y)*settle;
      poseJoint(rig.body,.045*stride+a[7],s*.035*stride+a[8],-s*.020*stride+a[9],settle);
      poseJoint(rig.head,-.025+breath*.01-a[7]*.45-spellAmount*.08,-s*.025*stride-a[8]*.28,downAmount*.20,settle);
      poseJoint(rig.leftLeg,s*.53*stride-1.10*mountAmount,0,-.40*mountAmount,settle);
      poseJoint(rig.rightLeg,-s*.53*stride-1.10*mountAmount,0,.40*mountAmount,settle);
      poseJoint(rig.leftShin,liftLeft*.42*stride+.80*mountAmount,0,0,settle);
      poseJoint(rig.rightShin,liftRight*.42*stride+.80*mountAmount,0,0,settle);
      poseJoint(rig.leftArm,(-s*.32*armStride-.06+a[10]-spellAmount*.70-.9*carryAmount-.65*mountAmount)*alive,spellAmount*.14,.09+spellAmount*.08,settle);
      poseJoint(rig.rightArm,(s*.24*armStride-.12+a[0]-spellAmount*.65-.9*carryAmount-.65*mountAmount)*alive,a[1],-.10+a[2]-spellAmount*.08,settle);
      poseJoint(rig.leftFore,(-.13+a[11]-spellAmount*.32-.6*carryAmount-.35*mountAmount)*alive,0,0,settle);
      const uprightGrip=UPRIGHT_TOOLS.has(toolId);
      const elbowRest=-.14-(uprightGrip?1.26*(1-mountAmount)*(1-carryAmount):0);
      poseJoint(rig.rightFore,(elbowRest+a[3]-spellAmount*.18-.6*carryAmount-.35*mountAmount)*alive,0,0,settle);
      // The same forearm twist seats each shaft through the fingers. Tools
      // use a bent elbow for an upright carry, sword keeps its low guard.
      const gripTwist=toolId==='sword'||uprightGrip?-Math.PI/2:0;
      poseJoint(rig.hand,(a[4]+spellAmount*.46)*alive,a[5]+gripTwist*alive*(1-mountAmount)*(1-carryAmount),a[6],settle);
    }
  }
  function dispose() {
    if(disposed)return; disposed=true;
    for(const g of owned)g.dispose(); owned.clear(); group.clear();
  }
  update(0,0);
  group.name=`${kind}-character`;
  return {group,update,setRole,setTool,dispose};
}
