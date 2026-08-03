import { randomUUID } from 'node:crypto';
import { AutomationAuthorityError } from './automation-contract';
import { checkAutomationGateExtended, type FounderControlContext } from './founder-controls';
import { completeLevel1Step, completeLevel2Step, type AutomationContext } from './automation-service';
import { scoreLeadExplainably, type LeadScoringInput } from './lead-scoring';
import { CUSTOMER_JOURNEY_STAGES, type JourneyStageCode } from './customer-journey-workflow';
import type { MaterialCommercialFields } from '@/server/supplier/contract';

/**
 * Phase 4G — customer-journey stage executor.
 *
 * `JourneyServicePorts` is the seam between this orchestration layer and
 * the real internal services built in Phases 4A–4F (CRM/inbox, proposal,
 * payment-link, portal-task, booking, subscription). Each port method
 * corresponds to exactly one named stage's own real service — this file
 * never re-implements CRM, proposal, payment, or booking logic itself; it
 * only sequences calls to those services under the automation gate and
 * records what each call returned as the stage's authoritative output
 * reference. `SimulationJourneyServicePorts` is a fixture-only
 * implementation for testing this orchestration layer without a live
 * database — a real deployment would supply an implementation whose
 * methods call the actual Phase 4A–4F services directly.
 *
 * No port method here sends a live message, creates a real payment,
 * confirms a real booking, issues a ticket, or executes a cancellation/
 * refund — every "commit" method is named to reflect that it PREPARES or
 * RECORDS a human-confirmed action, never performs one autonomously.
 */

export interface JourneyServicePorts {
  recordInboundEnquiry(conversationId: string): Promise<{ crmRecordId: string }>;
  resolveIdentity(conversationId: string): Promise<{ contactId: string }>;
  resolveLanguage(conversationId: string): Promise<{ locale: string }>;
  recordTravelRequest(contactId: string, details: Record<string, unknown>): Promise<{ requestId: string }>;
  prepareOutboundDraft(contactId: string, purpose: string): Promise<{ draftMessageId: string }>;
  prepareProposal(contactId: string, requestId: string, proposalType: 'HOTEL' | 'OTHER', material: MaterialCommercialFields | null): Promise<{ proposalDraftId: string }>;
  recordProposalApproval(proposalDraftId: string, approvedBy: string): Promise<{ approvalId: string }>;
  deliverApprovedProposal(proposalDraftId: string, approvalId: string): Promise<{ deliveryId: string }>;
  trackCustomerResponse(conversationId: string): Promise<{ responseRecordId: string }>;
  preparePaymentLinkApproval(proposalDraftId: string): Promise<{ approvalRequestId: string }>;
  createApprovedPaymentLink(approvalRequestId: string, approvedBy: string): Promise<{ paymentLinkId: string }>;
  reconcilePayment(paymentLinkId: string): Promise<{ reconciliationId: string }>;
  prepareSupplierTask(requestId: string): Promise<{ portalTaskId: string }>;
  recordHumanBookingConfirmation(portalTaskId: string, confirmedBy: string): Promise<{ bookingId: string }>;
  activateTripRoom(bookingId: string, portalTaskId?: string): Promise<{ tripRoomId: string }>;
  scheduleReminder(tripRoomId: string, kind: string): Promise<{ scheduledActionId: string }>;
  escalateToConcierge(conversationId: string, reason: string): Promise<{ escalationId: string }>;
  recommendApprovedSubscription(contactId: string): Promise<{ recommendationId: string; planCode: string | null }>;
}

