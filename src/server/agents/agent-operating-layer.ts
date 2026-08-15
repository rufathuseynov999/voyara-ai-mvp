import { randomUUID } from 'node:crypto';
import { sha256 } from '@/server/bos/canonical-json';
import { reportError } from '@/server/observability/error-reporter';
import type { ChannelAdapter } from './channel-adapter';
import type { ConversationStore } from './conversation-store';
import type { IdentityStore } from './identity-store';
import {
  AgentAuthorityError,
  agentDraftSchema,
  type AgentDraft,
  type Conversation,
  type Message
} from './agent-contract';

/**
 * Phase 4A — AI Agent Operating Layer.
 *
 * The single choke point every agent-authored message must pass through.
 * Structurally identical to the HAG already proven for quotes (content-hash
 * approval) and supplier/payment preparation (requiresHumanApproval literal
 * types): an agent can only ever DRAFT; only a real human actor, identified
 * by their own id, approving the EXACT content hash of that draft, can move
 * a message toward being sent; only after that can sendOutbound() be called.
 *
 * There is no function in this file, or anywhere in this layer, that lets an
 * agent send a message directly. `draftAgentMessage` never touches a
 * ChannelAdapter. Only `approveAndSendMessage` does, and only after loading
 * the message back from the store and checking `status === 'APPROVED'`.
 */

export type AgentOperatingContext = {
  store: ConversationStore;
  /** E.2A — only required for WhatsApp sends (verified-identity recipient
   *  resolution). Other channels never read this. */
  identityStore?: IdentityStore;
  channel: ChannelAdapter;
  actor: { id: string; kind: 'human' | 'agent' | 'system' };
  accountId: string;
  correlationId: string;
  now: () => Date;
};

async function audit(
  ctx: AgentOperatingContext,
  kind: string,
  conversationId: string | null,
  messageId: string | null,
  reasonCode?: string,
  contentHash?: string
): Promise<void> {
  await ctx.store.recordAgentAuditEvent({
    eventId: randomUUID(),
    conversationId,
    messageId,
    kind,
    actorId: ctx.actor.id,
    actorKind: ctx.actor.kind,
    correlationId: ctx.correlationId,
    reasonCode: reasonCode ?? null,
    contentHash: contentHash ?? null
  });
}

/** Starts a new conversation for a contact on a channel. Purely
 *  record-keeping — no message is sent or drafted by this call. */
export async function startConversation(
  ctx: AgentOperatingContext,
  input: { contactId: string; channel: Conversation['channel']; relatedQuoteId?: string | null }
): Promise<{ conversationId: string }> {
  const conversationId = randomUUID();
  const conversation: Omit<Conversation, 'lastMessageAt'> = {
    conversationId,
    accountId: ctx.accountId,
    contactId: input.contactId,
    channel: input.channel,
    status: 'OPEN',
    assignedAgentRole: null,
    relatedQuoteId: input.relatedQuoteId ?? null,
    correlationId: ctx.correlationId,
    createdAt: ctx.now().toISOString()
  };
  await ctx.store.createConversation(conversation);
  await audit(ctx, 'CONVERSATION_STARTED', conversationId, null);
  return { conversationId };
}

/** An AI agent drafts a message. This function NEVER sends anything — it can
 *  only ever produce a `status: 'DRAFTED'` record. `agentDraftSchema` makes
 *  it impossible to construct input where `requiresHumanApproval` is
 *  anything but the literal `true`. */
