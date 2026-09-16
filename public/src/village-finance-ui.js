import { BUILDINGS } from '../../shared/world.js';
import { buildingEntrance, canUseBuilding } from '../../shared/access.js';
import { INVESTMENT_RULES, TAVERN_RULES, rouletteColor } from '../../shared/village-finance.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const count = value => Math.max(0, Number.isFinite(Number(value)) ? Math.floor(Number(value)) : 0);
const gold = value => count(value).toLocaleString('en-US');
const estimate = value => Math.max(0, Number(value) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const WHEEL = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
const color = n => rouletteColor(Number(n));
const safeStorage = () => { try { return globalThis.localStorage; } catch { return null; } };
const isUUID = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function tavernQuote(game, choice, stake, tavern = {}, wallet = 0) {
  const exact = game === 'roulette' && choice === 'number', multiplier = exact ? TAVERN_RULES.rouletteNumberMultiplier : game === 'coinflip' ? TAVERN_RULES.coinflipMultiplier : TAVERN_RULES.rouletteEvenMoneyMultiplier;
  const serverMax = game === 'coinflip' ? tavern.coinflipMaximumStake : exact ? tavern.rouletteNumberMaximumStake : tavern.evenMoneyMaximumStake;
  const maximum = Math.max(0, Math.min(1000, count(tavern.maxStake ?? 1000), count(serverMax), count(wallet)));
  const amount = Number(stake), valid = /^\d+$/.test(String(stake)) && Number.isSafeInteger(amount) && amount >= Math.max(1, count(tavern.minStake ?? 1)) && amount <= maximum;
  return { maximum, valid, stake: valid ? amount : 0, multiplier, total: valid ? amount * multiplier : 0, profit: valid ? amount * (multiplier - 1) : 0, odds: game === 'coinflip' ? '1 in 2 · 50%' : exact ? '1 in 37 · 2.70%' : '18 in 37 · 48.65%' };
}
export function tavernResult(receipt) {
  const outcome = receipt.game === 'coinflip' ? String(receipt.outcome).replace(/^./, c => c.toUpperCase()) : `${receipt.outcome} ${color(Number(receipt.outcome))}`;
  const total = count(receipt.payout), stake = count(receipt.stake);
  return { outcome, total, profit: total - stake, label: total > stake ? `You won ${gold(total - stake)} gold profit` : `You lost ${gold(stake - total)} gold` };
}
function coinArt(side = 'heads') {
  return `<svg viewBox="0 0 160 160" role="img" aria-label="${side === 'heads' ? 'Crowned hearth, heads side' : 'Crossed axes, tails side'}"><circle cx="80" cy="80" r="72" fill="#8d6229"/><circle cx="80" cy="78" r="68" fill="#d4af60" stroke="#f4df9a" stroke-width="3"/><circle cx="80" cy="78" r="57" fill="#b5853d" stroke="#e8cd80" stroke-width="2" stroke-dasharray="2 5"/><circle cx="80" cy="78" r="47" fill="#d2ad60"/>${side === 'heads' ? '<path d="m44 94 7-38 18 16 12-30 12 30 18-16 7 38Z" fill="#755021" stroke="#f0d391" stroke-width="3"/><path d="M49 103h64M56 113h50" stroke="#89632c" stroke-width="5"/>' : '<path d="m49 45 64 69M110 43l-62 73" stroke="#7a5525" stroke-width="10"/><path d="m45 33 29 19-21 22-21-19ZM112 32l-27 22 21 19 22-20Z" fill="#755021" stroke="#f0d391" stroke-width="3"/>'}<circle cx="80" cy="15" r="3" fill="#fbebad"/><circle cx="80" cy="141" r="3" fill="#fbebad"/></svg>`;
}
function wheelArt() {
  const step = Math.PI * 2 / 37;
  return `<svg viewBox="0 0 300 300" role="img" aria-label="European roulette wheel with one green zero and 36 numbered pockets"><circle cx="150" cy="150" r="147" fill="#51372b" stroke="#d2ae65" stroke-width="5"/>${WHEEL.map((n, i) => { const a = i * step - Math.PI / 2 - step / 2, b = a + step; const x = t => 150 + Math.cos(t) * 136, y = t => 150 + Math.sin(t) * 136; const mid = a + step / 2; return `<path d="M150 150L${x(a).toFixed(3)} ${y(a).toFixed(3)}A136 136 0 0 1 ${x(b).toFixed(3)} ${y(b).toFixed(3)}Z" fill="${color(n) === 'red' ? '#974139' : color(n) === 'green' ? '#47745a' : '#202e32'}" stroke="#ba9966" stroke-width=".8"/><text x="${(150 + Math.cos(mid) * 119).toFixed(3)}" y="${(154 + Math.sin(mid) * 119).toFixed(3)}" text-anchor="middle" fill="#f8e7c9" font-size="10" font-family="Georgia">${n}</text>`; }).join('')}<circle cx="150" cy="150" r="97" fill="#3d2e27" stroke="#c7a46c" stroke-width="3"/><circle cx="150" cy="150" r="82" fill="#8d663b" stroke="#ab8650" stroke-width="2"/><path d="M150 92v116M92 150h116" stroke="#e4c27b" stroke-width="8"/><circle cx="150" cy="150" r="23" fill="#d6b476" stroke="#f0d79a" stroke-width="4"/><circle cx="150" cy="150" r="9" fill="#786044"/></svg>`;
}
function investmentArt() {
  return '<svg viewBox="0 0 360 175" role="img" aria-label="Village treasury and a growing stack of gold"><path d="M15 149h330" stroke="#b39664" stroke-width="2"/><path d="m35 66 97-47 95 47Z" fill="#a89668" stroke="#d7c18b" stroke-width="2"/><path d="M50 71h160v63H50Z" fill="#304548"/><path d="M43 136h176v12H43Z" fill="#a39166"/><path d="M60 72h20v62H60ZM108 72h20v62h-20ZM158 72h20v62h-20Z" fill="#c0ac7a"/><path d="M98 107h49v27H98Z" fill="#23383b"/><path d="m126 29 6 11 12 2-9 8 2 13-11-6-11 6 2-13-9-8 12-2Z" fill="#f1d79b"/><g fill="#c9a456" stroke="#f0d08a" stroke-width="2"><ellipse cx="240" cy="137" rx="31" ry="9"/><path d="M209 126v11q31 18 62 0v-11"/><ellipse cx="240" cy="126" rx="31" ry="9"/><path d="M209 115v11q31 18 62 0v-11"/><ellipse cx="240" cy="115" rx="31" ry="9"/><path d="M267 91v46q29 17 58 0V91"/><ellipse cx="296" cy="91" rx="29" ry="9"/><path d="M267 104q29 17 58 0m-58 12q29 17 58 0m-58 12q29 17 58 0"/></g><path d="M236 70q24-27 64-32m-18-10 20 10-12 17" fill="none" stroke="#a6c69b" stroke-width="4" stroke-linecap="round"/></svg>';
}

export function createVillageFinanceUI({ getState, getMe, getActivePanel, openPanel, send, toast = () => {}, markWaypoint = () => {}, markTarget = markWaypoint, isConnected = () => true,
  document: doc = globalThis.document, storage = safeStorage(), makeRequestId = () => globalThis.crypto.randomUUID(), reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  schedule = (fn, ms) => setTimeout(fn, ms), cancel = id => clearTimeout(id) }) {
  let view = 'investments', game = 'coinflip', coinChoice = 'heads', rouletteChoice = 'red', number = 1, stake = '10', deposit = '10', withdrawal = '10';
  let context = null, pending = null, result = null, resultVisible = true, error = '', message = '', handlers = [], controls = new Map(), signature = '', timer = null, lastReceiptId = null;
  const active = () => ['investments', 'tavern'].includes(getActivePanel());
  const state = () => getState() || {};
  const me = () => getMe() || {};
  const finance = () => state().finance || {};
  const tavern = () => state().tavern || {};
  const content = () => doc.getElementById('panel-content');
  const key = suffix => `emberwatch-finance:${context}:${suffix}`;
  function read(suffix) { try { return JSON.parse(storage?.getItem(key(suffix)) || 'null'); } catch { return null; } }
  function save(suffix, value) { if (!storage) { if(value)throw new Error('Browser storage is unavailable.'); return; } if(value === null)storage.removeItem(key(suffix)); else storage.setItem(key(suffix), JSON.stringify(value)); }
  function ensureContext() {
    const current = state().id && me().id ? `${state().id}:${me().id}` : null;
    if (current !== context) { clear(); context = current; if (context) { const saved = read('pending'); if(saved && isUUID(saved.requestId))pending = saved; const prior = read('result'); if(prior?.requestId){result = prior;lastReceiptId=prior.requestId;} } }
    return Boolean(context);
  }
  const standing = () => state().status === 'active' && me().online !== false && me().hp > 0 && !me().downed && !me().carriedBy && !me().carryingId && !me().bedPlotId && !me().mountedHorseId;
  const building = type => BUILDINGS.find(site => site.id === (type === 'tavern' ? 'merchant' : 'bank'));
  const local = type => standing() && canUseBuilding(me(), building(type));
  const wallet = () => count(me().wallet);
  const quote = () => tavernQuote(game, game === 'coinflip' ? coinChoice : rouletteChoice, stake, tavern(), wallet());
  const depositMax = () => Math.max(0, Math.min(wallet(), count(finance().limits?.maxAction ?? INVESTMENT_RULES.maxAction), count(finance().limits?.maxPrincipal ?? INVESTMENT_RULES.maxPrincipal) - count(finance().principal)));
  const withdrawMax = () => Math.max(0, Math.min(count(finance().principal), count(finance().availableToWithdraw)));
  const whole = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
  function enabled(kind) {
    if (pending || !isConnected() || !resultVisible) return false;
    if (kind === 'bet') return local('tavern') && quote().valid && (rouletteChoice !== 'number' || Number.isInteger(number) && number >= 0 && number <= 36);
    if (!local('investments')) return false;
    if (kind === 'deposit') return whole(deposit) && Number(deposit) <= depositMax();
    if (kind === 'deposit-max') return depositMax() > 0;
    if (kind === 'withdraw') return whole(withdrawal) && Number(withdrawal) <= Math.min(withdrawMax(), count(finance().limits?.maxAction ?? INVESTMENT_RULES.maxAction));
    if (kind === 'withdraw-max') return withdrawMax() > 0;
    if (kind === 'claim') return count(finance().earnings) > 0;
    if (kind === 'reinvest') return count(finance().earnings) > 0 && count(finance().principal) < count(finance().limits?.maxPrincipal ?? INVESTMENT_RULES.maxPrincipal);
    return false;
  }
  function button(label, callback, { disabled = false, control = null, className = 'vf-button', ariaLabel = null } = {}) {
    const index = handlers.push(callback) - 1;
    if (control) controls.set(control, index);
    return `<button type="button" class="${className}" data-vf-action="${index}"${ariaLabel ? ` aria-label="${esc(ariaLabel)}"` : ''}${disabled ? ' disabled' : ''}>${label}</button>`;
  }
  function transaction(kind, extra = {}, gate = null) {
    if (!ensureContext() || pending || gate && !enabled(gate)) return;
    const action = { type: 'action', kind, requestId: makeRequestId(), ...extra };
    try { save('pending', action); } catch { error = 'The action could not be saved for recovery. Enable browser storage and try again.'; render(); return; }
    pending = action; error = ''; message = ''; send(action); render();
  }
  function recover() { if (!pending || !isConnected()) return; error = ''; send({ ...pending }); message = 'Checking the original action. Its receipt is reused; this is not a new purchase or bet.'; render(); }
  function finish() { cancel(timer); timer = null; resultVisible = true; if (active())render(); }
  function accept(receipt) {
    if (!receipt || receipt.requestId !== pending?.requestId) return false;
    pending = null; try { save('pending', null); } catch {}
    lastReceiptId=receipt.requestId;error = ''; message = receipt.kind==='tavern_bet'?'':receipt.message || 'Action completed.';
    if (receipt.kind === 'tavern_bet') {
      result = receipt; try { save('result', result); } catch {}
      resultVisible = reducedMotion() || !active() || view !== 'tavern';
      cancel(timer); timer = resultVisible ? null : schedule(finish, 2600);
    }
    if (active())render(); return true;
  }
  function receive(packet) {
    if (!ensureContext()) return false;
    if(packet?.type==='notice' && (packet.requestId===pending?.requestId||packet.requestId===lastReceiptId)&&packet.requestId)return true;
    if(!pending)return false;
    const receipt = packet?.receipt || (packet?.type === 'finance_receipt' ? packet : null);
    if (receipt && accept(receipt)) return true;
    if (packet?.type === 'error' && packet.requestId === pending.requestId) {
      if (['RATE_LIMIT', 'DISCONNECTED', 'TRANSIENT'].includes(packet.code)) { error = packet.message || 'The action needs a connection. Recover it with the same receipt.'; }
      else { pending = null; try { save('pending', null); } catch {} error = packet.message || 'The action was rejected.'; }
      if(active())render();return true;
    }
    return false;
  }
  function status() {
    let html = error ? `<p class="vf-error" role="alert">${esc(error)}</p>` : message && resultVisible ? `<p class="vf-notice" role="status">${esc(message)}</p>` : '';
    if (pending) html += `<div class="vf-pending"><span>Awaiting the saved result. No payout or balance is assumed.</span>${button('Recover pending action', recover, { disabled: !isConnected() })}</div>`;
    if (!isConnected()) html += '<p class="vf-error">Reconnecting to the village. Actions are paused.</p>';
    if (!local(view)) html += `<div class="vf-visit"><p>${standing() ? `Visit ${view === 'tavern' ? 'The Wayfarer entrance' : 'the Village Treasury entrance'} to ${view === 'tavern' ? 'place a bet' : 'manage your investment'}.` : state().status === 'fallen' ? 'This village has fallen. Its investments and tavern are closed.' : 'Stand on foot and finish carrying or treatment to use these services.'}</p>${button(view === 'tavern' ? 'Mark The Wayfarer' : 'Mark treasury', () => { const site = building(view); markTarget({ ...buildingEntrance(site), id: site.id, kind: 'service', name: site.name }); message=site.name+' marked on the minimap.';render(); })}</div>`;
    return html;
  }
  function investmentView() {
    const f = finance(), rate = Number.isFinite(f.dividendRate) ? f.dividendRate : INVESTMENT_RULES.dividendRate;
    const amount = whole(deposit) && Number(deposit) <= depositMax() ? Number(deposit) : 0, current = count(f.principal) * rate, projected = (count(f.principal) + amount) * rate;
    const largest = Math.max(projected, current, 1), width = n => Math.max(0, Math.min(100, n / largest * 100)).toFixed(2);
    return `<section class="vf-hero vf-invest-hero"><div><p class="vf-kicker">PUT YOUR GOLD TO WORK</p><h2>Invest in the village.</h2><p>Village investments support this settlement. Earnings come from its available treasury funds.</p></div>${investmentArt()}</section><div class="vf-stats"><div><span>YOUR PRINCIPAL</span><strong>${gold(f.principal)}g</strong></div><div><span>EARNINGS HELD FOR YOU</span><strong>${gold(f.earnings)}g</strong></div><div><span>YOUR WALLET</span><strong>${gold(wallet())}g</strong></div></div>${status()}<div class="vf-invest-columns"><section class="vf-card"><h3>Add to your investment</h3><label for="vf-deposit">Gold from your wallet</label><input id="vf-deposit" data-vf-input="deposit" type="text" inputmode="numeric" autocomplete="off" value="${esc(deposit)}"${pending ? ' disabled' : ''}><p class="vf-hint">Maximum now: <strong id="vf-deposit-max">${gold(depositMax())}g</strong></p><div class="vf-actions">${button('Invest amount', () => transaction('investment_deposit', { amount: Number(deposit) }, 'deposit'), { control: 'deposit', disabled: !enabled('deposit'), className: 'vf-button primary' })}${button('Invest max', () => transaction('investment_deposit', { amount: depositMax() }, 'deposit-max'), { control: 'deposit-max', disabled: !enabled('deposit-max') })}</div><div class="vf-projection" id="vf-projection"><p>Potential per fully eligible day</p><div><span>Current</span><i style="width:${width(current)}%"></i><strong>${estimate(current)}g</strong></div><div><span>With this deposit</span><i style="width:${width(projected)}%"></i><strong>${estimate(projected)}g</strong></div><small>Potential from your selected deposit, before available village funding.</small></div></section><section class="vf-card"><h3>Collect or grow your earnings</h3><p>Claiming moves credited earnings to your wallet. Reinvesting adds them to principal and starts a new eligibility wait.</p><div class="vf-actions">${button('Claim earnings', () => transaction('investment_claim', { max: true }, 'claim'), { control: 'claim', disabled: !enabled('claim'), className: 'vf-button primary' })}${button('Reinvest earnings', () => transaction('investment_reinvest', { max: true }, 'reinvest'), { control: 'reinvest', disabled: !enabled('reinvest') })}</div><h3>Withdraw principal</h3><label for="vf-withdraw">Gold to return to your wallet</label><input id="vf-withdraw" data-vf-input="withdrawal" type="text" inputmode="numeric" autocomplete="off" value="${esc(withdrawal)}"${pending ? ' disabled' : ''}><p class="vf-hint">Withdrawable now: <strong id="vf-withdrawable">${gold(withdrawMax())}g</strong>, limited by village surplus.</p><div class="vf-actions">${button('Withdraw amount', () => transaction('investment_withdraw', { amount: Number(withdrawal) }, 'withdraw'), { control: 'withdraw', disabled: !enabled('withdraw') })}${button('Withdraw max', () => transaction('investment_withdraw', { max: true }, 'withdraw-max'), { control: 'withdraw-max', disabled: !enabled('withdraw-max') })}</div></section></div><section class="vf-rules"><h3>How returns work</h3><p>Earn up to <strong>${estimate(rate * 100)}% per completed village day</strong>. New deposits and reinvestments skip their first dawn; they can earn at the following dawn. Returns depend on treasury funds above its emergency reserve. Shortfalls reduce that day’s return; unpaid returns do not become village debt.</p><div class="vf-ledger"><span>Eligible principal at the next dawn <strong>${gold(f.eligiblePrincipal)}g</strong></span><span>New principal still waiting <strong>${gold(f.pendingPrincipal)}g${f.pendingPrincipal && f.firstEligibleDay ? ` · eligible day ${gold(f.firstEligibleDay)}` : ''}</strong></span><span>Treasury surplus available <strong>${gold(f.treasurySurplus)}g</strong></span><span>Emergency reserve protected <strong>${gold(f.reserve)}g</strong></span></div>${f.lastDividend ? `<p>Last recorded dividend: day ${gold(f.lastDividend.day)} · ${gold(f.lastDividend.paid)}g paid of ${gold(f.lastDividend.due)}g calculated. Fractional yields carry forward.</p>` : '<p>No dividend has been recorded for your investment yet. Fractional yields carry forward.</p>'}<p>Credited earnings are held separately for you. Principal withdrawals use current surplus. Funds left in a fallen village are lost. All amounts are virtual game gold.</p></section>`;
  }
  function wagerControls() {
    const q = quote();
    return `<section class="vf-wager"><div><label for="vf-stake">Your stake · virtual wallet gold</label><input id="vf-stake" data-vf-input="stake" type="text" inputmode="numeric" autocomplete="off" value="${esc(stake)}"${pending || !resultVisible ? ' disabled' : ''}><div class="vf-chip-row">${[1,10,100].map(n => button(`+${n}`, () => { if(pending || !resultVisible)return; stake=String(Math.min(quote().maximum, Math.max(0, Number(stake)||0)+n));render(); }, { disabled: pending || !resultVisible || q.maximum < 1, className: 'vf-chip' })).join('')}${button('Max', () => { if(pending || !resultVisible)return;stake=String(quote().maximum);render(); }, { disabled: pending || !resultVisible || q.maximum < 1, className: 'vf-chip' })}</div><p class="vf-hint">Allowed: 1–1,000g. Maximum for this choice now: <strong id="vf-stake-limit">${gold(q.maximum)}g</strong>, limited by your wallet and village liquidity.</p></div><div class="vf-bet-quote" id="vf-bet-quote"><span>CHANCE OF WINNING</span><strong>${q.odds}</strong><dl><div><dt>Total return on a win</dt><dd>${gold(q.total)}g</dd></div><div><dt>Profit on a win</dt><dd>+${gold(q.profit)}g</dd></div><div><dt>Loss if you lose</dt><dd>${gold(q.stake)}g</dd></div></dl><small>Total return includes your stake. ${game === 'roulette' ? 'Zero loses red, black, even, and odd bets.' : 'Heads and tails are equally likely.'}</small></div>${button('Place bet', () => { if (!enabled('bet'))return; transaction('tavern_bet', { game, stake: Number(stake), choice: game === 'coinflip' ? coinChoice : rouletteChoice, ...(game === 'roulette' && rouletteChoice === 'number' ? { number } : {}) }, 'bet'); }, { control: 'bet', disabled: !enabled('bet'), className: 'vf-button primary vf-place-bet' })}</section>`;
  }
  function resultView() {
    if (pending?.kind === 'tavern_bet') return '<div class="vf-await" role="status">Waiting for your bet to be saved. The coin or wheel starts after the outcome is confirmed.</div>';
    if (!result || result.kind !== 'tavern_bet') return '<p class="vf-table-note">Choose a side or number, review the return, then place one bet. The village treasury receives losses and funds wins.</p>';
    if (!resultVisible) return `<div class="vf-reveal-status"><p>The outcome is saved. Skipping reveals the same result.</p>${button('Skip reveal', finish)}</div>`;
    const outcome = tavernResult(result);
    return `<section class="vf-result ${outcome.profit > 0 ? 'win' : 'loss'}" aria-live="polite"><span>${esc(result.game === 'coinflip' ? 'COIN FLIP' : 'EUROPEAN ROULETTE')}</span><h3>${esc(outcome.outcome)} · ${esc(outcome.label)}</h3><p>Stake ${gold(result.stake)}g · total returned ${gold(outcome.total)}g · ${outcome.profit >= 0 ? '+' : '−'}${gold(Math.abs(outcome.profit))}g net.</p><small>Saved result · wallet after this bet ${gold(result.walletAfter)}g. Current wallet is shown above.</small></section>`;
  }
  function tavernView() {
    const locked = Boolean(pending) || !resultVisible, spinning = !resultVisible && result?.game === game;
    const rest = game === 'roulette' && result?.game === 'roulette' ? -WHEEL.indexOf(Number(result.outcome)) * 360 / 37 : 0, end = 1800 + rest;
    const coinRest=result?.game==='coinflip'&&result.outcome==='tails'?180:0;
    let table;
    if (game === 'coinflip') table = `<section class="vf-coin-table"><div class="vf-coin-stage"><div class="vf-coin${spinning ? ' spinning' : ''}" style="--coin-end:${1800+coinRest}deg;--coin-rest:${coinRest}deg"><div class="vf-coin-front">${coinArt('heads')}</div><div class="vf-coin-back">${coinArt('tails')}</div></div></div><div class="vf-side-choices">${['heads','tails'].map(side => button(`${coinArt(side)}<strong>${side === 'heads' ? 'Heads' : 'Tails'}</strong>`, () => { if(locked)return;coinChoice=side;render(); }, { disabled: locked, className: `vf-side ${coinChoice === side ? 'selected' : ''}`, ariaLabel: `Choose ${side}` })).join('')}</div></section>`;
    else table = `<section class="vf-roulette-stage"><div class="vf-wheel"><span class="vf-wheel-pointer" aria-hidden="true"></span><div class="vf-wheel-disc${spinning ? ' spinning' : ''}" style="--wheel-end:${end.toFixed(3)}deg;--wheel-rest:${rest.toFixed(3)}deg">${wheelArt()}</div></div><div class="vf-roulette-instructions"><p class="vf-kicker">ONE GREEN ZERO · 37 POCKETS</p><h3>Make your selection.</h3><p>A single number pays 36× total. Red, black, even, or odd pays 2× total. There is no double zero.</p><strong id="vf-selection">${rouletteChoice === 'number' ? `Number ${number}` : esc(rouletteChoice.replace(/^./, c => c.toUpperCase()))} selected</strong></div></section><div class="vf-number-scroll"><div class="vf-roulette-table">${button('0', () => { if(locked)return;rouletteChoice='number';number=0;render(); }, { disabled: locked, className:`vf-number zero ${rouletteChoice === 'number' && number === 0 ? 'selected' : ''}`, ariaLabel:'Bet on number 0' })}<div class="vf-number-grid">${[3,2,1].flatMap(row => Array.from({length:12},(_,i)=>row+i*3)).map(n => button(String(n), () => { if(locked)return;rouletteChoice='number';number=n;render(); }, { disabled:locked,className:`vf-number ${color(n)} ${rouletteChoice === 'number' && number === n ? 'selected' : ''}`,ariaLabel:`Bet on number ${n}` })).join('')}</div></div></div><div class="vf-outside-bets">${['red','black','even','odd'].map(choice => button(choice.toUpperCase(),()=>{if(locked)return;rouletteChoice=choice;render();},{disabled:locked,className:`vf-button outside ${choice} ${rouletteChoice === choice ? 'selected' : ''}`})).join('')}</div>`;
    return `<section class="vf-hero vf-tavern-hero"><div><p class="vf-kicker">THE WAYFARER · OPEN DAY & NIGHT</p><h2>A turn of fortune.</h2><p>A quiet corner of the inn, a gold coin, and the village’s own gaming table.</p></div><span class="vf-inn-mark" aria-hidden="true">${coinArt('heads')}</span></section><div class="vf-stats"><div><span>YOUR WALLET</span><strong>${gold(wallet())}g</strong></div><div><span>VILLAGE TREASURY</span><strong>${gold(state().treasury)}g</strong></div><div><span>BET LIMIT</span><strong>1–1,000g</strong></div></div>${status()}<nav class="vf-game-tabs" aria-label="Tavern game">${button('Coin flip',()=>{if(locked)return;game='coinflip';render();},{disabled:locked,className:`vf-button ${game === 'coinflip' ? 'selected' : ''}`})}${button('European roulette',()=>{if(locked)return;game='roulette';render();},{disabled:locked,className:`vf-button ${game === 'roulette' ? 'selected' : ''}`})}</nav>${table}${resultView()}${wagerControls()}<p class="vf-footer">Every bet uses virtual wallet gold. Bank savings, loans, and crate credits are not used. The maximum changes with available funds; the server checks again before accepting.</p>`;
  }
  function refreshControls() {
    const nodes = content()?.querySelectorAll('[data-vf-action]') || [];
    for (const [kind, index] of controls) if(nodes[index])nodes[index].disabled=!enabled(kind);
    const q=quote(),limit=doc.getElementById('vf-stake-limit');if(limit)limit.textContent=gold(q.maximum)+'g';
    const depositLimit=doc.getElementById('vf-deposit-max');if(depositLimit)depositLimit.textContent=gold(depositMax())+'g';
    const withdrawLimit=doc.getElementById('vf-withdrawable');if(withdrawLimit)withdrawLimit.textContent=gold(withdrawMax())+'g';
    const quoteNode=doc.getElementById('vf-bet-quote');if(quoteNode)quoteNode.innerHTML=`<span>CHANCE OF WINNING</span><strong>${q.odds}</strong><dl><div><dt>Total return on a win</dt><dd>${gold(q.total)}g</dd></div><div><dt>Profit on a win</dt><dd>+${gold(q.profit)}g</dd></div><div><dt>Loss if you lose</dt><dd>${gold(q.stake)}g</dd></div></dl><small>Total includes your stake. ${game === 'roulette' ? 'Zero loses all outside bets.' : 'Heads and tails are equally likely.'}</small>`;
    const projection=doc.getElementById('vf-projection');if(projection){const rate=finance().dividendRate??INVESTMENT_RULES.dividendRate,a=count(finance().principal)*rate,b=(count(finance().principal)+(whole(deposit)&&Number(deposit)<=depositMax()?Number(deposit):0))*rate,scale=Math.max(a,b,1);projection.innerHTML=`<p>Potential per fully eligible day</p><div><span>Current</span><i style="width:${a/scale*100}%"></i><strong>${estimate(a)}g</strong></div><div><span>With this deposit</span><i style="width:${b/scale*100}%"></i><strong>${estimate(b)}g</strong></div><small>Selected deposit estimate before village funding; new funds skip their first dawn.</small>`;}
  }
  function render() {
    if(!ensureContext())return;
    const focused=doc.activeElement,focusId=content()?.contains?.(focused)?focused.id:null,start=focused?.selectionStart,end=focused?.selectionEnd;
    handlers=[];controls=new Map();
    const scroll=doc.getElementById('panel-dialog')?.scrollTop||0;
    openPanel(`<div class="village-finance vf-${view}">${view === 'tavern' ? tavernView() : investmentView()}</div>`,view);
    const dialog=doc.getElementById('panel-dialog');if(dialog)dialog.scrollTop=scroll;
    for(const node of content()?.querySelectorAll('[data-vf-action]')||[]){const handler=handlers[Number(node.dataset.vfAction)];node.onclick=()=>{if(!node.disabled)return handler?.();};}
    for(const input of content()?.querySelectorAll('[data-vf-input]')||[])input.oninput=()=>{if(input.dataset.vfInput==='stake')stake=input.value;else if(input.dataset.vfInput==='deposit')deposit=input.value;else withdrawal=input.value;refreshControls();};
    if(focusId){const target=doc.getElementById(focusId);target?.focus?.({preventScroll:true});if(Number.isInteger(start))try{target?.setSelectionRange?.(start,end);}catch{}}
    signature=JSON.stringify([finance(),tavern(),wallet(),state().treasury,state().status,local(view),isConnected()]);
  }
  function update() {
    if(!ensureContext())return;
    if(pending){const receipts=[...(finance().receipts||[]),...(tavern().history||[])];const receipt=receipts.find(row=>row.requestId===pending.requestId||row.id===pending.requestId);if(receipt){accept({...receipt,requestId:receipt.requestId||receipt.id});return;}}
    if(!active())return;
    refreshControls();
    const next=JSON.stringify([finance(),tavern(),wallet(),state().treasury,state().status,local(view),isConnected()]);
    const editing=content()?.contains?.(doc.activeElement)&&['INPUT','SELECT','TEXTAREA'].includes(doc.activeElement?.tagName);
    if(resultVisible&&!editing&&next!==signature)render();
  }
  function show(type) { if(!ensureContext())return; view=type;if(!resultVisible)finish();error='';message='';render();update(); }
  function clear() { cancel(timer);timer=null;context=null;pending=null;result=null;resultVisible=true;error='';message='';signature='';lastReceiptId=null;handlers=[];controls=new Map(); }
  return {showInvestments:()=>show('investments'),showTavern:()=>show('tavern'),update,receive,clear};
}
