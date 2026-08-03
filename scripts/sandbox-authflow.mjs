// Phase 3B Part 4 — authenticated end-to-end flow against the production
// server, real PostgreSQL (via PostgREST) and real session cookies.
// Synthetic sandbox accounts only; everything simulation-labelled.
import { chromium as pw } from 'playwright-core';
import { globSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const exe = globSync('/opt/pw-browsers/chromium-*/chrome-linux/chrome')[0];
const cookies = JSON.parse(readFileSync('/tmp/cookies.json', 'utf8'));
const BASE = 'http://localhost:3000';
const out = { steps: [], consoleErrors: [], pageErrors: [], csp: 0 };
const ok = (name, cond, extra = '') => { out.steps.push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' ' + extra : ''}`); if (!cond) out.failed = true; };

const browser = await pw.launch({ executablePath: exe, headless: true });

function wire(page) {
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (m.text().includes('Refused to apply')) { out.csp += 1; return; }
    // Expected negative-path responses (404 cross-customer, 409 stale hash)
    // are asserted explicitly; the browser's resource log for them is not an
    // application error.
    if (/Failed to load resource:.*(404|409)/.test(m.text())) return;
    out.consoleErrors.push(m.text().slice(0, 160));
  });
  page.on('pageerror', (e) => out.pageErrors.push(String(e).slice(0, 160)));
}

async function ctxFor(user, viewport = { width: 1440, height: 1000 }) {
  const ctx = await browser.newContext({ viewport, baseURL: BASE });
  await ctx.addCookies(cookies[user].map((c) => ({ name: c.name, value: c.value, domain: 'localhost', path: '/' })));
  return ctx;
}

async function api(ctx, method, pathOrBody, body) {
  const headers = { Origin: BASE, 'Content-Type': 'application/json', 'Idempotency-Key': `flow-${randomUUID()}`, 'x-correlation-id': randomUUID() };
  const r = method === 'GET'
    ? await ctx.request.get(`${BASE}/api/v1/orchestration?${pathOrBody}`, { headers })
    : await ctx.request.post(`${BASE}/api/v1/orchestration`, { headers, data: body ?? pathOrBody });
  let json = {};
  try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status(), json };
}

async function open(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForTimeout(1400); // hydration settle
}

async function clickAndWait(page, buttonText, expectSubstring) {
  await page.locator(`.orch-console button:has-text("${buttonText}")`).first().click();
  await page.waitForFunction(
    (needle) => document.querySelector('.orch-console')?.innerText.includes(needle),
    expectSubstring,
    { timeout: 20000 }
  );
}

const A = await ctxFor('CUSTA');
const B = await ctxFor('CUSTB');
const F = await ctxFor('FOUNDER');
const pa = await A.newPage(); wire(pa);
const pf = await F.newPage(); wire(pf);
const pb = await B.newPage(); wire(pb);

let lastConsoleText = '';
try {
/* 1. Customer A: wizard search via UI -> quote created */
let quote1 = null;
let quote1Resolve;
const quote1Ready = new Promise((resolve) => { quote1Resolve = resolve; });
pa.on('response', async (r) => {
  if (r.url().includes('/api/v1/orchestration') && r.request().method() === 'POST' && !quote1) {
    try { const j = await r.json(); if (j.quoteId) { quote1 = j.quoteId; quote1Resolve(); } } catch { /* ignore */ }
  }
});
await open(pa, '/az/trip-wizard');
await clickAndWait(pa, 'Axtar və sitat yarat', 'Uğurlu');
await Promise.race([quote1Ready, new Promise((r) => setTimeout(r, 5000))]);
ok('wizard->quote via UI (customer A authenticated)', Boolean(quote1), quote1 ?? '');

/* 2. Founder: submit -> load status (hash) -> approve -> present via UI */
await open(pf, '/az/staff/approvals');
await pf.locator('.orch-console .orch-field input').first().fill(quote1);
await clickAndWait(pf, 'Təsdiqə göndər', 'Uğurlu');
const st1 = await api(F, 'GET', `view=quoteStatus&quoteId=${quote1}`);
ok('status readable by AAL2 founder', st1.status === 200 && Boolean(st1.json.contentHash));
await pf.locator('.orch-console .orch-field input').nth(1).fill(st1.json.contentHash);
await clickAndWait(pf, 'Təsdiqlə (hash ilə)', 'Uğurlu');
await clickAndWait(pf, 'Müştəriyə təqdim et', 'Uğurlu');
ok('submit->approve(exact hash)->present via UI', true);

/* 3. Customer A accepts via UI on Proposal */
await open(pa, '/az/proposal');
await pa.locator('.orch-console .orch-field input').first().fill(quote1);
await clickAndWait(pa, 'Qəbul et', 'Uğurlu');
ok('customer acceptance via UI', true);

/* 4. Founder: intent + simulated signed webhook via UI; detected != verified */
await open(pf, '/az/payment');
const gate = await pf.locator('.orch-console').count();
if (gate === 0) {
  // Payment lives in the customer area; founder executes payment commands via
  // the authenticated route (same authority path), UI states verified on CRM.
  const intent = await api(F, 'POST', { command: 'PREPARE_PAYMENT_INTENT', quoteId: quote1 });
  ok('payment intent via authenticated route', intent.status === 200);
  const wh = await api(F, 'POST', { command: 'SIMULATE_WEBHOOK', quoteId: quote1 });
  ok('simulated signed webhook accepted', wh.status === 200);
} else {
  await pf.locator('.orch-console .orch-field input').first().fill(quote1);
  await clickAndWait(pf, 'Ödəniş niyyəti hazırla', 'Uğurlu');
  await clickAndWait(pf, 'Webhook simulyasiya et', 'Uğurlu');
  ok('payment intent + simulated webhook via UI', true);
}
await open(pf, '/az/staff/crm');
await pf.locator('.orch-console .orch-field input').first().fill(quote1);
await clickAndWait(pf, 'Statusu yüklə', 'PAYMENT_DETECTED');
const crmText1 = await pf.locator('.orch-console').innerText();
ok('UI shows detected separate from verified', crmText1.includes('DETECTED') && crmText1.includes('UNVERIFIED'));

/* 5. Exact reconciliation -> verified; booking prep; voucher */
const rec = await api(F, 'POST', { command: 'RECONCILE_SIMULATED', quoteId: quote1, scenario: 'EXACT' });
ok('exact reconciliation verifies', rec.status === 200 && rec.json.verified === true);
await clickAndWait(pf, 'Statusu yüklə', 'PAYMENT_VERIFIED');
const crmText2 = await pf.locator('.orch-console').innerText();
ok('UI shows verification after exact match', crmText2.includes('VERIFIED'));
const prep = await api(F, 'POST', {
  command: 'PREPARE_BOOKING', quoteId: quote1,
  travellers: [{ fullName: 'Sandbox Traveller', isLead: true }],
  rooming: [{ roomIndex: 1, travellerNames: ['Sandbox Traveller'] }],
  specialRequests: '', hagApprovalReference: randomUUID()
});
ok('booking preparation after verification', prep.status === 200);
const voucherBlocked = await api(F, 'POST', { command: 'CHECK_VOUCHER_ELIGIBILITY', quoteId: quote1, bookingConfirmed: false });
ok('voucher blocked before booking confirmation', voucherBlocked.json.eligible === false);
const voucherOk = await api(F, 'POST', { command: 'CHECK_VOUCHER_ELIGIBILITY', quoteId: quote1, bookingConfirmed: true });
ok('voucher eligible only after full authority chain', voucherOk.json.eligible === true);
/* Customer-side voucher UI state on Trip Room */
await open(pa, '/az/trip-room');
await pa.locator('.orch-console .orch-field input').first().fill(quote1);
await clickAndWait(pa, 'Vauçeri yoxla', 'Vauçer bloklanıb');
ok('customer sees voucher-blocked UI state (bookingConfirmed=false)', true);

/* 6. Stale hash on a second quote — visible UI failure */
const q2resp = await api(A, 'POST', { command: 'SEARCH_AND_CREATE_QUOTE', destination: 'Maldives', checkIn: '2026-08-12', checkOut: '2026-08-19', occupancy: { adults: 2, children: 0, rooms: 1 }, currency: 'AZN' });
const quote2 = q2resp.json.quoteId;
await api(F, 'POST', { command: 'SUBMIT_FOR_REVIEW', quoteId: quote2 });
await open(pf, '/az/staff/approvals');
await pf.locator('.orch-console .orch-field input').first().fill(quote2);
await pf.locator('.orch-console .orch-field input').nth(1).fill('f'.repeat(64));
await clickAndWait(pf, 'Təsdiqlə (hash ilə)', 'Köhnəlmiş hash');
ok('stale hash fails visibly in UI (409)', true);

/* 7. Approve quote2 with the exact hash, then verify revalidation/reapproval
      authority on a dedicated quote so the mismatch chain stays intact */
const st2 = await api(F, 'GET', `view=quoteStatus&quoteId=${quote2}`);
const approve2 = await api(F, 'POST', { command: 'APPROVE_QUOTE', quoteId: quote2, expectedContentHash: st2.json.contentHash });
ok('quote2 approved with exact hash', approve2.status === 200);
const q2b = await api(A, 'POST', { command: 'SEARCH_AND_CREATE_QUOTE', destination: 'Dubai', checkIn: '2026-09-10', checkOut: '2026-09-14', occupancy: { adults: 2, children: 1, rooms: 1 }, currency: 'AZN' });
const quote2b = q2b.json.quoteId;
await api(F, 'POST', { command: 'SUBMIT_FOR_REVIEW', quoteId: quote2b });
const st2b = await api(F, 'GET', `view=quoteStatus&quoteId=${quote2b}`);
await api(F, 'POST', { command: 'APPROVE_QUOTE', quoteId: quote2b, expectedContentHash: st2b.json.contentHash });
const reval = await api(F, 'POST', { command: 'REVALIDATE', quoteId: quote2b });
ok('revalidation executes on live sandbox clock', reval.status === 200, `outcome=${reval.json.outcome}`);
if (['MATERIAL_CHANGE', 'PRICE_CHANGED'].includes(reval.json.outcome)) {
  const st2bAfter = await api(F, 'GET', `view=quoteStatus&quoteId=${quote2b}`);
  ok('material change invalidates approval (reapproval required)', st2bAfter.json.hasValidApproval === false);
}

/* 8. Partial mismatch blocks booking — visible UI mismatch */
const present2 = await api(F, 'POST', { command: 'PRESENT_QUOTE', quoteId: quote2 });
ok('quote2 presented', present2.status === 200);
const accept2 = await api(A, 'POST', { command: 'ACCEPT_QUOTE', quoteId: quote2 });
ok('quote2 accepted by owner', accept2.status === 200);
const intent2 = await api(F, 'POST', { command: 'PREPARE_PAYMENT_INTENT', quoteId: quote2 });
ok('quote2 intent prepared', intent2.status === 200);
const wh2 = await api(F, 'POST', { command: 'SIMULATE_WEBHOOK', quoteId: quote2 });
ok('quote2 webhook detected', wh2.status === 200);
const partial = await api(F, 'POST', { command: 'RECONCILE_SIMULATED', quoteId: quote2, scenario: 'PARTIAL' });
ok('partial reconciliation is not verified', partial.json.verified === false);
const prep2 = await api(F, 'POST', {
  command: 'PREPARE_BOOKING', quoteId: quote2,
  travellers: [{ fullName: 'T', isLead: true }], rooming: [{ roomIndex: 1, travellerNames: ['T'] }],
  specialRequests: '', hagApprovalReference: randomUUID()
});
ok('mismatch blocks booking preparation (409)', prep2.status === 409, `reason=${prep2.json.reasonCode}`);
await open(pf, '/az/staff/crm');
await pf.locator('.orch-console .orch-field input').first().fill(quote2);
await clickAndWait(pf, 'Statusu yüklə', 'PAYMENT_MISMATCH');
ok('UI shows payment mismatch state', true);

/* 9. Cross-customer access rejection — customer B sees empty authoritative state */
await open(pb, '/az/proposal');
await pb.locator('.orch-console .orch-field input').first().fill(quote1);
await clickAndWait(pb, 'Statusu yüklə', 'Səlahiyyətli məlumat yoxdur');
const bApi = await api(B, 'GET', `view=quoteStatus&quoteId=${quote1}`);
ok('cross-customer GET is 404 with empty UI state', bApi.status === 404);
const bAccept = await api(B, 'POST', { command: 'ACCEPT_QUOTE', quoteId: quote1 });
ok('cross-customer command rejected', bAccept.status === 404);

/* 10. Expired offer fails closed (authenticated route; sandbox clock forced past expiry) */
const q3resp = await api(A, 'POST', { command: 'SEARCH_AND_CREATE_QUOTE', destination: 'Baku', checkIn: '2026-09-01', checkOut: '2026-09-05', occupancy: { adults: 2, children: 0, rooms: 1 }, currency: 'AZN' });
const quote3 = q3resp.json.quoteId;
await api(F, 'POST', { command: 'SUBMIT_FOR_REVIEW', quoteId: quote3 });
const st3 = await api(F, 'GET', `view=quoteStatus&quoteId=${quote3}`);
const approve3 = await api(F, 'POST', { command: 'APPROVE_QUOTE', quoteId: quote3, expectedContentHash: st3.json.contentHash });
ok('quote3 approved before expiry test', approve3.status === 200);
const upd = execSync(`su postgres -c "psql -d voyara_sandbox -tA -c \\"update quotes set expires_at = now() - interval '1 hour' where id = '${quote3}'; select count(*) from quotes where id='${quote3}' and expires_at < now();\\""`).toString().trim();
const revalExpired = await api(F, 'POST', { command: 'REVALIDATE', quoteId: quote3 });
ok('expired offer detected on revalidation', revalExpired.status === 200 && revalExpired.json.outcome === 'EXPIRED', `updated=${upd} outcome=${revalExpired.json.outcome}`);

/* 11. Language preservation with authenticated session */
await open(pf, '/az/staff/approvals');
await pf.locator('.locale-switcher a[hreflang="ru"]').click();
await pf.waitForURL('**/ru/staff/approvals', { timeout: 20000 });
ok('language switch preserves authenticated route', pf.url().includes('/ru/staff/approvals'));

/* 12. 390px overflow with consoles mounted (authenticated) */
const AM = await ctxFor('CUSTA', { width: 390, height: 844 });
const pm = await AM.newPage(); wire(pm);
for (const path of ['/az/trip-wizard', '/az/proposal', '/az/trip-room']) {
  await open(pm, path);
  const over = await pm.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  ok(`390px no overflow ${path}`, !over);
}

/* 13. Simulation label present on operational screens */
const simText = await pa.locator('body').innerText();
ok('simulation banner present', simText.includes('Demo simulyasiya') || simText.includes('Demo simulation'));

} catch (error) {
  out.failed = true;
  out.crash = String(error).slice(0, 300);
  try { lastConsoleText = await pf.locator('.orch-console').innerText().catch(() => ''); } catch { /* ignore */ }
  out.lastConsoleText = lastConsoleText.slice(0, 400);
}
out.consoleErrorCount = out.consoleErrors.length;
out.pageErrorCount = out.pageErrors.length;
console.log(JSON.stringify(out, null, 1));
await browser.close();
process.exit(out.failed ? 1 : 0);
