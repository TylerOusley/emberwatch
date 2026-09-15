import { caveAreaAt } from '../../shared/caves.js';

// Original, quiet procedural sounds. No downloads or continuously running
// oscillators: short cached buffers share one master bus and a bounded voice pool.
const TAU = Math.PI * 2, clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const SOUND = Object.freeze({
  swing: [.20, .17], tap: [.17, .19], wood: [.19, .19], stone: [.17, .18],
  grass: [.20, .12], stepStone: [.13, .15], hoof: [.16, .15], hit: [.20, .15],
  gate: [.65, .33], bell: [2.8, .19], bird: [1.1, .075], cricket: [.85, .038],
  breeze: [2.7, .055], groan: [1.8, .14], emerge: [1.1, .13], split: [.55, .15], heal: [.65, .11]
});
const AMBIENT = new Set(['bird', 'cricket', 'breeze', 'groan']);
const OUTDOOR = new Set(['bird', 'cricket', 'breeze']);
const MAX_VOICES = 16, MAX_AMBIENT = 4;

// Use the very same curved lanes as the rendered world. The spatial index is
// built once, so footsteps do not search every road or allocate scene objects.
export function createFootstepSurface(lanes = []) {
  const cells = new Map(), cellSize = 8;
  const add = segment => {
    const {a,b,r} = segment;
    for(let x=Math.floor((Math.min(a.x,b.x)-r)/cellSize);x<=Math.floor((Math.max(a.x,b.x)+r)/cellSize);x++)
      for(let z=Math.floor((Math.min(a.z,b.z)-r)/cellSize);z<=Math.floor((Math.max(a.z,b.z)+r)/cellSize);z++){
        const key=`${x},${z}`; if(!cells.has(key))cells.set(key,[]); cells.get(key).push(segment);
      }
  };
  for(const lane of lanes){
    if(!lane.curve?.getSpacedPoints || !(lane.width>0))continue;
    const count=Math.max(2,Math.ceil(lane.curve.getLength()/1.2));
    const points=lane.curve.getSpacedPoints(count);
    for(let i=1;i<points.length;i++)add({a:points[i-1],b:points[i],r:lane.width/2});
  }
  return point => {
    if(!point || !Number.isFinite(point.x) || !Number.isFinite(point.z))return 'grass';
    if(caveAreaAt(point.x,point.z))return 'stone';
    if(Math.hypot(point.x-8,point.z+4)<=5.7 || Math.hypot(point.x,point.z+66)<=8)return 'stone';
    for(const {a,b,r} of cells.get(`${Math.floor(point.x/cellSize)},${Math.floor(point.z/cellSize)}`)||[]){
      const dx=b.x-a.x,dz=b.z-a.z,t=clamp(((point.x-a.x)*dx+(point.z-a.z)*dz)/(dx*dx+dz*dz||1),0,1);
      if(Math.hypot(point.x-a.x-t*dx,point.z-a.z-t*dz)<=r)return 'stone';
    }
    return 'grass';
  };
}

