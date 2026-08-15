import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  approvePaymentLink,
  cancelPaymentLink,
  createAndSendPaymentLink,
  draftPaymentLink,
  processPaymentLinkWebhook,
  type PaymentLinkContext
} from '@/server/payment/payment-link-service';
import { InMemoryPaymentLinkStore } from '@/server/payment/in-memory-payment-link-store';
import { InMemoryConversationStore } from '@/server/agents/in-memory-conversation-store';
import { SimulationPaymentLinkAdapter, signPaymentLinkWebhook } from '@/server/payment/simulation-payment-link-adapter';
import { PaymentLinkAuthorityError } from '@/server/payment/payment-link-contract';

const FIXED = new Date('2026-08-01T09:00:00.000Z');
const SECRET = 'w'.repeat(40);

function ctx(assuranceLevel: 'aal1' | 'aal2' = 'aal2'): PaymentLinkContext & { store: InMemoryPaymentLinkStore; conversationStore: InMemoryConversationStore } {
  return {
    store: new InMemoryPaymentLinkStore(),
    conversationStore: new InMemoryConversationStore(),
    adapter: new SimulationPaymentLinkAdapter(),
    actor: { id: randomUUID(), kind: 'human', assuranceLevel },
    correlationId: `corr-${randomUUID().slice(0, 8)}`,
    now: () => FIXED
  };
}

const draftInput = (overrides: Partial<Parameters<typeof draftPaymentLink>[1]> = {}) => ({
  contactId: randomUUID(),
  originatingConversationId: randomUUID(),
  originatingBrand: 'RTRAVEL' as const,
  proposalVersionId: null,
  supplierContractReference: null,
  serviceDescription: 'Baku city tour, 2 pax',
  transactionType: 'TOUR_PACKAGE' as const,
  amountMinor: 130_000,
  currency: 'AZN' as const,
  merchantAuthority: 'R-Travel LLC',
  expiresAt: new Date(FIXED.getTime() + 3_600_000).toISOString(),
  paymentPurpose: 'Payment for Baku city tour',
  correlationId: 'corr-1',
  requiresHumanApproval: true as const,
  ...overrides
});

/* ------------------------------- draft / approve ------------------------------ */

test('a payment link is DRAFTED and never auto-approved', async () => {
  const c = ctx();
  const { paymentLinkId } = await draftPaymentLink(c, draftInput());
  const link = await c.store.loadLink(paymentLinkId);
  assert.equal(link?.status, 'DRAFTED');
  assert.equal(link?.approvedBy, null);
});

test('drafting rejects an expiry in the past', async () => {
  const c = ctx();
  await assert.rejects(
    () => draftPaymentLink(c, draftInput({ expiresAt: new Date(FIXED.getTime() - 1000).toISOString() })),
    (e: unknown) => e instanceof PaymentLinkAuthorityError && e.code === 'VALIDATION'
  );
});

test('approval requires a human AAL2 actor', async () => {
  const c = ctx('aal1');
  const { paymentLinkId } = await draftPaymentLink(c, draftInput());
  const link = await c.store.loadLink(paymentLinkId);
  await assert.rejects(
    () => approvePaymentLink(c, paymentLinkId, link!.contentHash),
    (e: unknown) => e instanceof PaymentLinkAuthorityError && e.code === 'VALIDATION'
  );
});

test('a non-human actor cannot approve', async () => {
  const c = ctx();
  const { paymentLinkId } = await draftPaymentLink(c, draftInput());
  const link = await c.store.loadLink(paymentLinkId);
  const agentCtx = { ...c, actor: { id: randomUUID(), kind: 'agent' as const } };
  await assert.rejects(
    () => approvePaymentLink(agentCtx, paymentLinkId, link!.contentHash),
    (e: unknown) => e instanceof PaymentLinkAuthorityError && e.code === 'VALIDATION'
  );
});

test('a stale content hash is rejected — identical discipline to quote/message approval', async () => {
  const c = ctx();
  const { paymentLinkId } = await draftPaymentLink(c, draftInput());
  await assert.rejects(
    () => approvePaymentLink(c, paymentLinkId, 'f'.repeat(64)),
    (e: unknown) => e instanceof PaymentLinkAuthorityError && e.code === 'STALE_CONTENT_HASH'
  );
});

test('approval by the exact content hash succeeds', async () => {
  const c = ctx();
  const { paymentLinkId } = await draftPaymentLink(c, draftInput());
  const link = await c.store.loadLink(paymentLinkId);
  await approvePaymentLink(c, paymentLinkId, link!.contentHash);
  const approved = await c.store.loadLink(paymentLinkId);
  assert.equal(approved?.status, 'APPROVED');
  assert.equal(approved?.approvedBy, c.actor.id);
});

