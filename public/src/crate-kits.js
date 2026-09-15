import * as THREE from 'three';

// Original display artwork only. These models grant no equipment or supplies.
const KITS = Object.freeze({
  hearth_ration_kit: { tier: 'basic', food: 'bread', cloth: 0x727a47 },
  tradesmans_kit: { tier: 'rare', food: 'bread', toolTier: 'wood', cloth: 0x365e70 },
  prospectors_kit: { tier: 'epic', food: 'hearty_meal', toolTier: 'stone', cloth: 0x695078 },
  master_expedition_kit: { tier: 'legendary', food: 'feast', toolTier: 'iron', cloth: 0x2a685e }
});
const TAU = Math.PI * 2;
const vector = p => new THREE.Vector3(...p);

function atelier() {
  const geometries = new Set(), materials = new Set();
  function material(name, color, extra = {}) {
    const result = new THREE.MeshStandardMaterial({ color, roughness: .8, ...extra });
    result.name = name; materials.add(result); return result;
  }
  function mesh(parent, geometry, mat, name, position = [0, 0, 0], scale = [1, 1, 1]) {
    geometries.add(geometry);
    const result = new THREE.Mesh(geometry, mat); result.name = name;
    result.position.set(...position); result.scale.set(...scale);
    result.castShadow = result.receiveShadow = true; parent.add(result); return result;
  }
  function surface(fn, columns = 32, rows = 12) {
    const positions = [], indices = [];
    for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++) positions.push(...fn(x / columns, y / rows));
    for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
      const a = y * (columns + 1) + x;
      indices.push(a, a + 1, a + columns + 1, a + 1, a + columns + 2, a + columns + 1);
    }
    const result = new THREE.BufferGeometry(); result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    result.setIndex(indices); result.computeVertexNormals(); return result;
  }
  function tube(parent, mat, name, points, radius = .008, segments = 28, closed = false) {
    return mesh(parent, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(vector), closed), segments, radius, 6, closed), mat, name);
  }
  const orb = (parent, mat, name, position, scale) => mesh(parent, new THREE.SphereGeometry(1, 18, 12), mat, name, position, scale);
  function plate(parent, mat, name, draw, depth = .025, bevel = .008) {
    const shape = new THREE.Shape(); draw(shape);
    const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 12, steps: 1 });
    geometry.translate(0, 0, -depth / 2); return mesh(parent, geometry, mat, name);
  }
  // All static ornament is merged by material, not left as one draw per stitch.
  function batch(root) {
    const groups = new Map(); root.updateMatrixWorld(true);
    const inverse = root.matrixWorld.clone().invert();
    root.traverse(object => {
      if (!object.isMesh) return;
      const group = groups.get(object.material) ?? []; group.push(object); groups.set(object.material, group);
    });
    const results = [];
    for (const [mat, objects] of groups) {
      const positions = [], normals = [], components = [];
      for (const object of objects) {
        const transformed = object.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld));
        const plain = transformed.index ? transformed.toNonIndexed() : transformed;
        for (const value of plain.attributes.position.array) positions.push(value);
        for (const value of plain.attributes.normal.array) normals.push(value);
        components.push(object.name);
        if (plain !== transformed) plain.dispose(); transformed.dispose();
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3)); geometry.computeBoundingSphere();
      const object = new THREE.Mesh(geometry, mat); object.name = `kit-batch-${mat.name}`;
      object.userData.components = components; object.castShadow = object.receiveShadow = true;
      results.push(object);
    }
    root.clear();
    for (const geometry of geometries) geometry.dispose(); geometries.clear();
    for (const object of results) { geometries.add(object.geometry); root.add(object); }
  }
  return { material, mesh, surface, tube, orb, plate, batch, geometries, materials };
}

