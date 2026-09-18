import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillageFinanceUI, tavernQuote, tavernResult } from '../public/src/village-finance-ui.js';
import { BUILDINGS } from '../shared/world.js';
import { buildingEntrance } from '../shared/access.js';
import { TAVERN_GAMES } from '../shared/village-finance.js';

function memory() { const values=new Map();return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}; }
function fixture(options={}) {
  const storage=options.storage===undefined?memory():options.storage, sent=[],marked=[],timers=new Map(),fields=new Map();
  let html='',panel=null,buttons=[],inputs=[],nodes=[],renders=0,connected=true,serial=0,timerId=0;
  const me={id:'alice',name:'Alice',online:true,hp:100,wallet:500,...buildingEntrance(BUILDINGS.find(b=>b.id==='bank'))};
  const state={id:'village-1',day:7,status:'active',treasury:8000,merchant:{present:false},finance:{principal:2000,earnings:40,eligiblePrincipal:1500,pendingPrincipal:500,firstEligibleDay:9,dividendRate:.01,reserve:2000,availableToWithdraw:800,treasurySurplus:6000,totalPrincipal:2000,limits:{maxAction:1000000,maxPrincipal:1000000000},lastDividend:null,receipts:[]},tavern:{minStake:1,maxStake:1000,coinflipMaximumStake:500,rouletteNumberMaximumStake:40,evenMoneyMaximumStake:500,history:[]}};
  const content={contains:node=>nodes.includes(node),querySelectorAll:query=>query==='[data-vf-action]'?buttons:query==='[data-vf-input]'?inputs:[]};
  const dialog={scrollTop:0},doc={activeElement:null,getElementById:id=>id==='panel-content'?content:id==='panel-dialog'?dialog:fields.get(id)||null};
  const ui=createVillageFinanceUI({getState:()=>state,getMe:()=>me,getActivePanel:()=>panel,send:action=>{sent.push(action);return true;},markWaypoint:point=>marked.push(point),isConnected:()=>connected,document:doc,storage,reducedMotion:()=>Boolean(options.reducedMotion),makeRequestId:()=>`00000000-0000-4000-8000-${String(++serial).padStart(12,'0')}`,schedule:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;},cancel:id=>timers.delete(id),openPanel(next,nextPanel){
    html=next;panel=nextPanel;renders++;fields.clear();
    buttons=[...html.matchAll(/<button\b([^>]*)>(.*?)<\/button>/gs)].map(([,attr,body])=>({tagName:'BUTTON',label:attr.match(/aria-label="([^"]+)"/)?.[1]||body.replace(/<[^>]*>/g,''),dataset:{vfAction:attr.match(/data-vf-action="(\d+)"/)[1]},disabled:/\sdisabled(?:\s|$)/.test(attr)}));
    inputs=[...html.matchAll(/<input\b([^>]*)>/g)].map(([,attr])=>{const input={tagName:'INPUT',id:attr.match(/id="([^"]+)"/)[1],dataset:{vfInput:attr.match(/data-vf-input="([^"]+)"/)[1]},value:attr.match(/value="([^"]*)"/)[1],selectionStart:0,selectionEnd:0,focus(){doc.activeElement=input;},setSelectionRange(a,b){input.selectionStart=a;input.selectionEnd=b;}};fields.set(input.id,input);return input;});
    for(const [,attr] of html.matchAll(/<(?:div|strong|p)\b([^>]*\bid="[^"]+"[^>]*)>/g)){const id=attr.match(/id="([^"]+)"/)[1];fields.set(id,{id,innerHTML:'',textContent:''});}
    nodes=[...buttons,...inputs,...fields.values()];
  }});
  return {ui,state,me,sent,marked,timers,storage,doc,fields,get html(){return html;},get renders(){return renders;},get inputs(){return inputs;},get buttons(){return buttons;},button(label){const b=buttons.find(b=>b.label===label);assert.ok(b,'Missing '+label);return b;},click(label){const b=this.button(label);assert.equal(b.disabled,false,'Disabled '+label);return b.onclick();},press(label,{key=null}={}){const b=this.button(label);assert.equal(b.disabled,false,'Disabled '+label);doc.activeElement=b;b.activationKey=key;if(key)b.onkeydown?.({key});else b.onpointerdown?.({button:0});return b;},release(b,{cancel=false,beforeClick=()=>{}}={}){if(cancel){b.onpointercancel?.();return;}if(b.activationKey)b.onkeyup?.({key:b.activationKey});else b.onpointerup?.();beforeClick();if(buttons.includes(b)&&!b.disabled)b.onclick();for(const [id,timer] of [...timers])if(timer.delay===0){timers.delete(id);timer.fn();}},type(name,value){const input=inputs.find(i=>i.dataset.vfInput===name);assert.ok(input,'Missing input '+name);input.focus();input.value=value;input.selectionStart=input.selectionEnd=value.length;input.oninput();return input;},visit(id){Object.assign(me,buildingEntrance(BUILDINGS.find(b=>b.id===id)));},setConnected(value){connected=value;ui.update();},close(){panel=null;},receipt(extra={}){const action=sent.at(-1);const receipt={...action,id:action.requestId,requestId:action.requestId,message:'Saved by the server',day:state.day,clock:123,...extra};state.finance.receipts.unshift(receipt);ui.update();return receipt;}};
}

test('quotes expose exact win chance, total return versus profit, and wallet/liquidity limits',()=>{
  const tavern={maxStake:1000,coinflipMaximumStake:900,rouletteNumberMaximumStake:20,evenMoneyMaximumStake:400};
  assert.deepEqual(tavernQuote('coinflip','heads','10',tavern,200),{maximum:200,valid:true,stake:10,multiplier:2,total:20,profit:10,odds:'1 in 2 · 50%'});
  assert.equal(tavernQuote('roulette','number','20',tavern,200).total,720);assert.equal(tavernQuote('roulette','number','20',tavern,200).profit,700);
  assert.equal(tavernQuote('roulette','number','20',tavern,200).odds,'1 in 37 · 2.70%');
  assert.equal(tavernQuote('roulette','red','10',tavern,200).odds,'18 in 37 · 48.65%');
  for(const amount of ['0','-1','1.5','1e2','1001','', '21'])assert.equal(tavernQuote('roulette','number',amount,tavern,200).valid,false,amount);
  assert.equal(tavernQuote('coinflip','heads','10',{},200).valid,false,'missing authoritative liquidity never enables a bet');
});

test('10,000 gold is the tavern ceiling and all choices still honor wallet and treasury limits',()=>{
  const tavern={maxStake:10000,coinflipMaximumStake:10000,rouletteNumberMaximumStake:10000,evenMoneyMaximumStake:10000};
  for(const [game,choice,multiplier] of [['coinflip','heads',2],['roulette','red',2],['roulette','number',36]]){
    const quote=tavernQuote(game,choice,'10000',tavern,10000);
    assert.equal(quote.valid,true);assert.equal(quote.maximum,10000);assert.equal(quote.total,10000*multiplier);
    assert.equal(tavernQuote(game,choice,'10001',tavern,20000).valid,false);
    assert.equal(tavernQuote(game,choice,'10000',tavern,9999).valid,false);
  }
  assert.equal(tavernQuote('coinflip','heads','10000',{...tavern,coinflipMaximumStake:9999},20000).valid,false);
  assert.equal(tavernQuote('roulette','number','10000',{...tavern,rouletteNumberMaximumStake:9999},20000).valid,false);
  assert.equal(tavernQuote('roulette','red','10000',{...tavern,evenMoneyMaximumStake:9999},20000).valid,false);
  const f=fixture();f.visit('merchant');f.me.wallet=20000;Object.assign(f.state.tavern,tavern);f.ui.showTavern();
  assert.match(f.html,/BET LIMIT<\/span><strong>1–10,000g/);assert.match(f.html,/Allowed: 1–10,000g/);
  f.type('stake','10001');assert.equal(f.button('Place bet').disabled,true);
  f.click('Max');f.click('Place bet');assert.equal(f.sent[0].stake,10000);
});

test('tavern directions mark the inn entrance and explain its always-open games button',()=>{
  const f=fixture();f.ui.showTavern();
  assert.match(f.html,/Press E at the inn and choose Play tavern games/);
  f.click('Mark The Wayfarer');
  assert.deepEqual(f.marked[0],{...buildingEntrance(BUILDINGS.find(b=>b.id==='merchant')),id:'merchant',kind:'service',name:'The Wayfarer tavern'});
  f.visit('merchant');f.ui.update();assert.equal(f.button('Place bet').disabled,false);
});

test('investment ledger shows real principal, funding limits and eligibility without invented history',()=>{
  const f=fixture();f.ui.showInvestments();
  assert.match(f.html,/2,000g/);assert.match(f.html,/40g/);assert.match(f.html,/1% per completed village day/);assert.match(f.html,/skip their first dawn/);assert.match(f.html,/eligible day 9/);assert.match(f.html,/No dividend has been recorded/);assert.match(f.html,/Funds left in a fallen village are lost/);
  f.type('deposit','100');assert.match(f.fields.get('vf-projection').innerHTML,/21g/);assert.match(f.fields.get('vf-projection').innerHTML,/20g/);
  f.state.finance.lastDividend={day:6,due:20,paid:12};f.doc.activeElement=null;f.ui.update();assert.match(f.html,/day 6 · 12g paid of 20g calculated/);
});

test('typing 10 survives frequent snapshots; focused controls revalidate live wallet and principal limits',()=>{
  const f=fixture();f.ui.showInvestments();const input=f.type('deposit','1'),renders=f.renders;
  f.me.wallet=300;f.ui.update();assert.equal(f.renders,renders);assert.equal(f.inputs.find(i=>i.id===input.id),input);
  f.type('deposit','10');f.click('Invest amount');assert.equal(f.sent.at(-1).amount,10);assert.equal(f.me.wallet,300,'the UI never deducts optimistically');
  f.receipt({amount:10});f.type('withdrawal','900');assert.equal(f.button('Withdraw amount').disabled,true);
  f.state.finance.availableToWithdraw=1000;f.ui.update();assert.equal(f.button('Withdraw amount').disabled,false);
});

test('investment max, claim, reinvest and withdrawal actions use unique receipts and current limits',()=>{
  const f=fixture();f.ui.showInvestments();f.click('Invest max');assert.equal(f.sent.at(-1).kind,'investment_deposit');assert.equal(f.sent.at(-1).amount,500);f.receipt({amount:500});
  f.click('Claim earnings');assert.deepEqual({...f.sent.at(-1),requestId:'id'},{type:'action',kind:'investment_claim',requestId:'id',max:true});f.receipt({amount:40});
  f.click('Reinvest earnings');assert.equal(f.sent.at(-1).kind,'investment_reinvest');f.receipt({amount:40});
  f.click('Withdraw max');assert.equal(f.sent.at(-1).kind,'investment_withdraw');assert.equal(f.sent.at(-1).max,true);assert.equal(new Set(f.sent.map(a=>a.requestId)).size,4);
});

test('coin bets commit before animation, ignore double clicks, and Skip shows that same saved result',()=>{
  const f=fixture();f.visit('merchant');f.ui.showTavern();assert.doesNotMatch(f.html,/The merchant is on the road/,'tavern operates even when the merchant is away');
  f.click('Choose tails');const place=f.button('Place bet');place.onclick();place.onclick();assert.equal(f.sent.length,1);assert.equal(f.sent[0].choice,'tails');assert.match(f.html,/Waiting for your bet to be saved/);assert.doesNotMatch(f.html,/vf-coin spinning/);assert.equal(f.me.wallet,500);
  const receipt=f.receipt({game:'coinflip',outcome:'tails',stake:10,payout:20,net:10,win:true,walletAfter:510,treasuryAfter:7990,message:'Tails wins 10 gold!'});
  assert.match(f.html,/vf-coin spinning/);assert.doesNotMatch(f.html,/Tails wins 10 gold!/);assert.equal(f.timers.size,1);assert.equal(f.ui.receive({type:'notice',requestId:receipt.requestId,message:receipt.message}),true,'generic notice cannot spoil reveal');
  f.click('Skip reveal');assert.match(f.html,/Tails · You won 10 gold profit/);assert.match(f.html,/total returned 20g/);assert.match(f.html,/--coin-rest:180deg/);assert.equal(f.timers.size,0);assert.equal(f.sent.length,1);assert.equal(f.me.wallet,500,'balance changes wait for state snapshots');
});

test('a bet click survives changing balances while the button is pressed',()=>{
  const f=fixture();f.visit('merchant');f.ui.showTavern();
  const button=f.press('Place bet'),renders=f.renders;
  f.state.treasury-=1;f.me.wallet+=1;f.ui.update();
  assert.equal(f.button('Place bet'),button,'a snapshot cannot detach the native click target');
  assert.equal(f.renders,renders);assert.equal(button.disabled,false);
  f.release(button,{beforeClick(){f.state.treasury-=1;f.ui.update();assert.equal(f.button('Place bet'),button,'pointerup still waits for the native click');}});
  assert.equal(f.sent.length,1);assert.equal(f.sent[0].kind,'tavern_bet');assert.equal(f.sent[0].stake,10);
  assert.match(f.html,/Waiting for your bet to be saved/);assert.match(f.html,/501g/);
});

test('cancelling a press allows the next snapshot to refresh the panel',()=>{
  const f=fixture();f.visit('merchant');f.ui.showTavern();
  const button=f.press('Place bet'),renders=f.renders;
  f.state.treasury-=1;f.ui.update();assert.equal(f.button('Place bet'),button);
  f.release(button,{cancel:true});f.ui.update();
  assert.equal(f.renders,renders+1);assert.match(f.html,/7,999g/);assert.equal(f.sent.length,0);
});

test('keyboard activation preserves the bet target until its native click',()=>{
  for(const key of [' ','Enter']){
    const f=fixture();f.visit('merchant');f.ui.showTavern();const button=f.press('Place bet',{key});
    f.state.treasury-=1;f.ui.update();assert.equal(f.button('Place bet'),button,key);
    f.release(button,{beforeClick(){f.state.treasury-=1;f.ui.update();assert.equal(f.button('Place bet'),button,key);}});
    assert.equal(f.sent.length,1,key);assert.equal(f.timers.size,0,'release fallback cannot linger after a click');
  }
});

test('funds and connection changes still block a bet during button activation',()=>{
  for(const changed of ['wallet','liquidity','connection']){
    const f=fixture();f.visit('merchant');f.ui.showTavern();const button=f.press('Place bet');
    if(changed==='wallet')f.me.wallet=5;
    else if(changed==='liquidity')f.state.tavern.coinflipMaximumStake=5;
    else f.setConnected(false);
    f.ui.update();assert.equal(f.button('Place bet').disabled,true,changed);
    f.release(button);assert.equal(f.sent.length,0,changed);
    f.ui.update();assert.equal(f.button('Place bet').disabled,true,changed);
  }
});

test('bet validation explains the current restriction beside Place bet',()=>{
  const f=fixture();f.visit('merchant');f.ui.showTavern();assert.match(f.html,/Ready to bet 10g/);
  f.type('stake','1.5');assert.match(f.fields.get('vf-bet-validation').textContent,/whole-gold stake from 1 to 500g/);
  f.type('stake','10');f.me.wallet=0;f.ui.update();assert.match(f.fields.get('vf-bet-validation').textContent,/at least 1 gold in your wallet/);
  f.me.wallet=500;f.state.tavern.coinflipMaximumStake=0;f.ui.update();assert.match(f.fields.get('vf-bet-validation').textContent,/treasury cannot cover a win/);
  f.state.tavern.coinflipMaximumStake=500;f.me.x=0;f.me.z=0;f.ui.update();assert.match(f.fields.get('vf-bet-validation').textContent,/Visit The Wayfarer entrance/);
  f.visit('merchant');f.me.mountedHorseId='horse';f.ui.update();assert.match(f.fields.get('vf-bet-validation').textContent,/Stand on foot/);
  f.me.mountedHorseId=null;f.setConnected(false);assert.match(f.fields.get('vf-bet-validation').textContent,/Reconnect to the village/);
});

test('roulette offers all 37 numbers, precise straight-number stake limits and zero loss on outside bets',()=>{
  const f=fixture({reducedMotion:true});f.visit('merchant');f.ui.showTavern();f.click('European roulette');
  assert.equal(f.buttons.filter(b=>/^Bet on number /.test(b.label)).length,37);assert.match(f.html,/There is no double zero/);
  f.click('Bet on number 0');f.type('stake','41');assert.equal(f.button('Place bet').disabled,true);f.type('stake','40');f.click('Place bet');assert.deepEqual({...f.sent.at(-1),requestId:'id'},{type:'action',kind:'tavern_bet',requestId:'id',game:'roulette',stake:40,choice:'number',number:0});
  f.receipt({game:'roulette',outcome:0,color:'green',stake:40,payout:1440,walletAfter:1900,win:true});assert.equal(f.timers.size,0);assert.match(f.html,/0 green · You won 1,400 gold profit/);
  f.click('RED');f.type('stake','10');f.click('Place bet');f.receipt({game:'roulette',outcome:0,color:'green',stake:10,payout:0,walletAfter:1890,win:false});assert.match(f.html,/0 green · You lost 10 gold/);
});

test('a 2,000g green bet explains its odds and the animated wheel reveals the saved zero and payout',()=>{
  const f=fixture();f.visit('merchant');f.me.wallet=250000;Object.assign(f.state.tavern,{maxStake:10000,rouletteNumberMaximumStake:10000});f.ui.showTavern();f.click('European roulette');
  f.click('Bet on number 0');
  assert.match(f.html,/1 in 37 · 2.70%/);assert.match(f.html,/Green is only zero: 1 in 37 \(2.70%\) each spin/);
  assert.match(f.html,/Earlier spins do not change the odds/);
  f.type('stake','2000');assert.match(f.fields.get('vf-bet-quote').innerHTML,/72,000g/);assert.match(f.fields.get('vf-bet-quote').innerHTML,/\+70,000g/);
  f.click('Place bet');assert.equal(f.sent[0].number,0);assert.equal(f.sent[0].stake,2000);
  f.receipt({game:'roulette',outcome:0,color:'green',stake:2000,payout:72000,net:70000,win:true});
  assert.match(f.html,/vf-wheel-disc spinning/);assert.match(f.html,/--wheel-end:1800.000deg;--wheel-rest:0.000deg/);
  assert.equal(f.timers.size,1);f.click('Skip reveal');
  assert.match(f.html,/0 green · You won 70,000 gold profit/);assert.match(f.html,/total returned 72,000g/);
  assert.equal(f.timers.size,0);assert.equal(f.sent.length,1,'revealing the zero never starts another spin');
});

test('same pending receipt survives reconnect/reload and an old direct receipt restores without a second debit',()=>{
  const f=fixture();f.visit('merchant');f.ui.showTavern();f.click('Place bet');const action=f.sent[0];assert.ok([...f.storage.values.keys()].some(k=>k.endsWith(':pending')));f.setConnected(false);assert.equal(f.button('Recover pending action').disabled,true);
  const reload=fixture({storage:f.storage,reducedMotion:true});reload.visit('merchant');reload.ui.showTavern();reload.click('Recover pending action');assert.deepEqual(reload.sent[0],action);assert.equal(reload.me.wallet,500);
  assert.equal(reload.ui.receive({type:'financeReceipt',requestId:action.requestId,receipt:{...action,id:action.requestId,game:'coinflip',outcome:'heads',payout:20,walletAfter:510}}),true);
  assert.match(reload.html,/Heads · You won 10 gold profit/);assert.ok(![...reload.storage.values.keys()].some(k=>k.endsWith(':pending')));assert.equal(reload.sent.length,1);
});

test('correlated errors release failed actions; unrelated or transient errors do not erase receipts',()=>{
  const f=fixture();f.ui.showInvestments();f.click('Invest amount');const id=f.sent[0].requestId;
  assert.equal(f.ui.receive({type:'error',requestId:'other',message:'Other action'}),false);assert.match(f.html,/Recover pending action/);
  f.ui.receive({type:'error',requestId:id,code:'TRANSIENT',message:'Retry connection'});assert.match(f.html,/Recover pending action/);
  assert.equal(f.ui.receive({type:'error',requestId:id,message:'Insufficient wallet gold'}),true);assert.doesNotMatch(f.html,/Recover pending action/);assert.match(f.html,/Insufficient wallet gold/);assert.equal(f.button('Invest amount').disabled,false);
});

test('remote previews mark the real entrance but stale click handlers cannot transact after moving away',()=>{
  const f=fixture();f.me.x=0;f.me.z=0;f.ui.showInvestments();assert.equal(f.button('Invest amount').disabled,true);f.click('Mark treasury');assert.deepEqual({x:f.marked[0].x,z:f.marked[0].z},buildingEntrance(BUILDINGS.find(b=>b.id==='bank')));
  f.visit('bank');f.ui.showInvestments();const old=f.button('Invest amount');f.me.x=0;f.me.z=0;old.onclick();assert.equal(f.sent.length,0);
  f.visit('merchant');f.ui.showTavern();const bet=f.button('Place bet');f.me.downed=true;bet.onclick();assert.equal(f.sent.length,0);f.me.downed=false;f.state.status='fallen';f.ui.update();assert.equal(f.button('Place bet').disabled,true);
});

test('storage failure blocks a transaction and old village receipts cannot leak into another village',()=>{
  const f=fixture({storage:null});f.ui.showInvestments();f.click('Invest amount');assert.equal(f.sent.length,0);assert.match(f.html,/Enable browser storage/);
  const other=fixture();other.ui.showInvestments();other.click('Invest amount');other.state.id='village-2';other.ui.showInvestments();assert.doesNotMatch(other.html,/Recover pending action/);
});

test('saved result rendering escapes server messages and reports exact loss versus profit',()=>{
  assert.deepEqual(tavernResult({game:'roulette',outcome:36,stake:10,payout:360}),{outcome:'36 red',total:360,profit:350,label:'You won 350 gold profit'});
  const f=fixture();f.ui.showInvestments();f.click('Invest amount');f.receipt({amount:10,message:'<img src=x onerror=alert(1)>'});assert.match(f.html,/&lt;img/);assert.doesNotMatch(f.html,/<img src=x/);
});

test('all four new games are selectable in the same tavern and respect their authoritative limits', () => {
  const f = fixture(); f.visit('merchant'); Object.assign(f.state.tavern, { blackjackMaximumStake: 100, pokerMaximumAnte: 100, slotsMaximumStake: 100, wheelMaximumStake: 100 }); f.ui.showTavern();
  for (const [label, id, text] of [['Blackjack', 'blackjack', /soft 17/], ['Three-card poker', 'three_card_poker', /ante plus 2× play/], ['Enchanted reels', 'slots', /216 symbol combinations/], ['Wheel of Fate', 'wheel', /twenty stops/]]) {
    f.click(label); assert.match(f.html, text); assert.equal(f.button('Place bet').disabled, false); assert.match(f.html, /Largest possible total return/);
    assert.equal(tavernQuote(id, '', '101', f.state.tavern, f.me.wallet).valid, false);
  }
  assert.equal(tavernQuote('three_card_poker', '', '100', f.state.tavern, 199).valid, false);
  assert.equal(tavernQuote('blackjack', '', '11', f.state.tavern, 100).total, 27);
  assert.equal(tavernQuote('slots', '', '10', f.state.tavern, 100).total, 300);
  f.click('Enchanted reels'); f.click('Place bet'); assert.equal(f.sent[0].game, 'slots');
});

test('blackjack private hand controls send recoverable hit/stand moves and keep a press through updates', () => {
  const f = fixture(); f.visit('merchant'); f.state.tavern.blackjackMaximumStake = 100; f.ui.showTavern(); f.click('Blackjack'); f.click('Place bet');
  const round = { id: f.sent[0].requestId, game: 'blackjack', stake: 10, totalStake: 10, cards: [0, 1], dealer: [13, null], value: 5, secondsRemaining: 120 };
  f.state.tavern.round = round; f.receipt({ game: 'blackjack', status: 'playing', roundId: round.id, round });
  assert.match(f.html, /Your hand · 5/); assert.match(f.html, /Face-down card/); assert.equal(f.buttons.some(button => button.label === 'Place bet'), false);
  const held = f.press('Hit'); f.state.tavern.round = { ...round, secondsRemaining: 119 }; f.ui.update(); f.release(held);
  assert.equal(f.sent[1].roundId, round.id); assert.equal(f.sent[1].move, 'hit'); assert.notEqual(f.sent[1].requestId, round.id);
  assert.equal(f.button('Stand').disabled, true);
  f.receipt({ game: 'blackjack', status: 'playing', roundId: round.id, round: { ...round, value: 9, cards: [0, 1, 2] } });
  f.state.tavern.round = { ...round, value: 9, cards: [0, 1, 2] }; f.ui.update(); f.click('Stand'); assert.equal(f.sent[2].move, 'stand');
});

test('poker play requires its extra wager and reconnect resumes a hand then shows automatic folding', () => {
  const f = fixture(); f.visit('merchant');
  const round = { id: '00000000-0000-4000-8000-000000000101', game: 'three_card_poker', stake: 100, totalStake: 100, cards: [0, 15, 30], dealer: [null, null, null], hand: 'High card', secondsRemaining: 32 };
  f.state.tavern.round = round; f.me.wallet = 99; f.ui.showTavern();
  assert.equal(f.button('Play · 100g').disabled, true); assert.equal(f.button('Fold').disabled, false); assert.match(f.html, /32 village seconds/);
  f.state.tavern.history.unshift({ kind: 'tavern_bet', requestId: '00000000-0000-4000-8000-000000000102', game: 'three_card_poker', status: 'settled', roundId: round.id, stake: 100, payout: 0, outcome: 'Fold', cards: round.cards, dealer: [13, 28, 42] });
  f.state.tavern.round = null; f.ui.update(); assert.match(f.html, /Fold · You lost 100 gold/); assert.equal(f.buttons.some(button => button.label === 'Fold'), false);
});

function bettingRecord(totals = {}, byGame = {}) {
  const empty = { bets: 0, wins: 0, losses: 0, pushes: 0, wagered: '0', returned: '0', won: '0', lost: '0', net: '0' };
  return { totals: { ...empty, ...totals }, byGame: Object.fromEntries(Object.keys(TAVERN_GAMES).map(id => [id, { ...empty, ...byGame[id] }])) };
}

test('betting stats are readable anywhere and missing authoritative totals are not shown as zero', () => {
  const f = fixture();
  f.me.hp = 0; f.me.downed = true; f.me.x = 0; f.me.z = 0; f.state.status = 'fallen';
  f.ui.showTavernStats();
  assert.match(f.html, /class="village-finance vf-tavern-stats"/);
  assert.match(f.html, /Loading your record/);
  assert.doesNotMatch(f.html, /0g|Visit .*entrance|Stand on foot|Place bet/);
  assert.equal(f.button('All villages').disabled, false);
  assert.equal(f.button('This village').disabled, false);
  assert.equal(f.button('Back to tavern').disabled, false);
  f.state.tavern.stats = { lifetime: bettingRecord(), village: bettingRecord() }; f.ui.update();
  assert.doesNotMatch(f.html, /Loading your record/);
  assert.match(f.html, /No finished bets in this view yet/);
  assert.match(f.html, /Only your own results are shown/);
  assert.match(f.html, /Unfinished hands are excluded/);
  assert.equal(f.sent.length, 0, 'reading totals never sends a betting action');
});

test('betting stats preserve exact lifetime gold strings and distinguish profits, losses, and returned stakes', () => {
  const f = fixture(), won = 9007199254740993007n, lost = 225n;
  const totals = { bets: 9, wins: 4, losses: 3, pushes: 2, won: String(won), lost: String(lost), net: String(won - lost), wagered: '1000', returned: String(1000n + won - lost) };
  f.state.tavern.stats = { lifetime: bettingRecord(totals, { roulette: totals }), village: bettingRecord({ bets: 1, losses: 1, wagered: '125', lost: '125', net: '-125' }) };
  f.ui.showTavernStats();
  assert.match(f.html, /9,007,199,254,740,993,007g/);
  assert.match(f.html, /\+9,007,199,254,740,992,782g/);
  assert.match(f.html, /9,007,199,254,740,993,782g/);
  assert.match(f.html, /Gold won is profit after your stake is returned/);
  assert.match(f.html, /Gold lost is the part of a stake you did not get back/);
  assert.match(f.html, /<dt>Draws<\/dt><dd>2<\/dd>/);
  assert.match(f.html, /4 wins · 3 losses · 2 draws/);
  assert.match(f.html, /aria-pressed="true">All villages/);
  for (const label of Object.values(TAVERN_GAMES)) assert.ok(f.html.includes(label), label);
  f.click('This village');
  assert.match(f.html, /aria-pressed="true">This village/);
  assert.match(f.html, /<span>Net profit<\/span><strong>-125g<\/strong>/);
  assert.doesNotMatch(f.html, /9,007,199/);
  f.click('All villages'); assert.match(f.html, /9,007,199,254,740,993,007g/);
});

test('betting stats refresh from live totals, preserve tab clicks, and label disconnected data', () => {
  const f = fixture(); f.state.tavern.stats = { lifetime: bettingRecord(), village: bettingRecord() }; f.ui.showTavernStats();
  const initialRenders = f.renders;
  f.state.treasury += 100; f.me.wallet += 100; f.state.finance.earnings += 10; f.ui.update();
  assert.equal(f.renders, initialRenders, 'unrelated world and account balances cannot repeatedly redraw the stats table');
  const held = f.press('This village');
  f.state.tavern.stats.lifetime = bettingRecord({ bets: 1, wins: 1, wagered: '10', returned: '20', won: '10', net: '10' }); f.ui.update();
  assert.equal(f.button('This village'), held, 'incoming totals preserve an in-progress scope click');
  f.release(held); assert.match(f.html, /aria-pressed="true">This village/);
  f.click('All villages'); assert.match(f.html, /<span>Net profit<\/span><strong>\+10g<\/strong>/);
  f.setConnected(false); assert.match(f.html, /These are your last received totals/);
  f.setConnected(true); assert.doesNotMatch(f.html, /These are your last received totals/);
  f.state.tavern.stats.lifetime = bettingRecord({ bets: 2, wins: 1, losses: 1, wagered: '30', returned: '20', won: '10', lost: '20', net: '-10' }); f.ui.update();
  assert.match(f.html, /<span>Net profit<\/span><strong>-10g<\/strong>/);
  assert.match(f.html, /<dt>Finished bets<\/dt><dd>2<\/dd>/);
  assert.equal(f.sent.length, 0);
});

test('stats navigation preserves pending receipts and accepting a result there never places another bet', () => {
  const f = fixture(); f.visit('merchant'); f.state.tavern.stats = { lifetime: bettingRecord(), village: bettingRecord() }; f.ui.showTavern();
  f.click('Place bet'); const action = f.sent[0];
  f.click('Betting stats');
  assert.match(f.html, /Your bet is awaiting its saved result/);
  assert.match(f.html, /<dt>Finished bets<\/dt><dd>0<\/dd>/);
  f.click('Back to tavern'); f.click('Recover pending action'); assert.deepEqual(f.sent[1], action);
  f.click('Betting stats');
  f.receipt({ game: 'coinflip', status: 'settled', stake: 10, payout: 20, outcome: 'heads', net: 10 });
  assert.doesNotMatch(f.html, /awaiting its saved result|vf-coin spinning/);
  assert.equal(f.timers.size, 0, 'no reveal timer runs while the dashboard is open');
  assert.match(f.html, /<dt>Finished bets<\/dt><dd>0<\/dd>/, 'the UI waits for authoritative totals instead of adding a result optimistically');
  f.state.tavern.stats = { lifetime: bettingRecord({ bets: 1, wins: 1, wagered: '10', returned: '20', won: '10', net: '10' }), village: bettingRecord() }; f.ui.update();
  assert.match(f.html, /<dt>Finished bets<\/dt><dd>1<\/dd>/);
  f.click('Back to tavern'); assert.match(f.html, /Heads · You won 10 gold profit/);
  assert.equal(f.sent.length, 2, 'only the original action and its identical recovery were sent');
  assert.ok(![...f.storage.values.keys()].some(key => key.endsWith(':pending')));
});

test('opening betting stats after a reload preserves the original pending action for recovery', () => {
  const f = fixture(); f.visit('merchant'); f.ui.showTavern(); f.click('Place bet'); const original = f.sent[0];
  const reload = fixture({ storage: f.storage }); reload.visit('merchant');
  reload.state.tavern.stats = { lifetime: bettingRecord(), village: bettingRecord() }; reload.ui.showTavernStats();
  assert.match(reload.html, /Your bet is awaiting its saved result/); assert.equal(reload.sent.length, 0);
  reload.click('Back to tavern'); reload.click('Recover pending action');
  assert.deepEqual(reload.sent[0], original);
});

test('betting stats preserve an active poker hand and returning to the table retains its actions', () => {
  const f = fixture(); f.visit('merchant');
  const round = { id: '00000000-0000-4000-8000-000000000101', game: 'three_card_poker', stake: 100, totalStake: 100, cards: [0, 15, 30], dealer: [null, null, null], hand: 'High card', secondsRemaining: 32 };
  f.state.tavern.round = round; f.state.tavern.stats = { lifetime: bettingRecord(), village: bettingRecord() }; f.ui.showTavern();
  f.click('Betting stats'); assert.match(f.html, /Your card hand is still in progress/);
  f.click('This village'); assert.match(f.html, /<dt>Finished bets<\/dt><dd>0<\/dd>/);
  f.click('Back to tavern'); assert.match(f.html, /32 village seconds remain/);
  assert.equal(f.button('Play · 100g').disabled, false); assert.equal(f.button('Fold').disabled, false);
  f.click('Play · 100g'); assert.equal(f.sent[0].roundId, round.id); assert.equal(f.sent[0].move, 'play');
  assert.equal(f.sent.length, 1);
});

test('leaving a reveal for stats finishes that reveal once and never rerolls the saved outcome', () => {
  const f = fixture(); f.visit('merchant'); f.state.tavern.stats = { lifetime: bettingRecord(), village: bettingRecord() }; f.ui.showTavern(); f.click('Place bet');
  f.receipt({ game: 'coinflip', status: 'settled', stake: 10, payout: 0, outcome: 'tails', net: -10 });
  assert.equal(f.timers.size, 1); assert.match(f.html, /vf-coin spinning/);
  f.click('Betting stats'); assert.equal(f.timers.size, 0);
  f.click('Back to tavern'); assert.match(f.html, /Tails · You lost 10 gold/);
  assert.doesNotMatch(f.html, /vf-coin spinning/); assert.equal(f.sent.length, 1);
});
