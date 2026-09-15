const TAU = Math.PI * 2;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const ease = t => t * t * (3 - 2 * t);

// Contact, weight acceptance, planted stance, toe-off, and swinging recovery.
// Hip and knee move independently; the ankle keeps the planted sole level and
// then rolls onto the toe before the knee folds to clear the returning foot.
const WALK = [
  [0, -.48, .18, -.12], [.12, -.28, .27, 0], [.30, .02, .14, 0],
  [.51, .40, .20, .08], [.62, .36, .62, .30], [.77, -.28, 1.12, .10],
  [.91, -.43, .56, -.18], [1, -.48, .18, -.12],
];
const RUN = [
  [0, -.67, .40, -.10], [.12, -.36, .58, .03], [.30, .20, .42, .16],
  [.46, .58, .62, .37], [.62, .10, 1.35, .28], [.77, -.52, 1.58, .03],
  [.91, -.70, .86, -.18], [1, -.67, .40, -.10],
];

function sample(keys, phase, out) {
  const t = ((phase % TAU) + TAU) % TAU / TAU;
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
  const a = keys[i], b = keys[i + 1], u = ease((t - a[0]) / (b[0] - a[0]));
  for (let j = 0; j < 3; j++) out[j] = a[j + 1] + (b[j + 1] - a[j + 1]) * u;
}

/** Fill [hip, knee, ankle] rotations in radians without allocating each frame. */
export function sampleLegGait(phase, strength, running, out, scratch) {
  sample(WALK, phase, out); sample(RUN, phase, scratch);
  for (let i = 0; i < 3; i++) out[i] += (scratch[i] - out[i]) * running;
  out[0] *= strength;
  out[1] = .04 + out[1] * strength;
  // The sampled third channel is a world-aligned sole angle, not another knee.
  out[2] = clamp(out[2] * strength - out[0] - out[1], -.85, .55);
}

export function runningBlend(speed) {
  return ease(clamp((speed - 5.4) / 2.6, 0, 1));
}
