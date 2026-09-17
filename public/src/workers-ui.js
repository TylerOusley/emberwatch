import { WORKER_EQUIPMENT, WORKER_TOOLS, workerTool } from '../../shared/workers.js';

// The settlement panel supplies its escaped rows and action-button dispatcher.
// Buttons carry only choices; equipment, costs and proximity are checked again
// by the server before any tool or material changes hands.
export function workerEquipmentPanel({ worker, player, plots, command, row, esc, plotName }) {
  let html = worker.roleLimitPaused ? '<p class="settlement-warning">This personal hire is suspended by your current role limit. Their orders, cargo, equipment and prepaid wages stay safe. Manager training or dismissing another hire can reopen the slot.</p>' : '';
  if (worker.staffRole === 'transporter') return html;
  const near = Math.hypot(player.x - worker.x, player.z - worker.z) <= 3.3;
  html += '<h4>Worker tools</h4><p>Supply a crafted stone tool for +25% harvest output or an iron tool for +50%. One durability is used per harvest. Broken tools fall back to standard wooden equipment until repaired. Stand beside the worker to swap, recover or repair gear.</p>';
  for (const tool of ['axe', 'pickaxe', 'scythe']) {
    const supplied = worker.equipment?.[tool], effective = workerTool(worker, tool), active = WORKER_TOOLS[worker.resource] === tool;
    const tier = player.tiers?.[tool], canSupply = ['stone', 'iron'].includes(tier) && player.durability?.[tool] > 0 && !player.boundKitTools?.[tool];
    const title = `${tool[0].toUpperCase()}${tool.slice(1)}${active ? ' · current assignment' : ''}`;
    html += row(title, supplied ? `${supplied.tier} · ${supplied.durability} / ${supplied.maxDurability} durability${effective.tier === 'wood' ? ' · using wooden fallback' : ''}` : 'Standard wooden equipment');
    html += '<div class="panel-actions">';
    html += command(canSupply ? `Supply your ${tier} ${tool}` : `Carry a crafted ${tool}`, 'worker_equip', { workerId: worker.id, tool, tier }, !near || !canSupply || worker.staffRetired,
      !near ? 'Stand next to the worker.' : 'Your current tool transfers to the worker; their old supplied tool returns to you.');
    if (supplied) {
      const rule = WORKER_EQUIPMENT[supplied.tier], costs = Object.entries(rule.repair).map(([id, amount]) => `${amount} ${id}`).join(', ');
      html += command('Recover tool', 'worker_unequip', { workerId: worker.id, tool }, !near || player.durability?.[tool] > 0, 'Requires an empty matching tool slot and enough pack capacity.');
      html += command(`Repair · ${rule.repairGold}g + materials`, 'worker_repair', { workerId: worker.id, tool }, !near || supplied.durability >= supplied.maxDurability || worker.staffRetired,
        `${costs} from your pack. Restores full durability.`);
    }
    html += '</div>';
  }
  const source = plots.find(plot => plot.id === worker.maintenancePlotId) ?? plots.find(plot => plot.id === worker.sourcePlotId) ?? plots[0];
  html += '<h4>Automatic maintenance</h4><p>Optional repairs use your wallet and materials in one of your buildings, including while you are away. The budget limits additional repair gold; it is not charged upfront. Missing funds or materials keep the worker on wooden tools.</p>';
  html += row('Repair budget', worker.maintenanceEnabled ? `${worker.maintenanceBudgetGold} gold remaining · ${plotName(worker.maintenancePlotId)}` : 'Disabled');
  html += '<div class="panel-actions">';
  if (worker.maintenanceEnabled) html += command('Disable automatic repairs', 'worker_maintenance', { workerId: worker.id, enabled: false }, worker.staffRetired);
  for (const budgetGold of [100, 500, 1000]) html += command(`${worker.maintenanceEnabled ? 'Set remaining' : 'Enable'} ${budgetGold}g budget`, 'worker_maintenance', { workerId: worker.id, enabled: true, budgetGold, plotId: source?.id }, !source || worker.staffRetired, 'Repair gold is paid only when a supplied tool breaks.');
  html += '</div>';
  if (worker.maintenanceEnabled && plots.length > 1) {
    html += '<p>Repair materials from:</p><div class="panel-actions">';
    for (const plot of plots) html += command(plotName(plot.id), 'worker_maintenance', { workerId: worker.id, enabled: true, budgetGold: Math.max(10, worker.maintenanceBudgetGold), plotId: plot.id }, plot.id === worker.maintenancePlotId || worker.staffRetired);
    html += '</div>';
  }
  return html;
}
