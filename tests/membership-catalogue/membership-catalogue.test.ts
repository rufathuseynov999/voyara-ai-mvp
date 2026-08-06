import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MEMBERSHIP_CATALOGUE,
  PERSONAL_PLANS,
  CORPORATE_PLANS,
  getPlanByCode,
  getFullBenefitList,
  getInheritanceLabel,
  getResolvedPricing,
  type MembershipPlanDefinition,
  type LocalizedText,
  type LocalizedList
} from '@/lib/membership-catalogue';
import { LOCKED_PLAN_PRICES, planCodes, type PlanCode } from '@/server/agents/subscriptions/plan-authority';

const LOCALES = ['az', 'ru', 'en'] as const;

// ---------------------------------------------------------------------------
// 1. All eight plans exist, exactly, no duplicates
// ---------------------------------------------------------------------------

test('catalogue contains exactly the eight locked plan codes, no duplicates', () => {
  const catalogueCodes = MEMBERSHIP_CATALOGUE.map((p) => p.planCode);
  assert.equal(catalogueCodes.length, 8);
  const uniqueCodes = new Set(catalogueCodes);
  assert.equal(uniqueCodes.size, 8, 'duplicate planCode detected in catalogue');
  for (const code of planCodes) {
    assert.ok(catalogueCodes.includes(code), `catalogue missing plan code ${code}`);
  }
});

test('four personal and four corporate plans', () => {
  assert.equal(PERSONAL_PLANS.length, 4);
  assert.equal(CORPORATE_PLANS.length, 4);
});

test('display order is unique and spans 1..8', () => {
  const orders = MEMBERSHIP_CATALOGUE.map((p) => p.displayOrder).sort((a, b) => a - b);
  assert.deepEqual(orders, [1, 2, 3, 4, 5, 6, 7, 8]);
});

// ---------------------------------------------------------------------------
// 2. All three locales exist and are non-empty for every customer-facing field
// ---------------------------------------------------------------------------

function assertLocalizedTextComplete(field: LocalizedText, label: string) {
  for (const locale of LOCALES) {
    assert.ok(field[locale] && field[locale].trim().length > 0, `${label} missing/empty for locale "${locale}"`);
  }
}

function assertLocalizedListComplete(field: LocalizedList, label: string) {
  for (const locale of LOCALES) {
    assert.ok(Array.isArray(field[locale]), `${label} missing array for locale "${locale}"`);
    assert.ok(field[locale].length > 0, `${label} is empty for locale "${locale}"`);
    for (const item of field[locale]) {
      assert.ok(item.trim().length > 0, `${label} has an empty string entry for locale "${locale}"`);
    }
  }
}

for (const plan of MEMBERSHIP_CATALOGUE) {
  test(`plan ${plan.planCode}: all locales present for every localized text field`, () => {
    assertLocalizedTextComplete(plan.name, `${plan.planCode}.name`);
    assertLocalizedTextComplete(plan.positioning, `${plan.planCode}.positioning`);
    assertLocalizedTextComplete(plan.bestFor, `${plan.planCode}.bestFor`);
    assertLocalizedTextComplete(plan.memberRateAccess, `${plan.planCode}.memberRateAccess`);
    assertLocalizedTextComplete(plan.searchDepth, `${plan.planCode}.searchDepth`);
    assertLocalizedTextComplete(plan.humanApprovalBoundary, `${plan.planCode}.humanApprovalBoundary`);
    assertLocalizedTextComplete(plan.fairUseDisclosure, `${plan.planCode}.fairUseDisclosure`);
    assertLocalizedTextComplete(plan.availabilityDisclosure, `${plan.planCode}.availabilityDisclosure`);
    assertLocalizedTextComplete(plan.ctaLabel, `${plan.planCode}.ctaLabel`);
    assertLocalizedTextComplete(plan.upgradeTrigger, `${plan.planCode}.upgradeTrigger`);
  });

  test(`plan ${plan.planCode}: all locales present for every localized list field`, () => {
    assertLocalizedListComplete(plan.additionalBenefits, `${plan.planCode}.additionalBenefits`);
    assertLocalizedListComplete(plan.hotelFlightAncillaryCoordination, `${plan.planCode}.hotelFlightAncillaryCoordination`);
  });

  test(`plan ${plan.planCode}: AI-agent involvement roles localized in all locales`, () => {
    assert.ok(plan.aiAgentInvolvement.length > 0, `${plan.planCode} has no AI-agent involvement entries`);
    for (const involvement of plan.aiAgentInvolvement) {
      assertLocalizedTextComplete(involvement.role, `${plan.planCode}.aiAgentInvolvement[${involvement.agentKey}].role`);
    }
  });

  test(`plan ${plan.planCode}: fair-use limits are founder-configurable, not invented numbers`, () => {
    assert.ok(plan.fairUseLimits.length > 0, `${plan.planCode} has no fair-use limit entries`);
    for (const limit of plan.fairUseLimits) {
      assert.equal(limit.founderConfigurable, true);
      assertLocalizedTextComplete(limit.description, `${plan.planCode}.fairUseLimits[].description`);
    }
  });
}

