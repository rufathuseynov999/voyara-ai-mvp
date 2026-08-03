import { randomUUID } from 'node:crypto';
import { AutomationAuthorityError } from './automation-contract';
import { checkAutomationGate, type AutomationContext } from './automation-service';

/**
 * Phase 4G Part 2 — durable workflow runtime.
 *
 * "Durable" here means every piece of state a running workflow depends on
 * — which worker currently owns a step, when that ownership expires, how
 * many times a step has been attempted, when it should be retried next —
 * lives in the database (Migration 24), never in an in-process variable or
 * timer. A worker process can crash or restart at any point and the
 * runtime recovers correctly: an expired lease simply becomes eligible for
 * another worker to claim.
 *
 * Every function in this file that would do real work first calls
 * `checkAutomationGate` — there is no execution path here that bypasses
 * emergency stop, global pause, or per-agent pause.
 */

export type LeasableStep = {
  stepId: string;
  workflowRunId: string;
  stepIndex: number;
  stepCode: string;
  actionLevel: 'LEVEL_1' | 'LEVEL_2' | 'LEVEL_3';
  status: 'PENDING' | 'RUNNING' | 'AWAITING_APPROVAL' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  attemptCount: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  causationId: string | null;
  timeoutSeconds: number;
};

export interface WorkflowRuntimeStore {
  loadRunnableSteps(now: Date, limit: number): Promise<LeasableStep[]>;
  loadStep(stepId: string): Promise<LeasableStep | null>;
  saveStep(step: LeasableStep): Promise<void>;
  loadExpiredLeases(now: Date): Promise<LeasableStep[]>;
  reserveInboxEvent(eventKey: string, workflowRunId: string | null, eventKind: string, payload: Record<string, unknown>, causationId: string | null): Promise<{ winner: boolean; eventId: string }>;
  markInboxEventProcessed(eventKey: string, processedAt: string): Promise<void>;
}

export class InMemoryWorkflowRuntimeStore implements WorkflowRuntimeStore {
  private readonly steps = new Map<string, LeasableStep>();
  private readonly inboxEvents = new Map<string, { eventId: string; processed: boolean }>();

  seedStep(step: LeasableStep): void { this.steps.set(step.stepId, step); }

  async loadRunnableSteps(now: Date, limit: number): Promise<LeasableStep[]> {
    const runnable: LeasableStep[] = [];
    for (const step of this.steps.values()) {
      const leaseExpired = step.leaseExpiresAt === null || new Date(step.leaseExpiresAt).getTime() < now.getTime();
      const retryDue = step.nextRetryAt === null || new Date(step.nextRetryAt).getTime() <= now.getTime();
      if (step.status === 'PENDING' && leaseExpired) runnable.push(step);
      else if (step.status === 'FAILED' && step.attemptCount < step.maxAttempts && retryDue && leaseExpired) runnable.push(step);
      if (runnable.length >= limit) break;
    }
    return runnable;
  }
  async loadStep(stepId: string): Promise<LeasableStep | null> { return this.steps.get(stepId) ?? null; }
  async saveStep(step: LeasableStep): Promise<void> { this.steps.set(step.stepId, step); }
  async loadExpiredLeases(now: Date): Promise<LeasableStep[]> {
    return [...this.steps.values()].filter((s) => s.leaseOwner !== null && s.leaseExpiresAt !== null && new Date(s.leaseExpiresAt).getTime() < now.getTime());
  }
  async reserveInboxEvent(eventKey: string, _workflowRunId: string | null, _eventKind: string, _payload: Record<string, unknown>, _causationId: string | null): Promise<{ winner: boolean; eventId: string }> {
    const existing = this.inboxEvents.get(eventKey);
    if (existing) return { winner: false, eventId: existing.eventId };
    const eventId = randomUUID();
    this.inboxEvents.set(eventKey, { eventId, processed: false });
    return { winner: true, eventId };
  }
  async markInboxEventProcessed(eventKey: string): Promise<void> {
    const existing = this.inboxEvents.get(eventKey);
    if (existing) this.inboxEvents.set(eventKey, { ...existing, processed: true });
  }
}

export type RuntimeContext = AutomationContext & { runtimeStore: WorkflowRuntimeStore };

const DEFAULT_LEASE_SECONDS = 90;

export function computeBackoffSeconds(attemptCount: number, baseSeconds = 30): number {
  const capped = Math.min(attemptCount, 10);
  return Math.min(baseSeconds * 2 ** capped, 3600);
}

export async function leaseNextStep(ctx: RuntimeContext, workerOwnerId: string, agentCode: string | null): Promise<LeasableStep | null> {
  if (!workerOwnerId) throw new AutomationAuthorityError('A real worker owner id is required to lease a step.', 'VALIDATION');
  await checkAutomationGate(ctx, agentCode);

  const candidates = await ctx.runtimeStore.loadRunnableSteps(ctx.now(), 1);
  if (candidates.length === 0) return null;
  const candidate = candidates[0];

  const leaseExpiresAt = new Date(ctx.now().getTime() + DEFAULT_LEASE_SECONDS * 1000).toISOString();
  const leased: LeasableStep = { ...candidate, status: 'RUNNING', leaseOwner: workerOwnerId, leaseExpiresAt };
  await ctx.runtimeStore.saveStep(leased);
  await ctx.store.recordExecutionEvent({
    eventId: randomUUID(), workflowRunId: leased.workflowRunId, workflowStepId: leased.stepId,
    kind: 'STEP_LEASED', actorId: workerOwnerId, actorKind: 'system', correlationId: ctx.correlationId
  });
  return leased;
}