function kitPalette(a, spec) {
  return {
    leather: a.material('saddle-leather', 0x6c4026), dark: a.material('seams-and-grip', 0x2e251e),
    cloth: a.material('dyed-linen', spec.cloth, { side: THREE.DoubleSide }),
    linen: a.material('cream-lining', 0xc5b589, { side: THREE.DoubleSide }),
    thread: a.material('waxed-thread', 0xdbbb78), brass: a.material('aged-brass', 0xc2994e, { metalness: .75, roughness: .35 }),
    wood: a.material('oiled-ash', 0x9d7044), crust: a.material('baked-crust', 0xb77432),
    crumb: a.material('cut-bread-and-bone', 0xebcb83), meal: a.material('roasted-meal', 0x7f3821),
    green: a.material('garden-garnish', 0x4c7139), vegetable: a.material('golden-vegetables', 0xd69739),
    head: a.material('tool-head', spec.toolTier === 'iron' ? 0x72858a : spec.toolTier === 'stone' ? 0x626965 : 0x9d7044,
      { metalness: spec.toolTier === 'iron' ? .8 : 0, roughness: spec.toolTier === 'iron' ? .3 : .9 }),
    edge: a.material('tool-edge', spec.toolTier === 'iron' ? 0xc4d0c8 : spec.toolTier === 'stone' ? 0x909587 : 0xc39659,
      { metalness: spec.toolTier === 'iron' ? .85 : 0, roughness: .45 })
  };
}

function cloth(a, parent, mat, name, { x = 0, y = 0, z = 0, width = .75, depth = .50, fold = .035 } = {}) {
  return a.mesh(parent, a.surface((u, v) => {
    const edge = Math.max(Math.abs(u - .5), Math.abs(v - .5)) * 2;
    return [x + (u - .5) * width, y + Math.sin(u * 18 + v * 3) * fold * (.35 + edge) + Math.sin(v * Math.PI) * .025, z + (v - .5) * depth];
  }, 26, 18), mat, name);
}
function stitch(a, parent, mat, name, path, count = 20) {
  const curve = new THREE.CatmullRomCurve3(path.map(vector));
  for (let i = 0; i < count; i++) {
    const p = curve.getPoint((i + .15) / count), q = curve.getPoint((i + .58) / count);
    a.tube(parent, mat, name, [p.toArray(), q.toArray()], .0027, 2);
  }
}
function bread(a, parent, m, x, y, z, index, angle = 0) {
  const loaf = new THREE.Group(); loaf.name = `bread-${index}`; loaf.position.set(x, y, z); loaf.rotation.y = angle; parent.add(loaf);
  const geometry = new THREE.SphereGeometry(1, 26, 16), p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const px = p.getX(i), py = p.getY(i), pz = p.getZ(i);
    const wobble = 1 + .025 * Math.sin(px * 9 + pz * 11) * Math.cos(py * 7);
    p.setXYZ(i, px * .19 * wobble, py * .092 * (py < 0 ? .70 : 1), pz * .108 * wobble);
  }
  geometry.computeVertexNormals(); a.mesh(loaf, geometry, m.crust, `bread-${index}-crust`);
  for (let cut = -1; cut <= 1; cut++) {
    const cx = cut * .085;
    const points = Array.from({ length: 9 }, (_, i) => {
      const z = (i / 8 - .5) * .137, xx = cx + z * .29;
      return [xx, .092 * Math.sqrt(Math.max(.03, 1 - (xx / .19) ** 2 - (z / .108) ** 2)) + .001, z];
    });
    a.tube(loaf, m.meal, `bread-${index}-scored-crust`, points, .010, 12);
    a.tube(loaf, m.crumb, `bread-${index}-opened-score`, points.map(([xx, yy, zz]) => [xx, yy + .003, zz]), .005, 12);
  }
  for (let i = 0; i < 11; i++) {
    const px = Math.sin(i * 2.4) * .12, pz = Math.cos(i * 1.6) * .066;
    a.orb(loaf, m.crumb, `bread-${index}-flour`, [px, .092 * Math.sqrt(Math.max(.05, 1 - (px / .19) ** 2 - (pz / .108) ** 2)) + .002, pz], [.007, .002, .0025]);
  }
}
function meal(a, parent, m, x, y, z, index, feast) {
  const bowl = new THREE.Group(); bowl.position.set(x, y, z); parent.add(bowl);
  const profile = [[0, -.055], [.085, -.055], [.14, -.025], [.17, .035], [.17, .043], [.158, .043], [.14, .005], [0, -.005]].map(p => new THREE.Vector2(...p));
  a.mesh(bowl, new THREE.LatheGeometry(profile, 28), feast ? m.wood : m.leather, `${feast ? 'feast' : 'hearty-meal'}-${index}-dish`);
  a.mesh(bowl, new THREE.CylinderGeometry(.146, .14, .01, 28), feast ? m.crumb : m.meal, `meal-${index}-serving`, [0, .005, 0]);
  if (feast) {
    a.orb(bowl, m.meal, `feast-${index}-roast`, [0, .073, -.015], [.095, .067, .075]);
    for (const side of [-1, 1]) {
      const leg = a.orb(bowl, m.crust, `feast-${index}-drumstick`, [side * .082, .038, .065], [.042, .034, .061]); leg.rotation.y = -side * .45;
      a.orb(bowl, m.crumb, `feast-${index}-bone`, [side * .103, .033, .112], [.018, .016, .025]);
    }
    for (let i = 0; i < 4; i++) a.tube(bowl, m.crust, `feast-${index}-roast-score`, [[-.06, .11 - Math.abs(i - 1.5) * .006, -.061 + i * .028], [0, .14, -.061 + i * .028], [.06, .11, -.061 + i * .028]], .004, 12);
  } else {
    for (let i = 0; i < 7; i++) a.orb(bowl, i % 2 ? m.vegetable : m.crust, `hearty-meal-${index}-stew`, [Math.sin(i * 2.4) * .10, .022, Math.cos(i * 2.4) * .10], [.027, .021, .025]);
  }
  for (let i = 0; i < 5; i++) {
    const angle = i * 1.1 + .5;
    const leaf = a.orb(bowl, m.green, `meal-${index}-herb`, [Math.cos(angle) * .12, .022, Math.sin(angle) * .12], [.014, .006, .034]); leaf.rotation.y = -angle;
    if (feast) a.orb(bowl, m.vegetable, `feast-${index}-vegetable`, [Math.sin(angle) * .125, .024, Math.cos(angle) * .125], [.022, .022, .027]);
  }
}

