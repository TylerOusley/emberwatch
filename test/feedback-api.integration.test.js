import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { createApp } from '../server/index.js';
import { submitFeedback, FEEDBACK_STATUSES } from '../server/feedback.js';

async function fixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'emberwatch-feedback-'));
  const bootstrap = new Store(dataDir, { testAdminAccountIds: [] });
  const admin = await bootstrap.authenticate('register', 'Feedback Owner', 'feedback-password');
  const alice = await bootstrap.authenticate('register', 'Feedback Alice', 'feedback-password');
  const bob = await bootstrap.authenticate('register', 'Feedback Bob', 'feedback-password');
  bootstrap.close();
  let app, now = Date.now();
  async function start() { app = createApp({ dataDir, autoTick: false, testAdminAccountIds: [admin.playerId], feedbackClock: () => now }); app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening'); }
  await start();
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  async function api(path = '/api/feedback', account = alice, body = undefined, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(account ? { Authorization: `Bearer ${account.token}` } : {}) }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
    return { status: response.status, headers: response.headers, data: response.headers.get('content-type')?.startsWith('application/json') ? await response.json() : await response.text() };
  }
  return { get app() { return app; }, api, alice, bob, admin, advance(ms) { now += ms; }, async restart() { await app.close(); await start(); }, seed(account = alice, extra = {}) { now += 86400001; return submitFeedback(app.store, app.simulation, account.playerId, payload(extra), now).report; } };
}
const payload = (extra = {}) => ({ requestId: randomUUID(), kind: 'bug', title: 'Worker stopped gathering', description: 'Assigned a worker to sulfur. It stopped after the first vein.', ...extra });

test('feedback requires authentication and each player sees only their own reports', async t => {
  const f = await fixture(t);
  for (const path of ['/api/feedback', '/api/feedback/review', '/api/feedback/export']) assert.equal((await f.api(path, null)).status, 401);
  assert.equal((await f.api('/api/feedback', null, payload())).status, 401);
  const created = await f.api('/api/feedback', f.alice, payload({ accountId: f.bob.playerId, status: 'resolved', testAdmin: true }));
  assert.equal(created.status, 201); assert.equal(created.data.report.status, 'new'); assert.equal(created.data.report.reporter, undefined);
  const mine = await f.api(), theirs = await f.api('/api/feedback?accountId=' + f.alice.playerId, f.bob);
  assert.equal(mine.data.reports.length, 1); assert.equal(theirs.data.reports.length, 0); assert.equal(mine.data.canReview, false);
  assert.equal(mine.headers.get('cache-control'), 'no-store');
  for (const path of ['/api/feedback/review?admin=true', '/api/feedback/export?format=markdown']) assert.equal((await f.api(path, f.bob)).status, 403);
  assert.equal((await f.api(`/api/feedback/${created.data.report.id}/review`, f.bob, { status: 'resolved', testAdmin: true })).status, 403);
});

test('feedback attaches trusted build and village context and rejects another village', async t => {
  const f = await fixture(t), villageId = f.app.simulation.create('Feedback Watch', f.app.store.account(f.alice.playerId)).id, village = f.app.simulation.villages.get(villageId);
  f.app.simulation.join(village.id, f.app.store.account(f.alice.playerId), 'villager'); village.day = 45; village.phase = 'night';
  const saved = await f.api('/api/feedback', f.alice, payload({ villageId: village.id, context: { build: 1, day: 999 }, day: 1000 }));
  assert.equal(saved.status, 201); assert.deepEqual(saved.data.report.context, { build: 31, villageId: village.id, villageName: village.name, day: 45, phase: 'night' });
  assert.equal((await f.api('/api/feedback', f.bob, payload({ villageId: village.id }))).status, 400);
  assert.equal((await f.api('/api/feedback', f.alice, payload({ villageId: randomUUID() }))).status, 400);
});

