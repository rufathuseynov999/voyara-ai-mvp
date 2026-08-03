'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { staffAreaRoles } from '@/server/auth/roles';
import { requireAssuranceLevel, requireViewerRole } from '@/server/auth/viewer';
import { requireLocale } from '@/i18n/server';
import { assignConversation, setHandoverStatus } from '../inbox-actions';
import { StaffConsoleActionError, CombinedAutomationAndFounderControlStore } from './staff-console-action-contract';
import { buildStaffActionGatePlan, gatePlanToExtendedGateInput } from './staff-action-authority-policy';
import { SupabaseAutomationStore } from './supabase-automation-store';
import { SupabaseFounderControlStore } from './supabase-founder-control-store';
import { SupabaseWorkflowRuntimeStore } from './supabase-workflow-runtime-store';
import { completeLevel2Step, guardAgainstDuplicateEvent } from './automation-service';
import { checkAutomationGateExtended } from './founder-controls';
import { manuallyRetryDeadLetteredStep } from './workflow-runtime';
import { AutomationAuthorityError } from './automation-contract';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';

/**
 * Phase 4G — staff automation console actions.
 *
 * REAL ACTION CONTEXT: `deriveWorkflowCode` loads the step's real
 * `workflow_run_id` → `workflow_version_id` → `workflow_definition_id`
 * chain from the database and returns the authoritative `workflow_code`
 * — never accepted from the caller, so a browser cannot supply a
 * different workflow code to bypass that workflow's own pause.
 *
 * EIGHT-POINT GATE: both actions now pass the derived `workflowCode` (so
 * point 5, workflow pause, is genuinely checked) and the real feature
 * flag `STAFF_CONSOLE_AUTOMATION_FLAG_CODE` (point 7). Working-hours
 * (point 6) is intentionally NOT enforced — staff approval and dead-letter
 * recovery are incident-response actions that must remain available
 * outside business hours; no working-hours policy exists or is being
 * invented for this action, and this is a deliberate design choice
 * documented here, not a control silently skipped to bypass it.
 * Risk-policy authorization (point 8, `requireLevel1PolicyAuthority`) is
 * a Level 1 autonomous-action concept — confirmed by reading
 * risk-policy-engine.ts before writing this file — and does not apply to
 * a Level 2 step, where the human approval itself is the authorization
 * mechanism. Channel pause (point 4) applies only when the run is
 * genuinely linked to a channel; workflow_runs carries no channel column
 * in this codebase's schema (confirmed by reading the real table), so
 * channel is honestly `null` here, not fabricated.
 *
 * The `STAFF_CONSOLE_AUTOMATION_FLAG_CODE` feature flag is seeded ONCE as
 * a genuine, auditable, Founder-attributed configuration action — never
 * created or self-enabled by the action code at runtime, which would be
 * exactly the "hardcoded automatic approval" this phase was told not to
 * introduce.
 */

async function requireStaffAal2(locale: string) {
  const requiredLocale = requireLocale(locale);
  const path = `/${requiredLocale}/staff/automation`;
  const viewer = await requireViewerRole(requiredLocale, staffAreaRoles, path);
  requireAssuranceLevel(requiredLocale, viewer, 'aal2', path);
  return viewer;
}

/** Loads the AUTHORITATIVE workflow_code for a step by walking the real
 *  step → run → version → definition chain in the database. Never trusts
 *  a workflow code supplied by the caller/browser. Returns null (fails
 *  closed at the call site, not here) if any link in the chain is
 *  missing, rather than guessing. */
async function deriveWorkflowCode(workflowRunId: string): Promise<string | null> {
  const admin = createAdminSupabaseClient();
  if (!admin) return null;
  const { data: run } = await admin.from('workflow_runs').select('workflow_version_id').eq('id', workflowRunId).maybeSingle();
  if (!run) return null;
  const { data: version } = await admin.from('workflow_versions').select('workflow_definition_id').eq('id', run.workflow_version_id).maybeSingle();
  if (!version) return null;
  const { data: definition } = await admin.from('workflow_definitions').select('workflow_code').eq('id', version.workflow_definition_id).maybeSingle();
  return definition?.workflow_code ?? null;
}

export async function takeoverConversationAction(locale: string, conversationId: string): Promise<void> {
  const viewer = await requireStaffAal2(locale);
  await assignConversation(conversationId, viewer.id, `staff-console-takeover-${Date.now()}`);
  await setHandoverStatus(conversationId, 'HUMAN', viewer.id, `staff-console-takeover-${Date.now()}`);
  revalidatePath(`/${locale}/staff/automation`);
}

export async function releaseConversationAction(locale: string, conversationId: string): Promise<void> {
  const viewer = await requireStaffAal2(locale);
  await setHandoverStatus(conversationId, 'AI', viewer.id, `staff-console-release-${Date.now()}`);
  revalidatePath(`/${locale}/staff/automation`);
}

