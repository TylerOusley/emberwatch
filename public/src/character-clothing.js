import * as THREE from 'three';

// Tailored surfaces: the sections describe the cut of a garment, while small
// tension folds are cut into the surface itself. No scaled stock primitives.
const TAU = Math.PI * 2;
const materials = new Map();
const textures = new Map();
const clamp = THREE.MathUtils.clamp;
const mix = THREE.MathUtils.lerp;
const ease = t => (t = clamp(t, 0, 1), t * t * (3 - 2 * t));

function textile(kind) {
  if (textures.has(kind)) return textures.get(kind);
  const size = 96, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const grain = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    const noise = grain - Math.floor(grain);
    const weave = ((x % 3 === 0) !== (y % 3 === 0)) ? .25 : -.15;
    const n = kind === 'cloth' ? 148 + weave * 70 + noise * 30 : 135 + noise * 75;
    const i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = n;
    data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.repeat.set(3, 3);
  t.needsUpdate = true;
  textures.set(kind, t);
  return t;
}

function fabric(color, kind = 'cloth') {
  const key = `${color}/${kind}`;
  if (!materials.has(key)) {
    const metal = kind === 'iron' || kind === 'brass';
    materials.set(key, new THREE.MeshStandardMaterial({
      color, vertexColors: true, metalness: metal ? .68 : .015,
      roughness: metal ? .43 : kind === 'leather' ? .79 : .94,
      side: THREE.DoubleSide,
      ...(!metal ? { bumpMap: textile(kind), bumpScale: kind === 'cloth' ? .0015 : .001 } : {}),
    }));
  }
  return materials.get(key);
}

function surface(rows, columns, sample, color = () => 1) {
  const p = [], uv = [], colors = [], index = [];
  for (let i = 0; i <= rows; i++) for (let j = 0; j <= columns; j++) {
    const v = i / rows, u = j / columns, q = sample(u, v);
    p.push(q[0], q[1], q[2]); uv.push(u, v);
    const c = color(u, v, q);
    colors.push(c, c * .995, c * .975);
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < columns; j++) {
    const a = i * (columns + 1) + j, b = a + columns + 1;
    index.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

function sectionAt(sections, y) {
  let i = 0;
  while (i < sections.length - 2 && y > sections[i + 1][0]) i++;
  const a = sections[i], b = sections[i + 1];
  const t = ease((y - a[0]) / (b[0] - a[0]));
  return [mix(a[1], b[1], t), mix(a[2], b[2], t), mix(a[3] || 0, b[3] || 0, t)];
}

function garment(sections, options = {}) {
  const { rows = 22, segments = 36, folds = .012, seed = 0, power = 1, hem = 0, origin = [0,0,0], front = 0 } = options;
  const ymin = sections[0][0], ymax = sections.at(-1)[0];
  return surface(rows, segments, (u, v) => {
    const a = u * TAU, y = mix(ymin, ymax, v), s = sectionAt(sections, y);
    const ca = Math.cos(a), sa = Math.sin(a);
    const tension = Math.sin(a * 9 + seed + v * .6) * .65 + Math.sin(a * 15 - v * 4 + seed) * .24;
    const ripples = folds * tension * (1 - .65 * ease(v));
    const x = Math.sign(ca) * Math.pow(Math.abs(ca), power) * (s[0] + ripples);
    const z = Math.sign(sa) * Math.pow(Math.abs(sa), power) * (s[1] + ripples * .8) + s[2];
    const hemY = hem * Math.sin(a * 7 + seed) * (1 - ease(v * 8));
    return [x + origin[0], y + hemY + origin[1], z + front * Math.max(0, sa) + origin[2]];
  }, (u, v) => .965 + .025 * Math.sin(u * TAU * 9 + seed + v * .6) + .018 * v);
}

function ribbon(points, width, depth = 0) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  return surface(Math.max(10, points.length * 5), 2, (u, v) => {
    const p = curve.getPoint(v), tangent = curve.getTangent(v);
    const across = new THREE.Vector3(tangent.y, -tangent.x, 0).normalize();
    if (across.lengthSq() < .1) across.set(1, 0, 0);
    p.addScaledVector(across, (u - .5) * width);
    p.z += depth + Math.sin(u * Math.PI) * .002;
    return p.toArray();
  });
}

function mergeOnBone(parent, own) {
  const byMaterial = new Map();
  for (const m of parent.children) if (m.userData.tailored && m.isMesh && !m.isSkinnedMesh) {
    const list = byMaterial.get(m.material) || [];
    list.push(m); byMaterial.set(m.material, list);
  }
  for (const [material, list] of byMaterial) {
    if (list.length < 2) continue;
    const p = [], n = [], uv = [], color = [];
    for (const m of list) {
      m.updateMatrix();
      const source = m.geometry.clone().applyMatrix4(m.matrix);
      const g = source.index ? source.toNonIndexed() : source;
      p.push(...g.attributes.position.array); n.push(...g.attributes.normal.array);
      uv.push(...g.attributes.uv.array); color.push(...g.attributes.color.array);
      if (g !== source) g.dispose(); source.dispose();
      parent.remove(m); own.delete(m.geometry); m.geometry.dispose();
    }
    const g = new THREE.BufferGeometry();
    for (const [name, values, size] of [['position',p,3],['normal',n,3],['uv',uv,2],['color',color,3]])
      g.setAttribute(name, new THREE.Float32BufferAttribute(values, size));
    g.computeBoundingSphere(); own.add(g);
    const m = new THREE.Mesh(g, material);
    m.userData.tailored = true; m.castShadow = m.receiveShadow = true;
    parent.add(m);
  }
}

function skinSkirt(geometry, rig, mat, fittedHem = false) {
  rig.body.updateWorldMatrix(true, true);
  const skeleton = new THREE.Skeleton([rig.body, rig.leftLeg, rig.leftShin, rig.rightLeg, rig.rightShin]);
  const p = geometry.attributes.position, indices = [], weights = [];
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), x = p.getX(i);
    // Fitted layers start moving below the rigid shirt, and use the same
    // weights for the tunic, apron, and pocket so they cannot pull through
    // one another. Long priest robes retain their looser drape.
    const hip = fittedHem ? ease((-y - .29) / .15) * .94 : ease((-y - .18) / .62) * .76;
    const leg = .5 + .5 * Math.tanh(x * 7);
    indices.push(0, 1, 3, 0); weights.push(1 - hip, hip * leg, hip * (1 - leg), 0);
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const mesh = new THREE.SkinnedMesh(geometry, mat);
  rig.body.add(mesh); mesh.updateWorldMatrix(true, false); mesh.bind(skeleton, mesh.matrixWorld);
  mesh.userData.tailored = true; mesh.castShadow = mesh.receiveShadow = true;
  mesh.frustumCulled = false; // A garment can move beyond its bind-pose bounds.
  return mesh;
}

