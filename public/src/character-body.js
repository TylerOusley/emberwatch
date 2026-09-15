import * as THREE from 'three';

// A single deformable skin surface for the exposed anatomy. The field blends
// forearms, palms, knuckles and fingers before meshing, so wrists have no seams.
// Clothed areas are intentionally omitted underneath the tailored garments.
const cache = new Map();
const smoothstep = (a,b,x) => { const t=THREE.MathUtils.clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); };
const blend = (a,b,k=.022) => { const h=Math.max(k-Math.abs(a-b),0)/k;return Math.min(a,b)-h*h*k*.25; };
function ellipsoid(x,y,z,cx,cy,cz,rx,ry,rz) {
  x-=cx;y-=cy;z-=cz;
  const k0=Math.hypot(x/rx,y/ry,z/rz), k1=Math.hypot(x/(rx*rx),y/(ry*ry),z/(rz*rz));
  return k1 ? k0*(k0-1)/k1 : -Math.min(rx,ry,rz);
}
function capsule(x,y,z,a,b,r) {
  const vx=b[0]-a[0],vy=b[1]-a[1],vz=b[2]-a[2];
  const t=THREE.MathUtils.clamp(((x-a[0])*vx+(y-a[1])*vy+(z-a[2])*vz)/(vx*vx+vy*vy+vz*vz),0,1);
  return Math.hypot(x-a[0]-vx*t,y-a[1]-vy*t,z-a[2]-vz*t)-r;
}
// Marching tetrahedra uses a consistent cell diagonal. Gradient normals retain
// the continuous field's surface instead of revealing the construction grid.
function surface(field,min,max,step,positions,normals) {
  const size=max.map((v,i)=>Math.ceil((v-min[i])/step)+1),[nx,ny,nz]=size;
  const spacing=max.map((v,i)=>(v-min[i])/(size[i]-1));
  const values=new Float32Array(nx*ny*nz), point=(x,y,z)=>[min[0]+x*spacing[0],min[1]+y*spacing[1],min[2]+z*spacing[2]];
  const index=(x,y,z)=>x+nx*(y+ny*z);
  for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++)values[index(x,y,z)]=field(...point(x,y,z));
  const corners=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
  const tetra=[[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]], eps=.0005;
  function vertex(a,b,va,vb) {
    const t=va/(va-vb), p=a.map((v,i)=>v+(b[i]-v)*t);
    const [x,y,z]=p;
    const n=[field(x+eps,y,z)-field(x-eps,y,z),field(x,y+eps,z)-field(x,y-eps,z),field(x,y,z+eps)-field(x,y,z-eps)];
    const length=Math.hypot(...n)||1;return {p,n:n.map(v=>v/length)};
  }
  function tri(a,b,c) {
    const ab=b.p.map((v,i)=>v-a.p[i]),ac=c.p.map((v,i)=>v-a.p[i]);
    const cross=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
    if(Math.hypot(...cross)<1e-11)return;
    if(cross.reduce((v,n,i)=>v+n*(a.n[i]+b.n[i]+c.n[i]),0)<0)[b,c]=[c,b];
    for(const v of [a,b,c]){positions.push(...v.p);normals.push(...v.n);}
  }
  for(let z=0;z<nz-1;z++)for(let y=0;y<ny-1;y++)for(let x=0;x<nx-1;x++) {
    const vs=corners.map(([cx,cy,cz])=>values[index(x+cx,y+cy,z+cz)]);
    if(vs.every(v=>v>=0)||vs.every(v=>v<0))continue;
    const ps=corners.map(([cx,cy,cz])=>point(x+cx,y+cy,z+cz));
    for(const t of tetra) {
      const inside=t.filter(i=>vs[i]<0),outside=t.filter(i=>vs[i]>=0);
      if(!inside.length||!outside.length)continue;
      const edge=(a,b)=>vertex(ps[a],ps[b],vs[a],vs[b]);
      if(inside.length===1){const a=inside[0];tri(...outside.map(b=>edge(a,b)));}
      else if(outside.length===1){const b=outside[0];tri(...inside.map(a=>edge(a,b)));}
      else {const[a,b]=inside,[c,d]=outside,ac=edge(a,c),ad=edge(a,d),bc=edge(b,c),bd=edge(b,d);tri(ac,ad,bc);tri(ad,bd,bc);}
    }
  }
}

