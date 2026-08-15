export const dynamic = 'force-dynamic';

import { AskVoyara } from '@/components/ask-voyara';
import { getDictionary } from '@/i18n/dictionaries';
import { requireLocale } from '@/i18n/server';
import { requireViewerRole } from '@/server/auth/viewer';

export default async function AskVoyaraPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale);
  const dictionary = getDictionary(locale);
  await requireViewerRole(locale, ['customer'], `/${locale}/ask`);

  return (
    <main className="screen-page ask-voyara-page" id="main-content" tabIndex={-1}>
      <section className="screen-heading">
        <span className="eyebrow">{dictionary.askVoyara.eyebrow}</span>
        <h1>{dictionary.askVoyara.title}</h1>
      </section>
      <AskVoyara locale={locale} messages={dictionary.askVoyara} requestMessages={dictionary.travelRequest} />
    </main>
  );
}
