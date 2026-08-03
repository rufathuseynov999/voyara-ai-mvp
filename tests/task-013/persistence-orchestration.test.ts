import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { InMemoryQuoteStore } from '@/server/supplier/in-memory-quote-store';
import { SimulationSupplierAdapter } from '@/server/supplier/simulation-adapter';
import { SimulationPaymentAdapter } from '@/server/payment/simulation-payment-adapter';
import {
  acceptQuote,
  approveQuote,
  prepareBookingCommand,
  preparePaymentIntent,
  presentQuote,
  searchAndCreateQuote,
  submitForReview,
  type OrchestrationContext
} from '@/server/supplier/orchestrator';
import { currentVersion, supersedeWithNewVersion } from '@/server/supplier/quote';

const FIXED = new Date('2026-07-20T09:00:00.000Z');

function context(overrides: Partial<OrchestrationContext> = {}): OrchestrationContext {
  return {
    store: new InMemoryQuoteStore(),
    supplier: new SimulationSupplierAdapter(),
    payment: new SimulationPaymentAdapter(),
    actor: { id: randomUUID(), kind: 'human' },
    ownership: { tenantId: randomUUID(), customerId: randomUUID() },
    correlationId: 'corr-abc-12345',
    now: () => FIXED,
    ...overrides
  };
}

const searchInput = (key = 'search-p2') => ({
  destination: 'Maldives',
  checkIn: '2026-08-12',
  checkOut: '2026-08-19',
  occupancy: { adults: 2, children: 0, rooms: 1 },
  currency: 'AZN' as const,
  commandKey: key
});

test('persistent happy path stores quote, versions, payment and audit through the store port', async () => {
  const ctx = context();
  const { quoteId } = await searchAndCreateQuote(ctx, searchInput());
  const quote = await ctx.store.loadQuote(quoteId, { ...ctx.ownership, isStaff: true });
  assert.ok(quote);
  await submitForReview(ctx, quoteId);
  await approveQuote(ctx, quoteId, currentVersion(quote!).contentHash);
  await presentQuote(ctx, quoteId);
  await acceptQuote(ctx, quoteId, 'accept-p2');
  await preparePaymentIntent(ctx, quoteId);
  const payment = await ctx.store.loadPaymentByQuote(quoteId);
  assert.ok(payment);
  assert.equal(payment?.simulated, true);
  const events = await ctx.store.auditForQuote(quoteId);
  assert.ok(events.length >= 5);
});

test('concurrent duplicate commands resolve to exactly one result (reserve-first)', async () => {
  const ctx = context();
  // Fire the same idempotency key concurrently: the key is reserved BEFORE the
  // work runs, so exactly one caller executes and everyone converges on the
  // winner's quote id — no duplicate quote records can exist.
  const [a, b, c] = await Promise.all([
    searchAndCreateQuote(ctx, searchInput('concurrent-1')),
    searchAndCreateQuote(ctx, searchInput('concurrent-1')),
    searchAndCreateQuote(ctx, searchInput('concurrent-1'))
  ]);
  const ids = new Set([a.quoteId, b.quoteId, c.quoteId]);
  assert.equal(ids.size, 1);
  assert.equal([a, b, c].filter((r) => !r.replayed).length, 1);
  assert.equal((ctx.store as InMemoryQuoteStore).countQuotes(), 1);
  const again = await searchAndCreateQuote(ctx, searchInput('concurrent-1'));
  assert.equal(again.replayed, true);
});

test('immutable quote versions survive supersession in the persisted model', async () => {
  const ctx = context();
  const { quoteId } = await searchAndCreateQuote(ctx, searchInput('immutable-1'));
  const quote = (await ctx.store.loadQuote(quoteId, { ...ctx.ownership, isStaff: true }))!;
  const v1 = currentVersion(quote);
  const superseded = supersedeWithNewVersion(quote, { ...v1.material, customerTotalMinor: v1.material.customerTotalMinor + 1 }, 'test', FIXED);
  await ctx.store.saveQuote(superseded, ctx.ownership, superseded.source);
  const reloaded = (await ctx.store.loadQuote(quoteId, { ...ctx.ownership, isStaff: true }))!;
  assert.equal(reloaded.versions.length, 2);
  const persistedV1 = reloaded.versions.find((v) => v.versionNumber === 1)!;
  assert.equal(persistedV1.contentHash, v1.contentHash); // untouched
  assert.equal(persistedV1.approvalInvalidated, true);
});

test('cross-customer and insufficient-role access is rejected by the store boundary', async () => {
  const ctx = context();
  const { quoteId } = await searchAndCreateQuote(ctx, searchInput('acl-1'));
  const stranger = { tenantId: ctx.ownership.tenantId, customerId: randomUUID(), isStaff: false };
  assert.equal(await ctx.store.loadQuote(quoteId, stranger), null);
  const staff = { tenantId: ctx.ownership.tenantId, customerId: randomUUID(), isStaff: true };
  assert.ok(await ctx.store.loadQuote(quoteId, staff));
});

