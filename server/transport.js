import { canUseBuilding, canUsePlot, canUseChurchBed } from '../shared/access.js';
import { randomUUID } from 'node:crypto';
import { BUILDINGS, canStand, moveWithCollision, plotSolids, plotBedPoint, groundHeight } from '../shared/world.js';
import { RESOURCE_WEIGHTS, inventoryWeight, transferableCount } from '../shared/content.js';
import { TRANSPORT, LOANS, cartCapacity, cartPassengerPoint, transportPlotSite, mountedTravelSpeed } from '../shared/transport.js';
import { moveResource, PLAYER_CARRY_LIMIT } from '../shared/transfers.js';
import { plotStorageCapacity } from '../shared/production.js';
import { CHURCH, bedCapacity } from '../shared/defense.js';
import { requireCartAllowance } from '../shared/cart-ownership.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const nearBuilding = (player, id) => canUseBuilding(player, BUILDINGS.find(candidate => candidate.id === id));
const wholeAmount = amount => { if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000000) throw new Error('Choose a positive whole amount.'); return amount; };

export function ensureTransport(village) {
  village.stable ??= { stock: 0 };
  village.horses ??= [];
  village.carts ??= [];
  village.loanPool ??= { lent: 0 };
  for (const player of Object.values(village.players)) { player.mountedHorseId ??= null; player.rescueCartId ??= null; player.rescueSlot ??= null; }
  for (const cart of village.carts) {
    cart.storage ??= {}; cart.upgradeLevel = cart.upgradeLevel >= 1 ? 1 : 0;
    cart.rescuePlayerIds = [...new Set(Array.isArray(cart.rescuePlayerIds) ? cart.rescuePlayerIds : [])].slice(0, TRANSPORT.rescueCapacity);
  }
}

export function availableGold(sim, player) {
  return player.wallet + (sim.store.account(player.id)?.credit ?? 0);
}

// Call only for a validated approved purchase, inside the simulation transaction.
// Ordinary shopping, banking, treatment and transfers must use wallet gold.
export function chargePurchase(sim, village, player, amount, { credit = false } = {}) {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Invalid purchase price.');
  const account = sim.store.account(player.id), permitted = credit ? account?.credit ?? 0 : 0;
  if (player.wallet + permitted < amount) throw new Error(credit ? 'You need more wallet gold or approved purchase credit.' : 'You need more wallet gold.');
  const cash = Math.min(player.wallet, amount), borrowed = amount - cash;
  if (borrowed) sim.store.spendCredit(player.id, borrowed);
  player.wallet -= cash;
  return { cash, credit: borrowed };
}
export const spendGold = (sim, village, player, amount) => chargePurchase(sim, village, player, amount, { credit: true });

export function bankTransfer(sim, village, player, action) {
  if (!nearBuilding(player, 'bank')) throw new Error('Visit the Village Treasury to use your savings.');
  const deposit = action.kind === 'deposit', account = sim.store.account(player.id);
  if (!['deposit', 'withdraw'].includes(action.kind) || !account || !Number.isSafeInteger(account.bank) || !Number.isSafeInteger(player.wallet) || player.wallet < 0 || account.bank < 0) throw new Error('Your savings cannot be transferred.');
  if (action.max !== undefined && typeof action.max !== 'boolean') throw new Error('Enter a whole gold amount.');
  const source = deposit ? player.wallet : account.bank, destination = deposit ? account.bank : player.wallet;
  const amount = action.max === true ? Math.min(source, Number.MAX_SAFE_INTEGER - destination) : action.amount;
  if (!Number.isSafeInteger(amount) || amount < 1 || (action.max !== true && amount > 1000000)) throw new Error(source ? 'Enter a whole gold amount.' : deposit ? 'Your wallet is empty.' : 'Your savings are empty.');
  if (amount > source) throw new Error(deposit ? 'You do not have that much gold in your wallet.' : 'Insufficient bank savings.');
  if (!Number.isSafeInteger(destination + amount)) throw new Error('That account cannot hold more gold.');
  const delta = deposit ? amount : -amount;
  const beforeWallet = player.wallet;
  try { sim.store.transaction(() => { sim.store.bank(player.id, delta); player.wallet -= delta; sim.store.saveVillage(village); }); }
  catch (error) { player.wallet = beforeWallet; throw error; }
  return `${amount} gold ${deposit ? 'secured in your personal bank' : 'withdrawn to your wallet'}.`;
}