function anatomy(zombie) {
  if(cache.has(zombie))return cache.get(zombie);
  const positions=[],normals=[],bodyY=zombie?1.10:1.04,armX=zombie?.35:.48;
  for(const side of [-1,1]) {
    const ax=side*armX;
    function field(x,y,z) {
      x=(x-ax)*side;y-=bodyY;
      let d=ellipsoid(x,y,z,0,.17,0,.113,.24,.109);
      d=blend(d,ellipsoid(x,y,z,-.009,-.055,0,.096,.15,.087),.035);
      d=blend(d,ellipsoid(x,y,z,-.008,-.18,.008,.075,.14,.066),.034);
      d=blend(d,ellipsoid(x,y,z,0,-.325,.035,.079,.105,.052),.03);
      // The finger chains curl into a loose tool grip rather than mitten balls.
      for(let i=0;i<4;i++) {
        const fx=-.054+i*.034, drop=i===3?.008:0;
        const a=[fx,-.363+drop,.025],b=[fx,-.414+drop,.047],c=[fx,-.410+drop,.108],e=[fx,-.377+drop,.124];
        d=blend(d,capsule(x,y,z,a,b,.018),.016);
        d=blend(d,capsule(x,y,z,b,c,.0165),.012);
        d=blend(d,capsule(x,y,z,c,e,.015),.01);
      }
      d=blend(d,ellipsoid(x,y,z,-.06,-.30,.044,.045,.06,.037),.028);
      d=blend(d,capsule(x,y,z,[-.086,-.31,.06],[-.085,-.345,.112],.023),.018);
      d=blend(d,capsule(x,y,z,[-.085,-.345,.112],[-.05,-.356,.139],.021),.015);
      return d;
    }
    // The upper arm is inside a sleeve. End the skin under its cuff instead of
    // spending triangles on invisible anatomy all the way to the shoulder.
    surface(field,[ax-.15,bodyY-.452,-.125],[ax+.15,bodyY+.065,.177],.022,positions,normals);
  }
  const armEnd=positions.length;
  // Neck tapers into the head and disappears beneath the open shirt collar.
  surface((x,y,z)=>blend(ellipsoid(x,y,z,0,bodyY+.55,-.015,.148,.23,.119),ellipsoid(x,y,z,0,bodyY+.38,-.012,.23,.14,.15),.04),[-.17,bodyY+.48,-.145],[.17,bodyY+.79,.14],.035,positions,normals);
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
  const indices=[],weights=[];
  // Index order is shared by every instance; each actor gets its own skeleton.
  for(let i=0;i<positions.length;i+=3) {
    const x=positions[i],y=positions[i+1]-bodyY;
    if(i>=armEnd) {
      const h=smoothstep(.55,.73,y);indices.push(0,1,0,0);weights.push(1-h,h,0,0);
    } else {
      const right=x<0,upper=right?3:2,fore=right?5:4;
      const f=1-smoothstep(-.02,.07,y),shoulder=smoothstep(.30,.43,y);
      const hand=right?1-smoothstep(-.29,-.21,y):0;
      indices.push(0,upper,fore,right?6:fore);
      weights.push(shoulder,(1-shoulder)*(1-f),(1-shoulder)*f*(1-hand),(1-shoulder)*f*hand);
    }
  }
  g.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(indices,4));
  g.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
  g.computeBoundingSphere();cache.set(zombie,g);return g;
}

export function buildBody(visual,rig,{skin,own}) {
  const bones=[rig.body,rig.head,rig.leftArm,rig.rightArm,rig.leftFore,rig.rightFore,rig.hand];
  visual.updateWorldMatrix(true,true);
  const skeleton=new THREE.Skeleton(bones);own.add(skeleton);
  const mesh=new THREE.SkinnedMesh(anatomy(rig.zombie),skin);
  mesh.name='Continuous exposed anatomy';mesh.castShadow=true;mesh.receiveShadow=true;
  // Bone movement can exceed the bind-pose bounds during a strike or fall.
  mesh.frustumCulled=false;visual.add(mesh);mesh.bind(skeleton);mesh.userData.sculpted=true;
  return mesh;
}
