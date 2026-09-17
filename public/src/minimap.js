import { BUILDINGS, PLOTS, RESOURCES, WALLS, ROAD, CAVE_AREAS, CAVE_ENTRANCE, CAVE_ROUTE, caveAreaAt, caveTravelWaypoint, resolveResource } from '../../shared/world.js';
import { NOTICEBOARD_POINT } from './noticeboard.js';

export const MINIMAP_RANGE = Object.freeze({ surface: 42, cave: 25 });
export const MAP_COLORS = Object.freeze({ bank:'#e6ba67', market:'#e09b61', shop:'#b6c5ce', food:'#e9c780', church:'#e9dbab', barracks:'#7eb7cd', keep:'#d6b26a', stable:'#caa881', merchant:'#ba9acb', house:'#d1b489', cave:'#bac5c3', noticeboard:'#e7ce96' });

export function minimapView(player, size=360) {
  const underground=!!caveAreaAt(player.x,player.z),range=MINIMAP_RANGE[underground?'cave':'surface'],center=size/2,radius=center-15,scale=radius/range;
  const project=(point,edge=false)=>{
    let dx=(point.x-player.x)*scale,dy=(point.z-player.z)*scale;const length=Math.hypot(dx,dy),limit=radius-12,offscreen=length>limit;
    if(edge&&offscreen){dx*=limit/length;dy*=limit/length;}
    return {x:center+dx,y:center+dy,offscreen,angle:Math.atan2(dy,dx)};
  };
  return {player,underground,range,center,radius,scale,project,visible:(point,padding=0)=>Math.hypot(point.x-player.x,point.z-player.z)<=range+padding};
}

export function mapDestination(player, target) {
  if(!target||!Number.isFinite(target.x)||!Number.isFinite(target.z))return null;
  const routed=caveTravelWaypoint(player,target),name=routed===target?(target.name||target.label||'Destination'):caveAreaAt(player.x,player.z)?'Return to village':'Enter mountain mine';
  return {...routed,name,distance:Math.round(Math.hypot(routed.x-player.x,routed.z-player.z))};
}

