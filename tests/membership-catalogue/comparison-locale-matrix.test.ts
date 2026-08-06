import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CORPORATE_PLANS, PERSONAL_PLANS } from '@/lib/membership-catalogue';
import { PERSONAL_ROWS, CORPORATE_ROWS } from '@/lib/membership-comparison-data';
import type { Locale } from '@/i18n/config';

/**
 * Regression coverage for the locale-dependent comparison-table defect:
 * membership-comparison-data.ts previously derived several boolean cells
 * by regex-matching TRANSLATED benefit text (e.g. /executive|icraçı/i).
 * That failed silently for sentence-initial Azerbaijani "İcraçı..." because
 * JavaScript's default Unicode case folding lowercases capital İ (U+0130)
 * to "i̇" (i + combining dot above, U+0307) — not plain ASCII "i" — so
 * /icraçı/i never matched it. A similar Russian case-folding edge produced
 * the reported false negative for Supplier/Company-rate Configuration.
 *
 * The fix replaces every such regex-derived cell with a read from
 * `plan.capabilityFlags`, a locale-INDEPENDENT structured field on the
 * catalogue itself (src/lib/membership-catalogue.ts). These tests prove,
 * for every affected row, that AZ/RU/EN now produce byte-identical
 * booleans, and pin the exact expected values from the corrected matrix.
 */

const LOCALES: Locale[] = ['az', 'ru', 'en'];

function rowByKey(rows: typeof PERSONAL_ROWS, key: string) {
  const row = rows.find((r) => r.key === key);
  if (!row) throw new Error(`row "${key}" not found`);
  return row;
}

function evalRow(rows: typeof PERSONAL_ROWS, key: string, plans: typeof PERSONAL_PLANS, locale: Locale): (string | boolean)[] {
  const row = rowByKey(rows, key);
  return plans.map((plan) => row.values(plan, locale));
}

// ---------------------------------------------------------------------------
// Cross-locale identity: for every affected row, AZ/RU/EN must agree exactly.
// ---------------------------------------------------------------------------

const PERSONAL_BOOLEAN_ROW_KEYS = ['multiDestination', 'ancillaryCoordination', 'complexItinerary', 'aiReception', 'namedManager', 'humanApproval'];
const CORPORATE_BOOLEAN_ROW_KEYS = [
  'approvals', 'travellerProfiles', 'policyGovernance', 'reporting', 'dashboard',
  'executiveTravel', 'complexMultiCity', 'dedicatedCoordination', 'supplierRateConfig',
  'customRoles', 'integrations'
];

for (const key of PERSONAL_BOOLEAN_ROW_KEYS) {
  test(`personal comparison row "${key}": AZ/RU/EN produce identical booleans for every plan`, () => {
    const az = evalRow(PERSONAL_ROWS, key, PERSONAL_PLANS, 'az');
    const ru = evalRow(PERSONAL_ROWS, key, PERSONAL_PLANS, 'ru');
    const en = evalRow(PERSONAL_ROWS, key, PERSONAL_PLANS, 'en');
    assert.deepEqual(az, ru, `row "${key}": AZ and RU disagree (${JSON.stringify(az)} vs ${JSON.stringify(ru)})`);
    assert.deepEqual(az, en, `row "${key}": AZ and EN disagree (${JSON.stringify(az)} vs ${JSON.stringify(en)})`);
  });
}

for (const key of CORPORATE_BOOLEAN_ROW_KEYS) {
  test(`corporate comparison row "${key}": AZ/RU/EN produce identical booleans for every plan`, () => {
    const az = evalRow(CORPORATE_ROWS, key, CORPORATE_PLANS, 'az');
    const ru = evalRow(CORPORATE_ROWS, key, CORPORATE_PLANS, 'ru');
    const en = evalRow(CORPORATE_ROWS, key, CORPORATE_PLANS, 'en');
    assert.deepEqual(az, ru, `row "${key}": AZ and RU disagree (${JSON.stringify(az)} vs ${JSON.stringify(ru)})`);
    assert.deepEqual(az, en, `row "${key}": AZ and EN disagree (${JSON.stringify(az)} vs ${JSON.stringify(en)})`);
  });
}

// ---------------------------------------------------------------------------
// Exact expected matrix, per the bug report, pinned for every locale.
// Corporate plan order is fixed: Starter, Standard, Professional, Enterprise.
// ---------------------------------------------------------------------------

const EXPECTED_MATRIX: Record<string, boolean[]> = {
  executiveTravel: [false, false, true, true],
  complexMultiCity: [false, false, true, true],
  dedicatedCoordination: [false, false, true, true],
  supplierRateConfig: [false, false, true, true],
  customRoles: [false, false, false, true],
  integrations: [false, false, false, true]
};

for (const [key, expected] of Object.entries(EXPECTED_MATRIX)) {
  for (const locale of LOCALES) {
    test(`corporate row "${key}" (${locale}): exact expected matrix [Starter, Standard, Professional, Enterprise]`, () => {
      const actual = evalRow(CORPORATE_ROWS, key, CORPORATE_PLANS, locale);
      assert.deepEqual(actual, expected, `row "${key}" (${locale}): expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    });
  }
}

// Specific regression pins for the two originally-reported false negatives.
test('regression pin: AZ Executive Travel Handling is true for Professional and Enterprise (was false)', () => {
  const actual = evalRow(CORPORATE_ROWS, 'executiveTravel', CORPORATE_PLANS, 'az');
  assert.equal(actual[2], true, 'Professional (index 2) must be true');
  assert.equal(actual[3], true, 'Enterprise (index 3) must be true');
});

test('regression pin: RU Supplier/Company-rate Configuration is true for Professional and Enterprise (was false)', () => {
  const actual = evalRow(CORPORATE_ROWS, 'supplierRateConfig', CORPORATE_PLANS, 'ru');
  assert.equal(actual[2], true, 'Professional (index 2) must be true');
  assert.equal(actual[3], true, 'Enterprise (index 3) must be true');
});

// ---------------------------------------------------------------------------
// Root-cause regression guard: confirm the specific Unicode case-folding
// trap that caused the original bug, so a future regex-based row would be
// caught immediately rather than silently reintroducing this class of bug.
// ---------------------------------------------------------------------------

test('root-cause guard: JS default case folding inserts an extra combining-dot character for Azerbaijani capital İ, breaking naive regex matching (documents why regex-on-translated-text is unsafe)', () => {
  const lowered = 'İcraçı'.toLowerCase();
  // 'İ' (U+0130) case-folds to TWO code units — 'i' (U+0069) followed by a
  // combining dot above (U+0307) — not to a single plain ASCII 'i'. That
  // extra inserted character is exactly what made /icraçı/i silently fail
  // to match sentence-initial "İcraçı..." in the original bug: the regex
  // matches 'i' at position 0, then expects 'c' at position 1, but finds
  // the combining dot there instead.
  assert.equal(lowered.length, 'icraçı'.length + 1, 'expected one extra combining-mark code unit from the İ case-fold');
  assert.equal(/icraçı/i.test('İcraçı səyahət idarəolunması'), false, 'this regex must NOT match the sentence-initial capital İ form (documents the original failure mode)');
});

test('capability flags are read directly from the catalogue, not derived from benefit-list text matching', () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(__dirname, '../../src/lib/membership-comparison-data.ts'), 'utf8');
  assert.doesNotMatch(src, /includesBenefit/, 'membership-comparison-data.ts must not use the removed regex-based includesBenefit helper');
  assert.doesNotMatch(src, /getFullBenefitList/, 'boolean capability rows must not derive from getFullBenefitList text scanning');
});
