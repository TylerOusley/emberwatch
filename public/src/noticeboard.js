import * as THREE from 'three';
import { buildingEntrance } from '../../shared/access.js';

// Mounted to the treasury's east wall, clear of its central doorway.
export const NOTICEBOARD = Object.freeze({ x: -12.91, z: -26.25, yaw: Math.PI / 2, name: 'Village request board' });
export const NOTICEBOARD_POINT = Object.freeze({ x: -11.65, z: -26.25, id: 'noticeboard', kind: 'noticeboard', name: NOTICEBOARD.name });
export function canReadNoticeboard(player) {
  return Boolean(player && !player.downed && !(player.hp <= 0) && player.online !== false && !player.bedPlotId && !player.mountedHorseId && !player.carriedBy &&
    Number.isFinite(player.x) && Number.isFinite(player.z) && player.x >= -12.35 && Math.hypot(player.x - NOTICEBOARD_POINT.x, player.z - NOTICEBOARD_POINT.z) <= 1.75);
}
export function noticeboardTakesPriority(player, candidate) {
  if (!canReadNoticeboard(player) || candidate?.kind === 'gather') return false;
  if (!candidate?.building) return true;
  const door = buildingEntrance(candidate.building);
  return !door || Math.hypot(player.x - NOTICEBOARD_POINT.x, player.z - NOTICEBOARD_POINT.z) < Math.hypot(player.x - door.x, player.z - door.z);
}

export function createNoticeboard(scene) {
  const root = new THREE.Group(); root.name = 'Village noticeboard';
  root.position.set(NOTICEBOARD.x, 1.7, NOTICEBOARD.z); root.rotation.y = NOTICEBOARD.yaw;
  const materials = [], geometries = [], textures = [];
  const material = color => { const m = new THREE.MeshStandardMaterial({ color, roughness: .85 }); materials.push(m); return m; };
  const wood = material('#60442d'), rim = material('#92714b'), paper = material('#dbc79a'), pin = material('#bda166');
  function box(w,h,d,x,y,z,m) { const g = new THREE.BoxGeometry(w,h,d); geometries.push(g); const mesh = new THREE.Mesh(g,m); mesh.position.set(x,y,z); root.add(mesh); return mesh; }
  box(2.05,1.35,.12,0,0,0,wood);
  box(2.42,.14,.52,0,.87,.08,wood);
  box(2.48,.06,.56,0,.96,.08,rim);
  for (const x of [-1.04,1.04]) box(.09,1.51,.18,x,0,.015,rim);
  for (const y of [-.72,.72]) box(2.17,.09,.18,0,y,.015,rim);
  for (let i=0;i<3;i++) { const x=(i-1)*.61, y=i===1?-.12:0; const p=box(.49,.75,.012,x,y,.071,paper); p.rotation.z=(i-1)*.06; box(.055,.055,.025,x,y+.29,.09,pin); for(let line=0;line<4;line++)box(line===3?.19:.3,.025,.006,x,y+.08-line*.1,.083,wood); }
  if (typeof document !== 'undefined') {
    const canvas=document.createElement('canvas'); canvas.width=512;canvas.height=96;const ctx=canvas.getContext('2d');
    if(ctx){ctx.fillStyle='#382a1f';ctx.fillRect(0,0,512,96);ctx.fillStyle='#eddbab';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='bold 33px Georgia';ctx.fillText('VILLAGE REQUESTS',256,49);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;textures.push(texture);const m=new THREE.MeshStandardMaterial({map:texture,roughness:1});materials.push(m);const g=new THREE.PlaneGeometry(1.89,.35);geometries.push(g);const label=new THREE.Mesh(g,m);label.position.set(0,.48,.084);root.add(label);}
  }
  scene.add(root); let disposed=false;
  return {root,dispose(){if(disposed)return;disposed=true;scene.remove(root);geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());}};
}