// Only earnings enter this path. Deposits, withdrawals and refunds never repay
// loans automatically. Fractional accounting prevents 1-gold sales evading debt.
export function repayIncome(sim, village, player, amount) {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Invalid income amount.');
  const account = sim.store.account(player.id);
  if (!account?.debt || !amount) return amount;
  const accrued = amount * LOANS.repaymentPercent + (account.repayment_remainder ?? 0);
  const repaid = Math.min(account.debt, Math.floor(accrued / 100));
  sim.store.repayDebt(player.id, repaid, accrued % 100);
  village.treasury += repaid;
  return amount - repaid;
}

function ownerHorse(village, player, id) {
  const horse = village.horses.find(candidate => candidate.id === id);
  if (!horse || horse.ownerId !== player.id) throw new Error('That horse belongs to another dwarf.');
  return horse;
}
function ownerCart(village, player, id) {
  const cart = village.carts.find(candidate => candidate.id === id);
  if (!cart || cart.ownerId !== player.id) throw new Error('That cart belongs to another dwarf.');
  if (distance(player, cart) > 4) throw new Error('Move closer to your cart.');
  return cart;
}
export function dismountPlayer(village, player) {
  for (const horse of village.horses ?? []) if (horse.riderId === player.id) { horse.riderId = null; horse.moving = false; }
  player.mountedHorseId = null;
}

function safeUnloadPoint(village, cart, player) {
  const solids = plotSolids(village.plots), yaw = cart.yaw ?? 0;
  for (const offset of [[-1.9, 0], [1.9, 0], [0, -2], [-2.3, -2], [2.3, -2], [0, 2.5]]) {
    const point = { x: cart.x + Math.cos(yaw) * offset[0] + Math.sin(yaw) * offset[1], z: cart.z - Math.sin(yaw) * offset[0] + Math.cos(yaw) * offset[1] };
    if (canStand(point.x, point.z, .48, solids)) return point;
  }
  if (canStand(cart.x, cart.z, .48, solids)) return { x: cart.x, z: cart.z };
  return { x: player.x, z: player.z };
}

// The player is the body: seats contain identities only. Clearing every roster
// makes respawn/reconnect and malformed old saves unable to duplicate a body.
export function releaseTransportPassenger(village, player, { place = true } = {}) {
  const cart = village.carts?.find(c => c.id === player.rescueCartId);
  if (place && cart) Object.assign(player, safeUnloadPoint(village, cart, player));
  for (const candidate of village.carts ?? []) candidate.rescuePlayerIds = (candidate.rescuePlayerIds ?? []).filter(id => id !== player.id);
  player.rescueCartId = null; player.rescueSlot = null;
  if (place && cart) { player.y = groundHeight(player.x, player.z); player.verticalSpeed = 0; player.grounded = true; }
}

function rescuePassenger(village, cart, id) {
  const target = village.players[id];
  if (!target || target.rescueCartId !== cart.id || !cart.rescuePlayerIds.includes(id)) throw new Error('That dwarf is not riding in this carriage.');
  return target;
}

