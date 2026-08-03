export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { CustomerPaymentWorkspace } from '@/components/customer-payment-workspace';
import { getDictionary } from '@/i18n/dictionaries';
import { SimulationBanner } from '@/components/simulation-banner';
import { OrchestrationConsole } from '@/components/orchestration-console';
import { requireLocale } from '@/i18n/server';
import { requireViewerRole } from '@/server/auth/viewer';
import { loadCustomerPaymentRequests } from '@/server/payment/queries';

export default async function PaymentPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale);
  const dictionary = getDictionary(locale);
  const path = `/${locale}/payment`;
  const viewer = await requireViewerRole(locale, ['customer'], path);
  const { payments, availableLocales } = await loadCustomerPaymentRequests(viewer, locale);

  if (payments.length === 0 && availableLocales.length > 0 && availableLocales[0] !== locale) {
    redirect(`/${availableLocales[0]}/payment`);
  }

  return (
    <main className="screen-page payment-page" id="main-content" tabIndex={-1}>
      <SimulationBanner dictionary={dictionary} />
      <OrchestrationConsole mode="payment" labels={dictionary.phase3b} />
      <section className="screen-heading">
        <span className="screen-number screen-number-large">{dictionary.screens.payment.number}</span>
        <span className="eyebrow">{dictionary.paymentCustomer.eyebrow}</span>
        <h1>{dictionary.screens.payment.title}</h1>
        <p>{dictionary.paymentCustomer.intro}</p>
      </section>
      <CustomerPaymentWorkspace locale={locale} messages={dictionary.paymentCustomer} payments={payments} />
    </main>
  );
}
