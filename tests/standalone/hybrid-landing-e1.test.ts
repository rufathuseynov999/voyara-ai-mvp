import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { screenRegistry } from '@/lib/screen-registry';

/**
 * Phase E1 — hybrid landing-page acceptance tests.
 *
 * Protects the approved synthesis: the July page's premium identity and
 * the August page's conversion architecture, without weakening VOYARA's
 * human-authority, pricing, localisation or eight-screen invariants.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function readSource(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf8');
}

const landingByLocale = Object.fromEntries(
  (['az', 'ru', 'en'] as const).map((locale) => [
    locale,
    JSON.parse(readSource(`src/i18n/messages/${locale}.json`)).landing
  ])
) as Record<'az' | 'ru' | 'en', Record<string, unknown>>;

test('hybrid landing renders exactly one clearly labelled Work Receipt 2.0 proof artifact', () => {
  const page = readSource('src/app/[locale]/page.tsx');

  assert.equal((page.match(/className="work-receipt"/g) ?? []).length, 1);
  assert.match(page, /<article className="work-receipt"/);
  assert.match(page, /dictionary\.landing\.receiptExampleLabel/);
  assert.match(page, /dictionary\.landing\.workReceiptStatus/);
  assert.match(page, /dictionary\.landing\.workReceiptBoundary/);
});

test('hybrid landing has exactly three audience paths with real in-page destinations', () => {
  const page = readSource('src/app/[locale]/page.tsx');
  const pricing = readSource('src/components/membership-pricing.tsx');

  assert.match(page, /\['memberships', 'membership-premium', 'corporate-memberships'\] as const/);
  assert.match(page, /dictionary\.landing\.audiences\.map/);
  assert.match(page, /id="memberships"/);
  assert.match(pricing, /id=\{`membership-\$\{plan\.planCode\}`\}/);
  assert.match(pricing, /id="corporate-memberships"/);
});

test('all locales preserve identical hybrid content structure', () => {
  const keySets = Object.values(landingByLocale).map((landing) => Object.keys(landing).sort());
  assert.deepEqual(keySets[1], keySets[0], 'Russian landing keys must match Azerbaijani');
  assert.deepEqual(keySets[2], keySets[0], 'English landing keys must match Azerbaijani');

  for (const [locale, landing] of Object.entries(landingByLocale)) {
    assert.equal((landing.audiences as unknown[]).length, 3, `${locale}: expected three audiences`);
    assert.equal((landing.workReceiptSteps as unknown[]).length, 3, `${locale}: expected three receipt steps`);
    assert.equal((landing.authorityPrinciples as unknown[]).length, 3, `${locale}: expected three authority principles`);
    assert.equal((landing.journeySteps as unknown[]).length, 7, `${locale}: expected seven journey stages`);
    assert.ok(String(landing.workReceiptBoundary).length > 20, `${locale}: receipt boundary copy is missing`);
  }
});

test('pricing remains server-authoritative and is not hard-coded into the hybrid page', () => {
  const page = readSource('src/app/[locale]/page.tsx');
  const pricing = readSource('src/components/membership-pricing.tsx');

  assert.match(page, /loadPublicMembershipCatalogue\(\)/);
  assert.match(page, /plansFromMinor/);
  assert.doesNotMatch(page, /(?:₼|AZN|USD|EUR)\s*\d|\d\s*(?:₼|AZN|USD|EUR)/);
  assert.match(pricing, /className="currency-symbol">₼<\/span>/, 'semantic manat symbol must be retained with the visual fallback');
});

test('the locked eight-screen product showcase remains intact', () => {
  assert.equal(screenRegistry.length, 8);
  assert.deepEqual(screenRegistry.map((screen) => screen.legacyId), [
    's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'
  ]);
});

test('literal landing-page IDs are unique and anchor-safe', () => {
  const page = readSource('src/app/[locale]/page.tsx');
  const ids = [...page.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, `duplicate literal id found: ${ids.join(', ')}`);
});

test('header navigation and actions are locale-driven', () => {
  const header = readSource('src/components/site-header.tsx');

  for (const key of ['navHow', 'navPlatform', 'navMembership', 'brandDescriptor', 'headerCta', 'menuLabel', 'navigationLabel']) {
    assert.match(header, new RegExp(`dictionary\\.landing\\.${key}`));
  }
  assert.doesNotMatch(header, /aria-label="Menu"/);
  assert.match(header, /className=\{`menu-icon\$\{open \? ' is-open' : ''\}`\}/, 'menu icon must not depend on a font glyph');
});

test('hybrid visual system includes responsive proof, audience and authority layouts down to 320px-class screens', () => {
  const css = readSource('src/app/globals.css');

  assert.match(css, /HYBRID E1 — Luxury editorial identity/);
  assert.match(css, /\.work-receipt\s*\{/);
  assert.match(css, /\.hero-audience-grid\s*\{/);
  assert.match(css, /\.authority-principles\s*\{/);
  assert.match(css, /@media \(max-width:\s*380px\)/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.match(css, /\.landing-v2 \.screens-section \.sc-stage\s*\{\s*color:\s*var\(--ink\)/, 'light showcase stage must restore dark text contrast');
  assert.match(css, /@media \(min-width:\s*981px\)[\s\S]*?\.authority-flow-section \.authflow\s*\{[\s\S]*?grid-template-columns:\s*repeat\(7/, 'desktop authority sequence must show all seven stages');
  assert.match(css, /\.chat-launcher::before\s*\{/, 'mobile chat control must use a font-independent icon');
});
