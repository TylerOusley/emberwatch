import * as THREE from 'three';
import { BUILDINGS, WALLS, ROAD, GUARD_ROAD, RESOURCES, PLOTS, WORLD_BOUNDS, plotFront, seeded, CAVE_AREAS, groundHeight, caveAreaAt } from '/shared/world.js';
import { createPlotsWorld, mineralOutcropGeometry, mineralBedGeometry } from './plots-world.js';

// Original procedural artwork. Everything is drawn from simple, authored geometry;
// no downloaded models or textures are required to explore the village.
export function createWorld(scene) {
  const root = new THREE.Group(); root.name = 'Emberwatch • world'; scene.add(root);
  const resources = new Map(), flickers = [], wind = [], lanterns = [];
  const resourceEffects=createResourceEffects(root);
  const rng = seeded(9153);
  const color = (c) => new THREE.Color(c);
  const mat = (c, extra = {}) => new THREE.MeshStandardMaterial({color:c, roughness:.93, ...extra});
  const M = {
    stone:mat('#7c867a'), stoneLight:mat('#a4aa94'), stoneDark:mat('#535e58'), mortar:mat('#555e55'), moss:mat('#5d7546'),
    plaster:mat('#d8c495'), plasterPale:mat('#e4d2ad'), wood:mat('#65472d'), woodDark:mat('#382d26'), woodLight:mat('#aa8051'),
    roof:mat('#315b61'), roofDark:mat('#25484f'), roofLight:mat('#44777a'), copper:mat('#9d6745'), iron:mat('#344047',{metalness:.25}),
    glass:mat('#efbb62',{emissive:'#d58532',emissiveIntensity:.4,roughness:.35}), leaf:mat('#5d803d'), leafLight:mat('#83a24b'),
    pine:mat('#385e44'), pineLight:mat('#517748'), bark:mat('#655440'), wheat:mat('#d9b452'), wheatTip:mat('#f0d782'),
    dirt:mat('#705d3f'), fabric:mat('#ac6249'), fabricLight:mat('#dfbd7e'), blue:mat('#416c79'), purple:mat('#766080'),
    water:mat('#648c8c',{roughness:.2,metalness:.25}), embers:mat('#f6c971',{emissive:'#ff9b36',emissiveIntensity:1.3}),
    geology:mat('#ffffff',{vertexColors:true,roughness:.98}),
    mountain:mat('#7b9386',{flatShading:true}), mountainLight:mat('#95a596',{flatShading:true})
  };
  const boxG = new THREE.BoxGeometry(1,1,1), cylinderG = new THREE.CylinderGeometry(1,1,1,8), coneG = new THREE.ConeGeometry(1,1,7);
  const sphereG = new THREE.IcosahedronGeometry(1,0), dummy = new THREE.Object3D();
  const batches = new Map(),caveOccluders=[];let mountainG;
  function batch(geo,material,x,y,z,sx=1,sy=1,sz=1,rx=0,ry=0,rz=0) {
    const caveOccluder=geo===mountainG&&Math.abs(x)<55&&z<-140;
    const key=geo.uuid+material.uuid+(caveOccluder?':cave':'');
    if(!batches.has(key)) batches.set(key,{geo,material,transforms:[],caveOccluder});
    dummy.position.set(x,y,z);dummy.scale.set(sx,sy,sz);dummy.rotation.set(rx,ry,rz);dummy.updateMatrix();
    batches.get(key).transforms.push(dummy.matrix.clone());
  }
  function box(material,x,y,z,w,h,d,ry=0,rz=0){batch(boxG,material,x,y,z,w,h,d,0,ry,rz);}
  function mesh(geo,material,parent=root,x=0,y=0,z=0,sx=1,sy=1,sz=1) {
    const o=new THREE.Mesh(geo,material);o.position.set(x,y,z);o.scale.set(sx,sy,sz);o.castShadow=true;o.receiveShadow=true;parent.add(o);return o;
  }
  function localBox(parent,material,x,y,z,w,h,d) {return mesh(boxG,material,parent,x,y,z,w,h,d);}
  function cylinder(material,x,y,z,r,h){batch(cylinderG,material,x,y,z,r,h,r);}
  function beam(material,a,b,width=.18,depth=width){
    const av=new THREE.Vector3(...a), bv=new THREE.Vector3(...b), mid=av.clone().add(bv).multiplyScalar(.5),dir=bv.clone().sub(av);
    dummy.position.copy(mid);dummy.scale.set(width,dir.length(),depth);dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),dir.normalize());dummy.updateMatrix();
    const key=boxG.uuid+material.uuid;if(!batches.has(key))batches.set(key,{geo:boxG,material,transforms:[]});batches.get(key).transforms.push(dummy.matrix.clone());
  }
  function canvasTexture(draw,w=512,h=512){const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;draw(canvas.getContext('2d'),w,h);const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;return t;}
  const cobbles=canvasTexture((ctx,w,h)=>{
    const r=seeded(801);ctx.fillStyle='#756f5c';ctx.fillRect(0,0,w,h);
    for(let row=0;row<12;row++)for(let col=-1;col<9;col++){
      const x=col*64+(row%2)*32,y=row*43,shade=130+Math.floor(r()*30);
      ctx.fillStyle=`rgb(${shade+10},${shade+8},${shade-5})`;ctx.beginPath();ctx.roundRect(x+2+r()*3,y+3,56+r()*4,34+r()*4,7);ctx.fill();
      ctx.strokeStyle='rgba(220,218,186,.24)';ctx.lineWidth=2;ctx.stroke();
    }
    for(let i=0;i<2500;i++){ctx.fillStyle=r()>.5?'rgba(255,244,185,.035)':'rgba(38,47,23,.04)';ctx.fillRect(r()*w,r()*h,2,2);}
  });cobbles.wrapS=cobbles.wrapT=THREE.RepeatWrapping;cobbles.anisotropy=4;
  const roadMat=mat('#f0e3c6',{map:cobbles});

  // Broad, softly faceted ground under a flat play area.
  const groundG=new THREE.PlaneGeometry(540,460,90,78);groundG.rotateX(-Math.PI/2);
  const gp=groundG.attributes.position, gc=[];
  for(let i=0;i<gp.count;i++){
    const x=gp.getX(i),z=gp.getZ(i),outside=Math.max(0,Math.abs(x)-118,-z-151,z-135);
    gp.setY(i,-.14+Math.sin(x*.05)*Math.cos(z*.043)*Math.min(outside*.09,4));
    const n=rng(),c=color(n>.72?'#82975c':n>.34?'#728b50':'#657d49');c.multiplyScalar(.94+rng()*.12);gc.push(c.r,c.g,c.b);
  }
  groundG.setAttribute('color',new THREE.Float32BufferAttribute(gc,3));groundG.computeVertexNormals();
  const carvedGround=carveGroundForCave(groundG);groundG.dispose();
  const ground=mesh(carvedGround,mat('#ffffff',{vertexColors:true,flatShading:true}));ground.name='village-terrain';ground.castShadow=false;

  const lanes=[];
  function road(points,width=7,y=.014){
    const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(p.x,y,p.z)),false,'centripetal');
    const len=curve.getLength(),steps=Math.ceil(len*2),pos=[],uv=[],indices=[];
    for(let i=0;i<=steps;i++){
      const t=i/steps,p=curve.getPoint(t),tan=curve.getTangent(t),nx=tan.z,nz=-tan.x;
      pos.push(p.x+nx*width/2,y+groundHeight(p.x+nx*width/2,p.z+nz*width/2),p.z+nz*width/2,p.x-nx*width/2,y+groundHeight(p.x-nx*width/2,p.z-nz*width/2),p.z-nz*width/2);uv.push(0,t*len/5,width/5,t*len/5);
      if(i<steps){let j=i*2;indices.push(j,j+1,j+2,j+1,j+3,j+2);}
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();
    const o=mesh(g,roadMat);o.castShadow=false;
    // Edging is placed after every lane and paved square is known, so no
    // curb continues across the mouth of a junction or a plot access path.
    lanes.push({curve,width,geometry:g});return curve;
  }
  const mainRoad=road([...ROAD].reverse(),7.2);
  // The Watch faces the central street. Existing route waypoints beyond its
  // forecourt remain stable so guards in saved villages continue their patrol.
  road(GUARD_ROAD.slice(0,3),2.2);
  road([{x:0,z:8},{x:-10.7,z:8}],2.8);
  road([{x:0,z:7},{x:9.2,z:7}],2.8);
  road([{x:0,z:-14},{x:16.1,z:-14}],3.2);
  road([{x:0,z:-23},{x:-11.5,z:-23}],3.2);
  road([{x:0,z:-35},{x:16.5,z:-35}],2.5);
  road([{x:0,z:-34},{x:-13,z:-34},{x:-17,z:-39},{x:-20.6,z:-39}],2.2);
  // Neighborhood streets connect every deed to the square and the single gate.
  for(const side of [-1,1]){
    for(const x of [39,61])road([{x:side*x,z:14},{x:side*x,z:-129.4}],3.4);
    road([{x:0,z:14},{x:side*39,z:14},{x:side*61,z:14}],3);
    road([{x:0,z:-60},{x:side*39,z:-60},{x:side*61,z:-60}],3);
    road([{x:0,z:-113},{x:side*23,z:-113},{x:side*23,z:-123.5},{x:side*28,z:-127},{x:side*39,z:-127},{x:side*61,z:-129.4}],2.2);
  }
  road([{x:0,z:-30},{x:12,z:-30},{x:12,z:-60},{x:0,z:-60}],2.6);
  road([{x:0,z:-60},{x:0,z:-129.4}],3.6);
  road([{x:0,z:-66},{x:12.4,z:-66}],2.8);
  road([{x:0,z:-67},{x:-11.4,z:-67}],2.8);
  for(const plot of PLOTS){
    const front=plotFront(plot),side=plot.x<0?-1:1;
    if(!plot.outside)road([{x:side*(Math.abs(plot.x)>60?61:39),z:plot.z},front],1.8);
    else {
      const nearest=ROAD.reduce((best,p)=>Math.hypot(p.x-front.x,p.z-front.z)<Math.hypot(best.x-front.x,best.z-front.z)?p:best);
      road([front,{x:nearest.x,z:front.z},{x:nearest.x,z:nearest.z}],1.55);
    }
  }
  root.userData.lanes=lanes;
  // Paved square around the communal well, completely outside the central lane.
  const paving=mesh(new THREE.CircleGeometry(5.7,16),roadMat,root,8,.018,-4);paving.rotation.x=-Math.PI/2;
  const marketPaving=mesh(new THREE.CircleGeometry(8,20),roadMat,root,0,.019,-66);marketPaving.rotation.x=-Math.PI/2;marketPaving.castShadow=false;
  paving.updateMatrix();marketPaving.updateMatrix();
  for(const edge of createRoadEdging(lanes,[paving,marketPaving])){
    box(edge.index%4?M.stone:M.moss,edge.x,.045+groundHeight(edge.x,edge.z),edge.z,.38,.13,.88,edge.yaw);
  }

  // Mountain shoulders shelter the keep; silhouettes stay outside playable bounds.
  mountainG=new THREE.ConeGeometry(1,1,6);
  for(let i=0;i<31;i++){
    const x=-175+i*12,z=-178-rng()*30,h=23+rng()*43;
    batch(mountainG,i%3?M.mountain:M.mountainLight,x,h/2-3,z,18+rng()*12,h,18+rng()*15,0,rng()*Math.PI,0);
    if(i%4===0)batch(mountainG,M.stoneLight,x,h*.83-3,z,6.4,h*.34,6.4,0,.2,0);
  }
  for(const side of [-1,1])for(let i=0;i<10;i++)batch(mountainG,M.mountain,side*(148+rng()*35),13+rng()*7,-135+i*26,16+rng()*20,29+rng()*24,20+rng()*18,0,rng()*3,0);

  function masonry(x,z,w,h,d){
    box(M.mortar,x,h/2,z,w,h,d);
    for(let row=0;row<Math.floor(h/.7);row++){
      const by=.35+row*.7;
      for(let j=0;j<Math.ceil(w/1.65);j++){
        const bw=Math.min(1.57,w-j*1.65),bx=x-w/2+j*1.65+bw/2;
        if(bw>.08){box((row+j)%7===0?M.moss:(row+j)%3?M.stone:M.stoneLight,bx,by,z+d/2+.02,bw,.64,.12);box(M.stone,bx,by,z-d/2-.02,bw,.64,.12);}
      }
    }
    box(M.stoneLight,x,h+.08,z,w+.2,.26,d+.18);
  }
  for(const w of WALLS){
    const height=4.7;box(M.stoneDark,w.x,.35,w.z,w.w+.18,.7,w.d+.18);box(M.stone,w.x,height/2,w.z,w.w,height,w.d);
    box(M.stoneLight,w.x,height,w.z,w.w+.18,.32,w.d+.18);
    const horizontal=w.w>w.d,length=horizontal?w.w:w.d;
    for(let i=0;i<length/2;i++){
      const p=-length/2+1+i*2;box(i%7===0?M.moss:M.stoneLight,w.x+(horizontal?p:0),height+.6,w.z+(horizontal?0:p),horizontal?1: w.w+.05,.9,horizontal?w.d+.05:1);
    }
    for(let j=0;j<length/4;j++){
      const p=-length/2+2+j*4;box(M.stoneDark,w.x+(horizontal?p:0),2,w.z+(horizontal?0:p),horizontal?.44:w.w+.15,3.8,horizontal?w.d+.15:.44);
    }
    // Narrow horizontal courses catch the low evening light.
    for(const y of [1.1,2.1,3.1])box(M.stoneDark,w.x,y,w.z,w.w+.025,.055,w.d+.025);
  }
  function turret(x,z,w=4.4,d=4.8,h=8.5,roof=true){
    masonry(x,z,w,h,d);
    for(const dx of [-1,1])for(const dz of [-1,1])box(M.stoneLight,x+dx*(w/2-.24),h/2,z+dz*(d/2-.22),.48,h,.45);
    for(let k=0;k<3;k++){const a=x-w/2+.5+k*(w-1)/2;box(M.stoneLight,a,h+.7,z+d/2,.75,.85,.75);box(M.stoneLight,a,h+.7,z-d/2,.75,.85,.75);}
    if(roof){
      const rg=new THREE.ConeGeometry(w*.86,3,4);rg.rotateY(Math.PI/4);mesh(rg,M.roof,root,x,h+2.1,z,1,1,d/w);
      cylinder(M.woodDark,x,h+4.1,z,.065,1.4);banner(x+.45,h+4.0,z,1,.72,M.fabric);
    }
    for(const dz of [-1,1]){box(M.woodDark,x,h*.55,z+dz*(d/2+.09),.45,1.45,.09);box(M.glass,x,h*.55,z+dz*(d/2+.15),.14,1.12,.05);}
  }
  function banner(x,y,z,w=1,h=1.6,material=M.fabric){
    const group=new THREE.Group();group.position.set(x,y,z);root.add(group);
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([-w/2,h/2,0,w/2,h/2,0,w/2,-h*.32,0,0,-h/2,0,-w/2,-h*.32,0],3));g.setIndex([0,1,2,0,2,3,0,3,4]);g.computeVertexNormals();
    const cloth=mesh(g,new THREE.MeshStandardMaterial({color:material.color,roughness:1,side:THREE.DoubleSide}),group);wind.push({o:cloth,phase:rng()*6,amount:.075});
    localBox(group,M.fabricLight,0,0,.012,.12,h*.58,.018);localBox(group,M.fabricLight,0,.12,.016,w*.45,.12,.02);
    return group;
  }
  turret(-8,18);turret(8,18);
  turret(-87,18,1.9,1.9,6.2,false);turret(87,18,1.9,1.9,6.2,false);
  turret(-87,-132,1.9,1.9,6.2,false);turret(87,-132,1.9,1.9,6.2,false);
  box(M.stoneDark,0,6.05,18,11.7,2,3.8);box(M.stoneLight,0,7.18,18,11.7,.33,4.05);
  for(let i=-5;i<=5;i+=2)box(M.stoneLight,i,7.83,18.9,.9,1,1);
  // Stone voussoirs frame an open passage beneath the raised portcullis.
  for(let i=0;i<9;i++){
    const a=Math.PI*(i+.5)/9;
    box(M.stoneLight,Math.cos(a)*5.28,3.78+Math.sin(a)*1.35,20.02,1.22,.63,.45,0,(a-Math.PI/2)*.24);
  }
  const gateArtwork=createGateArtwork(),gate=gateArtwork.gate;root.add(gate,gateArtwork.frame);
  banner(-8,6.9,20.65,1.35,2.7);banner(8,6.9,20.65,1.35,2.7);

  function roof(x,z,w,d,base,h,material=M.roof){
    const geo=new THREE.BufferGeometry();const a=w/2,b=d/2;
    geo.setAttribute('position',new THREE.Float32BufferAttribute([-a,0,b,a,0,b,0,h,b,-a,0,-b,a,0,-b,0,h,-b],3));
    geo.setIndex([0,1,2,3,5,4,0,2,5,0,5,3,2,1,4,2,4,5,0,3,4,0,4,1]);geo.computeVertexNormals();mesh(geo,material,root,x,base,z);
    for(const end of [-1,1]){
      beam(M.woodDark,[x-a,base,z+end*(b+.025)],[x,base+h,z+end*(b+.025)],.19);
      beam(M.woodDark,[x+a,base,z+end*(b+.025)],[x,base+h,z+end*(b+.025)],.19);
      beam(M.woodLight,[x,base+.08,z+end*(b+.08)],[x,base+h-.05,z+end*(b+.08)],.12);
      box(M.woodDark,x,base+.04,z+end*(b+.04),w,.16,.16);
    }
    for(const side of [-1,1])box(M.woodDark,x+side*a,base-.08,z,.18,.24,d+.18);
    box(M.roofDark,x,base+h+.06,z,.26,.2,d+.2);
    for(let k=0;k<Math.ceil(d/.8);k++)box(k%3?M.roof:M.roofLight,x,base+h+.16,z-d/2+(k+.5)*d/Math.ceil(d/.8),.36,.12,d/Math.ceil(d/.8)-.025);
    // Shingle courses and occasional brighter tiles, built as instances.
    const angle=Math.atan2(h,a),slope=Math.hypot(h,a);
    for(const side of [-1,1])for(let row=0;row<5;row++){
      const t=(row+.45)/5;box(row%2?M.roofDark:M.roofLight,x+side*a*t,base+h*(1-t)+.055,z,slope/5+.035,.075,d+.05,0,-side*angle);
    }
    return geo;
  }
  function window(x,y,z,w=.85,h=1.1){
    box(M.woodDark,x,y,z,w+.22,h+.2,.12);box(M.glass,x,y,z+.075,w,h,.035);
    box(M.woodDark,x,y,z+.12,.07,h,.08);box(M.woodDark,x,y,z+.12,w,.07,.08);
    box(M.woodLight,x,y-h/2-.1,z+.12,w+.37,.14,.24);
    for(const side of [-1,1]){
      box(M.wood,x+side*(w/2+.2),y,z+.05,.2,h+.06,.09);
      for(const offset of [-.27,.27])box(M.iron,x+side*(w/2+.2),y+h*offset,z+.11,.23,.065,.045);
    }
  }
  function door(x,z,y=.65,w=1.55,h=2.4){
    box(M.stoneDark,x,y+h/2,z,w+.5,h+.3,.15);box(M.woodDark,x,y+h/2,z+.11,w,h,.1);
    for(let i=0;i<5;i++)box(M.wood,x-w/2+(i+.5)*w/5,y+h/2,z+.18,w/5-.045,h,.07);
    box(M.iron,x,y+.4,z+.24,w,.13,.06);box(M.iron,x,y+h-.4,z+.24,w,.13,.06);
    batch(sphereG,M.copper,x+w*.27,y+h*.45,z+.3,.1,.1,.08);
    box(M.stoneLight,x,.16,z+.6,w+.65,.32,1);box(M.stone,x,.38,z+.22,w+.36,.42,.55);
  }
  function sign(text,x,y,z,w=3.1,yaw=0){
    const texture=canvasTexture((ctx,cw,ch)=>{
      ctx.fillStyle='#332c24';ctx.fillRect(0,0,cw,ch);ctx.strokeStyle='#ac8d56';ctx.lineWidth=9;ctx.strokeRect(9,9,cw-18,ch-18);
      ctx.fillStyle='#e8d7ac';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='600 43px Georgia';ctx.fillText(text,cw/2,ch/2,cw-42);
    },512,112);
    const sm=new THREE.MeshStandardMaterial({map:texture,roughness:1});const backing=mesh(new THREE.BoxGeometry(w,.67,.16),M.woodDark,root,x,y,z);backing.rotation.y=yaw;const face=mesh(new THREE.PlaneGeometry(w-.07,.6),sm,root,x+Math.sin(yaw)*.086,y,z+Math.cos(yaw)*.086);face.rotation.y=yaw;
  }
  function chimney(x,z,y){
    masonry(x,z,1.15,1.8,1.05); // Base instance is hidden inside building; upper stack follows.
    box(M.stone,x,y+1.5,z,1.1,3,1);box(M.stoneLight,x,y+3.04,z,1.35,.28,1.2);box(M.woodDark,x,y+3.2,z,.83,.05,.72);
  }
  function cottage(b){
    const {x,z,w,d}=b,h=b.kind==='bank'?5.7:4.8,front=z+d/2;
    box(M.stoneDark,x,.4,z,w+.16,.8,d+.16);box(b.kind==='bank'?M.stoneLight:M.plaster,x,h/2+.4,z,w,h,d);
    box(M.stoneLight,x,.74,z,w+.25,.19,d+.25);
    box(M.woodDark,x,.97,z,w+.1,.22,d+.1);box(M.woodDark,x,h+.34,z,w+.12,.24,d+.12);
    for(const dx of [-w/2+.13,0,w/2-.13])box(M.wood,x+dx,h/2+.48,front+.04,.22,h,.18);
    for(const dz of [-d/2+.12,0,d/2-.12])box(M.wood,x-w/2-.035,h/2+.48,z+dz,.17,h,.22);
    box(M.wood,x,3.17,front+.075,w,.18,.2);
    beam(M.wood,[x-w/2+.12,1.1,front+.13],[x-1.4,3.08,front+.13],.16);
    beam(M.wood,[x+w/2-.12,1.1,front+.13],[x+1.4,3.08,front+.13],.16);
    roof(x,z,w+1.25,d+1.25,h+.55,w*.36);
    door(x,front+.05,.62,1.5,2.35);window(x-w*.3,2.16,front+.14);window(x+w*.3,2.16,front+.14);
    window(x-w*.26,h-.8,front+.14,.95,.85);window(x+w*.26,h-.8,front+.14,.95,.85);
    window(x,h+1.2,front+.12,.7,.8);chimney(x+w*.28,z-d*.23,h+.8);
    // Small brackets tie the overhanging roof into the timber facade.
    for(const side of [-1,1])beam(M.wood,[x+side*(w/2-.16),h-.28,front+.14],[x+side*(w/2+.3),h+.47,front+.14],.14);
    if(b.kind==='shop'||b.kind==='food'){
      const az=front+1.4,aw=w*.84;
      box(M.wood,x,1.04,az,aw,.17,1.45);box(M.woodDark,x,.5,az,aw*.93,.9,1.2);
      for(const side of [-1,1])cylinder(M.woodDark,x+side*aw/2,1.85,az+.48,.095,3.7);
      for(let i=0;i<8;i++){
        const stripe=new THREE.Mesh(new THREE.BoxGeometry(aw/8+.01,.06,2.5),i%2?M.fabricLight:M.fabric);stripe.position.set(x-aw/2+(i+.5)*aw/8,3.68,front+.93);stripe.rotation.x=.15;stripe.castShadow=true;root.add(stripe);
        box(i%2?M.fabricLight:M.fabric,x-aw/2+(i+.5)*aw/8,3.28,front+2.15,aw/8,.48,.055);
      }
      sign(b.name,x,4.38,front+.19,Math.min(w-1,4.7));
      for(let i=0;i<6;i++){
        const bx=x-1.5+i*.59;
        if(b.kind==='food')batch(sphereG,M.wheat,bx,1.3,az,.26,.18,.32,0,rng(),0);
        else{box(M.woodLight,bx,1.35,az,.08,.7,.08);box(M.stoneDark,bx+.12,1.62,az,.4,.2,.18);}
      }
    } else if(b.kind==='bank') {
      sign('TREASURY',x,3.38,front+.2,3.5);banner(x-w*.45,3.6,front+.21,.8,1.7,M.blue);
      for(const side of [-1,1])for(let row=0;row<7;row++)box(row%2?M.stone:M.stoneLight,x+side*(w/2-.17),1.18+row*.66,front+.1,.5,.52,.23);
      box(M.stoneLight,x,4.0,front+.34,4.0,.2,.56);
    }
    else{
      for(const side of [-1,1]){box(M.wood,x+side*w*.3,1.33,front+.4,1.15,.3,.45);for(let f=0;f<4;f++)batch(sphereG,f%2?M.fabric:M.wheatTip,x+side*w*.3-.42+f*.28,1.57,front+.42,.11,.15,.13);}
    }
  }
  function barracks(b){
    cottage({...b,kind:'house'});sign('THE WATCH',b.x,3.54,b.z+b.d/2+.24,3.7);
    banner(b.x-3.8,4,b.z+b.d/2+.25,1.05,2.2);banner(b.x+3.8,4,b.z+b.d/2+.25,1.05,2.2);
    for(const s of [-1,1]){const x=b.x+s*3.7,z=b.z+b.d/2+1.35;beam(M.wood,[x-.4,.1,z],[x+.4,1.55,z],.1);beam(M.wood,[x+.4,.1,z],[x-.4,1.55,z],.1);for(let i=0;i<3;i++){cylinder(M.woodLight,x+(i-1)*.23,1.05,z,.035,1.8);batch(coneG,M.iron,x+(i-1)*.23,2,z,.1,.3,.1);}}
  }
  function church(b){
    const{x,z,w,d}=b,front=z+d/2;
    masonry(x,z,w,6.7,d);roof(x,z,w+1.1,d+1.1,6.9,4.2);
    for(const dx of [-1,1])for(let i=0;i<3;i++)box(M.stoneLight,x+dx*(w/2-.18),2.6,z-d/2+1.6+i*(d-3.2)/2,.6,5.2,.8);
    door(x,front+.13,.45,2.3,3.45);
    const rose=mesh(new THREE.CylinderGeometry(1.08,1.08,.13,12),M.woodDark,root,x,6.1,front+.18);rose.rotation.x=Math.PI/2;
    const roseg=mesh(new THREE.CylinderGeometry(.86,.86,.15,12),M.glass,root,x,6.1,front+.27);roseg.rotation.x=Math.PI/2;
    box(M.stoneLight,x,6.1,front+.39,.13,1.9,.1);box(M.stoneLight,x,6.1,front+.39,1.9,.13,.1);
    const tx=x-w/2+1.7,tz=z-d/2+2;turret(tx,tz,3.3,3.3,11.2,false);
    const steeple=new THREE.ConeGeometry(2.6,5.8,4);steeple.rotateY(Math.PI/4);mesh(steeple,M.roof,root,tx,14.4,tz);
    box(M.fabricLight,tx,18,tz,.15,2.2,.15);box(M.fabricLight,tx,18.4,tz,1,.14,.15);
    banner(x-3.25,4.7,front+.27,.9,2.15,M.purple);banner(x+3.25,4.7,front+.27,.9,2.15,M.purple);
    sign('SANCTUARY',x,4.4,front+.26,3.55);
  }
  function keep(b){
    const{x,z,w,d}=b; masonry(x,z,w,9.4,d);
    box(M.stoneDark,x,4,z+d/2+.14,w,.22,.25);box(M.stoneLight,x,8.4,z,w+.2,.38,d+.2);
    roof(x,z,w+.9,d+.9,9.6,5.2,M.roofDark);
    for(const dx of [-1,1])turret(x+dx*(w/2-1.9),z+d/2-2,3.8,4,12.6,true);
    door(x,z+d/2+.2,.4,3.2,4.5);window(x,7.1,z+d/2+.2,1.8,2.1);
    banner(x-3.5,7,z+d/2+.24,1.3,3.8);banner(x+3.5,7,z+d/2+.24,1.3,3.8);
    sign('THE HEARTHKEEP',x,5.7,z+d/2+.25,5.4);
    cylinder(M.woodDark,x,17.1,z,.1,4);banner(x+1.25,17.8,z,2.5,1.7);
  }
  function stable(b){
    const{x,z,w,d}=b;
    box(M.stoneDark,x,.2,z,w+.2,.4,d+.2);roof(x,z,w+1.05,d+1.1,4.15,2.6);
    box(M.woodDark,x,2,z-d/2,w,4,.25);
    for(const dx of [-w/2,w/2]){box(M.wood,x+dx,2,z,.25,4,d);box(M.woodDark,x+dx,2,z+d/2,.3,4,.3);}
    for(let i=0;i<3;i++){
      const sx=x-w/2+(i+.5)*w/3;
      box(M.wood,sx,1,z+d/2,w/3-.2,1.6,.12);
      box(M.woodLight,sx,1.84,z+d/2,w/3-.1,.18,.22);
      box(M.wheat,sx,.45,z+d/2-1.1,1.35,.6,1.25);
      box(M.woodDark,sx+w/6,1.8,z+d/2,.16,3.6,.16);
    }
    sign('HEARTHSIDE STABLES',x,3.43,z+d/2+.16,Math.min(w-1,5.5));
    for(const dx of [-w/2+.35,w/2-.35])banner(x+dx,3.15,z+d/2+.2,.55,1.5,M.blue);
  }
  function merchant(b){
    const{x,z,w,d}=b;
    box(M.woodDark,x,1.05,z,w*.8,.45,d*.76);
    for(const side of [-1,1])for(const end of [-1,1]){
      const wheel=mesh(new THREE.CylinderGeometry(.86,.86,.2,10),M.woodDark,root,x+side*w*.42,.9,z+end*d*.25);wheel.rotation.z=Math.PI/2;
      box(M.iron,x+side*w*.44,.9,z+end*d*.25,.24,.16,1.8);
    }
    for(const side of [-1,1])box(M.wood,x+side*w*.38,2,z,.18,1.5,d*.75);
    box(M.wood,x,2,z-d*.38,w*.8,1.5,.17);
    for(const dx of [-w*.38,w*.38])for(const dz of [-d*.38,d*.38])box(M.woodDark,x+dx,3.05,z+dz,.13,3.9,.13);
    for(let i=0;i<9;i++)box(i%2?M.fabricLight:M.purple,x-w*.46+(i+.5)*w*.92/9,4.9,z,w*.92/9+.02,.13,d*.98);
    sign('THE WAYFARER',x,3.75,z+d*.4,4.1);
    for(let i=0;i<5;i++)box(i%2?M.copper:M.woodLight,x-2+i,1.9,z,.7,1.15,.8);
  }
  // Building artwork is authored with a south-facing front, then transformed as
  // one unit, including signs, banners, steps and instanced trim. Swapping local
  // width/depth for quarter turns preserves the shared server collision bounds.
  const facing={keep:0,barracks:Math.PI/2,stable:-Math.PI/2,merchant:Math.PI/2,tools:Math.PI/2,food:-Math.PI/2,bank:Math.PI/2,church:-Math.PI/2,house1:-Math.PI/2,house2:Math.PI/2};
  for(const b of BUILDINGS){
    const yaw=b.yaw??facing[b.id]??0,quarter=Math.abs(Math.sin(yaw))>.5;
    const local={...b,x:0,z:0,w:quarter?b.d:b.w,d:quarter?b.w:b.d};
    const firstChild=root.children.length,firstInstances=new Map([...batches].map(([key,value])=>[key,value.transforms.length]));
    if(b.kind==='keep')keep(local);else if(b.kind==='church')church(local);else if(b.kind==='barracks')barracks(local);else if(b.kind==='stable')stable(local);else if(b.kind==='merchant')merchant(local);else cottage(local);
    const group=new THREE.Group();group.name=`building-${b.id}`;group.position.set(b.x,0,b.z);group.rotation.y=yaw;group.updateMatrix();
    for(const child of root.children.slice(firstChild))group.add(child);
    const front=new THREE.Vector3(0,0,local.d/2).applyMatrix4(group.matrix);
    group.userData={buildingId:b.id,front:{x:front.x,z:front.z},direction:{x:Math.sin(yaw),z:Math.cos(yaw)}};
    root.add(group);
    for(const [key,value] of batches)for(let i=firstInstances.get(key)??0;i<value.transforms.length;i++)value.transforms[i].premultiply(group.matrix);
  }

  function crate(x,z,s=.85,ry=0){
    box(M.woodLight,x,s/2,z,s,s,s,ry);for(const y of [.14,s-.14])box(M.woodDark,x,y,z,s+.04,.12,s+.04,ry);
    beam(M.wood,[x-s*.43,.1,z+s*.505],[x+s*.43,s-.1,z+s*.505],.1,.05);
  }
  function barrel(x,z,s=1){
    const g=new THREE.CylinderGeometry(.42*s,.36*s,.95*s,10);mesh(g,M.wood,root,x,.475*s,z);
    for(const y of [.15,.7]){const ring=mesh(new THREE.TorusGeometry(.405*s,.035*s,4,10),M.iron,root,x,y*s,z);ring.rotation.x=Math.PI/2;}
    cylinder(M.woodDark,x,.96*s,z,.31*s,.025);
  }
  for(const [x,z] of [[-12,11],[-12.8,10.6],[-27.8,3],[-27,-21],[20,11],[25,-29]])crate(x,z,.7+rng()*.35,rng()*.13);
  for(const [x,z] of [[-22,12],[-23,11.8],[19,11],[-13,-18],[26,-7]])barrel(x,z,.85+rng()*.25);
  // Communal well: compact landmark beside the main road.
  const wx=8,wz=-4;
  const wellArtwork=createWellArtwork();root.add(wellArtwork.root);
  roof(wx,wz,3.6,2.7,3.6,1.3);

  function lamp(x,z,h=3.4){
    cylinder(M.stoneDark,x,.19,z,.26,.38);box(M.woodDark,x,h/2,z,.13,h,.14);box(M.iron,x+.3,h,z,.8,.1,.1);
    const glow=mesh(new THREE.BoxGeometry(.3,.47,.3),M.embers,root,x+.57,h-.48,z);glow.castShadow=false;
    box(M.iron,x+.57,h-.77,z,.43,.1,.43);box(M.iron,x+.57,h-.18,z,.45,.1,.45);
    for(const dx of [-1,1])for(const dz of [-1,1])box(M.iron,x+.57+dx*.15,h-.48,z+dz*.15,.045,.55,.045);
    const light=new THREE.PointLight('#ffbe70',0,9,2);light.position.set(x+.57,h-.48,z);root.add(light);lanterns.push(light);
    const halo=mesh(new THREE.SphereGeometry(.25,6,4),new THREE.MeshBasicMaterial({color:'#ffce7e',transparent:true,opacity:.07,depthWrite:false}),root,x+.57,h-.48,z,2.5,2.5,2.5);flickers.push({o:halo,phase:rng()*6});
  }
  for(const [x,z] of [[-4.6,13],[4.5,13],[-4.5,25],[4.5,25],[-4.8,-10],[4.6,-28],[-11,-4],[12,-5],[10,56],[20,93]])lamp(x,z);
  for(const side of [-1,1])for(const z of [-29,-71,-113])lamp(side*36.7,z);
  for(const side of [-1,1]){cylinder(M.woodDark,side*30,1.35,-59,.1,2.7);sign(side<0?'WEST HEARTHS':'EAST HEARTHS',side*30,2.75,-59,4.3);}
  cylinder(M.woodDark,4.5,1.4,-89,.1,2.8);sign('NORTH COMMON',4.5,2.8,-89,4.2);

  // Merge resource artwork by material. Confirmed harvests animate separately
  // so resource availability stays authoritative and fields remain inexpensive.
  function mergeParts(parts){
    const byMaterial=new Map();
    for(const p of parts){p.updateMatrix();let g=p.geometry.clone();g.applyMatrix4(p.matrix);if(g.index)g=g.toNonIndexed();const key=p.material.uuid;if(!byMaterial.has(key))byMaterial.set(key,{material:p.material,gs:[]});byMaterial.get(key).gs.push(g);}
    const group=new THREE.Group();
    for(const {material,gs} of byMaterial.values()){
      const positions=[],normals=[];for(const g of gs){positions.push(...g.attributes.position.array);normals.push(...g.attributes.normal.array);g.dispose();}
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));mesh(g,material,group);
    }
    return group;
  }
  function part(geo,material,x,y,z,sx,sy,sz,ry=0,rz=0){const p=new THREE.Mesh(geo,material);p.position.set(x,y,z);p.scale.set(sx,sy,sz);p.rotation.set(0,ry,rz);return p;}
  function tree(x,z,seed,decor=false){
    const r=seeded(seed),pine=r()>.47,h=4.8+r()*3.9,parts=[];
    parts.push(part(cylinderG,M.bark,0,h*.28,0,.22,h*.56,.22));
    if(pine){
      for(let k=0;k<3;k++){const radius=h*(.24-k*.045);parts.push(part(coneG,k%2?M.pineLight:M.pine,0,h*(.48+k*.18),0,radius,h*.51,radius,k*.4));}
    }else{
      parts.push(part(cylinderG,M.bark,-.3,h*.53,0,.11,h*.4,.11,0,-.5));
      for(let k=0;k<5;k++){const a=k*2.4,spread=k?1.1:0,size=h*(.22+r()*.065);parts.push(part(sphereG,k%2?M.leaf:M.leafLight,Math.cos(a)*spread,h*.7+r()*.7,Math.sin(a)*spread,size,size*.85,size,k*.4));}
    }
    for(let k=0;k<3;k++){const a=k*Math.PI*2/3;parts.push(part(sphereG,M.bark,Math.cos(a)*.22,.12,Math.sin(a)*.22,.28,.16,.23));}
    const rotation=r()*6.28;
    if(decor){
      dummy.position.set(x,0,z);dummy.scale.set(1,1,1);dummy.rotation.set(0,rotation,0);dummy.updateMatrix();const parentMatrix=dummy.matrix.clone();
      for(const p of parts){p.updateMatrix();const key=p.geometry.uuid+p.material.uuid;if(!batches.has(key))batches.set(key,{geo:p.geometry,material:p.material,transforms:[]});batches.get(key).transforms.push(parentMatrix.clone().multiply(p.matrix));}
      return null;
    }
    const o=mergeParts(parts);o.position.set(x,0,z);o.rotation.y=rotation;root.add(o);o.userData.resourceWind={phase:r()*6.28,amount:.007};o.userData.resourceHeight=h;return o;
  }
  function wheat(x,z,seed){
    const r=seeded(seed),parts=[];
    for(let i=0;i<4;i++){
      const dx=(r()-.5)*.42,dz=(r()-.5)*.42,h=.72+r()*.25;
      parts.push(part(cylinderG,M.wheat,dx,h*.48,dz,.025,h,.025,0,(r()-.5)*.17));
      parts.push(part(sphereG,M.wheatTip,dx,h,dz,.074,.22,.068,r()*3));
      parts.push(part(coneG,M.wheat,dx-.06,h*.53,dz,.07,.4,.015,0,-.47));
    }
    const o=mergeParts(parts);o.position.set(x,.025,z);root.add(o);o.userData.resourceWind={phase:r()*6.28,amount:.045};return o;
  }
  function createResource(n){
    let object;
    const seed=n.seed??Array.from(n.id).reduce((value,char)=>Math.imul(value,31)+char.charCodeAt(0)|0,1);
    if(n.type==='timber')object=tree(n.x,n.z,seed);
    else if(n.type==='wheat')object=wheat(n.x,n.z,seed);
    else{
      object=mesh(mineralOutcropGeometry(n.type,seed),M.geology,root,n.x,0,n.z);
      object.name=`${n.type}-${caveAreaAt(n.x,n.z)?'cave-vein':'exposed-bedrock'}`;
      object.userData.formation='layered-outcrop';
    }
    object.position.y+=groundHeight(n.x,n.z);object.userData.resourceId=n.id;object.userData.resourceType=n.type;object.userData.resourceLocation={x:n.x,z:n.z};resources.set(n.id,object);resourceEffects.register(n,object);return object;
  }
  // Public ore is exposed in the cave; private mine artwork stays with its plot.
  for(const n of RESOURCES)createResource(n);
  const publicResourceIds=new Set(RESOURCES.map(n=>n.id));
  // Small tilled patches beneath individual harvestable wheat stalks.
  box(M.dirt,-27,-.045,-11.2,5.8,.09,4.8);box(M.dirt,21,.002,47.55,7.55,.04,6.1);
  for(let i=0;i<6;i++)box(M.woodDark,-29+i*.8,.018,-11.35,.1,.03,4.5);
  for(let i=0;i<8;i++)box(M.woodDark,18+i*.85,.029,47.2,.11,.028,5.8);
  function fence(x,z,length,alongZ=false){
    for(let i=0;i<=length/1.5;i++){const a=i*1.5;box(M.wood,x+(alongZ?0:a),.58,z+(alongZ?a:0),.11,1.16,.11);}
    for(const y of [.4,.89])box(M.woodLight,x+(alongZ?0:length/2),y,z+(alongZ?length/2:0),alongZ?.09:length,.09,alongZ?length:.09);
  }
  fence(-30,-14,6.5);fence(-30,-14,5.5,true);fence(17,44,8.5);fence(25.5,44,7,true);
  // Distant forest provides depth without changing navigation inside the village.
  for(let i=0;i<53;i++){const side=i%2?1:-1;tree(side*(119+rng()*27),-131+rng()*252,20000+i,true);}
  // Graveyard: the only incoming route, readable from the road and gate.
  const graveX=20,graveZ=104;
  const graveGround=mesh(new THREE.CircleGeometry(14,15),mat('#6e7960'),root,graveX,.005,graveZ);graveGround.rotation.x=-Math.PI/2;graveGround.castShadow=false;
  for(const side of [-1,1]){
    cylinder(M.stoneDark,graveX+side*4.1,2,graveZ-4.5,.55,4);batch(sphereG,M.stoneLight,graveX+side*4.1,4.2,graveZ-4.5,.6,.6,.6);
    fence(graveX+side*5.2,graveZ-3.5,9,true);
  }
  beam(M.iron,[graveX-4.1,4,graveZ-4.5],[graveX+4.1,4,graveZ-4.5],.13);
  sign('THE HOLLOW',graveX,4.7,graveZ-4.5,4.15,Math.PI);
  for(let i=0;i<19;i++){
    const side=i%2?1:-1,x=graveX+side*(3.6+rng()*7),z=graveZ-1+rng()*10;
    box(M.dirt,x,.025,z+1,1.25,.08,2.25);
    if(i%3===0){box(M.stoneLight,x,.92,z,.26,1.75,.2);box(M.stoneLight,x,1.19,z,1.04,.24,.25);}
    else{
      const gravestone=new THREE.Group();gravestone.position.set(x,0,z);gravestone.rotation.z=(rng()-.5)*.2;
      localBox(gravestone,M.stone,.62*0,.58,0,.84,1.05,.23);const arch=mesh(new THREE.CylinderGeometry(.42,.42,.23,8),M.stone,gravestone,0,1.09,0);arch.rotation.x=Math.PI/2;
      localBox(gravestone,M.stoneDark,0,.78,.125,.34,.055,.016);localBox(gravestone,M.stoneDark,0,.62,.125,.24,.045,.016);root.add(gravestone);
    }
  }
  // Simple dead trees frame the source without obstructing the road.
  for(const [x,z] of [[8,106],[32,102],[28,115]]){
    beam(M.woodDark,[x,0,z],[x+.35,5,z],.42);beam(M.woodDark,[x+.2,2.5,z],[x-1.7,4.5,z+.4],.22);beam(M.woodDark,[x+.3,3.7,z],[x+1.7,5.1,z-.5],.17);
  }
  // Flush repeated architectural details into a small number of draw calls.
  for(const {geo,material,transforms,caveOccluder} of batches.values()){
    const instance=new THREE.InstancedMesh(geo,material,transforms.length);transforms.forEach((m,i)=>instance.setMatrixAt(i,m));instance.castShadow=true;instance.receiveShadow=true;instance.computeBoundingSphere();root.add(instance);if(caveOccluder)caveOccluders.push(instance);
  }
  const details=createWorldDetails(lanes);root.add(details.root);
  const plotsWorld=createPlotsWorld(root);
  let previousNight=-1;
  function update(time,nightAmount=0,state={}){
    plotsWorld.update(state,time);details.update(time);
    const t=time,night=THREE.MathUtils.clamp(nightAmount,0,1);
    for(const item of wind){if(item.o.visible)item.o.rotation.z=Math.sin(t*1.4+item.phase)*item.amount;}
    for(const item of flickers){item.o.material.opacity=.035+night*.1+Math.sin(t*6+item.phase)*.01;}
    if(Math.abs(night-previousNight)>.025){M.glass.emissiveIntensity=.35+night*1.3;M.embers.emissiveIntensity=1+night*1.7;for(const l of lanterns)l.intensity=night*13;previousNight=night;}
    const raw=state.resources;
    if(raw){
      resourceEffects.beginSnapshot(state);
      const harvesters=[...(Array.isArray(state.players)?state.players:Object.values(state.players||{})),...(state.workers||[])];
      const entries=Array.isArray(raw)?raw:Object.entries(raw).map(([id,value])=>typeof value==='object'?{id,...value}:{id,available:value});
      const plotEntries=Array.isArray(state.plotResources)?state.plotResources:[];
      const dynamicIds=new Set();
      for(const n of [...entries,...plotEntries]){
        if(!publicResourceIds.has(n.id))dynamicIds.add(n.id);
        let object=resources.get(n.id);
        const changed=object&&n.type&&(object.userData.resourceType!==n.type||Number.isFinite(n.x)&&Number.isFinite(n.z)&&(object.userData.resourceLocation?.x!==n.x||object.userData.resourceLocation?.z!==n.z));
        if(changed){resourceEffects.remove(n.id);root.remove(object);object.traverse(child=>{if(child.isMesh)child.geometry.dispose();});resources.delete(n.id);object=null;}
        if(!object&&Number.isFinite(n.x)&&Number.isFinite(n.z)&&n.type)object=createResource(n);
        if(object)resourceEffects.observe(n,time,harvesters);
      }
      for(const [id,object] of resources){
        if(publicResourceIds.has(id)||dynamicIds.has(id))continue;
        resourceEffects.remove(id);root.remove(object);object.traverse(child=>{if(child.isMesh)child.geometry.dispose();});resources.delete(id);
      }
    }
    resourceEffects.update(time);
    const gateHP=state.gateHp??state.gateHP??state.gate?.hp??state.gateHealth??1200;
    gate.visible=gateHP>0;
    const players=Array.isArray(state.players)?state.players:Object.values(state.players||{}),guards=Array.isArray(state.guards)?state.guards:Object.values(state.guards||{});
    const nearby=[...players,...guards,...(state.workers||[])].some(p=>Math.abs((p.x??p.position?.x??999))<6.2&&Math.abs((p.z??p.position?.z??999)-18)<7);
    const target=nearby?1:0;
    gate.userData.openAmount=THREE.MathUtils.lerp(gate.userData.openAmount,target,.065);gate.position.y=.1+gate.userData.openAmount*4.7;gateArtwork.update();
  }
  return {root,resources,gate,ground,setCaveView(inside){for(const m of caveOccluders)m.visible=!inside;},landmarks:{gate:gateArtwork,well:wellArtwork},update,road:mainRoad,lanterns,details,plots:plotsWorld,resourceEffects,resetResourceEffects:()=>resourceEffects.reset()};
}

