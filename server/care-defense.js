import { canUsePlot, canUseChurchBed } from '../shared/access.js';
import { randomUUID } from 'node:crypto';
import * as world from '../shared/world.js';
import { CHURCH, RECRUIT, DEFENSE_UPGRADES, TOWER_STATS, bedCapacity } from '../shared/defense.js';
import { TOOL_TIERS } from '../shared/content.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const siteFor = plot => world.PLOTS?.find(site => site.id === plot.id) ?? plot;
const isDefense = plot => Boolean(TOWER_STATS[plot.building]);
const standing = p => p?.online && !p.downed;
const near = (p, site, range = 4) => Number.isFinite(site.x) && Number.isFinite(site.z) && Math.hypot(Math.max(0, Math.abs(p.x - site.x) - (site.w ?? 10) / 2), Math.max(0, Math.abs(p.z - site.z) - (site.d ?? 10) / 2)) <= range;
const usable = plot => plot?.ownerId && plot.building && plot.hp > 0;
const hasStock = (storage, cost) => Object.entries(cost).every(([id, amount]) => (storage[id] ?? 0) >= amount);
const spendStock = (storage, cost) => { for (const [id, amount] of Object.entries(cost)) storage[id] -= amount; };
const validWallet = (player, amount) => Number.isSafeInteger(player?.wallet) && player.wallet >= amount;

function entrance(plot) {
  const site = siteFor(plot);
  if (typeof world.plotFront === 'function') return world.plotFront(site, 1);
  if (site.access?.length) return { ...site.access[0] };
  if (site.path?.length) return { ...site.path[0] };
  if (site.front) return { ...site.front };
  const yaw = site.yaw ?? site.facing ?? 0;
  return { x: site.x + Math.sin(yaw) * ((site.w ?? 10) / 2 + 1.3), z: site.z + Math.cos(yaw) * ((site.d ?? 10) / 2 + 1.3) };
}

function structureEdge(plot, target, padding = .1) {
  const site = siteFor(plot), solid = world.plotSolid?.(site, plot.building) ?? site;
  const dx = target.x - site.x, dz = target.z - site.z;
  const scale = 1 / Math.max(Math.abs(dx) / ((solid.w ?? 6) / 2 + padding), Math.abs(dz) / ((solid.d ?? 6) / 2 + padding), .01);
  return { x: site.x + dx * scale, z: site.z + dz * scale };
}

function towerCanHit(sim, village, plot, target) {
  return !sim.clearAttack || sim.clearAttack(village, structureEdge(plot, target), target, false);
}

function towerTargets(sim, village, plot) {
  const site = siteFor(plot), range = TOWER_STATS[plot.building].range;
  const inRange = village.zombies.filter(z => z.hp > 0 && distance(site, z) <= range);
  const target = inRange.filter(z => !(village.gate.hp > 0 && site.z < 18 && z.z > 20) && towerCanHit(sim, village, plot, z)).sort((a, b) => distance(site, a) - distance(site, b))[0];
  return { target, inRange: inRange.length };
}

function towerStatus(sim, village, plot) {
  const stats = TOWER_STATS[plot.building];
  const unlimitedAmmo = Object.keys(stats.ammo).length === 0;
  const shotsRemaining = unlimitedAmmo ? null : Math.max(0, Math.min(...Object.entries(stats.ammo).map(([id, cost]) => Math.floor((plot.storage[id] ?? 0) / cost))));
  let status;
  if (!usable(plot)) status = 'destroyed';
  else if (!unlimitedAmmo && !shotsRemaining) status = 'empty';
  else if (plot.lastShot?.until > village.clock) status = 'firing';
  else {
    const { target, inRange } = towerTargets(sim, village, plot);
    status = target ? 'ready' : inRange ? 'blocked' : village.zombies.some(z => z.hp > 0) ? 'out_of_range' : 'ready';
  }
  return { plotId: plot.id, status, range: stats.range, shotsRemaining, unlimitedAmmo, ammo: stats.ammo };
}

