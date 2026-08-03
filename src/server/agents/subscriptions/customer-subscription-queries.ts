import 'server-only';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { LOCKED_PLAN_PRICES, planCodes, type PlanCode } from './plan-authority';

/**
 * Phase 4F — customer-facing subscription read model. Plan comparison is
 * built from `LOCKED_PLAN_PRICES` (the founder's own locked catalog) and
 * whatever real ACTIVE plan_versions rows exist for benefits/privileges —
 * never from a separately maintained marketing copy that could drift from
 * the approved prices. Enterprise is deliberately excluded from the public
 * comparison entirely.
 */

export type PlanComparisonEntry = {
  planCode: PlanCode;
  monthlyPriceMinorUnits: number | null;
  annualPriceMinorUnits: number | null;
  benefits: string[];
  currency: string;
};

export type CurrentMembership = {
  subscriptionId: string;
  planCode: string;
  status: string;
  billingCycle: string;
  currentPeriodEnd: string | null;
  nextPaymentDate: string | null;
  cancelAtPeriodEnd: boolean;
  gracePeriodEndsAt: string | null;
} | null;

export type PaymentHistoryEntry = { eventId: string; transactionType: string; amountMinorUnits: number | null; currency: string | null; accepted: boolean; receivedAt: string };

const PUBLIC_PLAN_CODES: readonly PlanCode[] = planCodes.filter((c) => c !== 'CORPORATE_ENTERPRISE');

export async function loadPlanComparison(): Promise<PlanComparisonEntry[]> {
  const admin = createAdminSupabaseClient();
  const benefitsByCode = new Map<string, string[]>();
  if (admin) {
    const { data } = await admin.from('plan_versions').select('plan_code, benefits, currency').eq('status', 'ACTIVE');
    for (const row of data ?? []) {
      benefitsByCode.set(row.plan_code, Array.isArray(row.benefits) ? row.benefits : []);
    }
  }
  return PUBLIC_PLAN_CODES.map((planCode) => ({
    planCode,
    monthlyPriceMinorUnits: LOCKED_PLAN_PRICES[planCode].MONTHLY,
    annualPriceMinorUnits: LOCKED_PLAN_PRICES[planCode].ANNUAL,
    benefits: benefitsByCode.get(planCode) ?? [],
    currency: 'AZN'
  }));
}

export async function loadCurrentMembership(accountId: string): Promise<CurrentMembership> {
  const admin = createAdminSupabaseClient();
  if (!admin) return null;
  const { data: contactRows } = await admin.from('contacts').select('id').eq('account_id', accountId);
  const contactIds = (contactRows ?? []).map((r) => r.id);
  if (contactIds.length === 0) return null;

  const { data } = await admin.from('subscriptions')
    .select('id, status, billing_cycle, current_period_end, next_payment_date, cancel_at_period_end, grace_period_ends_at, plan_versions(plan_code)')
    .in('contact_id', contactIds).in('status', ['ACTIVE', 'GRACE_PERIOD', 'PAYMENT_FAILED', 'TRIAL', 'PENDING_PAYMENT', 'RENEWAL_PENDING', 'SCHEDULED_UPGRADE', 'SCHEDULED_DOWNGRADE'])
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  return {
    subscriptionId: data.id, planCode: (data as { plan_versions?: { plan_code?: string } }).plan_versions?.plan_code ?? 'UNKNOWN',
    status: data.status, billingCycle: data.billing_cycle, currentPeriodEnd: data.current_period_end,
    nextPaymentDate: data.next_payment_date, cancelAtPeriodEnd: data.cancel_at_period_end, gracePeriodEndsAt: data.grace_period_ends_at
  };
}

export async function loadPaymentHistory(subscriptionId: string): Promise<PaymentHistoryEntry[]> {
  const admin = createAdminSupabaseClient();
  if (!admin) return [];
  const { data } = await admin.from('renewal_events').select('id, transaction_type, amount_minor_units, currency, accepted, received_at')
    .eq('subscription_id', subscriptionId).order('received_at', { ascending: false }).limit(24);
  return (data ?? []).map((r) => ({ eventId: r.id, transactionType: r.transaction_type, amountMinorUnits: r.amount_minor_units, currency: r.currency, accepted: r.accepted, receivedAt: r.received_at }));
}

export async function loadEntitlementUsageSummary(subscriptionId: string): Promise<Array<{ usageKey: string; usedAmount: number; periodStart: string; periodEnd: string }>> {
  const admin = createAdminSupabaseClient();
  if (!admin) return [];
  const { data } = await admin.from('entitlement_usage').select('usage_key, used_amount, period_start, period_end').eq('subscription_id', subscriptionId).order('period_start', { ascending: false }).limit(12);
  return (data ?? []).map((r) => ({ usageKey: r.usage_key, usedAmount: Number(r.used_amount), periodStart: r.period_start, periodEnd: r.period_end }));
}
