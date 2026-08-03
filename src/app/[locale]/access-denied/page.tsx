import Link from 'next/link';
import { getDictionary } from '@/i18n/dictionaries';
import { requireLocale } from '@/i18n/server';

export default async function AccessDeniedPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale);
  const dictionary = getDictionary(locale);

  return (
    <main className="auth-page" id="main-content" tabIndex={-1}>
      <section className="auth-card">
        <span className="eyebrow">{dictionary.common.protected}</span>
        <h1>{dictionary.accessDenied.title}</h1>
        <p>{dictionary.accessDenied.body}</p>
        <Link className="button button-primary" href={`/${locale}`}>
          {dictionary.common.returnHome}
        </Link>
      </section>
    </main>
  );
}
