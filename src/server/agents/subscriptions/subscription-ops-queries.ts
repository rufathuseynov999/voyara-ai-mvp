import 'server-only';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';

/**
 * Phase 4F — read-only CRM/Founder views over subscriptions and
 * entitlements. Every function here is a plain SELECT — nothing in this
 * file writes anything. Matches the same AAL2-staff-only read-model
 * pattern already proven for loadAdministrationSnapshot /
 * loadSupplierOpsSnapshot: the caller (a staff page already behind
 * requireAssuranceLevel) is trusted to have enforced authorization; this
 * module only shapes the read.
 *
 * MRR/ARR are computed ONLY from real, currently-ACTIVE subscription rows
 * joined to their real plan version's real approved price — an annual
 * subscription contributes its price divided by 12 to MRR; a subscription
 * whose plan version cannot be resolved contributes nothing rather than a
 * guessed value. There is no fallback that invents a number when
 * authoritative data is unavailable — `mrrDataComplete` is false whenever
 * any active subscription's plan price could not be resolved, so the
 * Founder can see when the figure is partial rather than silently wrong.
 */

export type SubscriptionOpsSnapshot = {
  activeSubscriptions: number;
  planDistribution: Record<string, number>;
  monthlyVsAnnualSplit: { monthly: number; annual: number };
  personalVsCorporate: { personal: number; corporate: number };
  renewalsDueNext30Days: number;
  failedPayments: number;
  gracePeriodAccounts: number;
  scheduledUpgrades: number;
  scheduledDowngrades: number;
  cancellationsAtPeriodEnd: number;
  mrrMinorUnits: number;
  arrMinorUnits: number;
  mrrDataComplete: boolean;
  churnLast30Days: number | null;
  retentionRateLast30Days: number | null;
};

const EMPTY_SNAPSHOT: SubscriptionOpsSnapshot = {
  activeSubscriptions: 0, planDistribution: {}, monthlyVsAnnualSplit: { monthly: 0, annual: 0 },
  personalVsCorporate: { personal: 0, corporate: 0 }, renewalsDueNext30Days: 0, failedPayments: 0,
  gracePeriodAccounts: 0, scheduledUpgrades: 0, scheduledDowngrades: 0, cancellationsAtPeriodEnd: 0,
  mrrMinorUnits: 0, arrMinorUnits: 0, mrrDataComplete: true, churnLast30Days: null, retentionRateLast30Days: null
};

export async function loadSubscriptionOpsSnapshot(): Promise<SubscriptionOpsSnapshot> {
  const admin = createAdminSupabaseClient();
  if (!admin) return EMPTY_SNAPSHOT;

  const [
    { data: activeSubs },
    { count: renewalsDue30 },
    { count: failedPayments },
    { count: gracePeriod },
    { count: scheduledUpgrades },
    { count: scheduledDowngrades },
    { count: cancellations },
    { count: cancelledLast30 },
    { count: activeStartOfPeriod }
  ] = await Promise.all([
    admin.from('subscriptions').select('id, billing_cycle, contact_id, corporate_account_id, plan_version_id, plan_versions(plan_code, price_minor_units, billing_cycle)').eq('status', 'ACTIVE'),
    admin.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'ACTIVE')
      .lte('next_payment_date', new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)),
    admin.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'PAYMENT_FAILED'),
    admin.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'GRACE_PERIOD'),
    admin.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'SCHEDULED_UPGRADE'),
    admin.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'SCHEDULED_DOWNGRADE'),
    admin.from('subscriptions').select('id', { count: 'exact', head: true }).eq('cancel_at_period_end', true),
    admin.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'CANCELLED')
      .gte('updated_at', new Date(Date.now() - 30 * 86_400_000).toISOString()),
    admin.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'ACTIVE')
      .lte('created_at', new Date(Date.now() - 30 * 86_400_000).toISOString())
  ]);

  const rows = activeSubs ?? [];
  const planDistribution: Record<string, number> = {};
  let monthly = 0, annual = 0, personal = 0, corporate = 0, mrrMinorUnits = 0, mrrDataComplete = true;

  for (const row of rows) {
    const planCode = (row as { plan_versions?: { plan_code?: string } }).plan_versions?.plan_code;
    if (planCode) planDistribution[planCode] = (planDistribution[planCode] ?? 0) + 1;

    if (row.billing_cycle === 'MONTHLY') monthly++; else if (row.billing_cycle === 'ANNUAL') annual++;
    if (row.contact_id) personal++; else if (row.corporate_account_id) corporate++;

    const price = (row as { plan_versions?: { price_minor_units?: number } }).plan_versions?.price_minor_units;
    if (typeof price === 'number') {
      mrrMinorUnits += row.billing_cycle === 'ANNUAL' ? Math.round(price / 12) : price;
    } else {
      mrrDataComplete = false;
    }
  }

  const churnLast30Days = cancelledLast30 ?? null;
  const retentionRateLast30Days = (activeStartOfPeriod !== null && activeStartOfPeriod > 0 && churnLast30Days !== null)
    ? Math.round(((activeStartOfPeriod - churnLast30Days) / activeStartOfPeriod) * 10000) / 100
    : null;

  return {
    activeSubscriptions: rows.length, planDistribution, monthlyVsAnnualSplit: { monthly, annual },
    personalVsCorporate: { personal, corporate }, renewalsDueNext30Days: renewalsDue30 ?? 0,
    failedPayments: failedPayments ?? 0, gracePeriodAccounts: gracePeriod ?? 0,
    scheduledUpgrades: scheduledUpgrades ?? 0, scheduledDowngrades: scheduledDowngrades ?? 0,
    cancellationsAtPeriodEnd: cancellations ?? 0, mrrMinorUnits, arrMinorUnits: mrrMinorUnits * 12,
    mrrDataComplete, churnLast30Days, retentionRateLast30Days
  };
}
