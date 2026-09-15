import * as THREE from 'three';

// Original sculpted horse. One continuous, deformable coat surface joins the
// torso, neck, face and legs; a second shared mesh carries its tack and hair.
// All horses share these two geometries, but retain independent skeletons.
const clamp = THREE.MathUtils.clamp;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const union = (a, b, radius = .06) => { const h = Math.max(radius - Math.abs(a - b), 0) / radius; return Math.min(a, b) - h * h * radius * .25; };
const joints = [
  { side: -1, front: true, hip: [-.38, 1.56, .69], knee: [-.38, .80, .77], ankle: [-.38, .27, .74] },
  { side: 1, front: true, hip: [.38, 1.56, .69], knee: [.38, .80, .77], ankle: [.38, .27, .74] },
  { side: -1, front: false, hip: [-.38, 1.55, -.73], knee: [-.38, .77, -.93], ankle: [-.38, .27, -.74] },
  { side: 1, front: false, hip: [.38, 1.55, -.73], knee: [.38, .77, -.93], ankle: [.38, .27, -.74] }
];
function ellipsoid(x, y, z, cx, cy, cz, rx, ry, rz, tilt = 0) {
  x -= cx; y -= cy; z -= cz;
  const ny = y * Math.cos(tilt) + z * Math.sin(tilt), nz = z * Math.cos(tilt) - y * Math.sin(tilt);
  const k0 = Math.hypot(x / rx, ny / ry, nz / rz), k1 = Math.hypot(x / (rx * rx), ny / (ry * ry), nz / (rz * rz));
  return k1 ? k0 * (k0 - 1) / k1 : -Math.min(rx, ry, rz);
}
function tapered(x, y, z, a, b, ra, rb) {
  const vx = b[0] - a[0], vy = b[1] - a[1], vz = b[2] - a[2];
  const t = clamp(((x - a[0]) * vx + (y - a[1]) * vy + (z - a[2]) * vz) / (vx * vx + vy * vy + vz * vz), 0, 1);
  return Math.hypot(x - a[0] - vx * t, y - a[1] - vy * t, z - a[2] - vz * t) - ra - (rb - ra) * t;
}
function coatField(x, y, z) {
  let d = ellipsoid(x, y, z, 0, 1.56, -.02, .48, .49, 1.10);
  d = union(d, ellipsoid(x, y, z, 0, 1.61, -.76, .48, .48, .48), .20);
  d = union(d, ellipsoid(x, y, z, 0, 1.55, .68, .45, .56, .48), .20);
  // Withers flow into the ascending neck, then the long sloping forehead.
  d = union(d, ellipsoid(x, y, z, 0, 2.12, .80, .30, .70, .37, .43), .23);
  d = union(d, ellipsoid(x, y, z, 0, 2.65, 1.11, .22, .45, .25, .40), .17);
  d = union(d, ellipsoid(x, y, z, 0, 2.80, 1.31, .23, .27, .29, -.15), .12);
  d = union(d, ellipsoid(x, y, z, 0, 2.65, 1.60, .185, .22, .42, .53), .10);
  d = union(d, ellipsoid(x, y, z, 0, 2.48, 1.85, .215, .175, .235), .09);
  // The cheeks and jaw have a narrower throat latch than the skull.
  for (const side of [-1, 1]) d = union(d, ellipsoid(x, y, z, side * .105, 2.64, 1.36, .16, .235, .205), .10);
  if (y < 1.89) for (const j of joints) {
    if (Math.abs(x - j.hip[0]) > .5 || Math.abs(z - j.hip[2]) > .7) continue;
    const muscle = j.front ? .205 : .25;
    d = union(d, tapered(x, y, z, j.hip, [j.hip[0], 1.04, j.front ? .72 : -.72], muscle, .12), .16);
    d = union(d, tapered(x, y, z, [j.hip[0], 1.08, j.front ? .72 : -.72], j.knee, .13, .087), .09);
    d = union(d, tapered(x, y, z, j.knee, j.ankle, .075, .057), .05);
    d = union(d, ellipsoid(x, y, z, j.ankle[0], .26, j.ankle[2], .087, .11, .10), .04);
    d = union(d, ellipsoid(x, y, z, j.ankle[0], .135, j.ankle[2] + .055, .112, .128, .172), .04);
  }
  return d;
}

