export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { JourneyCanvas } from '@/components/journey-canvas';
import { getDictionary } from '@/i18n/dictionaries';
import { SimulationBanner } from '@/components/simulation-banner';
import { OrchestrationConsole } from '@/components/orchestration-console';
import { requireLocale } from '@/i18n/server';
import { requireViewerRole } from '@/server/auth/viewer';
import { loadCustomerPublishedProposals } from '@/server/commercial/queries';
import { loadCustomerPaymentRequests } from '@/server/payment/queries';
import { loadCustomerBookings } from '@/server/booking/queries';

export default async function ProposalPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale);
  const dictionary = getDictionary(locale);
  const path = `/${locale}/proposal`;
  const viewer = await requireViewerRole(locale, ['customer'], path);
  const [{ proposals, availableLocales }, { payments }, { bookings }] = await Promise.all([
    loadCustomerPublishedProposals(viewer, locale),
    loadCustomerPaymentRequests(viewer, locale),
    loadCustomerBookings(viewer, locale)
  ]);

  if (proposals.length === 0 && availableLocales.length > 0 && availableLocales[0] !== locale) {
    redirect(`/${availableLocales[0]}/proposal`);
  }

  return (
    <main className="screen-page proposal-page" id="main-content" tabIndex={-1}>
      <SimulationBanner dictionary={dictionary} />
      <OrchestrationConsole mode="proposal" labels={dictionary.phase3b} />
      <section className="screen-heading">
        <span className="screen-number screen-number-large">{dictionary.screens.proposal.number}</span>
        <span className="eyebrow">{dictionary.proposalLive.eyebrow}</span>
        <h1>{dictionary.screens.proposal.title}</h1>
        <p>{dictionary.proposalLive.intro}</p>
      </section>
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
    </main>
  );
}
