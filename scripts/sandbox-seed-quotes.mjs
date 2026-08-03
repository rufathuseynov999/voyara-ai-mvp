// Phase 3B Part 5 — seed quotes for screenshot capture (API-only, fast,
// locale-independent). Writes /tmp/seed-quotes.json with the four quote ids.
// Synthetic sandbox accounts only.
import { chromium as pw } from 'playwright-core';
import { globSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const exe = globSync('/opt/pw-browsers/chromium-*/chrome-linux/chrome')[0];
const cookies = JSON.parse(readFileSync('/tmp/cookies.json', 'utf8'));
const BASE = 'http://localhost:3000';

const browser = await pw.launch({ executablePath: exe, headless: true });
async function ctxFor(user) {
  const ctx = await browser.newContext({ baseURL: BASE });
  await ctx.addCookies(cookies[user].map((c) => ({ name: c.name, value: c.value, domain: 'localhost', path: '/' })));
  return ctx;
}
async function api(ctx, method, pathOrBody, body) {
  const headers = { Origin: BASE, 'Content-Type': 'application/json', 'Idempotency-Key': `seed-${randomUUID()}`, 'x-correlation-id': randomUUID() };
  const r = method === 'GET'
    ? await ctx.request.get(`${BASE}/api/v1/orchestration?${pathOrBody}`, { headers })
    : await ctx.request.post(`${BASE}/api/v1/orchestration`, { headers, data: body ?? pathOrBody });
  let json = {};
  try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status(), json };
}

const A = await ctxFor('CUSTA');
const F = await ctxFor('FOUNDER');
const search = (destination) => ({ command: 'SEARCH_AND_CREATE_QUOTE', destination, checkIn: '2026-08-12', checkOut: '2026-08-19', occupancy: { adults: 2, children: 0, rooms: 1 }, currency: 'AZN' });

async function toApproved(destination) {
  const created = await api(A, 'POST', search(destination));
  const quoteId = created.json.quoteId;
  await api(F, 'POST', { command: 'SUBMIT_FOR_REVIEW', quoteId });
  const status = await api(F, 'GET', `view=quoteStatus&quoteId=${quoteId}`);
  await api(F, 'POST', { command: 'APPROVE_QUOTE', quoteId, expectedContentHash: status.json.contentHash });
  await api(F, 'POST', { command: 'PRESENT_QUOTE', quoteId });
  return quoteId;
}

// Q_APPROVED: submitted, approved, presented — stops before customer acceptance
// (Approvals screen evidence).
const qApproved = await toApproved('Gabala');

// Q_ACCEPTED: approved, presented, customer-accepted (Proposal screen evidence).
const qAcceptedId = await toApproved('Shahdag');
await api(A, 'POST', { command: 'ACCEPT_QUOTE', quoteId: qAcceptedId });

// Q_VERIFIED: full chain to PAYMENT_VERIFIED + booking prepared
// (Trip Room / backend evidence for the verified path).
const qVerifiedId = await toApproved('Maldives');
await api(A, 'POST', { command: 'ACCEPT_QUOTE', quoteId: qVerifiedId });
await api(F, 'POST', { command: 'PREPARE_PAYMENT_INTENT', quoteId: qVerifiedId });
await api(F, 'POST', { command: 'SIMULATE_WEBHOOK', quoteId: qVerifiedId });
const recon = await api(F, 'POST', { command: 'RECONCILE_SIMULATED', quoteId: qVerifiedId, scenario: 'EXACT' });
await api(F, 'POST', {
  command: 'PREPARE_BOOKING', quoteId: qVerifiedId,
  travellers: [{ fullName: 'Sandbox Traveller', isLead: true }],
  rooming: [{ roomIndex: 1, travellerNames: ['Sandbox Traveller'] }],
  specialRequests: '', hagApprovalReference: randomUUID()
});

// Q_MISMATCH: full chain to PAYMENT_MISMATCH (CRM screen evidence).
const qMismatchId = await toApproved('Dubai');
await api(A, 'POST', { command: 'ACCEPT_QUOTE', quoteId: qMismatchId });
await api(F, 'POST', { command: 'PREPARE_PAYMENT_INTENT', quoteId: qMismatchId });
await api(F, 'POST', { command: 'SIMULATE_WEBHOOK', quoteId: qMismatchId });
const partial = await api(F, 'POST', { command: 'RECONCILE_SIMULATED', quoteId: qMismatchId, scenario: 'PARTIAL' });

const seed = {
  qApproved,
  qAccepted: qAcceptedId,
  qVerified: qVerifiedId,
  qMismatch: qMismatchId,
  verifiedRecon: recon.json,
  mismatchRecon: partial.json
};
writeFileSync('/tmp/seed-quotes.json', JSON.stringify(seed, null, 1));
console.log(JSON.stringify(seed, null, 1));
await browser.close();