// Build-time curb clipping uses the exact triangles of the rendered roads,
// including curved lanes and paved squares. A spatial grid keeps this bounded
// to nearby surfaces; it does no work in the animation loop.
export function createRoadEdging(lanes,pavedSquares=[]){
  const cellSize=4,grid=new Map(),edgeGrid=new Map(),edges=[];
  const bounds=points=>({minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),minZ:Math.min(...points.map(p=>p.z)),maxZ:Math.max(...points.map(p=>p.z))});
  function visitCells(box,visit){
    for(let x=Math.floor(box.minX/cellSize);x<=Math.floor(box.maxX/cellSize);x++)for(let z=Math.floor(box.minZ/cellSize);z<=Math.floor(box.maxZ/cellSize);z++)visit(`${x}:${z}`);
  }
  function insert(index,record){visitCells(record.bounds,key=>{if(!index.has(key))index.set(key,[]);index.get(key).push(record);});}
  function candidates(index,box){const found=new Set();visitCells(box,key=>{for(const item of index.get(key)??[])found.add(item);});return found;}
  function overlaps(a,b){
    // Separating axes for convex footprints. Merely touching an exposed edge
    // is allowed; positive overlap into the neighboring pavement is not.
    for(const polygon of [a,b])for(let i=0;i<polygon.length;i++){
      const next=polygon[(i+1)%polygon.length],axisX=next.z-polygon[i].z,axisZ=polygon[i].x-next.x;
      let aMin=Infinity,aMax=-Infinity,bMin=Infinity,bMax=-Infinity;
      for(const p of a){const d=p.x*axisX+p.z*axisZ;aMin=Math.min(aMin,d);aMax=Math.max(aMax,d);}
      for(const p of b){const d=p.x*axisX+p.z*axisZ;bMin=Math.min(bMin,d);bMax=Math.max(bMax,d);}
      if(Math.min(aMax,bMax)-Math.max(aMin,bMin)<=1e-7)return false;
    }
    return true;
  }
  function addSurface(geometry,owner,matrix){
    const positions=geometry.attributes.position,index=geometry.index,vertex=new THREE.Vector3();
    for(let i=0;i<(index?.count??positions.count);i+=3){
      const points=[];
      for(let j=0;j<3;j++){
        vertex.fromBufferAttribute(positions,index?index.getX(i+j):i+j);if(matrix)vertex.applyMatrix4(matrix);points.push({x:vertex.x,z:vertex.z});
      }
      const [a,b,c]=points;
      if(Math.abs((b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x))<1e-8)continue;
      insert(grid,{owner,points,bounds:bounds(points)});
    }
  }
  lanes.forEach((lane,owner)=>addSurface(lane.geometry,owner));
  for(const square of pavedSquares)addSurface(square.geometry,-1,square.matrix);
  function footprint(x,z,yaw,width=.38,depth=.88){
    const cos=Math.cos(yaw),sin=Math.sin(yaw);
    return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>({x:x+cos*a*width/2+sin*b*depth/2,z:z-sin*a*width/2+cos*b*depth/2}));
  }
  lanes.forEach(({curve,width},owner)=>{
    const length=curve.getLength(),count=length/1.15;
    for(let index=0;index<count;index++)for(const side of [-1,1]){
      const p=curve.getPoint(index/count),tangent=curve.getTangent(index/count),offset=width/2+.08,yaw=Math.atan2(tangent.x,tangent.z);
      const x=p.x+tangent.z*offset*side,z=p.z-tangent.x*offset*side;
      // The inner 11 cm is deliberately bedded into its own paving. Only the
      // exposed portion can cross another road: this also preserves the outer
      // boundary where two parallel road surfaces coincide.
      const exposed=footprint(x+tangent.z*.0625*side,z-tangent.x*.0625*side,yaw,.255),exposedBounds=bounds(exposed);
      if([...candidates(grid,exposedBounds)].some(surface=>surface.owner!==owner&&overlaps(exposed,surface.points)))continue;
      const points=footprint(x,z,yaw),box=bounds(points);
      // Coincident roads share one row of edging, rather than stacking stones.
      if([...candidates(edgeGrid,box)].some(edge=>overlaps(points,edge.points)))continue;
      const edge={x,z,yaw,index,side,owner};edges.push(edge);insert(edgeGrid,{points,bounds:box});
    }
  });
  return edges;
}

