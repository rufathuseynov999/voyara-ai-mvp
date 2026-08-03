import 'server-only';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';

/**
 * Phase 4G — staff automation console, read-only query layer. Every
 * function is a plain SELECT against real Migration 23/25 tables; nothing
 * here writes. Mutations (approve, retry, takeover/release) live in
 * `staff-console-actions.ts` and reuse the EXISTING, already-tested
 * functions from automation-service.ts, workflow-runtime.ts, and
 * inbox-actions.ts rather than re-implementing any of that logic.
 */

export type PendingApproval = {
  stepId: string; workflowRunId: string; stepCode: string; correlationId: string; createdAt: string;
};

export type DeadLetterQueueEntry = {
  alertId: string; workflowRunId: string | null; workflowStepId: string | null; reasonCode: string; createdAt: string;
};

export type HandoverEscalation = {
  conversationId: string; channel: string; lastInboundAt: string | null; assignedOwnerId: string | null;
};

export type StaffConsoleSnapshot = {
  pendingApprovals: PendingApproval[] | null;
  deadLetterQueue: DeadLetterQueueEntry[] | null;
  handoverEscalations: HandoverEscalation[] | null;
  dataAvailability: 'complete' | 'unavailable';
};

const UNAVAILABLE_SNAPSHOT: StaffConsoleSnapshot = {
  pendingApprovals: null, deadLetterQueue: null, handoverEscalations: null, dataAvailability: 'unavailable'
};

export async function loadStaffConsoleSnapshot(): Promise<StaffConsoleSnapshot> {
  const admin = createAdminSupabaseClient();
  if (!admin) return UNAVAILABLE_SNAPSHOT;

  const [approvalsResult, deadLettersResult, handoverResult] = await Promise.all([
    admin.from('workflow_steps').select('id, workflow_run_id, step_code, correlation_id, created_at')
      .eq('action_level', 'LEVEL_2').eq('status', 'AWAITING_APPROVAL').order('created_at', { ascending: true }).limit(100),
    admin.from('dead_letter_records').select('id, workflow_run_id, workflow_step_id, reason_code, created_at')
      .eq('resolved', false).order('created_at', { ascending: true }).limit(100),
    admin.from('conversations').select('id, channel, last_inbound_at, assigned_owner_id')
      .eq('handover_status', 'HUMAN').order('last_inbound_at', { ascending: true }).limit(100)
  ]);

  return {
    pendingApprovals: approvalsResult.error || !approvalsResult.data ? null : approvalsResult.data.map((r) => ({
      stepId: r.id, workflowRunId: r.workflow_run_id, stepCode: r.step_code, correlationId: r.correlation_id, createdAt: r.created_at
    })),
    deadLetterQueue: deadLettersResult.error || !deadLettersResult.data ? null : deadLettersResult.data.map((r) => ({
      alertId: r.id, workflowRunId: r.workflow_run_id, workflowStepId: r.workflow_step_id, reasonCode: r.reason_code, createdAt: r.created_at
    })),
    handoverEscalations: handoverResult.error || !handoverResult.data ? null : handoverResult.data.map((r) => ({
      conversationId: r.id, channel: r.channel, lastInboundAt: r.last_inbound_at, assignedOwnerId: r.assigned_owner_id
    })),
    dataAvailability: approvalsResult.error && deadLettersResult.error && handoverResult.error ? 'unavailable' : 'complete'
  };
}
