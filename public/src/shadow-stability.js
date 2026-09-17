import * as THREE from 'three';

const basis=new THREE.Matrix4(),right=new THREE.Vector3(),up=new THREE.Vector3(),offset=new THREE.Vector3();

/** Call after the sky positions a root-level directional light for this frame.
 * Snap in its shadow camera's axes, preserving light direction and depth. World
 * X/Z rounding still moves an angled light's projected grid by partial texels.
 * Reuses scratch vectors; no allocations or shadow-map resizing per frame.
 */
export function stabilizeDirectionalShadow(light){
  const camera=light?.shadow?.camera,mapSize=light?.shadow?.mapSize;
  if(!light?.isDirectionalLight||!camera?.isOrthographicCamera)return false;
  const stepX=(camera.right-camera.left)/(mapSize.x*camera.zoom),stepY=(camera.top-camera.bottom)/(mapSize.y*camera.zoom);
  if(!Number.isFinite(stepX)||!Number.isFinite(stepY)||stepX<=0||stepY<=0)return false;
  basis.lookAt(light.position,light.target.position,camera.up);
  right.setFromMatrixColumn(basis,0);up.setFromMatrixColumn(basis,1);
  const x=light.target.position.dot(right)+(camera.right+camera.left)/2;
  const y=light.target.position.dot(up)+(camera.top+camera.bottom)/2;
  offset.copy(right).multiplyScalar(Math.round(x/stepX)*stepX-x).addScaledVector(up,Math.round(y/stepY)*stepY-y);
  light.position.add(offset);light.target.position.add(offset);
  return true;
}
