// Export the actual Resource Exchange building and its spatially batched trim.
// node scripts/preview-exchange.mjs [output.json]
import fs from 'node:fs';
import * as THREE from 'three';

const threeURL=new URL('../node_modules/three/build/three.module.js',import.meta.url).href;
const sharedURL=new URL('../shared/world.js',import.meta.url).href;
const moduleURL=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const plots=fs.readFileSync(new URL('../public/src/plots-world.js',import.meta.url),'utf8').replace("'three'",JSON.stringify(threeURL)).replace("'/shared/world.js'",JSON.stringify(sharedURL));
const source=fs.readFileSync(new URL('../public/src/world.js',import.meta.url),'utf8').replace("'three'",JSON.stringify(threeURL)).replace("'/shared/world.js'",JSON.stringify(sharedURL)).replace("'./plots-world.js'",JSON.stringify(moduleURL(plots)));
const {createWorld}=await import(moduleURL(source));
const output=process.argv[2]||'/tmp/emberwatch-exchange.json';
const textures={};
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
      let texture=null;
      if(mat.map?.image?.commands){texture=mat.map.uuid;textures[texture]={width:mat.map.image.width,height:mat.map.image.height,commands:mat.map.image.commands};}
      const uv=g.attributes.uv?indices.map(i=>[g.attributes.uv.getX(i),g.attributes.uv.getY(i)]):null;
      triangles.push({p:ps,n:ns,c:cs,texture,uv,e:mat.emissive?.clone().multiplyScalar(mat.emissiveIntensity??1).toArray()??[0,0,0],metal:mat.metalness??0,rough:mat.roughness??1,side:mat.side??THREE.FrontSide,opacity:mat.transparent?mat.opacity:1});
    }
  }
  panels.push({label,caption,view,focus,triangles,stats:{sourceMeshes,triangles:triangles.length,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()}}});
}

// Record the existing canvas sign drawing commands rather than invent a label.
const previousDocument=globalThis.document;
globalThis.document={createElement:()=>{
  const canvas={width:0,height:0,commands:[]};
  const state={fillStyle:'#000000',strokeStyle:'#000000',lineWidth:1,font:'10px sans-serif',textAlign:'start',textBaseline:'alphabetic'};
  canvas.getContext=()=>new Proxy(state,{get(target,key){
    if(key in target)return target[key];
    return(...args)=>canvas.commands.push({op:key,args,state:{...state}});
  },set(target,key,value){target[key]=value;return true;}});
  return canvas;
}};
let world;try{world=createWorld(new THREE.Scene());}finally{globalThis.document=previousDocument;}
world.root.updateMatrixWorld(true);
const selected=new THREE.Group();selected.name='Resource Exchange actual architecture';
const market=world.root.getObjectByName('building-market');if(!market)throw new Error('Resource Exchange is not in the current world.');
selected.add(market.clone(true));
const instanceMatrix=new THREE.Matrix4(),position=new THREE.Vector3();
for(const mesh of world.root.children){
  if(!mesh.isInstancedMesh||mesh.name.startsWith('Decorative'))continue;
  for(let i=0;i<mesh.count;i++){
    mesh.getMatrixAt(i,instanceMatrix);const matrix=new THREE.Matrix4().multiplyMatrices(mesh.matrixWorld,instanceMatrix);position.setFromMatrixPosition(matrix);
    if(position.x<9.5||position.x>24.8||position.z< -91.3||position.z> -80.7||position.y<.08||position.y>9)continue;
    const proxy=new THREE.Mesh(mesh.geometry,mesh.material);proxy.matrix.copy(matrix);proxy.matrixAutoUpdate=false;selected.add(proxy);
  }
}
exportPanel(selected,'RESOURCE EXCHANGE','Permanent storehouse, covered counter, and west-facing frontage.',[-1,.40,.52]);
exportPanel(selected,'AT THE TRADING COUNTER','Resource bins, weighing balance, serving shelves, and the shop sign.',[-1,.14,.04],{center:[10.8,2.26,-86],width:10.5,height:6.1});
fs.writeFileSync(output,JSON.stringify({format:1,panels,textures}));
console.log(JSON.stringify({output,panels:panels.map(({label,stats})=>({label,...stats})),textures:Object.keys(textures).length}));
