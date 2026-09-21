import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createFeedbackUI } from '../public/src/feedback-ui.js';

const unescape = value => String(value ?? '').replace(/&(?:amp|lt|gt|quot|#39);/g, token => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }[token]));
const memory = () => { const values = new Map(); return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; };
const makeReport = (extra = {}) => ({ id: randomUUID(), kind: 'bug', title: 'Worker stopped', description: 'It stopped at the sulfur vein.', context: { build: 31, villageId: null }, status: 'new', reviewNote: '', createdAt: Date.now(), ...extra });
function fixture(options = {}) {
  let account = 'alice', panel = null, html = '', buttons = [], renders = 0;
  const storage = options.storage === undefined ? memory() : options.storage, fields = new Map(), requests = [], reports = options.reports ?? [], downloads = [];
  const doc = { getElementById: id => id === 'panel-content' ? { querySelectorAll: () => buttons } : fields.get(id) ?? null };
  function render(next, nextPanel) {
    html = next; panel = nextPanel; renders++; fields.clear();
    buttons = [...html.matchAll(/<button\b([^>]*)>(.*?)<\/button>/gs)].map(match => ({ dataset: { feedbackAction: match[1].match(/data-feedback-action="(\d+)"/)[1] }, disabled: /\sdisabled(?:\s|$)/.test(match[1]), text: unescape(match[2]) }));
    for (const match of html.replace(/<input\b[^>]*>/g, value => `${value}</input>`).matchAll(/<(input|textarea|select)\b([^>]*)>(.*?)<\/\1>/gs)) {
      const id = match[2].match(/\bid="([^"]*)"/)?.[1]; if (!id) continue;
      const selected = [...(match[3] ?? '').matchAll(/<option\b([^>]*)>(.*?)<\/option>/gs)].find(option => /\sselected(?:\s|$)/.test(option[1]));
      const value = match[1] === 'input' ? match[2].match(/\bvalue="([^"]*)"/)?.[1] : match[1] === 'select' ? selected?.[1].match(/\bvalue="([^"]*)"/)?.[1] ?? '' : match[3];
      fields.set(id, { value: unescape(value), readOnly: /\sreadonly(?:\s|$)/.test(match[2]) });
    }
  }
  const defaultApi = async (path, settings) => {
    if (!settings) return { reports: structuredClone(reports), nextCursor: null, canReview: !!options.admin, openCount: reports.length, readyForReview: reports.length >= 10, reviewThreshold: 10 };
    const body = JSON.parse(settings.body);
    if (path.endsWith('/review')) { const report = reports.find(row => path.includes(row.id)); report.status = body.status; report.reviewNote = body.note; return { report }; }
    let report = reports.find(row => row.requestId === body.requestId);
    if (!report) { report = makeReport(body); reports.unshift(report); }
    return { report };
  };
  const api = async (path, settings) => { requests.push({ path, body: settings ? JSON.parse(settings.body) : null }); return options.api ? options.api(path, settings, defaultApi) : defaultApi(path, settings); };
  const ui = createFeedbackUI({ api, getState: () => ({ id: 'village-id' }), getAccountKey: () => account, getActivePanel: () => panel, openPanel: render, document: doc, storage, makeRequestId: randomUUID, download: page => downloads.push(page) });
  return { ui, storage, requests, fields, reports, downloads, get html() { return html; }, get renders() { return renders; }, get panel() { return panel; }, setAccount(next) { account = next; }, close() { panel = null; }, async click(label) { const button = buttons.find(row => row.text === label); assert.ok(button, `Missing button ${label}: ${html}`); assert.equal(button.disabled, false); return button.onclick(); }, field(id, value) { const field = fields.get(id); assert.ok(field, `Missing field ${id}`); field.value = value; field.oninput?.(); return field.onchange?.(); } };
}
function draft(f, title = 'A worker got stuck', description = 'After gathering sulfur the worker stopped moving.') { f.field('feedback-title', title); f.field('feedback-description', description); }

test('feedback form saves a bug, keeps stable input while typing, and shows saved history', async () => {
  const f = fixture(); await f.ui.show(); const renders = f.renders;
  draft(f); assert.equal(f.renders, renders); await f.click('Send feedback');
  assert.match(f.html, /Saved report/); assert.equal(f.requests.at(-1).body.villageId, 'village-id'); assert.equal(f.reports.length, 1);
  await f.click('My reports'); assert.match(f.html, /A worker got stuck/); assert.match(f.html, /New/); assert.doesNotMatch(f.html, /Review inbox/);
});

test('idea switching keeps a draft through closing and reloading', async () => {
  const f = fixture(); await f.ui.show(); draft(f); await f.click('Suggest an update');
  assert.equal(f.fields.get('feedback-title').value, 'A worker got stuck'); f.close();
  const restored = fixture({ storage: f.storage }); await restored.ui.show();
  assert.equal(restored.fields.get('feedback-description').value, 'After gathering sulfur the worker stopped moving.'); assert.match(restored.html, /What would you change/);
  await restored.click('Send feedback'); assert.equal(restored.requests.at(-1).body.kind, 'suggestion');
});

test('an interrupted saved submission retries its persisted receipt across reload without duplicating', async () => {
  let drop = true;
  const f = fixture({ api: async (path, settings, normal) => { const result = await normal(path, settings); if (settings && drop) { drop = false; throw new Error('Connection lost'); } return result; } });
  await f.ui.show(); draft(f); await f.click('Send feedback');
  assert.match(f.html, /Check saved submission/); assert.equal(f.fields.get('feedback-title').readOnly, true); assert.equal(f.reports.length, 1);
  const restored = fixture({ storage: f.storage, reports: f.reports }); await restored.ui.show(); await restored.click('Check saved submission');
  assert.equal(restored.reports.length, 1); assert.equal(restored.requests.at(-1).body.requestId, f.requests.at(-1).body.requestId); assert.match(restored.html, /Saved report/);
});

test('failed validation retains editable draft and storage failure does not send a report', async () => {
  const f = fixture({ api: async (path, settings, normal) => { if (settings) throw Object.assign(new Error('Please wait a minute.'), { status: 429 }); return normal(path, settings); } });
  await f.ui.show(); draft(f); await f.click('Send feedback'); assert.match(f.html, /Please wait a minute/); assert.equal(f.fields.get('feedback-title').value, 'A worker got stuck'); assert.equal(f.fields.get('feedback-title').readOnly, false);
  const blocked = fixture({ storage: null }); await blocked.ui.show(); draft(blocked); await blocked.click('Send feedback'); assert.match(blocked.html, /could not save the submission receipt/); assert.equal(blocked.requests.filter(row => row.body).length, 0);
});

test('feedback renders player content as text and private drafts never transfer to another account', async () => {
  const attack = '<img src=x onerror=alert(1)>', report = makeReport({ title: attack, description: '<script>boom()</script>', reviewNote: '<svg onload=alert(1)>' });
  const f = fixture({ reports: [report] }); await f.ui.show(); draft(f, 'Alice private title', 'Alice private description'); await f.click('My reports');
  assert.doesNotMatch(f.html, /<img|<script|<svg/); assert.match(f.html, /&lt;script&gt;/);
  await f.click('New report'); f.setAccount('bob'); await f.ui.show(); assert.equal(f.fields.get('feedback-title').value, ''); assert.equal(f.fields.get('feedback-description').value, '');
});

test('closing or changing account during a slow save never reopens or leaks the previous report', async () => {
  let release;
  const f = fixture({ api: async (path, settings, normal) => settings ? new Promise(resolve => { release = async () => resolve(await normal(path, settings)); }) : normal(path, settings) });
  await f.ui.show(); draft(f); const saving = f.click('Send feedback'); f.close(); await release(); await saving; assert.equal(f.panel, null);
  await f.ui.show(); draft(f, 'Another issue', 'A second issue to report.'); const second = f.click('Send feedback'); f.setAccount('bob'); await f.ui.show(); const renders = f.renders; await release(); await second;
  assert.equal(f.renders, renders); assert.equal(f.fields.get('feedback-title').value, ''); assert.doesNotMatch(f.html, /Saved report/);
});

test('administrator can filter and export the inbox while keeping failed review edits', async () => {
  let reject = true;
  const report = makeReport({ reporter: { id: 'alice', name: 'Alice' } }), f = fixture({ admin: true, reports: [report], api: async (path, settings, normal) => { if (settings && path.endsWith('/review') && reject) throw new Error('Network interrupted'); return normal(path, settings); } });
  await f.ui.show(); await f.click('Review inbox'); assert.match(f.html, /1 open reports/); assert.match(f.html, /Review batch target: 10 reports/);
  await f.field(`feedback-status-${report.id}`, 'confirmed'); f.field(`feedback-note-${report.id}`, 'Reproduced after upgrading the mine.'); await f.click('Save review');
  assert.match(f.html, /Network interrupted/); assert.equal(f.fields.get(`feedback-status-${report.id}`).value, 'confirmed'); assert.equal(f.fields.get(`feedback-note-${report.id}`).value, 'Reproduced after upgrading the mine.');
  await f.click('Refresh'); assert.equal(f.fields.get(`feedback-note-${report.id}`).value, 'Reproduced after upgrading the mine.');
  reject = false; await f.click('Save review'); assert.equal(f.reports[0].status, 'confirmed'); assert.match(f.html, /Review saved/);
  await f.field('feedback-filter', 'planned'); assert.match(f.requests.at(-1).path, /status=planned/); await f.click('Export this page'); assert.equal(f.downloads.length, 1); assert.match(f.requests.at(-1).path, /^\/api\/feedback\/export\?/);
});