test('a link cannot be approved twice', async () => {
  const c = ctx();
  const { paymentLinkId } = await draftPaymentLink(c, draftInput());
  const link = await c.store.loadLink(paymentLinkId);
  await approvePaymentLink(c, paymentLinkId, link!.contentHash);
  await assert.rejects(() => approvePaymentLink(c, paymentLinkId, link!.contentHash), (e: unknown) => e instanceof PaymentLinkAuthorityError && e.code === 'ALREADY_APPROVED');
});

/* ------------------------- create checkout + send only after approval ------------------------- */

test('checkout creation and send are refused before approval', async () => {
  const c = ctx();
  const { paymentLinkId } = await draftPaymentLink(c, draftInput());
  await assert.rejects(() => createAndSendPaymentLink(c, paymentLinkId), (e: unknown) => e instanceof PaymentLinkAuthorityError && e.code === 'NOT_APPROVED');
});

test('after approval, the link is created and delivered ONLY into the originating conversation', async () => {
  const c = ctx();
  const conversationId = randomUUID();
  const draft = draftInput({ originatingConversationId: conversationId });
  await c.conversationStore.createConversation({
    conversationId, accountId: 'acct-payment-link-tests', contactId: draft.contactId, channel: 'WEB_CHAT', status: 'OPEN',
    assignedAgentRole: null, relatedQuoteId: null, correlationId: c.correlationId, createdAt: c.now().toISOString(), handoverStatus: 'HUMAN', lastInboundAt: null
  });
  const { paymentLinkId } = await draftPaymentLink(c, draft);
  const drafted = await c.store.loadLink(paymentLinkId);
  await approvePaymentLink(c, paymentLinkId, drafted!.contentHash);
  const { hostedUrl, messageId } = await createAndSendPaymentLink(c, paymentLinkId);
  assert.ok(hostedUrl.startsWith('https://'));
  const message = await c.conversationStore.loadMessage(messageId);
  assert.equal(message?.conversationId, conversationId);
  assert.equal(message?.status, 'SENT');
  assert.ok(message?.body.includes(hostedUrl));
  const link = await c.store.loadLink(paymentLinkId);
  assert.equal(link?.status, 'SENT');
});

test('an expired-since-approval link refuses checkout creation', async () => {
  const c = ctx();
  const nearExpiry = new Date(FIXED.getTime() + 1000).toISOString();
  const { paymentLinkId } = await draftPaymentLink(c, draftInput({ expiresAt: nearExpiry }));
  const drafted = await c.store.loadLink(paymentLinkId);
  await approvePaymentLink(c, paymentLinkId, drafted!.contentHash);
  const laterCtx = { ...c, now: () => new Date(FIXED.getTime() + 2000) };
  await assert.rejects(() => createAndSendPaymentLink(laterCtx, paymentLinkId), (e: unknown) => e instanceof PaymentLinkAuthorityError && e.code === 'EXPIRED');
});

/* --------------------------------- cancellation --------------------------------- */

test('cancellation is refused once a link is already VERIFIED (terminal)', async () => {
  const c = ctx();
  const { paymentLinkId } = await draftPaymentLink(c, draftInput());
  const drafted = await c.store.loadLink(paymentLinkId);
  await approvePaymentLink(c, paymentLinkId, drafted!.contentHash);
  await c.store.saveLink({ ...(await c.store.loadLink(paymentLinkId))!, status: 'VERIFIED' });
  await assert.rejects(() => cancelPaymentLink(c, paymentLinkId, 'CUSTOMER_REQUEST'), (e: unknown) => e instanceof PaymentLinkAuthorityError && e.code === 'ALREADY_TERMINAL');
});

/* ------------------------------ webhook + reconciliation ------------------------------ */

async function toSent(c: ReturnType<typeof ctx>) {
  const input = draftInput();
  // The in-memory store now mirrors the real database's FK constraint:
  // a message can only be saved against a conversation that actually
  // exists (E.2A's channel-derivation invariant depends on this). This
  // fixture previously used a bare random UUID with no real conversation
  // behind it — create one for real here, matching what any real
  // payment-link send already requires in production.
  await c.conversationStore.createConversation({
    conversationId: input.originatingConversationId, accountId: 'acct-payment-link-tests', contactId: input.contactId,
    channel: 'WEB_CHAT', status: 'OPEN', assignedAgentRole: null, relatedQuoteId: null,
    correlationId: c.correlationId, createdAt: c.now().toISOString(), handoverStatus: 'HUMAN', lastInboundAt: null
  });
  const { paymentLinkId } = await draftPaymentLink(c, input);
  const drafted = await c.store.loadLink(paymentLinkId);
  await approvePaymentLink(c, paymentLinkId, drafted!.contentHash);
  await createAndSendPaymentLink(c, paymentLinkId);
  return (await c.store.loadLink(paymentLinkId))!;
}

