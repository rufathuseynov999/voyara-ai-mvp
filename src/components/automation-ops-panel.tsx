import type { AutomationOpsSnapshot } from '@/server/agents/automation/automation-ops-queries';
import type { Dictionary } from '@/i18n/dictionaries';

/**
 * Phase 4G — read-only Founder/COO automation reporting panel. Purely a
 * display of numbers already computed server-side; no button, form,
 * retry control, approval control, takeover control, or any other
 * mutation anywhere in this component — matches the same advisory-only
 * discipline as VoiceMetricsPanel, SupplierOpsPanel, and
 * SubscriptionOpsPanel from prior phases.
 *
 * Localized: every displayed label/status is sourced from
 * dictionary.opsPanels.automation — internal status enum values (used as
 * object keys) are untouched.
 */
export function AutomationOpsPanel({ snapshot, dictionary }: { snapshot: AutomationOpsSnapshot; dictionary: Dictionary }) {
  const d = dictionary.opsPanels.automation;
  return (
    <section className="automation-ops-panel state-card">
      <h2>{d.title}</h2>
      {snapshot.dataAvailability === 'unavailable' && (
        <p className="orch-note">{d.unavailable}</p>
      )}
      {snapshot.dataAvailability === 'partial' && (
        <p className="orch-note">{d.partial}</p>
      )}

      <div className="voice-metrics-grid">
        <div><strong>{snapshot.completedWorkflows ?? '—'}</strong><span>{d.completed}</span></div>
        <div><strong>{snapshot.failedWorkflows ?? '—'}</strong><span>{d.failed}</span></div>
        <div><strong>{snapshot.pausedWorkflows ?? '—'}</strong><span>{d.paused}</span></div>
        <div><strong>{snapshot.deadLetteredWorkflows ?? '—'}</strong><span>{d.deadLettered}</span></div>
        <div><strong>{snapshot.approvalBacklog ?? '—'}</strong><span>{d.approvalBacklog}</span></div>
        <div><strong>{snapshot.slaBreaches ?? '—'}</strong><span>{d.slaBreaches}{snapshot.slaBreaches === null && ` ${d.unavailableSuffix}`}</span></div>
        <div><strong>{snapshot.leadsAwaitingResponse ?? '—'}</strong><span>{d.leadsAwaiting}</span></div>
        <div><strong>{snapshot.proposalsAwaitingApproval ?? '—'}</strong><span>{d.proposalsAwaiting}</span></div>
        <div><strong>{snapshot.supplierTaskBacklog ?? '—'}</strong><span>{d.supplierBacklog}</span></div>
        <div><strong>{snapshot.bookingDeadlinesNext7Days ?? '—'}</strong><span>{d.bookingDeadlines}{snapshot.bookingDeadlinesNext7Days === null && ` ${d.unavailableSuffix}`}</span></div>
        <div><strong>{snapshot.ticketingDeadlinesNext7Days ?? '—'}</strong><span>{d.ticketingDeadlines}{snapshot.ticketingDeadlinesNext7Days === null && ` ${d.unavailableSuffix}`}</span></div>
        <div><strong>{snapshot.subscriptionRisks ? `${snapshot.subscriptionRisks.gracePeriod + snapshot.subscriptionRisks.paymentFailed}` : '—'}</strong><span>{d.subRisks}</span></div>
        <div><strong>{snapshot.corporateWorkload ?? '—'}</strong><span>{d.corporateWorkload}</span></div>
        <div><strong>{snapshot.humanTakeoverRate !== null ? `${snapshot.humanTakeoverRate}%` : '—'}</strong><span>{d.takeoverRate}</span></div>
        <div><strong>{snapshot.unresolvedOperationalRisks ?? '—'}</strong><span>{d.unresolvedRisks}{snapshot.unresolvedOperationalRisks === null && ` ${d.unavailableSuffix}`}</span></div>
      </div>

      {snapshot.workflowTotalsByStatus && (
        <>
          <h3>{d.workflowTotals}</h3>
          <ul className="voice-language-distribution">
            {Object.entries(snapshot.workflowTotalsByStatus).map(([status, count]) => <li key={status}>{status}: {count}</li>)}
          </ul>
        </>
      )}

      {snapshot.channelVolumes && (
        <>
          <h3>{d.channelVolumes}</h3>
          <ul className="voice-language-distribution">
            {Object.entries(snapshot.channelVolumes).map(([channel, count]) => <li key={channel}>{channel}: {count}</li>)}
          </ul>
        </>
      )}

      {snapshot.paymentLinkStatus && (
        <>
          <h3>{d.paymentLinkStatus}</h3>
          <ul className="voice-language-distribution">
            {Object.entries(snapshot.paymentLinkStatus).map(([status, count]) => <li key={status}>{status}: {count}</li>)}
          </ul>
        </>
      )}

      {snapshot.unavailableReasons.length > 0 && (
        <>
          <h3>{d.unavailableMetrics}</h3>
          <ul className="voice-language-distribution">
            {snapshot.unavailableReasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </>
      )}
    </section>
  );
}