export function ensureCare(village) {
  village.guards ??= [];
  village.barracks ??= { wheat: 0 };
  // Earlier saves could contain several dead recruits in the same paid slot.
  // Keep living troops first, then the newest casualty per slot. Migration is
  // idempotent and never fills slots that the owner has not recruited.
  if (village.guardRosterVersion !== 1) {
    const keep = new Set(village.guards.filter(g => !g.plotId));
    for (const plot of village.plots ?? []) {
      if (plot.building !== 'barracks') continue;
      const troops = village.guards.filter(g => g.plotId === plot.id);
      const slots = new Set();
      for (const guard of [...troops.filter(g => g.hp > 0), ...troops.filter(g => g.hp <= 0).reverse()]) {
        const slot = Number.isInteger(guard.slot) ? guard.slot : [0, 1, 2].find(i => !slots.has(i));
        if (slot === undefined || slots.has(slot) || slot < 0 || slot >= RECRUIT.capacity) continue;
        guard.slot = slot; slots.add(slot); keep.add(guard);
      }
    }
    village.guards = village.guards.filter(g => keep.has(g));
    village.guardRosterVersion = 1;
  }
  for (const plot of village.plots ?? []) {
    plot.storage ??= {};
    if (plot.building === 'church') plot.patients ??= [];
  }
  for (const p of Object.values(village.players)) {
    p.carryingId ??= null;
    p.carriedBy ??= null;
    p.bedPlotId ??= null;
    if (p.bedPlotId && !(village.plots ?? []).some(plot => plot.id === p.bedPlotId && plot.patients?.some(patient => patient.playerId === p.id))) p.bedPlotId = null;
  }
}

// A carried dwarf retains inventory and the choice to wait for revival at dawn.
export function cancelCarry(village, player) {
  const target = village.players[player.carryingId];
  if (target?.carriedBy === player.id) {
    target.x = player.x; target.z = player.z; target.carriedBy = null;
  }
  const carrier = village.players[player.carriedBy];
  if (carrier?.carryingId === player.id) carrier.carryingId = null;
  player.carryingId = null; player.carriedBy = null;
}

function releasePatient(village, plot, patient, refund) {
  const target = village.players[patient.playerId];
  if (target?.bedPlotId === plot.id) {
    target.bedPlotId = null;
    target.anim = target.downed ? 'downed' : 'idle';
    target.animationUntil = village.clock;
  }
  if (refund) {
    const payer = village.players[patient.payerId];
    if (payer) payer.wallet += patient.fee;
  }
  plot.patients = (plot.patients ?? []).filter(other => other !== patient);
}

export function cancelTreatment(village, player) {
  for (const plot of village.plots ?? []) {
    for (const patient of [...(plot.patients ?? [])]) {
      if (patient.playerId === player.id) releasePatient(village, plot, patient, true);
    }
  }
  player.bedPlotId = null;
}

function getPlot(village, player, id, allowed, ownerOnly = false, access = 'entrance') {
  const plot = (village.plots ?? []).find(item => item.id === id);
  if (!usable(plot) || !allowed.includes(plot.building)) throw new Error('Choose a standing building of the right type.');
  const site = siteFor(plot);
  const reachable = access === 'bed' ? canUseChurchBed(player, site, plot) : access === 'repair' ? near(player, site) : canUsePlot(player, site, plot);
  if (!reachable) throw new Error(access === 'bed' ? 'Stand beside a church bed to begin treatment.' : access === 'repair' ? 'Move closer to that building.' : 'Visit this building’s entrance to use it.');
  if (ownerOnly && plot.ownerId !== player.id) throw new Error('Only this building’s owner can do that.');
  return plot;
}

function payBuildingCost(village, player, plot, cost) {
  if (!validWallet(player, cost.gold)) throw new Error(`This costs ${cost.gold} gold from your wallet.`);
  if (!hasStock(plot.storage, cost.resources)) throw new Error('Deposit the required materials into this building’s storage first.');
  player.wallet -= cost.gold;
  village.treasury += cost.gold;
  spendStock(plot.storage, cost.resources);
}

function barracksStock(village, guard) {
  if (!guard.plotId) return village.barracks;
  const plot = (village.plots ?? []).find(p => p.id === guard.plotId && p.building === 'barracks' && p.ownerId === guard.ownerId && p.hp > 0);
  return plot?.storage;
}

