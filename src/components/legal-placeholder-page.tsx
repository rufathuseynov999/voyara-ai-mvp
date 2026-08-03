import Link from 'next/link';
import type { Dictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';

/**
 * Founder-review correction: the footer previously had no Privacy/Terms/
 * Contact/Support links at all. This is a single, clearly-labelled
 * "coming soon" placeholder — no legal text is invented here; it exists only
 * so the footer links resolve to something honest rather than a 404 or
 * fabricated policy text. Replace with real content once approved.
 */
export function LegalPlaceholderPage({
  dictionary,
  locale,
  title
}: {
  dictionary: Dictionary;
  locale: Locale;
  title: string;
}) {
  return (
    <main className="auth-page" id="main-content" tabIndex={-1}>
      <section className="auth-card">
        <span className="eyebrow">{dictionary.legal.comingSoonBadge}</span>
        <h1>{title}</h1>
        <p>{dictionary.legal.comingSoonBody}</p>
        <Link className="button button-primary" href={`/${locale}`}>
          {dictionary.common.returnHome}
        </Link>
      </section>
    </main>
  );
}
