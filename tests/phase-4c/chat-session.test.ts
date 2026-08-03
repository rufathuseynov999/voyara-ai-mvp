import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import test from 'node:test';
import {
  linkChatSessionToAuthenticatedCustomer,
  loadChatSessionConversation,
  sendChatMessage,
  startChatSession,
  type ChatContext
} from '@/server/agents/chat/chat-session-service';
import { InMemoryChatSessionStore } from '@/server/agents/chat/chat-session-store';
import { InMemoryConversationStore } from '@/server/agents/in-memory-conversation-store';
import { ChatSessionAuthorityError, CHAT_RATE_LIMIT_MAX_MESSAGES } from '@/server/agents/chat/chat-session-contract';

const FIXED = new Date('2026-08-01T09:00:00.000Z');

function ctx(): ChatContext & { conversationStore: InMemoryConversationStore; sessionStore: InMemoryChatSessionStore } {
  return {
    conversationStore: new InMemoryConversationStore(),
    sessionStore: new InMemoryChatSessionStore(),
    accountId: randomUUID(),
    correlationId: `corr-${randomUUID().slice(0, 8)}`,
    now: () => FIXED
  };
}

/* -------------------------------- consent required -------------------------------- */

test('starting a session without consent is refused', async () => {
  const c = ctx();
  await assert.rejects(
    () => startChatSession(c, { preferredLocale: 'en', consentGiven: false, ipHash: null, correlationId: c.correlationId }),
    (e: unknown) => e instanceof ChatSessionAuthorityError && e.code === 'CONSENT_REQUIRED'
  );
});

/* -------------------------------- session tokens are opaque -------------------------------- */

test('the session token is never the same value as any stored hash — only the hash is persisted', async () => {
  const c = ctx();
  const { sessionToken } = await startChatSession(c, { preferredLocale: 'en', consentGiven: true, ipHash: null, correlationId: c.correlationId });
  const session = await c.sessionStore.findByTokenHash(createHash('sha256').update(sessionToken).digest('hex'));
  assert.ok(session);
  assert.notEqual(session?.sessionTokenHash, sessionToken);
});

test('two different sessions get cryptographically distinct tokens', async () => {
  const c = ctx();
  const a = await startChatSession(c, { preferredLocale: 'en', consentGiven: true, ipHash: null, correlationId: c.correlationId });
  const b = await startChatSession(c, { preferredLocale: 'en', consentGiven: true, ipHash: null, correlationId: c.correlationId });
  assert.notEqual(a.sessionToken, b.sessionToken);
  assert.notEqual(a.conversationId, b.conversationId);
});

/* -------------------------------- strict anonymous isolation -------------------------------- */

test('a visitor cannot read another visitor\'s conversation with a guessed or wrong token', async () => {
  const c = ctx();
  const a = await startChatSession(c, { preferredLocale: 'en', consentGiven: true, ipHash: null, correlationId: c.correlationId });
  await startChatSession(c, { preferredLocale: 'ru', consentGiven: true, ipHash: null, correlationId: c.correlationId });

  await assert.rejects(
    () => loadChatSessionConversation(c, 'a-completely-wrong-token-that-nobody-has-0000000000'),
    (e: unknown) => e instanceof ChatSessionAuthorityError && e.code === 'SESSION_NOT_FOUND'
  );
  // Sanity: the legitimate token for session A still resolves correctly.
  const resolved = await loadChatSessionConversation(c, a.sessionToken);
  assert.equal(resolved.conversationId, a.conversationId);
});

test('an expired session is refused even with the exact correct token', async () => {
  const c = ctx();
  const { sessionToken } = await startChatSession(c, { preferredLocale: 'en', consentGiven: true, ipHash: null, correlationId: c.correlationId });
  const laterCtx = { ...c, now: () => new Date(FIXED.getTime() + 13 * 3_600_000) }; // past the 12h session duration
  await assert.rejects(
    () => loadChatSessionConversation(laterCtx, sessionToken),
    (e: unknown) => e instanceof ChatSessionAuthorityError && e.code === 'SESSION_EXPIRED'
  );
});

/* -------------------------------- message send + rate limiting -------------------------------- */

test('a message sends successfully into the session\'s own conversation', async () => {
  const c = ctx();
  const { sessionToken, conversationId } = await startChatSession(c, { preferredLocale: 'az', consentGiven: true, ipHash: null, correlationId: c.correlationId });
  const { messageId } = await sendChatMessage(c, { sessionToken, body: 'Salam, Antalya-ya turlar varmi?', correlationId: c.correlationId });
  const message = await c.conversationStore.loadMessage(messageId);
  assert.equal(message?.conversationId, conversationId);
  assert.equal(message?.direction, 'INBOUND');
});

test('rate limiting refuses a message once the window\'s max is reached', async () => {
  const c = ctx();
  const { sessionToken, conversationId } = await startChatSession(c, { preferredLocale: 'en', consentGiven: true, ipHash: null, correlationId: c.correlationId });
  for (let i = 0; i < CHAT_RATE_LIMIT_MAX_MESSAGES; i++) {
    c.sessionStore.recordMessageTimestamp(conversationId, FIXED.toISOString());
  }
  await assert.rejects(
    () => sendChatMessage(c, { sessionToken, body: 'one more message', correlationId: c.correlationId }),
    (e: unknown) => e instanceof ChatSessionAuthorityError && e.code === 'RATE_LIMITED'
  );
});

test('rate limiting only counts messages within the rolling window, not all-time history', async () => {
  const c = ctx();
  const { sessionToken, conversationId } = await startChatSession(c, { preferredLocale: 'en', consentGiven: true, ipHash: null, correlationId: c.correlationId });
  // Old messages, well outside the window.
  const longAgo = new Date(FIXED.getTime() - 60 * 60_000).toISOString();
  for (let i = 0; i < CHAT_RATE_LIMIT_MAX_MESSAGES; i++) {
    c.sessionStore.recordMessageTimestamp(conversationId, longAgo);
  }
  // Should NOT be rate-limited — those messages are outside the 10-minute window.
  const result = await sendChatMessage(c, { sessionToken, body: 'still allowed', correlationId: c.correlationId });
  assert.ok(result.messageId);
});

/* -------------------------------- authenticated linking -------------------------------- */

test('linking an anonymous session to an authenticated customer sets isAnonymous to false', async () => {
  const c = ctx();
  const { sessionToken } = await startChatSession(c, { preferredLocale: 'en', consentGiven: true, ipHash: null, correlationId: c.correlationId });
  const authenticatedCustomerId = randomUUID();
  await linkChatSessionToAuthenticatedCustomer(c, sessionToken, authenticatedCustomerId);
  const session = await c.sessionStore.findByTokenHash(createHash('sha256').update(sessionToken).digest('hex'));
  assert.equal(session?.isAnonymous, false);
  assert.equal(session?.contactId, authenticatedCustomerId);
});

/* -------------------------------- structural: no secrets exposed -------------------------------- */

test('nothing in the chat session contract or service ever logs the raw session token', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const file of ['../../src/server/agents/chat/chat-session-contract.ts', '../../src/server/agents/chat/chat-session-service.ts']) {
    const raw = await readFile(new URL(file, import.meta.url), 'utf8');
    const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/console\.(log|error|warn)\([^)]*sessionToken\b(?!Hash)/i.test(codeOnly));
  }
});
