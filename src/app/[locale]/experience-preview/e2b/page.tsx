export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import { requireLocale } from '@/i18n/server';
import { ExperiencePreviewWorkspace } from '@/components/experience-preview-workspace';

/**
 * E.2B.1 — customer Experience Proof preview. No Supabase authentication,
 * no admin client, no operational writes. Server-flag-gated
 * (VOYARA_CUSTOMER_EXPERIENCE_PREVIEW_ENABLED, never NEXT_PUBLIC_),
 * noindex/nofollow, absent from navigation and the sitemap. Every value
 * shown traces to a deterministic fixture in
 * src/lib/e2b-experience-preview-fixtures.tsx — nothing here queries a
 * real database or claims live pricing, confirmed hotels, payment, or
 * booking.
 */
export async function generateMetadata() {
  return { robots: { index: false, follow: false } };
}

export default async function E2BExperiencePreviewPage({ params }: { params: Promise<{ locale: string }> }) {
  if (process.env.VOYARA_CUSTOMER_EXPERIENCE_PREVIEW_ENABLED !== 'true') {
    notFound();
  }
  const locale = requireLocale((await params).locale);

  return (
    <main className="screen-page e2b-preview-page" id="main-content" tabIndex={-1}>
      <div className="e2b-preview-banner" role="note">
        {locale === 'az' ? 'Təcrübə önizləməsi — illüstrativ səfər məzmunu' : locale === 'ru' ? 'Демонстрация опыта — иллюстративный контент поездки' : 'Experience preview — illustrative trip content'}
      </div>
      <ExperiencePreviewWorkspace locale={locale} />
    </main>
  );
}
