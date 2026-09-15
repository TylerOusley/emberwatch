// Fit the model's bounding sphere in BOTH viewport dimensions. Normalized item
// scale alone is insufficient on a narrow phone or split-screen browser.
export function studioDistance(radius,aspect,fov=33,padding=1.10){
  if(![radius,aspect,fov,padding].every(Number.isFinite)||radius<=0||aspect<=0||fov<=0||fov>=170||padding<1)throw new Error('Invalid studio camera bounds.');
  const vertical=fov*Math.PI/360,horizontal=Math.atan(Math.tan(vertical)*aspect);
  return radius/Math.sin(Math.min(vertical,horizontal))*padding;
}
