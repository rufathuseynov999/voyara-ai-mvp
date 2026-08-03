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
  createConversation(conversation: Omit<Conversation, 'lastMessageAt'>): Promise<void>;
  loadConversation(conversationId: string): Promise<Conversation | null>;
  updateConversationStatus(conversationId: string, status: Conversation['status'], lastMessageAt: string): Promise<void>;
  saveMessage(message: Message): Promise<void>;
  loadMessage(messageId: string): Promise<Message | null>;
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
