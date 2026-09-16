// Export the actual landmark helper geometry, including dynamic hoist chains.
// node scripts/preview-landmarks.mjs [output.json]
import fs from 'node:fs';
import * as THREE from 'three';

const threeURL=new URL('../node_modules/three/build/three.module.js',import.meta.url).href;
const sharedURL=new URL('../shared/world.js',import.meta.url).href;
const moduleURL=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const plots=fs.readFileSync(new URL('../public/src/plots-world.js',import.meta.url),'utf8').replace("'three'",JSON.stringify(threeURL)).replace("'/shared/world.js'",JSON.stringify(sharedURL)).replace("'./surface-materials.js'",JSON.stringify(new URL('../public/src/surface-materials.js',import.meta.url).href)).replace("'./environment-geometry.js'",JSON.stringify(new URL('../public/src/environment-geometry.js',import.meta.url).href));
const source=fs.readFileSync(new URL('../public/src/world.js',import.meta.url),'utf8').replace("'three'",JSON.stringify(threeURL)).replace("'/shared/world.js'",JSON.stringify(sharedURL)).replace("'./plots-world.js'",JSON.stringify(moduleURL(plots))).replace("'./surface-materials.js'",JSON.stringify(new URL('../public/src/surface-materials.js',import.meta.url).href)).replace("'./environment-geometry.js'",JSON.stringify(new URL('../public/src/environment-geometry.js',import.meta.url).href));
const {createGateArtwork,createWellArtwork}=await import(moduleURL(source));
const output=process.argv[2]||'/tmp/emberwatch-landmarks.json';
const panels=[];

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
      const base=mat.color?.toArray()??[1,1,1];
      const cs=indices.map(i=>mat.vertexColors&&colors?vertexColors[i].map((value,c)=>value*base[c]):base);
      triangles.push({p:ps,n:ns,c:cs,e:mat.emissive?.clone().multiplyScalar(mat.emissiveIntensity??1).toArray()??[0,0,0],metal:mat.metalness??0,rough:mat.roughness??1,side:mat.side??THREE.FrontSide,opacity:mat.transparent?mat.opacity:1});
    }
  }
  panels.push({label,caption,view,focus,triangles,stats:{sourceMeshes,triangles:triangles.length,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()}}});
}

for(const openAmount of [0,1]){
  const artwork=createGateArtwork(),root=new THREE.Group();
  root.position.z=-18.7;root.add(artwork.gate,artwork.frame);
  artwork.gate.position.y=.1+openAmount*4.7;
  artwork.update();
  exportPanel(root,openAmount?'RAISED PORTCULLIS':'CLOSED PORTCULLIS',openAmount?'Gate rises within fixed guides; chains shorten.':'Beveled oak lattice, iron straps, rivets, and pointed shoes.',[.22,.15,1]);
  artwork.dispose();
}
{
  const artwork=createWellArtwork();
  artwork.root.position.set(0,0,0);
  exportPanel(artwork.root,'COMMUNAL WELL','Roof omitted to expose masonry, spindle, rope, and bucket.',[.63,.90,1]);
  exportPanel(artwork.root,'WELL SHAFT DETAIL','Roof omitted; view into the solid inner wall and thick stone rim.',[.13,1.9,1],{center:[0,.70,0],width:4.0,height:3.7});
  artwork.dispose();
}
fs.writeFileSync(output,JSON.stringify({format:1,panels}));
console.log(JSON.stringify({output,panels:panels.map(({label,stats})=>({label,...stats}))}));
