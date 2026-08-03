export const dynamic = 'force-dynamic';

import { CommercialApprovalWorkspace } from '@/components/commercial-approval-workspace';
import { getDictionary } from '@/i18n/dictionaries';
import { SimulationBanner } from '@/components/simulation-banner';
import { OrchestrationConsole } from '@/components/orchestration-console';
import { requireLocale } from '@/i18n/server';
import { staffAreaRoles } from '@/server/auth/roles';
import { requireAssuranceLevel, requireViewerRole } from '@/server/auth/viewer';
import { loadCommercialStaffCases } from '@/server/commercial/queries';

export default async function ApprovalsPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale);
  const dictionary = getDictionary(locale);
  const path = `/${locale}/staff/approvals`;
  const viewer = await requireViewerRole(locale, staffAreaRoles, path);
  requireAssuranceLevel(locale, viewer, 'aal2', path);
  const cases = await loadCommercialStaffCases(viewer);

  return (
    <main className="screen-page commercial-approval-page" id="main-content" tabIndex={-1}>
      <SimulationBanner dictionary={dictionary} />
      <OrchestrationConsole mode="approvals" labels={dictionary.phase3b} />
      <section className="screen-heading">
        <span className="screen-number screen-number-large">{dictionary.screens.approvals.number}</span>
        <span className="eyebrow">{dictionary.commercialStaff.eyebrow}</span>
        <h1>{dictionary.screens.approvals.title}</h1>
        <p>{dictionary.screens.approvals.description}</p>
      </section>
      <CommercialApprovalWorkspace
        initialCases={cases}
        messages={dictionary.commercialStaff}
        viewerId={viewer.id}
        viewerIsFounder={viewer.roles.includes('founder')}
      />
    </main>
  );
}
