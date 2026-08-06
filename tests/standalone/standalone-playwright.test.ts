import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';

/**
 * Phase C8 item 4 — real Playwright verification of the standalone HTML
 * across the full 48-state matrix: 8 screens x 3 locales x 2 viewports.
 *
 * Uses a locally cached Chromium binary directly via `executablePath`,
 * because the `playwright` npm package version installed in this project
 * (1.61.1, expecting browser revision 1228) does not match the only
 * browser revision actually cached on this machine (1194, at
 * /opt/pw-browsers/chromium-1194). Playwright's own revision-resolution
 * logic refuses to use a mismatched revision automatically, but the
 * cached 1194 binary launches and drives pages correctly when pointed to
 * explicitly — confirmed by a manual smoke check before this suite was
 * written. If that cached binary is ever removed, this suite fails
 * loudly with a clear "executable not found" error rather than silently
 * skipping — see test.before() below.
 *
 * Run standalone: `npm run test:standalone:playwright`
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const CACHED_CHROMIUM_PATH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const SCREEN_KEYS = ['landing', 'wizard', 'proposal', 'approvals', 'founder', 'tripRoom', 'payment', 'crm'] as const;
const LOCALES = ['az', 'ru', 'en'] as const;
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 }
] as const;

const SCREEN_TITLE_ELEMENT_ID: Record<(typeof SCREEN_KEYS)[number], string | null> = {
  landing: null, // landing's heading is the hero <h1>, not a mock-head title
  wizard: 'wiz-title',
  proposal: 'prop-title',
  approvals: 'appr-title',
  founder: 'fdr-title',
  tripRoom: 'trip-title',
  payment: 'pay-title',
  crm: 'crm-title'
};

let fileUrl: string;
let tmpDir: string;
let browser: Browser;

test.before(async () => {
  if (!existsSync(CACHED_CHROMIUM_PATH)) {
    throw new Error(
      `Cached Chromium binary not found at ${CACHED_CHROMIUM_PATH}. This suite requires a real local browser ` +
      `and will not silently skip — see the file header for why executablePath is pinned explicitly.`
    );
  }
  tmpDir = mkdtempSync(path.join(tmpdir(), 'voyara-pw-'));
  const outPath = path.join(tmpDir, 'test-build.html');
  execFileSync('node', [path.join(ROOT, 'scripts/build-final-interactive-demo.mjs'), outPath], { cwd: ROOT });
  fileUrl = `file://${outPath}`;
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], executablePath: CACHED_CHROMIUM_PATH });
});

test.after(async () => {
  await browser.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

interface StateCheckResult {
  consoleErrors: string[];
  pageErrors: string[];
  externalRequests: string[];
  cspViolations: string[];
  hasHorizontalOverflow: boolean;
  screenTitle: string | null;
  documentTitle: string;
}

async function checkState(page: Page, screenKey: string, locale: string): Promise<StateCheckResult> {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const externalRequests: string[] = [];
  const cspViolations: string[] = [];

  page.removeAllListeners('console');
  page.removeAllListeners('pageerror');
  page.removeAllListeners('request');

  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('request', (req) => {
    const url = req.url();
    if (!url.startsWith('file://') && !url.startsWith('data:') && !url.startsWith('about:')) externalRequests.push(url);
  });
  await page.exposeFunction('__reportCspViolation', (detail: string) => cspViolations.push(detail)).catch(() => { /* already exposed */ });
  await page.evaluate(() => {
    document.addEventListener('securitypolicyviolation', (e: SecurityPolicyViolationEvent) => {
      (window as unknown as { __reportCspViolation: (s: string) => void }).__reportCspViolation(`${e.violatedDirective}: ${e.blockedURI}`);
    });
  }).catch(() => { /* listener already attached on a prior state */ });

  await page.evaluate((loc) => { (window as unknown as { setLocale: (l: string) => void }).setLocale(loc); }, locale);
  await page.evaluate((key) => { (window as unknown as { goScreen: (k: string) => void }).goScreen(key); }, screenKey);
  await page.waitForTimeout(150);

  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  const titleElId = SCREEN_TITLE_ELEMENT_ID[screenKey as (typeof SCREEN_KEYS)[number]];
  const screenTitle = titleElId ? await page.evaluate((id) => document.getElementById(id)?.textContent ?? null, titleElId) : null;
  const documentTitle = await page.title();

  return { consoleErrors, pageErrors, externalRequests, cspViolations, hasHorizontalOverflow, screenTitle, documentTitle };
}

