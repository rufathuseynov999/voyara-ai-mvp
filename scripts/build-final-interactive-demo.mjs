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

/* ---------------- 2. Locked pricing (must match the approved values exactly) ---------------- */
const PRICING = {
  personal: [
    { code: 'smart', monthly: 19, annual: 190 },
    { code: 'plus', monthly: 39, annual: 390 },
    { code: 'premium', monthly: 69, annual: 690, hot: true },
    { code: 'black', monthly: 299, annual: 2990 }
  ],
  corporate: [
    { code: 'starter', monthly: 149 },
    { code: 'standard', monthly: 299 },
    { code: 'professional', monthly: 599 },
    { code: 'enterprise', monthly: null }
  ]
};

/* ---------------- 3. Real VOYARA logo, base64-embedded ---------------- */
const logoPath = path.join(ROOT, 'public/brand/voyara-logo.jpg');
const LOGO_DATAURI = `data:image/jpeg;base64,${readFileSync(logoPath).toString('base64')}`;

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
  .replace('__PRICING_JSON__', JSON.stringify(PRICING));

/* ---------------- 7. HTML shell ---------------- */
const HTML_SHELL = readFileSync(path.join(ROOT, 'scripts/build-final-interactive-demo.shell.html'), 'utf8');
const HTML = HTML_SHELL
  .replace(/__LOGO_DATAURI__/g, LOGO_DATAURI)
  .replace('__CSS__', CSS)
  .replace('__JS__', JS);

const outPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, 'VOYARA-FINAL-INTERACTIVE-DEMO.html');

writeFileSync(outPath, HTML, 'utf8');
process.stdout.write(`Built ${outPath} (${Buffer.byteLength(HTML, 'utf8')} bytes)\n`);
