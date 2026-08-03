export const dynamic = 'force-dynamic';

import { SupportOperationsQueue } from '@/components/support-operations-queue';
import { getDictionary } from '@/i18n/dictionaries';
import { requireLocale } from '@/i18n/server';
import { requireAssuranceLevel, requireViewerRole } from '@/server/auth/viewer';
import { loadStaffSupportCases } from '@/server/support/queries';

const supportOperationsRoles = ['staff', 'manager', 'admin', 'founder'] as const;

export default async function SupportOperationsPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale);
  const dictionary = getDictionary(locale);
  const path = `/${locale}/staff/support`;
  const viewer = await requireViewerRole(locale, supportOperationsRoles, path);
  requireAssuranceLevel(locale, viewer, 'aal2', path);
  const cases = await loadStaffSupportCases(viewer);

  return (
    <main className="screen-page support-operations-page" id="main-content" tabIndex={-1}>
      <section className="screen-heading">
        <span className="screen-number screen-number-large">06</span>
        <span className="eyebrow">{dictionary.supportStaff.eyebrow}</span>
        <h1>{dictionary.supportStaff.queueTitle}</h1>
        <p>{dictionary.supportStaff.intro}</p>
      </section>
      <SupportOperationsQueue
        canManage={viewer.roles.some((role) => ['manager', 'admin', 'founder'].includes(role))}
        cases={cases}
        locale={locale}
        messages={dictionary.supportStaff}
        viewerId={viewer.id}
      />
    </main>
  );
}
