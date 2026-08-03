'use client';

import { usePathname } from 'next/navigation';
import { locales, type Locale } from '@/i18n/config';

export function LocaleSwitcher({ locale }: { locale: Locale }) {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);
  const suffix = segments.slice(1).join('/');

  const hrefFor = (candidate: Locale) => `/${candidate}${suffix ? `/${suffix}` : ''}`;

  return (
    <nav className="locale-switcher" aria-label="AZ / RU / EN">
      {locales.map((candidate) => (
        <a
          className={candidate === locale ? 'locale-link is-active' : 'locale-link'}
          href={hrefFor(candidate)}
          hrefLang={candidate}
          key={candidate}
          onClick={(event) => {
            // Preserve the current hash (e.g. selected showcase screen #s4)
            // across the language change so AZ -> RU -> EN keeps the same screen.
            if (typeof window !== 'undefined') {
              event.preventDefault();
              window.location.assign(`${hrefFor(candidate)}${window.location.hash}`);
            }
          }}
        >
          {candidate.toUpperCase()}
        </a>
      ))}
    </nav>
  );
}