export class SimulationJourneyServicePorts implements JourneyServicePorts {
  async recordInboundEnquiry(): Promise<{ crmRecordId: string }> { return { crmRecordId: `crm-${randomUUID()}` }; }
  async resolveIdentity(): Promise<{ contactId: string }> { return { contactId: randomUUID() }; }
  async resolveLanguage(): Promise<{ locale: string }> { return { locale: 'az' }; }
  async recordTravelRequest(): Promise<{ requestId: string }> { return { requestId: `req-${randomUUID()}` }; }
  async prepareOutboundDraft(): Promise<{ draftMessageId: string }> { return { draftMessageId: `draft-${randomUUID()}` }; }
  async prepareProposal(): Promise<{ proposalDraftId: string }> { return { proposalDraftId: `prop-${randomUUID()}` }; }
  async recordProposalApproval(_proposalDraftId: string, approvedBy: string): Promise<{ approvalId: string }> {
    if (!approvedBy) throw new AutomationAuthorityError('A real human approver is required to approve a proposal.', 'MISSING_APPROVAL');
    return { approvalId: `appr-${randomUUID()}` };
  }
  async deliverApprovedProposal(): Promise<{ deliveryId: string }> { return { deliveryId: `deliv-${randomUUID()}` }; }
  async trackCustomerResponse(): Promise<{ responseRecordId: string }> { return { responseRecordId: `resp-${randomUUID()}` }; }
  async preparePaymentLinkApproval(): Promise<{ approvalRequestId: string }> { return { approvalRequestId: `payapprreq-${randomUUID()}` }; }
  async createApprovedPaymentLink(_approvalRequestId: string, approvedBy: string): Promise<{ paymentLinkId: string }> {
    if (!approvedBy) throw new AutomationAuthorityError('A real human approver is required to create a payment link.', 'MISSING_APPROVAL');
    return { paymentLinkId: `paylink-${randomUUID()}` };
  }
  async reconcilePayment(): Promise<{ reconciliationId: string }> { return { reconciliationId: `recon-${randomUUID()}` }; }
  async prepareSupplierTask(): Promise<{ portalTaskId: string }> { return { portalTaskId: `portal-${randomUUID()}` }; }
  async recordHumanBookingConfirmation(_portalTaskId: string, confirmedBy: string): Promise<{ bookingId: string }> {
    if (!confirmedBy) throw new AutomationAuthorityError('A real human actor is required to confirm a booking.', 'MISSING_APPROVAL');
    return { bookingId: `book-${randomUUID()}` };
  }
  async activateTripRoom(): Promise<{ tripRoomId: string }> { return { tripRoomId: `trip-${randomUUID()}` }; }
  async scheduleReminder(): Promise<{ scheduledActionId: string }> { return { scheduledActionId: `sched-${randomUUID()}` }; }
  async escalateToConcierge(): Promise<{ escalationId: string }> { return { escalationId: `esc-${randomUUID()}` }; }
  async recommendApprovedSubscription(_contactId: string): Promise<{ recommendationId: string; planCode: string | null }> {
    return { recommendationId: `subrec-${randomUUID()}`, planCode: null };
  }
}

export type JourneyExecutionContext = AutomationContext & FounderControlContext;

export type StageExecutionResult = { stageCode: JourneyStageCode; outputReference: string; skippedAsDuplicate: boolean };