export async function reapExpiredLeases(ctx: RuntimeContext): Promise<{ reapedCount: number }> {
  const expired = await ctx.runtimeStore.loadExpiredLeases(ctx.now());
  for (const step of expired) {
    const released: LeasableStep = { ...step, status: 'PENDING', leaseOwner: null, leaseExpiresAt: null };
    await ctx.runtimeStore.saveStep(released);
    await ctx.store.recordExecutionEvent({
      eventId: randomUUID(), workflowRunId: step.workflowRunId, workflowStepId: step.stepId,
      kind: 'LEASE_EXPIRED_RELEASED', actorId: 'system', actorKind: 'system', correlationId: ctx.correlationId
    });
  }
  return { reapedCount: expired.length };
}

export async function recordStepFailure(ctx: RuntimeContext, stepId: string, reasonCode: string): Promise<{ deadLettered: boolean }> {
  const step = await ctx.runtimeStore.loadStep(stepId);
  if (!step) throw new AutomationAuthorityError('Step not found.', 'NOT_FOUND');

  const newAttemptCount = step.attemptCount + 1;
  if (newAttemptCount >= step.maxAttempts) {
    const deadLettered: LeasableStep = { ...step, status: 'FAILED', leaseOwner: null, leaseExpiresAt: null, attemptCount: newAttemptCount, nextRetryAt: null };
    await ctx.runtimeStore.saveStep(deadLettered);
    await ctx.store.recordExecutionEvent({
      eventId: randomUUID(), workflowRunId: step.workflowRunId, workflowStepId: stepId,
      kind: 'STEP_DEAD_LETTERED', actorId: 'system', actorKind: 'system', correlationId: ctx.correlationId, reasonCode
    });
    return { deadLettered: true };
  }

  const backoffSeconds = computeBackoffSeconds(newAttemptCount);
  const nextRetryAt = new Date(ctx.now().getTime() + backoffSeconds * 1000).toISOString();
  const retryable: LeasableStep = { ...step, status: 'FAILED', leaseOwner: null, leaseExpiresAt: null, attemptCount: newAttemptCount, nextRetryAt };
  await ctx.runtimeStore.saveStep(retryable);
  await ctx.store.recordExecutionEvent({
    eventId: randomUUID(), workflowRunId: step.workflowRunId, workflowStepId: stepId,
    kind: 'STEP_FAILED_WILL_RETRY', actorId: 'system', actorKind: 'system', correlationId: ctx.correlationId, reasonCode
  });
  return { deadLettered: false };
}

export async function manuallyRetryDeadLetteredStep(ctx: RuntimeContext, stepId: string, retriedBy: string): Promise<void> {
  if (!retriedBy) throw new AutomationAuthorityError('A real human actor is required to manually retry a dead-lettered step.', 'VALIDATION');
  const step = await ctx.runtimeStore.loadStep(stepId);
  if (!step) throw new AutomationAuthorityError('Step not found.', 'NOT_FOUND');
  if (step.status !== 'FAILED') throw new AutomationAuthorityError('Only a FAILED step may be manually retried.', 'INVALID_TRANSITION');

  const reset: LeasableStep = { ...step, status: 'PENDING', attemptCount: 0, nextRetryAt: null, leaseOwner: null, leaseExpiresAt: null };
  await ctx.runtimeStore.saveStep(reset);
  await ctx.store.recordExecutionEvent({
    eventId: randomUUID(), workflowRunId: step.workflowRunId, workflowStepId: stepId,
    kind: 'STEP_MANUALLY_RETRIED', actorId: retriedBy, actorKind: 'human', correlationId: ctx.correlationId
  });
}

export async function checkStepTimeout(ctx: RuntimeContext, stepId: string): Promise<{ timedOut: boolean }> {
  const step = await ctx.runtimeStore.loadStep(stepId);
  if (!step) throw new AutomationAuthorityError('Step not found.', 'NOT_FOUND');
  if (step.status !== 'RUNNING' || !step.leaseExpiresAt) return { timedOut: false };
  if (new Date(step.leaseExpiresAt).getTime() >= ctx.now().getTime()) return { timedOut: false };

  await recordStepFailure(ctx, stepId, 'STEP_TIMEOUT');
  return { timedOut: true };
}

export async function consumeWorkflowEvent(
  ctx: RuntimeContext,
  input: { eventKey: string; workflowRunId: string | null; eventKind: string; payload: Record<string, unknown>; causationId: string | null }
): Promise<{ consumed: boolean; eventId: string }> {
  const reservation = await ctx.runtimeStore.reserveInboxEvent(input.eventKey, input.workflowRunId, input.eventKind, input.payload, input.causationId);
  if (!reservation.winner) return { consumed: false, eventId: reservation.eventId };
  await ctx.runtimeStore.markInboxEventProcessed(input.eventKey, ctx.now().toISOString());
  return { consumed: true, eventId: reservation.eventId };
}
