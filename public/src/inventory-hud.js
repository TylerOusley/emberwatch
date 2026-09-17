import { itemArt } from './shop-display.js';
import { CRATE_EQUIPMENT } from '../../shared/crates.js';
import { carryCapacity, inventoryWeight, TOOL_WEIGHTS } from '../../shared/content.js';
import { ownsStaff } from '../../shared/equipment.js';

const ITEMS = Object.freeze([
  ['timber', 'Wood'], ['stone', 'Stone'], ['iron', 'Iron'], ['coal', 'Coal'], ['sulfur', 'Sulfur'], ['wheat', 'Wheat'],
  ['food', 'Bread'], ['good_food', 'Meals'], ['best_food', 'Feasts'], ['arrows', 'Arrows'], ['gunpowder', 'Gunpowder'], ['musket_ammo', 'Musket shot'], ['cart', 'Cart']
]);
const count = value => Number.isSafeInteger(value) && value > 0 ? value : 0;
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const name = value => value.replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
const number = value => value.toLocaleString(undefined, { maximumFractionDigits: 2 });

// This model reads only the viewer's private player snapshot, never village or
// building storage. Bound kit supplies are already included in inventory counts.
export function inventoryHUDModel(player) {
  if (!player) return null;
  const items = ITEMS.map(([id, label]) => ({ id, label, amount: count(player.inventory?.[id]) }))
    .filter(item => item.id !== 'cart' || item.amount > 0);
  const tools = Object.keys(TOOL_WEIGHTS).filter(id => id === 'staff' ? ownsStaff(player) : count(player.durability?.[id]) > 0)
    .map(id => ({ id, label: id === 'staff' ? 'Arcane staff' : id === 'musket' ? 'Musket' : `${name(player.tiers?.[id] || 'wood')} ${name(id)}`, amount: 1, uses: id === 'staff' ? null : count(player.durability?.[id]), unbreakable: id === 'staff', tier: player.tiers?.[id] || 'wood' }));
  const gear = ['head', 'body', 'feet', 'utility'].map(slot => player.crateEquipment?.[slot])
    .filter(id => typeof id === 'string' && Object.hasOwn(CRATE_EQUIPMENT, id))
    .map(id => ({ id, label: name(id), amount: 1 }));
  return { items, tools, gear, weight: inventoryWeight(player), capacity: carryCapacity(player) };
}

export function createInventoryHUD(root, { onOpen = () => {} } = {}) {
  let signature = '';
  return {
    update(player) {
      const model = inventoryHUDModel(player);
      if (!model) { root.hidden = true; signature = ''; return; }
      root.hidden = false;
      const next = JSON.stringify(model);
      if (next === signature) return;
      signature = next;
      const ratio = Math.min(100, Math.max(0, model.weight / model.capacity * 100));
      root.innerHTML = `<header class="pack-hud-heading"><span>ON YOU</span><button type="button" title="Open your pack (I)" aria-label="Open your full inventory">Your pack <kbd>I</kbd> ↗</button></header>
        <div class="pack-hud-items">${model.items.map(item => `<div class="pack-hud-item${item.amount ? '' : ' is-empty'}" title="${escape(item.label)}: ${number(item.amount)} carried"><span class="pack-hud-art">${itemArt(item.id)}</span><span class="pack-hud-label">${item.label}</span><strong>${number(item.amount)}</strong></div>`).join('')}</div>
        ${model.tools.length || model.gear.length ? `<div class="pack-hud-equipment" aria-label="Carried tools and equipped items">${model.tools.map(tool => { const condition = tool.unbreakable ? 'Unbreakable · Mana powered' : `${number(tool.uses)} uses remaining`; return `<span title="${escape(tool.label)} · 1 carried · ${condition}" aria-label="${escape(tool.label)}, 1 carried, ${condition}">${itemArt(tool.id, { tier: tool.tier })}<b>1</b></span>`; }).join('')}${model.gear.map(item => `<span title="${escape(item.label)} · 1 equipped" aria-label="${escape(item.label)}, 1 equipped"><img src="/assets/crate-items/${item.id}.png" alt=""><b>1</b></span>`).join('')}</div>` : ''}
        <footer class="pack-hud-weight${model.weight >= model.capacity ? ' is-full' : ''}"><span>Carry weight</span><strong>${number(model.weight)} / ${number(model.capacity)}</strong><div class="pack-hud-meter" role="progressbar" aria-label="Carrying capacity used" aria-valuemin="0" aria-valuemax="${model.capacity}" aria-valuenow="${Math.min(model.weight, model.capacity)}"><i style="width:${ratio}%"></i></div></footer>`;
      root.querySelector('button').onclick = onOpen;
    },
    clear() { root.hidden = true; root.replaceChildren(); signature = ''; }
  };
}
