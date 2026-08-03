import { randomUUID } from 'node:crypto';
import { sha256 } from '@/server/bos/canonical-json';
import type { ConversationStore } from '../conversation-store';
import type { ChatSessionStore } from './chat-session-store';
import {
  ChatSessionAuthorityError,
  chatMessageRequestSchema,
  hashSessionToken,
  generateSessionToken,
  startChatSessionRequestSchema,
  CHAT_RATE_LIMIT_MAX_MESSAGES,
  CHAT_RATE_LIMIT_WINDOW_MINUTES,
  CHAT_SESSION_DURATION_HOURS,
  type ChatSession,
  type StartChatSessionRequest,
  type ChatMessageRequest
} from './chat-session-contract';
import type { Message } from '../agent-contract';

/**
 * Phase 4C — website chat session service.
 *
 * `resolveSession` is the ONLY way any code path reaches a session's
 * conversation, and it always goes through `findByTokenHash` — there is no
 * function anywhere in this file that accepts a sessionId, contactId, or
 * conversationId directly from an unauthenticated caller and trusts it. A
 * visitor who does not possess the exact session token cannot reach another
 * visitor's conversation, regardless of what other ids they might guess or
 * already know (e.g. from their own session).
 */

export type ChatContext = {
  conversationStore: ConversationStore;
  sessionStore: ChatSessionStore;
  accountId: string;
  correlationId: string;
  now: () => Date;
};

export async function startChatSession(ctx: ChatContext, input: StartChatSessionRequest): Promise<{ sessionToken: string; conversationId: string }> {
  const parsed = startChatSessionRequestSchema.safeParse(input);
  if (!parsed.success) throw new ChatSessionAuthorityError('Invalid chat session request.', 'VALIDATION');
  if (!parsed.data.consentGiven) throw new ChatSessionAuthorityError('Privacy/consent notice must be accepted before starting a chat session.', 'CONSENT_REQUIRED');

  const sessionToken = generateSessionToken();
  const sessionTokenHash = hashSessionToken(sessionToken);
  const now = ctx.now();

  const contactId = randomUUID();
  await ctx.conversationStore.upsertContact({
    contactId, accountId: ctx.accountId, linkedCustomerId: null, displayName: null,
    phone: null, email: null, instagramHandle: null, preferredLocale: parsed.data.preferredLocale
  });

  const conversationId = randomUUID();
  await ctx.conversationStore.createConversation({
    conversationId, accountId: ctx.accountId, contactId, channel: 'WEB_CHAT', status: 'OPEN',
    assignedAgentRole: null, relatedQuoteId: null, correlationId: parsed.data.correlationId, createdAt: now.toISOString()
  });

  const session: ChatSession = {
    sessionId: randomUUID(), accountId: ctx.accountId, contactId, conversationId, sessionTokenHash,
    isAnonymous: true, ipHash: parsed.data.ipHash, preferredLocale: parsed.data.preferredLocale,
    consentGivenAt: now.toISOString(), createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CHAT_SESSION_DURATION_HOURS * 3_600_000).toISOString(), lastSeenAt: now.toISOString()
  };
  await ctx.sessionStore.createSession(session);

  return { sessionToken, conversationId };
}

/** The single, exclusive path to a session's own data. */
async function resolveSession(ctx: ChatContext, sessionToken: string): Promise<ChatSession> {
  const session = await ctx.sessionStore.findByTokenHash(hashSessionToken(sessionToken));
  if (!session) throw new ChatSessionAuthorityError('Session not found.', 'SESSION_NOT_FOUND');
  if (Date.parse(session.expiresAt) <= ctx.now().getTime()) throw new ChatSessionAuthorityError('Session has expired.', 'SESSION_EXPIRED');
  return session;
}

export async function sendChatMessage(ctx: ChatContext, input: ChatMessageRequest): Promise<{ messageId: string }> {
  const parsed = chatMessageRequestSchema.safeParse(input);
  if (!parsed.success) throw new ChatSessionAuthorityError('Invalid chat message.', 'VALIDATION');

  const session = await resolveSession(ctx, parsed.data.sessionToken);

  const windowStart = new Date(ctx.now().getTime() - CHAT_RATE_LIMIT_WINDOW_MINUTES * 60_000).toISOString();
  const recentCount = await ctx.sessionStore.countRecentMessages(session.conversationId, windowStart);
  if (recentCount >= CHAT_RATE_LIMIT_MAX_MESSAGES) {
    throw new ChatSessionAuthorityError(`Rate limit exceeded: max ${CHAT_RATE_LIMIT_MAX_MESSAGES} messages per ${CHAT_RATE_LIMIT_WINDOW_MINUTES} minutes.`, 'RATE_LIMITED');
  }

  const messageId = randomUUID();
  const createdAt = ctx.now().toISOString();
  const message: Message = {
    messageId, conversationId: session.conversationId, direction: 'INBOUND', senderKind: 'CONTACT', agentRole: null,
    body: parsed.data.body, contentHash: sha256({ conversationId: session.conversationId, body: parsed.data.body }),
    status: 'SENT', requiresHumanApproval: false, approvedBy: null, approvedAt: null, sentAt: createdAt,
    correlationId: parsed.data.correlationId, createdAt,
    riskClass: 'HUMAN_APPROVAL_REQUIRED', policyId: null, policyHash: null, knowledgeVersion: null, model: null, agentRunId: null, messageType: 'TEXT'
  };
  await ctx.conversationStore.saveMessage(message);
  await ctx.conversationStore.updateConversationStatus(session.conversationId, 'PENDING_HUMAN', createdAt);
  await ctx.sessionStore.touchSession(session.sessionId, createdAt);

  return { messageId };
}

/** Reading a session's own conversation — same exclusive resolveSession
 *  path, so a session can only ever read what it itself created. */
export async function loadChatSessionConversation(ctx: ChatContext, sessionToken: string): Promise<{ conversationId: string; contactId: string | null }> {
  const session = await resolveSession(ctx, sessionToken);
  return { conversationId: session.conversationId, contactId: session.contactId };
}

/** Links an anonymous session to a real, authenticated customer once they
 *  sign in mid-conversation — an explicit, intentional upgrade, never an
 *  automatic merge by similarity (matching identity-linking.ts's own rule:
 *  this is the "already-authenticated website session" verified-link case,
 *  not a guess). */
export async function linkChatSessionToAuthenticatedCustomer(ctx: ChatContext, sessionToken: string, authenticatedCustomerId: string): Promise<void> {
  const session = await resolveSession(ctx, sessionToken);
  await ctx.sessionStore.linkSessionToContact(session.sessionId, authenticatedCustomerId);
}