function troopSpawn(village, guard) {
  if (!guard.plotId) {
    const slot = guard.id === 'watch-1' ? 1 : 0;
    return { x: world.GUARD_ROAD[0].x, z: world.GUARD_ROAD[0].z + (slot - .5) * 1.4, yaw: Math.PI / 2, hp: 160, maxHp: 160, damage: 14 };
  }
  const plot = village.plots.find(p => p.id === guard.plotId), door = entrance(plot), yaw = siteFor(plot).yaw ?? 0;
  const hp = plot.level >= 2 ? 220 : 160;
  return { x: door.x + Math.cos(yaw) * (guard.slot - 1) * .9, z: door.z - Math.sin(yaw) * (guard.slot - 1) * .9, yaw, hp, maxHp: hp, damage: plot.level >= 2 ? 18 : 14 };
}

function tickGuardReplacements(sim, village) {
  const before = village.guards.length;
  village.guards = village.guards.filter(guard => !guard.plotId || Boolean(barracksStock(village, guard)));
  let changed = before !== village.guards.length;
  for (let i = 0; i < village.guards.length; i++) {
    const guard = village.guards[i];
    if (guard.hp > 0) continue;
    if (!Number.isFinite(guard.respawnAt)) { guard.respawnAt = village.clock + RECRUIT.respawnSeconds; changed = true; }
    const stock = barracksStock(village, guard);
    if (village.clock < guard.respawnAt || (stock?.wheat ?? 0) < RECRUIT.respawnWheat) continue;
    stock.wheat -= RECRUIT.respawnWheat;
    // Retain the paid slot and identity, but create a fresh entity so cached
    // navigation routes from the casualty cannot pull the replacement astray.
    village.guards[i] = { ...guard, ...troopSpawn(village, guard), anim: 'idle', roadIndex: 0, cooldown: 0, hungry: false, fedNight: village.day, respawnAt: null };
    changed = true;
  }
  if (changed) sim.store?.saveVillage(village);
}

function feed(village, guard) {
  if (guard.hp <= 0 || village.phase !== 'night') return;
  if (guard.fedNight === village.day) { guard.hungry = false; return; }
  const stock = barracksStock(village, guard);
  guard.hungry = true;
  if ((stock?.wheat ?? 0) > 0) {
    stock.wheat--; guard.fedNight = village.day; guard.hungry = false;
  }
}

export function careNight(_sim, village) {
  ensureCare(village);
  for (const guard of village.guards) feed(village, guard);
}

export function guardPathFor(village, guard) {
  if (!guard.plotId) return world.GUARD_ROAD.slice(1);
  const plot = (village.plots ?? []).find(p => p.id === guard.plotId);
  if (!plot) return world.GUARD_ROAD.slice(1);
  const site = siteFor(plot);
  if (typeof world.plotAccessRoute === 'function') return world.plotAccessRoute(site).slice(1);
  if (typeof world.plotGuardRoute === 'function') return world.plotGuardRoute(site);
  const access = site.access ?? site.path;
  if (access?.length) return [...access.slice(1), ...world.GUARD_ROAD.filter(p => p.x === 0)];
  const door = entrance(plot);
  return [{ x: 0, z: door.z }, ...world.GUARD_ROAD.filter(p => p.x === 0 && p.z > door.z)];
}

