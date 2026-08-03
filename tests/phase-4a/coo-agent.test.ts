import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { generateCooDigest } from '@/server/agents/coo-agent';
import { FixtureOperationalSignalsSource, InMemoryCooDigestStore } from '@/server/agents/in-memory-coo-digest-store';
import { cooProposedActionKinds, cooProposedActionSchema } from '@/server/agents/coo-agent-contract';

/**
 * Phase 4A — hermetic COO agent tests.
 *
 * Founder decision under test: the COO agent is read-only. It may summarize,
 * identify risks, rank priorities, and propose actions — every proposed
 * action requires human approval and none of them can be, or resemble,
 * approving a price, sending a customer message, executing a payment,
 * creating a booking, cancelling a service, issuing a refund, or modifying
 * an authoritative record.
 */

const FIXED = new Date('2026-08-01T09:00:00.000Z');
const FORBIDDEN_PATTERNS = [
  /approve.*price/i, /send.*message/i, /execute.*payment/i, /create.*booking/i,
  /cancel.*service/i, /issue.*refund/i, /modify.*record/i
];

test('a quiet operational day produces zero risks and zero proposed actions', async () => {
  const signals = new FixtureOperationalSignalsSource({});
  const digest = await generateCooDigest(signals, { accountId: randomUUID(), correlationId: 'corr-coo-1', now: () => FIXED });
  assert.deepEqual(digest.risks, []);
  assert.deepEqual(digest.proposedActions, []);
  assert.match(digest.summary, /no operational risks/i);
});

test('payment mismatches are surfaced as a risk and a proposed action, ranked by severity threshold', async () => {
  const signals = new FixtureOperationalSignalsSource({ paymentMismatches: 5 });
  const digest = await generateCooDigest(signals, { accountId: randomUUID(), correlationId: 'corr-coo-2', now: () => FIXED });
  assert.equal(digest.risks.length, 1);
  assert.equal(digest.risks[0].severity, 'HIGH'); // 5 >= threshold of 3
  assert.equal(digest.proposedActions[0].kind, 'REVIEW_PAYMENT_MISMATCH');
  assert.equal(digest.proposedActions[0].requiresHumanApproval, true);
});

test('every proposed action kind is advisory-only — the closed enum excludes every forbidden capability', () => {
  for (const kind of cooProposedActionKinds) {
    for (const pattern of FORBIDDEN_PATTERNS) {
      assert.ok(!pattern.test(kind), `action kind "${kind}" must not resemble a forbidden capability`);
    }
  }
});

test('cooProposedActionSchema rejects any attempt to construct an action without requiresHumanApproval literal true', () => {
  const result = cooProposedActionSchema.safeParse({
    kind: 'REVIEW_QUOTE', description: 'x', relatedEntityId: null, requiresHumanApproval: false
  });
  assert.equal(result.success, false);
});

test('cooProposedActionSchema rejects an unknown action kind (cannot smuggle in a forbidden capability)', () => {
  const result = cooProposedActionSchema.safeParse({
    kind: 'EXECUTE_PAYMENT', description: 'x', relatedEntityId: null, requiresHumanApproval: true
  });
  assert.equal(result.success, false);
});

test('every priority produced across varied signal combinations resolves to a proposed action requiring human approval', async () => {
  const signals = new FixtureOperationalSignalsSource({
    pendingApprovals: 2, paymentMismatches: 1, expiringOffers: 4, escalatedConversations: 1, pendingHumanConversations: 3
  });
  const digest = await generateCooDigest(signals, { accountId: randomUUID(), correlationId: 'corr-coo-3', now: () => FIXED });
  assert.ok(digest.proposedActions.length > 0);
  for (const action of digest.proposedActions) {
    assert.equal(action.requiresHumanApproval, true);
  }
});

test('generateCooDigest performs no write of any kind — it only calls read methods on the signals source', async () => {
  const raw = await readFile(new URL('../../src/server/agents/coo-agent.ts', import.meta.url), 'utf8');
  const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/\.save|\.send|\.approve|\.execute|\.create(?!Query)|\.cancel|\.refund/i.test(codeOnly));
});

test('generateCooDigest has no parameter of type ConversationStore or ChannelAdapter (structural — cannot reach a send path)', async () => {
  const raw = await readFile(new URL('../../src/server/agents/coo-agent.ts', import.meta.url), 'utf8');
  const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!codeOnly.includes('ConversationStore'));
  assert.ok(!codeOnly.includes('ChannelAdapter'));
});

test('the coo_digests migration has no sent_at/executed_at/confirmed_at column — read-only by schema, not just convention', async () => {
  const raw = await readFile(new URL('../../supabase/migrations/20260726093000_task016_phase4a_coo_digest.sql', import.meta.url), 'utf8');
  const sqlOnly = raw.replace(/--.*$/gm, '');
  assert.ok(!/sent_at|executed_at|confirmed_at/i.test(sqlOnly));
});

test('digests persist and list back in descending recency order', async () => {
  const store = new InMemoryCooDigestStore();
  const accountId = randomUUID();
  const signals = new FixtureOperationalSignalsSource({ paymentMismatches: 1 });
  const first = await generateCooDigest(signals, { accountId, correlationId: 'corr-coo-4', now: () => new Date('2026-08-01T09:00:00.000Z') });
  const second = await generateCooDigest(signals, { accountId, correlationId: 'corr-coo-5', now: () => new Date('2026-08-02T09:00:00.000Z') });
  await store.saveDigest(first);
  await store.saveDigest(second);
  const recent = await store.listRecentDigests(accountId, 10);
  assert.equal(recent.length, 2);
  assert.equal(recent[0].digestId, second.digestId);
});
