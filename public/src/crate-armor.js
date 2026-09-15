import * as THREE from 'three';

// Original fitted crate-display armor. This module builds models only; it does
// not equip a live character, grant inventory, or change gameplay statistics.
const TAU=Math.PI*2;
const mix=(a,b,t)=>a+(b-a)*t;
const smooth=t=>(t=Math.max(0,Math.min(1,t)),t*t*(3-2*t));
const ids=new Set(['riveted_vest','tempered_cuirass','runeforged_cuirass','stout_leather_boots','guardians_boots']);

function surface(rows,columns,sample,{reverse=false,grain=0}={}) {
  const positions=[],uvs=[],colors=[],indices=[];
  for(let row=0;row<=rows;row++)for(let column=0;column<=columns;column++) {
    const u=column/columns,v=row/rows,p=sample(u,v),tint=1-grain*.5+grain*(Math.sin(u*157.7+v*311.3)*Math.sin(u*79.1-v*41.5)*.5+.5);
    positions.push(...p);uvs.push(u,v);colors.push(tint,tint,tint);
  }
  for(let row=0;row<rows;row++)for(let column=0;column<columns;column++) {
    const a=row*(columns+1)+column,b=a+columns+1;
    indices.push(...(reverse?[a,b,a+1,a+1,b,b+1]:[a,a+1,b,a+1,b+1,b]));
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}
function interpolate(sections,y) {
  if(y<=sections[0][0])return sections[0].slice(1);if(y>=sections.at(-1)[0])return sections.at(-1).slice(1);
  let i=0;while(sections[i+1][0]<y)i++;const a=sections[i],b=sections[i+1],t=smooth((y-a[0])/(b[0]-a[0]));return a.slice(1).map((n,j)=>mix(n,b[j+1],t));
}
function shell(sections,{rows=30,segments=48,power=1,folds=0,bevel=0}={}) {
  return surface(rows,segments,(u,v)=>{
    const angle=u*TAU,y=mix(sections[0][0],sections.at(-1)[0],v),[width,depth,center=0]=interpolate(sections,y),sn=Math.sin(angle),cs=Math.cos(angle);
    const crease=folds*Math.sin(angle*10+v*6)*(1-smooth(v*.8)),edge=bevel*Math.sin(Math.min(1,v*12)*Math.PI/2)*Math.sin(Math.min(1,(1-v)*12)*Math.PI/2);
    return [Math.sign(sn)*Math.abs(sn)**power*(width+crease+edge),y,Math.sign(cs)*Math.abs(cs)**power*(depth+crease*.5+edge)+center];
  },{grain:folds?.05:.012});
}
function ribbon(points,width,depth=.001) {
  const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));
  return surface(Math.max(16,points.length*7),4,(u,v)=>{
    const p=curve.getPoint(v),t=curve.getTangent(v),side=new THREE.Vector3(t.y,-t.x,0);if(side.lengthSq()<.01)side.set(1,0,0);else side.normalize();
    p.addScaledVector(side,(u-.5)*width);p.z+=depth+Math.sin(u*Math.PI)*.0015;return p.toArray();
  });
}
function strap(points,width) {
  const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));
  return surface(36,5,(u,v)=>{const p=curve.getPoint(v);p.x+=(u-.5)*width;p.y+=Math.sin(u*Math.PI)*.002;return p.toArray();});
}
function frontPoint(u,v,{back=false,offset=0,lame=false}={}) {
  const s=u*2-1,shoulder=.385+.059*Math.sin(v*Math.PI)-.004*s*s,x=s*shoulder;
  const y=mix(lame?-.22:-.14,.445,v)-.115*(1-Math.abs(s))**3*smooth((v-.67)/.33);
  // Flatter front clears the villager apron; cut-away armholes retain the
  // shoulder joints. A center ridge produces actual forged highlights.
  const curve=Math.max(.05,1-.69*s*s)**.28;
  const z=(.328+.012*Math.sin(v*Math.PI))*curve+.021*(1-Math.abs(s))**3+offset;
  return [x,y,back?-z*.91:z];
}
function breastplate({back=false,offset=0,lame=false}={}) {return surface(34,44,(u,v)=>frontPoint(u,v,{back,offset,lame}),{reverse:back,grain:.026});}

