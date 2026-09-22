import { RESOURCE_WEIGHTS, inventoryWeight } from '../shared/content.js';
import { plotStorageCapacity } from '../shared/production.js';
import { SMELTING_BATCH_LIMIT, smeltingRecipe, smeltingJob } from '../shared/smelting.js';

const whole = value => Number.isSafeInteger(value) && value >= 0;

/** Called after ownershipAction validates plot proximity. Inputs and pending
 * outputs remain on this plot across saves, disconnects and server restarts. */
export function smeltingAction(village, player, plot, action) {
  if (plot.ownerId !== player.id) throw new Error('Only the plot owner can run this smelter.');
  if (plot.building !== 'smelter') throw new Error('Build a smelter on this plot first.');
  if (action.kind === 'smelt_cancel') {
    const job = smeltingJob(plot), recipe = smeltingRecipe(job?.recipe);
    if (!job || job.ownerId !== player.id) throw new Error('There is no valid smelting job to cancel.');
    const storage = { ...plot.storage };
    for (const [id, amount] of Object.entries(recipe.cost)) {
      const held = storage[id] ?? 0, restored = held + amount * job.remaining;
      if (!whole(held) || !whole(restored)) throw new Error('This storage cannot accept the unused materials.');
      storage[id] = restored;
    }
    const held = storage[job.recipe] ?? 0, restored = held + job.ready * recipe.amount;
    if (!whole(held) || !whole(restored)) throw new Error('This storage cannot accept the finished ingots.');
    storage[job.recipe] = restored;
    if (inventoryWeight(storage) > plotStorageCapacity(plot) + 1e-6) throw new Error('Make room in plot storage before cancelling; unused materials and finished ingots are safe in the smelter.');
    Object.assign(plot.storage, storage);
    plot.smelting = null;
    return 'Smelting cancelled. Unused materials and any waiting ingots returned to plot storage.';
  }
  if (action.kind !== 'smelt_start') throw new Error('Choose a valid smelting action.');
  if (plot.hp <= 0) throw new Error('Repair this smelter before starting a job.');
  if (plot.smelting) throw new Error('Finish or cancel the current smelting job first.');
  const recipe = smeltingRecipe(action.recipe), batches = action.batches ?? 1;
  if (!recipe) throw new Error('Choose iron ingots or steel ingots to smelt.');
  if (!Number.isSafeInteger(batches) || batches < 1 || batches > SMELTING_BATCH_LIMIT) throw new Error(`Smelt from 1 to ${SMELTING_BATCH_LIMIT} ingots per job.`);
  const storage = { ...plot.storage };
  for (const [id, amount] of Object.entries(recipe.cost)) {
    const held = storage[id] ?? 0, needed = amount * batches;
    if (!whole(held) || held < needed) throw new Error(`The smelter needs ${needed} ${id === 'iron' ? 'iron ore' : id} in plot storage.`);
    storage[id] = held - needed;
  }
  Object.assign(plot.storage, storage);
  plot.smelting = { recipe: action.recipe, batches, remaining: batches, progress: 0, ready: 0, ownerId: player.id };
  return `Smelting ${batches} ${recipe.name.toLowerCase()}${batches === 1 ? '' : 's'}. Ingredients paid from plot storage; work continues while the village is active.`;
}

export function smeltingTick(village, dt) {
  if (!Number.isFinite(dt) || dt <= 0 || village.status === 'fallen' || !Object.values(village.players ?? {}).some(player => player.online)) return;
  for (const plot of village.plots ?? []) {
    const job = smeltingJob(plot);
    if (!job || plot.building !== 'smelter' || plot.hp <= 0 || !plot.ownerId || job.ownerId !== plot.ownerId) continue;
    const recipe = smeltingRecipe(job.recipe);
    if (job.remaining > 0) {
      // Clamp to the paid work left: a large tick cannot manufacture extra goods.
      const progress = Math.min(job.remaining * recipe.seconds, job.progress + dt);
      const completed = Math.min(job.remaining, Math.floor((progress + 1e-9) / recipe.seconds));
      job.remaining -= completed; job.ready += completed;
      job.progress = job.remaining ? Math.max(0, progress - completed * recipe.seconds) : 0;
    }
    const held = plot.storage?.[job.recipe] ?? 0;
    const room = Math.max(0, plotStorageCapacity(plot) - inventoryWeight(plot.storage));
    const deliver = whole(held) ? Math.min(job.ready, Number.MAX_SAFE_INTEGER - held, Math.max(0, Math.floor((room + 1e-6) / RESOURCE_WEIGHTS[job.recipe]))) : 0;
    if (deliver > 0) { plot.storage[job.recipe] = held + deliver * recipe.amount; job.ready -= deliver; }
    if (job.remaining === 0 && job.ready === 0) plot.smelting = null;
  }
}
