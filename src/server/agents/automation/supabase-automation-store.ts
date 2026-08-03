import 'server-only';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { workflowVersionSchema, workflowStepSchema, type WorkflowVersion, type WorkflowStep } from './automation-contract';
import { automationPolicySchema, type AutomationPolicy } from './automation-policy-contract';
import type { AutomationStore, WorkflowRun, WorkflowExecutionEvent, PauseControl, EmergencyStopState, PauseScope } from './automation-store';

/**
 * Phase 4G — the real Supabase/PostgreSQL implementation of
 * `AutomationStore`, persisting into the actual Migration 23–25 tables —
 * every table this session already applied, tested, and verified against
 * real PostgreSQL earlier in Phase 4G, whose exact schema is reused here
 * rather than re-derived.
 *
 * This is the store `completeLevel2Step` and `manuallyRetryDeadLetteredStep`
 * need before the staff console's approve/retry actions can be genuinely
 * wired — see staff-console-actions.ts's own honest note about that gap,
 * which this file closes at the store layer. Wiring the staff console's
 * actions to actually USE this store, and a matching WorkflowRuntimeStore
 * implementation for the runtime-specific lease/retry columns, remain
 * separate follow-up work — this file's scope is exactly the
 * AutomationStore interface, not the broader runtime.
 */

class AutomationStoreUnavailableError extends Error {
  constructor() {
    super('AUTOMATION_STORE_UNAVAILABLE');
    this.name = 'AutomationStoreUnavailableError';
  }
}

function admin() {
  const client = createAdminSupabaseClient();
  if (!client) throw new AutomationStoreUnavailableError();
  return client;
}

function iso(value: string | null): string | null { return value ? new Date(value).toISOString() : null; }

export class SupabaseAutomationStore implements AutomationStore {
  async saveWorkflowVersion(version: WorkflowVersion): Promise<void> {
    const { error } = await admin().from('workflow_versions').upsert({
      id: version.workflowVersionId, workflow_definition_id: version.workflowDefinitionId, version: version.version,
      step_graph: version.stepGraph, status: version.status, approved_by: version.approvedBy, approved_at: version.approvedAt,
      content_hash: version.contentHash, correlation_id: version.correlationId, created_at: version.createdAt, updated_at: version.updatedAt
    });
    if (error) throw new Error(`WORKFLOW_VERSION_SAVE_FAILED: ${error.message}`);
  }

  async loadWorkflowVersion(workflowVersionId: string): Promise<WorkflowVersion | null> {
    const { data, error } = await admin().from('workflow_versions').select('*').eq('id', workflowVersionId).maybeSingle();
    if (error) throw new Error(`WORKFLOW_VERSION_LOAD_FAILED: ${error.message}`);
    if (!data) return null;
    return workflowVersionSchema.parse({
      workflowVersionId: data.id, workflowDefinitionId: data.workflow_definition_id, version: data.version,
      stepGraph: data.step_graph, status: data.status, approvedBy: data.approved_by, approvedAt: iso(data.approved_at),
      contentHash: data.content_hash, correlationId: data.correlation_id, createdAt: iso(data.created_at), updatedAt: iso(data.updated_at)
    });
  }

  async saveWorkflowVersionHistory(entry: { historyId: string; workflowVersionId: string; version: number; contentHash: string; snapshot: Record<string, unknown>; createdBy: string; correlationId: string }): Promise<void> {
    const { error } = await admin().from('workflow_version_history').insert({
      id: entry.historyId, workflow_version_id: entry.workflowVersionId, version: entry.version, content_hash: entry.contentHash,
      snapshot: entry.snapshot, created_by: entry.createdBy, correlation_id: entry.correlationId
    });
    if (error) throw new Error(`WORKFLOW_VERSION_HISTORY_SAVE_FAILED: ${error.message}`);
  }

  async saveWorkflowRun(run: WorkflowRun): Promise<void> {
    const { error } = await admin().from('workflow_runs').upsert({
      id: run.workflowRunId, workflow_version_id: run.workflowVersionId, subject_type: run.subjectType, subject_id: run.subjectId,
      status: run.status, current_step_index: run.currentStepIndex, correlation_id: run.correlationId,
      created_at: run.createdAt, updated_at: run.updatedAt
    });
    if (error) throw new Error(`WORKFLOW_RUN_SAVE_FAILED: ${error.message}`);
  }

  async loadWorkflowRun(workflowRunId: string): Promise<WorkflowRun | null> {
    const { data, error } = await admin().from('workflow_runs').select('*').eq('id', workflowRunId).maybeSingle();
    if (error) throw new Error(`WORKFLOW_RUN_LOAD_FAILED: ${error.message}`);
    if (!data) return null;
    return {
      workflowRunId: data.id, workflowVersionId: data.workflow_version_id, subjectType: data.subject_type, subjectId: data.subject_id,
      status: data.status, currentStepIndex: data.current_step_index, correlationId: data.correlation_id,
      createdAt: iso(data.created_at) ?? data.created_at, updatedAt: iso(data.updated_at) ?? data.updated_at
    };
  }

