import { redirect } from 'next/navigation';
import { MfaPanel } from '@/components/mfa-panel';
import { readPublicSupabaseConfig } from '@/config/env-core';
import { getDictionary } from '@/i18n/dictionaries';
import { requireLocale } from '@/i18n/server';
import { safeLocalePath } from '@/server/auth/redirects';
import { getViewer } from '@/server/auth/viewer';

export const dynamic = 'force-dynamic';

export default async function MfaPage({
  params,
  searchParams
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = requireLocale((await params).locale);
  const dictionary = getDictionary(locale);
  const nextPath = safeLocalePath((await searchParams).next, locale, `/${locale}/staff`);
  const viewer = await getViewer();
  if (!viewer) redirect(`/${locale}/login?next=${encodeURIComponent(nextPath)}`);

  return (
    <main className="auth-page" id="main-content" tabIndex={-1}>
      <section className="auth-card">
        <span className="eyebrow">{dictionary.common.protected}</span>
        <h1>{dictionary.mfa.title}</h1>
        <p>{dictionary.mfa.body}</p>
        {readPublicSupabaseConfig() ? (
          <MfaPanel messages={dictionary.mfa} nextPath={nextPath} />
        ) : (
          <div className="auth-notice">{dictionary.auth.configuration}</div>
        )}
      </section>
    </main>
  );
}
