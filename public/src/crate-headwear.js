import * as THREE from 'three';

// Original optional cosmetic models. All coordinates are local to the existing
// head bone: +Z is the face, scalp crown is .296m, and eye centers are y=.047m.
// Nothing in this module equips a player, awards an item, or creates a light.
const TAU=Math.PI*2,clamp=THREE.MathUtils.clamp,lerp=THREE.MathUtils.lerp;
const COVER_NAMES=Object.freeze(['swept grooved scalp hair','forged helmet and cheek protection','rolled helmet edge','draped linen hood','cloth opening seam','soft stitched leather cap']);
const STYLES={
  padded_cap:{top:.333,rx:.267,rz:.238,front:.142,back:-.061,soft:true},
  iron_coif:{top:.329,rx:.285,rz:.251,coif:true},
  runed_helm:{top:.356,rx:.284,rz:.249,front:.128,back:-.085,cheek:.093},
  dawnsteel_helm:{top:.380,rx:.285,rz:.251,front:.136,back:-.085,cheek:.058},
  sunforged_viking_helm:{top:.379,rx:.284,rz:.250,front:.133,back:-.092,cheek:.062}
};
function bottomAt(style,theta){
  const c=Math.cos(theta),angle=Math.abs(Math.atan2(Math.sin(theta),c));
  if(style.coif)return -.279+.435*Math.pow(Math.max(0,(c-.20)/.8),1.45);
  return lerp(style.front,style.back,(1-c)/2)-(style.cheek??0)*Math.exp(-(((angle-1.28)/.28)**2));
}
function shellPoint(style,u,v,offset=0){
  const theta=u*TAU,s=Math.sin(theta),c=Math.cos(theta),y=lerp(style.top,bottomAt(style,theta),v);
  const crown=Math.sqrt(Math.max(0,1-Math.max(0,(y-.023)/(style.top-.023))**2));
  const radius=crown*(1+.025*Math.max(0,-y));
  const quilt=style.soft?.0064*(Math.sin(theta*10+v*19)**2)*(Math.sin(theta*10-v*19)**2)*Math.sin(Math.PI*v):0;
  const forged=!style.soft&&!style.coif?.0008*Math.cos(theta*6)*Math.sin(v*Math.PI):0;
  return new THREE.Vector3(s*Math.max(0,style.rx*radius+quilt+forged+offset),y,c*Math.max(0,style.rz*radius+quilt+forged+offset)-.041);
}
function sampledSurface(cols,rows,sample,{wrap=false,flip=false}={}){
  const positions=[],colors=[],uvs=[],indices=[];
  for(let j=0;j<=rows;j++)for(let i=0;i<=cols;i++){
    const p=sample(i/cols,j/rows),v=p.position??p,c=p.color??[1,1,1];positions.push(v.x,v.y,v.z);colors.push(...c);uvs.push(i/cols,j/rows);
  }
  for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){const a=j*(cols+1)+i,b=a+cols+1;if(flip)indices.push(a,b,a+1,b,b+1,a+1);else indices.push(a,a+1,b,b,a+1,b+1);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setIndex(indices);g.computeVertexNormals();
  if(wrap){const n=g.attributes.normal;for(let j=0;j<=rows;j++){const a=j*(cols+1),b=a+cols,normal=new THREE.Vector3().fromBufferAttribute(n,a).add(new THREE.Vector3().fromBufferAttribute(n,b)).normalize();n.setXYZ(a,normal.x,normal.y,normal.z);n.setXYZ(b,normal.x,normal.y,normal.z);}}
  g.computeBoundingBox();g.computeBoundingSphere();return g;
}

