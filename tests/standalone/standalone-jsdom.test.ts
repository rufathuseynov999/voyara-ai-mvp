import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

/**
 * Phase C8 — permanent standalone verification suite.
 *
 * This suite regenerates VOYARA-FINAL-INTERACTIVE-DEMO*.html FRESH from
 * current source on every run (via the real generator script, not a
 * checked-in stale copy), then actually executes it in jsdom — not just
 * greps the source — so it catches real runtime breakage: JS errors,
 * missing DOM wiring, broken language-switch refresh, etc.
 *
 * Run standalone: `npm run test:standalone`
 * Included in the full suite via `npm test`.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

let HTML: string;
let JS_ERRORS_ON_LOAD: string[] = [];

test.before(() => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'voyara-standalone-'));
  const outPath = path.join(tmpDir, 'test-build.html');
  execFileSync('node', [path.join(ROOT, 'scripts/build-final-interactive-demo.mjs'), outPath], { cwd: ROOT });
  HTML = readFileSync(outPath, 'utf8');
  rmSync(tmpDir, { recursive: true, force: true });
});

function freshDom(): JSDOM {
  const errors: string[] = [];
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/' });
  dom.window.onerror = (msg: unknown) => { errors.push(String(msg)); };
  (dom as unknown as { __errors: string[] }).__errors = errors;
  return dom;
}

async function settle(ms = 250): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/** Real "visible rendered text" excludes <script>, <style>, <template> and
 *  non-visible metadata elements — jsdom's plain textContent on <body>
 *  otherwise includes the raw JS source itself (which legitimately
 *  contains \uXXXX escapes; scanning source code as if it were rendered
 *  page text produces false positives, not a real defect). */
function visibleTextOnly(doc: Document): string {
  const clone = doc.body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('script, style, template, noscript, meta, link').forEach((el) => el.remove());
  return clone.textContent ?? '';
}

// ---------------------------------------------------------------------------
// Generator sanity
// ---------------------------------------------------------------------------

test('generator produces non-empty HTML with the real VOYARA logo embedded', () => {
  assert.ok(HTML.length > 100000, 'generated HTML is suspiciously small');
  assert.match(HTML, /data:image\/jpeg;base64,/, 'expected the real embedded logo data URI');
});

test('generated HTML declares no external script/style/font dependency (fully standalone)', () => {
  assert.doesNotMatch(HTML, /<script[^>]+src=/i, 'found an external <script src=...>');
  assert.doesNotMatch(HTML, /<link[^>]+rel=["']stylesheet["'][^>]+href=["']https?:/i, 'found an external stylesheet link');
});

// ---------------------------------------------------------------------------
// Execution: zero JS errors on load
// ---------------------------------------------------------------------------

test('loads and executes with zero JavaScript errors', async () => {
  const dom = freshDom();
  await settle();
  const errors = (dom as unknown as { __errors: string[] }).__errors;
  assert.deepEqual(errors, [], `unexpected JS errors: ${JSON.stringify(errors)}`);
});

// ---------------------------------------------------------------------------
// All eight screens render and are selectable
// ---------------------------------------------------------------------------

const SCREEN_KEYS = ['landing', 'wizard', 'proposal', 'approvals', 'founder', 'tripRoom', 'payment', 'crm'];

test('all eight screens can be selected via goScreen with zero errors', async () => {
  const dom = freshDom();
  await settle();
  for (const key of SCREEN_KEYS) {
    dom.window.goScreen(key);
    await settle(50);
    const active = dom.window.document.querySelector('.screen.on');
    assert.ok(active, `no active screen after goScreen('${key}')`);
    assert.equal(active!.id, `screen-${key}`, `expected screen-${key} to be active`);
  }
  const errors = (dom as unknown as { __errors: string[] }).__errors;
  assert.deepEqual(errors, [], `unexpected JS errors while cycling all 8 screens: ${JSON.stringify(errors)}`);
});

// ---------------------------------------------------------------------------
// Comparison tables
// ---------------------------------------------------------------------------

