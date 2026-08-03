import 'server-only';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import type { AgentRole, ChannelKind, Contact, Conversation, Message, MessageStatus } from './agent-contract';
import type { AgentAuditEventRecord, ConversationStore } from './conversation-store';

/**
 * Phase 4A — Supabase-backed ConversationStore.
 *
 * Same shape and discipline as SupabaseQuoteStore: explicit field mapping
 * (never a raw passthrough of arbitrary input), a single admin client. No
 * method here can mark a message SENT by itself — that only ever happens
 * through agent-operating-layer.ts's approveAndSendMessage(), which requires
 * a real human actor first (enforced in application code AND by the
 * database's own CHECK constraint).
 */
export class SupabaseConversationStore implements ConversationStore {
  private admin() {
    const client = createAdminSupabaseClient();
    if (!client) throw new Error('CONVERSATION_STORE_UNAVAILABLE: Supabase admin client is not configured.');
    return client;
  }

  async upsertContact(contact: Omit<Contact, 'createdAt' | 'updatedAt'>): Promise<void> {
    const { error } = await this.admin().from('contacts').upsert({
      id: contact.contactId,
      account_id: contact.accountId,
      linked_customer_id: contact.linkedCustomerId,
      display_name: contact.displayName,
      phone: contact.phone,
      email: contact.email,
      instagram_handle: contact.instagramHandle,
      preferred_locale: contact.preferredLocale,
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' });
    if (error) throw new Error(`CONTACT_WRITE_FAILED:${error.code}`);
  }

  async createConversation(conversation: Omit<Conversation, 'lastMessageAt'>): Promise<void> {
    const { error } = await this.admin().from('conversations').insert({
      id: conversation.conversationId,
      account_id: conversation.accountId,
      contact_id: conversation.contactId,
      channel: conversation.channel,
      status: conversation.status,
      assigned_agent_role: conversation.assignedAgentRole,
      related_quote_id: conversation.relatedQuoteId,
      correlation_id: conversation.correlationId,
      created_at: conversation.createdAt
    });
    if (error) throw new Error(`CONVERSATION_WRITE_FAILED:${error.code}`);
  }

  async loadConversation(conversationId: string): Promise<Conversation | null> {
    const { data, error } = await this.admin().from('conversations').select('*').eq('id', conversationId).maybeSingle();
    if (error) throw new Error(`CONVERSATION_READ_FAILED:${error.code}`);
    if (!data) return null;
    return {
      conversationId: data.id,
      accountId: data.account_id,
      contactId: data.contact_id,
      channel: data.channel as ChannelKind,
      status: data.status,
      assignedAgentRole: data.assigned_agent_role as AgentRole | null,
      relatedQuoteId: data.related_quote_id,
      correlationId: data.correlation_id,
      createdAt: data.created_at,
      lastMessageAt: data.last_message_at
    };
  }

  async updateConversationStatus(conversationId: string, status: Conversation['status'], lastMessageAt: string): Promise<void> {
    const { error } = await this.admin().from('conversations').update({ status, last_message_at: lastMessageAt }).eq('id', conversationId);
    if (error) throw new Error(`CONVERSATION_UPDATE_FAILED:${error.code}`);
  }

  async saveMessage(message: Message): Promise<void> {
    const { error } = await this.admin().from('messages').upsert({
      id: message.messageId,
      conversation_id: message.conversationId,
      direction: message.direction,
      sender_kind: message.senderKind,
      agent_role: message.agentRole,
      body: message.body,
      content_hash: message.contentHash,
      status: message.status,
      requires_human_approval: message.requiresHumanApproval,
      approved_by: message.approvedBy,
      approved_at: message.approvedAt,
      sent_at: message.sentAt,
      correlation_id: message.correlationId,
      created_at: message.createdAt,
      risk_class: message.riskClass,
      policy_id: message.policyId,
      policy_hash: message.policyHash,
      knowledge_version: message.knowledgeVersion,
      model: message.model,
      agent_run_id: message.agentRunId,
      message_type: message.messageType
    }, { onConflict: 'id' });
    if (error) throw new Error(`MESSAGE_WRITE_FAILED:${error.code}`);
  }

  async loadMessage(messageId: string): Promise<Message | null> {
    const { data, error } = await this.admin().from('messages').select('*').eq('id', messageId).maybeSingle();
    if (error) throw new Error(`MESSAGE_READ_FAILED:${error.code}`);
    if (!data) return null;
    return {
      messageId: data.id,
      conversationId: data.conversation_id,
      direction: data.direction,
      senderKind: data.sender_kind,
      agentRole: data.agent_role,
      body: data.body,
      contentHash: data.content_hash,
      status: data.status as MessageStatus,
      requiresHumanApproval: data.requires_human_approval,
      approvedBy: data.approved_by,
      approvedAt: data.approved_at,
      sentAt: data.sent_at,
      correlationId: data.correlation_id,
      createdAt: data.created_at,
      riskClass: data.risk_class,
      policyId: data.policy_id,
      policyHash: data.policy_hash,
      knowledgeVersion: data.knowledge_version,
      model: data.model,
      agentRunId: data.agent_run_id,
      messageType: data.message_type
    };
  }

  async recordAgentAuditEvent(event: AgentAuditEventRecord): Promise<void> {
    const { error } = await this.admin().from('agent_audit_events').insert({
      id: event.eventId,
      conversation_id: event.conversationId,
      message_id: event.messageId,
      kind: event.kind,
      actor_id: event.actorId,
      actor_kind: event.actorKind,
      correlation_id: event.correlationId,
      reason_code: event.reasonCode ?? null,
      content_hash: event.contentHash ?? null
    });
    if (error) throw new Error(`AGENT_AUDIT_WRITE_FAILED:${error.code}`);
  }

  /** Reserve-first idempotency, identical guarantee to
   *  orchestration_idempotency_keys (Phase 3B): the PRIMARY KEY decides
   *  under real concurrency, never a find-then-put race. */
  async reserveIdempotent(record: { key: string; resultId: string; accountId: string; actorId: string; correlationId: string }): Promise<{ winner: boolean; resultId: string }> {
    const { error } = await this.admin().from('agent_idempotency_keys').insert({
      key: record.key,
      result_id: record.resultId,
      account_id: record.accountId,
      actor_id: record.actorId,
      correlation_id: record.correlationId
    });
    if (!error) return { winner: true, resultId: record.resultId };
    if (error.code !== '23505') throw new Error(`AGENT_IDEMPOTENCY_WRITE_FAILED:${error.code}`);
    const { data, error: readError } = await this.admin().from('agent_idempotency_keys').select('result_id').eq('key', record.key).single();
    if (readError) throw new Error(`AGENT_IDEMPOTENCY_READ_FAILED:${readError.code}`);
    return { winner: false, resultId: data.result_id };
  }
}