// Cosmetic feedback follows confirmed resource changes, never local clicks.
// The depleted authoritative mesh is hidden immediately; short-lived visual
// copies can finish falling or crumbling without remaining gather targets.
export function createResourceEffects(parent,{maxParticles=192,maxGhosts=16}={}){
  const root=new THREE.Group();root.name='Harvest feedback';parent.add(root);
  const records=new Map(),ghosts=[],dummy=new THREE.Object3D(),axis=new THREE.Vector3(),rotation=new THREE.Quaternion();
  let villageId,lastClock,events=0;
  const chipMaterial=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.95,flatShading:true});
  const dustMaterial=new THREE.MeshBasicMaterial({color:'#ffffff',transparent:true,opacity:.19,depthWrite:false});
  function pool(name,geometry,material,capacity){
    const mesh=new THREE.InstancedMesh(geometry,material,capacity);mesh.name=name;mesh.count=0;mesh.visible=false;mesh.frustumCulled=false;mesh.castShadow=false;root.add(mesh);
    return {mesh,slots:Array(capacity).fill(null),cursor:0};
  }
  const chips=pool('harvest-chips',new THREE.TetrahedronGeometry(1,0),chipMaterial,Math.max(1,Math.floor(maxParticles*.75)));
  const dust=pool('harvest-dust',new THREE.IcosahedronGeometry(1,1),dustMaterial,Math.max(1,Math.floor(maxParticles*.25)));
  const palettes={timber:['#b98a53','#8b663d','#65884a'],stone:['#999c8e','#727c72','#b0ad98'],iron:['#a0744b','#8a6a4c','#79796e'],coal:['#333b39','#636a62','#878679'],wheat:['#e2c171','#c5a150','#9bac62']};
  const smooth=t=>t*t*(3-2*t),clamp=t=>THREE.MathUtils.clamp(t,0,1);
  function restore(record){record.object.position.copy(record.position);record.object.quaternion.copy(record.quaternion);record.object.scale.copy(record.scale);}
  function register(node,object){
    remove(node.id);
    const seed=node.seed??Array.from(node.id).reduce((value,char)=>Math.imul(value,31)+char.charCodeAt(0)|0,1);
    records.set(node.id,{id:node.id,type:node.type,seed,object,position:object.position.clone(),quaternion:object.quaternion.clone(),scale:object.scale.clone(),wind:object.userData.resourceWind,previous:null,hitAt:-Infinity,hitDirection:{x:0,z:1},serial:0,capacity:node.type==='wheat'?1:node.type==='timber'?5:8});
  }
  function removeGhost(index){const ghost=ghosts[index];root.remove(ghost.object);ghosts.splice(index,1);}
  function clearGhosts(id){for(let i=ghosts.length-1;i>=0;i--)if(id===undefined||ghosts[i].id===id)removeGhost(i);}
  function remove(id){clearGhosts(id);records.delete(id);}
  function direction(record,players=[]){
    let nearest=null,distance=3.8;
    for(const player of players){
      if(player.online===false||player.downed||player.anim!=='gather')continue;
      const d=Math.hypot(record.position.x-player.x,record.position.z-player.z);
      if(d<distance&&d>.1){nearest=player;distance=d;}
    }
    if(nearest)return {x:(record.position.x-nearest.x)/distance,z:(record.position.z-nearest.z)/distance};
    const angle=seeded(record.seed)()*Math.PI*2;return {x:Math.cos(angle),z:Math.sin(angle)};
  }
  function emit(record,time,depleted=false,impact=false,origin=record.position){
    const random=seeded(record.seed+Math.imul(++record.serial,719)),palette=palettes[record.type]??palettes.stone;
    const wood=record.type==='timber',wheat=record.type==='wheat';
    const amount=impact?13:depleted?(wood?15:wheat?9:22):wood?8:6;
    for(let i=0;i<amount;i++){
      const slot=chips.slots[chips.cursor]??={};chips.cursor=(chips.cursor+1)%chips.slots.length;
      const angle=random()*Math.PI*2,speed=(depleted?1.4:.9)+random()*(depleted?2:1.3),leaf=wood&&impact&&i%3===0;
      Object.assign(slot,{start:time,life:.42+random()*.42,floor:origin.y+.035,x:origin.x+(random()-.5)*.3,y:origin.y+(impact?.12:wood?.8:wheat?.55:.28),z:origin.z+(random()-.5)*.3,vx:Math.cos(angle)*speed,vy:1.4+random()*1.5,vz:Math.sin(angle)*speed,size:(wheat?.035:wood?.045:.055)+random()*.06,stretch:leaf?2.1:wood?1.8:1.1,spin:random()*8,color:new THREE.Color(leaf?palette[2]:palette[i%2])});
    }
    if(!wheat)for(let i=0;i<(depleted?7:3);i++){
      const slot=dust.slots[dust.cursor]??={};dust.cursor=(dust.cursor+1)%dust.slots.length;
      Object.assign(slot,{start:time,life:.45+random()*.42,floor:origin.y+.035,x:origin.x+(random()-.5)*.45,y:origin.y+(impact?.08:wood?.72:.19),z:origin.z+(random()-.5)*.45,vx:(random()-.5)*.75,vy:.3+random()*.4,vz:(random()-.5)*.75,size:.12+random()*.11,stretch:1,spin:0,color:new THREE.Color(record.type==='coal'?'#7b8077':wood?'#b29c79':'#aba38a')});
    }
  }
  function ghost(record,time,fallDirection){
    clearGhosts(record.id);while(ghosts.length>=Math.max(1,maxGhosts))removeGhost(0);
    const copy=record.object.clone(true);copy.name=`harvest-${record.type}-${record.id}`;copy.visible=true;
    copy.position.copy(record.position);copy.quaternion.copy(record.quaternion);root.add(copy);
    // Geometry and materials are shared with the source. Never dispose them
    // when a temporary visual finishes, or a regrown node would be corrupted.
    ghosts.push({id:record.id,type:record.type,record,object:copy,position:copy.position.clone(),quaternion:copy.quaternion.clone(),scale:copy.scale.clone(),direction:fallDirection,start:time,duration:record.type==='timber'?1.22:record.type==='wheat'?.25:.66,impacted:false});
  }
  function observe(node,time,players=[]){
    const record=records.get(node.id);if(!record)return;
    const available=Boolean(node.available??node.active??node.alive??(node.remaining!==undefined?node.remaining>0:node.hp!==undefined?node.hp>0:true));
    const remaining=Number.isFinite(node.remaining)?node.remaining:Number.isFinite(node.hp)?node.hp:null,previous=record.previous;
    if(remaining!==null)record.capacity=Math.max(record.capacity,remaining);
    if(previous?.available&&(available===false||remaining!==null&&previous.remaining!==null&&remaining<previous.remaining)){
      record.hitDirection=direction(record,players);record.hitAt=time;events++;
      emit(record,time,!available);
      if(!available)ghost(record,time,record.hitDirection);
    }else if(available&&!previous?.available){
      clearGhosts(record.id);record.hitAt=-Infinity;restore(record);
    }
    record.previous={available,remaining};record.object.visible=available;
  }
  function beginSnapshot(state={}){
    const clock=Number.isFinite(state.clock)?state.clock:null;
    // Large clock jumps also suppress old actions after a suspended tab or
    // missed connection, even if the caller did not explicitly reset history.
    if(villageId!==undefined&&state.id!==villageId||clock!==null&&lastClock!==undefined&&(clock<lastClock||clock-lastClock>2.5))reset();
    villageId=state.id;if(clock!==null)lastClock=clock;
  }
  function drawPool(pool,time,isDust){
    let active=0;
    for(const slot of pool.slots){
      if(!slot)continue;const age=(time-slot.start)/slot.life;if(age<0||age>=1)continue;
      const t=time-slot.start,fade=isDust?(.4+age*2.5)*Math.sin(Math.PI*age):(1-age)**.55;
      if(fade<.0001)continue;
      dummy.position.set(slot.x+slot.vx*t,Math.max(slot.floor??.035,slot.y+slot.vy*t-(isDust?0:3.5)*t*t),slot.z+slot.vz*t);
      dummy.rotation.set(slot.spin*t,slot.spin*t*.7,slot.spin*t*.4);dummy.scale.set(slot.size*fade*slot.stretch,slot.size*fade,slot.size*fade*.7);dummy.updateMatrix();
      pool.mesh.setMatrixAt(active,dummy.matrix);pool.mesh.setColorAt(active,slot.color);active++;
    }
    pool.mesh.count=active;pool.mesh.visible=active>0;
    if(active){pool.mesh.instanceMatrix.needsUpdate=true;pool.mesh.instanceColor.needsUpdate=true;}
  }
  function update(time){
    for(const record of records.values()){
      restore(record);if(!record.object.visible)continue;
      const wood=record.type==='timber',wheat=record.type==='wheat',elapsed=time-record.hitAt;
      if(record.wind)record.object.rotation.z+=Math.sin(time*1.4+record.wind.phase)*record.wind.amount;
      if(!wood&&!wheat&&Number.isFinite(record.previous?.remaining)){
        const fraction=clamp(record.previous.remaining/record.capacity);
        record.object.scale.x*=.84+.16*fraction;record.object.scale.y*=.6+.4*fraction;record.object.scale.z*=.84+.16*fraction;
      }
      if(elapsed>=0&&elapsed<.38){
        const shake=Math.sin(elapsed*45)*Math.exp(-elapsed*11);
        if(wood){record.object.rotation.x+=record.hitDirection.z*shake*.035;record.object.rotation.z-=record.hitDirection.x*shake*.035;}
        else if(wheat)record.object.rotation.z+=shake*.12;
        else{record.object.position.x+=record.hitDirection.x*shake*.045;record.object.position.z+=record.hitDirection.z*shake*.045;record.object.rotation.z+=shake*.015;}
      }
    }
    for(let i=ghosts.length-1;i>=0;i--){
      const g=ghosts[i],t=clamp((time-g.start)/g.duration),o=g.object;
      if(t>=1){removeGhost(i);continue;}
      o.position.copy(g.position);o.quaternion.copy(g.quaternion);o.scale.copy(g.scale);
      if(g.type==='timber'){
        const fall=clamp(t/.82),angle=(Math.PI/2-.04)*fall*fall;
        axis.set(g.direction.z,0,-g.direction.x);rotation.setFromAxisAngle(axis,angle);o.quaternion.premultiply(rotation);
        const settle=smooth(clamp((t-.75)/.25));o.scale.multiplyScalar(1-settle);o.position.y-=settle*.14;
        if(t>.73&&!g.impacted){g.impacted=true;const reach=Math.min(5,g.record.object.userData.resourceHeight*.65||4);emit(g.record,time,true,true,{x:g.position.x+g.direction.x*reach,y:g.position.y+.03,z:g.position.z+g.direction.z*reach});}
      }else if(g.type==='wheat'){
        o.rotation.z+=t*.75;o.scale.y*=1-smooth(t);o.scale.x*=1-t*.5;o.scale.z*=1-t*.5;
      }else{
        const crumble=smooth(t);o.rotation.z+=Math.sin(t*12)*(1-t)*.1;o.position.y-=crumble*.21;o.scale.x*=1-crumble*.45;o.scale.y*=1-crumble;o.scale.z*=1-crumble*.45;
      }
    }
    drawPool(chips,time,false);drawPool(dust,time,true);
  }
  function reset(){
    clearGhosts();for(const pool of [chips,dust]){pool.slots.fill(null);pool.cursor=0;pool.mesh.count=0;pool.mesh.visible=false;}
    for(const record of records.values()){restore(record);record.previous=null;record.hitAt=-Infinity;}
    villageId=undefined;lastClock=undefined;
  }
  return {root,register,remove,observe,beginSnapshot,update,reset,
    get stats(){return {events,ghosts:ghosts.length,particles:chips.mesh.count+dust.mesh.count,particleCapacity:chips.slots.length+dust.slots.length};},
    dispose(){reset();records.clear();for(const pool of [chips,dust]){pool.mesh.dispose();pool.mesh.geometry.dispose();pool.mesh.material.dispose();}parent.remove(root);}
  };
}

