import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { existsSync, globSync, mkdirSync } from 'node:fs';

/**
 * E.2A internal-preview browser certification.
 *
 * Starts the REAL production server (next build already run separately;
 * this spawns `node scripts/start-standalone.mjs`, the same script
 * production certification uses), with VOYARA_INTERNAL_PREVIEW_ENABLED=true
 * ONLY for that child process — never exported to the parent shell. Always
 * terminates the server in `finally`.
 */

async function resolveChromium() {
  const candidates = [
    ...globSync('/opt/pw-browsers/chromium-*/chrome-linux/chrome'),
    ...globSync(`${process.env.HOME || ''}/.cache/ms-playwright/chromium-*/chrome-linux/chrome`)
  ];
  const managed = candidates.find((c) => existsSync(c));
  return managed ? { executablePath: managed } : {};
}

const port = process.env.E2A_PREVIEW_CERT_PORT || '3000';
const origin = `http://127.0.0.1:${port}`;
const server = spawn('node', ['scripts/start-standalone.mjs'], {
  env: { ...process.env, VOYARA_INTERNAL_PREVIEW_ENABLED: 'true', PORT: port },
  stdio: ['ignore', 'pipe', 'pipe']
});
let serverOutput = '';
server.stdout.on('data', (c) => { serverOutput += c.toString(); });
server.stderr.on('data', (c) => { serverOutput += c.toString(); });

async function waitReady() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`server exited early:\n${serverOutput}`);
    try { const r = await fetch(`${origin}/az`); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`server not ready:\n${serverOutput}`);
}

const viewports = [
  { name: '320', width: 320, height: 900 },
  { name: '390', width: 390, height: 900 },
  { name: '1024', width: 1024, height: 900 },
  { name: '1440', width: 1440, height: 1000 }
];
const locales = ['az', 'ru', 'en'];
const states = ['waiting', 'ready', 'denied', 'converted'];

// Full target matrix is 4 viewports x 3 locales x 4 states = 48. Sliced via
// E2A_CERT_SLICE across invocations to fit this sandbox's per-call wall-
// clock budget (established constraint throughout this project); each
// slice is a real, independently-run subset, not a claim of 48 in one go.
const SLICES = {
  v320: viewports.filter((v) => v.name === '320').flatMap((v) => locales.flatMap((l) => states.map((s) => ({ v, l, s })))),
  v390: viewports.filter((v) => v.name === '390').flatMap((v) => locales.flatMap((l) => states.map((s) => ({ v, l, s })))),
  v1024: viewports.filter((v) => v.name === '1024').flatMap((v) => locales.flatMap((l) => states.map((s) => ({ v, l, s })))),
  v1440: viewports.filter((v) => v.name === '1440').flatMap((v) => locales.flatMap((l) => states.map((s) => ({ v, l, s })))),
  all: viewports.flatMap((v) => locales.flatMap((l) => states.map((s) => ({ v, l, s }))))
};
const sliceName = process.env.E2A_CERT_SLICE || 'all';
const combinations = SLICES[sliceName];
if (!combinations) throw new Error(`unknown slice ${sliceName}`);

const forbiddenText = /undefined|\[object Object\]|inbox\.[a-zA-Z]+|ACKNOWLEDGEMENT_BEFORE_CONFIRMATION|STALE_ACKNOWLEDGEMENT_EVIDENCE|CONVERSATION_NOT_WHATSAPP|MISSING_BRAND|UNLINKED_CONTACT/;

mkdirSync('outputs/e2a-whatsapp-visual-preview', { recursive: true });

let browser;
const findings = [];
let checked = 0;
try {
  await waitReady();
  browser = await chromium.launch({ headless: true, ...(await resolveChromium()) });
  const page = await browser.newPage();
  const runtimeErrors = [];
  page.on('pageerror', (e) => runtimeErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') runtimeErrors.push(m.text()); });

  let lastViewport = null;
  for (const { v, l, s } of combinations) {
    if (v !== lastViewport) { await page.setViewportSize({ width: v.width, height: v.height }); lastViewport = v; }
    runtimeErrors.length = 0;
    const url = `${origin}/${l}/internal-preview/e2a-whatsapp/${s}`;
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 20_000 });
    assert.equal(response?.status(), 200, `${v.name} ${l} ${s} status`);
    assert.equal(await page.locator('html').getAttribute('lang'), l, `${v.name} ${l} ${s} lang attr`);

    const audit = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      bodyText: document.body.innerText,
      brokenImages: [...document.querySelectorAll('img')].filter((img) => img.complete && img.naturalWidth === 0).length,
      topbarCount: document.querySelectorAll('header.site-header, .exp-topbar').length,
      footerCount: document.querySelectorAll('.site-footer').length,
      chatWidgetCount: document.querySelectorAll('.website-chat-widget').length,
      shellCount: document.querySelectorAll('.crm-inbox.e2a-preview-shell').length
    }));

    assert.ok(audit.overflow <= 2, `${v.name} ${l} ${s} horizontal overflow ${audit.overflow}px`);
    assert.equal(audit.brokenImages, 0, `${v.name} ${l} ${s} broken images`);
    assert.equal(audit.topbarCount, 0, `${v.name} ${l} ${s} no marketing header on internal-preview`);
    assert.equal(audit.footerCount, 0, `${v.name} ${l} ${s} no marketing footer on internal-preview`);
    assert.equal(audit.chatWidgetCount, 0, `${v.name} ${l} ${s} no chat widget on internal-preview`);
    assert.equal(audit.shellCount, 1, `${v.name} ${l} ${s} exactly one preview shell (no duplicate)`);
    assert.ok(!forbiddenText.test(audit.bodyText), `${v.name} ${l} ${s} no raw dictionary keys/RPC reason codes`);
    const devNoise = /webpack-hmr|WebSocket connection/i;
    const realErrors = runtimeErrors.filter((m) => !devNoise.test(m));
    assert.deepEqual(realErrors, [], `${v.name} ${l} ${s} console/page errors`);

    // State-specific honesty checks
    if (s === 'waiting') {
      const ackDisabled = await page.locator('.inbox-conversion-form select').nth(1).isDisabled();
      assert.equal(ackDisabled, true, `${v.name} ${l} waiting: acknowledgement select must be disabled (no candidates)`);
    }
    if (s === 'converted') {
      const formVisible = await page.locator('.inbox-conversion-form').count();
      assert.equal(formVisible, 0, `${v.name} ${l} converted: form must be replaced by the completed state, not still shown`);
    }
    if (s === 'denied') {
      const deniedBox = await page.locator('.inbox-conversion-denied').count();
      assert.equal(deniedBox, 1, `${v.name} ${l} denied: a denial message must be shown`);
    }

    checked++;
  }

  console.log(`E2A PREVIEW CERT PASS (slice "${sliceName}"): ${checked} combinations checked.`);
} catch (error) {
  findings.push(error instanceof Error ? error.message : String(error));
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}

if (findings.length > 0) {
  console.error('E2A PREVIEW CERT FAIL:\n' + findings.join('\n'));
  process.exitCode = 1;
}
