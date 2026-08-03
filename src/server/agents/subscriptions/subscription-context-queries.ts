import 'server-only';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import type { PlanStore } from './plan-store';
import { verifyPlanIsActiveAuthority } from './plan-authority';

/**
 * Phase 4G — Phase 4F production subscription/entitlement context queries
 * and the authoritative subscription recommendation service. Reads only —
 * every function here is a plain SELECT against the real Migration 22
 * tables (`subscriptions`, `corporate_accounts`, `entitlement_grants`,
 * `entitlement_usage`), inspected directly before writing this file.
 */

class SubscriptionContextUnavailableError extends Error {
  constructor() {
    super('SUBSCRIPTION_CONTEXT_UNAVAILABLE');
    this.name = 'SubscriptionContextUnavailableError';
  }
}

function admin() {
  const client = createAdminSupabaseClient();
  if (!client) throw new SubscriptionContextUnavailableError();
  return client;
}

export type SubscriptionContext = {
  subscriptionId: string;
  planVersionId: string;
  status: string;
  contactId: string | null;
  corporateAccountId: string | null;
};

export async function loadPersonalSubscriptionContext(contactId: string): Promise<SubscriptionContext | null> {
  const { data, error } = await admin().from('subscriptions').select('id, plan_version_id, status, contact_id, corporate_account_id')
    .eq('contact_id', contactId).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`PERSONAL_SUBSCRIPTION_LOOKUP_FAILED: ${error.message}`);
  if (!data) return null;
  return { subscriptionId: data.id, planVersionId: data.plan_version_id, status: data.status, contactId: data.contact_id, corporateAccountId: data.corporate_account_id };
}

export async function loadCorporateSubscriptionContext(corporateAccountId: string): Promise<SubscriptionContext | null> {
  const { data, error } = await admin().from('subscriptions').select('id, plan_version_id, status, contact_id, corporate_account_id')
    .eq('corporate_account_id', corporateAccountId).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`CORPORATE_SUBSCRIPTION_LOOKUP_FAILED: ${error.message}`);
  if (!data) return null;
  return { subscriptionId: data.id, planVersionId: data.plan_version_id, status: data.status, contactId: data.contact_id, corporateAccountId: data.corporate_account_id };
}

export type EntitlementGrantContext = { benefitsSnapshot: string[]; usageLimitsSnapshot: Record<string, unknown>; expiresAt: string | null };

export async function loadEntitlementGrantContext(subscriptionId: string): Promise<EntitlementGrantContext | null> {
  const { data, error } = await admin().from('entitlement_grants').select('benefits_snapshot, usage_limits_snapshot, expires_at')
    .eq('subscription_id', subscriptionId).order('granted_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`ENTITLEMENT_GRANT_LOOKUP_FAILED: ${error.message}`);
  if (!data) return null;
  return { benefitsSnapshot: data.benefits_snapshot, usageLimitsSnapshot: data.usage_limits_snapshot, expiresAt: data.expires_at };
}

export type EntitlementUsageContext = { usageKey: string; usedAmount: number; periodStart: string; periodEnd: string };

export async function loadEntitlementUsageContext(subscriptionId: string): Promise<EntitlementUsageContext[]> {
  const { data, error } = await admin().from('entitlement_usage').select('usage_key, used_amount, period_start, period_end')
    .eq('subscription_id', subscriptionId);
  if (error) throw new Error(`ENTITLEMENT_USAGE_LOOKUP_FAILED: ${error.message}`);
  return (data ?? []).map((r) => ({ usageKey: r.usage_key, usedAmount: Number(r.used_amount), periodStart: r.period_start, periodEnd: r.period_end }));
}

export type SubscriptionRecommendationResult =
  | { planCode: string; explanation: string; benefits: string[] }
  | { planCode: null; reason: string };

/** Dependency-injected — defaults to the real Supabase-backed lookups in
 *  production, but accepts an injected loader so this function (and its
 *  callers) remain hermetically testable without a live database,
 *  matching the DI pattern used everywhere else in Phase 4G. */
export type SubscriptionContextLoader = {
  loadPersonal(contactId: string): Promise<SubscriptionContext | null>;
  loadCorporate(corporateAccountId: string): Promise<SubscriptionContext | null>;
};

export const defaultSubscriptionContextLoader: SubscriptionContextLoader = {
  loadPersonal: loadPersonalSubscriptionContext,
  loadCorporate: loadCorporateSubscriptionContext
};

export async function recommendSubscriptionFromAuthoritativeContext(
  planStore: PlanStore,
  input: { contactId: string | null; corporateAccountId: string | null; candidatePlanCode: string; candidateBillingCycle: 'MONTHLY' | 'ANNUAL' },
  contextLoader: SubscriptionContextLoader = defaultSubscriptionContextLoader
): Promise<SubscriptionRecommendationResult> {
  if (!input.contactId && !input.corporateAccountId) {
    return { planCode: null, reason: 'No customer or corporate context was supplied — cannot recommend without real identity context.' };
  }

  const existing = input.corporateAccountId
    ? await contextLoader.loadCorporate(input.corporateAccountId)
    : await contextLoader.loadPersonal(input.contactId!);

  if (existing && existing.status === 'ACTIVE') {
    return { planCode: null, reason: `Already has an ACTIVE subscription (${existing.subscriptionId}) — no new recommendation is warranted.` };
  }

  const plan = await planStore.findActivePlan(input.candidatePlanCode as never, input.candidateBillingCycle);
  if (!plan) {
    return { planCode: null, reason: `No ACTIVE, approved plan version exists for "${input.candidatePlanCode}" (${input.candidateBillingCycle}) — nothing to recommend.` };
  }

  try {
    verifyPlanIsActiveAuthority(plan, new Date());
  } catch (error) {
    return { planCode: null, reason: `The matched plan version failed authority re-verification: ${(error as Error).message}` };
  }

  if (plan.planCode === 'CORPORATE_ENTERPRISE') {
    return { planCode: null, reason: 'Enterprise plans are never recommended automatically — they require a custom human-negotiated contract.' };
  }

  return {
    planCode: plan.planCode,
    explanation: `Recommended based on the currently ACTIVE, approved plan version for "${plan.planCode}" (${plan.billingCycle}), approved ${plan.approvedAt}.`,
    benefits: plan.benefits
  };
}
