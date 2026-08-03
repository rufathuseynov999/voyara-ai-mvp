import { randomUUID } from 'node:crypto';
import type { SupplierAdapter } from './adapter';
import { commercialSourceForMode, type MaterialCommercialFields } from './contract';
import {
  approveCurrentVersion,
  createQuote,
  currentVersion,
  hasValidApproval,
  hashMaterial,
  revalidateQuote,
  transitionQuote,
  type Quote
} from './quote';
import { assertTransition } from './quote-lifecycle';
import {
  prepareBooking,
  isVoucherEligible,
  type BookingPreparationContract
} from './booking-preparation';
import type { Actor, OwnershipScope, QuoteStore, StoredAuditEvent } from './orchestration-store';
import type { PaymentAdapter, InboundWebhook, PaymentRecord } from '@/server/payment/integration-contract';
import { processWebhook, reconcilePayment } from '@/server/payment/reconciliation';

/**
 * Phase 3B Part 1 — persistent orchestration over the SIMULATION adapters only.
 *
 * Composes supplier search, quote lifecycle/versioning, revalidation, payment
 * intent/webhook/reconciliation and human-gated booking preparation, persisting
 * through an injected QuoteStore. Enforces every Phase 3A authority rule and is
 * idempotent on repeated commands. No live provider is contacted; all records
 * are labelled simulation.
 */

export const SIMULATION_LABEL = 'Demo simulation — no live inventory or payment.';

export type OrchestrationContext = {
  store: QuoteStore;
  supplier: SupplierAdapter;
  payment: PaymentAdapter;
  actor: Actor;
  ownership: OwnershipScope;
  correlationId: string;
  now: () => Date;
};

/** Persistence ownership always derives from the quote's own tenant/customer —
 *  a staff member acting on a customer's quote must never re-own it. */
function ownershipOf(quote: Quote): { tenantId: string; customerId: string } {
  return { tenantId: quote.tenantId, customerId: quote.customerId };
}

export class AuthorityError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'AuthorityError';
  }
}

async function audit(
  ctx: OrchestrationContext,
  kind: StoredAuditEvent['kind'],
  quoteId: string,
  reasonCode?: string,
  contentHash?: string
): Promise<void> {
  await ctx.store.appendAudit({
    eventId: randomUUID(),
    kind,
    quoteId,
    actorId: ctx.actor.id,
    actorKind: ctx.actor.kind,
    correlationId: ctx.correlationId,
    occurredAt: ctx.now().toISOString(),
    reasonCode,
    contentHash
  });
}

/** Reserve-first idempotency: exactly one concurrent caller wins the key (the
 *  store's PRIMARY KEY decides); losers return the winner's result id without
 *  executing `work`. If the winner's work fails, the reservation is released so
 *  a retry can succeed, and the error propagates. */
async function once(
  ctx: OrchestrationContext,
  key: string,
  resultId: string,
  work: () => Promise<void>
): Promise<{ resultId: string; replayed: boolean }> {
  const reservation = await ctx.store.reserveIdempotent({
    key,
    resultId,
    createdAt: ctx.now().toISOString()
  });
  if (!reservation.winner) return { resultId: reservation.resultId, replayed: true };
  try {
    await work();
  } catch (error) {
    await ctx.store.releaseIdempotent(key);
    throw error;
  }
  return { resultId, replayed: false };
}

/** 1. Supplier search + normalized-offer persistence + quote creation. */
export async function searchAndCreateQuote(
  ctx: OrchestrationContext,
  input: { destination: string; checkIn: string; checkOut: string; occupancy: { adults: number; children: number; rooms: number }; currency: MaterialCommercialFields['currency']; commandKey: string }
): Promise<{ quoteId: string; replayed: boolean }> {
  const quoteId = randomUUID();
  const result = await once(ctx, input.commandKey, quoteId, async () => {
    const search = await ctx.supplier.search({
      destination: input.destination,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      occupancy: input.occupancy,
      currency: input.currency,
      correlationId: ctx.correlationId
    });
    if (!search.ok) throw new AuthorityError('Supplier search failed', search.error.code);
    const offer = search.value[0];

    // Build the quote's material terms from the (simulated) normalized offer.
    const material: MaterialCommercialFields = {
      supplierNetMinor: offer.supplierNetMinor,
      taxesAndFeesMinor: offer.taxesMinor + offer.mandatoryFeesMinor,
      customerTotalMinor: offer.customerTotalMinor ?? offer.supplierNetMinor + offer.taxesMinor + offer.mandatoryFeesMinor,
      currency: offer.currency,
      roomType: offer.roomType,
      boardBasis: offer.boardBasis,
      cancellationPolicy: offer.cancellationPolicy,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      occupancy: input.occupancy,
      supplierOfferReference: offer.supplierOfferReference,
      offerExpiry: offer.expiresAt
    };

    let quote = createQuote({
      quoteId,
      tenantId: ctx.ownership.tenantId,
      customerId: ctx.ownership.customerId,
      supplierOfferReference: offer.supplierOfferReference,
      source: commercialSourceForMode(ctx.supplier.mode),
      correlationId: ctx.correlationId,
      material,
      now: ctx.now()
    });
    quote = transitionQuote(quote, 'SEARCHED');
    quote = transitionQuote(quote, 'NORMALIZED');
    quote = transitionQuote(quote, 'PREPARED');

    await ctx.store.saveQuote(quote, ownershipOf(quote), quote.source);
    await audit(ctx, 'QUOTE_CREATED', quote.quoteId, undefined, currentVersion(quote).contentHash);
    await audit(ctx, 'QUOTE_VERSION_CREATED', quote.quoteId, undefined, currentVersion(quote).contentHash);
  });
  return { quoteId: result.resultId, replayed: result.replayed };
}

