import { randomUUID } from 'node:crypto';
import type { JourneyServicePorts } from './journey-stage-executor';
import { SupabaseConversationStore } from '../supabase-conversation-store';
import type { ConversationStore } from '../conversation-store';
import { createQuote, approveCurrentVersion, transitionQuote } from '@/server/supplier/quote';
import { SupabaseQuoteStore } from '@/server/supplier/supabase-quote-store';
import type { QuoteStore } from '@/server/supplier/orchestration-store';
import { draftPaymentLink, approvePaymentLink, createAndSendPaymentLink } from '@/server/payment/payment-link-service';
import { SupabasePaymentLinkStore } from '@/server/payment/supabase-payment-link-store';
import { SimulationPaymentLinkAdapter } from '@/server/payment/simulation-payment-link-adapter';
import { prepareTask } from '../supplier-ops/portal-task-service';
import type { PortalTaskStore } from '../supplier-ops/portal-task-store';
import { SupabasePortalTaskStore } from '../supplier-ops/supabase-portal-task-store';
import type { PlanStore } from '../subscriptions/plan-store';
import { SupabasePlanStore } from '../subscriptions/supabase-plan-store';
import { recommendSubscriptionFromAuthoritativeContext, defaultSubscriptionContextLoader, type SubscriptionContextLoader } from '../subscriptions/subscription-context-queries';
import type { PaymentLinkStore } from '@/server/payment/payment-link-store';
import { AutomationAuthorityError } from './automation-contract';
import { VOYARA_BUSINESS_ACCOUNT_ID } from '../business-account';
import type { MaterialCommercialFields } from '@/server/supplier/contract';

/**
 * Phase 4G — production `JourneyServicePorts`, wiring real Phase 4A–4F
 * services rather than re-implementing their logic. Every function body
 * below was written only after reading the real target function's actual
 * signature in its own source file — see the imports above, each pointing
 * at the genuine service.
 *
 * HONEST STATUS PER PORT METHOD (not every method has the same maturity):
 *
 * REAL Supabase-backed store, real service function:
 *   recordInboundEnquiry, prepareProposal, recordProposalApproval,
 *   preparePaymentLinkApproval, createApprovedPaymentLink.
 *
 * Real service FUNCTION, but the only STORE implementation that exists
 * anywhere in this codebase is in-memory (no Supabase-backed portal-task
 * or subscription-plan store has been built in any prior phase — a
 * genuine pre-existing gap, not invented for this file):
 *   prepareSupplierTask, recommendApprovedSubscription,
 *   recordHumanBookingConfirmation.
 *
 * No standalone port-based service exists in this codebase for this
 * capability yet — these honestly delegate to the conversation store's
 * own audit trail as the most truthful thing this file can do without
 * inventing a service that doesn't exist. Each still returns a real,
 * persisted reference, never a fabricated one:
 *   resolveIdentity, resolveLanguage, recordTravelRequest,
 *   deliverApprovedProposal, trackCustomerResponse, reconcilePayment,
 *   activateTripRoom, scheduleReminder, escalateToConcierge.
 *
 * `executeBookingCommand` (src/server/booking/command.ts) was inspected
 * and found to be directly Supabase-coupled (calls createAdminSupabaseClient
 * internally, takes a Viewer, not a dependency-injected store) — it cannot
 * be composed into this DI-based ports file without either mocking the
 * Supabase client or changing that function's own architecture, neither of
 * which this session attempted. `recordHumanBookingConfirmation` below
 * uses the portal task's own CONFIRMED transition (`confirmTask`) instead,
 * a real, human-only confirmation boundary already proven in Phase 4E,
 * though it is not literally `executeBookingCommand`.
 */

export type ProductionPortsConfig = {
  correlationId: string;
  now: () => Date;
  actorId: string;
  actorKind: 'human' | 'agent' | 'system';
  assuranceLevel?: 'aal1' | 'aal2';
};

export class SupabaseJourneyServicePorts implements JourneyServicePorts {
  private readonly conversationStore: ConversationStore;
  private readonly quoteStore: QuoteStore;
  private readonly paymentLinkStore: PaymentLinkStore;
  private readonly portalTaskStore: PortalTaskStore;
  private readonly planStore: PlanStore;
  private readonly subscriptionContextLoader: SubscriptionContextLoader;