test('personal and corporate comparison tables render with correct plan counts and order', async () => {
  const dom = freshDom();
  await settle();
  dom.window.goScreen('landing');
  await settle(50);
  const doc = dom.window.document;

  const personalHeaders = [...doc.querySelectorAll('#personal-comparison thead th')].slice(1).map((th) => th.textContent);
  assert.deepEqual(personalHeaders, ['Smart', 'Plus', 'Premium', 'Black']);

  const corporateHeaders = [...doc.querySelectorAll('#corporate-comparison thead th')].slice(1).map((th) => th.textContent);
  assert.deepEqual(corporateHeaders, ['Starter', 'Standard', 'Professional', 'Enterprise']);
});

test('corrected comparison matrix: Executive Travel Handling and Supplier/Company-rate Configuration are true for Professional and Enterprise', async () => {
  const dom = freshDom();
  await settle();
  const doc = dom.window.document;
  // Looked up by the stable data-row-key attribute (locale-independent),
  // never by matching translated row-label text: an earlier version of
  // this very test used a regex against the localized label and silently
  // failed to find the row, because Azerbaijani "İcraçı..." case-folds
  // its capital İ to "i" + a combining dot (U+0307) under JS's default
  // Unicode rules, not to plain ASCII "i" — the exact same class of bug
  // that capabilityFlags was introduced to eliminate in the product itself.
  const execRow = doc.querySelector('#corporate-comparison tr[data-row-key="executiveTravel"]');
  assert.ok(execRow, 'expected to find the Executive Travel Handling row by its stable data-row-key');
  const execCells = [...execRow!.querySelectorAll('td')].map((td) => td.textContent);
  assert.deepEqual(execCells, ['\u2014', '\u2014', '\u2713', '\u2713'], 'Executive Travel Handling: expected Starter/Standard false, Professional/Enterprise true');

  const supplierRow = doc.querySelector('#corporate-comparison tr[data-row-key="supplierRateConfig"]');
  assert.ok(supplierRow, 'expected to find the Supplier/Company-rate Configuration row by its stable data-row-key');
  const supplierCells = [...supplierRow!.querySelectorAll('td')].map((td) => td.textContent);
  assert.deepEqual(supplierCells, ['\u2014', '\u2014', '\u2713', '\u2713'], 'Supplier/Company-rate Configuration: expected Starter/Standard false, Professional/Enterprise true');
});

test('full corporate capability matrix, looked up by stable row key, matches the exact expected values', async () => {
  const dom = freshDom();
  await settle();
  const doc = dom.window.document;
  const expected: Record<string, string[]> = {
    executiveTravel: ['\u2014', '\u2014', '\u2713', '\u2713'],
    complexMultiCity: ['\u2014', '\u2014', '\u2713', '\u2713'],
    dedicatedCoordination: ['\u2014', '\u2014', '\u2713', '\u2713'],
    supplierRateConfig: ['\u2014', '\u2014', '\u2713', '\u2713'],
    customRoles: ['\u2014', '\u2014', '\u2014', '\u2713'],
    integrations: ['\u2014', '\u2014', '\u2014', '\u2713']
  };
  for (const [key, expectedCells] of Object.entries(expected)) {
    const row = doc.querySelector(`#corporate-comparison tr[data-row-key="${key}"]`);
    assert.ok(row, `row "${key}" not found by data-row-key`);
    const cells = [...row!.querySelectorAll('td')].map((td) => td.textContent);
    assert.deepEqual(cells, expectedCells, `row "${key}": expected ${JSON.stringify(expectedCells)}, got ${JSON.stringify(cells)}`);
  }
});

// ---------------------------------------------------------------------------
// Member-value journey and AI-agent section
// ---------------------------------------------------------------------------

test('member-value journey renders exactly 8 ordered steps', async () => {
  const dom = freshDom();
  await settle();
  const steps = dom.window.document.querySelectorAll('#member-value-journey .mvj-step');
  assert.equal(steps.length, 8);
});

test('AI-agent section renders exactly 8 agents, each with an honest status badge', async () => {
  const dom = freshDom();
  await settle();
  const doc = dom.window.document;
  const cards = doc.querySelectorAll('#ai-agent-section .ai-agent-card');
  assert.equal(cards.length, 8);
  const statuses = [...doc.querySelectorAll('#ai-agent-section .ai-agent-status')].map((s) => s.textContent);
  assert.equal(statuses.length, 8);
  for (const s of statuses) assert.ok(s && s.trim().length > 0);
});

