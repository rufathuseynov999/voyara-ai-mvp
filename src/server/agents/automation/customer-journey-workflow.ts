import type { AutomationStore } from './automation-store';
import { draftWorkflowVersion, createWorkflowRun, createStep, type AutomationContext } from './automation-service';
import type { WorkflowActionLevel } from './automation-contract';

/**
 * Phase 4G — the customer-journey workflow catalog.
 *
 * Every stage below is a DEFINITION — a named step in the canonical step
 * graph with its founder-assigned action level — not a live integration.
 * This module never sends a message, creates a payment, confirms a
 * booking, issues a ticket, or executes a cancellation/refund; it defines
 * WHICH stage a real workflow run is in and WHAT authority level that
 * stage requires, reusing the existing CRM/inbox/payment/supplier/booking/
 * subscription services (built in Phases 4A–4F) as the actual actors that
 * will eventually be invoked once a real orchestration worker is wired to
 * this catalog — that wiring is out of scope for this definitional layer.
 *
 * Action-level assignment follows the founder's own AI-agent rules
 * (risk-policy-contract.ts, message-send-policy, Phase 4F "AI agents must
 * not... activate subscriptions without reconciled payment... cancel or
 * refund autonomously"): read/track stages are LEVEL_0, autonomous
 * preparation is LEVEL_1 (must sit under an approved automation policy),
 * anything that commits money, a supplier, or a customer-facing
 * proposal/booking is LEVEL_2 (human approval required), and nothing in
 * this catalog is LEVEL_3 — but the *ticketing/cancellation/refund
 * execution itself* (not preparation) has no stage here at all, exactly
 * mirroring air-ticketing-records.ts's own "AI may prepare and summarize;
 * AI must not issue/void/reissue/cancel" split from Phase 4E.
 */

export type JourneyStageCode =
  | 'INBOUND_ENQUIRY' | 'IDENTITY_RESOLUTION' | 'LANGUAGE_RESOLUTION' | 'LEAD_QUALIFICATION'
  | 'TRAVEL_REQUEST_COLLECTION' | 'MISSING_INFO_FOLLOW_UP' | 'PROPOSAL_PREPARATION' | 'PROPOSAL_HUMAN_APPROVAL'
  | 'PROPOSAL_DELIVERY' | 'CUSTOMER_RESPONSE_TRACKING' | 'PAYMENT_LINK_APPROVAL' | 'PAYMENT_LINK_CREATION'
  | 'PAYMENT_RECONCILIATION' | 'SUPPLIER_TASK_PREPARATION' | 'HUMAN_BOOKING_CONFIRMATION' | 'TRIP_ROOM_ACTIVATION'
  | 'PRE_DEPARTURE_REMINDERS' | 'CONCIERGE_ESCALATION' | 'POST_TRIP_FOLLOW_UP' | 'FEEDBACK_AND_SUBSCRIPTION_RECOMMENDATION';

export const journeyStageActionLevels: Record<JourneyStageCode, WorkflowActionLevel | 'LEVEL_0'> = {
  INBOUND_ENQUIRY: 'LEVEL_0',
  IDENTITY_RESOLUTION: 'LEVEL_0',
  LANGUAGE_RESOLUTION: 'LEVEL_0',
  LEAD_QUALIFICATION: 'LEVEL_1',
  TRAVEL_REQUEST_COLLECTION: 'LEVEL_1',
  MISSING_INFO_FOLLOW_UP: 'LEVEL_1',
  PROPOSAL_PREPARATION: 'LEVEL_1',
  PROPOSAL_HUMAN_APPROVAL: 'LEVEL_2',
  PROPOSAL_DELIVERY: 'LEVEL_2',
  CUSTOMER_RESPONSE_TRACKING: 'LEVEL_0',
  PAYMENT_LINK_APPROVAL: 'LEVEL_2',
  PAYMENT_LINK_CREATION: 'LEVEL_2',
  PAYMENT_RECONCILIATION: 'LEVEL_0',
  SUPPLIER_TASK_PREPARATION: 'LEVEL_1',
  HUMAN_BOOKING_CONFIRMATION: 'LEVEL_2',
  TRIP_ROOM_ACTIVATION: 'LEVEL_1',
  PRE_DEPARTURE_REMINDERS: 'LEVEL_1',
  CONCIERGE_ESCALATION: 'LEVEL_0',
  POST_TRIP_FOLLOW_UP: 'LEVEL_1',
  FEEDBACK_AND_SUBSCRIPTION_RECOMMENDATION: 'LEVEL_1'
};

export const CUSTOMER_JOURNEY_STAGES: JourneyStageCode[] = [
  'INBOUND_ENQUIRY', 'IDENTITY_RESOLUTION', 'LANGUAGE_RESOLUTION', 'LEAD_QUALIFICATION',
  'TRAVEL_REQUEST_COLLECTION', 'MISSING_INFO_FOLLOW_UP', 'PROPOSAL_PREPARATION', 'PROPOSAL_HUMAN_APPROVAL',
  'PROPOSAL_DELIVERY', 'CUSTOMER_RESPONSE_TRACKING', 'PAYMENT_LINK_APPROVAL', 'PAYMENT_LINK_CREATION',
  'PAYMENT_RECONCILIATION', 'SUPPLIER_TASK_PREPARATION', 'HUMAN_BOOKING_CONFIRMATION', 'TRIP_ROOM_ACTIVATION',
  'PRE_DEPARTURE_REMINDERS', 'CONCIERGE_ESCALATION', 'POST_TRIP_FOLLOW_UP', 'FEEDBACK_AND_SUBSCRIPTION_RECOMMENDATION'
];

export const CUSTOMER_JOURNEY_WORKFLOW_CODE = 'customer.journey.v1';

export type CustomerJourneyContext = { store: AutomationStore; correlationId: string; now: () => Date };

export async function draftCustomerJourneyWorkflowVersion(ctx: CustomerJourneyContext, workflowDefinitionId: string): Promise<{ workflowVersionId: string }> {
  const automationCtx: AutomationContext = { store: ctx.store, correlationId: ctx.correlationId, now: ctx.now };
  const stepGraph = { stages: CUSTOMER_JOURNEY_STAGES, actionLevels: journeyStageActionLevels };
  return draftWorkflowVersion(automationCtx, { workflowDefinitionId, version: 1, stepGraph });
}

export async function startCustomerJourneyRun(
  ctx: CustomerJourneyContext,
  input: { workflowVersionId: string; conversationId: string; contactId: string | null; corporateAccountId: string | null },
  idempotencyKey: string
): Promise<{ workflowRunId: string; created: boolean }> {
  const automationCtx: AutomationContext = { store: ctx.store, correlationId: ctx.correlationId, now: ctx.now };
  const { workflowRunId, created } = await createWorkflowRun(
    automationCtx,
    { workflowVersionId: input.workflowVersionId, subjectType: 'conversation', subjectId: input.conversationId, agentCode: 'customer-journey-agent' },
    idempotencyKey
  );

  if (created) {
    for (let i = 0; i < CUSTOMER_JOURNEY_STAGES.length; i++) {
      const stageCode = CUSTOMER_JOURNEY_STAGES[i];
      const level = journeyStageActionLevels[stageCode];
      const dbLevel: WorkflowActionLevel = level === 'LEVEL_0' ? 'LEVEL_1' : level;
      const stepCode = level === 'LEVEL_0' ? `readonly.${stageCode}` : stageCode;
      await createStep(automationCtx, workflowRunId, i, stepCode, dbLevel);
    }
  }

  return { workflowRunId, created };
}
