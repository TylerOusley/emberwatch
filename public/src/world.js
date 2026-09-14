import * as THREE from 'three';
import { BUILDINGS, WALLS, ROAD, RESOURCES, seeded } from '/shared/world.js';

// Original procedural artwork. Everything is drawn from simple, authored geometry;
// no downloaded models or textures are required to explore the village.
export function createWorld(scene) {
  const root = new THREE.Group(); root.name = 'Emberwatch • world'; scene.add(root);
  const resources = new Map(), flickers = [], wind = [], lanterns = [];
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
    cloud:mat('#d4ded2',{flatShading:true}), mountain:mat('#7b9386',{flatShading:true}), mountainLight:mat('#95a596',{flatShading:true})
  };
  const boxG = new THREE.BoxGeometry(1,1,1), cylinderG = new THREE.CylinderGeometry(1,1,1,8), coneG = new THREE.ConeGeometry(1,1,7);
  const sphereG = new THREE.IcosahedronGeometry(1,0), dummy = new THREE.Object3D();
  const batches = new Map();
  function batch(geo,material,x,y,z,sx=1,sy=1,sz=1,rx=0,ry=0,rz=0) {
    const key=geo.uuid+material.uuid;
    if(!batches.has(key)) batches.set(key,{geo,material,transforms:[]});
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
    const x=gp.getX(i),z=gp.getZ(i),outside=Math.max(0,Math.abs(x)-67, -z-61,z-125);
    gp.setY(i,-.14+Math.sin(x*.05)*Math.cos(z*.043)*Math.min(outside*.09,4));
    const n=rng(),c=color(n>.72?'#82975c':n>.34?'#728b50':'#657d49');c.multiplyScalar(.94+rng()*.12);gc.push(c.r,c.g,c.b);
  }
  groundG.setAttribute('color',new THREE.Float32BufferAttribute(gc,3));groundG.computeVertexNormals();
  const ground=mesh(groundG,mat('#ffffff',{vertexColors:true,flatShading:true}));ground.castShadow=false;

  function road(points,width=7,y=.014){
    const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(p.x,y,p.z)),false,'centripetal');
    const len=curve.getLength(),steps=Math.ceil(len*2),pos=[],uv=[],indices=[];
    for(let i=0;i<=steps;i++){
      const t=i/steps,p=curve.getPoint(t),tan=curve.getTangent(t),nx=tan.z,nz=-tan.x;
      pos.push(p.x+nx*width/2,y,p.z+nz*width/2,p.x-nx*width/2,y,p.z-nz*width/2);uv.push(0,t*len/5,width/5,t*len/5);
      if(i<steps){let j=i*2;indices.push(j,j+1,j+2,j+1,j+3,j+2);}
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();
    const o=mesh(g,roadMat);o.castShadow=false;
    // Irregular stone edging gives the lane an authored, old-world outline.
    for(let i=0;i<len/1.15;i++)for(const side of [-1,1]){
      const t=i/(len/1.15),p=curve.getPoint(t),tan=curve.getTangent(t),off=width/2+.08;
      box(i%4?M.stone:M.moss,p.x+tan.z*off*side,.045,p.z-tan.x*off*side,.38,.13,.88,Math.atan2(tan.x,tan.z));
    }
    return curve;
  }
  const mainRoad=road([...ROAD].reverse(),7.2);
  road([{x:-29,z:-3},{x:-11,z:-3},{x:0,z:-3}],3.5);
  road([{x:0,z:-14},{x:12,z:-14},{x:22,z:-6}],3.2);
  road([{x:-18,z:-17},{x:-9,z:-15},{x:0,z:-15}],3.3);
  road([{x:0,z:6},{x:8,z:7},{x:13,z:11}],3.1);
  // Paved square around the communal well, completely outside the central lane.
  const paving=mesh(new THREE.CircleGeometry(5.7,16),roadMat,root,8,.018,-4);paving.rotation.x=-Math.PI/2;

  // Mountain shoulders shelter the keep; silhouettes stay outside playable bounds.
  const mountainG=new THREE.ConeGeometry(1,1,6);
  for(let i=0;i<31;i++){
    const x=-175+i*12,z=-91-rng()*25,h=23+rng()*43;
    batch(mountainG,i%3?M.mountain:M.mountainLight,x,h/2-3,z,18+rng()*12,h,18+rng()*15,0,rng()*Math.PI,0);
    if(i%4===0)batch(mountainG,M.stoneLight,x,h*.83-3,z,6.4,h*.34,6.4,0,.2,0);
  }
  for(const side of [-1,1])for(let i=0;i<10;i++)batch(mountainG,M.mountain,side*(93+rng()*35),13+rng()*7,-46+i*19,16+rng()*20,29+rng()*24,20+rng()*18,0,rng()*3,0);

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
  turret(-36,18,1.9,1.9,6.2,false);turret(36,18,1.9,1.9,6.2,false);
  turret(-36,-50,1.9,1.9,6.2,false);turret(36,-50,1.9,1.9,6.2,false);
  box(M.stoneDark,0,6.05,18,11.7,2,3.8);box(M.stoneLight,0,7.18,18,11.7,.33,4.05);
  for(let i=-5;i<=5;i+=2)box(M.stoneLight,i,7.83,18.9,.9,1,1);
  // Stone voussoirs frame an open passage beneath the raised portcullis.
  for(let i=0;i<9;i++){
    const a=Math.PI*(i+.5)/9;
    box(M.stoneLight,Math.cos(a)*5.28,3.78+Math.sin(a)*1.35,20.02,1.22,.63,.45,0,(a-Math.PI/2)*.24);
  }
  const gate=new THREE.Group();gate.name='gate-portcullis';gate.position.set(0,.25,18.7);root.add(gate);
  for(let i=-5;i<=5;i++)localBox(gate,M.iron,i,2.5,0,.15,5.1,.18);
  for(const y of [.65,1.75,2.85,4,4.8])localBox(gate,M.woodDark,0,y,0,10.2,.2,.26);
  for(const x of [-4.5,4.5])localBox(gate,M.iron,x,2.7,.18,.2,4.7,.16);
  gate.userData.openAmount=1;gate.position.y=4.3;
  banner(-8,6.9,20.65,1.35,2.7);banner(8,6.9,20.65,1.35,2.7);

  function roof(x,z,w,d,base,h,material=M.roof){
    const geo=new THREE.BufferGeometry();const a=w/2,b=d/2;
    geo.setAttribute('position',new THREE.Float32BufferAttribute([-a,0,b,a,0,b,0,h,b,-a,0,-b,a,0,-b,0,h,-b],3));
    geo.setIndex([0,1,2,3,5,4,0,2,5,0,5,3,2,1,4,2,4,5,0,3,4,0,4,1]);geo.computeVertexNormals();mesh(geo,material,root,x,base,z);
    beam(M.woodDark,[x-a,base,z+b+.025],[x,base+h,z+b+.025],.19);beam(M.woodDark,[x+a,base,z+b+.025],[x,base+h,z+b+.025],.19);
    box(M.roofDark,x,base+h+.06,z,.26,.2,d+.2);
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
  }
  function door(x,z,y=.65,w=1.55,h=2.4){
    box(M.stoneDark,x,y+h/2,z,w+.5,h+.3,.15);box(M.woodDark,x,y+h/2,z+.11,w,h,.1);
    for(let i=0;i<5;i++)box(M.wood,x-w/2+(i+.5)*w/5,y+h/2,z+.18,w/5-.045,h,.07);
    box(M.iron,x,y+.4,z+.24,w,.13,.06);box(M.iron,x,y+h-.4,z+.24,w,.13,.06);
    batch(sphereG,M.copper,x+w*.27,y+h*.45,z+.3,.1,.1,.08);
    box(M.stoneLight,x,.16,z+.6,w+.65,.32,1);box(M.stone,x,.38,z+.22,w+.36,.42,.55);
  }
  function sign(text,x,y,z,w=3.1){
    const texture=canvasTexture((ctx,cw,ch)=>{
      ctx.fillStyle='#332c24';ctx.fillRect(0,0,cw,ch);ctx.strokeStyle='#ac8d56';ctx.lineWidth=9;ctx.strokeRect(9,9,cw-18,ch-18);
      ctx.fillStyle='#e8d7ac';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='600 43px Georgia';ctx.fillText(text,cw/2,ch/2,cw-42);
    },512,112);
    const sm=new THREE.MeshStandardMaterial({map:texture,roughness:1});mesh(new THREE.BoxGeometry(w,.67,.16),M.woodDark,root,x,y,z);mesh(new THREE.PlaneGeometry(w-.07,.6),sm,root,x,y,z+.086);
  }
  function chimney(x,z,y){
    masonry(x,z,1.15,1.8,1.05); // Base instance is hidden inside building; upper stack follows.
    box(M.stone,x,y+1.5,z,1.1,3,1);box(M.stoneLight,x,y+3.04,z,1.35,.28,1.2);box(M.woodDark,x,y+3.2,z,.83,.05,.72);
  }
  function cottage(b){
    const {x,z,w,d}=b,h=b.kind==='bank'?5.7:4.8,front=z+d/2;
    box(M.stoneDark,x,.4,z,w+.16,.8,d+.16);box(b.kind==='bank'?M.stoneLight:M.plaster,x,h/2+.4,z,w,h,d);
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
    } else if(b.kind==='bank') {sign('TREASURY',x,3.38,front+.2,3.5);banner(x-w*.45,3.6,front+.21,.8,1.7,M.blue);}
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
    for(const dx of [-1,1])for(let i=0;i<3;i++)box(M.stoneLight,x+dx*(w/2-.18),2.6,z-d/2+2+i*4.7,.6,5.2,1);
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
  for(const b of BUILDINGS){if(b.kind==='keep')keep(b);else if(b.kind==='church')church(b);else if(b.kind==='barracks')barracks(b);else cottage(b);}

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
  const wellG=new THREE.CylinderGeometry(1.45,1.55,1.15,12,1,true);mesh(wellG,M.stoneLight,root,wx,.575,wz);
  const wellInside=mesh(new THREE.CylinderGeometry(1.34,1.34,.02,16),M.water,root,wx,.55,wz);wellInside.castShadow=false;
  for(const side of [-1,1])box(M.woodDark,wx+side*1.2,1.85,wz,.2,3.7,.23);
  roof(wx,wz,3.6,2.7,3.6,1.3);beam(M.woodLight,[wx-1.3,2.6,wz],[wx+1.3,2.6,wz],.16);
  cylinder(M.woodDark,wx,1.9,wz,.025,1.4);mesh(new THREE.CylinderGeometry(.23,.18,.36,8),M.wood,root,wx,1.13,wz);

  function lamp(x,z,h=3.4){
    cylinder(M.stoneDark,x,.19,z,.26,.38);box(M.woodDark,x,h/2,z,.13,h,.14);box(M.iron,x+.3,h,z,.8,.1,.1);
    const glow=mesh(new THREE.BoxGeometry(.3,.47,.3),M.embers,root,x+.57,h-.48,z);glow.castShadow=false;
    box(M.iron,x+.57,h-.77,z,.43,.1,.43);box(M.iron,x+.57,h-.18,z,.45,.1,.45);
    for(const dx of [-1,1])for(const dz of [-1,1])box(M.iron,x+.57+dx*.15,h-.48,z+dz*.15,.045,.55,.045);
    const light=new THREE.PointLight('#ffbe70',0,9,2);light.position.set(x+.57,h-.48,z);root.add(light);lanterns.push(light);
    const halo=mesh(new THREE.SphereGeometry(.25,6,4),new THREE.MeshBasicMaterial({color:'#ffce7e',transparent:true,opacity:.07,depthWrite:false}),root,x+.57,h-.48,z,2.5,2.5,2.5);flickers.push({o:halo,phase:rng()*6});
  }
  for(const [x,z] of [[-4.6,13],[4.5,13],[-4.5,25],[4.5,25],[-4.8,-10],[4.6,-28],[-11,-4],[12,-5],[10,56],[20,93]])lamp(x,z);

  // Merge the few primitive pieces in each resource by material. A harvest hides
  // one complete object, while the field remains inexpensive to draw.
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
    const o=mergeParts(parts);o.position.set(x,0,z);o.rotation.y=rotation;root.add(o);wind.push({o,phase:r()*6.28,amount:.007});return o;
  }
  function wheat(x,z,seed){
    const r=seeded(seed),parts=[];
    for(let i=0;i<4;i++){
      const dx=(r()-.5)*.42,dz=(r()-.5)*.42,h=.72+r()*.25;
      parts.push(part(cylinderG,M.wheat,dx,h*.48,dz,.025,h,.025,0,(r()-.5)*.17));
      parts.push(part(sphereG,M.wheatTip,dx,h,dz,.074,.22,.068,r()*3));
      parts.push(part(coneG,M.wheat,dx-.06,h*.53,dz,.07,.4,.015,0,-.47));
    }
    const o=mergeParts(parts);o.position.set(x,.025,z);root.add(o);wind.push({o,phase:r()*6.28,amount:.045});return o;
  }
  for(const n of RESOURCES){
    let object;
    if(n.type==='timber')object=tree(n.x,n.z,n.seed);
    else if(n.type==='wheat')object=wheat(n.x,n.z,n.seed);
    else{
      const r=seeded(n.seed),parts=[];
      for(let j=0;j<3;j++)parts.push(part(sphereG,j%2?M.stoneLight:M.stone,(r()-.5)*.65,.3+r()*.28,(r()-.5)*.55,.4+r()*.4,.4+r()*.4,.35+r()*.45,r()*3));
      object=mergeParts(parts);object.position.set(n.x,0,n.z);root.add(object);
    }
    object.userData.resourceId=n.id;resources.set(n.id,object);
  }
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
  for(let i=0;i<53;i++){const side=i%2?1:-1;tree(side*(62+rng()*32),-36+rng()*161,20000+i,true);}
  const grassG=new THREE.BufferGeometry();grassG.setAttribute('position',new THREE.Float32BufferAttribute([-.065,0,0,.065,0,0,.025,.48,0,0,0,-.07,0,0,.07,.03,.34,0],3));grassG.setIndex([0,1,2,3,4,5]);grassG.computeVertexNormals();
  const grassMat=mat('#789a53',{side:THREE.DoubleSide});
  for(let i=0;i<1450;i++){
    const x=-60+rng()*120,z=-47+rng()*160;
    const nearRoad=mainRoad.getPoints(70).some(p=>Math.abs(p.x-x)<5&&Math.abs(p.z-z)<4.2);
    const occupied=BUILDINGS.some(b=>Math.abs(x-b.x)<b.w/2+1.3&&Math.abs(z-b.z)<b.d/2+1.3);
    if(nearRoad||occupied||Math.abs(z-18)<2||Math.abs(x)>34&&z<18||x>16&&x<27&&z>43&&z<52||x> -31&&x< -23&&z> -15&&z< -8)continue;
    batch(grassG,grassMat,x,.015,z,.6+rng()*.8,.45+rng()*.9,.6+rng()*.8,0,rng()*6.28,0);
    if(i%23===0){batch(sphereG,i%2?M.fabricLight:M.purple,x,.3,z,.075,.06,.075);}
  }
  // Graveyard: the only incoming route, readable from the road and gate.
  const graveX=20,graveZ=104;
  const graveGround=mesh(new THREE.CircleGeometry(14,15),mat('#6e7960'),root,graveX,.005,graveZ);graveGround.rotation.x=-Math.PI/2;graveGround.castShadow=false;
  for(const side of [-1,1]){
    cylinder(M.stoneDark,graveX+side*4.1,2,graveZ-4.5,.55,4);batch(sphereG,M.stoneLight,graveX+side*4.1,4.2,graveZ-4.5,.6,.6,.6);
    fence(graveX+side*5.2,graveZ-3.5,9,true);
  }
  beam(M.iron,[graveX-4.1,4,graveZ-4.5],[graveX+4.1,4,graveZ-4.5],.13);
  sign('THE HOLLOW',graveX,4.7,graveZ-4.5,4.15);
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
  for(const {geo,material,transforms} of batches.values()){
    const instance=new THREE.InstancedMesh(geo,material,transforms.length);transforms.forEach((m,i)=>instance.setMatrixAt(i,m));instance.castShadow=material!==grassMat;instance.receiveShadow=true;instance.computeBoundingSphere();root.add(instance);
  }
  let previousNight=-1;
  function update(time,nightAmount=0,state={}){
    const t=time,night=THREE.MathUtils.clamp(nightAmount,0,1);
    for(const item of wind){if(item.o.visible)item.o.rotation.z=Math.sin(t*1.4+item.phase)*item.amount;}
    for(const item of flickers){item.o.material.opacity=.035+night*.1+Math.sin(t*6+item.phase)*.01;}
    if(Math.abs(night-previousNight)>.025){M.glass.emissiveIntensity=.35+night*1.3;M.embers.emissiveIntensity=1+night*1.7;for(const l of lanterns)l.intensity=night*13;previousNight=night;}
    const raw=state.resources;
    if(raw){
      const entries=Array.isArray(raw)?raw:Object.entries(raw).map(([id,value])=>typeof value==='object'?{id,...value}:{id,available:value});
      for(const n of entries){const o=resources.get(n.id);if(o){const available=n.available??n.active??n.alive??(n.remaining!==undefined?n.remaining>0:n.hp!==undefined?n.hp>0:true);o.visible=Boolean(available);}}
    }
    const gateHP=state.gateHp??state.gateHP??state.gate?.hp??state.gateHealth??1200;
    gate.visible=gateHP>0;
    const players=Array.isArray(state.players)?state.players:Object.values(state.players||{}),guards=Array.isArray(state.guards)?state.guards:Object.values(state.guards||{});
    const nearby=[...players,...guards].some(p=>Math.abs((p.x??p.position?.x??999))<6.2&&Math.abs((p.z??p.position?.z??999)-18)<7);
    const target=nearby?1:0;
    gate.userData.openAmount=THREE.MathUtils.lerp(gate.userData.openAmount,target,.065);gate.position.y=.1+gate.userData.openAmount*4.7;
  }
  return {root,resources,gate,update,road:mainRoad,lanterns};
}
