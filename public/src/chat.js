const MESSAGE_LIMIT = 60;
const MESSAGE_LENGTH = 240;
const TYPING_LIFETIME = 5000;
const BUBBLE_LIFETIME = 8000;

export function cleanChatDraft(value) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MESSAGE_LENGTH) : '';
}

// This state also drives avatar bubbles; history never replays old speech.
export function createChatState({ now = () => Date.now() } = {}) {
  const messages = [];
  const seen = new Set();
  const bubbles = new Map();
  const typists = new Map();
  const playerKey = value => (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) ? String(value) : '';

  function add(raw, live) {
    if (!raw || (typeof raw.id !== 'string' && typeof raw.id !== 'number')) return null;
    const id = String(raw.id), playerId = playerKey(raw.playerId), text = cleanChatDraft(raw.text);
    if (!id || id.length > 128 || !playerId || !text || typeof raw.name !== 'string' || !Number.isFinite(raw.at) || !Number.isFinite(new Date(raw.at).getTime()) || seen.has(id)) return null;
    const message = { id, playerId, name: raw.name.slice(0, 40), text, at: raw.at };
    seen.add(id);
    while (seen.size > MESSAGE_LIMIT * 4) seen.delete(seen.values().next().value);
    messages.push(message);
    messages.sort((a, b) => a.at - b.at);
    if (messages.length > MESSAGE_LIMIT) messages.splice(0, messages.length - MESSAGE_LIMIT);
    if (live) {
      bubbles.set(playerId, { text, until: now() + BUBBLE_LIFETIME });
      typists.delete(playerId);
    }
    return message;
  }

  return {
    receive(packet) {
      if (!packet || typeof packet !== 'object') return null;
      if (packet.type === 'chatHistory' && Array.isArray(packet.messages)) {
        let added = 0;
        for (const raw of packet.messages.slice(-MESSAGE_LIMIT)) if (add(raw, false)) added++;
        return { type: 'history', added };
      }
      if (packet.type === 'chat') {
        const message = add(packet, true);
        return message ? { type: 'message', message } : null;
      }
      if (packet.type === 'typing') {
        const playerId = playerKey(packet.playerId);
        if (!playerId || typeof packet.typing !== 'boolean') return null;
        if (packet.typing) typists.set(playerId, { name: typeof packet.name === 'string' ? packet.name.slice(0, 40) : 'A villager', until: now() + TYPING_LIFETIME });
        else typists.delete(playerId);
        return { type: 'typing' };
      }
      return null;
    },
    messages: () => messages.slice(),
    typingNames(excludeId) {
      const names = [];
      for (const [id, typist] of typists) {
        if (typist.until <= now()) typists.delete(id);
        else if (id !== String(excludeId)) names.push(typist.name);
      }
      return names;
    },
    bubbleFor(playerId) {
      const key = String(playerId), typing = typists.get(key), message = bubbles.get(key);
      if (typing?.until > now()) return { text: '', typing: true };
      typists.delete(key);
      if (message?.until > now()) return { text: message.text, typing: false };
      bubbles.delete(key);
      return null;
    },
    clearTyping() { typists.clear(); },
    reset() { messages.length = 0; seen.clear(); bubbles.clear(); typists.clear(); }
  };
}

