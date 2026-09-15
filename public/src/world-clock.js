import { CONFIG } from '../../shared/world.js';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// The sky follows the village clock, not a timer started when a browser joins.
// Brief extrapolation smooths the 10 Hz stream; a stalled connection cannot
// advance into another phase before the server actually changes it.
export function createWorldClock() {
  let snapshot = null;
  return {
    ingest(state, receivedAt) {
      if (!state || !['day', 'night'].includes(state.phase) || !Number.isFinite(state.clock) || !Number.isFinite(receivedAt)) return false;
      const fallback = state.phase === 'night' ? CONFIG.nightSeconds : CONFIG.daySeconds;
      const duration = Number.isFinite(state.phaseDuration) && state.phaseDuration > 0 ? state.phaseDuration : fallback;
      const remaining = Number.isFinite(state.phaseRemaining) ? Math.max(0, state.phaseRemaining) : duration;
      const end = Number.isFinite(state.phaseEndsAt) ? state.phaseEndsAt : state.clock + remaining;
      snapshot = { clock: state.clock, end, duration, phase: state.phase, receivedAt,
        running: state.clockRunning === undefined ? state.status !== 'fallen' : state.clockRunning === true };
      return true;
    },
    sample(now) {
      if (!snapshot) return null;
      const { clock, end, duration, phase, receivedAt, running } = snapshot;
      const age = Number.isFinite(now) ? clamp((now - receivedAt) / 1000, 0, .3) : 0;
      const time = clock + (running ? Math.min(age, Math.max(0, end - clock)) : 0);
      const remaining = Math.max(0, end - time);
      const progress = clamp(1 - remaining / duration, 0, 1);
      return { time, phase, remaining, duration, progress, cycle: (phase === 'night' ? .5 : 0) + progress * .5 };
    },
    reset() { snapshot = null; }
  };
}
