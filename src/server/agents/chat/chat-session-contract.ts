import { randomBytes, createHash } from 'node:crypto';
import { z } from 'zod';

/**
 * Phase 4C — website chat session identity.
 *
 * A session token is 32 cryptographically random bytes, base64url-encoded,
 * given to the browser once (the client is responsible for holding it —
 * typically in memory or localStorage; this contract doesn't prescribe
 * storage, only that the SERVER never sees or stores the raw token again).
 * Only `sha256(token)` is ever persisted (`chat_sessions.session_token_hash`)
 * — this is the same "never store the raw secret" discipline used for the
 * database password / API keys everywhere else in this project, applied to
 * a visitor's session identity.
 *
 * An anonymous session cannot be escalated to see another session's
 * conversation: `resolveSessionConversation` looks up a conversation ONLY by
 * the exact hash of the token presented, never by contact id, customer id,
 * or any other guessable value — presenting a different (even a real, valid)
 * token for a different session returns null, not another visitor's data.
 */

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export const chatSessionSchema = z.object({
  sessionId: z.uuid(),
  accountId: z.uuid(),
  contactId: z.uuid().nullable(),
  conversationId: z.uuid(),
  sessionTokenHash: z.string().regex(/^[0-9a-f]{64}$/),
  isAnonymous: z.boolean(),
  ipHash: z.string().nullable(),
  preferredLocale: z.enum(['az', 'ru', 'en']).nullable(),
  consentGivenAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime()
}).strict();
export type ChatSession = z.infer<typeof chatSessionSchema>;

export const startChatSessionRequestSchema = z.object({
  preferredLocale: z.enum(['az', 'ru', 'en']),
  consentGiven: z.boolean(),
  ipHash: z.string().nullable(),
  correlationId: z.string().min(1).max(128)
}).strict();
export type StartChatSessionRequest = z.infer<typeof startChatSessionRequestSchema>;

export const chatMessageRequestSchema = z.object({
  sessionToken: z.string().min(32).max(128),
  body: z.string().trim().min(1).max(2_000),
  correlationId: z.string().min(1).max(128)
}).strict();
export type ChatMessageRequest = z.infer<typeof chatMessageRequestSchema>;

export class ChatSessionAuthorityError extends Error {
  constructor(
    message: string,
    readonly code: 'VALIDATION' | 'CONSENT_REQUIRED' | 'SESSION_NOT_FOUND' | 'SESSION_EXPIRED' | 'RATE_LIMITED'
  ) {
    super(message);
    this.name = 'ChatSessionAuthorityError';
  }
}

/** Rate-limit rule: at most N inbound messages per session within a rolling
 *  window. Kept as named constants so the limit is auditable, not a magic
 *  number buried in logic. */
export const CHAT_RATE_LIMIT_MAX_MESSAGES = 20;
export const CHAT_RATE_LIMIT_WINDOW_MINUTES = 10;
export const CHAT_SESSION_DURATION_HOURS = 12;
