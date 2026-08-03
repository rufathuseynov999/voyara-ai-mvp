import { z } from 'zod';

/**
 * Phase 4C — message risk classification and policy-gated auto-send.
 *
 * VOYARA operates 24/7 through AI, but only LOW_RISK_INFORMATIONAL messages
 * (greetings, FAQs, service explanations, lead qualification, collecting
 * destination/dates/travellers/budget, status acknowledgements, callback
 * scheduling) may ever be sent without a per-message human approval — and
 * even then, only under a founder-approved, versioned policy whose exact
 * content hash is checked at send time, exactly like every other
 * content-hash check in this project. Every other message class
 * (HUMAN_APPROVAL_REQUIRED — prices, discounts, proposals, payment links,
 * supplier availability commitments, bookings, changes, cancellations,
 * refunds, legal/exceptional claims) is completely unaffected by anything in
 * this file: it continues through the exact same AAL2 human-approval path
 * that shipped in Phase 4A, unchanged.
 */

export const lowRiskIntents = [
  'GREETING', 'FAQ', 'SERVICE_EXPLANATION', 'LEAD_QUALIFICATION',
  'COLLECT_TRIP_DETAILS', 'STATUS_ACKNOWLEDGEMENT', 'CALLBACK_SCHEDULING'
] as const;
export type LowRiskIntent = (typeof lowRiskIntents)[number];

export const messageSendPolicySchema = z.object({
  policyId: z.uuid(),
  policyName: z.string().trim().min(1).max(200),
  version: z.number().int().positive(),
  policyHash: z.string().regex(/^[0-9a-f]{64}$/),
  knowledgeVersion: z.string().trim().min(1).max(64),
  allowedIntents: z.array(z.enum(lowRiskIntents)).min(1),
  approvedBy: z.uuid(),
  approvedAt: z.iso.datetime(),
  active: z.boolean(),
  correlationId: z.string().min(1).max(128),
  createdAt: z.iso.datetime()
}).strict();
export type MessageSendPolicy = z.infer<typeof messageSendPolicySchema>;

/** What a low-risk auto-send request must supply. `intent` must be one the
 *  active policy's `allowedIntents` actually lists — checked at send time,
 *  not merely at draft time, so a policy deactivated between drafting and
 *  sending correctly blocks the send (see low-risk-auto-send.ts). */
export const lowRiskSendRequestSchema = z.object({
  conversationId: z.uuid(),
  agentRole: z.enum(['sales', 'travel_planning', 'concierge', 'operations', 'corporate', 'marketing', 'coo']),
  intent: z.enum(lowRiskIntents),
  body: z.string().trim().min(1).max(4_000),
  modelName: z.string().trim().min(1).max(120),
  correlationId: z.string().min(1).max(128)
}).strict();
export type LowRiskSendRequest = z.infer<typeof lowRiskSendRequestSchema>;

export class RiskPolicyAuthorityError extends Error {
  constructor(
    message: string,
    readonly code: 'VALIDATION' | 'NO_ACTIVE_POLICY' | 'INTENT_NOT_ALLOWED' | 'STALE_POLICY_HASH' | 'NOT_FOUND'
  ) {
    super(message);
    this.name = 'RiskPolicyAuthorityError';
  }
}

/** Canonical content a policy's hash is computed over — a policy's identity,
 *  for hashing purposes, is exactly its name, version, knowledge version,
 *  and allowed-intents list. Changing any of those without bumping the
 *  version would change the hash, which is the point: a stale hash means
 *  "this isn't the policy you think it is anymore." */
export function policyHashInput(policy: { policyName: string; version: number; knowledgeVersion: string; allowedIntents: readonly LowRiskIntent[] }) {
  return {
    policyName: policy.policyName,
    version: policy.version,
    knowledgeVersion: policy.knowledgeVersion,
    allowedIntents: [...policy.allowedIntents].sort()
  };
}
