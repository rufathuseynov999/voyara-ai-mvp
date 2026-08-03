export const dynamic = 'force-dynamic';

import { CustomerMembershipScreen } from '@/components/customer-membership-screen';
import { requireLocale } from '@/i18n/server';
import { requireViewerRole } from '@/server/auth/viewer';
import { loadPlanComparison, loadCurrentMembership, loadPaymentHistory, loadEntitlementUsageSummary } from '@/server/agents/subscriptions/customer-subscription-queries';

export default async function MembershipPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale);
  const viewer = await requireViewerRole(locale, ['customer'], `/${locale}/membership`);

  const [plans, membership] = await Promise.all([
    loadPlanComparison(),
    loadCurrentMembership(viewer.id)
  ]);
  const [paymentHistory, usage] = membership
    ? await Promise.all([loadPaymentHistory(membership.subscriptionId), loadEntitlementUsageSummary(membership.subscriptionId)])
    : [[], []];

  return <CustomerMembershipScreen locale={locale} plans={plans} membership={membership} paymentHistory={paymentHistory} usage={usage} />;
}
