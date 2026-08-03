import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  leaseNextStep, reapExpiredLeases, recordStepFailure, manuallyRetryDeadLetteredStep, checkStepTimeout,
  consumeWorkflowEvent, computeBackoffSeconds, InMemoryWorkflowRuntimeStore, type RuntimeContext, type LeasableStep
} from '@/server/agents/automation/workflow-runtime';
import { InMemoryAutomationStore } from '@/server/agents/automation/automation-store';
import { pauseAgent, activateEmergencyStop } from '@/server/agents/automation/automation-service';
import { AutomationAuthorityError } from '@/server/agents/automation/automation-contract';

const FIXED = new Date('2026-08-01T09:00:00.000Z');

function ctx(): RuntimeContext & { store: InMemoryAutomationStore; runtimeStore: InMemoryWorkflowRuntimeStore } {
  return {
    store: new InMemoryAutomationStore(), runtimeStore: new InMemoryWorkflowRuntimeStore(),
    correlationId: `corr-${randomUUID().slice(0, 8)}`, now: () => FIXED
  };
}

function baseStep(overrides: Partial<LeasableStep> = {}): LeasableStep {
  return {
    stepId: randomUUID(), workflowRunId: randomUUID(), stepIndex: 0, stepCode: 'test.step', actionLevel: 'LEVEL_1',
    status: 'PENDING', leaseOwner: null, leaseExpiresAt: null, attemptCount: 0, maxAttempts: 3, nextRetryAt: null,
    causationId: null, timeoutSeconds: 300,
    ...overrides
  };
}

test('computeBackoffSeconds grows exponentially and is deterministic', () => {
  assert.equal(computeBackoffSeconds(0), 30);
  assert.equal(computeBackoffSeconds(1), 60);
  assert.equal(computeBackoffSeconds(2), 120);
  assert.equal(computeBackoffSeconds(3), 240);
});

test('computeBackoffSeconds is capped at one hour even for very large attempt counts', () => {
  assert.equal(computeBackoffSeconds(20), 3600);
});

test('leasing a step marks it RUNNING with a real owner and a real expiry', async () => {
  const c = ctx();
  c.runtimeStore.seedStep(baseStep());
  const leased = await leaseNextStep(c, 'worker-1', null);
  assert.equal(leased?.status, 'RUNNING');
  assert.equal(leased?.leaseOwner, 'worker-1');
  assert.ok(leased?.leaseExpiresAt);
});

test('leaseNextStep refuses without a real worker owner id', async () => {
  const c = ctx();
  c.runtimeStore.seedStep(baseStep());
  await assert.rejects(
    () => leaseNextStep(c, '', null),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'VALIDATION'
  );
});

test('a step already leased and not yet expired is never returned to a second lease attempt', async () => {
  const c = ctx();
  const step = baseStep();
  c.runtimeStore.seedStep(step);
  const first = await leaseNextStep(c, 'worker-1', null);
  assert.ok(first);
  const second = await leaseNextStep(c, 'worker-2', null);
  assert.equal(second, null);
});

test('an expired lease is reaped back to PENDING and becomes runnable again', async () => {
  const c = ctx();
  const step = baseStep({ status: 'RUNNING', leaseOwner: 'worker-1', leaseExpiresAt: new Date(FIXED.getTime() - 1000).toISOString() });
  c.runtimeStore.seedStep(step);
  const { reapedCount } = await reapExpiredLeases(c);
  assert.equal(reapedCount, 1);
  const reaped = await c.runtimeStore.loadStep(step.stepId);
  assert.equal(reaped?.status, 'PENDING');
  assert.equal(reaped?.leaseOwner, null);
});

test('leaseNextStep refuses when the emergency stop is active', async () => {
  const c = ctx();
  c.runtimeStore.seedStep(baseStep());
  await activateEmergencyStop(c, randomUUID(), 'SAFETY_INCIDENT');
  await assert.rejects(
    () => leaseNextStep(c, 'worker-1', null),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'EMERGENCY_STOP_ACTIVE'
  );
});

test('leaseNextStep refuses for a specific agent while that agent is paused, but not for a different agent', async () => {
  const c = ctx();
  c.runtimeStore.seedStep(baseStep());
  await pauseAgent(c, 'crm-agent', randomUUID(), 'test');
  await assert.rejects(
    () => leaseNextStep(c, 'worker-1', 'crm-agent'),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'AGENT_PAUSED'
  );
  await assert.doesNotReject(() => leaseNextStep(c, 'worker-1', 'voice-agent'));
});

test('a failed step below max attempts is scheduled for retry, not dead-lettered', async () => {
  const c = ctx();
  const step = baseStep({ attemptCount: 0, maxAttempts: 3 });
  c.runtimeStore.seedStep(step);
  const { deadLettered } = await recordStepFailure(c, step.stepId, 'TRANSIENT_ERROR');
  assert.equal(deadLettered, false);
  const updated = await c.runtimeStore.loadStep(step.stepId);
  assert.equal(updated?.status, 'FAILED');
  assert.equal(updated?.attemptCount, 1);
  assert.ok(updated?.nextRetryAt);
});

