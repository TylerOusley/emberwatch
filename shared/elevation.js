// Small traversable details are shared by rendering and every collision user.
// Tall walls and buildings keep their ordinary, non-jumpable bounds.
export const LOW_OBSTACLES = Object.freeze([
  { id: 'fallen-oak', kind: 'log', x: -66, z: 106, w: 7, d: .9, height: .65 },
  { id: 'east-log', kind: 'log', x: 66, z: 111, w: 5, d: 1, height: .7 },
  { id: 'quarry-step-a', kind: 'rock', x: -76, z: 111, w: 3, d: 4, height: .55 },
  { id: 'quarry-step-b', kind: 'rock', x: -79, z: 111, w: 3, d: 4, height: 1.1 },
  { id: 'quarry-step-c', kind: 'rock', x: -82, z: 111, w: 3, d: 4, height: 1.65 }
]);
