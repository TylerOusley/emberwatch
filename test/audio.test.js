import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createGameAudio, createFootstepSurface, TASK_RECORDINGS } from '../public/src/audio.js';

class Node {
  constructor(){this.gain=this.pan=this.threshold=this.knee=this.ratio=this.playbackRate={value:1};this.connections=[];this.disconnected=false;}
  connect(node){this.connections.push(node);return node;}
  disconnect(){this.disconnected=true;this.connections=[];}
}
class Context {
  constructor(){this.state='suspended';this.sampleRate=12000;this.destination=new Node();this.sources=[];this.buffers=[];this.closed=0;this.resumes=0;}
  createGain(){return new Node();}createStereoPanner(){return new Node();}createDynamicsCompressor(){return new Node();}
  createBuffer(channels,length,sampleRate){const data=new Float32Array(length),buffer={duration:length/sampleRate,getChannelData:()=>data};this.buffers.push(buffer);return buffer;}
  createBufferSource(){const source=new Node();source.start=time=>{source.started=true;source.startAt=time;};source.stop=()=>{source.stopped=true;source.onended?.();};this.sources.push(source);return source;}
  async resume(){this.resumes++;this.state='running';}async close(){this.closed++;this.state='closed';}
}
function fixture({muted=false,storage,document,fetch=null,decodeAudioData}={}){
  const context=new Context(),saved=new Map([['emberwatch-muted',String(muted)]]);
  if(decodeAudioData)context.decodeAudioData=decodeAudioData;
  const doc=document||new EventTarget();doc.hidden=false;
  const audio=createGameAudio({contextFactory:()=>context,storage:storage||{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)},document:doc,random:()=>.5,fetch});
  return {audio,context,saved,doc};
}
function frame(time=0,overrides={}){
  const me={id:'self',x:0,z:4,hp:100,anim:'idle'};
  return {time,snapshotAt:time,connected:true,me,position:{x:me.x,z:me.z},speed:0,
    state:{id:'village',clock:time,day:1,phase:'day',phaseRemaining:100,clockRunning:true,status:'active',gate:{hp:100},players:[me],guards:[],zombies:[]},...overrides};
}
function update(audio,time,changes={}){const f=frame(time);Object.assign(f.state,changes);audio.update(f);return f;}

test('audio waits for a gesture, respects persisted mute, and is safe when audio/storage are unavailable',async()=>{
  const {audio,context,saved}=fixture({muted:true});audio.update(frame());
  assert.equal(audio.play('tap'),false);assert.equal(context.sources.length,0);assert.equal(context.buffers.length,0);
  assert.equal(await audio.unlock(),true);assert.equal(context.resumes,1);await audio.unlock();assert.equal(context.resumes,1);
  assert.equal(audio.play('tap'),false);audio.setMuted(false);assert.equal(saved.get('emberwatch-muted'),'false');
  assert.equal(audio.play('tap'),true);audio.setMuted(true);assert.equal(audio.debug.activeVoices,0);assert.ok(context.sources[0].stopped);
  audio.reset();assert.equal(audio.muted,true);audio.dispose();assert.equal(context.closed,1);
  const unavailable=createGameAudio({contextFactory:()=>null,storage:{getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}},document:null});
  assert.equal(await unavailable.unlock(),false);unavailable.update(frame());assert.equal(unavailable.play('bell'),false);unavailable.setMuted(true);unavailable.dispose();
});

test('voices and cached buffers remain bounded and disconnect on end/reset/dispose',async()=>{
  const {audio,context}=fixture();await audio.unlock();
  for(let i=0;i<200;i++){update(audio,i*.07);audio.play('tap');assert.ok(audio.debug.activeVoices<=audio.debug.maxVoices);}
  assert.ok(context.buffers.length<6,'repeat actions reuse a cached sample');assert.equal(audio.debug.activeVoices,16);
  const first=context.sources.find(s=>!s.stopped&&s.onended);first.onended();assert.ok(first.disconnected);assert.equal(audio.debug.activeVoices,15);
  audio.reset();assert.equal(audio.debug.activeVoices,0);assert.ok(context.sources.every(s=>s.disconnected));
  audio.dispose();audio.dispose();assert.equal(context.closed,1);assert.equal(audio.debug.buffers,0);assert.equal(await audio.unlock(),false);
});

