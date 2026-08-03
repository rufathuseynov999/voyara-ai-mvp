import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createPaymentAdapter, PaymentAdapterError } from '@/server/payment/payment-registry';
import {
  HostedCheckoutPaymentAdapter,
  signHostedCheckoutWebhook
} from '@/server/payment/providers/hosted-checkout/hosted-checkout-adapter';
import {
  HOSTED_CHECKOUT_FIXTURE_CREATE_SUCCESS,
  HOSTED_CHECKOUT_FIXTURE_RATE_LIMIT_ERROR,
  HOSTED_CHECKOUT_FIXTURE_STATUS_PAID,
  HOSTED_CHECKOUT_FIXTURE_WEBHOOK_PAID,
  HOSTED_CHECKOUT_FIXTURE_WEBHOOK_WRONG_AMOUNT,
  HOSTED_CHECKOUT_FIXTURE_WEBHOOK_WRONG_CURRENCY
} from '@/server/payment/providers/hosted-checkout/hosted-checkout-fixtures';
import { SimulationPaymentAdapter } from '@/server/payment/simulation-payment-adapter';
import { reconcilePayment } from '@/server/payment/reconciliation';
import { prepareBooking } from '@/server/supplier/booking-preparation';

/**
 * Phase 3C Part 3 — formal hosted-checkout payment adapter test suite.
 *
 * No test in this file makes a real network call — no payment provider has
 * been approved by the founder and no credentials exist anywhere in this
 * project (see the Part 3 checkpoint). Every HTTP-shaped test injects a
 * fixture-backed `fetchImpl`, exactly like scripts/certify-hosted-payment.mjs.
 *
 * Several tests below call the EXISTING, already-tested `reconcilePayment()`
 * and `prepareBooking()` functions directly with data shaped exactly as this
 * adapter's webhook payload would produce it — this is deliberate: those
 * functions' own correctness is proven in tests/task-013/orchestration.test.ts
 * and tests/task-013/db-integration.test.ts, so this suite focuses on proving
 * this adapter's output integrates correctly with that existing engine,
 * rather than re-testing the engine's internals.
 */

const VALID_CREDENTIALS = {
  providerName: 'test-provider',
  merchantId: 'test-merchant-000001',
  apiKey: 'test-api-key-000001',
  webhookSigningSecret: 'test-webhook-signing-secret-00000000000000',
  baseUrl: 'https://fixture.invalid'
};

function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}
function errJson(status: number, body: unknown) {
  return { ok: false, status, json: async () => body };
}
function fixtureFetch(routes: Record<string, (body: unknown) => unknown>) {
  return async (url: string, init: { headers?: Record<string, string>; body?: string }) => {
    const path = new URL(url).pathname;
    const auth = init.headers?.Authorization;
    if (!auth || auth !== `Bearer ${VALID_CREDENTIALS.apiKey}`) return errJson(401, { error: { code: 'UNAUTHORIZED' } });
    const route = routes[path];
    if (!route) return errJson(404, { error: { message: 'no fixture route' } });
    return route(init.body ? JSON.parse(init.body) : undefined);
  };
}
function adapter(routes: Record<string, (body: unknown) => unknown>, extra: Partial<ConstructorParameters<typeof HostedCheckoutPaymentAdapter>[1]> = {}) {
  return new HostedCheckoutPaymentAdapter(VALID_CREDENTIALS, { fetchImpl: fixtureFetch(routes) as unknown as typeof fetch, ...extra });
}

/* -------------------------------- credentials ------------------------------- */

test('valid credentials construct a SANDBOX hosted-checkout adapter via the registry', () => {
  process.env.VOYARA_PAYMENT_PROVIDER_NAME = 'test-provider';
  process.env.VOYARA_PAYMENT_MERCHANT_ID = 'test-merchant-000001';
  process.env.VOYARA_PAYMENT_API_KEY = 'test-api-key-000001';
  process.env.VOYARA_PAYMENT_WEBHOOK_SIGNING_SECRET = 'test-webhook-signing-secret-00000000000000';
  process.env.VOYARA_PAYMENT_BASE_URL = 'https://fixture.invalid';
  try {
    const instance = createPaymentAdapter('SANDBOX', 'hosted-checkout');
    assert.equal(instance.adapterId, 'hosted-checkout');
    assert.equal(instance.mode, 'SANDBOX');
    assert.equal(instance.simulated, false);
    assert.ok(instance instanceof HostedCheckoutPaymentAdapter);
  } finally {
    delete process.env.VOYARA_PAYMENT_PROVIDER_NAME;
    delete process.env.VOYARA_PAYMENT_MERCHANT_ID;
    delete process.env.VOYARA_PAYMENT_API_KEY;
    delete process.env.VOYARA_PAYMENT_WEBHOOK_SIGNING_SECRET;
    delete process.env.VOYARA_PAYMENT_BASE_URL;
  }
});