// ---------------------------------------------------------------------------
// Language switching refreshes every dynamic surface
// ---------------------------------------------------------------------------

test('language switching AZ -> EN -> RU refreshes journey title, agent-section title, and comparison headers', async () => {
  const dom = freshDom();
  await settle();
  const doc = dom.window.document;

  const az = { journey: doc.getElementById('mvj-title')?.textContent, agents: doc.getElementById('ai-agent-title')?.textContent };
  dom.window.setLocale('en');
  await settle(100);
  const en = { journey: doc.getElementById('mvj-title')?.textContent, agents: doc.getElementById('ai-agent-title')?.textContent };
  dom.window.setLocale('ru');
  await settle(100);
  const ru = { journey: doc.getElementById('mvj-title')?.textContent, agents: doc.getElementById('ai-agent-title')?.textContent };

  assert.notEqual(az.journey, en.journey);
  assert.notEqual(en.journey, ru.journey);
  assert.notEqual(az.agents, en.agents);
  assert.notEqual(en.agents, ru.agents);

  const errors = (dom as unknown as { __errors: string[] }).__errors;
  assert.deepEqual(errors, [], `unexpected JS errors during language switching: ${JSON.stringify(errors)}`);
});

test('language switching mid-flow (on the wizard screen) keeps the same screen active', async () => {
  const dom = freshDom();
  await settle();
  dom.window.goScreen('wizard');
  await settle(50);
  dom.window.setLocale('ru');
  await settle(100);
  const active = dom.window.document.querySelector('.screen.on');
  assert.equal(active?.id, 'screen-wizard', 'expected to remain on the wizard screen after a language switch');
});

// ---------------------------------------------------------------------------
// Monthly / annual pricing switch
// ---------------------------------------------------------------------------

test('monthly/annual period switch changes the displayed personal plan price', async () => {
  const dom = freshDom();
  await settle();
  const doc = dom.window.document;
  dom.window.setPeriod('monthly');
  await settle(50);
  const monthlyFirstPrice = doc.querySelector('#plans-v2 .plan-pr')?.textContent;
  dom.window.setPeriod('annually');
  await settle(50);
  const annualFirstPrice = doc.querySelector('#plans-v2 .plan-pr')?.textContent;
  assert.notEqual(monthlyFirstPrice, annualFirstPrice, 'expected the displayed price to change between monthly and annual');
});

// ---------------------------------------------------------------------------
// Interaction smoke: wizard -> proposal -> approval -> payment
// ---------------------------------------------------------------------------

test('wizard -> proposal -> approval -> payment interaction chain runs with zero errors', async () => {
  const dom = freshDom();
  await settle();
  dom.window.goScreen('wizard');
  await settle(50);
  if (typeof dom.window.submitWizard === 'function') {
    dom.window.submitWizard();
    await settle(1000);
  }
  if (typeof dom.window.acceptProposal === 'function') {
    dom.window.goScreen('proposal');
    await settle(50);
    dom.window.acceptProposal();
    await settle(1000);
  }
  const errors = (dom as unknown as { __errors: string[] }).__errors;
  assert.deepEqual(errors, [], `unexpected JS errors during the interaction chain: ${JSON.stringify(errors)}`);
});

// ---------------------------------------------------------------------------
// Content-integrity artifact scan (all three locales)
// ---------------------------------------------------------------------------

const FORBIDDEN_ARTIFACT_PATTERNS: Array<[string, RegExp]> = [
  ['literal "undefined" text', /\bundefined\b/],
  ['"[object Object]"', /\[object Object\]/],
  ['unresolved raw enum token', /\b(PERSONAL_[A-Z]+|CORPORATE_[A-Z]+|STANDARD_REVIEW|PRIORITY_REVIEW|NAMED_MANAGER_REVIEW)\b/],
  ['literal unicode escape artifact', /\\u[0-9a-fA-F]{4}(?![^<]*<\/script>)/],
  ['peso symbol (wrong currency)', /\u20B1/],
  ['forbidden autonomy over-claim', /fully\s+autonomous|runs?\s+continuously\s+in\s+production|always\s+live/i]
];