function tool(a, parent, m, type, tier) {
  const group = new THREE.Group(); group.name = `${tier}-${type}`; group.position.set(.02, .26, -.21); group.rotation.z = -.32; group.rotation.y = -.12; parent.add(group);
  const long = type === 'scythe', top = long ? 1.13 : .91;
  a.tube(group, m.wood, 'shaped-wooden-handle', [[0, -.43, 0], [-.014, -.16, 0], [.015, .25, 0], [0, top, 0]], .029, 30);
  for (const side of [-1, 1]) a.tube(group, m.dark, 'handle-grain', [[side * .020, -.36, .019], [side * .013, .14, .025], [side * .019, top - .1, .018]], .0022, 16);
  for (let i = 0; i < 13; i++) {
    const y = -.37 + i * .017;
    a.tube(group, m.leather, 'spiral-leather-grip', Array.from({ length: 11 }, (_, k) => { const theta = k / 10 * TAU; return [Math.sin(theta) * .031, y + k / 10 * .014, Math.cos(theta) * .031]; }), .005, 12);
  }
  a.orb(group, m.dark, 'handle-end-cap', [0, -.434, 0], [.033, .025, .033]);
  const head = new THREE.Group(); head.position.y = top - .025; group.add(head);
  if (type === 'axe') {
    const draw = s => { s.moveTo(-.07, .11); s.bezierCurveTo(.08, .095, .20, .155, .28, .20); s.bezierCurveTo(.37, .055, .38, -.14, .29, -.255); s.bezierCurveTo(.18, -.18, .14, -.09, -.065, -.08); s.closePath(); };
    a.plate(head, m.head, `${tier}-axe-forged-head`, draw, .071, .012);
    a.plate(head, m.edge, `${tier}-axe-sharpened-edge`, s => { s.moveTo(.266, .168); s.bezierCurveTo(.34, .045, .34, -.125, .28, -.219); s.lineTo(.31, -.249); s.bezierCurveTo(.39, -.105, .372, .085, .294, .196); s.closePath(); }, .075, .004);
  } else if (type === 'pickaxe') {
    a.plate(head, m.head, `${tier}-pickaxe-curved-head`, s => { s.moveTo(-.40, -.15); s.bezierCurveTo(-.28, .07, -.15, .12, 0, .09); s.bezierCurveTo(.20, .12, .30, .015, .40, -.18); s.bezierCurveTo(.21, -.06, .15, .025, 0, .025); s.bezierCurveTo(-.19, .055, -.25, -.04, -.40, -.15); s.closePath(); }, .067, .009);
    for (const side of [-1, 1]) a.tube(head, m.edge, `${tier}-pickaxe-polished-ridge`, [[side * .06, .086, .041], [side * .20, .066, .038], [side * .31, -.023, .027], [side * .375, -.137, .012]], .009, 18);
  } else {
    a.plate(head, m.head, `${tier}-scythe-swept-blade`, s => { s.moveTo(-.04, .03); s.bezierCurveTo(.22, .24, .57, .22, .70, -.12); s.bezierCurveTo(.51, .095, .25, .045, .015, -.095); s.closePath(); }, .027, .007);
    a.tube(head, m.edge, `${tier}-scythe-cutting-edge`, [[.015, -.087, .022], [.23, .04, .022], [.44, .082, .021], [.60, .015, .018], [.685, -.103, .007]], .007, 28);
    a.tube(group, m.wood, 'scythe-side-grip', [[.01, .35, 0], [.095, .36, .055], [.19, .38, .035]], .026, 12);
  }
  for (const y of [-.055, .04]) {
    a.mesh(head, new THREE.CylinderGeometry(.055, .055, .028, 14), tier === 'wood' ? m.leather : m.brass, 'tool-socket-band', [0, y, 0]);
    a.orb(head, m.brass, 'socket-rivet', [0, y, .055], [.012, .012, .008]);
  }
  if (tier === 'stone') for (let i = 0; i < 4; i++) a.tube(head, m.dark, 'stone-head-fissure', [[-.10 + i * .07, .075, .044], [-.09 + i * .07, .043, .047], [-.11 + i * .07, .02, .042]], .0025, 5);
}

