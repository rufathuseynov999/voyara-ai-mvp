import type { SupplierOpsSnapshot } from '@/server/agents/supplier-ops/supplier-ops-queries';
import type { Dictionary } from '@/i18n/dictionaries';

/**
 * Phase 4E — read-only supplier operations panel. Purely a display of
 * numbers already computed server-side; no interactive control, button, or
 * form anywhere — matches the same advisory-only discipline as
 * VoiceMetricsPanel (Phase 4D).
 *
 * Localized: every displayed label/status is sourced from
 * dictionary.opsPanels.supplier — internal status enum values (used as
 * object keys) are untouched.
 */
export function SupplierOpsPanel({ snapshot, dictionary }: { snapshot: SupplierOpsSnapshot; dictionary: Dictionary }) {
  const d = dictionary.opsPanels.supplier;
  return (
    <section className="supplier-ops-panel state-card">
      <h2>{d.title}</h2>
      <p className="orch-note">{d.note}</p>
      <div className="voice-metrics-grid">
        <div><strong>{snapshot.activeSuppliers}</strong><span>{d.activeSuppliers}</span></div>
        <div><strong>{snapshot.activeContracts}</strong><span>{d.activeContracts}</span></div>
        <div><strong>{snapshot.expiringContracts.length}</strong><span>{d.expiringSoon}</span></div>
        <div><strong>{snapshot.suspendedSuppliers.length}</strong><span>{d.suspended}</span></div>
        <div><strong>{snapshot.pendingSupplierConfirmations}</strong><span>{d.pendingConf}</span></div>
        <div><strong>{snapshot.bookingWorkload.hotelTour}</strong><span>{d.hotelWorkload}</span></div>
        <div><strong>{snapshot.bookingWorkload.airTicketing}</strong><span>{d.airWorkload}</span></div>
        <div><strong>{(snapshot.expectedMarginMinorUnits / 100).toFixed(2)}</strong><span>{d.expectedMargin}</span></div>
        <div><strong>{(snapshot.realizedMarginMinorUnits / 100).toFixed(2)}</strong><span>{d.realizedMargin}</span></div>
      </div>

      {snapshot.expiringContracts.length > 0 && (
        <>
          <h3>{d.expiringContracts}</h3>
          <ul className="voice-language-distribution" style={{ flexDirection: 'column' }}>
            {snapshot.expiringContracts.map((c) => <li key={c.contractId}>{c.contractReference} — {d.expires} {c.expiryDate}</li>)}
          </ul>
        </>
      )}

      <h3>{d.portalTasks}</h3>
      <ul className="voice-language-distribution">
        {Object.entries(snapshot.portalTasksByStatus).length === 0 ? <li>{d.noPortalTasks}</li> : null}
        {Object.entries(snapshot.portalTasksByStatus).map(([status, count]) => <li key={status}>{status}: {count}</li>)}
      </ul>

      <h3>{d.migrationBatches}</h3>
      <ul className="voice-language-distribution">
        {Object.entries(snapshot.migrationBatchesByStatus).length === 0 ? <li>{d.noMigration}</li> : null}
        {Object.entries(snapshot.migrationBatchesByStatus).map(([status, count]) => <li key={status}>{status}: {count}</li>)}
      </ul>
    </section>
  );
}
