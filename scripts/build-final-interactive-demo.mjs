#!/usr/bin/env node
/**
 * Phase "Post-4H" — reproducible generator for the standalone founder
 * preview HTML (VOYARA-FINAL-INTERACTIVE-DEMO*.html).
 *
 * This script rebuilds the exact same artifact from the real source of
 * truth: the project's own AZ/RU/EN dictionaries (src/i18n/messages/*.json),
 * the real VOYARA logo (public/brand/voyara-logo.jpg), and a small,
 * explicit MOCK strings table for the interactive screens' sample data
 * (never hardcoded ternaries — every visible string is locale data).
 *
 * Usage:
 *   node scripts/build-final-interactive-demo.mjs [outputPath]
 *
 * Default output: VOYARA-FINAL-INTERACTIVE-DEMO.html in the repo root.
 *
 * This script deliberately contains NO business logic of its own beyond
 * assembly — it reads real dictionary content, real pricing constants
 * (matching the approved locked prices), and the MOCK table below, and
 * emits one self-contained HTML file with embedded CSS/JS/logo. No network
 * calls, no external dependencies at runtime.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}

/* ---------------- 1. Real dictionary content (source of truth) ---------------- */
const LOCALES = ['az', 'ru', 'en'];
const CONTENT = {};
for (const loc of LOCALES) {
  const full = readJson(path.join(ROOT, 'src/i18n/messages', `${loc}.json`));
  CONTENT[loc] = {
    landing: full.landing,
    nav: full.nav,
    footerLinks: full.footerLinks,
    screens: full.screens,
    meta: full.meta
  };
}

/* ---------------- 2. Membership catalogue — bridged from the single
   authoritative source, src/lib/membership-catalogue.ts, via
   scripts/export-membership-catalogue.ts. This script does not declare
   any plan name, price, or benefit copy of its own. Run
   `npx tsx scripts/export-membership-catalogue.ts` first if this file is
   missing or stale relative to membership-catalogue.ts. ---------------- */
const CATALOGUE_PATH = path.join(ROOT, 'scripts/build-final-interactive-demo.membership-catalogue.json');
let MEMBERSHIP_CATALOGUE;
try {
  MEMBERSHIP_CATALOGUE = readJson(CATALOGUE_PATH);
} catch (err) {
  throw new Error(
    `Membership catalogue export not found at ${CATALOGUE_PATH}. ` +
    `Run "npx tsx scripts/export-membership-catalogue.ts" first — this ` +
    `generator does not maintain its own copy of plan data. (${err.message})`
  );
}

// Legacy shape kept for the JS template's existing PRICING.personal /
// PRICING.corporate consumers (renderPlans/renderCorpPlans in app.js),
// but every number and code is now sourced from the bridged catalogue,
// not hand-declared here.
const PRICING = {
  personal: MEMBERSHIP_CATALOGUE.plans.en
    .filter((p) => p.category === 'PERSONAL')
    .map((p) => ({ code: p.slug, monthly: p.pricing.monthly, annual: p.pricing.annual, hot: p.slug === 'premium' })),
  corporate: MEMBERSHIP_CATALOGUE.plans.en
    .filter((p) => p.category === 'CORPORATE')
    .map((p) => ({ code: p.slug, monthly: p.pricing.monthly }))
};

/* ---------------- 3. Real VOYARA logo, base64-embedded ----------------
   Three distinct embeds, matching the same convention used by the live
   React app (which fixed an identical pair of defects — see BrandMark's
   doc comment and the founder-section image):
     - LOGO_DATAURI: full lockup (emblem + "VOYARA" wordmark) — for large
       placements only, where the wordmark stays legible.
     - MARK_DATAURI: compact emblem only, no wordmark — for the small
       44x44 header slot, where a baked-in wordmark would be illegible.
     - FOUNDER_DATAURI: the founder's own personal mark — the standalone
       shell previously mislabeled the VOYARA company logo as
       alt="Rufat Huseynov" in the founder section; this embed fixes that
       to show the actual founder asset the React app already uses. */
const logoPath = path.join(ROOT, 'public/brand/voyara-logo.jpg');
const LOGO_DATAURI = `data:image/jpeg;base64,${readFileSync(logoPath).toString('base64')}`;
const markPath = path.join(ROOT, 'public/brand/voyara-mark.png');
const MARK_DATAURI = `data:image/png;base64,${readFileSync(markPath).toString('base64')}`;
const founderPath = path.join(ROOT, 'public/brand/founder-rufat-huseynov-logo.jpg');
const FOUNDER_DATAURI = `data:image/jpeg;base64,${readFileSync(founderPath).toString('base64')}`;

/* ---------------- 4. MOCK strings for the interactive demo screens ----------------
   Every visible string used by the mock Wizard/Proposal/Approvals/Founder/
   TripRoom/Payment/CRM screens lives here, per locale — never inline
   ternaries in the rendering code. Locked language rule: AZ shows only
   Azerbaijani ordinary UI text, RU only Russian, EN only English; brand
   names, plan names, and technical identifiers are unchanged across all
   three (VOYARA, Smart/Plus/Premium/Black, Starter/Standard/Professional/
   Enterprise, Instagram, WhatsApp, CRM, MVP, MIT, AAL2, SHA-256, Soneva
   Jani, Water Retreat, Qatar flight codes). */
const MOCK = readJson(path.join(ROOT, 'scripts/build-final-interactive-demo.mock.json'));

/* ---------------- 5. CSS (approved emerald / champagne-gold / ivory identity) ---------------- */
const CSS = readFileSync(path.join(ROOT, 'scripts/build-final-interactive-demo.style.css'), 'utf8');

/* ---------------- 6. Assemble the JS app (locale-driven, renderGlobalChrome) ---------------- */
const JS_TEMPLATE = readFileSync(path.join(ROOT, 'scripts/build-final-interactive-demo.app.js'), 'utf8');
const JS = JS_TEMPLATE
  .replace('__CONTENT_JSON__', JSON.stringify(CONTENT))
  .replace('__MOCK_JSON__', JSON.stringify(MOCK))
  .replace('__PRICING_JSON__', JSON.stringify(PRICING))
  .replace('__MEMBERSHIP_CATALOGUE_JSON__', JSON.stringify(MEMBERSHIP_CATALOGUE.plans))
  .replace('__ANNUAL_VALUE_FRAMING_JSON__', JSON.stringify(MEMBERSHIP_CATALOGUE.annualValueFraming))
  .replace('__COMPARISON_JSON__', JSON.stringify(MEMBERSHIP_CATALOGUE.comparison))
  .replace('__JOURNEY_JSON__', JSON.stringify(MEMBERSHIP_CATALOGUE.journey))
  .replace('__AGENTS_JSON__', JSON.stringify(MEMBERSHIP_CATALOGUE.agents));

/* ---------------- 7. HTML shell ---------------- */
const HTML_SHELL = readFileSync(path.join(ROOT, 'scripts/build-final-interactive-demo.shell.html'), 'utf8');
const HTML = HTML_SHELL
  .replace(/__LOGO_DATAURI__/g, LOGO_DATAURI)
  .replace(/__MARK_DATAURI__/g, MARK_DATAURI)
  .replace(/__FOUNDER_DATAURI__/g, FOUNDER_DATAURI)
  .replace('__CSS__', CSS)
  .replace('__JS__', JS);

const outPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, 'VOYARA-FINAL-INTERACTIVE-DEMO.html');

writeFileSync(outPath, HTML, 'utf8');
process.stdout.write(`Built ${outPath} (${Buffer.byteLength(HTML, 'utf8')} bytes)\n`);