export function careAction(sim, village, player, action) {
  const kinds = ['carryPlayer', 'dropPlayer', 'churchTreat', 'churchLeave', 'recruitGuard', 'upgradeDefense', 'repairPlot'];
  if (!kinds.includes(action.kind)) return null;
  ensureCare(village);
  if (!player.online || (player.downed && action.kind !== 'churchLeave')) throw new Error('A living dwarf must perform that action.');
  if (player.mountedHorseId) throw new Error('Dismount your horse before using a building or carrying a dwarf.');
  if (player.bedPlotId && action.kind !== 'churchLeave') throw new Error('Leave your church bed before doing that.');
  if (player.carryingId && !['dropPlayer', 'churchTreat'].includes(action.kind)) throw new Error('Put your companion down before doing that.');
  if (action.kind === 'carryPlayer') {
    const target = village.players[action.targetId];
    if (!target?.online || !target.downed || target.id === player.id || target.carriedBy || target.bedPlotId || distance(player, target) > 3) throw new Error('Stand beside an uncarried downed dwarf.');
    player.carryingId = target.id; target.carriedBy = player.id;
    player.healing = null; target.healing = null;
    sim.inputs?.delete(target.id);
    return `Carrying ${target.name}. Walk to a church bed for rescue.`;
  }
  if (action.kind === 'dropPlayer') {
    if (!player.carryingId) throw new Error('You are not carrying anyone.');
    cancelCarry(village, player);
    return 'Your companion is safely on the ground.';
  }
  if (action.kind === 'churchLeave') {
    if (!player.bedPlotId) throw new Error('You are not using a church bed.');
    cancelTreatment(village, player);
    return 'Treatment cancelled and the payer refunded.';
  }
  if (action.kind === 'churchTreat') {
    const plot = getPlot(village, player, action.plotId, ['church'], false, 'bed');
    const target = village.players[action.targetId ?? player.id];
    if (!target?.online || target.bedPlotId) throw new Error('That dwarf is unavailable for treatment.');
    if (target.id !== player.id && (player.carryingId !== target.id || !target.downed)) throw new Error('Carry the downed dwarf to the church first.');
    if (target.id === player.id && player.carryingId) throw new Error('Place your carried companion in a bed first.');
    if (!target.downed && target.hp >= target.maxHp) throw new Error('You are already healthy.');
    const occupied = new Set(plot.patients.map(p => p.bedIndex));
    const bedIndex = Array.from({ length: bedCapacity(plot) }, (_, i) => i).find(i => !occupied.has(i));
    if (bedIndex === undefined) throw new Error('All church beds are occupied.');
    const revive = Boolean(target.downed), fee = revive ? CHURCH.reviveFee : CHURCH.healFee;
    if (!validWallet(player, fee)) throw new Error(`Church treatment costs ${fee} gold.`);
    player.wallet -= fee;
    cancelCarry(village, target);
    const door = typeof world.plotBedPoint === 'function' ? world.plotBedPoint(siteFor(plot), bedIndex) : entrance(plot);
    target.x = door.x; target.z = door.z;
    target.bedPlotId = plot.id; target.healing = null;
    target.anim = 'downed';
    const until = village.clock + (revive ? CHURCH.reviveSeconds : CHURCH.healSeconds);
    target.animationUntil = until;
    plot.patients.push({ playerId: target.id, payerId: player.id, fee, until, revive, bedIndex });
    sim.inputs?.delete(target.id);
    return `${revive ? 'Revival' : 'Healing'} started. ${fee} gold paid; ${revive ? CHURCH.reviveSeconds : CHURCH.healSeconds} seconds in bed.`;
  }
  if (action.kind === 'recruitGuard') {
    const plot = getPlot(village, player, action.plotId, ['barracks'], true);
    if (player.role !== 'guard') throw new Error('Only guards may command barracks troops.');
    const roster = village.guards.filter(g => g.plotId === plot.id);
    if (roster.length >= RECRUIT.capacity) throw new Error('This barracks already has three recruited troops, including replacements. Stock wheat to replace fallen guards.');
    payBuildingCost(village, player, plot, RECRUIT);
    const door = entrance(plot), hp = plot.level >= 2 ? 220 : 160;
    const slot = [0, 1, 2].find(i => !roster.some(g => g.slot === i));
    const yaw = siteFor(plot).yaw ?? 0;
    // Separate doorside spawns and defense posts prevent identical recruits
    // from remaining perfectly overlapped during their road-following march.
    const postAt = index => ({ x: (index % 6 - 2.5) * 1.2, z: 29 + Math.floor(index / 6) * 1.6 });
    const postIndex = Array.from({ length: 64 }, (_, i) => i).find(i => !village.guards.some(g => g.postIndex === i || distance(postAt(i), g.post ?? { x: g.id.endsWith('0') ? -2 : 2, z: 35 }) < 1.1)) ?? village.guards.length;
    const guard = { id: `troop-${randomUUID()}`, ownerId: player.id, plotId: plot.id, slot, x: door.x + Math.cos(yaw) * (slot - 1) * .9, z: door.z - Math.sin(yaw) * (slot - 1) * .9, yaw, hp, maxHp: hp, damage: plot.level >= 2 ? 18 : 14, anim: 'idle', roadIndex: 0, cooldown: 0, hungry: false, fedNight: null, postIndex, post: postAt(postIndex) };
    village.guards.push(guard); feed(village, guard);
    return 'A guard has been recruited and is following the road to the gate.';
  }
  if (action.kind === 'upgradeDefense') {
    const plot = getPlot(village, player, action.plotId, Object.keys(DEFENSE_UPGRADES), true);
    if ((plot.level ?? 1) >= 2) throw new Error('This building is already fully upgraded.');
    payBuildingCost(village, player, plot, DEFENSE_UPGRADES[plot.building]);
    plot.level = 2;
    const extra = Math.ceil(plot.maxHp * .5);
    plot.maxHp += extra; plot.hp += extra;
    for (const guard of village.guards.filter(g => g.plotId === plot.id && g.hp > 0)) {
      guard.hp += 60; guard.maxHp += 60; guard.damage = 18;
    }
    return plot.building === 'church' ? 'Church upgraded to four beds.' : 'Defense upgraded to level 2.';
  }
  const plot = getPlot(village, player, action.plotId, Object.keys(DEFENSE_UPGRADES).concat(['house', 'tool_shop', 'sword_shop', 'tinker_shop', 'mine', 'wheat_farm', 'tree_farm']), false, 'repair');
  if (player.tool !== 'hammer' || (player.durability?.hammer ?? 0) <= 0) throw new Error('Equip a working hammer first.');
  if (plot.hp >= plot.maxHp) throw new Error('This building is already fully repaired.');
  if ((village.stock.timber ?? 0) < 1 || (village.stock.stone ?? 0) < 1) throw new Error('The village needs timber and stone for this repair.');
  if ((player.repairBonus ?? 0) < world.CONFIG.repairCap && village.treasury < 1) throw new Error('The treasury cannot currently fund repair work.');
  const restore = TOOL_TIERS[player.tiers?.hammer ?? 'wood']?.repair ?? TOOL_TIERS.wood.repair;
  village.stock.timber--; village.stock.stone--; player.durability.hammer--;
  plot.hp = Math.min(plot.maxHp, plot.hp + restore);
  if ((player.repairBonus ?? 0) < world.CONFIG.repairCap) { player.repairBonus = (player.repairBonus ?? 0) + 1; village.treasury--; }
  player.anim = 'repair'; player.animationUntil = village.clock + .5;
  return `Building repaired. Repair earnings: ${player.repairBonus}/10, paid at dawn.`;
}

