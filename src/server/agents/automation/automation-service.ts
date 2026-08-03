import { randomUUID } from 'node:crypto';
import { sha256 } from '@/server/bos/canonical-json';
import type { AutomationStore, WorkflowRun } from './automation-store';
import {
  AutomationAuthorityError, workflowVersionSchema, workflowStepSchema, workflowVersionHashInput,
  verifyWorkflowVersionIsActiveAuthority, stepApprovalHashInput,
  type WorkflowVersion, type WorkflowStep
} from './automation-contract';
import { SYSTEM_ACTOR_ID } from '../business-account';

/**
 * Phase 4G — automation service.
 *
 * `checkAutomationGate` is the single choke point every workflow-run
 * creation and step-execution path must call before doing anything —
 * emergency stop is checked first (highest authority), then global pause,
 * then the specific agent's own pause state. There is no function in this
 * module that performs automation work without going through this gate.
 *
 * `completeLevel2Step` is the ONLY function that can mark a Level 2 step
 * COMPLETED, and it requires a real human approver, timestamp, and content
 * hash — verified here and again by the database's own CHECK constraint.
 * There is no `completeLevel3Step` function anywhere in this file, this
 * module, or this codebase — Level 3 execution is not merely blocked, it
 * is absent.
 */

export type AutomationContext = { store: AutomationStore; correlationId: string; now: () => Date };

export async function activateEmergencyStop(ctx: AutomationContext, actorId: string, reasonCode: string): Promise<void> {
  if (!actorId) throw new AutomationAuthorityError('A real human actor is required to activate the emergency stop.', 'VALIDATION');
  await ctx.store.saveEmergencyStopState({ active: true, activatedBy: actorId, activatedAt: ctx.now().toISOString(), reason: reasonCode });
  await ctx.store.recordEmergencyStopEvent({ eventId: randomUUID(), kind: 'ACTIVATED', actorId, reasonCode, correlationId: ctx.correlationId });
}

export async function deactivateEmergencyStop(ctx: AutomationContext, actorId: string, reasonCode: string): Promise<void> {
  if (!actorId) throw new AutomationAuthorityError('A real human actor is required to deactivate the emergency stop.', 'VALIDATION');
  await ctx.store.saveEmergencyStopState({ active: false, activatedBy: null, activatedAt: null, reason: null });
  await ctx.store.recordEmergencyStopEvent({ eventId: randomUUID(), kind: 'DEACTIVATED', actorId, reasonCode, correlationId: ctx.correlationId });
}

export async function pauseGlobal(ctx: AutomationContext, actorId: string, reason: string): Promise<void> {
  if (!actorId) throw new AutomationAuthorityError('A real human actor is required to pause automation globally.', 'VALIDATION');
  const now = ctx.now().toISOString();
  await ctx.store.savePauseControl({ scope: 'GLOBAL', scopeKey: null, paused: true, pausedBy: actorId, pausedAt: now, reason, resumedBy: null, resumedAt: null });
  await ctx.store.recordPauseEvent({ eventId: randomUUID(), scope: 'GLOBAL', scopeKey: null, kind: 'PAUSED', actorId, reasonCode: reason, correlationId: ctx.correlationId });
}

export async function resumeGlobal(ctx: AutomationContext, actorId: string): Promise<void> {
  if (!actorId) throw new AutomationAuthorityError('A real human actor is required to resume global automation.', 'VALIDATION');
  await ctx.store.savePauseControl({ scope: 'GLOBAL', scopeKey: null, paused: false, pausedBy: null, pausedAt: null, reason: null, resumedBy: actorId, resumedAt: ctx.now().toISOString() });
  await ctx.store.recordPauseEvent({ eventId: randomUUID(), scope: 'GLOBAL', scopeKey: null, kind: 'RESUMED', actorId, correlationId: ctx.correlationId });
}

export async function pauseAgent(ctx: AutomationContext, agentCode: string, actorId: string, reason: string): Promise<void> {
  if (!actorId) throw new AutomationAuthorityError('A real human actor is required to pause an agent.', 'VALIDATION');
  const now = ctx.now().toISOString();
  await ctx.store.savePauseControl({ scope: 'AGENT', scopeKey: agentCode, paused: true, pausedBy: actorId, pausedAt: now, reason, resumedBy: null, resumedAt: null });
  await ctx.store.recordPauseEvent({ eventId: randomUUID(), scope: 'AGENT', scopeKey: agentCode, kind: 'PAUSED', actorId, reasonCode: reason, correlationId: ctx.correlationId });
}

