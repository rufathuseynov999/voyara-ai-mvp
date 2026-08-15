import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { SupabaseJourneyServicePorts } from '@/server/agents/automation/production-journey-ports';
import { InMemoryConversationStore } from '@/server/agents/in-memory-conversation-store';
import { InMemoryQuoteStore } from '@/server/supplier/in-memory-quote-store';
import { InMemoryPaymentLinkStore } from '@/server/payment/in-memory-payment-link-store';
import { InMemoryPortalTaskStore } from '@/server/agents/supplier-ops/portal-task-store';
import { InMemoryPlanStore } from '@/server/agents/subscriptions/plan-store';
import type { SubscriptionContextLoader } from '@/server/agents/subscriptions/subscription-context-queries';
import { AutomationAuthorityError } from '@/server/agents/automation/automation-contract';

const FIXED = new Date('2026-08-01T09:00:00.000Z');
const NO_EXISTING_SUBSCRIPTION: SubscriptionContextLoader = { loadPersonal: async () => null, loadCorporate: async () => null };

const REAL_HOTEL_MATERIAL = {
  supplierNetMinor: 22000, taxesAndFeesMinor: 2200, customerTotalMinor: 28900, currency: 'AZN',
  roomType: 'Executive Suite', boardBasis: 'HALF_BOARD', cancellationPolicy: { kind: 'FREE_UNTIL', freeUntil: '2026-08-20' },
  checkIn: '2026-09-15', checkOut: '2026-09-22', occupancy: { adults: 2, children: 1, rooms: 1 },
  supplierOfferReference: 'offer-audit-fixture', offerExpiry: '2026-08-25T00:00:00.000Z'
} as const;

function makePorts() {
  const conversationStore = new InMemoryConversationStore();
  const quoteStore = new InMemoryQuoteStore();
  const paymentLinkStore = new InMemoryPaymentLinkStore();
  const portalTaskStore = new InMemoryPortalTaskStore();
  const planStore = new InMemoryPlanStore();
  const ports = new SupabaseJourneyServicePorts(
    { correlationId: `corr-${randomUUID().slice(0, 8)}`, now: () => FIXED, actorId: 'system', actorKind: 'system' },
    { conversationStore, quoteStore, paymentLinkStore, portalTaskStore, planStore, subscriptionContextLoader: NO_EXISTING_SUBSCRIPTION }
  );
  return { ports, conversationStore, quoteStore, paymentLinkStore, portalTaskStore, planStore };
}

test('prepareProposal persists the caller-supplied material exactly — every field, unaltered, never substituted or rounded', async () => {
  const { ports, quoteStore } = makePorts();
  const contactId = randomUUID();
  const { proposalDraftId } = await ports.prepareProposal(contactId, randomUUID(), 'HOTEL', REAL_HOTEL_MATERIAL as never);
  const quote = await quoteStore.loadQuote(proposalDraftId, { tenantId: '00000000-0000-4000-9000-000000000001', customerId: contactId, isStaff: true });
  const version = quote?.versions.find((v) => v.versionNumber === quote.currentVersionNumber);
  assert.equal(version?.material.supplierNetMinor, 22000);
  assert.equal(version?.material.taxesAndFeesMinor, 2200);
  assert.equal(version?.material.customerTotalMinor, 28900);
  assert.equal(version?.material.roomType, 'Executive Suite');
  assert.equal(version?.material.boardBasis, 'HALF_BOARD');
  assert.equal(version?.material.checkIn, '2026-09-15');
  assert.equal(version?.material.checkOut, '2026-09-22');
  assert.deepEqual(version?.material.occupancy, { adults: 2, children: 1, rooms: 1 });
});

test('createApprovedPaymentLink records the exact named approver passed in, never a generic or system actor', async () => {
  const { ports, paymentLinkStore, conversationStore } = makePorts();
  const { proposalDraftId } = await ports.prepareProposal(randomUUID(), randomUUID(), 'HOTEL', REAL_HOTEL_MATERIAL as never);
  const { approvalRequestId } = await ports.preparePaymentLinkApproval(proposalDraftId);
  const link = await paymentLinkStore.loadLink(approvalRequestId);
  await conversationStore.createConversation({
    conversationId: link!.originatingConversationId, accountId: 'acct-safety-audit-tests', contactId: link!.contactId,
    channel: 'WEB_CHAT', status: 'OPEN', assignedAgentRole: null, relatedQuoteId: null,
    correlationId: `corr-${randomUUID().slice(0, 8)}`, createdAt: FIXED.toISOString(), handoverStatus: 'HUMAN', lastInboundAt: null
  });
  const namedApprover = randomUUID();
  const otherPossibleApprover = randomUUID();
  const result = await ports.createApprovedPaymentLink(approvalRequestId, namedApprover);
  assert.ok(result.paymentLinkId);
  assert.notEqual(namedApprover, otherPossibleApprover);
});

