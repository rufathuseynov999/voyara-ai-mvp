import type { SupplierOpsSnapshot } from '@/server/agents/supplier-ops/supplier-ops-queries';

/**
 * Phase 4E — read-only supplier operations panel. Purely a display of
 * numbers already computed server-side; no interactive control, button, or
 * form anywhere — matches the same advisory-only discipline as
 * VoiceMetricsPanel (Phase 4D).
 */
export function SupplierOpsPanel({ snapshot }: { snapshot: SupplierOpsSnapshot }) {
  return (
    <section className="supplier-ops-panel state-card">
      <h2>Supplier &amp; contract operations (read-only)</h2>
      <p className="orch-note">No real supplier or R-Travel data has been migrated — fixtures only until founder-provided documents and credentials are supplied.</p>
      <div className="voice-metrics-grid">
        <div><strong>{snapshot.activeSuppliers}</strong><span>Active suppliers</span></div>
        <div><strong>{snapshot.activeContracts}</strong><span>Active contracts</span></div>
        <div><strong>{snapshot.expiringContracts.length}</strong><span>Expiring soon (60d)</span></div>
        <div><strong>{snapshot.suspendedSuppliers.length}</strong><span>Suspended suppliers</span></div>
        <div><strong>{snapshot.pendingSupplierConfirmations}</strong><span>Pending confirmations</span></div>
        <div><strong>{snapshot.bookingWorkload.hotelTour}</strong><span>Hotel/tour workload</span></div>
        <div><strong>{snapshot.bookingWorkload.airTicketing}</strong><span>Air-ticketing workload</span></div>
        <div><strong>{(snapshot.expectedMarginMinorUnits / 100).toFixed(2)}</strong><span>Expected margin</span></div>
        <div><strong>{(snapshot.realizedMarginMinorUnits / 100).toFixed(2)}</strong><span>Realized margin</span></div>
      </div>

      {snapshot.expiringContracts.length > 0 && (
        <>
          <h3>Contracts expiring within 60 days</h3>
          <ul className="voice-language-distribution" style={{ flexDirection: 'column' }}>
            {snapshot.expiringContracts.map((c) => <li key={c.contractId}>{c.contractReference} — expires {c.expiryDate}</li>)}
          </ul>
        </>
      )}

      <h3>Portal tasks by status</h3>
      <ul className="voice-language-distribution">
        {Object.entries(snapshot.portalTasksByStatus).length === 0 ? <li>No portal tasks yet.</li> : null}
        {Object.entries(snapshot.portalTasksByStatus).map(([status, count]) => <li key={status}>{status}: {count}</li>)}
      </ul>

      <h3>Migration batches by status</h3>
      <ul className="voice-language-distribution">
        {Object.entries(snapshot.migrationBatchesByStatus).length === 0 ? <li>No migration batches yet.</li> : null}
        {Object.entries(snapshot.migrationBatchesByStatus).map(([status, count]) => <li key={status}>{status}: {count}</li>)}
      </ul>
    </section>
  );
}