function rescueTreatment(sim, village, player, cart, action) {
  const target = rescuePassenger(village, cart, action.playerId);
  if (!target.online || !target.downed || target.bedPlotId) throw new Error('That passenger is unavailable for revival.');
  const plot = village.plots.find(p => p.id === action.plotId), site = transportPlotSite(plot);
  if (!plot?.ownerId || plot.building !== 'church' || plot.hp <= 0 || !(canUsePlot(player, site, plot) || canUseChurchBed(player, site, plot)) || distance(cart, player) > 4) throw new Error('Park beside a standing church and approach its entrance or beds.');
  const occupied = new Set((plot.patients ?? []).map(p => p.bedIndex));
  const bedIndex = Array.from({ length: bedCapacity(plot) }, (_, i) => i).find(i => !occupied.has(i));
  if (bedIndex === undefined) throw new Error('All church beds are occupied.');
  if (!Number.isSafeInteger(player.wallet) || player.wallet < CHURCH.reviveFee) throw new Error(`Church treatment costs ${CHURCH.reviveFee} gold.`);
  player.wallet -= CHURCH.reviveFee;
  releaseTransportPassenger(village, target, { place: false });
  const until = village.clock + CHURCH.reviveSeconds;
  Object.assign(target, plotBedPoint(site, bedIndex), { bedPlotId: plot.id, healing: null, anim: 'downed', animationUntil: until });
  target.y = groundHeight(target.x, target.z); target.verticalSpeed = 0; target.grounded = true;
  (plot.patients ??= []).push({ playerId: target.id, payerId: player.id, fee: CHURCH.reviveFee, until, revive: true, bedIndex });
  sim.inputs?.delete(target.id);
  return `${target.name} placed in a church bed. Revival takes ${CHURCH.reviveSeconds} seconds and costs ${CHURCH.reviveFee} gold.`;
}

