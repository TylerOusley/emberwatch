// Employment costs are paid from the owner's wallet. Hired hands never spend
// protected savings, purchase credit, or the village's treasury.
export const WORKER_RULES = Object.freeze({
  maxPerPlayer: 2, hireCost: 75, wageGold: 1, wageSeconds: 30,
  carryCapacity: 40, gatherSeconds: 4, speed: 3
});
export const WORKER_RESOURCES = Object.freeze(['wheat', 'timber', 'stone', 'iron', 'coal']);
