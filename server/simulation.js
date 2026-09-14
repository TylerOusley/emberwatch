import { randomUUID } from 'node:crypto';
import { CONFIG, ROAD, GUARD_ROAD, RESOURCES, BUILDINGS, moveWithCollision } from '../shared/world.js';
import { saleQuote, TREASURY_RESERVE } from '../shared/market.js';

const TOOL_IDS = new Set(['sword', 'axe', 'pickaxe', 'scythe', 'hammer', 'food', 'heal']);
const ROLES = new Set(['guard', 'priest', 'villager']);
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const emptyInventory = () => ({ timber: 0, stone: 0, wheat: 0, food: 0 });
const durability = () => ({ sword: 100, axe: 100, pickaxe: 100, scythe: 100, hammer: 100 });
const makeResource = resource => ({ id: resource.id, available: true, remaining: resource.type === 'wheat' ? 1 : resource.type === 'stone' ? 8 : 5, regrowAt: 0 });
const building = id => BUILDINGS.find(b => b.id === id);
const nearBuilding = (player, id, range = 3.5) => {
  const b = building(id);
  return Math.hypot(Math.max(0, Math.abs(player.x - b.x) - b.w / 2), Math.max(0, Math.abs(player.z - b.z) - b.d / 2)) <= range;
};

export function createVillage(name, creatorId, options = {}) {
  return {
    id: randomUUID(), name, creatorId, day: 1, phase: 'day', phaseRemaining: options.daySeconds ?? CONFIG.daySeconds,
    clock: 0, status: 'active', gate: { hp: CONFIG.gateMax, maxHp: CONFIG.gateMax }, keep: { hp: CONFIG.keepMax, maxHp: CONFIG.keepMax },
    treasury: 2500, stock: { timber: 60, stone: 40, wheat: 40 }, barracks: { wheat: 12 }, players: {},
    resources: RESOURCES.map(makeResource), zombies: [], guards: [0, 1].map(i => ({ id: `watch-${i}`, x: -22 + i * 1.5, z: 3, yaw: 0, hp: 160, maxHp: 160, anim: 'idle', roadIndex: 0, cooldown: 0, hungry: false })),
    nextSpawn: 0, spawned: 0, waveCount: 0, nightParticipants: [], warningSent: false
  };
}

