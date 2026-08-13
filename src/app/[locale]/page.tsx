import Link from 'next/link';
import { MembershipPricing } from '@/components/membership-pricing';
import { PlatformShowcase } from '@/components/platform-showcase';
import { getDictionary } from '@/i18n/dictionaries';
import { requireLocale } from '@/i18n/server';
import { loadPublicMembershipCatalogue } from '@/server/administration/queries';
import { MEMBERSHIP_CATALOGUE, getInheritanceLabel } from '@/lib/membership-catalogue';
import { PersonalMembershipComparison, CorporateMembershipComparison } from '@/components/membership-comparison';
import { MemberValueJourney } from '@/components/member-value-journey';
import { AiAgentMembershipSection } from '@/components/ai-agent-membership-section';

/** Look up the rich catalogue entry for a legacy lowercase plan code
 *  (e.g. 'smart', 'starter') by matching against the catalogue's `slug`.
 *  Pricing itself still comes exclusively from loadPublicMembershipCatalogue
 *  / plan-authority — this only supplies descriptive content. */
function catalogueEntryForSlug(planCode: string) {
  return MEMBERSHIP_CATALOGUE.find((p) => p.slug === planCode) ?? null;
}

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
    plans.map((plan) => {
      const richEntry = catalogueEntryForSlug(plan.planCode);
      return {
        planCode: plan.planCode,
        displayName: plan.displayName,
        monthly: fmtMinor(plan.monthlyMinor),
        annual: fmtMinor(plan.annualMinor),
        bestFor: richEntry?.bestFor[locale],
        benefits: richEntry ? richEntry.additionalBenefits[locale] : undefined,
        ctaLabel: richEntry?.ctaLabel[locale],
        inheritanceLabel: richEntry ? getInheritanceLabel(richEntry.planCode, locale) : undefined
      };
    });
  const personalPriced = priceOf(personalMemberships);
  const corporatePriced = priceOf(corporateMemberships);

  const journey = dictionary.landing.journeySteps;
  const authorityFlow = dictionary.landing.authorityFlow;
  const audienceTargets = ['memberships', 'membership-premium', 'corporate-memberships'] as const;

  return (
    <main className="landing-v2" id="main-content" tabIndex={-1}>
      <section className="hero-v2">
        <div className="hero-veil" aria-hidden="true" />
        <div className="hero-ambient hero-ambient-one" aria-hidden="true" />
        <div className="hero-ambient hero-ambient-two" aria-hidden="true" />
        <div className="hero-grid">
          <div className="hero-in">
            <span className="eyebrow eyebrow-inverse">{dictionary.landing.eyebrow}</span>
            <h1>
              <span>{dictionary.landing.title}</span>
              <em>{dictionary.landing.heroAccent}</em>
            </h1>
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
              <span className="statline-chip statline-chip-trust">{dictionary.landing.statApproval}</span>
            </div>
          </div>

          <div className="hero-proof">
            <div className="hero-brand-card" aria-hidden="true">
              <img
                alt=""
                decoding="async"
                fetchPriority="high"
                height={260}
                src="/brand/voyara-logo-master.jpg"
                width={260}
              />
            </div>
            <article className="work-receipt" aria-labelledby="work-receipt-title">
              <div className="work-receipt-topline">
                <span className="work-receipt-demo">{dictionary.landing.receiptExampleLabel}</span>
                <span className="work-receipt-status">
                  <i aria-hidden="true" />
                  {dictionary.landing.workReceiptStatus}
                </span>
              </div>
              <span className="work-receipt-kicker">{dictionary.landing.workReceiptKicker}</span>
              <h2 id="work-receipt-title">{dictionary.landing.workReceiptTitle}</h2>
              <div className="work-receipt-metric">
                <strong>{dictionary.landing.workReceiptMetricValue}</strong>
                <span>{dictionary.landing.workReceiptMetricLabel}</span>
              </div>
              <ol className="work-receipt-steps">
                {dictionary.landing.workReceiptSteps.map(([label, value], index) => (
                  <li className={`receipt-step receipt-step-${index + 1}`} key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </li>
                ))}
              </ol>
              <p className="work-receipt-boundary">
                <i aria-hidden="true">✦</i>
                {dictionary.landing.workReceiptBoundary}
              </p>
            </article>
          </div>
        </div>

        <div className="hero-audience" aria-labelledby="audience-title">
          <div className="hero-audience-heading">
            <span>{dictionary.landing.audienceEyebrow}</span>
            <h2 id="audience-title">{dictionary.landing.audienceTitle}</h2>
            <p>{dictionary.landing.audienceLead}</p>
          </div>
          <div className="hero-audience-grid">
            {dictionary.landing.audiences.map(([title, body, action], index) => (
              <Link className="audience-card" href={`/${locale}#${audienceTargets[index]}`} key={title}>
                <span className="audience-index" aria-hidden="true">0{index + 1}</span>
                <span className="audience-copy">
                  <strong>{title}</strong>
                  <span>{body}</span>
                </span>
                <span className="audience-action">{action} <i aria-hidden="true">→</i></span>
              </Link>
            ))}
          </div>
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

      <section className="sect scope-section" id="scope" aria-labelledby="scope-title">
        <div className="section-heading">
          <span className="eyebrow">VOYARA</span>
          <h2 id="scope-title">{dictionary.landing.scopeTitle}</h2>
          <p>{dictionary.landing.scopeLead}</p>
        </div>
        <ul className="scope-grid">
          {dictionary.landing.scopeItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="story-band sect" id="how" aria-label={dictionary.landing.journeyTitle}>
        <div className="story-cap">
          <span className="eyebrow">{dictionary.landing.journeyEyebrow}</span>
          <h2>{dictionary.landing.journeyTitle}</h2>
          <p>{dictionary.landing.journeyLead}</p>
        </div>
        <div className="storyrail">
          {journey.map((node, index) => {
            const tone = index === 1 ? 'em' : index === 2 || index === 3 ? 'gold' : '';
            return (
              <span className="storyrail-item" key={node}>
                <span className={`snode${tone ? ` ${tone}` : ''}`}>{node}</span>
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
          <p>{dictionary.landing.whyLead}</p>
        </div>
        <div className="why-grid">
          {dictionary.landing.why.map(([title, body], index) => (
            <article className="why-card" key={title}>
              <span className="why-card-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="sect authority-flow-section" id="authority" aria-labelledby="authority-title">
        <div className="section-heading">
          <span className="eyebrow">VOYARA</span>
          <h2 id="authority-title">{dictionary.landing.authorityFlowTitle}</h2>
          <p>{dictionary.landing.authorityBody}</p>
        </div>
        <div className="authority-principles">
          {dictionary.landing.authorityPrinciples.map(([title, body], index) => (
            <article className={`authority-principle authority-principle-${index + 1}`} key={title}>
              <span aria-hidden="true">0{index + 1}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
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
        <p className="authority-boundary">
          <i aria-hidden="true">✦</i>
          {dictionary.landing.authorityBoundary}
        </p>
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
        <PersonalMembershipComparison locale={locale} />
        <CorporateMembershipComparison locale={locale} />
      </section>

      <MemberValueJourney locale={locale} />

      <AiAgentMembershipSection locale={locale} />

      <section className="authority-section founder-section landing-founder-band" id="founder">
        <figure className="founder-figure">
          <img
            alt={dictionary.landing.founderRole}
            className="founder-logo"
            decoding="async"
            height={160}
            loading="lazy"
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
