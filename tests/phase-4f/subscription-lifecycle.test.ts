import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  createSubscription, activateAfterReconciledPayment, markRenewalPending, markPaymentFailed, enterGracePeriod, renewAfterReconciledPayment,
  cancelAtPeriodEnd, suspendSubscription, finalizeCancellation, expireSubscription, scheduleUpgradeOrDowngrade, applyScheduledPlanChange,
  SubscriptionAuthorityError, type SubscriptionLifecycleContext
} from '@/server/agents/subscriptions/subscription-lifecycle';
import { InMemorySubscriptionStore } from '@/server/agents/subscriptions/subscription-store';
import { InMemoryPlanStore } from '@/server/agents/subscriptions/plan-store';
import { draftPlanVersion, approveAndActivatePlan, type PlanServiceContext, type DraftPlanVersionInput } from '@/server/agents/subscriptions/plan-service';

const FIXED = new Date('2026-08-01T09:00:00.000Z');

function ctx(): SubscriptionLifecycleContext & { subscriptionStore: InMemorySubscriptionStore; planStore: InMemoryPlanStore } {
  return { subscriptionStore: new InMemorySubscriptionStore(), planStore: new InMemoryPlanStore(), correlationId: `corr-${randomUUID().slice(0, 8)}`, now: () => FIXED };
}

async function activePlan(c: ReturnType<typeof ctx>, planCode: DraftPlanVersionInput['planCode'] = 'PERSONAL_PLUS', priceMinorUnits = 3900) {
  const planCtx: PlanServiceContext = { store: c.planStore, correlationId: c.correlationId, now: c.now };
  const { planVersionId } = await draftPlanVersion(planCtx, {
    planCode, planType: 'PERSONAL', billingCycle: 'MONTHLY', priceMinorUnits, currency: 'AZN',
    benefits: ['Priority support'], usageLimits: {}, servicePrivileges: [], seatOrTravellerLimit: null, activationDate: '2026-01-01', retirementDate: null
  });
  await approveAndActivatePlan(planCtx, planVersionId, randomUUID());
  return planVersionId;
}

test('a new subscription always starts PENDING_PAYMENT, never ACTIVE', async () => {
  const c = ctx();
  const planVersionId = await activePlan(c);
  const contactId = randomUUID();
  const { subscriptionId } = await createSubscription(c, { contactId, corporateAccountId: null, planVersionId, billingCycle: 'MONTHLY' });
  const sub = await c.subscriptionStore.loadSubscription(subscriptionId);
  assert.equal(sub?.status, 'PENDING_PAYMENT');
});

test('activation is refused without a real reconciled renewal event id', async () => {
  const c = ctx();
  const planVersionId = await activePlan(c);
  const { subscriptionId } = await createSubscription(c, { contactId: randomUUID(), corporateAccountId: null, planVersionId, billingCycle: 'MONTHLY' });
  await assert.rejects(
    () => activateAfterReconciledPayment(c, subscriptionId, '', '2026-09-01', '2026-09-01'),
    (e: unknown) => e instanceof SubscriptionAuthorityError && e.code === 'PAYMENT_NOT_RECONCILED'
  );
});

test('activation with a real reconciled renewal event id succeeds and grants entitlements', async () => {
  const c = ctx();
  const planVersionId = await activePlan(c);
  const { subscriptionId } = await createSubscription(c, { contactId: randomUUID(), corporateAccountId: null, planVersionId, billingCycle: 'MONTHLY' });
  await activateAfterReconciledPayment(c, subscriptionId, `evt-${randomUUID()}`, '2026-09-01', '2026-09-01');
  const sub = await c.subscriptionStore.loadSubscription(subscriptionId);
  assert.equal(sub?.status, 'ACTIVE');
  const grant = await c.subscriptionStore.loadLatestEntitlementGrant(subscriptionId);
  assert.ok(grant);
});

test('a contact cannot have two active subscriptions — creating a second is refused', async () => {
  const c = ctx();
  const planVersionId = await activePlan(c);
  const contactId = randomUUID();
  const { subscriptionId: first } = await createSubscription(c, { contactId, corporateAccountId: null, planVersionId, billingCycle: 'MONTHLY' });
  await activateAfterReconciledPayment(c, first, `evt-${randomUUID()}`, '2026-09-01', '2026-09-01');
  await assert.rejects(
    () => createSubscription(c, { contactId, corporateAccountId: null, planVersionId, billingCycle: 'MONTHLY' }),
    (e: unknown) => e instanceof SubscriptionAuthorityError && e.code === 'DUPLICATE_ACTIVE'
  );
});

test('a subscription must belong to exactly one of contactId/corporateAccountId, never both, never neither', async () => {
  const c = ctx();
  const planVersionId = await activePlan(c);
  await assert.rejects(
    () => createSubscription(c, { contactId: randomUUID(), corporateAccountId: randomUUID(), planVersionId, billingCycle: 'MONTHLY' }),
    (e: unknown) => e instanceof SubscriptionAuthorityError && e.code === 'VALIDATION'
  );
  await assert.rejects(
    () => createSubscription(c, { contactId: null, corporateAccountId: null, planVersionId, billingCycle: 'MONTHLY' }),
    (e: unknown) => e instanceof SubscriptionAuthorityError && e.code === 'VALIDATION'
  );
});

