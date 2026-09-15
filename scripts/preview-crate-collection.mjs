// Export the actual authored collection for the deterministic CPU renderer.
// node scripts/preview-crate-collection.mjs [/tmp/emberwatch-crate-collection]
// python3 scripts/render-crate-collection.py [/tmp/emberwatch-crate-collection]
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CRATE_ITEMS, CRATE_TIERS } from '../public/src/crate-catalog.js';
import { createCrateAsset } from '../public/src/crate-assets.js';

const destination = path.resolve(process.argv[2] ?? '/tmp/emberwatch-crate-collection');
await mkdir(destination, { recursive: true });
const output = { format: 1, frame: .14, width: 400, height: 360, items: [] };
function textureData(texture) {
  if (!texture) return null;
  const { data, width, height } = texture.image ?? {};
  assert.ok(data && width && height, 'Offline artwork textures must expose their pixel data.');
  texture.updateMatrix();
  return { width, height, channels: data.length / (width * height), data: Array.from(data), matrix: texture.matrix.toArray(),
    wrapS: texture.wrapS, wrapT: texture.wrapT, flipY: texture.flipY, colorSpace: texture.colorSpace };
}
for (const item of CRATE_ITEMS) {
  const asset = createCrateAsset(item.id, { tool: 'pickaxe', backpackTier: 0 });
  try {
    asset.update(output.frame, { reducedMotion: false }); asset.root.updateMatrixWorld(true);
    const materials = [], materialIds = new Map(), meshes = [], points = [], bounds = new THREE.Box3();
    function materialId(material) {
      if (materialIds.has(material)) return materialIds.get(material);
      const id = materials.length; materialIds.set(material, id);
      materials.push({ name: material.name, color: material.color?.toArray() ?? [1, 1, 1], vertexColors: !!material.vertexColors,
        emissive: material.emissive?.clone().multiplyScalar(material.emissiveIntensity ?? 1).toArray() ?? [0, 0, 0],
        roughness: material.roughness ?? 1, metalness: material.metalness ?? 0, clearcoat: material.clearcoat ?? 0,
        clearcoatRoughness: material.clearcoatRoughness ?? .2, envMapIntensity: material.envMapIntensity ?? 1,
        opacity: material.transparent ? material.opacity : 1, transparent: material.transparent, depthWrite: material.depthWrite,
        side: material.side, flatShading: !!material.flatShading, unlit: !!material.isMeshBasicMaterial || !!material.isPointsMaterial,
        additive: material.blending === THREE.AdditiveBlending, map: textureData(material.map), bumpMap: textureData(material.bumpMap), bumpScale: material.bumpScale ?? 0 });
      return id;
    }
    asset.root.traverseVisible(object => {
      if (!object.isMesh && !object.isPoints) return;
      assert.ok(!object.isSkinnedMesh && !object.isInstancedMesh, 'Crate display exports use ordinary geometry.');
      const geometry = object.geometry, position = geometry.attributes.position, normal = geometry.attributes.normal;
      const colors = geometry.attributes.color, uv = geometry.attributes.uv;
      const positions = [], normals = [], vertexColors = [], uvs = [], normalMatrix = new THREE.Matrix3().getNormalMatrix(object.matrixWorld);
      for (let i = 0; i < position.count; i++) {
        const p = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
        assert.ok(p.toArray().every(Number.isFinite)); positions.push(...p.toArray()); bounds.expandByPoint(p);
        if (normal) normals.push(...new THREE.Vector3().fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize().toArray());
        if (colors) vertexColors.push(colors.getX(i), colors.getY(i), colors.getZ(i));
        if (uv) uvs.push(uv.getX(i), uv.getY(i));
      }
      if (object.isPoints) {
        points.push({ positions, material: materialId(object.material), size: object.material.size * object.getWorldScale(new THREE.Vector3()).x }); return;
      }
      assert.ok(normal, `${item.id} geometry has authored normals.`);
      const count = geometry.index?.count ?? position.count;
      const start = Math.max(0, geometry.drawRange.start), end = Math.min(count, start + geometry.drawRange.count);
      const groups = Array.isArray(object.material) ? geometry.groups : [{ start: 0, count, materialIndex: 0 }];
      const reflected = object.matrixWorld.determinant() < 0;
      for (const group of groups) {
        const material = Array.isArray(object.material) ? object.material[group.materialIndex] : object.material;
        if (!material || !material.visible || material.opacity <= 0) continue;
        const indices = [];
        for (let i = Math.max(start, group.start); i + 2 < Math.min(end, group.start + group.count); i += 3) {
          const tri = [0, 1, 2].map(k => geometry.index ? geometry.index.getX(i + k) : i + k);
          if (reflected) [tri[1], tri[2]] = [tri[2], tri[1]];
          indices.push(...tri);
        }
        if (indices.length) meshes.push({ name: object.name, material: materialId(material), positions, normals, colors: vertexColors, uvs, indices });
      }
    });
    const rear = item.id === 'mining_pack' || item.id === 'lumber_pack';
    const camera = { yaw: rear ? Math.PI + .42 : -.38, pitch: item.id === 'hearth_ration_kit' ? .53 : item.slot === 'kit' ? .34 : .22 };
    const model = { id: item.id, name: item.name, tier: item.tier, tierLabel: CRATE_TIERS[item.tier].label, tierColor: CRATE_TIERS[item.tier].color,
      slot: item.slot, frame: output.frame, camera, bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() }, materials, meshes, points };
    const file = `${item.id}.json`; await writeFile(path.join(destination, file), JSON.stringify(model));
    output.items.push({ id: item.id, name: item.name, tier: item.tier, tierLabel: model.tierLabel, tierColor: model.tierColor, file,
      triangles: meshes.reduce((sum, mesh) => sum + mesh.indices.length / 3, 0), camera });
    process.stdout.write(`${item.id}: ${output.items.at(-1).triangles} triangles\n`);
  } finally { asset.dispose(); }
}
assert.equal(output.items.length, 20);
await writeFile(path.join(destination, 'collection.json'), JSON.stringify(output, null, 2));
process.stdout.write(`Exported ${output.items.length} actual models to ${destination}\n`);
