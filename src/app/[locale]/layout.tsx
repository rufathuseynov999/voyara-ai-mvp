import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { WebsiteChatWidget } from '@/components/website-chat-widget';
import { locales } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { requireLocale } from '@/i18n/server';

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const dictionary = getDictionary(locale);
  return {
    title: dictionary.meta.title,
    description: dictionary.meta.description,
    alternates: {
      languages: {
        az: '/az',
        ru: '/ru',
        en: '/en'
      }
    }
  };
}

export default async function LocaleLayout({
  children,
  params
}: Readonly<{ children: React.ReactNode; params: Promise<{ locale: string }> }>) {
  const locale = requireLocale((await params).locale);
  const dictionary = getDictionary(locale);

  return (
    <div className="site-shell">
      <SiteHeader dictionary={dictionary} locale={locale} />
      {children}
      <footer className="site-footer">
        <span>© {new Date().getUTCFullYear()} VOYARA AI</span>
        <span>{dictionary.landing.footerTagline}</span>
        <nav className="footer-links" aria-label={dictionary.footerLinks.privacy}>
          <Link href={`/${locale}/privacy`}>{dictionary.footerLinks.privacy}</Link>
          <Link href={`/${locale}/terms`}>{dictionary.footerLinks.terms}</Link>
          <Link href={`/${locale}/contact`}>{dictionary.footerLinks.contact}</Link>
          <Link href={`/${locale}/support`}>{dictionary.footerLinks.support}</Link>
        </nav>
      </footer>
      <WebsiteChatWidget labels={dictionary.chat} initialLocale={locale} />
    </div>
  );
}