async function mustLoad(ctx: OrchestrationContext, quoteId: string, isStaff: boolean): Promise<Quote> {
  const quote = await ctx.store.loadQuote(quoteId, { ...ctx.ownership, isStaff });
  if (!quote) throw new AuthorityError('Quote not found or access denied', 'QUOTE_ACCESS_DENIED');
  return quote;
}

/** 2. Submit to Human Approval Gate. */
export async function submitForReview(ctx: OrchestrationContext, quoteId: string): Promise<void> {
  const quote = await mustLoad(ctx, quoteId, true);
  const next = transitionQuote(quote, 'PENDING_HUMAN_REVIEW');
  await ctx.store.saveQuote(next, ownershipOf(next), next.source);
  await audit(ctx, 'QUOTE_SUBMITTED_FOR_REVIEW', quoteId);
}

/** 3. Approve, binding approval to the exact current content hash. Fails closed
 *  if the provided hash does not match the current version. */
export async function approveQuote(
  ctx: OrchestrationContext,
  quoteId: string,
  expectedContentHash: string
): Promise<void> {
  const quote = await mustLoad(ctx, quoteId, true);
  if (ctx.actor.kind !== 'human') {
    throw new AuthorityError('Only a human may approve', 'HUMAN_APPROVAL_REQUIRED');
  }
  const version = currentVersion(quote);
  if (version.contentHash !== expectedContentHash) {
    throw new AuthorityError('Approval content hash is stale', 'STALE_APPROVAL_HASH');
  }
  const approved = approveCurrentVersion(quote, randomUUID());
  await ctx.store.saveQuote(approved, ownershipOf(approved), approved.source);
  await audit(ctx, 'QUOTE_APPROVED', quoteId, undefined, version.contentHash);
}

/** Present the approved quote — blocked without a valid approval. */
export async function presentQuote(ctx: OrchestrationContext, quoteId: string): Promise<void> {
  const quote = await mustLoad(ctx, quoteId, true);
  if (!hasValidApproval(quote)) {
    throw new AuthorityError('Cannot present without valid human approval', 'NO_VALID_APPROVAL');
  }
  const presented = transitionQuote(quote, 'PRESENTED');
  await ctx.store.saveQuote(presented, ownershipOf(presented), presented.source);
  await audit(ctx, 'QUOTE_PRESENTED', quoteId);
}

/** 4. Customer acceptance (idempotent). */
export async function acceptQuote(
  ctx: OrchestrationContext,
  quoteId: string,
  commandKey: string
): Promise<{ replayed: boolean }> {
  const result = await once(ctx, commandKey, quoteId, async () => {
    const quote = await mustLoad(ctx, quoteId, false);
    const accepted = transitionQuote(quote, 'CUSTOMER_ACCEPTED');
    await ctx.store.saveQuote(accepted, ownershipOf(accepted), accepted.source);
    await audit(ctx, 'QUOTE_CUSTOMER_ACCEPTED', quoteId);
  });
  return { replayed: result.replayed };
}

