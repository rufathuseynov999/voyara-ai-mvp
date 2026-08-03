export const dynamic = 'force-dynamic';

import { BookingOperationsQueue } from '@/components/booking-operations-queue';
import { getDictionary } from '@/i18n/dictionaries';
import { requireLocale } from '@/i18n/server';
import { requireAssuranceLevel, requireViewerRole } from '@/server/auth/viewer';
import { loadBookingOperationsCases } from '@/server/booking/queries';

const bookingOperationsRoles = ['staff', 'manager', 'admin', 'founder'] as const;

export default async function BookingOperationsPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale);
  const dictionary = getDictionary(locale);
  const path = `/${locale}/staff/bookings`;
  const viewer = await requireViewerRole(locale, bookingOperationsRoles, path);
  requireAssuranceLevel(locale, viewer, 'aal2', path);
  const cases = await loadBookingOperationsCases(viewer);

  return (
    <main className="screen-page booking-operations-page" id="main-content" tabIndex={-1}>
      <section className="screen-heading">
        <span className="screen-number screen-number-large">06</span>
        <span className="eyebrow">{dictionary.bookingStaff.eyebrow}</span>
        <h1>{dictionary.bookingStaff.queueTitle}</h1>
        <p>{dictionary.bookingStaff.intro}</p>
      </section>
      <BookingOperationsQueue
        canVerify={viewer.roles.some((role) => ['manager', 'admin', 'founder'].includes(role))}
        cases={cases}
        locale={locale}
        messages={dictionary.bookingStaff}
        viewerId={viewer.id}
      />
    </main>
  );
}
