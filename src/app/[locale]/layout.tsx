import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
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

// UX2 — Experience OS routes (Ask VOYARA, Trip Wizard, Journey Canvas /
// proposal, Trip Room, Membership) render their own continuous
// ExperienceShell chrome one layout level in (see
// (customer)/layout.tsx and trip-wizard/page.tsx). Rendering the marketing
// SiteHeader/footer/chat widget around them as well would stack two
// competing navigation systems on the same screen. Every other route
// (landing, login, staff area, legal pages, etc.) keeps the marketing
// chrome exactly as before — this check is additive and route-scoped, not
// a change to any existing page.
const experienceOsPathPrefixes = ['/ask', '/trip-wizard', '/proposal', '/trip-room', '/membership', '/payment'];

function isExperienceOsPath(pathname: string): boolean {
  const withoutLocale = pathname.replace(/^\/[a-z]{2}(?=\/|$)/, '') || '/';
  return experienceOsPathPrefixes.some((prefix) => withoutLocale === prefix || withoutLocale.startsWith(`${prefix}/`));
}

// The staff operating workspace (and its internal, server-flag-gated
// preview) is a different chrome category from the customer Experience
// OS above — it is not customer-branded at all. It already has its own
// auth-gated layout (staff/layout.tsx: AccessBanner + AAL2/staff role
// check) and must never additionally render the marketing
// header/footer/chat widget or its customer "Plan a journey" CTA. This
// was a real defect: those routes previously fell through to the
// marketing-chrome branch below with no exclusion at all.
const bareChromePathPrefixes = ['/staff', '/internal-preview', '/experience-preview'];

function isBareChromePath(pathname: string): boolean {
  const withoutLocale = pathname.replace(/^\/[a-z]{2}(?=\/|$)/, '') || '/';
  return bareChromePathPrefixes.some((prefix) => withoutLocale === prefix || withoutLocale.startsWith(`${prefix}/`));
}

export default async function LocaleLayout({
  children,
  params
}: Readonly<{ children: React.ReactNode; params: Promise<{ locale: string }> }>) {
  const locale = requireLocale((await params).locale);
  const dictionary = getDictionary(locale);
  const requestHeaders = await headers();
  const pathname = requestHeaders.get('x-voyara-pathname') ?? '';
  const skipMarketingChrome = isExperienceOsPath(pathname) || isBareChromePath(pathname);

  if (skipMarketingChrome) {
    return <div className="site-shell">{children}</div>;
  }

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
