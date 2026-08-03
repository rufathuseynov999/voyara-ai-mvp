import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  activateEmergencyStop, deactivateEmergencyStop, pauseGlobal, resumeGlobal, pauseAgent, resumeAgent,
  checkAutomationGate, draftWorkflowVersion, approveAndActivateWorkflowVersion, requireActiveWorkflowVersion,
  createWorkflowRun, createStep, completeLevel1Step, completeLevel2Step, guardAgainstDuplicateEvent,
  type AutomationContext
} from '@/server/agents/automation/automation-service';
import { InMemoryAutomationStore } from '@/server/agents/automation/automation-store';
import { AutomationAuthorityError } from '@/server/agents/automation/automation-contract';

const FIXED = new Date('2026-08-01T09:00:00.000Z');

function ctx(): AutomationContext & { store: InMemoryAutomationStore } {
  return { store: new InMemoryAutomationStore(), correlationId: `corr-${randomUUID().slice(0, 8)}`, now: () => FIXED };
}

async function activeWorkflowVersion(c: ReturnType<typeof ctx>) {
  const { workflowVersionId } = await draftWorkflowVersion(c, { workflowDefinitionId: randomUUID(), version: 1, stepGraph: { steps: ['a', 'b'] } });
  await approveAndActivateWorkflowVersion(c, workflowVersionId, randomUUID());
  return workflowVersionId;
}

test('emergency stop requires a real human actor to activate', async () => {
  const c = ctx();
  await assert.rejects(
    () => activateEmergencyStop(c, '', 'test'),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'VALIDATION'
  );
});

test('once emergency stop is active, the automation gate refuses everything regardless of pause state', async () => {
  const c = ctx();
  await activateEmergencyStop(c, randomUUID(), 'SAFETY_INCIDENT');
  await assert.rejects(
    () => checkAutomationGate(c, null),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'EMERGENCY_STOP_ACTIVE'
  );
  await assert.rejects(
    () => checkAutomationGate(c, 'any-agent'),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'EMERGENCY_STOP_ACTIVE'
  );
});

test('deactivating the emergency stop restores normal gate behavior', async () => {
  const c = ctx();
  const actor = randomUUID();
  await activateEmergencyStop(c, actor, 'test');
  await deactivateEmergencyStop(c, actor, 'resolved');
  await assert.doesNotReject(() => checkAutomationGate(c, null));
});

test('a workflow run cannot be created while the emergency stop is active', async () => {
  const c = ctx();
  const workflowVersionId = await activeWorkflowVersion(c);
  await activateEmergencyStop(c, randomUUID(), 'SAFETY_INCIDENT');
  await assert.rejects(
    () => createWorkflowRun(c, { workflowVersionId, subjectType: 'test', subjectId: null, agentCode: null }, `idem-${randomUUID()}`),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'EMERGENCY_STOP_ACTIVE'
  );
});

test('global pause requires a real human actor', async () => {
  const c = ctx();
  await assert.rejects(
    () => pauseGlobal(c, '', 'test'),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'VALIDATION'
  );
});

test('once globally paused, the automation gate refuses every agent, even unlisted ones', async () => {
  const c = ctx();
  await pauseGlobal(c, randomUUID(), 'MAINTENANCE_WINDOW');
  await assert.rejects(
    () => checkAutomationGate(c, 'crm-agent'),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'GLOBALLY_PAUSED'
  );
  await assert.rejects(
    () => checkAutomationGate(c, null),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'GLOBALLY_PAUSED'
  );
});

test('resuming global automation restores normal gate behavior', async () => {
  const c = ctx();
  const actor = randomUUID();
  await pauseGlobal(c, actor, 'test');
  await resumeGlobal(c, actor);
  await assert.doesNotReject(() => checkAutomationGate(c, null));
});

test('pausing one specific agent does not affect a different agent', async () => {
  const c = ctx();
  await pauseAgent(c, 'crm-agent', randomUUID(), 'INVESTIGATING_DEFECT');
  await assert.rejects(
    () => checkAutomationGate(c, 'crm-agent'),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'AGENT_PAUSED'
  );
  await assert.doesNotReject(() => checkAutomationGate(c, 'voice-agent'));
});

test('resuming a specific agent restores its own gate behavior without affecting others', async () => {
  const c = ctx();
  const actor = randomUUID();
  await pauseAgent(c, 'crm-agent', actor, 'test');
  await resumeAgent(c, 'crm-agent', actor);
  await assert.doesNotReject(() => checkAutomationGate(c, 'crm-agent'));
});

test('a workflow version requires a real approver, timestamp, and content hash to become ACTIVE', async () => {
  const c = ctx();
  const { workflowVersionId } = await draftWorkflowVersion(c, { workflowDefinitionId: randomUUID(), version: 1, stepGraph: {} });
  const approver = randomUUID();
  await approveAndActivateWorkflowVersion(c, workflowVersionId, approver);
  const version = await c.store.loadWorkflowVersion(workflowVersionId);
  assert.equal(version?.status, 'ACTIVE');
  assert.equal(version?.approvedBy, approver);
  assert.ok(version?.contentHash);
});

