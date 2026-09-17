import { TRANSPORT, cartCapacity, transportPlotSite, onFreightRoad } from '../../shared/transport.js';
import { canUsePlot, canUseChurchBed } from '../../shared/access.js';
import { CHURCH, bedCapacity } from '../../shared/defense.js';
import { RESOURCE_WEIGHTS, transferableCount } from '../../shared/content.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const gap = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const name = id => String(id).replaceAll('_', ' ');

// Uses the settlement panel's command registry, so these controls keep its
// pointer-lock, event binding and server-authoritative action path.
export function cartTransportControls({ state, player, cart, command }) {
  if (cart.ownerId !== player.id) return '<p class="menu-footnote">The owner manages this carriage’s freight and rescue stretchers.</p>';
  const nearby = gap(player, cart) <= 4, players = state.players ?? [], seats = cart.rescuePlayerIds ?? [];
  let html = `<h3>Freight carriage</h3><p>${cartCapacity(cart).toLocaleString()} cargo capacity. Loaded carriages and rescue journeys travel 20% faster on village roads. ${onFreightRoad(cart) ? 'This carriage is on a freight road.' : 'Follow the paved roads for the travel bonus.'}</p>`;
  if (!(cart.upgradeLevel >= 1)) {
    const funded = player.wallet >= TRANSPORT.cartUpgradeGold && Object.entries(TRANSPORT.cartUpgradeMaterials).every(([id, amount]) => transferableCount(player, id) >= amount);
    html += '<p>Reinforced chassis: 2,000 capacity for 750 gold, 40 timber and 15 iron carried in your pack.</p>' + command('Reinforce carriage · 2,000 capacity', 'cartUpgrade', { targetId: cart.id }, !nearby || !funded || !!player.mountedHorseId || !!player.carryingId);
  }
  html += `<h3>Rescue stretchers · ${seats.length} / ${TRANSPORT.rescueCapacity}</h3><p>Two separate stretchers leave all cargo space available. Load a downed companion, ride to a church, then place them in an available bed.</p>`;
  const churches = (state.plots ?? []).filter(plot => plot.ownerId && plot.building === 'church' && plot.hp > 0 && (canUsePlot(player, transportPlotSite(plot), plot) || canUseChurchBed(player, transportPlotSite(plot), plot)));
  for (const id of seats) {
    const target = players.find(p => p.id === id);
    html += `<p><strong>${escape(target?.name ?? 'Passenger')}</strong></p>` + command('Unload beside carriage', 'cartRescueUnload', { targetId: cart.id, playerId: id }, !nearby);
    for (const church of churches) {
      const occupied = (state.beds ?? []).find(bed => bed.plotId === church.id)?.patients?.length ?? 0;
      html += command(`Place in ${transportPlotSite(church).name ?? 'church'} bed · ${CHURCH.reviveFee}g`, 'cartRescueTreat', { targetId: cart.id, playerId: id, plotId: church.id }, !nearby || occupied >= bedCapacity(church) || player.wallet < CHURCH.reviveFee);
    }
  }
  const candidates = players.filter(p => p.id !== player.id && p.online && p.downed && !p.rescueCartId && !p.bedPlotId && (!p.carriedBy || p.carriedBy === player.id) && gap(player, p) <= 3.5 && gap(cart, p) <= 5.5);
  for (const target of candidates) html += command(`Load ${target.name} onto stretcher`, 'cartRescueLoad', { targetId: cart.id, playerId: target.id }, !nearby || seats.length >= TRANSPORT.rescueCapacity || !!player.mountedHorseId);
  if (!seats.length && !candidates.length) html += '<p class="menu-footnote">Bring a fallen companion beside this carriage to load a stretcher.</p>';
  const plots = (state.plots ?? []).filter(plot => plot.ownerId && plot.building && canUsePlot(player, transportPlotSite(plot), plot));
  if (plots.length && nearby) html += '<h3>Bulk freight</h3><p>Move supplies directly between the nearby plot and carriage without filling your pack. Load your own mine or farm; deliver to any village building.</p>';
  for (const plot of plots) {
    const site = transportPlotSite(plot), stock = plot.storage ?? {};
    for (const resource of Object.keys(RESOURCE_WEIGHTS)) {
      if (plot.ownerId === player.id && (stock[resource] ?? 0) > 0) html += command(`Load ${name(resource)} from ${site.name ?? plot.building}`, 'cartPlotLoad', { targetId: cart.id, plotId: plot.id, resource, max: true }, !nearby);
      if ((cart.storage?.[resource] ?? 0) > 0) html += command(`Deliver ${name(resource)} to ${site.name ?? plot.building}`, 'cartPlotUnload', { targetId: cart.id, plotId: plot.id, resource, max: true }, !nearby);
    }
  }
  return html;
}