test('concurrent retries share one saved receipt, mismatched reuse fails, and reports survive restart', async t => {
  const f = await fixture(t), body = payload(), results = await Promise.all(Array.from({ length: 8 }, () => f.api('/api/feedback', f.alice, body)));
  assert.equal(results.filter(result => result.status === 201).length, 1); assert.equal(new Set(results.map(result => result.data.report.id)).size, 1);
  assert.equal((await f.api()).data.reports.length, 1);
  assert.equal((await f.api('/api/feedback', f.alice, { ...body, title: 'Another title' })).status, 409);
  await f.restart(); const replay = await f.api('/api/feedback', f.alice, body);
  assert.equal(replay.status, 200); assert.equal(replay.data.replayed, true); assert.equal(replay.data.report.id, results[0].data.report.id);
});

test('durable per-account limits reject bursts and survive restart without blocking receipt recovery', async t => {
  const f = await fixture(t), first = payload();
  assert.equal((await f.api('/api/feedback', f.alice, first)).status, 201);
  for (let i = 0; i < 4; i++) assert.equal((await f.api('/api/feedback', f.alice, payload())).status, 201);
  assert.equal((await f.api('/api/feedback', f.alice, payload())).status, 429);
  assert.equal((await f.api('/api/feedback', f.bob, payload())).status, 201);
  await f.restart(); assert.equal((await f.api('/api/feedback', f.alice, payload())).status, 429);
  assert.equal((await f.api('/api/feedback', f.alice, first)).status, 200);
  for (let group = 0; group < 3; group++) { f.advance(60001); for (let i = 0; i < 5; i++) assert.equal((await f.api('/api/feedback', f.alice, payload())).status, 201); }
  f.advance(60001); const rejected = await f.api('/api/feedback', f.alice, payload()); assert.equal(rejected.status, 429); assert.match(rejected.data.error, /20 reports/);
  f.advance(86400001); assert.equal((await f.api('/api/feedback', f.alice, payload())).status, 201);
});

test('feedback rejects invalid fields, body size, pagination and status inputs without writes', async t => {
  const f = await fixture(t);
  for (const extra of [{ requestId: 'bad' }, { kind: 'admin' }, { title: 'ab' }, { title: 'x'.repeat(101) }, { description: 'short' }, { description: 'x'.repeat(3001) }, { title: 'hidden\0title' }, { villageId: 7 }]) assert.equal((await f.api('/api/feedback', f.alice, payload(extra))).status, 400);
  for (const body of ['[1,2]', '{', JSON.stringify(payload({ extra: 'x'.repeat(17000) }))]) assert.equal((await f.api('/api/feedback', f.alice, body)).status, 400);
  for (const query of ['limit=0', 'limit=51', 'before=Infinity', 'before=9007199254740992', 'status=admin', 'kind=wrong']) assert.equal((await f.api('/api/feedback?' + query)).status, 400);
  assert.equal((await f.api()).data.reports.length, 0);
  assert.equal((await f.api('/api/feedback', f.alice, undefined, 'DELETE')).status, 405);
  assert.equal((await f.api('/api/feedback', f.alice, payload({ title: '漢'.repeat(100), description: '漢'.repeat(3000) }))).status, 201, 'advertised text lengths fit for multibyte Unicode');
});

