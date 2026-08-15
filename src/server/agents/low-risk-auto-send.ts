import { randomUUID } from 'node:crypto';
import { sha256 } from '@/server/bos/canonical-json';
import type { ConversationStore } from './conversation-store';
import type { PolicyStore } from './policy-store';
import type { ChannelAdapter } from './channel-adapter';
import {
  RiskPolicyAuthorityError,
  lowRiskSendRequestSchema,
  policyHashInput,
  type LowRiskSendRequest,
  type MessageSendPolicy
} from './risk-policy-contract';
import type { Message } from './agent-contract';

/**
 * Phase 4C — the ONLY function anywhere in this codebase that can produce a
 * SENT message without a human clicking approve. It is deliberately narrow:
 *
 *   1. There must be an ACTIVE policy right now (checked at send time, not
 *      draft time — a policy deactivated between drafting and sending
 *      correctly blocks the send).
 *   2. The request's `intent` must be a member of that policy's
 *      `allowedIntents` — anything else is refused.
 *   3. The policy's OWN content hash is recomputed from its current
 *      (name, version, knowledgeVersion, allowedIntents) and compared
 *      against the stored `policyHash` — if it doesn't match, something
 *      about the "active" policy has drifted from what was actually
 *      approved, and the send is refused. This is the same stale-hash
 *      discipline used for quotes and messages, applied to the policy
 *      itself.
 *   4. The resulting message carries full evidence
 *      (policyId, policyHash, knowledgeVersion, model, agentRunId) — the
 *      exact fields the database's own CHECK constraints require before
 *      accepting a policy-authorized SENT message. Even if every check
 *      above were somehow bypassed, the database would still refuse the
 *      write.
 *
 * There is no way to reach this function for a HUMAN_APPROVAL_REQUIRED
 * message — `LowRiskSendRequest`'s `intent` field only accepts the seven
 * low-risk intents; prices, proposals, payment links, bookings, changes,
 * cancellations, refunds, and legal/exceptional claims have no
 * representation in this type at all.
 */

export type LowRiskAutoSendContext = {
  store: ConversationStore;
  policyStore: PolicyStore;
  channel: ChannelAdapter;
  correlationId: string;
  now: () => Date;
};

