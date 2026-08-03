import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { InMemoryQuoteStore } from '@/server/supplier/in-memory-quote-store';
import { SimulationSupplierAdapter } from '@/server/supplier/simulation-adapter';
import { SimulationPaymentAdapter, signSimulatedWebhook } from '@/server/payment/simulation-payment-adapter';
import {
  acceptQuote,
  approveQuote,
  AuthorityError,
  checkVoucherEligibility,
  handlePaymentWebhook,
  prepareBookingCommand,
  preparePaymentIntent,
  presentQuote,
  reconcile,
  revalidate,
  searchAndCreateQuote,
  submitForReview,
  type OrchestrationContext
} from '@/server/supplier/orchestrator';
import { currentVersion } from '@/server/supplier/quote';
import type { InboundWebhook } from '@/server/payment/integration-contract';
import type { MaterialCommercialFields } from '@/server/supplier/contract';

const SECRET = 'w'.repeat(40);
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

const searchInput = () => ({
  destination: 'Maldives',
  checkIn: '2026-08-12',
  checkOut: '2026-08-19',
  occupancy: { adults: 2, children: 0, rooms: 1 },
  currency: 'AZN' as const,
  commandKey: 'search-1'
});

function webhook(ctx: OrchestrationContext, eventId = 'evt-1'): InboundWebhook {
  const timestamp = FIXED.toISOString();
  const body = JSON.stringify({ id: eventId, type: 'payment.detected' });
  return { eventId, eventType: 'payment.detected', timestamp, signature: signSimulatedWebhook(SECRET, timestamp, body), body };
}

/** Drive a quote to PAYMENT_VERIFIED via the orchestrator. */
async function toVerified(ctx: OrchestrationContext): Promise<string> {
  const { quoteId } = await searchAndCreateQuote(ctx, searchInput());
  const store = ctx.store;
  const quote = await store.loadQuote(quoteId, { ...ctx.ownership, isStaff: true });
  const hash = currentVersion(quote!).contentHash;
  await submitForReview(ctx, quoteId);
  await approveQuote(ctx, quoteId, hash);
  await presentQuote(ctx, quoteId);
  await acceptQuote(ctx, quoteId, 'accept-1');
  await preparePaymentIntent(ctx, quoteId);
  await handlePaymentWebhook(ctx, quoteId, webhook(ctx), SECRET, ['payment.detected']);
  const v = currentVersion((await store.loadQuote(quoteId, { ...ctx.ownership, isStaff: true }))!);
  await reconcile(ctx, quoteId, {
    receivedAmountMinor: v.material.customerTotalMinor,
    receivedCurrency: v.material.currency,
    providerTransactionReference: 'SIM-TX-1',
    providerStatus: 'PAID',
    receivedAt: '2026-07-20T09:15:00.000Z',
    seenProviderReferences: []
  });
  return quoteId;
}

test('complete simulated happy path reaches PAYMENT_VERIFIED and voucher eligible', async () => {
  const ctx = context();
  const quoteId = await toVerified(ctx);
  const quote = await ctx.store.loadQuote(quoteId, { ...ctx.ownership, isStaff: true });
  assert.equal(quote?.status, 'PAYMENT_VERIFIED');

  const prep = await prepareBookingCommand(ctx, quoteId, {
    travellers: [{ fullName: 'Aygun M', isLead: true }],
    rooming: [{ roomIndex: 1, travellerNames: ['Aygun M'] }],
    specialRequests: '',
    hagApprovalReference: randomUUID(),
    commandKey: 'prep-1'
  });
  assert.equal(prep.prepared, true);
  assert.equal(prep.preparation?.simulated, true);
  // Voucher eligible only once booking is confirmed by a human downstream.
  assert.equal(await checkVoucherEligibility(ctx, quoteId, false), false);
  assert.equal(await checkVoucherEligibility(ctx, quoteId, true), true);
});

test('presentation is blocked without valid human approval (HAG rejection)', async () => {
  const ctx = context();
  const { quoteId } = await searchAndCreateQuote(ctx, searchInput());
  await submitForReview(ctx, quoteId);
  await assert.rejects(() => presentQuote(ctx, quoteId), (e: unknown) =>
    e instanceof AuthorityError && e.code === 'NO_VALID_APPROVAL');
});

test('stale-hash approval is rejected', async () => {
  const ctx = context();
  const { quoteId } = await searchAndCreateQuote(ctx, searchInput());
  await submitForReview(ctx, quoteId);
  await assert.rejects(() => approveQuote(ctx, quoteId, 'f'.repeat(64)), (e: unknown) =>
    e instanceof AuthorityError && e.code === 'STALE_APPROVAL_HASH');
});

test('AI actor cannot approve (human approval required)', async () => {
  const ctx = context({ actor: { id: randomUUID(), kind: 'ai_agent' } });
  const { quoteId } = await searchAndCreateQuote(ctx, searchInput());
  const quote = await ctx.store.loadQuote(quoteId, { ...ctx.ownership, isStaff: true });
  await submitForReview(ctx, quoteId);
  await assert.rejects(() => approveQuote(ctx, quoteId, currentVersion(quote!).contentHash), (e: unknown) =>
    e instanceof AuthorityError && e.code === 'HUMAN_APPROVAL_REQUIRED');
});

