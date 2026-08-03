import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { checkEntitlement, isBenefitIncluded, grantEntitlement, checkUsageRemaining, type EntitlementContext } from '@/server/agents/subscriptions/entitlement-engine';
import { InMemoryPlanStore } from '@/server/agents/subscriptions/plan-store';
import { InMemorySubscriptionStore, type Subscription } from '@/server/agents/subscriptions/subscription-store';
import { draftPlanVersion, approveAndActivatePlan, type PlanServiceContext, type DraftPlanVersionInput } from '@/server/agents/subscriptions/plan-service';

const FIXED = new Date('2026-08-01T09:00:00.000Z');

function ctx(): EntitlementContext & { planStore: InMemoryPlanStore; subscriptionStore: InMemorySubscriptionStore } {
  return { planStore: new InMemoryPlanStore(), subscriptionStore: new InMemorySubscriptionStore(), correlationId: `corr-${randomUUID().slice(0, 8)}`, now: () => FIXED };
}

function baseSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    subscriptionId: randomUUID(), contactId: randomUUID(), corporateAccountId: null, planVersionId: '',
    scheduledPlanVersionId: null, status: 'ACTIVE', billingCycle: 'MONTHLY', startDate: '2026-07-01',
    currentPeriodEnd: '2026-09-01', nextPaymentDate: '2026-09-01', cancelAtPeriodEnd: false, gracePeriodEndsAt: null,
    humanOverrideReason: null, humanOverrideBy: null, correlationId: 'corr-test', createdAt: FIXED.toISOString(), updatedAt: FIXED.toISOString(),
    ...overrides
  };
}

async function activePlanAndGrantedSubscription(c: ReturnType<typeof ctx>, planCode: DraftPlanVersionInput['planCode'] = 'PERSONAL_PLUS', priceMinorUnits = 3900) {
  const planCtx: PlanServiceContext = { store: c.planStore, correlationId: c.correlationId, now: c.now };
  const { planVersionId } = await draftPlanVersion(planCtx, {
    planCode, planType: 'PERSONAL', billingCycle: 'MONTHLY', priceMinorUnits, currency: 'AZN',
    benefits: ['Priority support', 'Dedicated concierge'], usageLimits: { tripsPerMonth: 5 }, servicePrivileges: ['ENHANCED_CONCIERGE'],
    seatOrTravellerLimit: null, activationDate: '2026-01-01', retirementDate: null
  });
  await approveAndActivatePlan(planCtx, planVersionId, randomUUID());

  const subscription = baseSubscription({ planVersionId });
  await c.subscriptionStore.saveSubscription(subscription);
  await grantEntitlement(c, subscription.subscriptionId, planVersionId, null);
  return { subscriptionId: subscription.subscriptionId, planVersionId };
}

test('an active subscription with a valid grant from an active plan is entitled, with real benefits from the plan', async () => {
  const c = ctx();
  const { subscriptionId } = await activePlanAndGrantedSubscription(c);
  const result = await checkEntitlement(c, subscriptionId);
  assert.equal(result.planActive, true);
  assert.deepEqual(result.benefits, ['Priority support', 'Dedicated concierge']);
});

test('a subscription with no entitlement grant at all is denied, even if a plan exists and is active', async () => {
  const c = ctx();
  const planCtx: PlanServiceContext = { store: c.planStore, correlationId: c.correlationId, now: c.now };
  const { planVersionId } = await draftPlanVersion(planCtx, {
    planCode: 'PERSONAL_SMART', planType: 'PERSONAL', billingCycle: 'MONTHLY', priceMinorUnits: 1900, currency: 'AZN',
    benefits: ['Some benefit'], usageLimits: {}, servicePrivileges: [], seatOrTravellerLimit: null, activationDate: null, retirementDate: null
  });
  await approveAndActivatePlan(planCtx, planVersionId, randomUUID());
  const subscription = baseSubscription({ planVersionId });
  await c.subscriptionStore.saveSubscription(subscription);
  const result = await checkEntitlement(c, subscription.subscriptionId);
  assert.equal(result.planActive, false);
  assert.ok(result.reason.includes('No entitlement grant'));
});

test('checking an unknown benefit name never returns true just because the plan exists', async () => {
  const c = ctx();
  const { subscriptionId } = await activePlanAndGrantedSubscription(c);
  const included = await isBenefitIncluded(c, subscriptionId, 'A benefit that was never approved');
  assert.equal(included, false);
});

test('a CANCELLED subscription is denied access', async () => {
  const c = ctx();
  const { subscriptionId } = await activePlanAndGrantedSubscription(c);
  const sub = await c.subscriptionStore.loadSubscription(subscriptionId);
  await c.subscriptionStore.saveSubscription({ ...sub!, status: 'CANCELLED' });
  const result = await checkEntitlement(c, subscriptionId);
  assert.equal(result.planActive, false);
});

