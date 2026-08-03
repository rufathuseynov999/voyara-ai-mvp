export const dynamic = 'force-dynamic';

import { AdministrationWorkspace } from '@/components/administration-workspace';
import { TravelRequestQueue } from '@/components/travel-request-queue';
import { getDictionary } from '@/i18n/dictionaries';
import { SimulationBanner } from '@/components/simulation-banner';
import { OrchestrationConsole } from '@/components/orchestration-console';
import { requireLocale } from '@/i18n/server';
import { requireViewerRole, requireAssuranceLevel } from '@/server/auth/viewer';
import { staffAreaRoles } from '@/server/auth/roles';
import { loadAdministrationSnapshot } from '@/server/administration/queries';
import { loadStaffTravelRequestQueue } from '@/server/travel-request/queries';

export default async function CrmPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale);
  const dictionary = getDictionary(locale);
  const path = `/${locale}/staff/crm`;
  const viewer = await requireViewerRole(locale, staffAreaRoles, path);
  requireAssuranceLevel(locale, viewer, 'aal2', path);
  const [items, administration] = await Promise.all([
    loadStaffTravelRequestQueue(viewer),
    loadAdministrationSnapshot(viewer)
  ]);

  return (
    <main className="screen-page staff-crm-page" id="main-content" tabIndex={-1}>
      <SimulationBanner dictionary={dictionary} />
      <OrchestrationConsole mode="crm" labels={dictionary.phase3b} />
      <section className="screen-heading">
        <span className="screen-number screen-number-large">{dictionary.screens.crm.number}</span>
        <span className="eyebrow">{dictionary.travelRequestStaff.eyebrow}</span>
        <h1>{dictionary.screens.crm.title}</h1>
        <p>{dictionary.screens.crm.description}</p>
      </section>
      <TravelRequestQueue
        initialItems={items}
        locale={locale}
        messages={dictionary.travelRequestStaff}
        purposeLabels={dictionary.travelRequest.purposes}
        statusLabels={dictionary.travelRequest.statusLabels}
        viewerId={viewer.id}
      />
      <AdministrationWorkspace
        initialSnapshot={administration}
        locale={locale}
        messages={dictionary.administration}
        viewerId={viewer.id}
        viewerRoles={viewer.roles}
      />
    </main>
  );
}
