import * as THREE from 'three';
import { buildBody } from './character-body.js';
import { buildHead } from './character-head.js';
import { buildClothing } from './character-clothing.js';
import { sampleLegGait, runningBlend } from './locomotion.js';
import { createMusketModel } from './musket-model.js';

// Original sculpted characters: continuous skin, shaped faces and tailored
// garments deform around the existing gameplay rig. Tools retain rigid batching.
const geometryCache = new Map();
const materialCache = new Map();
const backpackCache = new Map();
const TAU = Math.PI * 2;
// These named surfaces must remain independently hideable when live equipment
// replaces hair or a role's hat. Face, eye and beard detail can still be batched.
const REMOVABLE_HEAD_COVERS = new Set(['swept grooved scalp hair','forged helmet and cheek protection','rolled helmet edge','draped linen hood','cloth opening seam','soft stitched leather cap']);
const clamp = THREE.MathUtils.clamp;
const smooth = t => t * t * (3 - 2 * t);

// Additive shoulder, elbow, wrist, torso, and support-arm poses. Each action
// eases from the current gait through anticipation, contact, and recovery.
// Wrist rotation lets the working end of a tool travel forward at contact.
const WORK_TOOLS = new Set(['axe','pickaxe','hammer','scythe']);
const UPRIGHT_TOOLS = new Set([...WORK_TOOLS,'bow','musket','staff','heal']);
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
  for (const child of root.children) if (child.isMesh && !child.isSkinnedMesh && !child.userData.tailored && !child.userData.removableEquipment) {
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

function makeTool(id, tier=1, element='fire') {
  if(id==='musket')return createMusketModel();
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
    const tint=element==='lightning'?[0xc4aeff,0x7753ce]:element==='frost'?[0x9de8ff,0x3b8bae]:[0xffb064,0xd85c20];
    const brass=material(0xc3a360,.45,.5), glow=id==='staff'?material(tint[0],.1,.4,tint[1]):material(0x97eac6,.1,.4,0x438d6b);
    mesh(g,'cylinder',wood,0,.26,0,.031,1.48,.031);
    mesh(g,'cylinder',brass,0,.81,0,.045,.14,.045);
    mesh(g,'ring',brass,0,1.02,0,.16,.2,.16);
    mesh(g,'chunk',glow,0,1.02,0,.072,.11,.072);
    mesh(g,'cone',brass,0,1.24,0,.055,.11,.055);
  }
  return g;
}

