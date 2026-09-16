import * as THREE from 'three';
import { GUARD_ORDERS } from '../../shared/guard-orders.js';
import { PLOTS, groundHeight } from '../../shared/world.js';
import { buildingArt } from './build-carousel.js';
import { itemArt } from './shop-display.js';

const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usable = player => player?.online && !player.downed && player.hp > 0 && player.role === 'guard' && !player.mountedHorseId && !player.bedPlotId;

export function createGuardOrdersUI({ getState, getMe, getActivePanel, openPanel, send }) {
  let signature = '', disposed = false;
  const rows = () => (getState()?.guardOrders ?? []).filter(row => row.ownerId === getMe()?.id);
  const troopsFor = order => (getState()?.guards ?? []).filter(guard => guard.ownerId === getMe()?.id && guard.plotId === order.plotId);
  const plotFor = order => getState()?.plots?.find(plot => plot.id === order.plotId);
  const panelOpen = () => getActivePanel ? getActivePanel() === 'guard-orders' : Boolean(document.getElementById('guard-orders-panel') && document.getElementById('panel-dialog')?.open);
  const currentSignature = () => JSON.stringify([getMe()?.id, usable(getMe()), rows().map(order => {
    const { plotId, mode, effectiveMode, fallback, livingTroops, recruitedTroops } = order, plot = plotFor(order);
    return [plotId, mode, effectiveMode, fallback, livingTroops, recruitedTroops, plot?.hp, plot?.maxHp, plot?.level, plot?.storage?.wheat, troopsFor(order).map(guard => [guard.id, guard.name, guard.hp, guard.maxHp, guard.hungry])];
  })]);
  function render() {
    if (disposed || !getMe() || !getState()) return;
    signature = currentSignature();
    const orders = rows(), enabled = usable(getMe());
    const content = orders.map((order, index) => {
      const name = PLOTS.find(site => site.id === order.plotId)?.name ?? order.plotId;
      const title = GUARD_ORDERS[order.mode]?.label ?? GUARD_ORDERS.defend.label;
      const troops = troopsFor(order), plot = plotFor(order), effective = GUARD_ORDERS[order.effectiveMode] ?? GUARD_ORDERS.defend;
      const unitCards = troops.map((guard, unitIndex) => {
        const maxHp = Number.isFinite(guard.maxHp) && guard.maxHp > 0 ? guard.maxHp : 1;
        const hp = Number.isFinite(guard.hp) ? Math.max(0, Math.min(maxHp, guard.hp)) : 0;
        const unitName = guard.name || `Guard ${unitIndex + 1}`;
        return `<article class="guard-unit ${hp > 0 ? '' : 'fallen'}"><span class="command-item-art">${itemArt('sword', { tier: plot?.level >= 2 ? 'iron' : 'stone' })}</span><div><strong>${esc(unitName)}</strong><small>${Math.ceil(hp)} / ${Math.ceil(maxHp)} health · ${hp <= 0 ? 'Fallen' : guard.hungry ? 'Needs wheat' : 'Ready'}</small><meter min="0" max="${maxHp}" value="${hp}" aria-label="${esc(unitName)} health">${Math.ceil(hp)} / ${Math.ceil(maxHp)}</meter></div></article>`;
      }).join('');
      return `<section class="guard-command-card"><header><div class="guard-barracks-art">${buildingArt('barracks')}</div><div><small>YOUR BARRACKS${plot?.level ? ` · LEVEL ${plot.level}` : ''}</small><h3>${esc(name)} barracks</h3><span class="command-badge" style="--stance-color:#${effective.color.toString(16).padStart(6, '0')}">${esc(effective.label)}</span></div></header><div class="guard-command-stats"><div><span>Standing troops</span><strong>${order.livingTroops}/${order.recruitedTroops} troops standing</strong></div>${plot?.maxHp > 0 ? `<div><span>Barracks health</span><strong>${Math.ceil(Math.max(0, plot.hp))} / ${plot.maxHp}</strong></div><div><span>Replacement supplies</span><strong>${plot.storage?.wheat || 0} wheat</strong></div>` : ''}</div>${unitCards ? `<div class="guard-unit-grid">${unitCards}</div>` : ''}<p class="guard-current-order"><strong>${esc(title)}</strong>${order.fallback ? `<br>${esc(order.fallback)} — ${esc(effective.label)}` : ''}</p><div class="panel-actions guard-order-actions">${Object.entries(GUARD_ORDERS).map(([mode, info]) => `<button type="button" class="secondary-button" data-guard-order="${mode}" data-guard-row="${index}" ${!enabled ? 'disabled' : ''} aria-pressed="${order.mode === mode}">${esc(mode === 'hold' ? 'Hold here' : info.label)}</button>`).join('')}</div></section>`;
    }).join('');
    openPanel(`<div id="guard-orders-panel" class="command-panel"><header class="command-hero"><div class="command-hero-art">${itemArt('sword', { tier: 'iron' })}</div><div><p class="eyebrow">COMMAND YOUR WATCH</p><h2>Barracks orders</h2><p>Give orders to troops from your own barracks from anywhere in the village. Hold here places a rally at your current position. Troops stay near that point when fighting.</p></div></header>${!enabled ? '<p class="command-notice">You must be a living guard, on foot and out of bed, to give orders.</p>' : ''}${content || '<p class="command-empty">You do not own an intact barracks. Build one on a plot, then visit its door to recruit troops.</p>'}<p class="command-footnote">Follow troops retreat home if you fall, disconnect, mount a horse, or leave the accessible village and gate approach. Stock barracks wheat to replace fallen recruits; replacements keep the same orders.</p><p>Recruitment, upgrades, and supply deliveries still require visiting the barracks entrance. The public Watch keeps defending the gate.</p></div>`, 'guard-orders');
    for (const button of document.getElementById('panel-content')?.querySelectorAll('[data-guard-order]') ?? []) button.onclick = () => {
      if (button.disabled || !usable(getMe())) return;
      const order = orders[Number(button.dataset.guardRow)];
      if (!order || !rows().some(row => row.plotId === order.plotId) || !Object.hasOwn(GUARD_ORDERS, button.dataset.guardOrder)) return;
      send({ type: 'action', kind: 'guard_order', plotId: order.plotId, mode: button.dataset.guardOrder });
    };
  }
  return {
    show: render,
    update() { if (!disposed && panelOpen() && signature !== currentSignature()) render(); },
    dispose() { disposed = true; signature = ''; }
  };
}

