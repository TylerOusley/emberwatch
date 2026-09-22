import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { Store } from './store.js';
import { Simulation } from './simulation.js';
import { VillageChat } from './chat.js';
import { randomUUID } from 'node:crypto';
import { accountCrateSnapshot, crateAccountAction } from './crates.js';
import { listFeedback, submitFeedback, reviewFeedback, feedbackMarkdown } from './feedback.js';
import { accountPetSnapshot, petAccountAction, petPurchaseReceipt, petVillageSnapshot } from './pets.js';
import { syncPetCompanions } from './pet-companions.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ttf':'font/ttf', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg' };
function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}
async function readJson(req, maximumBytes = 8192) {
  const chunks = []; let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maximumBytes) throw new Error('Request too large.');
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString('utf8');
  try { const value = JSON.parse(body); if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(); return value; }
  catch { throw new Error('Send a valid JSON object.'); }
}

export function createApp(options = {}) {
  const store = new Store(options.dataDir ?? process.env.DATA_DIR ?? resolve(ROOT, 'data'), { testAdminAccountIds: options.testAdminAccountIds });
  const simulation = new Simulation(store, { ...options, devTools: options.devTools ?? process.env.ALLOW_DEV_TOOLS === 'true' });
  const chat = new VillageChat(options.chatClock);
  const sockets = new Map();
  const reconnectSessions = new Map();
  const networkClock = options.networkClock ?? (() => performance.now());
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 10000;
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 45000;
  const authAttempts = new Map();
  let activeAuth = 0;
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, game: 'emberwatch' });
      if (req.method === 'GET' && url.pathname === '/api/config') return json(res, 200, { devTools: simulation.devTools });
      if (req.method === 'GET' && url.pathname === '/api/villages') return json(res, 200, { villages: simulation.list() });
      if (url.pathname === '/api/feedback' || url.pathname.startsWith('/api/feedback/')) {
        const account = store.accountFromToken(req.headers.authorization?.replace(/^Bearer /, ''));
        if (!account) return json(res, 401, { error: 'Sign in to send or read feedback.' });
        try {
          if (url.pathname === '/api/feedback' && req.method === 'GET') return json(res, 200, listFeedback(store, account.id, url.searchParams));
          if (url.pathname === '/api/feedback' && req.method === 'POST') {
            const result = submitFeedback(store, simulation, account.id, await readJson(req, 16384), options.feedbackClock?.() ?? Date.now());
            return json(res, result.replayed ? 200 : 201, result);
          }
          if (url.pathname === '/api/feedback/review' && req.method === 'GET') return json(res, 200, listFeedback(store, account.id, url.searchParams, true));
          if (url.pathname === '/api/feedback/export' && req.method === 'GET') {
            const page = listFeedback(store, account.id, url.searchParams, true), format = url.searchParams.get('format') ?? 'json';
            if (format === 'json') return json(res, 200, page);
            if (format !== 'markdown') return json(res, 400, { error: 'Choose JSON or Markdown export.' });
            res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': 'attachment; filename="emberwatch-feedback.md"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
            return res.end(feedbackMarkdown(page));
          }
          const reviewMatch = url.pathname.match(/^\/api\/feedback\/([^/]+)\/review$/);
          if (reviewMatch && req.method === 'POST') return json(res, 200, reviewFeedback(store, account.id, reviewMatch[1], await readJson(req), options.feedbackClock?.() ?? Date.now()));
          return json(res, 405, { error: 'Method not allowed.' });
        } catch (error) {
          // Validation is intentionally readable; never expose SQL details or
          // claim success when the durable write failed.
          const bodyError = ['Request too large.', 'Send a valid JSON object.'].includes(error.message);
          const status = error.statusCode ?? (bodyError ? 400 : 500);
          return json(res, status, { error: status === 500 ? 'Feedback could not be saved or loaded. Please retry.' : error.message });
        }
      }
      if (url.pathname === '/api/pets' || url.pathname === '/api/pets/action') {
        const account = store.accountFromToken(req.headers.authorization?.replace(/^Bearer /, ''));
        if (!account) return json(res, 401, { error: 'Sign in to manage your pets.' });
        try {
          if (req.method === 'GET' && url.pathname === '/api/pets') return json(res, 200, { pets: accountPetSnapshot(store, account.id, simulation.petOptions) });
          if (req.method === 'POST' && url.pathname === '/api/pets/action') {
            const action = await readJson(req);
            if (action.kind === 'pet_buy_egg') {
              // Read a committed account receipt first, even if the player has
              // since disconnected, moved away, fallen or changed villages.
              let result = petPurchaseReceipt(store, account.id, action);
              const village = simulation.villages.get(action.villageId);
              if (!result) {
                if (!village?.players[account.id]?.online) return json(res, 400, { error: 'Join this village and visit its traveling merchant to buy an egg.' });
                simulation.action(village.id, account.id, action);
                result = petPurchaseReceipt(store, account.id, action);
                if (!result) throw new Error('The egg purchase was not saved.');
              }
              const pets = village?.players[account.id] ? petVillageSnapshot(store, village, account.id, simulation.petOptions) : accountPetSnapshot(store, account.id, simulation.petOptions);
              return json(res, 200, { pets, message: result.message, requestId: result.requestId, result });
            }
            const result = petAccountAction(store, account.id, action, simulation.petOptions);
            for (const village of simulation.villages.values()) if (village.status === 'active' && village.players[account.id]) syncPetCompanions(simulation, village);
            return json(res, 200, result);
          }
          return json(res, 405, { error: 'Method not allowed.' });
        } catch (error) {
          const bodyError = ['Request too large.', 'Send a valid JSON object.'].includes(error.message);
          const status = error.statusCode ?? (bodyError ? 400 : 500);
          return json(res, status, { error: status === 500 ? 'Your pet collection could not be saved or loaded. Please retry.' : error.message });
        }
      }
      if (url.pathname === '/api/crates' || url.pathname === '/api/crates/action') {
        const account = store.accountFromToken(req.headers.authorization?.replace(/^Bearer /, ''));
        if (!account) return json(res, 401, { error: 'Sign in to manage your crates and loadout.' });
        if (req.method === 'GET' && url.pathname === '/api/crates') return json(res, 200, { crates: accountCrateSnapshot(store, account.id) });
        if (req.method === 'POST' && url.pathname === '/api/crates/action') return json(res, 200, crateAccountAction(store, account.id, await readJson(req)));
        return json(res, 405, { error: 'Method not allowed.' });
      }
      if (req.method === 'POST' && url.pathname === '/api/auth') {
        const key = req.socket.remoteAddress, now = Date.now();
        const prior = (authAttempts.get(key) ?? []).filter(t => now - t < 60000);
        if (prior.length >= 15 || activeAuth >= 4) return json(res, 429, { error: 'Too many attempts. Wait a minute and try again.' });
        prior.push(now); authAttempts.set(key, prior);
        const body = await readJson(req);
        activeAuth++;
        try { return json(res, 200, await store.authenticate(body.mode, body.name, body.password)); }
        finally { activeAuth--; }
      }
      if (req.method === 'POST' && url.pathname === '/api/villages') {
        const account = store.accountFromToken(req.headers.authorization?.replace(/^Bearer /, ''));
        if (!account) return json(res, 401, { error: 'Sign in again to create a village.' });
        const body = await readJson(req);
        return json(res, 201, { village: simulation.create(body.name, account) });
      }
      if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Route not found.' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed.' });
      let base, relative;
      if (url.pathname === '/vendor/three.module.js' || url.pathname === '/vendor/three.core.js') {
        base = resolve(ROOT, 'node_modules/three/build'); relative = url.pathname.split('/').pop();
      } else if (url.pathname.startsWith('/vendor/three-addons/')) {
        base = resolve(ROOT, 'node_modules/three/examples/jsm'); relative = decodeURIComponent(url.pathname.slice('/vendor/three-addons/'.length));
      } else if (url.pathname.startsWith('/shared/')) {
        base = resolve(ROOT, 'shared'); relative = decodeURIComponent(url.pathname.slice('/shared/'.length));
      } else { base = resolve(ROOT, 'public'); relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1)); }
      const path = resolve(base, relative);
      if (!path.startsWith(base + sep) || relative.includes('\0')) return json(res, 403, { error: 'Forbidden.' });
      try {
        if (!(await stat(path)).isFile()) return json(res, 404, { error: 'Not found.' });
        const content = await readFile(path);
        res.writeHead(200, { 'Content-Type': MIME[extname(path)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache', 'Referrer-Policy': 'same-origin' });
        res.end(req.method === 'HEAD' ? undefined : content);
      } catch { json(res, 404, { error: 'Not found.' }); }
    } catch (error) { if (!res.headersSent) json(res, 400, { error: error.message || 'Request failed.' }); else res.end(); }
  });
  server.requestTimeout = 10000;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    const origin = req.headers.origin;
    if (req.url !== '/socket' || (origin && (() => { try { return new URL(origin).host !== req.headers.host; } catch { return true; } })())) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  const send = (socket, data) => {
    if (socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount >= 1024 * 1024) return false;
    socket.send(JSON.stringify(data)); return true;
  };
  const sendState = (socket, village, viewerId) => {
    const snapshot = simulation.snapshot(village, viewerId);
    if (!socket.statePatches) { send(socket, { type: 'state', state: snapshot }); return; }
    // Plot catalogues and resource states seldom change. Send only changed
    // top-level fields to clients that explicitly support merging snapshots.
    if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount >= 1024 * 1024) return;
    const previous = socket.snapshotFields, next = new Map(), changed = {};
    for (const [key, value] of Object.entries(snapshot)) {
      const serialized = JSON.stringify(value); next.set(key, serialized);
      if (!previous || previous.get(key) !== serialized) changed[key] = value;
    }
    if (send(socket, { type: 'state', patch: Boolean(previous), state: previous ? changed : snapshot })) socket.snapshotFields = next;
  };
  const sendVillage = (identity, data, includeSender = true) => {
    if (!data) return;
    const village = simulation.villages.get(identity.villageId);
    if (!village) return;
    for (const player of Object.values(village.players)) {
      if (player.online && (includeSender || player.id !== identity.playerId)) send(sockets.get(player.id), data);
    }
  };
  wss.on('connection', socket => {
    let identity = null, messages = 0, windowStart = performance.now();
    socket.lastSeen = networkClock();
    socket.on('pong', () => { socket.lastSeen = networkClock(); });
    const joinTimeout = setTimeout(() => { if (!identity) socket.close(1008, 'Sign in to join.'); }, 10000);
    socket.on('message', data => {
      let requestId = null;
      try {
        const now = performance.now();
        socket.lastSeen = networkClock();
        if (now - windowStart >= 1000) { windowStart = now; messages = 0; }
        // Input can arrive in a burst after a paused tab or congested link.
        // Shed excess messages without disconnecting an otherwise valid game.
        if (++messages > 120) {
          if (messages === 121) send(socket, { type: 'error', code: 'RATE_LIMIT', message: 'Too many actions at once. Please slow down.' });
          return;
        }
        let message;
        try { message = JSON.parse(data.toString()); } catch { throw new Error('Invalid message.'); }
        if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('Invalid message.');
        if (message.type === 'action' && typeof message.requestId === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(message.requestId)) requestId = message.requestId;
        if (message.type === 'join') {
          if (identity) throw new Error('You have already joined.');
          const account = store.accountFromToken(message.token);
          if (!account) throw Object.assign(new Error('Your session expired. Please sign in again.'), { code: 'SESSION_EXPIRED' });
          const previous = sockets.get(account.id);
          const clientId = typeof message.clientId === 'string' && /^[a-f0-9]{32}$/.test(message.clientId) ? message.clientId : null;
          const resumesPrevious = previous && ((typeof message.resumeToken === 'string' && message.resumeToken === previous.resumeToken) || (clientId && clientId === previous.clientId));
          const previousStale = previous && (previous.readyState !== WebSocket.OPEN || networkClock() - previous.lastSeen >= heartbeatTimeoutMs);
          if (previous && !resumesPrevious && !previousStale) throw Object.assign(new Error('This dwarf is already connected. Close the other game tab first.'), { code: 'ALREADY_CONNECTED' });
          const player = simulation.join(message.villageId, account, message.role ?? 'villager');
          socket.statePatches = message.statePatches === true;
          socket.villageId = message.villageId;
          socket.clientId = clientId;
          const savedResume = reconnectSessions.get(account.id);
          socket.resumeToken = resumesPrevious ? previous.resumeToken : savedResume && savedResume.token === message.resumeToken ? savedResume.token : randomUUID();
          identity = { playerId: player.id, villageId: message.villageId, name: account.name };
          sockets.set(player.id, socket); clearTimeout(joinTimeout);
          reconnectSessions.set(player.id, { token: socket.resumeToken, seen: networkClock() });
          // Install the replacement before closing its predecessor: delayed
          // messages and close events from the old socket cannot mutate state.
          if (previous && previous !== socket) {
            if (previous.villageId !== identity.villageId) simulation.disconnect(previous.villageId, player.id);
            previous.close(4001, 'This connection was resumed in another window.');
            setTimeout(() => { if (previous.readyState !== WebSocket.CLOSED) previous.terminate(); }, 1000).unref();
          }
          send(socket, { type: 'welcome', id: player.id, villageId: message.villageId, resumeToken: socket.resumeToken });
          sendState(socket, simulation.villages.get(message.villageId), player.id);
          send(socket, { type: 'chatHistory', messages: chat.history(identity.villageId) });
        } else {
          if (!identity) throw new Error('Join a village first.');
          if (sockets.get(identity.playerId) !== socket) return;
          if (message.type === 'ping') send(socket, { type: 'pong', nonce: message.nonce });
          else if (message.type === 'resync') {
            socket.snapshotFields = null;
            sendState(socket, simulation.villages.get(identity.villageId), identity.playerId);
          } else if (message.type === 'input') simulation.input(identity.villageId, identity.playerId, message);
          else if (message.type === 'chat') {
            const entry = chat.post(identity, message.text);
            sendVillage(identity, chat.clearTyping(identity), false);
            sendVillage(identity, entry);
          } else if (message.type === 'typing') sendVillage(identity, chat.setTyping(identity, message.typing), false);
          else if (message.type === 'action') {
            const response = simulation.action(identity.villageId, identity.playerId, message);
            if (requestId && ['investment_deposit', 'investment_withdraw', 'investment_claim', 'investment_reinvest', 'tavern_bet'].includes(message.kind)) {
              const receipt = store.financeReceipt(identity.villageId, identity.playerId, requestId);
              if (receipt) send(socket, { type: 'financeReceipt', requestId, receipt });
            }
            // Routine hits and harvests already have visual and HUD feedback.
            if (response && !['attack', 'gather', 'repair', 'repairPlot'].includes(message.kind)) send(socket, { type: 'notice', message: response, ...(requestId ? { requestId } : {}) });
          } else throw new Error('Unknown message.');
        }
      } catch (error) { send(socket, { type: 'error', message: error.message || 'Action failed.', ...(requestId ? { requestId } : {}), ...(identity ? {} : { code: error.code ?? 'JOIN_FAILED', fatal: true }) }); }
    });
    socket.on('close', () => {
      clearTimeout(joinTimeout);
      if (identity && sockets.get(identity.playerId) === socket) {
        sendVillage(identity, chat.clearTyping(identity), false);
        const session = reconnectSessions.get(identity.playerId);
        if (session) session.seen = networkClock();
        sockets.delete(identity.playerId); simulation.disconnect(identity.villageId, identity.playerId);
      }
    });
    socket.on('error', () => {});
  });
  let count = 0;
  const timer = options.autoTick === false ? null : setInterval(() => {
    simulation.tick(.05);
    if (++count % 2 === 0) broadcast();
    if (count % 100 === 0) simulation.saveAll();
  }, 50);
  function broadcast() {
    for (const village of simulation.villages.values()) {
      for (const player of Object.values(village.players)) {
        const socket = sockets.get(player.id);
        if (player.online && socket) sendState(socket, village, player.id);
      }
    }
    for (const notice of simulation.notices.splice(0)) {
      const village = simulation.villages.get(notice.villageId);
      for (const player of Object.values(village.players)) if (player.online) send(sockets.get(player.id), { type: 'notice', message: notice.message });
    }
  }
  function heartbeatCheck() {
    for (const socket of wss.clients) {
      if (networkClock() - socket.lastSeen >= heartbeatTimeoutMs) socket.terminate();
      else if (socket.readyState === WebSocket.OPEN) socket.ping();
    }
    for (const [id, session] of reconnectSessions) if (!sockets.has(id) && networkClock() - session.seen > 120000) reconnectSessions.delete(id);
    for (const [key, times] of authAttempts) if (Date.now() - times.at(-1) > 60000) authAttempts.delete(key);
    chat.prune();
  }
  const heartbeat = setInterval(heartbeatCheck, heartbeatIntervalMs);
  async function close() {
    clearInterval(timer); clearInterval(heartbeat);
    for (const socket of wss.clients) socket.terminate();
    await new Promise(resolveClosed => wss.close(resolveClosed));
    await new Promise(resolveClosed => server.close(resolveClosed));
    for (const village of simulation.villages.values()) for (const player of Object.values(village.players)) player.online = false;
    simulation.saveAll(); store.close();
  }
  return { server, wss, simulation, store, broadcast, heartbeatCheck, close };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp();
  const port = Number(process.env.PORT) || 3000;
  app.server.listen(port, '0.0.0.0', () => console.log(`Emberwatch listening on port ${port}`));
  let closing = false;
  const shutdown = async () => { if (closing) return; closing = true; await app.close(); process.exit(0); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}