// Soft baggage is modeled from curved sewn panels, rather than boxes strapped
// to the torso. A small cached template per tier/armor fit is shared by actors;
// equipping a pack never rebuilds the skinned body or allocates per-frame meshes.
function makeBackpack(tier, armored=false) {
  const key=`${tier}/${armored}`;
  if(backpackCache.has(key))return backpackCache.get(key).clone(true);
  const root=new THREE.Group(), resources=new Set();
  root.name='worn-backpack';root.userData.backpackTier=tier;
  const canvas=material(tier===1?0x886044:tier===2?0x69704d:0x465f62,0,.97);
  const leather=material(0x684833,0,.86),edging=material(0xb39366,0,.90);
  const brass=material(0xb8934d,.55,.47),bedroll=material(0x84917b,0,.98);
  // Double-sided panels retain their sewn edges from both shoulder views.
  const panelLeather=new THREE.MeshStandardMaterial({color:0x78523a,roughness:.9,side:THREE.DoubleSide});
  const width=[0,.48,.58,.64][tier],height=[0,.56,.68,.77][tier],depth=[0,.24,.30,.36][tier];
  const centerY=tier===1?.09:.08,centerZ=-.29-depth/2-(armored?.035:0);
  const add=(g,mat,x=0,y=0,z=0)=>{
    resources.add(g);const m=new THREE.Mesh(g,mat);m.position.set(x,y,z);
    m.castShadow=m.receiveShadow=true;root.add(m);return m;
  };
  const surface=(rows,columns,sample,reverse=false)=>{
    const p=[],uv=[],ix=[];
    for(let row=0;row<=rows;row++)for(let col=0;col<=columns;col++) {
      const u=col/columns,v=row/rows;p.push(...sample(u,v));uv.push(u,v);
    }
    for(let row=0;row<rows;row++)for(let col=0;col<columns;col++) {
      const a=row*(columns+1)+col,b=a+columns+1;
      if(reverse)ix.push(a,b,a+1,a+1,b,b+1);else ix.push(a,a+1,b,a+1,b+1,b);
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(ix);g.computeVertexNormals();g.computeBoundingSphere();return g;
  };
  const sack=(w,h,d,phase=0)=>surface(20,32,(u,v)=>{
    const angle=u*TAU,round=Math.pow(Math.max(.0001,Math.sin(v*Math.PI)),.30);
    const gathered=1-.13*Math.exp(-Math.pow((v-.91)/.08,2));
    const folds=1+.025*Math.sin(angle*7+v*5+phase)*Math.sin(v*Math.PI);
    const ca=Math.cos(angle),sa=Math.sin(angle);
    return [Math.sign(ca)*Math.pow(Math.abs(ca),.78)*w*.5*round*gathered*folds,(v-.5)*h,
      Math.sign(sa)*Math.pow(Math.abs(sa),.83)*d*.5*round*folds];
  },true);
  const line=(points,radius,mat,closed=false)=>{
    const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)),closed,'centripetal');
    return add(new THREE.TubeGeometry(curve,Math.max(12,points.length*2),radius,6,closed),mat);
  };
  const strap=(points,w=.065,mat=leather)=>{
    const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));
    const sample=(u,v)=>{
      const p=curve.getPoint(v),t=curve.getTangent(v);
      let across=new THREE.Vector3(1,0,0).addScaledVector(t,-t.x);
      if(across.lengthSq()<.05)across=new THREE.Vector3(0,1,0).addScaledVector(t,-t.y);
      across.normalize();return p.addScaledVector(across,(u-.5)*w).toArray();
    };
    const m=add(surface(30,3,sample),mat);m.material=mat===leather?panelLeather:mat;
    for(const edge of [.08,.92])line(Array.from({length:14},(_,i)=>sample(edge,i/13)),.0025,edging);
  };
  const buckle=(x,y,z)=>{
    mesh(root,'ring',brass,x,y,z,.028,.038,.026);
    mesh(root,'box',brass,x,y,z-.003,.007,.053,.009);
  };
  add(sack(width,height,depth,tier),canvas,0,centerY,centerZ);
  const top=centerY+height*.44,rear=centerZ-depth*.5-.008;
  // A curved leather flap folds over the gathered opening and hangs down the
  // outward-facing panel. Its hem bows slightly between the closing straps.
  add(surface(12,24,(u,v)=>{
    const across=u*2-1;
    return [across*width*.47*(1-.07*v),top-v*height*.34-(1-across*across)*.025*v,
      rear+.10*(1-v)*(1-v)+.035*across*across-.014*Math.sin(v*Math.PI)];
  }),panelLeather);
  line(Array.from({length:17},(_,i)=>{const a=i/8-1;return [a*width*.437,top-height*.34-(1-a*a)*.025,rear+.035*a*a-.002];}),.003,edging);
  for(const side of [-1,1]) {
    const x=side*width*.24;
    strap([[x,top-.025,rear+.02],[x,top-.16,rear-.023],[x,top-height*.40,rear-.02]],.037);
    buckle(x,top-height*.32,rear-.034);
    // Shoulder webbing runs from the bag, over the shirt and down the chest;
    // the armored fit clears the guard's breastplate and back plate.
    const front=armored?.27:.23;
    strap([[side*.22,-.14,-.30],[side*.25,.20,-.285],[side*.27,.43,-.16],
      [side*.27,.485,-.035],[side*.25,.44,.12],[side*.23,.26,front],
      [side*.235,.06,front],[side*.28,-.13,.19],[side*.35,-.19,.04],
      [side*.31,-.13,-.25]],tier===1?.052:.067);
    buckle(side*.235,.12,front+.01);
  }
  if(tier>=2) {
    for(const side of [-1,1]) {
      const x=side*(width*.5+.055);
      add(sack(tier===3?.17:.14,.29,.18,side),leather,x,-.025,centerZ+.015);
      line([[x-.04,.08,centerZ-.075],[x,.055,centerZ-.085],[x+.04,.08,centerZ-.075]],.003,edging);
      buckle(x,.028,centerZ-.085);
    }
    // Leather base reinforcement follows the lower sack instead of forming a
    // separate rigid crate under it.
    add(surface(7,32,(u,v)=>{
      const a=u*TAU,y=-height*.48+v*height*.15,r=Math.pow(Math.sin((.02+v*.15)*Math.PI),.30);
      return [Math.sign(Math.cos(a))*Math.pow(Math.abs(Math.cos(a)),.78)*(width*.5+.004)*r,
        centerY+y,centerZ+Math.sign(Math.sin(a))*Math.pow(Math.abs(Math.sin(a)),.83)*(depth*.5+.004)*r];
    },true),leather);
  }
  if(tier===3) {
    const rollY=top+.105,rollZ=centerZ+.015;
    const roll=add(new THREE.CapsuleGeometry(.096,.57,5,20),bedroll,0,rollY,rollZ);
    roll.rotation.z=Math.PI/2;
    for(const side of [-1,1]) {
      for(const r of [.064,.042,.021]) {
        const seam=add(new THREE.TorusGeometry(r,.0035,5,20),edging,side*.379,rollY,rollZ);
        seam.rotation.y=Math.PI/2;
      }
      line(Array.from({length:16},(_,i)=>[side*.19,rollY+Math.cos(i/16*TAU)*.101,rollZ+Math.sin(i/16*TAU)*.101]),.014,leather,true);
    }
  }
  mergeRigid(root,resources);
  backpackCache.set(key,root);
  return root.clone(true);
}