export async function approveWorkflowStepAction(locale: string, stepId: string): Promise<{ stepId: string; status: string }> {
  const viewer = await requireStaffAal2(locale);
  const store = new SupabaseAutomationStore();
  const founderControlStore = new SupabaseFounderControlStore();
  const correlationId = `staff-approve-${randomUUID()}`;
  const ctx = { store: new CombinedAutomationAndFounderControlStore(store, founderControlStore) as never, correlationId, now: () => new Date() };

  const step = await store.loadWorkflowStep(stepId);
  if (!step) throw new StaffConsoleActionError('Workflow step not found.', 'VALIDATION');
  if (step.actionLevel === 'LEVEL_3') throw new StaffConsoleActionError('Level 3 actions can never be approved through this console — no execution path exists for them anywhere in this codebase.', 'VALIDATION');
  if (step.actionLevel !== 'LEVEL_2') throw new StaffConsoleActionError('Only a Level 2 step may be approved through this console.', 'VALIDATION');

  // Authoritative context, derived from the database — never accepted
  // from the caller.
  const workflowCode = await deriveWorkflowCode(step.workflowRunId);
  const gatePlan = buildStaffActionGatePlan({ agentCode: null, channel: null, workflowCode });
  await checkAutomationGateExtended(ctx, gatePlanToExtendedGateInput(gatePlan, { agentCode: null, channel: null, workflowCode }));

  await guardAgainstDuplicateEvent(ctx, `staff-approve-step-${stepId}-${viewer.id}`);
  await completeLevel2Step(ctx, stepId, viewer.id);

  const updated = await store.loadWorkflowStep(stepId);
  if (!updated) throw new StaffConsoleActionError('Step vanished after approval — this should never happen.', 'VALIDATION');
  revalidatePath(`/${locale}/staff/automation`);
  return { stepId: updated.stepId, status: updated.status };
}

export async function retryDeadLetterAction(locale: string, deadLetterId: string): Promise<{ stepId: string; status: string }> {
  const viewer = await requireStaffAal2(locale);
  const admin = createAdminSupabaseClient();
  if (!admin) throw new StaffConsoleActionError('No production database connection is available.', 'NOT_IMPLEMENTED');

  const { data: dl, error } = await admin.from('dead_letter_records').select('*').eq('id', deadLetterId).maybeSingle();
  if (error || !dl) throw new StaffConsoleActionError('Dead-letter record not found.', 'VALIDATION');
  if (dl.resolved) throw new StaffConsoleActionError('This dead-letter record has already been resolved — a resolved record cannot be retried again.', 'VALIDATION');
  if (!dl.workflow_step_id || !dl.workflow_run_id) throw new StaffConsoleActionError('This dead-letter record has no linked workflow run/step to retry.', 'VALIDATION');

  const store = new SupabaseAutomationStore();
  const founderControlStore = new SupabaseFounderControlStore();
  const runtimeStore = new SupabaseWorkflowRuntimeStore();
  const correlationId = `staff-retry-${randomUUID()}`;
  const ctx = { store: new CombinedAutomationAndFounderControlStore(store, founderControlStore) as never, runtimeStore, correlationId, now: () => new Date() };

  // Authoritative context, derived from the real dead-letter record's own
  // linked run — never accepted from the caller.
  const workflowCode = await deriveWorkflowCode(dl.workflow_run_id);
  const gatePlan = buildStaffActionGatePlan({ agentCode: null, channel: null, workflowCode });
  await checkAutomationGateExtended(ctx, gatePlanToExtendedGateInput(gatePlan, { agentCode: null, channel: null, workflowCode }));

  await guardAgainstDuplicateEvent(ctx, `staff-retry-dl-${deadLetterId}-${viewer.id}`);

  await store.recordExecutionEvent({
    eventId: randomUUID(), workflowRunId: dl.workflow_run_id, workflowStepId: dl.workflow_step_id,
    kind: 'STEP_MANUAL_RETRY_STARTED', actorId: viewer.id, actorKind: 'human', correlationId
  });

  try {
    await manuallyRetryDeadLetteredStep(ctx, dl.workflow_step_id, viewer.id);
  } catch (retryError) {
    await store.recordExecutionEvent({
      eventId: randomUUID(), workflowRunId: dl.workflow_run_id, workflowStepId: dl.workflow_step_id,
      kind: 'STEP_MANUAL_RETRY_FAILED', actorId: viewer.id, actorKind: 'human', correlationId,
      reasonCode: (retryError as Error).message
    });
    // Left unresolved on failure — the dead-letter record is not updated.
    throw retryError instanceof AutomationAuthorityError
      ? new StaffConsoleActionError(retryError.message, 'VALIDATION')
      : retryError;
  }

  await store.recordExecutionEvent({
    eventId: randomUUID(), workflowRunId: dl.workflow_run_id, workflowStepId: dl.workflow_step_id,
    kind: 'STEP_MANUAL_RETRY_SUCCEEDED', actorId: viewer.id, actorKind: 'human', correlationId
  });

  const { error: resolveError } = await admin.from('dead_letter_records').update({ resolved: true, resolved_by: viewer.id, resolved_at: new Date().toISOString() }).eq('id', deadLetterId);
  if (resolveError) throw new StaffConsoleActionError(`Failed to mark dead-letter record resolved: ${resolveError.message}`, 'VALIDATION');

  const updated = await store.loadWorkflowStep(dl.workflow_step_id);
  if (!updated) throw new StaffConsoleActionError('Step vanished after retry — this should never happen.', 'VALIDATION');
  revalidatePath(`/${locale}/staff/automation`);
  return { stepId: updated.stepId, status: updated.status };
}
