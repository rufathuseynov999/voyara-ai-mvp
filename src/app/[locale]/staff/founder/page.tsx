import { FounderCommandCenter } from '@/components/founder-command-center';
import { VoiceMetricsPanel } from '@/components/voice-metrics-panel';
import { SupplierOpsPanel } from '@/components/supplier-ops-panel';
import { SubscriptionOpsPanel } from '@/components/subscription-ops-panel';
import { AutomationOpsPanel } from '@/components/automation-ops-panel';
import { getDictionary } from '@/i18n/dictionaries';
import { requireLocale } from '@/i18n/server';
import { requireViewerRole } from '@/server/auth/viewer';
import { loadFounderCommandCenter } from '@/server/founder/queries';
import { loadVoiceOperationsMetrics } from '@/server/agents/voice/voice-metrics-queries';
import { loadSupplierOpsSnapshot } from '@/server/agents/supplier-ops/supplier-ops-queries';
import { loadSubscriptionOpsSnapshot } from '@/server/agents/subscriptions/subscription-ops-queries';
import { loadAutomationOpsSnapshot } from '@/server/agents/automation/automation-ops-queries';

export default async function FounderPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale);
  const viewer = await requireViewerRole(locale, ['founder'], `/${locale}/staff/founder`);
  const dictionary = getDictionary(locale);
  const snapshot = await loadFounderCommandCenter(viewer);
  const voiceMetrics = await loadVoiceOperationsMetrics();
  const supplierOpsSnapshot = await loadSupplierOpsSnapshot();
  const subscriptionOpsSnapshot = await loadSubscriptionOpsSnapshot();
  const automationOpsSnapshot = await loadAutomationOpsSnapshot();
  return (
    <>
      <FounderCommandCenter dictionary={dictionary} locale={locale} snapshot={snapshot} />
      <VoiceMetricsPanel metrics={voiceMetrics} />
      <SupplierOpsPanel snapshot={supplierOpsSnapshot} />
      <SubscriptionOpsPanel snapshot={subscriptionOpsSnapshot} />
      <AutomationOpsPanel snapshot={automationOpsSnapshot} />
    </>
  );
}
