import type { PaymentLinkStatus } from './payment-link-contract';

/**
 * Phase 4B — payment-link reconciliation.
 *
 * A sibling to reconciliation.ts's `reconcilePayment`, not a copy-paste of
 * it renamed: the rule order and the "only an exact match verifies"
 * discipline are identical on purpose, but the field names are honest about
 * what a payment link actually compares against (its own order reference,
 * not a quote allocation) rather than reusing quote-shaped names that would
 * read as misleading for a subscription or other non-quote-bound payment.
 *
 * `processWebhook` from reconciliation.ts is reused UNCHANGED for payment
 * links — it was already fully generic (event id / signature / replay
 * window, no quote-specific field anywhere in it).
 */

export type PaymentLinkReconciliationInput = {
  expectedAmountMinor: number;
  receivedAmountMinor: number | null;
  expectedCurrency: string;
  receivedCurrency: string | null;
  expectedOrderReference: string;
  receivedOrderReference: string | null;
  providerTransactionReference: string | null;
  providerStatus: 'PAID' | 'PENDING' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
  linkExpiresAt: string;
  receivedAt: string;
  seenProviderReferences: readonly string[];
};

export type PaymentLinkReconciliationResult = {
  status: Extract<PaymentLinkStatus, 'VERIFIED' | 'MISMATCHED'> | 'DUPLICATE' | 'EXPIRED_ON_RECEIPT' | 'WRONG_REFERENCE';
  verified: boolean;
  requiresHumanReview: boolean;
  reasonCode: string;
};

export function reconcilePaymentLink(input: PaymentLinkReconciliationInput): PaymentLinkReconciliationResult {
  const review = (status: PaymentLinkReconciliationResult['status'], reasonCode: string): PaymentLinkReconciliationResult => ({
    status, verified: false, requiresHumanReview: true, reasonCode
  });

  if (!input.providerTransactionReference) {
    return review('MISMATCHED', 'MISSING_PROVIDER_REFERENCE');
  }
  if (!input.receivedOrderReference || input.receivedOrderReference !== input.expectedOrderReference) {
    return review('WRONG_REFERENCE', 'WRONG_ORDER_REFERENCE');
  }
  if (input.seenProviderReferences.includes(input.providerTransactionReference)) {
    return review('DUPLICATE', 'DUPLICATE_PAYMENT');
  }
  if (Date.parse(input.receivedAt) > Date.parse(input.linkExpiresAt)) {
    return review('EXPIRED_ON_RECEIPT', 'PAYMENT_AFTER_LINK_EXPIRY');
  }
  if (input.providerStatus !== 'PAID') {
    return review('MISMATCHED', `PROVIDER_STATUS_${input.providerStatus}`);
  }
  if (input.receivedCurrency === null || input.receivedCurrency !== input.expectedCurrency) {
    return review('MISMATCHED', 'CURRENCY_MISMATCH');
  }
  if (input.receivedAmountMinor === null || input.receivedAmountMinor !== input.expectedAmountMinor) {
    return review('MISMATCHED', input.receivedAmountMinor === null ? 'NO_RECEIVED_AMOUNT' : 'AMOUNT_MISMATCH');
  }

  return { status: 'VERIFIED', verified: true, requiresHumanReview: false, reasonCode: 'EXACT_MATCH' };
}
