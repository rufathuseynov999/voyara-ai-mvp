import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  registerPaymentToken, reconcileRenewalWebhook, recordFailedPaymentWebhook, cancelFutureRenewal,
  signRenewalWebhook, verifyRenewalWebhookSignature, InMemoryRecurringPaymentStore, RecurringPaymentError,
  type RecurringPaymentContext
} from '@/server/agents/subscriptions/recurring-payment-service';
import { InMemoryPlanStore } from '@/server/agents/subscriptions/plan-store';
import { draftPlanVersion, approveAndActivatePlan, type PlanServiceContext } from '@/server/agents/subscriptions/plan-service';

const FIXED = new Date('2026-08-01T09:00:00.000Z');
const SECRET = 'r'.repeat(32);

function ctx(): RecurringPaymentContext & { store: InMemoryRecurringPaymentStore; planStore: InMemoryPlanStore } {
  return { store: new InMemoryRecurringPaymentStore(), planStore: new InMemoryPlanStore(), correlationId: `corr-${randomUUID().slice(0, 8)}`, now: () => FIXED };
}

async function activePlan(c: ReturnType<typeof ctx>) {
  const planCtx: PlanServiceContext = { store: c.planStore, correlationId: c.correlationId, now: c.now };
  const { planVersionId } = await draftPlanVersion(planCtx, {
    planCode: 'PERSONAL_PLUS', planType: 'PERSONAL', billingCycle: 'MONTHLY', priceMinorUnits: 3900, currency: 'AZN',
    benefits: [], usageLimits: {}, servicePrivileges: [], seatOrTravellerLimit: null, activationDate: null, retirementDate: null
  });
  await approveAndActivatePlan(planCtx, planVersionId, randomUUID());
  return planVersionId;
}

test('registering a real token reference succeeds', async () => {
  const c = ctx();
  const { tokenId } = await registerPaymentToken(c, { contactId: randomUUID(), corporateAccountId: null, providerTokenReference: 'tok_sim_abc123', maskedDisplay: '**** 4242', status: 'ACTIVE' });
  const token = await c.store.loadToken(tokenId);
  assert.equal(token?.status, 'ACTIVE');
});

test('a token reference containing a raw card number is refused', async () => {
  const c = ctx();
  await assert.rejects(
    () => registerPaymentToken(c, { contactId: randomUUID(), corporateAccountId: null, providerTokenReference: '4111 1111 1111 1111', maskedDisplay: null, status: 'ACTIVE' }),
    (e: unknown) => e instanceof RecurringPaymentError && e.code === 'CARD_DATA_REJECTED'
  );
});

test('a token reference referencing a CVV is refused', async () => {
  const c = ctx();
  await assert.rejects(
    () => registerPaymentToken(c, { contactId: randomUUID(), corporateAccountId: null, providerTokenReference: 'cvv_999_stored', maskedDisplay: null, status: 'ACTIVE' }),
    (e: unknown) => e instanceof RecurringPaymentError && e.code === 'CARD_DATA_REJECTED'
  );
});

test('a renewal webhook with the exact plan price and currency is reconciled successfully', async () => {
  const c = ctx();
  const planVersionId = await activePlan(c);
  const result = await reconcileRenewalWebhook(c, { externalEventId: `evt-${randomUUID()}`, subscriptionId: randomUUID(), transactionType: 'RENEWAL', amountMinorUnits: 3900, currency: 'AZN', planVersionId });
  assert.equal(result.accepted, true);
});

test('a renewal webhook with a mismatched amount is refused', async () => {
  const c = ctx();
  const planVersionId = await activePlan(c);
  await assert.rejects(
    () => reconcileRenewalWebhook(c, { externalEventId: `evt-${randomUUID()}`, subscriptionId: randomUUID(), transactionType: 'RENEWAL', amountMinorUnits: 999, currency: 'AZN', planVersionId }),
    (e: unknown) => e instanceof RecurringPaymentError && e.code === 'AMOUNT_MISMATCH'
  );
});