test('no forbidden content-integrity artifacts appear in visible rendered text (all three locales)', async () => {
  const dom = freshDom();
  await settle();
  const doc = dom.window.document;

  for (const locale of ['az', 'en', 'ru']) {
    dom.window.setLocale(locale);
    await settle(100);
    const visibleText = visibleTextOnly(doc);
    for (const [label, pattern] of FORBIDDEN_ARTIFACT_PATTERNS) {
      assert.doesNotMatch(visibleText, pattern, `found forbidden artifact "${label}" in visible ${locale} text`);
    }
  }
});

test('correct \u20bc currency symbol is present in visible pricing text', async () => {
  const dom = freshDom();
  await settle();
  const visibleText = visibleTextOnly(dom.window.document);
  assert.match(visibleText, /\u20bc/, 'expected the \u20bc (manat) symbol to appear in visible pricing text');
});

test('exact locked prices are present in visible rendered text', async () => {
  const dom = freshDom();
  await settle();
  const doc = dom.window.document;
  dom.window.setPeriod('monthly');
  await settle(50);
  const visibleText = visibleTextOnly(doc);
  // Smart monthly (19) and Black monthly (299) should both be visible somewhere on the landing screen.
  assert.match(visibleText, /19/, 'expected Smart monthly price (19) to be visible');
  assert.match(visibleText, /299/, 'expected Black monthly price (299) to be visible');
});

// ---------------------------------------------------------------------------
// Personal capability matrix (mirrors the corporate matrix coverage above)
// ---------------------------------------------------------------------------

test('personal capability matrix, looked up by stable row key, matches expected values', async () => {
  const dom = freshDom();
  await settle();
  const doc = dom.window.document;
  const expected: Record<string, string[]> = {
    // [Smart, Plus, Premium, Black]
    multiDestination: ['\u2014', '\u2713', '\u2713', '\u2713'],
    ancillaryCoordination: ['\u2014', '\u2713', '\u2713', '\u2713'],
    aiReception: ['\u2014', '\u2014', '\u2014', '\u2713'],
    namedManager: ['\u2014', '\u2014', '\u2014', '\u2713'],
    humanApproval: ['\u2713', '\u2713', '\u2713', '\u2713']
  };
  for (const [key, expectedCells] of Object.entries(expected)) {
    const row = doc.querySelector(`#personal-comparison tr[data-row-key="${key}"]`);
    assert.ok(row, `row "${key}" not found by data-row-key`);
    const cells = [...row!.querySelectorAll('td')].map((td) => td.textContent);
    assert.deepEqual(cells, expectedCells, `row "${key}": expected ${JSON.stringify(expectedCells)}, got ${JSON.stringify(cells)}`);
  }
});

// ---------------------------------------------------------------------------
// Agent statuses use only the honest allowed vocabulary (standalone HTML)
// ---------------------------------------------------------------------------

const ALLOWED_AGENT_STATUS_LABELS: Record<string, string[]> = {
  az: ['Tətbiq olunub', 'Qaydaya əsaslanan (deterministik)', 'Simulyasiya rejimində', 'Provayder konfiqurasiya olunmayıb', 'İnsan təsdiqi tələb olunur', 'Aktivləşdirmə gözlənilir'],
  ru: ['Реализовано', 'Детерминированное (на основе правил)', 'В режиме симуляции', 'Провайдер не настроен', 'Требуется подтверждение человеком', 'Ожидает активации'],
  en: ['Implemented', 'Deterministic (rule-based)', 'Simulated', 'Provider not configured', 'Human approval required', 'Activation pending']
};

for (const locale of ['az', 'ru', 'en']) {
  test(`AI-agent section (${locale}): every status badge uses only the honest allowed vocabulary`, async () => {
    const dom = freshDom();
    await settle();
    dom.window.setLocale(locale);
    await settle(100);
    const statuses = [...dom.window.document.querySelectorAll('#ai-agent-section .ai-agent-status')].map((s) => s.textContent);
    assert.equal(statuses.length, 8);
    for (const s of statuses) {
      assert.ok(ALLOWED_AGENT_STATUS_LABELS[locale].includes(s ?? ''), `status "${s}" is not in the honest allowed vocabulary for ${locale}`);
    }
  });
}

// ---------------------------------------------------------------------------
// Comparison table headings and content refresh on language switch too
// ---------------------------------------------------------------------------

