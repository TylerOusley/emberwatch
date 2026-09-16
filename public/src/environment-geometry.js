import * as THREE from 'three';

// Original deterministic scenery meshes. Local coordinates keep gameplay
// anchors, resource pivots and instance transforms independent of artwork.
const randomFor=seed=>{let value=seed|0;return()=>{value=(Math.imul(value,1664525)+1013904223)|0;return(value>>>0)/4294967296;};};
const up=new THREE.Vector3(0,1,0);
function builder(){
  const positions=[],indices=[],colors=[];
  function vertex(p,c){const index=positions.length/3;positions.push(p.x,p.y,p.z);colors.push(c.r,c.g,c.b);return index;}
  const face=(a,b,c)=>indices.push(a,b,c);
  function tube(points,radius,endRadius,seed,segments=7,sides=7,tint='#ffffff'){
    const curve=new THREE.CatmullRomCurve3(points),phase=seed*.713,c=new THREE.Color(tint),rings=[];
    for(let row=0;row<=segments;row++){
      const t=row/segments,p=curve.getPoint(t),tangent=curve.getTangent(t).normalize();
      const axis=Math.abs(tangent.y)>.92?new THREE.Vector3(1,0,0):up;
      const right=new THREE.Vector3().crossVectors(tangent,axis).normalize(),front=new THREE.Vector3().crossVectors(right,tangent).normalize();
      const r=(radius+(endRadius-radius)*t)*(1+Math.sin(t*9+phase)*.035),ring=[];
      for(let side=0;side<sides;side++){
        const a=side/sides*Math.PI*2,flute=1+Math.sin(a*5+phase)*.09;
        ring.push(vertex(p.clone().addScaledVector(right,Math.cos(a)*r*flute).addScaledVector(front,Math.sin(a)*r*flute),c));
      }
      rings.push(ring);
      if(row)for(let side=0;side<sides;side++){const next=(side+1)%sides;face(rings[row-1][side],ring[side],ring[next]);face(rings[row-1][side],ring[next],rings[row-1][next]);}
    }
    for(const [row,invert]of[[0,true],[segments,false]]){const center=vertex(curve.getPoint(row/segments),c);for(let side=0;side<sides;side++){const a=rings[row][side],b=rings[row][(side+1)%sides];invert?face(center,a,b):face(center,b,a);}}
  }
  // Folded pointed leaves have real edges and a shallow central ridge, so
  // their silhouette stays fine without alpha textures or tiny shadow maps.
  function leaf(base,direction,length,width,roll,c){
    const d=direction.clone().normalize(),side=new THREE.Vector3().crossVectors(d,Math.abs(d.y)>.94?new THREE.Vector3(1,0,0):up).normalize().applyAxisAngle(d,roll);
    const normal=new THREE.Vector3().crossVectors(side,d).normalize(),mid=base.clone().addScaledVector(d,length*.46);
    const a=vertex(base,c),b=vertex(mid.clone().addScaledVector(side,width),c),tip=vertex(base.clone().addScaledVector(d,length),c),e=vertex(mid.clone().addScaledVector(side,-width),c),ridge=vertex(mid.clone().addScaledVector(normal,width*.24),c.clone().multiplyScalar(1.06));
    face(a,b,ridge);face(b,tip,ridge);face(tip,e,ridge);face(e,a,ridge);
  }
  function finish(name){const g=new THREE.BufferGeometry();g.name=name;g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setIndex(indices);g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();return g;}
  return {tube,leaf,finish};
}

