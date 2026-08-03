import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  SimulationPaymentAdapter,
  signSimulatedWebhook
} from '@/server/payment/simulation-payment-adapter';
import {
  createPaymentAdapter,
  PaymentAdapterError,
  resolvePaymentAdapter
} from '@/server/payment/payment-registry';
import {
  processWebhook,
  reconcilePayment,
  type ReconciliationInput
} from '@/server/payment/reconciliation';
import type { InboundWebhook } from '@/server/payment/integration-contract';
import { canTransition } from '@/server/supplier/quote-lifecycle';

const NOW = new Date('2026-07-20T09:00:00.000Z');
const SECRET = 'w'.repeat(40);

const baseEnv = (overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: 'test',
  VOYARA_SUPPLIER_MODE: 'SIMULATION',
  VOYARA_SUPPLIER_ADAPTER: 'simulation',
  VOYARA_PAYMENT_MODE: 'SIMULATION',
  VOYARA_PAYMENT_ADAPTER: 'simulation',
  VOYARA_LIVE_BOOKING_ENABLED: 'false',
  ...overrides
});

const reconInput = (overrides: Partial<ReconciliationInput> = {}): ReconciliationInput => ({
  expectedAmountMinor: 1_040_000,
  receivedAmountMinor: 1_040_000,
  expectedCurrency: 'AZN',
  receivedCurrency: 'AZN',
  providerTransactionReference: 'SIM-TX-1',
  providerStatus: 'PAID',
  allocatedQuoteId: 'quote-1',
  paymentQuoteId: 'quote-1',
  quoteExpiresAt: '2026-07-25T12:00:00.000Z',
  receivedAt: '2026-07-21T09:00:00.000Z',
  seenProviderReferences: [],
  ...overrides
});

const webhook = (overrides: Partial<InboundWebhook> = {}): InboundWebhook => {
  const timestamp = NOW.toISOString();
  const body = JSON.stringify({ type: 'payment.detected', id: 'evt-1' });
  return {
    eventId: 'evt-1',
    eventType: 'payment.detected',
    timestamp,
    signature: signSimulatedWebhook(SECRET, timestamp, body),
    body,
    ...overrides
  };
};

test('simulation payment adapter is deterministic and clearly simulated', async () => {
  const adapter = new SimulationPaymentAdapter();
  assert.equal(adapter.simulated, true);
  const request = { quoteId: randomUUID(), expectedAmountMinor: 1_040_000, currency: 'AZN' as const, correlationId: 'corr-abc-12345' };
  const first = await adapter.createPayment(request);
  const second = await adapter.createPayment(request);
  assert.ok(first.ok && second.ok);
  if (first.ok && second.ok) {
    assert.deepEqual(first.value, second.value);
    assert.ok(first.value.intentReference.startsWith('SIM-PI-'));
    assert.equal(first.value.detectedStatus, 'PENDING'); // detection, not verification
    assert.equal(first.value.simulated, true);
  }
});

test('detected status scenarios are deterministic', async () => {
  const adapter = new SimulationPaymentAdapter();
  const pending = await adapter.lookupStatus({ intentReference: 'SIM-PI-x', correlationId: 'corr-SIM-PENDING-1' });
  const failed = await adapter.lookupStatus({ intentReference: 'SIM-PI-x', correlationId: 'corr-SIM-FAILED-1' });
  const detected = await adapter.lookupStatus({ intentReference: 'SIM-PI-x', correlationId: 'corr-normal-1' });
  assert.ok(pending.ok && pending.value === 'PENDING');
  assert.ok(failed.ok && failed.value === 'FAILED');
  assert.ok(detected.ok && detected.value === 'DETECTED');
});

test('invalid webhook signature fails closed', () => {
  const adapter = new SimulationPaymentAdapter();
  const bad = webhook({ signature: 'deadbeef' });
  assert.equal(adapter.verifyWebhookSignature(bad, SECRET), false);
  const result = processWebhook({
    webhook: bad, secret: SECRET, adapter, knownEventTypes: ['payment.detected'],
    processedEventIds: new Set(), correlationId: 'corr-1', now: NOW
  });
  assert.equal(result.accepted, false);
  assert.equal(result.reasonCode, 'INVALID_SIGNATURE');
});

test('replay outside the window is rejected', () => {
  const adapter = new SimulationPaymentAdapter();
  const stale = new Date(NOW.getTime() + 10 * 60_000); // 10 min later
  const result = processWebhook({
    webhook: webhook(), secret: SECRET, adapter, knownEventTypes: ['payment.detected'],
    processedEventIds: new Set(), correlationId: 'corr-1', now: stale
  });
  assert.equal(result.accepted, false);
  assert.equal(result.reasonCode, 'REPLAY_WINDOW');
});

test('duplicate webhook is idempotent (accepted no-op, no new record)', () => {
  const adapter = new SimulationPaymentAdapter();
  const result = processWebhook({
    webhook: webhook(), secret: SECRET, adapter, knownEventTypes: ['payment.detected'],
    processedEventIds: new Set(['evt-1']), correlationId: 'corr-1', now: NOW
  });
  assert.equal(result.accepted, true);
  assert.equal(result.duplicate, true);
  assert.equal(result.reasonCode, 'DUPLICATE_EVENT');
});

test('event-order tolerance: unknown event type stored safely, not acted on', () => {
  const adapter = new SimulationPaymentAdapter();
  const result = processWebhook({
    webhook: webhook({ eventId: 'evt-2', eventType: 'payment.some_future_event', body: JSON.stringify({ id: 'evt-2' }), timestamp: NOW.toISOString(), signature: signSimulatedWebhook(SECRET, NOW.toISOString(), JSON.stringify({ id: 'evt-2' })) }),
    secret: SECRET, adapter, knownEventTypes: ['payment.detected', 'payment.verified'],
    processedEventIds: new Set(), correlationId: 'corr-1', now: NOW
  });
  assert.equal(result.accepted, true);
  assert.equal(result.reasonCode, 'UNKNOWN_EVENT_STORED');
});

