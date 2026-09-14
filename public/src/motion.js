const MAX_SNAPSHOTS = 8;
const RESET_GAP_MS = 1000;
const TELEPORT_DISTANCE = 12;
const STILL_DISTANCE = 0.001;
const locomotion = new Set(['walk', 'run']);
const angle = value => Math.atan2(Math.sin(value), Math.cos(value));
const distance = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);

/** A small delayed playback buffer for authoritative remote entity snapshots.
 * Times are in milliseconds on the same monotonic clock (performance.now()).
 * It interpolates positions only between received poses, never predicts beyond
 * the newest pose, and returns movement speed in world units per second.
 */
export class PoseBuffer {
  constructor() { this.frames = []; }

  clear() { this.frames.length = 0; }

  push(entity, receivedAtMs) {
    if (!entity || !Number.isFinite(entity.x) || !Number.isFinite(entity.z) || !Number.isFinite(receivedAtMs)) return;
    const previous = this.frames.at(-1);
    // Ignore late packets so the playback timeline cannot run backwards.
    if (previous && receivedAtMs < previous.time) return;
    const frame = {
      x: entity.x, z: entity.z,
      yaw: Number.isFinite(entity.yaw) ? angle(entity.yaw) : previous?.yaw ?? 0,
      anim: typeof entity.anim === 'string' ? entity.anim : 'idle',
      time: receivedAtMs,
    };
    if (previous && (receivedAtMs - previous.time > RESET_GAP_MS || distance(previous, frame) > TELEPORT_DISTANCE)) this.clear();
    if (this.frames.at(-1)?.time === receivedAtMs) this.frames.pop();
    this.frames.push(frame);
    if (this.frames.length > MAX_SNAPSHOTS) this.frames.shift();
  }

  sample(nowMs, delayMs = 120) {
    if (!this.frames.length || !Number.isFinite(nowMs)) return null;
    const target = nowMs - Math.max(0, Number.isFinite(delayMs) ? delayMs : 120);
    const first = this.frames[0], latest = this.frames.at(-1);
    if (target < first.time) return this.hold(first);
    if (target >= latest.time || this.frames.length === 1) {
      const pose = this.hold(latest);
      // A lost connection must not leave attack/gather loops running forever.
      if (nowMs - latest.time > RESET_GAP_MS && pose.anim !== 'downed') pose.anim = 'idle';
      return pose;
    }
    let index = 0;
    while (this.frames[index + 1].time <= target) index++;
    const a = this.frames[index], b = this.frames[index + 1];
    const t = (target - a.time) / (b.time - a.time);
    const travel = distance(a, b);
    // Average adjacent segment speeds for animation; positions remain on the
    // actual received path, including corners. Stationary segments stop fully.
    const speed = travel <= STILL_DISTANCE ? 0 : this.pointSpeed(index) * (1 - t) + this.pointSpeed(index + 1) * t;
    return {
      x: a.x + (b.x - a.x) * t,
      z: a.z + (b.z - a.z) * t,
      yaw: angle(a.yaw + angle(b.yaw - a.yaw) * t),
      anim: speed === 0 && locomotion.has(a.anim) ? 'idle' : a.anim,
      speed,
    };
  }

  pointSpeed(index) {
    const a = this.frames[Math.max(0, index - 1)];
    const b = this.frames[index];
    const c = this.frames[Math.min(this.frames.length - 1, index + 1)];
    return (distance(a, b) + distance(b, c)) * 1000 / (c.time - a.time);
  }

  hold(frame) {
    return { x: frame.x, z: frame.z, yaw: frame.yaw, anim: locomotion.has(frame.anim) ? 'idle' : frame.anim, speed: 0 };
  }
}