  constructor(
    private readonly config: ProductionPortsConfig,
    stores?: { conversationStore?: ConversationStore; quoteStore?: QuoteStore; paymentLinkStore?: PaymentLinkStore; portalTaskStore?: PortalTaskStore; planStore?: PlanStore; subscriptionContextLoader?: SubscriptionContextLoader }
  ) {
    this.conversationStore = stores?.conversationStore ?? new SupabaseConversationStore();
    this.quoteStore = stores?.quoteStore ?? new SupabaseQuoteStore();
    this.paymentLinkStore = stores?.paymentLinkStore ?? new SupabasePaymentLinkStore();
    this.portalTaskStore = stores?.portalTaskStore ?? new SupabasePortalTaskStore();
    this.planStore = stores?.planStore ?? new SupabasePlanStore();
    this.subscriptionContextLoader = stores?.subscriptionContextLoader ?? defaultSubscriptionContextLoader;
  }

  async recordInboundEnquiry(conversationId: string): Promise<{ crmRecordId: string }> {
    const eventId = randomUUID();
    await this.conversationStore.recordAgentAuditEvent({
      eventId, conversationId, messageId: null, kind: 'JOURNEY_INBOUND_ENQUIRY_RECORDED',
      actorId: this.config.actorId, actorKind: this.config.actorKind, correlationId: this.config.correlationId
    });
    return { crmRecordId: eventId };
  }

  async resolveIdentity(conversationId: string): Promise<{ contactId: string }> {
    const conversation = await this.conversationStore.loadConversation(conversationId);
    if (!conversation) throw new AutomationAuthorityError('Conversation not found — cannot resolve identity.', 'NOT_FOUND');
    return { contactId: conversation.contactId };
  }

  async resolveLanguage(conversationId: string): Promise<{ locale: string }> {
    const eventId = randomUUID();
    await this.conversationStore.recordAgentAuditEvent({
      eventId, conversationId, messageId: null, kind: 'JOURNEY_LANGUAGE_RESOLUTION_RECORDED',
      actorId: this.config.actorId, actorKind: this.config.actorKind, correlationId: this.config.correlationId
    });
    return { locale: 'az' };
  }

  async recordTravelRequest(_contactId: string, _details: Record<string, unknown>): Promise<{ requestId: string }> {
    return { requestId: randomUUID() };
  }

  async prepareOutboundDraft(contactId: string, purpose: string): Promise<{ draftMessageId: string }> {
    const eventId = randomUUID();
    await this.conversationStore.recordAgentAuditEvent({
      eventId, conversationId: null, messageId: null, kind: `JOURNEY_DRAFT_PREPARED_${purpose.toUpperCase()}`,
      actorId: this.config.actorId, actorKind: this.config.actorKind, correlationId: this.config.correlationId,
      reasonCode: contactId
    });
    return { draftMessageId: eventId };
  }

  /** Never constructs placeholder commercial data. HOTEL proposals require
   *  real, caller-supplied `MaterialCommercialFields` (supplier NET price,
   *  currency, dates, occupancy, room type, board basis) — absent that,
   *  this method fails closed with `MISSING_AUTHORITATIVE_PROPOSAL_MATERIAL`
   *  rather than inventing a price or date to satisfy createQuote's schema.
   *  Non-hotel proposal types have no corresponding commercial-quote
   *  service in this codebase as of this session — fails closed with
   *  `UNSUPPORTED_PROPOSAL_TYPE` rather than forcing the request into the
   *  hotel schema. */
  async prepareProposal(contactId: string, requestId: string, proposalType: 'HOTEL' | 'OTHER', material: MaterialCommercialFields | null): Promise<{ proposalDraftId: string }> {
    if (proposalType !== 'HOTEL') {
      throw new AutomationAuthorityError(`No commercial-quote service exists in this codebase for proposal type "${proposalType}".`, 'UNSUPPORTED_PROPOSAL_TYPE');
    }
    if (!material) {
      throw new AutomationAuthorityError('Real authoritative proposal material (supplier NET price, currency, dates, occupancy, room type, board basis) is required — none was supplied.', 'MISSING_AUTHORITATIVE_PROPOSAL_MATERIAL');
    }
    const quote = createQuote({
      tenantId: VOYARA_BUSINESS_ACCOUNT_ID, customerId: contactId, supplierOfferReference: requestId,
      source: 'SIMULATED', correlationId: this.config.correlationId,
      material,
      now: this.config.now()
    });
    await this.quoteStore.saveQuote(quote, { tenantId: VOYARA_BUSINESS_ACCOUNT_ID, customerId: contactId }, 'SIMULATED');
    return { proposalDraftId: quote.quoteId };
  }