export function transportAction(sim, village, player, action) {
  const recognized = ['loan', 'repayLoan', 'buyHorse', 'mountHorse', 'dismountHorse', 'deployCart', 'attachCart', 'cartDeposit', 'cartWithdraw', 'cartUpgrade', 'cartRescueLoad', 'cartRescueUnload', 'cartRescueTreat', 'cartPlotLoad', 'cartPlotUnload'];
  if (!recognized.includes(action.kind)) return null;
  ensureTransport(village);
  if (action.kind === 'loan') {
    if (!nearBuilding(player, 'bank')) throw new Error('Visit the Village Treasury to apply for a loan.');
    const amount = wholeAmount(action.amount);
    if (amount > LOANS.maximumDebt || village.loanPool.lent + amount > LOANS.runPool) throw new Error('The village lending pool cannot fund this loan.');
    if (village.treasury - amount < LOANS.reserve) throw new Error('The steward must preserve 1,000 gold for village essentials.');
    sim.store.issueCredit(player.id, amount, LOANS.maximumDebt);
    village.treasury -= amount; village.loanPool.lent += amount;
    return `${amount} gold of approved purchase credit granted. It can fund plots, construction and shop equipment. Debt follows your account; 20% of earnings repays it.`;
  }
  if (action.kind === 'repayLoan') {
    if (!nearBuilding(player, 'bank')) throw new Error('Visit the Village Treasury to repay a loan.');
    const amount = wholeAmount(action.amount), debt = sim.store.account(player.id)?.debt ?? 0;
    if (amount > player.wallet) throw new Error('You need that much gold in your wallet.');
    if (amount > debt) throw new Error('Repayment exceeds your outstanding loan.');
    sim.store.repayDebt(player.id, amount); player.wallet -= amount; village.treasury += amount;
    return `${amount} gold repaid. Your protected bank savings were not used.`;
  }
  if (action.kind === 'buyHorse') {
    if (!nearBuilding(player, 'stable')) throw new Error('Visit the village stable to buy a horse.');
    if (village.stable.stock < 1) throw new Error('The stable is empty. The steward can restock when the merchant visits.');
    if (village.horses.filter(horse => horse.ownerId === player.id).length >= TRANSPORT.maxHorses) throw new Error('You already own a horse in this village.');
    const stable = BUILDINGS.find(b => b.id === 'stable');
    const spawn = [0, 2.5, -2.5, 5, -5, 7.5, -7.5, 10].map(offset => ({ x: stable.x - stable.w / 2 - 2.5, z: stable.z + offset })).find(point => canStand(point.x, point.z, .8, plotSolids(village.plots)) && village.horses.every(horse => distance(horse, point) >= 2));
    if (!spawn) throw new Error('The stable exit is blocked. Move nearby horses first.');
    const horse = { id: randomUUID(), ownerId: player.id, ...spawn, yaw: Math.PI, riderId: null, cartId: null, moving: false };
    spendGold(sim, village, player, TRANSPORT.horseCost);
    village.treasury += TRANSPORT.horseCost; village.stable.stock--; village.horses.push(horse);
    return 'Your horse is waiting beside the stable. Approach it to mount.';
  }
  if (action.kind === 'mountHorse') {
    if (player.mountedHorseId) throw new Error('Dismount your current horse first.');
    if (player.carryingId || player.carriedBy || player.bedPlotId || player.rescueCartId) throw new Error('Finish carrying or treatment before riding.');
    const horse = ownerHorse(village, player, action.targetId);
    if (distance(player, horse) > 3.5) throw new Error('Move closer to your horse.');
    if (horse.riderId) throw new Error('This horse is already being ridden.');
    horse.riderId = player.id; player.mountedHorseId = horse.id;
    player.x = horse.x; player.z = horse.z; player.yaw = horse.yaw; player.healing = null;
    sim.inputs?.delete(player.id);
    return 'Mounted. Use your usual movement keys to ride; dismount before fighting or working.';
  }
  if (action.kind === 'dismountHorse') {
    if (!player.mountedHorseId) throw new Error('You are not riding a horse.');
    const horse = ownerHorse(village, player, player.mountedHorseId);
    const side = [1, -1].map(direction => ({ x: horse.x + Math.cos(horse.yaw) * 1.5 * direction, z: horse.z - Math.sin(horse.yaw) * 1.5 * direction })).find(point => canStand(point.x, point.z, .48, plotSolids(village.plots)));
    if (!side) throw new Error('Ride to an open place before dismounting.');
    dismountPlayer(village, player); player.x = side.x; player.z = side.z;
    sim.inputs?.delete(player.id);
    return 'Dismounted. Your horse will wait here.';
  }
  if (action.kind === 'deployCart') {
    if (player.mountedHorseId) throw new Error('Dismount before placing your cart.');
    if ((player.inventory.cart ?? 0) < 1) throw new Error('Buy a cargo cart from a stocked tinker shop first.');
    if (village.carts.filter(cart => cart.ownerId === player.id).length >= TRANSPORT.maxCarts) throw new Error('You already have a cargo cart in this village.');
    const point = { x: player.x - Math.sin(player.yaw) * 2.5, z: player.z - Math.cos(player.yaw) * 2.5 };
    if (!canStand(point.x, point.z, 1, plotSolids(village.plots))) throw new Error('Find an open place with room for a cart behind you.');
    player.inventory.cart--; village.carts.push({ id: randomUUID(), ownerId: player.id, ...point, yaw: player.yaw, horseId: null, storage: {}, upgradeLevel: 0, rescuePlayerIds: [] });
    return 'Cargo cart placed. Move beside it to load supplies or attach your horse.';
  }
  if (action.kind === 'attachCart') {
    const cart = ownerCart(village, player, action.targetId);
    if (!action.horseId) {
      const horse = village.horses.find(candidate => candidate.id === cart.horseId);
      if (horse) horse.cartId = null;
      cart.horseId = null; return 'Cart detached. Stored supplies remain safe in it.';
    }
    const horse = ownerHorse(village, player, action.horseId);
    if (cart.horseId || horse.cartId) throw new Error('Detach the existing harness first.');
    if (distance(cart, horse) > 5) throw new Error('Bring your horse closer to the cart.');
    horse.cartId = cart.id; cart.horseId = horse.id;
    return 'Cart attached. Its cargo travels behind your horse.';
  }
  if (action.kind === 'cartUpgrade') {
    const cart = ownerCart(village, player, action.targetId);
    if (cart.upgradeLevel >= 1) throw new Error('This carriage already has its reinforced 2,000-capacity chassis.');
    if (player.mountedHorseId || player.carryingId) throw new Error('Dismount and set down your companion before upgrading the carriage.');
    if (!Number.isSafeInteger(player.wallet) || player.wallet < TRANSPORT.cartUpgradeGold) throw new Error(`Carriage reinforcement costs ${TRANSPORT.cartUpgradeGold} wallet gold.`);
    if (!Object.entries(TRANSPORT.cartUpgradeMaterials).every(([id, amount]) => transferableCount(player, id) >= amount)) throw new Error('Carry 40 timber and 15 iron to reinforce the carriage.');
    player.wallet -= TRANSPORT.cartUpgradeGold; village.treasury += TRANSPORT.cartUpgradeGold;
    for (const [id, amount] of Object.entries(TRANSPORT.cartUpgradeMaterials)) player.inventory[id] -= amount;
    cart.upgradeLevel = 1;
    return 'Carriage reinforced: 2,000 cargo capacity, with both rescue stretchers preserved.';
  }
  if (action.kind === 'cartRescueLoad') {
    const cart = ownerCart(village, player, action.targetId), target = village.players[action.playerId];
    if (player.mountedHorseId || player.bedPlotId) throw new Error('Dismount before helping a fallen dwarf into the carriage.');
    if (!target?.online || !target.downed || target.id === player.id || target.rescueCartId || target.bedPlotId || target.mountedHorseId || target.carriedBy && target.carriedBy !== player.id || distance(player, target) > 3.5 || distance(cart, target) > 5.5) throw new Error('Bring an unseated downed dwarf beside your carriage.');
    if (cart.rescuePlayerIds.length >= TRANSPORT.rescueCapacity) throw new Error('Both carriage stretchers are occupied.');
    if (target.carriedBy === player.id) { player.carryingId = null; target.carriedBy = null; }
    target.carryingId = null; target.rescueCartId = cart.id; target.rescueSlot = cart.rescuePlayerIds.length;
    cart.rescuePlayerIds.push(target.id);
    Object.assign(target, cartPassengerPoint(cart, target.rescueSlot), { yaw: cart.yaw, anim: 'downed', healing: null });
    target.y = groundHeight(target.x, target.z); target.verticalSpeed = 0; target.grounded = true;
    player.healing = null; sim.inputs?.delete(target.id);
    return `${target.name} secured on a carriage stretcher. Drive to a church for revival.`;
  }
  if (action.kind === 'cartRescueUnload') {
    const cart = ownerCart(village, player, action.targetId), target = rescuePassenger(village, cart, action.playerId);
    releaseTransportPassenger(village, target);
    return `${target.name} safely unloaded beside the carriage.`;
  }
  if (action.kind === 'cartRescueTreat') return rescueTreatment(sim, village, player, ownerCart(village, player, action.targetId), action);
  if (['cartPlotLoad', 'cartPlotUnload'].includes(action.kind)) {
    const cart = ownerCart(village, player, action.targetId), plot = village.plots.find(p => p.id === action.plotId), site = transportPlotSite(plot);
    if (!plot?.building || !plot.ownerId || !(canUsePlot(player, site, plot)) || distance(player, cart) > 4) throw new Error('Park beside the plot and stand at its entrance to move bulk freight.');
    const loading = action.kind === 'cartPlotLoad';
    if (loading && plot.ownerId !== player.id) throw new Error('Only the plot owner can load its supplies into a carriage.');
    if (!Object.hasOwn(RESOURCE_WEIGHTS, action.resource)) throw new Error('Choose a stackable resource or supply.');
    if (action.resource === 'cart' && !loading && plot.ownerId !== player.id) {
      const owner = village.players[plot.ownerId];
      if (!owner) throw new Error('This plot owner is unavailable.');
      requireCartAllowance(village, owner, action.max ? cart.storage.cart ?? 0 : action.amount);
    }
    plot.storage ??= {};
    const amount = moveResource({ source: loading ? plot.storage : cart.storage, destination: loading ? cart.storage : plot.storage, resource: action.resource, action,
      capacity: loading ? cartCapacity(cart) : plotStorageCapacity(plot), fullMessage: loading ? 'The carriage is full.' : 'This plot storage is full.' });
    return `${amount} ${action.resource} moved directly ${loading ? 'from plot storage into your carriage' : 'from your carriage into plot storage'}.`;
  }
  const cart = ownerCart(village, player, action.targetId), resource = action.resource;
  if (!Object.hasOwn(RESOURCE_WEIGHTS, resource)) throw new Error('Choose a stackable resource or food item.');
  const depositing = action.kind === 'cartDeposit';
  const amount = moveResource({ source: depositing ? player : cart.storage, destination: depositing ? cart.storage : player, resource, action,
    capacity: depositing ? cartCapacity(cart) : PLAYER_CARRY_LIMIT, fullMessage: depositing ? 'The cart cannot carry that much cargo.' : 'Your pack cannot accept that item count.' });
  return `${amount} ${resource} ${depositing ? 'loaded into' : 'taken from'} your cart.`;
}

