import { randomUUID } from 'node:crypto';
import type { PlanStore } from './plan-store';
import { requireActivePlanAuthority, type PlanServiceContext } from './plan-service';
import type { SubscriptionStore } from './subscription-store';

/**
 * Phase 4F — deterministic entitlement engine.
 *
 * `checkEntitlement` is the ONLY function anywhere in this project that may
 * answer "is this customer allowed to use this benefit" — and it always
 * traces back through a real `entitlement_grants` row to an approved plan
 * version and an active subscription. There is no code path that grants
 * access from pricing-card copy, marketing text, or an LLM's own
 * description of a plan — those are display text; this is authority.
 *
 * Every check re-verifies three independent things: the subscription is in
 * an access-granting status (not expired/suspended/cancelled), the grant it
 * points to hasn't itself expired, and the underlying plan version is still
 * genuinely active (reusing `requireActivePlanAuthority` unchanged — not a
 * duplicate check). A human override is a real, explicit, must-look-for
 * field on the subscription record, never inferred.
 */

const ACCESS_GRANTING_STATUSES = new Set(['ACTIVE', 'GRACE_PERIOD', 'TRIAL']);

export type EntitlementContext = { planStore: PlanStore; subscriptionStore: SubscriptionStore; correlationId: string; now: () => Date };

export type EntitlementResult = {
  planActive: boolean;
  planCode: string | null;
  benefits: string[];
  usageLimits: Record<string, unknown>;
  hasHumanOverride: boolean;
  expiresAt: string | null;
  reason: string;
};

export async function checkEntitlement(ctx: EntitlementContext, subscriptionId: string): Promise<EntitlementResult> {
  const subscription = await ctx.subscriptionStore.loadSubscription(subscriptionId);
  if (!subscription) {
    return { planActive: false, planCode: null, benefits: [], usageLimits: {}, hasHumanOverride: false, expiresAt: null, reason: 'Subscription not found.' };
  }

  if (subscription.humanOverrideReason && subscription.humanOverrideBy) {
    const grant = await ctx.subscriptionStore.loadLatestEntitlementGrant(subscriptionId);
    return {
      planActive: true, planCode: null, benefits: grant?.benefitsSnapshot ?? [], usageLimits: grant?.usageLimitsSnapshot ?? {},
      hasHumanOverride: true, expiresAt: grant?.expiresAt ?? null, reason: `Human override by ${subscription.humanOverrideBy}: ${subscription.humanOverrideReason}`
    };
  }

  if (!ACCESS_GRANTING_STATUSES.has(subscription.status)) {
    return { planActive: false, planCode: null, benefits: [], usageLimits: {}, hasHumanOverride: false, expiresAt: null, reason: `Subscription status "${subscription.status}" does not grant access.` };
  }

  const grant = await ctx.subscriptionStore.loadLatestEntitlementGrant(subscriptionId);
  if (!grant) {
    return { planActive: false, planCode: null, benefits: [], usageLimits: {}, hasHumanOverride: false, expiresAt: null, reason: 'No entitlement grant on file for this subscription.' };
  }
  if (grant.expiresAt && new Date(grant.expiresAt).getTime() < ctx.now().getTime()) {
    return { planActive: false, planCode: null, benefits: [], usageLimits: {}, hasHumanOverride: false, expiresAt: grant.expiresAt, reason: 'Entitlement grant has expired.' };
  }

  const planCtx: PlanServiceContext = { store: ctx.planStore, correlationId: ctx.correlationId, now: ctx.now };
  try {
    const plan = await requireActivePlanAuthority(planCtx, grant.planVersionId);
    return {
      planActive: true, planCode: plan.planCode, benefits: grant.benefitsSnapshot, usageLimits: grant.usageLimitsSnapshot,
      hasHumanOverride: false, expiresAt: grant.expiresAt, reason: 'Active subscription with a valid entitlement grant from an active plan.'
    };
  } catch (error) {
    return { planActive: false, planCode: null, benefits: [], usageLimits: {}, hasHumanOverride: false, expiresAt: null, reason: error instanceof Error ? error.message : 'Plan is no longer active.' };
  }
}

export async function isBenefitIncluded(ctx: EntitlementContext, subscriptionId: string, benefit: string): Promise<boolean> {
  const entitlement = await checkEntitlement(ctx, subscriptionId);
  return entitlement.planActive && entitlement.benefits.includes(benefit);
}

export async function grantEntitlement(ctx: EntitlementContext, subscriptionId: string, planVersionId: string, expiresAt: string | null): Promise<{ grantId: string }> {
  const planCtx: PlanServiceContext = { store: ctx.planStore, correlationId: ctx.correlationId, now: ctx.now };
  const plan = await requireActivePlanAuthority(planCtx, planVersionId);

  const grantId = randomUUID();
  await ctx.subscriptionStore.saveEntitlementGrant({
    grantId, subscriptionId, planVersionId, benefitsSnapshot: plan.benefits, usageLimitsSnapshot: plan.usageLimits,
    grantedAt: ctx.now().toISOString(), expiresAt, correlationId: ctx.correlationId
  });
  return { grantId };
}

export async function checkUsageRemaining(ctx: EntitlementContext, subscriptionId: string, usageKey: string, periodStart: string): Promise<{ remaining: number | null; used: number; limit: number | null }> {
  const entitlement = await checkEntitlement(ctx, subscriptionId);
  const limit = typeof entitlement.usageLimits[usageKey] === 'number' ? (entitlement.usageLimits[usageKey] as number) : null;
  const used = await ctx.subscriptionStore.loadUsage(subscriptionId, usageKey, periodStart);
  return { remaining: limit === null ? null : Math.max(0, limit - used), used, limit };
}