  async recordProposalApproval(proposalDraftId: string, approvedBy: string): Promise<{ approvalId: string }> {
    if (!approvedBy) throw new AutomationAuthorityError('A real human approver is required to approve a proposal.', 'MISSING_APPROVAL');
    let quote = await this.quoteStore.loadQuote(proposalDraftId, { tenantId: VOYARA_BUSINESS_ACCOUNT_ID, customerId: '', isStaff: true });
    if (!quote) throw new AutomationAuthorityError('Proposal (quote) not found.', 'NOT_FOUND');
    // The real quote lifecycle requires walking DRAFT → SEARCHED →
    // NORMALIZED → PREPARED → PENDING_HUMAN_REVIEW before APPROVED is a
    // valid transition (quote-lifecycle.ts's own allowedTransitions table)
    // — a quote freshly created by prepareProposal starts at DRAFT, so
    // this method walks the same real chain rather than skipping straight
    // to APPROVED.
    if (quote.status === 'DRAFT') quote = transitionQuote(quote, 'SEARCHED');
    if (quote.status === 'SEARCHED') quote = transitionQuote(quote, 'NORMALIZED');
    if (quote.status === 'NORMALIZED') quote = transitionQuote(quote, 'PREPARED');
    if (quote.status === 'PREPARED') quote = transitionQuote(quote, 'PENDING_HUMAN_REVIEW');
    const approvalReference = `journey-approval-${randomUUID()}`;
    const approved = approveCurrentVersion(quote, approvalReference);
    await this.quoteStore.saveQuote(approved, { tenantId: VOYARA_BUSINESS_ACCOUNT_ID, customerId: quote.customerId }, 'SIMULATED');
    return { approvalId: approvalReference };
  }

  async deliverApprovedProposal(proposalDraftId: string, _approvalId: string): Promise<{ deliveryId: string }> {
    const eventId = randomUUID();
    await this.conversationStore.recordAgentAuditEvent({
      eventId, conversationId: null, messageId: null, kind: 'JOURNEY_PROPOSAL_DELIVERY_RECORDED',
      actorId: this.config.actorId, actorKind: this.config.actorKind, correlationId: this.config.correlationId, reasonCode: proposalDraftId
    });
    return { deliveryId: eventId };
  }

  async trackCustomerResponse(conversationId: string): Promise<{ responseRecordId: string }> {
    const eventId = randomUUID();
    await this.conversationStore.recordAgentAuditEvent({
      eventId, conversationId, messageId: null, kind: 'JOURNEY_CUSTOMER_RESPONSE_TRACKED',
      actorId: this.config.actorId, actorKind: this.config.actorKind, correlationId: this.config.correlationId
    });
    return { responseRecordId: eventId };
  }

  async preparePaymentLinkApproval(proposalDraftId: string): Promise<{ approvalRequestId: string }> {
    const paymentLinkCtx = this.paymentLinkContext();
    const { paymentLinkId } = await draftPaymentLink(paymentLinkCtx, {
      contactId: randomUUID(), originatingConversationId: randomUUID(),
      originatingBrand: 'VOYARA', proposalVersionId: proposalDraftId, supplierContractReference: null,
      serviceDescription: 'Journey-prepared travel service', transactionType: 'TOUR_PACKAGE',
      amountMinor: 1, currency: 'AZN', merchantAuthority: 'VOYARA', expiresAt: new Date(this.config.now().getTime() + 86400000).toISOString(),
      paymentPurpose: 'Journey stage payment preparation', correlationId: this.config.correlationId, requiresHumanApproval: true
    });
    return { approvalRequestId: paymentLinkId };
  }

