import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { globSync, existsSync } from 'node:fs';

async function resolveChromium() {
  const candidates = [
    ...globSync('/opt/pw-browsers/chromium-*/chrome-linux/chrome'),
    ...globSync(`${process.env.HOME || ''}/.cache/ms-playwright/chromium-*/chrome-linux/chrome`)
  ];
  const managed = candidates.find((c) => existsSync(c));
  return managed ? { executablePath: managed } : {};
}

/**
 * E.2B — permanent regression proof for the AZ hydration defect fixed in
 * published-proposals.tsx (money()/date formatting). Root cause: Chromium's
 * bundled ICU (in this environment's Playwright build) lacks complete
 * az-AZ locale data and silently falls back to a generic, non-Azerbaijani
 * format for Intl.NumberFormat/Intl.DateTimeFormat, while Node's full ICU
 * renders correctly — producing genuinely different server vs client text
 * and a real React hydration error (#418). This test would have failed
 * before the fix (deterministic hand-rolled az formatters replacing the
 * Intl delegation for az specifically) and passes after it.
 *
 * This exercises the REAL production JourneyCanvas presentation via the
 * production harness — a genuine render, not a source-string assertion.
 */
const port = process.env.E2B_AZ_REGRESSION_PORT || '3000';
const origin = `http://127.0.0.1:${port}`;
const server = spawn('node', ['scripts/start-standalone.mjs'], {
  env: { ...process.env, VOYARA_E2B_PRODUCTION_PREVIEW_ENABLED: 'true', PORT: port },
  stdio: ['ignore', 'pipe', 'pipe']
});
let out = '';
server.stdout.on('data', (c) => { out += c.toString(); });
server.stderr.on('data', (c) => { out += c.toString(); });

async function waitReady() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`server exited early:\n${out}`);
    try { const r = await fetch(`${origin}/az`); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`server not ready:\n${out}`);
}

let pass = 0, fail = 0;
function check(name, cond, extra) { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra ?? ''); } }

let browser;
try {
  await waitReady();
  browser = await chromium.launch({ headless: true, ...(await resolveChromium()) });
  const page = await browser.newPage();
  const devNoise = /webpack-hmr|WebSocket connection/i;

  for (const viewport of [{ w: 320, h: 900 }, { w: 390, h: 900 }, { w: 1024, h: 900 }, { w: 1440, h: 1000 }]) {
    await page.setViewportSize({ width: viewport.w, height: viewport.h });
    for (const state of ['published', 'accepted', 'payment-required', 'payment-review', 'booking-progress', 'voucher-issued', 'verification-rejected', 'cross-quotation', 'minimal-live']) {
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      const requests = [];
      const onReq = (req) => { if (req.url().includes(origin) && req.method() !== 'GET') requests.push(req.url()); };
      page.on('request', onReq);

      await page.goto(`${origin}/az/internal-preview/e2b-production/${state}`, { waitUntil: 'networkidle', timeout: 20000 });
      const label = `AZ ${viewport.w}px ${state}`;
      const realErrors = errors.filter((m) => !devNoise.test(m));
      check(`${label}: zero hydration/console/page errors`, realErrors.length === 0, JSON.stringify(realErrors));

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`${label}: zero horizontal overflow`, overflow <= 0, overflow);
      check(`${label}: zero non-GET requests`, requests.length === 0, JSON.stringify(requests));

      const bodyText = await page.locator('body').innerText();
      check(`${label}: real AZ content present (not raw keys)`, bodyText.includes('Baku to Istanbul') && !bodyText.includes('journeyCanvas.'));

      if (['accepted', 'payment-required', 'payment-review', 'booking-progress', 'voucher-issued', 'verification-rejected', 'cross-quotation'].includes(state)) {
        const totalEl = await page.locator('.proposal-total strong').first().textContent().catch(() => null);
        check(`${label}: proposal total renders (AZ money format)`, totalEl !== null && /₼/.test(totalEl ?? ''), totalEl);
        const validUntilEl = await page.locator('.proposal-version-strip strong').nth(1).textContent().catch(() => null);
        check(`${label}: valid-until date renders`, validUntilEl !== null && validUntilEl.length > 0, validUntilEl);
      }
      if (['accepted', 'payment-required', 'payment-review', 'booking-progress', 'voucher-issued', 'verification-rejected'].includes(state)) {
        const nextActionCard = await page.locator('.next-action-card').count();
        check(`${label}: NextActionCard renders`, nextActionCard === 1);
        const responsibility = await page.locator('.next-action-card').getAttribute('data-responsibility').catch(() => null);
        check(`${label}: NextActionCard has a real responsibility attribute`, responsibility === 'customer' || responsibility === 'voyara' || responsibility === 'ready', responsibility);
      }

      page.off('request', onReq);
      page.removeAllListeners('pageerror');
      page.removeAllListeners('console');
    }
  }

  console.log(`\nAZ HYDRATION REGRESSION: ${pass} passed, ${fail} failed.`);
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}

process.exitCode = fail > 0 ? 1 : 0;
