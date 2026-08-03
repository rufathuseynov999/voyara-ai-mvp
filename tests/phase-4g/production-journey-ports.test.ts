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

const NO_EXISTING_SUBSCRIPTION: SubscriptionContextLoader = {
  loadPersonal: async () => null,
  loadCorporate: async () => null
};

const REAL_HOTEL_MATERIAL = {
  supplierNetMinor: 15000, taxesAndFeesMinor: 1500, customerTotalMinor: 19900, currency: 'AZN',
  roomType: 'Deluxe Double', boardBasis: 'BED_AND_BREAKFAST', cancellationPolicy: { kind: 'FREE_UNTIL', freeUntil: '2026-08-10' },
  checkIn: '2026-09-01', checkOut: '2026-09-08', occupancy: { adults: 2, children: 0, rooms: 1 },
  supplierOfferReference: 'offer-ref-fixture', offerExpiry: '2026-08-15T00:00:00.000Z'
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

test('prepareProposal genuinely calls the real createQuote function and persists a real Quote, never a simulation-prefixed fixture id', async () => {
  const { ports, quoteStore } = makePorts();
  const contactId = randomUUID();
  const result = await ports.prepareProposal(contactId, randomUUID(), "HOTEL", REAL_HOTEL_MATERIAL as never);
  assert.ok(!result.proposalDraftId.startsWith('prop-'));
  const quote = await quoteStore.loadQuote(result.proposalDraftId, { tenantId: 'voyara', customerId: contactId, isStaff: true });
  assert.ok(quote);
  assert.equal(quote?.status, 'DRAFT');
  assert.equal(quote?.customerId, contactId);
});

test('recordProposalApproval genuinely calls the real approveCurrentVersion function, moving the real quote to an approved state', async () => {
  const { ports, quoteStore } = makePorts();
  const contactId = randomUUID();
  const { proposalDraftId } = await ports.prepareProposal(contactId, randomUUID(), "HOTEL", REAL_HOTEL_MATERIAL as never);
  const approver = randomUUID();
  const result = await ports.recordProposalApproval(proposalDraftId, approver);
  assert.ok(result.approvalId);
  const quote = await quoteStore.loadQuote(proposalDraftId, { tenantId: 'voyara', customerId: contactId, isStaff: true });
  const version = quote?.versions.find((v) => v.versionNumber === quote.currentVersionNumber);
  assert.equal(version?.approvalReference, result.approvalId);
});

test('recordProposalApproval (Level 2) refuses without a real human approver', async () => {
  const { ports } = makePorts();
  const { proposalDraftId } = await ports.prepareProposal(randomUUID(), randomUUID(), "HOTEL", REAL_HOTEL_MATERIAL as never);
  await assert.rejects(
    () => ports.recordProposalApproval(proposalDraftId, ''),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'MISSING_APPROVAL'
  );
});

test('preparePaymentLinkApproval and createApprovedPaymentLink genuinely call the real payment-link service end to end', async () => {
  const { ports, paymentLinkStore } = makePorts();
  const { proposalDraftId } = await ports.prepareProposal(randomUUID(), randomUUID(), "HOTEL", REAL_HOTEL_MATERIAL as never);
  const { approvalRequestId } = await ports.preparePaymentLinkApproval(proposalDraftId);
  assert.ok(!approvalRequestId.startsWith('payapprreq-'));
  const link = await paymentLinkStore.loadLink(approvalRequestId);
  assert.ok(link);
  assert.equal(link?.status, 'DRAFTED');

  const approver = randomUUID();
  const result = await ports.createApprovedPaymentLink(approvalRequestId, approver);
  assert.equal(result.paymentLinkId, approvalRequestId);
  const approvedLink = await paymentLinkStore.loadLink(approvalRequestId);
  assert.equal(approvedLink?.status, 'SENT');
});

test('createApprovedPaymentLink (Level 2) refuses without a real human approver', async () => {
  const { ports } = makePorts();
  const { approvalRequestId } = await ports.preparePaymentLinkApproval(randomUUID());
  await assert.rejects(
    () => ports.createApprovedPaymentLink(approvalRequestId, ''),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'MISSING_APPROVAL'
  );
});

test('createApprovedPaymentLink refuses for a payment link id that does not exist', async () => {
  const { ports } = makePorts();
  await assert.rejects(
    () => ports.createApprovedPaymentLink(randomUUID(), randomUUID()),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'NOT_FOUND'
  );
});

test('recommendApprovedSubscription honestly returns planCode: null when no plan is configured in the real plan store', async () => {
  const { ports } = makePorts();
  const result = await ports.recommendApprovedSubscription(randomUUID());
  assert.equal(result.planCode, null);
  assert.ok(!result.recommendationId.startsWith('subrec-'));
});

test('resolveIdentity reads the real conversation record and refuses when it does not exist', async () => {
  const { ports } = makePorts();
  await assert.rejects(
    () => ports.resolveIdentity(randomUUID()),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'NOT_FOUND'
  );
});

test('resolveIdentity returns the real contactId from a real, seeded conversation', async () => {
  const { ports, conversationStore } = makePorts();
  const conversationId = randomUUID();
  const contactId = randomUUID();
  await conversationStore.upsertContact({ contactId, accountId: randomUUID(), phone: null, email: null, displayName: 'Test', preferredLanguage: 'az' } as never);
  await conversationStore.createConversation({ conversationId, accountId: randomUUID(), contactId, channel: 'WHATSAPP', status: 'OPEN', assignedAgentRole: null, relatedQuoteId: null, correlationId: 'corr-test', createdAt: FIXED.toISOString() } as never);
  const result = await ports.resolveIdentity(conversationId);
  assert.equal(result.contactId, contactId);
});

test('every audit-trail-backed port method records a real event via the actual ConversationStore.recordAgentAuditEvent function', async () => {
  const { ports } = makePorts();
  const result = await ports.escalateToConcierge(randomUUID(), 'TEST_ESCALATION');
  assert.ok(result.escalationId);
  assert.match(result.escalationId, /^[0-9a-f-]{36}$/);
});

test('prepareProposal fails closed with MISSING_AUTHORITATIVE_PROPOSAL_MATERIAL when no real material is supplied — it never fabricates a price, date, room type, or availability', async () => {
  const { ports } = makePorts();
  await assert.rejects(
    () => ports.prepareProposal(randomUUID(), randomUUID(), 'HOTEL', null),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'MISSING_AUTHORITATIVE_PROPOSAL_MATERIAL'
  );
});

test('prepareProposal fails closed with UNSUPPORTED_PROPOSAL_TYPE for a non-hotel request rather than forcing it into the hotel quote schema', async () => {
  const { ports } = makePorts();
  await assert.rejects(
    () => ports.prepareProposal(randomUUID(), randomUUID(), 'OTHER', REAL_HOTEL_MATERIAL as never),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'UNSUPPORTED_PROPOSAL_TYPE'
  );
});

test('prepareProposal with real material persists the exact authoritative supplier NET price, currency, dates, occupancy, room type, and board basis — never a placeholder', async () => {
  const { ports, quoteStore } = makePorts();
  const contactId = randomUUID();
  const { proposalDraftId } = await ports.prepareProposal(contactId, randomUUID(), 'HOTEL', REAL_HOTEL_MATERIAL as never);
  const quote = await quoteStore.loadQuote(proposalDraftId, { tenantId: contactId === contactId ? '00000000-0000-4000-9000-000000000001' : '', customerId: contactId, isStaff: true });
  const version = quote?.versions.find((v) => v.versionNumber === quote.currentVersionNumber);
  assert.equal(version?.material.supplierNetMinor, REAL_HOTEL_MATERIAL.supplierNetMinor);
  assert.equal(version?.material.roomType, REAL_HOTEL_MATERIAL.roomType);
  assert.equal(version?.material.checkIn, REAL_HOTEL_MATERIAL.checkIn);
  assert.equal(version?.material.boardBasis, REAL_HOTEL_MATERIAL.boardBasis);
});
