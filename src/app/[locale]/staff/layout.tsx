export const dynamic = 'force-dynamic';

import { AccessBanner } from '@/components/access-banner';
import { getDictionary } from '@/i18n/dictionaries';
import { requireLocale } from '@/i18n/server';
import { readRequestedPath } from '@/server/auth/request-path';
import { staffAreaRoles } from '@/server/auth/roles';
import { requireAssuranceLevel, requireViewerRole } from '@/server/auth/viewer';

export default async function StaffLayout({
  children,
  params
}: Readonly<{ children: React.ReactNode; params: Promise<{ locale: string }> }>) {
  const locale = requireLocale((await params).locale);
  const requestedPath = await readRequestedPath(locale, `/${locale}/staff`);
  const viewer = await requireViewerRole(locale, staffAreaRoles, requestedPath);
  requireAssuranceLevel(locale, viewer, 'aal2', requestedPath);

  return (
    <>
      <AccessBanner dictionary={getDictionary(locale)} locale={locale} viewer={viewer} />
      {children}
    </>
  );
}
