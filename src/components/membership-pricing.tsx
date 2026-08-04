'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { Dictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';
export type PricedPlan = {
  planCode: string;
  displayName: string;
  monthly: string | null;
  annual: string | null;
};

/** Personal + corporate membership pricing with a working monthly/annual selector.
 *  Prices are pre-formatted on the server and passed in as strings, so server and
 *  client render identical markup (no locale-dependent hydration mismatch). */
export function MembershipPricing({
  dictionary,
  locale,
  personal,
  corporate
}: {
  dictionary: Dictionary;
  locale: Locale;
  personal: PricedPlan[];
  corporate: PricedPlan[];
}) {
  const [period, setPeriod] = useState<'monthly' | 'annual'>('monthly');
  const unit = period === 'monthly' ? dictionary.landing.monthly : dictionary.landing.annually;

  return (
    <>
      <div className="perctl" role="tablist" aria-label={dictionary.landing.personalTitle}>
        <button
          aria-selected={period === 'monthly'}
          className={period === 'monthly' ? 'on' : ''}
          onClick={() => setPeriod('monthly')}
          role="tab"
          type="button"
        >
          {dictionary.landing.monthlyLabel}
        </button>
        <button
          aria-selected={period === 'annual'}
          className={period === 'annual' ? 'on' : ''}
          onClick={() => setPeriod('annual')}
          role="tab"
          type="button"
        >
          {dictionary.landing.annualLabel}
        </button>
      </div>

      <div className="plans-v2">
        {personal.map((plan) => {
          const featured = plan.planCode === 'premium';
          const black = plan.planCode === 'black';
          const price = period === 'monthly' ? plan.monthly : plan.annual;
          return (
            <article className={`plan-v2${featured ? ' hot' : ''}${black ? ' black' : ''}`} key={plan.planCode}>
              {featured && <span className="plan-tag">{dictionary.landing.recommended}</span>}
              <span className="plan-nm">{plan.displayName}</span>
              <span className="plan-pr">
                {price ?? '—'} ₼<span>/{unit}</span>
              </span>
              <span className="plan-note">{dictionary.landing.planNotes[plan.planCode as keyof typeof dictionary.landing.planNotes]}</span>
              <span className="plan-ann">
                {plan.monthly ?? '—'} ₼/{dictionary.landing.monthly} · {plan.annual ?? '—'} ₼/{dictionary.landing.annually}
              </span>
              <Link
                className={`btn btn-sm${featured ? ' btn-gold' : black ? ' btn-ghost-inverse' : ' btn-ghost'}`}
                href={`/${locale}/trip-wizard`}
              >
                {dictionary.landing.selectPlan}
              </Link>
            </article>
          );
        })}
      </div>

      <div className="corpwrap">
        <div className="section-heading corporate-heading">
          <span className="eyebrow">{dictionary.landing.corporateTitle}</span>
          <p>{dictionary.landing.corporateBody}</p>
        </div>
        <ul className="corp-bullets">
          {dictionary.landing.corporateBullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
        <div className="corpgrid">
          {corporate.map((plan) => (
            <article className="plan-v2 corp2" key={plan.planCode}>
              <span className="plan-nm">{plan.displayName}</span>
              <span className="plan-pr plan-pr-corp">
                {plan.monthly === null ? dictionary.landing.custom : `${plan.monthly} ₼`}
                {plan.monthly !== null && <span>/{dictionary.landing.monthly}</span>}
              </span>
              <span className="plan-note">{dictionary.landing.planNotes[plan.planCode as keyof typeof dictionary.landing.planNotes]}</span>
              <Link className="btn btn-em btn-sm" href={`/${locale}/trip-wizard`}>
                {dictionary.landing.requestDemo}
              </Link>
            </article>
          ))}
        </div>
      </div>
      <p className="price-note">{dictionary.landing.priceNote}</p>
    </>
  );
}