/** 5. Revalidation against the supplier adapter. */
export async function revalidate(
  ctx: OrchestrationContext,
  quoteId: string,
  freshMaterial: MaterialCommercialFields | null
): Promise<{ outcome: string }> {
  const quote = await mustLoad(ctx, quoteId, true);
  await audit(ctx, 'QUOTE_REVALIDATION_STARTED', quoteId);

  const input = freshMaterial
    ? { ok: true as const, material: freshMaterial }
    : { ok: false as const, error: { kind: 'UNAVAILABLE' as const, retryable: true, code: 'SUPPLIER_UNAVAILABLE' } };
  const outcome = revalidateQuote(quote, input, ctx.now());

  await ctx.store.saveQuote(outcome.quote, ownershipOf(outcome.quote), outcome.quote.source);
  if (outcome.kind === 'UNCHANGED') {
    await audit(ctx, 'QUOTE_REVALIDATION_UNCHANGED', quoteId);
  } else if (outcome.kind === 'MATERIAL_CHANGE') {
    await audit(ctx, 'QUOTE_MATERIAL_CHANGE_DETECTED', quoteId, 'PRICE_CHANGED', currentVersion(outcome.quote).contentHash);
    await audit(ctx, 'QUOTE_APPROVAL_INVALIDATED', quoteId);
  } else if (outcome.kind === 'EXPIRED') {
    await audit(ctx, 'QUOTE_EXPIRED', quoteId);
  } else if (outcome.kind === 'SUPPLIER_UNAVAILABLE') {
    await audit(ctx, 'QUOTE_SUPPLIER_UNAVAILABLE', quoteId);
  }
  return { outcome: outcome.kind };
}

/** 6. Prepare a payment intent (moves quote to PAYMENT_PENDING). */
export async function preparePaymentIntent(
  ctx: OrchestrationContext,
  quoteId: string
): Promise<{ intentReference: string }> {
  const quote = await mustLoad(ctx, quoteId, true);
  if (!hasValidApproval(quote)) {
    throw new AuthorityError('Payment requires a valid approved quote', 'NO_VALID_APPROVAL');
  }
  const version = currentVersion(quote);
  const created = await ctx.payment.createPayment({
    quoteId,
    expectedAmountMinor: version.material.customerTotalMinor,
    currency: version.material.currency,
    correlationId: ctx.correlationId
  });
  if (!created.ok) throw new AuthorityError('Payment intent failed', created.error.code);

  const pending = transitionQuote(quote, 'PAYMENT_PENDING');
  await ctx.store.saveQuote(pending, ownershipOf(pending), pending.source);

  const record: PaymentRecord = {
    paymentId: randomUUID(),
    quoteId,
    tenantId: quote.tenantId,
    customerId: quote.customerId,
    expectedAmountMinor: version.material.customerTotalMinor,
    receivedAmountMinor: null,
    currency: version.material.currency,
    receivedCurrency: null,
    providerTransactionReference: null,
    intentReference: created.value.intentReference,
    detectedStatus: 'PENDING',
    verifiedStatus: 'UNVERIFIED',
    reconciliationStatus: 'PENDING',
    providerFeesMinor: null,
    supplierPayableMinor: null,
    voyaraRevenueMinor: null,
    cashReceivedMinor: null,
    refundableAmountMinor: null,
    refundRequestStatus: 'NONE',
    bookingAllocationReference: null,
    correlationId: ctx.correlationId,
    source: pending.source,
    simulated: pending.source !== 'LIVE',
    createdAt: ctx.now().toISOString(),
    updatedAt: ctx.now().toISOString()
  };
  await ctx.store.savePayment(record);
  await audit(ctx, 'PAYMENT_INTENT_CREATED', quoteId, undefined);
  return { intentReference: created.value.intentReference };
}

/** 7. Process an inbound webhook (idempotent; detection only, never verify). */
export async function handlePaymentWebhook(
  ctx: OrchestrationContext,
  quoteId: string,
  webhook: InboundWebhook,
  secret: string,
  knownEventTypes: readonly string[]
): Promise<{ accepted: boolean; duplicate: boolean; reasonCode: string }> {
  const alreadyProcessed = await ctx.store.hasProcessedEvent(webhook.eventId);
  const result = processWebhook({
    webhook,
    secret,
    adapter: ctx.payment,
    knownEventTypes,
    processedEventIds: new Set(alreadyProcessed ? [webhook.eventId] : []),
    correlationId: ctx.correlationId,
    now: ctx.now()
  });
  await ctx.store.saveWebhookReceipt(result.receipt);
  await audit(ctx, 'PAYMENT_WEBHOOK_RECEIVED', quoteId, result.reasonCode);

  // A valid, first-time detection webhook moves the quote to PAYMENT_DETECTED
  // (detection ≠ verification — verification only happens on reconciliation).
  if (result.accepted && !result.duplicate && result.reasonCode === 'ACCEPTED') {
    const quote = await mustLoad(ctx, quoteId, true);
    if (quote.status === 'PAYMENT_PENDING') {
      const detected = transitionQuote(quote, 'PAYMENT_DETECTED');
      await ctx.store.saveQuote(detected, ownershipOf(detected), detected.source);
      const payment = await ctx.store.loadPaymentByQuote(quoteId);
      if (payment) await ctx.store.savePayment({ ...payment, detectedStatus: 'DETECTED', updatedAt: ctx.now().toISOString() });
    }
  }
  return { accepted: result.accepted, duplicate: result.duplicate, reasonCode: result.reasonCode };
}

