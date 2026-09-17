import * as THREE from 'three';

export const EXPANSION_UTILITIES = new Set(['harvest_satchel', 'quartermasters_belt', 'tinkers_pouch', 'caravan_harness', 'arcanists_seal', 'heart_of_emberwatch']);

// Small authored accessories use the existing torso rig and retain every mesh
// during animation. The Heart emits light through its material, without adding
// a shadow-casting point light per wearer.
export function createExpansionUtility(id) {
  if (!EXPANSION_UTILITIES.has(id)) return null;
  const object = new THREE.Group(); object.name = `crate-utility-${id}`; object.userData.utilityId = id;
  const resources = new Set(), heart = id === 'heart_of_emberwatch', seal = id === 'arcanists_seal';
  const material = (color, metalness = 0, emissive = 0) => {
    const value = new THREE.MeshStandardMaterial({ color, metalness, roughness: metalness ? .36 : .88, emissive, emissiveIntensity: emissive ? .65 : 0 });
    resources.add(value); return value;
  };
  const leather = material(0x44332b), cloth = material(id === 'harvest_satchel' ? 0x677846 : id === 'quartermasters_belt' ? 0x425d80 : 0x755775), metal = material(heart ? 0x272c35 : seal ? 0xb9ced8 : 0xba9553, .75), gem = material(heart ? 0xff8b33 : 0xa577e2, .28, heart ? 0xff4b0d : 0x583080);
  const add = (geometry, mat, point = [0, 0, 0], scale = [1, 1, 1]) => { resources.add(geometry); const mesh = new THREE.Mesh(geometry, mat); mesh.position.fromArray(point); mesh.scale.fromArray(scale); object.add(mesh); return mesh; };
  const tube = (points, radius, mat, closed = false) => add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), closed), 30, radius, 5, closed), mat);
  const strap = (side, back = false) => tube([[side * .28, -.23, back ? -.35 : .25], [side * .28, .15, back ? -.30 : .31], [side * .26, .46, -.02]], .023, leather);
  const pouch = (x, y, z, width = .20, height = .23) => {
    add(new THREE.SphereGeometry(1, 16, 10), cloth, [x, y, z], [width / 2, height / 2, .083]);
    const flap = add(new THREE.SphereGeometry(1, 12, 8), leather, [x, y + height * .24, z + .047], [width * .5, height * .27, .05]); flap.rotation.x = -.15;
    add(new THREE.TorusGeometry(.022, .004, 5, 12), metal, [x, y + .014, z + .102]);
  };
  if (heart || seal) {
    tube([[-.23,.43,.10],[-.16,.22,.315],[0,.07,.357],[.16,.22,.315],[.23,.43,.10]], .008, metal);
    const frame = add(new THREE.TorusGeometry(.104, .019, 8, 24), metal, [0,.065,.355], [.82,1,.6]); frame.rotation.z = Math.PI / 4;
    add(new THREE.IcosahedronGeometry(.079, 1), gem, [0,.065,.374], [.76,1,.37]);
    for (const side of [-1,1]) tube([[side*.047,.14,.38],[side*.06,.07,.409],[side*.045,-.01,.38]], .009, metal);
    object.userData.rarity = heart ? 'godly' : 'legendary';
  } else if (id === 'caravan_harness') {
    for (const side of [-1,1]) { strap(side, true); pouch(side * .29, -.10, -.39, .29, .39); }
    tube([[-.40,-.11,0],[0,-.11,.31],[.40,-.11,0],[0,-.11,-.33]],.026,leather,true);
    add(new THREE.TorusGeometry(.040,.009,6,12),metal,[0,-.11,.342]);
    object.userData.rarity='legendary';
  } else {
    strap(1); pouch(.30,-.21,.31,id === 'tinkers_pouch' ? .25 : .21,.29);
    if (id === 'tinkers_pouch') for (let i=0;i<4;i++) { add(new THREE.CylinderGeometry(.021,.021,.10,8),metal,[.215+i*.055,-.31,.38]); add(new THREE.SphereGeometry(.019,8,5),gem,[.215+i*.055,-.25,.38]); }
    else if (id === 'harvest_satchel') for (let i=0;i<3;i++) tube([[.34,-.09,.36],[.36+i*.018,-.02,.35],[.36+i*.018,.02+i*.025,.36]],.004,metal);
    else { add(new THREE.BoxGeometry(.09,.13,.024),leather,[.24,-.06,.38]); add(new THREE.TorusGeometry(.025,.004,5,12),metal,[.34,-.09,.416]); }
    object.userData.rarity = id === 'harvest_satchel' ? 'basic' : id === 'quartermasters_belt' ? 'rare' : 'epic';
  }
  const parts = [{ bone:'body', object }]; let disposed = false;
  return { parts, setBackpackTier() {}, update(time, options = {}) { if (disposed) return; if (heart) gem.emissiveIntensity = options?.reducedMotion ? .8 : .75 + Math.sin((Number.isFinite(time) ? time : 0) * 2) * .14 + (options?.emberWard > 0 ? .6 : 0); }, dispose() { if (disposed) return; disposed = true; object.removeFromParent(); for (const resource of resources) resource.dispose(); object.clear(); } };
}
