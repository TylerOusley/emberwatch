import { randomUUID } from 'node:crypto';

export const FEEDBACK_BUILD = 31;
export const FEEDBACK_REVIEW_THRESHOLD = 10;
export const FEEDBACK_STATUSES = ['new', 'needs_info', 'confirmed', 'planned', 'resolved', 'not_reproduced', 'duplicate'];
const OPEN_STATUSES = ['new', 'needs_info', 'confirmed', 'planned'];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const failure = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const textField = (value, name, min, max) => {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw failure(`${name} must be ${min}–${max} characters.`);
  return value.trim();
};
export function installFeedbackSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS player_feedback(
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,
    account_id TEXT NOT NULL REFERENCES accounts(id),request_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('bug','suggestion')),title TEXT NOT NULL,description TEXT NOT NULL,
    context TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'new',review_note TEXT NOT NULL DEFAULT '',
    created INTEGER NOT NULL,updated INTEGER NOT NULL,UNIQUE(account_id,request_id));
    CREATE INDEX IF NOT EXISTS player_feedback_account ON player_feedback(account_id,sequence DESC);
    CREATE INDEX IF NOT EXISTS player_feedback_rate ON player_feedback(account_id,created);
    CREATE INDEX IF NOT EXISTS player_feedback_status ON player_feedback(status,sequence DESC);
    CREATE TABLE IF NOT EXISTS player_feedback_reviews(
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,report_id TEXT NOT NULL REFERENCES player_feedback(id),
      reviewer_id TEXT NOT NULL REFERENCES accounts(id),previous_status TEXT NOT NULL,status TEXT NOT NULL,note TEXT NOT NULL,created INTEGER NOT NULL);`);
}
function publicReport(row, admin = false) {
  return { id: row.id, requestId: row.request_id, kind: row.kind, title: row.title, description: row.description,
    context: JSON.parse(row.context), status: row.status, reviewNote: row.review_note, createdAt: row.created, updatedAt: row.updated,
    ...(admin ? { reporter: { id: row.account_id, name: row.reporter_name } } : {}) };
}
function requireAdmin(store, accountId) {
  if (!store.isTestAdmin(accountId)) throw failure('Only the village game administrator can review all reports.', 403);
}
function queryOptions(query) {
  const rawLimit = query.get('limit') ?? '20', cursor = query.get('before'), status = query.get('status') ?? '', kind = query.get('kind') ?? '';
  if (!/^\d{1,2}$/.test(rawLimit) || +rawLimit < 1 || +rawLimit > 50) throw failure('Choose a page size from 1 to 50.');
  if (cursor !== null && (!/^[1-9]\d{0,15}$/.test(cursor) || !Number.isSafeInteger(+cursor))) throw failure('Invalid feedback page.');
  if (status && !FEEDBACK_STATUSES.includes(status) && status !== 'open') throw failure('Choose a valid report status.');
  if (kind && !['bug', 'suggestion'].includes(kind)) throw failure('Choose bugs or suggestions.');
  return { limit: +rawLimit, cursor: cursor === null ? null : +cursor, status, kind };
}
export function listFeedback(store, accountId, query = new URLSearchParams(), admin = false) {
  if (admin) requireAdmin(store, accountId);
  const { limit, cursor, status, kind } = queryOptions(query), conditions = [], values = [];
  if (!admin) { conditions.push('f.account_id=?'); values.push(accountId); }
  if (cursor !== null) { conditions.push('f.sequence<?'); values.push(cursor); }
  if (status === 'open') conditions.push(`f.status IN ('new','needs_info','confirmed','planned')`);
  else if (status) { conditions.push('f.status=?'); values.push(status); }
  if (kind) { conditions.push('f.kind=?'); values.push(kind); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = store.db.prepare(`SELECT f.*,a.name AS reporter_name FROM player_feedback f JOIN accounts a ON a.id=f.account_id ${where} ORDER BY f.sequence DESC LIMIT ?`).all(...values, limit + 1);
  const page = rows.slice(0, limit), canReview = store.isTestAdmin(accountId);
  const openCount = admin ? store.db.prepare(`SELECT count(*) AS n FROM player_feedback WHERE status IN ('new','needs_info','confirmed','planned')`).get().n : undefined;
  return { reports: page.map(row => publicReport(row, admin)), nextCursor: rows.length > limit ? String(page.at(-1).sequence) : null, canReview,
    ...(admin ? { openCount, reviewThreshold: FEEDBACK_REVIEW_THRESHOLD, readyForReview: openCount >= FEEDBACK_REVIEW_THRESHOLD } : {}) };
}
export function submitFeedback(store, simulation, accountId, body, now = Date.now()) {
  if (typeof body.requestId !== 'string' || !UUID.test(body.requestId)) throw failure('A valid submission receipt is required.');
  if (!['bug', 'suggestion'].includes(body.kind)) throw failure('Choose a bug report or update idea.');
  const title = textField(body.title, 'Title', 3, 100), description = textField(body.description, 'Details', 10, 3000);
  const villageId = body.villageId ?? null;
  if (villageId !== null && (typeof villageId !== 'string' || !UUID.test(villageId))) throw failure('Invalid village context.');
  return store.transaction(() => {
    const prior = store.db.prepare('SELECT * FROM player_feedback WHERE account_id=? AND request_id=?').get(accountId, body.requestId);
    if (prior) {
      if (prior.kind !== body.kind || prior.title !== title || prior.description !== description || JSON.parse(prior.context).villageId !== villageId) throw failure('That submission receipt belongs to different feedback.', 409);
      return { report: publicReport(prior), replayed: true };
    }
    const village = villageId ? simulation.villages.get(villageId) : null;
    if (villageId && !village?.players?.[accountId]) throw failure('Choose a village you have joined, or submit without a village.');
    const recent = store.db.prepare('SELECT count(*) AS daily,sum(CASE WHEN created>? THEN 1 ELSE 0 END) AS minute FROM player_feedback WHERE account_id=? AND created>?').get(now - 60000, accountId, now - 86400000);
    if (recent.minute >= 5 || recent.daily >= 20) throw failure(recent.minute >= 5 ? 'Please wait a minute before sending another report.' : 'You have sent 20 reports today. Please try again tomorrow.', 429);
    const context = { build: FEEDBACK_BUILD, villageId, villageName: village?.name ?? null, day: Number.isSafeInteger(village?.day) ? village.day : null, phase: ['day', 'night'].includes(village?.phase) ? village.phase : null };
    const id = randomUUID();
    store.db.prepare('INSERT INTO player_feedback(id,account_id,request_id,kind,title,description,context,created,updated) VALUES(?,?,?,?,?,?,?,?,?)').run(id, accountId, body.requestId, body.kind, title, description, JSON.stringify(context), now, now);
    return { report: publicReport(store.db.prepare('SELECT * FROM player_feedback WHERE id=?').get(id)), replayed: false };
  });
}
export function reviewFeedback(store, accountId, id, body, now = Date.now()) {
  requireAdmin(store, accountId);
  if (!UUID.test(id)) throw failure('Invalid report ID.');
  if (!FEEDBACK_STATUSES.includes(body.status)) throw failure('Choose a valid report status.');
  const note = textField(body.note ?? '', 'Review note', 0, 600);
  return store.transaction(() => {
    const prior = store.db.prepare('SELECT * FROM player_feedback WHERE id=?').get(id);
    if (!prior) throw failure('That report was not found.', 404);
    if (prior.status !== body.status || prior.review_note !== note) {
      store.db.prepare('INSERT INTO player_feedback_reviews(report_id,reviewer_id,previous_status,status,note,created) VALUES(?,?,?,?,?,?)').run(id, accountId, prior.status, body.status, note, now);
      store.db.prepare('UPDATE player_feedback SET status=?,review_note=?,updated=? WHERE id=?').run(body.status, note, now, id);
    }
    return { report: publicReport(store.db.prepare('SELECT f.*,a.name AS reporter_name FROM player_feedback f JOIN accounts a ON a.id=f.account_id WHERE f.id=?').get(id), true) };
  });
}
export function feedbackMarkdown(page) {
  // A text export, never interpreted as HTML by the game. Keep report text in
  // blockquotes so player content cannot impersonate report headings.
  const quote = value => String(value ?? '').split(/\r\n?|\n/).map(line => `> ${line.replace(/</g, '&lt;').replace(/>/g, '&gt;')}`).join('\n');
  return `# Emberwatch player feedback\n\n${page.openCount} open reports. Review batch target: ${page.reviewThreshold}.\n\n` + page.reports.map(report => `## ${report.id}\n\n${report.kind} · ${report.status} · ${new Date(report.createdAt).toISOString()}\n\n${quote(report.title)}\n\n${quote(report.description)}\n\nReporter: ${report.reporter.id}\n\nBuild ${report.context.build} · Village ${report.context.villageId ?? 'none'} · Day ${report.context.day ?? 'none'}\n\nReview note:\n${quote(report.reviewNote)}`).join('\n\n---\n\n') + `\n\nNext page cursor: ${page.nextCursor ?? 'none'}\n`;
}