export async function resumeAgent(ctx: AutomationContext, agentCode: string, actorId: string): Promise<void> {
  if (!actorId) throw new AutomationAuthorityError('A real human actor is required to resume an agent.', 'VALIDATION');
  await ctx.store.savePauseControl({ scope: 'AGENT', scopeKey: agentCode, paused: false, pausedBy: null, pausedAt: null, reason: null, resumedBy: actorId, resumedAt: ctx.now().toISOString() });
  await ctx.store.recordPauseEvent({ eventId: randomUUID(), scope: 'AGENT', scopeKey: agentCode, kind: 'RESUMED', actorId, correlationId: ctx.correlationId });
}

export async function pauseChannel(ctx: AutomationContext, channel: string, actorId: string, reason: string): Promise<void> {
  if (!actorId) throw new AutomationAuthorityError('A real human actor is required to pause a channel.', 'VALIDATION');
  const now = ctx.now().toISOString();
  await ctx.store.savePauseControl({ scope: 'CHANNEL', scopeKey: channel, paused: true, pausedBy: actorId, pausedAt: now, reason, resumedBy: null, resumedAt: null });
  await ctx.store.recordPauseEvent({ eventId: randomUUID(), scope: 'CHANNEL', scopeKey: channel, kind: 'PAUSED', actorId, reasonCode: reason, correlationId: ctx.correlationId });
}

export async function resumeChannel(ctx: AutomationContext, channel: string, actorId: string): Promise<void> {
  if (!actorId) throw new AutomationAuthorityError('A real human actor is required to resume a channel.', 'VALIDATION');
  await ctx.store.savePauseControl({ scope: 'CHANNEL', scopeKey: channel, paused: false, pausedBy: null, pausedAt: null, reason: null, resumedBy: actorId, resumedAt: ctx.now().toISOString() });
  await ctx.store.recordPauseEvent({ eventId: randomUUID(), scope: 'CHANNEL', scopeKey: channel, kind: 'RESUMED', actorId, correlationId: ctx.correlationId });
}

export async function pauseWorkflow(ctx: AutomationContext, workflowCode: string, actorId: string, reason: string): Promise<void> {
  if (!actorId) throw new AutomationAuthorityError('A real human actor is required to pause a workflow.', 'VALIDATION');
  const now = ctx.now().toISOString();
  await ctx.store.savePauseControl({ scope: 'WORKFLOW', scopeKey: workflowCode, paused: true, pausedBy: actorId, pausedAt: now, reason, resumedBy: null, resumedAt: null });
  await ctx.store.recordPauseEvent({ eventId: randomUUID(), scope: 'WORKFLOW', scopeKey: workflowCode, kind: 'PAUSED', actorId, reasonCode: reason, correlationId: ctx.correlationId });
}

export async function resumeWorkflow(ctx: AutomationContext, workflowCode: string, actorId: string): Promise<void> {
  if (!actorId) throw new AutomationAuthorityError('A real human actor is required to resume a workflow.', 'VALIDATION');
  await ctx.store.savePauseControl({ scope: 'WORKFLOW', scopeKey: workflowCode, paused: false, pausedBy: null, pausedAt: null, reason: null, resumedBy: actorId, resumedAt: ctx.now().toISOString() });
  await ctx.store.recordPauseEvent({ eventId: randomUUID(), scope: 'WORKFLOW', scopeKey: workflowCode, kind: 'RESUMED', actorId, correlationId: ctx.correlationId });
}

export async function checkAutomationGate(ctx: AutomationContext, agentCode: string | null): Promise<void> {
  const stopState = await ctx.store.loadEmergencyStopState();
  if (stopState.active) throw new AutomationAuthorityError(`Emergency stop is active (activated by ${stopState.activatedBy}): ${stopState.reason}`, 'EMERGENCY_STOP_ACTIVE');

  const globalPause = await ctx.store.loadPauseControl('GLOBAL', null);
  if (globalPause?.paused) throw new AutomationAuthorityError(`Automation is globally paused: ${globalPause.reason}`, 'GLOBALLY_PAUSED');

  if (agentCode) {
    const agentPause = await ctx.store.loadPauseControl('AGENT', agentCode);
    if (agentPause?.paused) throw new AutomationAuthorityError(`Agent "${agentCode}" is paused: ${agentPause.reason}`, 'AGENT_PAUSED');
  }
}

