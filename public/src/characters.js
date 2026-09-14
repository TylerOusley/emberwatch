import * as THREE from 'three';

// Original, articulated low-poly actors. Static detail is merged per joint/material;
// shared source meshes and palette materials are reused between all inhabitants.
const geometryCache = new Map();
const materialCache = new Map();
const TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;
function material(color, metalness = 0, roughness = .8, emissive = 0) {
  const key = `${color}/${metalness}/${roughness}/${emissive}`;
  if (!materialCache.has(key)) materialCache.set(key, new THREE.MeshStandardMaterial({ color, metalness, roughness, flatShading: true, emissive, emissiveIntensity: emissive ? .65 : 0 }));
  return materialCache.get(key);
}
function geometry(type) {
  if (geometryCache.has(type)) return geometryCache.get(type);
  let g;
  if (type === 'round') g = new THREE.IcosahedronGeometry(1, 1);
  else if (type === 'chunk') g = new THREE.IcosahedronGeometry(1, 0);
  else if (type === 'cylinder') g = new THREE.CylinderGeometry(1, 1, 1, 8);
  else if (type === 'taper') g = new THREE.CylinderGeometry(.8, 1, 1, 8);
  else if (type === 'cone') g = new THREE.ConeGeometry(1, 1, 7);
  else if (type === 'ring') g = new THREE.TorusGeometry(1, .13, 4, 10);
  else if (type === 'cap') g = new THREE.SphereGeometry(1, 10, 5, 0, TAU, 0, Math.PI * .54);
  else if (type === 'cloth') g = new THREE.CylinderGeometry(.74, 1, 1, 8);
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
  let walkPhase=(Number(seed)||1)*1.173, downAmount=0, moveAmount=0;
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

    if (zombie) {
      const rot=material([0x7f9770,0x718a6c,0x8b9568,0x6b8e79][variation]);
      const rotDark=material(0x4c6350), cloth=material([0x484852,0x534c42,0x474e43,0x535044][variation]);
      const torn=material(0x303936), bone=material(0xc8c3a1), eye=material(0xe7b568,.1,.4,0xa1571d);
      mesh(body,'round',rot,0,.29,0,.34,.45,.22,0,0,.09);
      mesh(body,'cloth',cloth,0,.0,-.025,.34,.5,.24,0,0,.09);
      mesh(body,'box',torn,0,.22,-.2,.48,.42,.055,0,0,.08);
      for(let i=0;i<3;i++) mesh(body,'box',rotDark,-.045,.33-i*.085,.198,.29-i*.025,.018,.018,0,0,-.15);
      for(let i=0;i<4;i++) mesh(body,'cone',cloth,-.23+i*.15,-.32,0,.1,.22+(i%2)*.13,.15,0,0,Math.PI);
      mesh(head,'round',rot,0,0,0,.31,.37,.28,.04,0,-.09);
      mesh(head,'chunk',rotDark,.19,-.1,.19,.15,.14,.1);
      mesh(head,'round',rot,-.02,-.27,.11,.22,.17,.19,0,0,.12);
      for(const side of [-1,1]) {
        mesh(head,'round',torn,side*.126,.038,.251,.089,.078,.022);
        mesh(head,'chunk',eye,side*.126,.035,.271,.043,.031,.017);
        mesh(head,'box',rotDark,side*.126,.11,.24,.18,.047,.062,0,0,side*-.17);
        mesh(head,'chunk',rot,side*.3,-.02,0,.072,.105,.1,0,0,side*.3);
      }
      mesh(head,'chunk',rotDark,0,-.063,.265,.058,.086,.047);
      mesh(head,'box',torn,-.012,-.19,.266,.23,.061,.023,0,0,.1);
      for(let i=0;i<4;i++) mesh(head,'box',bone,-.077+i*.046,-.178,.282,.024,.032,.014,0,0,.1);
      for(let i=0;i<3;i++) mesh(head,'cone',torn,-.12+i*.1,.29,-.10,.04,.17,.035,0,0,.35-i*.2);
      for(const [arm,fore,side] of [[leftArm,leftFore,1],[rightArm,rightFore,-1]]) {
        mesh(arm,'round',cloth,0,-.11,0,.16,.24,.16);
        mesh(arm,'taper',rot,0,-.28,0,.10,.35,.11,0,0,side*.05);
        mesh(fore,'taper',rot,0,-.18,0,.077,.39,.08);
        mesh(fore,'round',rot,0,-.42,.02,.105,.12,.07);
        for(let i=0;i<3;i++) mesh(fore,'box',rot,(i-1)*.056,-.5,.08,.033,.13,.033,-.44,0,0);
        mesh(fore,'box',rotDark,side*.038,-.18,.07,.054,.11,.015,0,0,.2);
      }
      for(const [leg,shin,side] of [[leftLeg,leftShin,1],[rightLeg,rightShin,-1]]) {
        mesh(leg,'taper',cloth,0,-.21,0,.135,.43,.14,0,0,side*.025);
        mesh(shin,'taper',rot,0,-.19,0,.08,.43,.083);
        mesh(shin,'round',rotDark,0,-.37,.1,.125,.11,.23);
        mesh(shin,'box',cloth,0,-.045,0,.2,.14,.18,0,0,side*.13);
      }
    } else {
      const clothes=material(role==='guard'?0x345e80:role==='priest'?0xd4c7a1:0x3e8882);
      const secondary=material(role==='guard'?0x213e58:role==='priest'?0x687c69:0x275953);
      const leather=material(0x73503a), cream=material(0xe4d6b6);
      mesh(body,'cloth',clothes,0,.04,0,.54,.74,.35);
      mesh(body,'round',clothes,0,.29,-.015,.55,.38,.35);
      mesh(body,'cylinder',leather,0,-.13,0,.55,.12,.36);
      mesh(body,'box',brass,0,-.13,.36,.16,.12,.055);
      mesh(body,'box',dark,0,-.13,.393,.072,.06,.008);
      mesh(body,'box',leather,.4,-.15,.23,.18,.22,.13,0,0,-.15);
      mesh(body,'box',brass,.4,-.11,.31,.045,.055,.02);
      mesh(body,'box',secondary,0,-.37,.27,.36,.26,.06);
      if(role==='guard') {
        mesh(body,'round',iron,0,.22,.18,.43,.35,.22);
        mesh(body,'box',brass,0,.27,.393,.065,.4,.025);
        mesh(body,'box',brass,0,.28,.399,.23,.06,.025);
        mesh(body,'cloth',secondary,0,-.30,-.18,.49,.46,.18);
        for(const side of [-1,1]) mesh(body,'round',brass,side*.35,.42,.25,.045,.045,.03);
      } else if(role==='priest') {
        mesh(body,'box',secondary,-.23,.08,.31,.14,.75,.052,0,0,-.04);
        mesh(body,'box',secondary,.23,.08,.31,.14,.75,.052,0,0,.04);
        mesh(body,'box',brass,0,.21,.367,.035,.14,.025);
        mesh(body,'box',brass,0,.23,.375,.11,.035,.025);
        mesh(body,'cloth',clothes,0,-.47,-.025,.53,.59,.36);
        mesh(body,'cylinder',brass,0,-.73,-.025,.53,.035,.36);
      } else {
        mesh(body,'box',leather,0,.025,.33,.53,.47,.06);
        mesh(body,'box',leather,-.23,.33,.29,.085,.33,.045,0,0,-.17);
        mesh(body,'box',leather,.23,.33,.29,.085,.33,.045,0,0,.17);
        mesh(body,'box',brass,-.23,.31,.33,.045,.05,.02);
        mesh(body,'box',brass,.23,.31,.33,.045,.05,.02);
        mesh(body,'box',secondary,.08,-.05,.373,.22,.17,.025);
      }
      // Broad face, brows, nose, moustache, and three independently shaped beard braids.
      mesh(head,'round',skin,0,.01,0,.39,.37,.32);
      mesh(head,'round',skin,0,-.1,.19,.3,.25,.23);
      for(const side of [-1,1]) {
        mesh(head,'round',skin,side*.37,-.02,0,.115,.14,.10,0,0,side*-.3);
        mesh(head,'box',cream,side*.14,.08,.297,.12,.07,.029);
        mesh(head,'box',dark,side*.13,.075,.32,.043,.055,.015);
        mesh(head,'box',beard,side*.14,.145,.298,.18,.052,.053,0,0,side*-.12);
        mesh(head,'round',beard,side*.11,-.125,.353,.16,.065,.074,0,0,side*.12);
      }
      mesh(head,'round',skin,0,-.015,.344,.095,.13,.12);
      mesh(head,'round',beard,0,-.25,.19,.29,.22,.19);
      for(let i=0;i<3;i++) {
        const x=(i-1)*.15, length=i===1?.43:.31;
        mesh(head,'cone',beard,x,-.32,.27,.105,length,.10,0,0,Math.PI+(i-1)*.13);
        mesh(head,'cylinder',brass,x,-.36-length*.18,.278,.061,.05,.059);
        mesh(head,'chunk',beard,x,-.41-length*.24,.273,.059,.1,.062);
      }
      if(role==='priest') {
        mesh(head,'round',clothes,0,.08,-.18,.5,.46,.28);
        mesh(head,'ring',clothes,0,.06,.025,.45,.45,.27);
        mesh(head,'ring',brass,0,.06,.068,.365,.369,.18);
      } else if(role==='guard') {
        mesh(head,'cap',iron,0,.08,-.005,.44,.37,.37);
        mesh(head,'ring',brass,0,.1,-.005,.425,.35,.35,Math.PI/2);
        mesh(head,'box',brass,0,.2,.342,.07,.28,.055);
        for(const side of [-1,1]) mesh(head,'box',iron,side*.34,-.055,.11,.09,.3,.19,0,0,side*-.12);
        mesh(head,'box',secondary,0,.425,-.045,.105,.25,.35);
        mesh(head,'box',brass,0,.31,-.045,.13,.045,.39);
      } else {
        mesh(head,'cap',leather,0,.09,-.01,.40,.31,.34);
        mesh(head,'cylinder',secondary,0,.10,-.01,.41,.08,.35);
        mesh(head,'box',leather,0,.09,.31,.57,.04,.18,-.11,0,0);
        mesh(head,'box',brass,.2,.115,.293,.08,.09,.032,0,.25,0);
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
        mesh(shin,'box',dark,0,-.34,.12,.40,.075,.51);
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
    const {moving=false,speed=5.4,attack=false,downed=false,tool}=options;
    dt=clamp(Number(dt)||0,0,.1); time=Number(time)||0;
    if(tool!==undefined) setTool(tool);
    if((typeof attack==='number' && attack>0 && attack!==previousAttack) || (typeof attack==='boolean' && attack && (!previousAttack || attackClock>.69))) attackClock=0;
    previousAttack=attack; attackClock+=dt;
    const blend=1-Math.exp(-dt*12);
    moveAmount+=(moving?1-moveAmount:-moveAmount)*blend;
    downAmount+=((downed?1:0)-downAmount)*(1-Math.exp(-dt*8));
    walkPhase+=dt*(rig.zombie?5.3:8.6)*clamp((Number(speed)||5.4)/5.4,.4,1.6);
    const s=Math.sin(walkPhase), c=Math.cos(walkPhase), breath=Math.sin(time*2.2+variation);
    const swing=attackClock<.62 ? Math.sin(attackClock/.62*Math.PI) : 0;
    visual.rotation.z=-Math.PI*.49*downAmount;
    visual.position.y=.70*downAmount;
    visual.position.z=0;
    if(rig.zombie) {
      rig.body.position.y=1.10+Math.abs(s)*.037*moveAmount+breath*.012;
      rig.body.rotation.set(.17+Math.sin(walkPhase*.5)*.025,Math.sin(walkPhase*.5)*.07*moveAmount,.075+s*.062*moveAmount);
      rig.head.rotation.set(-.09+breath*.025,c*.065,.12+Math.sin(time*1.4+variation)*.045);
      rig.leftLeg.rotation.x=s*.30*moveAmount;
      rig.rightLeg.rotation.x=-s*.39*moveAmount;
      rig.leftShin.rotation.x=.10+Math.max(0,-s)*.24*moveAmount;
      rig.rightShin.rotation.x=.07+Math.max(0,s)*.32*moveAmount;
      rig.leftArm.rotation.set(-.50+c*.15*moveAmount-swing*.90,0,.10+Math.sin(time*1.7)*.04);
      rig.rightArm.rotation.set(-.79-c*.17*moveAmount-swing*.70,0,-.13);
      rig.leftFore.rotation.x=-.14-breath*.06;
      rig.rightFore.rotation.x=-.18+breath*.08;
    } else {
      rig.body.position.y=1.04+Math.abs(s)*.063*moveAmount+breath*.009;
      rig.body.rotation.set(-.035*moveAmount,Math.sin(walkPhase)*.036*moveAmount,-s*.028*moveAmount);
      rig.head.rotation.set(-.025+breath*.012,-Math.sin(walkPhase)*.025*moveAmount,0);
      rig.leftLeg.rotation.x=s*.55*moveAmount;
      rig.rightLeg.rotation.x=-s*.55*moveAmount;
      rig.leftShin.rotation.x=Math.max(0,-s)*.34*moveAmount;
      rig.rightShin.rotation.x=Math.max(0,s)*.34*moveAmount;
      rig.leftArm.rotation.set(-s*.36*moveAmount-.06,0,.09);
      rig.rightArm.rotation.set(s*.28*moveAmount-.12,0,-.10);
      rig.leftFore.rotation.x=-.13;
      rig.rightFore.rotation.x=-.14;
      if(swing>0) {
        // A lifted shoulder leads into the follow-through. The server controls impact.
        const phase=attackClock/.62;
        rig.rightArm.rotation.x=-.18-Math.sin(phase*Math.PI)*1.72;
        rig.rightArm.rotation.z=-.12-Math.sin(phase*Math.PI)*.30;
        rig.rightFore.rotation.x=-.15-Math.sin(phase*Math.PI)*.42;
        rig.body.rotation.y=-Math.sin(phase*Math.PI*2)*.15;
        if(toolId==='heal') {
          rig.leftArm.rotation.x=-.8*swing;
          rig.head.rotation.x=-.13*swing;
        }
      }
    }
    if(downAmount>.01) {
      rig.leftArm.rotation.x*=1-downAmount; rig.rightArm.rotation.x*=1-downAmount;
      rig.leftLeg.rotation.x*=1-downAmount; rig.rightLeg.rotation.x*=1-downAmount;
      rig.head.rotation.z+=downAmount*.20;
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
