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

const port = process.env.E2B_INTERACTION_PORT || '3000';
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

let pass = 0, fail = 0;
function check(name, cond, extra) { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra ?? ''); } }

let browser;
try {
  await waitReady();
  browser = await chromium.launch({ headless: true, ...(await resolveChromium()) });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const requests = [];
  page.on('request', (req) => { if (req.url().includes(origin) && req.method() !== 'GET') requests.push(req.url()); });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/en/experience-preview/e2b`, { waitUntil: 'networkidle' });

  await page.fill('.e2b-text-input', "I'm planning a trip from Baku to Istanbul.");
  await page.click('button:has-text("Send")');
  await page.waitForTimeout(150);
  check('real text input produces a new conversation turn', (await page.locator('.e2b-turn').count()) >= 3);

  const missingFieldQuestion = await page.locator('.e2b-turn-voyara').last().textContent();
  check('VOYARA asks about the next missing field (nights)', /night/i.test(missingFieldQuestion || ''));

  const briefTextBefore = await page.locator('.e2b-brief').textContent();
  check('nights not yet claimed complete before being provided', (briefTextBefore || '').includes('Not provided yet'));

  await page.fill('.e2b-text-input', '5 nights, 2 adults, in September.');
  await page.click('button:has-text("Send")');
  await page.waitForTimeout(150);
  const briefTextAfterNights = await page.locator('.e2b-brief').textContent();
  check('nights/travelers populated after being provided', (briefTextAfterNights || '').includes('5') && (briefTextAfterNights || '').includes('2'));

  await page.fill('.e2b-text-input', 'Budget is 3000 AZN, I love culture and food, relaxed pace.');
  await page.click('button:has-text("Send")');
  await page.waitForTimeout(150);
  check('build button appears once all required fields exist', (await page.locator('button:has-text("Build my journey")').count()) === 1);
  await page.click('button:has-text("Build my journey")');
  await page.waitForTimeout(200);

  await page.fill('#e2b-correction', 'Actually, make it 6 nights and increase the budget to 3,500 AZN.');
  await page.click('button:has-text("Apply correction")');
  await page.waitForTimeout(150);
  const briefAfterCorrection = await page.locator('.e2b-brief').textContent();
  check('correction actually updates nights to 6', (briefAfterCorrection || '').includes('6'));
  check('correction actually updates budget to 3,500', /3,?500/.test(briefAfterCorrection || ''));

  const itineraryBefore = await page.locator('.e2b-itinerary').textContent();
  await page.click('.e2b-inspiration-card:has-text("Istanbul Through Food") button:has-text("Use this direction")');
  await page.waitForTimeout(150);
  const itineraryAfterFood = await page.locator('.e2b-itinerary').textContent();
  check('selecting Istanbul Through Food genuinely changes the itinerary', itineraryBefore !== itineraryAfterFood);
  check('food direction mentions market/cooking/meyhane', /market|cooking|meyhane/i.test(itineraryAfterFood || ''));
  check('how-this-direction-changed summary is shown', (await page.locator('.e2b-direction-summary').count()) === 1);

  await page.click('.e2b-compare-card:has-text("Premium Comfort") button:has-text("Select this direction")');
  await page.waitForTimeout(150);
  const canvasCardsText = await page.locator('.e2b-canvas-cards').textContent();
  check('selecting Premium Comfort updates the hotel candidate to 5 star', /5 star/i.test(canvasCardsText || ''));

  await page.click('.e2b-edit-panel button:has-text("Apply this change")');
  await page.waitForTimeout(150);
  const whatChanged = await page.locator('.e2b-edit-panel .e2b-what-changed').textContent();
  check('day-3 edit shows a real what-changed summary', /relaxed|Bosphorus/i.test(whatChanged || ''));

  // The original/revised toggle only governs the day-3 edit; once an
  // Inspiration direction is active it intentionally takes precedence
  // over that toggle (selecting a new direction supersedes the earlier
  // point edit). So this proves the toggle in true isolation, using a
  // fresh page load with no direction selected.
  await page.goto(`${origin}/en/experience-preview/e2b`, { waitUntil: 'networkidle' });
  await page.fill('.e2b-text-input', 'Istanbul, 5 nights, 2 adults, September, budget 3000 AZN, culture and food, relaxed.');
  await page.click('button:has-text("Send")');
  await page.waitForTimeout(150);
  await page.click('button:has-text("Build my journey")');
  await page.waitForTimeout(150);
  await page.click('.e2b-edit-panel button:has-text("Apply this change")');
  await page.waitForTimeout(150);
  const itineraryRevised = await page.locator('.e2b-itinerary').textContent();
  await page.click('.e2b-edit-panel button:has-text("Show original")');
  await page.waitForTimeout(100);
  const itineraryOriginalAgain = await page.locator('.e2b-itinerary').textContent();
  check('original/revised toggle actually switches the displayed itinerary (isolated from Inspiration)', itineraryOriginalAgain !== itineraryRevised);

  for (const w of [320, 390, 1024, 1440]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(80);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`zero horizontal overflow at ${w}px`, overflow <= 0, `overflow=${overflow}px`);
  }

  check('zero non-GET network requests during the entire interactive session', requests.length === 0, JSON.stringify(requests));
  check('zero page errors', errors.length === 0, JSON.stringify(errors));

  console.log(`\n${pass} passed, ${fail} failed`);
} catch (error) {
  console.error('E2B INTERACTION TEST FAIL:', error.message);
  fail++;
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}

process.exitCode = fail > 0 ? 1 : 0;
