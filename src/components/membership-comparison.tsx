import type { Locale } from '@/i18n/config';
import { PERSONAL_PLANS, CORPORATE_PLANS, type MembershipPlanDefinition } from '@/lib/membership-catalogue';
import {
  HEADER_TEXT,
  cellDisplay,
  type ComparisonRow,
  PERSONAL_ROWS,
  CORPORATE_ROWS
} from '@/lib/membership-comparison-data';

/**
 * Phase C3 / C7.2 — shared personal and corporate membership comparison
 * table components.
 *
 * All row logic and localized wording live in
 * src/lib/membership-comparison-data.ts, the shared authority also
 * consumed by the standalone HTML export bridge — this file only renders.
 *
 * Renders as a real <table> for screen readers and desktop, and reflows
 * into an accessible card-per-plan stack under 640px so nothing overflows
 * the viewport horizontally.
 */

function ComparisonTable({
  plans, rows, locale, title
}: {
  plans: readonly MembershipPlanDefinition[];
  rows: ComparisonRow[];
  locale: Locale;
  title: string;
}) {
  const h = HEADER_TEXT[locale];
  return (
    <div className="membership-comparison">
      <h2>{title}</h2>

      {/* Desktop/tablet: real table, horizontally scrollable as a safety net
          only — content itself is designed to fit without relying on it. */}
      <div className="membership-comparison-scroll" role="region" aria-label={title} tabIndex={0}>
        <table className="membership-comparison-table">
          <thead>
            <tr>
              <th scope="col">{h.feature}</th>
              {plans.map((plan) => (
                <th scope="col" key={plan.planCode}>{plan.name[locale]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.label[locale]}</th>
                {plans.map((plan) => (
                  <td key={plan.planCode}>{cellDisplay(row.values(plan, locale), locale)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: accessible per-plan card stack, avoids any viewport
          overflow entirely rather than relying on scroll affordance. */}
      <div className="membership-comparison-cards" aria-hidden="false">
        {plans.map((plan) => (
          <div className="membership-comparison-card" key={plan.planCode}>
            <h3>{plan.name[locale]}</h3>
            <dl>
              {rows.map((row) => (
                <div className="membership-comparison-card-row" key={row.key}>
                  <dt>{row.label[locale]}</dt>
                  <dd>{cellDisplay(row.values(plan, locale), locale)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PersonalMembershipComparison({ locale }: { locale: Locale }) {
  return <ComparisonTable plans={PERSONAL_PLANS} rows={PERSONAL_ROWS} locale={locale} title={HEADER_TEXT[locale].personalTitle} />;
}

export function CorporateMembershipComparison({ locale }: { locale: Locale }) {
  return <ComparisonTable plans={CORPORATE_PLANS} rows={CORPORATE_ROWS} locale={locale} title={HEADER_TEXT[locale].corporateTitle} />;
}
