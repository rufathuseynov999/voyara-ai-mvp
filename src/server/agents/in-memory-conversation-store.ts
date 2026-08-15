import type { Contact, Conversation, Message } from './agent-contract';
import type { AgentAuditEventRecord, ConversationStore } from './conversation-store';

/**
 * Phase 4A — in-memory ConversationStore for hermetic tests.
 * Mirrors InMemoryQuoteStore's design exactly.
 */
export class InMemoryConversationStore implements ConversationStore {
  private readonly contacts = new Map<string, Contact>();
  private readonly conversations = new Map<string, Conversation>();
  private readonly messages = new Map<string, Message>();
  private readonly auditEvents: AgentAuditEventRecord[] = [];
  private readonly idempotency = new Map<string, { resultId: string }>();

  async upsertContact(contact: Omit<Contact, 'createdAt' | 'updatedAt'>): Promise<void> {
    const existing = this.contacts.get(contact.contactId);
    const now = new Date().toISOString();
    this.contacts.set(contact.contactId, {
      ...contact,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    });
  }

  async loadContact(contactId: string): Promise<Contact | null> {
    return this.contacts.get(contactId) ?? null;
  }

  async createConversation(conversation: Omit<Conversation, 'lastMessageAt'>): Promise<void> {
    this.conversations.set(conversation.conversationId, { ...conversation, lastMessageAt: null });
  }

  async loadConversation(conversationId: string): Promise<Conversation | null> {
    return this.conversations.get(conversationId) ?? null;
  }