export async function draftAgentMessage(ctx: AgentOperatingContext, input: AgentDraft): Promise<{ messageId: string }> {
  const parsed = agentDraftSchema.safeParse(input);
  if (!parsed.success) throw new AgentAuthorityError('Invalid agent draft input.', 'VALIDATION');

  const conversation = await ctx.store.loadConversation(parsed.data.conversationId);
  if (!conversation) throw new AgentAuthorityError('Conversation not found.', 'NOT_FOUND');

  const messageId = randomUUID();
  const contentHash = sha256({ conversationId: parsed.data.conversationId, agentRole: parsed.data.agentRole, body: parsed.data.body });
  const message: Message = {
    messageId,
    conversationId: parsed.data.conversationId,
    direction: 'OUTBOUND',
    senderKind: 'AI_AGENT',
    agentRole: parsed.data.agentRole,
    body: parsed.data.body,
    contentHash,
    status: 'DRAFTED',
    requiresHumanApproval: true,
    approvedBy: null,
    approvedAt: null,
    sentAt: null,
    correlationId: parsed.data.correlationId,
    createdAt: ctx.now().toISOString(),
    riskClass: 'HUMAN_APPROVAL_REQUIRED',
    policyId: null,
    policyHash: null,
    knowledgeVersion: null,
    model: null,
    agentRunId: null,
    messageType: 'TEXT'
  };
  await ctx.store.saveMessage(message);
  await ctx.store.updateConversationStatus(parsed.data.conversationId, 'PENDING_HUMAN', message.createdAt);
  await audit(ctx, 'MESSAGE_DRAFTED', parsed.data.conversationId, messageId, undefined, contentHash);
  return { messageId };
}

/** A human reviews and approves an agent's draft BY EXACT CONTENT HASH — the
 *  same stale-hash-rejection discipline already proven for quote approval.
 *  If the draft's content has changed since the human last saw it (it
 *  cannot, today, since nothing edits a DRAFTED message — but the check
 *  exists so that guarantee is structural, not just "true because nothing
 *  currently violates it"), approval is refused. */
export async function approveMessage(
  ctx: AgentOperatingContext,
  messageId: string,
  expectedContentHash: string
): Promise<void> {
  if (ctx.actor.kind !== 'human') throw new AgentAuthorityError('Only a human actor may approve a message.', 'VALIDATION');

  const message = await ctx.store.loadMessage(messageId);
  if (!message) throw new AgentAuthorityError('Message not found.', 'NOT_FOUND');
  if (message.status !== 'DRAFTED') throw new AgentAuthorityError(`Message is not in DRAFTED status (currently ${message.status}).`, 'ALREADY_APPROVED');
  if (message.contentHash !== expectedContentHash) throw new AgentAuthorityError('Stale content hash — the draft changed since it was reviewed.', 'STALE_CONTENT_HASH');

  const approved: Message = {
    ...message,
    status: 'APPROVED',
    approvedBy: ctx.actor.id,
    approvedAt: ctx.now().toISOString()
  };
  await ctx.store.saveMessage(approved);
  await audit(ctx, 'MESSAGE_APPROVED', message.conversationId, messageId, undefined, message.contentHash);
}

export async function rejectMessage(ctx: AgentOperatingContext, messageId: string, reasonCode: string): Promise<void> {
  if (ctx.actor.kind !== 'human') throw new AgentAuthorityError('Only a human actor may reject a message.', 'VALIDATION');
  const message = await ctx.store.loadMessage(messageId);
  if (!message) throw new AgentAuthorityError('Message not found.', 'NOT_FOUND');
  if (message.status !== 'DRAFTED') throw new AgentAuthorityError(`Message is not in DRAFTED status (currently ${message.status}).`, 'ALREADY_APPROVED');
  await ctx.store.saveMessage({ ...message, status: 'REJECTED' });
  await audit(ctx, 'MESSAGE_REJECTED', message.conversationId, messageId, reasonCode);
}

/** The ONLY function anywhere in this layer that calls a ChannelAdapter. It
 *  requires the message to already be APPROVED (i.e. approveMessage() ran
 *  first, by a human) — an agent-drafted message can never reach this
 *  function's send call without that step, and the database's own CHECK
 *  constraint (`messages_sent_requires_approval`) refuses the write even if
 *  application logic were somehow bypassed.
 *
 *  E.2A: this remains the ONE canonical send path for every channel,
 *  including WhatsApp. `contactExternalId` is now optional — for WhatsApp,
 *  the recipient is ALWAYS resolved from the conversation's own linked
 *  contact record (never trusted from a caller-supplied value), which also
 *  structurally prevents a cross-contact/cross-conversation/cross-brand
 *  recipient substitution: the phone number sent to is the one actually on
 *  file for message.conversationId's contactId, full stop. Other channels
 *  (voice, web chat, Instagram) keep the existing explicit
 *  contactExternalId behaviour unchanged — this is additive, not a
 *  behaviour change for them. */