// Decorative plants use a separate fixed seed from buildings/resources: adding
// a flower cannot relocate a grave, change a harvestable tree, or alter a save.
// The footprint includes each mesh's full horizontal spread, not just its stem.
export function createWorldDetailLayout(lanes=[]){
  const random=seeded(58021),items=[],cellSize=6,blocked=new Map(),trees=RESOURCES.filter(n=>n.type==='timber');
  const key=(x,z)=>`${x},${z}`;
  function reserve(shape,minX,maxX,minZ,maxZ){
    for(let x=Math.floor(minX/cellSize);x<=Math.floor(maxX/cellSize);x++)for(let z=Math.floor(minZ/cellSize);z<=Math.floor(maxZ/cellSize);z++){
      const k=key(x,z);if(!blocked.has(k))blocked.set(k,[]);blocked.get(k).push(shape);
    }
  }
  function circle(x,z,r){reserve({x,z,r},x-r,x+r,z-r,z+r);}
  function rect(x,z,w,d){reserve({x,z,w,d},x-w/2,x+w/2,z-d/2,z+d/2);}
  for(const {curve,width} of lanes){
    const points=curve.getSpacedPoints(Math.ceil(curve.getLength()*2));
    for(const point of points)circle(point.x,point.z,width/2+.52);
  }
  for(const b of BUILDINGS){
    rect(b.x,b.z,b.w+1.6,b.d+1.6);
    const yaw=b.yaw??0,half=Math.abs(Math.sin(yaw))>.5?b.w/2:b.d/2;
    // The entire doorway/counter approach stays clear, including its sides.
    for(const depth of [half+.4,half+1.5,half+2.7])circle(b.x+Math.sin(yaw)*depth,b.z+Math.cos(yaw)*depth,2.25);
  }
  for(const wall of WALLS)rect(wall.x,wall.z,wall.w+.7,wall.d+.7);
  for(const area of CAVE_AREAS)rect(area.x,area.z,area.w+3,area.d+2);
  for(const plot of PLOTS){rect(plot.x,plot.z,plot.w+1.5,plot.d+1.5);const front=plotFront(plot);circle(front.x,front.z,2.1);}
  for(const n of RESOURCES)circle(n.x,n.z,n.type==='timber'?1.25:n.type==='wheat'?.65:1.95);
  circle(8,-4,6.05);circle(0,-66,8.5);rect(0,18,21,7);
  // Beds, public fields and the visiting wagon's complete parked footprint.
  rect(15.8,-14,5.6,11.5);rect(-27,-11.3,7.6,6.4);rect(21,47.5,9.5,8.1);
  rect(-14.9,-74.4,13.1,6.8);circle(20,104,13.2);
  const clear=(x,z,r)=>{
    if(x-r<WORLD_BOUNDS.minX||x+r>WORLD_BOUNDS.maxX||z-r<WORLD_BOUNDS.minZ||z+r>WORLD_BOUNDS.maxZ)return false;
    for(let gx=Math.floor((x-r)/cellSize);gx<=Math.floor((x+r)/cellSize);gx++)for(let gz=Math.floor((z-r)/cellSize);gz<=Math.floor((z+r)/cellSize);gz++)for(const block of blocked.get(key(gx,gz))??[]){
      if(block.r!==undefined?Math.hypot(x-block.x,z-block.z)<r+block.r:Math.abs(x-block.x)<block.w/2+r&&Math.abs(z-block.z)<block.d/2+r)return false;
    }
    return true;
  };
  const radii={grass:.40,fern:.64,shrub:.65,flowers:.37,litter:.63,cover:.65};
  function add(kind,x,z,scale=1,zone){
    const radius=radii[kind]*scale;if(!clear(x,z,radius))return false;
    zone??=Math.hypot(x-20,z-104)<21?'graveyard':Math.abs(x)>88||z>25||z< -89&&Math.abs(x)>13&&Math.abs(x)<33?'woodland':'village';
    items.push({kind,x,z,scale,radius,yaw:random()*Math.PI*2,variant:Math.floor(random()*3),zone});return true;
  }
  // Patches leave breathing room between clumps, instead of a uniform grid.
  for(let patch=0;patch<310;patch++){
    let x=-108+random()*216,z=-141+random()*265;
    if(patch<90&&lanes.length){
      const lane=lanes[Math.floor(random()*lanes.length)],t=random(),p=lane.curve.getPoint(t),tangent=lane.curve.getTangent(t),side=random()<.5?-1:1,offset=side*(lane.width/2+1.35+random()*2.6);
      x=p.x+tangent.z*offset;z=p.z-tangent.x*offset;
    }
    const patchRadius=2.4+random()*3.4;
    for(let blade=0;blade<16;blade++){
      const angle=random()*6.283,r=Math.sqrt(random())*patchRadius,px=x+Math.cos(angle)*r,pz=z+Math.sin(angle)*r;
      add('grass',px,pz,.6+random()*.75);
      if(blade%7===0&&Math.hypot(px-20,pz-104)>23)add('flowers',px+.38,pz-.24,.65+random()*.5);
    }
    if(patch%3===0)add('shrub',x,z,.7+random()*.5);
    if(patch%2===0)add('cover',x+.7,z+.9,1+random()*.6);
  }
  // Forest floor accents stay around trees, leaving their gathering ring open.
  for(const tree of trees)for(let i=0;i<7;i++){
    const a=random()*6.283,r=2.05+random()*2.45,x=tree.x+Math.cos(a)*r,z=tree.z+Math.sin(a)*r;
    add(i%3===0?'fern':'litter',x,z,.65+random()*.65,'woodland');
    if(i%2===0)add('grass',x+.75,z+.4,.65+random()*.6,'woodland');
  }
  // Small tended flower beds flank cottage/shop walls; their frontages remain
  // empty. No permanent landscaping is placed on player-owned building plots.
  for(const building of BUILDINGS.filter(b=>!['keep','merchant','stable','barracks'].includes(b.id))){
    const yaw=building.yaw??0,halfSide=Math.abs(Math.sin(yaw))>.5?building.d/2:building.w/2;
    for(const side of [-1,1])for(let i=0;i<8;i++){
      const across=side*(halfSide+1.6+(i%2)*.48),along=-1.5+Math.floor(i/2)*.75;
      const x=building.x+Math.cos(yaw)*across+Math.sin(yaw)*along,z=building.z-Math.sin(yaw)*across+Math.cos(yaw)*along;
      add('flowers',x,z,.9,'village');if(i%3===0)add('cover',x,z,.8,'village');
    }
  }
  // Dry, low grasses and fallen leaves frame the graveyard, not its spawn road.
  for(let i=0;i<150;i++){
    const a=random()*6.283,r=14+random()*6,x=20+Math.cos(a)*r,z=104+Math.sin(a)*r;
    add(i%3?'grass':'litter',x,z,.55+random()*.7,'graveyard');
  }
  return items;
}

