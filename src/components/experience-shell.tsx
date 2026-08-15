'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { BrandMark } from './brand-mark';
import { LocaleSwitcher } from './locale-switcher';
import type { Dictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';

/**
 * UX2 — Global Customer Experience Shell.
 *
 * Wraps every authenticated customer surface (Ask VOYARA, Trip Wizard,
 * Journey Canvas / Proposal, Trip Room, Membership) in one continuous
 * navigation frame instead of disconnected screens, per the frozen
 * VOYARA-EXPERIENCE-OS-v1.md architecture.
 *
 * Desktop: persistent left rail (brand + primary nav + locale).
 * Mobile: top bar (brand + locale) + bottom tab bar for thumb reach.
 *
 * The ME / FAMILY / WORK context switcher is a non-authoritative UI
 * affordance only (per spec §4) — it renders as a visibly disabled
 * "coming soon" control. It does not read or write any backend state.
 */
export function ExperienceShell({
  children,
  dictionary,
  locale,
  planCode = null
}: {
  children: React.ReactNode;
  dictionary: Dictionary;
  locale: Locale;
  planCode?: string | null;
}) {
  const pathname = usePathname() ?? '';
  const strings = dictionary.experienceShell;
  const membershipStrings = dictionary.membershipContext;
  // UX3 — Membership-in-context (§12): only rendered when a real ACTIVE
  // membership was loaded server-side (see (customer)/layout.tsx). No
  // fallback/placeholder plan is ever shown for a viewer without one.
  const planLabel = planCode ? planCode.charAt(0) + planCode.slice(1).toLowerCase() : null;

  const primaryNav = [
    { href: `/${locale}`, label: strings.navHome, match: (p: string) => p === `/${locale}` },
    { href: `/${locale}/ask`, label: strings.navAsk, match: (p: string) => p.startsWith(`/${locale}/ask`) },
    {
      href: `/${locale}/trip-room`,
      label: strings.navTrips,
      match: (p: string) => p.startsWith(`/${locale}/trip-room`) || p.startsWith(`/${locale}/proposal`) || p.startsWith(`/${locale}/trip-wizard`)
    },
    { href: `/${locale}/membership`, label: strings.navMembership, match: (p: string) => p.startsWith(`/${locale}/membership`) }
  ];

  return (
    <div className="exp-shell">
      <header className="exp-topbar">
        <Link className="exp-brand" href={`/${locale}`} aria-label="VOYARA AI">
          <BrandMark />
          <span className="exp-brand-copy">VOYARA</span>
        </Link>
        <div className="exp-topbar-actions">
          {planLabel ? (
            <Link className="exp-membership-badge" href={`/${locale}/membership`} title={membershipStrings.currentPlanLabel}>
              {planLabel} <span>{membershipStrings.planBadgeSuffix}</span>
            </Link>
          ) : null}
          <LocaleSwitcher locale={locale} />
        </div>
      </header>

      <div className="exp-body">
        <nav aria-label={strings.navigationLabel} className="exp-rail">
          <ExperienceContextSwitcher strings={strings} variant="rail" />
          <ul className="exp-rail-list">
            {primaryNav.map((item) => (
              <li key={item.href}>
                <Link
                  aria-current={item.match(pathname) ? 'page' : undefined}
                  className={item.match(pathname) ? 'exp-rail-link is-active' : 'exp-rail-link'}
                  href={item.href}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="exp-workspace">{children}</div>
      </div>

      <nav aria-label={strings.navigationLabel} className="exp-bottom-nav">
        {primaryNav.map((item) => (
          <Link
            aria-current={item.match(pathname) ? 'page' : undefined}
            className={item.match(pathname) ? 'exp-bottom-link is-active' : 'exp-bottom-link'}
            href={item.href}
            key={item.href}
          >
            <span className="exp-bottom-dot" aria-hidden="true" />
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

function ExperienceContextSwitcher({
  strings,
  variant = 'topbar'
}: {
  strings: Dictionary['experienceShell'];
  variant?: 'topbar' | 'rail';
}) {
  const [context] = useState<'me' | 'family' | 'work'>('me');
  const options: Array<{ id: 'me' | 'family' | 'work'; label: string }> = [
    { id: 'me', label: strings.contextMe },
    { id: 'family', label: strings.contextFamily },
    { id: 'work', label: strings.contextWork }
  ];

  return (
    <div className={variant === 'rail' ? 'exp-context-switcher exp-context-switcher-rail' : 'exp-context-switcher'}>
      {options.map((option) => (
        <button
          aria-disabled={option.id !== 'me'}
          aria-pressed={context === option.id}
          className={context === option.id ? 'exp-context-chip is-active' : 'exp-context-chip'}
          disabled={option.id !== 'me'}
          key={option.id}
          title={option.id !== 'me' ? strings.contextComingSoon : undefined}
          type="button"
        >
          {option.label}
          {option.id !== 'me' ? <span className="exp-context-badge">{strings.contextComingSoon}</span> : null}
        </button>
      ))}
    </div>
  );
}