test('repeated work cycles distinct cached timbres without adjacent repeats or an extra voice per strike',async()=>{
  const {audio,context}=fixture();await audio.unlock();let time=0;
  for(const kind of ['wood','stone','tap','gather','repair']){
    const heard=[];
    for(let i=0;i<20;i++){
      for(const source of context.sources)source.onended?.();
      update(audio,time+=.1);
      const before=context.sources.length;
      assert.equal(audio.play(kind),true);assert.equal(context.sources.length,before+1,'one work event owns one bounded voice');
      const buffer=context.sources.at(-1).buffer;
      assert.notEqual(buffer,heard.at(-1),'consecutive strikes use different authored waveforms');heard.push(buffer);
      assert.equal(audio.play(kind),false,'variation cannot bypass the family cooldown');
    }
    assert.equal(new Set(heard).size,4,`${kind} uses exactly four cached variants`);
    for(let start=0;start<heard.length;start+=4)assert.equal(new Set(heard.slice(start,start+4)).size,4,'every bag visits the complete family');
    assert.equal(new Set(heard.map(buffer=>buffer.duration)).size,4,'variants differ in envelope, not just playback pitch');
  }
  for(const buffer of context.buffers){const data=buffer.getChannelData(0);assert.ok(data.every(Number.isFinite));assert.ok(data.every(value=>Math.abs(value)<=.93));}
  assert.ok(audio.debug.buffers<=22,'five finite task families plus occasional ambience');
  audio.setMuted(true);assert.equal(audio.play('gather'),false);assert.equal(audio.debug.activeVoices,0);audio.dispose();
});

test('observed repairs have their own work cue and do not replay while the animation is unchanged',async()=>{
  const {audio}=fixture();await audio.unlock();
  const other={id:'builder',x:0,z:5,hp:100,anim:'idle'};
  update(audio,0,{players:[frame().me,other]});
  update(audio,.1,{players:[frame().me,{...other,anim:'repair'}]});
  update(audio,.2,{players:[frame().me,{...other,anim:'repair'}]});
  assert.equal(audio.debug.events.repair,1);assert.equal(audio.debug.events.wood,undefined);audio.dispose();
});

test('night warning happens once at threshold and is not repeated by sunset, join, reconnect, or unmute',async()=>{
  const {audio}=fixture();await audio.unlock();
  update(audio,0,{phaseRemaining:31});update(audio,.1,{phaseRemaining:30});
  assert.equal(audio.debug.events.bell,1);
  update(audio,.2,{phaseRemaining:30});update(audio,.3,{phase:'night',phaseRemaining:240});assert.equal(audio.debug.events.bell,1);
  audio.reset();update(audio,10,{phase:'night',phaseRemaining:150});assert.equal(audio.debug.events.bell,1,'joining an ongoing night is silent');
  audio.reset();update(audio,11,{phaseRemaining:15});update(audio,11.1,{phase:'night',phaseRemaining:240});assert.equal(audio.debug.events.bell,1,'joining after the warning does not replay it');
  update(audio,12,{day:2,phaseRemaining:480});update(audio,12.1,{day:2,phaseRemaining:31});audio.setMuted(true);
  update(audio,12.2,{day:2,phaseRemaining:30});audio.setMuted(false);update(audio,12.3,{day:2,phase:'night',phaseRemaining:240});
  assert.equal(audio.debug.events.bell,1,'a muted warning is consumed');
  update(audio,15,{day:3,phaseRemaining:480});update(audio,15.1,{day:3,phase:'night',phaseRemaining:240});
  assert.equal(audio.debug.events.bell,2,'an observed phase transition is a fallback if the threshold was skipped');audio.dispose();
});