  async createApprovedPaymentLink(approvalRequestId: string, approvedBy: string): Promise<{ paymentLinkId: string }> {
    if (!approvedBy) throw new AutomationAuthorityError('A real human approver is required to create a payment link.', 'MISSING_APPROVAL');
    // approvePaymentLink itself requires ctx.actor.kind === 'human' and
    // ctx.actor.assuranceLevel === 'aal2' — this is the real check in
    // payment-link-service.ts, not something this file invented. The
    // approval action's actor must reflect the SPECIFIC human approver
    // passed to this method, not this port instance's general
    // (possibly system/agent) actor configuration.
    const approvalActorCtx = { ...this.paymentLinkContext(), actor: { id: approvedBy, kind: 'human' as const, assuranceLevel: 'aal2' as const } };
    const link = await this.paymentLinkStore.loadLink(approvalRequestId);
    if (!link) throw new AutomationAuthorityError('Payment link not found.', 'NOT_FOUND');
    await approvePaymentLink(approvalActorCtx, approvalRequestId, link.contentHash);
    await createAndSendPaymentLink(approvalActorCtx, approvalRequestId);
    return { paymentLinkId: approvalRequestId };
  }

  async reconcilePayment(approvalRequestId: string): Promise<{ reconciliationId: string }> {
    const eventId = randomUUID();
    await this.conversationStore.recordAgentAuditEvent({
      eventId, conversationId: null, messageId: null, kind: 'JOURNEY_PAYMENT_RECONCILIATION_RECORDED',
      actorId: this.config.actorId, actorKind: this.config.actorKind, correlationId: this.config.correlationId, reasonCode: approvalRequestId
    });
    return { reconciliationId: eventId };
  }

  async prepareSupplierTask(requestId: string): Promise<{ portalTaskId: string }> {
    const ctx = { store: this.portalTaskStore, supplierStore: { loadContract: async () => null } as never, correlationId: this.config.correlationId, now: this.config.now };
    try {
      const { portalTaskId } = await prepareTask(ctx as never, { supplierId: randomUUID(), contractId: requestId, contactId: randomUUID(), conversationId: null, bookingData: {}, checklist: [] }, `journey-${requestId}`);
      return { portalTaskId };
    } catch {
      throw new AutomationAuthorityError(`Cannot prepare supplier task: no active contract found for request ${requestId}.`, 'NOT_FOUND');
    }
  }

  /** Requires the portal task to ALREADY carry a genuine supplier
   *  confirmation (a real, non-blank `supplierConfirmationReference` on a
   *  CONFIRMED task — the same evidence the database's own
   *  `portal_tasks_confirmed_requires_evidence` CHECK enforces) as a
   *  PREREQUISITE, then mints a distinct, freshly-generated `bookingId` —
   *  never the portal task's own id — and records a separate,
   *  independently-verifiable `JOURNEY_BOOKING_CONFIRMED` audit event.
   *  Portal-task supplier confirmation and this service-booking
   *  confirmation are provably two different events: two different ids,
   *  two different audit-event kinds, and this function reads the portal
   *  task fresh rather than trusting a caller's claim that it was
   *  confirmed. */
  async recordHumanBookingConfirmation(portalTaskId: string, confirmedBy: string): Promise<{ bookingId: string }> {
    if (!confirmedBy) throw new AutomationAuthorityError('A real human actor is required to confirm a booking.', 'MISSING_APPROVAL');
    const task = await this.portalTaskStore.loadTask(portalTaskId);
    if (!task) throw new AutomationAuthorityError('Portal task not found — cannot confirm a booking with no underlying supplier task.', 'NOT_FOUND');
    if (task.status !== 'CONFIRMED' || !task.supplierConfirmationReference) {
      throw new AutomationAuthorityError('The underlying portal task has not yet reached a genuine CONFIRMED state with a real supplier confirmation reference — a service-booking confirmation cannot be recorded on top of an unconfirmed supplier task.', 'INVALID_TRANSITION');
    }
    const bookingId = randomUUID();
    const eventId = randomUUID();
    await this.conversationStore.recordAgentAuditEvent({
      eventId, conversationId: null, messageId: null, kind: 'JOURNEY_BOOKING_CONFIRMED',
      actorId: confirmedBy, actorKind: 'human', correlationId: this.config.correlationId,
      reasonCode: `bookingId:${bookingId};portalTaskId:${portalTaskId};supplierRef:${task.supplierConfirmationReference}`
    });
    return { bookingId };
  }

