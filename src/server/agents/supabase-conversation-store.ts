import 'server-only';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import type { AgentRole, ChannelKind, Contact, Conversation, Message, MessageStatus } from './agent-contract';
import type { AgentAuditEventRecord, ConversationStore } from './conversation-store';
import { ActiveConversationConflictError, MessageReplayConflictError, classifyUniqueViolation } from '@/server/conversation/conversation-store-errors';

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

  async loadContact(contactId: string): Promise<Contact | null> {
    const { data, error } = await this.admin().from('contacts').select('*').eq('id', contactId).maybeSingle();
    if (error) throw new Error(`CONTACT_READ_FAILED:${error.code}`);
    if (!data) return null;
    return {
      contactId: data.id,
      accountId: data.account_id,
      linkedCustomerId: data.linked_customer_id,
      displayName: data.display_name,
      phone: data.phone,
      email: data.email,
      instagramHandle: data.instagram_handle,
      preferredLocale: data.preferred_locale,
      createdAt: data.created_at,
      updatedAt: data.updated_at
    };
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
      created_at: conversation.createdAt,
      customer_facing_brand: conversation.customerFacingBrand ?? null,
      handover_status: conversation.handoverStatus ?? 'AI',
      last_inbound_at: conversation.lastInboundAt ?? null
    });
    if (error) {
      if (classifyUniqueViolation(error) === 'ACTIVE_CONVERSATION') {
        throw new ActiveConversationConflictError(conversation.accountId, conversation.contactId, conversation.channel, conversation.customerFacingBrand ?? null);
      }
      throw new Error(`CONVERSATION_WRITE_FAILED:${error.code}`);
    }
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
      lastMessageAt: data.last_message_at,
      customerFacingBrand: data.customer_facing_brand,
      handoverStatus: data.handover_status,
      lastInboundAt: data.last_inbound_at
    };
  }

  /**
   * E.2A — real conversation continuity via a query, not a schema change:
   * the relevant columns (account_id, contact_id, channel,
   * customer_facing_brand, status, last_message_at) already exist. This is
   * a best-effort "find-then-reuse" query, not a database-enforced
   * uniqueness constraint on its own — see migration 29
   * (whatsapp_conversations_active_uidx) for the actual concurrency
   * guarantee; this query plus that index together make reuse both
   * deterministic in the common case and safe under a genuine race (the
   * unique-violation path is handled by the caller, whatsapp-inbound.ts).
   */
  async findOpenConversation(params: {
    accountId: string;
    contactId: string;
    channel: Conversation['channel'];
    customerFacingBrand: Conversation['customerFacingBrand'];
  }): Promise<Conversation | null> {
    let query = this.admin()
      .from('conversations')
      .select('*')
      .eq('account_id', params.accountId)
      .eq('contact_id', params.contactId)
      .eq('channel', params.channel)
      .in('status', ['OPEN', 'PENDING_HUMAN']);
    query = params.customerFacingBrand ? query.eq('customer_facing_brand', params.customerFacingBrand) : query.is('customer_facing_brand', null);
    const { data, error } = await query
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
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
      lastMessageAt: data.last_message_at,
      customerFacingBrand: data.customer_facing_brand,
      handoverStatus: data.handover_status,
      lastInboundAt: data.last_inbound_at
    };
  }

  /**
   * E.2A — the only write path for lastInboundAt. Uses a conditional
   * update (`.or(...)`) so a replayed/out-of-order inbound event can never
   * move last_inbound_at backwards: the row is only updated if the new
   * timestamp is later than what is already stored, or nothing is stored
   * yet.
   */
  async recordInboundActivity(params: {
    conversationId: string;
    inboundAt: string | null;
    status: Conversation['status'];
    handoverStatus: Conversation['handoverStatus'];
  }): Promise<void> {
    if (params.inboundAt === null) {
      // Untrusted/missing provider timestamp: still moves the
      // conversation to the given status/handover (a human still needs
      // to see the message), but last_inbound_at is completely omitted
      // from this UPDATE — never guessed from server time.
      const { error } = await this.admin()
        .from('conversations')
        .update({ status: params.status, handover_status: params.handoverStatus })
        .eq('id', params.conversationId);
      if (error) throw new Error(`CONVERSATION_UPDATE_FAILED:${error.code}`);
      return;
    }
    const { data: current, error: readError } = await this.admin()
      .from('conversations')
      .select('last_inbound_at')
      .eq('id', params.conversationId)
      .maybeSingle();
    if (readError) throw new Error(`CONVERSATION_READ_FAILED:${readError.code}`);
    if (!current) throw new Error('CONVERSATION_NOT_FOUND');
    const nextInboundAt = current.last_inbound_at && current.last_inbound_at > params.inboundAt ? current.last_inbound_at : params.inboundAt;
    const { error } = await this.admin()
      .from('conversations')
      .update({ last_inbound_at: nextInboundAt, last_message_at: params.inboundAt, status: params.status, handover_status: params.handoverStatus })
      .eq('id', params.conversationId);
    if (error) throw new Error(`CONVERSATION_UPDATE_FAILED:${error.code}`);
  }

  async updateConversationStatus(conversationId: string, status: Conversation['status'], lastMessageAt: string): Promise<void> {
    const { error } = await this.admin().from('conversations').update({ status, last_message_at: lastMessageAt }).eq('id', conversationId);
    if (error) throw new Error(`CONVERSATION_UPDATE_FAILED:${error.code}`);
  }

  async saveMessage(message: Message): Promise<void> {
    // E.2A: `channel` is intentionally NEVER included in this payload —
    // it is entirely database-derived (migration 29's
    // messages_derive_channel_trigger). Writing it here, even with the
    // "correct" value, would reintroduce exactly the caller-authority risk
    // that trigger exists to remove; the database is the only source of
    // truth for this field.
    //
    // `provider_occurred_at` uses conditional-key inclusion rather than
    // `?? null`: if the caller didn't set providerOccurredAt at all
    // (undefined — e.g. a later outbound status update that isn't
    // re-supplying WhatsApp evidence), the key is OMITTED from the upsert
    // payload entirely, so Supabase's upsert leaves the column completely
    // untouched on conflict — never silently nulling out an
    // already-recorded provider timestamp. An explicit `null` still
    // writes null (a real, deliberate clear); a real value still writes
    // that value. The database trigger separately refuses any attempt to
    // REASSIGN an already-set provider_occurred_at to a different value.
    const providerOccurredAtField = message.providerOccurredAt === undefined ? {} : { provider_occurred_at: message.providerOccurredAt };

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
      message_type: message.messageType,
      external_message_id: message.externalMessageId ?? null,
      delivery_status: message.deliveryStatus ?? null,
      webhook_status: message.webhookStatus ?? null,
      ...providerOccurredAtField
    }, { onConflict: 'id' });
    if (error) {
      if (classifyUniqueViolation(error) === 'MESSAGE_REPLAY' && message.channel && message.externalMessageId) {
        throw new MessageReplayConflictError(message.channel, message.externalMessageId);
      }
      throw new Error(`MESSAGE_WRITE_FAILED:${error.code}`);
    }
  }

  /**
   * E.2A — delivery-status reconciliation, scoped to exactly the one
   * message row with this external_message_id. A duplicate/out-of-order
   * status event is idempotent and never regresses a terminal/higher
   * delivery state (READ is terminal-highest; a late DELIVERED after READ
   * is ignored). An unknown external_message_id mutates nothing and is
   * reported back as unmatched — never silently written to an unrelated row.
   */
  async reconcileDeliveryStatus(params: {
    externalMessageId: string;
    deliveryStatus: Message['deliveryStatus'];
    webhookStatus: string | null;
    expectedAccountId: string;
    expectedBrand: Conversation['customerFacingBrand'];
  }): Promise<{ matched: boolean }> {
    const { data: current, error: readError } = await this.admin()
      .from('messages')
      .select('id, delivery_status, conversation_id, conversations!inner(account_id, customer_facing_brand)')
      .eq('external_message_id', params.externalMessageId)
      .maybeSingle();
    if (readError) throw new Error(`MESSAGE_READ_FAILED:${readError.code}`);
    if (!current) return { matched: false };

    const conversation = Array.isArray(current.conversations) ? current.conversations[0] : current.conversations;
    if (!conversation || conversation.account_id !== params.expectedAccountId || conversation.customer_facing_brand !== params.expectedBrand) {
      // Right external message id, wrong account/brand context — never
      // mutate. This is the check that makes cross-brand/cross-account
      // contamination structurally impossible.
      return { matched: false };
    }

    const rank: Record<string, number> = { PENDING: 0, DELIVERED: 1, FAILED: 1, READ: 2 };
    const currentRank = current.delivery_status ? (rank[current.delivery_status as string] ?? -1) : -1;
    const nextRank = params.deliveryStatus ? (rank[params.deliveryStatus] ?? -1) : -1;
    if (nextRank < currentRank) return { matched: true };

    const { error } = await this.admin()
      .from('messages')
      .update({ delivery_status: params.deliveryStatus, webhook_status: params.webhookStatus })
      .eq('id', current.id);
    if (error) throw new Error(`MESSAGE_UPDATE_FAILED:${error.code}`);
    return { matched: true };
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
      messageType: data.message_type,
      externalMessageId: data.external_message_id,
      channel: data.channel,
      providerOccurredAt: data.provider_occurred_at,
      deliveryStatus: data.delivery_status,
      webhookStatus: data.webhook_status
    };
  }

  async loadMessageByExternalId(channel: Conversation['channel'], externalMessageId: string) {
    const { data, error } = await this.admin()
      .from('messages')
      .select('*, conversations!inner(id, account_id, contact_id, customer_facing_brand)')
      .eq('channel', channel)
      .eq('external_message_id', externalMessageId)
      .maybeSingle();
    if (error) throw new Error(`MESSAGE_READ_FAILED:${error.code}`);
    if (!data) return null;
    const conversation = Array.isArray(data.conversations) ? data.conversations[0] : data.conversations;
    if (!conversation) return null;
    return {
      message: {
        messageId: data.id, conversationId: data.conversation_id, direction: data.direction, senderKind: data.sender_kind,
        agentRole: data.agent_role, body: data.body, contentHash: data.content_hash, status: data.status as MessageStatus,
        requiresHumanApproval: data.requires_human_approval, approvedBy: data.approved_by, approvedAt: data.approved_at,
        sentAt: data.sent_at, correlationId: data.correlation_id, createdAt: data.created_at, riskClass: data.risk_class,
        policyId: data.policy_id, policyHash: data.policy_hash, knowledgeVersion: data.knowledge_version, model: data.model,
        agentRunId: data.agent_run_id, messageType: data.message_type, externalMessageId: data.external_message_id,
        channel: data.channel, providerOccurredAt: data.provider_occurred_at, deliveryStatus: data.delivery_status,
        webhookStatus: data.webhook_status
      } as Message,
      conversationId: conversation.id, accountId: conversation.account_id, contactId: conversation.contact_id,
      customerFacingBrand: conversation.customer_facing_brand
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