test('paused, stale, hidden and disconnected worlds stop active effects and do not queue a return burst',async()=>{
  const {audio,context,doc}=fixture();await audio.unlock();update(audio,0);audio.play('bell');assert.equal(audio.debug.activeVoices,1);
  update(audio,.1,{clockRunning:false});assert.equal(audio.debug.activeVoices,0);assert.ok(context.sources[0].stopped);
  update(audio,.2);audio.play('tap');doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));assert.equal(audio.debug.activeVoices,0);
  audio.update(frame(20));assert.equal(audio.debug.active,false);doc.hidden=false;audio.update(frame(30));assert.equal(audio.debug.activeVoices,0);
  audio.play('tap');audio.update(frame(31,{snapshotAt:30}));assert.equal(audio.debug.activeVoices,0);
  audio.update(frame(40,{connected:false}));assert.equal(audio.debug.active,false);audio.update(frame(41));assert.equal(audio.debug.activeVoices,0);
  update(audio,42,{status:'fallen'});assert.equal(audio.play('tap'),false);audio.dispose();
});

test('actual road curves and squares choose stone footsteps; traveled distance prevents footsteps at rest or on teleport',async()=>{
  const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(20,0,0),new THREE.Vector3(25,0,10),new THREE.Vector3(35,0,15)]);
  const surface=createFootstepSurface([{curve,width:3}]);
  assert.equal(surface(curve.getPoint(.5)),'stone');assert.equal(surface({x:8,z:-4}),'stone');assert.equal(surface({x:0,z:-66}),'stone');assert.equal(surface({x:70,z:40}),'grass');
  const {audio}=fixture();audio.setSurfaceResolver(surface);await audio.unlock();
  const step=(time,x,z,speed=4)=>audio.update(frame(time,{position:{x,z},speed}));
  step(0,20,0);step(.1,20,1);step(.2,20,2);assert.equal(audio.debug.events.stepStone,1);
  step(.3,20,2);step(.4,20,2);assert.equal(audio.debug.events.stepStone,1,'running against a wall has no footfalls');
  step(.5,70,40);assert.equal(audio.debug.events.grass,undefined,'teleport is silent');step(.6,70,41);step(.7,70,42);assert.equal(audio.debug.events.grass,1);
  step(.8,70,43,0);step(.9,70,44,0);assert.equal(audio.debug.events.grass,1);audio.dispose();
});

test('authoritative damage and animation changes play once, and distant combat remains quiet',async()=>{
  const {audio}=fixture();await audio.unlock();
  const guard={id:'guard',x:0,z:5,hp:100,anim:'idle'},zombie={id:'zombie',x:0,z:7,hp:80,anim:'walk'};
  update(audio,0,{guards:[guard],zombies:[zombie]});
  update(audio,.1,{gate:{hp:92},guards:[{...guard,anim:'attack'}],zombies:[{...zombie,hp:70}]});
  assert.equal(audio.debug.events.gate,1);assert.equal(audio.debug.events.swing,1);assert.equal(audio.debug.events.hit,1);
  update(audio,.2,{gate:{hp:92},guards:[{...guard,anim:'attack'}],zombies:[{...zombie,hp:70}]});
  assert.equal(audio.debug.events.gate,1);assert.equal(audio.debug.events.swing,1);assert.equal(audio.debug.events.hit,1);
  update(audio,.3,{gate:{hp:95},zombies:[{...zombie,hp:70},{id:'rise',x:0,z:12,hp:100,anim:'emerge'}]});assert.equal(audio.debug.events.gate,1,'repairs do not sound like damage');assert.equal(audio.debug.events.emerge,1);
  assert.equal(audio.play('groan',{position:{x:300,z:300}}),false);audio.dispose();
});

