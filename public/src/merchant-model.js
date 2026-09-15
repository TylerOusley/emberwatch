import * as THREE from 'three';
import { createCharacter } from './characters.js';
import { createHorseModel } from './horse-model.js';

// The visiting caravan is scenery, not a second set of player-owned horses.
// Its entire lifetime and visibility follows the authoritative merchant state.
export function createMerchantVisit(building, horseResources) {
  const group = new THREE.Group(); group.name = 'merchant-visit';
  group.position.set(building.x, 0, building.z); group.rotation.y = building.yaw ?? 0;
  const owned = new Set(), materials = new Set();
  const mat = (color, extra = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: .9, ...extra }); materials.add(m); return m;
  };
  const wood = mat('#805b37'), lightWood = mat('#af8553'), dark = mat('#392d26'), iron = mat('#425050', { metalness: .4 }),
    plum = mat('#79617f', { side: THREE.DoubleSide }), cream = mat('#dbc497', { side: THREE.DoubleSide }),
    leather = mat('#5a392b'), brass = mat('#c3a263', { metalness: .5, roughness: .45 }), sacks = mat('#ad9770');
  const box = new THREE.BoxGeometry(1, 1, 1), sphere = new THREE.SphereGeometry(1, 14, 10);
  owned.add(box); owned.add(sphere);
  function part(parent, geometry, material, position = [0, 0, 0], scale = [1, 1, 1]) {
    owned.add(geometry);
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(...position); mesh.scale.set(...scale);
    mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  function beam(parent, material, a, b, width = .08, depth = width) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), delta = end.clone().sub(start);
    const mesh = part(parent, box, material, start.add(end).multiplyScalar(.5).toArray(), [width, delta.length(), depth]);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()); return mesh;
  }
  function tube(parent, material, points, radius = .024, segments = 24) {
    return part(parent, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), segments, radius, 6, false), material);
  }
  // Merge only the rigid caravan artwork. Characters keep their independent
  // bones, and horse meshes keep the geometry shared by all village horses.
  function batch(root) {
    const batches = new Map(); root.updateMatrixWorld(true);
    root.traverse(mesh => {
      if (!mesh.isMesh) return;
      const entries = batches.get(mesh.material) ?? []; entries.push(mesh); batches.set(mesh.material, entries);
    });
    for (const [material, meshes] of batches) {
      const positions = [], normals = [];
      for (const mesh of meshes) {
        const transformed = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld), plain = transformed.index ? transformed.toNonIndexed() : transformed;
        for (const value of plain.attributes.position.array) positions.push(value);
        for (const value of plain.attributes.normal.array) normals.push(value);
        if (plain !== transformed) plain.dispose(); transformed.dispose(); mesh.removeFromParent();
      }
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3)); geometry.computeBoundingSphere();
      part(root, geometry, material);
    }
  }

  const merchant = createCharacter('villager', 17); merchant.setTool(''); merchant.group.name = 'wayfarer-merchant';
  // Clone the affected materials: changing an NPC's coat must never recolor
  // villagers that share the fitted-clothing material cache.
  const recolored = new Map();
  merchant.group.traverse(mesh => {
    if (!mesh.isMesh) return;
    const isCap = mesh.name === 'soft stitched leather cap';
    if (mesh.material.color?.getHex() !== 0x60765b && !isCap) return;
    if (!recolored.has(mesh.material)) {
      const copy = mesh.material.clone(); copy.color.set(isCap ? '#694c70' : '#79617f');
      recolored.set(mesh.material, copy); materials.add(copy);
    }
    mesh.material = recolored.get(mesh.material);
  });
  const chest = merchant.group.getObjectByName('body');
  part(chest, sphere, brass, [.17, .39, .241], [.044, .052, .014]).name = 'merchant-gold-brooch';
  const localDepth = Math.abs(Math.sin(building.yaw ?? 0)) > .5 ? building.w : building.d;
  merchant.group.position.set(0, 1.275, localDepth * .28); group.add(merchant.group);

  const carriage = new THREE.Group(); carriage.name = 'wayfarer-carriage';
  for (let i = 0; i < 7; i++) part(carriage, box, i % 2 ? wood : lightWood, [(i - 3) * .3, .96, 0], [.285, .16, 3.5]);
  for (const side of [-1, 1]) {
    for (let row = 0; row < 3; row++) part(carriage, box, wood, [side * 1.02, 1.2 + row * .22, 0], [.12, .19, 3.5]);
    for (const z of [-1.56, 1.45]) part(carriage, box, dark, [side * 1.04, 1.49, z], [.15, 1.03, .15]);
    part(carriage, box, brass, [side * 1.091, 1.77, -.1], [.025, .045, 3.2]);
  }
  for (let row = 0; row < 3; row++) part(carriage, box, lightWood, [0, 1.2 + row * .22, -1.72], [2, .19, .12]);
  for (const z of [-1.23, 1.23]) {
    part(carriage, box, iron, [0, .68, z], [2.7, .13, .13]);
    for (const side of [-1, 1]) {
      const wheel = new THREE.Group(); wheel.position.set(side * 1.29, .68, z); carriage.add(wheel);
      const rim = part(wheel, new THREE.TorusGeometry(.58, .075, 8, 28), iron); rim.rotation.y = Math.PI / 2;
      const woodRim = part(wheel, new THREE.TorusGeometry(.49, .074, 8, 24), lightWood); woodRim.rotation.y = Math.PI / 2;
      for (let spoke = 0; spoke < 10; spoke++) {
        const angle = spoke / 10 * Math.PI * 2;
        beam(wheel, lightWood, [0, 0, 0], [0, Math.sin(angle) * .49, Math.cos(angle) * .49], .064);
      }
      const hub = part(wheel, new THREE.CylinderGeometry(.13, .13, .32, 12), brass); hub.rotation.z = Math.PI / 2;
    }
  }
  // A curved canvas cover, with alternating cloth panels and exposed ribs.
  for (let panel = 0; panel < 9; panel++) {
    const positions = [], indices = [];
    for (let row = 0; row <= 10; row++) for (let segment = 0; segment <= 4; segment++) {
      const angle = (panel + segment / 4) / 9 * Math.PI, z = -1.74 + row / 10 * 2.94;
      positions.push(Math.cos(angle) * 1.1, 2.02 + Math.sin(angle) * 1.16 - Math.sin(row / 10 * Math.PI * 4) ** 2 * .025, z);
    }
    for (let row = 0; row < 10; row++) for (let segment = 0; segment < 4; segment++) {
      const a = row * 5 + segment; indices.push(a, a + 1, a + 5, a + 1, a + 6, a + 5);
    }
    const canvas = new THREE.BufferGeometry(); canvas.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); canvas.setIndex(indices); canvas.computeVertexNormals();
    part(carriage, canvas, panel % 2 ? cream : plum);
  }
  for (const z of [-1.75, -.99, -.23, .53, 1.21]) {
    tube(carriage, lightWood, Array.from({ length: 15 }, (_, i) => {
      const angle = i / 14 * Math.PI; return [Math.cos(angle) * 1.115, 2.026 + Math.sin(angle) * 1.174, z];
    }), .027, 28);
  }
  // Driver's bench, entry step, packed goods, torch brackets and a towing pole.
  part(carriage, box, dark, [0, 1.64, 1.40], [1.88, .14, .68]);
  part(carriage, box, leather, [0, 1.72, 1.43], [1.75, .08, .56]);
  part(carriage, box, wood, [0, 1.96, 1.12], [1.87, .42, .11]);
  for (const side of [-1, 1]) {
    part(carriage, box, iron, [side * 1.20, .83, .44], [.44, .08, .58]);
    beam(carriage, iron, [side * 1.02, 1.73, 1.4], [side * 1.20, 1.73, 1.9], .06);
    beam(carriage, wood, [side * 1.20, 1.70, 1.9], [side * 1.20, 2.35, 1.9], .09);
    part(carriage, new THREE.CylinderGeometry(.095,.13,.23,8), dark, [side * 1.20, 2.32, 1.9]);
    for (const y of [2.22,2.37]) part(carriage, box, iron, [side * 1.20, y, 1.9], [.24,.045,.24]);
    part(carriage, sphere, sacks, [side * .49, 1.37, -.91], [.43, .43, .57]);
    part(carriage, sphere, dark, [side * .49, 1.78, -.91], [.095, .07, .095]);
  }
  const crate = new THREE.Group(); carriage.add(crate);
  part(crate, box, lightWood, [0, 1.39, -.08], [.79, .69, .74]);
  for (const y of [1.09, 1.66]) part(crate, box, dark, [0, y, -.08], [.83, .075, .79]);
  beam(crate, wood, [-.38, 1.09, .302], [.38, 1.66, .302], .065);
  beam(carriage, dark, [0, .83, 1.45], [0, 1.15, 7.42], .11);
  beam(carriage, wood, [-1.39, 1.16, 5.05], [1.39, 1.16, 5.05], .10);
  for (const side of [-1, 1]) for (const flank of [-1, 1]) {
    const x = side * .88 + flank * .40;
    tube(carriage, leather, [[x, 1.18, 5.06], [x, 1.29, 6.12], [x, 1.5, 7.48]], .022);
  }
  batch(carriage); carriage.position.set(7.4, 0, 0); group.add(carriage);
  const horses = [-1, 1].map((side, i) => {
    const horse = createHorseModel(`wayfarer-team-${i}`, horseResources);
    horse.group.position.set(7.4 + side * .88, 0, 6.8); group.add(horse.group); return horse;
  });
  group.userData.decorative = true;
  let disposed = false;
  return {
    group, merchant, carriage, horses,
    getTorchFixtures() {
      if(disposed||!group.visible)return [];
      group.updateMatrixWorld(true);
      return [-1,1].map((side,i)=>{const p=new THREE.Vector3(7.4+side*1.20,2.44,1.9).applyMatrix4(group.matrixWorld);return {id:`merchant-torch-${i}`,x:p.x,y:p.y,z:p.z,mount:'existing',height:.64,alwaysLit:false,seed:.24+i*.31};});
    },
    update(dt, time) {
      if (disposed || !group.visible) return;
      merchant.update(dt, time, { moving: false });
      for (const horse of horses) horse.update(dt, time, { moving: false, cartId: 'wayfarer-carriage' });
    },
    dispose() {
      if (disposed) return; disposed = true;
      merchant.dispose(); for (const horse of horses) horse.dispose();
      group.removeFromParent(); group.clear();
      for (const geometry of owned) geometry.dispose();
      for (const material of materials) material.dispose();
    }
  };
}