test('missing credentials fail closed with CREDENTIALS_MISSING, never falling back to simulation', () => {
  delete process.env.VOYARA_PAYMENT_PROVIDER_NAME;
  delete process.env.VOYARA_PAYMENT_MERCHANT_ID;
  delete process.env.VOYARA_PAYMENT_API_KEY;
  delete process.env.VOYARA_PAYMENT_WEBHOOK_SIGNING_SECRET;
  assert.throws(
    () => createPaymentAdapter('SANDBOX', 'hosted-checkout'),
    (error: unknown) => error instanceof PaymentAdapterError && error.code === 'CREDENTIALS_MISSING'
  );
});

test('placeholder-shaped credentials are rejected, not silently accepted', () => {
  process.env.VOYARA_PAYMENT_PROVIDER_NAME = 'replace_me_with_real_provider';
  process.env.VOYARA_PAYMENT_MERCHANT_ID = 'test-merchant-000001';
  process.env.VOYARA_PAYMENT_API_KEY = 'test-api-key-000001';
  process.env.VOYARA_PAYMENT_WEBHOOK_SIGNING_SECRET = 'test-webhook-signing-secret-00000000000000';
  process.env.VOYARA_PAYMENT_BASE_URL = 'https://fixture.invalid';
  try {
    assert.throws(() => createPaymentAdapter('SANDBOX', 'hosted-checkout'), /placeholder/i);
  } finally {
    delete process.env.VOYARA_PAYMENT_PROVIDER_NAME;
    delete process.env.VOYARA_PAYMENT_MERCHANT_ID;
    delete process.env.VOYARA_PAYMENT_API_KEY;
    delete process.env.VOYARA_PAYMENT_WEBHOOK_SIGNING_SECRET;
    delete process.env.VOYARA_PAYMENT_BASE_URL;
  }
});

/* ------------------------------ invalid signatures --------------------------- */

test('a correctly signed webhook verifies', () => {
  const a = adapter({});
  const timestamp = new Date().toISOString();
  const body = JSON.stringify(HOSTED_CHECKOUT_FIXTURE_WEBHOOK_PAID);
  const signature = signHostedCheckoutWebhook(VALID_CREDENTIALS.webhookSigningSecret, timestamp, body);
  assert.equal(a.verifyWebhookSignature({ eventId: 'evt-1', eventType: 'payment.paid', timestamp, signature, body }, VALID_CREDENTIALS.webhookSigningSecret), true);
});

test('an invalid signature is rejected', () => {
  const a = adapter({});
  const timestamp = new Date().toISOString();
  const body = JSON.stringify(HOSTED_CHECKOUT_FIXTURE_WEBHOOK_PAID);
  assert.equal(a.verifyWebhookSignature({ eventId: 'evt-1', eventType: 'payment.paid', timestamp, signature: 'a'.repeat(64), body }, VALID_CREDENTIALS.webhookSigningSecret), false);
});

test('a tampered body invalidates an otherwise-correct signature', () => {
  const a = adapter({});
  const timestamp = new Date().toISOString();
  const body = JSON.stringify(HOSTED_CHECKOUT_FIXTURE_WEBHOOK_PAID);
  const signature = signHostedCheckoutWebhook(VALID_CREDENTIALS.webhookSigningSecret, timestamp, body);
  const tamperedBody = JSON.stringify({ ...HOSTED_CHECKOUT_FIXTURE_WEBHOOK_PAID, amountMinor: 1 });
  assert.equal(a.verifyWebhookSignature({ eventId: 'evt-1', eventType: 'payment.paid', timestamp, signature, body: tamperedBody }, VALID_CREDENTIALS.webhookSigningSecret), false);
});

test('malformed webhook input (missing fields) fails closed rather than throwing', () => {
  const a = adapter({});
  assert.equal(a.verifyWebhookSignature({ eventId: '', eventType: '', timestamp: '', signature: '', body: '' }, VALID_CREDENTIALS.webhookSigningSecret), false);
});

/* -------------------------------- timeout / rate limit ----------------------- */

