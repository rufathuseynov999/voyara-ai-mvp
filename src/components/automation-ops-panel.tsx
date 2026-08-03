import type { AutomationOpsSnapshot } from '@/server/agents/automation/automation-ops-queries';

/**
 * Phase 4G — read-only Founder/COO automation reporting panel. Purely a
 * display of numbers already computed server-side; no button, form,
 * retry control, approval control, takeover control, or any other
 * mutation anywhere in this component — matches the same advisory-only
 * discipline as VoiceMetricsPanel, SupplierOpsPanel, and
 * SubscriptionOpsPanel from prior phases.
 */
export function AutomationOpsPanel({ snapshot }: { snapshot: AutomationOpsSnapshot }) {
  return (
    <section className="automation-ops-panel state-card">
      <h2>Automation operations (read-only)</h2>
      {snapshot.dataAvailability === 'unavailable' && (
        <p className="orch-note">Automation reporting is currently unavailable — no database connection.</p>
      )}
      {snapshot.dataAvailability === 'partial' && (
        <p className="orch-note">Some automation metrics below are unavailable — see the notes under each affected figure. No metric is estimated to fill a gap.</p>
      )}

      <div className="voice-metrics-grid">
        <div><strong>{snapshot.completedWorkflows ?? '—'}</strong><span>Completed workflows</span></div>
        <div><strong>{snapshot.failedWorkflows ?? '—'}</strong><span>Failed workflows</span></div>
        <div><strong>{snapshot.pausedWorkflows ?? '—'}</strong><span>Paused workflows</span></div>
        <div><strong>{snapshot.deadLetteredWorkflows ?? '—'}</strong><span>Dead-lettered (unresolved)</span></div>
        <div><strong>{snapshot.approvalBacklog ?? '—'}</strong><span>Approval backlog (Level 2)</span></div>
        <div><strong>{snapshot.slaBreaches ?? '—'}</strong><span>SLA breaches{snapshot.slaBreaches === null && ' — unavailable'}</span></div>
        <div><strong>{snapshot.leadsAwaitingResponse ?? '—'}</strong><span>Leads awaiting response</span></div>
        <div><strong>{snapshot.proposalsAwaitingApproval ?? '—'}</strong><span>Proposals awaiting approval</span></div>
        <div><strong>{snapshot.supplierTaskBacklog ?? '—'}</strong><span>Supplier-task backlog</span></div>
        <div><strong>{snapshot.bookingDeadlinesNext7Days ?? '—'}</strong><span>Booking deadlines (7d){snapshot.bookingDeadlinesNext7Days === null && ' — unavailable'}</span></div>
        <div><strong>{snapshot.ticketingDeadlinesNext7Days ?? '—'}</strong><span>Ticketing deadlines (7d){snapshot.ticketingDeadlinesNext7Days === null && ' — unavailable'}</span></div>
        <div><strong>{snapshot.subscriptionRisks ? `${snapshot.subscriptionRisks.gracePeriod + snapshot.subscriptionRisks.paymentFailed}` : '—'}</strong><span>Subscription risks (grace + failed)</span></div>
        <div><strong>{snapshot.corporateWorkload ?? '—'}</strong><span>Corporate accounts (active)</span></div>
        <div><strong>{snapshot.humanTakeoverRate !== null ? `${snapshot.humanTakeoverRate}%` : '—'}</strong><span>Human-takeover rate</span></div>
        <div><strong>{snapshot.unresolvedOperationalRisks ?? '—'}</strong><span>Unresolved operational risks{snapshot.unresolvedOperationalRisks === null && ' — unavailable'}</span></div>
      </div>

      {snapshot.workflowTotalsByStatus && (
        <>
          <h3>Workflow totals by status</h3>
          <ul className="voice-language-distribution">
            {Object.entries(snapshot.workflowTotalsByStatus).map(([status, count]) => <li key={status}>{status}: {count}</li>)}
          </ul>
        </>
      )}

      {snapshot.channelVolumes && (
        <>
          <h3>Channel volumes</h3>
          <ul className="voice-language-distribution">
            {Object.entries(snapshot.channelVolumes).map(([channel, count]) => <li key={channel}>{channel}: {count}</li>)}
          </ul>
        </>
      )}

      {snapshot.paymentLinkStatus && (
        <>
          <h3>Payment-link status</h3>
          <ul className="voice-language-distribution">
            {Object.entries(snapshot.paymentLinkStatus).map(([status, count]) => <li key={status}>{status}: {count}</li>)}
          </ul>
        </>
      )}

      {snapshot.unavailableReasons.length > 0 && (
        <>
          <h3>Unavailable metrics</h3>
          <ul className="voice-language-distribution">
            {snapshot.unavailableReasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </>
      )}
    </section>
  );
}
