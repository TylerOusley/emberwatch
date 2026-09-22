// Ore retains its original `iron` save identity. Ingots are separate goods.
export const SMELTING_BATCH_LIMIT = 100;
export const SMELTING_RECIPES = Object.freeze({
  iron_ingot: Object.freeze({ name: 'Iron ingot', cost: Object.freeze({ iron: 2, timber: 1 }), seconds: 10, amount: 1 }),
  steel_ingot: Object.freeze({ name: 'Steel ingot', cost: Object.freeze({ iron: 2, timber: 1, coal: 1 }), seconds: 15, amount: 1 })
});
export function smeltingRecipe(id) {
  return typeof id === 'string' && Object.hasOwn(SMELTING_RECIPES, id) ? SMELTING_RECIPES[id] : null;
}
// Invalid saved jobs are retained for diagnosis, never reinterpreted as free
// output or erased by a snapshot. Only validated, server-created jobs run.
export function smeltingJob(plot) {
  const job = plot?.smelting, recipe = smeltingRecipe(job?.recipe);
  return recipe && typeof job.ownerId === 'string' && Number.isSafeInteger(job.batches) && job.batches >= 1 && job.batches <= SMELTING_BATCH_LIMIT &&
    Number.isSafeInteger(job.remaining) && job.remaining >= 0 && job.remaining <= job.batches &&
    Number.isSafeInteger(job.ready) && job.ready >= 0 && job.ready <= job.batches - job.remaining &&
    Number.isFinite(job.progress) && job.progress >= 0 && job.progress < recipe.seconds && (job.remaining > 0 || job.progress === 0)
    ? job : null;
}