export async function approveAndSendMessage(ctx: AgentOperatingContext, messageId: string, contactExternalId?: string): Promise<{ sent: boolean }> {
  const message = await ctx.store.loadMessage(messageId);
  if (!message) throw new AgentAuthorityError('Message not found.', 'NOT_FOUND');
  if (message.status !== 'APPROVED') {
    throw new AgentAuthorityError(`Message must be APPROVED before it can be sent (currently ${message.status}).`, 'VALIDATION');
  }

  const conversation = await ctx.store.loadConversation(message.conversationId);
  if (!conversation) throw new AgentAuthorityError('Conversation not found.', 'NOT_FOUND');

  if (conversation.channel === 'WHATSAPP') {
    return sendApprovedWhatsAppMessageInternal(ctx, message, conversation);
  }

  if (!contactExternalId) throw new AgentAuthorityError('contactExternalId is required for this channel.', 'VALIDATION');
  const result = await ctx.channel.sendOutbound({ contactExternalId, body: message.body, correlationId: ctx.correlationId });
  if (!result.ok) {
    await audit(ctx, 'MESSAGE_SEND_FAILED', message.conversationId, messageId, result.error.code);
    reportError(new Error(`channel send failed: ${result.error.code}`), { code: 'AGENT_MESSAGE_SEND_FAILED', messageId });
    return { sent: false };
  }

  const sent: Message = { ...message, status: 'SENT', sentAt: ctx.now().toISOString() };
  await ctx.store.saveMessage(sent);
  await ctx.store.updateConversationStatus(message.conversationId, 'OPEN', sent.sentAt!);
  await audit(ctx, 'MESSAGE_SENT', message.conversationId, messageId, undefined, message.contentHash);
  return { sent: true };
}

/**
 * E.2A §1 — the ONLY way this layer resolves a WhatsApp send destination.
 * `contacts.phone` alone is never trusted as recipient authority — it can
 * exist without ever having been proven to be this contact's verified
 * WhatsApp identity (e.g. entered by staff from a different channel). This
 * requires a real `LinkedIdentity` row with `identityKind: 'WHATSAPP'`,
 * `verified: true`, and `contactId` matching exactly. If `contacts.phone`
 * is also present, it must agree with the verified identity's externalId
 * (allowing for a leading '+') or the operation fails closed — a
 * disagreement between the two is treated as a real inconsistency worth
 * refusing to send over, not something to silently prefer one side of.
 */
type VerifiedRecipientResult =
  | { ok: true; externalId: string }
  | { ok: false; reasonCode: 'WHATSAPP_NO_VERIFIED_IDENTITY' | 'WHATSAPP_AMBIGUOUS_IDENTITY' | 'WHATSAPP_PHONE_IDENTITY_MISMATCH' };

async function resolveVerifiedWhatsAppRecipient(
  store: ConversationStore,
  identityStore: IdentityStore,
  contactId: string
): Promise<VerifiedRecipientResult> {
  const identities = await identityStore.listIdentitiesForContact(contactId);
  const verifiedWhatsApp = identities.filter((identity) => identity.identityKind === 'WHATSAPP' && identity.verified === true && identity.contactId === contactId);

  if (verifiedWhatsApp.length === 0) return { ok: false, reasonCode: 'WHATSAPP_NO_VERIFIED_IDENTITY' };
  if (verifiedWhatsApp.length > 1) {
    // More than one verified WhatsApp identity for the same contact is an
    // ambiguous state this layer refuses to guess between, rather than
    // silently picking the first/most-recent one.
    return { ok: false, reasonCode: 'WHATSAPP_AMBIGUOUS_IDENTITY' };
  }

  const identity = verifiedWhatsApp[0];
  const contact = await store.loadContact(contactId);
  if (contact?.phone) {
    const normalizedPhone = contact.phone.replace(/^\+/, '');
    const normalizedIdentity = identity.externalId.replace(/^\+/, '');
    if (normalizedPhone !== normalizedIdentity) {
      return { ok: false, reasonCode: 'WHATSAPP_PHONE_IDENTITY_MISMATCH' };
    }
  }

  return { ok: true, externalId: `+${identity.externalId.replace(/^\+/, '')}` };
}