// Instanced ground plants and wall ivy share a single wind uniform. Their low silhouettes and
// leaf-shaped geometry make them scenery rather than extra harvestable nodes.
export function createWorldDetails(lanes=[]){
  const root=new THREE.Group();root.name='Village gardens and woodland floor';
  const layout=createWorldDetailLayout(lanes),time={value:0};
  function geometry(kind){
    const p=[],colors=[],random=seeded(90+kind.length),green=new THREE.Color('#8fa75e'),shade=new THREE.Color('#617b43'),pale=new THREE.Color('#dcd29d');
    function triangle(a,b,c,color){p.push(...a,...b,...c);for(let i=0;i<3;i++)colors.push(color.r,color.g,color.b);}
    function leaf(a,b,width,color=green){
      const dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz)||1,nx=-dz/length*width,nz=dx/length*width;
      const mid=[(a[0]+b[0])*.5,(a[1]+b[1])*.5+.022,(a[2]+b[2])*.5];
      triangle(a,[mid[0]+nx,mid[1],mid[2]+nz],b,color);triangle(a,b,[mid[0]-nx,mid[1],mid[2]-nz],color);
    }
    if(kind==='grass')for(let i=0;i<6;i++){
      const angle=i*2.4,height=.26+random()*.34,x=(random()-.5)*.34,z=(random()-.5)*.34,lean=.11+random()*.15;
      const direction=[Math.cos(angle),Math.sin(angle)],normal=[-direction[1],direction[0]],width=.022+random()*.02;
      for(let segment=0;segment<3;segment++){
        const a=segment/3,b=(segment+1)/3,wa=width*(1-a),wb=width*(1-b),cx=x+direction[0]*lean*a*a,cz=z+direction[1]*lean*a*a,tx=x+direction[0]*lean*b*b,tz=z+direction[1]*lean*b*b;
        const left=[cx+normal[0]*wa,height*a,cz+normal[1]*wa],right=[cx-normal[0]*wa,height*a,cz-normal[1]*wa],topLeft=[tx+normal[0]*wb,height*b,tz+normal[1]*wb],topRight=[tx-normal[0]*wb,height*b,tz-normal[1]*wb];
        const c=shade.clone().lerp(green,(a+b)*.5);triangle(left,right,topLeft,c);if(segment<2)triangle(right,topRight,topLeft,c);
      }
    }
    if(kind==='fern')for(let frond=0;frond<5;frond++){
      const angle=frond*2.4,length=.44+random()*.16,dx=Math.cos(angle),dz=Math.sin(angle);
      leaf([0,0,0],[dx*length,.18,dz*length],.018,shade);
      for(let i=1;i<6;i++)for(const side of [-1,1]){
        const t=i/6,y=Math.sin(t*Math.PI)*.30+.04,width=(1-t)*.18;
        leaf([dx*length*t,y,dz*length*t],[dx*length*(t+.12)-dz*width*side,y-.06,dz*length*(t+.12)+dx*width*side],.035+width*.13,green);
      }
    }
    if(kind==='shrub')for(let stem=0;stem<6;stem++){
      const a=stem*2.4,h=.30+random()*.36,dx=Math.cos(a),dz=Math.sin(a),spread=.20+random()*.17;
      leaf([0,0,0],[dx*spread,h,dz*spread],.018,shade);
      for(let layer=1;layer<=3;layer++)for(const side of [-1,1]){
        const t=layer/3,x=dx*spread*t,z=dz*spread*t;
        leaf([x,h*t,z],[x-dz*.18*side+dx*.13,h*t+.065,z+dx*.18*side+dz*.13],.085,layer%2?green:shade);
      }
    }
    if(kind==='flowers')for(let stem=0;stem<3;stem++){
      const x=(random()-.5)*.38,z=(random()-.5)*.38,h=.25+random()*.25;
      leaf([x,0,z],[x+.03,h,z],.014,shade);leaf([x,h*.35,z],[x+.16,h*.5,z+.05],.05,green);
      for(let petal=0;petal<5;petal++){
        const a=petal*Math.PI*2/5;
        leaf([x+.03,h,z],[x+.03+Math.cos(a)*.08,h+.018,z+Math.sin(a)*.08],.04,pale);
      }
      const c=new THREE.Color('#deb753');triangle([x-.007,h+.023,z-.025],[x+.065,h+.023,z-.025],[x+.03,h+.025,z+.04],c);
    }
    if(kind==='litter')for(let i=0;i<8;i++){
      const a=random()*6.283,x=(random()-.5)*.65,z=(random()-.5)*.65;
      leaf([x,.006,z],[x+Math.cos(a)*.20,.01+random()*.015,z+Math.sin(a)*.20],.06,new THREE.Color(i%3?'#947146':'#77613d'));
    }
    if(kind==='cover')for(let i=0;i<11;i++){
      const a=i*2.4,r=.13+random()*.36,x=Math.cos(a)*r,z=Math.sin(a)*r;
      for(let petal=0;petal<3;petal++){
        const b=petal*2.094;leaf([x,.01,z],[x+Math.cos(b)*.13,.025,z+Math.sin(b)*.13],.065,i%3?green:shade);
      }
    }
    const result=new THREE.BufferGeometry();result.setAttribute('position',new THREE.Float32BufferAttribute(p,3));result.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));result.computeVertexNormals();result.computeBoundingSphere();return result;
  }
  const palette={village:['#e4ebbd','#d6dfa9','#c9ddb0'],woodland:['#aabc91','#bdcba0','#a7bf95'],graveyard:['#c4b996','#b4af8a','#a2ac8b']};
  const material=new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,side:THREE.DoubleSide,roughness:1});
  material.onBeforeCompile=shader=>{
    shader.uniforms.detailTime=time;
    shader.vertexShader='uniform float detailTime;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      #ifdef USE_INSTANCING
      float breeze = sin(detailTime * 1.45 + instanceMatrix[3].x * .29 + instanceMatrix[3].z * .17);
      transformed.x += breeze * .10 * position.y * position.y;
      transformed.z += sin(detailTime * .93 + instanceMatrix[3].z * .2) * .055 * position.y * position.y;
      #endif`);
  };
  material.customProgramCacheKey=()=> 'emberwatch-ground-foliage-v1';
  const dummy=new THREE.Object3D(),tint=new THREE.Color();let triangles=0;
  for(const kind of ['grass','fern','shrub','flowers','litter','cover']){
    const entries=layout.filter(item=>item.kind===kind);if(!entries.length)continue;
    const geo=geometry(kind),instance=new THREE.InstancedMesh(geo,material,entries.length);instance.name=`Decorative ${kind}`;instance.castShadow=false;instance.receiveShadow=true;
    for(const [i,item] of entries.entries()){
      dummy.position.set(item.x,-.125,item.z);dummy.rotation.set(0,item.yaw,0);dummy.scale.setScalar(item.scale);dummy.updateMatrix();instance.setMatrixAt(i,dummy.matrix);
      tint.set(palette[item.zone][item.variant]);if(kind==='flowers'&&item.variant===2)tint.set('#bdb3d8');instance.setColorAt(i,tint);
    }
    instance.computeBoundingBox();instance.computeBoundingSphere();instance.boundingSphere.radius+=.15;root.add(instance);triangles+=geo.attributes.position.count/3*entries.length;
  }
  // Ivy climbs only the rear corners of permanent civic/cottage buildings.
  // Keeping it off front and side facades leaves doors, signs and beds readable.
  const ivySites=BUILDINGS.filter(b=>['house1','house2','bank','church'].includes(b.id));
  const ivyGeometry=geometry('cover'),ivy=new THREE.InstancedMesh(ivyGeometry,material,ivySites.length*10),ivyPlacements=[];
  ivy.name='Decorative wall ivy';ivy.castShadow=false;ivy.receiveShadow=true;
  const wallTurn=new THREE.Quaternion(),leafTurn=new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI/2,0,0));
  for(const building of ivySites){
    const yaw=building.yaw??0,quarter=Math.abs(Math.sin(yaw))>.5,w=quarter?building.d:building.w,d=quarter?building.w:building.d;
    wallTurn.setFromAxisAngle(new THREE.Vector3(0,1,0),yaw);
    for(const side of [-1,1])for(let row=0;row<5;row++){
      const localX=side*(w/2-.72)-side*Math.sin(row*1.1)*.18,localZ=-d/2-.10;
      const x=building.x+Math.cos(yaw)*localX+Math.sin(yaw)*localZ,z=building.z-Math.sin(yaw)*localX+Math.cos(yaw)*localZ;
      dummy.position.set(x,.28+row*.39,z);dummy.quaternion.copy(wallTurn).multiply(leafTurn);dummy.scale.setScalar(.62-row*.045);dummy.updateMatrix();
      const index=ivyPlacements.length;ivy.setMatrixAt(index,dummy.matrix);ivy.setColorAt(index,tint.set(row%2?'#a7bc91':'#bbcc9e'));ivyPlacements.push({building:building.id,x,z,y:dummy.position.y});
    }
  }
  ivy.computeBoundingBox();ivy.computeBoundingSphere();root.add(ivy);triangles+=ivyGeometry.attributes.position.count/3*ivy.count;
  root.userData.ivyPlacements=ivyPlacements;
  root.userData.detailLayout=layout;root.userData.detailStats={instances:layout.length+ivy.count,drawCalls:root.children.length,triangles};
  return {root,update(seconds){time.value=Number.isFinite(seconds)?seconds:0;},time};
}