export function careTick(sim, village, dt) {
  ensureCare(village);
  for (const p of Object.values(village.players)) {
    if (p.carryingId) {
      const target = village.players[p.carryingId];
      if (!standing(p) || !target?.online || !target.downed || target.bedPlotId || target.carriedBy !== p.id) cancelCarry(village, p);
      else { target.x = p.x; target.z = p.z; target.yaw = p.yaw; target.anim = 'downed'; }
    }
    if (p.carriedBy && village.players[p.carriedBy]?.carryingId !== p.id) p.carriedBy = null;
  }
  tickGuardReplacements(sim, village);
  for (const guard of village.guards) feed(village, guard);
  for (const plot of village.plots ?? []) {
    for (const patient of [...(plot.patients ?? [])]) {
      const target = village.players[patient.playerId];
      if (!usable(plot) || plot.building !== 'church' || !target?.online || target.bedPlotId !== plot.id || patient.revive !== Boolean(target.downed)) {
        releasePatient(village, plot, patient, true); continue;
      }
      if (village.clock < patient.until) continue;
      const finish = () => {
        target.hp = patient.revive ? Math.min(CHURCH.reviveHp, target.maxHp) : target.maxHp;
        target.downed = false; target.respawnAvailable = false;
        const owner = village.players[plot.ownerId];
        if (owner && owner.id === patient.payerId) owner.wallet += patient.fee;
        else if (owner) {
          if (sim.awardIncome) sim.awardIncome(village, owner, patient.fee);
          else owner.wallet += patient.fee;
          owner.cycleServiceIncome = (owner.cycleServiceIncome ?? 0) + patient.fee;
        } else village.treasury += patient.fee;
        releasePatient(village, plot, patient, false);
        sim.store?.saveVillage(village);
      };
      // Income may repay account debt; keep that persistent transfer in the
      // same database transaction as releasing the paid bed and saving health.
      if (sim.store?.transaction) sim.store.transaction(finish);
      else finish();
    }
    if (!usable(plot) || !isDefense(plot)) continue;
    plot.shotCooldown = Math.max(0, (plot.shotCooldown ?? 0) - dt);
    const stats = TOWER_STATS[plot.building];
    if (plot.shotCooldown > 0 || !hasStock(plot.storage, stats.ammo)) continue;
    const { target } = towerTargets(sim, village, plot);
    if (!target) continue;
    spendStock(plot.storage, stats.ammo);
    plot.shotCooldown = stats.cooldown;
    plot.lastShot = { x: target.x, z: target.z, until: village.clock + .35 };
    const owner = village.players[plot.ownerId];
    const damage = stats.damage * ((plot.level ?? 1) >= 2 ? 1.5 : 1);
    for (const zombie of village.zombies.filter(z => z.hp > 0 && (z === target || (stats.splash && distance(z, target) <= stats.splash && towerCanHit(sim, village, plot, z))))) sim.hitZombie(village, zombie, damage, owner);
  }
}