test('revalidation price change creates new version and invalidates approval', async () => {
  const ctx = context();
  const { quoteId } = await searchAndCreateQuote(ctx, searchInput());
  const quote = await ctx.store.loadQuote(quoteId, { ...ctx.ownership, isStaff: true });
  const version = currentVersion(quote!);
  await submitForReview(ctx, quoteId);
  await approveQuote(ctx, quoteId, version.contentHash);

  const changed: MaterialCommercialFields = { ...version.material, customerTotalMinor: version.material.customerTotalMinor + 50_000 };
  const outcome = await revalidate(ctx, quoteId, changed);
  assert.equal(outcome.outcome, 'MATERIAL_CHANGE');
  const after = await ctx.store.loadQuote(quoteId, { ...ctx.ownership, isStaff: true });
  assert.equal(after?.status, 'PRICE_CHANGED');
  assert.equal(after?.currentVersionNumber, 2);
});

test('duplicate commands are idempotent (search, acceptance, booking-prep)', async () => {
  const ctx = context();
  const first = await searchAndCreateQuote(ctx, searchInput());
  const second = await searchAndCreateQuote(ctx, searchInput());
  assert.equal(first.quoteId, second.quoteId);
  assert.equal(second.replayed, true);

  const quoteId = await toVerified(ctx);
  // repeated acceptance with the SAME key used during the flow is a no-op replay
  const acc1 = await acceptQuote(ctx, quoteId, 'accept-1');
  const acc2 = await acceptQuote(ctx, quoteId, 'accept-1');
  assert.equal(acc1.replayed, true);
  assert.equal(acc2.replayed, true);

  const prepArgs = {
    travellers: [{ fullName: 'A', isLead: true }],
    rooming: [{ roomIndex: 1, travellerNames: ['A'] }],
    specialRequests: '',
    hagApprovalReference: randomUUID(),
    commandKey: 'prep-dup'
  };
  await prepareBookingCommand(ctx, quoteId, prepArgs);
  const again = await prepareBookingCommand(ctx, quoteId, prepArgs);
  assert.equal(again.replayed, true);
  assert.equal((ctx.store as InMemoryQuoteStore).countBookingPreparations(), 1);
});

test('payment mismatch blocks booking preparation', async () => {
  const ctx = context();
  const { quoteId } = await searchAndCreateQuote(ctx, searchInput());
  const quote = await ctx.store.loadQuote(quoteId, { ...ctx.ownership, isStaff: true });
  const hash = currentVersion(quote!).contentHash;
  await submitForReview(ctx, quoteId);
  await approveQuote(ctx, quoteId, hash);
  await presentQuote(ctx, quoteId);
  await acceptQuote(ctx, quoteId, 'accept-mm');
  await preparePaymentIntent(ctx, quoteId);
  await handlePaymentWebhook(ctx, quoteId, webhook(ctx), SECRET, ['payment.detected']);
  // Partial amount → mismatch.
  const v = currentVersion((await ctx.store.loadQuote(quoteId, { ...ctx.ownership, isStaff: true }))!);
  const recon = await reconcile(ctx, quoteId, {
    receivedAmountMinor: v.material.customerTotalMinor - 10_000,
    receivedCurrency: v.material.currency,
    providerTransactionReference: 'SIM-TX-2',
    providerStatus: 'PAID',
    receivedAt: '2026-07-20T09:15:00.000Z',
    seenProviderReferences: []
  });
  assert.equal(recon.verified, false);
  const after = await ctx.store.loadQuote(quoteId, { ...ctx.ownership, isStaff: true });
  assert.equal(after?.status, 'PAYMENT_MISMATCH');

  const prep = await prepareBookingCommand(ctx, quoteId, {
    travellers: [{ fullName: 'A', isLead: true }],
    rooming: [{ roomIndex: 1, travellerNames: ['A'] }],
    specialRequests: '',
    hagApprovalReference: randomUUID(),
    commandKey: 'prep-mm'
  });
  assert.equal(prep.prepared, false);
});

test('cross-customer access is rejected', async () => {
  const ctx = context();
  const { quoteId } = await searchAndCreateQuote(ctx, searchInput());
  // A different customer, non-staff, may not load this quote.
  const otherCustomer = { tenantId: ctx.ownership.tenantId, customerId: randomUUID(), isStaff: false };
  const loaded = await ctx.store.loadQuote(quoteId, otherCustomer);
  assert.equal(loaded, null);
});

test('duplicate payment webhook is idempotent (no second detection)', async () => {
  const ctx = context();
  const { quoteId } = await searchAndCreateQuote(ctx, searchInput());
  const quote = await ctx.store.loadQuote(quoteId, { ...ctx.ownership, isStaff: true });
  const hash = currentVersion(quote!).contentHash;
  await submitForReview(ctx, quoteId);
  await approveQuote(ctx, quoteId, hash);
  await presentQuote(ctx, quoteId);
  await acceptQuote(ctx, quoteId, 'accept-w');
  await preparePaymentIntent(ctx, quoteId);
  const first = await handlePaymentWebhook(ctx, quoteId, webhook(ctx, 'evt-dup'), SECRET, ['payment.detected']);
  const second = await handlePaymentWebhook(ctx, quoteId, webhook(ctx, 'evt-dup'), SECRET, ['payment.detected']);
  assert.equal(first.reasonCode, 'ACCEPTED');
  assert.equal(second.duplicate, true);
});

test('audit records are created for each authoritative transition', async () => {
  const ctx = context();
  const quoteId = await toVerified(ctx);
  const events = await ctx.store.auditForQuote(quoteId);
  const kinds = new Set(events.map((e) => e.kind));
  for (const expected of ['QUOTE_CREATED', 'QUOTE_SUBMITTED_FOR_REVIEW', 'QUOTE_APPROVED', 'QUOTE_PRESENTED', 'QUOTE_CUSTOMER_ACCEPTED', 'PAYMENT_INTENT_CREATED', 'PAYMENT_WEBHOOK_RECEIVED', 'PAYMENT_RECONCILED']) {
    assert.ok(kinds.has(expected as never), `audit has ${expected}`);
  }
});
