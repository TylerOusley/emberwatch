import * as THREE from 'three';

// Original, rigid utility accessories fitted to the natural dwarf's body bone.
// +Z is the chest; the body origin is 1.04 m above the ground. These are cosmetic
// assemblies only: hiding a purchased backpack never changes carrying capacity.
const IDS = new Set(['foragers_pouch', 'miners_buckle', 'deep_delvers_belt', 'mining_pack', 'lumber_pack']);
const TAU = Math.PI * 2;
const V = p => new THREE.Vector3(...p);
const clampTier = value => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(3, Math.trunc(value))) : 0;

function surface(rows, columns, sample) {
  const position = [], uv = [], indices = [];
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= columns; c++) {
    position.push(...sample(c / columns, r / rows)); uv.push(c / columns, r / rows);
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
    const a = r * (columns + 1) + c, b = a + columns + 1;
    indices.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

// A gathered sewn shell with flat-ish panels, rounded corners and shallow folds.
// The narrow end rings close the silhouette without poles or faceted box edges.
function sewnShell(width, height, depth, seed = 0) {
  return surface(20, 36, (u, v) => {
    const a = u * TAU, round = Math.pow(Math.max(.00001, Math.sin(v * Math.PI)), .25);
    const gather = 1 - .11 * Math.exp(-(((v - .9) / .065) ** 2));
    const fold = 1 + Math.sin(a * 9 + v * 5 + seed) * .022 * Math.sin(v * Math.PI);
    return [Math.sign(Math.cos(a)) * Math.abs(Math.cos(a)) ** .73 * width * .5 * round * gather * fold,
      (v - .5) * height, Math.sign(Math.sin(a)) * Math.abs(Math.sin(a)) ** .77 * depth * .5 * round * fold];
  });
}

function textile(kind) {
  const size = 48, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const wave = Math.sin(x * 97.7 + y * 219.3) * 913.17, noise = wave - Math.floor(wave);
    const weave = kind === 'canvas' ? ((x % 3 === 0) !== (y % 3 === 0) ? 21 : -12) : 0;
    const i = (x + y * size) * 4, value = Math.round(130 + noise * 75 + weave);
    pixels[i] = pixels[i + 1] = pixels[i + 2] = value; pixels[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.repeat.set(3, 3); texture.needsUpdate = true;
  return texture;
}

export function createUtility(id) {
  if (!IDS.has(id)) return null;
  const object = new THREE.Group(); object.name = `crate-utility-${id}`;
  object.userData.utilityId = id; object.userData.backpackTier = 0;
  const isPack = id === 'mining_pack' || id === 'lumber_pack';
  const materials = new Map(), textures = new Map(), batches = new Map(), owned = new Set();
  let disposed = false;
  const palette = {
    leather: [0x855a38, 'leather'], dark: [0x49382c, 'leather'], trim: [0xae8250, 'leather'],
    canvas: [id === 'mining_pack' ? 0x48616c : id === 'lumber_pack' ? 0x69744b : 0x738355, 'canvas'],
    stitch: [0xd6be8a], brass: [0xbc995b, 'metal'], iron: [0x768f92, 'metal'],
    teal: [0x4caca2, 'gem'], ore: [0x405862], bark: [0x665039, 'leather'], endgrain: [0xc19b65]
  };
  function mat(key) {
    if (materials.has(key)) return materials.get(key);
    const [color, kind] = palette[key], metal = kind === 'metal';
    const material = new THREE.MeshStandardMaterial({ color, roughness: metal ? .43 : kind === 'gem' ? .31 : .9,
      metalness: metal ? .66 : kind === 'gem' ? .22 : .015, side: THREE.DoubleSide });
    if (kind === 'leather' || kind === 'canvas') {
      if (!textures.has(kind)) textures.set(kind, textile(kind));
      material.bumpMap = textures.get(kind); material.bumpScale = kind === 'canvas' ? .0018 : .0011;
    }
    materials.set(key, material); return material;
  }
  function add(geometry, key, point = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1]) {
    const transform = new THREE.Matrix4().compose(V(point), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), V(scale));
    geometry.applyMatrix4(transform);
    const material = mat(key), list = batches.get(material) || []; list.push(geometry); batches.set(material, list);
  }
  function line(points, radius, key, closed = false, segments = null) {
    const curve = new THREE.CatmullRomCurve3(points.map(V), closed, 'centripetal');
    add(new THREE.TubeGeometry(curve, segments || Math.max(12, points.length * 3), radius, 5, closed), key);
  }
  function stitches(points, key = 'stitch', spacing = .026) {
    const curve = new THREE.CatmullRomCurve3(points.map(V), false, 'centripetal');
    const count = Math.max(2, Math.ceil(curve.getLength() / spacing));
    for (let i = 0; i < count; i++) {
      const a = curve.getPoint((i + .16) / count), b = curve.getPoint((i + .66) / count);
      line([a.toArray(), a.lerp(b, .5).toArray(), b.toArray()], .0017, key, false, 3);
    }
  }
  function strap(points, width = .055, key = 'leather', stitched = true) {
    const curve = new THREE.CatmullRomCurve3(points.map(V), false, 'centripetal');
    const sample = (u, v) => {
      const p = curve.getPoint(v), tangent = curve.getTangent(v);
      let across = new THREE.Vector3(1, 0, 0).addScaledVector(tangent, -tangent.x);
      if (across.lengthSq() < .02) across = new THREE.Vector3(0, 1, 0).addScaledVector(tangent, -tangent.y);
      across.normalize(); return p.addScaledVector(across, (u - .5) * width).toArray();
    };
    add(surface(Math.max(14, points.length * 5), 3, sample), key);
    if (stitched) for (const edge of [.13, .87]) stitches(Array.from({ length: 18 }, (_, i) => sample(edge, i / 17)));
  }
  function rivet(x, y, z, key = 'brass', radius = .009) {
    add(new THREE.SphereGeometry(1, 10, 6), key, [x, y, z], [0, 0, 0], [radius, radius, radius * .5]);
  }
  function clasp(x, y, z, w = .047, h = .059, key = 'brass') {
    const radius = Math.min(w, h) * .17, corners = [[-w/2+radius,-h/2], [w/2-radius,-h/2], [w/2,-h/2+radius], [w/2,h/2-radius], [w/2-radius,h/2], [-w/2+radius,h/2], [-w/2,h/2-radius], [-w/2,-h/2+radius]];
    line(corners.map(([a,b]) => [x+a,y+b,z]), .0048, key, true, 28);
    line([[x,y-h*.42,z+.002],[x,y,z+.005],[x+w*.36,y+h*.07,z+.005]],.0035,key);
  }
  function patch(x, y, z, w, h, key = 'leather', direction = 1) {
    add(surface(9, 18, (u,v) => {
      const a = u * 2 - 1;
      return [x+a*w*.5*(1-.07*v), y+h*.5-v*h-.013*(1-a*a)*v,
        z+direction*(.015*Math.sin(v*Math.PI)-.021*a*a)];
    }), key);
    stitches(Array.from({ length: 17 }, (_, i) => { const a=i/8-1;return [x+a*w*.465,y-h*.5-.013*(1-a*a),z-direction*.021*a*a+direction*.002]; }));
  }
  function pouch(x, y, z, w, h, d, key = 'canvas', outward = 1, seed = 0) {
    add(sewnShell(w,h,d,seed),key,[x,y,z]);
    const front = z + outward * (d*.5+.009), top=y+h*.46;
    patch(x,top-h*.19,front,w*.97,h*.33,'leather',outward);
    strap([[x,top-.014,front+outward*.006],[x,top-h*.24,front+outward*.014],[x,top-h*.44,front+outward*.003]],.032,'trim',false);
    clasp(x,top-h*.32,front+outward*.018,.035,.046);
    const edge=Array.from({length:15},(_,i)=>{const a=-Math.PI*.48+i/14*Math.PI*.96;return [x+Math.sin(a)*w*.46,y-Math.cos(a)*h*.44,z+outward*d*.44];});
    line(edge,.003,'dark'); stitches(edge);
  }
  function belt(y = -.11, height = .09, key = 'leather', width = .417, depth = .302) {
    add(surface(6, 64, (u,v) => {
      const angle=u*TAU, scallop=Math.cos(angle*4)*.002;
      return [Math.cos(angle)*(width-.008*Math.sin(v*Math.PI)),y+(v-.5)*height+scallop,Math.sin(angle)*(depth+.004*Math.sin(v*Math.PI))];
    }),key);
    for (const edge of [-1,1]) {
      const points=Array.from({length:65},(_,i)=>{const a=i/64*TAU;return [Math.cos(a)*(width+.001),y+edge*height*.39+Math.cos(a*4)*.002,Math.sin(a)*(depth+.002)];});
      stitches(points,'stitch',.028);
    }
  }
  function plate(points, depth, key, position, bevel = .004) {
    const shape = new THREE.Shape(); points.forEach(([x,y],i)=>i?shape.lineTo(x,y):shape.moveTo(x,y)); shape.closePath();
    add(new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:true,bevelSize:bevel,bevelThickness:bevel,bevelSegments:2,steps:1}),key,position);
  }
  function pickEmblem(x,y,z,size=.065,key='brass',crossed=false) {
    const one = direction => {
      line([[x-size*.35*direction,y-size*.60,z],[x,y,z+.001],[x+size*.35*direction,y+size*.52,z]],.005,key);
      line([[x-size*.48*direction,y+size*.24,z],[x+size*.15*direction,y+size*.48,z+.002],[x+size*.63*direction,y+size*.21,z]],.006,key);
    };
    one(1);if(crossed)one(-1);
  }
  function harness() {
    for (const side of [-1,1]) {
      strap([[side*.23,-.19,-.34],[side*.25,.21,-.31],[side*.265,.45,-.18],
        [side*.265,.506,-.035],[side*.25,.46,.15],[side*.225,.28,.294],
        [side*.225,.09,.316],[side*.28,-.13,.248],[side*.37,-.19,.07],[side*.31,-.19,-.29]],.066);
      clasp(side*.225,.13,.324,.045,.061);
    }
  }
  function forager() {
    // The pouch hangs clear of the apron and is gathered under a leaf-shaped flap.
    strap([[.22,-.047,.281],[.246,-.101,.301],[.259,-.16,.34]],.059);
    pouch(.279,-.279,.362,.218,.269,.145,'canvas',1,3);
    add(surface(8,16,(u,v)=>[.279+(u-.5)*.157*(1-v*.20),-.15-v*.103-.017*Math.sin(u*Math.PI),.452-.027*(2*u-1)**2]),'dark');
    stitches([[.205,-.225,.429],[.24,-.243,.452],[.279,-.254,.457],[.317,-.244,.453],[.352,-.224,.428]]);
    rivet(.279,-.215,.465,'brass',.013);
    // A tied herb sprig, small measuring spoon and contrasting side gusset.
    for (const side of [-1,1]) {
      const points=[[.353,-.185,.405],[.361+side*.006,-.119,.417],[.364+side*.017,-.063,.421]];
      line(points,.0032,'trim');
      for (let j=0;j<3;j++) add(new THREE.SphereGeometry(1,10,6),'canvas',[.359+side*(.01+j*.004),-.093-j*.024,.423],[0,0,side*.65],[.018,.008,.003]);
    }
    line([[.351,-.15,.432],[.373,-.146,.429],[.37,-.174,.422],[.346,-.169,.426]],.003,'stitch',true);
    object.userData.rarity='basic';
  }
  function minerBuckle() {
    belt(-.10,.095,'dark');
    const shield=[[-.102,.041],[-.076,.070],[.076,.070],[.102,.041],[.089,-.048],[0,-.081],[-.089,-.048]];
    plate(shield,.014,'iron',[0,-.095,.316],.006);
    plate(shield.map(([x,y])=>[x*.83,y*.79]),.009,'dark',[0,-.095,.335],.003);
    pickEmblem(0,-.085,.352,.088,'brass',true);
    for(const side of [-1,1]) {
      rivet(side*.079,-.074,.344,'brass',.007);
      clasp(side*.148,-.10,.292,.039,.065,'iron');
      strap([[side*.165,-.046,.281],[side*.167,-.10,.29],[side*.168,-.15,.278]],.028,'trim',false);
    }
    add(new THREE.IcosahedronGeometry(.021,0),'teal',[0,-.118,.362],[0,0,.25],[1,.83,.42]);
    object.userData.rarity='rare';
  }
  function delverBelt() {
    belt(-.117,.173,'dark',.427,.31); belt(-.118,.113,'leather',.431,.315);
    const plateShape=[[-.09,.050],[0,.078],[.09,.050],[.087,-.047],[0,-.080],[-.087,-.047]];
    plate(plateShape,.016,'brass',[0,-.105,.325],.005);
    plate(plateShape.map(([x,y])=>[x*.76,y*.74]),.012,'iron',[0,-.105,.347],.004);
    add(new THREE.IcosahedronGeometry(.044,0),'teal',[0,-.105,.368],[0,0,.1],[.74,1,.38]);
    for(const side of [-1,1]) {
      // Forged keeper plates, engraved chevrons and two short supply pockets.
      for(let j=0;j<2;j++) {
        const x=side*(.155+j*.105),z=Math.sqrt(1-(x/.433)**2)*.32;
        plate([[-.029,.051],[.026,.049],[.032,-.046],[-.023,-.051]],.008,'iron',[x,-.116,z],.003);
        line([[x-side*.014,-.084,z+.013],[x+side*.008,-.113,z+.017],[x-side*.01,-.142,z+.013]],.003,'brass');
        rivet(x,-.071,z+.013,'brass',.005);rivet(x,-.160,z+.013,'brass',.005);
      }
      pouch(side*.344,-.262,.198,.142,.235,.113,'dark',1,side);
      clasp(side*.39,-.137,.126,.035,.048,'brass');
      line([[side*.39,-.14,.13],[side*.422,-.188,.15],[side*.409,-.232,.20]],.008,'iron');
    }
    object.userData.rarity='epic';
  }
  function miningPack() {
    harness();
    const center=[0,.051,-.477];
    add(sewnShell(.526,.657,.33,4),'canvas',center);
    // Reinforced leather base curves around the cloth shell.
    add(surface(7,36,(u,v)=>{const a=u*TAU,r=.70+.27*Math.sin(v*Math.PI*.5);return [Math.cos(a)*.268*r,-.276+v*.114,-.477+Math.sin(a)*.17*r];}),'dark');
    patch(0,.283,-.651,.493,.226,'leather',-1);
    for(const side of [-1,1]) {
      strap([[side*.126,.352,-.638],[side*.127,.238,-.677],[side*.127,.097,-.673]],.039,'trim');
      clasp(side*.127,.167,-.686,.042,.060,'iron');
      pouch(side*.30,-.084,-.499,.153,.272,.198,'dark',-1,side);
      // Ore visible above an open, stitched mineral sleeve, with copper seams.
      add(new THREE.IcosahedronGeometry(1,0),'ore',[side*.30,.056,-.518],[.2,side*.4,.1],[.068,.059,.061]);
      line([[side*.334,.083,-.548],[side*.30,.093,-.559],[side*.273,.065,-.568]],.004,'brass');
    }
    pouch(0,-.145,-.68,.328,.278,.146,'canvas',-1,8);
    // Small pickaxe maker's badge is flush with the broad rear pocket.
    add(new THREE.CylinderGeometry(.044,.044,.008,20),'iron',[0,-.142,-.773],[Math.PI/2,0,0]);
    pickEmblem(0,-.143,-.781,.046,'brass');
    // Leather carry handle rises above the lid, with a stitched lining.
    strap([[-.066,.348,-.446],[-.073,.436,-.452],[0,.458,-.461],[.073,.436,-.452],[.066,.348,-.446]],.035,'dark');
    object.userData.rarity='rare';
  }
  function log(x,y,z,length,radius,seed) {
    const bark=surface(7,22,(u,v)=>{const a=u*TAU,r=radius*(1+.04*Math.sin(a*7+seed)+.02*Math.sin(v*9+a));return [x+(v-.5)*length,y+Math.cos(a)*r,z+Math.sin(a)*r];});
    add(bark,'bark');
    for (const side of [-1,1]) {
      add(new THREE.CircleGeometry(radius*.94,24),'endgrain',[x+side*(length*.5+.001),y,z],[0,side*Math.PI/2,0]);
      for(const fraction of [.3,.57,.8]) {
        const ring=Array.from({length:28},(_,i)=>{const a=i/28*TAU,r=radius*fraction*(1+.025*Math.sin(a*5+seed));return [x+side*(length*.5+.0025),y+Math.cos(a)*r,z+Math.sin(a)*r];});
        line(ring,.0019,'trim',true,28);
      }
      line([[x+side*(length*.5+.003),y-radius*.1,z],[x+side*(length*.5+.003),y+radius*.24,z+radius*.16],[x+side*(length*.5+.003),y+radius*.69,z+radius*.36]],.0022,'bark');
    }
    for(let i=0;i<7;i++) {
      const a=i/7*TAU;
      line(Array.from({length:6},(_,j)=>{const v=j/5;return [x+(v-.5)*length*.94,y+Math.cos(a+.025*Math.sin(v*9+seed))*radius*1.013,z+Math.sin(a+.025*Math.sin(v*9+seed))*radius*1.013];}),.0027,i%2?'dark':'trim');
    }
  }
  function lumberPack() {
    harness();
    // A narrow canvas rucksack supports an open bent-wood hauling frame. The
    // exposed bundle and pale end grain distinguish it from the ore satchel.
    add(sewnShell(.424,.602,.19,2),'canvas',[0,.036,-.4]);
    for(const side of [-1,1]) {
      line([[side*.20,-.318,-.442],[side*.221,.035,-.463],[side*.224,.39,-.445]],.024,'bark');
      line([[side*.20,-.314,-.445],[side*.20,-.287,-.572],[side*.20,-.233,-.672]],.017,'trim');
    }
    for(const y of [-.258,.08,.339]) line([[-.217,y,-.463],[0,y+.008,-.477],[.217,y,-.463]],.018,'trim');
    log(-.02,-.093,-.598,.664,.079,1);
    log(.024,.063,-.609,.708,.083,2);
    log(-.012,.224,-.575,.651,.079,4);
    add(surface(10,22,(u,v)=>{const a=u*Math.PI;return [Math.cos(a)*(.266+.018*Math.sin(v*Math.PI)),-.31+v*.23,-.526-Math.sin(a)*.189];}),'canvas');
    stitches([[-.261,-.09,-.526],[-.19,-.10,-.655],[0,-.102,-.723],[.19,-.10,-.655],[.261,-.09,-.526]]);
    for(const side of [-1,1]) {
      const x=side*.172;
      strap([[x,-.294,-.436],[x,.06,-.471],[x,.34,-.478],[x,.365,-.555],[x,.29,-.672],[x,.044,-.709],[x,-.183,-.702],[x,-.299,-.602],[x,-.294,-.436]],.042,'leather');
      clasp(x,-.037,-.719,.045,.064);
    }
    // Hanging canvas tool sleeve and a strapped wooden wedge are functional
    //-looking details, not an extra full backpack layered over this frame.
    pouch(.291,-.143,-.426,.121,.246,.124,'canvas',-1,7);
    add(new THREE.ConeGeometry(.025,.145,4),'iron',[-.284,-.122,-.43],[0,0,.22],[1,1,.55]);
    strap([[-.301,-.056,-.408],[-.288,-.117,-.470],[-.27,-.187,-.428]],.037,'dark',false);
    object.userData.rarity='rare';
  }

  ({foragers_pouch:forager,miners_buckle:minerBuckle,deep_delvers_belt:delverBelt,mining_pack:miningPack,lumber_pack:lumberPack})[id]();
  // Each material is one immutable draw batch. Stitches, rivets and folds never
  // add per-frame objects or dozens of separate draw calls.
  for (const [material, geometries] of batches) {
    const flat = geometries.map(g => g.index ? g.toNonIndexed() : g);
    const count = flat.reduce((sum,g) => sum+g.attributes.position.count,0), geometry = new THREE.BufferGeometry();
    for (const [name,size] of [['position',3],['normal',3],['uv',2]]) {
      const data = new Float32Array(count*size);let offset=0;
      for(const part of flat) { const source=part.attributes[name]?.array;if(source)data.set(source,offset);offset+=part.attributes.position.count*size; }
      geometry.setAttribute(name,new THREE.BufferAttribute(data,size));
    }
    for(let i=0;i<geometries.length;i++) { if(flat[i]!==geometries[i])flat[i].dispose();geometries[i].dispose(); }
    geometry.computeBoundingBox();geometry.computeBoundingSphere();owned.add(geometry);
    const mesh=new THREE.Mesh(geometry,material);mesh.name=`${id}-${[...materials].find(([,value])=>value===material)[0]}`;
    mesh.castShadow=mesh.receiveShadow=true;object.add(mesh);
  }
  batches.clear(); object.userData.materialBatches=object.children.length;
  function setBackpackTier(tier) { if(!disposed)object.userData.backpackTier=clampTier(tier); }
  return {
    parts:[{bone:'body',object,...(isPack?{hideNames:['worn-backpack']}:{})}],
    setBackpackTier,
    update(_time,options={}) { if(!disposed&&options&&Object.hasOwn(options,'backpackTier'))setBackpackTier(options.backpackTier); },
    dispose() {
      if(disposed)return;disposed=true;object.removeFromParent();
      for(const geometry of owned)geometry.dispose();for(const material of materials.values())material.dispose();for(const texture of textures.values())texture.dispose();
      owned.clear();materials.clear();textures.clear();object.clear();
    }
  };
}