test('UTF-8 characters split between HTTP chunks retain exact content and replay cleanly', async t => {
  const f = await fixture(t), body = payload({ description: 'Mining 漢字 in the cave failed after one node.' }), bytes = Buffer.from(JSON.stringify(body)), split = bytes.indexOf(Buffer.from('漢')) + 1;
  const result = await new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: f.app.server.address().port, path: '/api/feedback', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${f.alice.token}`, 'Content-Length': bytes.length } }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject); req.write(bytes.subarray(0, split)); setTimeout(() => req.end(bytes.subarray(split)), 5);
  });
  assert.equal(result.status, 201); assert.equal(result.data.report.description, body.description);
  assert.equal((await f.api('/api/feedback', f.alice, body)).status, 200);
});

test('admin review statuses and notes are saved, visible to reporter, audited and protected', async t => {
  const f = await fixture(t), report = f.seed();
  const inbox = await f.api('/api/feedback/review', f.admin); assert.equal(inbox.data.openCount, 1); assert.equal(inbox.data.readyForReview, false);
  for (const status of FEEDBACK_STATUSES) {
    const review = await f.api(`/api/feedback/${report.id}/review`, f.admin, { status, note: 'Reviewed by the game owner.' });
    assert.equal(review.status, 200); assert.equal(review.data.report.status, status); assert.equal(review.data.report.reporter.id, f.alice.playerId);
  }
  const own = (await f.api()).data.reports[0]; assert.equal(own.status, 'duplicate'); assert.equal(own.reviewNote, 'Reviewed by the game owner.'); assert.equal(own.reporter, undefined);
  assert.equal(f.app.store.db.prepare('SELECT count(*) AS n FROM player_feedback_reviews').get().n, FEEDBACK_STATUSES.length);
  await f.api(`/api/feedback/${report.id}/review`, f.admin, { status: 'duplicate', note: own.reviewNote });
  assert.equal(f.app.store.db.prepare('SELECT count(*) AS n FROM player_feedback_reviews').get().n, FEEDBACK_STATUSES.length);
  assert.equal((await f.api(`/api/feedback/${report.id}/review`, f.admin, { status: 'invalid' })).status, 400);
  assert.equal((await f.api(`/api/feedback/${randomUUID()}/review`, f.admin, { status: 'resolved' })).status, 404);
  assert.equal((await f.api('/api/feedback/not-an-id/review', f.admin, { status: 'resolved' })).status, 400);
});

test('paginated inbox and exports cover the full backlog with filters and a truthful review threshold', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 57; i++) f.seed(i % 2 ? f.bob : f.alice, { kind: i % 3 ? 'bug' : 'suggestion', title: `Report ${i}` });
  const first = await f.api('/api/feedback/review?limit=50', f.admin);
  assert.equal(first.status, 200); assert.equal(first.data.reports.length, 50); assert.equal(first.data.openCount, 57); assert.equal(first.data.reviewThreshold, 10); assert.equal(first.data.readyForReview, true);
  const second = await f.api('/api/feedback/export?limit=50&before=' + first.data.nextCursor, f.admin);
  assert.equal(second.data.reports.length, 7); assert.equal(second.data.nextCursor, null); assert.equal(new Set([...first.data.reports, ...second.data.reports].map(report => report.id)).size, 57);
  const filtered = await f.api('/api/feedback/review?kind=suggestion&status=new', f.admin); assert.equal(filtered.data.reports.length, 19);
  const markdown = await f.api('/api/feedback/export?format=markdown&limit=1', f.admin);
  assert.equal(markdown.status, 200); assert.match(markdown.headers.get('content-type'), /text\/markdown/); assert.match(markdown.data, /# Emberwatch player feedback/); assert.match(markdown.data, /Next page cursor: \d+/);
  assert.equal((await f.api('/api/feedback/export?format=html', f.admin)).status, 400);
});

test('failed report persistence and failed review updates roll back without fake success or partial audit rows', async t => {
  const f = await fixture(t), body = payload();
  f.app.store.db.exec("CREATE TRIGGER fail_feedback BEFORE INSERT ON player_feedback BEGIN SELECT RAISE(ABORT,'private database detail'); END;");
  const rejected = await f.api('/api/feedback', f.alice, body); assert.equal(rejected.status, 500); assert.doesNotMatch(rejected.data.error, /private database detail/); assert.equal((await f.api()).data.reports.length, 0);
  f.app.store.db.exec('DROP TRIGGER fail_feedback');
  const saved = await f.api('/api/feedback', f.alice, body); assert.equal(saved.status, 201);
  f.app.store.db.exec("CREATE TRIGGER fail_review BEFORE UPDATE ON player_feedback BEGIN SELECT RAISE(ABORT,'private review detail'); END;");
  assert.equal((await f.api(`/api/feedback/${saved.data.report.id}/review`, f.admin, { status: 'confirmed', note: 'Good report' })).status, 500);
  assert.equal((await f.api()).data.reports[0].status, 'new'); assert.equal(f.app.store.db.prepare('SELECT count(*) AS n FROM player_feedback_reviews').get().n, 0);
  f.app.store.db.exec('DROP TRIGGER fail_review');
});
