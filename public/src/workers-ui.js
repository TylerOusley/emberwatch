import { WORKER_EQUIPMENT, WORKER_TOOLS, workerTool } from '../../shared/workers.js';

// Purchases are worker equipment orders, independent of the owner's carried
// tools. The server validates ownership and authoritative balances again.
export function workerEquipmentPanel({ worker, player, command, row }) {
  const bank = Number.isSafeInteger(player.bank) && player.bank >= 0 ? player.bank : 0;
  const money = value => Number(value || 0).toLocaleString();
  const inactive = worker.staffRetired || worker.roleLimitPaused;
  const transporter = worker.staffRole === 'transporter';
  let html = transporter ? '<p>Transporters move stored goods and do not use harvesting tools. Train Movement or Carrying to improve deliveries.</p>' : '<h4>Worker tools</h4><p>Buy tools directly for this worker. Stone costs 30 wallet gold for +25% harvest output; iron costs 100 for +50%. No carried tool or materials are needed. Each completed harvest uses one durability.</p>';
  if (!transporter) html += row('Purchase funds', `${money(player.wallet)} wallet gold`);
  for (const tool of ['axe', 'pickaxe', 'scythe']) {
    const supplied = worker.equipment?.[tool], effective = workerTool(worker, tool), active = WORKER_TOOLS[worker.resource] === tool;
    if (transporter && (!supplied || supplied.workerOnly)) continue;
    const title = `${tool[0].toUpperCase()}${tool.slice(1)}${active ? ' · current assignment' : ''}`;
    html += row(title, supplied ? `${supplied.tier} · ${supplied.durability} / ${supplied.maxDurability} durability${effective.tier === 'wood' ? ' · using wooden fallback' : ''}` : 'Standard wooden equipment');
    html += '<div class="panel-actions">';
    for (const tier of transporter ? [] : ['stone', 'iron']) {
      const price = WORKER_EQUIPMENT[tier].purchaseGold, equipped = supplied?.tier === tier && supplied.durability > 0;
      const caption = `${tier[0].toUpperCase()}${tier.slice(1)} ${tool}`;
      html += command(equipped ? `${caption} equipped` : `Buy ${tier} ${tool} · ${price}g`, 'worker_buy_tool', { workerId: worker.id, tool, tier }, inactive || equipped || (player.wallet || 0) < price,
        equipped ? 'This tool is still usable. Buy another when it breaks, or choose a different tier.' : inactive ? 'Reactivate this worker before buying tools.' : `Costs ${price} wallet gold. Replaces the current ${tool} without a refund.`);
    }
    if (supplied && !supplied.workerOnly) {
      const near = Math.hypot(player.x - worker.x, player.z - worker.z) <= 3.3;
      html += command('Recover tool', 'worker_unequip', { workerId: worker.id, tool }, !near || player.durability?.[tool] > 0, 'Recover a tool you previously supplied. Stand beside the worker with an empty matching tool slot and enough pack capacity.');
    }
    html += '</div>';
  }
  if (!transporter) html += '<p class="menu-footnote">Purchased tools belong to this worker. Buying a different tier replaces the old tool without a refund. Previously supplied tools can still be recovered before replacing them.</p>';
  if (!transporter || worker.autoReplaceEnabled) {
    html += '<h4>Auto-replacement</h4><p>When a tool breaks, buy the same tier again from your bank: 30 gold for stone or 100 for iron. No materials or repair budget. If the bank is short, the worker uses wooden tools and tries again while working after you add funds. Wages still use your wallet.</p>';
    html += row('Bank funding', `${money(bank)} bank gold available`);
    html += row('Auto-replacement', worker.autoReplaceEnabled ? 'On · replacements use your bank' : 'Off · replace broken tools yourself');
    const activeGear = worker.equipment?.[WORKER_TOOLS[worker.resource]];
    if (worker.autoReplaceEnabled && activeGear?.durability <= 0 && bank < (WORKER_EQUIPMENT[activeGear.tier]?.purchaseGold ?? Infinity)) html += '<p class="settlement-warning">Waiting for enough bank gold. Standard wooden tools remain available.</p>';
    html += '<div class="panel-actions">' + command(worker.autoReplaceEnabled ? 'Disable auto-replacement' : 'Enable auto-replacement', 'worker_auto_replace', { workerId: worker.id, enabled: !worker.autoReplaceEnabled }, !worker.autoReplaceEnabled && (inactive || transporter), worker.autoReplaceEnabled ? 'Stop future automatic purchases. Current tools remain equipped.' : 'Authorize 30 or 100 gold from your bank each time a gathering tool needs replacement, including while you are offline in an active village.') + '</div>';
  }
  return html;
}

// Summarize the authoritative status without changing work or wage rules.
export function workerActivity(worker) {
  if (worker.staffRetired) return { state: 'attention', label: 'Inactive plot' };
  if (worker.roleLimitPaused) return { state: 'attention', label: 'Role limit' };
  if (worker.paused) return { state: 'paused', label: 'Paused' };
  if (worker.staffRole === 'transporter' && /target met/i.test(worker.status || '')) return { state: 'working', label: 'Stocked' };
  if (!worker.resource || /waiting|needs|choose|invalid|unavailable|storage full/i.test(worker.status || '')) {
    return { state: 'attention', label: 'Needs attention' };
  }
  return { state: 'working', label: 'On duty' };
}
