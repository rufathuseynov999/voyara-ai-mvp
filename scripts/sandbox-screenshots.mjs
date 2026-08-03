// Phase 3B Part 5 — final UI captures. Server must already be running with the
// sandbox env (see sandbox-seed-quotes.mjs invocation for setup). Reuses the
// four quotes seeded by sandbox-seed-quotes.mjs; all actions taken here are
// read-only or idempotent-safe so the same seed data can be reused across
// every locale/viewport without mutation conflicts.
import { chromium as pw } from 'playwright-core';
import { globSync, readFileSync, mkdirSync } from 'node:fs';

const exe = globSync('/opt/pw-browsers/chromium-*/chrome-linux/chrome')[0];
const cookies = JSON.parse(readFileSync('/tmp/cookies.json', 'utf8'));
const seed = JSON.parse(readFileSync('/tmp/seed-quotes.json', 'utf8'));
const BASE = 'http://localhost:3000';
const OUT = '/tmp/shots';
mkdirSync(OUT, { recursive: true });

const LOCALES = ['az', 'ru', 'en'];
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };

const browser = await pw.launch({ executablePath: exe, headless: true });

async function ctxFor(user, viewport) {
  const ctx = await browser.newContext({ viewport, baseURL: BASE });
  if (user) await ctx.addCookies(cookies[user].map((c) => ({ name: c.name, value: c.value, domain: 'localhost', path: '/' })));
  return ctx;
}

async function openAndSettle(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForTimeout(1200);
}

async function shoot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

const results = [];

for (const viewportName of Object.keys(VIEWPORTS)) {
  const viewport = VIEWPORTS[viewportName];
  for (const locale of LOCALES) {
    const tag = `${locale}-${viewportName}`;

    // 1. Landing — public, no auth needed.
    {
      const ctx = await ctxFor(null, viewport);
      const page = await ctx.newPage();
      await openAndSettle(page, `/${locale}`);
      await shoot(page, `${tag}-01-landing`);
      await ctx.close();
    }

    // 2. Trip Wizard — customer A, live search creates a fresh quote (safe to repeat).
    {
      const ctx = await ctxFor('CUSTA', viewport);
      const page = await ctx.newPage();
      await openAndSettle(page, `/${locale}/trip-wizard`);
      await page.locator('.orch-console .orch-actions button').nth(0).click();
      await page.waitForTimeout(1500);
      await shoot(page, `${tag}-02-wizard`);
      await ctx.close();
    }

    // 3. Proposal — customer A, Q_ACCEPTED via read-only "load status".
    {
      const ctx = await ctxFor('CUSTA', viewport);
      const page = await ctx.newPage();
      await openAndSettle(page, `/${locale}/proposal`);
      await page.locator('.orch-console .orch-field input').first().fill(seed.qAccepted);
      await page.locator('.orch-console .orch-actions button').nth(0).click(); // loadStatus
      await page.waitForTimeout(1200);
      await shoot(page, `${tag}-03-proposal`);
      await ctx.close();
    }

    // 4. Approvals — founder, Q_APPROVED via read-only "load status".
    {
      const ctx = await ctxFor('FOUNDER', viewport);
      const page = await ctx.newPage();
      await openAndSettle(page, `/${locale}/staff/approvals`);
      await page.locator('.orch-console .orch-field input').first().fill(seed.qApproved);
      await page.locator('.orch-console .orch-actions button').nth(0).click(); // loadStatus
      await page.waitForTimeout(1200);
      await shoot(page, `${tag}-04-approvals`);
      await ctx.close();
    }

    // 5. Payment — customer A (route is customer-only); neutral console view
    // with the quote id filled. Payment orchestration itself is staff-only and
    // is exercised via the authenticated route (see Part 4 authflow, 31/31
    // PASS) and surfaced read-side on CRM below.
    {
      const ctx = await ctxFor('CUSTA', viewport);
      const page = await ctx.newPage();
      await openAndSettle(page, `/${locale}/payment`);
      await page.locator('.orch-console .orch-field input').first().fill(seed.qVerified);
      await page.waitForTimeout(600);
      await shoot(page, `${tag}-05-payment`);
      await ctx.close();
    }

    // 6. Trip Room — customer A, Q_VERIFIED; voucher check (UI always sends
    // bookingConfirmed=false, so this truthfully shows the blocked state even
    // though the backend quote is fully verified and booking-prepared).
    {
      const ctx = await ctxFor('CUSTA', viewport);
      const page = await ctx.newPage();
      await openAndSettle(page, `/${locale}/trip-room`);
      await page.locator('.orch-console .orch-field input').first().fill(seed.qVerified);
      await page.locator('.orch-console .orch-actions button').nth(1).click(); // checkVoucher
      await page.waitForTimeout(1200);
      await shoot(page, `${tag}-06-triproom`);
      await ctx.close();
    }

    // 7. CRM — founder, Q_MISMATCH via read-only "load status" (shows
    // detected != verified and the PARTIAL reconciliation block).
    {
      const ctx = await ctxFor('FOUNDER', viewport);
      const page = await ctx.newPage();
      await openAndSettle(page, `/${locale}/staff/crm`);
      await page.locator('.orch-console .orch-field input').first().fill(seed.qMismatch);
      await page.locator('.orch-console .orch-actions button').nth(0).click(); // loadStatus
      await page.waitForTimeout(1200);
      await shoot(page, `${tag}-07-crm`);
      await ctx.close();
    }

    // 8. Founder Command Center — founder, adapter health (read-only).
    {
      const ctx = await ctxFor('FOUNDER', viewport);
      const page = await ctx.newPage();
      await openAndSettle(page, `/${locale}/staff/founder`);
      await page.locator('.orch-console .orch-actions button').nth(0).click(); // loadHealth
      await page.waitForTimeout(1200);
      await shoot(page, `${tag}-08-founder`);
      await ctx.close();
    }

    results.push(tag);
    console.log('captured', tag);
  }
}

await browser.close();
console.log('DONE', results.length, 'locale/viewport sets x 8 screens');
