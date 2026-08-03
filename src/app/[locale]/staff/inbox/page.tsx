export const dynamic = 'force-dynamic';

import { CrmInbox } from '@/components/crm-inbox';
import { SimulationBanner } from '@/components/simulation-banner';
import { getDictionary } from '@/i18n/dictionaries';
import { requireLocale } from '@/i18n/server';
import { requireAssuranceLevel, requireViewerRole } from '@/server/auth/viewer';
import { staffAreaRoles } from '@/server/auth/roles';

export default async function InboxPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale);
  const dictionary = getDictionary(locale);
  const path = `/${locale}/staff/inbox`;
  const viewer = await requireViewerRole(locale, staffAreaRoles, path);
  requireAssuranceLevel(locale, viewer, 'aal2', path);

  return (
    <main className="screen-page staff-inbox-page" id="main-content" tabIndex={-1}>
      <SimulationBanner dictionary={dictionary} />
      <CrmInbox labels={dictionary.inbox} />
    </main>
  );
}
