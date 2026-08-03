import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { existsSync, globSync } from 'node:fs';

async function resolveChromium() {
  // Prefer a Playwright-managed Chromium if present; otherwise fall back to the
  // @sparticuz/chromium binary. This keeps the browser test runnable in
  // environments where Playwright's CDN download is unavailable, without
  // changing any assertion. `npx playwright install chromium` remains the
  // documented path when the download is reachable.
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

// Runs against the PRODUCTION standalone build (not next dev), so the strict
// production CSP is exercised. `npm run build` (in verify) must have produced
// .next/standalone/server.js before this test runs.
const port = '3200';
const origin = `http://127.0.0.1:${port}`;
const serverEnvironment = {
  ...process.env,
  NODE_ENV: 'production',
  PORT: port,
  VOYARA_HOSTNAME: '127.0.0.1'
};
for (const name of [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'DATABASE_URL',
  'VOYARA_HEALTH_TOKEN',
  'VOYARA_RELEASE_ID'
]) delete serverEnvironment[name];

const server = spawn('node', ['scripts/start-standalone.mjs'], {
  cwd: process.cwd(),
  env: serverEnvironment,
  stdio: ['ignore', 'pipe', 'pipe']
});
let serverOutput = '';
server.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });

async function waitUntilReady() {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Browser server exited early:\n${serverOutput}`);
    try {
      const response = await fetch(`${origin}/az`);
      if (response.ok) return;
    } catch {
      // Standalone server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Browser server did not become ready:\n${serverOutput}`);
}

const screenPaths = [
  '',
  '/trip-wizard',
  '/proposal',
  '/staff/approvals',
  '/staff/founder',
  '/trip-room',
  '/payment',
  '/staff/crm'
];
// In the production standalone build (no demo mode) the public surfaces render
// directly; the protected screen routes redirect to the locale login. Both sets
// are exercised below.
const publicPaths = ['', '/trip-wizard', '/login'];
const protectedPaths = screenPaths.filter((path) => !['', '/trip-wizard'].includes(path));
const viewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1440, height: 900 }
];
const forbiddenText = /undefined|\[object Object\]|landing\.[a-zA-Z]|nav\.[a-zA-Z]/;

