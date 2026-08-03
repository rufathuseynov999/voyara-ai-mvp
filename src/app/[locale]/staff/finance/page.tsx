export const dynamic = 'force-dynamic';

import { FinancePaymentQueue } from '@/components/finance-payment-queue';
import { getDictionary } from '@/i18n/dictionaries';
import { requireLocale } from '@/i18n/server';
import { requireAssuranceLevel, requireViewerRole } from '@/server/auth/viewer';
import { loadFinancePaymentCases } from '@/server/payment/queries';

const financeReviewRoles = ['finance', 'admin', 'founder'] as const;

export default async function FinancePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale);
  const dictionary = getDictionary(locale);
  const path = `/${locale}/staff/finance`;
  const viewer = await requireViewerRole(locale, financeReviewRoles, path);
  requireAssuranceLevel(locale, viewer, 'aal2', path);
  const cases = await loadFinancePaymentCases(viewer);

  return (
    <main className="screen-page finance-page" id="main-content" tabIndex={-1}>
      <section className="screen-heading">
        <span className="screen-number screen-number-large">07</span>
        <span className="eyebrow">{dictionary.paymentStaff.eyebrow}</span>
        <h1>{dictionary.paymentStaff.queueTitle}</h1>
        <p>{dictionary.paymentStaff.intro}</p>
      </section>
      <FinancePaymentQueue
        cases={cases}
        locale={locale}
        messages={dictionary.paymentStaff}
        viewerCanAllocate={viewer.roles.some((role) => ['finance', 'founder'].includes(role))}
      />
    </main>
  );
}
