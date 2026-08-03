import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { InMemoryQuoteStore } from '@/server/supplier/in-memory-quote-store';
import { SimulationSupplierAdapter } from '@/server/supplier/simulation-adapter';
import { SimulationPaymentAdapter } from '@/server/payment/simulation-payment-adapter';
import {
  executeOrchestrationCommand,
  executeOrchestrationQuery,
  type OrchestrationDeps,
  type OrchestrationViewer
} from '@/server/supplier/orchestration-service';

const FIXED = new Date('2026-07-20T09:00:00.000Z');
const SECRET = 'w'.repeat(40);

function deps(): OrchestrationDeps & { store: InMemoryQuoteStore } {
  return {
    store: new InMemoryQuoteStore(),
    supplier: new SimulationSupplierAdapter(),
    payment: new SimulationPaymentAdapter(),
    webhookSecret: SECRET,
    now: () => FIXED
  };
}

const customer = (id = randomUUID()): OrchestrationViewer =>
  ({ id, roles: ['customer'], source: 'supabase', assuranceLevel: 'aal1' });
const staff = (id = randomUUID()): OrchestrationViewer =>
  ({ id, roles: ['founder'], source: 'supabase', assuranceLevel: 'aal2' });
const demoViewer = (): OrchestrationViewer =>
  ({ id: randomUUID(), roles: ['founder'], source: 'demo', assuranceLevel: 'aal2' });

const searchCmd = {
  command: 'SEARCH_AND_CREATE_QUOTE',
  destination: 'Maldives',
  checkIn: '2026-08-12',
  checkOut: '2026-08-19',
  occupancy: { adults: 2, children: 0, rooms: 1 },
  currency: 'AZN'
};

async function run(viewer: OrchestrationViewer, input: unknown, d: OrchestrationDeps, key = randomUUID().slice(0, 24)) {
  return executeOrchestrationCommand({ viewer, idempotencyKey: `key-${key}`, input, deps: d });
}

/** Drive wizard→approved→presented→accepted→intent→webhook via the service. */
async function driveToDetected(d: ReturnType<typeof deps>, owner: OrchestrationViewer, approver: OrchestrationViewer) {
  const created = await run(owner, searchCmd, d);
  assert.equal(created.status, 200);
  const quoteId = created.body.quoteId as string;
  // Owner context created the quote under owner.id; staff commands run in the
  // approver's context but load via the staff boundary.
  const approverDeps = { ...d };
  await run(approver, { command: 'SUBMIT_FOR_REVIEW', quoteId }, approverDeps);
  const status = await executeOrchestrationQuery({ viewer: staffView(approver), input: { view: 'quoteStatus', quoteId }, deps: d });
  const hash = status.body.contentHash as string;
  const approved = await run(approver, { command: 'APPROVE_QUOTE', quoteId, expectedContentHash: hash }, d);
  assert.equal(approved.status, 200);
  await run(approver, { command: 'PRESENT_QUOTE', quoteId }, d);
  const accepted = await run(owner, { command: 'ACCEPT_QUOTE', quoteId }, d);
  assert.equal(accepted.status, 200);
  await run(approver, { command: 'PREPARE_PAYMENT_INTENT', quoteId }, d);
  const webhook = await run(approver, { command: 'SIMULATE_WEBHOOK', quoteId }, d);
  assert.equal(webhook.status, 200);
  return quoteId;
}

function staffView(viewer: OrchestrationViewer): OrchestrationViewer {
  return viewer;
}

test('e2e: wizard to quote via the service (session-derived customer)', async () => {
  const d = deps();
  const owner = customer();
  const result = await run(owner, searchCmd, d);
  assert.equal(result.status, 200);
  assert.match(result.body.quoteId as string, /[0-9a-f-]{36}/);
  assert.equal(result.body.simulation, 'Demo simulation — no live inventory or payment.');
});

