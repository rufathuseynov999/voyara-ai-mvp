import type { Conversation } from '@/server/agents/agent-contract';

/**
 * E.2A — the neutral domain home for typed uniqueness-conflict errors.
 * Nothing in this file imports Supabase, PGlite, or any concrete store
 * implementation — `whatsapp-inbound.ts` (a generic, store-agnostic
 * processor) and both `InMemoryConversationStore`/`SupabaseConversationStore`
 * import FROM here, never from each other's implementation files. This
 * closes a real coupling defect: the generic inbound processor must not
 * depend on which concrete store it happens to be running against.
 *
 * Both known migration-29 partial unique index names are recorded as
 * exact constants — real named-constraint classification, not string
 * guessing, and not "every 23505 is recoverable."
 */
export const ACTIVE_CONVERSATION_CONSTRAINT_NAME = 'whatsapp_conversations_active_uidx';
export const MESSAGE_REPLAY_CONSTRAINT_NAME = 'messages_channel_external_message_id_uidx';

/**
 * A typed conflict error for the active-WhatsApp-conversation partial
 * unique index (migration 29: whatsapp_conversations_active_uidx).
 * Thrown ONLY from a store's own createConversation insert path, so a
 * caller never needs to parse a constraint name out of the raw Postgres
 * error to know which invariant it hit — the operation that threw already
 * tells it. Carries the exact scope needed for the caller's re-read.
 */
export class ActiveConversationConflictError extends Error {
  readonly code = '23505' as const;
  readonly constraintName = ACTIVE_CONVERSATION_CONSTRAINT_NAME;
  constructor(
    readonly accountId: string,
    readonly contactId: string,
    readonly channel: Conversation['channel'],
    readonly customerFacingBrand: Conversation['customerFacingBrand']
  ) {
    super('Active WhatsApp conversation already exists for this account/contact/channel/brand.');
    this.name = 'ActiveConversationConflictError';
  }
}

/**
 * A typed conflict error for the channel-scoped external-message-id
 * unique index (migration 29: messages_channel_external_message_id_uidx).
 * Thrown ONLY from a store's own saveMessage insert path, for the same
 * reason as above.
 */
export class MessageReplayConflictError extends Error {
  readonly code = '23505' as const;
  readonly constraintName = MESSAGE_REPLAY_CONSTRAINT_NAME;
  constructor(readonly channel: Conversation['channel'], readonly externalMessageId: string) {
    super('A message with this external_message_id already exists for this channel.');
    this.name = 'MessageReplayConflictError';
  }
}

/**
 * E.2A §2 — the single, narrow classifier every store implementation must
 * route a Postgres/PostgREST error through before deciding which typed
 * error (if any) to throw. Deliberately conservative: only a SQLSTATE of
 * exactly '23505' combined with an EXACT, anchored match on one of the two
 * known constraint names (via Supabase's `error.message`/`error.details`,
 * the strongest structured metadata this driver actually exposes for a
 * unique-violation — PostgREST does not currently expose a dedicated
 * `constraint` property) is ever classified as recoverable. Every other
 * 23505 — an unrelated unique violation, or a 23505 whose message doesn't
 * anchor-match either known constraint name — returns 'UNKNOWN', which
 * callers must treat as a hard failure, never a recoverable conflict.
 */
export type ConflictClassification = 'ACTIVE_CONVERSATION' | 'MESSAGE_REPLAY' | 'UNKNOWN';

export function classifyUniqueViolation(error: { code?: string | null; message?: string | null; details?: string | null; constraint?: string | null } | null | undefined): ConflictClassification {
  if (!error || error.code !== '23505') return 'UNKNOWN';
  // Verified directly against the installed @supabase/postgrest-js source
  // (node_modules/@supabase/postgrest-js/src/PostgrestError.ts): the
  // production error type is exactly { message, details, hint, code } —
  // there is NO `constraint` field in production at all. The check below
  // is not a defensive fallback for a rare case; for every real Supabase
  // call in this codebase, this anchored message/details match IS the
  // only signal that will ever be present. `error.constraint` is checked
  // first only because some non-Supabase callers (e.g. a future direct
  // pg/PGlite-backed store) may genuinely have it, verified by direct
  // PGlite testing to be the exact constraint name Postgres reports.
  if (error.constraint === ACTIVE_CONVERSATION_CONSTRAINT_NAME) return 'ACTIVE_CONVERSATION';
  if (error.constraint === MESSAGE_REPLAY_CONSTRAINT_NAME) return 'MESSAGE_REPLAY';
  if (error.constraint) return 'UNKNOWN'; // a real, different constraint name — never guess further

  const haystack = `${error.message ?? ''} ${error.details ?? ''}`;
  if (new RegExp(`"${ACTIVE_CONVERSATION_CONSTRAINT_NAME}"`).test(haystack)) return 'ACTIVE_CONVERSATION';
  if (new RegExp(`"${MESSAGE_REPLAY_CONSTRAINT_NAME}"`).test(haystack)) return 'MESSAGE_REPLAY';
  return 'UNKNOWN';
}