export function createVillageChat({ host, send, ownId, onFocusChange = () => {} }) {
  const memory = createChatState();
  let connected = false, expanded = false, focused = false, unread = 0;
  let typing = false, lastTypingSent = -Infinity, idleTimer, statusTimer;
  let composing = false, lastMessageSent = -Infinity, messageTimer;
  const renderedRows = new Map();
  const doc = host.ownerDocument;

  function element(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  const toggleButton = element('button', 'village-chat-toggle');
  toggleButton.type = 'button';
  toggleButton.title = 'Village chat (T) · Enter to type';
  toggleButton.setAttribute('aria-expanded', 'false');
  toggleButton.setAttribute('aria-controls', 'village-chat-panel');
  const icon = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 20 20');
  icon.setAttribute('aria-hidden', 'true');
  const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M3 3.5h14v10H9l-4 3v-3H3zM6 7h8M6 10h5');
  icon.append(path);
  const unreadBadge = element('span', 'village-chat-unread');
  unreadBadge.hidden = true;
  toggleButton.append(icon, element('span', '', 'VILLAGE CHAT'), unreadBadge, element('kbd', '', 'T'));

  const panel = element('section', 'village-chat-panel');
  panel.id = 'village-chat-panel';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Village chat');
  const header = element('div', 'village-chat-heading');
  const heading = element('div');
  heading.append(element('h2', '', 'Around the hearth'), element('span', '', 'VILLAGE CHAT'));
  const closeButton = element('button', 'village-chat-close', '×');
  closeButton.type = 'button';
  closeButton.title = 'Close chat (Escape)';
  closeButton.setAttribute('aria-label', 'Close village chat');
  header.append(heading, closeButton);
  const log = element('div', 'village-chat-log');
  log.setAttribute('role', 'log');
  log.setAttribute('aria-live', 'polite');
  log.setAttribute('aria-relevant', 'additions');
  log.setAttribute('aria-label', 'Village messages');
  log.tabIndex = 0;
  const empty = element('p', 'village-chat-empty', 'A quiet hearth. Say hello to your village.');
  log.append(empty);
  const typingLabel = element('p', 'village-chat-typing');
  // Visual typing indicators are intentionally not announced on every keystroke.
  typingLabel.setAttribute('aria-hidden', 'true');
  const form = element('form', 'village-chat-compose');
  const input = element('input', 'village-chat-input');
  input.type = 'text';
  input.name = 'chat';
  input.maxLength = MESSAGE_LENGTH;
  input.placeholder = 'Message your village…';
  input.autocomplete = 'off';
  input.setAttribute('aria-label', 'Message your village');
  const sendButton = element('button', 'village-chat-send', 'Send');
  sendButton.type = 'submit';
  form.append(input, sendButton);
  const footer = element('div', 'village-chat-footer');
  const hint = element('span', '', 'Enter to send · Esc to return');
  const count = element('span', '', `0 / ${MESSAGE_LENGTH}`);
  count.setAttribute('aria-hidden', 'true');
  footer.append(hint, count);
  panel.append(header, log, typingLabel, form, footer);
  host.classList.add('village-chat-host');
  host.append(toggleButton, panel);

  function updateUnread() {
    unreadBadge.hidden = unread === 0;
    unreadBadge.textContent = unread > 99 ? '99+' : String(unread);
    toggleButton.setAttribute('aria-label', unread ? `Village chat, ${unread} unread messages` : 'Open village chat');
  }
  function setFocus(value) {
    if (focused === value) return;
    focused = value;
    onFocusChange(value);
  }
  function stopTyping() {
    clearTimeout(idleTimer);
    if (typing && connected) send({ type: 'typing', typing: false });
    memory.receive({ type: 'typing', playerId: ownId(), typing: false });
    typing = false;
    lastTypingSent = -Infinity;
  }
  function updateDraft() {
    count.textContent = `${input.value.length} / ${MESSAGE_LENGTH}`;
    sendButton.disabled = !connected || !cleanChatDraft(input.value) || Date.now() - lastMessageSent < 1000;
  }
  function markTyping() {
    updateDraft();
    if (!connected || !cleanChatDraft(input.value)) return stopTyping();
    const now = Date.now();
    memory.receive({ type: 'typing', playerId: ownId(), name: 'You', typing: true });
    if (!typing || now - lastTypingSent >= 2000) {
      send({ type: 'typing', typing: true });
      typing = true;
      lastTypingSent = now;
    }
    clearTimeout(idleTimer);
    idleTimer = setTimeout(stopTyping, 4500);
  }
  function updateTypingLabel() {
    const names = memory.typingNames(ownId());
    typingLabel.textContent = names.length === 1 ? `${names[0]} is typing…` : names.length > 1 ? `${names.slice(0, 2).join(' and ')}${names.length > 2 ? ' and others' : ''} are typing…` : '';
  }
  function scheduleTypingLabel() {
    clearTimeout(statusTimer);
    updateTypingLabel();
    if (memory.typingNames(ownId()).length) statusTimer = setTimeout(scheduleTypingLabel, 500);
  }
  function renderMessages({ scroll = false, quiet = false } = {}) {
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 36;
    // History is a reconnect aid, not a new conversation announcement.
    if (quiet) log.setAttribute('aria-live', 'off');
    const messages = memory.messages();
    const retained = new Set(messages.map(message => message.id));
    for (const [id, row] of renderedRows) {
      if (!retained.has(id)) { row.remove(); renderedRows.delete(id); }
    }
    if (messages.length) empty.remove();
    const nodes = messages.map(message => {
      let row = renderedRows.get(message.id);
      if (!row) {
        row = element('div', 'village-chat-message');
        if (message.playerId === String(ownId())) row.classList.add('own');
        const meta = element('div', 'village-chat-meta');
        const time = element('time', '', new Date(message.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        time.dateTime = new Date(message.at).toISOString();
        meta.append(element('strong', '', message.name), time);
        row.append(meta, element('p', '', message.text));
        renderedRows.set(message.id, row);
      }
      return row;
    });
    // Preserve existing rows so a live log announces only the new message.
    (nodes.length ? nodes : [empty]).forEach((node, index) => {
      if (log.children[index] !== node) log.insertBefore(node, log.children[index] || null);
    });
    if (scroll || nearBottom) log.scrollTop = log.scrollHeight;
    if (quiet) queueMicrotask(() => log.setAttribute('aria-live', 'polite'));
  }
  function open(shouldFocus = false) {
    expanded = true;
    unread = 0;
    updateUnread();
    host.classList.add('is-open');
    toggleButton.hidden = true;
    toggleButton.setAttribute('aria-expanded', 'true');
    panel.hidden = false;
    log.scrollTop = log.scrollHeight;
    if (shouldFocus && connected) input.focus({ preventScroll: true });
  }
  function close() {
    stopTyping();
    expanded = false;
    panel.hidden = true;
    toggleButton.hidden = false;
    toggleButton.setAttribute('aria-expanded', 'false');
    host.classList.remove('is-open');
    if (host.contains(doc.activeElement)) doc.activeElement.blur();
    setFocus(false);
  }
  function submit(event) {
    event.preventDefault();
    const text = cleanChatDraft(input.value);
    if (composing || !connected || !text || Date.now() - lastMessageSent < 1000) return;
    send({ type: 'chat', text });
    lastMessageSent = Date.now();
    clearTimeout(messageTimer);
    messageTimer = setTimeout(updateDraft, 1000);
    stopTyping();
    input.value = '';
    updateDraft();
    input.focus({ preventScroll: true });
  }

  // Consume pointer/keyboard events here so tool swings and hotkeys cannot fire.
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'wheel', 'contextmenu']) {
    host.addEventListener(type, event => event.stopPropagation());
  }
  host.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.isComposing || composing || event.keyCode === 229) return;
    if (event.code === 'Escape') { event.preventDefault(); close(); }
    else if (event.target === input && (event.key === 'Enter' || event.code === 'NumpadEnter')) { event.preventDefault(); submit(event); }
  });
  host.addEventListener('keyup', event => event.stopPropagation());
  toggleButton.addEventListener('click', () => open(true));
  closeButton.addEventListener('click', close);
  form.addEventListener('submit', submit);
  input.addEventListener('input', markTyping);
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; });
  input.addEventListener('focus', () => setFocus(true));
  input.addEventListener('blur', () => { composing = false; stopTyping(); setFocus(false); });

  const api = {
    receive(packet) {
      const result = memory.receive(packet);
      if (!result) return;
      if (result.type === 'history') renderMessages({ quiet: true });
      else if (result.type === 'message') {
        if (!expanded && result.message.playerId !== String(ownId())) unread++;
        updateUnread();
        renderMessages({ scroll: result.message.playerId === String(ownId()) });
      }
      scheduleTypingLabel();
    },
    reset() {
      stopTyping();
      clearTimeout(statusTimer);
      clearTimeout(messageTimer);
      memory.reset();
      lastMessageSent = -Infinity;
      composing = false;
      unread = 0;
      input.value = '';
      close();
      updateUnread();
      updateDraft();
      renderMessages({ quiet: true });
      updateTypingLabel();
    },
    setConnected(value) {
      if (!value) stopTyping();
      connected = !!value;
      input.disabled = !connected;
      input.placeholder = connected ? 'Message your village…' : 'Waiting for connection…';
      hint.textContent = connected ? 'Enter to send · Esc to return' : 'Chat reconnects with your village';
      if (!connected) {
        memory.clearTyping();
        clearTimeout(statusTimer);
        updateTypingLabel();
        input.blur();
        setFocus(false);
      }
      updateDraft();
    },
    toggle() { if (expanded) close(); else open(true); },
    focus() { open(true); },
    isFocused: () => focused,
    close,
    bubbleFor: playerId => memory.bubbleFor(playerId)
  };
  updateUnread();
  api.setConnected(false);
  return api;
}
