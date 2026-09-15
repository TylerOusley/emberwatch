// Export actual cave architecture and all 44 public mineral formations.
// node scripts/preview-cave.mjs [output.json]
import fs from 'node:fs';
import * as THREE from 'three';
import {createCaveWorld} from '../public/src/cave-world.js';
import {createTorchSystem} from '../public/src/torch-world.js';
import {RESOURCES,caveResourceType,groundHeight,CAVE_AREAS} from '../shared/world.js';

const threeURL=new URL('../node_modules/three/build/three.module.js',import.meta.url).href;
const sharedURL=new URL('../shared/world.js',import.meta.url).href;
const plots=fs.readFileSync(new URL('../public/src/plots-world.js',import.meta.url),'utf8').replace("'three'",JSON.stringify(threeURL)).replace("'/shared/world.js'",JSON.stringify(sharedURL));
const {mineralOutcropGeometry}=await import('data:text/javascript;base64,'+Buffer.from(plots).toString('base64'));
const output=process.argv[2]||'/tmp/emberwatch-cave.json';
const cave=createCaveWorld(),ore=new THREE.Group(),oreMaterial=new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:.98}),oreGeometries=[];
ore.name='cave-preview-resource-formations';cave.root.add(ore);
const torches=createTorchSystem(cave.root,cave.torchFixtures); // export actual holders, use the dedicated preview-torches script for GLSL flames
const minerals=RESOURCES.filter(n=>n.caveTier),oreTypes={};
for(const node of minerals){
  // A reproducible fresh-village roll; live villages have their own saved seed.
  const type=caveResourceType(node.caveTier,`preview-cave:${node.id}`,0);
  oreTypes[type]=(oreTypes[type]??0)+1;
  const geometry=mineralOutcropGeometry(type,node.seed);oreGeometries.push(geometry);
  const mesh=new THREE.Mesh(geometry,oreMaterial);mesh.position.set(node.x,groundHeight(node.x,node.z),node.z);mesh.name=`${type}:${node.id}`;ore.add(mesh);
}
cave.root.updateMatrixWorld(true);
const triangles=[],stats={sourceMeshes:0,triangles:0,minerals:minerals.length,oreTypes},instance=new THREE.Matrix4();
cave.root.traverse(original=>{
  if(!original.isMesh||!original.visible||original.material?.isShaderMaterial)return;
  let part='interior';
  for(let p=original;p;p=p.parent){
    if(!p.visible)return;
    if(p===ore){part='ore';break;}
    if(p===cave.roof){part='roof';break;}
    if(p.name==='mouth-rock-crown'){part='crown';break;}
    if(p===cave.mouth){part='mouth';break;}
  }
  stats.sourceMeshes++;
  for(let instanceIndex=0;instanceIndex<(original.isInstancedMesh?original.count:1);instanceIndex++){
    const matrix=original.matrixWorld.clone();
    if(original.isInstancedMesh){original.getMatrixAt(instanceIndex,instance);matrix.multiply(instance);}
    const g=original.geometry,ix=g.index,p=g.attributes.position;
    if(!g.attributes.normal)g.computeVertexNormals();
    const n=g.attributes.normal,color=g.attributes.color,normalMatrix=new THREE.Matrix3().getNormalMatrix(matrix),reflected=matrix.determinant()<0;
    const ps=[],ns=[];
    for(let i=0;i<p.count;i++){
      const position=new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(matrix).toArray();
      const normal=new THREE.Vector3().fromBufferAttribute(n,i).applyMatrix3(normalMatrix).normalize().toArray();
      if(![...position,...normal].every(Number.isFinite))throw new Error(`Nonfinite cave vertex in ${original.name}`);
      ps.push(position);ns.push(normal);
    }
    const start=Math.max(0,g.drawRange.start),end=Math.min(ix?ix.count:p.count,start+g.drawRange.count);
    for(let j=start;j+2<end;j+=3){
      const group=Array.isArray(original.material)?g.groups.find(item=>j>=item.start&&j<item.start+item.count):null;
      if(Array.isArray(original.material)&&!group)continue;
      const mat=Array.isArray(original.material)?original.material[group.materialIndex]:original.material;
      if(!mat||mat.visible===false||mat.opacity<=0)continue;
      const indices=[0,1,2].map(k=>ix?ix.getX(j+k):j+k);if(reflected)[indices[1],indices[2]]=[indices[2],indices[1]];
      const base=mat.color?.toArray()??[1,1,1];
      const colors=indices.map(i=>mat.vertexColors&&color?[color.getX(i)*base[0],color.getY(i)*base[1],color.getZ(i)*base[2]]:base);
      triangles.push({part,p:indices.map(i=>ps[i]),n:indices.map(i=>ns[i]),c:colors,e:mat.emissive?.clone().multiplyScalar(mat.emissiveIntensity??1).toArray()??[0,0,0],rough:mat.roughness??1,metal:mat.metalness??0,side:mat.side??THREE.FrontSide});
    }
  }
});
stats.triangles=triangles.length;
const camera=new THREE.PerspectiveCamera(65,1,.1,200);camera.position.set(-2,1,-147);
cave.update({x:-2,z:-147},camera,0);
torches.update(0,0,camera,{x:-2,y:groundHeight(-2,-147),z:-147});
const lights=torches.lights.filter(light=>light.visible&&light.intensity>0).map(light=>({position:light.position.toArray(),color:light.color.toArray(),intensity:light.intensity}));
const chambers=CAVE_AREAS.filter(a=>a.kind==='chamber').map(a=>({label:`${a.tier.toUpperCase()}  /  ${-groundHeight(a.x,a.z)} m`,point:[a.x,groundHeight(a.x,a.z)+.15,a.z]}));
const panels=[
  {id:'overview',projection:'orthographic',view:[.10,2.1,1],hide:['roof','crown'],label:'THREE DESCENDING CHAMBERS',caption:'Ceiling and mouth crown hidden for this cutaway.',chambers},
  {id:'entrance',projection:'perspective',camera:[4,4,-102],target:[0,2,-123],fov:60,hide:[],label:'THE DEEPWORKS ENTRANCE',caption:'Dressed stone, brass-inlaid nameplate and a continuous rail descent.'},
  {id:'interior',projection:'perspective',camera:[-2,1,-147],target:[7,-1.5,-161],fov:70,hide:[],label:'INSIDE THE UPPER WORKINGS',caption:'Rock chambers and torch holders; animated fire has its own GLSL preview.',lights}
];
fs.writeFileSync(output,JSON.stringify({format:1,triangles,panels,stats}));
ore.removeFromParent();for(const g of oreGeometries)g.dispose();oreMaterial.dispose();torches.dispose();cave.dispose();
console.log(JSON.stringify({output,stats}));