/** Return owned, unparented artwork for a named head bone. Unknown ids throw. */
export function createHeadwear(id){
  if(!Object.hasOwn(STYLES,id))throw new RangeError(`Unknown headwear: ${String(id)}`);
  const style=STYLES[id],root=new THREE.Group();root.name=`crate-headwear-${id}`;root.userData={id,sculpted:true,attachment:'head',front:'+Z'};
  const owned=new Set(),batches=new Map(),sparkles=[];
  const own=resource=>(owned.add(resource),resource);
  function mat(name,color,roughness=.7,metalness=0,extra={}){const m=own(new THREE.MeshPhysicalMaterial({color,roughness,metalness,vertexColors:true,...extra}));m.name=name;return m;}
  function add(g,material,name){own(g);if(!batches.has(material))batches.set(material,[]);batches.get(material).push({g,name});return g;}
  function surface(material,name,cols,rows,sample,options){return add(sampledSurface(cols,rows,sample,options),material,name);}
  function tube(material,name,points,radius=.0024,segments=32,closed=false){
    const path=new THREE.CatmullRomCurve3(points.map(p=>p.isVector3?p:new THREE.Vector3(...p)),closed,'centripetal');
    return add(new THREE.TubeGeometry(path,segments,radius,5,closed),material,name);
  }
  function shell(material,lining){
    const shade=(u,v)=>{const theta=u*TAU;
      if(style.soft){const a=Math.abs(Math.sin(theta*10+v*19)),b=Math.abs(Math.sin(theta*10-v*19)),seam=Math.min(a,b),t=.76+.24*clamp(seam/.17,0,1);return [t,t*.99,t*.96];}
      const value=.966+.028*Math.sin(theta*9+v*7)*Math.sin(theta*4-v*12);return [value,value,value];};
    surface(material,'continuous shaped outer shell',80,32,(u,v)=>({position:shellPoint(style,u,v),color:shade(u,v)}),{wrap:true,flip:true});
    // A second inward face and joined rolled opening give genuine thickness.
    surface(lining,'fitted inner lining',64,20,(u,v)=>{const p=shellPoint(style,u,v,-.007);p.y-=.005*(1-v);return p;},{wrap:true});
    surface(lining,'closed opening edge',80,1,(u,v)=>shellPoint(style,u,1,-.007+v*.007),{wrap:true,flip:true});
  }
  function band(material,name,start=.89,end=1,offset=.0025){surface(material,name,80,5,(u,v)=>shellPoint(style,u,lerp(start,end,v),offset),{wrap:true,flip:true});}
  function rolledEdge(material,radius=.0045){tube(material,'rolled opening binding',Array.from({length:81},(_,i)=>shellPoint(style,i/80,1,.003)),radius,100,true);}
  function meridian(material,width=.055,offset=.004){
    for(const center of[0,.5])surface(material,'raised crown band',8,32,(u,v)=>shellPoint(style,center+(u-.5)*width,v,offset),{flip:true});
  }
  function stud(material,u,v,r=.010){
    const center=shellPoint(style,u,v,.003),ahead=shellPoint(style,u+.0002,v),below=shellPoint(style,u,v+.0002);
    const tangent=ahead.sub(shellPoint(style,u,v)).normalize(),normal=below.sub(shellPoint(style,u,v)).cross(tangent).normalize();
    const geometry=new THREE.SphereGeometry(r,10,6);geometry.scale(1,1,.40);geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),normal));geometry.translate(center.x,center.y,center.z);add(geometry,material,'flush forged rivets');
  }
  function runes(material,{v=.84,count=11,height=.048,radius=.0017}={}){
    const glyphs=[[[0,-1],[0,1],[.6,.4],[0,0],[-.6,.4]],[[0,-1],[0,1],[-.6,.4],[.6,-.2]],[[0,-1],[0,1],[-.6,.25],[0,-.1],[.6,.25]],[[0,-1],[-.6,0],[0,1],[.6,0],[0,-1]],[[0,-1],[0,1],[.6,.35],[0,-.1]]];
    for(let i=0;i<count;i++){const angle=lerp(-1.08,1.08,count===1?.5:i/(count-1)),glyph=glyphs[i%glyphs.length];tube(material,'inlaid runic strokes',glyph.map(([x,y])=>shellPoint(style,(angle+x*.039)/TAU,v-y*height,.0055)),radius,Math.max(12,glyph.length*4));}
  }
  const darkLining=mat('supple dark fitted lining',0x322c26,.96);
  if(id==='padded_cap'){
    const cloth=mat('moss flax quilted cloth',0x727757,.98),binding=mat('bound russet leather',0x634b35,.88),thread=mat('waxed linen stitching',0xc1ad7b,.95);
    shell(cloth,darkLining);band(binding,'soft leather sweatband',.91,1,.003);rolledEdge(binding,.005);
    for(let i=0;i<72;i++){const u=i/72;tube(thread,'hand sewn binding stitch',[shellPoint(style,u-.0013,.936,.006),shellPoint(style,u+.0013,.972,.006)],.0009,3);}
    // Curved seams gather the padded crown without a separate primitive top.
    for(let i=0;i<6;i++)tube(binding,'tailored crown seam',Array.from({length:21},(_,j)=>shellPoint(style,i/6,j/20*.90,.0015)),.0013,24);
  }else if(id==='iron_coif'){
    const backing=mat('dark woven coif undercap',0x333c3d,.96),steel=mat('interlinked weathered iron',0x8a9697,.40,.91),alternate=mat('alternating iron links',0x697577,.49,.88),binding=mat('coif leather face binding',0x554536,.85);
    shell(backing,darkLining);
    // Real flattened interlocking rings follow the hood's changing curvature;
    // they are consolidated into two material meshes after construction.
    for(let row=0;row<20;row++){
      const y=.312-row*.030,sideV=(style.top-y)/(style.top-bottomAt(style,Math.PI/2)),at=shellPoint(style,.25,sideV),count=Math.max(10,Math.round(Math.abs(at.x)*TAU/.037));
      for(let col=0;col<count;col++){
        const u=(col+(row%2)*.5)/count,v=(style.top-y)/(style.top-bottomAt(style,u*TAU));
        if(v>.977)continue;
        const p=shellPoint(style,u,v,.003),du=shellPoint(style,u+.0002,v).sub(shellPoint(style,u-.0002,v)).normalize(),dv=shellPoint(style,u,v+.0002).sub(shellPoint(style,u,v-.0002)).normalize(),normal=new THREE.Vector3().crossVectors(dv,du).normalize();
        const tilt=row%2?.36:-.36,along=du.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(dv,Math.sin(tilt)),down=dv.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(du,-Math.sin(tilt));
        surface(row%2?alternate:steel,'interwoven chain links',8,3,(a,b)=>{const angle=a*TAU,t=b*TAU,r=.0025,px=Math.cos(angle)*(.0195+r*Math.cos(t)),py=Math.sin(angle)*(.0172+r*Math.cos(t));return p.clone().addScaledVector(along,px).addScaledVector(down,py).addScaledVector(normal,Math.sin(t)*r);},{wrap:true,flip:true});
      }
    }
    rolledEdge(binding,.006);band(binding,'bound coif opening',.974,1,.005);
  }else if(id==='runed_helm'){
    const steel=mat('tempered midnight steel',0x52707d,.30,.91),edge=mat('brushed pewter edges',0xb1beb9,.25,.88),inlay=mat('quiet frost runes',0x88bfb9,.31,.60,{emissive:0x286a65,emissiveIntensity:.30}),dark=mat('engraved blue steel recess',0x263e49,.52,.72);
    shell(steel,darkLining);band(dark,'recessed runic brow band',.75,.985,.0025);rolledEdge(edge,.005);meridian(edge,.042,.0045);runes(inlay,{v:.84,count:11,height:.042});
    for(let i=0;i<12;i++)stud(edge,(i+.5)/12,.953,.0065);
    for(const center of[.25,.75])tube(edge,'swept temple ridge',Array.from({length:17},(_,i)=>shellPoint(style,center-.045+Math.sin(i/16*Math.PI)*.05,.36+i/16*.64,.004)),.0038,20);
  }else if(id==='dawnsteel_helm'){
    const ivory=mat('ivory enamel over dawnsteel',0xe5e1c9,.26,.62,{clearcoat:.32,clearcoatRoughness:.18}),silver=mat('polished silver edges',0xc9d3d1,.19,.97),gold=mat('warm gold filigree',0xd5a34d,.23,.96),recess=mat('inset antique gold',0x7c592e,.42,.88);
    shell(ivory,darkLining);band(silver,'silver brow plate',.88,1,.003);rolledEdge(gold,.004);meridian(gold,.036,.004);runes(recess,{v:.937,count:9,height:.020,radius:.0012});
    for(const side of[-1,1]){
      const point=(t,s,offset=0)=>{const width=.052*Math.sin(Math.PI*t)**.72;return new THREE.Vector3(side*(.266+.051*Math.sin(Math.PI*t*.85)+offset+.006*(1-s*s)),.026+.31*t,-.024-.105*t+Math.sin(Math.PI*t)*.040+s*width);};
      for(const back of[false,true])surface(silver,'swept sculpted temple plate',8,24,(u,v)=>point(v,u*2-1,back?-.008:.007),{flip:side>0?!back:back});
      for(const edge of[-1,1])tube(gold,'gilded temple edge',Array.from({length:25},(_,i)=>point(i/24,edge,.010)),.0031,28);
      for(let i=1;i<6;i++){const t=i/7;tube(recess,'engraved temple feather',Array.from({length:8},(_,j)=>point(t+j/7*.10,(j/7-.5)*1.7,.013)),.0015,10);}
    }
    for(let i=0;i<8;i++)stud(gold,(i+.5)/8,.941,.007);
    surface(gold,'sunrise forehead seal',40,7,(u,v)=>{const a=u*TAU,r=.033*v,cy=.228,x=Math.sin(a)*r,y=cy+Math.cos(a)*r,baseZ=shellPoint(style,0,(style.top-y)/(style.top-style.front)).z;return new THREE.Vector3(x,y,baseZ+.006+.012*(1-v*v));},{flip:false});
  }else{
    const gold=mat('highly polished sunforged gold',0xeec24f,.135,1,{clearcoat:.40,clearcoatRoughness:.12,envMapIntensity:1.45}),bright=mat('burnished pale gold edges',0xf4db91,.19,.98,{envMapIntensity:1.35}),engraving=mat('deep engraved gold recesses',0x80601f,.34,.92),inset=mat('warm hammered gold bands',0xc89128,.26,.98);
    shell(gold,darkLining);band(inset,'hammered engraved brow band',.79,1,.003);rolledEdge(bright,.005);meridian(bright,.045,.005);
    for(const v of[.815,.948])tube(bright,'engraved band border',Array.from({length:81},(_,i)=>shellPoint(style,i/80,v,.005)),.0021,100,true);
    for(let i=0;i<30;i++){
      const u=i/30,points=[[u-.009,.87],[u,.823],[u+.009,.87],[u,.923],[u-.009,.87]].map(([a,b])=>shellPoint(style,a,b,.0056));tube(engraving,'interlaced diamond engraving',points,.0015,16);
    }
    // One crowned nasal plate curves forward over the real modeled nose, with
    // an open cheek/eye silhouette. It grows from the brow rather than floats.
    const nose=(u,v,back=false)=>{const width=lerp(.048,.020,Math.min(1,v/.30))+.006*Math.sin(v*Math.PI),x=(u*2-1)*width,y=.194-v*.312,z=.171+.123*Math.sin(v*Math.PI*.79)-(back?.009:0)+.006*(1-(u*2-1)**2);return new THREE.Vector3(x,y,z);};
    surface(gold,'forged curved Viking noseguard',12,28,(u,v)=>nose(u,v),{flip:true});surface(inset,'noseguard inner face',12,28,(u,v)=>nose(u,v,true),{flip:false});
    for(const edge of[0,1])tube(bright,'nasal rolled edge',Array.from({length:25},(_,i)=>nose(edge,i/24)),.0026,30);
    tube(engraving,'nasal center engraving',Array.from({length:20},(_,i)=>nose(.5,.12+i/19*.76).add(new THREE.Vector3(0,0,.001))),.0013,24);
    for(let i=0;i<12;i++)stud(bright,(i+.5)/12,.974,.007);
    // Sunburst chased into the forehead: slim rays sit on the curved shell.
    const centerV=.52;
    for(let i=0;i<12;i++){const angle=i/12*TAU;const points=[.65,1].map(r=>shellPoint(style,Math.sin(angle)*.025*r,centerV+Math.cos(angle)*.090*r,.007));tube(engraving,'chased solar rays',points,.00145,4);}
    stud(bright,0,centerV,.016);
    const sparkleGeometry=own(new THREE.BufferGeometry()),p=[],ix=[];
    const star=[[0,.018],[.0028,.003],[.013,0],[.0028,-.003],[0,-.018],[-.0028,-.003],[-.013,0],[-.0028,.003]];
    p.push(0,0,0);for(const [x,y]of star)p.push(x,y,0);for(let i=0;i<8;i++)ix.push(0,i+1,(i+1)%8+1);sparkleGeometry.setAttribute('position',new THREE.Float32BufferAttribute(p,3));sparkleGeometry.setIndex(ix);sparkleGeometry.computeVertexNormals();sparkleGeometry.computeBoundingSphere();
    const sparkleMaterial=own(new THREE.MeshBasicMaterial({color:0xfff3c5,transparent:true,opacity:.80,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,toneMapped:false}));sparkleMaterial.name='restrained sunforged glints';
    for(const [i,[u,v]]of [[.04,.45],[-.10,.72],[.23,.52],[-.32,.60]].entries()){
      const mesh=new THREE.Mesh(sparkleGeometry,sparkleMaterial),position=shellPoint(style,u,v,.011),normal=new THREE.Vector3(Math.sin(u*TAU),.34,Math.cos(u*TAU)).normalize();mesh.name=`sunforged-glint-${i}`;mesh.position.copy(position);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),normal);mesh.visible=false;mesh.renderOrder=3;mesh.userData.cosmeticGlint=true;root.add(mesh);sparkles.push(mesh);
    }
  }
  // Consolidate rigid decoration by material, preserving the smooth normals of
  // the shaped surfaces. Each instance owns every resulting GPU resource.
  for(const [material,entries]of batches){
    const positions=[],normals=[],colors=[],uvs=[];
    for(const {g}of entries){const index=g.index,p=g.attributes.position,n=g.attributes.normal,c=g.attributes.color,uv=g.attributes.uv;
      for(let j=0;j<(index?.count??p.count);j++){const i=index?index.getX(j):j;positions.push(p.getX(i),p.getY(i),p.getZ(i));normals.push(n.getX(i),n.getY(i),n.getZ(i));colors.push(c?.getX(i)??1,c?.getY(i)??1,c?.getZ(i)??1);uvs.push(uv?.getX(i)??0,uv?.getY(i)??0);}
      owned.delete(g);g.dispose();
    }
    const geometry=own(new THREE.BufferGeometry());geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.computeBoundingBox();geometry.computeBoundingSphere();
    const mesh=new THREE.Mesh(geometry,material);mesh.name=`${id}: ${material.name}`;mesh.userData.details=[...new Set(entries.map(e=>e.name))];mesh.userData.sculpted=true;mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);
  }
  let disposed=false;
  function update(time=0,{reducedMotion=false}={}){
    if(disposed)return;
    const clock=Number.isFinite(time)?Math.max(0,time):0;
    for(let i=0;i<sparkles.length;i++){const phase=((clock+i*1.13)%5.7)/5.7,on=!reducedMotion&&phase<.085,pulse=on?Math.sin(phase/.085*Math.PI):0;sparkles[i].visible=on;sparkles[i].scale.setScalar(.35+pulse*.65);}
  }
  function dispose(){if(disposed)return;disposed=true;root.removeFromParent();for(const resource of owned)resource.dispose();owned.clear();root.clear();}
  return {parts:[{bone:'head',object:root,hideNames:[...COVER_NAMES]}],update,dispose};
}