// Consistent tetrahedra prevent cracks; field-gradient normals keep the coat
// smooth without joining separate spheres at the shoulders or head.
function sculpt(field) {
  const min = [-.83, .003, -1.34], max = [.83, 3.15, 2.15], step = .065;
  const size = max.map((v, i) => Math.ceil((v - min[i]) / step) + 1), [nx, ny, nz] = size;
  const spacing = max.map((v, i) => (v - min[i]) / (size[i] - 1));
  const at = (x, y, z) => x + nx * (y + ny * z);
  const point = (x, y, z) => [min[0] + x * spacing[0], min[1] + y * spacing[1], min[2] + z * spacing[2]];
  const values = new Float32Array(nx * ny * nz);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) values[at(x, y, z)] = field(...point(x, y, z));
  const corners = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
  const tetra = [[0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6]];
  const positions = [], normals = [];
  function vertex(a, b, va, vb) {
    const t = va / (va - vb), p = a.map((v, i) => v + (b[i] - v) * t), [x, y, z] = p, eps = .001;
    const n = [field(x + eps, y, z) - field(x - eps, y, z), field(x, y + eps, z) - field(x, y - eps, z), field(x, y, z + eps) - field(x, y, z - eps)];
    const length = Math.hypot(...n) || 1; return { p, n: n.map(v => v / length) };
  }
  function triangle(a, b, c) {
    const ab = b.p.map((v, i) => v - a.p[i]), ac = c.p.map((v, i) => v - a.p[i]);
    const n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    if (Math.hypot(...n) < 1e-10) return;
    if (n.reduce((sum, v, i) => sum + v * (a.n[i] + b.n[i] + c.n[i]), 0) < 0) [b, c] = [c, b];
    for (const v of [a, b, c]) { positions.push(...v.p); normals.push(...v.n); }
  }
  for (let z = 0; z < nz - 1; z++) for (let y = 0; y < ny - 1; y++) for (let x = 0; x < nx - 1; x++) {
    const vs = corners.map(([cx, cy, cz]) => values[at(x + cx, y + cy, z + cz)]);
    if (vs.every(v => v >= 0) || vs.every(v => v < 0)) continue;
    const ps = corners.map(([cx, cy, cz]) => point(x + cx, y + cy, z + cz));
    for (const t of tetra) {
      const inside = t.filter(i => vs[i] < 0), outside = t.filter(i => vs[i] >= 0);
      if (!inside.length || !outside.length) continue;
      const edge = (a, b) => vertex(ps[a], ps[b], vs[a], vs[b]);
      if (inside.length === 1) triangle(...outside.map(b => edge(inside[0], b)));
      else if (outside.length === 1) triangle(...inside.map(a => edge(a, outside[0])));
      else { const [a, b] = inside, [c, d] = outside, ac = edge(a, c), ad = edge(a, d), bc = edge(b, c), bd = edge(b, d); triangle(ac, ad, bc); triangle(ad, bd, bc); }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}
function influences(x, y, z) {
  // Each leg's skin blends around the shoulder, knee and fetlock. The torso
  // remains on the root bone instead of stretching across opposing legs.
  if (y < 1.55 && Math.abs(z) > .34) {
    const index = (z < 0 ? 2 : 0) + (x > 0 ? 1 : 0), base = 3 + index * 3;
    const limb = 1 - smooth(1.09, 1.56, y), knee = 1 - smooth(.68, .93, y), ankle = 1 - smooth(.20, .36, y);
    return [[0, base, base + 1, base + 2], [1 - limb, limb * (1 - knee), limb * knee * (1 - ankle), limb * knee * ankle]];
  }
  const neck = smooth(1.95, 2.45, y) * smooth(.45, 1.05, z), head = smooth(1.20, 1.47, z);
  return [[0, 1, 2, 0], [1 - neck, neck * (1 - head), neck * head, 0]];
}
function skinGeometry(geometry, color, weights = influences) {
  const p = geometry.attributes.position, colors = [], indices = [], values = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const c = typeof color === 'function' ? color(x, y, z) : new THREE.Color(color);
    colors.push(c.r, c.g, c.b); const [ix, w] = weights(x, y, z); indices.push(...ix); values.push(...w);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(values, 4));
  geometry.computeBoundingSphere(); return geometry;
}
function tube(points, radius, segments = 16, sides = 7) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), segments, radius, sides, false);
}
function loft(rings, sides = 12) {
  const positions = [], indices = [];
  // Rings contain center x/y/z, half-width and half-depth, along a mostly
  // vertical path. Used for pointed ears and long tapered strands of hair.
  rings.forEach(([x, y, z, rx, rz]) => { for (let i = 0; i < sides; i++) { const a = i / sides * Math.PI * 2; positions.push(x + Math.cos(a) * rx, y, z + Math.sin(a) * rz); } });
  const ascending = rings.at(-1)[1] > rings[0][1];
  for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < sides; i++) { const a = r * sides + i, b = r * sides + (i + 1) % sides, c = a + sides, d = b + sides; if (ascending) indices.push(a, c, b, b, c, d); else indices.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setIndex(indices); g.computeVertexNormals(); return g;
}
function merge(geometries) {
  const result = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color', 'skinIndex', 'skinWeight']) {
    const values = [], size = geometries[0].attributes[name].itemSize;
    for (const g of geometries) for (const v of g.attributes[name].array) values.push(v);
    result.setAttribute(name, name === 'skinIndex' ? new THREE.Uint16BufferAttribute(values, size) : new THREE.Float32BufferAttribute(values, size));
  }
  for (const g of geometries) g.dispose(); result.computeBoundingSphere(); return result;
}

