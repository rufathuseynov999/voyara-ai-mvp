import Link from 'next/link';
import { MembershipPricing } from '@/components/membership-pricing';
import { PlatformShowcase } from '@/components/platform-showcase';
import { getDictionary } from '@/i18n/dictionaries';
import { requireLocale } from '@/i18n/server';
import { loadPublicMembershipCatalogue } from '@/server/administration/queries';

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale);
  const dictionary = getDictionary(locale);
  const numberFormat = new Intl.NumberFormat(locale === 'az' ? 'az-AZ' : locale === 'ru' ? 'ru-RU' : 'en-US');
  const membershipCatalogue = await loadPublicMembershipCatalogue();
  const personalMemberships = membershipCatalogue.filter((plan) => plan.audience === 'PERSONAL');
  const corporateMemberships = membershipCatalogue.filter((plan) => plan.audience === 'CORPORATE');
  const monthlyMinors = personalMemberships
    .map((plan) => plan.monthlyMinor)
    .filter((minor): minor is number => minor !== null && minor > 0);
  const plansFromMinor = monthlyMinors.length > 0 ? Math.min(...monthlyMinors) : null;
  const fmtMinor = (minor: number | null) => (minor === null ? null : numberFormat.format(minor / 100));
  const priceOf = (plans: typeof membershipCatalogue) =>
    plans.map((plan) => ({
      planCode: plan.planCode,
      displayName: plan.displayName,
      monthly: fmtMinor(plan.monthlyMinor),
      annual: fmtMinor(plan.annualMinor)
    }));
  const personalPriced = priceOf(personalMemberships);
  const corporatePriced = priceOf(corporateMemberships);

  const journey = dictionary.landing.journeySteps;
  const authorityFlow = dictionary.landing.authorityFlow;

  return (
    <main className="landing-v2" id="main-content" tabIndex={-1}>
      <section className="hero-v2">
        <div className="hero-veil" aria-hidden="true" />
        <img alt="" aria-hidden="true" className="hero-watermark" decoding="async" height={520} src="/brand/voyara-logo.jpg" width={520} />
        <div className="hero-grid">
          <div className="hero-in">
            <span className="eyebrow eyebrow-inverse">{dictionary.landing.eyebrow}</span>
            <h1>{dictionary.landing.title}</h1>
            <p>{dictionary.landing.lead}</p>
            <div className="hero-actions">
              <Link className="btn btn-gold" href={`/${locale}/trip-wizard`}>
                {dictionary.landing.primaryAction}
              </Link>
              <Link className="btn btn-ghost-inverse" href={`/${locale}#screens`}>
                {dictionary.landing.secondaryAction}
              </Link>
            </div>
            <div className="statline">
              {plansFromMinor !== null && (
                <span className="statline-chip">
                  {dictionary.landing.statPlansFrom.replace('{price}', numberFormat.format(plansFromMinor / 100))}
                </span>
              )}
              <i aria-hidden="true">✦</i>
              <span className="statline-chip statline-chip-trust">{dictionary.landing.statApproval}</span>
            </div>
          </div>
          <div className="hero-preview" aria-hidden="true">
            <div className="hp-top">
              <span className="dot" /><span className="dot" /><span className="dot" />
              <span className="hp-top-label">{dictionary.landing.authorityFlowTitle}</span>
            </div>
            <div className="hp-row">{journey[1]}<span className="tag ai">{authorityFlow[0]}</span></div>
            <div className="hp-row">{journey[5]}<span className="tag human">{authorityFlow[1]}</span></div>
            <div className="hp-row">{journey[9]}<span className="tag ok">✓</span></div>
          </div>
        </div>
      </section>

      <section className="story-band sect" id="how" aria-label={dictionary.landing.journeyTitle}>
        <div className="story-cap">
          <span className="eyebrow">{dictionary.landing.journeyEyebrow}</span>
          <h2>{dictionary.landing.journeyTitle}</h2>
        </div>
        <div className="storyrail">
          {journey.map((node, index) => {
            const tone = index === 4 || index === 7 || index === 8 ? 'gold' : index === 3 ? 'em' : '';
            return (
              <span className="storyrail-item" key={node}>
                <span className={`snode${tone ? ` ${tone}` : ''}`} style={{ '--i': index } as React.CSSProperties}>{node}</span>
                {index < journey.length - 1 && <span className="sarr" aria-hidden="true">→</span>}
              </span>
            );
          })}
        </div>
      </section>

      <section className="sect why-section" id="why" aria-labelledby="why-title">
        <div className="section-heading">
          <span className="eyebrow">VOYARA</span>
          <h2 id="why-title">{dictionary.landing.whyTitle}</h2>
        </div>
        <div className="why-grid">
          {dictionary.landing.why.map(([title, body], index) => (
            <article className="why-card" key={title} style={{ '--i': index } as React.CSSProperties}>
              <span className="why-card-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="screens-section sect showcase" id="screens" aria-labelledby="screens-title">
        <div className="section-heading section-heading-wide">
          <span className="eyebrow">MVP 01—08</span>
          <h2 id="screens-title">{dictionary.landing.showcaseTitle}</h2>
          <p>{dictionary.landing.showcaseLead}</p>
        </div>
        <PlatformShowcase dictionary={dictionary} locale={locale} />
      </section>

      <section className="sect authority-flow-section" aria-labelledby="authority-title">
        <div className="section-heading">
          <span className="eyebrow">VOYARA</span>
          <h2 id="authority-title">{dictionary.landing.authorityFlowTitle}</h2>
          <p>{dictionary.landing.authorityBody}</p>
        </div>
        <div className="authflow">
          {authorityFlow.map((step, index) => {
            const human = index === 1 || index === 3 || index === 5;
            const ai = index === 0;
            return (
              <span className="authstep" key={step}>
                <span className={`authbox${ai ? ' ai' : human ? ' human' : ''}`}>{step}</span>
                {index < authorityFlow.length - 1 && <span className="sarr" aria-hidden="true">→</span>}
              </span>
            );
          })}
        </div>
      </section>

      <section className="membership-section sect" id="memberships" aria-labelledby="personal-memberships">
        <div className="section-heading">
          <span className="eyebrow">VOYARA</span>
          <h2 id="personal-memberships">{dictionary.landing.personalTitle}</h2>
        </div>
        <MembershipPricing
          corporate={corporatePriced}
          dictionary={dictionary}
          locale={locale}
          personal={personalPriced}
        />
      </section>

      <section className="authority-section founder-section landing-founder-band" id="founder">
        <figure className="founder-figure">
          <img
            alt={dictionary.landing.founderRole}
            className="founder-logo"
            decoding="async"
            height={160}
            src="/brand/founder-rufat-huseynov-logo.jpg"
            width={160}
          />
          <figcaption>{dictionary.landing.founderRole}</figcaption>
        </figure>
        <div>
          <span className="eyebrow founder-kicker">{dictionary.landing.founderKicker}</span>
          <h2>{dictionary.landing.founderName}</h2>
          <p>{dictionary.landing.founderBio}</p>
        </div>
      </section>

      <section className="final-cta">
        <div className="final-in">
          <span className="eyebrow eyebrow-inverse">VOYARA</span>
          <h2>{dictionary.landing.finalTitle}</h2>
          <div className="final-actions">
            <Link className="btn btn-gold" href={`/${locale}/trip-wizard`}>
              {dictionary.landing.finalStart}
            </Link>
            <Link className="btn btn-ghost-inverse" href={`/${locale}#screens`}>
              {dictionary.landing.finalExplore}
            </Link>
          </div>
          <p className="final-trust">
            <i aria-hidden="true">✦</i> {dictionary.landing.statApproval}
          </p>
        </div>
      </section>
    </main>
  );
}
