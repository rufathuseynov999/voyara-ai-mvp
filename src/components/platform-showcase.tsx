'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
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
  // Clean-load default is always screen 01 (index 0) — a stale index-1
  // default here previously made screen 02 active on first paint, which is
  // exactly the "opens on the wrong screen" defect this fixes.
  const [active, setActive] = useState<ScreenDefinition>(screenRegistry[0]);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Restore the selected showcase screen from the URL hash (#s1..#s8) on mount
  // and whenever the hash changes (e.g. after a client-side language switch).
  // Only ever applies when the URL explicitly carries a valid hash — a plain
  // URL with no hash leaves the screen-01 default untouched.
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

  // Keep the active tab fully visible within the horizontal selector, both
  // on first paint and after every interaction/hash change — this never
  // touches page-level scroll (only the selector's own scrollLeft), so it
  // cannot cause the whole page to jump.
  useEffect(() => {
    const list = listRef.current;
    const item = itemRefs.current[active.key];
    if (!list || !item) return;
    const listRect = list.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const isFullyVisible = itemRect.left >= listRect.left && itemRect.right <= listRect.right;
    if (!isFullyVisible) {
      const delta = itemRect.left < listRect.left
        ? itemRect.left - listRect.left
        : itemRect.right - listRect.right;
      list.scrollBy({ left: delta, behavior: 'smooth' });
    }
  }, [active]);

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
      <div className="sc-list" ref={listRef} role="tablist" aria-label={dictionary.landing.showcaseTitle}>
        {screenRegistry.map((screen) => {
          const sc = dictionary.screens[screen.key];
          const on = screen.key === active.key;
          return (
            <button
              aria-selected={on}
              className={`sc-item${on ? ' on' : ''}`}
              key={screen.key}
              onClick={() => selectScreen(screen)}
              ref={(el) => { itemRefs.current[screen.key] = el; }}
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