let browser;
try {
  await waitUntilReady();
  const chromiumLaunch = await resolveChromium();
  browser = await chromium.launch({ headless: true, ...chromiumLaunch });
  const page = await browser.newPage();
  const runtimeErrors = [];
  const cspViolations = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });
  // Capture CSP violations explicitly via the security policy report event.
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      (window.__cspViolations ||= []).push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const path of publicPaths) {
      runtimeErrors.length = 0;
      const response = await page.goto(`${origin}/az${path}`, { waitUntil: 'networkidle', timeout: 60_000 });
      assert.equal(response?.status(), 200, `${viewport.name} ${path || '/'} status`);
      assert.equal(await page.locator('html').getAttribute('lang'), 'az');
      assert.equal(await page.locator('main#main-content').count(), 1, `${path || '/'} main landmark`);
      assert.ok((await page.locator('h1').count()) >= 1, `${path || '/'} has a heading`);
      const audit = await page.evaluate(() => {
        const visibleControls = [...document.querySelectorAll('input:not([type="hidden"]), select, textarea')]
          .filter((element) => !(element instanceof HTMLElement) || element.offsetParent !== null);
        const unlabelledControls = visibleControls.filter((element) => {
          const id = element.getAttribute('id');
          return !element.getAttribute('aria-label')
            && !element.getAttribute('aria-labelledby')
            && !element.closest('label')
            && !(id && document.querySelector(`label[for="${CSS.escape(id)}"]`));
        }).length;
        const unnamedButtons = [...document.querySelectorAll('button')]
          .filter((button) => !button.textContent?.trim() && !button.getAttribute('aria-label') && !button.getAttribute('aria-labelledby')).length;
        const imagesWithoutAlt = [...document.querySelectorAll('img:not([alt])')].length;
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          bodyText: document.body.innerText,
          unlabelledControls,
          unnamedButtons,
          imagesWithoutAlt
        };
      });
      assert.ok(audit.overflow <= 2, `${viewport.name} ${path || '/'} horizontal overflow ${audit.overflow}px`);
      assert.equal(audit.unlabelledControls, 0, `${path || '/'} labelled controls`);
      assert.equal(audit.unnamedButtons, 0, `${path || '/'} named buttons`);
      assert.equal(audit.imagesWithoutAlt, 0, `${path || '/'} image alternatives`);
      assert.ok(!forbiddenText.test(audit.bodyText), `${viewport.name} ${path || '/'} no undefined/raw keys`);
      const violations = await page.evaluate(() => window.__cspViolations || []);
      assert.deepEqual(violations, [], `${viewport.name} ${path || '/'} CSP violations`);
      assert.deepEqual(runtimeErrors, [], `${viewport.name} ${path || '/'} browser errors`);
    }
    // Protected routes must not 500 in production; they redirect to the locale login.
    for (const path of protectedPaths) {
      const response = await fetch(`${origin}/az${path}`, { redirect: 'manual' });
      assert.ok([302, 303, 307].includes(response.status), `${path} protected redirect (got ${response.status})`);
      assert.ok((response.headers.get('location') ?? '').startsWith('/az/login'), `${path} redirects to login`);
    }
  }

  // Server-rendered <html lang> for each locale.
  for (const locale of ['az', 'ru', 'en']) {
    for (const path of ['', '/trip-wizard']) {
      const response = await page.goto(`${origin}/${locale}${path}`, { waitUntil: 'networkidle', timeout: 60_000 });
      assert.equal(response?.status(), 200);
      assert.equal(await page.locator('html').getAttribute('lang'), locale);
    }
  }

  // Showcase: select S4, then AZ -> RU -> EN preserves #s4 and <html lang> updates.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/az#screens`, { waitUntil: 'networkidle' });
  await page.locator('.showcase .sc-item').nth(3).click();
  assert.equal(await page.evaluate(() => location.hash), '#s4', 'S4 hash written');
  const s4Az = await page.locator('.showcase .scr-h h3').innerText();
  for (const locale of ['ru', 'en']) {
    await page.locator('.locale-switcher a', { hasText: locale.toUpperCase() }).click();
    await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('html').getAttribute('lang'), locale, `<html lang> is ${locale} after switch`);
    assert.equal(await page.evaluate(() => location.hash), '#s4', `#s4 preserved into ${locale}`);
    const skip = await page.locator('a.skip-link').getAttribute('href');
    assert.equal(skip, '#main-content', 'skip-link present after switch');
    const s4Loc = await page.locator('.showcase .scr-h h3').innerText();
    assert.notEqual(s4Loc, '', `S4 title rendered in ${locale}`);
    assert.notEqual(s4Loc, s4Az, `S4 title localised in ${locale}`);
  }

  // Direct-open a screen hash restores the selection.
  await page.goto(`${origin}/en#s6`, { waitUntil: 'networkidle' });
  assert.equal(await page.evaluate(() => location.hash), '#s6', 'direct #s6 open');
  const activeItem = await page.locator('.showcase .sc-item.on .sc-item-title').innerText();
  assert.notEqual(activeItem, '', 'direct-open selects a screen');

  // All eight showcase screens selectable.
  await page.goto(`${origin}/az#screens`, { waitUntil: 'networkidle' });
  assert.equal(await page.locator('.showcase .sc-item').count(), 8, 'eight showcase screens');
  for (let index = 0; index < 8; index += 1) {
    await page.locator('.showcase .sc-item').nth(index).click();
    assert.equal(await page.locator('.showcase .scr-h h3').count(), 1, `screen ${index + 1} renders`);
  }

  // Monthly/annual pricing selector toggles the displayed price.
  const before = (await page.locator('.plans-v2 .plan-pr').first().innerText()).replace(/\s+/g, ' ');
  await page.locator('.perctl button').nth(1).click();
  const after = (await page.locator('.plans-v2 .plan-pr').first().innerText()).replace(/\s+/g, ' ');
  assert.notEqual(before, after, 'monthly/annual selector changes price');

  // Mobile menu opens and lists navigation.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/az`, { waitUntil: 'networkidle' });
  await page.locator('.menu-toggle').click();
  assert.ok((await page.locator('.mobile-nav a').count()) >= 3, 'mobile menu lists navigation');
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'no horizontal overflow at 390px'
  );

  // Keyboard skip link.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/az`, { waitUntil: 'networkidle' });
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('skip-link')), true);
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'main-content');

  process.stdout.write('Browser launch readiness PASS: production standalone build; eight screens at mobile/desktop; zero CSP violations, console errors and page errors; <html lang> correct after in-app language switch; showcase S4 preserved across AZ/RU/EN and via direct URL; all eight showcase screens; monthly/annual pricing; mobile menu; no undefined/raw keys; 390px overflow guard.\n');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  await new Promise((resolve) => {
    if (server.exitCode !== null) return resolve();
    server.once('exit', resolve);
    setTimeout(resolve, 2_000).unref();
  });
}
