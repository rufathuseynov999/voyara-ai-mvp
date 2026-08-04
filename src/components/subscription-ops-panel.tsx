import type { SubscriptionOpsSnapshot } from '@/server/agents/subscriptions/subscription-ops-queries';
import type { Dictionary } from '@/i18n/dictionaries';

/**
 * Phase 4F — read-only subscription operations panel. Purely a display of
 * numbers already computed server-side; no interactive control, button, or
 * form anywhere — matches the same advisory-only discipline as
 * VoiceMetricsPanel (Phase 4D) and SupplierOpsPanel (Phase 4E).
 *
 * Localized: every displayed label/status is sourced from
 * dictionary.opsPanels.subscription — internal plan codes are untouched.
 */
export function SubscriptionOpsPanel({ snapshot, dictionary }: { snapshot: SubscriptionOpsSnapshot; dictionary: Dictionary }) {
  const d = dictionary.opsPanels.subscription;
  return (
    <section className="subscription-ops-panel state-card">
      <h2>{d.title}</h2>
      <p className="orch-note">{d.note}</p>
      <div className="voice-metrics-grid">
        <div><strong>{snapshot.activeSubscriptions}</strong><span>{d.active}</span></div>
        <div><strong>{snapshot.monthlyVsAnnualSplit.monthly}</strong><span>{d.monthly}</span></div>
        <div><strong>{snapshot.monthlyVsAnnualSplit.annual}</strong><span>{d.annual}</span></div>
        <div><strong>{snapshot.personalVsCorporate.personal}</strong><span>{d.personal}</span></div>
        <div><strong>{snapshot.personalVsCorporate.corporate}</strong><span>{d.corporate}</span></div>
        <div><strong>{snapshot.renewalsDueNext30Days}</strong><span>{d.renewals}</span></div>
        <div><strong>{snapshot.failedPayments}</strong><span>{d.failed}</span></div>
        <div><strong>{snapshot.gracePeriodAccounts}</strong><span>{d.grace}</span></div>
        <div><strong>{snapshot.scheduledUpgrades}</strong><span>{d.upgrades}</span></div>
        <div><strong>{snapshot.scheduledDowngrades}</strong><span>{d.downgrades}</span></div>
        <div><strong>{snapshot.cancellationsAtPeriodEnd}</strong><span>{d.cancellations}</span></div>
        <div><strong>{(snapshot.mrrMinorUnits / 100).toFixed(2)}</strong><span>{d.mrr}{!snapshot.mrrDataComplete && ` ${d.partial}`}</span></div>
        <div><strong>{(snapshot.arrMinorUnits / 100).toFixed(2)}</strong><span>{d.arr}{!snapshot.mrrDataComplete && ` ${d.partial}`}</span></div>
        <div><strong>{snapshot.churnLast30Days ?? '—'}</strong><span>{d.churn}</span></div>
        <div><strong>{snapshot.retentionRateLast30Days !== null ? `${snapshot.retentionRateLast30Days}%` : '—'}</strong><span>{d.retention}</span></div>
      </div>

      {!snapshot.mrrDataComplete && (
        <p className="orch-note">{d.mrrPartialNote}</p>
      )}

      <h3>{d.planDist}</h3>
      <ul className="voice-language-distribution">
        {Object.entries(snapshot.planDistribution).length === 0 ? <li>{d.noActive}</li> : null}
        {Object.entries(snapshot.planDistribution).map(([code, count]) => <li key={code}>{code}: {count}</li>)}
      </ul>
    </section>
  );
}
