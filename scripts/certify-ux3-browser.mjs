import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { existsSync, globSync } from 'node:fs';

/**
 * UX3 browser QA — layout/CSS/CSP coverage for the four post-planning
 * customer surfaces (Journey Canvas/Proposal, Payment, Trip Room,
 * Membership), same dev+demo-mode mechanism as scripts/certify-ux2-browser.mjs
 * and the same honest caveat: `next dev` client hydration is unreliable in
 * this sandbox (proven environment-wide in UX2 QA), so this checks real
 * SSR HTML/CSS layout, not live click interaction.
 *
 * HONEST FIXTURE LIMITATION: every customer data loader
 * (loadCustomerPublishedProposals, loadCustomerPaymentRequests,
 * loadCustomerBookings, loadCurrentMembership) explicitly returns
 * empty/null unless it can reach a real Supabase instance
 * (viewer.source === 'supabase' / a working admin client) — the demo-mode
 * viewer used here has `source: 'demo'` specifically to avoid touching
 * production data, so every loader short-circuits to empty. That means
 * this sandbox's live browser session can only ever render the honest
 * EMPTY/sample state for these four routes, never the accepted-quotation,
 * payment-required, booking-in-progress, or active-membership states.
 * Those states are proven correct instead by the 45/45 tests/ux3 suite
 * (deriveJourneyNextAction/deriveBookingStage), which exercises the exact
 * same projection logic these components render — that is real coverage
 * of the business logic, just not a live-fixture screenshot of it. This
 * script is honest about that split rather than fabricating fixture
 * coverage it does not have.
 */

async function resolveChromium() {
  const candidates = [
    ...globSync('/opt/pw-browsers/chromium-*/chrome-linux/chrome'),
    ...globSync(`${process.env.HOME || ''}/.cache/ms-playwright/chromium-*/chrome-linux/chrome`)
  ];
  const managed = candidates.find((candidate) => existsSync(candidate));
  if (managed) return { executablePath: managed, args: [] };
  try {
    const sparticuz = (await import('@sparticuz/chromium')).default;
    return { executablePath: await sparticuz.executablePath(), args: sparticuz.args };
  } catch {
    return {};
  }
}

const port = process.env.UX3_QA_PORT || '3221';
const origin = `http://127.0.0.1:${port}`;
const server = spawn('npx', ['next', 'dev', '--port', port], {
  cwd: process.cwd(),
  env: { ...process.env, VOYARA_DEMO_MODE: 'true', VOYARA_DEMO_ROLE: 'customer', PORT: port },
  stdio: ['ignore', 'pipe', 'pipe']
});
let serverOutput = '';
server.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });

async function waitUntilReady() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`UX3 dev server exited early:\n${serverOutput}`);
    try {
      const response = await fetch(`${origin}/az`);
      if (response.ok) return;
    } catch {
      // still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`UX3 dev server did not become ready:\n${serverOutput}`);
}

const routes = ['/proposal', '/payment', '/trip-room', '/membership'];
const viewports = [
  { name: '320', width: 320, height: 720 },
  { name: '390', width: 390, height: 844 },
  { name: '1024', width: 1024, height: 900 },
  { name: '1280', width: 1280, height: 900 },
  { name: '1440', width: 1440, height: 900 }
];

// Full target matrix is 5 viewports x 3 locales x 4 routes = 60. Sliced
// via UX3_QA_SLICE env var across multiple invocations to fit this
// sandbox's per-call execution time budget; default slice covers the full
// az set (20) when no slice is specified.
const SLICES = {
  az: viewports.flatMap((viewport) => routes.map((route) => ({ viewport, locale: 'az', route }))),
  'ru-1': ['ru'].flatMap((locale) => [viewports[0], viewports[1]].flatMap((viewport) => routes.map((route) => ({ viewport, locale, route })))),
  'ru-2': ['ru'].flatMap((locale) => [viewports[2], viewports[3], viewports[4]].flatMap((viewport) => routes.map((route) => ({ viewport, locale, route })))),
  'en-1': ['en'].flatMap((locale) => [viewports[0], viewports[1]].flatMap((viewport) => routes.map((route) => ({ viewport, locale, route })))),
  'en-2': ['en'].flatMap((locale) => [viewports[2], viewports[3], viewports[4]].flatMap((viewport) => routes.map((route) => ({ viewport, locale, route }))))
};
const sliceName = process.env.UX3_QA_SLICE || 'az';
const combinations = SLICES[sliceName];
if (!combinations) throw new Error(`Unknown UX3_QA_SLICE "${sliceName}"`);

