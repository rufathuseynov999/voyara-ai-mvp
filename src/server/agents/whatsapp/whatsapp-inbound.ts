import { randomUUID } from 'node:crypto';
import { sha256 } from '@/server/bos/canonical-json';
import type { ConversationStore } from '../conversation-store';
import type { IdentityStore } from '../identity-store';
import { autoLinkIdentity, type IdentityLinkingContext } from '../identity-linking';
import type { WhatsAppChannelAdapter } from './whatsapp-adapter';
import type { WhatsAppWebhookPayload } from './whatsapp-contract';
import type { Message } from '../agent-contract';

/**
 * Phase 4C — WhatsApp inbound processing. Reuses the existing
 * `ConversationStore`/`IdentityStore` ports unchanged (no new persistence
 * concept) — an inbound WhatsApp message becomes exactly the same
 * `contacts`/`conversations`/`messages` rows an Instagram DM or website chat
 * message would, distinguished only by `channel: 'WHATSAPP'` and the brand
 * carried on the conversation. Duplicate webhook events (Meta retries
 * delivery) are rejected via the SAME reserve-first idempotency pattern
 * proven elsewhere in this project — the caller (the webhook route) must
 * reserve `whatsapp_webhook_receipts` by event id before calling this.
 */

export type WhatsAppInboundContext = {
  conversationStore: ConversationStore;
  identityStore: IdentityStore;
  adapter: WhatsAppChannelAdapter;
  accountId: string;
  brand: 'RTRAVEL' | 'VOYARA';
  correlationId: string;
  now: () => Date;
};

export async function processInboundWhatsAppMessage(
  ctx: WhatsAppInboundContext,
  payload: WhatsAppWebhookPayload
): Promise<{ messageIds: string[] }> {
  const messageIds: string[] = [];

  for (const inbound of payload.messages) {
    // Auto-link: a verified WhatsApp phone number is, by definition, a
    // verified phone — the channel itself proved the identity by virtue of
    // the customer texting from that number. No human confirmation needed,
    // matching identity-linking.ts's own rule for AUTO_VERIFIED_PHONE.
    const existingIdentity = await ctx.identityStore.findByExternalId('WHATSAPP', inbound.from);
    let contactId: string;
    if (existingIdentity) {
      contactId = existingIdentity.contactId;
    } else {
      contactId = randomUUID();
      await ctx.conversationStore.upsertContact({
        contactId, accountId: ctx.accountId, linkedCustomerId: null, displayName: null,
        phone: `+${inbound.from}`, email: null, instagramHandle: null, preferredLocale: null
      });
      const identityCtx: IdentityLinkingContext = { store: ctx.identityStore, actor: { id: 'system', assuranceLevel: 'aal2' }, correlationId: ctx.correlationId, now: ctx.now };
      await autoLinkIdentity(identityCtx, { contactId, identityKind: 'WHATSAPP', externalId: inbound.from, linkedVia: 'AUTO_VERIFIED_PHONE', correlationId: ctx.correlationId });
    }

    // One open conversation per contact+channel — reuse if it exists rather
    // than fragmenting a customer's WhatsApp thread into many conversations.
    // (Simplification for this phase: always creates a fresh conversation if
    // none is passed in; a real "find or reuse open conversation for this
    // contact" query belongs in inbox-queries.ts once WhatsApp is wired into
    // the inbox UI's data layer — noted in the final report.)
    const conversationId = randomUUID();
    await ctx.conversationStore.createConversation({
      conversationId, accountId: ctx.accountId, contactId, channel: 'WHATSAPP', status: 'OPEN',
      assignedAgentRole: null, relatedQuoteId: null, correlationId: ctx.correlationId, createdAt: ctx.now().toISOString()
    });

    const body = inbound.type === 'text' ? (inbound.text?.body ?? '') : inbound.type === 'button' ? (inbound.button?.text ?? '') : `[${inbound.type} attachment]`;
    const messageId = randomUUID();
    const message: Message = {
      messageId, conversationId, direction: 'INBOUND', senderKind: 'CONTACT', agentRole: null,
      body, contentHash: sha256({ conversationId, body, externalMessageId: inbound.id }),
      status: 'SENT', // an inbound message is already "sent" by the customer — there's nothing to approve
      requiresHumanApproval: false, approvedBy: null, approvedAt: null, sentAt: ctx.now().toISOString(),
      correlationId: ctx.correlationId, createdAt: ctx.now().toISOString(),
      riskClass: 'HUMAN_APPROVAL_REQUIRED', policyId: null, policyHash: null, knowledgeVersion: null, model: null, agentRunId: null,
      messageType: inbound.type === 'button' ? 'BUTTON_REPLY' : inbound.type === 'text' ? 'TEXT' : 'ATTACHMENT'
    };
    await ctx.conversationStore.saveMessage(message);
    await ctx.conversationStore.updateConversationStatus(conversationId, 'PENDING_HUMAN', message.sentAt!);
    messageIds.push(messageId);
  }

  return { messageIds };
}
