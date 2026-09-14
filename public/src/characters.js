import * as THREE from 'three';

// Original, articulated stylized actors. Smooth organic surfaces and shaped
// clothing share cached geometry; rigid detail is still merged per joint/material.
const geometryCache = new Map();
const materialCache = new Map();
const TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;
const smooth = t => t * t * (3 - 2 * t);

// Additive shoulder, elbow, wrist, torso, and support-arm poses. Each action
// eases from the current gait through anticipation, contact, and recovery.
// Wrist rotation lets the working end of a tool travel forward at contact.
const REST_ACTION = new Array(12).fill(0);
const ACTION_POSES = {
  axe: [
    [-1.85,-.15,-.20,-.45,-.15,0,-.12,-.035,-.22,-.035,-.38,-.24],
    [-.78,.14,-.06,-.05,1.30,0,.12,.10,.23,.025,-.56,-.16],
    [-.42,.18,.05,.04,.85,0,.16,.07,.16,.015,-.28,-.08],
  ],
  pickaxe: [
    [-2.0,-.05,-.12,-.42,-.10,0,-.08,-.055,-.10,0,-.68,-.36],
    [-.82,.04,-.03,-.04,1.38,0,.05,.16,.10,0,-.72,-.20],
    [-.42,.06,.01,.04,.86,0,.08,.10,.08,0,-.35,-.12],
  ],
  hammer: [
    [-.78,-.06,-.08,-.72,-.23,0,-.05,-.02,-.09,0,-.20,-.12],
    [-.60,.04,-.03,-.12,1.18,0,.03,.065,.09,0,-.27,-.08],
    [-.36,.05,.02,-.04,.58,0,.06,.035,.06,0,-.14,-.05],
  ],
  scythe: [
    [-.40,-.50,-.32,-.26,.88,-.25,.62,.035,-.48,-.035,-.38,-.24],
    [-.55,.45,.22,-.08,1.15,.26,.62,.085,.42,.04,-.58,-.14],
    [-.34,.64,.36,-.02,.87,.36,.48,.06,.55,.035,-.35,-.08],
  ],
  sword: [
    [-1.18,-.26,-.38,-.40,-.18,0,-.35,-.025,-.20,-.025,-.28,-.22],
    [-.86,.28,.23,-.03,1.0,.10,.37,.07,.27,.03,-.47,-.20],
    [-.42,.37,.35,.03,.65,.15,.48,.045,.34,.025,-.22,-.10],
  ],
  bow: [
    [-1.55,-.18,-.1,-.20,.35,0,.05,-.02,-.25,0,-1.1,-1.0],
    [-1.55,.04,-.1,-.05,.32,0,.05,.025,.1,0,-.72,-.35],
    [-1.20,.04,-.08,-.12,.26,0,.04,0,.08,0,-.65,-.45],
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
  else if (type === 'taper') g = new THREE.CylinderGeometry(.8, 1, 1, 12);
  else if (type === 'cone') g = new THREE.ConeGeometry(1, 1, 10);
  else if (type === 'ring') g = new THREE.TorusGeometry(1, .13, 6, 16);
  else if (type === 'cap') g = new THREE.SphereGeometry(1, 16, 8, 0, TAU, 0, Math.PI * .54);
  else if (type === 'softbox') {
    // Rounded corners without adding another model loader or runtime dependency.
    g = new THREE.BoxGeometry(1,1,1,3,3,3);
    const p=g.attributes.position, n=g.attributes.normal;
    const v=new THREE.Vector3(), core=new THREE.Vector3(), normal=new THREE.Vector3();
    for(let i=0;i<p.count;i++) {
      v.fromBufferAttribute(p,i); core.copy(v).clampScalar(-.34,.34);
      normal.copy(v).sub(core).normalize(); v.copy(core).addScaledVector(normal,.16);
      p.setXYZ(i,v.x,v.y,v.z); n.setXYZ(i,normal.x,normal.y,normal.z);
    }
  } else if (type === 'cloth' || type === 'braid') {
    const profile = type==='cloth'
      ? [[0,-.5],[.98,-.5],[1,-.45],[.94,-.27],[.88,0],[.79,.30],[.74,.47],[0,.5]]
      : [[0,-.5],[.30,-.43],[.65,-.27],[.84,-.04],[1,.23],[.84,.42],[0,.5]];
    g = new THREE.LatheGeometry(profile.map(([x,y])=>new THREE.Vector2(x,y)),12);
    if(type==='cloth') {
      const p=g.attributes.position;
      for(let i=0;i<p.count;i++) {
        const y=p.getY(i), angle=Math.atan2(p.getZ(i),p.getX(i));
        const fold=1+.025*Math.cos(angle*6)*(1-(y+.5)*.6);
        p.setX(i,p.getX(i)*fold); p.setZ(i,p.getZ(i)*fold);
      }
      g.computeVertexNormals();
    }
  } else if (type === 'apron') {
    g = new THREE.CylinderGeometry(.83,1,1,12,3,true,-.78,1.56);
  }
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
  for (const child of [...root.children]) if (child.isGroup) mergeRigid(child,owned);
  const batches = new Map();
  for (const child of root.children) if (child.isMesh) {
    if (!batches.has(child.material)) batches.set(child.material,[]);
    batches.get(child.material).push(child);
  }
  for (const [mat, sources] of batches) {
    if (sources.length < 2) continue;
    const positions=[], normals=[];
    for (const source of sources) {
      source.updateMatrix();
      const transformed = source.geometry.clone().applyMatrix4(source.matrix);
      const flat = transformed.index ? transformed.toNonIndexed() : transformed;
      positions.push(...flat.attributes.position.array); normals.push(...flat.attributes.normal.array);
      if (flat !== transformed) flat.dispose(); transformed.dispose(); root.remove(source);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
    g.computeBoundingSphere(); owned.add(g);
    const m = new THREE.Mesh(g,mat); m.castShadow = true; m.receiveShadow = true; root.add(m);
  }
}

function makeTool(id, tier=1) {
  const g = new THREE.Group();
  const wood = material(0x946038), grain=material(0xc69459), grip=material(0x49372c);
  const head = tier >= 3 ? material(0xadc2c6,.7,.35) : tier === 2 ? material(0x8b9695,.08,.95) : material(0xc99963);
  if (id === 'sword') {
    mesh(g,'cylinder',grip,0,0,0,.045,.22,.045);
    mesh(g,'round',grain,0,-.15,0,.065,.065,.06);
    mesh(g,'box',wood,0,.13,0,.32,.07,.09);
    mesh(g,'sword',head,0,.17,-.018);
    mesh(g,'box',grain,0,.45,.047,.015,.51,.012);
  } else if (id === 'axe' || id === 'pickaxe' || id === 'scythe' || id === 'hammer') {
    const height = id === 'scythe' ? 1.32 : .95;
    mesh(g,'cylinder',wood,0,height*.24,0,.037,height,.037,0,0,-.025);
    mesh(g,'cylinder',grip,0,-.08,0,.046,.24,.046);
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
    mesh(g,'cylinder',grip,.28,0,0,.045,.23,.045);
    mesh(g,'cylinder',grain,.10,0,.20,.012,.70,.012,Math.PI/2);
    mesh(g,'cone',head,.10,0,.56,.035,.12,.035,Math.PI/2);
  } else if (id === 'food') {
    mesh(g,'round',material(0xc6863f),0,.08,.03,.17,.1,.32);
    for(let i=0;i<3;i++) mesh(g,'box',material(0xf1c580),0,.17,-.10+i*.11,.19,.018,.02,0,.3,0);
  } else if (id === 'heal' || id === 'staff') {
    const brass=material(0xc3a360,.45,.5), glow=material(0x97eac6,.1,.4,0x438d6b);
    mesh(g,'cylinder',wood,0,.26,0,.033,1.48,.033);
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
  const dark=material(0x302b29), boot=material(0x493831), brass=material(0xc9a25b,.55,.5), iron=material(0x809da2,.65,.45);

  function build() {
    visual.clear();
    for (const g of owned) g.dispose(); owned.clear();
    const zombie=role === 'zombie';
    const body=pivot(visual,0,zombie?1.10:1.04,0);
    const head=pivot(body,0,zombie?.81:.7,zombie?.12:.02);
    const leftArm=pivot(body,zombie?.41:.59,zombie?.4:.30,0);
    const rightArm=pivot(body,zombie?-.41:-.59,zombie?.4:.30,0);
    const leftFore=pivot(leftArm,0,zombie?-.42:-.30,0);
    const rightFore=pivot(rightArm,0,zombie?-.42:-.30,0);
    const hand=pivot(rightFore,0,zombie?-.43:-.31,.035);
    const leftLeg=pivot(body,zombie?.19:.26,zombie?-.28:-.27,0);
    const rightLeg=pivot(body,zombie?-.19:-.26,zombie?-.28:-.27,0);
    const leftShin=pivot(leftLeg,0,zombie?-.41:-.32,0);
    const rightShin=pivot(rightLeg,0,zombie?-.41:-.32,0);
    rig={body,head,leftArm,rightArm,leftFore,rightFore,hand,leftLeg,rightLeg,leftShin,rightShin,zombie};
    attackClock=9; previousAttack=false; spellAmount=0;

    if (zombie) {
      const rot=material([0x7f9770,0x718a6c,0x8b9568,0x6b8e79][variation]);
      const rotDark=material(0x4c6350), cloth=material([0x484852,0x534c42,0x474e43,0x535044][variation]);
      const torn=material(0x303936), bone=material(0xc8c3a1), eye=material(0xe7b568,.1,.4,0xa1571d);
      mesh(body,'round',rot,0,.29,0,.34,.45,.22,0,0,.09);
      mesh(body,'cloth',cloth,0,.0,-.025,.34,.5,.24,0,0,.09);
      mesh(body,'softbox',torn,0,.22,-.2,.48,.42,.055,0,0,.08);
      for(let i=0;i<3;i++) mesh(body,'box',rotDark,-.045,.33-i*.085,.198,.29-i*.025,.018,.018,0,0,-.15);
      for(let i=0;i<4;i++) mesh(body,'cone',cloth,-.23+i*.15,-.32,0,.1,.22+(i%2)*.13,.15,0,0,Math.PI);
      mesh(head,'round',rot,0,0,0,.31,.37,.28,.04,0,-.09);
      mesh(head,'round',rotDark,.19,-.1,.19,.15,.14,.1);
      mesh(head,'round',rot,-.02,-.27,.11,.22,.17,.19,0,0,.12);
      for(const side of [-1,1]) {
        mesh(head,'round',torn,side*.126,.038,.251,.089,.078,.022);
        mesh(head,'round',eye,side*.126,.035,.271,.043,.031,.017);
        mesh(head,'round',rotDark,side*.126,.11,.24,.11,.038,.047,0,0,side*-.17);
        mesh(head,'round',rot,side*.3,-.02,0,.072,.105,.1,0,0,side*.3);
      }
      mesh(head,'chunk',rotDark,0,-.063,.265,.058,.086,.047);
      mesh(head,'softbox',torn,-.012,-.19,.266,.23,.061,.023,0,0,.1);
      for(let i=0;i<4;i++) mesh(head,'box',bone,-.077+i*.046,-.178,.282,.024,.032,.014,0,0,.1);
      for(let i=0;i<3;i++) mesh(head,'cone',torn,-.12+i*.1,.29,-.10,.04,.17,.035,0,0,.35-i*.2);
      for(const [arm,fore,side] of [[leftArm,leftFore,1],[rightArm,rightFore,-1]]) {
        mesh(arm,'round',cloth,0,-.11,0,.16,.24,.16);
        mesh(arm,'taper',rot,0,-.28,0,.10,.35,.11,0,0,side*.05);
        mesh(fore,'taper',rot,0,-.18,0,.077,.39,.08);
        mesh(fore,'round',rot,0,-.42,.02,.105,.12,.07);
        for(let i=0;i<3;i++) mesh(fore,'round',rot,(i-1)*.056,-.5,.08,.022,.084,.022,-.44,0,0);
        mesh(fore,'box',rotDark,side*.038,-.18,.07,.054,.11,.015,0,0,.2);
      }
      for(const [leg,shin,side] of [[leftLeg,leftShin,1],[rightLeg,rightShin,-1]]) {
        mesh(leg,'taper',cloth,0,-.21,0,.135,.43,.14,0,0,side*.025);
        mesh(shin,'taper',rot,0,-.19,0,.08,.43,.083);
        mesh(shin,'round',rotDark,0,-.37,.1,.125,.11,.23);
        mesh(shin,'softbox',cloth,0,-.045,0,.2,.14,.18,0,0,side*.13);
      }
    } else {
      const clothes=material(role==='guard'?0x345e80:role==='priest'?0xd4c7a1:0x3e8882);
      const secondary=material(role==='guard'?0x213e58:role==='priest'?0x687c69:0x275953);
      const leather=material(0x73503a), cream=material(0xe4d6b6);
      mesh(body,'cloth',clothes,0,.04,0,.54,.74,.35);
      mesh(body,'round',role==='guard'?iron:clothes,0,.29,-.015,.55,.38,.35);
      mesh(body,'cylinder',leather,0,-.13,0,.55,.12,.36);
      mesh(body,'softbox',brass,0,-.13,.36,.16,.12,.055);
      mesh(body,'box',dark,0,-.13,.393,.072,.06,.008);
      mesh(body,'softbox',leather,.4,-.15,.23,.18,.22,.13,0,0,-.15);
      mesh(body,'softbox',leather,-.31,-.14,-.29,.23,.24,.15,0,0,.12);
      mesh(body,'box',brass,.4,-.11,.31,.045,.055,.02);
      mesh(body,'apron',secondary,0,-.37,0,.43,.26,.34);
      if(role==='guard') {
        mesh(body,'round',iron,0,.22,.18,.43,.35,.22);
        mesh(body,'ring',iron,0,.49,0,.36,.27,.23,Math.PI/2);
        mesh(body,'box',brass,0,.27,.393,.065,.4,.025);
        mesh(body,'box',brass,0,.28,.399,.23,.06,.025);
        mesh(body,'cloth',secondary,0,-.30,-.18,.49,.46,.18);
        for(const side of [-1,1]) mesh(body,'softbox',iron,side*.32,-.25,.37,.24,.25,.12,0,side*.28,side*.14);
        for(const side of [-1,1]) mesh(body,'round',brass,side*.35,.42,.25,.045,.045,.03);
      } else if(role==='priest') {
        mesh(body,'softbox',secondary,-.23,.08,.31,.14,.75,.052,0,0,-.04);
        mesh(body,'softbox',secondary,.23,.08,.31,.14,.75,.052,0,0,.04);
        mesh(body,'box',brass,0,.21,.367,.035,.14,.025);
        mesh(body,'box',brass,0,.23,.375,.11,.035,.025);
        mesh(body,'cloth',clothes,0,-.47,-.025,.53,.59,.36);
        mesh(body,'cylinder',brass,0,-.75,-.025,.56,.035,.39);
      } else {
        mesh(body,'apron',leather,0,.025,.015,.47,.49,.365);
        mesh(body,'softbox',leather,-.23,.33,.29,.085,.33,.045,0,0,-.17);
        mesh(body,'softbox',leather,.23,.33,.29,.085,.33,.045,0,0,.17);
        mesh(body,'softbox',leather,0,.24,-.337,.075,.47,.045,0,0,-.55);
        mesh(body,'softbox',leather,0,.24,-.339,.075,.47,.045,0,0,.55);
        mesh(body,'box',brass,-.23,.31,.33,.045,.05,.02);
        mesh(body,'box',brass,.23,.31,.33,.045,.05,.02);
        mesh(body,'softbox',secondary,.08,-.05,.373,.22,.17,.025);
      }
      // Soft cheeks, inset eyes, swept moustache, and full tapered beard locks.
      mesh(head,'round',skin,0,.01,0,.39,.37,.32);
      mesh(head,'round',skin,0,-.1,.15,.3,.25,.23);
      for(const side of [-1,1]) {
        mesh(head,'round',skin,side*.37,-.02,0,.115,.14,.10,0,0,side*-.3);
        mesh(head,'round',skin,side*.21,-.08,.24,.12,.11,.095);
        mesh(head,'round',cream,side*.14,.075,.311,.061,.037,.023);
        mesh(head,'round',dark,side*.13,.075,.331,.024,.030,.011);
        mesh(head,'round',cream,side*.13-.008,.087,.340,.008,.010,.006);
        mesh(head,'round',beard,side*.14,.145,.298,.115,.038,.047,0,0,side*-.17);
        mesh(head,'round',beard,side*.12,-.125,.343,.16,.076,.085,0,0,side*.24);
        mesh(head,'braid',beard,side*.28,-.17,.145,.095,.30,.10,0,0,side*-.18);
      }
      mesh(head,'round',skin,0,-.015,.344,.107,.12,.125);
      mesh(head,'round',beard,0,-.255,.17,.31,.24,.20);
      for(let i=0;i<3;i++) {
        const x=(i-1)*.15, length=i===1?.43:.31;
        mesh(head,'braid',beard,x,-.32,.27,.115,length,.105,0,0,-(i-1)*.13);
        mesh(head,'cylinder',brass,x,-.36-length*.18,.278,.061,.05,.059);
        mesh(head,'round',beard,x,-.41-length*.24,.273,.062,.082,.063);
      }
      if(role==='priest') {
        mesh(head,'round',clothes,0,.08,-.18,.5,.46,.28);
        mesh(head,'ring',clothes,0,.06,.025,.45,.45,.27);
        mesh(head,'ring',brass,0,.06,.068,.365,.369,.18);
      } else if(role==='guard') {
        mesh(head,'cap',iron,0,.19,-.005,.44,.37,.37);
        mesh(head,'ring',brass,0,.21,-.005,.425,.35,.35,Math.PI/2);
        mesh(head,'softbox',brass,0,.31,.342,.07,.28,.055);
        for(const side of [-1,1]) mesh(head,'softbox',iron,side*.34,-.055,.11,.09,.3,.19,0,0,side*-.12);
        mesh(head,'round',secondary,0,.50,-.045,.060,.19,.21);
        mesh(head,'softbox',brass,0,.42,-.045,.13,.045,.39);
      } else {
        mesh(head,'cap',leather,0,.19,-.01,.40,.31,.34);
        mesh(head,'cylinder',secondary,0,.20,-.01,.41,.08,.35);
        mesh(head,'round',leather,0,.19,.28,.31,.035,.20,-.11,0,0);
        mesh(head,'box',brass,.2,.215,.293,.08,.09,.032,0,.25,0);
      }
      for(const [arm,fore,side] of [[leftArm,leftFore,1],[rightArm,rightFore,-1]]) {
        mesh(arm,'round',clothes,0,-.075,0,.235,.25,.235);
        mesh(arm,'taper',clothes,0,-.19,0,.17,.34,.17);
        if(role==='guard') {
          mesh(arm,'cap',iron,0,.01,0,.29,.20,.29,0,0,side*.2);
          mesh(arm,'cylinder',brass,0,.01,0,.275,.04,.26,0,0,side*.2);
        }
        mesh(fore,'taper',skin,0,-.115,0,.145,.30,.14);
        mesh(fore,'cylinder',role==='priest'?cream:leather,0,-.21,0,.16,.14,.15);
        mesh(fore,'round',skin,0,-.32,.026,.16,.14,.15);
        mesh(fore,'round',skin,-side*.11,-.30,.115,.066,.073,.065);
      }
      if(role==='guard') {
        const shield=pivot(leftFore,.06,-.1,.22);
        mesh(shield,'shield',brass,0,0,0);
        mesh(shield,'shield',secondary,0,.018,.078,.87,.85,.38);
        mesh(shield,'box',brass,0,.02,.133,.06,.43,.025);
        mesh(shield,'box',brass,0,.07,.136,.27,.055,.025);
        mesh(shield,'round',iron,0,.045,.15,.075,.075,.04);
      }
      for(const [leg,shin] of [[leftLeg,leftShin],[rightLeg,rightShin]]) {
        mesh(leg,'taper',secondary,0,-.16,0,.21,.32,.22);
        mesh(shin,'taper',boot,0,-.12,0,.22,.31,.23);
        mesh(shin,'round',boot,0,-.28,.10,.235,.15,.34);
        mesh(shin,'softbox',dark,0,-.34,.12,.40,.075,.51);
        mesh(shin,'cylinder',leather,0,-.005,0,.23,.08,.23);
        mesh(shin,'box',brass,0,-.04,.235,.06,.065,.025);
      }
    }
    mergeRigid(visual,owned);
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
    // Keep held equipment clear of the forearm and visibly outside the silhouette.
    heldTool.position.set(-.065,0,.10);
    heldTool.rotation.set(.65,0,id==='sword'?.40:id==='staff'||id==='heal'?.16:.28);
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
      poseJoint(rig.rightFore,(-.14+a[3]-spellAmount*.18-.6*carryAmount-.35*mountAmount)*alive,0,0,settle);
      poseJoint(rig.hand,(a[4]+spellAmount*.46)*alive,a[5],a[6],settle);
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