function satchel(a, parent, m, spec, selectedTool) {
  const ringPoint = (u, v, inset = 0) => {
    const theta = u * TAU, sx = Math.sin(theta), cz = Math.cos(theta), front = Math.max(0, cz);
    const round = n => Math.sign(n) * Math.abs(n) ** .68;
    return [round(sx) * (.29 + v * .075 - inset), .01 + v * (.37 - front * .065) + Math.sin(theta * 6) * v * .01,
      round(cz) * (.15 + v * .045 - inset)];
  };
  a.mesh(parent, a.surface((u, v) => ringPoint(u, v), 48, 14), m.leather, 'open-satchel-outer');
  a.mesh(parent, a.surface((u, v) => ringPoint(u, v, .009), 48, 14), m.linen, 'open-satchel-lining');
  a.orb(parent, m.leather, 'rounded-satchel-bottom', [0, .027, 0], [.302, .085, .161]);
  a.tube(parent, m.dark, 'rolled-opening-rim', Array.from({ length: 48 }, (_, i) => ringPoint(i / 48, 1)), .014, 60, true);
  const frontSeam = Array.from({ length: 20 }, (_, i) => { const p = ringPoint((i / 19 - .5) * .43, .22); p[2] += .008; return p; });
  a.tube(parent, m.dark, 'lower-seam', frontSeam, .006, 28); stitch(a, parent, m.thread, 'lower-seam-stitch', frontSeam, 34);
  // The folded-open back flap is a curved cloth/leather surface, not a box lid.
  a.mesh(parent, a.surface((u, v) => [(u - .5) * (.62 - v * .08), .36 + Math.sin(v * Math.PI * .75) * .31 + Math.cos(u * TAU * 2) * .008,
    -.185 - v * .13 - Math.sin(u * Math.PI) * .025], 24, 20), m.cloth, 'folded-open-flap');
  for (const side of [-1, 1]) {
    const seam = [[side * .285, .02, .145], [side * .31, .15, .175], [side * .34, .315, .16]];
    a.tube(parent, m.dark, 'vertical-piping', seam, .009, 20); stitch(a, parent, m.thread, 'vertical-stitching', seam, 15);
    a.mesh(parent, a.surface((u, v) => [side * .19 + (u - .5) * .046, .04 + v * .235, .173 + Math.sin(v * Math.PI) * .025], 3, 16), m.dark, 'front-buckle-strap');
    const buckle = a.mesh(parent, new THREE.TorusGeometry(.030, .005, 5, 16), m.brass, 'rounded-brass-buckle', [side * .19, .17, .204], [.77, 1, 1]);
    a.tube(parent, m.brass, 'buckle-pin', [[side * .19, .143, .21], [side * .19, .181, .21]], .003, 4);
    a.orb(parent, m.brass, 'strap-rivet', [side * .19, .078, .191], [.007, .007, .004]);
    buckle.rotation.z = .08 * side;
  }
  a.tube(parent, m.leather, 'carry-handle', [[-.17, .36, -.15], [-.13, .65, -.17], [.12, .67, -.18], [.19, .36, -.16]], .025, 30);
  a.tube(parent, m.thread, 'handle-sewn-edge', [[-.181, .38, -.129], [-.137, .644, -.148], [.114, .66, -.158], [.179, .39, -.139]], .003, 26);
  cloth(a, parent, m.cloth, 'food-linen', { y: .32, z: .035, width: .69, depth: .47 });
  for (const side of [-1, 1]) {
    if (spec.food === 'bread') bread(a, parent, m, side * .162, .39, .072, side < 0 ? 1 : 2, side * .21);
    else meal(a, parent, m, side * .17, .374, .070, side < 0 ? 1 : 2, spec.food === 'feast');
  }
  // A stitched leather crest and rivets identify the container without implying
  // an extra inventory item such as a potion or flask.
  a.plate(parent, m.cloth, 'stitched-satchel-badge', s => { s.moveTo(-.07, .225); s.lineTo(.07, .225); s.lineTo(.064, .139); s.quadraticCurveTo(0, .104, -.064, .139); s.closePath(); }, .007, .004).position.z = .184;
  a.tube(parent, m.brass, 'badge-mountain', [[-.045, .158, .199], [-.012, .196, .199], [.012, .17, .199], [.031, .19, .199], [.05, .154, .199]], .004, 12);
  tool(a, parent, m, selectedTool, spec.toolTier);
}
function rationBundle(a, parent, m) {
  a.orb(parent, m.leather, 'rounded-ration-wrap', [0, -.034, 0], [.39, .079, .235]);
  cloth(a, parent, m.cloth, 'open-hearth-cloth', { y: .025, width: .88, depth: .63, fold: .043 });
  cloth(a, parent, m.linen, 'linen-bread-lining', { y: .048, width: .65, depth: .41, fold: .022 });
  bread(a, parent, m, -.145, .137, -.009, 1, -.21); bread(a, parent, m, .14, .137, .025, 2, .32);
  const cord = [[-.37, .012, -.13], [-.28, .041, -.26], [0, .034, -.28], [.31, .05, -.23], [.37, .032, .02], [.32, .029, .22], [0, .035, .27], [-.34, .009, .20], [-.37, .012, -.13]];
  a.tube(parent, m.thread, 'loosened-bundle-cord', cord, .009, 48);
  a.tube(parent, m.thread, 'loose-cord-bow', [[.23, .068, .24], [.30, .126, .22], [.36, .115, .19], [.23, .068, .24], [.12, .102, .28], [.08, .074, .26], [.23, .068, .24], [.31, .012, .31]], .007, 36);
  stitch(a, parent, m.thread, 'cloth-hem-stitches', Array.from({ length: 15 }, (_, i) => { const u = .06 + i / 14 * .88; return [(u - .5) * .88, .025 + Math.sin(u * 18 + 3) * .043 * 1.35 + .004, .306]; }), 36);
}

