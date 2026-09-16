// Export real plot structures for the shared offline geometry renderer.
// node scripts/preview-plots.mjs [output.json]
// python scripts/render-landmark-preview.py input.json output.jpg
import fs from 'node:fs';
import * as THREE from 'three';
import {PLOTS} from '../shared/world.js';
let source=fs.readFileSync(new URL('../public/src/plots-world.js',import.meta.url),'utf8').replace("'three'",JSON.stringify(new URL('../node_modules/three/build/three.module.js',import.meta.url).href)).replace("'/shared/world.js'",JSON.stringify(new URL('../shared/world.js',import.meta.url).href));
for(const name of ['surface-materials','environment-geometry'])source=source.replace(`'./${name}.js'`,JSON.stringify(new URL(`../public/src/${name}.js`,import.meta.url).href));
const {createPlotsWorld}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const old=globalThis.document;globalThis.document={createElement:()=>({getContext:()=>new Proxy({},{get:()=>()=>{},set:()=>true})})};
const panels=[],output=process.argv[2]||'/tmp/emberwatch-plots.json';
function exportPanel(root,label,caption,view,focus=null) {
  root.updateMatrixWorld(true);
  const triangles=[],meshes=[],bounds=new THREE.Box3();
  let sourceMeshes=0;
  root.traverse(mesh=>{
    if(!mesh.isMesh||!mesh.visible)return;
    for(let parent=mesh.parent;parent;parent=parent.parent)if(!parent.visible)return;
    sourceMeshes++;
    if(mesh.isInstancedMesh){
      const instance=new THREE.Matrix4();
      for(let i=0;i<mesh.count;i++){
        mesh.getMatrixAt(i,instance);
        const proxy=new THREE.Mesh(mesh.geometry,mesh.material);
        proxy.matrixWorld.multiplyMatrices(mesh.matrixWorld,instance);
        if(mesh.instanceColor){proxy.userData.previewTint=new THREE.Color();mesh.getColorAt(i,proxy.userData.previewTint);}
        meshes.push(proxy);
      }
    }else meshes.push(mesh);
  });
  for(const mesh of meshes){
    const g=mesh.geometry,ix=g.index,p=g.attributes.position;
    if(!p)continue;
    if(!g.attributes.normal)g.computeVertexNormals();
    const n=g.attributes.normal,colors=g.attributes.color;
    const normalMatrix=new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    const reflected=mesh.matrixWorld.determinant()<0;
    const positions=[],normals=[],vertexColors=[];
    for(let i=0;i<p.count;i++){
      const v=new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);
      const vn=new THREE.Vector3().fromBufferAttribute(n,i).applyMatrix3(normalMatrix).normalize();
      if(![...v.toArray(),...vn.toArray()].every(Number.isFinite))throw new Error(`Nonfinite ${label} geometry.`);
      positions.push(v.toArray());normals.push(vn.toArray());bounds.expandByPoint(v);
      if(colors)vertexColors.push([colors.getX(i),colors.getY(i),colors.getZ(i)]);
    }
    const start=Math.max(0,g.drawRange.start),end=Math.min(ix?ix.count:p.count,start+g.drawRange.count);
    for(let j=start;j+2<end;j+=3){
      const group=Array.isArray(mesh.material)?g.groups.find(item=>j>=item.start&&j<item.start+item.count):null;
      if(Array.isArray(mesh.material)&&!group)continue;
      const mat=Array.isArray(mesh.material)?mesh.material[group.materialIndex]:mesh.material;
      if(!mat||mat.visible===false||mat.opacity<=0)continue;
      const indices=[0,1,2].map(k=>ix?ix.getX(j+k):j+k);
      if(reflected)[indices[1],indices[2]]=[indices[2],indices[1]];
      const ps=indices.map(i=>positions[i]),ns=indices.map(i=>normals[i]);
      if(mat.flatShading){const face=new THREE.Vector3().subVectors(new THREE.Vector3(...ps[1]),new THREE.Vector3(...ps[0])).cross(new THREE.Vector3().subVectors(new THREE.Vector3(...ps[2]),new THREE.Vector3(...ps[0]))).normalize().toArray();for(let k=0;k<3;k++)ns[k]=face;}
      const base=(mat.color?.clone()??new THREE.Color()).multiply(mesh.userData.previewTint??new THREE.Color()).toArray();
      const cs=indices.map(i=>mat.vertexColors&&colors?vertexColors[i].map((value,c)=>value*base[c]):base);
      triangles.push({p:ps,n:ns,c:cs,e:mat.emissive?.clone().multiplyScalar(mat.emissiveIntensity??1).toArray()??[0,0,0],metal:mat.metalness??0,rough:mat.roughness??1,side:mat.side??THREE.FrontSide,opacity:mat.transparent?mat.opacity:1});
    }
  }
  panels.push({label,caption,view,focus,triangles,stats:{sourceMeshes,triangles:triangles.length,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()}}});
}

const scene=new THREE.Scene(),world=createPlotsWorld(scene);
try{
 const definitions=[['house',1,'HEARTHSTONE COTTAGE','Overlapping shingles, chamfered stone, framed glazing and oak joinery.'],['church',2,'SANCTUARY II','Fitted beds, stone courses, leaded panes and gilded spire.'],['mine',3,'DEVELOPED MINE III','A twin hoist and engine house behind the unchanged harvest area.'],['cannon',2,'REINFORCED CANNON II','Turned barrel, fitted muzzle, wheel spokes and banded ironwork.']];
 world.update({id:'plot-geometry-preview',clock:0,plots:definitions.map(([building,level],i)=>({id:PLOTS[i].id,ownerId:'preview',building,level,hp:100}))});
 for(let i=0;i<definitions.length;i++){
  const [building,level,label,caption]=definitions[i],group=world.root.getObjectByName('plot-'+PLOTS[i].id);group.position.set(0,0,0);group.rotation.y=0;
  // Canvas lettering needs the actual browser; suppress only those flat sign
  // planes for this offline structural inspection, not any building geometry.
  group.traverse(m=>{if(m.isMesh&&m.material.map?.isCanvasTexture)m.visible=false;});
  exportPanel(group,label,caption,[.62,building==='cannon'?.76:.46,1]);
 }
 fs.writeFileSync(output,JSON.stringify({format:1,title:'EMBERWATCH  /  OWNED PLOT DETAIL',subtitle:'Actual game meshes  ·  Surface geometry and material tints  ·  Offline studio lighting',footer:'Geometry review only. Local PBR textures, animated effects, signs and game lighting need a live playtest.',panels}));
 console.log(JSON.stringify({output,panels:panels.map(({label,stats})=>({label,...stats}))}));
}finally{world.dispose();globalThis.document=old;}
