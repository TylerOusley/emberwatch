import { MAGIC } from '../../shared/magic.js';
import { canEquip } from '../../shared/equipment.js';

// Keep mana affordability separate from the short spell recovery timer.
export function staffCastState(player, clock = 0) {
  const element = ['fire', 'frost', 'lightning'].includes(player?.staffElement) ? player.staffElement : 'fire';
  const spell = MAGIC[element];
  const mana = Number.isFinite(player?.mana) ? Math.max(0, player.mana) : 0;
  const recovery = Number.isFinite(player?.staffReadyAt) ? Math.max(0, player.staffReadyAt - clock) : 0;
  return { element, spell, recovery, enoughMana: mana >= spell.mana,
    ready: canEquip(player, 'staff') && mana >= spell.mana && recovery === 0 };
}
