import 'server-only';
import { randomUUID } from 'node:crypto';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import type { WorkflowRuntimeStore, LeasableStep } from './workflow-runtime';

/**
 * Phase 4G — the complete production Supabase-backed WorkflowRuntimeStore.
 * Every method is now a genuine implementation against the real
 * Migration 24 columns/tables (workflow_steps' lease/retry columns,
 * workflow_event_inbox), inspected directly before writing this file —
 * no throwing stubs remain anywhere in this class.
 */

class WorkflowRuntimeStoreUnavailableError extends Error {
  constructor() {
    super('WORKFLOW_RUNTIME_STORE_UNAVAILABLE');
    this.name = 'WorkflowRuntimeStoreUnavailableError';
  }
}

function admin() {
  const client = createAdminSupabaseClient();
  if (!client) throw new WorkflowRuntimeStoreUnavailableError();
  return client;
}

function rowToStep(data: Record<string, unknown>): LeasableStep {
  return {
    stepId: data.id as string, workflowRunId: data.workflow_run_id as string, stepIndex: data.step_index as number,
    stepCode: data.step_code as string, actionLevel: data.action_level as LeasableStep['actionLevel'], status: data.status as LeasableStep['status'],
    leaseOwner: data.lease_owner as string | null, leaseExpiresAt: data.lease_expires_at as string | null,
    attemptCount: data.attempt_count as number, maxAttempts: data.max_attempts as number, nextRetryAt: data.next_retry_at as string | null,
    causationId: data.causation_id as string | null, timeoutSeconds: data.timeout_seconds as number
  };
}

export class SupabaseWorkflowRuntimeStore implements WorkflowRuntimeStore {
  async loadStep(stepId: string): Promise<LeasableStep | null> {
    const { data, error } = await admin().from('workflow_steps').select('*').eq('id', stepId).maybeSingle();
    if (error) throw new Error(`RUNTIME_STEP_LOAD_FAILED: ${error.message}`);
    if (!data) return null;
    return rowToStep(data);
  }

  async saveStep(step: LeasableStep): Promise<void> {
    const { error } = await admin().from('workflow_steps').update({
      status: step.status, lease_owner: step.leaseOwner, lease_expires_at: step.leaseExpiresAt,
      attempt_count: step.attemptCount, max_attempts: step.maxAttempts, next_retry_at: step.nextRetryAt,
      causation_id: step.causationId, timeout_seconds: step.timeoutSeconds
    }).eq('id', step.stepId);
    if (error) throw new Error(`RUNTIME_STEP_SAVE_FAILED: ${error.message}`);
  }

  /** Real query for the autonomous worker loop: PENDING steps with no
   *  next_retry_at in the future, oldest first. */
  async loadRunnableSteps(now: Date, limit: number): Promise<LeasableStep[]> {
    const { data, error } = await admin().from('workflow_steps').select('*')
      .eq('status', 'PENDING').or(`next_retry_at.is.null,next_retry_at.lte.${now.toISOString()}`)
      .order('created_at', { ascending: true }).limit(limit);
    if (error) throw new Error(`RUNTIME_RUNNABLE_STEPS_LOAD_FAILED: ${error.message}`);
    return (data ?? []).map(rowToStep);
  }

  /** Real query: RUNNING steps whose lease has already expired. */
  async loadExpiredLeases(now: Date): Promise<LeasableStep[]> {
    const { data, error } = await admin().from('workflow_steps').select('*')
      .eq('status', 'RUNNING').lt('lease_expires_at', now.toISOString());
    if (error) throw new Error(`RUNTIME_EXPIRED_LEASES_LOAD_FAILED: ${error.message}`);
    return (data ?? []).map(rowToStep);
  }

  /** Real reserve-first insert into workflow_event_inbox — the same
   *  table built for exactly this purpose in Phase 4G. */
  async reserveInboxEvent(eventKey: string, workflowRunId: string | null, eventKind: string, payload: Record<string, unknown>, causationId: string | null): Promise<{ winner: boolean; eventId: string }> {
    const proposedId = randomUUID();
    const { error } = await admin().from('workflow_event_inbox').insert({
      id: proposedId, event_key: eventKey, workflow_run_id: workflowRunId, event_kind: eventKind, payload,
      correlation_id: eventKey, causation_id: causationId
    });
    if (!error) return { winner: true, eventId: proposedId };
    const isDuplicateKey = (error as { code?: string }).code === '23505';
    if (!isDuplicateKey) throw new Error(`RUNTIME_INBOX_RESERVE_FAILED: ${error.message}`);
    const { data, error: readError } = await admin().from('workflow_event_inbox').select('id').eq('event_key', eventKey).maybeSingle();
    if (readError || !data) throw new Error(`RUNTIME_INBOX_READBACK_FAILED: ${readError?.message ?? 'no row found'}`);
    return { winner: false, eventId: (data as { id: string }).id };
  }

  async markInboxEventProcessed(eventKey: string, processedAt: string): Promise<void> {
    const { error } = await admin().from('workflow_event_inbox').update({ processed: true, processed_at: processedAt }).eq('event_key', eventKey);
    if (error) throw new Error(`RUNTIME_INBOX_MARK_PROCESSED_FAILED: ${error.message}`);
  }
}