function labelTexture(text) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 96;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = 'rgba(18,34,31,.88)'; context.fillRect(0, 0, 512, 96);
  context.strokeStyle = '#cfb57a'; context.lineWidth = 3; context.strokeRect(2, 2, 508, 92);
  context.font = 'bold 30px sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
  context.fillStyle = '#fff4d7'; context.fillText(text, 256, 49, 478);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createGuardRallies(scene) {
  const group = new THREE.Group(); group.name = 'owned-guard-rallies'; scene.add(group);
  const markers = new Map(), ringGeometry = new THREE.RingGeometry(1.35, 1.55, 32), poleGeometry = new THREE.CylinderGeometry(.035, .035, 1.65, 5);
  const flagGeometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, .65, -.12, 0, 0, -.43, 0], 3));
  flagGeometry.computeVertexNormals();
  let disposed = false;
  function remove(id, marker) {
    marker.group.removeFromParent(); marker.material.dispose(); marker.label?.material.map?.dispose(); marker.label?.material.dispose(); markers.delete(id);
  }
  function markerFor(id) {
    if (markers.has(id)) return markers.get(id);
    const root = new THREE.Group(), material = new THREE.MeshBasicMaterial({ color: 0xd6b568, side: THREE.DoubleSide, transparent: true, opacity: .9, depthWrite: false });
    const ring = new THREE.Mesh(ringGeometry, material); ring.rotation.x = -Math.PI / 2; ring.position.y = .032;
    const pole = new THREE.Mesh(poleGeometry, material); pole.position.y = .72;
    const flag = new THREE.Mesh(flagGeometry, material); flag.position.y = 1.53;
    root.add(ring, pole, flag); group.add(root);
    const marker = { group: root, material, label: null, mode: null }; markers.set(id, marker); return marker;
  }
  return {
    group,
    update(state, ownerId) {
      if (disposed) return;
      const active = new Set();
      for (const row of state?.guardOrders ?? []) {
        if (row.ownerId !== ownerId || ![row.rally?.x, row.rally?.z].every(Number.isFinite)) continue;
        const mode = Object.hasOwn(GUARD_ORDERS, row.effectiveMode) ? row.effectiveMode : 'defend', info = GUARD_ORDERS[mode];
        active.add(row.plotId); const marker = markerFor(row.plotId);
        marker.group.position.set(row.rally.x, groundHeight(row.rally.x, row.rally.z), row.rally.z); marker.group.userData.label = info.label;
        if (marker.mode !== mode) {
          marker.mode = mode; marker.material.color.setHex(info.color);
          const texture = labelTexture(info.label);
          if (marker.label) { marker.label.material.map?.dispose(); marker.label.material.map = texture; marker.label.material.needsUpdate = true; }
          else if (texture) { marker.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false, toneMapped: false })); marker.label.position.y = 2.1; marker.label.scale.set(4.8, .9, 1); marker.group.add(marker.label); }
        }
      }
      for (const [id, marker] of markers) if (!active.has(id)) remove(id, marker);
    },
    dispose() {
      if (disposed) return; disposed = true;
      for (const [id, marker] of markers) remove(id, marker);
      ringGeometry.dispose(); poleGeometry.dispose(); flagGeometry.dispose(); group.removeFromParent();
    }
  };
}
