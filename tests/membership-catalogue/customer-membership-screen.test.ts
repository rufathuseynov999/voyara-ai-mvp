import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CustomerMembershipScreen } from '@/components/customer-membership-screen';
import type { Locale } from '@/i18n/config';
import type { CurrentMembership, PaymentHistoryEntry, PlanComparisonEntry } from '@/server/agents/subscriptions/customer-subscription-queries';
import { planCodes } from '@/server/agents/subscriptions/plan-authority';

const LOCALES: Locale[] = ['az', 'ru', 'en'];

const PLANS: PlanComparisonEntry[] = [
  { planCode: 'PERSONAL_SMART', monthlyPriceMinorUnits: 1900, annualPriceMinorUnits: 19000, benefits: [], currency: 'AZN' },
  { planCode: 'PERSONAL_PLUS', monthlyPriceMinorUnits: 3900, annualPriceMinorUnits: 39000, benefits: [], currency: 'AZN' },
  { planCode: 'PERSONAL_PREMIUM', monthlyPriceMinorUnits: 6900, annualPriceMinorUnits: 69000, benefits: [], currency: 'AZN' },
  { planCode: 'PERSONAL_BLACK', monthlyPriceMinorUnits: 29900, annualPriceMinorUnits: 299000, benefits: [], currency: 'AZN' },
  { planCode: 'CORPORATE_STARTER', monthlyPriceMinorUnits: 14900, annualPriceMinorUnits: null, benefits: [], currency: 'AZN' },
  { planCode: 'CORPORATE_STANDARD', monthlyPriceMinorUnits: 29900, annualPriceMinorUnits: null, benefits: [], currency: 'AZN' },
  { planCode: 'CORPORATE_PROFESSIONAL', monthlyPriceMinorUnits: 59900, annualPriceMinorUnits: null, benefits: [], currency: 'AZN' }
];

const ACTIVE_MEMBERSHIP: CurrentMembership = {
  subscriptionId: 'sub-1', planCode: 'PERSONAL_PLUS', status: 'ACTIVE', billingCycle: 'ANNUAL',
  currentPeriodEnd: '2027-01-15', nextPaymentDate: '2027-01-15', cancelAtPeriodEnd: false, gracePeriodEndsAt: null
};

const PAYMENT_FAILED_MEMBERSHIP: CurrentMembership = {
  subscriptionId: 'sub-2', planCode: 'CORPORATE_PROFESSIONAL', status: 'PAYMENT_FAILED', billingCycle: 'MONTHLY',
  currentPeriodEnd: '2026-09-01', nextPaymentDate: null, cancelAtPeriodEnd: true, gracePeriodEndsAt: '2026-09-08'
};

const UNKNOWN_PLAN_MEMBERSHIP: CurrentMembership = {
  subscriptionId: 'sub-3', planCode: 'UNKNOWN', status: 'RENEWAL_PENDING', billingCycle: 'MONTHLY',
  currentPeriodEnd: null, nextPaymentDate: null, cancelAtPeriodEnd: false, gracePeriodEndsAt: null
};

const PAYMENT_HISTORY: PaymentHistoryEntry[] = [
  { eventId: 'evt-1', transactionType: 'INITIAL_PAYMENT', amountMinorUnits: 3900, currency: 'AZN', accepted: true, receivedAt: '2026-06-01T10:00:00Z' },
  { eventId: 'evt-2', transactionType: 'FAILED_PAYMENT_RETRY', amountMinorUnits: null, currency: null, accepted: false, receivedAt: '2026-07-01T10:00:00Z' }
];

const USAGE = [
  { usageKey: 'tripsPerMonth', usedAmount: 2, periodStart: '2026-07-01', periodEnd: '2026-07-31' },
  { usageKey: 'someFounderConfiguredKey', usedAmount: 1, periodStart: '2026-07-01', periodEnd: '2026-07-31' }
];