test('a 429 response maps to RATE_LIMIT', async () => {
  const a = adapter({ '/v1/payment-intents': () => errJson(429, HOSTED_CHECKOUT_FIXTURE_RATE_LIMIT_ERROR) });
  const result = await a.createPayment({ quoteId: randomUUID(), expectedAmountMinor: 130_000, currency: 'AZN', correlationId: 'test-correlation-000001' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, 'RATE_LIMIT');
});

test('a network timeout maps to TIMEOUT', async () => {
  const a = new HostedCheckoutPaymentAdapter(VALID_CREDENTIALS, {
    timeoutMs: 5,
    fetchImpl: (() => new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), 50))) as unknown as typeof fetch
  });
  const result = await a.createPayment({ quoteId: randomUUID(), expectedAmountMinor: 130_000, currency: 'AZN', correlationId: 'test-correlation-000002' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, 'TIMEOUT');
});

/* ------------------------------- detection vs verification -------------------- */

test('createPayment() always starts a payment as PENDING (detection, not verification)', async () => {
  const a = adapter({ '/v1/payment-intents': () => okJson(HOSTED_CHECKOUT_FIXTURE_CREATE_SUCCESS) });
  const result = await a.createPayment({ quoteId: randomUUID(), expectedAmountMinor: 130_000, currency: 'AZN', correlationId: 'test-correlation-000003' });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.detectedStatus, 'PENDING');
});

test('a PAID provider status maps to DETECTED — never directly to a verified state', async () => {
  const a = adapter({ '/v1/payment-intents/hc-intent-000001': () => okJson(HOSTED_CHECKOUT_FIXTURE_STATUS_PAID) });
  const result = await a.lookupStatus({ intentReference: 'hc-intent-000001', correlationId: 'test-correlation-000004' });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, 'DETECTED');
});

/* --------------------- wrong amount / currency / reference / exact reconciliation ------------------ */

const baseReconciliationInput = {
  expectedAmountMinor: HOSTED_CHECKOUT_FIXTURE_WEBHOOK_PAID.amountMinor,
  expectedCurrency: 'AZN' as const,
  allocatedQuoteId: 'quote-a',
  paymentQuoteId: 'quote-a',
  quoteExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  receivedAt: new Date().toISOString(),
  seenProviderReferences: [] as string[]
};

test('exact reconciliation: matching amount, currency and reference verifies MATCHED', () => {
  const result = reconcilePayment({
    ...baseReconciliationInput,
    receivedAmountMinor: HOSTED_CHECKOUT_FIXTURE_WEBHOOK_PAID.amountMinor,
    receivedCurrency: HOSTED_CHECKOUT_FIXTURE_WEBHOOK_PAID.currency as 'AZN',
    providerTransactionReference: HOSTED_CHECKOUT_FIXTURE_WEBHOOK_PAID.providerTransactionReference,
    providerStatus: 'PAID'
  });
  assert.equal(result.status, 'MATCHED');
  assert.equal(result.verified, true);
});

test('wrong amount from a hosted-checkout webhook is reconciled as a mismatch, never verified', () => {
  const result = reconcilePayment({
    ...baseReconciliationInput,
    receivedAmountMinor: HOSTED_CHECKOUT_FIXTURE_WEBHOOK_WRONG_AMOUNT.amountMinor,
    receivedCurrency: HOSTED_CHECKOUT_FIXTURE_WEBHOOK_WRONG_AMOUNT.currency as 'AZN',
    providerTransactionReference: HOSTED_CHECKOUT_FIXTURE_WEBHOOK_WRONG_AMOUNT.providerTransactionReference,
    providerStatus: 'PAID'
  });
  assert.notEqual(result.status, 'MATCHED');
  assert.equal(result.verified, false);
  assert.equal(result.requiresHumanReview, true);
});

test('wrong currency from a hosted-checkout webhook is reconciled as CURRENCY_MISMATCH', () => {
  const result = reconcilePayment({
    ...baseReconciliationInput,
    receivedAmountMinor: HOSTED_CHECKOUT_FIXTURE_WEBHOOK_WRONG_CURRENCY.amountMinor,
    receivedCurrency: HOSTED_CHECKOUT_FIXTURE_WEBHOOK_WRONG_CURRENCY.currency as 'USD',
    providerTransactionReference: HOSTED_CHECKOUT_FIXTURE_WEBHOOK_WRONG_CURRENCY.providerTransactionReference,
    providerStatus: 'PAID'
  });
  assert.equal(result.status, 'CURRENCY_MISMATCH');
  assert.equal(result.verified, false);
});