export async function executeJourneyStage(
  ctx: JourneyExecutionContext,
  ports: JourneyServicePorts,
  workflowRunId: string,
  stepId: string,
  stageCode: JourneyStageCode,
  input: { conversationId: string; contactId?: string; requestId?: string; proposalDraftId?: string; approvalRequestId?: string; portalTaskId?: string; bookingId?: string; tripRoomId?: string; approvedBy?: string; proposalType?: 'HOTEL' | 'OTHER'; proposalMaterial?: MaterialCommercialFields | null; agentCode: string | null; channel: string | null }
): Promise<StageExecutionResult> {
  const step = await ctx.store.loadWorkflowStep(stepId);
  if (!step) throw new AutomationAuthorityError('Step not found.', 'NOT_FOUND');
  if (step.status === 'COMPLETED') {
    return { stageCode, outputReference: '', skippedAsDuplicate: true };
  }

  await checkAutomationGateExtended(ctx, {
    agentCode: input.agentCode, channel: input.channel, workflowCode: 'customer.journey.v1',
    workingHoursPolicyCode: null, requiredFeatureFlag: null, level1PolicyCode: null
  });

  let outputReference: string;

  switch (stageCode) {
    case 'INBOUND_ENQUIRY': outputReference = (await ports.recordInboundEnquiry(input.conversationId)).crmRecordId; break;
    case 'IDENTITY_RESOLUTION': outputReference = (await ports.resolveIdentity(input.conversationId)).contactId; break;
    case 'LANGUAGE_RESOLUTION': outputReference = (await ports.resolveLanguage(input.conversationId)).locale; break;
    case 'LEAD_QUALIFICATION': {
      const scoringInput: LeadScoringInput = {
        hasCompleteContactInfo: true, hasStatedBudgetRange: false, hasStatedTravelDates: false, hasRespondedToOutreach: true,
        isReturningCustomer: false, hasActiveSubscription: false, isCorporateAccount: false, engagedWithinLast48Hours: true
      };
      const result = scoreLeadExplainably(scoringInput);
      outputReference = `lead-score-${result.score}`;
      break;
    }
    case 'TRAVEL_REQUEST_COLLECTION': outputReference = (await ports.recordTravelRequest(input.contactId ?? '', {})).requestId; break;
    case 'MISSING_INFO_FOLLOW_UP': outputReference = (await ports.prepareOutboundDraft(input.contactId ?? '', 'missing_info')).draftMessageId; break;
    case 'PROPOSAL_PREPARATION': outputReference = (await ports.prepareProposal(input.contactId ?? '', input.requestId ?? '', input.proposalType ?? 'HOTEL', input.proposalMaterial ?? null)).proposalDraftId; break;
    case 'PROPOSAL_HUMAN_APPROVAL': outputReference = (await ports.recordProposalApproval(input.proposalDraftId ?? '', input.approvedBy ?? '')).approvalId; break;
    case 'PROPOSAL_DELIVERY': outputReference = (await ports.deliverApprovedProposal(input.proposalDraftId ?? '', input.approvedBy ?? '')).deliveryId; break;
    case 'CUSTOMER_RESPONSE_TRACKING': outputReference = (await ports.trackCustomerResponse(input.conversationId)).responseRecordId; break;
    case 'PAYMENT_LINK_APPROVAL': outputReference = (await ports.preparePaymentLinkApproval(input.proposalDraftId ?? '')).approvalRequestId; break;
    case 'PAYMENT_LINK_CREATION': outputReference = (await ports.createApprovedPaymentLink(input.approvalRequestId ?? '', input.approvedBy ?? '')).paymentLinkId; break;
    case 'PAYMENT_RECONCILIATION': outputReference = (await ports.reconcilePayment(input.approvalRequestId ?? '')).reconciliationId; break;
    case 'SUPPLIER_TASK_PREPARATION': outputReference = (await ports.prepareSupplierTask(input.requestId ?? '')).portalTaskId; break;
    case 'HUMAN_BOOKING_CONFIRMATION': outputReference = (await ports.recordHumanBookingConfirmation(input.portalTaskId ?? '', input.approvedBy ?? '')).bookingId; break;
    case 'TRIP_ROOM_ACTIVATION': outputReference = (await ports.activateTripRoom(input.bookingId ?? '', input.portalTaskId)).tripRoomId; break;
    case 'PRE_DEPARTURE_REMINDERS': outputReference = (await ports.scheduleReminder(input.tripRoomId ?? '', 'PRE_DEPARTURE')).scheduledActionId; break;
    case 'CONCIERGE_ESCALATION': outputReference = (await ports.escalateToConcierge(input.conversationId, 'CUSTOMER_REQUESTED')).escalationId; break;
    case 'POST_TRIP_FOLLOW_UP': outputReference = (await ports.prepareOutboundDraft(input.contactId ?? '', 'post_trip')).draftMessageId; break;
    case 'FEEDBACK_AND_SUBSCRIPTION_RECOMMENDATION': outputReference = (await ports.recommendApprovedSubscription(input.contactId ?? '')).recommendationId; break;
    default: {
      const exhaustive: never = stageCode;
      throw new AutomationAuthorityError(`Unknown journey stage: ${exhaustive}`, 'VALIDATION');
    }
  }

  const isLevel2 = ['PROPOSAL_HUMAN_APPROVAL', 'PROPOSAL_DELIVERY', 'PAYMENT_LINK_APPROVAL', 'PAYMENT_LINK_CREATION', 'HUMAN_BOOKING_CONFIRMATION'].includes(stageCode);
  if (isLevel2) {
    await completeLevel2Step(ctx, stepId, input.approvedBy ?? '');
  } else {
    await completeLevel1Step(ctx, stepId);
  }

  await ctx.store.recordExecutionEvent({
    eventId: randomUUID(), workflowRunId, workflowStepId: stepId, kind: 'STAGE_OUTPUT_RECORDED',
    actorId: input.approvedBy ?? 'system', actorKind: input.approvedBy ? 'human' : 'system',
    correlationId: ctx.correlationId, reasonCode: outputReference
  });

  return { stageCode, outputReference, skippedAsDuplicate: false };
}

export function allStagesHaveExecutionMapping(): boolean {
  const handled = new Set<JourneyStageCode>([
    'INBOUND_ENQUIRY', 'IDENTITY_RESOLUTION', 'LANGUAGE_RESOLUTION', 'LEAD_QUALIFICATION',
    'TRAVEL_REQUEST_COLLECTION', 'MISSING_INFO_FOLLOW_UP', 'PROPOSAL_PREPARATION', 'PROPOSAL_HUMAN_APPROVAL',
    'PROPOSAL_DELIVERY', 'CUSTOMER_RESPONSE_TRACKING', 'PAYMENT_LINK_APPROVAL', 'PAYMENT_LINK_CREATION',
    'PAYMENT_RECONCILIATION', 'SUPPLIER_TASK_PREPARATION', 'HUMAN_BOOKING_CONFIRMATION', 'TRIP_ROOM_ACTIVATION',
    'PRE_DEPARTURE_REMINDERS', 'CONCIERGE_ESCALATION', 'POST_TRIP_FOLLOW_UP', 'FEEDBACK_AND_SUBSCRIPTION_RECOMMENDATION'
  ]);
  return CUSTOMER_JOURNEY_STAGES.every((s) => handled.has(s));
}
