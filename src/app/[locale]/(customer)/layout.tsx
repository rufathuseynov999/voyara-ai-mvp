export const dynamic = 'force-dynamic';

import { AccessBanner } from '@/components/access-banner';
import { ExperienceShell } from '@/components/experience-shell';
import { getDictionary } from '@/i18n/dictionaries';
import { requireLocale } from '@/i18n/server';
import { readRequestedPath } from '@/server/auth/request-path';
import { customerAreaRoles } from '@/server/auth/roles';
import { requireViewerRole } from '@/server/auth/viewer';
import { loadCurrentMembership } from '@/server/agents/subscriptions/customer-subscription-queries';

export default async function CustomerLayout({
  children,
  params
}: Readonly<{ children: React.ReactNode; params: Promise<{ locale: string }> }>) {
  const locale = requireLocale((await params).locale);
  const requestedPath = await readRequestedPath(locale, `/${locale}`);
  const viewer = await requireViewerRole(locale, customerAreaRoles, requestedPath);
  const dictionary = getDictionary(locale);
  const membership = viewer.roles.includes('customer') ? await loadCurrentMembership(viewer.id) : null;

  return (
    <ExperienceShell dictionary={dictionary} locale={locale} planCode={membership?.status === 'ACTIVE' ? membership.planCode : null}>
      <AccessBanner dictionary={dictionary} locale={locale} viewer={viewer} />
      {children}
    </ExperienceShell>
  );
}
