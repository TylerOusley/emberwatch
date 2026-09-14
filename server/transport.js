import { randomUUID } from 'node:crypto';
import { BUILDINGS, canStand, moveWithCollision, plotSolids } from '../shared/world.js';
import { CARRY_CAPACITY, RESOURCE_WEIGHTS, inventoryWeight } from '../shared/content.js';
import { TRANSPORT, LOANS } from '../shared/transport.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function nearBuilding(player, id) {
  const b = BUILDINGS.find(candidate => candidate.id === id);
  return b && Math.hypot(Math.max(0, Math.abs(player.x - b.x) - b.w / 2), Math.max(0, Math.abs(player.z - b.z) - b.d / 2)) <= 3.5;
}
const wholeAmount = amount => { if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000000) throw new Error('Choose a positive whole amount.'); return amount; };

export function ensureTransport(village) {
  village.stable ??= { stock: 0 };
  village.horses ??= [];
  village.carts ??= [];
  village.loanPool ??= { lent: 0 };
  for (const player of Object.values(village.players)) player.mountedHorseId ??= null;
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

export function transportAction(sim, village, player, action) {
  const recognized = ['loan', 'repayLoan', 'buyHorse', 'mountHorse', 'dismountHorse', 'deployCart', 'attachCart', 'cartDeposit', 'cartWithdraw'];
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
    if (player.carryingId || player.carriedBy || player.bedPlotId) throw new Error('Finish carrying or treatment before riding.');
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
    player.inventory.cart--; village.carts.push({ id: randomUUID(), ownerId: player.id, ...point, yaw: player.yaw, horseId: null, storage: {} });
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
  const cart = ownerCart(village, player, action.targetId), amount = wholeAmount(action.amount), resource = action.resource;
  if (!Object.hasOwn(RESOURCE_WEIGHTS, resource)) throw new Error('Choose a stackable resource or food item.');
  const depositing = action.kind === 'cartDeposit', source = depositing ? player.inventory : cart.storage, destination = depositing ? cart.storage : player.inventory;
  if ((source[resource] ?? 0) < amount) throw new Error('There are not enough items to move.');
  const weight = amount * RESOURCE_WEIGHTS[resource];
  if (depositing ? inventoryWeight(cart.storage) + weight > TRANSPORT.cartCapacity : inventoryWeight(player) + weight > CARRY_CAPACITY) throw new Error(depositing ? 'The cart cannot carry that much cargo.' : 'Your pack cannot carry that much cargo.');
  source[resource] -= amount; destination[resource] = (destination[resource] ?? 0) + amount;
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
        const travel = Math.min(apart - 3, TRANSPORT.horseSpeed * dt * 1.4);
        moveWithCollision(cart, (horse.x - cart.x) / apart * travel, (horse.z - cart.z) / apart * travel, .8, plotSolids(village.plots));
        cart.yaw = Math.atan2(horse.x - cart.x, horse.z - cart.z);
      }
      if (distance(cart, horse) > 8) { cart.horseId = null; horse.cartId = null; if (rider) sim.notice?.(village.id, `${rider.name}'s cart harness detached at an obstacle. Its cargo is still in the cart.`); }
    }
  }
}

export function transportSnapshot(village, viewerId, store) {
  ensureTransport(village);
  const account = store?.account(viewerId);
  return {
    stable: { stock: village.stable.stock },
    horses: village.horses.map(horse => ({ ...horse })),
    carts: village.carts.map(({ storage, ...cart }) => ({ ...cart, weight: inventoryWeight(storage), capacity: TRANSPORT.cartCapacity, ...(cart.ownerId === viewerId ? { storage: { ...storage } } : {}) })),
    loan: { debt: account?.debt ?? 0, credit: account?.credit ?? 0, maxDebt: LOANS.maximumDebt, repaymentPercent: LOANS.repaymentPercent, availablePool: Math.max(0, LOANS.runPool - village.loanPool.lent) }
  };
}
