import { z } from 'zod';

/**
 * Phase 4A — COO Agent contract.
 *
 * Founder decision, verbatim: the COO agent stays in scope only as a
 * read-only Daily Digest and recommendation agent. It may summarize
 * operations, identify risks, rank priorities and propose actions. It must
 * NEVER approve prices, send customer messages, execute payments, create
 * bookings, cancel services, issue refunds, or modify authoritative records.
 * Every proposed operational action requires human approval.
 *
 * `cooProposedActionKindSchema` is the structural enforcement of that list:
 * a closed enum of advisory-only action kinds. None of the forbidden
 * capabilities are members — "approve a price", "send a customer message",
 * "execute a payment", "create a booking", "cancel a service", "issue a
 * refund", and "modify an authoritative record" cannot be expressed by this
 * type, so no code path can construct a `CooProposedAction` that means one of
 * them, no matter what a future prompt or model output tries to produce.
 * There is also no field anywhere in this contract or in the `coo_digests`
 * table for "executed" — a digest is read-only by construction; turning a
 * proposed action into a real one always means a human going and using the
 * *existing*, already-HAG-gated surfaces (approveQuote, prepareBooking,
 * prepareRefundRequest, approveAndSendMessage) themselves.
 */

export const cooProposedActionKinds = [
  'REVIEW_QUOTE',           // "a human should look at this quote"
  'REVIEW_PAYMENT_MISMATCH', // "a human should look at this reconciliation exception"
  'FOLLOW_UP_WITH_CONTACT', // "a human should reach out" — the agent does not reach out itself
  'ESCALATE_CONVERSATION',  // "a human should take over this conversation"
  'REVIEW_EXPIRING_OFFER',  // "a human should decide whether to revalidate"
  'STAFFING_REVIEW',        // advisory only — no scheduling/roster system exists to act on this
  'OTHER_ADVISORY'
] as const;
export type CooProposedActionKind = (typeof cooProposedActionKinds)[number];

export const cooProposedActionSchema = z.object({
  kind: z.enum(cooProposedActionKinds),
  description: z.string().trim().min(1).max(500),
  relatedEntityId: z.uuid().nullable(),
  requiresHumanApproval: z.literal(true)
}).strict();
export type CooProposedAction = z.infer<typeof cooProposedActionSchema>;

export const cooRiskSchema = z.object({
  label: z.string().trim().min(1).max(200),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  count: z.number().int().min(0)
}).strict();
export type CooRisk = z.infer<typeof cooRiskSchema>;

export const cooPrioritySchema = z.object({
  label: z.string().trim().min(1).max(200),
  rank: z.number().int().min(1)
}).strict();
export type CooPriority = z.infer<typeof cooPrioritySchema>;

export const cooDigestSchema = z.object({
  digestId: z.uuid(),
  accountId: z.uuid(),
  generatedAt: z.iso.datetime(),
  summary: z.string().trim().min(1).max(2_000),
  risks: z.array(cooRiskSchema),
  priorities: z.array(cooPrioritySchema),
  proposedActions: z.array(cooProposedActionSchema),
  correlationId: z.string().min(1).max(128),
  createdAt: z.iso.datetime()
}).strict();
export type CooDigest = z.infer<typeof cooDigestSchema>;

/** Read-only operational signals the digest is computed from. Every method
 *  is a pure count/read — there is no method here, or anywhere reachable
 *  from generateCooDigest(), that writes anything. */
export interface OperationalSignalsSource {
  countPendingApprovals(accountId: string): Promise<number>;
  countPaymentMismatches(accountId: string): Promise<number>;
  countExpiringOffers(accountId: string, withinHours: number): Promise<number>;
  countEscalatedConversations(accountId: string): Promise<number>;
  countPendingHumanConversations(accountId: string): Promise<number>;
}
