import { CIVIC_BOARD, CIVIC_PROJECTS, CIVIC_DEPOT_ITEMS, CIVIC_SIEGE } from '../shared/civic.js';
import { transferableCount } from '../shared/content.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const full = (stock, cost) => Object.entries(cost).every(([id, count]) => (stock[id] ?? 0) >= count);
function spend(stock, cost) { for (const [id, amount] of Object.entries(cost)) stock[id] -= amount; }
export function ensureCivic(village) {
  village.civic ??= { active: null, completed: [], progress: {}, contributors: {}, depot: {}, siege: {}, mason: { x: -10, z: -23, paidTime: 0, cooldown: 0, status: 'waiting' } };
  return village.civic;
}
export function civicAction(sim, village, player, action) {
  if (!['civic_select', 'civic_donate', 'civic_supply'].includes(action.kind)) return null;
  const works = ensureCivic(village);
  if (!player.online || player.downed || distance(player, CIVIC_BOARD) > 4) throw new Error('Visit the village works board beside the Treasury.');
  if (action.kind === 'civic_select') {
    const project = typeof action.projectId === 'string' && Object.hasOwn(CIVIC_PROJECTS, action.projectId) ? CIVIC_PROJECTS[action.projectId] : null;
    if (!project || works.completed.includes(action.projectId)) throw new Error('Choose an unfinished village project.');
    if (works.active) throw new Error('Finish the current village project before starting another.');
    if (project.requires && !works.completed.includes(project.requires)) throw new Error('Complete the required village project first.');
    works.active = action.projectId; works.progress = {};
    sim.notice?.(village.id, `${player.name} started a village project: ${project.name}. Everyone can donate at the works board.`);
    return `${project.name} opened for contributions.`;
  }
  const supply = action.kind === 'civic_supply', project = typeof works.active === 'string' && Object.hasOwn(CIVIC_PROJECTS, works.active) ? CIVIC_PROJECTS[works.active] : null, resource = action.resource;
  if (!supply && !project) throw new Error('Choose a village project first.');
  if (typeof resource !== 'string' || (supply ? !CIVIC_DEPOT_ITEMS.includes(resource) : !Object.hasOwn(project.cost, resource))) throw new Error('That resource is not needed here.');
  let source = resource === 'gold' ? player : player.inventory;
  let key = resource === 'gold' ? 'wallet' : resource;
  let available = resource === 'gold' ? player.wallet : transferableCount(player, resource);
  if (action.cartId) {
    const cart = village.carts?.find(c => c.id === action.cartId);
    if (resource === 'gold' || !cart || cart.ownerId !== player.id || distance(player, cart) > 5 || distance(cart, CIVIC_BOARD) > 8) throw new Error('Bring your own freight cart beside the works board.');
    source = cart.storage ?? {}; key = resource; available = source[resource] ?? 0;
  }
  const destination = supply ? works.depot : works.progress;
  if (!Number.isSafeInteger(destination[resource] ?? 0) || (destination[resource] ?? 0) < 0) throw new Error('The works depot cannot accept that contribution right now.');
  const room = supply ? 10000000 - (destination[resource] ?? 0) : project.cost[resource] - (destination[resource] ?? 0);
  const amount = action.amount === 'max' ? Math.min(available, room) : action.amount;
  if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(available) || amount > available || amount > room) throw new Error('Choose a whole contribution within your available stock and the remaining requirement.');
  source[key] -= amount; destination[resource] = (destination[resource] ?? 0) + amount;
  const ledger = works.contributors[player.id] ??= { name: player.name, resources: {} };
  ledger.name = player.name; ledger.resources[resource] = (ledger.resources[resource] ?? 0) + amount;
  if (!supply && full(works.progress, project.cost)) {
    const id = works.active; works.completed.push(id); works.active = null; works.progress = {};
    if (id === 'reinforcement') {
      for (const [target, bonus] of [[village.gate, 1200], [village.keep, 1000]]) { target.maxHp += bonus; target.hp = Math.min(target.maxHp, target.hp + bonus); }
    }
    sim.notice?.(village.id, `Village project complete: ${project.name}!`);
    return `${project.name} completed. Its improvements are now active.`;
  }
  return `${amount} ${resource} donated to ${supply ? 'the works depot' : project.name}.`;
}
export function civicTick(sim, village, dt) {
  const works = ensureCivic(village);
  if (works.completed.includes('repair_crew')) {
    const mason = works.mason;
    const id = village.gate.hp < village.gate.maxHp ? 'gate' : village.keep.hp < village.keep.maxHp ? 'keep' : null;
    if (!id) mason.status = 'All structures repaired';
    else if (!full(works.depot, { timber: 1, stone: 1 }) || !(mason.paidTime > 0 || works.depot.gold >= 1)) mason.status = 'Waiting for donated timber, stone and wages';
    else {
      if (!(mason.paidTime > 0)) { works.depot.gold--; mason.paidTime = 60; }
      const worked = Math.min(dt, mason.paidTime); mason.paidTime -= worked;
      const target = id === 'gate' ? { x: 0, z: 14 } : { x: 0, z: -35 };
      mason.status = `Repairing the ${id}`; mason.target = id;
      if (distance(mason, target) > 1.4) {
        const waypoint = Math.abs(mason.x) > .6 ? { x: 0, z: mason.z } : target;
        sim.stepNpc?.(mason, waypoint, 3, worked, []);
      } else {
        mason.cooldown -= worked;
        if (mason.cooldown <= 0) { spend(works.depot, { timber: 1, stone: 1 }); village[id].hp = Math.min(village[id].maxHp, village[id].hp + 35); mason.cooldown = 4; }
      }
    }
  }
  for (const [id, stats] of Object.entries(CIVIC_SIEGE)) {
    if (!works.completed.includes(id)) continue;
    const siege = works.siege[id] ??= { cooldown: 0, sequence: 0 };
    siege.cooldown = Math.max(0, siege.cooldown - dt);
    if (siege.cooldown > 0 || !full(works.depot, stats.ammo)) continue;
    // Fixed gatehouse emplacements fire outward above the wall; they cannot
    // reach through the keep or other interior buildings to attack villagers.
    const targets = village.zombies.filter(z => z.hp > 0 && z.z > 21 && distance(stats, z) <= stats.range);
    const target = targets.sort((a, b) => distance(stats, a) - distance(stats, b))[0];
    if (!target) continue;
    spend(works.depot, stats.ammo); siege.cooldown = stats.cooldown; siege.sequence++;
    siege.lastShot = { id: `${id}:${siege.sequence}`, x: target.x, z: target.z, at: village.clock };
    for (const zombie of targets.filter(z => z === target || stats.splash && distance(z, target) <= stats.splash)) sim.hitZombie(village, zombie, stats.damage, null);
  }
}
export function civicSnapshot(village) { return { civic: structuredClone(ensureCivic(village)) }; }
