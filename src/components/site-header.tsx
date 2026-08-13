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
    { href: `/${locale}#how`, label: dictionary.landing.navHow },
    { href: `/${locale}#screens`, label: dictionary.landing.navPlatform },
    { href: `/${locale}#memberships`, label: dictionary.landing.navMembership }
  ];

  return (
    <header className="site-header">
      <div className="header-inner">
        <Link className="brand" href={`/${locale}`} aria-label="VOYARA AI">
          <BrandMark />
          <span className="brand-copy" aria-hidden="true">
            <strong>VOYARA</strong>
            <small>{dictionary.landing.brandDescriptor}</small>
          </span>
        </Link>
        <nav className="primary-nav" aria-label={dictionary.landing.navigationLabel}>
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
          <Link className="button header-trip" href={`/${locale}/trip-wizard`}>
            {dictionary.landing.headerCta}
          </Link>
          <button
            aria-expanded={open}
            aria-label={dictionary.landing.menuLabel}
            className="menu-toggle"
            onClick={() => setOpen((value) => !value)}
            type="button"
          >
            <span aria-hidden="true" className={`menu-icon${open ? ' is-open' : ''}`}>
              <i />
              <i />
              <i />
            </span>
          </button>
        </div>
      </div>
      {open && (
        <nav className="mobile-nav" aria-label={dictionary.landing.navigationLabel}>
          {links.map((link) => (
            <Link href={link.href} key={link.href} onClick={() => setOpen(false)}>
              {link.label}
            </Link>
          ))}
          <Link className="mobile-login" href={`/${locale}/login`} onClick={() => setOpen(false)}>
            {dictionary.nav.login}
          </Link>
          <Link className="mobile-trip" href={`/${locale}/trip-wizard`} onClick={() => setOpen(false)}>
            {dictionary.landing.headerCta}
          </Link>
        </nav>
      )}
    </header>
  );
}