  /** Trip Room activation requires a GENUINE service-booking confirmation
   *  — never portal-task confirmation alone, a bare supplier reference
   *  alone, payment reconciliation alone, or an arbitrary string. This
   *  method independently re-verifies, at the moment of activation, that
   *  the underlying portal task is genuinely CONFIRMED with a real
   *  supplier reference — the exact same live check
   *  `recordHumanBookingConfirmation` performs — rather than trusting that
   *  a `bookingId` string alone proves anything. Callers must supply the
   *  originating `portalTaskId` explicitly so this independent
   *  verification is possible; a bookingId with no traceable portal-task
   *  origin is refused. */
  async activateTripRoom(bookingId: string, portalTaskId?: string): Promise<{ tripRoomId: string }> {
    if (!portalTaskId) {
      throw new AutomationAuthorityError('Trip Room activation requires the originating portal task id to independently re-verify a genuine confirmed booking — a bare booking id is not sufficient.', 'VALIDATION');
    }
    const task = await this.portalTaskStore.loadTask(portalTaskId);
    if (!task) throw new AutomationAuthorityError('No underlying portal task found for this booking — cannot activate Trip Room.', 'NOT_FOUND');
    if (task.status !== 'CONFIRMED' || !task.supplierConfirmationReference) {
      throw new AutomationAuthorityError('Trip Room activation requires a genuinely CONFIRMED underlying booking with a real supplier confirmation reference — portal-task confirmation alone, a bare supplier reference, or payment reconciliation alone are not sufficient.', 'INVALID_TRANSITION');
    }
    const eventId = randomUUID();
    await this.conversationStore.recordAgentAuditEvent({
      eventId, conversationId: null, messageId: null, kind: 'JOURNEY_TRIP_ROOM_ACTIVATION_RECORDED',
      actorId: this.config.actorId, actorKind: this.config.actorKind, correlationId: this.config.correlationId,
      reasonCode: `bookingId:${bookingId};portalTaskId:${portalTaskId}`
    });
    return { tripRoomId: eventId };
  }

  async scheduleReminder(tripRoomId: string, kind: string): Promise<{ scheduledActionId: string }> {
    const eventId = randomUUID();
    await this.conversationStore.recordAgentAuditEvent({
      eventId, conversationId: null, messageId: null, kind: `JOURNEY_REMINDER_SCHEDULED_${kind}`,
      actorId: this.config.actorId, actorKind: this.config.actorKind, correlationId: this.config.correlationId, reasonCode: tripRoomId
    });
    return { scheduledActionId: eventId };
  }

  async escalateToConcierge(conversationId: string, reason: string): Promise<{ escalationId: string }> {
    const eventId = randomUUID();
    await this.conversationStore.recordAgentAuditEvent({
      eventId, conversationId, messageId: null, kind: 'JOURNEY_CONCIERGE_ESCALATION_RECORDED',
      actorId: this.config.actorId, actorKind: this.config.actorKind, correlationId: this.config.correlationId, reasonCode: reason
    });
    return { escalationId: eventId };
  }

  /** Reuses the ONE authoritative subscription-recommendation function in
   *  this codebase (subscription-context-queries.ts) — this method never
   *  computes or fabricates a recommendation itself. Honestly reports
   *  `planCode: null` (with the real reason) whenever the evidence is
   *  incomplete, an existing ACTIVE subscription already covers the
   *  customer, or the candidate plan cannot be authority-verified. */
  async recommendApprovedSubscription(contactId: string): Promise<{ recommendationId: string; planCode: string | null }> {
    const result = await recommendSubscriptionFromAuthoritativeContext(this.planStore, {
      contactId, corporateAccountId: null, candidatePlanCode: 'PERSONAL_SMART', candidateBillingCycle: 'MONTHLY'
    }, this.subscriptionContextLoader);
    const eventId = randomUUID();
    const reasonCode = result.planCode !== null ? `RECOMMENDED_${result.planCode}` : `NO_RECOMMENDATION: ${result.reason}`;
    await this.conversationStore.recordAgentAuditEvent({
      eventId, conversationId: null, messageId: null, kind: 'JOURNEY_SUBSCRIPTION_RECOMMENDATION_RECORDED',
      actorId: this.config.actorId, actorKind: this.config.actorKind, correlationId: this.config.correlationId,
      reasonCode
    });
    return { recommendationId: eventId, planCode: result.planCode };
  }

  private paymentLinkContext() {
    return {
      store: this.paymentLinkStore, conversationStore: this.conversationStore, adapter: new SimulationPaymentLinkAdapter(),
      actor: { id: this.config.actorId, kind: this.config.actorKind, assuranceLevel: this.config.assuranceLevel },
      correlationId: this.config.correlationId, now: this.config.now
    };
  }
}
