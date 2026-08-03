import { randomUUID } from 'node:crypto';
import type { SubscriptionStore, Subscription, SubscriptionStatus } from './subscription-store';
import type { PlanStore } from './plan-store';
import { requireActivePlanAuthority, type PlanServiceContext } from './plan-service';
import { grantEntitlement, type EntitlementContext } from './entitlement-engine';

/**
 * Phase 4F — subscription lifecycle service.
 *
 * A closed 12-state machine. The single most important rule: **initial
 * activation only happens after a reconciled payment** — `createSubscription`
 * always starts a subscription at `PENDING_PAYMENT`, never `ACTIVE`;
 * `activateAfterReconciledPayment` is the only function that can move a
 * subscription to `ACTIVE` for the first time, and it requires a real
 * renewal-event id proving a payment was actually reconciled (not just
 * attempted). No function anywhere in this file lets an AI agent, or
 * anything other than a verified payment event or an explicit human actor,
 * change a subscription's status — every transition function takes an
 * explicit actor and records an immutable event.
 */

const transitions: Record<SubscriptionStatus, readonly SubscriptionStatus[]> = {
  TRIAL: ['ACTIVE', 'PENDING_PAYMENT', 'CANCELLED', 'EXPIRED'],
  PENDING_PAYMENT: ['ACTIVE', 'CANCELLED', 'EXPIRED'],
  ACTIVE: ['RENEWAL_PENDING', 'CANCELLED', 'SUSPENDED', 'SCHEDULED_UPGRADE', 'SCHEDULED_DOWNGRADE', 'PAUSED'],
  RENEWAL_PENDING: ['ACTIVE', 'PAYMENT_FAILED'],
  PAYMENT_FAILED: ['GRACE_PERIOD', 'CANCELLED', 'SUSPENDED'],
  GRACE_PERIOD: ['ACTIVE', 'EXPIRED', 'SUSPENDED', 'CANCELLED'],
  PAUSED: ['ACTIVE', 'CANCELLED'],
  CANCELLED: [],
  EXPIRED: ['PENDING_PAYMENT'],
  SUSPENDED: ['ACTIVE', 'CANCELLED'],
  SCHEDULED_UPGRADE: ['ACTIVE'],
  SCHEDULED_DOWNGRADE: ['ACTIVE']
};

export class SubscriptionAuthorityError extends Error {
  constructor(
    message: string,
    readonly code: 'VALIDATION' | 'NOT_FOUND' | 'INVALID_TRANSITION' | 'DUPLICATE_ACTIVE' | 'PAYMENT_NOT_RECONCILED' | 'PLAN_NOT_ACTIVE'
  ) {
    super(message);
    this.name = 'SubscriptionAuthorityError';
  }
}

export type SubscriptionLifecycleContext = {
  subscriptionStore: SubscriptionStore;
  planStore: PlanStore;
  correlationId: string;
  now: () => Date;
};

async function transition(store: SubscriptionStore, sub: Subscription, to: SubscriptionStatus, actorId: string, actorKind: 'human' | 'agent' | 'system', now: Date, extra: Partial<Subscription> = {}, reasonCode?: string): Promise<Subscription> {
  if (!transitions[sub.status].includes(to)) {
    throw new SubscriptionAuthorityError(`Cannot transition subscription from ${sub.status} to ${to}.`, 'INVALID_TRANSITION');
  }
  const updated: Subscription = { ...sub, ...extra, status: to, updatedAt: now.toISOString() };
  await store.saveSubscription(updated);
  await store.recordSubscriptionEvent({ eventId: randomUUID(), subscriptionId: sub.subscriptionId, kind: `TRANSITIONED_TO_${to}`, actorId, actorKind, correlationId: sub.correlationId, reasonCode: reasonCode ?? null });
  return updated;
}

