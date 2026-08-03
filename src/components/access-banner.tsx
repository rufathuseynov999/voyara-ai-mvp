import Link from 'next/link';
import type { Dictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';
import { logoutAction } from '@/server/auth/actions';
import type { Viewer } from '@/server/auth/viewer';

export function AccessBanner({ dictionary, locale, viewer }: { dictionary: Dictionary; locale: Locale; viewer: Viewer }) {
  if (viewer.source === 'demo') {
    return (
      <aside className="demo-banner" role="status">
        <strong>{dictionary.shell.demoActor}</strong>
        <span>{dictionary.shell.demoWarning}</span>
      </aside>
    );
  }

  return (
    <aside className="session-banner" aria-label={dictionary.auth.sessionTitle}>
      <span>
        {dictionary.auth.sessionTitle}: {viewer.roles.join(', ')} · {viewer.assuranceLevel.toUpperCase()}
      </span>
      <div className="session-actions">
        {viewer.roles.some((role) => ['staff', 'manager', 'finance', 'admin', 'founder'].includes(role)) ? (
          <Link href={`/${locale}/staff/crm`}>{dictionary.screens.crm.title}</Link>
        ) : null}
        {viewer.roles.some((role) => ['staff', 'manager', 'admin', 'founder'].includes(role)) ? (
          <Link href={`/${locale}/staff/bookings`}>{dictionary.bookingStaff.queueTitle}</Link>
        ) : null}
        {viewer.roles.some((role) => ['staff', 'manager', 'admin', 'founder'].includes(role)) ? (
          <Link href={`/${locale}/staff/support`}>{dictionary.supportStaff.queueTitle}</Link>
        ) : null}
        {viewer.roles.some((role) => ['finance', 'admin', 'founder'].includes(role)) ? (
          <Link href={`/${locale}/staff/finance`}>{dictionary.paymentStaff.queueTitle}</Link>
        ) : null}
        <form action={logoutAction}>
          <input name="locale" type="hidden" value={locale} />
          <input name="scope" type="hidden" value="local" />
          <button type="submit">{dictionary.auth.signOut}</button>
        </form>
        <form action={logoutAction}>
          <input name="locale" type="hidden" value={locale} />
          <input name="scope" type="hidden" value="global" />
          <button type="submit">{dictionary.auth.signOutAll}</button>
        </form>
      </div>
    </aside>
  );
}
