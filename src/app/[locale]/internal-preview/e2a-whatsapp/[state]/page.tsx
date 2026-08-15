export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import { CrmInboxPreviewShell } from '@/components/crm-inbox-preview-shell';
import { getDictionary } from '@/i18n/dictionaries';
import { requireLocale } from '@/i18n/server';
import {
  previewWaitingDetail, previewReadyDetail, previewConvertedDetail, previewDeniedDetail,
  PREVIEW_CONFIRMATION_MESSAGE_ID, PREVIEW_ACK_MESSAGE_ID
} from '@/lib/e2a-preview-fixtures';

const previewStates = ['waiting', 'ready', 'converted', 'denied'] as const;
type PreviewState = (typeof previewStates)[number];

function isPreviewState(value: string): value is PreviewState {
  return (previewStates as readonly string[]).includes(value);
}

/**
 * E.2A internal visual preview. Exists ONLY to let the founder see the
 * real CrmInbox presentation and real WhatsAppConversionPanel rendered
 * with domain-valid fixture data — this sandbox has no live WhatsApp
 * traffic to show otherwise. Server-flag-gated (not an auth bypass — see
 * below), performs zero Supabase queries, zero admin-client construction,
 * and the panel is mounted in previewMode (its submit becomes a no-op —
 * see WhatsAppConversionPanel's own doc comment). Absent from navigation,
 * absent from the sitemap, and noindex/nofollow via generateMetadata.
 */
export async function generateMetadata() {
  return { robots: { index: false, follow: false } };
}

export default async function E2AWhatsAppPreviewPage({ params }: { params: Promise<{ locale: string; state: string }> }) {
  if (process.env.VOYARA_INTERNAL_PREVIEW_ENABLED !== 'true') {
    notFound();
  }

  const { locale: rawLocale, state } = await params;
  const locale = requireLocale(rawLocale);
  const dictionary = getDictionary(locale);
  if (!isPreviewState(state)) notFound();

  const detail =
    state === 'waiting' ? previewWaitingDetail()
    : state === 'ready' ? previewReadyDetail()
    : state === 'converted' ? previewConvertedDetail()
    : previewDeniedDetail();

  const initialResult =
    state === 'converted'
      ? { status: 'accepted' as const, travelRequestId: '66666666-6666-4666-8666-666666666666', versionNumber: 1, intentId: '77777777-7777-4777-8777-777777777777' }
      : state === 'denied'
        ? { status: 'denied' as const, reasonCode: 'STALE_ACKNOWLEDGEMENT_EVIDENCE' }
        : null;

  return (
    <main className="screen-page e2a-preview-page" id="main-content" tabIndex={-1}>
      <div className="e2a-preview-banner" role="note">
        {dictionary.inbox.previewBannerLabel}
      </div>
      <CrmInboxPreviewShell
        detail={detail}
        labels={dictionary.inbox}
        initialResult={initialResult}
        initialConfirmationId={state === 'waiting' ? '' : PREVIEW_CONFIRMATION_MESSAGE_ID}
        initialAckId={state === 'ready' || state === 'denied' || state === 'converted' ? PREVIEW_ACK_MESSAGE_ID : ''}
      />
    </main>
  );
}
