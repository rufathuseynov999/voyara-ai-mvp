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

  async createConversation(conversation: Omit<Conversation, 'lastMessageAt'>): Promise<void> {
    this.conversations.set(conversation.conversationId, { ...conversation, lastMessageAt: null });
  }

  async loadConversation(conversationId: string): Promise<Conversation | null> {
    return this.conversations.get(conversationId) ?? null;
  }

  async updateConversationStatus(conversationId: string, status: Conversation['status'], lastMessageAt: string): Promise<void> {
    const existing = this.conversations.get(conversationId);
    if (!existing) throw new Error('CONVERSATION_NOT_FOUND');
    this.conversations.set(conversationId, { ...existing, status, lastMessageAt });
  }

  async saveMessage(message: Message): Promise<void> {
    this.messages.set(message.messageId, message);
  }

  async loadMessage(messageId: string): Promise<Message | null> {
    return this.messages.get(messageId) ?? null;
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
