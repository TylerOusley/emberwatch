import * as THREE from 'three';
import { groundHeight } from '../../shared/world.js';

// A bounded pool renders authoritative hits only. No per-cast lights/shadows.
export function createMagicWorld(scene) {
  const root = new THREE.Group(); root.name = 'arcane-projectiles'; scene.add(root);
  const seen = new Map(), effects = [];
  const colors = { fire: '#ffb044', frost: '#91eaff', lightning: '#c4baff' };
  const geometry = new THREE.SphereGeometry(.18, 8, 6);
  function add(id, shot, time, height = 1.5) {
    if (!shot?.id || seen.get(id) === shot.id) return;
    seen.set(id, shot.id);
    const at = shot.at ?? shot.firedAt;
    if (!Number.isFinite(at) || time - at > 1 || at - time > .5) return;
    for (const [index, segment] of (shot.segments ?? [{ from: shot.from, to: shot.to }]).entries()) {
      if (!segment.from || !segment.to) continue;
      const element = shot.element ?? 'fire', material = new THREE.MeshBasicMaterial({ color: colors[element], transparent: true, opacity: 1 });
      const from = new THREE.Vector3(segment.from.x, groundHeight(segment.from.x, segment.from.z) + (index ? 1 : height), segment.from.z);
      const to = new THREE.Vector3(segment.to.x, groundHeight(segment.to.x, segment.to.z) + 1, segment.to.z);
      let mesh;
      if (element === 'lightning') {
        const points = Array.from({ length: 9 }, (_, i) => { const point = from.clone().lerp(to, i / 8); if (i && i < 8) { point.x += Math.sin(i * 19 + at) * .23; point.y += Math.cos(i * 12 + at) * .22; } return point; });
        mesh = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: colors.lightning, transparent: true })); material.dispose();
      } else mesh = new THREE.Mesh(geometry, material);
      root.add(mesh); effects.push({ mesh, from, to, start: time, element });
    }
  }
  function remove(effect) { root.remove(effect.mesh); if (effect.mesh.isLine) effect.mesh.geometry.dispose(); effect.mesh.material.dispose(); }
  return {
    update(state, time) {
      if (!state) { for (const effect of effects.splice(0)) remove(effect); seen.clear(); return; }
      for (const player of state.players ?? []) if (player.lastShot?.kind === 'magic') add(player.id, player.lastShot, time);
      for (const plot of state.plots ?? []) if (plot.building === 'wizard_tower') add(plot.id, plot.lastShot, time, 6);
      for (let i = effects.length - 1; i >= 0; i--) {
        const effect = effects[i], age = time - effect.start;
        if (age > .55 || effects.length > 80) { remove(effect); effects.splice(i, 1); continue; }
        effect.mesh.material.opacity = Math.max(0, 1 - age / .55);
        if (!effect.mesh.isLine) { effect.mesh.position.copy(effect.from).lerp(effect.to, Math.min(1, age / .3)); effect.mesh.scale.setScalar(age > .3 ? 1 + (age - .3) * 8 : 1); }
      }
    },
    dispose() { for (const effect of effects.splice(0)) remove(effect); geometry.dispose(); scene.remove(root); seen.clear(); }
  };
}