export function createOrganicTreeGeometry(seed=1,{pine,height,detail=1}={}){
  const density=Number.isFinite(detail)?Math.max(.45,Math.min(1,detail)):1;
  const random=randomFor(seed),conifer=pine??random()>.47,h=height??4.8+random()*3.9;
  const trunk=builder(),leaves=builder(),bend=(random()-.5)*h*.075,twist=random()*Math.PI*2;
  const center=t=>new THREE.Vector3(Math.sin(t*1.6)*bend,t*h,Math.sin(t*2.2+twist)*bend*.55*t);
  trunk.tube([center(0),center(.30),center(.64),center(conifer?1:.82)],h*.031,h*.003,seed,9,8);
  for(let i=0;i<5;i++){
    const a=i*Math.PI*2/5+twist,p=new THREE.Vector3(Math.cos(a)*h*.09,.025,Math.sin(a)*h*.09);
    trunk.tube([p,p.clone().multiplyScalar(.60).setY(.07),center(.045)],h*.008,h*.031,seed+i,3,5);
  }
  if(conifer){
    for(let tier=0;tier<8;tier++){
      const t=.29+tier*.083,branches=6-(tier>5?1:0),spread=h*(.275-tier*.027);
      for(let branch=0;branch<branches;branch++){
        const a=twist+branch/branches*Math.PI*2+tier*1.61+(random()-.5)*.24,start=center(t);
        const dir=new THREE.Vector3(Math.cos(a),0,Math.sin(a)),length=spread*(.80+random()*.35);
        const tip=start.clone().addScaledVector(dir,length);tip.y+=h*(.005+random()*.04);
        const mid=start.clone().lerp(tip,.55);mid.y-=h*.028;
        trunk.tube([start,mid,tip],h*.008*(1-tier*.065),.008,seed+branch+tier*7,density<.9?2:3,4);
        const sprays=Math.round(3*density),needles=density<.9?2:3;
        for(let spray=0;spray<sprays;spray++){
          const q=(spray+.6)/sprays,base=mid.clone().lerp(tip,Math.max(0,(q-.45)/.55));if(q<.45)base.copy(start).lerp(mid,q/.45);
          const sprayLength=h*(.13-tier*.010)*(1-q*.45);
          for(const side of [-1,1])for(let needle=0;needle<needles;needle++){
            const na=a+side*(.32+needle/(needles-1)*.72),d=new THREE.Vector3(Math.cos(na),.05+random()*.34,Math.sin(na));
            const c=new THREE.Color().setHSL(.285+random()*.025,.26+random()*.19,.18+random()*.12);
            // A folded blade represents a dense spray of small needles. Its
            // broader footprint keeps a full canopy at normal camera distance
            // without spending thousands of triangles on individual needles.
            leaves.leaf(base.clone().addScaledVector(dir,needle*.014*h),d,sprayLength*(.76+random()*.40),h*(.021+random()*.008),random()*.8-.4,c);
          }
        }
      }
    }
    for(let i=0;i<20;i++){const a=i*2.4;leaves.leaf(center(.88+random()*.09),new THREE.Vector3(Math.cos(a),1.8,Math.sin(a)),h*.08,h*.014,a,new THREE.Color('#648157'));}
  }else{
    for(let branch=0;branch<9;branch++){
      const a=branch*2.399+twist,t=.38+branch*.037,start=center(t),length=h*(.21+random()*.10);
      const tip=new THREE.Vector3(Math.cos(a)*length,h*(.72+random()*.16),Math.sin(a)*length),mid=start.clone().lerp(tip,.54);mid.y-=h*.055;
      trunk.tube([start,mid,tip],h*.016*(1-branch*.045),h*.004,seed+branch,6,6);
      for(let twig=0;twig<3;twig++){
        const ta=a+(twig-1)*.63,root=mid.clone().lerp(tip,.48+twig*.17),end=root.clone().add(new THREE.Vector3(Math.cos(ta)*h*.092,h*(.055+random()*.055),Math.sin(ta)*h*.092));
        trunk.tube([root,root.clone().lerp(end,.55).add(new THREE.Vector3(0,h*.02,0)),end],h*.005,.006,seed+branch*3+twig,3,4);
        const cluster=end.clone().add(new THREE.Vector3(0,h*.015,0));
        for(let leaf=0;leaf<Math.round(25*density);leaf++){
          const az=random()*Math.PI*2,cy=random()*2-1,radius=Math.cbrt(random()),horizontal=Math.sqrt(1-cy*cy);
          const offset=new THREE.Vector3(Math.cos(az)*horizontal*h*.135*radius,cy*h*.10*radius,Math.sin(az)*horizontal*h*.135*radius);
          const c=new THREE.Color().setHSL(.22+random()*.085,.33+random()*.22,.25+random()*.16);
          leaves.leaf(cluster.clone().add(offset),new THREE.Vector3(Math.cos(az),.15+(random()-.5)*1.4,Math.sin(az)),h*(.055+random()*.034),h*(.024+random()*.016),random()*Math.PI,c);
        }
      }
    }
  }
  return {trunk:trunk.finish('organic-tapered-tree-branches'),foliage:leaves.finish(conifer?'individual-conifer-shoots':'individual-broadleaf-canopy'),height:h,pine:conifer};
}

