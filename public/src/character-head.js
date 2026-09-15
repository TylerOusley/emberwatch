import * as THREE from 'three';

// A single sculpted cranial surface carries the jaw, cheekbones, orbital rims,
// bridge, nose, lips and ears. Hair is a groomed shell with directional grooves;
// no facial landmark is constructed from a sphere or another visible primitive.
const TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;
const mix = THREE.MathUtils.lerp;
const gauss = (value, center, width) => Math.exp(-(((value - center) / width) ** 2));
const profile = [
  [-.247,.001,.001,-.025],[-.226,.097,.103,-.021],[-.19,.145,.151,-.021],
  [-.14,.193,.181,-.027],[-.08,.218,.197,-.031],[-.01,.230,.203,-.036],
  [.065,.234,.199,-.040],[.135,.229,.187,-.046],[.205,.192,.144,-.045],
  [.25,.125,.088,-.042],[.278,.001,.001,-.038],
];
function shapeAt(y) {
  let index = 0;
  while (index < profile.length - 2 && y > profile[index + 1][0]) index++;
  const a=profile[index], b=profile[index+1], before=profile[Math.max(0,index-1)], after=profile[Math.min(profile.length-1,index+2)];
  const t=clamp((y-a[0])/(b[0]-a[0]),0,1), t2=t*t, t3=t2*t;
  return [1,2,3].map(k => {
    const ma=(b[k]-before[k])/(b[0]-before[0]), mb=(after[k]-a[k])/(after[0]-a[0]);
    return (2*t3-3*t2+1)*a[k] + (t3-2*t2+t)*ma*(b[0]-a[0]) + (-2*t3+3*t2)*b[k] + (t3-t2)*mb*(b[0]-a[0]);
  });
}
function faceRelief(x,y,zombie=false) {
  let z=.023*gauss(x,0,.09)*gauss(y,-.188,.048);
  z+=.025*gauss(x,0,.087)*gauss(y,-.115,.038);
  for(const side of [-1,1]) {
    z+=(zombie?.012:.024)*gauss(x,side*.132,.055)*gauss(y,-.049,.042);
    z-=(zombie?.034:.024)*gauss(x,side*.092,.046)*gauss(y,.047,.027);
    z+=.019*gauss(x,side*.094,.060)*gauss(y,.094,.020);
    z+=.0045*gauss(x,side*.092,.046)*gauss(y,.071,.007);
    z-=.003*gauss(x,side*.092,.050)*gauss(y,.018,.007);
    z-=.006*gauss(x,side*.168,.041)*gauss(y,.079,.060);
    z+=.023*gauss(x,side*.036,.021)*gauss(y,-.067,.016);
    z-=.008*gauss(x,side*.033,.009)*gauss(y,-.077,.006);
    if(zombie) {
      z-=.038*gauss(x,side*.130,.05)*gauss(y,-.099,.043);
      z-=.006*gauss(x,side*.068,.010)*gauss(y,-.099,.039);
    }
  }
  z+=.040*gauss(x,0,.025)*gauss(y,.007,.078);
  z+=(zombie?.077:.094)*gauss(x,0,.031)*gauss(y,-.043,.032);
  z-=.006*gauss(x,0,.009)*gauss(y,-.101,.022);
  const bow=.005*(1-gauss(x,0,.023));
  z+=.009*gauss(x,0,.064)*gauss(y,-.125+bow,.009);
  z+=.011*gauss(x,0,.061)*gauss(y,-.146,.011);
  z-=.005*gauss(x,0,.072)*gauss(y,-.136+bow,.0038);
  return z;
}
function frontAt(x,y,zombie=false) {
  const [rx,rz,zc]=shapeAt(y), a=clamp(x/Math.max(.001,rx),-.999,.999);
  const c=Math.sqrt(1-a*a);
  return zc+rz*c+faceRelief(x,y,zombie)*Math.pow(c,3);
}
function meshSurface(parent,own,cols,rows,sample,material,{wrap=true,flip=false,name='sculpted detail'}={}) {
  const positions=[], colors=[], uv=[], indices=[];
  for(let j=0;j<=rows;j++) for(let i=0;i<=cols;i++) {
    const p=sample(i/cols,j/rows);
    positions.push(p.x,p.y,p.z); uv.push(i/cols,j/rows);
    const c=p.color || new THREE.Color(1,1,1); colors.push(c.r,c.g,c.b);
  }
  for(let j=0;j<rows;j++) for(let i=0;i<cols;i++) {
    const a=j*(cols+1)+i,b=a+cols+1;
    if(flip) indices.push(a,b,a+1,b,b+1,a+1); else indices.push(a,a+1,b,b,a+1,b+1);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2)); g.setIndex(indices); g.computeVertexNormals();
  if(wrap) {
    const normal=g.attributes.normal;
    for(let j=0;j<=rows;j++) {
      const a=j*(cols+1),b=a+cols;
      const n=new THREE.Vector3().fromBufferAttribute(normal,a).add(new THREE.Vector3().fromBufferAttribute(normal,b)).normalize();
      normal.setXYZ(a,n.x,n.y,n.z); normal.setXYZ(b,n.x,n.y,n.z);
    }
  }
  g.computeBoundingSphere(); own.add(g);
  const mesh=new THREE.Mesh(g,material); mesh.name=name; mesh.userData.sculpted=true;
  mesh.castShadow=true; mesh.receiveShadow=true; parent.add(mesh); return mesh;
}
function colorOf(value,fallback) {
  return value?.isMaterial ? value.color.clone() : new THREE.Color(value ?? fallback);
}
function mat(own,color,{metalness=0,roughness=.86,emissive=0}={}) {
  const m=new THREE.MeshStandardMaterial({color,vertexColors:true,metalness,roughness,emissive,emissiveIntensity:.3}); own.add(m); return m;
}

