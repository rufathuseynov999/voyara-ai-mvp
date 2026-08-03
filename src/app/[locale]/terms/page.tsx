import { LegalPlaceholderPage } from '@/components/legal-placeholder-page';
import { getDictionary } from '@/i18n/dictionaries';
import { requireLocale } from '@/i18n/server';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale);
  const dictionary = getDictionary(locale);
  return <LegalPlaceholderPage dictionary={dictionary} locale={locale} title={dictionary.legal.termsTitle} />;
}
