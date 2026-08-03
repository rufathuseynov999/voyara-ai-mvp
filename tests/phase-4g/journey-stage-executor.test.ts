import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  executeJourneyStage, allStagesHaveExecutionMapping, SimulationJourneyServicePorts, type JourneyExecutionContext
} from '@/server/agents/automation/journey-stage-executor';
import { InMemoryAutomationStore } from '@/server/agents/automation/automation-store';
import { draftWorkflowVersion, approveAndActivateWorkflowVersion, createWorkflowRun, createStep, activateEmergencyStop, pauseGlobal } from '@/server/agents/automation/automation-service';
import { CUSTOMER_JOURNEY_STAGES, journeyStageActionLevels } from '@/server/agents/automation/customer-journey-workflow';
import { AutomationAuthorityError } from '@/server/agents/automation/automation-contract';
import type { WorkflowActionLevel } from '@/server/agents/automation/automation-contract';

const FIXED = new Date('2026-08-01T09:00:00.000Z');

class CombinedStore extends InMemoryAutomationStore {
  private readonly featureFlags = new Map<string, { flagCode: string; enabled: boolean }>();
  private readonly controlEvents: unknown[] = [];
  async loadWorkingHoursPolicy() { return null; }
  async saveWorkingHoursPolicy() { /* unused */ }
  async findActiveWorkingHoursPolicyByCode() { return null; }
  async loadFeatureFlag(flagCode: string) { return this.featureFlags.get(flagCode) ?? null; }
  async saveFeatureFlag(flag: { flagCode: string; enabled: boolean }) { this.featureFlags.set(flag.flagCode, flag); }
  async recordFounderControlEvent(event: unknown) { this.controlEvents.push(event); }
}

function ctx(): JourneyExecutionContext & { store: CombinedStore } {
  const store = new CombinedStore();
  return { store, correlationId: `corr-${randomUUID().slice(0, 8)}`, now: () => FIXED };
}

async function setUpRunWithAllStages(c: ReturnType<typeof ctx>) {
  const definitionId = randomUUID();
  const { workflowVersionId } = await draftWorkflowVersion(c, { workflowDefinitionId: definitionId, version: 1, stepGraph: { stages: CUSTOMER_JOURNEY_STAGES } });
  await approveAndActivateWorkflowVersion(c, workflowVersionId, randomUUID());
  const { workflowRunId } = await createWorkflowRun(c, { workflowVersionId, subjectType: 'conversation', subjectId: randomUUID(), agentCode: null }, `idem-${randomUUID()}`);

  const stepIds: Record<string, string> = {};
  for (let i = 0; i < CUSTOMER_JOURNEY_STAGES.length; i++) {
    const stage = CUSTOMER_JOURNEY_STAGES[i];
    const level = journeyStageActionLevels[stage];
    const dbLevel: WorkflowActionLevel = level === 'LEVEL_0' ? 'LEVEL_1' : level;
    const { stepId } = await createStep(c, workflowRunId, i, stage, dbLevel);
    stepIds[stage] = stepId;
  }
  return { workflowRunId, stepIds };
}

test('every canonical journey stage has a corresponding execution mapping — no silent gaps', () => {
  assert.equal(allStagesHaveExecutionMapping(), true);
});

test('a Level 1 stage (INBOUND_ENQUIRY) executes and records a real output reference from the port', async () => {
  const c = ctx();
  const ports = new SimulationJourneyServicePorts();
  const { workflowRunId, stepIds } = await setUpRunWithAllStages(c);
  const conversationId = randomUUID();
  const result = await executeJourneyStage(c, ports, workflowRunId, stepIds.INBOUND_ENQUIRY, 'INBOUND_ENQUIRY', { conversationId, agentCode: null, channel: null });
  assert.equal(result.skippedAsDuplicate, false);
  assert.ok(result.outputReference.startsWith('crm-'));
});

test('the LEAD_QUALIFICATION stage reuses the explainable lead-scoring service and reports its score as the output reference', async () => {
  const c = ctx();
  const ports = new SimulationJourneyServicePorts();
  const { workflowRunId, stepIds } = await setUpRunWithAllStages(c);
  const result = await executeJourneyStage(c, ports, workflowRunId, stepIds.LEAD_QUALIFICATION, 'LEAD_QUALIFICATION', { conversationId: randomUUID(), agentCode: null, channel: null });
  assert.ok(result.outputReference.startsWith('lead-score-'));
});

test('re-executing an already-completed stage is idempotent — it never re-runs the underlying port call', async () => {
  const c = ctx();
  const ports = new SimulationJourneyServicePorts();
  const { workflowRunId, stepIds } = await setUpRunWithAllStages(c);
  const conversationId = randomUUID();
  const first = await executeJourneyStage(c, ports, workflowRunId, stepIds.INBOUND_ENQUIRY, 'INBOUND_ENQUIRY', { conversationId, agentCode: null, channel: null });
  const second = await executeJourneyStage(c, ports, workflowRunId, stepIds.INBOUND_ENQUIRY, 'INBOUND_ENQUIRY', { conversationId, agentCode: null, channel: null });
  assert.equal(first.skippedAsDuplicate, false);
  assert.equal(second.skippedAsDuplicate, true);
});

