export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { TravelRequestForm } from '@/components/travel-request-form';
import { getDictionary } from '@/i18n/dictionaries';
import { SimulationBanner } from '@/components/simulation-banner';
import { OrchestrationConsole } from '@/components/orchestration-console';
import { ExperienceShell } from '@/components/experience-shell';
import { requireLocale } from '@/i18n/server';
import { getViewer } from '@/server/auth/viewer';
import { loadCustomerTravelRequests } from '@/server/travel-request/queries';

export default async function TripWizardPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale);
  const dictionary = getDictionary(locale);
  const viewer = await getViewer();
  const screen = dictionary.screens.wizard;
  const requests = viewer?.roles.includes('customer')
    ? await loadCustomerTravelRequests(viewer)
    : { draft: null, recent: [] };

  const content = (
    <main className="screen-page travel-request-page" id="main-content" tabIndex={-1}>
      <SimulationBanner dictionary={dictionary} />
      <OrchestrationConsole mode="wizard" labels={dictionary.phase3b} />
      <section className="screen-heading">
        <span className="screen-number screen-number-large">{screen.number}</span>
        <span className="eyebrow">{dictionary.travelRequest.eyebrow}</span>
        <h1>{screen.title}</h1>
        <p>{dictionary.travelRequest.intro}</p>
      </section>

      {!viewer ? (
        <section className="auth-gate-card">
          <h2>{dictionary.travelRequest.signInTitle}</h2>
          <p>{dictionary.travelRequest.signInBody}</p>
          <Link className="button button-primary" href={`/${locale}/login?next=${encodeURIComponent(`/${locale}/trip-wizard`)}`}>
            {dictionary.travelRequest.signInAction}
          </Link>
        </section>
      ) : !viewer.roles.includes('customer') ? (
        <section className="auth-gate-card"><p>{dictionary.travelRequest.roleDenied}</p></section>
      ) : (
        <TravelRequestForm
          initialDraft={requests.draft}
          locale={locale}
          messages={dictionary.travelRequest}
          recent={requests.recent}
        />
      )}
    </main>
  );

  // The wizard remains reachable by signed-out visitors (it shows its own
  // sign-in gate above), so it cannot use the (customer) route group's
  // requireViewerRole-gated layout. It still gets the same continuous
  // Experience Shell chrome by mounting it directly here.
  return (
    <ExperienceShell dictionary={dictionary} locale={locale}>
      {content}
    </ExperienceShell>
  );
}