// Called by zombie AI after checking nearby dwarfs and troops, so structures
// never steal aggro from a defender. Reuse the zombie cooldown to prevent two
// attacks in a single tick when moving between a tower and the gate.
export function tickDefenseAttack(sim, village, zombie, dt) {
  const targets = (village.plots ?? []).filter(plot => usable(plot) && isDefense(plot) && near(zombie, world.plotSolid?.(siteFor(plot), plot.building) ?? siteFor(plot), 12) && !(village.gate.hp > 0 && siteFor(plot).z < 18 && zombie.z > 20));
  const plot = targets.sort((a, b) => distance(siteFor(a), zombie) - distance(siteFor(b), zombie))[0];
  if (!plot) return false;
  const site = siteFor(plot), dx = zombie.x - site.x, dz = zombie.z - site.z;
  const edge = structureEdge(plot, zombie, .8);
  if (distance(zombie, edge) > 1.6) { sim.cancelZombieWindup?.(zombie); sim.stepNpc(zombie, edge, zombie.speed, dt, village.zombies); }
  else {
    zombie.anim = 'attack'; zombie.yaw = Math.atan2(-dx, -dz);
    const struck = sim.attackZombieStructure ? sim.attackZombieStructure(village, zombie, plot, plot.id, 'plot') : !zombie.cooldown;
    if (struck) {
      if (!sim.attackZombieStructure) { plot.hp = Math.max(0, plot.hp - (zombie.elite ? 18 : 10)); zombie.cooldown = 1.5; }
      if (plot.hp <= 0) {
        plot.lastShot = null;
        sim.notice?.(village.id, 'A defensive building has been destroyed. Its owner can rebuild on the plot.');
        sim.store?.saveVillage(village);
      }
    }
  }
  return true;
}

export function careSnapshot(village, _viewerId, sim = {}) {
  return {
    defenseStatus: (village.plots ?? []).filter(plot => isDefense(plot)).map(plot => towerStatus(sim, village, plot)),
    guardReplacements: village.guards.filter(g => g.hp <= 0 && barracksStock(village, g)).map(g => ({ guardId: g.id, plotId: g.plotId ?? null, ownerId: g.ownerId ?? null, remaining: Math.max(0, Math.ceil((g.respawnAt ?? village.clock + RECRUIT.respawnSeconds) - village.clock)), waitingForWheat: (barracksStock(village, g)?.wheat ?? 0) < RECRUIT.respawnWheat })),
    beds: (village.plots ?? []).filter(plot => usable(plot) && plot.building === 'church').map(plot => ({ plotId: plot.id, capacity: bedCapacity(plot), patients: (plot.patients ?? []).map(p => ({ playerId: p.playerId, remaining: Math.max(0, Math.ceil(p.until - village.clock)), revive: p.revive, bedIndex: p.bedIndex })) })),
    carrying: Object.values(village.players).filter(p => p.carryingId).map(p => ({ playerId: p.id, targetId: p.carryingId }))
  };
}