export async function sendLowRiskMessage(
  ctx: LowRiskAutoSendContext,
  input: LowRiskSendRequest,
  contactExternalId: string
): Promise<{ messageId: string; sent: boolean }> {
  const parsed = lowRiskSendRequestSchema.safeParse(input);
  if (!parsed.success) throw new RiskPolicyAuthorityError('Invalid low-risk send request.', 'VALIDATION');

  const policy = await ctx.policyStore.loadActivePolicy();
  if (!policy) throw new RiskPolicyAuthorityError('No active message-send policy — auto-send is refused.', 'NO_ACTIVE_POLICY');
  if (!policy.allowedIntents.includes(parsed.data.intent)) {
    throw new RiskPolicyAuthorityError(`Intent "${parsed.data.intent}" is not authorized by the active policy.`, 'INTENT_NOT_ALLOWED');
  }
  const recomputedHash = sha256(policyHashInput(policy));
  if (recomputedHash !== policy.policyHash) {
    throw new RiskPolicyAuthorityError('The active policy\'s content hash no longer matches what was approved — refusing to auto-send.', 'STALE_POLICY_HASH');
  }

  const conversation = await ctx.store.loadConversation(parsed.data.conversationId);
  if (!conversation) throw new RiskPolicyAuthorityError('Conversation not found.', 'NOT_FOUND');

  // E.2A §2 — WhatsApp low-risk auto-send is deliberately disabled for the
  // controlled first pilot. This is a fail-closed rule at the top of the
  // function, before any message row is even drafted, not just before the
  // network call — no WHATSAPP conversation can produce an auto-sent
  // message through this path regardless of policy state. All WhatsApp
  // outbound customer messages must go through the human-approved
  // canonical path (approveAndSendMessage in agent-operating-layer.ts).
  // This does not touch simulation or any other already-certified channel.
  if (conversation.channel === 'WHATSAPP') {
    await ctx.store.recordAgentAuditEvent({
      eventId: randomUUID(), conversationId: parsed.data.conversationId, messageId: null, kind: 'LOW_RISK_MESSAGE_AUTO_SENT_REFUSED',
      actorId: 'system', actorKind: 'system', correlationId: ctx.correlationId, reasonCode: 'WHATSAPP_AUTOSEND_NOT_ACTIVATED', contentHash: null
    });
    throw new RiskPolicyAuthorityError('WhatsApp low-risk auto-send is not activated for this checkpoint.', 'WHATSAPP_AUTOSEND_NOT_ACTIVATED');
  }

  const agentRunId = randomUUID();
  await ctx.policyStore.recordLlmRun({
    runId: agentRunId, conversationId: parsed.data.conversationId, messageId: null,
    modelTier: 'CHEAP', modelName: parsed.data.modelName, simulated: true, correlationId: ctx.correlationId
  });

  const messageId = randomUUID();
  const createdAt = ctx.now().toISOString();
  const message: Message = {
    messageId,
    conversationId: parsed.data.conversationId,
    direction: 'OUTBOUND',
    senderKind: 'AI_AGENT',
    agentRole: parsed.data.agentRole,
    body: parsed.data.body,
    contentHash: sha256({ conversationId: parsed.data.conversationId, body: parsed.data.body }),
    status: 'DRAFTED', // written as DRAFTED first, then flipped to SENT below only after the channel call succeeds
    requiresHumanApproval: false,
    approvedBy: null,
    approvedAt: null,
    sentAt: null,
    correlationId: ctx.correlationId,
    createdAt,
    riskClass: 'LOW_RISK_INFORMATIONAL',
    policyId: policy.policyId,
    policyHash: policy.policyHash,
    knowledgeVersion: policy.knowledgeVersion,
    model: parsed.data.modelName,
    agentRunId,
    messageType: 'TEXT'
  };
  await ctx.store.saveMessage(message);

  const result = await ctx.channel.sendOutbound({ contactExternalId, body: message.body, correlationId: ctx.correlationId });
  if (!result.ok) {
    return { messageId, sent: false };
  }

  const sentAt = ctx.now().toISOString();
  await ctx.store.saveMessage({ ...message, status: 'SENT', sentAt });
  await ctx.store.updateConversationStatus(parsed.data.conversationId, 'OPEN', sentAt);
  await ctx.store.recordAgentAuditEvent({
    eventId: randomUUID(), conversationId: parsed.data.conversationId, messageId, kind: 'LOW_RISK_MESSAGE_AUTO_SENT',
    actorId: 'system', actorKind: 'system', correlationId: ctx.correlationId, reasonCode: parsed.data.intent, contentHash: message.contentHash
  });

  return { messageId, sent: true };
}

/** Founder-only policy activation. Computes and stores the policy's own
 *  content hash from its current content — a human (the founder, AAL2,
 *  enforced by the caller) is the one who decides a policy is approved;
 *  this function only records that decision and its hash. */
export function buildApprovedPolicy(input: {
  policyId: string; policyName: string; version: number; knowledgeVersion: string;
  allowedIntents: MessageSendPolicy['allowedIntents']; approvedBy: string; correlationId: string; now: () => Date;
}): MessageSendPolicy {
  const policyHash = sha256(policyHashInput(input));
  return {
    policyId: input.policyId,
    policyName: input.policyName,
    version: input.version,
    policyHash,
    knowledgeVersion: input.knowledgeVersion,
    allowedIntents: input.allowedIntents,
    approvedBy: input.approvedBy,
    approvedAt: input.now().toISOString(),
    active: true,
    correlationId: input.correlationId,
    createdAt: input.now().toISOString()
  };
}