export function createCharacter(kind='villager', seed=1, { equipmentPreview=false }={}) {
  const group = new THREE.Group();
  const visual = pivot(group);
  const owned = new Set();
  let rig, clothing, clothingColor=null, role=kind, toolId='', toolTier=1, toolElement='fire', heldTool, backpackTier=0, backpack=null, attackClock=9, previousAttack=false, previousShot, disposed=false;
  let walkPhase=(Number(seed)||1)*1.173, idleTime=0, downAmount=0, moveAmount=0, motionSpeed=0, spellAmount=0, mountAmount=0, carryAmount=0, turnAmount=0;
  const actionOffsets = new Float64Array(12);
  const leftStep=new Float64Array(3),rightStep=new Float64Array(3),stepScratch=new Float64Array(3);
  const soleMatrix=new THREE.Matrix4(),solePoint=new THREE.Vector3();
  const armDirection=new THREE.Vector3(),elbowOffset=new THREE.Vector3(),elbowPoint=new THREE.Vector3(),foreDirection=new THREE.Vector3();
  const downAxis=new THREE.Vector3(0,-1,0),foreTip=new THREE.Vector3(),armRotation=new THREE.Quaternion(),foreRotation=new THREE.Quaternion(),inverseRotation=new THREE.Quaternion();
  const musketRotation=new THREE.Quaternion(),musketEuler=new THREE.Euler(),handTarget=new THREE.Vector3(),supportTarget=new THREE.Vector3();
  const rightPole=new THREE.Vector3(-.65,-.16,.10),leftPole=new THREE.Vector3(.56,-.12,.25);

  // Solve the two arm segments toward a fixed grip/support point. This keeps
  // the off hand under the barrel while the body turns into a shouldered stance.
  // All scratch vectors are reused; no per-frame geometry or materials are made.
  function aimArm(upper,fore,target,pole,tip,amount) {
    armDirection.copy(target).sub(upper.position);
    const upperLength=fore.position.length(),foreLength=tip.length();
    const distance=clamp(armDirection.length(),Math.abs(upperLength-foreLength)+.001,upperLength+foreLength-.001);
    armDirection.normalize();
    const along=(upperLength*upperLength+distance*distance-foreLength*foreLength)/(2*distance);
    elbowOffset.copy(pole).sub(upper.position).addScaledVector(armDirection,-elbowOffset.dot(armDirection)).normalize();
    elbowPoint.copy(upper.position).addScaledVector(armDirection,along).addScaledVector(elbowOffset,Math.sqrt(Math.max(0,upperLength*upperLength-along*along)));
    foreDirection.copy(elbowPoint).sub(upper.position).normalize();
    armRotation.setFromUnitVectors(downAxis,foreDirection);
    inverseRotation.copy(armRotation).invert();
    foreDirection.copy(target).sub(elbowPoint).normalize().applyQuaternion(inverseRotation);
    foreTip.copy(tip).normalize();foreRotation.setFromUnitVectors(foreTip,foreDirection);
    upper.quaternion.slerp(armRotation,amount);fore.quaternion.slerp(foreRotation,amount);
  }

  function removeHeldTool() {
    if(!heldTool)return;
    heldTool.removeFromParent();
    if(heldTool.userData.dispose)heldTool.userData.dispose();
    else heldTool.traverse(n=>{if(n.isMesh&&owned.delete(n.geometry))n.geometry.dispose();});
    heldTool=null;
  }

  function groundedHeight() {
    // Measure sole corners through the actual eased joints, so extra knee and
    // ankle articulation does not push the boots into the floor. This only
    // adjusts the cosmetic body; network position and collision stay unchanged.
    rig.body.updateMatrix(); rig.pelvis.updateMatrix();
    let lowest=Infinity;
    for(const [leg,shin,foot] of [[rig.leftLeg,rig.leftShin,rig.leftFoot],[rig.rightLeg,rig.rightShin,rig.rightFoot]]) {
      leg.updateMatrix();shin.updateMatrix();foot.updateMatrix();
      soleMatrix.makeRotationFromEuler(rig.body.rotation).multiply(rig.pelvis.matrix).multiply(leg.matrix).multiply(shin.matrix).multiply(foot.matrix);
      for(const x of [-.14,.14])for(const z of [-.135,.316]) {
        solePoint.set(x,-.152,z).applyMatrix4(soleMatrix);lowest=Math.min(lowest,solePoint.y);
      }
    }
    return .018-lowest;
  }
  const variation = Math.abs(Math.trunc(Number(seed)||1)) % 4;
  const skin = material([0xdba779,0xc38d65,0xe9bc8e,0xa87354][variation]);
  const beard = material([0x6b4029,0x9a6137,0xc6a77d,0x4b3730][variation]);
  const dark=material(0x302b29), brass=material(0xc9a25b,.55,.5), iron=material(0x809da2,.65,.45);

  function build() {
    removeHeldTool();
    visual.clear();
    for (const resource of owned) resource.dispose(); owned.clear();
    const zombie=role === 'zombie';
    const bone=(parent,x=0,y=0,z=0)=>{const b=new THREE.Bone();b.position.set(x,y,z);parent.add(b);return b;};
    const body=bone(visual,0,zombie?1.10:1.04,0);
    const pelvis=bone(body);
    const head=bone(body,0,zombie?.81:.76,.01);
    const leftArm=bone(body,zombie?.35:.48,.36,0),rightArm=bone(body,zombie?-.35:-.48,.36,0);
    const leftFore=bone(leftArm,0,-.34,0),rightFore=bone(rightArm,0,-.34,0);
    const hand=bone(rightFore,0,-.30,.035);
    const leftLeg=bone(pelvis,zombie?.17:.21,-.27,0),rightLeg=bone(pelvis,zombie?-.17:-.21,-.27,0);
    const leftShin=bone(leftLeg,0,-.35,0),rightShin=bone(rightLeg,0,-.35,0);
    const leftFoot=bone(leftShin,0,-.25,.015),rightFoot=bone(rightShin,0,-.25,.015);
    rig={body,pelvis,head,leftArm,rightArm,leftFore,rightFore,hand,leftLeg,rightLeg,leftShin,rightShin,leftFoot,rightFoot,zombie};
    for(const [name,joint] of Object.entries(rig))if(joint?.isBone)joint.name=name;
    attackClock=9; previousAttack=false; previousShot=undefined; spellAmount=0;
    const clothes=material(role==='guard'?0x364b5e:role==='priest'?0xb6ab91:role==='wizard'?0x705281:role==='manager'?0x44667a:role==='tinker'?0x88633e:role==='zombie'?0x50584f:0x4d6456);
    const actualSkin=zombie?material([0x87917b,0x7d8a79,0x93917a,0x738779][variation],0,.92):skin;
    const palette={skin:actualSkin,hair:beard,cloth:clothes,leather:material(0x66503a),iron,brass,dark};
    buildBody(visual,rig,{skin:actualSkin,own:owned});
    buildHead(head,{role,variation,palette,own:owned});
    clothing=buildClothing(rig,{role,variation,palette,own:owned});
    if(clothingColor)clothing.setColor(clothingColor);
    // Preserve just removable coverings in live rigs; the studio additionally
    // keeps individual facial surfaces for its inspection tools.
    if(!zombie)head.traverse(object=>{if(object.isMesh&&REMOVABLE_HEAD_COVERS.has(object.name))object.userData.removableEquipment=true;});
    if(equipmentPreview) head.traverse(object=>{if(object.isMesh)object.userData.tailored=true;});
    mergeRigid(visual,owned);
    if(role==='guard') {
      const shield=pivot(leftFore,.045,-.12,.20);
      shield.name='guard-shield';
      mesh(shield,'shield',brass,0,0,0,.90,.94,1);
      mesh(shield,'shield',clothes,0,.018,.078,.78,.80,.38);
      mesh(shield,'box',brass,0,.02,.133,.045,.38,.022);
      mesh(shield,'box',brass,0,.07,.136,.23,.040,.022);
      mesh(shield,'round',iron,0,.045,.15,.065,.065,.035);
      mergeRigid(shield,owned);
    }
    toolId=''; heldTool=null;
    if(!zombie) setTool(role==='priest'?'heal':role==='wizard'?'staff':'sword');
    backpack=null;
    if(backpackTier>0&&!zombie){backpack=makeBackpack(backpackTier,role==='guard');rig.body.add(backpack);}
  }

  function setTool(tool) {
    let id=typeof tool==='object'&&tool ? tool.id : tool;
    const tier=typeof tool==='object'&&tool ? Number(tool.tier)||1 : 1;
    const element=typeof tool==='object'&&['fire','frost','lightning'].includes(tool?.element)?tool.element:'fire';
    id=id||'';
    if(rig.zombie || (id===toolId && tier===toolTier && (id!=='staff'||element===toolElement))) return;
    removeHeldTool();
    toolId=id; toolTier=tier; toolElement=element;
    const shield=rig.leftFore.getObjectByName('guard-shield');
    if(shield)shield.visible=id!=='bow'&&id!=='musket';
    heldTool=makeTool(id,tier,element);
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
    if(id!=='musket')mergeRigid(heldTool,owned);
  }
  function setRole(next) {
    if(!['villager','guard','priest','manager','tinker','wizard','zombie'].includes(next) || next===role) return;
    const previousTool=toolId, previousTier=toolTier;
    role=next; build();
    if(previousTool && next!=='zombie') setTool({id:previousTool,tier:previousTier});
  }
  function setBackpackTier(value) {
    if(disposed)return;
    const next=Number.isInteger(value)&&value>=0&&value<=3?value:0;
    if(next===backpackTier)return;
    backpackTier=next;
    if(backpack)backpack.removeFromParent();
    backpack=null;
    if(next>0&&!rig.zombie){backpack=makeBackpack(next,role==='guard');rig.body.add(backpack);}
  }
  function setClothingColor(value) {
    if(disposed)return;
    const next=typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value)?value.toLowerCase():null;
    if(next===clothingColor)return;
    clothingColor=next;clothing?.setColor(next);
  }
  build();

  function update(dt,time, options={}) {
    if(disposed) return;
    const {moving=false,speed=5.4,turnRate=0,attack=false,shot,downed=false,tool,channeling=false,mounted=false,carrying=false,tier=1,staffElement='fire',backpackTier:requestedBackpackTier}=options;
    dt=clamp(Number(dt)||0,0,.1);
    idleTime+=dt;
    if(tool!==undefined) setTool(typeof tool==='object'?tool:{id:tool,tier,element:staffElement});
    if(requestedBackpackTier!==undefined)setBackpackTier(requestedBackpackTier);
    if(heldTool) heldTool.visible=!mounted&&!carrying;
    mountAmount+=((mounted&&!downed?1:0)-mountAmount)*(1-Math.exp(-dt*12));
    carryAmount+=((carrying&&!downed?1:0)-carryAmount)*(1-Math.exp(-dt*12));
    const musket=toolId==='musket',duration=rig.zombie?1.30:musket?.72:.54;
    const shotAt=shot?.at??shot?.firedAt;
    const shotKey=shot?.kind==='musket'&&shot.id!=null&&Number.isFinite(shotAt)?`${shot.id}/${shotAt}`:null;
    const newShot=previousShot!==undefined&&shotKey!==null&&shotKey!==previousShot;
    previousShot=shotKey;
    const newAttack=typeof attack==='number' ? attack>0 && attack!==previousAttack : musket&&shot!==undefined?newShot:attack&&!previousAttack;
    const repeatAttack=!musket&&attack===true && attackClock>=duration+.06;
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
    turnAmount+=((Number.isFinite(turnRate)?clamp(turnRate,-3,3):0)-turnAmount)*(1-Math.exp(-dt*8));
    downAmount+=((downed?1:0)-downAmount)*(1-Math.exp(-dt*8));
    walkPhase=(walkPhase+strideDistance*(rig.zombie?4.1:9.0)/nominalSpeed)%TAU;
    const s=Math.sin(walkPhase), c=Math.cos(walkPhase), breath=Math.sin(idleTime*2.2+variation);
    const stride=moveAmount*clamp(motionSpeed/nominalSpeed,.45,1.15);
    const running=rig.zombie?0:runningBlend(motionSpeed);
    const stepRise=(1-Math.cos(walkPhase*2))*.5;
    const casting=toolId==='heal'||toolId==='staff';
    const spellTarget=!downed && casting && (channeling || attack===true || attackClock<.54) ? 1 : 0;
    spellAmount+=(spellTarget-spellAmount)*(1-Math.exp(-dt*(spellTarget?9:7)));
    const active=!casting && attackClock<duration && !downed;
    actionOffsets.fill(0);
    if(active&&!musket) actionPose(ACTION_POSES[rig.zombie?'zombie':toolId]||ACTION_POSES.sword,attackClock/duration,actionOffsets);
    const a=actionOffsets, alive=1-downAmount,musketReady=musket&&!downed&&!mounted&&!carrying;
    const attackWeight=active?Math.sin(Math.PI*clamp(attackClock/duration,0,1)):0;
    const armStride=stride*(1-attackWeight*.85)*(1-spellAmount*.85);
    const gaitStrength=stride*(1-mountAmount)*(1-downAmount);
    sampleLegGait(walkPhase,gaitStrength, running,leftStep,stepScratch);
    sampleLegGait(walkPhase+Math.PI,gaitStrength, running,rightStep,stepScratch);
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
      // Unequal steps and delayed shoulders retain a dragging zombie gait,
      // while elbows, knees and ankles now move instead of a rigid shuffle.
      poseJoint(rig.body,.17+s*.045*stride+a[7],s*.075*stride+a[8],.065+s*.065*stride+a[9],settle);
      poseJoint(rig.pelvis,-.10*stride,-s*.13*stride,-s*.035*stride,settle);
      poseJoint(rig.head,-.09+breath*.020-a[7]*.35,c*.07*stride,.10+Math.sin(idleTime*1.4+variation)*.025,settle);
      poseJoint(rig.leftLeg,leftStep[0]*.70,0,.015*stride,settle);
      poseJoint(rig.rightLeg,rightStep[0]*.85,0,-.015*stride,settle);
      poseJoint(rig.leftShin,.08+leftStep[1]*.55,0,0,settle);
      poseJoint(rig.rightShin,.06+rightStep[1]*.75,0,0,settle);
      poseJoint(rig.leftFoot,-leftStep[0]*.70-leftStep[1]*.55-.06,.015*stride,0,settle);
      poseJoint(rig.rightFoot,-rightStep[0]*.85-rightStep[1]*.75-.04,-.015*stride,0,settle);
      poseJoint(rig.leftArm,(-.50+Math.sin(walkPhase-.45)*.19*armStride+a[10])*alive,s*.05*stride,.10+breath*.025,settle);
      poseJoint(rig.rightArm,(-.75-Math.sin(walkPhase+.20)*.23*armStride+a[0])*alive,a[1]-s*.055*stride,-.12+a[2],settle);
      poseJoint(rig.leftFore,(-.14-breath*.025-.24*(.5+.5*c)*armStride+a[11])*alive,0,.025*stride,settle);
      poseJoint(rig.rightFore,(-.18+breath*.030-.32*(.5-.5*c)*armStride+a[3])*alive,0,-.035*stride,settle);
      rig.body.position.x=s*.030*stride*alive;
      const height=1.10+(groundedHeight()-1.10)*moveAmount;
      rig.body.position.y=height+(breath*.009)*alive*(1-moveAmount);
    } else {
      const counter=s*stride, lean=turnAmount*stride*.025;
      if(!musketReady)poseJoint(rig.body,(.055+.10*running)*stride+a[7],counter*.095+a[8],-counter*.025-lean+a[9],settle);
      poseJoint(rig.pelvis,-.035*stride,-counter*.17,counter*.04,settle);
      if(!musketReady)poseJoint(rig.head,-.025+breath*.01-a[7]*.45-spellAmount*.08-.035*running*stride,-counter*.07-a[8]*.28+turnAmount*.035,downAmount*.20+lean*.6,settle);
      poseJoint(rig.leftLeg,leftStep[0]-1.10*mountAmount,0,.015*stride-.40*mountAmount,settle);
      poseJoint(rig.rightLeg,rightStep[0]-1.10*mountAmount,0,-.015*stride+.40*mountAmount,settle);
      poseJoint(rig.leftShin,leftStep[1]*(1-mountAmount)+.80*mountAmount,0,0,settle);
      poseJoint(rig.rightShin,rightStep[1]*(1-mountAmount)+.80*mountAmount,0,0,settle);
      poseJoint(rig.leftFoot,leftStep[2]*(1-mountAmount)+.22*mountAmount,0,0,settle);
      poseJoint(rig.rightFoot,rightStep[2]*(1-mountAmount)+.22*mountAmount,0,0,settle);
      const leftSwing=c*(role==='guard'?.30:.46)*(1+running*.35)*armStride;
      const rightSwing=-c*(toolId?.30:.46)*(1+running*.35)*armStride;
      const armsFree=(1-mountAmount)*(1-carryAmount);
      poseJoint(rig.leftArm,(leftSwing*armsFree-.06+a[10]-spellAmount*.70-.9*carryAmount-.65*mountAmount)*alive,spellAmount*.14-counter*.035,.09+spellAmount*.08+running*.06*stride,settle);
      poseJoint(rig.rightArm,(rightSwing*armsFree-.12+a[0]-spellAmount*.65-.9*carryAmount-.65*mountAmount)*alive,a[1]+counter*.035,-.10+a[2]-spellAmount*.08-running*.06*stride,settle);
      const leftElbow=(.25*(.5-.5*c)+running*.50)*armStride*armsFree;
      poseJoint(rig.leftFore,(-.13-leftElbow+a[11]-spellAmount*.32-.6*carryAmount-.35*mountAmount)*alive,0,0,settle);
      const uprightGrip=UPRIGHT_TOOLS.has(toolId);
      const elbowRest=-.14-(uprightGrip?1.26*(1-mountAmount)*(1-carryAmount):0);
      const rightElbow=(uprightGrip?.10*(.5+.5*c):.25*(.5+.5*c)+running*.50)*armStride*armsFree;
      poseJoint(rig.rightFore,(elbowRest-rightElbow+a[3]-spellAmount*.18-.6*carryAmount-.35*mountAmount)*alive,0,0,settle);
      // The same forearm twist seats each shaft through the fingers. Tools
      // use a bent elbow for an upright carry, sword keeps its low guard.
      const gripTwist=toolId==='sword'||uprightGrip?-Math.PI/2:0;
      poseJoint(rig.hand,(a[4]+spellAmount*.46)*alive,a[5]+gripTwist*alive*(1-mountAmount)*(1-carryAmount),a[6],settle);
      if(musketReady) {
        const recoil=active?Math.sin(Math.PI*clamp(attackClock/.18,0,1))*Math.exp(-attackClock*5):0;
        // Turn the shoulders side-on so the stock reaches the right shoulder
        // and the left arm can support the forestock without stretching.
        poseJoint(rig.body,.04*stride-recoil*.045,-.90+counter*.025,-lean,settle);
        poseJoint(rig.head,-.025+breath*.008,.90,0,settle);
        musketEuler.set(0,.90-Math.PI/2,recoil*.07,'YXZ');musketRotation.setFromEuler(musketEuler);
        handTarget.copy(heldTool.position).applyQuaternion(musketRotation).multiplyScalar(-1);
        handTarget.x-=.10;handTarget.y+=.25;handTarget.z+=.20-recoil*.035;
        aimArm(rig.rightArm,rig.rightFore,handTarget,rightPole,rig.hand.position,1);
        // The left skin uses the forearm bone through its curled fingertips.
        supportTarget.set(.198,.23,.436-recoil*.035);foreTip.set(0,-.424,.085);
        aimArm(rig.leftArm,rig.leftFore,supportTarget,leftPole,foreTip,1);
        inverseRotation.copy(rig.rightArm.quaternion).multiply(rig.rightFore.quaternion).invert();
        rig.hand.quaternion.copy(inverseRotation.multiply(musketRotation));
      }
      rig.body.position.x=counter*.020*alive;
      const groundBlend=moveAmount*(1-mountAmount)*(1-downAmount);
      rig.body.position.y=1.04+(groundedHeight()-1.04)*groundBlend+breath*.008*alive*(1-moveAmount)+stepRise*.028*running*stride;
    }
  }
  function dispose() {
    if(disposed)return; disposed=true;
    removeHeldTool();
    for(const g of owned)g.dispose(); owned.clear(); group.clear();
  }
  update(0,0);
  group.name=`${kind}-character`;
  return {group,update,setRole,setTool,setBackpackTier,setClothingColor,dispose};
}