function makeBuffer(context, kind) {
  const duration=SOUND[kind][0], rate=context.sampleRate;
  const buffer=context.createBuffer(1,Math.ceil(rate*duration),rate), data=buffer.getChannelData(0);
  // A private deterministic generator leaves game randomness untouched.
  let seed=kind.split('').reduce((a,c)=>a*31+c.charCodeAt(0),91)>>>0, smooth=0;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296*2-1;};
  for(let i=0;i<data.length;i++){
    const t=i/rate,u=t/duration,n=random(),fade=Math.min(1,t/.009)*Math.min(1,(duration-t)/.025);
    smooth += (n-smooth)*.08;
    let s=0;
    switch(kind){
      case 'bell': s=(Math.sin(TAU*440*t)*Math.exp(-t*1.7)+.47*Math.sin(TAU*587.6*t)*Math.exp(-t*2.1)+.22*Math.sin(TAU*1185*t)*Math.exp(-t*3.7))*.48;break;
      case 'bird': {
        const pulse=t%.34, envelope=pulse<.18?Math.sin(Math.PI*pulse/.18)**2:0;
        s=Math.sin(TAU*(2000*t+720*t*t+25*Math.sin(t*22)))*envelope*.72;break;
      }
      case 'cricket': {
        const pulse=t%.19, envelope=pulse<.08?Math.sin(Math.PI*pulse/.08)**2:0;
        s=(Math.sin(TAU*4100*t)+.25*Math.sin(TAU*4350*t))*envelope*.6;break;
      }
      case 'breeze': s=smooth*Math.sin(Math.PI*u)**2*(.6+.4*Math.sin(t*6.1)**2);break;
      case 'groan': {
        const vibrato=.85*Math.sin(t*13), voice=Math.sin(TAU*72*t+vibrato)+.38*Math.sin(TAU*146*t+vibrato)+.17*Math.sin(TAU*218*t);
        s=(voice*.33+smooth*.45)*Math.sin(Math.PI*u)**1.6;break;
      }
      case 'heal': s=(Math.sin(TAU*523.25*t)+.55*Math.sin(TAU*659.25*t)+.32*Math.sin(TAU*783.99*t))*.35*Math.sin(Math.PI*u)*Math.exp(-t*2);break;
      case 'gate': s=(smooth*1.6+Math.sin(TAU*67*t)*.52+Math.sin(TAU*121*t)*.18)*Math.exp(-t*6.5);break;
      case 'emerge': s=(smooth*1.8+n*.08)*Math.sin(Math.PI*u)**1.4;break;
      case 'split': s=(smooth*1.4+Math.sin(TAU*(110*t-40*t*t))*.24)*Math.exp(-t*6);break;
      case 'swing': s=(n*.28+smooth*.75)*Math.sin(Math.PI*u)**1.5;break;
      case 'grass': s=(n*.32+smooth*.55)*Math.sin(Math.PI*u)**2;break;
      case 'stepStone': s=(Math.sin(TAU*117*t)*.4+smooth*.7+n*.15)*Math.exp(-t*32);break;
      case 'hoof': s=(Math.sin(TAU*330*t)*.36+Math.sin(TAU*163*t)*.25+n*.22)*Math.exp(-t*31);break;
      case 'stone': s=(Math.sin(TAU*960*t)*.33+Math.sin(TAU*1730*t)*.15+n*.23)*Math.exp(-t*30);break;
      case 'wood': s=(Math.sin(TAU*237*t)*.40+Math.sin(TAU*381*t)*.17+smooth*.7)*Math.exp(-t*24);break;
      case 'hit': s=(smooth*1.25+Math.sin(TAU*93*t)*.35)*Math.exp(-t*23);break;
      default: s=(smooth*.9+Math.sin(TAU*430*t)*.32+n*.18)*Math.exp(-t*25);
    }
    data[i]=clamp(s*fade,-.92,.92);
  }
  return buffer;
}