export class Simulation {
  constructor(store, { daySeconds = CONFIG.daySeconds, nightSeconds = CONFIG.nightSeconds, devTools = false } = {}) {
    this.store = store;
    this.daySeconds = daySeconds;
    this.nightSeconds = nightSeconds;
    this.devTools = devTools;
    this.villages = new Map(store.loadVillages().map(village => {
      for (const player of Object.values(village.players)) { player.online = false; player.anim = player.downed ? 'downed' : 'idle'; player.healing = null; }
      return [village.id, village];
    }));
    this.inputs = new Map();
    this.notices = [];
  }
  list() {
    return [...this.villages.values()].map(v => ({ id: v.id, name: v.name, day: v.day, online: Object.values(v.players).filter(p => p.online).length, residents: Object.keys(v.players).length, maxResidents: 8, status: v.status }));
  }
  create(name, account) {
    if (typeof name !== 'string' || name.trim().length < 3 || name.trim().length > 32) throw new Error('Village names must be 3–32 characters.');
    if ([...this.villages.values()].some(v => v.creatorId === account.id && v.status === 'active')) throw new Error('You already founded an active village.');
    if ([...this.villages.values()].some(v => v.status === 'active' && v.players[account.id])) throw new Error('Your place is reserved in an active village. Rejoin it to continue.');
    const village = createVillage(name.trim(), account.id, this);
    this.store.saveVillage(village);
    this.villages.set(village.id, village);
    return this.list().find(v => v.id === village.id);
  }
  join(villageId, account, role = 'villager') {
    const village = this.villages.get(villageId);
    if (!village) throw new Error('Village not found.');
    if (!ROLES.has(role)) throw new Error('Choose guard, priest or villager.');
    if (village.status !== 'active') throw new Error('This village has fallen. Join or found a new village.');
    if ([...this.villages.values()].some(v => v.id !== villageId && v.status === 'active' && v.players[account.id])) throw new Error('You already have a reserved place in another active village.');
    let player = village.players[account.id];
    if (!player && Object.keys(village.players).length >= 8) throw new Error('All eight resident places are reserved, including offline residents.');
    this.store.transaction(() => {
      if (!player) {
        player = { id: account.id, name: account.name, role, x: (Object.keys(village.players).length % 3 - 1) * 1.5, z: 4, yaw: Math.PI, hp: 100, maxHp: 100, online: true, downed: false, respawnAvailable: false, tool: 'sword', anim: 'idle', inventory: emptyInventory(), wallet: this.store.initialWallet(account.id), durability: durability(), repairBonus: 0, jobBonus: 0, healingProgress: 0, revivedThisNight: [], participated: 0, lastAction: -100, animationUntil: 0, healing: null, hunger: 100 };
        village.players[account.id] = player;
      }
      player.online = true;
      this.inputs.delete(player.id);
      this.store.saveVillage(village);
    });
    return player;
  }
  disconnect(villageId, playerId) {
    const village = this.villages.get(villageId), player = village?.players[playerId];
    if (!player) return;
    player.online = false; player.healing = null; player.anim = player.downed ? 'downed' : 'idle';
    this.inputs.delete(player.id);
    this.store.saveVillage(village);
  }
  input(villageId, playerId, input) {
    const player = this.villages.get(villageId)?.players[playerId];
    if (!player?.online) return;
    if (![input.x, input.z, input.yaw].every(Number.isFinite) || Math.abs(input.x) > 100 || Math.abs(input.z) > 100 || Math.abs(input.yaw) > 1e6) throw new Error('Invalid movement.');
    const length = Math.hypot(input.x, input.z);
    this.inputs.set(playerId, { x: length > 1 ? input.x / length : input.x, z: length > 1 ? input.z / length : input.z, yaw: input.yaw, sprint: input.sprint === true, received: performance.now() });
    if (TOOL_IDS.has(input.tool)) player.tool = input.tool;
  }
  snapshot(village, viewerId) {
    return { id: village.id, name: village.name, day: village.day, phase: village.phase, phaseRemaining: Math.ceil(village.phaseRemaining), gate: village.gate, keep: village.keep, treasury: village.treasury, stock: village.stock, barracks: village.barracks, status: village.status, devTools: this.devTools,
      players: Object.values(village.players).map(p => ({ id: p.id, name: p.name, role: p.role, x: p.x, z: p.z, yaw: p.yaw, hp: p.hp, maxHp: p.maxHp, online: p.online, downed: p.downed, respawnAvailable: p.respawnAvailable, tool: p.tool, anim: p.anim,
        ...(p.id === viewerId ? { inventory: p.inventory, wallet: p.wallet, bank: this.store.account(p.id)?.bank ?? 0, durability: p.durability, repairBonus: p.repairBonus, jobBonus: p.jobBonus, hunger: Math.floor(p.hunger ?? 100), healRemaining: p.healing ? Math.max(0, Math.ceil(p.healing.until - village.clock)) : 0 } : {}) })),
      zombies: village.zombies.filter(z => z.hp > 0).map(({ id, x, z, yaw, hp, maxHp, anim }) => ({ id, x, z, yaw, hp, maxHp, anim })),
      guards: village.guards.filter(g => g.hp > 0).map(({ id, x, z, yaw, hp, maxHp, anim, hungry }) => ({ id, x, z, yaw, hp, maxHp, anim, hungry })),
      resources: village.resources.map(({ id, available, remaining }) => ({ id, available, remaining })) };
  }
  notice(villageId, message) { this.notices.push({ villageId, message }); }
  action(villageId, playerId, action) {
    const village = this.villages.get(villageId), player = village?.players[playerId];
    if (!player?.online) throw new Error('Join a village first.');
    if (village.status !== 'active') throw new Error('The keep has fallen. This run has ended.');
    const kind = action.kind;
    if (typeof kind !== 'string') throw new Error('Invalid action.');
    if (player.downed && kind !== 'respawn') throw new Error('You are downed. A priest can revive you, or you can choose to respawn after dawn.');
    if (village.clock - player.lastAction < .55) throw new Error('Wait for your next action.');
    const tool = player.tool;
    const use = required => {
      if (tool !== required) throw new Error(`Equip your ${required} first.`);
      if (player.durability[required] <= 0) throw new Error('Your tool has broken. Buy a replacement at Oak & Iron.');
    };
    let message;
    if (kind === 'attack') {
      use('sword');
      const target = village.zombies.filter(z => z.hp > 0 && distance(player, z) <= 3.2).sort((a, b) => distance(player, a) - distance(player, b))[0];
      player.anim = 'attack'; player.animationUntil = village.clock + .45;
      if (target) { this.hitZombie(village, target, player.role === 'guard' ? 24 : 18, player); message = 'Strike landed.'; }
    } else if (kind === 'gather') {
      const node = RESOURCES.find(r => r.id === action.targetId), state = village.resources.find(r => r.id === action.targetId);
      if (!node || !state || !state.available) throw new Error('That resource is regrowing.');
      if (distance(player, node) > 3.3) throw new Error('Move closer to gather.');
      use({ timber: 'axe', stone: 'pickaxe', wheat: 'scythe' }[node.type]);
      if (Object.values(player.inventory).reduce((a, b) => a + b, 0) >= 60) throw new Error('Your pack is full. Sell or donate materials at the treasury.');
      player.inventory[node.type] += 1;
      player.durability[tool] -= 1;
      state.remaining -= 1;
      if (state.remaining <= 0) { state.available = false; state.regrowAt = village.clock + (node.type === 'wheat' ? 90 : 150); }
      player.anim = 'gather'; player.animationUntil = village.clock + .5;
      message = `+1 ${node.type}`;
    } else if (kind === 'repair') {
      use('hammer');
      const id = action.targetId === 'keep' ? 'keep' : action.targetId === 'gate' ? 'gate' : null;
      if (!id) throw new Error('Choose the gate or keep to repair.');
      if (id === 'gate' ? distance(player, { x: 0, z: 18 }) > 4.5 : !nearBuilding(player, 'keep', 4.5)) throw new Error('Move closer to the damaged structure.');
      const structure = village[id];
      if (structure.hp >= structure.maxHp) throw new Error('This structure is already fully repaired.');
      const cost = id === 'gate' ? { timber: 1, stone: 0 } : { timber: 1, stone: 1 };
      if (village.stock.timber < cost.timber || village.stock.stone < cost.stone) throw new Error('The village needs more repair materials.');
      if (player.repairBonus < CONFIG.repairCap && village.treasury < 1) throw new Error('The treasury cannot currently fund repair work.');
      village.stock.timber -= cost.timber; village.stock.stone -= cost.stone;
      structure.hp = Math.min(structure.maxHp, structure.hp + 35);
      player.durability.hammer -= 1;
      if (player.repairBonus < CONFIG.repairCap) { player.repairBonus++; village.treasury--; }
      player.anim = 'repair'; player.animationUntil = village.clock + .5;
      message = `Repaired ${id}. Repair earnings: ${player.repairBonus}/10, paid at dawn.`;
    } else if (kind === 'heal') {
      if (player.role !== 'priest') throw new Error('Only priests can heal and revive other dwarfs.');
      const target = village.players[action.targetId];
      if (!target?.online || target.id === player.id || distance(player, target) > 3.5) throw new Error('Move near another injured dwarf.');
      if (target.hp >= target.maxHp) throw new Error('That dwarf is already healthy.');
      if (player.healing) throw new Error('Your blessing is already in progress. Stay nearby.');
      player.healing = { targetId: target.id, until: village.clock + (target.downed ? 5 : 2) };
      player.anim = 'heal'; player.animationUntil = player.healing.until;
      message = target.downed ? 'Hold still for 5 seconds to revive your companion.' : 'Hold still to heal your companion.';
    } else if (kind === 'respawn') {
      if (!player.downed || !player.respawnAvailable) throw new Error('Respawning unlocks at the next dawn.');
      player.inventory = emptyInventory(); player.wallet = Math.floor(player.wallet * .75); player.durability = { sword: 100, axe: 20, pickaxe: 0, scythe: 0, hammer: 0 };
      Object.assign(player, { downed: false, respawnAvailable: false, hp: 100, hunger: 100, x: 0, z: 4, yaw: Math.PI, tool: 'sword', anim: 'idle', healing: null });
      message = 'You returned with an emergency sword and axe. Your carried inventory and 25% of wallet gold were lost.';
    } else if (kind === 'eat') {
      if (player.inventory.food < 1) throw new Error('Buy bread from The Breadboard.');
      if ((player.hunger ?? 100) >= 100) throw new Error('You are already well fed.');
      player.inventory.food--; player.hunger = Math.min(100, (player.hunger ?? 100) + 35);
      message = 'You ate bread. Hunger restored.';
    } else if (kind === 'deposit' || kind === 'withdraw') {
      if (!nearBuilding(player, 'bank')) throw new Error('Visit the Village Treasury to use your savings.');
      if (!Number.isSafeInteger(action.amount) || action.amount < 1 || action.amount > 1000000) throw new Error('Enter a whole gold amount.');
      if (kind === 'deposit' && player.wallet < action.amount) throw new Error('You do not have that much gold in your wallet.');
      const delta = kind === 'deposit' ? action.amount : -action.amount;
      this.store.transaction(() => { this.store.bank(player.id, delta); player.wallet -= delta; this.store.saveVillage(village); });
      message = kind === 'deposit' ? 'Gold secured in your personal bank.' : 'Gold withdrawn to your wallet.';
    } else if (kind === 'sell') {
      if (!nearBuilding(player, 'bank')) throw new Error('Visit the Village Treasury to sell your resources.');
      const { resource, amount, minTotal } = action;
      // Quote validation rejects unknown resources and non-integer/oversized sales.
      // The callback is synchronous, so another player's sale cannot interleave.
      const total = saleQuote(resource, village.stock[resource], amount);
      if (!Number.isSafeInteger(minTotal) || minTotal < 1) throw new Error('Request a current whole-gold sale quote.');
      if (!Number.isSafeInteger(player.inventory[resource]) || player.inventory[resource] < amount) throw new Error(`You do not have enough ${resource} to sell.`);
      if (total < minTotal) throw new Error('The price changed as village stock increased. Review the new quote and try again.');
      if (!Number.isSafeInteger(village.treasury) || village.treasury - total < TREASURY_RESERVE) throw new Error(`The village must keep ${TREASURY_RESERVE} gold for essential expenses. Try a smaller sale or return later.`);
      if (!Number.isSafeInteger(player.wallet) || !Number.isSafeInteger(player.wallet + total)) throw new Error('Your wallet cannot accept this sale.');
      // Validate the entire sale before changing any inventory or balance. One saved
      // village state contains the stock transfer and both sides of the gold transfer.
      player.inventory[resource] -= amount;
      village.stock[resource] += amount;
      village.treasury -= total;
      player.wallet += total;
      message = `Sold ${amount} ${resource} for ${total} gold. Gold added to your wallet.`;
    } else if (kind === 'donate') {
      if (action.targetId === 'barracks') {
        if (!nearBuilding(player, 'barracks')) throw new Error('Bring wheat to The Watch to feed the guards.');
        if (!player.inventory.wheat) throw new Error('Gather some wheat for the barracks first.');
        village.barracks.wheat += player.inventory.wheat;
        message = `${player.inventory.wheat} wheat delivered to the barracks.`;
        player.inventory.wheat = 0;
      } else {
        if (!nearBuilding(player, 'bank')) throw new Error('Bring your materials to the Village Treasury.');
        const total = player.inventory.timber + player.inventory.stone + player.inventory.wheat;
        if (!total) throw new Error('You have no materials to donate.');
        for (const id of ['timber', 'stone', 'wheat']) { village.stock[id] += player.inventory[id]; player.inventory[id] = 0; }
        message = `${total} materials donated to village supplies.`;
      }
    } else if (kind === 'buyTool') {
      if (!nearBuilding(player, 'tools')) throw new Error('Visit Oak & Iron to buy wooden tools.');
      if (!['axe', 'pickaxe', 'scythe', 'hammer'].includes(action.tool)) throw new Error('Choose a wooden gathering tool or hammer.');
      if (player.wallet < 10) throw new Error('A replacement wooden tool costs 10 gold.');
      if (player.durability[action.tool] > 0) throw new Error('Your current tool still has durability remaining.');
      player.wallet -= 10; village.treasury += 10; player.durability[action.tool] = 100;
      message = `Purchased a wooden ${action.tool}.`;
    } else if (kind === 'buyFood') {
      if (!nearBuilding(player, 'food')) throw new Error('Visit The Breadboard to buy food.');
      if (player.wallet < 5) throw new Error('Bread costs 5 gold.');
      if (village.stock.wheat < 2) throw new Error('The village needs wheat to bake more bread.');
      if (Object.values(player.inventory).reduce((a, b) => a + b, 0) >= 60) throw new Error('Your pack is full.');
      player.wallet -= 5; village.treasury += 5; village.stock.wheat -= 2; player.inventory.food++;
      message = 'Bread added to your pack. Eat it when you need it.';
    } else if (kind === 'startNight') {
      if (!this.devTools) throw new Error('Testing controls are disabled.');
      if (village.phase !== 'day') throw new Error('It is already nighttime.');
      this.startNight(village);
      message = 'Test night started.';
    } else throw new Error('Unknown action.');
    player.lastAction = village.clock;
    // Save all successful authoritative mutations before reporting them to the client.
    this.store.saveVillage(village);
    return message;
  }
  awardJob(village, player, gold) {
    const awarded = Math.min(gold, 25 - player.jobBonus, village.treasury);
    if (awarded > 0) { player.jobBonus += awarded; village.treasury -= awarded; }
  }
  hitZombie(village, zombie, damage, player) {
    zombie.hp = Math.max(0, zombie.hp - damage);
    if (zombie.hp <= 0 && player?.online && player.role === 'guard') this.awardJob(village, player, zombie.elite ? 3 : 1);
  }
  hurtPlayer(village, player, damage) {
    player.hp = Math.max(0, player.hp - damage);
    if (player.hp <= 0) { player.downed = true; player.respawnAvailable = false; player.anim = 'downed'; player.healing = null; this.inputs.delete(player.id); }
  }
  startNight(village) {
    village.phase = 'night'; village.phaseRemaining = this.nightSeconds; village.spawned = 0; village.nextSpawn = village.clock + 2;
    const active = Object.values(village.players).filter(p => p.online).length;
    const band = Math.floor((village.day - 1) / 5);
    village.waveCount = Math.min(80, 5 + active * 3 + band * 5);
    village.nightParticipants = Object.values(village.players).filter(p => p.online).map(p => p.id);
    for (const guard of village.guards.filter(g => g.hp > 0)) { guard.hungry = village.barracks.wheat <= 0; if (!guard.hungry) village.barracks.wheat--; }
    this.notice(village.id, `Night ${village.day}. Defend the gate together.`);
  }
  dawn(village) {
    const survived = village.day;
    village.phase = 'day'; village.phaseRemaining = this.daySeconds; village.day++; village.warningSent = false;
    village.treasury += 50 + 20 * village.nightParticipants.length;
    for (const player of Object.values(village.players)) {
      if (player.downed) player.respawnAvailable = true;
      const base = ['guard', 'priest'].includes(player.role) ? Math.floor(25 * Math.min(1, player.participated / (this.daySeconds + this.nightSeconds))) : 0;
      const funded = Math.min(base, village.treasury); village.treasury -= funded;
      player.wallet += funded + player.jobBonus + player.repairBonus;
      player.jobBonus = 0; player.repairBonus = 0; player.participated = 0; player.revivedThisNight = [];
    }
    this.notice(village.id, `Dawn breaks. Night ${survived} survived. Remaining zombies must still be defeated.`);
    this.store.saveVillage(village);
  }
  tick(dt) {
    for (const village of this.villages.values()) {
      if (village.status !== 'active' || !Object.values(village.players).some(p => p.online)) continue;
      village.clock += dt; village.phaseRemaining -= dt;
      for (const player of Object.values(village.players)) {
        if (!player.online) continue;
        player.participated += dt;
        if (player.downed) continue;
        player.hunger = Math.max(0, (player.hunger ?? 100) - dt * .05);
        const input = this.inputs.get(player.id);
        const fresh = input && performance.now() - input.received < 700;
        // Gathering and blessings can turn toward a target without walking.
        if (fresh) player.yaw = input.yaw;
        if (fresh && Math.hypot(input.x, input.z) > .02) {
          player.healing = null;
          const speed = input.sprint && player.hunger > 0 ? CONFIG.sprintSpeed : CONFIG.speed;
          moveWithCollision(player, input.x * speed * dt, input.z * speed * dt);
          if (village.clock > player.animationUntil) player.anim = input.sprint ? 'run' : 'walk';
        } else if (village.clock > player.animationUntil) player.anim = 'idle';
        if (player.healing) {
          const target = village.players[player.healing.targetId];
          if (!target?.online || distance(player, target) > 3.5) { player.healing = null; continue; }
          if (village.clock >= player.healing.until) {
            const wasDowned = target.downed;
            const restored = Math.min(wasDowned ? 45 : 30, target.maxHp - target.hp);
            target.hp += restored;
            if (wasDowned) {
              target.downed = false; target.respawnAvailable = false; target.anim = 'idle';
              if (!player.revivedThisNight.includes(target.id)) { this.awardJob(village, player, 5); player.revivedThisNight.push(target.id); }
            } else {
              player.healingProgress += restored;
              const rewards = Math.floor(player.healingProgress / 50); player.healingProgress %= 50;
              this.awardJob(village, player, rewards);
            }
            player.healing = null;
            this.store.saveVillage(village);
          }
        }
      }
      for (let i = 0; i < village.resources.length; i++) {
        const node = village.resources[i];
        if (!node.available && village.clock >= node.regrowAt) Object.assign(node, makeResource(RESOURCES[i]));
      }
      if (village.phase === 'night' && village.spawned < village.waveCount && village.clock >= village.nextSpawn) {
        const band = Math.floor((village.day - 1) / 5), elite = band > 0 && village.spawned % 5 === 0;
        village.zombies.push({ id: randomUUID(), x: ROAD[0].x + (village.spawned % 3 - 1) * 1.3, z: ROAD[0].z + (village.spawned % 2) * 1.5, yaw: Math.PI, hp: elite ? 120 + band * 20 : 65 + band * 14, maxHp: elite ? 120 + band * 20 : 65 + band * 14, anim: 'walk', roadIndex: 1, cooldown: 0, elite, speed: 1.75 + Math.min(band * .08, .65) });
        village.spawned++; village.nextSpawn = village.clock + Math.max(1.5, 6 - band * .4);
      }
      this.tickNpcs(village, dt);
      if (village.status === 'fallen') continue;
      if (village.phaseRemaining <= 0) { if (village.phase === 'day') this.startNight(village); else this.dawn(village); }
      if (village.phase === 'day' && village.day % 5 === 1 && village.day > 1 && !village.warningSent) { village.warningSent = true; this.notice(village.id, 'A stronger horde is stirring in the graveyard. Prepare before tonight.'); }
      village.zombies = village.zombies.filter(z => z.hp > 0);
    }
  }
  stepNpc(entity, target, speed, dt, neighbors = []) {
    const dx = target.x - entity.x, dz = target.z - entity.z, length = Math.hypot(dx, dz);
    if (length < .15) { entity.anim = 'idle'; return; }
    let vx = dx / length * speed, vz = dz / length * speed;
    for (const other of neighbors) {
      if (other === entity || other.hp <= 0) continue;
      const apart = distance(entity, other);
      if (apart > .01 && apart < 1.1) { vx += (entity.x - other.x) / apart * (1.1 - apart) * 2; vz += (entity.z - other.z) / apart * (1.1 - apart) * 2; }
    }
    const travel = Math.min(length, Math.hypot(vx, vz) * dt), norm = Math.hypot(vx, vz) || 1;
    moveWithCollision(entity, vx / norm * travel, vz / norm * travel, .4);
    entity.yaw = Math.atan2(vx, vz); entity.anim = 'walk';
  }
  tickNpcs(village, dt) {
    const alivePlayers = Object.values(village.players).filter(p => p.online && !p.downed);
    const guards = village.guards.filter(g => g.hp > 0);
    const zombies = village.zombies.filter(z => z.hp > 0);
    const guardPath = GUARD_ROAD.slice(1);
    for (const guard of guards) {
      guard.cooldown = Math.max(0, guard.cooldown - dt);
      if (guard.hungry && village.barracks.wheat > 0) { village.barracks.wheat--; guard.hungry = false; }
      const target = zombies.filter(z => z.hp > 0 && distance(guard, z) < 12 && z.z < 55).sort((a, b) => distance(guard, a) - distance(guard, b))[0];
      if (target) {
        if (distance(guard, target) > 2.1) this.stepNpc(guard, target, 3.4, dt, guards);
        else { guard.anim = 'attack'; guard.yaw = Math.atan2(target.x - guard.x, target.z - guard.z); if (!guard.cooldown) { this.hitZombie(village, target, guard.hungry ? 10.5 : 14); guard.cooldown = 1.05; } }
      } else {
        const point = guardPath[Math.min(guard.roadIndex, guardPath.length - 1)];
        if (distance(guard, point) < 1.4 && guard.roadIndex < guardPath.length - 1) guard.roadIndex++;
        const destination = guard.roadIndex === guardPath.length - 1 ? { x: guard.id.endsWith('0') ? -2 : 2, z: 35 } : point;
        this.stepNpc(guard, destination, 3, dt, guards);
      }
    }
    for (const zombie of zombies) {
      if (zombie.hp <= 0) continue;
      zombie.cooldown = Math.max(0, zombie.cooldown - dt);
      const defenders = [...alivePlayers.filter(p => !p.downed), ...guards.filter(g => g.hp > 0)];
      // An intact gate blocks attacks/aggro across the doorway until a defender steps outside.
      const target = defenders.filter(d => distance(zombie, d) < 7 && !(village.gate.hp > 0 && zombie.z > 20 && d.z < 18)).sort((a, b) => distance(zombie, a) - distance(zombie, b))[0];
      if (target) {
        if (distance(zombie, target) > 1.9) this.stepNpc(zombie, target, zombie.speed, dt, zombies);
        else { zombie.anim = 'attack'; zombie.yaw = Math.atan2(target.x - zombie.x, target.z - zombie.z); if (!zombie.cooldown) { if ('online' in target) this.hurtPlayer(village, target, zombie.elite ? 15 : 9); else target.hp = Math.max(0, target.hp - (zombie.elite ? 15 : 9)); zombie.cooldown = 1.5; } }
        continue;
      }
      if (village.gate.hp > 0 && zombie.z >= 18 && zombie.z <= 23 && zombie.roadIndex >= 3) {
        zombie.anim = 'attack'; zombie.yaw = Math.PI;
        if (!zombie.cooldown) { village.gate.hp = Math.max(0, village.gate.hp - (zombie.elite ? 15 : 8)); zombie.cooldown = 1.4; }
      } else if (zombie.z <= -33) {
        zombie.anim = 'attack'; zombie.yaw = Math.PI;
        if (!zombie.cooldown) { village.keep.hp = Math.max(0, village.keep.hp - (zombie.elite ? 20 : 10)); zombie.cooldown = 1.4; }
        if (village.keep.hp <= 0) { village.status = 'fallen'; this.notice(village.id, 'The Hearthkeep has fallen. Your personal bank savings are safe.'); this.store.saveVillage(village); return; }
      } else {
        const point = ROAD[Math.min(zombie.roadIndex, ROAD.length - 1)];
        if (distance(zombie, point) < 2 && zombie.roadIndex < ROAD.length - 1) zombie.roadIndex++;
        this.stepNpc(zombie, ROAD[Math.min(zombie.roadIndex, ROAD.length - 1)], zombie.speed, dt, zombies);
      }
    }
  }
  saveAll() { for (const village of this.villages.values()) this.store.saveVillage(village); }
}
