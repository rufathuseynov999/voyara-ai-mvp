import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PersonalMembershipComparison, CorporateMembershipComparison } from '@/components/membership-comparison';
import type { Locale } from '@/i18n/config';

const LOCALES: Locale[] = ['az', 'ru', 'en'];

function render(component: React.ReactElement): string {
  return renderToStaticMarkup(component);
}

for (const locale of LOCALES) {
  test(`personal comparison (${locale}): renders without throwing and includes all four personal plan names`, () => {
    const html = render(React.createElement(PersonalMembershipComparison, { locale }));
    for (const name of ['Smart', 'Plus', 'Premium', 'Black']) {
      assert.ok(html.includes(name), `expected "${name}" in personal comparison (${locale})`);
    }
  });

  test(`corporate comparison (${locale}): renders without throwing and includes all four corporate plan names`, () => {
    const html = render(React.createElement(CorporateMembershipComparison, { locale }));
    for (const name of ['Starter', 'Standard', 'Professional', 'Enterprise']) {
      assert.ok(html.includes(name), `expected "${name}" in corporate comparison (${locale})`);
    }
  });

  test(`personal comparison (${locale}): renders both a table region and a card-stack fallback (responsive, non-overflowing design)`, () => {
    const html = render(React.createElement(PersonalMembershipComparison, { locale }));
    assert.ok(html.includes('membership-comparison-scroll'), 'expected scrollable table region');
    assert.ok(html.includes('membership-comparison-table'), 'expected a real <table> for desktop/screen-readers');
    assert.ok(html.includes('membership-comparison-cards'), 'expected the accessible mobile card-stack fallback');
  });

  test(`corporate comparison (${locale}): table region is keyboard-focusable (tabIndex present) for accessible scrolling`, () => {
    const html = render(React.createElement(CorporateMembershipComparison, { locale }));
    assert.match(html, /tabindex="0"/i);
  });

  test(`corporate comparison (${locale}): Enterprise service-governance cell uses localized custom wording, not a raw enum or invented number`, () => {
    const html = render(React.createElement(CorporateMembershipComparison, { locale }));
    const customWording: Record<Locale, string> = {
      az: 'Enterprise üçün fərdi',
      ru: 'Индивидуально для Enterprise',
      en: 'Custom for Enterprise'
    };
    assert.ok(html.includes(customWording[locale]), `expected localized custom-Enterprise wording in ${locale}`);
    // No bare digit-only usage limits should appear anywhere in the table
    // body cells for founder-configurable rows (a loose but useful guard —
    // this checks no cell renders something like "10/month" which would
    // imply an invented hard number).
    assert.ok(!/\d+\s*\/\s*(month|ay|мес)/i.test(html), 'found what looks like an invented numeric usage limit');
  });

  test(`personal comparison (${locale}): annual saving row shows the exact locked saving figures, not invented values`, () => {
    const html = render(React.createElement(PersonalMembershipComparison, { locale }));
    for (const saving of ['38 ₼', '78 ₼', '138 ₼', '598 ₼']) {
      assert.ok(html.includes(saving), `expected annual saving "${saving}" in ${locale} personal comparison`);
    }
  });

  test(`personal comparison (${locale}): human-approval row is present and affirmative for every plan (HAG is universal, never optional)`, () => {
    const html = render(React.createElement(PersonalMembershipComparison, { locale }));
    const checkmarkCount = (html.match(/✓/g) ?? []).length;
    // At minimum one checkmark per personal plan for the always-true HAG row.
    assert.ok(checkmarkCount >= 4, `expected at least 4 checkmarks (HAG row x 4 plans), found ${checkmarkCount}`);
  });
}

test('no raw internal plan-code or enum tokens leak into either comparison table (spot check via en)', () => {
  const personalHtml = render(React.createElement(PersonalMembershipComparison, { locale: 'en' }));
  const corporateHtml = render(React.createElement(CorporateMembershipComparison, { locale: 'en' }));
  const rawTokens = [
    'PERSONAL_SMART', 'PERSONAL_PLUS', 'PERSONAL_PREMIUM', 'PERSONAL_BLACK',
    'CORPORATE_STARTER', 'CORPORATE_STANDARD', 'CORPORATE_PROFESSIONAL', 'CORPORATE_ENTERPRISE',
    'STANDARD_REVIEW', 'PRIORITY_REVIEW', 'NAMED_MANAGER_REVIEW', 'MANAGED_CONCIERGE', 'BESPOKE_VIP'
  ];
  for (const token of rawTokens) {
    const pattern = new RegExp(`\\b${token}\\b`);
    assert.ok(!pattern.test(personalHtml), `raw token "${token}" leaked into personal comparison`);
    assert.ok(!pattern.test(corporateHtml), `raw token "${token}" leaked into corporate comparison`);
  }
});
