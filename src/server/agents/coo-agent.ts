import { randomUUID } from 'node:crypto';
import {
  cooDigestSchema,
  type CooDigest,
  type CooPriority,
  type CooProposedAction,
  type CooRisk,
  type OperationalSignalsSource
} from './coo-agent-contract';

/**
 * Phase 4A — COO Agent digest generation.
 *
 * Deliberately rule-based, not LLM-generated: no LLM API credentials exist
 * anywhere in this project (see the gap matrix), so this does not pretend to
 * call one. What it does is real: it reads actual operational counts through
 * `OperationalSignalsSource` (read-only by that interface's own type) and
 * applies fixed, auditable thresholds to produce risks/priorities/proposed
 * actions. Wiring an LLM later to turn these structured signals into
 * higher-quality natural-language summaries is a Phase 4B+ item — the
 * signal-reading and safety-boundary work is what Phase 4A delivers.
 *
 * This function has no side effects beyond the reads it performs through
 * `signals` — it does not call saveMessage, does not call any ChannelAdapter,
 * and cannot, structurally: it never receives a ConversationStore or
 * ChannelAdapter as an argument at all.
 */

const MISMATCH_HIGH_THRESHOLD = 3;
const EXPIRING_OFFERS_WINDOW_HOURS = 24;
const ESCALATION_HIGH_THRESHOLD = 2;

export async function generateCooDigest(
  signals: OperationalSignalsSource,
  params: { accountId: string; correlationId: string; now: () => Date }
): Promise<CooDigest> {
  const [pendingApprovals, paymentMismatches, expiringOffers, escalated, pendingHuman] = await Promise.all([
    signals.countPendingApprovals(params.accountId),
    signals.countPaymentMismatches(params.accountId),
    signals.countExpiringOffers(params.accountId, EXPIRING_OFFERS_WINDOW_HOURS),
    signals.countEscalatedConversations(params.accountId),
    signals.countPendingHumanConversations(params.accountId)
  ]);

  const risks: CooRisk[] = [];
  if (paymentMismatches > 0) {
    risks.push({ label: 'Unresolved payment reconciliation mismatches', severity: paymentMismatches >= MISMATCH_HIGH_THRESHOLD ? 'HIGH' : 'MEDIUM', count: paymentMismatches });
  }
  if (escalated > 0) {
    risks.push({ label: 'Escalated conversations awaiting a human', severity: escalated >= ESCALATION_HIGH_THRESHOLD ? 'HIGH' : 'MEDIUM', count: escalated });
  }
  if (expiringOffers > 0) {
    risks.push({ label: `Offers expiring within ${EXPIRING_OFFERS_WINDOW_HOURS}h`, severity: 'MEDIUM', count: expiringOffers });
  }

  const priorities: CooPriority[] = [];
  let rank = 1;
  if (paymentMismatches > 0) priorities.push({ label: 'Resolve payment reconciliation mismatches', rank: rank++ });
  if (escalated > 0) priorities.push({ label: 'Clear escalated conversations', rank: rank++ });
  if (pendingApprovals > 0) priorities.push({ label: 'Clear pending quote approvals', rank: rank++ });
  if (expiringOffers > 0) priorities.push({ label: 'Review offers expiring soon', rank: rank++ });
  if (pendingHuman > 0) priorities.push({ label: 'Review conversations awaiting human review', rank: rank++ });

  const proposedActions: CooProposedAction[] = [];
  if (paymentMismatches > 0) {
    proposedActions.push({ kind: 'REVIEW_PAYMENT_MISMATCH', description: `${paymentMismatches} payment(s) require human reconciliation review.`, relatedEntityId: null, requiresHumanApproval: true });
  }
  if (escalated > 0) {
    proposedActions.push({ kind: 'ESCALATE_CONVERSATION', description: `${escalated} conversation(s) are escalated and awaiting a human response.`, relatedEntityId: null, requiresHumanApproval: true });
  }
  if (pendingApprovals > 0) {
    proposedActions.push({ kind: 'REVIEW_QUOTE', description: `${pendingApprovals} quote(s) are awaiting approval.`, relatedEntityId: null, requiresHumanApproval: true });
  }
  if (expiringOffers > 0) {
    proposedActions.push({ kind: 'REVIEW_EXPIRING_OFFER', description: `${expiringOffers} offer(s) expire within ${EXPIRING_OFFERS_WINDOW_HOURS}h.`, relatedEntityId: null, requiresHumanApproval: true });
  }

  const summary = risks.length === 0
    ? 'No operational risks detected. All queues within normal range.'
    : `${risks.length} operational risk area(s) detected: ${risks.map((r) => r.label.toLowerCase()).join('; ')}.`;

  const digest: CooDigest = cooDigestSchema.parse({
    digestId: randomUUID(),
    accountId: params.accountId,
    generatedAt: params.now().toISOString(),
    summary,
    risks,
    priorities,
    proposedActions,
    correlationId: params.correlationId,
    createdAt: params.now().toISOString()
  });
  return digest;
}
