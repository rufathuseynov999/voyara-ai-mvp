import { randomUUID } from 'node:crypto';
import { sha256 } from '@/server/bos/canonical-json';
import type { ConversationStore } from '../conversation-store';
import type { IdentityStore } from '../identity-store';
import type { InstagramChannelAdapter } from './instagram-adapter';
import type { InstagramWebhookPayload } from './instagram-contract';
import type { Message } from '../agent-contract';

/**
 * Phase 4H — Instagram inbound processing. Reuses the existing
 * `ConversationStore`/`IdentityStore` ports unchanged, exactly like
 * whatsapp-inbound.ts — an inbound Instagram DM becomes the same
 * `contacts`/`conversations`/`messages` rows a WhatsApp message or website
 * chat message would, distinguished only by `channel: 'INSTAGRAM_DM'` and
 * the brand carried on the conversation.
 *
 * THE ONE DELIBERATE DIFFERENCE FROM whatsapp-inbound.ts: this file never
 * calls `autoLinkIdentity`. A WhatsApp phone number is, by definition, a
 * verified phone — the channel itself proved the identity. An Instagram
 * sender id (`sender.id`, Meta's opaque Instagram-Scoped User ID) proves
 * nothing about who the person actually is — it is not a phone number, not
 * an email, and Meta does not attach any verified real-world identity to
 * it. `identityLinkMethods` in identity-contract.ts only permits
 * `HUMAN_CONFIRMED` for exactly this reason, and `HUMAN_CONFIRMED` requires
 * an AAL2 staff actor at the service layer (identity-linking.ts's
 * `humanConfirmMerge`) — something a webhook handler processing an
 * unattended inbound event can never itself be. So: a first-time Instagram
 * sender gets a brand-new, deliberately UNLINKED contact (no
 * `linked_identities` row at all) whose conversation lands in the staff
 * inbox exactly like any other new contact; a staff member later performs
 * the human-confirmed link/merge through the existing inbox workflow, if
 * and when they positively identify who the person is. A RETURNING
 * Instagram sender (one whose external id was already linked by a past
 * `HUMAN_CONFIRMED` action) is recognized via a straight lookup — that is
 * not auto-linking, it is reusing a link a human already made.
 */

export type InstagramInboundContext = {
  conversationStore: ConversationStore;
  identityStore: IdentityStore;
  adapter: InstagramChannelAdapter;
  accountId: string;
  brand: 'RTRAVEL' | 'VOYARA';
  correlationId: string;
  now: () => Date;
};

export async function processInboundInstagramMessage(
  ctx: InstagramInboundContext,
  payload: InstagramWebhookPayload
): Promise<{ messageIds: string[] }> {
  const messageIds: string[] = [];
  const identityKind = ctx.brand === 'RTRAVEL' ? 'INSTAGRAM_RTRAVEL' as const : 'INSTAGRAM_VOYARA' as const;

  for (const entry of payload.entry) {
    for (const event of entry.messaging) {
      if (!event.message) continue; // delivery/read receipts, not a DM — nothing to normalize yet

      const senderId = event.sender.id;

      // Lookup only — NEVER an auto-link. See the file header. A hit here
      // means a human already confirmed this externalId belongs to this
      // contact at some point in the past; a miss means a brand-new,
      // deliberately unlinked contact is created below.
      const existingIdentity = await ctx.identityStore.findByExternalId(identityKind, senderId);
      let contactId: string;
      if (existingIdentity) {
        contactId = existingIdentity.contactId;
      } else {
        contactId = randomUUID();
        await ctx.conversationStore.upsertContact({
          contactId, accountId: ctx.accountId, linkedCustomerId: null, displayName: null,
          phone: null, email: null, instagramHandle: senderId, preferredLocale: null
        });
        // Deliberately no autoLinkIdentity call and no saveLinkedIdentity
        // call here — this contact remains unlinked until a staff member
        // performs a HUMAN_CONFIRMED merge through the inbox. Nothing in
        // this function invents or simulates that confirmation.
      }

      const conversationId = randomUUID();
      await ctx.conversationStore.createConversation({
        conversationId, accountId: ctx.accountId, contactId, channel: 'INSTAGRAM_DM', status: 'OPEN',
        assignedAgentRole: null, relatedQuoteId: null, correlationId: ctx.correlationId, createdAt: ctx.now().toISOString()
      });

      const body = event.message.text ?? '[unsupported attachment]';
      const messageId = randomUUID();
      const message: Message = {
        messageId, conversationId, direction: 'INBOUND', senderKind: 'CONTACT', agentRole: null,
        body, contentHash: sha256({ conversationId, body, externalMessageId: event.message.mid }),
        status: 'SENT', // an inbound message is already "sent" by the customer — there's nothing to approve
        requiresHumanApproval: false, approvedBy: null, approvedAt: null, sentAt: ctx.now().toISOString(),
        correlationId: ctx.correlationId, createdAt: ctx.now().toISOString(),
        riskClass: 'HUMAN_APPROVAL_REQUIRED', policyId: null, policyHash: null, knowledgeVersion: null, model: null, agentRunId: null,
        messageType: 'TEXT'
      };
      await ctx.conversationStore.saveMessage(message);
      await ctx.conversationStore.updateConversationStatus(conversationId, 'PENDING_HUMAN', message.sentAt!);
      messageIds.push(messageId);
    }
  }

  return { messageIds };
}
