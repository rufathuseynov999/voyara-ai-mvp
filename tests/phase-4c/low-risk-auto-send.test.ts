import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { buildApprovedPolicy, sendLowRiskMessage, type LowRiskAutoSendContext } from '@/server/agents/low-risk-auto-send';
import { InMemoryConversationStore } from '@/server/agents/in-memory-conversation-store';
import { InMemoryPolicyStore } from '@/server/agents/policy-store';
import { SimulationChannelAdapter } from '@/server/agents/simulation-channel-adapter';
import { RiskPolicyAuthorityError, lowRiskIntents } from '@/server/agents/risk-policy-contract';

const FIXED = new Date('2026-08-01T09:00:00.000Z');

async function seededConversation(store: InMemoryConversationStore, accountId: string, correlationId: string) {
  const contactId = randomUUID();
  await store.upsertContact({ contactId, accountId, linkedCustomerId: null, displayName: 'Test', phone: '+994500000001', email: null, instagramHandle: null, preferredLocale: 'en' });
  const conversationId = randomUUID();
  await store.createConversation({ conversationId, accountId, contactId, channel: 'WHATSAPP', status: 'OPEN', assignedAgentRole: null, relatedQuoteId: null, correlationId, createdAt: FIXED.toISOString() });
  return conversationId;
}

function ctx(): LowRiskAutoSendContext & { store: InMemoryConversationStore; policyStore: InMemoryPolicyStore } {
  return {
    store: new InMemoryConversationStore(),
    policyStore: new InMemoryPolicyStore(),
    channel: new SimulationChannelAdapter('WHATSAPP'),
    correlationId: `corr-${randomUUID().slice(0, 8)}`,
    now: () => FIXED
  };
}

async function activatePolicy(c: ReturnType<typeof ctx>, allowedIntents: readonly (typeof lowRiskIntents)[number][] = ['GREETING', 'FAQ']) {
  const policy = buildApprovedPolicy({
    policyId: randomUUID(), policyName: 'default-policy', version: 1, knowledgeVersion: 'kb-2026-08-01',
    allowedIntents: [...allowedIntents], approvedBy: randomUUID(), correlationId: c.correlationId, now: c.now
  });
  await c.policyStore.savePolicy(policy);
  return policy;
}

/* -------------------------------- no policy at all -------------------------------- */

test('auto-send is refused with no active policy at all', async () => {
  const c = ctx();
  const conversationId = await seededConversation(c.store, randomUUID(), c.correlationId);
  await assert.rejects(
    () => sendLowRiskMessage(c, { conversationId, agentRole: 'sales', intent: 'GREETING', body: 'Hello!', modelName: 'sim-cheap-v1', correlationId: c.correlationId }, '+994500000001'),
    (e: unknown) => e instanceof RiskPolicyAuthorityError && e.code === 'NO_ACTIVE_POLICY'
  );
});

/* -------------------------------- intent not allowed -------------------------------- */

test('an intent outside the active policy\'s allowedIntents is refused', async () => {
  const c = ctx();
  await activatePolicy(c, ['GREETING']);
  const conversationId = await seededConversation(c.store, randomUUID(), c.correlationId);
  await assert.rejects(
    () => sendLowRiskMessage(c, { conversationId, agentRole: 'sales', intent: 'FAQ', body: 'Our office hours are...', modelName: 'sim-cheap-v1', correlationId: c.correlationId }, '+994500000001'),
    (e: unknown) => e instanceof RiskPolicyAuthorityError && e.code === 'INTENT_NOT_ALLOWED'
  );
});

/* -------------------------------- happy path -------------------------------- */

test('a genuinely allowed low-risk message auto-sends and carries full policy evidence', async () => {
  const c = ctx();
  const policy = await activatePolicy(c, ['GREETING', 'FAQ']);
  const conversationId = await seededConversation(c.store, randomUUID(), c.correlationId);
  const { messageId, sent } = await sendLowRiskMessage(c, { conversationId, agentRole: 'sales', intent: 'GREETING', body: 'Salam! How can I help you plan your trip?', modelName: 'sim-cheap-v1', correlationId: c.correlationId }, '+994500000001');
  assert.equal(sent, true);
  const message = await c.store.loadMessage(messageId);
  assert.equal(message?.status, 'SENT');
  assert.equal(message?.riskClass, 'LOW_RISK_INFORMATIONAL');
  assert.equal(message?.policyId, policy.policyId);
  assert.equal(message?.policyHash, policy.policyHash);
  assert.equal(message?.knowledgeVersion, policy.knowledgeVersion);
  assert.equal(message?.model, 'sim-cheap-v1');
  assert.ok(message?.agentRunId);
  assert.equal(message?.approvedBy, null); // never a human approver for a policy-authorized send
  assert.equal(c.policyStore.countLlmRuns(), 1);
});

