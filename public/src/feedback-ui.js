const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const statuses = { new: 'New', needs_info: 'Needs details', confirmed: 'Confirmed', planned: 'Planned', resolved: 'Resolved', not_reproduced: 'Not reproduced', duplicate: 'Duplicate' };
const safeStorage = () => { try { return globalThis.localStorage; } catch { return null; } };
const blankDraft = () => ({ kind: 'bug', title: '', description: '' });
const dateLabel = value => Number.isFinite(value) ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
function downloadJson(page, doc) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(page, null, 2)], { type: 'application/json' }));
  const link = doc.createElement('a'); link.href = url; link.download = 'emberwatch-feedback.json'; doc.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function createFeedbackUI({ api, getState = () => null, getMe = () => null, getAccountKey = () => getMe()?.id,
  getActivePanel, openPanel, toast = () => {}, document: doc = globalThis.document, storage = safeStorage(),
  makeRequestId = () => globalThis.crypto.randomUUID(), download = page => downloadJson(page, doc) }) {
  let accountKey = null, epoch = 0, view = 'new', draft = blankDraft(), pending = null, data = null, busy = false, loaded = false;
  let error = '', success = '', filter = 'open', before = null, pageStack = [], handlers = [], reviewDrafts = new Map();
  const active = () => getActivePanel() === 'feedback';
  const key = name => `emberwatch-feedback:${accountKey}:${name}`;
  const read = name => { try { return JSON.parse(storage?.getItem(key(name)) ?? 'null'); } catch { return null; } };
  const persist = (name, value, required = false) => {
    try { if (!storage) throw new Error(); if (value === null) storage.removeItem(key(name)); else storage.setItem(key(name), JSON.stringify(value)); }
    catch { if (required) throw new Error('Your browser could not save the submission receipt. Enable local storage, then try again. Your draft is still here.'); }
  };
  function capture() {
    if (pending || view !== 'new') return;
    for (const name of ['title', 'description']) { const field = doc.getElementById(`feedback-${name}`); if (field) draft[name] = field.value; }
    persist('draft', draft);
  }
  function currentAccount() {
    const next = getAccountKey();
    if (next !== accountKey) {
      clear(); accountKey = next;
      const saved = read('draft'), receipt = read('pending');
      if (saved && ['bug', 'suggestion'].includes(saved.kind) && typeof saved.title === 'string' && typeof saved.description === 'string') draft = { kind: saved.kind, title: saved.title.slice(0, 100), description: saved.description.slice(0, 3000) };
      if (receipt && typeof receipt.requestId === 'string' && ['bug', 'suggestion'].includes(receipt.kind) && typeof receipt.title === 'string' && typeof receipt.description === 'string') { pending = receipt; draft = { kind: receipt.kind, title: receipt.title, description: receipt.description }; }
    }
    return Boolean(accountKey);
  }
  const stillCurrent = (owner, token) => owner === getAccountKey() && owner === accountKey && token === epoch;
  function button(label, callback, disabled = false, className = '') {
    const id = handlers.push(callback) - 1;
    return `<button type="button" class="feedback-button ${className}" data-feedback-action="${id}"${disabled || busy ? ' disabled' : ''}>${esc(label)}</button>`;
  }
  const pageQuery = () => new URLSearchParams({ limit: '20', ...(view === 'review' && filter ? { status: filter } : {}), ...(before ? { before } : {}) }).toString();
  async function load() {
    if (!currentAccount()) return;
    const owner = accountKey, token = ++epoch;
    busy = true; render();
    try {
      const next = await api(`/api/feedback${view === 'review' ? '/review' : ''}?${pageQuery()}`);
      if (!stillCurrent(owner, token)) return;
      data = next; loaded = true;
    } catch (failure) { if (stillCurrent(owner, token)) error = failure.message || 'Feedback could not be loaded.'; }
    finally { if (stillCurrent(owner, token)) { busy = false; render(); } }
  }
  async function changeView(next) {
    if (busy || next === 'review' && !data?.canReview) return;
    capture(); view = next; error = ''; success = ''; before = null; pageStack = [];
    if (next === 'new') render(); else await load();
  }
  async function submit() {
    if (busy || !currentAccount()) return;
    capture(); error = ''; success = '';
    try {
      if (!pending) {
        if (draft.title.trim().length < 3 || draft.description.trim().length < 10) throw new Error('Add a short title and at least 10 characters of detail.');
        const next = { ...draft, title: draft.title.trim(), description: draft.description.trim(), requestId: makeRequestId(), villageId: getState()?.id ?? null };
        persist('pending', next, true); pending = next;
      }
    } catch (failure) { error = failure.message; render(); return; }
    const owner = accountKey, token = ++epoch;
    busy = true; render();
    try {
      const result = await api('/api/feedback', { method: 'POST', body: JSON.stringify(pending) });
      if (!stillCurrent(owner, token)) return;
      persist('pending', null); persist('draft', null); pending = null; draft = blankDraft();
      success = `Saved report ${result.report.id.slice(0, 8)}. You can follow its status in My reports.`;
      toast('Feedback saved. Thank you!');
    } catch (failure) {
      if (!stillCurrent(owner, token)) return;
      error = failure.message || 'The connection was interrupted. Retry to check your saved submission.';
      if ([400, 409, 413, 429].includes(failure.status)) { persist('pending', null); pending = null; }
    } finally { if (stillCurrent(owner, token)) { busy = false; render(); } }
  }
  async function review(report) {
    if (busy || !data?.canReview) return;
    const status = doc.getElementById(`feedback-status-${report.id}`)?.value, note = doc.getElementById(`feedback-note-${report.id}`)?.value ?? '';
    reviewDrafts.set(report.id, { status, note });
    const owner = accountKey, token = ++epoch;
    busy = true; error = ''; render();
    try {
      await api(`/api/feedback/${report.id}/review`, { method: 'POST', body: JSON.stringify({ status, note }) });
      if (!stillCurrent(owner, token)) return;
      reviewDrafts.delete(report.id); success = 'Review saved.'; busy = false; await load();
    } catch (failure) { if (stillCurrent(owner, token)) { error = failure.message; busy = false; render(); } }
  }
  async function exportPage() {
    if (busy || !data?.canReview) return;
    const owner = accountKey, token = ++epoch;
    busy = true; error = ''; render();
    try { const page = await api(`/api/feedback/export?${pageQuery()}`); if (stillCurrent(owner, token)) download(page); }
    catch (failure) { if (stillCurrent(owner, token)) error = failure.message; }
    finally { if (stillCurrent(owner, token)) { busy = false; render(); } }
  }
  function form() {
    return `<div class="feedback-compose"><div class="feedback-kind" role="group" aria-label="Feedback type">${button('Report a bug', () => { capture(); draft.kind = 'bug'; persist('draft', draft); render(); }, !!pending, draft.kind === 'bug' ? 'is-selected' : '')}${button('Suggest an update', () => { capture(); draft.kind = 'suggestion'; persist('draft', draft); render(); }, !!pending, draft.kind === 'suggestion' ? 'is-selected' : '')}</div>
      <label for="feedback-title">What would you like us to look at?</label><input id="feedback-title" maxlength="100" value="${esc(draft.title)}" placeholder="A short title"${pending || busy ? ' readonly' : ''}>
      <label for="feedback-description">${draft.kind === 'bug' ? 'What happened? How can we repeat it?' : 'What would you change, and why?'}</label><textarea id="feedback-description" maxlength="3000" rows="6" placeholder="Include the steps and what you expected to happen."${pending || busy ? ' readonly' : ''}>${esc(draft.description)}</textarea>
      <p class="feedback-hint">Your village, day and game build are attached automatically. Reports are private to you and the game administrator. Do not include passwords or personal information.</p>
      ${pending ? '<p class="feedback-hint">A submission is awaiting confirmation. Retrying checks the same receipt and will not create another report.</p>' : ''}
      ${button(busy ? 'Saving…' : pending ? 'Check saved submission' : 'Send feedback', submit, false, 'is-primary')}</div>`;
  }
  function reportCard(report) {
    const reviewDraft = reviewDrafts.get(report.id) ?? { status: report.status, note: report.reviewNote };
    return `<details class="feedback-report"><summary><span class="feedback-type">${report.kind === 'bug' ? 'Bug' : 'Idea'}</span><strong>${esc(report.title)}</strong><span class="feedback-status">${esc(statuses[report.status] ?? report.status)}</span></summary><div class="feedback-report-body"><small>${esc(dateLabel(report.createdAt))} · ${esc(report.id.slice(0, 8))}${view === 'review' ? ` · ${esc(report.reporter?.name)}` : ''}</small><p class="feedback-description">${esc(report.description)}</p><p class="feedback-hint">Build ${esc(report.context?.build)}${report.context?.villageName ? ` · ${esc(report.context.villageName)} · Day ${esc(report.context.day)}` : ' · Outside a village'}</p>${report.reviewNote ? `<p class="feedback-review-note"><strong>Review note</strong><br>${esc(report.reviewNote)}</p>` : ''}${view === 'review' ? `<div class="feedback-review-fields"><label for="feedback-status-${report.id}">Status</label><select id="feedback-status-${report.id}">${Object.entries(statuses).map(([id, label]) => `<option value="${id}"${reviewDraft.status === id ? ' selected' : ''}>${label}</option>`).join('')}</select><label for="feedback-note-${report.id}">Note visible to the reporter</label><textarea id="feedback-note-${report.id}" rows="2" maxlength="600">${esc(reviewDraft.note)}</textarea>${button('Save review', () => review(report))}</div>` : ''}</div></details>`;
  }
  function listing() {
    const reports = data?.reports ?? [];
    return `${view === 'review' ? `<div class="feedback-review-summary"><strong>${Number(data?.openCount ?? 0)} open reports</strong><span>${data?.readyForReview ? 'Ready for a review batch' : `Review batch target: ${Number(data?.reviewThreshold ?? 10)} reports`}</span></div><p class="feedback-hint">Reports wait here for manual review. A batch does not trigger automatic changes to the game.</p><label for="feedback-filter">Show</label><select id="feedback-filter"><option value=""${filter === '' ? ' selected' : ''}>All reports</option><option value="open"${filter === 'open' ? ' selected' : ''}>Open reports</option>${Object.entries(statuses).map(([id, label]) => `<option value="${id}"${filter === id ? ' selected' : ''}>${label}</option>`).join('')}</select>` : '<p class="feedback-hint">Your saved bugs and ideas. Open a report to see its details and review notes.</p>'}<div class="feedback-list">${reports.length ? reports.map(reportCard).join('') : `<p class="feedback-empty">${busy ? 'Loading reports…' : 'No reports here yet.'}</p>`}</div><div class="feedback-page-actions">${button('Refresh', load)}${pageStack.length ? button('Previous', () => { before = pageStack.pop(); return load(); }) : ''}${data?.nextCursor ? button('Next', () => { pageStack.push(before); before = data.nextCursor; return load(); }) : ''}${view === 'review' ? button('Export this page', exportPage, !reports.length) : ''}</div>`;
  }
  function render(force = false) {
    if (!force && !active()) return;
    handlers = [];
    const nav = `${button('New report', () => changeView('new'), false, view === 'new' ? 'is-selected' : '')}${button('My reports', () => changeView('mine'), false, view === 'mine' ? 'is-selected' : '')}${data?.canReview ? button('Review inbox', () => changeView('review'), false, view === 'review' ? 'is-selected' : '') : ''}`;
    openPanel(`<section class="feedback-ui"><header><p class="eyebrow">HELP SHAPE EMBERWATCH</p><h2>Bugs & ideas</h2></header><nav class="feedback-tabs" aria-label="Feedback">${nav}</nav>${error ? `<p class="feedback-error" role="alert">${esc(error)}</p>` : ''}${success ? `<p class="feedback-success" role="status">${esc(success)}</p>` : ''}${!loaded ? `<p class="feedback-empty">${busy ? 'Loading your reports…' : 'Your reports could not be loaded.'}</p>${!busy ? button('Try again', load) : ''}` : view === 'new' ? form() : listing()}</section>`, 'feedback');
    const content = doc.getElementById('panel-content');
    for (const node of content?.querySelectorAll('[data-feedback-action]') ?? []) node.onclick = () => { if (!busy && currentAccount()) return handlers[Number(node.dataset.feedbackAction)]?.(); };
    for (const name of ['title', 'description']) { const input = doc.getElementById(`feedback-${name}`); if (input) input.oninput = capture; }
    for (const report of view === 'review' ? data?.reports ?? [] : []) {
      const status = doc.getElementById(`feedback-status-${report.id}`), note = doc.getElementById(`feedback-note-${report.id}`);
      const keepReview = () => reviewDrafts.set(report.id, { status: status.value, note: note.value });
      if (status && note) { status.onchange = keepReview; note.oninput = keepReview; }
    }
    const select = doc.getElementById('feedback-filter'); if (select) select.onchange = () => { if (busy) return; filter = select.value; before = null; pageStack = []; return load(); };
  }
  function clear() { epoch++; accountKey = null; view = 'new'; draft = blankDraft(); pending = null; data = null; busy = false; loaded = false; error = ''; success = ''; filter = 'open'; before = null; pageStack = []; reviewDrafts.clear(); }
  async function show() { const previous = accountKey; if (!currentAccount()) { toast('Sign in to send feedback.'); return; } if (previous === accountKey && active()) capture(); render(true); await load(); }
  return { show, clear };
}