test('booking preparation remains blocked on unverified payment in the persisted flow', async () => {
  const ctx = context();
  const { quoteId } = await searchAndCreateQuote(ctx, searchInput('block-1'));
  const quote = (await ctx.store.loadQuote(quoteId, { ...ctx.ownership, isStaff: true }))!;
  await submitForReview(ctx, quoteId);
  await approveQuote(ctx, quoteId, currentVersion(quote).contentHash);
  await presentQuote(ctx, quoteId);
  await acceptQuote(ctx, quoteId, 'accept-block');
  await preparePaymentIntent(ctx, quoteId);
  // No webhook, no reconciliation → payment unverified → blocked.
  const prep = await prepareBookingCommand(ctx, quoteId, {
    travellers: [{ fullName: 'A', isLead: true }],
    rooming: [{ roomIndex: 1, travellerNames: ['A'] }],
    specialRequests: '',
    hagApprovalReference: randomUUID(),
    commandKey: 'prep-block'
  });
  assert.equal(prep.prepared, false);
});

test('idempotency migration enforces a primary-key unique constraint with RLS', async () => {
  const sql = await readFile(
    new URL('../../supabase/migrations/20260721090000_task014_phase3b_idempotency_keys.sql', import.meta.url),
    'utf8'
  );
  assert.ok(sql.includes('key text primary key'));
  assert.ok(sql.includes('enable row level security'));
  assert.ok(sql.includes('force row level security'));
  assert.ok(sql.includes("role in ('staff', 'manager', 'finance', 'admin', 'founder')"));
});

test('orchestration audit migration is append-only with staff-scoped RLS', async () => {
  const sql = await readFile(
    new URL('../../supabase/migrations/20260721091500_task014_phase3b_orchestration_audit.sql', import.meta.url),
    'utf8'
  );
  assert.ok(sql.includes('orchestration_audit_events'));
  assert.ok(sql.includes('enable row level security'));
  assert.ok(sql.includes('force row level security'));
  // No update/delete policy → append-only under RLS.
  assert.ok(!/create policy.*for (update|delete)/i.test(sql));
});

test('Supabase store treats unique-violation on idempotency insert as the designed concurrent-duplicate path', async () => {
  const source = await readFile(
    new URL('../../src/server/supplier/supabase-quote-store.ts', import.meta.url),
    'utf8'
  );
  assert.ok(source.includes("error.code !== '23505'"), 'unique_violation handled as the losing side of the reserve race');
  assert.ok(source.includes('reserveIdempotent'), 'reserve-first idempotency present');
  assert.ok(source.includes('orchestration_idempotency_keys'));
  assert.ok(source.includes('orchestration_audit_events'));
  assert.ok(source.includes("onConflict: 'quote_id,version_number'"), 'immutable version upsert keyed on quote+version');
});

test('orchestration route derives authority from the session and blocks non-authoritative and client-trust paths', async () => {
  const route = await readFile(
    new URL('../../src/app/api/v1/orchestration/route.ts', import.meta.url),
    'utf8'
  );
  const service = await readFile(
    new URL('../../src/server/supplier/orchestration-service.ts', import.meta.url),
    'utf8'
  );
  // The route passes only session-derived viewer fields to the service.
  assert.ok(route.includes('id: viewer.id'));
  assert.ok(route.includes('assuranceLevel: viewer.assuranceLevel'));
  // Transport hardening stays on the route: same-origin, JSON-only, body
  // limit and durable idempotency header.
  assert.ok(route.includes('REQUEST_ORIGIN_DENIED'));
  assert.ok(route.includes('IDEMPOTENCY_KEY_REQUIRED'));
  assert.ok(route.includes('REQUEST_TOO_LARGE'));
  // Authority decisions live in the service: demo sessions rejected, staff
  // commands role- and AAL2-gated, ownership from the viewer only.
  assert.ok(service.includes("viewer.source !== 'supabase'"));
  assert.ok(service.includes('STAFF_ROLE_REQUIRED'));
  assert.ok(service.includes("viewer.assuranceLevel !== 'aal2'"));
  assert.ok(service.includes('actor: { id: viewer.id'));
  assert.ok(!/ownership:\s*\{\s*tenantId:\s*input\./.test(service));
  // Simulation labelling on every success payload.
  assert.ok(service.includes('SIMULATION_LABEL'));
});

test('no client-side authority bypass: store and route are server-only modules', async () => {
  const store = await readFile(
    new URL('../../src/server/supplier/supabase-quote-store.ts', import.meta.url),
    'utf8'
  );
  assert.ok(store.startsWith("import 'server-only';"));
  // The admin client must never be imported from any client component.
  const banner = await readFile(
    new URL('../../src/components/simulation-banner.tsx', import.meta.url),
    'utf8'
  );
  assert.ok(!banner.includes('supabase-quote-store'));
  assert.ok(!banner.includes('createAdminSupabaseClient'));
});