function closeShoulder(geometry, side) {
  const p = geometry.attributes.position;
  for(let i=0;i<p.count;i++) p.setX(i,p.getX(i)-side*.10*ease((p.getY(i)-.005)/.085));
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  return geometry;
}

function skinSleeve(geometry, arm, fore, mat) {
  arm.updateWorldMatrix(true,true);
  const skeleton = new THREE.Skeleton([arm,fore]);
  const p=geometry.attributes.position, indices=[], weights=[];
  for(let i=0;i<p.count;i++) {
    const w=ease((-.22-p.getY(i))/.22);
    indices.push(0,1,0,0); weights.push(1-w,w,0,0);
  }
  geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(indices,4));
  geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
  const mesh=new THREE.SkinnedMesh(geometry,mat);
  arm.add(mesh); mesh.updateWorldMatrix(true,false);mesh.bind(skeleton,mesh.matrixWorld);
  mesh.userData.tailored=true;mesh.castShadow=mesh.receiveShadow=true;
  mesh.frustumCulled=false;
  return mesh;
}

// Keep the boot's stitching and leather together by material before skinning;
// an articulated boot should not require a draw call for every lace.
function joinSurfaces(parts) {
  if (parts.length === 1) return parts[0];
  const count = parts.reduce((n, g) => n + g.attributes.position.count, 0);
  const geometry = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'color']) {
    const size = parts[0].attributes[name].itemSize, data = new Float32Array(count * size);
    let offset = 0;
    for (const g of parts) { data.set(g.attributes[name].array, offset); offset += g.attributes[name].array.length; }
    geometry.setAttribute(name, new THREE.BufferAttribute(data, size));
  }
  const indices = [], sizes = parts.map(g => g.attributes.position.count);
  let offset = 0;
  parts.forEach((g, i) => { for (const index of g.index.array) indices.push(index + offset); offset += sizes[i]; g.dispose(); });
  geometry.setIndex(indices); geometry.computeBoundingSphere();
  return geometry;
}