// Art-only landmarks. Their roots retain the original coordinates; every
// collider, entrance, gate lift amount and interaction stays in shared/world.
function landmarkBuilder(){
  const geometries=new Map(),materials=new Map(),textures=new Set(),owned=new Set(),v=new THREE.Vector3();
  const mat=(name,color,metalness=0,roughness=.9,grain='stone')=>{
    if(materials.has(name))return materials.get(name);
    const data=new Uint8Array(64*64);let seed=314159;
    for(let y=0;y<64;y++)for(let x=0;x<64;x++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const n=(seed&255)/255;data[y*64+x]=Math.round(grain==='wood'?128+42*Math.sin(x*.79+Math.sin(y*.17)*.62)+n*25:100+n*65+Math.sin(x*2.1+y*.73)*12);}
    const texture=new THREE.DataTexture(data,64,64,THREE.RedFormat);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;textures.add(texture);
    const m=new THREE.MeshStandardMaterial({color,metalness,roughness,bumpMap:texture,bumpScale:grain==='wood'?.016:grain==='metal'?.006:.022});m.name=name;materials.set(name,m);return m;
  };
  const geometry=(key,make)=>{if(!geometries.has(key)){const g=make();geometries.set(key,g);owned.add(g);}return geometries.get(key);};
  const add=(parent,g,m,x=0,y=0,z=0,name='')=>{const n=new THREE.Mesh(g,m);n.position.set(x,y,z);n.name=name;n.castShadow=true;n.receiveShadow=true;parent.add(n);return n;};
  const bevelBox=(w,h,d,b=.014)=>geometry(`box:${w}:${h}:${d}:${b}`,()=>{
    const s=new THREE.Shape();s.moveTo(-w/2+b,-h/2+b);s.lineTo(w/2-b,-h/2+b);s.lineTo(w/2-b,h/2-b);s.lineTo(-w/2+b,h/2-b);s.closePath();
    const g=new THREE.ExtrudeGeometry(s,{depth:d-2*b,bevelEnabled:true,bevelSize:b,bevelThickness:b,bevelSegments:1,steps:1});g.translate(0,0,-d/2+b);return g;
  });
  const box=(parent,m,x,y,z,w,h,d,b=.014,name='')=>add(parent,bevelBox(w,h,d,b),m,x,y,z,name);
  const beam=(parent,m,a,b,w=.14,d=w)=>{const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),length=start.distanceTo(end);const n=box(parent,m,0,0,0,w,length,d,Math.min(.012,w*.1));n.position.copy(start).add(end).multiplyScalar(.5);n.quaternion.setFromUnitVectors(v.set(0,1,0),end.sub(start).normalize());return n;};
  function merge(parent){
    const batches=new Map();
    for(const n of [...parent.children]){
      if(!n.isMesh||n.isInstancedMesh)continue;
      n.updateMatrix();const g=n.geometry.clone();g.applyMatrix4(n.matrix);const flat=g.index?g.toNonIndexed():g;
      if(flat!==g)g.dispose();if(!batches.has(n.material))batches.set(n.material,[]);batches.get(n.material).push(flat);parent.remove(n);
    }
    for(const [m,parts]of batches){
      const count=parts.reduce((sum,g)=>sum+g.attributes.position.count,0),g=new THREE.BufferGeometry();
      for(const [name,size]of [['position',3],['normal',3],['uv',2]]){const values=new Float32Array(count*size);let offset=0;for(const p of parts){const a=p.attributes[name];if(a)values.set(a.array,offset);offset+=p.attributes.position.count*size;}g.setAttribute(name,new THREE.BufferAttribute(values,size));}
      g.computeBoundingBox();g.computeBoundingSphere();owned.add(g);const n=add(parent,g,m);n.name=`landmark-${m.name||[...materials].find(([,value])=>value===m)?.[0]||'detail'}`;
      for(const p of parts)p.dispose();
    }
  }
  let disposed=false;
  function dispose(){if(disposed)return;disposed=true;for(const g of owned)g.dispose();for(const m of materials.values())m.dispose();for(const t of textures)t.dispose();owned.clear();}
  return {mat,geometry,add,box,beam,merge,dispose,owned};
}

