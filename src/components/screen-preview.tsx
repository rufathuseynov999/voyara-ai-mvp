import type { ReactNode } from 'react';
import type { Dictionary } from '@/i18n/dictionaries';
import type { ScreenKey } from '@/lib/screen-registry';

export function ScreenPreview({
  children,
  dictionary,
  screenKey
}: {
  children?: ReactNode;
  dictionary: Dictionary;
  screenKey: ScreenKey;
}) {
  const content = dictionary.screens[screenKey];

  return (
    <main className="screen-page" id="main-content" tabIndex={-1}>
      <section className="screen-heading">
        <span className="screen-number screen-number-large">{content.number}</span>
        <span className="eyebrow">{dictionary.common.foundation}</span>
        <h1>{content.title}</h1>
        <p>{content.description}</p>
      </section>

      <section className="state-grid" aria-label={dictionary.common.status}>
        {content.states.map((state, index) => (
          <article className="state-card" key={state}>
            <span className="state-index">0{index + 1}</span>
            <h2>{state}</h2>
            <p>{dictionary.common.notEnabled}</p>
          </article>
        ))}
      </section>

      <aside className="authority-strip">
        <div>
          <span>{dictionary.common.status}</span>
          <strong>{dictionary.common.foundation}</strong>
        </div>
        <div>
          <span>{dictionary.common.authority}</span>
          <strong>{dictionary.common.protected}</strong>
        </div>
        <div>
          <span>{dictionary.common.dataSource}</span>
          <strong>{dictionary.common.preview}</strong>
        </div>
      </aside>
      {children}
    </main>
  );
}