export function createHorseResources() {
  const brown = new THREE.Color('#966647'), underside = new THREE.Color('#735441'), dark = new THREE.Color('#332e2b'), muzzle = new THREE.Color('#61514a'), blaze = new THREE.Color('#d9cab0');
  const coat = skinGeometry(sculpt(coatField), (x, y, z) => {
    const c = brown.clone().lerp(underside, (1 - smooth(1.22, 1.8, y)) * .36);
    if (y < .69) c.lerp(dark, 1 - smooth(.28, .73, y));
    if (z > 1.72) c.lerp(muzzle, smooth(1.70, 1.93, z));
    // A narrow irregular blaze lies on the forehead itself, not on a plate.
    const width = .037 + .021 * Math.sin(y * 17 + z * 3);
    if (y > 2.47 && z > 1.48 && Math.abs(x) < width) c.lerp(blaze, .94);
    return c;
  });
  const details = [];
  const rigid = bone => () => [[bone, 0, 0, 0], [1, 0, 0, 0]];
  function add(g, color, weight = influences) { const plain = g.index ? g.toNonIndexed() : g; if (plain !== g) g.dispose(); details.push(skinGeometry(plain, color, weight)); }
  function ell(center, scale, color, bone = 2) {
    const g = new THREE.SphereGeometry(1, 14, 10); g.scale(...scale); g.translate(...center); add(g, color, rigid(bone));
  }
  for (const side of [-1, 1]) {
    // Ears taper from a folded base to the tip, with recessed inner cartilage.
    add(loft([[side * .145, 2.98, 1.22, .085, .075], [side * .18, 3.11, 1.17, .086, .055], [side * .205, 3.29, 1.18, .040, .024], [side * .20, 3.35, 1.19, .003, .003]]), '#916044', rigid(2));
    add(loft([[side * .177, 3.085, 1.222, .046, .007], [side * .19, 3.19, 1.214, .041, .008], [side * .203, 3.29, 1.20, .004, .002]]), '#534136', rigid(2));
    ell([side * .221, 2.798, 1.443], [.037, .045, .061], '#261f1a');
    ell([side * .245, 2.807, 1.47], [.012, .015, .018], '#e0d8c4');
    // Dark inset nostrils follow the soft muzzle rather than an extra snout.
    ell([side * .164, 2.522, 1.983], [.014, .042, .057], '#302624');
    add(tube([[side * .15, 2.422, 2.01], [side * .18, 2.402, 1.91], [side * .17, 2.42, 1.80]], .008, 10, 5), '#42332c', rigid(2));
    // Brow and cheek straps, noseband, then loose reins to the saddle.
    add(tube([[side * .16, 3.005, 1.20], [side * .236, 2.90, 1.33], [side * .24, 2.70, 1.53], [side * .218, 2.49, 1.81]], .021), '#46312a', rigid(2));
    add(tube([[side * .224, 2.49, 1.81], [side * .38, 2.28, 1.2], [side * .37, 2.15, .40], [side * .30, 2.20, -.11]], .015), '#554033');
    ell([side * .232, 2.48, 1.81], [.014, .044, .044], '#b7a26e');
  }
  add(tube([[-.225, 2.54, 1.84], [0, 2.615, 1.955], [.225, 2.54, 1.84]], .026), '#4f362a', rigid(2));
  add(tube([[-.21, 2.93, 1.36], [0, 3.02, 1.44], [.21, 2.93, 1.36]], .022), '#5c4130', rigid(2));
  // The mane is a flowing, tapered crest with a few long locks down one side.
  add(loft([[.075, 2.99, 1.17, .012, .03], [.08, 2.84, 1.07, .12, .14], [.09, 2.60, .85, .14, .16], [.095, 2.34, .62, .14, .15], [.09, 2.12, .41, .11, .12], [.11, 1.97, .34, .003, .003]]), '#322d27');
  for (let i = 0; i < 6; i++) {
    const y = 2.86 - i * .125, z = 1.045 - i * .106;
    add(tube([[.115, y, z], [.225, y - .13, z - .015], [.245, y - .27, z + .02]], .014, 10, 5), i % 2 ? '#41382e' : '#292820');
  }
  add(loft([[0, 3.055, 1.29, .07, .06], [.015, 2.975, 1.42, .09, .075], [.035, 2.90, 1.52, .07, .035], [.075, 2.84, 1.545, .003, .003]]), '#3d3228', rigid(2));
  add(loft([[0, 1.76, -1.08, .11, .12], [.01, 1.56, -1.30, .15, .14], [.03, 1.21, -1.43, .17, .14], [.06, .82, -1.43, .15, .11], [.10, .53, -1.36, .085, .065], [.12, .40, -1.29, .002, .002]]), '#352e27', rigid(15));
  for (let i = -1; i <= 1; i++) add(tube([[i * .07, 1.6, -1.42], [i * .07 + .025, 1.12, -1.575], [i * .05 + .08, .57, -1.415]], .010, 14, 5), '#514033', rigid(15));
  // A cloth saddle pad drapes over the barrel; its curved seat retains the
  // existing rider height and root origin used by the multiplayer client.
  const padPositions = [], padIndices = [];
  for (let z = 0; z <= 8; z++) for (let ring = 0; ring <= 20; ring++) {
    const a = -.5 * Math.PI + ring / 20 * Math.PI, depth = -.64 + z / 8 * .97;
    padPositions.push(Math.sin(a) * .535, 1.57 + Math.cos(a) * (.493 + .025 * Math.sin(z / 8 * Math.PI)), depth);
  }
  for (let z = 0; z < 8; z++) for (let i = 0; i < 20; i++) { const a = z * 21 + i; padIndices.push(a, a + 21, a + 1, a + 1, a + 21, a + 22); }
  const pad = new THREE.BufferGeometry(); pad.setAttribute('position', new THREE.Float32BufferAttribute(padPositions, 3)); pad.setIndex(padIndices); pad.computeVertexNormals(); add(pad, '#7d3030', rigid(0));
  for (const z of [-.65, .34]) {
    const points = Array.from({ length: 13 }, (_, i) => { const a = -Math.PI / 2 + i / 12 * Math.PI; return [Math.sin(a) * .54, 1.575 + Math.cos(a) * .505, z]; });
    add(tube(points, .017, 24, 5), '#b69b60', rigid(0));
  }
  ell([0, 2.018, -.14], [.345, .10, .43], '#654432', 0);
  add(tube([[-.30, 2.10, .19], [0, 2.22, .21], [.30, 2.10, .19]], .062), '#51342a', rigid(0));
  add(tube([[-.34, 2.08, -.52], [0, 2.225, -.53], [.34, 2.08, -.52]], .066), '#57392c', rigid(0));
  for (const side of [-1, 1]) {
    add(loft([[side * .39, 1.99, -.12, .013, .31], [side * .505, 1.78, -.15, .017, .29], [side * .505, 1.52, -.17, .012, .14], [side * .493, 1.49, -.17, .006, .05]]), '#624231', rigid(0));
    add(tube([[side * .45, 1.98, -.07], [side * .55, 1.65, -.10], [side * .54, 1.30, -.10]], .029), '#3d2f27', rigid(0));
    add(tube([[side * .54, 1.37, -.10], [side * .55, 1.22, -.23], [side * .55, 1.16, -.10], [side * .55, 1.22, .03], [side * .54, 1.37, -.10]], .024), '#aaa18a', rigid(0));
  }
  const tack = merge(details);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .88 });
  let disposed = false;
  return { coat, tack, material, dispose() { if (disposed) return; disposed = true; coat.dispose(); tack.dispose(); material.dispose(); } };
}