/** 8. Reconcile a detected payment. Only an exact MATCHED reconciliation
 *  verifies; every mismatch routes to PAYMENT_MISMATCH (human review). */
export async function reconcile(
  ctx: OrchestrationContext,
  quoteId: string,
  evidence: {
    receivedAmountMinor: number | null;
    receivedCurrency: PaymentRecord['currency'] | null;
    providerTransactionReference: string | null;
    providerStatus: 'PAID' | 'PENDING' | 'FAILED' | 'UNKNOWN';
    receivedAt: string;
    seenProviderReferences: readonly string[];
  }
): Promise<{ status: string; verified: boolean }> {
  const quote = await mustLoad(ctx, quoteId, true);
  const payment = await ctx.store.loadPaymentByQuote(quoteId);
  if (!payment) throw new AuthorityError('No payment for quote', 'PAYMENT_NOT_FOUND');
  const version = currentVersion(quote);

  const outcome = reconcilePayment({
    expectedAmountMinor: version.material.customerTotalMinor,
    receivedAmountMinor: evidence.receivedAmountMinor,
    expectedCurrency: version.material.currency,
    receivedCurrency: evidence.receivedCurrency,
    providerTransactionReference: evidence.providerTransactionReference,
    providerStatus: evidence.providerStatus,
    allocatedQuoteId: quoteId,
    paymentQuoteId: quoteId,
    quoteExpiresAt: quote.expiresAt,
    receivedAt: evidence.receivedAt,
    seenProviderReferences: evidence.seenProviderReferences
  });

  const nextStatus = outcome.verified ? 'PAYMENT_VERIFIED' : 'PAYMENT_MISMATCH';
  assertTransition(quote.status, nextStatus);
  const updated = transitionQuote(quote, nextStatus);
  await ctx.store.saveQuote(updated, ownershipOf(updated), updated.source);
  await ctx.store.savePayment({
    ...payment,
    receivedAmountMinor: evidence.receivedAmountMinor,
    receivedCurrency: evidence.receivedCurrency,
    providerTransactionReference: evidence.providerTransactionReference,
    verifiedStatus: outcome.verified ? 'VERIFIED' : 'REJECTED',
    reconciliationStatus: outcome.status,
    updatedAt: ctx.now().toISOString()
  });
  await audit(ctx, 'PAYMENT_RECONCILED', quoteId, outcome.reasonCode);
  return { status: outcome.status, verified: outcome.verified };
}

/** 9. Booking preparation — requires verified payment + MATCHED reconciliation.
 *  Idempotent; never confirms a supplier booking. */
export async function prepareBookingCommand(
  ctx: OrchestrationContext,
  quoteId: string,
  input: {
    travellers: Array<{ fullName: string; isLead: boolean }>;
    rooming: Array<{ roomIndex: number; travellerNames: string[] }>;
    specialRequests: string;
    hagApprovalReference: string;
    commandKey: string;
  }
): Promise<{ prepared: boolean; replayed: boolean; reasonCode?: string; preparation?: BookingPreparationContract }> {
  const quote = await mustLoad(ctx, quoteId, true);
  const payment = await ctx.store.loadPaymentByQuote(quoteId);
  const paymentVerified = payment?.verifiedStatus === 'VERIFIED';
  const reconciliationStatus = payment?.reconciliationStatus ?? 'PENDING';

  const result = prepareBooking({
    quote,
    paymentVerified,
    reconciliationStatus,
    offerStillAvailable: true,
    hagApprovalReference: input.hagApprovalReference,
    travellers: input.travellers,
    rooming: input.rooming,
    specialRequests: input.specialRequests,
    correlationId: ctx.correlationId,
    liveBookingEnabled: false,
    now: ctx.now()
  });

  if (!result.ok) {
    return { prepared: false, replayed: false, reasonCode: result.reasonCode };
  }

  const idem = await once(ctx, input.commandKey, quoteId, async () => {
    await ctx.store.saveBookingPreparation(result.preparation, ownershipOf(quote));
    await audit(ctx, 'BOOKING_PREPARED', quoteId, undefined, result.preparation.approvedContentHash);
  });
  return { prepared: true, replayed: idem.replayed, preparation: result.preparation };
}

/** Voucher eligibility gate. */
export async function checkVoucherEligibility(
  ctx: OrchestrationContext,
  quoteId: string,
  bookingConfirmed: boolean
): Promise<boolean> {
  const quote = await mustLoad(ctx, quoteId, true);
  const payment = await ctx.store.loadPaymentByQuote(quoteId);
  return isVoucherEligible({
    quote,
    paymentVerified: payment?.verifiedStatus === 'VERIFIED',
    reconciliationStatus: payment?.reconciliationStatus ?? 'PENDING',
    bookingConfirmed
  });
}