test('a full failed-payment -> grace-period -> recovered-active journey works correctly', async () => {
  const c = ctx();
  const planVersionId = await activePlan(c);
  const { subscriptionId } = await createSubscription(c, { contactId: randomUUID(), corporateAccountId: null, planVersionId, billingCycle: 'MONTHLY' });
  await activateAfterReconciledPayment(c, subscriptionId, `evt-${randomUUID()}`, '2026-09-01', '2026-09-01');
  await markRenewalPending(c, subscriptionId);
  await markPaymentFailed(c, subscriptionId, 'CARD_DECLINED');
  assert.equal((await c.subscriptionStore.loadSubscription(subscriptionId))?.status, 'PAYMENT_FAILED');
  await enterGracePeriod(c, subscriptionId, '2026-09-08T00:00:00.000Z');
  assert.equal((await c.subscriptionStore.loadSubscription(subscriptionId))?.status, 'GRACE_PERIOD');
  await renewAfterReconciledPayment(c, subscriptionId, `evt-${randomUUID()}`, '2026-10-01', '2026-10-01');
  assert.equal((await c.subscriptionStore.loadSubscription(subscriptionId))?.status, 'ACTIVE');
});

test('grace period with no recovery correctly transitions to EXPIRED', async () => {
  const c = ctx();
  const planVersionId = await activePlan(c);
  const { subscriptionId } = await createSubscription(c, { contactId: randomUUID(), corporateAccountId: null, planVersionId, billingCycle: 'MONTHLY' });
  await activateAfterReconciledPayment(c, subscriptionId, `evt-${randomUUID()}`, '2026-09-01', '2026-09-01');
  await markRenewalPending(c, subscriptionId);
  await markPaymentFailed(c, subscriptionId, 'CARD_DECLINED');
  await enterGracePeriod(c, subscriptionId, '2026-09-08T00:00:00.000Z');
  await expireSubscription(c, subscriptionId);
  assert.equal((await c.subscriptionStore.loadSubscription(subscriptionId))?.status, 'EXPIRED');
});

test('a CANCELLED subscription cannot transition anywhere else — it is terminal', async () => {
  const c = ctx();
  const planVersionId = await activePlan(c);
  const { subscriptionId } = await createSubscription(c, { contactId: randomUUID(), corporateAccountId: null, planVersionId, billingCycle: 'MONTHLY' });
  await activateAfterReconciledPayment(c, subscriptionId, `evt-${randomUUID()}`, '2026-09-01', '2026-09-01');
  await suspendSubscription(c, subscriptionId, randomUUID(), 'FRAUD_REVIEW');
  await finalizeCancellation(c, subscriptionId, randomUUID());
  await assert.rejects(
    () => suspendSubscription(c, subscriptionId, randomUUID(), 'x'),
    (e: unknown) => e instanceof SubscriptionAuthorityError && e.code === 'INVALID_TRANSITION'
  );
});

test('PENDING_PAYMENT cannot jump directly to SUSPENDED — must go through ACTIVE first', async () => {
  const c = ctx();
  const planVersionId = await activePlan(c);
  const { subscriptionId } = await createSubscription(c, { contactId: randomUUID(), corporateAccountId: null, planVersionId, billingCycle: 'MONTHLY' });
  await assert.rejects(
    () => suspendSubscription(c, subscriptionId, randomUUID(), 'x'),
    (e: unknown) => e instanceof SubscriptionAuthorityError && e.code === 'INVALID_TRANSITION'
  );
});

test('cancelAtPeriodEnd is refused without a real human actor id', async () => {
  const c = ctx();
  const planVersionId = await activePlan(c);
  const { subscriptionId } = await createSubscription(c, { contactId: randomUUID(), corporateAccountId: null, planVersionId, billingCycle: 'MONTHLY' });
  await activateAfterReconciledPayment(c, subscriptionId, `evt-${randomUUID()}`, '2026-09-01', '2026-09-01');
  await assert.rejects(
    () => cancelAtPeriodEnd(c, subscriptionId, ''),
    (e: unknown) => e instanceof SubscriptionAuthorityError && e.code === 'VALIDATION'
  );
});

test('cancelAtPeriodEnd with a real human actor sets the flag and records the event, without immediately cancelling', async () => {
  const c = ctx();
  const planVersionId = await activePlan(c);
  const { subscriptionId } = await createSubscription(c, { contactId: randomUUID(), corporateAccountId: null, planVersionId, billingCycle: 'MONTHLY' });
  await activateAfterReconciledPayment(c, subscriptionId, `evt-${randomUUID()}`, '2026-09-01', '2026-09-01');
  const canceller = randomUUID();
  await cancelAtPeriodEnd(c, subscriptionId, canceller);
  const sub = await c.subscriptionStore.loadSubscription(subscriptionId);
  assert.equal(sub?.cancelAtPeriodEnd, true);
  assert.equal(sub?.status, 'ACTIVE');
  const events = c.subscriptionStore.eventsFor(subscriptionId);
  assert.ok(events.some((e) => e.kind === 'CANCEL_AT_PERIOD_END_REQUESTED' && e.actorId === canceller));
});