export function createWheatGeometry(seed=1){
  const random=randomFor(seed),stems=builder(),ears=builder(),gold=new THREE.Color('#b8a45f');
  for(let i=0;i<5;i++){
    const x=(random()-.5)*.32,z=(random()-.5)*.32,h=.66+random()*.25,a=random()*Math.PI*2,lean=.05+random()*.07;
    const tip=new THREE.Vector3(x+Math.cos(a)*lean,h,z+Math.sin(a)*lean);
    stems.tube([new THREE.Vector3(x,0,z),new THREE.Vector3(x,h*.45,z),tip],.013,.007,seed+i,5,5,gold);
    for(let j=0;j<3;j++){
      const t=.25+j*.18,start=new THREE.Vector3(x,h*t,z),angle=a+j*2.4;
      stems.leaf(start,new THREE.Vector3(Math.cos(angle),.65-j*.16,Math.sin(angle)),.22-j*.022,.023,angle,gold);
    }
    for(let row=0;row<6;row++)for(const side of [-1,1]){
      const start=tip.clone().add(new THREE.Vector3(0,row*.028,0)),angle=a+side*Math.PI/2;
      const dir=new THREE.Vector3(Math.cos(angle)*.5,1,Math.sin(angle)*.5),c=new THREE.Color(row%2?'#d5bd75':'#e3ce8b');
      ears.leaf(start,dir,.082,.022,row*.6,c);
      ears.leaf(start.clone().addScaledVector(dir,.05),dir,.13,.002,angle,c);
    }
  }
  return {stems:stems.finish('bending-wheat-stalks'),ears:ears.finish('wheat-grains-and-awns')};
}

export function createWeatheredRockGeometry(seed=1,{detail=2}={}){
  const g=new THREE.IcosahedronGeometry(1,Math.max(1,Math.min(3,detail|0))),p=g.attributes.position,phase=seed*.031;
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
    const erode=1+.13*Math.sin(x*5.1+phase)*Math.cos(z*4.7-phase)+.065*Math.sin(y*9+z*3+phase);
    p.setXYZ(i,x*erode,Math.max(-.72,y*(.82+.065*Math.sin(x*7+phase)))*erode,z*erode);
  }
  g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();g.name='weathered-natural-boulder';return g;
}

// Smooth broad ridgelines with subsidiary spurs and eroded gullies. Height
// stays within [-.5,.5], matching the old backdrop instance height envelope.
export function createMountainGeometry(seed=1,segments=24){
  const random=randomFor(seed),ridges=Array.from({length:5},(_,i)=>({x:(random()-.5)*.95,z:(random()-.5)*.9,sx:.20+random()*.40,sz:.25+random()*.43,h:i? .45+random()*.5:1}));
  const positions=[],colors=[],indices=[],values=[];let highest=0;
  for(let iz=0;iz<=segments;iz++)for(let ix=0;ix<=segments;ix++){
    const x=ix/segments*2-1,z=iz/segments*2-1,r=Math.sqrt(x*x+z*z),rim=Math.pow(Math.max(0,1-r*r),.9);
    let y=0;for(const ridge of ridges)y+=ridge.h*Math.exp(-((x-ridge.x)**2/ridge.sx+(z-ridge.z)**2/ridge.sz)*2.3);
    const erosion=1+.095*Math.sin(x*15+z*4+seed)*Math.sin(z*13-x*5)+.035*Math.sin(x*36-z*19+seed);
    y*=rim*erosion;values.push({x,z,y});highest=Math.max(highest,y);
  }
  for(const {x,z,y}of values){
    const h=y/highest,c=new THREE.Color('#788c70').lerp(new THREE.Color('#a6aba0'),Math.min(1,h*1.2));
    c.multiplyScalar(.94+.06*Math.sin(x*15+z*8+seed));positions.push(x,h-.5,z);colors.push(c.r,c.g,c.b);
  }
  for(let z=0;z<segments;z++)for(let x=0;x<segments;x++){const a=z*(segments+1)+x,b=a+segments+1;indices.push(a,b,a+1,b,b+1,a+1);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setIndex(indices);g.computeVertexNormals();g.computeBoundingSphere();g.userData.distantMountain=true;g.name='eroded-rolling-mountain-ridges';return g;
}

export function createBeveledBlockGeometry(){
  const bevel=.018,shape=new THREE.Shape();shape.moveTo(-.5+bevel,-.5+bevel);shape.lineTo(.5-bevel,-.5+bevel);shape.lineTo(.5-bevel,.5-bevel);shape.lineTo(-.5+bevel,.5-bevel);shape.closePath();
  const g=new THREE.ExtrudeGeometry(shape,{depth:1-bevel*2,bevelEnabled:true,bevelSize:bevel,bevelThickness:bevel,bevelSegments:1,steps:1});g.translate(0,0,-.5+bevel);g.name='chamfered-building-block';return g;
}
