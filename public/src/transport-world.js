import * as THREE from 'three';
import { BUILDINGS, groundHeight } from '/shared/world.js';
import { createHorseModel, createHorseResources } from './horse-model.js';
import { createMerchantVisit } from './merchant-model.js';

// Sculpted riding horses and cargo carts, sharing geometry between instances.
export function createTransportWorld(scene) {
  const root = new THREE.Group(); root.name = 'Emberwatch • transport'; scene.add(root);
  const horses = new Map(), carts = new Map();
  const horseResources = createHorseResources();
  const box = new THREE.BoxGeometry(1, 1, 1), round = new THREE.CylinderGeometry(1, 1, 1, 10), soft = new THREE.IcosahedronGeometry(1, 1);
  const material = color => new THREE.MeshStandardMaterial({ color, roughness: .92, flatShading: true });
  const m = { coat: material('#8b5b3e'), dark: material('#342d26'), white: material('#d7c7a5'), leather: material('#6b382b'), wood: material('#987144'), iron: material('#404c4b'), cargo: material('#a99567') };
  const merchantStall = BUILDINGS.find(building => building.id === 'merchant');
  let time = 0, merchantVisit = null, disposed = false;
  function part(parent, geometry, mat, position, scale) {
    const mesh = new THREE.Mesh(geometry, mat); mesh.position.set(...position); mesh.scale.set(...scale); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  function horseMesh(id) {
    const actor = createHorseModel(id, horseResources);
    actor.group.userData.actor = actor; root.add(actor.group); return actor.group;
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
    // A real rear storage chest replaces the old floating-cargo impression.
    const chest = new THREE.Group(); chest.position.set(0, .86, -1.18); group.add(chest);
    part(chest, box, m.dark, [0, .25, 0], [1.25, .48, .62]);
    part(chest, box, m.wood, [0, .27, 0], [1.12, .38, .56]);
    const lidPivot = new THREE.Group(); lidPivot.position.set(0, .52, -.28); chest.add(lidPivot);
    part(lidPivot, box, m.wood, [0, .06, .28], [1.16, .12, .62]);
    part(lidPivot, box, m.iron, [0, .08, .28], [.12, .15, .66]);
    group.userData = { wheels, cargo, chest, lidPivot, lidOpen: 0 }; root.add(group); return group;
  }
  function sync(map, entities, make, dt, animate, renderedRiders) {
    const ids = new Set();
    for (const entity of entities ?? []) {
      ids.add(entity.id);
      const rider = entity.riderId ? renderedRiders?.get(entity.riderId) : null;
      const renderedRider = rider && Number.isFinite(rider.x) && Number.isFinite(rider.z) ? rider : null;
      const target = renderedRider ?? entity;
      let mesh = map.get(entity.id);
      if (!mesh) { mesh = make(entity.id); mesh.position.set(target.x, 0, target.z); mesh.rotation.y = target.yaw ?? entity.yaw ?? 0; map.set(entity.id, mesh); }
      const beforeX = mesh.position.x, beforeZ = mesh.position.z;
      const distance = Math.hypot(beforeX - target.x, beforeZ - target.z);
      const blend = distance > 12 ? 1 : 1 - Math.exp(-14 * dt);
      if (renderedRider) {
        // The rider has already been predicted/interpolated by the character
        // renderer. A second horse interpolation visibly pulls the saddle out
        // from under them, so both use precisely the same rendered transform.
        mesh.position.x = target.x; mesh.position.z = target.z; mesh.rotation.y = target.yaw ?? entity.yaw ?? 0;
      } else {
        mesh.position.x += (entity.x - mesh.position.x) * blend; mesh.position.z += (entity.z - mesh.position.z) * blend;
        const turn = Math.atan2(Math.sin((entity.yaw ?? 0) - mesh.rotation.y), Math.cos((entity.yaw ?? 0) - mesh.rotation.y)); mesh.rotation.y += turn * blend;
      }
      // Sample after interpolation so ramps follow the rendered mount/cart,
      // including the rider's predicted position, without another height lag.
      mesh.position.y = groundHeight(mesh.position.x, mesh.position.z);
      const traveled = distance > 12 ? 0 : Math.hypot(mesh.position.x - beforeX, mesh.position.z - beforeZ);
      animate(mesh, entity, traveled, dt, Boolean(renderedRider));
    }
    for (const [id, mesh] of map) if (!ids.has(id)) { mesh.userData.actor?.dispose(); root.remove(mesh); map.delete(id); }
  }
  return {
    root,
    get torchFixtures(){return merchantVisit?.group.visible?merchantVisit.getTorchFixtures?.()||[]:[];},
    update(state, dt = 1 / 60, renderedRiders, openCartId = null) {
      if (disposed) return;
      if (!state) { if (merchantVisit) merchantVisit.group.visible = false; return; }
      dt = Math.min(.1, Math.max(0, dt)); time += dt;
      const present = state.merchant?.present === true;
      if (present && !merchantVisit && merchantStall) {
        merchantVisit = createMerchantVisit(merchantStall, horseResources); root.add(merchantVisit.group);
      }
      if (merchantVisit) {
        merchantVisit.group.visible = present;
        if (present) merchantVisit.update(dt, time);
      }
      const stable = BUILDINGS.find(building => building.id === 'stable');
      const stock = stable ? Array.from({ length: Math.min(3, Math.max(0, state.stable?.stock ?? 0)) }, (_, index) => ({ id: `stable-stock-${index}`, x: stable.x - 2 + index * 3, z: stable.z + 9.5, yaw: -Math.PI / 2, moving: false })) : [];
      sync(horses, [...(state.horses ?? []), ...stock], horseMesh, dt, (mesh, horse, traveled, frameTime, followsRider) => {
        mesh.userData.actor.update(dt, time, followsRider ? { ...horse, moving: traveled > .0001, speed: frameTime > 0 ? traveled / frameTime : 0 } : horse);
      }, renderedRiders);
      sync(carts, state.carts, cartMesh, dt, (mesh, cart, distance) => {
        mesh.userData.wheels.forEach(wheel => { wheel.rotation.x += distance * .32; });
        mesh.userData.cargo.visible = (cart.weight ?? 0) > 0;
        const target = cart.id === openCartId ? -1.15 : 0;
        mesh.userData.lidOpen += (target - mesh.userData.lidOpen) * (1 - Math.exp(-10 * dt));
        mesh.userData.lidPivot.rotation.x = mesh.userData.lidOpen;
      });
    },
    dispose() {
      if (disposed) return; disposed = true;
      merchantVisit?.dispose(); merchantVisit = null;
      for (const mesh of horses.values()) mesh.userData.actor.dispose();
      scene.remove(root); horses.clear(); carts.clear();
      horseResources.dispose();
      for (const geometry of [box, round, soft]) geometry.dispose();
      for (const mat of Object.values(m)) mat.dispose();
    }
  };
}
