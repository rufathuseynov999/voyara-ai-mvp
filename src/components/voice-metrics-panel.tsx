import type { VoiceOperationsMetrics } from '@/server/agents/voice/voice-metrics-queries';
import type { Dictionary } from '@/i18n/dictionaries';

/**
 * Phase 4D — read-only voice metrics panel. Purely a display of numbers
 * already computed server-side by loadVoiceOperationsMetrics(); there is no
 * interactive control, button, or form anywhere in this component — it
 * cannot execute anything, matching the founder's explicit instruction that
 * this stays advisory-only.
 *
 * Localized: every displayed label/status is sourced from
 * dictionary.opsPanels.voice — internal metric keys (totalCalls, answered,
 * etc.) are untouched.
 */
export function VoiceMetricsPanel({ metrics, dictionary }: { metrics: VoiceOperationsMetrics; dictionary: Dictionary }) {
  const d = dictionary.opsPanels.voice;
  return (
    <section className="voice-metrics-panel state-card">
      <h2>{d.title}</h2>
      <p className="orch-note">{d.note}</p>
      <div className="voice-metrics-grid">
        <div><strong>{metrics.totalCalls}</strong><span>{d.calls}</span></div>
        <div><strong>{metrics.answered}</strong><span>{d.answered}</span></div>
        <div><strong>{metrics.missed}</strong><span>{d.missed}</span></div>
        <div><strong>{metrics.completed}</strong><span>{d.completed}</span></div>
        <div><strong>{metrics.aiResolved}</strong><span>{d.aiResolved}</span></div>
        <div><strong>{metrics.transferred}</strong><span>{d.transferred}</span></div>
        <div><strong>{metrics.callbacksRequired}</strong><span>{d.callbacks}</span></div>
        <div><strong>{metrics.qualifiedLeads}</strong><span>{d.leads}</span></div>
        <div><strong>{metrics.averageDurationSeconds ?? '—'}</strong><span>{d.avgDuration}</span></div>
        <div><strong>{metrics.unresolvedOrHighRiskCalls}</strong><span>{d.unresolved}</span></div>
      </div>
      <h3>{d.langDist}</h3>
      <ul className="voice-language-distribution">
        {Object.entries(metrics.languageDistribution).length === 0 ? <li>{d.noCalls}</li> : null}
        {Object.entries(metrics.languageDistribution).map(([lang, count]) => (
          <li key={lang}>{lang.toUpperCase()}: {count}</li>
        ))}
      </ul>
      <p className="orch-note">
        {d.estCost}: {(metrics.estimatedLlmCostMinorUnits / 100).toFixed(2)}
      </p>
    </section>
  );
}