function phoenix(a, parent) {
  const gold = a.material('phoenix-gold', 0xd8ae55, { metalness: .86, roughness: .27 });
  const dark = a.material('antique-gold-recess', 0x614227, { metalness: .67, roughness: .55 });
  const edge = a.material('feather-highlights', 0xf5d796, { metalness: .74, roughness: .22 });
  const core = a.material('living-ember', 0xff8733, { emissive: 0xff440a, emissiveIntensity: 1.2, roughness: .26, metalness: .18 });
  const flame = a.material('ember-veins', 0xffc15b, { emissive: 0xff7b16, emissiveIntensity: .72, roughness: .35 });
  const stone = a.material('charcoal-seal', 0x303334, { roughness: .8 });
  a.mesh(parent, new THREE.CylinderGeometry(.22, .255, .105, 40), stone, 'one-use-charcoal-seal', [0, -.36, 0]);
  for (const y of [-.4, -.316]) a.mesh(parent, new THREE.TorusGeometry(.229, .011, 6, 36), gold, 'seal-gold-ring', [0, y, 0]).rotation.x = Math.PI / 2;
  // Each wing is a fan of long curved, engraved feather plates. The silhouette
  // reads as a rising bird from either side, rather than a glowing sphere.
  for (const side of [-1, 1]) {
    for (let feather = 0; feather < 5; feather++) {
      const baseX = side * (.055 + feather * .022), baseY = -.16 + feather * .015;
      const tipX = side * (.43 - feather * .039), tipY = .12 + feather * .091;
      const dx = tipX - baseX, dy = tipY - baseY;
      const draw = s => {
        s.moveTo(baseX, baseY); s.bezierCurveTo(baseX + dx * .7 + side * .042, baseY + dy * .1, tipX + side * .035, tipY - .12, tipX, tipY);
        s.bezierCurveTo(tipX - side * .053, tipY - .095, baseX + dx * .47 - side * .028, baseY + dy * .42, baseX, baseY); s.closePath();
      };
      const plate = a.plate(parent, feather % 2 ? gold : dark, `phoenix-wing-${side}-${feather}`, draw, .021, .007); plate.position.z = -.018 - feather * .007;
      a.tube(parent, edge, 'engraved-feather-spine', [[baseX, baseY, .005 - feather * .007], [baseX + dx * .55, baseY + dy * .38, .011 - feather * .007], [tipX, tipY - .025, .003 - feather * .007]], .005, 18);
      if (feather % 2 === 0) a.tube(parent, flame, 'ember-feather-vein', [[baseX + dx * .2, baseY + dy * .20, .011 - feather * .007], [baseX + dx * .55, baseY + dy * .44, .013 - feather * .007], [tipX - side * .015, tipY - .08, .008 - feather * .007]], .0038, 16);
    }
    a.tube(parent, gold, 'sweeping-wing-bone', [[side * .027, -.13, .017], [side * .15, .02, .020], [side * .22, .20, -.002], [side * .28, .42, -.03]], .021, 30);
    a.tube(parent, gold, 'relic-tail', [[side * .045, -.07, 0], [side * .11, -.22, -.012], [side * .06, -.30, 0], [0, -.315, 0]], .02, 22);
    for (let i = 0; i < 3; i++) a.orb(parent, edge, 'seal-claw', [side * (.06 + i * .019), -.302, .07], [.008, .016, .025]);
  }
  a.orb(parent, gold, 'phoenix-breast-frame', [0, -.01, .027], [.105, .165, .068]);
  const crystal = a.surface((u, v) => {
    const theta = u * TAU, radius = Math.sin(v * Math.PI) ** .78 * (.075 + .008 * Math.cos(theta * 6));
    return [Math.sin(theta + v * .65) * radius + .033 * v * v, -.145 + v * .318, .072 + Math.cos(theta + v * .65) * radius * .53];
  }, 24, 20);
  a.mesh(parent, crystal, core, 'single-living-ember-heart');
  for (const side of [-1, 1]) a.tube(parent, edge, 'heart-retaining-claw', [[side * .070, -.115, .065], [side * .073, -.035, .118], [side * .045, .035, .115]], .008, 20);
  a.orb(parent, gold, 'phoenix-curved-neck', [0, .163, .003], [.047, .109, .045]);
  a.orb(parent, gold, 'phoenix-head', [.013, .246, .021], [.050, .054, .044]);
  a.plate(parent, edge, 'phoenix-beak', s => { s.moveTo(.038, .264); s.quadraticCurveTo(.087, .255, .105, .223); s.lineTo(.039, .235); s.closePath(); }, .028, .003).position.z = .021;
  a.orb(parent, flame, 'phoenix-eye', [.034, .262, .064], [.008, .008, .004]);
  a.tube(parent, edge, 'phoenix-crest', [[-.018, .263, .006], [-.050, .327, -.012], [-.022, .361, -.032]], .009, 16);
  a.batch(parent);
  // One tiny Points batch; no per-particle objects, timers, textures or lights.
  const positions = [], original = [];
  for (let i = 0; i < 12; i++) { const p = [Math.sin(i * 2.4) * (.10 + i * .014), -.10 + i * .047, Math.cos(i * 1.7) * .07]; positions.push(...p); original.push(...p); }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); a.geometries.add(geometry);
  const mat = new THREE.PointsMaterial({ color: 0xffc16d, size: .012, transparent: true, opacity: .8, depthWrite: false, blending: THREE.AdditiveBlending }); a.materials.add(mat);
  const sparks = new THREE.Points(geometry, mat); sparks.name = 'twelve-ember-sparks'; parent.add(sparks);
  return (time, reducedMotion) => {
    const t = Number.isFinite(time) ? Math.max(0, time) : 0;
    core.emissiveIntensity = reducedMotion ? 1.2 : 1.2 + Math.sin(t * 1.6) * .13;
    flame.emissiveIntensity = reducedMotion ? .72 : .72 + Math.sin(t * 1.6 + .6) * .09;
    sparks.visible = !reducedMotion;
    for (let i = 0; i < 12; i++) {
      const age = (t * .10 + i / 12) % 1;
      geometry.attributes.position.setXYZ(i, original[i * 3] + (reducedMotion ? 0 : Math.sin(t * .6 + i) * .015), reducedMotion ? original[i * 3 + 1] : -.10 + age * .59, original[i * 3 + 2]);
    }
    geometry.attributes.position.needsUpdate = true; geometry.computeBoundingSphere();
  };
}

