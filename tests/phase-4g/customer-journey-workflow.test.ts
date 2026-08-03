import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  draftCustomerJourneyWorkflowVersion, startCustomerJourneyRun, CUSTOMER_JOURNEY_STAGES, journeyStageActionLevels,
  type CustomerJourneyContext
} from '@/server/agents/automation/customer-journey-workflow';
import { InMemoryAutomationStore } from '@/server/agents/automation/automation-store';
import { approveAndActivateWorkflowVersion, completeLevel2Step, type AutomationContext } from '@/server/agents/automation/automation-service';
import { AutomationAuthorityError } from '@/server/agents/automation/automation-contract';

const FIXED = new Date('2026-08-01T09:00:00.000Z');

function ctx(): CustomerJourneyContext & { store: InMemoryAutomationStore } {
  return { store: new InMemoryAutomationStore(), correlationId: `corr-${randomUUID().slice(0, 8)}`, now: () => FIXED };
}

async function activeJourneyVersion(c: ReturnType<typeof ctx>) {
  const definitionId = randomUUID();
  const { workflowVersionId } = await draftCustomerJourneyWorkflowVersion(c, definitionId);
  const automationCtx: AutomationContext = { store: c.store, correlationId: c.correlationId, now: c.now };
  await approveAndActivateWorkflowVersion(automationCtx, workflowVersionId, randomUUID());
  return workflowVersionId;
}

test('starting a journey creates all 20 stages up front, in canonical order, so current_step_index alone is enough to resume', async () => {
  const c = ctx();
  const workflowVersionId = await activeJourneyVersion(c);
  const conversationId = randomUUID();
  const { workflowRunId } = await startCustomerJourneyRun(c, { workflowVersionId, conversationId, contactId: randomUUID(), corporateAccountId: null }, `idem-${randomUUID()}`);
  const run = await c.store.loadWorkflowRun(workflowRunId);
  assert.equal(run?.currentStepIndex, 0);
  assert.equal(run?.subjectType, 'conversation');
  assert.equal(run?.subjectId, conversationId);
});

test('starting the same journey twice with the same idempotency key never creates a second run', async () => {
  const c = ctx();
  const workflowVersionId = await activeJourneyVersion(c);
  const conversationId = randomUUID();
  const idempotencyKey = `idem-${randomUUID()}`;
  const first = await startCustomerJourneyRun(c, { workflowVersionId, conversationId, contactId: randomUUID(), corporateAccountId: null }, idempotencyKey);
  const second = await startCustomerJourneyRun(c, { workflowVersionId, conversationId, contactId: randomUUID(), corporateAccountId: null }, idempotencyKey);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.workflowRunId, second.workflowRunId);
});

test('a retried startCustomerJourneyRun call does not duplicate the run-creation event', async () => {
  const c = ctx();
  const workflowVersionId = await activeJourneyVersion(c);
  const conversationId = randomUUID();
  const idempotencyKey = `idem-${randomUUID()}`;
  const { workflowRunId } = await startCustomerJourneyRun(c, { workflowVersionId, conversationId, contactId: randomUUID(), corporateAccountId: null }, idempotencyKey);
  await startCustomerJourneyRun(c, { workflowVersionId, conversationId, contactId: randomUUID(), corporateAccountId: null }, idempotencyKey);
  const events = c.store.executionEventsFor(workflowRunId);
  const runCreatedEvents = events.filter((e) => e.kind === 'RUN_CREATED');
  assert.equal(runCreatedEvents.length, 1);
});

test('a Level 2 journey step (PROPOSAL_HUMAN_APPROVAL) cannot complete without a real human approver', async () => {
  const c = ctx();
  const workflowVersionId = await activeJourneyVersion(c);
  const { workflowRunId } = await startCustomerJourneyRun(c, { workflowVersionId, conversationId: randomUUID(), contactId: randomUUID(), corporateAccountId: null }, `idem-${randomUUID()}`);
  const stageIndex = CUSTOMER_JOURNEY_STAGES.indexOf('PROPOSAL_HUMAN_APPROVAL');
  const stepId = c.store.stepIdForRunAndIndex(workflowRunId, stageIndex);
  assert.ok(stepId);
  const automationCtx: AutomationContext = { store: c.store, correlationId: c.correlationId, now: c.now };
  await assert.rejects(
    () => completeLevel2Step(automationCtx, stepId!, ''),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'MISSING_APPROVAL'
  );
});

test('a Level 2 journey step completes correctly with a real human approver', async () => {
  const c = ctx();
  const workflowVersionId = await activeJourneyVersion(c);
  const { workflowRunId } = await startCustomerJourneyRun(c, { workflowVersionId, conversationId: randomUUID(), contactId: randomUUID(), corporateAccountId: null }, `idem-${randomUUID()}`);
  const stageIndex = CUSTOMER_JOURNEY_STAGES.indexOf('HUMAN_BOOKING_CONFIRMATION');
  const stepId = c.store.stepIdForRunAndIndex(workflowRunId, stageIndex);
  const automationCtx: AutomationContext = { store: c.store, correlationId: c.correlationId, now: c.now };
  const approver = randomUUID();
  await completeLevel2Step(automationCtx, stepId!, approver);
  const step = await c.store.loadWorkflowStep(stepId!);
  assert.equal(step?.status, 'COMPLETED');
  assert.equal(step?.approvedBy, approver);
});

test('payment-link creation, payment-link approval, booking confirmation, and proposal delivery stages are all classified LEVEL_2 (human approval required)', () => {
  assert.equal(journeyStageActionLevels.PAYMENT_LINK_CREATION, 'LEVEL_2');
  assert.equal(journeyStageActionLevels.PAYMENT_LINK_APPROVAL, 'LEVEL_2');
  assert.equal(journeyStageActionLevels.HUMAN_BOOKING_CONFIRMATION, 'LEVEL_2');
  assert.equal(journeyStageActionLevels.PROPOSAL_HUMAN_APPROVAL, 'LEVEL_2');
  assert.equal(journeyStageActionLevels.PROPOSAL_DELIVERY, 'LEVEL_2');
});

test('the journey catalog contains no stage for autonomous ticket issuance, cancellation, or refund execution', () => {
  const stageNames = CUSTOMER_JOURNEY_STAGES.join(' ').toLowerCase();
  assert.ok(!/issue.*ticket|void.*ticket|reissue.*ticket|cancel.*booking|execute.*refund|autonomous.*book/i.test(stageNames));
});

test('every stage in the catalog has an explicit action-level classification — none is left undefined', () => {
  for (const stage of CUSTOMER_JOURNEY_STAGES) {
    assert.ok(journeyStageActionLevels[stage], `stage ${stage} must have an action level`);
  }
});

test('read-only journey stages (Level 0) are correctly identified as never requiring human approval to proceed', () => {
  assert.equal(journeyStageActionLevels.INBOUND_ENQUIRY, 'LEVEL_0');
  assert.equal(journeyStageActionLevels.IDENTITY_RESOLUTION, 'LEVEL_0');
  assert.equal(journeyStageActionLevels.LANGUAGE_RESOLUTION, 'LEVEL_0');
  assert.equal(journeyStageActionLevels.CUSTOMER_RESPONSE_TRACKING, 'LEVEL_0');
  assert.equal(journeyStageActionLevels.PAYMENT_RECONCILIATION, 'LEVEL_0');
  assert.equal(journeyStageActionLevels.CONCIERGE_ESCALATION, 'LEVEL_0');
});