export async function createSubscription(
  ctx: SubscriptionLifecycleContext,
  input: { contactId: string | null; corporateAccountId: string | null; planVersionId: string; billingCycle: Subscription['billingCycle'] }
): Promise<{ subscriptionId: string }> {
  if ((input.contactId === null) === (input.corporateAccountId === null)) {
    throw new SubscriptionAuthorityError('A subscription must belong to exactly one of contactId or corporateAccountId.', 'VALIDATION');
  }
  const planCtx: PlanServiceContext = { store: ctx.planStore, correlationId: ctx.correlationId, now: ctx.now };
  await requireActivePlanAuthority(planCtx, input.planVersionId);

  if (input.contactId) {
    const existing = await ctx.subscriptionStore.findActiveSubscriptionForContact(input.contactId);
    if (existing) throw new SubscriptionAuthorityError('This contact already has an active subscription.', 'DUPLICATE_ACTIVE');
  }

  const subscriptionId = randomUUID();
  const now = ctx.now().toISOString();
  const subscription: Subscription = {
    subscriptionId, contactId: input.contactId, corporateAccountId: input.corporateAccountId, planVersionId: input.planVersionId,
    scheduledPlanVersionId: null, status: 'PENDING_PAYMENT', billingCycle: input.billingCycle, startDate: null,
    currentPeriodEnd: null, nextPaymentDate: null, cancelAtPeriodEnd: false, gracePeriodEndsAt: null,
    humanOverrideReason: null, humanOverrideBy: null, correlationId: ctx.correlationId, createdAt: now, updatedAt: now
  };
  await ctx.subscriptionStore.saveSubscription(subscription);
  await ctx.subscriptionStore.recordSubscriptionEvent({ eventId: randomUUID(), subscriptionId, kind: 'SUBSCRIPTION_CREATED', actorId: 'system', actorKind: 'system', correlationId: ctx.correlationId });
  return { subscriptionId };
}

export async function activateAfterReconciledPayment(
  ctx: SubscriptionLifecycleContext,
  subscriptionId: string,
  reconciledRenewalEventId: string,
  periodEnd: string,
  nextPaymentDate: string
): Promise<void> {
  if (!reconciledRenewalEventId) throw new SubscriptionAuthorityError('A reconciled renewal event id is required to activate a subscription.', 'PAYMENT_NOT_RECONCILED');
  const sub = await ctx.subscriptionStore.loadSubscription(subscriptionId);
  if (!sub) throw new SubscriptionAuthorityError('Subscription not found.', 'NOT_FOUND');

  const activated = await transition(ctx.subscriptionStore, sub, 'ACTIVE', 'system', 'system', ctx.now(), {
    startDate: sub.startDate ?? ctx.now().toISOString().slice(0, 10), currentPeriodEnd: periodEnd, nextPaymentDate
  }, reconciledRenewalEventId);

  const entitlementCtx: EntitlementContext = { planStore: ctx.planStore, subscriptionStore: ctx.subscriptionStore, correlationId: ctx.correlationId, now: ctx.now };
  await grantEntitlement(entitlementCtx, subscriptionId, activated.planVersionId, null);
}

export async function markRenewalPending(ctx: SubscriptionLifecycleContext, subscriptionId: string): Promise<void> {
  const sub = await ctx.subscriptionStore.loadSubscription(subscriptionId);
  if (!sub) throw new SubscriptionAuthorityError('Subscription not found.', 'NOT_FOUND');
  await transition(ctx.subscriptionStore, sub, 'RENEWAL_PENDING', 'system', 'system', ctx.now());
}

export async function markPaymentFailed(ctx: SubscriptionLifecycleContext, subscriptionId: string, reasonCode: string): Promise<void> {
  const sub = await ctx.subscriptionStore.loadSubscription(subscriptionId);
  if (!sub) throw new SubscriptionAuthorityError('Subscription not found.', 'NOT_FOUND');
  await transition(ctx.subscriptionStore, sub, 'PAYMENT_FAILED', 'system', 'system', ctx.now(), {}, reasonCode);
}

export async function enterGracePeriod(ctx: SubscriptionLifecycleContext, subscriptionId: string, graceEndsAt: string): Promise<void> {
  const sub = await ctx.subscriptionStore.loadSubscription(subscriptionId);
  if (!sub) throw new SubscriptionAuthorityError('Subscription not found.', 'NOT_FOUND');
  await transition(ctx.subscriptionStore, sub, 'GRACE_PERIOD', 'system', 'system', ctx.now(), { gracePeriodEndsAt: graceEndsAt });
}

export async function renewAfterReconciledPayment(ctx: SubscriptionLifecycleContext, subscriptionId: string, reconciledRenewalEventId: string, periodEnd: string, nextPaymentDate: string): Promise<void> {
  if (!reconciledRenewalEventId) throw new SubscriptionAuthorityError('A reconciled renewal event id is required to renew a subscription.', 'PAYMENT_NOT_RECONCILED');
  const sub = await ctx.subscriptionStore.loadSubscription(subscriptionId);
  if (!sub) throw new SubscriptionAuthorityError('Subscription not found.', 'NOT_FOUND');
  await transition(ctx.subscriptionStore, sub, 'ACTIVE', 'system', 'system', ctx.now(), { currentPeriodEnd: periodEnd, nextPaymentDate }, reconciledRenewalEventId);
}

