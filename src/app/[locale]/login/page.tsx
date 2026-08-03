import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/login-form';
import { readPublicSupabaseConfig } from '@/config/env-core';
import { getDictionary } from '@/i18n/dictionaries';
import { requireLocale } from '@/i18n/server';
import { safeLocalePath } from '@/server/auth/redirects';
import { getViewer } from '@/server/auth/viewer';

export default async function LoginPage({
  params,
  searchParams
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = requireLocale((await params).locale);
  const dictionary = getDictionary(locale);
  const query = await searchParams;
  const nextPath = safeLocalePath(query.next, locale);
  const viewer = await getViewer();
  if (viewer) redirect(nextPath);
  const configured = Boolean(readPublicSupabaseConfig());

  return (
    <main className="auth-page" id="main-content" tabIndex={-1}>
      <section className="auth-card">
        <span className="eyebrow">{dictionary.common.protected}</span>
        <h1>{dictionary.auth.title}</h1>
        <p>{dictionary.auth.body}</p>
        {configured ? (
          <LoginForm messages={dictionary.auth} nextPath={nextPath} />
        ) : (
          <div className="auth-notice">{dictionary.auth.configuration}</div>
        )}
        <p className="auth-footnote">{dictionary.auth.staffInviteOnly}</p>
        <Link className="button button-primary" href={`/${locale}`}>
          {dictionary.common.returnHome}
        </Link>
      </section>
    </main>
  );
}