export function createHorseModel(id = 'horse', sharedResources) {
  const resources = sharedResources ?? createHorseResources(), group = new THREE.Group(); group.name = `horse-${id}`;
  const body = new THREE.Bone(); body.name = 'horse-body'; group.add(body);
  const neck = new THREE.Bone(); neck.position.set(0, 2.04, .72); body.add(neck);
  const head = new THREE.Bone(); head.position.set(0, .68, .50); neck.add(head);
  const bones = [body, neck, head], legs = [];
  for (const j of joints) {
    const upper = new THREE.Bone(); upper.position.set(...j.hip); body.add(upper);
    const lower = new THREE.Bone(); lower.position.fromArray(j.knee).sub(new THREE.Vector3(...j.hip)); upper.add(lower);
    const foot = new THREE.Bone(); foot.position.fromArray(j.ankle).sub(new THREE.Vector3(...j.knee)); lower.add(foot);
    bones.push(upper, lower, foot); legs.push({ upper, lower, foot, front: j.front });
  }
  const tail = new THREE.Bone(); tail.position.set(0, 1.76, -1.08); body.add(tail); bones.push(tail);
  group.updateMatrixWorld(true); const skeleton = new THREE.Skeleton(bones);
  for (const [name, geometry] of [['Continuous horse coat', resources.coat], ['Fitted horse tack and mane', resources.tack]]) {
    const mesh = new THREE.SkinnedMesh(geometry, resources.material); mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; group.add(mesh); mesh.bind(skeleton);
  }
  const phaseOffset = Array.from(String(id)).reduce((v, ch) => (v * 31 + ch.charCodeAt(0)) % 1009, 0) / 1009 * Math.PI * 2;
  let phase = phaseOffset, movingAmount = 0, disposed = false;
  return {
    group, skeleton, legs,
    update(dt = 1 / 60, time = 0, { moving = false, cartId = null, speed } = {}) {
      dt = clamp(Number(dt) || 0, 0, .1); time = Number(time) || 0;
      movingAmount += ((moving ? 1 : 0) - movingAmount) * (1 - Math.exp(-dt * 9));
      const speedScale = Number.isFinite(speed) ? clamp(speed / 10.5, 0, 1.5) : 1;
      phase = (phase + dt * (cartId ? 8.2 : 10.2) * movingAmount * speedScale) % (Math.PI * 2);
      // Diagonal pairs trot. Knees flex only in the swing phase; lower legs
      // counter-rotate through stance so hooves no longer sweep like stilts.
      legs.forEach((leg, i) => {
        const p = phase + [0, Math.PI, Math.PI, 0][i], swing = Math.sin(p), lift = Math.pow(Math.max(0, -Math.cos(p)), 2);
        leg.upper.rotation.x = swing * (leg.front ? .44 : .40) * movingAmount;
        leg.lower.rotation.x = (leg.front ? -.72 : .79) * lift * movingAmount;
        leg.foot.rotation.x = (-leg.upper.rotation.x - leg.lower.rotation.x) * .56;
      });
      body.position.y = Math.sin(phase * 2) * .032 * movingAmount + Math.sin(time * 1.7 + phaseOffset) * .007 * (1 - movingAmount);
      body.rotation.z = Math.sin(phase) * .012 * movingAmount;
      neck.rotation.x = Math.sin(phase * 2 + .4) * .021 * movingAmount + Math.sin(time * .8 + phaseOffset) * .013;
      head.rotation.x = -neck.rotation.x * .6;
      head.rotation.y = Math.sin(time * .54 + phaseOffset) * .035 * (1 - movingAmount);
      tail.rotation.z = Math.sin(time * 1.85 + phaseOffset) * (.065 + movingAmount * .03);
      tail.rotation.x = -.075 * movingAmount;
    },
    dispose() { if (disposed) return; disposed = true; skeleton.dispose(); group.removeFromParent(); if (!sharedResources) resources.dispose(); }
  };
}
