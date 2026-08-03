'use client';

import Link from 'next/link';
import { useState } from 'react';
import { BrandMark } from './brand-mark';
import { LocaleSwitcher } from './locale-switcher';
import type { Dictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';

export function SiteHeader({ dictionary, locale }: { dictionary: Dictionary; locale: Locale }) {
  const [open, setOpen] = useState(false);
  const links = [
    { href: `/${locale}`, label: dictionary.nav.home },
    { href: `/${locale}/trip-wizard`, label: dictionary.nav.wizard },
    { href: `/${locale}#screens`, label: dictionary.nav.screens }
  ];

  return (
    <header className="site-header">
      <div className="header-inner">
        <Link className="brand" href={`/${locale}`} aria-label="VOYARA AI">
          <BrandMark />
        </Link>
        <nav className="primary-nav" aria-label={dictionary.nav.screens}>
          {links.map((link) => (
            <Link href={link.href} key={link.href}>
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="header-actions">
          <LocaleSwitcher locale={locale} />
          <Link className="button button-quiet header-login" href={`/${locale}/login`}>
            {dictionary.nav.login}
          </Link>
          <button
            aria-expanded={open}
            aria-label="Menu"
            className="menu-toggle"
            onClick={() => setOpen((value) => !value)}
            type="button"
          >
            <span aria-hidden="true">{open ? '✕' : '☰'}</span>
          </button>
        </div>
      </div>
      {open && (
        <nav className="mobile-nav" aria-label={dictionary.nav.screens}>
          {links.map((link) => (
            <Link href={link.href} key={link.href} onClick={() => setOpen(false)}>
              {link.label}
            </Link>
          ))}
          <Link className="mobile-login" href={`/${locale}/login`} onClick={() => setOpen(false)}>
            {dictionary.nav.login}
          </Link>
        </nav>
      )}
    </header>
  );
}
