import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { screenRegistry } from '@/lib/screen-registry';

/**
 * Phase D2 — responsive landing-page correction tests.
 *
 * Covers the three genuine defects found and fixed (with real browser
 * evidence, not assumption) during this phase:
 *   1. The showcase section was four sections deep on the page; moved to
 *      immediately follow the hero.
 *   2. PlatformShowcase defaulted to screenRegistry[1] (screen 02) instead
 *      of screenRegistry[0] (screen 01) on a clean load.
 *   3. A CSS specificity conflict (`.landing-v2 .sect` at 0,0,2,0 silently
 *      beat `.screens-section` at 0,0,1,0) prevented the showcase's
 *      intended full-width background from ever rendering full-width.
 *   4. A classic CSS grid blowout (`.scope-grid li` missing `min-width: 0`)
 *      caused real page-level horizontal overflow at 320px for languages
 *      with long unbreakable words (confirmed: Russian "Авиабилеты").
 *
 * These are source-level structural checks; the full empirical browser
 * matrix (21 states: 7 widths x 3 locales) was run separately with
 * Playwright against a live server and is reported in
 * VOYARA-RESPONSIVE-LANDING-D2-REPORT.md, not duplicated here as a
 * committed suite because it requires a running server and a real browser
 * binary not guaranteed present in every CI environment.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function readSource(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('landing page: the showcase section (#screens) appears immediately after the hero section, before scope/how/why', () => {
  const src = readSource('src/app/[locale]/page.tsx');
  const heroIdx = src.indexOf('<section className="hero-v2">');
  const heroEndIdx = src.indexOf('</section>', heroIdx);
  const showcaseIdx = src.indexOf('id="screens"');
  const scopeIdx = src.indexOf('id="scope"');
  const howIdx = src.indexOf('id="how"');
  const whyIdx = src.indexOf('id="why"');

  assert.ok(heroIdx !== -1 && showcaseIdx !== -1 && scopeIdx !== -1, 'expected to find hero, showcase and scope sections');
  assert.ok(showcaseIdx > heroEndIdx, 'showcase must come after the hero closes');
  assert.ok(showcaseIdx < scopeIdx, 'showcase must come before the scope section (previously it came after)');
  assert.ok(showcaseIdx < howIdx, 'showcase must come before the "how" story-band section');
  assert.ok(showcaseIdx < whyIdx, 'showcase must come before the "why" section');

  // Nothing else should sit between the hero's closing tag and the
  // showcase section's own opening tag — i.e. no other <section> in
  // between. (The showcase section's own opening tag starts before the
  // "id=\"screens\"" attribute appears, so anchor on that tag's start,
  // not the attribute position, to avoid counting the showcase itself.)
  const showcaseTagStart = src.lastIndexOf('<section', showcaseIdx);
  const between = src.slice(heroEndIdx, showcaseTagStart);
  const otherSectionCount = (between.match(/<section/g) ?? []).length;
  assert.equal(otherSectionCount, 0, 'expected no other <section> between the hero and the showcase');
});

test('PlatformShowcase defaults to screenRegistry[0] (screen 01), not screenRegistry[1]', () => {
  const src = readSource('src/components/platform-showcase.tsx');
  assert.match(src, /useState<ScreenDefinition>\(screenRegistry\[0\]\)/, 'expected the initial active screen to be screenRegistry[0]');
  assert.doesNotMatch(src, /useState<ScreenDefinition>\(screenRegistry\[1\]\)/, 'must not default to screenRegistry[1] (screen 02) — this was the clean-load defect');
});

test('PlatformShowcase scrolls the active tab into view without ever touching page-level scroll', () => {
  const src = readSource('src/components/platform-showcase.tsx');
  // Must manipulate the list's own scrollLeft/scrollBy, never window.scrollTo
  // or a bare element.scrollIntoView() (which can move the whole page).
  assert.match(src, /listRef/, 'expected a ref to the horizontal selector list');
  assert.match(src, /scrollBy/, 'expected scrollBy-based horizontal correction');
  assert.doesNotMatch(src, /window\.scrollTo/, 'must never trigger page-level scrolling from tab selection');
  assert.doesNotMatch(src, /\.scrollIntoView\(/, 'must not use bare scrollIntoView, which can scroll the whole page vertically');
});

test('screenRegistry still has exactly 8 screens in the locked order (unchanged by D2)', () => {
  assert.equal(screenRegistry.length, 8);
  assert.equal(screenRegistry[0].legacyId, 's1');
  assert.equal(screenRegistry[7].legacyId, 's8');
});

test('CSS: the showcase full-width background rule has sufficient specificity to actually win over .landing-v2 .sect', () => {
  const css = readSource('src/app/globals.css');
  // The fix: .landing-v2 .sect.screens-section (3 classes) must exist and
  // must be at least as specific as .landing-v2 .sect (2 classes) — using
  // the same combination of classes guarantees this regardless of source
  // order, unlike the previous bare `.screens-section` (1 class) rule.
  assert.match(css, /\.landing-v2\s+\.sect\.screens-section\s*\{/, 'expected a correctly-scoped, sufficiently specific full-width override for the showcase section');
});

test('CSS: .scope-grid li allows shrinking below its content width (grid blowout fix)', () => {
  const css = readSource('src/app/globals.css');
  const ruleMatch = css.match(/\.scope-grid li \{[^}]*\}/);
  assert.ok(ruleMatch, 'expected to find the .scope-grid li rule');
  assert.match(ruleMatch![0], /min-width:\s*0/, 'expected min-width: 0 to prevent grid blowout from long unbreakable words in any locale');
});

test('CSS: a narrower single-column breakpoint exists for .scope-grid below 380px as extra headroom', () => {
  const css = readSource('src/app/globals.css');
  assert.match(css, /@media \(max-width:\s*380px\)\s*\{\s*\.scope-grid\s*\{\s*grid-template-columns:\s*1fr;/);
});

test('D1 logo assets were not touched by D2 (brand-mark.tsx and globals.css logo classes unchanged in intent)', () => {
  const brandMark = readSource('src/components/brand-mark.tsx');
  assert.match(brandMark, /voyara-mark\.png/, 'D2 must not regress the D1 header-logo fix');
});
