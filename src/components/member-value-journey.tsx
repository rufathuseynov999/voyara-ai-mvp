import type { Locale } from '@/i18n/config';
import {
  JOURNEY_TITLE,
  JOURNEY_INTRO,
  OPERATING_PRINCIPLE,
  STEPS_BY_LOCALE,
  FIELD_LABELS
} from '@/lib/member-value-journey-data';

/**
 * Phase C4 / C7.2 — Member-Value Journey component.
 *
 * All localized content lives in src/lib/member-value-journey-data.ts, the
 * shared authority also consumed by the standalone HTML export bridge —
 * this file only renders.
 */

export function MemberValueJourney({ locale }: { locale: Locale }) {
  const steps = STEPS_BY_LOCALE[locale];
  const labels = FIELD_LABELS[locale];

  return (
    <section className="member-value-journey" aria-labelledby="member-value-journey-title">
      <div className="section-heading">
        <span className="eyebrow">VOYARA AI</span>
        <h2 id="member-value-journey-title">{JOURNEY_TITLE[locale]}</h2>
        <p>{JOURNEY_INTRO[locale]}</p>
        <p className="mvj-principle">{OPERATING_PRINCIPLE[locale]}</p>
      </div>

      <ol className="mvj-steps">
        {steps.map((step, index) => (
          <li className="mvj-step" key={step.key}>
            <div className="mvj-step-header">
              <span className="mvj-step-number" aria-hidden="true">{index + 1}</span>
              <h3>{step.title}</h3>
            </div>
            <dl className="mvj-step-detail">
              <dt>{labels.provides}</dt>
              <dd>{step.customerProvides}</dd>

              <dt>{labels.prepares}</dt>
              <dd>{step.voyaraPrepares}</dd>

              <dt>{labels.value}</dt>
              <dd>{step.commercialValue}</dd>

              <dt>{labels.approval}</dt>
              <dd>{step.approvalPoint}</dd>

              <dt>{labels.next}</dt>
              <dd>{step.nextStep}</dd>
            </dl>
            {index < steps.length - 1 && <span className="mvj-arrow" aria-hidden="true">→</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}
