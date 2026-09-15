import { CRATE_ITEMS } from './crate-catalog.js';
import { createCrateAsset } from './crate-assets.js';

const SLOTS = ['head', 'body', 'feet', 'utility'];
const ITEMS = new Map(CRATE_ITEMS.map(item => [item.id, item]));
const ROLES = new Set(['villager', 'guard', 'priest']);
const BONES = ['body', 'head', 'leftShin', 'rightShin', 'leftFoot', 'rightFoot'];
const backpackTier = player => Number.isInteger(player.backpackTier) && player.backpackTier >= 0 && player.backpackTier <= 3 ? player.backpackTier : 0;

// The server's deployed equipment is the only source of live appearance. Account
// unlocks and the next-run loadout never attach equipment to the current dwarf.
// Assets own their resources; character disposal must not dispose them instead.
export function createCrateEquipmentWorld() {
  const records = new Map();
  let disposed = false;
  function remove(record) {
    for (const asset of record.slots.values()) asset.dispose();
    record.slots.clear();
  }
  function removePlayer(id) { const record = records.get(id); if (record) { remove(record); records.delete(id); } }
  function clear() {
    for (const record of records.values()) remove(record);
    records.clear();
  }
  function update(state = {}, actors = new Map(), time = 0, { reducedMotion = false } = {}) {
    if (disposed) return;
    const live = new Set();
    for (const player of state?.players ?? []) {
      const actor = actors.get(player.id)?.rig, group = actor?.group;
      if (!group || player.online === false || !ROLES.has(player.role)) continue;
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
        asset.update(time, { reducedMotion, backpackTier: tier });
      }
      record.backpack = pack;
    }
    for (const [id, record] of records) if (!live.has(id)) { remove(record); records.delete(id); }
  }
  return { update, clear, removePlayer,
    dispose() { if (disposed) return; clear(); disposed = true; },
    get stats() { return { players: records.size, assets: [...records.values()].reduce((sum, record) => sum + record.slots.size, 0) }; }
  };
}