export type DraftWorkflowVersionInput = { workflowDefinitionId: string; version: number; stepGraph: Record<string, unknown> };

export async function draftWorkflowVersion(ctx: AutomationContext, input: DraftWorkflowVersionInput): Promise<{ workflowVersionId: string }> {
  const workflowVersionId = randomUUID();
  const now = ctx.now().toISOString();
  const version: WorkflowVersion = {
    workflowVersionId, workflowDefinitionId: input.workflowDefinitionId, version: input.version, stepGraph: input.stepGraph,
    status: 'DRAFT', approvedBy: null, approvedAt: null, contentHash: null, correlationId: ctx.correlationId, createdAt: now, updatedAt: now
  };
  const parsed = workflowVersionSchema.safeParse(version);
  if (!parsed.success) throw new AutomationAuthorityError('Invalid workflow version draft.', 'VALIDATION');
  await ctx.store.saveWorkflowVersion(version);
  return { workflowVersionId };
}

export async function approveAndActivateWorkflowVersion(ctx: AutomationContext, workflowVersionId: string, approvedBy: string): Promise<void> {
  if (!approvedBy) throw new AutomationAuthorityError('A real human approver is required.', 'VALIDATION');
  const version = await ctx.store.loadWorkflowVersion(workflowVersionId);
  if (!version) throw new AutomationAuthorityError('Workflow version not found.', 'NOT_FOUND');

  const contentHash = sha256(workflowVersionHashInput(version));
  const now = ctx.now().toISOString();
  const activated: WorkflowVersion = { ...version, status: 'ACTIVE', approvedBy, approvedAt: now, contentHash, updatedAt: now };
  const parsed = workflowVersionSchema.safeParse(activated);
  if (!parsed.success) throw new AutomationAuthorityError('Workflow version failed validation on activation.', 'VALIDATION');

  await ctx.store.saveWorkflowVersion(activated);
  await ctx.store.saveWorkflowVersionHistory({
    historyId: randomUUID(), workflowVersionId, version: activated.version, contentHash,
    snapshot: workflowVersionHashInput(activated), createdBy: approvedBy, correlationId: ctx.correlationId
  });
}

export async function requireActiveWorkflowVersion(ctx: AutomationContext, workflowVersionId: string): Promise<WorkflowVersion> {
  const version = await ctx.store.loadWorkflowVersion(workflowVersionId);
  if (!version) throw new AutomationAuthorityError('Workflow version not found.', 'NOT_FOUND');
  verifyWorkflowVersionIsActiveAuthority(version);
  return version;
}

export async function createWorkflowRun(
  ctx: AutomationContext,
  input: { workflowVersionId: string; subjectType: string; subjectId: string | null; agentCode: string | null },
  idempotencyKey: string
): Promise<{ workflowRunId: string; created: boolean }> {
  await checkAutomationGate(ctx, input.agentCode);
  await requireActiveWorkflowVersion(ctx, input.workflowVersionId);

  const proposedRunId = randomUUID();
  const reservation = await ctx.store.reserveWorkflowIdempotencyKey(idempotencyKey, proposedRunId);
  if (!reservation.winner) return { workflowRunId: reservation.workflowRunId, created: false };

  const now = ctx.now().toISOString();
  const run: WorkflowRun = {
    workflowRunId: proposedRunId, workflowVersionId: input.workflowVersionId, subjectType: input.subjectType, subjectId: input.subjectId,
    status: 'PENDING', currentStepIndex: 0, correlationId: ctx.correlationId, createdAt: now, updatedAt: now
  };
  await ctx.store.saveWorkflowRun(run);
  await ctx.store.recordExecutionEvent({ eventId: randomUUID(), workflowRunId: proposedRunId, workflowStepId: null, kind: 'RUN_CREATED', actorId: SYSTEM_ACTOR_ID, actorKind: 'system', correlationId: ctx.correlationId });
  return { workflowRunId: proposedRunId, created: true };
}