export function createGameAudio(options = {}) {
  let storage=options.storage, doc=options.document;
  try{if(storage===undefined)storage=globalThis.localStorage;}catch{}
  if(doc===undefined)doc=globalThis.document;
  let muted=false;try{muted=['true','1'].includes(storage?.getItem('emberwatch-muted'));}catch{}
  let context=null, master=null, compressor=null, disposed=false, unlocked=false, active=false;
  let surfaceAt=options.surfaceAt||createFootstepSurface(), listener=null, camera=null, now=0;
  let previous=null, snapshotRef=null, previousPosition=null, steps=0, nextBird=Infinity, nextCricket=Infinity, nextBreeze=Infinity, nextGroan=Infinity;
  let bellNight=null,underground=false;
  const buffers=new Map(), voices=new Set(), lastPlayed=new Map(), counts={};
  const contextFactory=options.contextFactory||(()=>{const Context=globalThis.AudioContext||globalThis.webkitAudioContext;return Context?new Context():null;});
  const random=typeof options.random==='function'?options.random:Math.random;
  const hidden=()=>doc?.hidden===true;
  function release(voice, stop=false){
    if(!voices.delete(voice))return;
    voice.source.onended=null;
    if(stop)try{voice.source.stop();}catch{}
    for(const node of voice.nodes)try{node.disconnect();}catch{}
  }
  function stopAll(){for(const voice of [...voices])release(voice,true);}
  function pause(){active=false;previous=null;snapshotRef=null;previousPosition=null;steps=0;stopAll();}
  function canPlay(){return !disposed&&!muted&&unlocked&&active&&!hidden()&&context?.state==='running';}
  function play(kind, detail={}){
    if(!SOUND[kind] || !canPlay() || underground&&OUTDOOR.has(kind))return false;
    const cooldown=kind==='bell'?2:AMBIENT.has(kind)?.5:kind==='gate'?.18:.055;
    if(now-(lastPlayed.get(kind)??-Infinity)<cooldown)return false;
    const ambient=AMBIENT.has(kind);
    if(ambient&&[...voices].filter(v=>v.ambient).length>=MAX_AMBIENT)return false;
    if(voices.size>=MAX_VOICES){
      const quiet=[...voices].find(v=>v.ambient);
      if(!quiet)return false;release(quiet,true);
    }
    let attenuation=1,pan=Number.isFinite(detail.pan)?clamp(detail.pan,-1,1):0;
    if(detail.position&&listener&&kind!=='bell'){
      const dx=detail.position.x-listener.x,dz=detail.position.z-listener.z,distance=Math.hypot(dx,dz);
      if(!Number.isFinite(distance)||distance>48)return false;
      attenuation=1/(1+(distance/13)**2);
      const matrix=camera?.matrixWorld?.elements;
      pan=clamp((matrix?dx*matrix[0]+dz*matrix[2]:dx)/Math.max(5,distance),-.86,.86);
    }
    let source,gain,panner,voice;
    try{
      if(!buffers.has(kind))buffers.set(kind,makeBuffer(context,kind));
      source=context.createBufferSource();gain=context.createGain();
      source.buffer=buffers.get(kind);
      source.playbackRate.value=kind==='bell'||kind==='heal'?1:.94+random()*.12;
      gain.gain.value=SOUND[kind][1]*attenuation*clamp(Number.isFinite(detail.strength)?detail.strength:1,0,1.4);
      source.connect(gain);
      if(context.createStereoPanner){panner=context.createStereoPanner();panner.pan.value=pan;gain.connect(panner);panner.connect(master);}else gain.connect(master);
      voice={source,nodes:[source,gain,...(panner?[panner]:[])],ambient,kind};voices.add(voice);
      source.onended=()=>release(voice);
      // The blade first winds up; the airy peak belongs to its cutting stroke.
      // This is an already-owned voice, so mute/pause stops the scheduled cue.
      source.start((Number.isFinite(context.currentTime)?context.currentTime:0)+(kind==='swing'?.11:0));
      lastPlayed.set(kind,now);counts[kind]=(counts[kind]||0)+1;return true;
    }catch{
      if(voice)release(voice,true);else for(const node of [source,gain,panner])try{node?.disconnect();}catch{}
      return false;
    }
  }
  function baseline(state){
    return {id:state.id,day:state.day,phase:state.phase,remaining:state.phaseRemaining,clock:state.clock,gate:state.gate?.hp,
      zombies:new Map((state.zombies||[]).map(z=>[z.id,{anim:z.anim,hp:z.hp,lastSlamAt:z.lastSlamAt}])),
      actors:new Map([...(state.players||[]),...(state.guards||[])].map(p=>[p.id,{anim:p.anim,hp:p.hp}]))};
  }
  function update(frame={}){
    if(disposed)return;
    const state=frame.state,me=frame.me;
    now=Number.isFinite(frame.time)?frame.time:(globalThis.performance?.now?.()??Date.now())/1000;
    const age=Number.isFinite(frame.snapshotAt)?Math.max(0,now-frame.snapshotAt):0;
    const running=Boolean(state&&me&&frame.connected!==false&&state.status!=='fallen'&&state.clockRunning!==false&&age<=.65&&!hidden());
    listener=frame.position||me;camera=frame.camera;
    if(!running){pause();return;}
    const inside=Boolean(listener&&caveAreaAt(listener.x,listener.z));
    if(inside!==underground){
      underground=inside;
      if(inside)for(const voice of [...voices])if(OUTDOOR.has(voice.kind))release(voice,true);
      // Outdoor ambience resumes on a fresh interval after leaving the cave.
      nextBird=now+5+random()*6;nextCricket=now+2+random()*3;nextBreeze=now+4+random()*5;
    }
    const wasActive=active;active=true;
    if(!wasActive){
      nextBird=now+5+random()*6;nextCricket=now+2+random()*3;nextBreeze=now+4+random()*5;nextGroan=now+3+random()*3;
      previous=null;previousPosition=null;steps=0;
    }
    // The render loop can run faster than snapshots. Only build entity
    // baselines when authoritative data changes, not sixty times per second.
    if(state!==snapshotRef || !previous || state.clock!==previous.clock){
      snapshotRef=state;
      const current=baseline(state), key=`${state.id}:${state.day}`;
      // Always consume baselines while muted/locked: enabling sound or rejoining
      // cannot replay old attacks, a whole siege, or a missed warning bell.
      if(previous&&previous.id===state.id&&state.clock>=previous.clock&&state.clock-previous.clock<=1.5){
        const warning=state.phase==='day'&&previous.phase==='day'&&state.day===previous.day&&previous.remaining>30&&state.phaseRemaining<=30;
        const sunset=state.phase==='night'&&previous.phase==='day'&&state.day===previous.day;
        if((warning||sunset)&&bellNight!==key){play('bell');bellNight=key;}
        if(Number.isFinite(previous.gate)&&current.gate<previous.gate)play('gate',{position:{x:0,z:18}});
        const splitParents=new Set();
        for(const zombie of state.zombies||[]){
          const prior=previous.zombies.get(zombie.id);
          if(!prior&&['emerge','emerging'].includes(zombie.anim))play('emerge',{position:zombie});
          else if(!prior&&zombie.birth==='split'&&zombie.anim==='burst'&&!splitParents.has(zombie.parentId)){
            splitParents.add(zombie.parentId);play('split',{position:zombie});
          }else if(prior&&zombie.hp<prior.hp)play('hit',{position:zombie});
          if(prior&&zombie.kind==='siege'){
            if(zombie.anim==='windup'&&prior.anim!=='windup')play('groan',{position:zombie,strength:1.3});
            if(Number.isFinite(zombie.lastSlamAt)&&zombie.lastSlamAt>(prior.lastSlamAt??-Infinity))
              play('gate',{position:{x:zombie.lastSlamX??zombie.x,z:zombie.lastSlamZ??zombie.z},strength:1.25});
          }
        }
        for(const actor of [...(state.players||[]),...(state.guards||[])]){
          if(actor.online===false)continue;
          const prior=previous.actors.get(actor.id);
          if(prior&&actor.hp<prior.hp)play('hit',{position:actor,strength:.7});
          if(actor.id===me.id)continue;
          if(prior&&actor.anim!==prior.anim){
            const kind=actor.anim==='attack'?'swing':actor.anim==='heal'?'heal':actor.anim==='repair'?'wood':null;
            if(kind)play(kind,{position:actor,strength:.7});
          }
        }
      }else if(state.phase==='night'||state.phase==='day'&&state.phaseRemaining<=30)bellNight=key;
      previous=current;
    }
    if(!canPlay()){previousPosition=null;steps=0;return;}
    if(listener&&Number.isFinite(listener.x)&&Number.isFinite(listener.z)){
      const moving=frame.speed===undefined?['walk','run'].includes(me.anim):frame.speed>.15;
      if(previousPosition&&moving&&!me.downed&&!me.bedPlotId&&!me.carriedBy){
        const traveled=Math.hypot(listener.x-previousPosition.x,listener.z-previousPosition.z);
        // Teleports and reconnect corrections never produce a burst of steps.
        if(traveled<2){
          steps+=traveled;
          if(steps>=(me.mountedHorseId?2.3:1.5)){
            let surface=underground?'stone':'grass';if(!underground)try{surface=surfaceAt(listener);}catch{}
            play(me.mountedHorseId?'hoof':surface==='stone'?'stepStone':'grass');steps=0;
          }
        }else steps=0;
      }else steps=0;
      previousPosition={x:listener.x,z:listener.z};
    }
    if(!underground&&state.phase==='day'&&now>=nextBird){play('bird',{pan:random()*1.4-.7});nextBird=now+10+random()*12;}
    if(!underground&&state.phase==='night'&&now>=nextCricket){play('cricket',{pan:random()*1.4-.7});nextCricket=now+6+random()*7;}
    if(!underground&&now>=nextBreeze){play('breeze',{pan:random()-.5});nextBreeze=now+13+random()*12;}
    if(state.phase==='night'&&now>=nextGroan){
      const nearby=(state.zombies||[]).filter(z=>z.hp>0&&listener&&Math.hypot(z.x-listener.x,z.z-listener.z)<42);
      if(nearby.length)play('groan',{position:nearby[Math.min(nearby.length-1,Math.floor(random()*nearby.length))]});
      nextGroan=now+5+random()*6;
    }
  }
  async function unlock(){
    if(disposed)return false;
    try{
      if(!context){
        context=contextFactory();if(!context)return false;
        master=context.createGain();master.gain.value=muted?0:.62;
        compressor=context.createDynamicsCompressor?.();
        if(compressor){compressor.threshold.value=-12;compressor.knee.value=15;compressor.ratio.value=5;master.connect(compressor);compressor.connect(context.destination);}else master.connect(context.destination);
      }
      if(context.state==='suspended')await context.resume();
      unlocked=context.state==='running';return unlocked;
    }catch{unlocked=false;return false;}
  }
  function setMuted(value){
    const wasMuted=muted;muted=Boolean(value);
    if(wasMuted&&!muted){nextBird=now+5+random()*6;nextCricket=now+2+random()*3;nextBreeze=now+4+random()*5;nextGroan=now+3+random()*3;}
    try{storage?.setItem('emberwatch-muted',String(muted));}catch{}
    if(master)master.gain.value=muted?0:.62;
    if(muted)stopAll();return muted;
  }
  function reset(){pause();bellNight=null;lastPlayed.clear();}
  const onVisibility=()=>{if(hidden())pause();};doc?.addEventListener?.('visibilitychange',onVisibility);
  return {unlock,setMuted,play,update,reset,
    setSurfaceResolver(resolver){if(typeof resolver==='function')surfaceAt=resolver;},
    get muted(){return muted;},
    get debug(){return {activeVoices:voices.size,maxVoices:MAX_VOICES,buffers:buffers.size,unlocked,active,muted,events:{...counts}};},
    dispose(){
      if(disposed)return;reset();disposed=true;unlocked=false;
      doc?.removeEventListener?.('visibilitychange',onVisibility);
      try{master?.disconnect();compressor?.disconnect();}catch{}
      buffers.clear();try{context?.close()?.catch?.(()=>{});}catch{}
      master=compressor=context=null;
    }
  };
}
