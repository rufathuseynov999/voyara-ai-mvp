import 'server-only';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { randomUUID } from 'node:crypto';

/**
 * Phase 4B — CRM inbox staff actions. Every action here is a plain
 * record-keeping update (who owns this conversation, is a human or the AI
 * currently handling it) — none of them approves anything, sends anything,
 * or executes a payment/booking/refund. Escalation reuses
 * agent-operating-layer.ts's `escalateConversation` (Phase 4A, unchanged).
 */

export async function assignConversation(conversationId: string, staffActorId: string, correlationId: string): Promise<void> {
  const admin = createAdminSupabaseClient();
  if (!admin) throw new Error('INBOX_ACTIONS_UNAVAILABLE');
  const { error } = await admin.from('conversations').update({ assigned_owner_id: staffActorId }).eq('id', conversationId);
  if (error) throw new Error(`ASSIGN_CONVERSATION_FAILED:${error.code}`);
  await admin.from('agent_audit_events').insert({
    id: randomUUID(), conversation_id: conversationId, message_id: null, kind: 'CONVERSATION_ASSIGNED',
    actor_id: staffActorId, actor_kind: 'human', correlation_id: correlationId
  });
}

export async function setHandoverStatus(conversationId: string, status: 'AI' | 'HUMAN', staffActorId: string, correlationId: string): Promise<void> {
  const admin = createAdminSupabaseClient();
  if (!admin) throw new Error('INBOX_ACTIONS_UNAVAILABLE');
  const { error } = await admin.from('conversations').update({ handover_status: status }).eq('id', conversationId);
  if (error) throw new Error(`SET_HANDOVER_FAILED:${error.code}`);
  await admin.from('agent_audit_events').insert({
    id: randomUUID(), conversation_id: conversationId, message_id: null, kind: `HANDOVER_SET_${status}`,
    actor_id: staffActorId, actor_kind: 'human', correlation_id: correlationId
  });
}
