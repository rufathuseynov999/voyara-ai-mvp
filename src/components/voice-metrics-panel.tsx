import type { VoiceOperationsMetrics } from '@/server/agents/voice/voice-metrics-queries';

/**
 * Phase 4D — read-only voice metrics panel. Purely a display of numbers
 * already computed server-side by loadVoiceOperationsMetrics(); there is no
 * interactive control, button, or form anywhere in this component — it
 * cannot execute anything, matching the founder's explicit instruction that
 * this stays advisory-only.
 */
export function VoiceMetricsPanel({ metrics }: { metrics: VoiceOperationsMetrics }) {
  return (
    <section className="voice-metrics-panel state-card">
      <h2>Voice operations (read-only)</h2>
      <p className="orch-note">Simulation-only — no live telephony provider is connected. See the Phase 4D activation runbook.</p>
      <div className="voice-metrics-grid">
        <div><strong>{metrics.totalCalls}</strong><span>Calls received</span></div>
        <div><strong>{metrics.answered}</strong><span>Answered</span></div>
        <div><strong>{metrics.missed}</strong><span>Missed</span></div>
        <div><strong>{metrics.completed}</strong><span>Completed</span></div>
        <div><strong>{metrics.aiResolved}</strong><span>AI-resolved</span></div>
        <div><strong>{metrics.transferred}</strong><span>Transferred to staff</span></div>
        <div><strong>{metrics.callbacksRequired}</strong><span>Callbacks required</span></div>
        <div><strong>{metrics.qualifiedLeads}</strong><span>Qualified leads</span></div>
        <div><strong>{metrics.averageDurationSeconds ?? '—'}</strong><span>Avg. duration (s)</span></div>
        <div><strong>{metrics.unresolvedOrHighRiskCalls}</strong><span>Unresolved / high-risk</span></div>
      </div>
      <h3>Language distribution</h3>
      <ul className="voice-language-distribution">
        {Object.entries(metrics.languageDistribution).length === 0 ? <li>No calls yet.</li> : null}
        {Object.entries(metrics.languageDistribution).map(([lang, count]) => (
          <li key={lang}>{lang.toUpperCase()}: {count}</li>
        ))}
      </ul>
      <p className="orch-note">
        Estimated LLM cost: {(metrics.estimatedLlmCostMinorUnits / 100).toFixed(2)} — Estimated voice-provider cost: not available (no provider connected).
      </p>
    </section>
  );
}
