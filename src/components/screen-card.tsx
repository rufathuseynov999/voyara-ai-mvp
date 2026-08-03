import Link from 'next/link';
import type { Dictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';
import type { ScreenDefinition } from '@/lib/screen-registry';

export function ScreenCard({
  dictionary,
  locale,
  screen
}: {
  dictionary: Dictionary;
  locale: Locale;
  screen: ScreenDefinition;
}) {
  const content = dictionary.screens[screen.key];

  return (
    <article className="screen-card">
      <div className="screen-card-topline">
        <span className="screen-number">{content.number}</span>
        <span className={`audience audience-${screen.audience}`}>{dictionary.shell[screen.audience]}</span>
      </div>
      <h3>{content.title}</h3>
      <p>{content.description}</p>
      <Link className="text-link" href={screen.route(locale)}>
        {dictionary.common.open} <span aria-hidden="true">→</span>
      </Link>
    </article>
  );
}