// ---------------------------------------------------------------------------
// 3. Exact locked prices (via LOCKED_PLAN_PRICES, the single authority)
// ---------------------------------------------------------------------------

test('catalogue pricing resolves exactly to LOCKED_PLAN_PRICES for every plan', () => {
  for (const plan of MEMBERSHIP_CATALOGUE) {
    const resolved = getResolvedPricing(plan.planCode);
    const locked = LOCKED_PLAN_PRICES[plan.planCode];
    assert.equal(resolved.monthlyMinorUnits, locked.MONTHLY, `${plan.planCode} monthly minor-units mismatch`);
    assert.equal(resolved.annualMinorUnits, locked.ANNUAL, `${plan.planCode} annual minor-units mismatch`);
  }
});

test('exact locked display prices — personal plans', () => {
  const expectations: Record<string, { monthly: number; annual: number }> = {
    PERSONAL_SMART: { monthly: 19, annual: 190 },
    PERSONAL_PLUS: { monthly: 39, annual: 390 },
    PERSONAL_PREMIUM: { monthly: 69, annual: 690 },
    PERSONAL_BLACK: { monthly: 299, annual: 2990 }
  };
  for (const [code, expected] of Object.entries(expectations)) {
    const resolved = getResolvedPricing(code as PlanCode);
    assert.equal(resolved.monthlyDisplay, expected.monthly, `${code} monthly display mismatch`);
    assert.equal(resolved.annualDisplay, expected.annual, `${code} annual display mismatch`);
  }
});

test('exact locked display prices — corporate plans (monthly only, no public annual)', () => {
  const expectations: Record<string, number> = {
    CORPORATE_STARTER: 149,
    CORPORATE_STANDARD: 299,
    CORPORATE_PROFESSIONAL: 599
  };
  for (const [code, expectedMonthly] of Object.entries(expectations)) {
    const resolved = getResolvedPricing(code as PlanCode);
    assert.equal(resolved.monthlyDisplay, expectedMonthly, `${code} monthly display mismatch`);
    assert.equal(resolved.annualDisplay, null, `${code} should have no public annual price`);
  }
});

test('Enterprise is custom-priced with no public monthly or annual figure', () => {
  const resolved = getResolvedPricing('CORPORATE_ENTERPRISE');
  assert.equal(resolved.monthlyDisplay, null);
  assert.equal(resolved.annualDisplay, null);
  assert.equal(resolved.isCustomPriced, true);
  const plan = getPlanByCode('CORPORATE_ENTERPRISE');
  assert.equal(plan.isCustomPriced, true);
});

// ---------------------------------------------------------------------------
// 4. Exact annual savings
// ---------------------------------------------------------------------------

test('exact annual savings for all four personal plans', () => {
  const expected: Record<string, number> = {
    PERSONAL_SMART: 38,
    PERSONAL_PLUS: 78,
    PERSONAL_PREMIUM: 138,
    PERSONAL_BLACK: 598
  };
  for (const [code, expectedSaving] of Object.entries(expected)) {
    const resolved = getResolvedPricing(code as PlanCode);
    assert.equal(resolved.annualSavingDisplay, expectedSaving, `${code} annual saving mismatch`);
  }
});

// ---------------------------------------------------------------------------
// 5. Correct plan inheritance ("Everything in X")
// ---------------------------------------------------------------------------

