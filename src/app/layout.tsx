import type { Metadata } from 'next';
import { headers } from 'next/headers';
import './globals.css';
import '../styles/experience-os.css';
import { defaultLocale, isLocale } from '@/i18n/config';
import { PwaRegistration } from '@/components/pwa-registration';

export const metadata: Metadata = {
  applicationName: 'VOYARA AI',
  title: 'VOYARA AI — Travel Operating System',
  description: 'Human-controlled travel operations for Azerbaijan.',
  manifest: '/manifest.webmanifest',
  metadataBase: new URL('https://voyara.ai'),
  openGraph: {
    title: 'VOYARA AI — Travel Operating System',
    description: 'Human-controlled travel operations for Azerbaijan.',
    siteName: 'VOYARA AI',
    type: 'website'
  }
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const requestHeaders = await headers();
  const requestedLocale = requestHeaders.get('x-voyara-locale') ?? defaultLocale;
  const locale = isLocale(requestedLocale) ? requestedLocale : defaultLocale;

  return (
    <html lang={locale}>
      <body>
        <a className="skip-link" href="#main-content">
          {locale === 'az' ? 'Əsas məzmuna keç' : locale === 'ru' ? 'Перейти к содержанию' : 'Skip to content'}
        </a>
        {children}
        <PwaRegistration />
      </body>
    </html>
  );
}