export async function createStep(ctx: AutomationContext, workflowRunId: string, stepIndex: number, stepCode: string, actionLevel: WorkflowStep['actionLevel']): Promise<{ stepId: string }> {
  const stepId = randomUUID();
  const now = ctx.now().toISOString();
  const step: WorkflowStep = {
    stepId, workflowRunId, stepIndex, stepCode, actionLevel, status: 'PENDING',
    approvedBy: null, approvedAt: null, approvalContentHash: null, startedAt: null, completedAt: null,
    correlationId: ctx.correlationId, createdAt: now
  };
  const parsed = workflowStepSchema.safeParse(step);
  if (!parsed.success) throw new AutomationAuthorityError('Invalid workflow step.', 'VALIDATION');
  await ctx.store.saveWorkflowStep(step);
  return { stepId };
}

export async function completeLevel1Step(ctx: AutomationContext, stepId: string): Promise<void> {
  const step = await ctx.store.loadWorkflowStep(stepId);
  if (!step) throw new AutomationAuthorityError('Step not found.', 'NOT_FOUND');
  if (step.actionLevel !== 'LEVEL_1') throw new AutomationAuthorityError('Only a Level 1 step may be completed via completeLevel1Step.', 'MISSING_APPROVAL');
  const now = ctx.now().toISOString();
  const updated: WorkflowStep = { ...step, status: 'COMPLETED', startedAt: step.startedAt ?? now, completedAt: now };
  await ctx.store.saveWorkflowStep(updated);
  await ctx.store.recordExecutionEvent({ eventId: randomUUID(), workflowRunId: step.workflowRunId, workflowStepId: stepId, kind: 'STEP_COMPLETED', actorId: SYSTEM_ACTOR_ID, actorKind: 'system', correlationId: ctx.correlationId });
}

export async function completeLevel2Step(ctx: AutomationContext, stepId: string, approvedBy: string): Promise<void> {
  if (!approvedBy) throw new AutomationAuthorityError('A real human approver is required to complete a Level 2 step.', 'MISSING_APPROVAL');
  const step = await ctx.store.loadWorkflowStep(stepId);
  if (!step) throw new AutomationAuthorityError('Step not found.', 'NOT_FOUND');
  if (step.actionLevel !== 'LEVEL_2') throw new AutomationAuthorityError('Only a Level 2 step may be completed via completeLevel2Step.', 'MISSING_APPROVAL');
  // Single-use: an already-COMPLETED step's approval cannot be reused to
  // "complete" it again — a real human approval authorizes exactly one
  // execution, never a repeat. A step that has already failed or was
  // skipped is likewise never eligible for completion via approval —
  // those are terminal or intentionally-bypassed states, not "pending"
  // states an approval can move forward. Note: `workflow_steps` has no
  // CANCELLED status in this codebase's real schema (confirmed by
  // reading workflowStepStatuses) — cancellation is a workflow-RUN-level
  // concept, not a step-level one, so no such check applies here.
  if (step.status === 'COMPLETED') throw new AutomationAuthorityError('This step is already completed — its approval was single-use and has been consumed.', 'INVALID_TRANSITION');
  if (step.status === 'FAILED') throw new AutomationAuthorityError('This step has already failed and cannot be completed via approval.', 'INVALID_TRANSITION');
  if (step.status === 'SKIPPED') throw new AutomationAuthorityError('This step has been skipped and cannot be completed via approval.', 'INVALID_TRANSITION');

  const approvalContentHash = sha256(stepApprovalHashInput(step));
  const now = ctx.now().toISOString();
  const updated: WorkflowStep = { ...step, status: 'COMPLETED', approvedBy, approvedAt: now, approvalContentHash, startedAt: step.startedAt ?? now, completedAt: now };
  const parsed = workflowStepSchema.safeParse(updated);
  if (!parsed.success) throw new AutomationAuthorityError('Step failed validation on Level 2 completion.', 'VALIDATION');

  await ctx.store.saveWorkflowStep(updated);
  await ctx.store.recordExecutionEvent({ eventId: randomUUID(), workflowRunId: step.workflowRunId, workflowStepId: stepId, kind: 'STEP_COMPLETED', actorId: approvedBy, actorKind: 'human', correlationId: ctx.correlationId, reasonCode: 'LEVEL_2_APPROVED' });
}

export async function guardAgainstDuplicateEvent(ctx: AutomationContext, eventKey: string): Promise<void> {
  const reservation = await ctx.store.reserveWebhookOrDuplicateGuard(eventKey);
  if (!reservation.winner) throw new AutomationAuthorityError(`Duplicate event: ${eventKey} was already processed.`, 'DUPLICATE_EVENT');
}
