import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { Store } from './store.js';
import { Simulation } from './simulation.js';
import { VillageChat } from './chat.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ttf':'font/ttf', '.glb': 'model/gltf-binary' };
function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}
async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 8192) throw new Error('Request too large.');
  }
  try { const value = JSON.parse(body); if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(); return value; }
  catch { throw new Error('Send a valid JSON object.'); }
}

export function createApp(options = {}) {
  const store = new Store(options.dataDir ?? process.env.DATA_DIR ?? resolve(ROOT, 'data'));
  const simulation = new Simulation(store, { ...options, devTools: options.devTools ?? process.env.ALLOW_DEV_TOOLS === 'true' });
  const chat = new VillageChat(options.chatClock);
  const sockets = new Map();
  const authAttempts = new Map();
  let activeAuth = 0;
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, game: 'emberwatch' });
      if (req.method === 'GET' && url.pathname === '/api/config') return json(res, 200, { devTools: simulation.devTools });
      if (req.method === 'GET' && url.pathname === '/api/villages') return json(res, 200, { villages: simulation.list() });
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
    if (socket?.readyState === WebSocket.OPEN && socket.bufferedAmount < 1024 * 1024) socket.send(JSON.stringify(data));
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
    send(socket, { type: 'state', patch: Boolean(previous), state: previous ? changed : snapshot });
    socket.snapshotFields = next;
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
    socket.alive = true;
    socket.on('pong', () => { socket.alive = true; });
    const joinTimeout = setTimeout(() => { if (!identity) socket.close(1008, 'Sign in to join.'); }, 10000);
    socket.on('message', data => {
      try {
        const now = performance.now();
        if (now - windowStart >= 1000) { windowStart = now; messages = 0; }
        if (++messages > 60) { socket.close(1008, 'Too many messages.'); return; }
        let message;
        try { message = JSON.parse(data.toString()); } catch { throw new Error('Invalid message.'); }
        if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('Invalid message.');
        if (message.type === 'join') {
          if (identity) throw new Error('You have already joined.');
          const account = store.accountFromToken(message.token);
          if (!account) throw new Error('Your session expired. Please sign in again.');
          const previous = sockets.get(account.id);
          if (previous) throw new Error('This dwarf is already connected. Close the other game tab first.');
          const player = simulation.join(message.villageId, account, message.role ?? 'villager');
          socket.statePatches = message.statePatches === true;
          identity = { playerId: player.id, villageId: message.villageId, name: account.name };
          sockets.set(player.id, socket); clearTimeout(joinTimeout);
          send(socket, { type: 'welcome', id: player.id, villageId: message.villageId });
          sendState(socket, simulation.villages.get(message.villageId), player.id);
          send(socket, { type: 'chatHistory', messages: chat.history(identity.villageId) });
        } else {
          if (!identity) throw new Error('Join a village first.');
          if (message.type === 'input') simulation.input(identity.villageId, identity.playerId, message);
          else if (message.type === 'chat') {
            const entry = chat.post(identity, message.text);
            sendVillage(identity, chat.clearTyping(identity), false);
            sendVillage(identity, entry);
          } else if (message.type === 'typing') sendVillage(identity, chat.setTyping(identity, message.typing), false);
          else if (message.type === 'action') {
            const response = simulation.action(identity.villageId, identity.playerId, message);
            // Routine hits and harvests already have visual and HUD feedback.
            if (response && !['attack', 'gather', 'repair', 'repairPlot'].includes(message.kind)) send(socket, { type: 'notice', message: response });
          } else throw new Error('Unknown message.');
        }
      } catch (error) { send(socket, { type: 'error', message: error.message || 'Action failed.' }); }
    });
    socket.on('close', () => {
      clearTimeout(joinTimeout);
      if (identity && sockets.get(identity.playerId) === socket) {
        sendVillage(identity, chat.clearTyping(identity), false);
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
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) { if (!socket.alive) socket.terminate(); else { socket.alive = false; socket.ping(); } }
    for (const [key, times] of authAttempts) if (Date.now() - times.at(-1) > 60000) authAttempts.delete(key);
    chat.prune();
  }, 15000);
  async function close() {
    clearInterval(timer); clearInterval(heartbeat);
    for (const socket of wss.clients) socket.terminate();
    await new Promise(resolveClosed => wss.close(resolveClosed));
    await new Promise(resolveClosed => server.close(resolveClosed));
    for (const village of simulation.villages.values()) for (const player of Object.values(village.players)) player.online = false;
    simulation.saveAll(); store.close();
  }
  return { server, wss, simulation, store, broadcast, close };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp();
  const port = Number(process.env.PORT) || 3000;
  app.server.listen(port, '0.0.0.0', () => console.log(`Emberwatch listening on port ${port}`));
  let closing = false;
  const shutdown = async () => { if (closing) return; closing = true; await app.close(); process.exit(0); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}