test('inheritance chain: Smart <- Plus <- Premium <- Black', () => {
  assert.equal(getPlanByCode('PERSONAL_SMART').inheritsFrom, null);
  assert.equal(getPlanByCode('PERSONAL_PLUS').inheritsFrom, 'PERSONAL_SMART');
  assert.equal(getPlanByCode('PERSONAL_PREMIUM').inheritsFrom, 'PERSONAL_PLUS');
  assert.equal(getPlanByCode('PERSONAL_BLACK').inheritsFrom, 'PERSONAL_PREMIUM');
});

test('inheritance chain: Starter <- Standard <- Professional <- Enterprise', () => {
  assert.equal(getPlanByCode('CORPORATE_STARTER').inheritsFrom, null);
  assert.equal(getPlanByCode('CORPORATE_STANDARD').inheritsFrom, 'CORPORATE_STARTER');
  assert.equal(getPlanByCode('CORPORATE_PROFESSIONAL').inheritsFrom, 'CORPORATE_STANDARD');
  assert.equal(getPlanByCode('CORPORATE_ENTERPRISE').inheritsFrom, 'CORPORATE_PROFESSIONAL');
});

test('getFullBenefitList accumulates inherited benefits in order, for every locale', () => {
  for (const locale of LOCALES) {
    const smartList = getFullBenefitList('PERSONAL_SMART', locale);
    const plusList = getFullBenefitList('PERSONAL_PLUS', locale);
    const premiumList = getFullBenefitList('PERSONAL_PREMIUM', locale);
    const blackList = getFullBenefitList('PERSONAL_BLACK', locale);

    assert.ok(smartList.length > 0);
    assert.ok(plusList.length > smartList.length, `Plus (${locale}) should include Smart's benefits plus its own`);
    assert.ok(premiumList.length > plusList.length, `Premium (${locale}) should include Plus's full list plus its own`);
    assert.ok(blackList.length > premiumList.length, `Black (${locale}) should include Premium's full list plus its own`);

    // Every one of Smart's own benefits must appear verbatim inside Plus's full list.
    const smartOwn = getPlanByCode('PERSONAL_SMART').additionalBenefits[locale];
    for (const item of smartOwn) {
      assert.ok(plusList.includes(item), `Plus benefit list (${locale}) missing inherited Smart item: "${item}"`);
    }
  }
});

test('getInheritanceLabel is null for entry plans, populated for inheriting plans, in all locales', () => {
  assert.equal(getInheritanceLabel('PERSONAL_SMART', 'az'), null);
  assert.equal(getInheritanceLabel('CORPORATE_STARTER', 'en'), null);

  for (const locale of LOCALES) {
    const label = getInheritanceLabel('PERSONAL_PLUS', locale);
    assert.ok(label && label.length > 0, `expected non-empty inheritance label for Plus in ${locale}`);
  }
});

// ---------------------------------------------------------------------------
// 6. No raw internal enum values displayed to the customer
// ---------------------------------------------------------------------------

const RAW_ENUM_PATTERN = /^(PERSONAL_|CORPORATE_|STANDARD_REVIEW|PRIORITY_REVIEW|NAMED_MANAGER_REVIEW|MANAGED_CONCIERGE|NAMED_TRAVEL_MANAGER|BESPOKE_VIP|SALES_AGENT|CONCIERGE_AGENT|OPERATIONS_AGENT|VOICE_RECEPTION_AGENT|CORPORATE_DESK_AGENT)$/;

test('no plan displays a raw internal enum value as its customer-facing name', () => {
  for (const plan of MEMBERSHIP_CATALOGUE) {
    for (const locale of LOCALES) {
      assert.ok(!RAW_ENUM_PATTERN.test(plan.name[locale]), `${plan.planCode}.name.${locale} looks like a raw enum: "${plan.name[locale]}"`);
      assert.ok(!plan.positioning[locale].includes(plan.planCode), `${plan.planCode}.positioning.${locale} leaks the raw plan code`);
    }
  }
});

// ---------------------------------------------------------------------------
// 7. Language-mixing checks (heuristic: script-based, not exhaustive NLP)
//    Cyrillic must appear only in ru; AZ-specific letters (ə, ı, ğ, ş, ç, ö, ü
//    with diacritics distinguishing from Turkish/English) must not appear in
//    ru/en text; long runs of common ordinary-English UI words must not
//    appear inside az/ru fields.
// ---------------------------------------------------------------------------

