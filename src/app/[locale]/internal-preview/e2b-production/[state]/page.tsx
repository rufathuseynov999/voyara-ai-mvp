export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import { requireLocale } from '@/i18n/server';
import { getDictionary } from '@/i18n/dictionaries';
import { JourneyCanvas } from '@/components/journey-canvas';
import { buildProductionFixture, PRODUCTION_STATES, type ProductionState } from '@/lib/e2b-production-harness-fixtures';

/**
 * E.2B final certification — the safe production-presentation harness.
 * This renders the REAL, unmodified production <JourneyCanvas> component
 * (the exact same component the authenticated customer route uses) with
 * production-shaped deterministic fixtures instead of a live Supabase
 * session — the only way to visually verify the converged production
 * presentation in this sandbox, which has no live customer session
 * available.
 *
 * Server-flag-gated (VOYARA_E2B_PRODUCTION_PREVIEW_ENABLED, never
 * NEXT_PUBLIC_), force-dynamic, noindex/nofollow. Zero Supabase/admin
 * imports, zero operational writes — JourneyCanvas itself never performs
 * a write; the real accept()/payment/booking authority lives entirely
 * inside <PublishedProposals> and the real API routes, neither of which
 * this harness calls.
 */
export async function generateMetadata() {
  return { robots: { index: false, follow: false } };
}

function isProductionState(value: string): value is ProductionState {
  return (PRODUCTION_STATES as readonly string[]).includes(value);
}

export default async function E2BProductionHarnessPage({ params }: { params: Promise<{ locale: string; state: string }> }) {
  if (process.env.VOYARA_E2B_PRODUCTION_PREVIEW_ENABLED !== 'true') {
    notFound();
  }
  const { locale: rawLocale, state } = await params;
  const locale = requireLocale(rawLocale);
  if (!isProductionState(state)) notFound();

  const dictionary = getDictionary(locale);
  const { proposals, payments, bookings } = buildProductionFixture(state);

  return (
    <main className="screen-page e2b-preview-page" id="main-content" tabIndex={-1}>
      <div className="e2b-preview-banner" role="note">
        Production presentation simulation — not customer, supplier, payment or booking data.
      </div>
      <div className="e2b-preview-workspace">
        <JourneyCanvas
          askHref={`/${locale}/ask`}
          bookings={bookings}
          canvasMessages={dictionary.journeyCanvas}
          continuityMessages={dictionary.journeyContinuity}
          locale={locale}
          messages={dictionary.proposalLive}
          payments={payments}
          proposals={proposals}
        />
      </div>
    </main>
  );
}