test('a renewal webhook with a mismatched currency is refused', async () => {
  const c = ctx();
  const planVersionId = await activePlan(c);
  await assert.rejects(
    () => reconcileRenewalWebhook(c, { externalEventId: `evt-${randomUUID()}`, subscriptionId: randomUUID(), transactionType: 'RENEWAL', amountMinorUnits: 3900, currency: 'USD', planVersionId }),
    (e: unknown) => e instanceof RecurringPaymentError && e.code === 'CURRENCY_MISMATCH'
  );
});

test('a renewal webhook citing a non-active plan is refused', async () => {
  const c = ctx();
  const planCtx: PlanServiceContext = { store: c.planStore, correlationId: c.correlationId, now: c.now };
  const { planVersionId } = await draftPlanVersion(planCtx, {
    planCode: 'PERSONAL_SMART', planType: 'PERSONAL', billingCycle: 'MONTHLY', priceMinorUnits: 1900, currency: 'AZN',
    benefits: [], usageLimits: {}, servicePrivileges: [], seatOrTravellerLimit: null, activationDate: null, retirementDate: null
  });
  await assert.rejects(() => reconcileRenewalWebhook(c, { externalEventId: `evt-${randomUUID()}`, subscriptionId: randomUUID(), transactionType: 'RENEWAL', amountMinorUnits: 1900, currency: 'AZN', planVersionId }));
});

test('a duplicate renewal webhook event id is rejected, never double-reconciled', async () => {
  const c = ctx();
  const planVersionId = await activePlan(c);
  const externalEventId = `evt-${randomUUID()}`;
  await reconcileRenewalWebhook(c, { externalEventId, subscriptionId: randomUUID(), transactionType: 'RENEWAL', amountMinorUnits: 3900, currency: 'AZN', planVersionId });
  await assert.rejects(
    () => reconcileRenewalWebhook(c, { externalEventId, subscriptionId: randomUUID(), transactionType: 'RENEWAL', amountMinorUnits: 3900, currency: 'AZN', planVersionId }),
    (e: unknown) => e instanceof RecurringPaymentError && e.code === 'DUPLICATE_EVENT'
  );
});

test('a duplicate failed-payment webhook event id is rejected', async () => {
  const c = ctx();
  const externalEventId = `evt-${randomUUID()}`;
  await recordFailedPaymentWebhook(c, { externalEventId, subscriptionId: randomUUID(), reasonCode: 'CARD_DECLINED' });
  await assert.rejects(
    () => recordFailedPaymentWebhook(c, { externalEventId, subscriptionId: randomUUID(), reasonCode: 'CARD_DECLINED' }),
    (e: unknown) => e instanceof RecurringPaymentError && e.code === 'DUPLICATE_EVENT'
  );
});

test('cancelling future renewals is recorded and never triggers a refund of any kind', async () => {
  const c = ctx();
  const subscriptionId = randomUUID();
  await cancelFutureRenewal(c, subscriptionId);
  assert.equal(await c.store.isFutureRenewalCancelled(subscriptionId), true);
});

test('no function anywhere in recurring-payment-service.ts issues a refund', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/subscriptions/recurring-payment-service.ts', import.meta.url), 'utf8');
  const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/issueRefund|executeRefund|processRefund|function.*[Rr]efund\(/i.test(codeOnly));
});

test('a correctly signed webhook verifies', () => {
  const timestamp = FIXED.toISOString();
  const body = JSON.stringify({ test: 'payload' });
  const signature = signRenewalWebhook(SECRET, timestamp, body);
  assert.equal(verifyRenewalWebhookSignature(SECRET, timestamp, body, signature), true);
});

test('a tampered body invalidates the signature', () => {
  const timestamp = FIXED.toISOString();
  const body = JSON.stringify({ test: 'payload' });
  const signature = signRenewalWebhook(SECRET, timestamp, body);
  assert.equal(verifyRenewalWebhookSignature(SECRET, timestamp, JSON.stringify({ test: 'tampered' }), signature), false);
});