/** A standalone display model, centered locally; +Z is the front and +Y is up. */
export function createKit(id, { tool: selectedTool = 'pickaxe' } = {}) {
  const spec = Object.hasOwn(KITS, id) ? KITS[id] : undefined;
  if (!spec && id !== 'phoenix_ember') throw new RangeError(`Unknown crate kit: ${id}`);
  if (!['axe', 'pickaxe', 'scythe'].includes(selectedTool)) throw new RangeError(`Unknown kit tool: ${selectedTool}`);
  const a = atelier(), root = new THREE.Group(), art = new THREE.Group();
  root.name = `crate-kit-${id}`; art.name = 'authored-kit-art'; root.add(art);
  root.userData = { itemId: id, tier: spec?.tier ?? 'legendary', displayOnly: true,
    tool: spec?.toolTier ? selectedTool : null, toolTier: spec?.toolTier ?? null,
    contents: spec ? [...(spec.toolTier ? [{ item: `${spec.toolTier}_${selectedTool}`, quantity: 1 }] : []), { item: { bread: 'food', hearty_meal: 'good_food', feast: 'best_food' }[spec.food], appearance: spec.food, quantity: 2 }] : [{ item: 'phoenix_ember', quantity: 1 }] };
  let animate;
  if (spec) {
    const m = kitPalette(a, spec);
    if (spec.toolTier) satchel(a, art, m, spec, selectedTool); else rationBundle(a, art, m);
    a.batch(art);
    // Palette entries unused by a simple ration bundle need not remain alive.
    const used = new Set(); art.traverse(o => { if (o.material) used.add(o.material); });
    for (const mat of a.materials) if (!used.has(mat)) { mat.dispose(); a.materials.delete(mat); }
  } else animate = phoenix(a, art);
  const bounds = new THREE.Box3().setFromObject(art), size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
  const scale = (spec ? 1.10 : 1.02) / Math.max(size.x, size.y, size.z);
  art.scale.setScalar(scale); art.position.copy(center).multiplyScalar(-scale);
  let disposed = false;
  return {
    parts: [{ bone: null, object: root }],
    update(time, { reducedMotion = false } = {}) { if (!disposed) animate?.(time, reducedMotion); },
    dispose() {
      if (disposed) return; disposed = true;
      root.removeFromParent(); root.clear();
      for (const geometry of a.geometries) geometry.dispose(); a.geometries.clear();
      for (const mat of a.materials) mat.dispose(); a.materials.clear();
    }
  };
}
