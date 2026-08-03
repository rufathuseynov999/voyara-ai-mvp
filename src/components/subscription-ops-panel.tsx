import type { SubscriptionOpsSnapshot } from '@/server/agents/subscriptions/subscription-ops-queries';

/**
 * Phase 4F — read-only subscription operations panel. Purely a display of
 * numbers already computed server-side; no interactive control, button, or
 * form anywhere — matches the same advisory-only discipline as
 * VoiceMetricsPanel (Phase 4D) and SupplierOpsPanel (Phase 4E).
 */
export function SubscriptionOpsPanel({ snapshot }: { snapshot: SubscriptionOpsSnapshot }) {
  return (
    <section className="subscription-ops-panel state-card">
      <h2>Subscriptions &amp; membership (read-only)</h2>
      <p className="orch-note">No live recurring billing has been activated — figures reflect fixture/sandbox data until a real payment provider is connected.</p>
      <div className="voice-metrics-grid">
        <div><strong>{snapshot.activeSubscriptions}</strong><span>Active subscriptions</span></div>
        <div><strong>{snapshot.monthlyVsAnnualSplit.monthly}</strong><span>Monthly</span></div>
        <div><strong>{snapshot.monthlyVsAnnualSplit.annual}</strong><span>Annual</span></div>
        <div><strong>{snapshot.personalVsCorporate.personal}</strong><span>Personal</span></div>
        <div><strong>{snapshot.personalVsCorporate.corporate}</strong><span>Corporate</span></div>
        <div><strong>{snapshot.renewalsDueNext30Days}</strong><span>Renewals due (30d)</span></div>
        <div><strong>{snapshot.failedPayments}</strong><span>Failed payments</span></div>
        <div><strong>{snapshot.gracePeriodAccounts}</strong><span>Grace-period accounts</span></div>
        <div><strong>{snapshot.scheduledUpgrades}</strong><span>Scheduled upgrades</span></div>
        <div><strong>{snapshot.scheduledDowngrades}</strong><span>Scheduled downgrades</span></div>
        <div><strong>{snapshot.cancellationsAtPeriodEnd}</strong><span>Cancellations pending</span></div>
        <div><strong>{(snapshot.mrrMinorUnits / 100).toFixed(2)}</strong><span>MRR (₼){!snapshot.mrrDataComplete && ' — partial'}</span></div>
        <div><strong>{(snapshot.arrMinorUnits / 100).toFixed(2)}</strong><span>ARR (₼){!snapshot.mrrDataComplete && ' — partial'}</span></div>
        <div><strong>{snapshot.churnLast30Days ?? '—'}</strong><span>Churn (30d)</span></div>
        <div><strong>{snapshot.retentionRateLast30Days !== null ? `${snapshot.retentionRateLast30Days}%` : '—'}</strong><span>Retention (30d)</span></div>
      </div>

      {!snapshot.mrrDataComplete && (
        <p className="orch-note">MRR/ARR are partial: one or more active subscriptions reference a plan version whose price could not be resolved. No figure has been estimated to fill the gap.</p>
      )}

      <h3>Plan distribution</h3>
      <ul className="voice-language-distribution">
        {Object.entries(snapshot.planDistribution).length === 0 ? <li>No active subscriptions yet.</li> : null}
        {Object.entries(snapshot.planDistribution).map(([code, count]) => <li key={code}>{code}: {count}</li>)}
      </ul>
    </section>
  );
}