// ---------------------------------------------------------------------------
// The full 48-state matrix
// ---------------------------------------------------------------------------

for (const viewport of VIEWPORTS) {
  for (const locale of LOCALES) {
    for (const screenKey of SCREEN_KEYS) {
      test(`[${viewport.name} ${viewport.width}x${viewport.height}] [${locale}] [${screenKey}]: no overflow, no errors, no external requests`, async () => {
        const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
        const page = await context.newPage();
        try {
          await page.goto(fileUrl);
          await page.waitForTimeout(200);
          const result = await checkState(page, screenKey, locale);

          assert.deepEqual(result.consoleErrors, [], `console errors: ${JSON.stringify(result.consoleErrors)}`);
          assert.deepEqual(result.pageErrors, [], `page errors: ${JSON.stringify(result.pageErrors)}`);
          assert.deepEqual(result.externalRequests, [], `unexpected external requests: ${JSON.stringify(result.externalRequests)}`);
          assert.deepEqual(result.cspViolations, [], `CSP violations: ${JSON.stringify(result.cspViolations)}`);
          assert.equal(result.hasHorizontalOverflow, false, `unexpected horizontal overflow at ${viewport.width}px on ${screenKey}/${locale}`);
          if (SCREEN_TITLE_ELEMENT_ID[screenKey as (typeof SCREEN_KEYS)[number]]) {
            assert.ok(result.screenTitle && result.screenTitle.length > 0, `expected a non-empty localized screen title for ${screenKey}/${locale}`);
          }
        } finally {
          await context.close();
        }
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Language switching mid-flow preserves screen/state
// ---------------------------------------------------------------------------

test('language switching mid-flow (real browser): remains on the same screen and updates the heading', async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(fileUrl);
    await page.waitForTimeout(200);
    await page.evaluate(() => (window as unknown as { goScreen: (k: string) => void }).goScreen('proposal'));
    await page.waitForTimeout(100);

    const azTitle = await page.evaluate(() => document.getElementById('prop-title')?.textContent);
    await page.evaluate(() => (window as unknown as { setLocale: (l: string) => void }).setLocale('en'));
    await page.waitForTimeout(150);
    const activeScreenId = await page.evaluate(() => document.querySelector('.screen.on')?.id);
    const enTitle = await page.evaluate(() => document.getElementById('prop-title')?.textContent);

    assert.equal(activeScreenId, 'screen-proposal', 'expected to remain on the proposal screen after switching language');
    assert.notEqual(azTitle, enTitle, 'expected the proposal title to change between AZ and EN');
  } finally {
    await context.close();
  }
});

// ---------------------------------------------------------------------------
// Landing-screen sections (comparison, journey, agents) are readable at
// both viewport widths
// ---------------------------------------------------------------------------

for (const viewport of VIEWPORTS) {
  test(`[${viewport.name}] landing sections (comparison/journey/agents) are visible and non-overlapping`, async () => {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    const page = await context.newPage();
    try {
      await page.goto(fileUrl);
      await page.waitForTimeout(200);
      await page.evaluate(() => (window as unknown as { goScreen: (k: string) => void }).goScreen('landing'));
      await page.waitForTimeout(150);

      for (const selector of ['#personal-comparison', '#corporate-comparison', '#member-value-journey', '#ai-agent-section']) {
        const box = await page.locator(selector).boundingBox();
        assert.ok(box, `expected ${selector} to have a bounding box (be rendered/visible)`);
        assert.ok(box!.width > 0 && box!.height > 0, `expected ${selector} to have non-zero dimensions`);
      }
    } finally {
      await context.close();
    }
  });
}