  async reserveWorkflowIdempotencyKey(key: string, workflowRunId: string): Promise<{ winner: boolean; workflowRunId: string }> {
    const { error } = await admin().from('workflow_idempotency_keys').insert({ idempotency_key: key, workflow_run_id: workflowRunId, correlation_id: key });
    if (!error) return { winner: true, workflowRunId };
    const isDuplicateKey = (error as { code?: string }).code === '23505';
    if (!isDuplicateKey) throw new Error(`WORKFLOW_IDEMPOTENCY_RESERVE_FAILED: ${error.message}`);
    const { data, error: readError } = await admin().from('workflow_idempotency_keys').select('workflow_run_id').eq('idempotency_key', key).maybeSingle();
    if (readError || !data) throw new Error(`WORKFLOW_IDEMPOTENCY_READBACK_FAILED: ${readError?.message ?? 'no row found'}`);
    return { winner: false, workflowRunId: (data as { workflow_run_id: string }).workflow_run_id };
  }

  async saveWorkflowStep(step: WorkflowStep): Promise<void> {
    const { error } = await admin().from('workflow_steps').upsert({
      id: step.stepId, workflow_run_id: step.workflowRunId, step_index: step.stepIndex, step_code: step.stepCode,
      action_level: step.actionLevel, status: step.status, approved_by: step.approvedBy, approved_at: step.approvedAt,
      approval_content_hash: step.approvalContentHash, started_at: step.startedAt, completed_at: step.completedAt,
      correlation_id: step.correlationId, created_at: step.createdAt
    });
    if (error) throw new Error(`WORKFLOW_STEP_SAVE_FAILED: ${error.message}`);
  }

  async loadWorkflowStep(stepId: string): Promise<WorkflowStep | null> {
    const { data, error } = await admin().from('workflow_steps').select('*').eq('id', stepId).maybeSingle();
    if (error) throw new Error(`WORKFLOW_STEP_LOAD_FAILED: ${error.message}`);
    if (!data) return null;
    return workflowStepSchema.parse({
      stepId: data.id, workflowRunId: data.workflow_run_id, stepIndex: data.step_index, stepCode: data.step_code,
      actionLevel: data.action_level, status: data.status, approvedBy: data.approved_by, approvedAt: iso(data.approved_at),
      approvalContentHash: data.approval_content_hash, startedAt: iso(data.started_at), completedAt: iso(data.completed_at),
      correlationId: data.correlation_id, createdAt: iso(data.created_at)
    });
  }

  async recordExecutionEvent(event: WorkflowExecutionEvent): Promise<void> {
    const { error } = await admin().from('workflow_execution_events').insert({
      id: event.eventId, workflow_run_id: event.workflowRunId, workflow_step_id: event.workflowStepId, kind: event.kind,
      actor_id: event.actorId, actor_kind: event.actorKind, correlation_id: event.correlationId, reason_code: event.reasonCode ?? null
    });
    if (error) throw new Error(`WORKFLOW_EXECUTION_EVENT_RECORD_FAILED: ${error.message}`);
  }

  async loadPauseControl(scope: PauseScope, scopeKey: string | null): Promise<PauseControl | null> {
    let query = admin().from('automation_pause_controls').select('*').eq('scope', scope);
    query = scopeKey === null ? query.is('scope_key', null) : query.eq('scope_key', scopeKey);
    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(`PAUSE_CONTROL_LOAD_FAILED: ${error.message}`);
    if (!data) return null;
    return {
      scope: data.scope, scopeKey: data.scope_key, paused: data.paused, pausedBy: data.paused_by, pausedAt: iso(data.paused_at),
      reason: data.reason, resumedBy: data.resumed_by, resumedAt: iso(data.resumed_at)
    };
  }

  async savePauseControl(control: PauseControl): Promise<void> {
    let deleteQuery = admin().from('automation_pause_controls').delete().eq('scope', control.scope);
    deleteQuery = control.scopeKey === null ? deleteQuery.is('scope_key', null) : deleteQuery.eq('scope_key', control.scopeKey);
    await deleteQuery;
    const { randomUUID } = await import('node:crypto');
    const { error } = await admin().from('automation_pause_controls').insert({
      id: randomUUID(), scope: control.scope, scope_key: control.scopeKey, paused: control.paused, paused_by: control.pausedBy,
      paused_at: control.pausedAt, reason: control.reason, resumed_by: control.resumedBy, resumed_at: control.resumedAt,
      correlation_id: `store-write-${randomUUID()}`
    });
    if (error) throw new Error(`PAUSE_CONTROL_SAVE_FAILED: ${error.message}`);
  }

  async recordPauseEvent(event: { eventId: string; scope: PauseScope; scopeKey: string | null; kind: 'PAUSED' | 'RESUMED'; actorId: string; reasonCode?: string | null; correlationId: string }): Promise<void> {
    const { error } = await admin().from('automation_pause_events').insert({
      id: event.eventId, scope: event.scope, agent_code: event.scopeKey, kind: event.kind, actor_id: event.actorId,
      reason_code: event.reasonCode ?? null, correlation_id: event.correlationId
    });
    if (error) throw new Error(`PAUSE_EVENT_RECORD_FAILED: ${error.message}`);
  }

