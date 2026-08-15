export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { CustomerTripRoom } from '@/components/customer-trip-room';
import { getDictionary } from '@/i18n/dictionaries';
import { SimulationBanner } from '@/components/simulation-banner';
import { OrchestrationConsole } from '@/components/orchestration-console';
import { requireLocale } from '@/i18n/server';
import { requireViewerRole } from '@/server/auth/viewer';
import { loadCustomerBookings } from '@/server/booking/queries';
import { loadCustomerSupportCases } from '@/server/support/queries';

export default async function TripRoomPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale);
  const dictionary = getDictionary(locale);
  const path = `/${locale}/trip-room`;
  const viewer = await requireViewerRole(locale, ['customer'], path);
  const [{ bookings, availableLocales }, supportCases] = await Promise.all([
    loadCustomerBookings(viewer, locale),
    loadCustomerSupportCases(viewer, locale)
  ]);

  if (bookings.length === 0 && availableLocales.length > 0 && availableLocales[0] !== locale) {
    redirect(`/${availableLocales[0]}/trip-room`);
  }

  return (
    <main className="screen-page trip-room-page" id="main-content" tabIndex={-1}>
      <SimulationBanner dictionary={dictionary} />
      <OrchestrationConsole mode="triproom" labels={dictionary.phase3b} />
      <section className="screen-heading">
        <span className="screen-number screen-number-large">{dictionary.screens.tripRoom.number}</span>
        <span className="eyebrow">{dictionary.bookingCustomer.eyebrow}</span>
        <h1>{dictionary.screens.tripRoom.title}</h1>
        <p>{dictionary.bookingCustomer.intro}</p>
      </section>
      <CustomerTripRoom
        bookings={bookings}
        continuityMessages={dictionary.journeyContinuity}
        locale={locale}
        messages={dictionary.bookingCustomer}
        proposalHref={`/${locale}/proposal`}
        supportCases={supportCases}
        supportMessages={dictionary.supportCustomer}
      />
    </main>
  );
}