test('day birds, night crickets, breeze and nearby groans use finite modest cached waveforms',async()=>{
  const {audio,context}=fixture();await audio.unlock();
  update(audio,0);update(audio,8);assert.equal(audio.debug.events.bird,1);assert.equal(audio.debug.events.breeze,1);
  update(audio,9,{phase:'night',zombies:[{id:'z',x:0,z:9,hp:50,anim:'walk'}]});
  assert.equal(audio.debug.events.cricket,1);assert.equal(audio.debug.events.groan,1);
  for(const kind of ['wood','stone','grass','stepStone','hoof','hit','gate','bell','emerge','split','heal','swing']){
    for(const s of context.sources)if(s.onended)s.onended();audio.play(kind);
  }
  for(const buffer of context.buffers){const data=buffer.getChannelData(0);assert.ok(data.every(Number.isFinite));assert.ok(data.some(v=>Math.abs(v)>.001));assert.ok(data.every(v=>Math.abs(v)<=.93));assert.ok(buffer.duration<=2.81);}
  assert.ok(audio.debug.buffers<=17);assert.equal(context.sources.at(-1).startAt,.11,'the airy blade cue follows anticipation without a second local sound');audio.dispose();
});

test('split offspring share one cue, siege windups/impacts do not repeat, and spatial pan follows the camera right axis',async()=>{
  const {audio,context}=fixture();await audio.unlock();
  const siege={id:'siege',kind:'siege',x:0,z:12,hp:900,anim:'walk',lastSlamAt:null};
  update(audio,0,{phase:'night',zombies:[siege]});
  const children=Array.from({length:3},(_,i)=>({id:`child-${i}`,kind:'splinter',parentId:'splitter',birth:'split',anim:'burst',x:i,z:10,hp:20}));
  update(audio,.1,{phase:'night',zombies:[{...siege,anim:'windup'},...children]});
  assert.equal(audio.debug.events.split,1);assert.equal(audio.debug.events.groan,1);
  update(audio,.2,{phase:'night',zombies:[{...siege,anim:'windup'},...children]});assert.equal(audio.debug.events.split,1);assert.equal(audio.debug.events.groan,1);
  update(audio,.3,{phase:'night',zombies:[{...siege,anim:'attack',lastSlamAt:.3,lastSlamX:0,lastSlamZ:10},...children]});
  assert.equal(audio.debug.events.gate,1);
  update(audio,.4,{phase:'night',zombies:[{...siege,anim:'attack',lastSlamAt:.3,lastSlamX:0,lastSlamZ:10},...children]});assert.equal(audio.debug.events.gate,1);
  const f=frame(2,{camera:{matrixWorld:{elements:[0,0,-1,0,0,1,0,0,1,0,0,0,0,0,0,1]}}});audio.update(f);
  assert.equal(audio.play('stone',{position:{x:0,z:10}}),true);
  const source=context.sources.at(-1),panner=source.connections[0].connections[0];assert.ok(panner.pan.value<0,'a source on camera-left is heard on the left');audio.dispose();
});

