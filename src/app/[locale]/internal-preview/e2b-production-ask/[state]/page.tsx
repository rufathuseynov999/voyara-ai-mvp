export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import { requireLocale } from '@/i18n/server';
import { getDictionary } from '@/i18n/dictionaries';
import { AskVoyara } from '@/components/ask-voyara';

/**
 * E.2B final certification — the Ask VOYARA production-presentation
 * harness. Renders the REAL, unmodified <AskVoyara> component (the exact
 * same component the authenticated /[locale]/ask route uses) with real
 * dictionary labels. There is no forked JSX and no props override —
 * AskVoyara already manages its own compose/parse/confirm state
 * internally, so this harness simply mounts the real component and lets
 * a real browser session interact with it exactly as a customer would.
 *
 * The four states this route accepts (compose / chip-filled /
 * parsed-confirmation / validation-error) do not change what is
 * rendered — the same real AskVoyara mounts every time. They exist only
 * as a documented target for the browser-certification script's
 * interaction sequence (type/click through the real UI to reach each
 * moment), never as separately forked markup. This route NEVER submits
 * the real confirm action itself — no test script driving this harness
 * clicks "confirm," so the real `/api/v1/travel-requests` write path is
 * never exercised here, even though it is the same real code that would
 * call it if a real customer did.
 *
 * Server-flag-gated (VOYARA_E2B_PRODUCTION_PREVIEW_ENABLED, never
 * NEXT_PUBLIC_), force-dynamic, noindex/nofollow, zero Supabase/admin
 * imports in this file.
 */
export async function generateMetadata() {
  return { robots: { index: false, follow: false } };
}

const ASK_STATES = ['compose', 'chip-filled', 'parsed-confirmation', 'validation-error'] as const;
type AskState = (typeof ASK_STATES)[number];

function isAskState(value: string): value is AskState {
  return (ASK_STATES as readonly string[]).includes(value);
}

export default async function E2BProductionAskHarnessPage({ params }: { params: Promise<{ locale: string; state: string }> }) {
  if (process.env.VOYARA_E2B_PRODUCTION_PREVIEW_ENABLED !== 'true') {
    notFound();
  }
  const { locale: rawLocale, state } = await params;
  const locale = requireLocale(rawLocale);
  if (!isAskState(state)) notFound();

  const dictionary = getDictionary(locale);

  return (
    <main className="screen-page e2b-preview-page" id="main-content" tabIndex={-1} data-harness-state={state}>
      <div className="e2b-preview-banner" role="note">
        Production presentation simulation — no customer or operational data.
      </div>
      <div className="e2b-preview-workspace">
        <section className="e2b-section">
          <h2>{dictionary.askVoyara.title}</h2>
          <AskVoyara locale={locale} messages={dictionary.askVoyara} requestMessages={dictionary.travelRequest} />
        </section>
        <section className="e2b-section">
          {/* editInWizard is the real, existing structured-Wizard-alternative
              label AskVoyara itself already knows about — reused here, not
              invented, so the harness never claims a label that doesn't
              really exist in production. */}
          <a className="button button-outline-dark" href={`/${locale}/trip-wizard`}>
            {dictionary.askVoyara.editInWizard}
          </a>
        </section>
      </div>
    </main>
  );
}
