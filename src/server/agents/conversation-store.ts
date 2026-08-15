import type { Contact, Conversation, Message } from './agent-contract';

/**
 * Phase 4A — conversation/CRM store port.
 *
 * Mirrors QuoteStore's design exactly (src/server/supplier/orchestration-store.ts):
 * a dependency-injected interface so agent-operating-layer.ts is hermetically
 * testable against an in-memory implementation, with a real Supabase-backed
 * implementation used in production. reserveIdempotent/releaseIdempotent
 * carry the identical reserve-first guarantee proven under real concurrency
 * in Phase 3B Part 4.
 */
export interface ConversationStore {
  upsertContact(contact: Omit<Contact, 'createdAt' | 'updatedAt'>): Promise<void>;
  loadContact(contactId: string): Promise<Contact | null>;
  createConversation(conversation: Omit<Conversation, 'lastMessageAt'>): Promise<void>;
  loadConversation(conversationId: string): Promise<Conversation | null>;
  /**
   * E.2A — real conversation continuity, brand-aware. Returns the most
   * recent OPEN or PENDING_HUMAN conversation for this exact (accountId,
   * contactId, channel, customerFacingBrand) combination, or null if none
   * exists. Never crosses brands, contacts, or channels. A CLOSED
   * conversation is never silently reused — a new one is created instead.
   */
  findOpenConversation(params: {
    accountId: string;
    contactId: string;
    channel: Conversation['channel'];
    customerFacingBrand: Conversation['customerFacingBrand'];
  }): Promise<Conversation | null>;
  updateConversationStatus(conversationId: string, status: Conversation['status'], lastMessageAt: string): Promise<void>;
  /**
   * E.2A — the ONLY store method that may write `lastInboundAt`. Deliberately
   * separate from updateConversationStatus (which outbound sends/drafts use)
   * so an outbound write can never extend the customer service window.
   * Implementations must not move lastInboundAt backwards if the store
   * already holds a later value (a replayed/out-of-order inbound event must
   * not regress it).
   *
   * `inboundAt: null` means the real inbound event's provider timestamp
   * could not be trusted (missing/malformed/implausible — see
   * parseMetaMessageTimestamp) — the message is still safely recorded and
   * the conversation still moves to PENDING_HUMAN/HUMAN handover (a human
   * still needs to see it), but lastInboundAt (the WhatsApp service-window
   * evidence) is left completely untouched. It must never be guessed from
   * webhook-ingestion time.
   */
  recordInboundActivity(params: {
    conversationId: string;
    inboundAt: string | null;
    status: Conversation['status'];
    handoverStatus: Conversation['handoverStatus'];
  }): Promise<void>;
  saveMessage(message: Message): Promise<void>;
  loadMessage(messageId: string): Promise<Message | null>;
  /**
   * E.2A §2 — narrow lookup for replay idempotency, channel-scoped to
   * match migration 29's messages_channel_external_message_id_uidx
   * exactly. Returns the message AND enough authoritative conversation
   * context (accountId, contactId, customerFacingBrand, conversationId)
   * for the caller to verify full binding before ever treating a hit as
   * an idempotent replay — the caller must never trust its own
   * caller-supplied context instead.
   */
  loadMessageByExternalId(channel: Conversation['channel'], externalMessageId: string): Promise<{
    message: Message; conversationId: string; accountId: string; contactId: string; customerFacingBrand: Conversation['customerFacingBrand'];
  } | null>;
  /**
   * E.2A §3 — delivery-status reconciliation for one specific outbound
   * message, identified by its external (Meta) message id AND verified to
   * belong to a conversation in the exact resolved (accountId,
   * customerFacingBrand) context the webhook resolved for this
   * phone_number_id. A status event for the right external id but the
   * wrong account/brand context must NOT mutate anything — this is what
   * makes cross-brand contamination structurally impossible, not just
   * unlikely. Implementations must be a no-op (not an error, `matched:
   * false`) if no row matches all of: external id, account, brand. Must
   * never regress a terminal/higher-precedence delivery state on a
   * duplicate/out-of-order status event.
   */
  reconcileDeliveryStatus(params: {
    externalMessageId: string;
    deliveryStatus: Message['deliveryStatus'];
    webhookStatus: string | null;
    expectedAccountId: string;
    expectedBrand: Conversation['customerFacingBrand'];
  }): Promise<{ matched: boolean }>;
  recordAgentAuditEvent(event: AgentAuditEventRecord): Promise<void>;
  reserveIdempotent(record: { key: string; resultId: string; accountId: string; actorId: string; correlationId: string }): Promise<{ winner: boolean; resultId: string }>;
}

export type AgentAuditEventRecord = {
  eventId: string;
  conversationId: string | null;
  messageId: string | null;
  kind: string;
  actorId: string;
  actorKind: 'human' | 'agent' | 'system';
  correlationId: string;
  reasonCode?: string | null;
  contentHash?: string | null;
};
