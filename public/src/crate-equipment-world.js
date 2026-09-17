import { CRATE_ITEMS } from './crate-catalog.js';
import { createCrateAsset } from './crate-assets.js';
import * as THREE from 'three';

const SLOTS = ['head', 'body', 'feet', 'utility'];
const ITEMS = new Map(CRATE_ITEMS.map(item => [item.id, item]));
const ROLES = new Set(['villager', 'guard', 'priest', 'manager', 'tinker', 'wizard']);
const BONES = ['body', 'head', 'leftShin', 'rightShin', 'leftFoot', 'rightFoot'];
const backpackTier = player => Number.isInteger(player.backpackTier) && player.backpackTier >= 0 && player.backpackTier <= 3 ? player.backpackTier : 0;

// The server's deployed equipment is the only source of live appearance. Account
// unlocks and the next-run loadout never attach equipment to the current dwarf.
// Assets own their resources; character disposal must not dispose them instead.
export function createCrateEquipmentWorld() {
  const records = new Map();
  const wards = new Map();
  let disposed = false;
  function remove(record) {
    for (const asset of record.slots.values()) asset.dispose();
    record.slots.clear();
  }
  function removeWard(id) { const ward = wards.get(id); if (!ward) return; ward.mesh.removeFromParent(); ward.mesh.geometry.dispose(); ward.mesh.material.dispose(); wards.delete(id); }
  function removePlayer(id) { const record = records.get(id); if (record) { remove(record); records.delete(id); } removeWard(id); }
  function clear() {
    for (const record of records.values()) remove(record);
    records.clear();
    for (const id of wards.keys()) removeWard(id);
  }
  function update(state = {}, actors = new Map(), time = 0, { reducedMotion = false } = {}) {
    if (disposed) return;
    const live = new Set();
    const protectedPlayers = new Set();
    for (const player of state?.players ?? []) {
      const actor = actors.get(player.id)?.rig, group = actor?.group;
      if (!group || player.online === false || !ROLES.has(player.role)) continue;
      if (!player.downed && player.hp > 0 && player.emberWard > 0 && player.emberWardUntil > (state.clock ?? 0)) {
        protectedPlayers.add(player.id);
        let ward = wards.get(player.id);
        if (ward && ward.group !== group) { removeWard(player.id); ward = null; }
        if (!ward) {
          const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), new THREE.MeshBasicMaterial({ color:0xffa54d, transparent:true, opacity:.13, depthWrite:false, side:THREE.BackSide }));
          mesh.name = 'ember-ward-shield'; mesh.position.y=1.1; mesh.scale.set(.85,1.15,.85); group.add(mesh);
          ward={ group,mesh }; wards.set(player.id,ward);
        }
        ward.mesh.material.opacity = .065 + .065 * Math.min(1, player.emberWard / 50) + (reducedMotion ? 0 : .012 * Math.sin(time * 3));
      }
      const desired = new Map();
      for (const slot of SLOTS) {
        const id = player.crateEquipment?.[slot], item = ITEMS.get(id);
        if (item?.wearable && item.slot === slot) desired.set(slot, id);
      }
      if (!desired.size) continue;
      const body = group.getObjectByName('body');
      if (!body?.isBone) continue;
      let record = records.get(player.id);
      if (record && record.group !== group) { remove(record); records.delete(player.id); record = null; }
      const rebuilt = !!record && record.body !== body;
      if (!record || rebuilt) {
        if (!BONES.every(name => group.getObjectByName(name)?.isBone)) continue;
        if (!record) { record = { group, body, backpack: null, slots: new Map() }; records.set(player.id, record); }
        // A role rebuild changes every attachment bone. Unfit the full set
        // before fitting any replacement, restoring the old rig only once.
        if (rebuilt) for (const asset of record.slots.values()) asset.unfit();
        record.body = body;
      }
      live.add(player.id);
      // Tear down replaced slots first: their visibility restoration must never
      // reveal a default hat/boot/backpack underneath newly fitted equipment.
      for (const [slot, asset] of record.slots) if (desired.get(slot) !== asset.id) {
        asset.dispose(); record.slots.delete(slot);
      }
      const pack = body.getObjectByName('worn-backpack') ?? null, tier = backpackTier(player);
      for (const [slot, id] of desired) {
        let asset = record.slots.get(slot);
        if (!asset) {
          asset = createCrateAsset(id, { backpackTier: tier });
          try { asset.fit(actor); } catch (error) { asset.dispose(); throw error; }
          record.slots.set(slot, asset);
        } else if (rebuilt || slot === 'utility' && record.backpack !== pack) {
          // setBackpackTier replaces the purchased pack on the same body bone.
          // Refit its utility cover so the new base pack is hidden as well.
          asset.fit(actor);
        }
        asset.update(time, { reducedMotion, backpackTier: tier, emberWard: player.emberWard, emberWardUntil: player.emberWardUntil });
      }
      record.backpack = pack;
    }
    for (const [id, record] of records) if (!live.has(id)) { remove(record); records.delete(id); }
    for (const id of wards.keys()) if (!protectedPlayers.has(id)) removeWard(id);
  }
  return { update, clear, removePlayer,
    dispose() { if (disposed) return; clear(); disposed = true; },
    get stats() { return { players: records.size, assets: [...records.values()].reduce((sum, record) => sum + record.slots.size, 0) }; }
  };
}
