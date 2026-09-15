// One authenticated socket at a time. Inputs and transactions are never queued:
// after recovery the complete server snapshot is the source of truth.
export function createGameConnection({ url, join, onMessage = () => {}, onStatus = () => {},
  WebSocketImpl = globalThis.WebSocket, now = () => Date.now(), random = Math.random,
  schedule = (fn, ms) => setTimeout(fn, ms), cancel = id => clearTimeout(id),
  heartbeatMs = 10000, staleMs = 35000, joinTimeoutMs = 15000 } = {}) {
  let socket = null, generation = 0, running = false, welcomed = false;
  let attempts = 0, resumeToken = null, clientId = null, sessionKey = null, status = 'closed';
  let retryTimer = null, heartbeatTimer = null, openedAt = 0, receivedAt = 0;
  const report = (next, detail = {}) => { status = next; onStatus(next, detail); };
  const clearTimers = () => { cancel(retryTimer); cancel(heartbeatTimer); retryTimer = heartbeatTimer = null; };
  const current = (ws, epoch) => running && socket === ws && generation === epoch;
  function closeSocket() {
    const previous = socket;
    socket = null; welcomed = false; generation++;
    if (previous && previous.readyState < 2) previous.close();
  }
  function fail(message, code) {
    running = false; clearTimers(); closeSocket(); report('failed', { message, code });
  }
  function retry(message = 'Connection interrupted. Rejoining your village…') {
    if (!running || retryTimer !== null) return;
    cancel(heartbeatTimer); heartbeatTimer = null; closeSocket();
    const delay = Math.round(Math.min(8000, 500 * 2 ** Math.min(attempts++, 4)) * (.8 + random() * .4));
    report('reconnecting', { message, delay, attempt: attempts });
    retryTimer = schedule(() => { retryTimer = null; if (running) open(); }, delay);
  }
  function check(ws, epoch) {
    if (!current(ws, epoch)) return;
    if (!welcomed && now() - openedAt >= joinTimeoutMs) return retry('The server did not finish joining. Retrying…');
    if (welcomed && now() - receivedAt >= staleMs) return retry('The server stopped responding. Rejoining your village…');
    if (welcomed && ws.readyState === 1 && ws.bufferedAmount < 65536) ws.send(JSON.stringify({ type: 'ping', nonce: now() }));
    heartbeatTimer = schedule(() => check(ws, epoch), heartbeatMs);
  }
  function open() {
    if (!running) return;
    let payload;
    try { payload = join(); }
    catch (error) { fail(error.message || 'Sign in again to join.', 'JOIN_FAILED'); return; }
    const nextKey = `${payload.token}:${payload.villageId}`;
    if (sessionKey !== nextKey) {
      resumeToken = payload.resumeToken ?? null; sessionKey = nextKey;
      const bytes = new Uint8Array(16);
      // The initial welcome can itself be lost. Identify this connection
      // attempt before that welcome, using a cryptographically random nonce.
      clientId = globalThis.crypto?.getRandomValues ? [...globalThis.crypto.getRandomValues(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('') : null;
    }
    let ws;
    try { ws = new WebSocketImpl(typeof url === 'function' ? url() : url); }
    catch { retry(); return; }
    socket = ws; welcomed = false; const epoch = ++generation;
    openedAt = receivedAt = now();
    ws.onopen = () => {
      if (!current(ws, epoch)) return;
      ws.send(JSON.stringify({ ...payload, type: 'join', ...(resumeToken ? { resumeToken } : {}), ...(clientId ? { clientId } : {}) }));
    };
    ws.onmessage = event => {
      if (!current(ws, epoch)) return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (!message || typeof message !== 'object' || Array.isArray(message)) return;
      receivedAt = now();
      if (message.type === 'error' && !welcomed) {
        fail(message.message || 'Unable to join this village.', message.code); return;
      }
      if (message.type === 'welcome') {
        welcomed = true; attempts = 0; resumeToken = message.resumeToken ?? resumeToken;
        report('connected');
      }
      if (message.type !== 'pong') onMessage(message);
    };
    ws.onclose = event => {
      if (!current(ws, epoch)) return;
      if (event.code === 4001) fail(event.reason || 'This connection was resumed in another window.', 'SESSION_REPLACED');
      else if (event.code === 1008) fail(event.reason || 'The server ended this session. Sign in again.', 'SESSION_CLOSED');
      else retry();
    };
    ws.onerror = () => { if (current(ws, epoch)) retry(); };
    heartbeatTimer = schedule(() => check(ws, epoch), heartbeatMs);
  }
  function send(message) {
    if (!running || !welcomed || socket?.readyState !== 1 || socket.bufferedAmount >= 65536) return false;
    socket.send(JSON.stringify(message)); return true;
  }
  return {
    connect() { clearTimers(); closeSocket(); running = true; attempts = 0; report('connecting'); open(); },
    close() { running = false; clearTimers(); closeSocket(); report('closed'); },
    send,
    requestResync() { return send({ type: 'resync' }); },
    get status() { return status; }
  };
}