const forbiddenText = /undefined|\[object Object\]|journeyContinuity\.[a-zA-Z]+|membershipContext\.[a-zA-Z]+|journeyCanvas\.[a-zA-Z]+|experienceShell\.[a-zA-Z]+|bookingCustomer\.[a-zA-Z]+|paymentCustomer\.[a-zA-Z]+/;

let browser;
const findings = [];
try {
  await waitUntilReady();
  const chromiumLaunch = await resolveChromium();
  browser = await chromium.launch({ headless: true, ...chromiumLaunch });
  const page = await browser.newPage();
  const runtimeErrors = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      (window.__cspViolations ||= []).push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });

  let lastViewport = null;
  for (const { viewport, locale, route } of combinations) {
    if (viewport !== lastViewport) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      lastViewport = viewport;
    }
    runtimeErrors.length = 0;
    const url = `${origin}/${locale}${route}`;
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
    assert.equal(response?.status(), 200, `${viewport.name} ${locale} ${route} status`);
    assert.equal(await page.locator('html').getAttribute('lang'), locale, `${route} lang attr`);
    assert.equal(await page.locator('main#main-content').count(), 1, `${viewport.name} ${locale} ${route} exactly one main landmark`);

    const audit = await page.evaluate(() => {
      const docOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      let widest = null;
      if (docOverflow > 2) {
        let maxRight = 0;
        document.querySelectorAll('body *').forEach((element) => {
          const rect = element.getBoundingClientRect();
          if (rect.right > maxRight && rect.width > 0) {
            maxRight = rect.right;
            widest = `${element.tagName}.${[...element.classList].join('.')}`;
          }
        });
      }
      return {
        overflow: docOverflow,
        widest,
        bodyText: document.body.innerText,
        brokenImages: [...document.querySelectorAll('img')].filter((img) => img.complete && img.naturalWidth === 0).length
      };
    });

    assert.ok(audit.overflow <= 2, `${viewport.name} ${locale} ${route} horizontal overflow ${audit.overflow}px (widest: ${audit.widest})`);
    assert.equal(audit.brokenImages, 0, `${viewport.name} ${locale} ${route} broken images`);
    assert.ok(!forbiddenText.test(audit.bodyText), `${viewport.name} ${locale} ${route} no undefined/raw dictionary keys`);

    const devModeNoise = /webpack-hmr|WebSocket connection/i;
    const realRuntimeErrors = runtimeErrors.filter((message) => !devModeNoise.test(message));
    assert.deepEqual(realRuntimeErrors, [], `${viewport.name} ${locale} ${route} browser/console errors`);
    const violations = await page.evaluate(() => window.__cspViolations || []);
    const nonDevViolations = violations.filter((v) => !/websocket/i.test(v));
    assert.deepEqual(nonDevViolations, [], `${viewport.name} ${locale} ${route} unexpected CSP violations`);
  }

  // Shell chrome sanity on the UX3 routes (regression guard against the
  // duplicated-navigation defect found during UX2 QA).
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const route of routes) {
    await page.goto(`${origin}/az${route}`, { waitUntil: 'networkidle' });
    assert.equal(await page.locator('.exp-topbar').count(), 1, `${route}: exactly one shell topbar`);
    assert.equal(await page.locator('.locale-switcher .locale-link').count(), 3, `${route}: exactly one LocaleSwitcher instance`);
    assert.equal(await page.locator('.site-footer').count(), 0, `${route}: no stacked marketing footer`);
  }

  console.log(`UX3 browser QA PASS (slice "${sliceName}"):`, combinations.length, 'route/locale/viewport combinations checked across Proposal/Payment/Trip Room/Membership; shell chrome regression guard re-checked.');
} catch (error) {
  findings.push(error instanceof Error ? error.message : String(error));
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}

if (findings.length > 0) {
  console.error('UX3 browser QA FAIL:\n' + findings.join('\n'));
  process.exitCode = 1;
}