  async loadEmergencyStopState(): Promise<EmergencyStopState> {
    const { data, error } = await admin().from('emergency_stop_state').select('*').eq('id', 1).single();
    if (error || !data) throw new Error(`EMERGENCY_STOP_STATE_LOAD_FAILED: ${error?.message ?? 'no row found'}`);
    return { active: data.active, activatedBy: data.activated_by, activatedAt: iso(data.activated_at), reason: data.reason };
  }

  async saveEmergencyStopState(state: EmergencyStopState): Promise<void> {
    const { error } = await admin().from('emergency_stop_state').update({
      active: state.active, activated_by: state.activatedBy, activated_at: state.activatedAt, reason: state.reason,
      correlation_id: `store-write-${state.activatedAt ?? Date.now()}`
    }).eq('id', 1);
    if (error) throw new Error(`EMERGENCY_STOP_STATE_SAVE_FAILED: ${error.message}`);
  }

  async recordEmergencyStopEvent(event: { eventId: string; kind: 'ACTIVATED' | 'DEACTIVATED'; actorId: string; reasonCode?: string | null; correlationId: string }): Promise<void> {
    const { error } = await admin().from('emergency_stop_events').insert({
      id: event.eventId, kind: event.kind, actor_id: event.actorId, reason_code: event.reasonCode ?? null, correlation_id: event.correlationId
    });
    if (error) throw new Error(`EMERGENCY_STOP_EVENT_RECORD_FAILED: ${error.message}`);
  }

  async reserveWebhookOrDuplicateGuard(key: string): Promise<{ winner: boolean }> {
    const { randomUUID } = await import('node:crypto');
    const { error } = await admin().from('workflow_event_inbox').insert({ id: randomUUID(), event_key: key, event_kind: 'GENERIC_GUARD', correlation_id: key });
    if (!error) return { winner: true };
    const isDuplicateKey = (error as { code?: string }).code === '23505';
    if (!isDuplicateKey) throw new Error(`DUPLICATE_GUARD_RESERVE_FAILED: ${error.message}`);
    return { winner: false };
  }

  async saveAutomationPolicy(policy: AutomationPolicy): Promise<void> {
    const { error } = await admin().from('automation_policies').upsert({
      id: policy.policyId, policy_code: policy.policyCode, scope: policy.scope, rules: policy.rules, status: policy.status,
      approved_by: policy.approvedBy, approved_at: policy.approvedAt, content_hash: policy.contentHash, version: policy.version,
      correlation_id: policy.correlationId, created_at: policy.createdAt, updated_at: policy.updatedAt
    });
    if (error) throw new Error(`AUTOMATION_POLICY_SAVE_FAILED: ${error.message}`);
  }

  async loadAutomationPolicy(policyId: string): Promise<AutomationPolicy | null> {
    const { data, error } = await admin().from('automation_policies').select('*').eq('id', policyId).maybeSingle();
    if (error) throw new Error(`AUTOMATION_POLICY_LOAD_FAILED: ${error.message}`);
    if (!data) return null;
    return automationPolicySchema.parse({
      policyId: data.id, policyCode: data.policy_code, scope: data.scope, rules: data.rules, status: data.status,
      approvedBy: data.approved_by, approvedAt: iso(data.approved_at), contentHash: data.content_hash, version: data.version,
      correlationId: data.correlation_id, createdAt: iso(data.created_at), updatedAt: iso(data.updated_at)
    });
  }

  async findActiveAutomationPolicyByCode(policyCode: string): Promise<AutomationPolicy | null> {
    const { data, error } = await admin().from('automation_policies').select('*').eq('policy_code', policyCode).eq('status', 'ACTIVE').maybeSingle();
    if (error) throw new Error(`AUTOMATION_POLICY_ACTIVE_LOOKUP_FAILED: ${error.message}`);
    if (!data) return null;
    return automationPolicySchema.parse({
      policyId: data.id, policyCode: data.policy_code, scope: data.scope, rules: data.rules, status: data.status,
      approvedBy: data.approved_by, approvedAt: iso(data.approved_at), contentHash: data.content_hash, version: data.version,
      correlationId: data.correlation_id, createdAt: iso(data.created_at), updatedAt: iso(data.updated_at)
    });
  }

  async saveAutomationPolicyHistory(entry: { historyId: string; automationPolicyId: string; version: number; contentHash: string; snapshot: Record<string, unknown>; createdBy: string; correlationId: string }): Promise<void> {
    const { error } = await admin().from('automation_policy_history').insert({
      id: entry.historyId, automation_policy_id: entry.automationPolicyId, version: entry.version, content_hash: entry.contentHash,
      snapshot: entry.snapshot, created_by: entry.createdBy, correlation_id: entry.correlationId
    });
    if (error) throw new Error(`AUTOMATION_POLICY_HISTORY_SAVE_FAILED: ${error.message}`);
  }
}