test('comparison table titles refresh across AZ -> EN -> RU', async () => {
  const dom = freshDom();
  await settle();
  const doc = dom.window.document;
  const titleOf = () => doc.querySelector('#personal-comparison h2')?.textContent;

  dom.window.setLocale('az');
  await settle(100);
  const az = titleOf();
  dom.window.setLocale('en');
  await settle(100);
  const en = titleOf();
  dom.window.setLocale('ru');
  await settle(100);
  const ru = titleOf();

  assert.notEqual(az, en);
  assert.notEqual(en, ru);
  assert.notEqual(az, ru);
});

// ---------------------------------------------------------------------------
// Founder, Trip Room and CRM screens render meaningful content
// ---------------------------------------------------------------------------

test('Founder Command Center screen renders KPI figures', async () => {
  const dom = freshDom();
  await settle();
  dom.window.goScreen('founder');
  await settle(100);
  const kpis = dom.window.document.querySelectorAll('#fdr-kpis .mock-kpi');
  assert.ok(kpis.length >= 3, `expected at least 3 founder KPIs, found ${kpis.length}`);
});

test('Trip Room screen renders itinerary/document/visa status rows', async () => {
  const dom = freshDom();
  await settle();
  dom.window.goScreen('tripRoom');
  await settle(100);
  const rows = dom.window.document.querySelectorAll('#trip-card .mock-row');
  assert.ok(rows.length >= 3, `expected at least 3 Trip Room status rows, found ${rows.length}`);
});

test('CRM screen renders lead rows with source channel and status', async () => {
  const dom = freshDom();
  await settle();
  dom.window.goScreen('crm');
  await settle(100);
  const rows = dom.window.document.querySelectorAll('#crm-list .mock-row');
  assert.ok(rows.length >= 3, `expected at least 3 CRM lead rows, found ${rows.length}`);
});

test('approval screen decision (approve) updates the badge and disables buttons with zero errors', async () => {
  const dom = freshDom();
  await settle();
  const doc = dom.window.document;
  dom.window.goScreen('approvals');
  await settle(100);
  const approveBtn = doc.querySelector('#appr-list button.btn-em') as HTMLButtonElement | null;
  assert.ok(approveBtn, 'expected an approve button to be rendered');
  approveBtn!.click();
  await settle(100);
  const badge = doc.querySelector('#appr-list .mock-badge');
  assert.ok(badge?.classList.contains('done'), 'expected the badge to switch to the "done" state after approval');
  const errors = (dom as unknown as { __errors: string[] }).__errors;
  assert.deepEqual(errors, [], `unexpected JS errors during approval decision: ${JSON.stringify(errors)}`);
});

// ---------------------------------------------------------------------------
// Enumerated forbidden-phrase regression list (kept auditable in source)
// ---------------------------------------------------------------------------

/** Approved brand/technical terms that must NEVER be flagged even though
 *  they are (deliberately) unchanged across all three locales. */
const ALLOWLISTED_TERMS = [
  'VOYARA', 'VOYARA AI', 'Rufat Huseynov', 'Smart', 'Plus', 'Premium', 'Black',
  'Starter', 'Standard', 'Professional', 'Enterprise', 'Instagram', 'WhatsApp',
  'CRM', 'MVP', 'MIT', 'AAL2', 'SHA-256', 'Trip Room', 'Trip Wizard', 'DEMO', 'AZ', 'RU', 'EN'
];

/** Known previous-defect forbidden phrases, split by direction:
 *  - ENGLISH_LEAK_PHRASES: untranslated English UI labels that previously
 *    leaked into AZ/RU screens (checked against AZ and RU visible text).
 *  - AZ_LEAK_PHRASES: untranslated Azerbaijani strings (e.g. mock
 *    destination/field labels) that previously leaked into RU/EN screens
 *    (checked against RU and EN visible text — these phrases are, of
 *    course, entirely correct and expected when AZ itself is selected). */
const ENGLISH_LEAK_PHRASES = ['Landing', 'Wizard', 'Proposal', 'Approvals', 'Founder', 'Payment', 'Website', 'Voice call', 'Callback'];
const AZ_LEAK_PHRASES = ['Maldiv adaları', 'Başlanma tarixi', 'Gecə sayı', 'Davam et', 'Səyahətçi sayı', 'Yoxla və göndər'];