  async findOpenConversation(params: {
    accountId: string;
    contactId: string;
    channel: Conversation['channel'];
    customerFacingBrand: Conversation['customerFacingBrand'];
  }): Promise<Conversation | null> {
    const candidates = [...this.conversations.values()].filter(
      (c) =>
        c.accountId === params.accountId &&
        c.contactId === params.contactId &&
        c.channel === params.channel &&
        (c.customerFacingBrand ?? null) === (params.customerFacingBrand ?? null) &&
        (c.status === 'OPEN' || c.status === 'PENDING_HUMAN')
    );
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt));
    return candidates[0];
  }

  async recordInboundActivity(params: {
    conversationId: string;
    inboundAt: string | null;
    status: Conversation['status'];
    handoverStatus: Conversation['handoverStatus'];
  }): Promise<void> {
    const existing = this.conversations.get(params.conversationId);
    if (!existing) throw new Error('CONVERSATION_NOT_FOUND');
    if (params.inboundAt === null) {
      // Untrusted/missing provider timestamp: the message still needs a
      // human, but lastInboundAt (service-window evidence) is left
      // completely untouched — never guessed from server time.
      this.conversations.set(params.conversationId, { ...existing, status: params.status, handoverStatus: params.handoverStatus });
      return;
    }
    // Never move lastInboundAt backwards on a replayed/out-of-order event.
    const currentInboundAt = existing.lastInboundAt ?? null;
    const nextInboundAt = currentInboundAt && currentInboundAt > params.inboundAt ? currentInboundAt : params.inboundAt;
    this.conversations.set(params.conversationId, {
      ...existing,
      status: params.status,
      handoverStatus: params.handoverStatus,
      lastInboundAt: nextInboundAt,
      lastMessageAt: params.inboundAt
    });
  }

  async updateConversationStatus(conversationId: string, status: Conversation['status'], lastMessageAt: string): Promise<void> {
    const existing = this.conversations.get(conversationId);
    if (!existing) throw new Error('CONVERSATION_NOT_FOUND');
    this.conversations.set(conversationId, { ...existing, status, lastMessageAt });
  }

  async saveMessage(message: Message): Promise<void> {
    // Mirrors the real database's messages_derive_channel_trigger: channel
    // is always derived from the owning conversation, never trusted from
    // the caller. A caller-supplied channel that disagrees with the
    // conversation's real channel is rejected, exactly like the DB. This
    // store shares the same missing-conversation authority invariant as
    // SupabaseConversationStore (which enforces a real foreign key): a
    // message can never be saved against a conversation that doesn't
    // exist, and this store never fabricates one to work around that.
    const conversation = this.conversations.get(message.conversationId);
    if (!conversation) throw new Error('CONVERSATION_NOT_FOUND');
    if (message.channel !== undefined && message.channel !== conversation.channel) {
      throw new Error(`MESSAGE_CHANNEL_MISMATCH: message.channel (${message.channel}) does not match the owning conversation's channel (${conversation.channel}).`);
    }

    // Mirrors the Supabase store's conditional-key handling for
    // providerOccurredAt: undefined preserves whatever was already
    // stored (never silently nulled by an unrelated later save); a real
    // value or explicit null is written as given. Reassignment of an
    // already-set value is rejected, mirroring the database trigger.
    const existing = this.messages.get(message.messageId);
    let providerOccurredAt = existing?.providerOccurredAt ?? null;
    if (message.providerOccurredAt !== undefined) {
      if (existing?.providerOccurredAt != null && message.providerOccurredAt !== existing.providerOccurredAt) {
        throw new Error('MESSAGE_PROVIDER_OCCURRED_AT_REASSIGNMENT_DENIED: providerOccurredAt cannot be reassigned once set.');
      }
      providerOccurredAt = message.providerOccurredAt;
    }

    this.messages.set(message.messageId, { ...message, channel: conversation.channel, providerOccurredAt });
  }

  async reconcileDeliveryStatus(params: {
    externalMessageId: string;
    deliveryStatus: Message['deliveryStatus'];
    webhookStatus: string | null;
    expectedAccountId: string;
    expectedBrand: Conversation['customerFacingBrand'];
  }): Promise<{ matched: boolean }> {
    const match = [...this.messages.values()].find((m) => m.externalMessageId === params.externalMessageId);
    if (!match) return { matched: false };
    const conversation = this.conversations.get(match.conversationId);
    if (!conversation || conversation.accountId !== params.expectedAccountId || (conversation.customerFacingBrand ?? null) !== (params.expectedBrand ?? null)) {
      return { matched: false };
    }
    const rank: Record<string, number> = { PENDING: 0, DELIVERED: 1, READ: 2, FAILED: 1 };
    const currentRank = match.deliveryStatus ? (rank[match.deliveryStatus] ?? -1) : -1;
    const nextRank = params.deliveryStatus ? (rank[params.deliveryStatus] ?? -1) : -1;
    if (nextRank < currentRank) return { matched: true }; // do not regress a terminal/higher state
    this.messages.set(match.messageId, { ...match, deliveryStatus: params.deliveryStatus, webhookStatus: params.webhookStatus });
    return { matched: true };
  }

  async loadMessage(messageId: string): Promise<Message | null> {
    return this.messages.get(messageId) ?? null;
  }

  async loadMessageByExternalId(channel: Conversation['channel'], externalMessageId: string) {
    const match = [...this.messages.values()].find((m) => m.channel === channel && m.externalMessageId === externalMessageId);
    if (!match) return null;
    const conversation = this.conversations.get(match.conversationId);
    if (!conversation) return null;
    return {
      message: match, conversationId: conversation.conversationId, accountId: conversation.accountId,
      contactId: conversation.contactId, customerFacingBrand: conversation.customerFacingBrand ?? null
    };
  }

  async recordAgentAuditEvent(event: AgentAuditEventRecord): Promise<void> {
    this.auditEvents.push(event);
  }

  async reserveIdempotent(record: { key: string; resultId: string; accountId: string; actorId: string; correlationId: string }): Promise<{ winner: boolean; resultId: string }> {
    const existing = this.idempotency.get(record.key);
    if (existing) return { winner: false, resultId: existing.resultId };
    this.idempotency.set(record.key, { resultId: record.resultId });
    return { winner: true, resultId: record.resultId };
  }

  /** Test helpers. */
  countMessages(): number {
    return this.messages.size;
  }
  countAuditEvents(): number {
    return this.auditEvents.length;
  }
  auditEventsFor(conversationId: string): AgentAuditEventRecord[] {
    return this.auditEvents.filter((event) => event.conversationId === conversationId);
  }
}