export function createGateArtwork(){
  const b=landmarkBuilder(),gate=new THREE.Group(),frame=new THREE.Group();gate.name='gate-portcullis';gate.position.set(0,4.3,18.7);gate.userData.openAmount=1;frame.name='gate-hoist-and-guides';frame.position.z=18.7;
  const oak=b.mat('weathered-oak',0x695239,0,.89,'wood'),endgrain=b.mat('endgrain',0x473b2e,0,.92,'wood');
  const iron=b.mat('forged-iron',0x424c4c,.72,.64,'metal'),worn=b.mat('worn-metal-edges',0x7a8177,.64,.58,'metal'),rust=b.mat('oxide',0x6b513c,.38,.9,'metal');
  for(let i=-5;i<=5;i++){
    const x=i*1.09;
    b.box(gate,oak,x,2.68,0,.22,4.82,.27,.022,'oak-upright');
    // Each timber ends in a forged, four-sided shoe with a true pointed tip.
    const shoe=b.geometry('pointed-shoe',()=>{const p=[-.14,.55,-.17,.14,.55,-.17,.14,.55,.17,-.14,.55,.17,0,0,0],ix=[0,2,1,0,3,2,0,1,4,1,2,4,2,3,4,3,0,4];const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setIndex(ix);g.computeVertexNormals();return g;});
    b.add(gate,shoe,iron,x,0,0,'forged-pointed-shoe');
    for(const y of [.65,1.74,2.83,3.92,4.87]){
      // Iron straps wrap across the joint on both sides, with peened heads.
      for(const side of [-1,1]){
        b.box(gate,iron,x,y,side*.205,.35,.34,.07,.012,'joint-strap');
        const rivet=b.add(gate,b.geometry('peened-rivet',()=>new THREE.SphereGeometry(.046,8,6)),(i+Math.round(y))%7===0?rust:worn,x,y,side*.255,'joint-rivet');rivet.scale.z=.43;
      }
    }
  }
  for(const y of [.65,1.74,2.83,3.92,4.87])b.box(gate,oak,0,y,0,11.30,.255,.33,.021,'mortised-crossrail');
  for(const side of [-1,1]){
    b.beam(gate,iron,[0,.67,side*.206],[side*5.42,4.87,side*.206],.13,.065);
    for(const x of [-5.54,5.54])b.box(gate,iron,x,2.7,side*.195,.11,4.80,.065,.010,'edge-strap');
  }
  // The guides stay fixed while the original gate group moves vertically.
  for(const side of [-1,1]){
    const x=side*5.98;
    b.box(frame,endgrain,x,5.22,0,.38,10.38,.63,.026,'hoist-upright');
    b.box(frame,iron,x-side*.20,5.04,-.22,.075,10.05,.085,.009,'rear-guide');
    b.box(frame,iron,x-side*.20,5.04,.22,.075,10.05,.085,.009,'front-guide');
    for(const y of [.38,2.3,4.25,6.2,8.15,10.03])b.box(frame,iron,x,y,.34,.51,.14,.07,.012,'guide-bracket');
    b.box(frame,iron,x,.22,0,.55,.44,.77,.025,'guide-foot');
    b.beam(frame,oak,[x,8.94,-.32],[x-side*1.05,10.35,-.32],.20,.24);
  }
  b.box(frame,oak,0,10.34,-.18,12.58,.37,.56,.026,'hoist-header');
  b.box(frame,iron,0,10.37,.124,12.62,.115,.035,.009,'header-face-strap');
  const axle=b.add(frame,b.geometry('hoist-axle',()=>new THREE.CylinderGeometry(.11,.11,11.45,14)),iron,0,10.04,-.035,'hoist-axle');axle.rotation.z=Math.PI/2;
  for(const side of [-1,1]){
    const x=side*3.93;
    const drum=b.add(frame,b.geometry('hoist-drum',()=>new THREE.CylinderGeometry(.30,.30,.36,16)),oak,x,10.04,-.035,'chain-drum');drum.rotation.z=Math.PI/2;
    for(const shift of [-.20,.20]){const rim=b.add(frame,b.geometry('drum-rim',()=>new THREE.TorusGeometry(.31,.035,6,20)),iron,x+shift,10.04,-.035,'drum-rim');rim.rotation.y=Math.PI/2;}
    b.box(frame,iron,x,10.04,-.40,.55,.48,.12,.016,'drum-bearing');
    b.box(gate,iron,x,4.91,.01,.48,.24,.46,.02,'lifting-collar');
  }
  b.merge(gate);b.merge(frame);
  const chains=new THREE.Group();chains.name='moving-lift-chains';frame.add(chains);
  const linkGeo=b.geometry('oval-chain-link',()=>{const g=new THREE.TorusGeometry(.083,.024,6,10);g.scale(.79,1.34,1);return g;});
  const links=new THREE.InstancedMesh(linkGeo,worn,80);links.name='forged-chain-links';links.instanceMatrix.setUsage(THREE.DynamicDrawUsage);links.castShadow=true;links.receiveShadow=true;links.frustumCulled=false;chains.add(links);
  const transform=new THREE.Object3D();let previousY=NaN;
  function update(){
    chains.visible=gate.visible;
    if(gate.position.y===previousY)return;previousY=gate.position.y;
    const bottom=gate.position.y+5.055,top=10.04,length=Math.max(.07,top-bottom),step=.15;
    const count=Math.min(40,Math.max(1,Math.ceil(length/step))),spacing=length/count;
    let index=0;
    for(const side of [-1,1])for(let i=0;i<count;i++){
      transform.position.set(side*3.93,bottom+(i+.5)*spacing,.25);transform.rotation.set(0,i%2?Math.PI/2:0,0);transform.scale.set(1,Math.min(1,spacing/.15),1);transform.updateMatrix();links.setMatrixAt(index++,transform.matrix);
    }
    links.count=index;links.instanceMatrix.needsUpdate=true;
    gate.userData.chainBottom=bottom;gate.userData.chainTop=top;
  }
  update();let disposed=false;
  return {gate,frame,update,dispose(){if(disposed)return;disposed=true;b.dispose();gate.clear();frame.clear();}};
}