test('caves use stone footsteps, stop outdoor ambience and resume it after a fresh interval', async () => {
  const { audio, context } = fixture();await audio.unlock();update(audio, 0);update(audio, 8);
  const outdoor = context.sources.filter(source => source.onended);assert.ok(outdoor.length >= 2);
  audio.update(frame(8.1, { position: { x: 0, z: -151 } }));assert.ok(outdoor.every(source => source.stopped), 'birds and wind stop when entering the cave');
  const before = { ...audio.debug.events };
  for (const [time, phase] of [[30, 'day'], [60, 'night']]) {
    const f = frame(time, { position: { x: 0, z: -151 } });f.state.phase = phase;audio.update(f);
  }
  assert.equal(audio.debug.events.bird, before.bird);assert.equal(audio.debug.events.breeze, before.breeze);assert.equal(audio.debug.events.cricket, before.cricket);
  assert.equal(createFootstepSurface()({ x: 0, z: -151 }), 'stone');
  audio.setSurfaceResolver(() => 'grass');
  audio.update(frame(60.1, { position: { x: 0, z: -152 }, speed: 4 }));
  audio.update(frame(60.2, { position: { x: 0, z: -153 }, speed: 4 }));
  assert.equal(audio.debug.events.stepStone, 1, 'cave floor wins over an outdoor surface resolver');
  assert.equal(audio.play('swing'), true, 'combat cues remain available underground');
  audio.update(frame(61, { position: { x: 0, z: -115 } }));assert.equal(audio.debug.events.bird, before.bird, 'leaving does not replay queued outdoor ambience');
  audio.update(frame(70, { position: { x: 0, z: -115 } }));assert.equal(audio.debug.events.bird, before.bird + 1);assert.equal(audio.debug.events.breeze, before.breeze + 1);
  audio.dispose();
});

test('musket shots use one finite cached report and do not duplicate local snapshot audio',async()=>{
  const {audio,context}=fixture();await audio.unlock();update(audio,0);
  assert.equal(audio.play('musket'),true);
  const shotBuffer=context.sources.at(-1).buffer;
  assert.equal(context.sources.at(-1).startAt,0,'gunpowder ignition starts immediately');
  const data=shotBuffer.getChannelData(0);assert.ok(data.every(Number.isFinite));assert.ok(data.every(n=>Math.abs(n)<=.93));
  assert.ok(data.some(n=>Math.abs(n)>.1));assert.ok(Math.abs(shotBuffer.duration-.68)<=1/context.sampleRate);
  const shot={id:1,kind:'musket',at:.1,from:{x:0,z:4}};
  update(audio,.1,{players:[{...frame().me,tool:'musket',anim:'attack',lastShot:shot}]});
  assert.equal(audio.debug.events.musket,1,'local immediate cue owns the shot sound');
  update(audio,.2);assert.equal(audio.play('musket'),true);assert.equal(context.sources.at(-1).buffer,shotBuffer);
  assert.equal(audio.play('musket'),false,'same-frame duplicates still respect the voice cooldown');
  audio.dispose();assert.ok(context.sources.every(source=>source.disconnected));
});

test('remote player and troop musket events play once per shot across render rates',async()=>{
  for(const rate of [30,120]) {
    const {audio}=fixture();await audio.unlock();
    const remote={id:'shooter',x:0,z:5,hp:100,tool:'musket',anim:'idle'};
    const guard={id:'musketeer',x:2,z:5,hp:100,unitType:'musketeer',tool:'musket',anim:'idle'};
    update(audio,0,{players:[frame().me,remote],guards:[guard]});
    let remoteShot=null,troopShot=null,current;
    for(let tick=1;tick<=30;tick++) {
      const time=tick/10;
      if(tick===2||tick===14)remoteShot={id:`player-${tick}`,kind:'musket',at:time,from:remote};
      if(tick===7||tick===23)troopShot={id:`troop-${tick}`,kind:'musket',firedAt:time,fromX:guard.x,fromZ:guard.z};
      current=frame(time);current.state.players.push({...remote,anim:'attack',lastShot:remoteShot});current.state.guards=[{...guard,anim:'attack',lastShot:troopShot}];
      audio.update(current);
      for(let i=1;i<rate/10;i++)audio.update({...current,time:time+i/rate});
    }
    assert.equal(audio.debug.events.musket,4,`${rate} FPS plays one report for each server shot`);
    assert.equal(audio.debug.events.swing,undefined,'rifle attack animations never produce sword sounds');
    audio.dispose();
  }
});