/**
 * E.2A — internal helper, invoked ONLY by approveAndSendMessage above. Not
 * exported; there is no route or client entrypoint that can reach this
 * function without going through the same approval check every other
 * channel's send goes through. Resolves the recipient from the
 * conversation's own contact record — never from caller input — which is
 * what makes cross-contact/cross-brand recipient substitution structurally
 * impossible rather than merely validated against.
 */
async function sendApprovedWhatsAppMessageInternal(
  ctx: AgentOperatingContext,
  message: Message,
  conversation: Conversation
): Promise<{ sent: boolean }> {
  if (conversation.channel !== 'WHATSAPP') {
    throw new AgentAuthorityError('sendApprovedWhatsAppMessageInternal called for a non-WHATSAPP conversation.', 'VALIDATION');
  }
  if (!conversation.customerFacingBrand) {
    await audit(ctx, 'MESSAGE_SEND_FAILED', message.conversationId, message.messageId, 'WHATSAPP_MISSING_BRAND');
    return { sent: false };
  }
  if (!ctx.identityStore) {
    await audit(ctx, 'MESSAGE_SEND_FAILED', message.conversationId, message.messageId, 'WHATSAPP_NO_IDENTITY_STORE');
    return { sent: false };
  }
  const recipient = await resolveVerifiedWhatsAppRecipient(ctx.store, ctx.identityStore, conversation.contactId);
  if (!recipient.ok) {
    await audit(ctx, 'MESSAGE_SEND_FAILED', message.conversationId, message.messageId, recipient.reasonCode);
    return { sent: false };
  }

  const result = await ctx.channel.sendOutbound({
    contactExternalId: recipient.externalId,
    body: message.body,
    correlationId: ctx.correlationId,
    lastInboundAt: conversation.lastInboundAt ? new Date(conversation.lastInboundAt) : null
  });

  if (!result.ok) {
    await audit(ctx, 'MESSAGE_SEND_FAILED', message.conversationId, message.messageId, result.error.code);
    reportError(new Error(`WhatsApp send failed: ${result.error.code}`), { code: 'AGENT_WHATSAPP_SEND_FAILED', messageId: message.messageId });
    return { sent: false };
  }

  const sentAt = ctx.now().toISOString();
  await ctx.store.saveMessage({
    ...message,
    status: 'SENT',
    sentAt,
    externalMessageId: result.value.externalMessageId,
    deliveryStatus: 'PENDING',
    webhookStatus: null
  });
  // Outbound-only write: last_message_at is bumped, last_inbound_at is
  // never touched (updateConversationStatus, not recordInboundActivity).
  await ctx.store.updateConversationStatus(message.conversationId, conversation.status, sentAt);
  await audit(ctx, 'MESSAGE_SENT', message.conversationId, message.messageId, undefined, message.contentHash);
  return { sent: true };
}

export async function escalateConversation(ctx: AgentOperatingContext, conversationId: string, reasonCode: string): Promise<void> {
  const conversation = await ctx.store.loadConversation(conversationId);
  if (!conversation) throw new AgentAuthorityError('Conversation not found.', 'NOT_FOUND');
  await ctx.store.updateConversationStatus(conversationId, 'ESCALATED', ctx.now().toISOString());
  await audit(ctx, 'CONVERSATION_ESCALATED', conversationId, null, reasonCode);
}