test('every low-risk auto-send is audited with the intent as reasonCode', async () => {
  const c = ctx();
  await activatePolicy(c, ['CALLBACK_SCHEDULING']);
  const conversationId = await seededConversation(c.store, randomUUID(), c.correlationId);
  const { messageId } = await sendLowRiskMessage(c, { conversationId, agentRole: 'concierge', intent: 'CALLBACK_SCHEDULING', body: 'We will call you back at 3pm.', modelName: 'sim-cheap-v1', correlationId: c.correlationId }, '+994500000001');
  const events = c.store.auditEventsFor(conversationId);
  const sendEvent = events.find((e) => e.kind === 'LOW_RISK_MESSAGE_AUTO_SENT');
  assert.ok(sendEvent);
  assert.equal(sendEvent?.messageId, messageId);
  assert.equal(sendEvent?.reasonCode, 'CALLBACK_SCHEDULING');
  assert.equal(sendEvent?.actorKind, 'system');
});

/* -------------------------------- stale policy hash -------------------------------- */

test('a policy whose stored hash no longer matches its own content is refused (stale-hash discipline)', async () => {
  const c = ctx();
  const policy = await activatePolicy(c, ['FAQ']);
  // Simulate drift: the policy row's allowedIntents changed without a
  // version bump / hash recompute — exactly the scenario the hash check
  // exists to catch.
  await c.policyStore.savePolicy({ ...policy, allowedIntents: ['FAQ', 'GREETING'] });
  const conversationId = await seededConversation(c.store, randomUUID(), c.correlationId);
  await assert.rejects(
    () => sendLowRiskMessage(c, { conversationId, agentRole: 'sales', intent: 'FAQ', body: 'x', modelName: 'sim-cheap-v1', correlationId: c.correlationId }, '+994500000001'),
    (e: unknown) => e instanceof RiskPolicyAuthorityError && e.code === 'STALE_POLICY_HASH'
  );
});

/* -------------------------------- deactivated policy blocks send -------------------------------- */

test('deactivating the policy after drafting blocks the send (checked at send time, not draft time)', async () => {
  const c = ctx();
  const policy = await activatePolicy(c, ['GREETING']);
  await c.policyStore.savePolicy({ ...policy, active: false });
  const conversationId = await seededConversation(c.store, randomUUID(), c.correlationId);
  await assert.rejects(
    () => sendLowRiskMessage(c, { conversationId, agentRole: 'sales', intent: 'GREETING', body: 'x', modelName: 'sim-cheap-v1', correlationId: c.correlationId }, '+994500000001'),
    (e: unknown) => e instanceof RiskPolicyAuthorityError && e.code === 'NO_ACTIVE_POLICY'
  );
});

/* -------------------------------- structural: HUMAN_APPROVAL_REQUIRED unreachable -------------------------------- */

test('LowRiskSendRequest\'s intent field has no representation for prices/proposals/payments/bookings/changes/cancellations/refunds', () => {
  const forbidden = ['PRICE', 'DISCOUNT', 'PROPOSAL', 'PAYMENT', 'BOOKING', 'CHANGE', 'CANCELLATION', 'REFUND', 'LEGAL_CLAIM'];
  for (const term of forbidden) {
    assert.ok(!(lowRiskIntents as readonly string[]).includes(term));
  }
});

test('every low-risk intent in the closed enum is one of the founder-listed informational categories', () => {
  const expected = ['GREETING', 'FAQ', 'SERVICE_EXPLANATION', 'LEAD_QUALIFICATION', 'COLLECT_TRIP_DETAILS', 'STATUS_ACKNOWLEDGEMENT', 'CALLBACK_SCHEDULING'];
  assert.deepEqual([...lowRiskIntents].sort(), expected.sort());
});

test('sendLowRiskMessage is the only function in low-risk-auto-send.ts that can produce a SENT message', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/low-risk-auto-send.ts', import.meta.url), 'utf8');
  const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const sentAssignments = (codeOnly.match(/status:\s*'SENT'/g) ?? []).length;
  assert.equal(sentAssignments, 1, 'exactly one place constructs a SENT status');
});
