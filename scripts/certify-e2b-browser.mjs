import assert from 'node:assert/strict';
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

const port = process.env.E2B_BROWSER_PORT || '3000';
const origin = `http://127.0.0.1:${port}`;
const server = spawn('node', ['scripts/start-standalone.mjs'], {
  env: { ...process.env, VOYARA_CUSTOMER_EXPERIENCE_PREVIEW_ENABLED: 'true', PORT: port },
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
const states = ['initial', 'partial-brief', 'journey-built', 'direction-changed', 'edit-applied'];

async function driveToState(page, state) {
  if (state === 'initial') return;
  await page.fill('.e2b-text-input', 'Istanbul');
  await page.click('button:has-text("Send"), button:has-text("Göndər"), button:has-text("Отправить")');
  await page.waitForTimeout(100);
  if (state === 'partial-brief') return;
  await page.fill('.e2b-text-input', '5 nights, 2 adults, September, 3000 AZN, culture, relaxed.');
  await page.click('button:has-text("Send"), button:has-text("Göndər"), button:has-text("Отправить")');
  await page.waitForTimeout(100);
  const buildBtn = page.locator('button:has-text("Build my journey"), button:has-text("Səyahətimi qur"), button:has-text("Создать мой маршрут")');
  if (await buildBtn.count() > 0) await buildBtn.click();
  await page.waitForTimeout(150);
  if (state === 'journey-built') return;
  const directionBtn = page.locator('.e2b-inspiration-card button').nth(1);
  if (await directionBtn.count() > 0) await directionBtn.click();
  await page.waitForTimeout(150);
  const compareBtn = page.locator('.e2b-compare-card').nth(2).locator('button');
  if (await compareBtn.count() > 0) await compareBtn.click();
  await page.waitForTimeout(100);
  if (state === 'direction-changed') return;
  const editBtn = page.locator('.e2b-edit-panel button').first();
  if (await editBtn.count() > 0) await editBtn.click();
  await page.waitForTimeout(100);
}

const forbiddenText = /confirmed booking|payment received|booking confirmed|live price|guaranteed availability|undefined|\[object Object\]/i;

let pass = 0, fail = 0;
const findings = [];
function check(name, cond, extra) { if (cond) { pass++; } else { fail++; findings.push(`${name} ${extra ?? ''}`); } }

let browser;
try {
  await waitReady();
  browser = await chromium.launch({ headless: true, ...(await resolveChromium()) });
  const page = await browser.newPage();
  const runtimeErrors = [];
  page.on('pageerror', (e) => runtimeErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') runtimeErrors.push(m.text()); });
  let checked = 0;

  for (const v of viewports) {
    await page.setViewportSize({ width: v.width, height: v.height });
    for (const locale of locales) {
      for (const state of states) {
        runtimeErrors.length = 0;
        const requests = [];
        const onReq = (req) => { if (req.url().includes(origin) && req.method() !== 'GET') requests.push(req.url()); };
        page.on('request', onReq);

        await page.goto(`${origin}/${locale}/experience-preview/e2b`, { waitUntil: 'networkidle', timeout: 20000 });
        await driveToState(page, state);
        const label = `${v.name} ${locale} ${state}`;

        const audit = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          bodyText: document.body.innerText,
          brokenImages: [...document.querySelectorAll('img')].filter((img) => img.complete && img.naturalWidth === 0).length,
          bannerCount: document.querySelectorAll('.e2b-preview-banner').length,
          topbarCount: document.querySelectorAll('header.site-header').length,
          workspaceCount: document.querySelectorAll('.e2b-preview-workspace').length,
          accountabilityCount: document.querySelectorAll('.e2b-accountability').length
        }));

        check(`${label} zero overflow`, audit.overflow <= 0, `overflow=${audit.overflow}`);
        check(`${label} zero broken images`, audit.brokenImages === 0);
        check(`${label} preview banner exactly once`, audit.bannerCount === 1);
        check(`${label} no marketing chrome`, audit.topbarCount === 0);
        check(`${label} exactly one workspace`, audit.workspaceCount === 1);
        check(`${label} no forbidden text`, !forbiddenText.test(audit.bodyText));
        if (state === 'journey-built' || state === 'direction-changed' || state === 'edit-applied') {
          check(`${label} authority disclaimer present`, audit.accountabilityCount === 1);
        }
        const devNoise = /webpack-hmr|WebSocket connection/i;
        const realErrors = runtimeErrors.filter((m) => !devNoise.test(m));
        check(`${label} zero page/console errors`, realErrors.length === 0, JSON.stringify(realErrors));
        check(`${label} zero non-GET requests`, requests.length === 0, JSON.stringify(requests));

        page.off('request', onReq);
        checked++;
      }
    }
  }

  console.log(`E2B BROWSER CERT: ${checked} combinations checked, ${pass} assertions passed, ${fail} failed.`);
  if (findings.length > 0) console.error('FAILURES:\n' + findings.slice(0, 30).join('\n'));
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}

process.exitCode = fail > 0 ? 1 : 0;