export function transportTick(sim, village, dt) {
  ensureTransport(village);
  for (const horse of village.horses) {
    const rider = village.players[horse.riderId];
    if (!rider?.online || rider.downed || rider.mountedHorseId !== horse.id) {
      if (rider?.mountedHorseId === horse.id) rider.mountedHorseId = null;
      horse.riderId = null; horse.moving = false;
    } else {
      horse.moving = distance(horse, rider) > .01;
      horse.x = rider.x; horse.z = rider.z; horse.yaw = rider.yaw;
    }
    const cart = village.carts.find(candidate => candidate.id === horse.cartId);
    if (!cart || cart.horseId !== horse.id) { horse.cartId = null; continue; }
    if (horse.moving) {
      const apart = distance(cart, horse);
      if (apart > 3) {
        const travel = Math.min(apart - 3, (rider ? mountedTravelSpeed(village, rider) : TRANSPORT.horseSpeed) * dt * 1.4);
        moveWithCollision(cart, (horse.x - cart.x) / apart * travel, (horse.z - cart.z) / apart * travel, .8, plotSolids(village.plots));
        cart.yaw = Math.atan2(horse.x - cart.x, horse.z - cart.z);
      }
      if (distance(cart, horse) > 8) { cart.horseId = null; horse.cartId = null; if (rider) sim.notice?.(village.id, `${rider.name}'s cart harness detached at an obstacle. Its cargo is still in the cart.`); }
    }
  }
  for (const player of Object.values(village.players)) {
    if (player.rescueCartId && (!player.online || !player.downed || player.bedPlotId || player.carriedBy || !village.carts.some(c => c.id === player.rescueCartId && c.rescuePlayerIds.includes(player.id)))) releaseTransportPassenger(village, player, { place: !player.bedPlotId });
  }
  for (const cart of village.carts) {
    const owner = village.players[cart.ownerId];
    if (!owner?.online || owner.downed) for (const id of [...cart.rescuePlayerIds]) {
      const passenger = village.players[id];
      if (passenger?.rescueCartId === cart.id) releaseTransportPassenger(village, passenger);
    }
    cart.rescuePlayerIds = cart.rescuePlayerIds.filter(id => village.players[id]?.rescueCartId === cart.id);
    cart.rescuePlayerIds.forEach((id, slot) => {
      const passenger = village.players[id];
      Object.assign(passenger, cartPassengerPoint(cart, slot), { rescueSlot: slot, yaw: cart.yaw, anim: 'downed' });
      passenger.y = groundHeight(passenger.x, passenger.z); passenger.verticalSpeed = 0; passenger.grounded = true;
    });
  }
}

export function transportSnapshot(village, viewerId, store) {
  ensureTransport(village);
  const account = store?.account(viewerId);
  return {
    stable: { stock: village.stable.stock },
    horses: village.horses.map(horse => ({ ...horse })),
    carts: village.carts.map(({ storage, ...cart }) => ({ ...cart, rescuePlayerIds: [...cart.rescuePlayerIds], weight: inventoryWeight(storage), capacity: cartCapacity(cart), rescueCapacity: TRANSPORT.rescueCapacity, ...(cart.ownerId === viewerId ? { storage: { ...storage } } : {}) })),
    loan: { debt: account?.debt ?? 0, credit: account?.credit ?? 0, maxDebt: LOANS.maximumDebt, repaymentPercent: LOANS.repaymentPercent, availablePool: Math.max(0, LOANS.runPool - village.loanPool.lent) }
  };
}