test('forbidden-phrase regression list: no untranslated English UI labels leak into AZ or RU visible text', async () => {
  const dom = freshDom();
  await settle();
  const doc = dom.window.document;

  for (const locale of ['az', 'ru']) {
    dom.window.setLocale(locale);
    await settle(100);
    for (const key of SCREEN_KEYS) {
      dom.window.goScreen(key);
      await settle(50);
      let visibleText = visibleTextOnly(doc);
      // Strip approved compound terms first (e.g. "Trip Wizard", "Trip
      // Room") so a legitimate named-feature mention embedded in an
      // otherwise fully-translated sentence isn't mistaken for a leaked
      // bare English word like "Wizard" or "Room".
      for (const term of ALLOWLISTED_TERMS) {
        visibleText = visibleText.split(term).join(' ');
      }
      for (const phrase of ENGLISH_LEAK_PHRASES) {
        assert.ok(!visibleText.includes(phrase), `untranslated English phrase "${phrase}" found in ${locale} visible text on screen "${key}"`);
      }
    }
  }
});

test('forbidden-phrase regression list: no untranslated Azerbaijani strings leak into RU or EN visible text', async () => {
  const dom = freshDom();
  await settle();
  const doc = dom.window.document;

  for (const locale of ['ru', 'en']) {
    dom.window.setLocale(locale);
    await settle(100);
    for (const key of SCREEN_KEYS) {
      dom.window.goScreen(key);
      await settle(50);
      const visibleText = visibleTextOnly(doc);
      for (const phrase of AZ_LEAK_PHRASES) {
        assert.ok(!visibleText.includes(phrase), `untranslated Azerbaijani phrase "${phrase}" found in ${locale} visible text on screen "${key}"`);
      }
    }
  }
});

test('sanity: the Azerbaijani leak-phrase list IS legitimately present when AZ itself is selected (proves the check direction is correct, not vacuous)', async () => {
  const dom = freshDom();
  await settle();
  dom.window.setLocale('az');
  await settle(100);
  dom.window.goScreen('wizard');
  await settle(100);
  const visibleText = visibleTextOnly(dom.window.document);
  const foundAtLeastOne = AZ_LEAK_PHRASES.some((phrase) => visibleText.includes(phrase));
  assert.ok(foundAtLeastOne, 'expected at least one AZ_LEAK_PHRASES entry to legitimately appear in AZ wizard text');
});

test('allowlisted brand/technical terms are confirmed present (sanity: the allowlist is exercised, not vacuous)', async () => {
  const dom = freshDom();
  await settle();
  const visibleText = visibleTextOnly(dom.window.document);
  let matchedAtLeastOne = false;
  for (const term of ALLOWLISTED_TERMS) {
    if (visibleText.includes(term)) matchedAtLeastOne = true;
  }
  assert.ok(matchedAtLeastOne, 'expected at least one allowlisted brand/technical term to appear in visible text');
});

// ---------------------------------------------------------------------------
// No mixed-language contamination (script-level heuristic on standalone output)
// ---------------------------------------------------------------------------

test('no Cyrillic characters appear in visible AZ or EN standalone text', async () => {
  const dom = freshDom();
  await settle();
  const doc = dom.window.document;
  const cyrillic = /[\u0400-\u04FF]/;
  for (const locale of ['az', 'en']) {
    dom.window.setLocale(locale);
    await settle(100);
    const visibleText = visibleTextOnly(doc);
    assert.doesNotMatch(visibleText, cyrillic, `unexpected Cyrillic text found in ${locale} standalone rendering`);
  }
});

test('no Azerbaijani-distinctive characters appear in visible RU or EN standalone text', async () => {
  const dom = freshDom();
  await settle();
  const doc = dom.window.document;
  const azDistinctive = /[əğıöüşçİ]/;
  for (const locale of ['ru', 'en']) {
    dom.window.setLocale(locale);
    await settle(100);
    const visibleText = visibleTextOnly(doc);
    assert.doesNotMatch(visibleText, azDistinctive, `unexpected Azerbaijani-distinctive character found in ${locale} standalone rendering`);
  }
});
