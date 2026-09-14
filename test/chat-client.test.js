import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanChatDraft, createChatState } from '../public/src/chat.js';

const message = (id, extra = {}) => ({ type: 'chat', id: String(id), playerId: 'dwarf-1', name: 'Borin', text: `Message ${id}`, at: Number(id) || 1, ...extra });

test('chat history and live delivery deduplicate without replaying old speech', () => {
  const state = createChatState({ now: () => 10000 });
  assert.deepEqual(state.receive({ type: 'chatHistory', messages: [message(1), message(2)] }), { type: 'history', added: 2 });
  assert.equal(state.bubbleFor('dwarf-1'), null);
  assert.equal(state.receive(message(2)), null);
  assert.equal(state.receive(message(3)).type, 'message');
  assert.deepEqual(state.bubbleFor('dwarf-1'), { text: 'Message 3', typing: false });
  state.receive({ type: 'chatHistory', messages: [message(1), message(2), message(3)] });
  assert.equal(state.messages().length, 3);
});

test('chat keeps the latest 60 messages in timestamp order', () => {
  const state = createChatState();
  for (let i = 70; i > 0; i--) state.receive(message(i));
  const history = state.messages();
  assert.equal(history.length, 60);
  assert.equal(history[0].id, '11');
  assert.equal(history.at(-1).id, '70');
  history.pop();
  assert.equal(state.messages().length, 60);
});

test('typing expires and sent messages replace it, then speech expires', () => {
  let now = 1000;
  const state = createChatState({ now: () => now });
  state.receive({ type: 'typing', playerId: 'dwarf-1', name: 'Borin', typing: true });
  assert.deepEqual(state.bubbleFor('dwarf-1'), { text: '', typing: true });
  assert.deepEqual(state.typingNames('dwarf-2'), ['Borin']);
  assert.deepEqual(state.typingNames('dwarf-1'), []);
  now += 5000;
  assert.equal(state.bubbleFor('dwarf-1'), null);
  assert.deepEqual(state.typingNames('dwarf-2'), []);
  state.receive({ type: 'typing', playerId: 'dwarf-1', name: 'Borin', typing: true });
  state.receive(message(1));
  assert.deepEqual(state.bubbleFor('dwarf-1'), { text: 'Message 1', typing: false });
  now += 7999;
  assert.notEqual(state.bubbleFor('dwarf-1'), null);
  now++;
  assert.equal(state.bubbleFor('dwarf-1'), null);
});

test('disconnect clears typing; reset clears village history and bubbles', () => {
  const state = createChatState();
  state.receive(message(1));
  state.receive({ type: 'typing', playerId: 'dwarf-2', name: 'Elowen', typing: true });
  state.clearTyping();
  assert.equal(state.bubbleFor('dwarf-2'), null);
  assert.equal(state.messages().length, 1);
  state.reset();
  assert.equal(state.messages().length, 0);
  assert.equal(state.bubbleFor('dwarf-1'), null);
  assert.equal(state.receive(message(1)).type, 'message');
});

test('invalid packets are ignored and message content stays plain text', () => {
  const state = createChatState();
  assert.equal(state.receive(message(1, { at: Infinity })), null);
  assert.equal(state.receive(message(1, { at: 1e30 })), null);
  assert.equal(state.receive(message(1, { playerId: {} })), null);
  assert.equal(state.receive(message(1, { text: '   ' })), null);
  assert.equal(state.receive({ type: 'typing', playerId: 'dwarf-1', typing: 'yes' }), null);
  assert.equal(cleanChatDraft('  hello\nworld\u0000  '), 'hello world');
  assert.equal(cleanChatDraft('a'.repeat(300)).length, 240);
  const text = '<img src=x onerror=alert(1)>';
  state.receive(message(1, { text }));
  assert.equal(state.messages()[0].text, text);
});
