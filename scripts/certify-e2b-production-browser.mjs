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

const port = process.env.E2B_PROD_CERT_PORT || '3000';
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

const viewports = [
  { name: '320', width: 320, height: 900 }, { name: '390', width: 390, height: 900 },
  { name: '1024', width: 1024, height: 900 }, { name: '1440', width: 1440, height: 1000 }
];
const locales = ['az', 'ru', 'en'];
const askStates = ['compose', 'chip-filled', 'parsed-confirmation', 'validation-error'];
const journeyStates = ['published', 'accepted', 'payment-required', 'payment-review', 'booking-progress', 'voucher-issued', 'verification-rejected', 'cross-quotation', 'minimal-live'];

const forbiddenText = /undefined|\[object Object\]|inbox\.[a-zA-Z]+|askVoyara\.[a-zA-Z]+|journeyCanvas\.[a-zA-Z]+/;

async function driveAskState(page, state) {
  if (state === 'compose') return;
  const sendBtn = page.locator('button[type="submit"]').first();
  if (state === 'chip-filled') {
    const chip = page.locator('.e2b-quick-prompts button').first();
    if (await chip.count() > 0) await chip.click();
    return;
  }
  if (state === 'parsed-confirmation') {
    await page.fill('.e2b-text-input', 'Trip to Istanbul, 5 nights, 2 adults, budget 3000 AZN');
    await sendBtn.click();
    await page.waitForTimeout(150);
    return;
  }
  if (state === 'validation-error') {
    await page.fill('.e2b-text-input', 'hello');
    await sendBtn.click();
    await page.waitForTimeout(150);
  }
}

let pass = 0, fail = 0;
const findings = [];
function check(name, cond, extra) { if (cond) { pass++; } else { fail++; findings.push(`${name} ${extra ?? ''}`); } }

let browser;
let checked = 0;
try {
  await waitReady();
  browser = await chromium.launch({ headless: true, ...(await resolveChromium()) });
  const page = await browser.newPage();
  const runtimeErrors = [];
  page.on('pageerror', (e) => runtimeErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') runtimeErrors.push(m.text()); });

  for (const v of viewports) {
    await page.setViewportSize({ width: v.width, height: v.height });
    for (const locale of locales) {
      for (const state of askStates) {
        runtimeErrors.length = 0;
        const requests = [];
        const onReq = (req) => { if (req.url().includes(origin) && req.method() !== 'GET') requests.push(req.url()); };
        page.on('request', onReq);
        const label = `ASK ${v.name} ${locale} ${state}`;
        const response = await page.goto(`${origin}/${locale}/internal-preview/e2b-production-ask/${state}`, { waitUntil: 'networkidle', timeout: 20000 });
        check(`${label} status 200`, response?.status() === 200, response?.status());
        await driveAskState(page, state);

        const audit = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          bodyText: document.body.innerText,
          brokenImages: [...document.querySelectorAll('img')].filter((img) => img.complete && img.naturalWidth === 0).length,
          bannerCount: document.querySelectorAll('.e2b-preview-banner').length,
          topbarCount: document.querySelectorAll('header.site-header').length
        }));
        check(`${label} zero overflow`, audit.overflow <= 0, audit.overflow);
        check(`${label} banner exactly once`, audit.bannerCount === 1);
        check(`${label} no marketing chrome`, audit.topbarCount === 0);
        check(`${label} zero broken images`, audit.brokenImages === 0);
        check(`${label} no forbidden/raw text`, !forbiddenText.test(audit.bodyText));
        const devNoise = /webpack-hmr|WebSocket connection/i;
        check(`${label} zero errors`, runtimeErrors.filter((m) => !devNoise.test(m)).length === 0, JSON.stringify(runtimeErrors));
        check(`${label} zero non-GET requests`, requests.length === 0, JSON.stringify(requests));
        if (state === 'chip-filled') {
          const inputVal = await page.locator('.e2b-text-input').inputValue().catch(() => '');
          check(`${label} draft populated by chip`, inputVal.length > 0);
          const turns = await page.locator('.e2b-turn').count();
          check(`${label} chip did not auto-submit`, turns === 0, turns);
        }
        page.off('request', onReq);
        checked++;
      }

      for (const state of journeyStates) {
        runtimeErrors.length = 0;
        const requests = [];
        const onReq = (req) => { if (req.url().includes(origin) && req.method() !== 'GET') requests.push(req.url()); };
        page.on('request', onReq);
        const label = `JOURNEY ${v.name} ${locale} ${state}`;
        const response = await page.goto(`${origin}/${locale}/internal-preview/e2b-production/${state}`, { waitUntil: 'networkidle', timeout: 20000 });
        check(`${label} status 200`, response?.status() === 200, response?.status());

        const audit = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          bodyText: document.body.innerText,
          brokenImages: [...document.querySelectorAll('img')].filter((img) => img.complete && img.naturalWidth === 0).length,
          bannerCount: document.querySelectorAll('.e2b-preview-banner').length,
          topbarCount: document.querySelectorAll('header.site-header').length
        }));
        check(`${label} zero overflow`, audit.overflow <= 0, audit.overflow);
        check(`${label} banner exactly once`, audit.bannerCount === 1);
        check(`${label} no marketing chrome`, audit.topbarCount === 0);
        check(`${label} zero broken images`, audit.brokenImages === 0);
        check(`${label} no forbidden/raw text`, !forbiddenText.test(audit.bodyText));
        const devNoise = /webpack-hmr|WebSocket connection/i;
        check(`${label} zero errors`, runtimeErrors.filter((m) => !devNoise.test(m)).length === 0, JSON.stringify(runtimeErrors));
        check(`${label} zero non-GET requests`, requests.length === 0, JSON.stringify(requests));
        if (state === 'accepted' && locale === 'en') check(`${label} no pay-now claim`, !/pay now/i.test(audit.bodyText));
        // "ready to travel" is checked in EN only — az/ru render the
        // real localized NextActionCard string, which this English
        // substring check cannot match. Locale-correctness of that
        // string is already covered by the AZ/RU/EN dictionary-parity
        // gate elsewhere; this check only needs to prove EN's wording.
        if (state === 'voucher-issued' && locale === 'en') check(`${label} ready-to-travel present`, /ready to travel/i.test(audit.bodyText));
        if (state === 'verification-rejected' && locale === 'en') check(`${label} not ready-to-travel`, !/ready to travel/i.test(audit.bodyText));

        page.off('request', onReq);
        checked++;
      }
    }
  }

  console.log(`E2B PRODUCTION BROWSER CERT: ${checked} combinations checked, ${pass} assertions passed, ${fail} failed.`);
  if (findings.length > 0) console.error('FAILURES (first 40):\n' + findings.slice(0, 40).join('\n'));
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}

process.exitCode = fail > 0 ? 1 : 0;