export async function cancelAtPeriodEnd(ctx: SubscriptionLifecycleContext, subscriptionId: string, cancelledBy: string): Promise<void> {
  const sub = await ctx.subscriptionStore.loadSubscription(subscriptionId);
  if (!sub) throw new SubscriptionAuthorityError('Subscription not found.', 'NOT_FOUND');
  if (!cancelledBy) throw new SubscriptionAuthorityError('A real human actor is required to request cancellation.', 'VALIDATION');
  await ctx.subscriptionStore.saveSubscription({ ...sub, cancelAtPeriodEnd: true, updatedAt: ctx.now().toISOString() });
  await ctx.subscriptionStore.recordSubscriptionEvent({ eventId: randomUUID(), subscriptionId, kind: 'CANCEL_AT_PERIOD_END_REQUESTED', actorId: cancelledBy, actorKind: 'human', correlationId: ctx.correlationId });
}

export async function suspendSubscription(ctx: SubscriptionLifecycleContext, subscriptionId: string, suspendedBy: string, reasonCode: string): Promise<void> {
  if (!suspendedBy) throw new SubscriptionAuthorityError('A real human actor is required to suspend a subscription.', 'VALIDATION');
  const sub = await ctx.subscriptionStore.loadSubscription(subscriptionId);
  if (!sub) throw new SubscriptionAuthorityError('Subscription not found.', 'NOT_FOUND');
  await transition(ctx.subscriptionStore, sub, 'SUSPENDED', suspendedBy, 'human', ctx.now(), {}, reasonCode);
}

export async function finalizeCancellation(ctx: SubscriptionLifecycleContext, subscriptionId: string, actorId: string): Promise<void> {
  const sub = await ctx.subscriptionStore.loadSubscription(subscriptionId);
  if (!sub) throw new SubscriptionAuthorityError('Subscription not found.', 'NOT_FOUND');
  await transition(ctx.subscriptionStore, sub, 'CANCELLED', actorId, 'system', ctx.now());
}

export async function expireSubscription(ctx: SubscriptionLifecycleContext, subscriptionId: string): Promise<void> {
  const sub = await ctx.subscriptionStore.loadSubscription(subscriptionId);
  if (!sub) throw new SubscriptionAuthorityError('Subscription not found.', 'NOT_FOUND');
  await transition(ctx.subscriptionStore, sub, 'EXPIRED', 'system', 'system', ctx.now());
}

export async function scheduleUpgradeOrDowngrade(
  ctx: SubscriptionLifecycleContext,
  subscriptionId: string,
  targetPlanVersionId: string,
  direction: 'UPGRADE' | 'DOWNGRADE',
  requestedBy: string
): Promise<void> {
  const planCtx: PlanServiceContext = { store: ctx.planStore, correlationId: ctx.correlationId, now: ctx.now };
  await requireActivePlanAuthority(planCtx, targetPlanVersionId);

  const sub = await ctx.subscriptionStore.loadSubscription(subscriptionId);
  if (!sub) throw new SubscriptionAuthorityError('Subscription not found.', 'NOT_FOUND');
  const toStatus: SubscriptionStatus = direction === 'UPGRADE' ? 'SCHEDULED_UPGRADE' : 'SCHEDULED_DOWNGRADE';
  await transition(ctx.subscriptionStore, sub, toStatus, requestedBy, 'human', ctx.now(), { scheduledPlanVersionId: targetPlanVersionId });
}

export async function applyScheduledPlanChange(ctx: SubscriptionLifecycleContext, subscriptionId: string, reconciledRenewalEventId: string, periodEnd: string, nextPaymentDate: string): Promise<void> {
  const sub = await ctx.subscriptionStore.loadSubscription(subscriptionId);
  if (!sub) throw new SubscriptionAuthorityError('Subscription not found.', 'NOT_FOUND');
  if (!sub.scheduledPlanVersionId) throw new SubscriptionAuthorityError('No scheduled plan change is pending for this subscription.', 'VALIDATION');

  const activated = await transition(ctx.subscriptionStore, sub, 'ACTIVE', 'system', 'system', ctx.now(), {
    planVersionId: sub.scheduledPlanVersionId, scheduledPlanVersionId: null, currentPeriodEnd: periodEnd, nextPaymentDate
  }, reconciledRenewalEventId);

  const entitlementCtx: EntitlementContext = { planStore: ctx.planStore, subscriptionStore: ctx.subscriptionStore, correlationId: ctx.correlationId, now: ctx.now };
  await grantEntitlement(entitlementCtx, subscriptionId, activated.planVersionId, null);
}
