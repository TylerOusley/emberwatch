import { TRANSPORT } from './transport.js';

const cartsIn = stock => Number.isSafeInteger(stock?.cart) && stock.cart > 0 ? stock.cart : 0;

// Packed carts remain owned when stored on an owned plot or in an owned cart.
export function ownedCartCount(village, player) {
  return cartsIn(player.inventory) + (village.plots ?? []).filter(plot => plot.ownerId === player.id).reduce((sum, plot) => sum + cartsIn(plot.storage), 0) +
    (village.carts ?? []).filter(cart => cart.ownerId === player.id).reduce((sum, cart) => sum + 1 + cartsIn(cart.storage), 0);
}

export function requireCartAllowance(village, player, amount = 1, outgoing = 0) {
  if (!Number.isSafeInteger(amount) || amount < 0 || !Number.isSafeInteger(outgoing) || outgoing < 0 || ownedCartCount(village, player) - outgoing + amount > TRANSPORT.maxCarts) {
    throw new Error('Each dwarf may own only one cargo cart, including packed and stored carts.');
  }
}