test('a DRAFT workflow version cannot authorize a workflow run', async () => {
  const c = ctx();
  const { workflowVersionId } = await draftWorkflowVersion(c, { workflowDefinitionId: randomUUID(), version: 1, stepGraph: {} });
  await assert.rejects(
    () => requireActiveWorkflowVersion(c, workflowVersionId),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'NOT_ACTIVE'
  );
});

test('a retried createWorkflowRun with the same idempotency key returns the original run, never creates a duplicate', async () => {
  const c = ctx();
  const workflowVersionId = await activeWorkflowVersion(c);
  const idempotencyKey = `idem-${randomUUID()}`;
  const first = await createWorkflowRun(c, { workflowVersionId, subjectType: 'test', subjectId: null, agentCode: null }, idempotencyKey);
  const second = await createWorkflowRun(c, { workflowVersionId, subjectType: 'test', subjectId: null, agentCode: null }, idempotencyKey);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.workflowRunId, second.workflowRunId);
});

test('a duplicate event key is rejected outright, never processed twice', async () => {
  const c = ctx();
  const key = `evt-${randomUUID()}`;
  await guardAgainstDuplicateEvent(c, key);
  await assert.rejects(
    () => guardAgainstDuplicateEvent(c, key),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'DUPLICATE_EVENT'
  );
});

test('a Level 2 step cannot be completed via completeLevel1Step', async () => {
  const c = ctx();
  const workflowVersionId = await activeWorkflowVersion(c);
  const { workflowRunId } = await createWorkflowRun(c, { workflowVersionId, subjectType: 'test', subjectId: null, agentCode: null }, `idem-${randomUUID()}`);
  const { stepId } = await createStep(c, workflowRunId, 0, 'sensitive.action', 'LEVEL_2');
  await assert.rejects(
    () => completeLevel1Step(c, stepId),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'MISSING_APPROVAL'
  );
});

test('completeLevel2Step refuses without a real human approver', async () => {
  const c = ctx();
  const workflowVersionId = await activeWorkflowVersion(c);
  const { workflowRunId } = await createWorkflowRun(c, { workflowVersionId, subjectType: 'test', subjectId: null, agentCode: null }, `idem-${randomUUID()}`);
  const { stepId } = await createStep(c, workflowRunId, 0, 'sensitive.action', 'LEVEL_2');
  await assert.rejects(
    () => completeLevel2Step(c, stepId, ''),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'MISSING_APPROVAL'
  );
});

test('completeLevel2Step with a real human approver succeeds and records the approval', async () => {
  const c = ctx();
  const workflowVersionId = await activeWorkflowVersion(c);
  const { workflowRunId } = await createWorkflowRun(c, { workflowVersionId, subjectType: 'test', subjectId: null, agentCode: null }, `idem-${randomUUID()}`);
  const { stepId } = await createStep(c, workflowRunId, 0, 'sensitive.action', 'LEVEL_2');
  const approver = randomUUID();
  await completeLevel2Step(c, stepId, approver);
  const step = await c.store.loadWorkflowStep(stepId);
  assert.equal(step?.status, 'COMPLETED');
  assert.equal(step?.approvedBy, approver);
  assert.ok(step?.approvalContentHash);
});

test('Level 1 and Level 2 completion functions both refuse to complete a Level 3 step', async () => {
  const c = ctx();
  const workflowVersionId = await activeWorkflowVersion(c);
  const { workflowRunId } = await createWorkflowRun(c, { workflowVersionId, subjectType: 'test', subjectId: null, agentCode: null }, `idem-${randomUUID()}`);
  const { stepId } = await createStep(c, workflowRunId, 0, 'forbidden.action', 'LEVEL_3');
  await assert.rejects(() => completeLevel1Step(c, stepId));
  await assert.rejects(() => completeLevel2Step(c, stepId, randomUUID()));
  const step = await c.store.loadWorkflowStep(stepId);
  assert.equal(step?.status, 'PENDING');
});

test('no function anywhere in automation-service.ts is named or shaped to complete a Level 3 step', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/automation/automation-service.ts', import.meta.url), 'utf8');
  const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/completeLevel3|executeLevel3|runLevel3/i.test(codeOnly));
});

test('every workflow-run and step transition is recorded as an append-only execution event', async () => {
  const c = ctx();
  const workflowVersionId = await activeWorkflowVersion(c);
  const { workflowRunId } = await createWorkflowRun(c, { workflowVersionId, subjectType: 'test', subjectId: null, agentCode: null }, `idem-${randomUUID()}`);
  const { stepId } = await createStep(c, workflowRunId, 0, 'auto.action', 'LEVEL_1');
  await completeLevel1Step(c, stepId);
  const events = c.store.executionEventsFor(workflowRunId);
  assert.ok(events.some((e) => e.kind === 'RUN_CREATED'));
  assert.ok(events.some((e) => e.kind === 'STEP_COMPLETED'));
});
