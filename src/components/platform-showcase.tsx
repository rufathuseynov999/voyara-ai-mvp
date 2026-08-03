'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Dictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';
import { screenRegistry, type ScreenDefinition } from '@/lib/screen-registry';

/**
 * Integrated eight-screen platform showcase (client component).
 * Renders a selector plus a realistic interface preview for each real MVP screen.
 * Protected routes stay role-gated in the application; this is a safe static preview.
 */
export function PlatformShowcase({
  dictionary,
  locale
}: {
  dictionary: Dictionary;
  locale: Locale;
}) {
  const [active, setActive] = useState<ScreenDefinition>(screenRegistry[1]);

  // Restore the selected showcase screen from the URL hash (#s1..#s8) on mount
  // and whenever the hash changes (e.g. after a client-side language switch).
  useEffect(() => {
    const syncFromHash = () => {
      const id = window.location.hash.replace('#', '');
      const match = screenRegistry.find((screen) => screen.legacyId === id);
      if (match) setActive(match);
    };
    syncFromHash();
    window.addEventListener('hashchange', syncFromHash);
    return () => window.removeEventListener('hashchange', syncFromHash);
  }, []);

  const selectScreen = (screen: ScreenDefinition) => {
    setActive(screen);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `#${screen.legacyId}`);
    }
  };
  const content = dictionary.screens[active.key];
  const route = active.route(locale);

  return (
    <div className="sc-grid">
      <div className="sc-list" role="tablist" aria-label={dictionary.landing.showcaseTitle}>
        {screenRegistry.map((screen) => {
          const sc = dictionary.screens[screen.key];
          const on = screen.key === active.key;
          return (
            <button
              aria-selected={on}
              className={`sc-item${on ? ' on' : ''}`}
              key={screen.key}
              onClick={() => selectScreen(screen)}
              role="tab"
              type="button"
            >
              <span className="sc-n">{sc.number}</span>
              <span>
                <span className="aud">{dictionary.shell[screen.audience]}</span>
                <span className="sc-item-title">{sc.title}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="sc-stage">
        <div className="dev-bar">
          <span className="dd" />
          <span className="dd" />
          <span className="dd" />
          <span className="durl">voyara.az{route}</span>
          <span className="daud">{dictionary.shell[active.audience]}</span>
        </div>
        <div className="dev-body">
          <div className="scr-h">
            <span className="num">{content.number}</span>
            <h3>{content.title}</h3>
          </div>
          <p className="scr-desc">{content.description}</p>
          <ScreenState screenKey={active.key} states={content.states} />
          <div className="sc-actions">
            <span className="badge-demo">● {dictionary.landing.demoBadge}</span>
            <Link className="text-link" href={route}>
              {dictionary.landing.openScreen} <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScreenState({ screenKey, states }: { screenKey: string; states: readonly string[] }) {
  if (screenKey === 'payment') {
    return (
      <div className="paysteps">
        {states.map((state, index) => (
          <div className={`payst${index === 0 ? ' done' : index === 1 ? ' on' : ''}`} key={state}>
            {state}
          </div>
        ))}
      </div>
    );
  }
  if (screenKey === 'crm' || screenKey === 'founder') {
    return (
      <div className="preview-metrics">
        {states.map((state) => (
          <article className="preview-metric" key={state}>
            <span className="pm-dot" aria-hidden="true" />
            <span>{state}</span>
          </article>
        ))}
      </div>
    );
  }
  return (
    <div className="preview-rows">
      {states.map((state, index) => (
        <div className="preview-row" key={state}>
          <span className="pr-index">0{index + 1}</span>
          <span>{state}</span>
        </div>
      ))}
    </div>
  );
}
