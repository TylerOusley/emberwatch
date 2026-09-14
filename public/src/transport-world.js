import * as THREE from 'three';
import { BUILDINGS } from '/shared/world.js';

// Original low-poly riding horses and cargo carts, sharing a small geometry pool.
export function createTransportWorld(scene) {
  const root = new THREE.Group(); root.name = 'Emberwatch • transport'; scene.add(root);
  const horses = new Map(), carts = new Map();
  const box = new THREE.BoxGeometry(1, 1, 1), round = new THREE.CylinderGeometry(1, 1, 1, 10), soft = new THREE.IcosahedronGeometry(1, 1);
  const material = color => new THREE.MeshStandardMaterial({ color, roughness: .92, flatShading: true });
  const m = { coat: material('#8b5b3e'), dark: material('#342d26'), white: material('#d7c7a5'), leather: material('#6b382b'), wood: material('#987144'), iron: material('#404c4b'), cargo: material('#a99567') };
  let time = 0;
  function part(parent, geometry, mat, position, scale) {
    const mesh = new THREE.Mesh(geometry, mat); mesh.position.set(...position); mesh.scale.set(...scale); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  function horseMesh(id) {
    const group = new THREE.Group(); group.name = `horse-${id}`;
    const body = new THREE.Group(); group.add(body);
    part(body, soft, m.coat, [0, 1.55, 0], [.63, .66, 1.23]);
    const neck = part(body, soft, m.coat, [0, 2.02, .94], [.38, .86, .43]); neck.rotation.x = -.3;
    part(body, soft, m.coat, [0, 2.65, 1.26], [.34, .42, .62]);
    part(body, soft, m.dark, [0, 2.48, 1.7], [.29, .2, .22]);
    part(body, box, m.white, [0, 2.77, 1.67], [.12, .32, .03]);
    for (const side of [-1, 1]) {
      part(body, soft, m.coat, [side * .2, 3.05, 1.03], [.12, .3, .1]);
      part(body, soft, m.dark, [side * .31, 2.75, 1.4], [.055, .06, .07]);
    }
    for (let index = 0; index < 5; index++) part(body, box, m.dark, [0, 2.79 - index * .17, .8 - index * .075], [.16, .35, .18]);
    part(body, box, m.leather, [0, 2.03, -.16], [.8, .18, .83]);
    part(body, box, m.white, [0, 1.98, -.16], [.9, .08, 1.0]);
    const tail = part(body, soft, m.dark, [0, 1.3, -1.25], [.15, .75, .2]); tail.rotation.x = -.35;
    const legs = [];
    for (const side of [-1, 1]) for (const end of [-1, 1]) {
      const leg = new THREE.Group(); leg.position.set(side * .42, 1.48, end * .74); group.add(leg);
      part(leg, box, m.coat, [0, -.49, 0], [.21, .98, .23]);
      part(leg, box, m.dark, [0, -1.17, .05], [.24, .27, .32]);
      legs.push(leg);
    }
    group.userData = { body, legs, tail, phase: id.charCodeAt(0) }; root.add(group); return group;
  }
  function cartMesh(id) {
    const group = new THREE.Group(); group.name = `cart-${id}`;
    for (let i = 0; i < 6; i++) part(group, box, m.wood, [(i - 2.5) * .29, .68, 0], [.27, .15, 2]);
    for (const side of [-1, 1]) {
      for (let height = 0; height < 3; height++) part(group, box, m.wood, [side * .92, .88 + height * .24, 0], [.12, .18, 2.1]);
      part(group, box, m.wood, [side * .6, .55, 1.8], [.1, .11, 2]);
    }
    for (const end of [-1, 1]) for (let height = 0; height < 3; height++) part(group, box, m.wood, [0, .88 + height * .24, end * .98], [1.75, .18, .13]);
    part(group, box, m.iron, [0, .57, -.1], [2.5, .14, .14]);
    const wheels = [];
    for (const side of [-1, 1]) {
      const wheel = new THREE.Group(); wheel.position.set(side * 1.17, .57, -.1); group.add(wheel);
      const rim = part(wheel, round, m.dark, [0, 0, 0], [.54, .15, .54]); rim.rotation.z = Math.PI / 2;
      for (let spoke = 0; spoke < 4; spoke++) {
        const beam = part(wheel, box, m.wood, [side * .09, 0, 0], [.03, .9, .07]); beam.rotation.x = spoke * Math.PI / 4;
      }
      part(wheel, soft, m.iron, [side * .12, 0, 0], [.13, .12, .12]); wheels.push(wheel);
    }
    const cargo = new THREE.Group(); group.add(cargo);
    for (const side of [-1, 1]) part(cargo, soft, m.cargo, [side * .39, 1, 0], [.4, .46, .7]);
    group.userData = { wheels, cargo }; root.add(group); return group;
  }
  function sync(map, entities, make, dt, animate) {
    const ids = new Set();
    for (const entity of entities ?? []) {
      ids.add(entity.id);
      let mesh = map.get(entity.id);
      if (!mesh) { mesh = make(entity.id); mesh.position.set(entity.x, 0, entity.z); mesh.rotation.y = entity.yaw ?? 0; map.set(entity.id, mesh); }
      const distance = Math.hypot(mesh.position.x - entity.x, mesh.position.z - entity.z);
      const blend = distance > 12 ? 1 : 1 - Math.exp(-14 * dt);
      mesh.position.x += (entity.x - mesh.position.x) * blend; mesh.position.z += (entity.z - mesh.position.z) * blend;
      const turn = Math.atan2(Math.sin((entity.yaw ?? 0) - mesh.rotation.y), Math.cos((entity.yaw ?? 0) - mesh.rotation.y)); mesh.rotation.y += turn * blend;
      animate(mesh, entity, distance, dt);
    }
    for (const [id, mesh] of map) if (!ids.has(id)) { root.remove(mesh); map.delete(id); }
  }
  return {
    root,
    update(state, dt = 1 / 60) {
      if (!state) return; dt = Math.min(.1, Math.max(0, dt)); time += dt;
      const stable = BUILDINGS.find(building => building.id === 'stable');
      const stock = stable ? Array.from({ length: Math.min(3, Math.max(0, state.stable?.stock ?? 0)) }, (_, index) => ({ id: `stable-stock-${index}`, x: stable.x - 2 + index * 3, z: stable.z + 9.5, yaw: -Math.PI / 2, moving: false })) : [];
      sync(horses, [...(state.horses ?? []), ...stock], horseMesh, dt, (mesh, horse) => {
        const moving = horse.moving, phase = time * (horse.cartId ? 9 : 11) + mesh.userData.phase;
        mesh.userData.legs.forEach((leg, index) => { leg.rotation.x = moving ? Math.sin(phase + [0, Math.PI, Math.PI, 0][index]) * .57 : 0; });
        mesh.userData.body.position.y = moving ? Math.sin(phase * 2) * .055 : Math.sin(time * 2) * .015;
        mesh.userData.tail.rotation.z = Math.sin(time * 2.3 + mesh.userData.phase) * .1;
      });
      sync(carts, state.carts, cartMesh, dt, (mesh, cart, distance) => {
        mesh.userData.wheels.forEach(wheel => { wheel.rotation.x += distance * .32; });
        mesh.userData.cargo.visible = (cart.weight ?? 0) > 0;
      });
    },
    dispose() {
      scene.remove(root); horses.clear(); carts.clear();
      for (const geometry of [box, round, soft]) geometry.dispose();
      for (const mat of Object.values(m)) mat.dispose();
    }
  };
}