export function createArmor(id) {
  if(!ids.has(id))throw new Error(`Unknown crate armor: ${String(id)}`);
  const legendary=id==='runeforged_cuirass'||id==='guardians_boots',boots=id.endsWith('_boots');
  const parts=[],ownedMaterials=new Set(),ownedGeometry=new Set(),ownedTextures=new Set(),batches=new Map();let disposed=false;
  const makeMaterial=(color,metalness=0,roughness=.7,emissive=null)=>{
    const m=new THREE.MeshStandardMaterial({color,metalness,roughness,vertexColors:true,side:THREE.DoubleSide,...(emissive?{emissive,emissiveIntensity:.2}:{})});ownedMaterials.add(m);return m;
  };
  const leather=makeMaterial(0x76503a,.015,.86),leatherDark=makeMaterial(0x362b25,.015,.88),stitch=makeMaterial(0xbd9b67,.10,.72);
  const steel=makeMaterial(legendary?0x526b78:id==='riveted_vest'?0x8d9898:0xa4b6bb,.86,legendary?.31:.34);
  const edge=makeMaterial(legendary?0xd3b46e:0x697f88,.88,legendary?.28:.4),inlay=makeMaterial(0x82d6d0,.47,.23,0x399f9b);
  // Tiny deterministic pores create leather response without canvas or files.
  if(id==='riveted_vest'||id==='stout_leather_boots') {
    const data=new Uint8Array(64*64*4);for(let y=0;y<64;y++)for(let x=0;x<64;x++){const a=(y*64+x)*4,n=135+Math.round(Math.sin(x*42.17+y*131.29)*Math.sin(x*9.9-y*27.8)*30);data[a]=data[a+1]=data[a+2]=n;data[a+3]=255;}
    const texture=new THREE.DataTexture(data,64,64);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(3,3);texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;ownedTextures.add(texture);leather.bumpMap=texture;leather.bumpScale=.0025;
  }
  function part(bone,label) {const object=new THREE.Group();object.name=`crate-${id}-${label}`;object.userData={crateArmor:id,attachmentBone:bone};const p={bone,object};parts.push(p);batches.set(object,new Map());return object;}
  function add(parent,geometry,mat,position=null,scale=null,rotation=null) {
    if(position||scale||rotation){const transform=new THREE.Object3D();if(position)transform.position.set(...position);if(scale)transform.scale.set(...scale);if(rotation)transform.rotation.set(...rotation);transform.updateMatrix();geometry.applyMatrix4(transform.matrix);}
    const map=batches.get(parent);if(!map.has(mat))map.set(mat,[]);map.get(mat).push(geometry);
  }
  function stud(parent,p,mat=edge,r=.006) {add(parent,new THREE.SphereGeometry(r,9,6),mat,p,[1,1,.60]);}
  function seam(parent,points,mat=stitch,width=.003) {add(parent,ribbon(points,width,.003),mat);}
  function rivetStrip(parent,points,count,mat=edge) {const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));for(let i=0;i<count;i++)stud(parent,curve.getPoint((i+.5)/count).toArray(),mat);}
  function buckle(parent,x,y,z,mat=edge,width=.065,height=.047) {
    const points=[[-width/2,-height/2],[width/2,-height/2],[width/2,height/2],[-width/2,height/2],[-width/2,-height/2]];
    add(parent,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(([dx,dy])=>new THREE.Vector3(x+dx,y+dy,z)),false,'catmullrom',.05),28,.004,5,false),mat);
    seam(parent,[[x,y-height*.40,z+.004],[x,y+height*.35,z+.004]],mat,.005);
  }
  if(!boots) {
    const body=part('body','cuirass'),riveted=id==='riveted_vest';
    // Side gussets bridge front and back below the arms. Shoulder straps are
    // separate curved bands, leaving both shoulder pivots unobstructed.
    add(body,shell([[-.185,.386,.320],[-.08,.390,.322],[.1,.438,.310],[.20,.444,.275]],{rows:26,segments:52,power:.91,folds:riveted?.002:0}),riveted?leather:leatherDark);
    for(const side of [-1,1]) {
      add(body,strap([[side*.288,.22,.306],[side*.298,.37,.281],[side*.281,.484,.199],[side*.254,.504,.033],[side*.270,.474,-.184],[side*.292,.33,-.278]],.072),riveted?leather:steel);
      seam(body,[[side*.270,.26,.328],[side*.279,.37,.300],[side*.262,.447,.224]],riveted?stitch:edge,.0035);
      buckle(body,side*.291,.31,.328,edge,.057,.042);
    }
    if(riveted) {
      // Overlapping, individually curved iron panels over a soft leather vest.
      for(let panel=0;panel<6;panel++) {
        const start=panel/6+.006,end=(panel+1)/6-.006;
        add(body,surface(26,8,(u,v)=>frontPoint(mix(start,end,u),v)),steel);
        const border=[frontPoint(start,.07,{offset:.004}),frontPoint(start,.48,{offset:.004}),frontPoint(start,.92,{offset:.004})];
        rivetStrip(body,border,4,edge);
      }
      add(body,breastplate({back:true,offset:-.005}),leather);
      for(const v of [.07,.9]){const points=Array.from({length:14},(_,i)=>frontPoint(i/13,v,{offset:.006}));seam(body,points,leatherDark,.011);rivetStrip(body,points,13,edge);}
      for(const side of [-1,1])for(let i=0;i<4;i++)seam(body,[[side*.408,-.1+i*.06,.137],[side*.427,-.08+i*.06,.145]],stitch,.003);
    } else {
      add(body,breastplate({lame:true}),steel);add(body,breastplate({back:true,lame:true}),steel);
      // A rolled perimeter and crown neckline have geometric width and relief.
      for(const back of [false,true])for(const v of [0,1])seam(body,Array.from({length:22},(_,i)=>frontPoint(i/21,v,{back,offset:.006,lame:true})),edge,.014);
      for(const side of [-1,1])seam(body,Array.from({length:15},(_,i)=>frontPoint(side<0?0:1,i/14,{offset:.005,lame:true})),edge,.013);
      seam(body,[[0,-.18,.363],[0,-.02,.369],[0,.15,.373],[0,.29,.367]],edge,.013);
      // Three articulated-looking waist lames stop above the hip pivots. They
      // are rigid to the torso; the knees, legs, and apron beneath remain free.
      for(let i=0;i<3;i++) {
        const y=-.06-i*.054;
        add(body,surface(5,34,(u,v)=>{const s=u*2-1;return [s*(.361+i*.008),y-v*.057+.009*(1-s*s),.370*(1-.65*s*s)**.28+.010+i*.004];}),i===1?edge:steel);
      }
      if(legendary) {
        // Raised angular knotwork follows the forged chest. The illuminated
        // strokes are shallow inlays, not floating particles or lights.
        for(const side of [-1,1]) {
          seam(body,[[side*.025,.235,.373],[side*.103,.177,.370],[side*.194,.221,.343],[side*.273,.162,.324],[side*.194,.082,.349],[side*.094,.118,.372]],edge,.013);
          seam(body,[[side*.049,.222,.383],[side*.110,.180,.380],[side*.184,.214,.353]],inlay,.0045);
          seam(body,[[side*.13,.03,.370],[side*.21,-.008,.350],[side*.278,.038,.330]],edge,.009);
        }
        add(body,new THREE.OctahedronGeometry(.039,1),inlay,[0,.163,.393],[.76,1.28,.33]);
        for(const side of [-1,1])for(const y of [.365,-.133])stud(body,[side*.30,y,.302],edge,.007);
      } else {
        for(const side of [-1,1]) {
          seam(body,[[side*.075,.275,.354],[side*.163,.236,.350],[side*.270,.188,.327]],edge,.008);
          stud(body,[side*.329,.278,.268],edge,.008);stud(body,[side*.324,-.17,.279],edge,.008);
        }
      }
    }
    const belt=shell([[-.206,.397,.325],[-.188,.401,.331],[-.158,.400,.330],[-.147,.394,.323]],{rows:7,segments:48,power:.88});
    if(!riveted)belt.translate(0,-.052,0);add(body,belt,leatherDark);
    buckle(body,.055,riveted?-.174:-.226,riveted?.353:.387,edge,.086,.049);
  } else {
    for(const [side,prefix] of [[1,'left'],[-1,'right']]) {
      const foot=part(prefix+'Foot',prefix+'-shoe'),shin=part(prefix+'Shin',prefix+'-cuff'),guard=id==='guardians_boots';
      const shoeSections=[[-.150,.145,.227,.091],[-.143,.155,.237,.093],[-.124,.160,.240,.095],[-.088,.157,.237,.095],[-.042,.145,.221,.082],[.010,.130,.191,.064],[.063,.121,.157,.032],[.125,.119,.138,-.002]];
      const footFront=(x,y,offset=.004)=>{const [width,depth,center=0]=interpolate(shoeSections,y),sn=Math.min(.999,Math.abs(x)/width)**(1/.84);return [x,y,Math.sqrt(1-sn*sn)**.84*depth+center+offset];};
      add(foot,shell(shoeSections,{rows:34,segments:48,power:.84,folds:guard?0:.002}),guard?steel:leather);
      // Grounded sole matches the existing rig's -0.152 foot-floor reference.
      add(foot,shell([[-.152,.143,.226,.091],[-.150,.155,.236,.091],[-.134,.162,.244,.093],[-.119,.161,.243,.093]],{rows:7,segments:48,power:.79}),leatherDark);
      const solePositions=[0,-.152,.091],soleIndices=[];for(let i=0;i<48;i++){const a=i/48*TAU;solePositions.push(Math.sign(Math.sin(a))*Math.abs(Math.sin(a))**.79*.145,-.152,Math.sign(Math.cos(a))*Math.abs(Math.cos(a))**.79*.227+.091);soleIndices.push(0,(i+1)%48+1,i+1);}
      const soleCap=new THREE.BufferGeometry();soleCap.setAttribute('position',new THREE.Float32BufferAttribute(solePositions,3));soleCap.setIndex(soleIndices);soleCap.computeVertexNormals();add(foot,soleCap,leatherDark);
      add(foot,shell([[-.127,.162,.245,.093],[-.116,.163,.246,.093],[-.107,.158,.241,.093]],{rows:6,segments:48,power:.80}),guard?edge:stitch);
      // Toe-cap seam wraps a sculpted, asymmetric instep rather than a box.
      const toePoints=Array.from({length:19},(_,i)=>{const a=mix(-1.12,1.12,i/18);return footFront(Math.sin(a)*.145,-.034-Math.abs(Math.sin(a))*.028);});
      seam(foot,toePoints,guard?edge:stitch,guard?.008:.003);
      const cuffSections=[[-.215,.127,.147,.013],[-.166,.129,.148,.010],[-.09,.137,.149,.003],[.002,.145,.153,0],[.039,.146,.153,0],[.054,.139,.147,0]];
      add(shin,shell(cuffSections,{rows:26,segments:44,power:.94,folds:guard?0:.003}),guard?steel:leather);
      add(shin,shell([[.030,.147,.155,0],[.045,.151,.159,0],[.062,.147,.155,0],[.067,.140,.149,0]],{rows:7,segments:44,power:.94}),guard?edge:stitch);
      if(guard) {
        for(let i=0;i<3;i++)add(foot,surface(6,24,(u,v)=>{const s=u*2-1;return footFront(s*(.121-i*.007),.002+i*.030-v*.035,.008+Math.sin(v*Math.PI)*.003+i*.001);}),i===1?edge:steel);
        for(const direction of [-1,1])seam(shin,[[direction*.047,.037,.154],[direction*.073,-.018,.154],[direction*.044,-.09,.160],[direction*.062,-.162,.157]],edge,.009);
        seam(shin,[[0,.033,.164],[-.030,-.012,.171],[0,-.068,.174],[.030,-.012,.171],[0,.033,.164]],inlay,.0045);
        seam(shin,[[0,-.069,.176],[0,-.160,.166]],inlay,.0038);
        for(const x of [-.105,.105])stud(shin,[x,-.097,.119],edge,.006);
      } else {
        // Crossed laces follow the foot/shin split so they never bridge the
        // animated ankle. Raised eyelets and tiny welt stitches catch light.
        for(let i=0;i<3;i++) {
          const y=-.011+i*.036;
          seam(foot,[footFront(-.061,y,.006),footFront(0,y+.004,.009),footFront(.061,y+.022,.006)],stitch,.004);
          seam(foot,[footFront(.061,y,.006),footFront(0,y+.009,.010),footFront(-.061,y+.022,.006)],stitch,.004);
          for(const x of [-.061,.061])stud(foot,footFront(x,y,.005),stitch,.005);
        }
        for(let i=0;i<4;i++){const y=-.183+i*.051;seam(shin,[[-.060,y,.154],[0,y+.02,.169],[.060,y+.037,.156]],stitch,.004);}
        add(shin,ribbon([[side*.106,-.050,.115],[side*.068,-.056,.147],[0,-.057,.164],[-side*.07,-.056,.143]],.025),leatherDark);
        buckle(shin,side*.052,-.056,.169,stitch,.049,.032);
        const welt=Array.from({length:23},(_,i)=>{const a=mix(-2.0,2.0,i/22);return [Math.sin(a)*.160,-.120,.092+Math.cos(a)*.243];});
        for(let i=0;i<welt.length-1;i+=2)seam(foot,[welt[i],welt[i+1]],stitch,.0023);
      }
    }
  }
  // Batch every material per attachment, while each ankle retains two
  // independently moving pieces. All finished resources belong to this item.
  for(const {object} of parts)for(const [mat,geometries] of batches.get(object)) {
    const attributes={position:[],normal:[],uv:[],color:[]};
    for(const source of geometries) {
      const geometry=source.index?source.toNonIndexed():source;if(!geometry.attributes.normal)geometry.computeVertexNormals();
      const count=geometry.attributes.position.count;
      for(let i=0;i<count;i++){attributes.position.push(geometry.attributes.position.getX(i),geometry.attributes.position.getY(i),geometry.attributes.position.getZ(i));attributes.normal.push(geometry.attributes.normal.getX(i),geometry.attributes.normal.getY(i),geometry.attributes.normal.getZ(i));attributes.uv.push(geometry.attributes.uv?.getX(i)??0,geometry.attributes.uv?.getY(i)??0);attributes.color.push(geometry.attributes.color?.getX(i)??1,geometry.attributes.color?.getY(i)??1,geometry.attributes.color?.getZ(i)??1);}
      if(geometry!==source)geometry.dispose();source.dispose();
    }
    const geometry=new THREE.BufferGeometry();for(const [name,array] of Object.entries(attributes))geometry.setAttribute(name,new THREE.Float32BufferAttribute(array,name==='uv'?2:3));geometry.computeBoundingBox();geometry.computeBoundingSphere();ownedGeometry.add(geometry);
    const mesh=new THREE.Mesh(geometry,mat);mesh.name=`${object.name}-surface-${object.children.length}`;mesh.castShadow=mesh.receiveShadow=true;object.add(mesh);
  }
  const usedMaterials=new Set();for(const {object} of parts)object.traverse(o=>{if(o.isMesh)usedMaterials.add(o.material);});for(const m of [...ownedMaterials])if(!usedMaterials.has(m)){m.dispose();ownedMaterials.delete(m);}
  batches.clear();
  return {parts,update(time,{reducedMotion=false}={}){if(disposed||!legendary)return;inlay.emissiveIntensity=reducedMotion||!Number.isFinite(time)?.20:.20+Math.sin(time*1.35)*.035;},dispose(){if(disposed)return;disposed=true;for(const {object} of parts)object.removeFromParent();for(const geometry of ownedGeometry)geometry.dispose();for(const mat of ownedMaterials)mat.dispose();for(const texture of ownedTextures)texture.dispose();ownedGeometry.clear();ownedMaterials.clear();ownedTextures.clear();}};
}
