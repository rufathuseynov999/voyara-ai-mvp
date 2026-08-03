import { FounderAccessConsole } from '@/components/founder-access-console';
import { getDictionary } from '@/i18n/dictionaries';
import { requireLocale } from '@/i18n/server';
import { requireViewerRole } from '@/server/auth/viewer';

export default async function FounderAccessPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale);
  const dictionary = getDictionary(locale);
  await requireViewerRole(locale, ['founder'], `/${locale}/staff/founder/access`);

  return (
    <main className="screen-page" id="main-content" tabIndex={-1}>
      <section className="screen-heading">
        <span className="eyebrow">{dictionary.common.protected}</span>
        <h1>{dictionary.founderAccess.title}</h1>
        <p>{dictionary.founderAccess.body}</p>
      </section>
      <FounderAccessConsole locale={locale} messages={dictionary.founderAccess} />
    </main>
  );
}