// Small hand-drawn silhouettes remain legible without downloading icon images.
export function drawMapSymbol(c,kind,x,y,size=22,color=null) {
  const types={tools:'shop',tool_shop:'shop',sword_shop:'barracks',tinker_shop:'shop',tree_farm:'tree',wheat_farm:'wheat',mine:'cave',archer_tower:'tower'};kind=types[kind]||kind;
  c.save();c.translate(x,y);c.scale(size/24,size/24);c.lineCap='round';c.lineJoin='round';c.lineWidth=1.7;c.strokeStyle='#253632';c.fillStyle=color||MAP_COLORS[kind]||'#c6be9b';
  const path=(points,fill=true)=>{c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));if(fill){c.closePath();c.fill();}c.stroke();};
  const box=(x,y,w,h)=>{c.fillRect(x,y,w,h);c.strokeRect(x,y,w,h);};
  const circle=(x,y,r)=>{c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fill();c.stroke();};
  if(kind==='tree'){c.fillStyle='#9b7951';box(-1,2,2,8);c.fillStyle='#478664';path([[-9,4],[-5,-3],[-7,-3],[0,-12],[7,-3],[5,-3],[9,4]]);}
  else if(kind==='wheat'){c.strokeStyle='#efd680';for(const side of [-1,1]){path([[side*2,9],[side*5,-9]],false);for(let j=0;j<3;j++)path([[side*(4-j),3-j*4],[side*(9-j),-j*4]],false);}}
  else if(kind==='cave'){path([[-11,9],[-10,-2],[-5,-10],[5,-10],[10,-3],[11,9]]);c.fillStyle='#263d3d';path([[-6,9],[-5,-2],[0,-6],[5,-2],[6,9]]);c.strokeStyle='#d3bc87';path([[-8,9],[-8,-5],[8,-5],[8,9]],false);}
  else if(kind==='food'){c.beginPath();c.ellipse(0,1,11,7,-.2,0,Math.PI*2);c.fill();c.stroke();c.strokeStyle='#947040';for(const i of [-1,0,1])path([[i*5-1,-4],[i*5+2,1]],false);}
  else if(kind==='stable'){c.lineWidth=5;c.beginPath();c.arc(0,-1,8,-.25,Math.PI+.25);c.strokeStyle='#263a35';c.stroke();c.lineWidth=3;c.strokeStyle=color||MAP_COLORS.stable;c.stroke();path([[-8,-3],[-8,-9]],false);path([[8,-3],[8,-9]],false);}
  else if(kind==='bank'){box(-9,-8,18,18);c.fillStyle='#617b73';circle(0,1,6);c.strokeStyle='#f4d899';path([[-4,1],[4,1]],false);path([[0,-3],[0,5]],false);circle(0,1,1);}
  else if(kind==='market'){box(-9,0,18,9);c.fillStyle='#71927e';path([[-11,0],[-8,-8],[8,-8],[11,0]]);c.strokeStyle='#f4ce8b';for(const i of [-5,0,5])path([[i,-7],[i,-1]],false);c.fillStyle='#d8ad68';box(-5,3,6,6);c.strokeStyle='#7d633f';path([[-4,4],[0,8]],false);}
  else if(kind==='merchant'){path([[-12,7],[-5,-10],[5,-10],[12,7]]);c.fillStyle='#e8cd99';path([[-4,7],[0,-3],[4,7]]);c.strokeStyle='#debc71';path([[0,-10],[0,-13],[7,-11]],false);}
  else if(kind==='barracks'){path([[-9,-9],[9,-9],[8,3],[0,11],[-8,3]]);c.strokeStyle='#e4eff0';path([[0,-6],[0,6]],false);path([[-4,-1],[4,-1]],false);}
  else if(kind==='shop'){c.lineWidth=3;c.strokeStyle='#a4784c';path([[-8,10],[7,-8]],false);path([[8,10],[-7,-8]],false);c.strokeStyle=color||'#ced3c1';c.lineWidth=4;path([[-11,-7],[-7,-10],[-3,-8]],false);path([[2,-10],[8,-7],[10,-4]],false);}
  else if(kind==='noticeboard'){box(-9,-8,18,13);c.fillStyle='#f4e1ad';box(-5,-5,10,8);c.strokeStyle='#a8834e';path([[-5,6],[-5,11]],false);path([[5,6],[5,11]],false);}
  else if(kind==='cannon'){c.fillStyle='#61787b';path([[-8,-4],[10,-10],[12,-5],[-5,4]]);c.fillStyle='#bf9459';circle(-6,6,4);circle(5,3,4);}
  else if(kind==='keep'||kind==='tower'){box(-8,-6,16,16);for(const i of [-8,0,8]){box(i-3,-10,6,6);}c.fillStyle='#45594e';box(-3,3,6,7);}
  else{box(-8,-2,16,12);c.fillStyle=kind==='church'?'#baa06d':'#a16f50';path([[-11,-2],[0,-10],[11,-2]]);c.fillStyle='#465c50';box(-2,3,5,7);if(kind==='church'){c.strokeStyle='#f8e5ac';c.lineWidth=2;path([[0,-12],[0,-5]],false);path([[-3,-9],[3,-9]],false);}}
  c.restore();
}