test('old, muted, faraway and reconnect musket shots do not replay',async()=>{
  const {audio}=fixture();await audio.unlock();
  const remote={id:'shooter',x:0,z:5,hp:100,tool:'musket',anim:'attack'};
  const state=(at,id,x=0)=>({players:[frame().me,{...remote,x,lastShot:{id,kind:'musket',at,from:{x,z:5}}}]});
  update(audio,10,state(3,'old'));update(audio,10.1,state(3,'old'));
  assert.equal(audio.debug.events.musket,undefined,'joining an old shot is silent');
  audio.setMuted(true);update(audio,10.2,state(10.2,'muted'));audio.setMuted(false);update(audio,10.3,state(10.2,'muted'));
  assert.equal(audio.debug.events.musket,undefined,'unmuting cannot replay consumed events');
  update(audio,10.4,state(10.4,'far',200));assert.equal(audio.debug.events.musket,undefined);
  audio.reset();update(audio,11,state(10.9,'reconnect'));update(audio,11.1,state(10.9,'reconnect'));
  assert.equal(audio.debug.events.musket,undefined,'reconnecting establishes a fresh baseline');
  update(audio,11.2,state(11.2,'fresh'));assert.equal(audio.debug.events.musket,1);audio.dispose();
});

const settleLoading=()=>new Promise(resolve=>setImmediate(resolve));
function recordedFixture(options={}){
  const fetched=[],decoded=[];
  const fetch=async(url,options)=>{
    fetched.push({url,options});
    return {ok:true,arrayBuffer:async()=>new Uint8Array([fetched.length]).buffer};
  };
  const decodeAudioData=async data=>{
    const buffer={duration:.8+new Uint8Array(data)[0]/100,recording:new Uint8Array(data)[0]};decoded.push(buffer);return buffer;
  };
  return {...fixture({fetch,decodeAudioData,...options}),fetched,decoded};
}

test('approved recordings load after a gesture, cache once and replace each procedural strike with one voice',async()=>{
  const {audio,context,fetched,decoded}=recordedFixture();update(audio,0);
  assert.equal(fetched.length,0,'no network or audio work before a user gesture');
  await audio.unlock();await settleLoading();
  assert.deepEqual(fetched.map(call=>call.url).sort(),Object.values(TASK_RECORDINGS).flat().sort());
  assert.equal(decoded.length,5);assert.deepEqual(audio.debug.recordings,{stone:4,wood:1});
  assert.equal(context.sources.length,0,'finishing a fetch never starts an old action');
  const heard=[];
  for(let i=0;i<12;i++){
    update(audio,.1+i*.1);const before=context.sources.length;
    assert.equal(audio.play('stone'),true);assert.equal(context.sources.length,before+1);
    const source=context.sources.at(-1);assert.ok(decoded.includes(source.buffer));
    assert.notEqual(source.buffer,heard.at(-1));heard.push(source.buffer);
    assert.ok(source.playbackRate.value>=.985&&source.playbackRate.value<=1.015);
    source.onended();
  }
  for(let start=0;start<heard.length;start+=4)assert.equal(new Set(heard.slice(start,start+4)).size,4);
  assert.equal(context.buffers.length,0,'no procedural overlay is allocated when the recorded family is ready');
  update(audio,2);assert.equal(audio.play('wood'),true);
  const wood=context.sources.at(-1).buffer;assert.ok(decoded.includes(wood));assert.ok(!heard.includes(wood));
  update(audio,2.1);assert.equal(audio.play('wood'),true);assert.equal(context.sources.at(-1).buffer,wood,'wood variation shares its decoded recording');
  await audio.unlock();audio.reset();await audio.unlock();await settleLoading();assert.equal(fetched.length,5,'rejoining does not fetch or decode again');
  assert.equal(audio.debug.activeVoices,0);audio.dispose();assert.deepEqual(audio.debug.recordings,{});
});