test('a SUSPENDED subscription is denied access', async () => {
  const c = ctx();
  const { subscriptionId } = await activePlanAndGrantedSubscription(c);
  const sub = await c.subscriptionStore.loadSubscription(subscriptionId);
  await c.subscriptionStore.saveSubscription({ ...sub!, status: 'SUSPENDED' });
  const result = await checkEntitlement(c, subscriptionId);
  assert.equal(result.planActive, false);
});

test('a GRACE_PERIOD subscription still grants access (it is in ACCESS_GRANTING_STATUSES)', async () => {
  const c = ctx();
  const { subscriptionId } = await activePlanAndGrantedSubscription(c);
  const sub = await c.subscriptionStore.loadSubscription(subscriptionId);
  await c.subscriptionStore.saveSubscription({ ...sub!, status: 'GRACE_PERIOD' });
  const result = await checkEntitlement(c, subscriptionId);
  assert.equal(result.planActive, true);
});

test('an expired entitlement grant denies access even if the subscription status is ACTIVE', async () => {
  const c = ctx();
  const { subscriptionId, planVersionId } = await activePlanAndGrantedSubscription(c);
  await c.subscriptionStore.saveEntitlementGrant({
    grantId: randomUUID(), subscriptionId, planVersionId, benefitsSnapshot: ['x'], usageLimitsSnapshot: {},
    grantedAt: FIXED.toISOString(), expiresAt: new Date(FIXED.getTime() - 86400000).toISOString(), correlationId: c.correlationId
  });
  const result = await checkEntitlement(c, subscriptionId);
  assert.equal(result.planActive, false);
  assert.ok(result.reason.includes('expired'));
});

test('a plan that has since been retired stops authorizing access even though the grant snapshot still exists', async () => {
  const c = ctx();
  const { subscriptionId, planVersionId } = await activePlanAndGrantedSubscription(c);
  const plan = await c.planStore.loadPlanVersion(planVersionId);
  await c.planStore.savePlanVersion({ ...plan!, status: 'RETIRED' });
  const result = await checkEntitlement(c, subscriptionId);
  assert.equal(result.planActive, false);
});

test('checkEntitlement for one subscription never reflects another customer\'s grant', async () => {
  const c = ctx();
  const a = await activePlanAndGrantedSubscription(c, 'PERSONAL_SMART', 1900);
  const b = await activePlanAndGrantedSubscription(c, 'PERSONAL_BLACK', 29900);
  const resultA = await checkEntitlement(c, a.subscriptionId);
  const resultB = await checkEntitlement(c, b.subscriptionId);
  assert.notEqual(resultA.planCode, resultB.planCode);
  assert.equal(resultA.planCode, 'PERSONAL_SMART');
  assert.equal(resultB.planCode, 'PERSONAL_BLACK');
});

test('a human override is surfaced explicitly with the reason and who granted it, never silently applied', async () => {
  const c = ctx();
  const { subscriptionId } = await activePlanAndGrantedSubscription(c);
  const sub = await c.subscriptionStore.loadSubscription(subscriptionId);
  const overrider = randomUUID();
  await c.subscriptionStore.saveSubscription({ ...sub!, status: 'SUSPENDED', humanOverrideReason: 'Goodwill gesture after service issue', humanOverrideBy: overrider });
  const result = await checkEntitlement(c, subscriptionId);
  assert.equal(result.planActive, true);
  assert.equal(result.hasHumanOverride, true);
  assert.ok(result.reason.includes(overrider));
  assert.ok(result.reason.includes('Goodwill gesture'));
});

test('checkUsageRemaining returns null (not a fabricated number) when the plan defines no limit for that key', async () => {
  const c = ctx();
  const { subscriptionId } = await activePlanAndGrantedSubscription(c);
  const result = await checkUsageRemaining(c, subscriptionId, 'someUndefinedUsageKey', '2026-08-01');
  assert.equal(result.limit, null);
  assert.equal(result.remaining, null);
});

test('checkUsageRemaining computes the real remaining amount from recorded usage', async () => {
  const c = ctx();
  const { subscriptionId } = await activePlanAndGrantedSubscription(c);
  await c.subscriptionStore.recordUsage(subscriptionId, 'tripsPerMonth', 2, '2026-08-01', '2026-08-31');
  const result = await checkUsageRemaining(c, subscriptionId, 'tripsPerMonth', '2026-08-01');
  assert.equal(result.limit, 5);
  assert.equal(result.used, 2);
  assert.equal(result.remaining, 3);
});