test('e2e: approval to presentation requires the exact hash and staff AAL2', async () => {
  const d = deps();
  const owner = customer();
  const approver = staff();
  const created = await run(owner, searchCmd, d);
  const quoteId = created.body.quoteId as string;
  await run(approver, { command: 'SUBMIT_FOR_REVIEW', quoteId }, d);
  const status = await executeOrchestrationQuery({ viewer: approver, input: { view: 'quoteStatus', quoteId }, deps: d });
  const hash = status.body.contentHash as string;
  assert.equal((await run(approver, { command: 'APPROVE_QUOTE', quoteId, expectedContentHash: hash }, d)).status, 200);
  assert.equal((await run(approver, { command: 'PRESENT_QUOTE', quoteId }, d)).status, 200);
});

test('e2e: stale hash approval fails visibly with 409 STALE_APPROVAL_HASH', async () => {
  const d = deps();
  const owner = customer();
  const approver = staff();
  const created = await run(owner, searchCmd, d);
  const quoteId = created.body.quoteId as string;
  await run(approver, { command: 'SUBMIT_FOR_REVIEW', quoteId }, d);
  const stale = await run(approver, { command: 'APPROVE_QUOTE', quoteId, expectedContentHash: 'f'.repeat(64) }, d);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, 'STALE_APPROVAL_HASH');
});

test('e2e: payment detected remains separate from verified until exact reconciliation', async () => {
  const d = deps();
  const owner = customer();
  const approver = staff();
  const quoteId = await driveToDetected(d, owner, approver);

  const afterWebhook = await executeOrchestrationQuery({ viewer: approver, input: { view: 'quoteStatus', quoteId }, deps: d });
  assert.equal(afterWebhook.body.status, 'PAYMENT_DETECTED');
  const paymentAfterWebhook = afterWebhook.body.payment as Record<string, unknown>;
  assert.equal(paymentAfterWebhook.detectedStatus, 'DETECTED');
  assert.equal(paymentAfterWebhook.verifiedStatus, 'UNVERIFIED');

  const reconciled = await run(approver, { command: 'RECONCILE_SIMULATED', quoteId, scenario: 'EXACT' }, d);
  assert.equal(reconciled.body.verified, true);
  const afterRecon = await executeOrchestrationQuery({ viewer: approver, input: { view: 'quoteStatus', quoteId }, deps: d });
  assert.equal(afterRecon.body.status, 'PAYMENT_VERIFIED');
  assert.equal((afterRecon.body.payment as Record<string, unknown>).verifiedStatus, 'VERIFIED');
});

test('e2e: partial reconciliation mismatch blocks booking preparation', async () => {
  const d = deps();
  const owner = customer();
  const approver = staff();
  const quoteId = await driveToDetected(d, owner, approver);
  const partial = await run(approver, { command: 'RECONCILE_SIMULATED', quoteId, scenario: 'PARTIAL' }, d);
  assert.equal(partial.body.verified, false);

  const prep = await run(approver, {
    command: 'PREPARE_BOOKING', quoteId,
    travellers: [{ fullName: 'A', isLead: true }],
    rooming: [{ roomIndex: 1, travellerNames: ['A'] }],
    specialRequests: '', hagApprovalReference: randomUUID()
  }, d);
  assert.equal(prep.status, 409);
});

test('e2e: successful booking preparation after exact reconciliation', async () => {
  const d = deps();
  const owner = customer();
  const approver = staff();
  const quoteId = await driveToDetected(d, owner, approver);
  await run(approver, { command: 'RECONCILE_SIMULATED', quoteId, scenario: 'EXACT' }, d);
  const prep = await run(approver, {
    command: 'PREPARE_BOOKING', quoteId,
    travellers: [{ fullName: 'Aygun M', isLead: true }],
    rooming: [{ roomIndex: 1, travellerNames: ['Aygun M'] }],
    specialRequests: '', hagApprovalReference: randomUUID()
  }, d);
  assert.equal(prep.status, 200);
  assert.equal(d.store.countBookingPreparations(), 1);
});