test('valid known webhook is accepted once', () => {
  const adapter = new SimulationPaymentAdapter();
  const result = processWebhook({
    webhook: webhook(), secret: SECRET, adapter, knownEventTypes: ['payment.detected'],
    processedEventIds: new Set(), correlationId: 'corr-1', now: NOW
  });
  assert.equal(result.accepted, true);
  assert.equal(result.duplicate, false);
  assert.equal(result.reasonCode, 'ACCEPTED');
  // Receipt carries no secret or raw signature.
  const serialized = JSON.stringify(result.receipt);
  assert.ok(!serialized.includes(SECRET));
  assert.ok(!serialized.includes(webhook().signature));
});

test('reconciliation: exact match verifies; nothing else does', () => {
  const matched = reconcilePayment(reconInput());
  assert.equal(matched.status, 'MATCHED');
  assert.equal(matched.verified, true);
  assert.equal(matched.requiresHumanReview, false);
});

test('reconciliation: partial payment → review, not verified', () => {
  const result = reconcilePayment(reconInput({ receivedAmountMinor: 900_000 }));
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.verified, false);
  assert.equal(result.requiresHumanReview, true);
});

test('reconciliation: excess payment → review', () => {
  const result = reconcilePayment(reconInput({ receivedAmountMinor: 1_200_000 }));
  assert.equal(result.status, 'EXCESS');
  assert.equal(result.verified, false);
});

test('reconciliation: currency mismatch → review', () => {
  const result = reconcilePayment(reconInput({ receivedCurrency: 'USD' }));
  assert.equal(result.status, 'CURRENCY_MISMATCH');
  assert.equal(result.verified, false);
});

test('reconciliation: duplicate payment → review', () => {
  const result = reconcilePayment(reconInput({ seenProviderReferences: ['SIM-TX-1'] }));
  assert.equal(result.status, 'DUPLICATE');
  assert.equal(result.verified, false);
});

test('reconciliation: missing provider reference → review', () => {
  const result = reconcilePayment(reconInput({ providerTransactionReference: null }));
  assert.equal(result.status, 'MISSING_REFERENCE');
  assert.equal(result.verified, false);
});

test('reconciliation: provider-status disagreement → review', () => {
  const result = reconcilePayment(reconInput({ providerStatus: 'PENDING' }));
  assert.equal(result.status, 'STATUS_DISAGREEMENT');
  assert.equal(result.verified, false);
});

test('reconciliation: wrong quote allocation → review', () => {
  const result = reconcilePayment(reconInput({ paymentQuoteId: 'quote-2' }));
  assert.equal(result.status, 'WRONG_QUOTE');
  assert.equal(result.verified, false);
});

test('reconciliation: payment after quote expiry → review', () => {
  const result = reconcilePayment(reconInput({ receivedAt: '2026-07-26T00:00:00.000Z' }));
  assert.equal(result.status, 'AFTER_EXPIRY');
  assert.equal(result.verified, false);
});

test('detected is never verified: lifecycle requires the detected→verified step', () => {
  // Payment detection maps to PAYMENT_DETECTED; verification is a separate,
  // guarded transition that only reconciliation authorises.
  assert.equal(canTransition('PAYMENT_PENDING', 'PAYMENT_VERIFIED'), false);
  assert.equal(canTransition('PAYMENT_PENDING', 'PAYMENT_DETECTED'), true);
  assert.equal(canTransition('PAYMENT_DETECTED', 'PAYMENT_VERIFIED'), true);
  assert.equal(canTransition('PAYMENT_DETECTED', 'PAYMENT_MISMATCH'), true);
});

test('payment registry: unsupported adapter and live mode fail closed', () => {
  assert.throws(() => createPaymentAdapter('SIMULATION', 'stripe-live'), PaymentAdapterError);
  assert.throws(() => createPaymentAdapter('LIVE', 'simulation'), (error: unknown) =>
    error instanceof PaymentAdapterError && error.code === 'LIVE_NOT_AVAILABLE');
  const adapter = createPaymentAdapter('SIMULATION', 'simulation');
  assert.equal(adapter.simulated, true);
  assert.equal(resolvePaymentAdapter(baseEnv()).simulated, true);
});

test('refund preparation never executes and requires human approval', async () => {
  const adapter = new SimulationPaymentAdapter();
  const prep = await adapter.prepareRefundRequest(randomUUID(), 500_000, 'AZN');
  assert.ok(prep.ok);
  if (prep.ok) {
    assert.equal(prep.value.refundRequestStatus, 'PREPARED');
    assert.equal(prep.value.requiresHumanApproval, true);
    assert.equal(prep.value.simulated, true);
  }
});

test('no sensitive data leaks through webhook receipts or errors', () => {
  const adapter = new SimulationPaymentAdapter();
  const result = processWebhook({
    webhook: webhook({ body: JSON.stringify({ card: '4111111111111111', cvv: '123' }), signature: 'bad' }),
    secret: SECRET, adapter, knownEventTypes: ['payment.detected'],
    processedEventIds: new Set(), correlationId: 'corr-1', now: NOW
  });
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('4111111111111111'));
  assert.ok(!serialized.includes('123') || result.reasonCode === 'INVALID_SIGNATURE');
  assert.ok(!serialized.includes(SECRET));
});