test('a missing provider reference is reconciled as MISSING_REFERENCE, never verified', () => {
  const result = reconcilePayment({
    ...baseReconciliationInput,
    receivedAmountMinor: HOSTED_CHECKOUT_FIXTURE_WEBHOOK_PAID.amountMinor,
    receivedCurrency: HOSTED_CHECKOUT_FIXTURE_WEBHOOK_PAID.currency as 'AZN',
    providerTransactionReference: null,
    providerStatus: 'PAID'
  });
  assert.equal(result.status, 'MISSING_REFERENCE');
  assert.equal(result.verified, false);
});

/* -------------------------------- duplicate webhooks -------------------------- */

test('a duplicate provider reference (already seen for this quote) is reconciled as DUPLICATE', () => {
  const reference = HOSTED_CHECKOUT_FIXTURE_WEBHOOK_PAID.providerTransactionReference!;
  const result = reconcilePayment({
    ...baseReconciliationInput,
    receivedAmountMinor: HOSTED_CHECKOUT_FIXTURE_WEBHOOK_PAID.amountMinor,
    receivedCurrency: HOSTED_CHECKOUT_FIXTURE_WEBHOOK_PAID.currency as 'AZN',
    providerTransactionReference: reference,
    providerStatus: 'PAID',
    seenProviderReferences: [reference]
  });
  assert.equal(result.status, 'DUPLICATE');
  assert.equal(result.verified, false);
});

/* --------------------------------- cross-customer isolation ------------------- */

test('cross-customer isolation: a payment allocated to a different quote than referenced is reconciled as WRONG_QUOTE', () => {
  const result = reconcilePayment({
    ...baseReconciliationInput,
    allocatedQuoteId: 'quote-customer-a',
    paymentQuoteId: 'quote-customer-b',
    receivedAmountMinor: HOSTED_CHECKOUT_FIXTURE_WEBHOOK_PAID.amountMinor,
    receivedCurrency: HOSTED_CHECKOUT_FIXTURE_WEBHOOK_PAID.currency as 'AZN',
    providerTransactionReference: HOSTED_CHECKOUT_FIXTURE_WEBHOOK_PAID.providerTransactionReference,
    providerStatus: 'PAID'
  });
  assert.equal(result.status, 'WRONG_QUOTE');
  assert.equal(result.verified, false);
});

/* --------------------------- refund preparation without execution ------------- */

test('prepareRefundRequest() only ever prepares, and requires human approval', async () => {
  const a = adapter({});
  const result = await a.prepareRefundRequest(randomUUID(), 130_000, 'AZN');
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.refundRequestStatus, 'PREPARED');
    assert.equal(result.value.requiresHumanApproval, true);
  }
});

test('no code path in the adapter constructs a refund-execution or booking-confirmation request', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(
    new URL('../../src/server/payment/providers/hosted-checkout/hosted-checkout-adapter.ts', import.meta.url),
    'utf8'
  );
  const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/\/refund/i.test(codeOnly));
  assert.ok(!/\/book/i.test(codeOnly));
});

/* --------------------- no booking preparation before verified MATCHED payment --------------------- */

function minimalApprovedQuote(overrides: { status?: 'PAYMENT_VERIFIED' } = {}) {
  const material = {
    supplierNetMinor: 100_000,
    taxesAndFeesMinor: 12_000,
    customerTotalMinor: HOSTED_CHECKOUT_FIXTURE_WEBHOOK_PAID.amountMinor,
    currency: 'AZN' as const,
    roomType: 'Deluxe Room',
    boardBasis: 'BED_AND_BREAKFAST' as const,
    cancellationPolicy: { kind: 'NON_REFUNDABLE' as const },
    checkIn: '2027-01-10',
    checkOut: '2027-01-13',
    occupancy: { adults: 2, children: 0, rooms: 1 },
    supplierOfferReference: 'test-offer-000001',
    offerExpiry: new Date(Date.now() + 3_600_000).toISOString()
  };
  return {
    quoteId: randomUUID(),
    tenantId: randomUUID(),
    customerId: randomUUID(),
    status: overrides.status ?? ('PAYMENT_VERIFIED' as const),
    supplierOfferReference: 'test-offer-000001',
    source: 'SANDBOX' as const,
    correlationId: 'test-correlation-quote-1',
    currentVersionNumber: 1,
    versions: [{
      versionNumber: 1,
      contentHash: 'a'.repeat(64),
      material,
      approvalReference: randomUUID(),
      approvalInvalidated: false,
      createdAt: new Date().toISOString(),
      previousVersionNumber: null,
      supersededReason: null
    }],
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    lastRevalidatedAt: null
  };
}

