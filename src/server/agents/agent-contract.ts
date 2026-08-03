import { z } from 'zod';

/**
 * Phase 4A — AI Agent Operating Layer contracts.
 *
 * Mirrors the exact HAG discipline already proven for suppliers (Phase 3C
 * Part 2) and payments (Part 3): an agent's only output is a DRAFT. Nothing
 * in this contract, or anywhere downstream of it, can mark a message SENT
 * without a real human `approvedBy` actor — `messageStatusSchema`'s SENT
 * value has no path to it that skips `approveAndSendMessage()`
 * (agent-operating-layer.ts), and the database itself enforces this with a
 * CHECK constraint (`messages_sent_requires_approval`), not just application
 * code — belt and suspenders, same as every other HAG boundary in this
 * project.
 */

export const channelKinds = ['VOICE', 'WEB_CHAT', 'WHATSAPP', 'INSTAGRAM_DM', 'EMAIL', 'SIMULATION'] as const;
export type ChannelKind = (typeof channelKinds)[number];

export const agentRoles = [
  'sales', 'travel_planning', 'concierge', 'operations',
  'corporate', 'marketing', 'coo', 'human_staff'
] as const;
export type AgentRole = (typeof agentRoles)[number];

export const conversationStatuses = ['OPEN', 'PENDING_HUMAN', 'RESOLVED', 'ESCALATED'] as const;
export type ConversationStatus = (typeof conversationStatuses)[number];

export const messageStatuses = ['DRAFTED', 'APPROVED', 'REJECTED', 'SENT'] as const;
export type MessageStatus = (typeof messageStatuses)[number];

export const messageDirections = ['INBOUND', 'OUTBOUND'] as const;
export type MessageDirection = (typeof messageDirections)[number];

export const messageSenderKinds = ['CONTACT', 'AI_AGENT', 'STAFF'] as const;
export type MessageSenderKind = (typeof messageSenderKinds)[number];

/* --------------------------------- Contact --------------------------------- */

export const contactSchema = z.object({
  contactId: z.uuid(),
  accountId: z.uuid(),
  linkedCustomerId: z.uuid().nullable(),
  displayName: z.string().trim().max(200).nullable(),
  phone: z.string().trim().max(32).nullable(),
  email: z.email().nullable(),
  instagramHandle: z.string().trim().max(64).nullable(),
  preferredLocale: z.enum(['az', 'ru', 'en']).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
}).strict();
export type Contact = z.infer<typeof contactSchema>;

/* ------------------------------- Conversation ------------------------------- */

export const conversationSchema = z.object({
  conversationId: z.uuid(),
  accountId: z.uuid(),
  contactId: z.uuid(),
  channel: z.enum(channelKinds),
  status: z.enum(conversationStatuses),
  assignedAgentRole: z.enum(agentRoles).nullable(),
  relatedQuoteId: z.uuid().nullable(),
  correlationId: z.string().min(1).max(128),
  createdAt: z.iso.datetime(),
  lastMessageAt: z.iso.datetime().nullable()
}).strict();
export type Conversation = z.infer<typeof conversationSchema>;

/* ---------------------------------- Message ---------------------------------- */

/** A message an AI agent has drafted. `requiresHumanApproval` is the literal
 *  `true` type (never a plain boolean) — the same device used for
 *  `BookingPreparationPayload` and `RefundRequestPreparation`. No object
 *  matching this type can be constructed with that field set to `false`. */
export const agentDraftSchema = z.object({
  conversationId: z.uuid(),
  agentRole: z.enum(agentRoles).exclude(['human_staff']),
  body: z.string().trim().min(1).max(4_000),
  requiresHumanApproval: z.literal(true),
  correlationId: z.string().min(1).max(128)
}).strict();
export type AgentDraft = z.infer<typeof agentDraftSchema>;

export const messageRiskClasses = ['LOW_RISK_INFORMATIONAL', 'HUMAN_APPROVAL_REQUIRED'] as const;
export type MessageRiskClass = (typeof messageRiskClasses)[number];

export const messageTypes = ['TEXT', 'TEMPLATE', 'BUTTON_REPLY', 'ATTACHMENT'] as const;
export type MessageType = (typeof messageTypes)[number];

/**
 * Phase 4C — extended in place (not duplicated): every field below is new,
 * every field above is unchanged. The two refines are widened with an
 * OR-branch for policy-gated low-risk auto-send, mirroring the database's
 * own `messages_sent_requires_approval_or_policy` /
 * `messages_agent_drafts_require_approval_or_policy` constraints exactly —
 * the human-approval branch of each refine is byte-for-byte what shipped in
 * Phase 4A; nothing about it changed.
 */
function hasCompletePolicyAuthorization(message: {
  riskClass: MessageRiskClass; policyId: string | null; policyHash: string | null;
  knowledgeVersion: string | null; model: string | null; agentRunId: string | null;
}): boolean {
  return message.riskClass === 'LOW_RISK_INFORMATIONAL'
    && message.policyId !== null && message.policyHash !== null
    && message.knowledgeVersion !== null && message.model !== null && message.agentRunId !== null;
}

export const messageSchema = z.object({
  messageId: z.uuid(),
  conversationId: z.uuid(),
  direction: z.enum(messageDirections),
  senderKind: z.enum(messageSenderKinds),
  agentRole: z.enum(agentRoles).nullable(),
  body: z.string().min(1).max(4_000),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  status: z.enum(messageStatuses),
  requiresHumanApproval: z.boolean(),
  approvedBy: z.uuid().nullable(),
  approvedAt: z.iso.datetime().nullable(),
  sentAt: z.iso.datetime().nullable(),
  correlationId: z.string().min(1).max(128),
  createdAt: z.iso.datetime(),
  riskClass: z.enum(messageRiskClasses),
  policyId: z.uuid().nullable(),
  policyHash: z.string().nullable(),
  knowledgeVersion: z.string().nullable(),
  model: z.string().nullable(),
  agentRunId: z.uuid().nullable(),
  messageType: z.enum(messageTypes)
}).strict().refine(
  (message) => message.status !== 'SENT' || message.direction === 'INBOUND' || (message.approvedBy !== null && message.approvedAt !== null) || hasCompletePolicyAuthorization(message),
  { message: 'a SENT outbound message must carry a human approver, or complete low-risk policy authorization (inbound messages are exempt — a customer\'s own message needs no VOYARA approval)' }
).refine(
  (message) => message.senderKind !== 'AI_AGENT' || message.requiresHumanApproval === true || hasCompletePolicyAuthorization(message),
  { message: 'every AI-agent-authored message requires human approval, or complete low-risk policy authorization' }
).refine(
  (message) => message.riskClass !== 'HUMAN_APPROVAL_REQUIRED' || message.policyId === null,
  { message: 'a HUMAN_APPROVAL_REQUIRED message can never carry policy authorization' }
);
export type Message = z.infer<typeof messageSchema>;

/* ------------------------------- Errors / results ---------------------------- */

export type AgentErrorKind = 'VALIDATION' | 'NOT_FOUND' | 'ALREADY_APPROVED' | 'STALE_CONTENT_HASH' | 'CHANNEL_UNAVAILABLE';

export class AgentAuthorityError extends Error {
  constructor(message: string, readonly code: AgentErrorKind) {
    super(message);
    this.name = 'AgentAuthorityError';
  }
}
