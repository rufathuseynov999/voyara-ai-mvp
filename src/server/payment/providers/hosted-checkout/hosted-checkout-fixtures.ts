import type { HostedCheckoutCreateResponse, HostedCheckoutErrorResponse, HostedCheckoutStatusResponse } from './hosted-checkout-contract';

/**
 * Phase 3C Part 3 — documented fixtures for the generic hosted-checkout
 * adapter. Hand-built against hosted-checkout-contract.ts's own reference
 * shape — not captured from any real provider, since none is approved or
 * reachable from this environment. See hosted-checkout-contract.ts's header
 * for the full honesty note.
 */

export const HOSTED_CHECKOUT_FIXTURE_CREATE_SUCCESS: HostedCheckoutCreateResponse = {
  id: 'hc-intent-000001',
  hostedUrl: 'https://fixture.invalid/checkout/hc-intent-000001',
  status: 'PENDING'
};

export const HOSTED_CHECKOUT_FIXTURE_STATUS_PAID: HostedCheckoutStatusResponse = {
  id: 'hc-intent-000001',
  status: 'PAID'
};

export const HOSTED_CHECKOUT_FIXTURE_STATUS_PENDING: HostedCheckoutStatusResponse = {
  id: 'hc-intent-000001',
  status: 'PENDING'
};

export const HOSTED_CHECKOUT_FIXTURE_AUTH_ERROR: HostedCheckoutErrorResponse = {
  error: { code: 'UNAUTHORIZED', message: 'Invalid API key' }
};

export const HOSTED_CHECKOUT_FIXTURE_RATE_LIMIT_ERROR: HostedCheckoutErrorResponse = {
  error: { code: 'RATE_LIMITED', message: 'Too many requests' }
};

export const HOSTED_CHECKOUT_FIXTURE_WEBHOOK_PAID = {
  eventId: 'evt-000001',
  eventType: 'payment.paid',
  intentId: 'hc-intent-000001',
  status: 'PAID' as const,
  amountMinor: 130_000,
  currency: 'AZN',
  providerTransactionReference: 'HC-TX-000001'
};

export const HOSTED_CHECKOUT_FIXTURE_WEBHOOK_WRONG_AMOUNT = {
  ...HOSTED_CHECKOUT_FIXTURE_WEBHOOK_PAID,
  eventId: 'evt-000002',
  amountMinor: 120_000
};

export const HOSTED_CHECKOUT_FIXTURE_WEBHOOK_WRONG_CURRENCY = {
  ...HOSTED_CHECKOUT_FIXTURE_WEBHOOK_PAID,
  eventId: 'evt-000003',
  currency: 'USD'
};

export const HOSTED_CHECKOUT_FIXTURE_WEBHOOK_NO_REFERENCE = {
  ...HOSTED_CHECKOUT_FIXTURE_WEBHOOK_PAID,
  eventId: 'evt-000004',
  providerTransactionReference: null
};