test('booking preparation is refused when reconciliation is not MATCHED (wrong amount)', () => {
  const reconciliation = reconcilePayment({
    ...baseReconciliationInput,
    receivedAmountMinor: HOSTED_CHECKOUT_FIXTURE_WEBHOOK_WRONG_AMOUNT.amountMinor,
    receivedCurrency: HOSTED_CHECKOUT_FIXTURE_WEBHOOK_WRONG_AMOUNT.currency as 'AZN',
    providerTransactionReference: HOSTED_CHECKOUT_FIXTURE_WEBHOOK_WRONG_AMOUNT.providerTransactionReference,
    providerStatus: 'PAID'
  });
  const result = prepareBooking({
    quote: minimalApprovedQuote(),
    paymentVerified: true,
    reconciliationStatus: reconciliation.status,
    offerStillAvailable: true,
    hagApprovalReference: randomUUID(),
    travellers: [{ fullName: 'Test Traveller', isLead: true }],
    rooming: [{ roomIndex: 1, travellerNames: ['Test Traveller'] }],
    specialRequests: '',
    correlationId: 'test-correlation-prep-1',
    liveBookingEnabled: false,
    now: new Date()
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reasonCode, 'RECONCILIATION_NOT_MATCHED');
});

test('booking preparation succeeds only once reconciliation is genuinely MATCHED', () => {
  const reconciliation = reconcilePayment({
    ...baseReconciliationInput,
    receivedAmountMinor: HOSTED_CHECKOUT_FIXTURE_WEBHOOK_PAID.amountMinor,
    receivedCurrency: HOSTED_CHECKOUT_FIXTURE_WEBHOOK_PAID.currency as 'AZN',
    providerTransactionReference: HOSTED_CHECKOUT_FIXTURE_WEBHOOK_PAID.providerTransactionReference,
    providerStatus: 'PAID'
  });
  const result = prepareBooking({
    quote: minimalApprovedQuote(),
    paymentVerified: true,
    reconciliationStatus: reconciliation.status,
    offerStillAvailable: true,
    hagApprovalReference: randomUUID(),
    travellers: [{ fullName: 'Test Traveller', isLead: true }],
    rooming: [{ roomIndex: 1, travellerNames: ['Test Traveller'] }],
    specialRequests: '',
    correlationId: 'test-correlation-prep-2',
    liveBookingEnabled: false,
    now: new Date()
  });
  assert.equal(result.ok, true);
});

/* ------------------------ simulation / sandbox / live labelling -------------- */

test('the simulation payment adapter labels output simulated:true', async () => {
  const sim = new SimulationPaymentAdapter();
  const result = await sim.createPayment({ quoteId: randomUUID(), expectedAmountMinor: 130_000, currency: 'AZN', correlationId: 'sim-correlation-000001' });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.simulated, true);
    assert.equal(result.value.source, 'SIMULATED');
  }
});

test('the hosted-checkout adapter labels output SANDBOX and simulated:false', async () => {
  const a = adapter({ '/v1/payment-intents': () => okJson(HOSTED_CHECKOUT_FIXTURE_CREATE_SUCCESS) });
  const result = await a.createPayment({ quoteId: randomUUID(), expectedAmountMinor: 130_000, currency: 'AZN', correlationId: 'test-correlation-000005' });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.simulated, false);
    assert.equal(result.value.source, 'SANDBOX');
  }
});

test('LIVE mode is never available for hosted-checkout, regardless of whether credentials are configured', () => {
  process.env.VOYARA_PAYMENT_PROVIDER_NAME = 'test-provider';
  process.env.VOYARA_PAYMENT_MERCHANT_ID = 'test-merchant-000001';
  process.env.VOYARA_PAYMENT_API_KEY = 'test-api-key-000001';
  process.env.VOYARA_PAYMENT_WEBHOOK_SIGNING_SECRET = 'test-webhook-signing-secret-00000000000000';
  try {
    assert.throws(
      () => createPaymentAdapter('LIVE', 'hosted-checkout'),
      (error: unknown) => error instanceof PaymentAdapterError && error.code === 'LIVE_NOT_AVAILABLE'
    );
  } finally {
    delete process.env.VOYARA_PAYMENT_PROVIDER_NAME;
    delete process.env.VOYARA_PAYMENT_MERCHANT_ID;
    delete process.env.VOYARA_PAYMENT_API_KEY;
    delete process.env.VOYARA_PAYMENT_WEBHOOK_SIGNING_SECRET;
  }
});

test('SANDBOX mode rejects any payment adapter id other than hosted-checkout', () => {
  assert.throws(
    () => createPaymentAdapter('SANDBOX', 'some-other-provider'),
    (error: unknown) => error instanceof PaymentAdapterError && error.code === 'UNSUPPORTED_ADAPTER'
  );
});
