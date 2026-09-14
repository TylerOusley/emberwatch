import { randomUUID } from 'node:crypto';
import { CHAT_MAX_LENGTH, CHAT_HISTORY_LIMIT, CHAT_SEND_INTERVAL_MS, CHAT_TYPING_INTERVAL_MS } from '../shared/chat.js';

// Chat is transient and separate from saved village state or account balances.
export class VillageChat {
  constructor(now = Date.now) {
    this.now = now;
    this.messages = new Map();
    this.lastMessageAt = new Map();
    this.lastTypingAt = new Map();
    this.typingPlayers = new Set();
  }

  history(villageId) { return this.messages.get(villageId) ?? []; }

  post(identity, rawText) {
    if (typeof rawText !== 'string') throw new Error('Chat messages must be text.');
    const text = rawText.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069]/g, ' ').replace(/\s+/gu, ' ').trim();
    if (!text.length || text.length > CHAT_MAX_LENGTH) throw new Error(`Chat messages must be 1–${CHAT_MAX_LENGTH} characters.`);
    const at = this.now(), last = this.lastMessageAt.get(identity.playerId);
    if (last !== undefined && at - last < CHAT_SEND_INTERVAL_MS) throw new Error('Wait a moment before sending another chat message.');
    this.lastMessageAt.set(identity.playerId, at);
    const message = { type: 'chat', id: randomUUID(), playerId: identity.playerId, name: identity.name, text, at };
    const messages = this.history(identity.villageId);
    messages.push(message);
    if (messages.length > CHAT_HISTORY_LIMIT) messages.splice(0, messages.length - CHAT_HISTORY_LIMIT);
    this.messages.set(identity.villageId, messages);
    return message;
  }

  setTyping(identity, typing) {
    if (typeof typing !== 'boolean') throw new Error('Invalid typing status.');
    if (!typing) return this.clearTyping(identity);
    const now = this.now(), last = this.lastTypingAt.get(identity.playerId);
    if (last !== undefined && now - last < CHAT_TYPING_INTERVAL_MS) return null;
    this.lastTypingAt.set(identity.playerId, now);
    this.typingPlayers.add(identity.playerId);
    return { type: 'typing', playerId: identity.playerId, name: identity.name, typing: true };
  }

  clearTyping(identity) {
    if (!this.typingPlayers.delete(identity.playerId)) return null;
    return { type: 'typing', playerId: identity.playerId, name: identity.name, typing: false };
  }

  prune() {
    const now = this.now();
    for (const times of [this.lastMessageAt, this.lastTypingAt]) {
      for (const [id, at] of times) if (now - at > 60000) times.delete(id);
    }
  }
}