test('scheduling an upgrade requires the target plan to be genuinely active', async () => {
  const c = ctx();
  const planVersionId = await activePlan(c, 'PERSONAL_SMART', 1900);
  const { subscriptionId } = await createSubscription(c, { contactId: randomUUID(), corporateAccountId: null, planVersionId, billingCycle: 'MONTHLY' });
  await activateAfterReconciledPayment(c, subscriptionId, `evt-${randomUUID()}`, '2026-09-01', '2026-09-01');

  const planCtx: PlanServiceContext = { store: c.planStore, correlationId: c.correlationId, now: c.now };
  const { planVersionId: draftTargetId } = await draftPlanVersion(planCtx, {
    planCode: 'PERSONAL_PLUS', planType: 'PERSONAL', billingCycle: 'MONTHLY', priceMinorUnits: 3900, currency: 'AZN',
    benefits: [], usageLimits: {}, servicePrivileges: [], seatOrTravellerLimit: null, activationDate: null, retirementDate: null
  });
  await assert.rejects(
    () => scheduleUpgradeOrDowngrade(c, subscriptionId, draftTargetId, 'UPGRADE', randomUUID()),
    (e: unknown) => e !== null && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'NOT_ACTIVE'
  );
});

test('a scheduled upgrade applies at renewal and re-grants entitlements against the new plan', async () => {
  const c = ctx();
  const smartId = await activePlan(c, 'PERSONAL_SMART', 1900);
  const { subscriptionId } = await createSubscription(c, { contactId: randomUUID(), corporateAccountId: null, planVersionId: smartId, billingCycle: 'MONTHLY' });
  await activateAfterReconciledPayment(c, subscriptionId, `evt-${randomUUID()}`, '2026-09-01', '2026-09-01');

  const plusId = await activePlan(c, 'PERSONAL_PLUS', 3900);
  const requester = randomUUID();
  await scheduleUpgradeOrDowngrade(c, subscriptionId, plusId, 'UPGRADE', requester);
  assert.equal((await c.subscriptionStore.loadSubscription(subscriptionId))?.status, 'SCHEDULED_UPGRADE');

  await applyScheduledPlanChange(c, subscriptionId, `evt-${randomUUID()}`, '2026-10-01', '2026-10-01');
  const sub = await c.subscriptionStore.loadSubscription(subscriptionId);
  assert.equal(sub?.status, 'ACTIVE');
  assert.equal(sub?.planVersionId, plusId);
  const grants = c.subscriptionStore.allGrantsFor(subscriptionId);
  assert.equal(grants.length, 2);
  assert.equal(grants[grants.length - 1].planVersionId, plusId);
});

test('every lifecycle transition is recorded as an append-only subscription event', async () => {
  const c = ctx();
  const planVersionId = await activePlan(c);
  const { subscriptionId } = await createSubscription(c, { contactId: randomUUID(), corporateAccountId: null, planVersionId, billingCycle: 'MONTHLY' });
  await activateAfterReconciledPayment(c, subscriptionId, `evt-${randomUUID()}`, '2026-09-01', '2026-09-01');
  await markRenewalPending(c, subscriptionId);
  await markPaymentFailed(c, subscriptionId, 'CARD_DECLINED');
  const events = c.subscriptionStore.eventsFor(subscriptionId);
  assert.ok(events.some((e) => e.kind === 'SUBSCRIPTION_CREATED'));
  assert.ok(events.some((e) => e.kind === 'TRANSITIONED_TO_ACTIVE'));
  assert.ok(events.some((e) => e.kind === 'TRANSITIONED_TO_PAYMENT_FAILED' && e.reasonCode === 'CARD_DECLINED'));
});

test('no function in subscription-lifecycle.ts allows an "agent" actorKind to cancel, suspend, or activate a subscription', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/subscriptions/subscription-lifecycle.ts', import.meta.url), 'utf8');
  const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  // Distinguish the generic helper's TYPE ANNOTATION (`actorKind: 'human' | 'agent' | 'system'`,
  // a legitimate general-purpose signature on the `async function transition(...)` definition)
  // from an actual CALL SITE passing 'agent' as a value — only the latter
  // would mean some transition is attributable to an AI agent actor.
  const withoutDefinition = codeOnly.replace(/async function transition\([^{]*\{/, 'async function transition() {');
  const callSiteUsages = withoutDefinition.match(/transition\(ctx\.[^)]*'agent'[^)]*\)/g) ?? [];
  assert.equal(callSiteUsages.length, 0, 'no transition() call site in this file should pass \'agent\' as the actor kind');
});