test('e2e: voucher remains blocked before authority completion', async () => {
  const d = deps();
  const owner = customer();
  const approver = staff();
  const quoteId = await driveToDetected(d, owner, approver);
  // Even claiming bookingConfirmed=true, verification is missing → blocked.
  const early = await run(approver, { command: 'CHECK_VOUCHER_ELIGIBILITY', quoteId, bookingConfirmed: true }, d);
  assert.equal(early.body.eligible, false);
  await run(approver, { command: 'RECONCILE_SIMULATED', quoteId, scenario: 'EXACT' }, d);
  const withoutBooking = await run(approver, { command: 'CHECK_VOUCHER_ELIGIBILITY', quoteId, bookingConfirmed: false }, d);
  assert.equal(withoutBooking.body.eligible, false);
  const complete = await run(approver, { command: 'CHECK_VOUCHER_ELIGIBILITY', quoteId, bookingConfirmed: true }, d);
  assert.equal(complete.body.eligible, true);
});

test('e2e: cross-customer access is rejected via the service boundary', async () => {
  const d = deps();
  const owner = customer();
  const created = await run(owner, searchCmd, d);
  const quoteId = created.body.quoteId as string;
  const stranger = customer(); // different session-derived customer id
  const denied = await run(stranger, { command: 'ACCEPT_QUOTE', quoteId }, d);
  assert.equal(denied.status, 404);
  assert.equal(denied.body.error, 'QUOTE_ACCESS_DENIED');
});

test('authority: demo sessions, missing staff role and AAL1 staff are rejected', async () => {
  const d = deps();
  assert.equal((await run(demoViewer(), searchCmd, d)).body.error, 'AUTHORITATIVE_SESSION_REQUIRED');
  const owner = customer();
  const created = await run(owner, searchCmd, d);
  const quoteId = created.body.quoteId as string;
  const notStaff = await run(owner, { command: 'SUBMIT_FOR_REVIEW', quoteId }, d);
  assert.equal(notStaff.body.error, 'STAFF_ROLE_REQUIRED');
  const aal1Staff: OrchestrationViewer = { id: randomUUID(), roles: ['founder'], source: 'supabase', assuranceLevel: 'aal1' };
  const lowAssurance = await run(aal1Staff, { command: 'SUBMIT_FOR_REVIEW', quoteId }, d);
  assert.equal(lowAssurance.body.error, 'AAL2_REQUIRED');
});

test('founder health view reports adapter health and never invents exception counts', async () => {
  const d = deps();
  const result = await executeOrchestrationQuery({ viewer: staff(), input: { view: 'health' }, deps: d });
  assert.equal(result.status, 200);
  assert.equal((result.body.supplier as Record<string, unknown>).simulated, true);
  assert.equal(result.body.exceptionCounts, null);
  // Customers cannot read the health view.
  const deniedHealth = await executeOrchestrationQuery({ viewer: customer(), input: { view: 'health' }, deps: d });
  assert.equal(deniedHealth.status, 403);
});

test('UI console surfaces every required state and supplies no authority fields', async () => {
  const source = await readFile(
    new URL('../../src/components/orchestration-console.tsx', import.meta.url),
    'utf8'
  );
  for (const stateKey of ['loading', 'success', 'validationError', 'unauthorized', 'staleApproval', 'expired', 'priceChanged', 'mismatch', 'retry', 'emptyAuth']) {
    assert.ok(source.includes(`labels.${stateKey}`), `console renders ${stateKey}`);
  }
  // No client-supplied role/ownership/actor fields in any command payload.
  assert.ok(!/customerId|tenantId|actorId|roles?:/.test(source.replace(/OrchestrationLabels[\s\S]*?};/, '')));
  // Console is mounted on all seven screens.
  const screens = [
    'src/app/[locale]/trip-wizard/page.tsx',
    'src/app/[locale]/(customer)/proposal/page.tsx',
    'src/app/[locale]/staff/approvals/page.tsx',
    'src/app/[locale]/(customer)/trip-room/page.tsx',
    'src/app/[locale]/(customer)/payment/page.tsx',
    'src/app/[locale]/staff/crm/page.tsx',
    'src/components/founder-command-center.tsx'
  ];
  for (const screen of screens) {
    const content = await readFile(new URL(`../../${screen}`, import.meta.url), 'utf8');
    assert.ok(content.includes('OrchestrationConsole'), `${screen} mounts the console`);
  }
});