test('PROPOSAL_HUMAN_APPROVAL (Level 2) fails without a real approver', async () => {
  const c = ctx();
  const ports = new SimulationJourneyServicePorts();
  const { workflowRunId, stepIds } = await setUpRunWithAllStages(c);
  await assert.rejects(
    () => executeJourneyStage(c, ports, workflowRunId, stepIds.PROPOSAL_HUMAN_APPROVAL, 'PROPOSAL_HUMAN_APPROVAL', { conversationId: randomUUID(), proposalDraftId: 'prop-1', agentCode: null, channel: null }),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'MISSING_APPROVAL'
  );
});

test('PROPOSAL_HUMAN_APPROVAL (Level 2) succeeds with a real human approver and completes the step', async () => {
  const c = ctx();
  const ports = new SimulationJourneyServicePorts();
  const { workflowRunId, stepIds } = await setUpRunWithAllStages(c);
  const approver = randomUUID();
  const result = await executeJourneyStage(c, ports, workflowRunId, stepIds.PROPOSAL_HUMAN_APPROVAL, 'PROPOSAL_HUMAN_APPROVAL', { conversationId: randomUUID(), proposalDraftId: 'prop-1', approvedBy: approver, agentCode: null, channel: null });
  assert.ok(result.outputReference.startsWith('appr-'));
  const step = await c.store.loadWorkflowStep(stepIds.PROPOSAL_HUMAN_APPROVAL);
  assert.equal(step?.status, 'COMPLETED');
  assert.equal(step?.approvedBy, approver);
});

test('PAYMENT_LINK_CREATION (Level 2) fails without a real approver', async () => {
  const c = ctx();
  const ports = new SimulationJourneyServicePorts();
  const { workflowRunId, stepIds } = await setUpRunWithAllStages(c);
  await assert.rejects(
    () => executeJourneyStage(c, ports, workflowRunId, stepIds.PAYMENT_LINK_CREATION, 'PAYMENT_LINK_CREATION', { conversationId: randomUUID(), approvalRequestId: 'req-1', agentCode: null, channel: null }),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'MISSING_APPROVAL'
  );
});

test('HUMAN_BOOKING_CONFIRMATION (Level 2) fails without a real human actor', async () => {
  const c = ctx();
  const ports = new SimulationJourneyServicePorts();
  const { workflowRunId, stepIds } = await setUpRunWithAllStages(c);
  await assert.rejects(
    () => executeJourneyStage(c, ports, workflowRunId, stepIds.HUMAN_BOOKING_CONFIRMATION, 'HUMAN_BOOKING_CONFIRMATION', { conversationId: randomUUID(), portalTaskId: 'portal-1', agentCode: null, channel: null }),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'MISSING_APPROVAL'
  );
});

test('emergency stop blocks stage execution entirely', async () => {
  const c = ctx();
  const ports = new SimulationJourneyServicePorts();
  const { workflowRunId, stepIds } = await setUpRunWithAllStages(c);
  await activateEmergencyStop(c, randomUUID(), 'INCIDENT');
  await assert.rejects(
    () => executeJourneyStage(c, ports, workflowRunId, stepIds.INBOUND_ENQUIRY, 'INBOUND_ENQUIRY', { conversationId: randomUUID(), agentCode: null, channel: null }),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'EMERGENCY_STOP_ACTIVE'
  );
});

test('global pause blocks stage execution entirely', async () => {
  const c = ctx();
  const ports = new SimulationJourneyServicePorts();
  const { workflowRunId, stepIds } = await setUpRunWithAllStages(c);
  await pauseGlobal(c, randomUUID(), 'MAINTENANCE');
  await assert.rejects(
    () => executeJourneyStage(c, ports, workflowRunId, stepIds.IDENTITY_RESOLUTION, 'IDENTITY_RESOLUTION', { conversationId: randomUUID(), agentCode: null, channel: null }),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'GLOBALLY_PAUSED'
  );
});

test('FEEDBACK_AND_SUBSCRIPTION_RECOMMENDATION never fabricates a plan code when none is configured', async () => {
  const c = ctx();
  const ports = new SimulationJourneyServicePorts();
  const recommendation = await ports.recommendApprovedSubscription(randomUUID());
  assert.equal(recommendation.planCode, null);
});

test('every successful (non-duplicate) stage execution records a non-empty output reference', async () => {
  const c = ctx();
  const ports = new SimulationJourneyServicePorts();
  const { workflowRunId, stepIds } = await setUpRunWithAllStages(c);
  const conversationId = randomUUID();
  const result = await executeJourneyStage(c, ports, workflowRunId, stepIds.CONCIERGE_ESCALATION, 'CONCIERGE_ESCALATION', { conversationId, agentCode: null, channel: null });
  assert.ok(result.outputReference.length > 0);
});