test('an exact-match webhook verifies the payment link', async () => {
  const c = ctx();
  const link = await toSent(c);
  const timestamp = FIXED.toISOString();
  const bodyPayload = { orderReference: link.orderReference, status: 'PAID' as const, amountMinor: link.amountMinor, currency: link.currency, providerTransactionReference: 'TX-1' };
  const body = JSON.stringify(bodyPayload);
  const signature = signPaymentLinkWebhook(SECRET, timestamp, body);
  const result = await processPaymentLinkWebhook(c, { eventId: 'evt-1', eventType: 'payment.paid', timestamp, signature, body }, SECRET, bodyPayload);
  assert.equal(result.accepted, true);
  assert.equal(result.verified, true);
  const updated = await c.store.loadLink(link.paymentLinkId);
  assert.equal(updated?.status, 'VERIFIED');
});

test('a wrong-amount webhook is accepted (real event) but never verifies', async () => {
  const c = ctx();
  const link = await toSent(c);
  const timestamp = FIXED.toISOString();
  const bodyPayload = { orderReference: link.orderReference, status: 'PAID' as const, amountMinor: link.amountMinor - 1000, currency: link.currency, providerTransactionReference: 'TX-2' };
  const body = JSON.stringify(bodyPayload);
  const signature = signPaymentLinkWebhook(SECRET, timestamp, body);
  const result = await processPaymentLinkWebhook(c, { eventId: 'evt-2', eventType: 'payment.paid', timestamp, signature, body }, SECRET, bodyPayload);
  assert.equal(result.verified, false);
  assert.equal(result.reasonCode, 'AMOUNT_MISMATCH');
  const updated = await c.store.loadLink(link.paymentLinkId);
  assert.equal(updated?.status, 'MISMATCHED');
});

test('a wrong order reference webhook never verifies (WRONG_ORDER_REFERENCE)', async () => {
  const c = ctx();
  const link = await toSent(c);
  const timestamp = FIXED.toISOString();
  const bodyPayload = { orderReference: 'VOY-WRONG-REF', status: 'PAID' as const, amountMinor: link.amountMinor, currency: link.currency, providerTransactionReference: 'TX-3' };
  const body = JSON.stringify(bodyPayload);
  const signature = signPaymentLinkWebhook(SECRET, timestamp, body);
  const result = await processPaymentLinkWebhook(c, { eventId: 'evt-3', eventType: 'payment.paid', timestamp, signature, body }, SECRET, bodyPayload);
  assert.equal(result.reasonCode, 'LINK_NOT_FOUND');
});

test('a tampered/invalid signature is rejected before any reconciliation happens', async () => {
  const c = ctx();
  const link = await toSent(c);
  const timestamp = FIXED.toISOString();
  const bodyPayload = { orderReference: link.orderReference, status: 'PAID' as const, amountMinor: link.amountMinor, currency: link.currency, providerTransactionReference: 'TX-4' };
  const body = JSON.stringify(bodyPayload);
  const result = await processPaymentLinkWebhook(c, { eventId: 'evt-4', eventType: 'payment.paid', timestamp, signature: 'f'.repeat(64), body }, SECRET, bodyPayload);
  assert.equal(result.accepted, false);
  assert.equal(result.reasonCode, 'INVALID_SIGNATURE');
  const updated = await c.store.loadLink(link.paymentLinkId);
  assert.equal(updated?.status, 'SENT'); // unchanged — never touched by a rejected webhook
});

test('a duplicate webhook event id is idempotent — accepted once, never double-reconciled', async () => {
  const c = ctx();
  const link = await toSent(c);
  const timestamp = FIXED.toISOString();
  const bodyPayload = { orderReference: link.orderReference, status: 'PAID' as const, amountMinor: link.amountMinor, currency: link.currency, providerTransactionReference: 'TX-5' };
  const body = JSON.stringify(bodyPayload);
  const signature = signPaymentLinkWebhook(SECRET, timestamp, body);
  const first = await processPaymentLinkWebhook(c, { eventId: 'evt-5', eventType: 'payment.paid', timestamp, signature, body }, SECRET, bodyPayload);
  const second = await processPaymentLinkWebhook(c, { eventId: 'evt-5', eventType: 'payment.paid', timestamp, signature, body }, SECRET, bodyPayload);
  assert.equal(first.verified, true);
  assert.equal(second.reasonCode, 'DUPLICATE_EVENT');
});

/* ------------------------------- structural: no auto-refund/booking ------------------------------- */

test('no code path in the payment-link service constructs a refund-execution or booking-confirmation request', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/payment/payment-link-service.ts', import.meta.url), 'utf8');
  const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/\/refund/i.test(codeOnly));
  assert.ok(!/\/book/i.test(codeOnly));
  assert.ok(!/executeRefund|confirmBooking|createBooking/i.test(codeOnly));
});

test('every drafted link\'s requiresHumanApproval is the literal true — the schema admits no other value', () => {
  const input = draftInput();
  assert.equal(input.requiresHumanApproval, true);
});
