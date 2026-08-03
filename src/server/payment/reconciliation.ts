import type {
  InboundWebhook,
  PaymentAdapter,
  PaymentRecord,
  ReconciliationStatus,
  WebhookReceipt
} from './integration-contract';

/**
 * Phase 3A Part 4 — reconciliation engine and idempotent webhook processing.
 *
 * Reconciliation is the ONLY path to a verified payment, and only an exact,
 * authoritative match may verify. Every mismatch is routed to human review and
 * must not progress to booking preparation. Webhook processing is idempotent,
 * replay-protected and fails closed on invalid signatures.
 */

export type ReconciliationInput = {
  expectedAmountMinor: number;
  receivedAmountMinor: number | null;
  expectedCurrency: PaymentRecord['currency'];
  receivedCurrency: PaymentRecord['currency'] | null;
  providerTransactionReference: string | null;
  providerStatus: 'PAID' | 'PENDING' | 'FAILED' | 'UNKNOWN';
  allocatedQuoteId: string;
  paymentQuoteId: string;
  quoteExpiresAt: string;
  receivedAt: string;
  /** References already seen for this quote — used to detect duplicates. */
  seenProviderReferences: readonly string[];
};

export type ReconciliationResult = {
  status: ReconciliationStatus;
  verified: boolean;
  /** True when the outcome must go to human review (any mismatch). */
  requiresHumanReview: boolean;
  reasonCode: string;
};

/**
 * Deterministically classify a payment against the expectation. Order of
 * checks matters: structural problems (missing reference, wrong quote, expiry)
 * are detected before amount/currency comparison, and only a fully exact match
 * verifies.
 */
export function reconcilePayment(input: ReconciliationInput): ReconciliationResult {
  const review = (status: ReconciliationStatus, reasonCode: string): ReconciliationResult => ({
    status,
    verified: false,
    requiresHumanReview: true,
    reasonCode
  });

  // Missing provider reference — cannot be authoritatively matched.
  if (!input.providerTransactionReference) {
    return review('MISSING_REFERENCE', 'MISSING_PROVIDER_REFERENCE');
  }

  // Payment allocated to a different quote than the one it references.
  if (input.allocatedQuoteId !== input.paymentQuoteId) {
    return review('WRONG_QUOTE', 'WRONG_QUOTE_ALLOCATION');
  }

  // Duplicate of a reference already recorded for this quote.
  if (input.seenProviderReferences.includes(input.providerTransactionReference)) {
    return review('DUPLICATE', 'DUPLICATE_PAYMENT');
  }

  // Payment received after the quote expired.
  if (Date.parse(input.receivedAt) > Date.parse(input.quoteExpiresAt)) {
    return review('AFTER_EXPIRY', 'PAYMENT_AFTER_EXPIRY');
  }

  // Provider status must authoritatively be PAID.
  if (input.providerStatus !== 'PAID') {
    return review('STATUS_DISAGREEMENT', `PROVIDER_STATUS_${input.providerStatus}`);
  }

  // Currency must match exactly.
  if (input.receivedCurrency === null || input.receivedCurrency !== input.expectedCurrency) {
    return review('CURRENCY_MISMATCH', 'CURRENCY_MISMATCH');
  }

  // Amount comparison.
  if (input.receivedAmountMinor === null) {
    return review('STATUS_DISAGREEMENT', 'NO_RECEIVED_AMOUNT');
  }
  if (input.receivedAmountMinor < input.expectedAmountMinor) {
    return review('PARTIAL', 'PARTIAL_PAYMENT');
  }
  if (input.receivedAmountMinor > input.expectedAmountMinor) {
    return review('EXCESS', 'EXCESS_PAYMENT');
  }

  // Exact, authoritative match — the only path to verified.
  return {
    status: 'MATCHED',
    verified: true,
    requiresHumanReview: false,
    reasonCode: 'EXACT_MATCH'
  };
}

/* ----------------------------- Webhook processor ------------------------- */

const MAX_SKEW_MS = 5 * 60_000; // 5 minutes replay window

export type WebhookProcessResult = {
  accepted: boolean;
  duplicate: boolean;
  reasonCode: string;
  receipt: WebhookReceipt;
};

/**
 * Idempotent, replay-protected webhook processing.
 *
 * - Invalid signature → fail closed (rejected).
 * - Timestamp outside the replay window → rejected.
 * - Event id already processed → accepted as a no-op duplicate (idempotent);
 *   never creates a second payment/approval/booking.
 * - Unknown event type → safely stored (accepted receipt) but flagged, not acted on.
 *
 * `processedEventIds` is the caller's durable idempotency set. The processor is
 * pure; the caller persists the returned receipt and updates its set.
 */
export function processWebhook(params: {
  webhook: InboundWebhook;
  secret: string;
  adapter: Pick<PaymentAdapter, 'verifyWebhookSignature'>;
  knownEventTypes: readonly string[];
  processedEventIds: ReadonlySet<string>;
  correlationId: string;
  now: Date;
}): WebhookProcessResult {
  const { webhook, secret, adapter, knownEventTypes, processedEventIds, correlationId, now } = params;

  const makeReceipt = (accepted: boolean, reasonCode: string): WebhookReceipt => ({
    eventId: webhook.eventId?.slice(0, 128) || 'unknown',
    eventType: webhook.eventType?.slice(0, 80) || 'unknown',
    receivedAt: now.toISOString(),
    correlationId,
    accepted,
    reasonCode
  });

  // Fail closed on invalid signature — before anything else.
  if (!adapter.verifyWebhookSignature(webhook, secret)) {
    return { accepted: false, duplicate: false, reasonCode: 'INVALID_SIGNATURE', receipt: makeReceipt(false, 'INVALID_SIGNATURE') };
  }

  // Replay protection: reject events outside the skew window.
  const eventTime = Date.parse(webhook.timestamp);
  if (!Number.isFinite(eventTime) || Math.abs(now.getTime() - eventTime) > MAX_SKEW_MS) {
    return { accepted: false, duplicate: false, reasonCode: 'REPLAY_WINDOW', receipt: makeReceipt(false, 'REPLAY_WINDOW') };
  }

  // Idempotency: a previously processed event is a no-op duplicate.
  if (processedEventIds.has(webhook.eventId)) {
    return { accepted: true, duplicate: true, reasonCode: 'DUPLICATE_EVENT', receipt: makeReceipt(true, 'DUPLICATE_EVENT') };
  }

  // Unknown event types are stored safely but not acted upon.
  if (!knownEventTypes.includes(webhook.eventType)) {
    return { accepted: true, duplicate: false, reasonCode: 'UNKNOWN_EVENT_STORED', receipt: makeReceipt(true, 'UNKNOWN_EVENT_STORED') };
  }

  return { accepted: true, duplicate: false, reasonCode: 'ACCEPTED', receipt: makeReceipt(true, 'ACCEPTED') };
}
