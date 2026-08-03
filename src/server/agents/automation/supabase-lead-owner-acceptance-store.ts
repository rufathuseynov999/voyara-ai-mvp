import 'server-only';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import type { LeadOwnerAcceptanceStore, LeadOwnerContext } from './lead-owner-acceptance';
import { SYSTEM_ACTOR_ID, VOYARA_BUSINESS_ACCOUNT_ID } from '../business-account';

/**
 * Phase 4G — production LeadOwnerAcceptanceStore, reusing exactly the
 * authoritative tables/mechanisms confirmed to already exist before
 * writing this file:
 *
 * - `conversations.assigned_owner_id` / `handover_status` (added by the
 *   Phase 4B migration, not the original Phase 4A conversations table —
 *   confirmed by reading both migrations directly);
 * - `agent_audit_events` (the same table `assignConversation` and
 *   `setHandoverStatus` already write to, Phase 4B inbox-actions.ts);
 * - the real reserve-first idempotency mechanism already proven on
 *   `SupabaseConversationStore.reserveIdempotent`, which persists into the
 *   real `agent_idempotency_keys` table (Phase 4A) — reused here unchanged
 *   rather than inventing a parallel one. `account_id`/`actor_id` on that
 *   table are real, NOT-NULL uuid columns, so this store uses the
 *   project's own established `SYSTEM_ACTOR_ID`/`VOYARA_BUSINESS_ACCOUNT_ID`
 *   constants for the idempotency record's own bookkeeping fields — never
 *   an arbitrary placeholder string.
 *
 * `conversations` has no `corporate_account_id` column in this codebase's
 * current schema (confirmed by reading the real table definition) — this
 * store honestly reports `corporateAccountId: null` rather than
 * fabricating a corporate link that does not exist.
 */

class LeadOwnerAcceptanceStoreUnavailableError extends Error {
  constructor() {
    super('LEAD_OWNER_ACCEPTANCE_STORE_UNAVAILABLE');
    this.name = 'LeadOwnerAcceptanceStoreUnavailableError';
  }
}

function admin() {
  const client = createAdminSupabaseClient();
  if (!client) throw new LeadOwnerAcceptanceStoreUnavailableError();
  return client;
}

export class SupabaseLeadOwnerAcceptanceStore implements LeadOwnerAcceptanceStore {
  async loadConversationOwner(conversationId: string): Promise<LeadOwnerContext | null> {
    const { data, error } = await admin().from('conversations').select('id, assigned_owner_id, account_id').eq('id', conversationId).maybeSingle();
    if (error) throw new Error(`LEAD_OWNER_LOOKUP_FAILED: ${error.message}`);
    if (!data) return null;
    return { assignedOwnerId: data.assigned_owner_id, accountId: data.account_id, corporateAccountId: null };
  }

  async reserveAcceptanceIdempotencyKey(key: string, resultId: string): Promise<{ winner: boolean; resultId: string }> {
    const { SupabaseConversationStore } = await import('../supabase-conversation-store');
    const conversationStore = new SupabaseConversationStore();
    return conversationStore.reserveIdempotent({ key, resultId, accountId: VOYARA_BUSINESS_ACCOUNT_ID, actorId: SYSTEM_ACTOR_ID, correlationId: key });
  }

  async recordAcceptanceEvent(event: { eventId: string; conversationId: string; actorId: string; correlationId: string; causationId: string | null; reasonCode: string }): Promise<void> {
    const { SupabaseConversationStore } = await import('../supabase-conversation-store');
    const conversationStore = new SupabaseConversationStore();
    await conversationStore.recordAgentAuditEvent({
      eventId: event.eventId, conversationId: event.conversationId, messageId: null, kind: 'LEAD_OWNER_ACCEPTED',
      actorId: event.actorId, actorKind: 'human', correlationId: event.correlationId, reasonCode: event.reasonCode
    });
  }
}