test('recordings retain voice limits, spatial audibility and mute behavior underground',async()=>{
  const {audio,context}=recordedFixture();await audio.unlock();await settleLoading();
  for(let i=0;i<100;i++){
    audio.update(frame(i*.07,{position:{x:0,z:-151}}));
    audio.play(i%2?'stone':'wood',{position:{x:0,z:-152}});
    assert.ok(audio.debug.activeVoices<=16);
  }
  assert.equal(audio.debug.activeVoices,16);
  assert.ok(context.sources.every(source=>source.buffer.recording));
  audio.setMuted(true);assert.equal(audio.debug.activeVoices,0);assert.ok(context.sources.every(source=>source.stopped));
  audio.setMuted(false);audio.update(frame(8,{position:{x:0,z:-151}}));
  assert.equal(audio.play('stone',{position:{x:100,z:-151}}),false,'distant sources remain inaudible');
  assert.equal(audio.play('stone',{position:{x:0,z:-152}}),true);
  audio.reset();assert.equal(audio.debug.activeVoices,0);assert.equal(audio.play('wood'),false);audio.dispose();
});

test('failed downloads and decode failures preserve playable fallbacks without unhandled rejections or retries per strike',async()=>{
  let requests=0,decodes=0;
  const {audio,context}=recordedFixture({fetch:async url=>{
    requests++;
    if(url.endsWith('1.mp3'))throw Error('network unavailable');
    if(url.endsWith('2.mp3'))return {ok:false};
    return {ok:true,arrayBuffer:async()=>new ArrayBuffer(1)};
  },decodeAudioData:async()=>{decodes++;throw Error('unsupported audio');}});
  await audio.unlock();await settleLoading();assert.equal(requests,5);assert.equal(decodes,3);
  assert.deepEqual(audio.debug.recordings,{});update(audio,0);
  assert.equal(audio.play('stone'),true);update(audio,.1);assert.equal(audio.play('wood'),true);
  assert.ok(context.sources.every(source=>source.buffer.getChannelData));
  await audio.unlock();await settleLoading();assert.equal(requests,5,'unavailable assets do not cause a network loop on clicks');audio.dispose();
});

test('partial recording loads use healthy variants while a missing wood asset falls back independently',async()=>{
  const {audio,context}=recordedFixture({fetch:async url=>({ok:!url.includes('wood')&&!url.endsWith('3.mp3'),arrayBuffer:async()=>new ArrayBuffer(1)})});
  await audio.unlock();await settleLoading();assert.deepEqual(audio.debug.recordings,{stone:3});
  update(audio,0);assert.equal(audio.play('stone'),true);assert.notEqual(context.sources.at(-1).buffer.recording,undefined);
  assert.equal(audio.play('wood'),true);assert.equal(context.sources.at(-1).buffer.recording,undefined);audio.dispose();
});

test('loading completion does not replay muted actions and disposing in-flight loads releases their results',async()=>{
  const pending=[];let decodes=0;
  const delayedFetch=(url,{signal})=>new Promise(resolve=>pending.push({signal,resolve}));
  const decodeAudioData=async()=>{decodes++;return {duration:.8,recording:decodes};};
  const {audio,context}=recordedFixture({muted:true,fetch:delayedFetch,decodeAudioData});
  await audio.unlock();update(audio,0);assert.equal(audio.play('stone'),false);
  pending.forEach(call=>call.resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(1)}));await settleLoading();
  assert.equal(context.sources.length,0);assert.equal(decodes,5);audio.setMuted(false);assert.equal(context.sources.length,0);
  assert.equal(audio.play('stone'),true);audio.dispose();
  pending.length=0;decodes=0;
  const disposed=recordedFixture({fetch:delayedFetch,decodeAudioData});await disposed.audio.unlock();disposed.audio.dispose();
  assert.ok(pending.every(call=>call.signal.aborted));
  pending.forEach(call=>call.resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(1)}));await settleLoading();
  assert.equal(decodes,0,'do not decode using a closed context');assert.deepEqual(disposed.audio.debug.recordings,{});
  assert.equal(disposed.context.sources.length,0);
});