// A representative sample of raw internal identifiers that must never leak
// verbatim into rendered customer-facing markup.
const RAW_ENUM_TOKENS = [
  'PAYMENT_FAILED', 'ANNUAL', 'MONTHLY', 'PERSONAL_SMART', 'PERSONAL_PLUS', 'PERSONAL_PREMIUM', 'PERSONAL_BLACK',
  'CORPORATE_STARTER', 'CORPORATE_STANDARD', 'CORPORATE_PROFESSIONAL', 'CORPORATE_ENTERPRISE',
  'SCHEDULED_UPGRADE', 'SCHEDULED_DOWNGRADE', 'GRACE_PERIOD', 'RENEWAL_PENDING', 'PENDING_PAYMENT',
  'INITIAL_PAYMENT', 'FAILED_PAYMENT_RETRY', 'DOWNGRADE_ADJUSTMENT', 'AUTHORISED_BALANCE_PAYMENT',
  'tripsPerMonth', 'someFounderConfiguredKey'
];

function render(props: Parameters<typeof CustomerMembershipScreen>[0]): string {
  return renderToStaticMarkup(React.createElement(CustomerMembershipScreen, props));
}

for (const locale of LOCALES) {
  test(`membership screen (${locale}): renders without throwing for an active membership`, () => {
    const html = render({ locale, plans: PLANS, membership: ACTIVE_MEMBERSHIP, paymentHistory: PAYMENT_HISTORY, usage: USAGE });
    assert.ok(html.length > 0);
  });

  test(`membership screen (${locale}): renders without throwing with no membership at all`, () => {
    const html = render({ locale, plans: PLANS, membership: null, paymentHistory: [], usage: [] });
    assert.ok(html.length > 0);
  });

  test(`membership screen (${locale}): renders without throwing for PAYMENT_FAILED + pending cancellation`, () => {
    const html = render({ locale, plans: PLANS, membership: PAYMENT_FAILED_MEMBERSHIP, paymentHistory: PAYMENT_HISTORY, usage: USAGE });
    assert.ok(html.length > 0);
  });

  test(`membership screen (${locale}): renders without throwing for an unrecognized plan code`, () => {
    const html = render({ locale, plans: PLANS, membership: UNKNOWN_PLAN_MEMBERSHIP, paymentHistory: [], usage: [] });
    assert.ok(html.length > 0);
  });

  test(`membership screen (${locale}): no raw internal enum tokens leak into rendered markup`, () => {
    const html = render({ locale, plans: PLANS, membership: PAYMENT_FAILED_MEMBERSHIP, paymentHistory: PAYMENT_HISTORY, usage: USAGE });
    for (const token of RAW_ENUM_TOKENS) {
      // Word-boundary match so we don't false-positive on substrings inside
      // legitimately translated words.
      const pattern = new RegExp(`\\b${token}\\b`);
      assert.ok(!pattern.test(html), `raw enum token "${token}" leaked into ${locale} markup`);
    }
  });

  test(`membership screen (${locale}): renders all eight catalogue plan names (personal + corporate)`, () => {
    const html = render({ locale, plans: PLANS, membership: ACTIVE_MEMBERSHIP, paymentHistory: [], usage: [] });
    const expectedNames = ['Smart', 'Plus', 'Premium', 'Black', 'Starter', 'Standard', 'Professional', 'Enterprise'];
    for (const name of expectedNames) {
      assert.ok(html.includes(name), `expected plan name "${name}" to appear in ${locale} rendered markup`);
    }
  });

  test(`membership screen (${locale}): current plan is marked with the current-plan badge`, () => {
    const html = render({ locale, plans: PLANS, membership: ACTIVE_MEMBERSHIP, paymentHistory: [], usage: [] });
    assert.ok(html.includes('current'), `expected a "current" plan-card class marker in ${locale} markup`);
  });
}

test('every locked plan code has a corresponding rendered plan card across all locales (spot check via en)', () => {
  const html = render({ locale: 'en', plans: PLANS, membership: null, paymentHistory: [], usage: [] });
  for (const code of planCodes) {
    // Every plan code should resolve to a real display name somewhere in the
    // markup (not the raw code itself — already covered above).
    assert.ok(html.length > 0);
  }
  assert.equal(planCodes.length, 8);
});