/** Rigid head attaches to the caller's animated head bone; every resource is owned. */
export function buildHead(headBone,{role='villager',variation=0,palette={},own=new Set()}={}) {
  const zombie=role==='zombie'; variation=Math.abs(Math.trunc(variation))%4;
  const skin=colorOf(palette.skin,zombie?[0x7f8b70,0x758574,0x92916e,0x6c8276][variation]:[0xd5a182,0xb98463,0xe3b691,0xa87559][variation]);
  const hair=colorOf(zombie?palette.zombieHair:(palette.hair ?? palette.beard),zombie?0x3f443a:[0x64442f,0x855c37,0xb5a082,0x493e35][variation]);
  const skinMat=mat(own,skin,{roughness:.84});
  const hairMat=mat(own,hair,{roughness:.92});
  const skinTint=(x,y,z) => {
    const warmth=.09*(gauss(x,.145,.055)+gauss(x,-.145,.055))*gauss(y,-.049,.05)+.08*gauss(x,0,.042)*gauss(y,-.06,.04);
    const eyeShade=(zombie?.27:.10)*(gauss(x,.092,.051)+gauss(x,-.092,.051))*gauss(y,.048,zombie?.040:.027);
    const lip=.08*gauss(x,0,.063)*gauss(y,-.137,.023);
    const shade=(1-eyeShade)*(z>0?1:.95);
    const color=new THREE.Color(shade,shade*(1-warmth-lip*.7),shade*(1-warmth*.9-lip));
    if(!zombie) {
      // Short growth on the cheeks blends the rooted beard into real skin.
      const cheekEdge=-.052-.089*gauss(x,0,.092);
      const growth=clamp((cheekEdge-y)/.035,0,1)*clamp((z+.09)/.13,0,1);
      const hairTint=new THREE.Color(hair.r/Math.max(.01,skin.r),hair.g/Math.max(.01,skin.g),hair.b/Math.max(.01,skin.b));
      color.lerp(hairTint,growth*.88);
    }
    return color;
  };
  meshSurface(headBone,own,72,44,(u,v)=>{
    const theta=u*TAU,y=mix(-.247,.278,v),[rx,rz,zc]=shapeAt(y),s=Math.sin(theta),c=Math.cos(theta);
    let x=rx*s, z=rz*c+zc;
    z+=faceRelief(x,y,zombie)*Math.pow(Math.max(0,c),3);
    // A continuous auricle grows from each side of the cranial mesh. Its concha
    // and helix are shallow relief on that same surface, never attached spheres.
    const sideWeight=Math.exp(-(((Math.abs(theta>Math.PI?theta-TAU:theta)-Math.PI/2)/.18)**2));
    const earProfile=gauss(y,-.027,.071);
    const earRim=.020*gauss(y,-.035,.078)-.013*gauss(y,-.018,.036);
    x+=Math.sign(s)*sideWeight*(.035*earProfile+earRim);
    z+=sideWeight*.007*gauss(y,-.016,.04);
    return {x,y,z,color:skinTint(x,y,z)};
  },skinMat,{name:'continuous sculpted face and skull'});

  // Almond-shaped eyes lie in the orbital depressions. The sclera, iris and
  // pupil share a colored surface; a narrow lid is part of the cranial relief.
  const eyeMat=mat(own,0xffffff,{roughness:.44,emissive:zombie?0x33220b:0});
  const eyeRimMat=mat(own,zombie?0x53604c:skin.clone().multiplyScalar(.63),{roughness:.9});
  for(const side of [-1,1]) {
    const cx=side*.092, cy=.047;
    for(const rim of [true,false]) meshSurface(headBone,own,rim?20:24,rim?4:8,(u,v)=>{
      const wide=rim?.046:.043, x=cx+(u*2-1)*wide;
      const arch=Math.pow(Math.sin(Math.PI*u),.78);
      const upper=arch*(rim?.0185:.016),lower=-arch*(rim?.0148:.0125);
      const y=cy+mix(lower,upper,v)+side*(x-cx)*-.065;
      const z=frontAt(x,y,zombie)+(rim?.0012:.0024)+.006*arch*Math.sin(Math.PI*v);
      let color=new THREE.Color(1,1,1);
      if(!rim) {
        const d=Math.hypot((x-cx)*1.08,(y-cy));
        color.set(zombie?0xbaa775:0xbcb8a4);
        if(d<.0106) color.set(zombie?0x8f692b:[0x635444,0x52645f,0x6a695b,0x524841][variation]);
        if(d<.0055) color.set(0x171b17);
        if(Math.hypot(x-cx+.003,y-cy-.004)<.0025) color.set(0xe7e6d8);
        color.multiplyScalar(.88+.12*Math.sin(Math.PI*v));
      }
      return {x,y,z,color};
    },rim?eyeRimMat:eyeMat,{wrap:false,name:rim?'inset orbital margin':'almond eye surface'});
    // Sculpted swept eyebrows follow the supraorbital ridge, with fine grooving.
    meshSurface(headBone,own,20,4,(u,v)=>{
      const x=side*(.041+.106*u), center=.100-.015*u+.004*Math.sin(Math.PI*u);
      const width=.009*Math.pow(Math.sin(Math.PI*u),.55), y=center+(v*2-1)*width;
      const ridge=Math.sin(Math.PI*v)*Math.pow(Math.sin(Math.PI*u),.5);
      return {x,y,z:frontAt(x,y,zombie)+.003+ridge*.009,color:new THREE.Color().setScalar(.8+.20*Math.cos(u*55+v*3)**2)};
    },hairMat,{wrap:false,flip:side<0,name:'swept eyebrow'});
  }
  // The mouth line is nestled between modeled upper and lower lips.
  const mouthMat=mat(own,zombie?0x384137:0x684a40,{roughness:.95});
  meshSurface(headBone,own,30,2,(u,v)=>{
    const x=(u*2-1)*(zombie?.062:.068);
    const y=zombie?-.147+(v-.5)*.034*Math.sin(Math.PI*u)+.009*u:-.136+.005*(1-gauss(x,0,.023))+(v-.5)*.0022*Math.sin(Math.PI*u);
    return {x,y,z:frontAt(x,y,zombie)+.0009};
  },mouthMat,{wrap:false,name:'recessed lip line'});

  const beardLength=role==='priest'?.49:.525;
  if(!zombie) {
    // One closed flowing beard volume, broad at the jaw and combed downwards.
    // Varying the sweep by azimuth forms overlapping-looking locks while the
    // geometry remains a continuous surface, with no beads or repeated cones.
    meshSurface(headBone,own,72,24,(u,v)=>{
      const theta=u*TAU,t=1-v,c=Math.cos(theta),s=Math.sin(theta);
      const front=Math.max(0,c), rootY=-.07-.08*front+.025*Math.max(0,-c);
      const y=mix(rootY,-beardLength,t);
      const body=Math.pow(Math.sin(Math.PI*(.13+.87*(1-t))),.58);
      const rx=.214*Math.pow(1-t,.64)+.027*Math.sin(Math.PI*t);
      const rz=.124*Math.pow(1-t,.62)+.025*Math.sin(Math.PI*t);
      const phase=theta*33 + t*3.5 + Math.sin(theta*3)*t*1.1;
      const furrow=(.0014*Math.cos(phase)+.0006*Math.cos(phase*2+theta))*(.25+.75*body)*Math.sin(Math.PI*t);
      const centerZ=.055+.052*Math.sin(t*Math.PI*.86);
      const twist=.010*Math.sin(t*3.2+variation*.7)*Math.sin(Math.PI*t);
      let x=s*(rx+furrow)+twist;
      let z=centerZ+c*(rz+furrow)+front*.014*Math.sin(Math.PI*t);
      // Roots follow the jaw surface precisely; the groom leaves that surface
      // gradually instead of reading as a separate beard-shaped bowl.
      const [rootRx,rootRz,rootZc]=shapeAt(rootY),rootX=rootRx*s;
      const rootZ=rootRz*c+rootZc+faceRelief(rootX,rootY)*Math.pow(front,3);
      const rootBlend=1-clamp(t/.18,0,1);
      x=mix(x,rootX,rootBlend);z=mix(z,rootZ+.001*front,rootBlend);
      const shade=.84+.10*(.5+.5*Math.cos(phase))+.035*Math.sin(theta*7+t*5);
      return {x,y,z,color:new THREE.Color(shade,shade*.985,shade*.96)};
    },hairMat,{name:'continuous combed beard'});
    // Each half of the moustache is a thin swept ribbon nestled into the beard,
    // rather than an independent ball. The part is narrow beneath the septum.
    for(const side of [-1,1]) meshSurface(headBone,own,24,6,(u,v)=>{
      const x=side*(.008+.146*u),cy=-.094-.032*u+.007*Math.sin(Math.PI*u);
      const width=.017*Math.pow(Math.sin(Math.PI*(.10+.88*u)),.65);
      const y=cy+(v*2-1)*width;
      const z=frontAt(x,y,zombie)+.009+.017*Math.sin(Math.PI*v)*Math.sin(Math.PI*(.10+.85*u));
      const shade=.80+.20*Math.cos(u*37+v*4)**2;
      return {x,y,z,color:new THREE.Color().setScalar(shade)};
    },hairMat,{wrap:false,flip:side<0,name:'combed moustache'});
  }

  // Back-swept scalp hair with a natural hairline. Its grooved surface follows
  // the cranium, with all strands sharing one flowing silhouette.
  meshSurface(headBone,own,56,16,(u,v)=>{
    const theta=u*TAU,c=Math.cos(theta);
    const hairline=(zombie?.238:.132)-(zombie?.315:.245)*(1-c)/2+.010*Math.sin(theta*3)+(zombie?.010*Math.sin(theta*9):0);
    const y=mix(.296,hairline,v),sampleY=clamp(y-.018,-.246,.277),[rx,rz,zc]=shapeAt(sampleY);
    const strand=theta*36+v*7+Math.sin(theta*2)*v*4, amount=.008+.003*Math.sin(strand);
    const edge=1-.12*gauss(v,1,.055)*(1+Math.sin(theta*29))*.5;
    const closeCrown=Math.sin(Math.min(1,v/.05)*Math.PI/2);
    const capCoverage=role==='villager'&&variation%2===1?clamp((y-(.146-.14*(1-c)/2))/.02,0,1):0;
    const tucked=1-capCoverage*.10;
    const x=Math.sin(theta)*(rx+amount)*edge*closeCrown*tucked,z=Math.cos(theta)*(rz+amount)*closeCrown*tucked+zc;
    const shade=.77+.17*Math.cos(strand)**2+.05*Math.cos(theta*5+v*3);
    return {x,y,z,color:new THREE.Color(shade,shade*.985,shade*.96)};
  },hairMat,{flip:true,name:'swept grooved scalp hair'});

  if(role==='guard') {
    const metal=mat(own,colorOf(palette.iron,0x63777a),{metalness:.68,roughness:.43});
    const trim=mat(own,colorOf(palette.brass,0xaaa080),{metalness:.63,roughness:.48});
    const helmetPoint=(u,v)=>{
      const theta=u*TAU,c=Math.cos(theta),s=Math.sin(theta);
      const cheek=.125*Math.exp(-(((Math.abs(theta>Math.PI?theta-TAU:theta)-1.32)/.30)**2));
      const bottom=.114-.145*(1-c)/2-cheek;
      const y=mix(.314,bottom,v),sy=clamp((y-.012)*.93,-.235,.277),[rx,rz,zc]=shapeAt(sy);
      const flared=.022+.008*v*v, ridge=.006*Math.cos(theta*2)**18*Math.sin(v*Math.PI*.8);
      const closeCrown=Math.sin(Math.min(1,v/.06)*Math.PI/2);
      return {x:s*(rx+flared+ridge)*closeCrown,y,z:c*(rz+flared+ridge)*closeCrown+zc,color:new THREE.Color().setScalar(.94+.06*Math.cos(theta*2))};
    };
    meshSurface(headBone,own,56,16,helmetPoint,metal,{flip:true,name:'forged helmet and cheek protection'});
    meshSurface(headBone,own,56,2,(u,v)=>{
      const p=helmetPoint(u,.957+.043*v); p.x*=1.008; p.z+=Math.cos(u*TAU)*.002; return p;
    },trim,{flip:true,name:'rolled helmet edge'});
  } else if(role==='priest') {
    const cloth=mat(own,colorOf(palette.cloth,0xb9ae91),{roughness:.98});
    const seam=mat(own,colorOf(palette.secondary,0x687665),{roughness:.96});
    const hoodPoint=(u,v)=>{
      const theta=u*TAU,c=Math.cos(theta),s=Math.sin(theta),front=Math.max(0,c);
      const bottom=-.315+.47*Math.pow(front,3.1),y=mix(.337,bottom,v);
      const closeCrown=Math.sin(Math.min(1,v/.05)*Math.PI/2);
      const crown=(y>.057?Math.sqrt(Math.max(0,1-((y-.057)/.283)**2)):.998)*closeCrown;
      const fold=(.005*Math.sin(theta*11+v*6)+.004*Math.cos(theta*6-v*4))*closeCrown;
      const x=s*(.278*crown+fold)*(.98+.02*v);
      const z=c*(.256*crown+fold)-.041-.008*v;
      return {x,y,z,color:new THREE.Color().setScalar(.91+.07*Math.cos(theta*11+v*6))};
    };
    meshSurface(headBone,own,56,20,hoodPoint,cloth,{flip:true,name:'draped linen hood'});
    meshSurface(headBone,own,56,3,(u,v)=>{
      const p=hoodPoint(u,.965+.035*v);p.x*=1.008;p.z+=Math.cos(u*TAU)*.002;
      return p;
    },seam,{flip:true,name:'cloth opening seam'});
  } else if(!zombie && variation%2===1) {
    const leather=mat(own,colorOf(palette.leather,0x6e5340),{roughness:.91});
    meshSurface(headBone,own,56,14,(u,v)=>{
      const theta=u*TAU,c=Math.cos(theta), y=mix(.312,.146-.14*(1-c)/2,v);
      const [rx,rz,zc]=shapeAt(clamp(y-.030,-.24,.277));
      const fold=.004*Math.sin(theta*7+v*3)*v,lean=.025*(1-v);
      const closeCrown=Math.sin(Math.min(1,v/.05)*Math.PI/2);
      return {x:Math.sin(theta)*(rx+.013+fold)*closeCrown+lean,y,z:Math.cos(theta)*(rz+.015+fold)*closeCrown+zc,color:new THREE.Color().setScalar(.9+.08*Math.cos(theta*7+v*3))};
    },leather,{flip:true,name:'soft stitched leather cap'});
  }
  return { headBottom:-.247,headTop:role==='priest'?.337:role==='guard'?.314:.30,beardBottom:zombie?null:-beardLength };
}