test('a failed step that reaches max attempts is dead-lettered, not endlessly retried', async () => {
  const c = ctx();
  const step = baseStep({ attemptCount: 2, maxAttempts: 3 });
  c.runtimeStore.seedStep(step);
  const { deadLettered } = await recordStepFailure(c, step.stepId, 'PERSISTENT_ERROR');
  assert.equal(deadLettered, true);
  const updated = await c.runtimeStore.loadStep(step.stepId);
  assert.equal(updated?.attemptCount, 3);
  assert.equal(updated?.nextRetryAt, null);
  const events = c.store.executionEventsFor(step.workflowRunId);
  assert.ok(events.some((e) => e.kind === 'STEP_DEAD_LETTERED'));
});

test('manuallyRetryDeadLetteredStep refuses without a real human actor', async () => {
  const c = ctx();
  const step = baseStep({ status: 'FAILED', attemptCount: 3 });
  c.runtimeStore.seedStep(step);
  await assert.rejects(
    () => manuallyRetryDeadLetteredStep(c, step.stepId, ''),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'VALIDATION'
  );
});

test('manuallyRetryDeadLetteredStep resets attempt count and returns the step to PENDING', async () => {
  const c = ctx();
  const step = baseStep({ status: 'FAILED', attemptCount: 3 });
  c.runtimeStore.seedStep(step);
  const retrier = randomUUID();
  await manuallyRetryDeadLetteredStep(c, step.stepId, retrier);
  const retried = await c.runtimeStore.loadStep(step.stepId);
  assert.equal(retried?.status, 'PENDING');
  assert.equal(retried?.attemptCount, 0);
  const events = c.store.executionEventsFor(step.workflowRunId);
  assert.ok(events.some((e) => e.kind === 'STEP_MANUALLY_RETRIED' && e.actorId === retrier));
});

test('manuallyRetryDeadLetteredStep refuses a step that is not currently FAILED', async () => {
  const c = ctx();
  const step = baseStep({ status: 'COMPLETED' });
  c.runtimeStore.seedStep(step);
  await assert.rejects(
    () => manuallyRetryDeadLetteredStep(c, step.stepId, randomUUID()),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'INVALID_TRANSITION'
  );
});

test('a RUNNING step past its lease expiry is detected as timed out and routed through the retry path', async () => {
  const c = ctx();
  const step = baseStep({ status: 'RUNNING', leaseOwner: 'worker-1', leaseExpiresAt: new Date(FIXED.getTime() - 1000).toISOString() });
  c.runtimeStore.seedStep(step);
  const { timedOut } = await checkStepTimeout(c, step.stepId);
  assert.equal(timedOut, true);
  const updated = await c.runtimeStore.loadStep(step.stepId);
  assert.equal(updated?.status, 'FAILED');
  const events = c.store.executionEventsFor(step.workflowRunId);
  assert.ok(events.some((e) => e.kind === 'STEP_FAILED_WILL_RETRY' && e.reasonCode === 'STEP_TIMEOUT'));
});

test('a RUNNING step still within its lease window is NOT treated as timed out', async () => {
  const c = ctx();
  const step = baseStep({ status: 'RUNNING', leaseOwner: 'worker-1', leaseExpiresAt: new Date(FIXED.getTime() + 60000).toISOString() });
  c.runtimeStore.seedStep(step);
  const { timedOut } = await checkStepTimeout(c, step.stepId);
  assert.equal(timedOut, false);
});

test('a PENDING (not yet leased) step is never reported as timed out', async () => {
  const c = ctx();
  const step = baseStep({ status: 'PENDING' });
  c.runtimeStore.seedStep(step);
  const { timedOut } = await checkStepTimeout(c, step.stepId);
  assert.equal(timedOut, false);
});

test('consumeWorkflowEvent processes a new event key and marks it consumed', async () => {
  const c = ctx();
  const result = await consumeWorkflowEvent(c, { eventKey: `evt-${randomUUID()}`, workflowRunId: null, eventKind: 'TEST_EVENT', payload: {}, causationId: null });
  assert.equal(result.consumed, true);
});

test('consumeWorkflowEvent never processes the same event key twice', async () => {
  const c = ctx();
  const eventKey = `evt-${randomUUID()}`;
  const first = await consumeWorkflowEvent(c, { eventKey, workflowRunId: null, eventKind: 'TEST_EVENT', payload: {}, causationId: null });
  const second = await consumeWorkflowEvent(c, { eventKey, workflowRunId: null, eventKind: 'TEST_EVENT', payload: {}, causationId: null });
  assert.equal(first.consumed, true);
  assert.equal(second.consumed, false);
  assert.equal(first.eventId, second.eventId);
});