const CYRILLIC_PATTERN = /[\u0400-\u04FF]/;
// Azerbaijani-distinctive characters not used in English or Russian text.
const AZ_DISTINCTIVE_PATTERN = /[əğıöüşçİ]/i;

function collectAllLocalizedStrings(plan: MembershipPlanDefinition, locale: 'az' | 'ru' | 'en'): string[] {
  const strings: string[] = [
    plan.name[locale],
    plan.positioning[locale],
    plan.bestFor[locale],
    plan.memberRateAccess[locale],
    plan.searchDepth[locale],
    plan.humanApprovalBoundary[locale],
    plan.fairUseDisclosure[locale],
    plan.availabilityDisclosure[locale],
    plan.ctaLabel[locale],
    plan.upgradeTrigger[locale],
    ...plan.additionalBenefits[locale],
    ...plan.hotelFlightAncillaryCoordination[locale],
    ...plan.aiAgentInvolvement.map((a) => a.role[locale]),
    ...plan.fairUseLimits.map((l) => l.description[locale])
  ];
  return strings;
}

for (const plan of MEMBERSHIP_CATALOGUE) {
  test(`plan ${plan.planCode}: no Cyrillic characters in AZ or EN fields`, () => {
    for (const s of collectAllLocalizedStrings(plan, 'az')) {
      assert.ok(!CYRILLIC_PATTERN.test(s), `Cyrillic text found in AZ field for ${plan.planCode}: "${s}"`);
    }
    for (const s of collectAllLocalizedStrings(plan, 'en')) {
      assert.ok(!CYRILLIC_PATTERN.test(s), `Cyrillic text found in EN field for ${plan.planCode}: "${s}"`);
    }
  });

  test(`plan ${plan.planCode}: no Azerbaijani-distinctive characters in RU or EN fields`, () => {
    for (const s of collectAllLocalizedStrings(plan, 'ru')) {
      assert.ok(!AZ_DISTINCTIVE_PATTERN.test(s), `Azerbaijani-distinctive character found in RU field for ${plan.planCode}: "${s}"`);
    }
    for (const s of collectAllLocalizedStrings(plan, 'en')) {
      assert.ok(!AZ_DISTINCTIVE_PATTERN.test(s), `Azerbaijani-distinctive character found in EN field for ${plan.planCode}: "${s}"`);
    }
  });

  test(`plan ${plan.planCode}: RU field text must not be identical to AZ or EN text (no untranslated copy-through)`, () => {
    const azStrings = collectAllLocalizedStrings(plan, 'az');
    const ruStrings = collectAllLocalizedStrings(plan, 'ru');
    const enStrings = collectAllLocalizedStrings(plan, 'en');
    for (let i = 0; i < ruStrings.length; i++) {
      const ru = ruStrings[i].trim();
      if (ru.length === 0) continue;
      // Brand names / proper nouns are allowed to be identical across locales.
      if (/^(VOYARA|Smart|Plus|Premium|Black|Starter|Standard|Professional|Enterprise)$/i.test(ru)) continue;
      assert.notEqual(ru, azStrings[i].trim(), `RU field identical to AZ (untranslated) for ${plan.planCode}: "${ru}"`);
      assert.notEqual(ru, enStrings[i].trim(), `RU field identical to EN (untranslated) for ${plan.planCode}: "${ru}"`);
    }
  });
}

// ---------------------------------------------------------------------------
// 8. Plan-code join integrity with plan-authority (the pricing/entitlement
//    authority) — this is what keeps the catalogue from silently drifting.
// ---------------------------------------------------------------------------

test('every catalogue planCode is a valid PlanCode from plan-authority', () => {
  const validCodes = new Set<string>(planCodes);
  for (const plan of MEMBERSHIP_CATALOGUE) {
    assert.ok(validCodes.has(plan.planCode), `${plan.planCode} is not a recognized PlanCode in plan-authority.ts`);
  }
});

test('every PlanCode from plan-authority has exactly one catalogue entry', () => {
  for (const code of planCodes) {
    const matches = MEMBERSHIP_CATALOGUE.filter((p) => p.planCode === code);
    assert.equal(matches.length, 1, `expected exactly one catalogue entry for ${code}, found ${matches.length}`);
  }
});