function skinLimb(geometry, upper, lower, mat, influence, anchor = null) {
  upper.updateWorldMatrix(true, true);
  const skeleton = new THREE.Skeleton(anchor ? [upper, lower, anchor.bone] : [upper, lower]);
  const positions = geometry.attributes.position, indices = [], weights = [];
  for (let i = 0; i < positions.count; i++) {
    const y = positions.getY(i), weight = clamp(influence(y), 0, 1);
    const pinned = anchor ? clamp(anchor.influence(y), 0, 1) : 0;
    indices.push(0, 1, anchor ? 2 : 0, 0);
    weights.push((1 - weight) * (1 - pinned), weight * (1 - pinned), pinned, 0);
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const mesh = new THREE.SkinnedMesh(geometry, mat);
  upper.add(mesh); mesh.updateWorldMatrix(true, false); mesh.bind(skeleton, mesh.matrixWorld);
  mesh.userData.tailored = true; mesh.castShadow = mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

/** Add original fitted clothing to the supplied natural-proportion dwarf rig. */
export function buildClothing(rig, { role = 'villager', variation = 0, palette = {}, own = new Set() } = {}) {
  const touched = new Set(), skins = [];
  const priest = role === 'priest', guard = role === 'guard', zombie = role === 'zombie';
  const shirt = fabric(palette.shirt || (priest ? 0xebe2cb : guard ? 0x334b64 : zombie ? 0x526148 : [0x536c71,0x60765b,0x746653,0x56667a][variation % 4]));
  const trouser = fabric(zombie ? 0x423f32 : guard ? 0x333d47 : 0x453e34);
  const leather = fabric(zombie ? 0x393c30 : 0x765039, 'leather');
  const darkLeather = fabric(0x3b2b22, 'leather');
  const seam = fabric(priest ? 0xcbbd99 : 0xbaa07a, 'leather');
  const steel = fabric(0x819397, 'iron'), steelEdge = fabric(0x56686f, 'iron');
  const brass = fabric(0xc29b4c, 'brass'), stole = fabric(0x596d63);
  const add = (bone, geometry, mat) => {
    if (zombie) geometry.scale(bone === rig.body ? .75 : .85, 1, bone === rig.body ? .82 : .9);
    own.add(geometry); touched.add(bone);
    const m = new THREE.Mesh(geometry, mat);
    m.userData.tailored = true; m.castShadow = m.receiveShadow = true;
    bone.add(m); return m;
  };
  const robe = (geometry, mat, part = '') => {
    if (zombie) geometry.scale(.75, 1, .82);
    own.add(geometry); const m = skinSkirt(geometry, rig, mat, Boolean(part));
    if (part) m.userData.clothingPart = part;
    skins.push(m); own.add(m.skeleton); return m;
  };
  const limb = (geometry, upper, lower, mat, influence, part, anchor = null) => {
    if (zombie) geometry.scale(.85, 1, .9);
    own.add(geometry);
    const m = skinLimb(geometry, upper, lower, mat, influence, anchor);
    m.userData.clothingPart = part;
    skins.push(m); own.add(m.skeleton); return m;
  };

  // A chest cut to the shoulder and neck rather than a capsule placed on a belt.
  const torsoSections = [[-.29,.365,.23],[.00,.366,.243],[.16,.412,.247],[.30,.43,.223],[.40,.404,.20],[.485,.235,.159],[.535,.145,.132]];
  if (priest) {
    robe(garment([[ -.895,.485,.315],[-.70,.462,.285],[-.48,.425,.278],[-.26,.404,.258],...torsoSections.slice(1)],
      { rows: 32, segments: 32, folds: .018, seed: variation, hem: .008 }), shirt);
  } else {
    add(rig.body, garment(torsoSections, { folds: .009, seed: variation, hem: zombie ? .055 : .004 }), shirt);
    // The short tunic hangs over, rather than terminating at, the trouser waist.
    if (!guard) robe(garment([[-.44,.379,.251],[-.29,.373,.248],[-.15,.364,.246]],
      { rows: 10, folds: .009, seed: variation, hem: zombie ? .055 : .008 }), shirt, 'shortTunic');
  }

  // Soft standing collar and a narrow opening below the throat.
  add(rig.body, garment([[.487,.154,.141],[.544,.151,.138],[.556,.148,.136]], { rows: 4, segments: 28, folds: .002 }), shirt);
  add(rig.body, ribbon([[0,.512,.149],[.006,.44,.184],[.008,.345,.228]], .015), darkLeather);
  for (let side of [-1,1]) {
    const arm = side > 0 ? rig.leftArm : rig.rightArm, fore = side > 0 ? rig.leftFore : rig.rightFore;
    const leg = side > 0 ? rig.leftLeg : rig.rightLeg, shin = side > 0 ? rig.leftShin : rig.rightShin;
    const foot = side > 0 ? rig.leftFoot : rig.rightFoot;
    const shoulderSections = [[-.23,.127,.119],[-.08,.144,.136],[.012,.133,.130],[.060,.09,.094],[.086,.012,.013],[.089,.001,.001]];
    const sleeveSections = [[-.306,.113,.11],...shoulderSections];
    if (priest || guard) {
      const sleeve=closeShoulder(garment([[-.611,priest?.136:.097,priest?.129:.10],[-.59,priest?.14:.097,priest?.132:.10],[-.49,.127,.12],[-.35,.126,.118],...shoulderSections],
        {rows:28,segments:28,folds:priest?.005:.003,seed:variation+side}),side);
      own.add(sleeve);const m=skinSleeve(sleeve,arm,fore,shirt);skins.push(m);own.add(m.skeleton);
      if(priest) add(fore,garment([[-.27,.14,.133],[-.255,.141,.133]],{rows:2,segments:28,folds:.001}),seam);
    } else {
      add(arm,closeShoulder(garment(sleeveSections,{rows:18,segments:26,folds:.004,seed:variation+side}),side),shirt);
      // A rolled fabric cuff has a layered lip, not a separate bead.
      add(arm, garment([[-.312,.115,.111],[-.301,.128,.12],[-.277,.129,.122],[-.265,.116,.113]],
        { rows: 7, segments: 24, folds: .002 }), shirt);
      add(arm, garment([[-.297,.129,.123],[-.290,.128,.122]], { rows: 2, segments: 24, folds: .001 }), seam);
    }
    // One fabric surface crosses the knee. Overlapping rigid thigh/calf tubes
    // pull apart as soon as a walking knee bends far enough to lift the foot.
    limb(garment([[-.48,.097,.104],[-.40,.110,.113],[-.35,.117,.119],[-.31,.129,.128],[-.13,.149,.151],[.065,.159,.151]],
      { rows: 28, segments: 24, folds: .006, seed: variation + side, front: .005 }),
      leg, shin, trouser, y => ease((-.265 - y) / .16), 'trousers',
      { bone: rig.body, influence: y => 1 - ease((-.02 - y) / .15) });

    // Fitted leather footwear: shaft, ankle, instep, asymmetric toe, and welt.
    const bootParts = new Map();
    const boot = (geometry, mat) => {
      const parts = bootParts.get(mat) || [];
      parts.push(geometry); bootParts.set(mat, parts);
    };
    const bootSections = [[-.391,.142,.221,.101],[-.369,.147,.226,.103],[-.322,.145,.226,.106],[-.268,.132,.198,.084],[-.196,.112,.139,.038],[-.10,.107,.119,.012],[.015,.126,.125,0]];
    boot(garment(bootSections, { rows: 24, segments: 28, folds: .002, power: .82, seed: variation }), darkLeather);
    boot(garment([[-.402,.145,.225,.101],[-.394,.151,.231,.101],[-.370,.15,.231,.102],[-.36,.145,.227,.103]],
      { rows: 5, segments: 32, folds: 0, power: .8 }), leather);
    boot(garment([[-.009,.13,.129],[.016,.135,.133],[.026,.13,.128]],
      { rows: 5, segments: 28, folds: .001 }), leather);
    boot(ribbon([[-.077,-.329,.272],[-.069,-.23,.187],[-.056,-.12,.126],[-.049,.006,.124]], .006), seam);
    boot(ribbon([[.077,-.329,.272],[.069,-.23,.187],[.056,-.12,.126],[.049,.006,.124]], .006), seam);
    for (let i = 0; i < 4; i++) {
      const y = -.03 - i * .044, z = .13 + Math.max(0,-y-.08)*.40;
      boot(ribbon([[-.048,y,z],[0,y-.012,z+.006],[.048,y-.025,z+.008]], .009), leather);
      boot(ribbon([[.048,y,z],[0,y-.012,z+.009],[-.048,y-.025,z+.008]], .009), leather);
    }
    for (const [mat, parts] of bootParts) {
      const geometry = joinSurfaces(parts);
      // The tall shaft follows the calf. A broad ankle transition bends into
      // the instep, while the sole and toe follow the foot without distortion.
      if (foot) limb(geometry, shin, foot, mat, y => ease((-.14 - y) / .15), 'boot');
      else add(shin, geometry, mat);
    }
  }

  if (guard) {
    // Raised center ridge, curved flanks, cut-away neckline, and hammered edges.
    const breastplate = (back = false, edge = false) => surface(20, 30, (u,v) => {
      const s = u*2-1, width = .328 + .098*ease(v/.65) - .047*ease((v-.76)/.24);
      const y = -.115 + v*.56 - .135*Math.pow(1-Math.abs(s),3)*ease((v-.72)/.28);
      const z = (.236 + .061*Math.sin(v*Math.PI)) * Math.sqrt(1-.77*s*s) + .022*(1-Math.abs(s));
      return [s*width,y,back?-z*.89:z + (edge?.005:0)];
    }, (u,v) => .975 + .02*Math.cos(u*Math.PI*4)*Math.sin(v*Math.PI));
    add(rig.body, breastplate(), steel); add(rig.body, breastplate(true), steelEdge);
    add(rig.body, ribbon([[-.329,-.113,.115],[-.22,-.12,.205],[0,-.122,.262],[.22,-.12,.205],[.329,-.113,.115]], .024), steelEdge);
    add(rig.body, ribbon([[0,-.08,.275],[0,.075,.318],[0,.22,.313],[0,.30,.299]], .009), brass);
    for (let side of [-1,1]) {
      const arm=side>0?rig.leftArm:rig.rightArm, fore=side>0?rig.leftFore:rig.rightFore, leg=side>0?rig.leftLeg:rig.rightLeg;
      // Broad forged shoulder caps and lames overlap like actual articulated armor.
      add(arm,closeShoulder(garment([[-.139,.17,.152],[-.08,.185,.166],[.008,.174,.159],[.07,.111,.108],[.103,.012,.013],[.106,.001,.001]],
        {rows:18,segments:30,folds:0,power:.94}),side),steel);
      add(arm,garment([[-.222,.141,.135],[-.2,.161,.147],[-.133,.176,.158],[-.12,.173,.155]],
        {rows:7,segments:30,folds:0}),steelEdge);
      add(fore, garment([[-.26,.11,.114],[-.235,.126,.126],[-.10,.14,.135],[-.063,.135,.134]],
        {rows:12,segments:24,folds:0,power:.89}), steel);
      add(fore, garment([[-.235,.13,.13],[-.215,.131,.13]],{rows:2,segments:24,folds:0}), darkLeather);
      add(fore, garment([[-.109,.144,.14],[-.091,.142,.14]],{rows:2,segments:24,folds:0}), darkLeather);
      // Tassets hang from the belt; their surfaces fit the thigh and move with it.
      for(let lame=0;lame<3;lame++) add(leg,surface(5,12,(u,v)=>{
        const a=mix(-.9,.9,u), y=.035-lame*.074-v*.10;
        return [Math.sin(a)*(.164-lame*.003),y,.164*Math.cos(a)+.013];
      }),lame===1?steelEdge:steel);
    }
  } else if (priest) {
    // A stole drapes as two continuous strips over the front of the robe.
    for (let side of [-1,1]) {
      const g=surface(30,6,(u,v)=>{
        const y=mix(-.76,.51,v), x=side*(.168-.042*ease((v-.70)/.3))+(u-.5)*.092;
        const s=sectionAt([[ -.90,.485,.315],[-.70,.462,.285],[-.48,.425,.278],[-.26,.404,.258],[.0,.366,.243],[.16,.412,.247],[.30,.43,.223],[.4,.404,.2],[.485,.235,.159],[.535,.145,.132]],y);
        const z=s[1]*Math.sqrt(Math.max(.2,1-(x/s[0])**2))+.018+Math.sin(v*11+side)*.003;
        return[x,y,z];
      });
      robe(g,stole);
      const border=surface(30,2,(u,v)=>{
        const y=mix(-.76,.50,v),x=side*(.203-.042*ease((v-.70)/.3))+(u-.5)*.008;
        const s=sectionAt([[ -.90,.485,.315],[-.70,.462,.285],[-.48,.425,.278],[-.26,.404,.258],[.0,.366,.243],[.16,.412,.247],[.30,.43,.223],[.4,.404,.2],[.485,.235,.159],[.535,.145,.132]],y);
        return[x,y,s[1]*Math.sqrt(Math.max(.2,1-(x/s[0])**2))+.023];
      });
      robe(border,brass);
      const symbolY=-.58, symbolZ=.292;
      // Woven dawn emblem near each end, kept small enough to read as embroidery.
      robe(ribbon([[side*.168,symbolY-.04,symbolZ],[side*.168,symbolY+.04,symbolZ]],.009),brass);
      robe(ribbon([[side*.135,symbolY,symbolZ],[side*.201,symbolY,symbolZ]],.009),brass);
    }
  } else if (!zombie) {
    const apron=surface(26,20,(u,v)=>{
      const y=mix(-.575,.335,v), width= v>.63 ? mix(.326,.217,ease((v-.63)/.37)) : mix(.31,.342,ease(v/.63));
      const x=(u*2-1)*width, z=.296+Math.sin(v*Math.PI)*.006-.02*(1-ease(v*2))-.025*(2*u-1)**2;
      return[x,y+.009*Math.cos(u*TAU*2)*(1-ease(v*9)),z+.008*Math.sin(u*TAU*4+v)*Math.sin(v*Math.PI)];
    },(u,v)=>.95+.035*Math.cos(u*TAU*4+v));
    robe(apron,leather,'apron');
    for(let side of [-1,1]) add(rig.body,ribbon([[side*.192,.28,.270],[side*.213,.41,.218],[side*.19,.485,.162],[side*.18,.50,.035],[side*.195,.444,-.153],[side*.253,.17,-.241]],.046),leather);
    robe(ribbon([[-.255,-.294,.295],[-.15,-.28,.311],[0,-.275,.317],[.15,-.28,.311],[.255,-.294,.295]],.009),seam,'apronTrim');
    // A shallow stitched pocket follows the apron surface rather than floating.
    robe(surface(9,12,(u,v)=>{
      const x=(u*2-1)*.153,y=-.34+v*.155;
      return[x,y,.327+.006*Math.sin(u*Math.PI)*Math.sin(v*Math.PI)];
    }),darkLeather,'apronPocket');
    robe(ribbon([[-.15,-.19,.332],[0,-.183,.336],[.15,-.19,.332]],.01),seam,'apronTrim');
  }

  // Belt with shaped buckle. This is a narrow strip, not a torus at the waist.
  const beltY = priest ? -.105 : guard ? -.135 : -.05;
  const beltX=priest?.403:.377,beltZ=priest?.278:.260;
  add(rig.body,garment([[beltY-.026,beltX,beltZ],[beltY+.026,beltX-.003,beltZ+.001]],{rows:4,segments:40,folds:0}),darkLeather);
  const buckle=surface(12,4,(u,v)=>{
    const a=v*TAU,r=.055+(u-.5)*.016;
    return[Math.sign(Math.cos(a))*Math.abs(Math.cos(a))**.45*r,beltY+Math.sign(Math.sin(a))*Math.abs(Math.sin(a))**.45*r*.72,beltZ+.016];
  });
  add(rig.body,buckle,brass);
  add(rig.body,ribbon([[0,beltY-.023,beltZ+.021],[0,beltY+.025,beltZ+.021]],.008),brass);

  for (const bone of touched) mergeOnBone(bone,own);
  const colored = [];
  rig.body.traverse(mesh => { if (mesh.isMesh && mesh.material === shirt) colored.push(mesh); });
  return { materials: [], skinnedMeshes: skins,
    setColor(color) {
      const next = color ? fabric(color) : shirt;
      // Cached fabrics are shared. Replace this rig's references instead of
      // tinting the shared material and changing every villager's clothing.
      for (const mesh of colored) mesh.material = next;
    },
    dispose() { for (const mesh of skins) mesh.skeleton.dispose(); } };
}