export function createWellArtwork(){
  const b=landmarkBuilder(),root=new THREE.Group();root.name='communal-well';root.position.set(8,0,-4);
  const stones=[0x949986,0xa5a890,0x858e80,0x9c9f89,0x8c9380].map((c,i)=>b.mat(`well-stone-${i}`,c));
  const coping=b.mat('coping-stone',0xb1b29c),mortar=b.mat('recessed-mortar',0x505950),damp=b.mat('damp-stone',0x65705e);
  const oak=b.mat('well-oak',0x705438,0,.90,'wood'),dark=b.mat('well-endgrain',0x473c2f,0,.91,'wood'),iron=b.mat('well-iron',0x4e5753,.60,.65,'metal'),rope=b.mat('hemp-rope',0x9b8866,0,1,'wood');
  function wedge(inner,outer,height,start,end,bevel=.018){
    const key=`stone:${inner}:${outer}:${height}:${start}:${end}:${bevel}`;
    return b.geometry(key,()=>{const s=new THREE.Shape();s.absarc(0,0,outer,start,end,false);s.lineTo(Math.cos(end)*inner,Math.sin(end)*inner);s.absarc(0,0,inner,end,start,true);s.closePath();const g=new THREE.ExtrudeGeometry(s,{depth:height-2*bevel,bevelEnabled:true,bevelSize:bevel,bevelThickness:bevel,bevelSegments:1,curveSegments:Math.max(2,Math.ceil((end-start)/(Math.PI*2)*24)),steps:1});g.rotateX(-Math.PI/2);g.translate(0,bevel,0);return g;});
  }
  // Solid annular masonry has top, outside, bottom and inward-facing surfaces.
  // The dark continuous backing closes tiny joints without sealing the shaft.
  b.add(root,wedge(1.115,1.472,1.12,0,Math.PI*2,.006),mortar,0,0,0,'well-mortar-ring');
  for(let row=0;row<3;row++)for(let i=0;i<16;i++){
    const angle=(i+(row%2)*.5)/16*Math.PI*2,gap=.012;
    const stone=b.add(root,wedge(1.105,1.49+Math.sin(i*2+row)*.018,.355,angle+gap,angle+Math.PI*2/16-gap),stones[(i+row*3)%stones.length],0,.02+row*.37,0,'well-masonry-course');stone.userData.course=row;
  }
  for(let i=0;i<16;i++){
    const a=i/16*Math.PI*2;
    b.add(root,wedge(1.06,1.59,.20,a+.010,a+Math.PI*2/16-.010,.023),coping,0,1.12,0,'thick-coping-stone');
  }
  b.add(root,wedge(1.11,1.20,.11,0,Math.PI*2,.005),damp,0,.035,0,'damp-inner-course');
  const waterMaterial=b.mat('well-water',0x456f70,.30,.18);waterMaterial.bumpScale=.004;
  const water=b.add(root,b.geometry('well-water-disc',()=>new THREE.CircleGeometry(1.105,48)),waterMaterial,0,.055,0,'well-water');water.rotation.x=-Math.PI/2;water.castShadow=false;
  for(const side of [-1,1]){
    b.box(root,oak,side*1.29,1.88,0,.24,3.76,.27,.022,'well-roof-post');
    b.box(root,iron,side*1.29,.30,0,.28,.22,.31,.012,'post-foot-band');
    b.beam(root,dark,[side*1.29,2.73,0],[side*.72,3.63,0],.12,.18);
    const bearing=b.add(root,b.geometry('well-axle-bearing',()=>new THREE.TorusGeometry(.135,.027,6,16)),iron,side*1.29,2.67,0,'well-bearing');bearing.rotation.y=Math.PI/2;
  }
  const spindle=b.add(root,b.geometry('well-spindle',()=>new THREE.CylinderGeometry(.103,.103,3.14,16)),oak,0,2.67,0,'well-winding-spindle');spindle.rotation.z=Math.PI/2;
  for(let i=0;i<14;i++){const wrap=b.add(root,b.geometry('rope-wrap',()=>new THREE.TorusGeometry(.116,.020,5,16)),rope,-.18+i*.030,2.67,0,'rope-wrap');wrap.rotation.y=Math.PI/2;}
  b.beam(root,iron,[1.54,2.67,0],[1.54,2.34,0],.055,.06);
  const crank=b.add(root,b.geometry('crank-handle',()=>new THREE.CylinderGeometry(.055,.055,.28,10)),dark,1.66,2.34,0,'well-crank-handle');crank.rotation.z=Math.PI/2;
  const hanging=b.add(root,b.geometry('hanging-rope',()=>new THREE.CylinderGeometry(.018,.018,1.285,8)),rope,.04,2.0275,.113,'hanging-rope');
  // Open slatted bucket: the rim is a true ring and its inside remains visible.
  b.add(root,wedge(.181,.217,.31,0,Math.PI*2,.006),oak,.04,.88,.113,'open-wooden-bucket');
  b.add(root,b.geometry('bucket-bottom',()=>new THREE.CylinderGeometry(.188,.188,.035,24)),oak,.04,.899,.113,'solid-bucket-bottom');
  for(const y of [.93,1.13]){const hoop=b.add(root,b.geometry('bucket-hoop',()=>new THREE.TorusGeometry(.221,.012,5,20)),iron,.04,y,.113,'bucket-hoop');hoop.rotation.x=Math.PI/2;}
  const handle=b.add(root,b.geometry('bucket-handle',()=>new THREE.TorusGeometry(.205,.013,5,20,Math.PI)),iron,.04,1.18,.113,'bucket-handle');handle.rotation.z=0;
  b.merge(root);root.traverse(n=>{if(n.isMesh&&n.material===waterMaterial)n.castShadow=false;});
  root.userData.innerRadius=1.06;root.userData.outerRadius=1.59;root.userData.rimHeight=1.32;
  return {root,dispose(){b.dispose();root.clear();}};
}

// Subtract the exact cave rectangle union from the surface mesh. Clipping keeps
// original elevation/color interpolation and prevents coarse-grid overcuts at
// the mouth; no opaque triangle spans the descending playable floor.
export function carveGroundForCave(geometry,areas=CAVE_AREAS){
  const position=geometry.attributes.position,color=geometry.attributes.color,index=geometry.index;
  const vertices=[],colors=[],hasColor=Boolean(color);
  const read=i=>({p:[position.getX(i),position.getY(i),position.getZ(i)],c:hasColor?[color.getX(i),color.getY(i),color.getZ(i)]:[1,1,1]});
  function split(polygon,axis,value,greater){
    const inside=[],outside=[];
    for(let i=0;i<polygon.length;i++){
      const a=polygon[i],b=polygon[(i+1)%polygon.length],ai=greater?a.p[axis]>=value:a.p[axis]<=value,bi=greater?b.p[axis]>=value:b.p[axis]<=value;
      (ai?inside:outside).push(a);
      if(ai!==bi){const t=(value-a.p[axis])/(b.p[axis]-a.p[axis]),v={p:a.p.map((n,j)=>n+(b.p[j]-n)*t),c:a.c.map((n,j)=>n+(b.c[j]-n)*t)};inside.push(v);outside.push(v);}
    }
    return {inside,outside};
  }
  const count=index?.count??position.count;
  for(let i=0;i<count;i+=3){
    let polygons=[[read(index?index.getX(i):i),read(index?index.getX(i+1):i+1),read(index?index.getX(i+2):i+2)]];
    for(const area of areas){
      const left=area.x-area.w/2,right=area.x+area.w/2,low=area.z-area.d/2,high=area.z+area.d/2,next=[];
      for(const polygon of polygons){
        if(polygon.every(v=>v.p[0]<=left)||polygon.every(v=>v.p[0]>=right)||polygon.every(v=>v.p[2]<=low)||polygon.every(v=>v.p[2]>=high)){next.push(polygon);continue;}
        let remainder=polygon;
        for(const [axis,value,greater]of[[0,left,true],[0,right,false],[2,low,true],[2,high,false]]){if(remainder.length<3)break;const parts=split(remainder,axis,value,greater);if(parts.outside.length>=3)next.push(parts.outside);remainder=parts.inside;}
      }
      polygons=next;
    }
    for(const polygon of polygons)for(let j=1;j<polygon.length-1;j++)for(const v of[polygon[0],polygon[j],polygon[j+1]]){vertices.push(...v.p);colors.push(...v.c);}
  }
  const result=new THREE.BufferGeometry();result.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));result.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));result.computeVertexNormals();result.computeBoundingSphere();return result;
}
