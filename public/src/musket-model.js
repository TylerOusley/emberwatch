import * as THREE from 'three';

// Shared, original flintlock geometry: three material batches per weapon. The
// closed hand grips the origin; +Y points toward the muzzle at 1.05 meters.
let template;
function buildTemplate() {
  const root = new THREE.Group(), batches = new Map();
  function part(geometry, material, color, position = [0, 0, 0], rotation = [0, 0, 0]) {
    const source = geometry.index ? geometry.toNonIndexed() : geometry;
    const transform = new THREE.Matrix4().compose(new THREE.Vector3(...position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(1, 1, 1));
    source.applyMatrix4(transform);
    const batch = batches.get(material) || { positions: [], normals: [], colors: [] }, tint = new THREE.Color(color);
    batch.positions.push(...source.attributes.position.array); batch.normals.push(...source.attributes.normal.array);
    for (let i = 0; i < source.attributes.position.count; i++) batch.colors.push(tint.r, tint.g, tint.b);
    batches.set(material, batch); source.dispose(); if (source !== geometry) geometry.dispose();
  }
  const stock = new THREE.Shape();
  stock.moveTo(-.055, .69); stock.lineTo(.058, .69); stock.lineTo(.055, -.13);
  stock.lineTo(.105, -.39); stock.quadraticCurveTo(.01, -.46, -.19, -.41);
  stock.lineTo(-.14, -.2); stock.quadraticCurveTo(-.045, -.1, -.055, .12); stock.closePath();
  part(new THREE.ExtrudeGeometry(stock, { depth: .072, bevelEnabled: true, bevelThickness: .008, bevelSize: .008, bevelSegments: 1, steps: 1 }), 'wood', '#845330', [0, 0, -.036]);
  for (let i = 0; i < 3; i++) part(new THREE.BoxGeometry(.012, .47, .003), 'wood', i % 2 ? '#9c6940' : '#654126', [-.033 + i * .025, .34, .045]);
  part(new THREE.CylinderGeometry(.031, .036, 1.02, 12), 'steel', '#707f87', [.02, .535, .06]);
  part(new THREE.CylinderGeometry(.022, .022, .003, 12), 'steel', '#192321', [.02, 1.047, .06]);
  part(new THREE.CylinderGeometry(.008, .009, .76, 8), 'steel', '#acb4ac', [-.043, .48, .063]);
  for (const y of [.2, .49, .72]) part(new THREE.BoxGeometry(.14, .031, .106), 'brass', '#b79754', [.005, y, .024]);
  part(new THREE.BoxGeometry(.014, .14, .084), 'steel', '#939991', [.071, -.022, .025]);
  part(new THREE.BoxGeometry(.036, .11, .026), 'steel', '#5c686d', [.088, .06, .064], [0, 0, -.45]);
  part(new THREE.BoxGeometry(.035, .035, .05), 'steel', '#bbc1aa', [.112, .103, .064]);
  part(new THREE.TorusGeometry(.047, .008, 5, 12), 'brass', '#ad8b45', [.079, -.1, .008], [0, Math.PI / 2, 0]);
  part(new THREE.BoxGeometry(.012, .048, .015), 'steel', '#495658', [.08, -.078, .008], [.25, 0, 0]);
  part(new THREE.BoxGeometry(.017, .038, .013), 'steel', '#232e30', [.02, .995, .094]);
  for (const [name, batch] of batches) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(batch.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(batch.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(batch.colors, 3));
    geometry.computeBoundingSphere();
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: name === 'wood' ? .84 : .43, metalness: name === 'wood' ? 0 : .65 });
    const mesh = new THREE.Mesh(geometry, material); mesh.name = `musket-${name}`; mesh.castShadow = true; mesh.receiveShadow = true;
    root.add(mesh);
  }
  const muzzle = new THREE.Object3D(); muzzle.name = 'musket-muzzle'; muzzle.position.set(.02, 1.05, .06); root.add(muzzle);
  return root;
}
export function createMusketModel() {
  template ??= buildTemplate();
  const model = template.clone(true); model.name = 'flintlock-musket';
  // Meshes share immutable geometry/materials with every musket. Removing one
  // actor must never dispose assets still used by another player or troop.
  model.userData.dispose = () => {};
  return model;
}