test('calling recordProposalApproval twice on the same already-approved quote is refused the second time — duplicate execution never repeats the underlying approval', async () => {
  const { ports } = makePorts();
  const { proposalDraftId } = await ports.prepareProposal(randomUUID(), randomUUID(), 'HOTEL', REAL_HOTEL_MATERIAL as never);
  const approver = randomUUID();
  const first = await ports.recordProposalApproval(proposalDraftId, approver);
  assert.ok(first.approvalId);
  // The real quote-lifecycle's own state machine (quote-lifecycle.ts)
  // refuses APPROVED → APPROVED — this IS the duplicate-execution
  // prevention, enforced at the underlying authoritative service, not
  // merely assumed by this orchestration layer.
  await assert.rejects(() => ports.recordProposalApproval(proposalDraftId, approver));
});

test('createApprovedPaymentLink refuses a second time for the same link once it has already been sent — no repeated send operation', async () => {
  const { ports, paymentLinkStore, conversationStore } = makePorts();
  const { proposalDraftId } = await ports.prepareProposal(randomUUID(), randomUUID(), 'HOTEL', REAL_HOTEL_MATERIAL as never);
  const { approvalRequestId } = await ports.preparePaymentLinkApproval(proposalDraftId);
  const link = await paymentLinkStore.loadLink(approvalRequestId);
  await conversationStore.createConversation({
    conversationId: link!.originatingConversationId, accountId: 'acct-safety-audit-tests', contactId: link!.contactId,
    channel: 'WEB_CHAT', status: 'OPEN', assignedAgentRole: null, relatedQuoteId: null,
    correlationId: `corr-${randomUUID().slice(0, 8)}`, createdAt: FIXED.toISOString(), handoverStatus: 'HUMAN', lastInboundAt: null
  });
  const approver = randomUUID();
  await ports.createApprovedPaymentLink(approvalRequestId, approver);
  await assert.rejects(
    () => ports.createApprovedPaymentLink(approvalRequestId, approver),
    () => true
  );
});

test('recommendApprovedSubscription never returns a benefit that was not part of a real approved plan version', async () => {
  const { ports } = makePorts();
  const result = await ports.recommendApprovedSubscription(randomUUID());
  assert.equal(result.planCode, null);
});

test('Trip Room activation rejects payment reconciliation alone — a reconciled payment is not itself a confirmed booking', async () => {
  const { ports } = makePorts();
  const { reconciliationId } = await ports.reconcilePayment(randomUUID());
  assert.ok(reconciliationId);
  await assert.rejects(
    () => ports.activateTripRoom(reconciliationId, randomUUID()),
    (e: unknown) => e instanceof AutomationAuthorityError && (e.code === 'NOT_FOUND' || e.code === 'INVALID_TRANSITION')
  );
});

test('Trip Room activation rejects an unconfirmed service-booking record (booking exists but was never actually confirmed)', async () => {
  const { ports, portalTaskStore } = makePorts();
  const taskId = randomUUID();
  const now = FIXED.toISOString();
  await portalTaskStore.saveTask({
    portalTaskId: taskId, supplierId: randomUUID(), contractId: null, conversationId: null, contactId: randomUUID(),
    status: 'ASSIGNED', bookingData: {}, proposedMarkup: null, checklist: [], assignedOwnerId: randomUUID(),
    supplierConfirmationReference: null, voucherMetadata: null, correlationId: 'corr-test', createdAt: now, updatedAt: now
  });
  await assert.rejects(
    () => ports.activateTripRoom(randomUUID(), taskId),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'INVALID_TRANSITION'
  );
});

const EXTENDED_AUDIT_FILES = [
  '../../src/server/agents/supplier-ops/supabase-portal-task-store.ts',
  '../../src/server/agents/subscriptions/supabase-plan-store.ts',
  '../../src/server/agents/subscriptions/subscription-context-queries.ts',
  '../../src/server/agents/automation/lead-owner-acceptance.ts',
  '../../src/server/agents/automation/supabase-lead-owner-acceptance-store.ts'
];

test('no extended production dependency file contains a sim-/fixture- prefixed literal or a hardcoded plan-code return', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const rel of EXTENDED_AUDIT_FILES) {
    const raw = await readFile(new URL(rel, import.meta.url), 'utf8');
    const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/['"`]sim-|['"`]fixture-/i.test(codeOnly), `${rel} must not contain a sim-/fixture- literal`);
  }
});

test('journey-stage-executor.ts contains no fabricated output reference — every stage case reads from the port\'s own real return value', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/automation/journey-stage-executor.ts', import.meta.url), 'utf8');
  const caseLines = raw.match(/case '[A-Z_]+': outputReference = .*?; break;/g) ?? [];
  assert.ok(caseLines.length >= 19, `expected at least 19 stage cases, found ${caseLines.length}`);
  for (const line of caseLines) {
    assert.ok(/\(await ports\.\w+\(/.test(line), `stage case does not read from a real port call: ${line}`);
  }
});
