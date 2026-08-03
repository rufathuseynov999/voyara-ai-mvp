import type { Dictionary } from '@/i18n/dictionaries';

/**
 * Phase 3A UI — a clearly-labelled simulation banner shown on operational
 * screens while supplier/payment integration runs in SIMULATION mode. It states
 * plainly that there is no live inventory or payment, so simulated data is never
 * mistaken for authoritative commercial state.
 */
export function SimulationBanner({ dictionary }: { dictionary: Dictionary }) {
  return (
    <div className="sim-banner" role="note" aria-label={dictionary.phase3a.simBanner}>
      <span className="sim-dot" aria-hidden="true" />
      <span>{dictionary.phase3a.simBanner}</span>
      <span className="sim-source">{dictionary.phase3a.sourceSimulated}</span>
    </div>
  );
}