export function createMinimap(canvas) {
  const c=canvas.getContext('2d');let view=null,markers=[],cachedLanes=null,roads=[];
  function setRoads(lanes){if(lanes===cachedLanes&&roads.length)return;cachedLanes=lanes;roads=lanes?.length?lanes.map(l=>({width:l.width,points:l.curve.getSpacedPoints(Math.max(2,Math.ceil(l.curve.getLength()/2)))})):[{width:5,points:ROAD}];}
  function line(points,color,width,dash=[]){c.strokeStyle=color;c.lineWidth=width;c.setLineDash(dash);c.beginPath();points.forEach((point,i)=>{const p=view.project(point);i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y);});c.stroke();c.setLineDash([]);}
  function rect(x,z,w,d,color,stroke=null){const p=view.project({x:x-w/2,z:z-d/2});c.fillStyle=color;c.fillRect(p.x,p.y,w*view.scale,d*view.scale);if(stroke){c.strokeStyle=stroke;c.lineWidth=1;c.strokeRect(p.x,p.y,w*view.scale,d*view.scale);}}
  function dot(point,color,size,outline='#243f35'){const p=view.project(point);c.fillStyle=color;c.strokeStyle=outline;c.lineWidth=1.5;c.beginPath();c.arc(p.x,p.y,size,0,Math.PI*2);c.fill();c.stroke();}
  function poi(point,kind,name,size=25,color=null){if(!view.visible(point,-3))return;const p=view.project(point);drawMapSymbol(c,kind,p.x,p.y,size,color);markers.push({...p,name,point});}
  function tree(node){const p=view.project(node);c.fillStyle='#456e4b';c.beginPath();c.ellipse(p.x+1,p.y+2,4.2,3.6,0,0,Math.PI*2);c.fill();c.fillStyle=node.seed%3===0?'#789657':'#608751';c.beginPath();c.arc(p.x,p.y,3.6,0,Math.PI*2);c.fill();c.fillStyle='#91a961';c.beginPath();c.arc(p.x-1,p.y-1,1.4,0,Math.PI*2);c.fill();}
  function update({state,player,ownId,yaw=0,waypoint=null,lanes=null}){
    if(!player||!state)return {waypointLabel:'M · VILLAGE ATLAS',nearby:[]};
    setRoads(lanes);view=minimapView(player,canvas.width);markers=[];const size=canvas.width,center=view.center,radius=view.radius;
    c.clearRect(0,0,size,size);c.save();c.beginPath();c.arc(center,center,radius,0,Math.PI*2);c.clip();
    const backdrop=c.createLinearGradient(0,0,size,size);backdrop.addColorStop(0,view.underground?'#25373c':'#537d5a');backdrop.addColorStop(1,view.underground?'#172d32':'#77945e');c.fillStyle=backdrop;c.fillRect(0,0,size,size);
    if(view.underground){
      for(const area of CAVE_AREAS)rect(area.x,area.z,area.w,area.d,{upper:'#8d8970',middle:'#67777a',deep:'#586d7d'}[area.tier],'#c4b898');
      line(CAVE_ROUTE,'#d0b779',1.5,[4,6]);
    }else{
      rect(0,-57,174,150,'#9b9d70');rect(0,-23,33,88,'#c1b589');
      for(const plot of PLOTS){if(!view.visible(plot,12))continue;const owned=state.plots?.find(p=>p.id===plot.id),mine=owned?.ownerId===ownId;
        rect(plot.x,plot.z,plot.w,plot.d,owned?.building?'#a7a37d':plot.outside?'#888760':'#afb082',mine?'#ffe2a0':'#718369');
        if(owned?.building)poi(plot,owned.building,(mine?'Your ':'')+owned.building.replaceAll('_',' '),22,mine?'#f5d17e':null);
        else if(view.visible(plot,-5)){const p=view.project(plot);c.strokeStyle='#75826a';c.lineWidth=1.2;c.beginPath();c.moveTo(p.x-3,p.y);c.lineTo(p.x+3,p.y);c.moveTo(p.x,p.y-3);c.lineTo(p.x,p.y+3);c.stroke();}
      }
      for(const road of roads)line(road.points,'#7f8060',road.width*view.scale+2);
      for(const road of roads)line(road.points,'#d0c09a',road.width*view.scale);
      for(const wall of WALLS)rect(wall.x,wall.z,wall.w,wall.d,'#768681','#455e54');
      rect(0,18,13,2.2,(state.gate?.hp??1)>0?'#a98450':'#624e3f','#4f5c4d');
    }
    const current=new Map((state.resources||[]).map(n=>[n.id,n]));
    for(const meta of RESOURCES){if(!view.visible(meta,1)||!!meta.caveTier!==view.underground)continue;const live=current.get(meta.id);if(live?.available===false)continue;const n=resolveResource(meta,live);
      if(n.type==='timber')tree(n);else if(n.type==='wheat'){const p=view.project(n);c.fillStyle='#ead087';c.fillRect(p.x-1.3,p.y-1.3,2.6,3.5);}
      else{const p=view.project(n);c.save();c.translate(p.x,p.y);c.rotate(Math.PI/4);c.fillStyle={stone:'#e0d5b6',iron:'#d69867',coal:'#344449',sulfur:'#e8d463'}[n.type];c.strokeStyle=n.type==='coal'?'#a7b7b9':'#615b48';c.lineWidth=1.3;c.fillRect(-3.1,-3.1,6.2,6.2);c.strokeRect(-3.1,-3.1,6.2,6.2);c.restore();}
    }
    if(!view.underground){
      for(const b of BUILDINGS){if(!view.visible(b,12))continue;rect(b.x,b.z,b.w,b.d,'#866f53','#ead7a1');poi(b,b.id==='tools'?'shop':b.kind,b.name,27);}
      poi(NOTICEBOARD_POINT,'noticeboard','Village request board',18);
      poi({x:0,z:18},'keep','Village gate',23,'#ca9f67');
    }
    poi(CAVE_ENTRANCE,'cave',view.underground?'Exit to village':'Mountain mine entrance',27);
    const inView=p=>view.visible(p,-1)&&view.underground===!!caveAreaAt(p.x,p.z);
    for(const p of state.players||[])if(p.id!==ownId&&p.online&&inView(p)){dot(p,p.downed?'#dfb59b':'#a6e3ee',4.3);markers.push({...view.project(p),name:p.name||'Dwarf',point:p});}
    for(const p of state.guards||[])if(p.hp>0&&inView(p))dot(p,'#79b7da',3.1);
    for(const p of state.workers||[])if(inView(p))dot(p,p.ownerId===ownId?'#d9c69a':'#b6ba99',2.8);
    for(const p of state.zombies||[])if(p.hp>0&&inView(p))dot(p,'#ed8774',3.6,'#713d37');
    const target=mapDestination(player,waypoint);
    if(target){const p=view.project(target,true);c.save();c.translate(p.x,p.y);c.strokeStyle='#fff0b4';c.fillStyle='#f5cc6d';c.lineWidth=2.5;
      if(p.offscreen){c.rotate(p.angle);c.beginPath();c.moveTo(7,0);c.lineTo(-5,-6);c.lineTo(-2,0);c.lineTo(-5,6);c.closePath();c.fill();c.stroke();}
      else{c.beginPath();c.arc(0,0,11,0,Math.PI*2);c.stroke();}c.restore();
    }
    c.save();c.translate(center,center);c.rotate(-yaw+Math.PI);c.fillStyle='#ffdd89';c.strokeStyle='#474b36';c.lineWidth=2;c.beginPath();c.moveTo(0,-10);c.lineTo(6,6);c.lineTo(0,3);c.lineTo(-6,6);c.closePath();c.fill();c.stroke();c.restore();
    c.restore();
    c.strokeStyle='#c3a874';c.lineWidth=2;c.beginPath();c.arc(center,center,radius+1,0,Math.PI*2);c.stroke();c.strokeStyle='#495e50';c.lineWidth=3;c.beginPath();c.arc(center,center,radius+5,0,Math.PI*2);c.stroke();
    c.font='bold 13px Georgia';c.textAlign='center';c.textBaseline='middle';for(const [text,x,y]of [['N',center,8],['S',center,size-7],['W',8,center],['E',size-8,center]]){c.fillStyle=text==='N'?'#fce7b3':'#b6c8b1';c.fillText(text,x,y);}
    c.font='11px sans-serif';c.textAlign='right';c.fillStyle='#ecdbb2';c.fillText(`${view.range} m`,size-23,size-19);
    canvas.setAttribute?.('aria-label',`Nearby ${view.underground?'cave':'village'} map, ${view.range} meter radius. Gold is you, blue are allies, red are enemies. ${markers.slice(0,8).map(p=>p.name).join(', ')}.`);
    return {waypointLabel:target?`${target.name} · ${target.distance} m`:'M · ATLAS & PLAYER SHOPS',nearby:markers.map(m=>({name:m.name,x:m.point.x,z:m.point.z})),view};
  }
  function hover(event){if(!view)return;const box=canvas.getBoundingClientRect(),x=(event.clientX-box.left)*canvas.width/box.width,y=(event.clientY-box.top)*canvas.height/box.height;
    const nearest=markers.map(m=>({...m,gap:Math.hypot(x-m.x,y-m.y)})).filter(m=>m.gap<16).sort((a,b)=>a.gap-b.gap)[0];
    canvas.title=nearest?`${nearest.name} · ${Math.round(Math.hypot(nearest.point.x-view.player.x,nearest.point.z-view.player.z))} m`:'Nearby landmarks · Open the village atlas (M)';
  }
  canvas.addEventListener?.('pointermove',hover);
  return {update,dispose(){canvas.removeEventListener?.('pointermove',hover);markers=[];roads=[];cachedLanes=null;}};
}
