import { randomUUID } from 'node:crypto';
import { sha256 } from '@/server/bos/canonical-json';
import type { ConversationStore } from '../conversation-store';
import type { IdentityStore } from '../identity-store';
import { autoLinkIdentity, type IdentityLinkingContext } from '../identity-linking';
import type { WhatsAppChannelAdapter } from './whatsapp-adapter';
import type { WhatsAppWebhookPayload } from './whatsapp-contract';
import type { Message } from '../agent-contract';
import { ActiveConversationConflictError, MessageReplayConflictError } from '@/server/conversation/conversation-store-errors';

/** E.2A §1 — see WhatsAppInboundContext.brand's doc comment. */
export type WhatsAppCustomerFacingBrand = 'RTRAVEL' | 'VOYARA';

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

/** E.2A §4 — parses Meta's inbound message `timestamp` field (documented
 *  as a numeric string of seconds since epoch) into a real ISO datetime,
 *  or null if the value cannot be trusted as evidence. Deliberately
 *  strict: malformed strings, negative values, non-finite values, and
 *  implausibly far-future values (more than 1 day ahead of `now`, which
 *  would indicate seconds/milliseconds confusion or a corrupted payload)
 *  all return null rather than guessing. Callers must never substitute
 *  webhook-ingestion time for a null result when the timestamp is meant
 *  as message-specific evidence (see processInboundWhatsAppMessage).
 */
export function parseMetaMessageTimestamp(rawTimestamp: string, now: Date = new Date()): string | null {
  if (!/^\d+$/.test(rawTimestamp)) return null; // not a plain digit string — no sign, no decimal, no milliseconds suffix guessing
  const seconds = Number(rawTimestamp);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const asDate = new Date(seconds * 1_000);
  if (Number.isNaN(asDate.getTime())) return null;
  const oneDayAheadMs = now.getTime() + 24 * 60 * 60 * 1_000;
  if (asDate.getTime() > oneDayAheadMs) return null; // implausible far-future value
  return asDate.toISOString();
}

/**
 * E.2A §2 — the full authoritative-evidence comparison that decides
 * whether a (channel, externalMessageId) hit is genuinely the identical
 * prior event (safe to treat as a no-op replay) or a real conflict (fail
 * closed). Every field listed in the spec is checked — account, contact,
 * brand, direction, sender kind, content hash, and provider time. A
 * mismatch on ANY field means this is NOT a safe replay.
 */
export function isGenuineWhatsAppReplay(
  existing: { message: { direction: string; senderKind: string; contentHash: string; providerOccurredAt?: string | null }; accountId: string; contactId: string; customerFacingBrand?: string | null },
  candidate: { accountId: string; contactId: string; customerFacingBrand: string | null; contentHash: string; providerOccurredAt: string | null }
): boolean {
  return (
    existing.accountId === candidate.accountId &&
    existing.contactId === candidate.contactId &&
    (existing.customerFacingBrand ?? null) === candidate.customerFacingBrand &&
    existing.message.direction === 'INBOUND' &&
    existing.message.senderKind === 'CONTACT' &&
    existing.message.contentHash === candidate.contentHash &&
    (existing.message.providerOccurredAt ?? null) === candidate.providerOccurredAt
  );
}

export type WhatsAppInboundContext = {
  conversationStore: ConversationStore;
  identityStore: IdentityStore;
  adapter: WhatsAppChannelAdapter;
  accountId: string;
  /**
   * E.2A §1 — deliberately NOT `Conversation['customerFacingBrand']`
   * (which is nullable, to stay backward compatible with legacy
   * non-brand-aware channels). WhatsApp requires a real resolved brand for
   * every operation; this narrower type makes "no brand" a compile error
   * here, and the caller (the webhook route) can only reach this function
   * after a real `whatsapp_accounts` row lookup succeeded — there is no
   * code path from WhatsApp into `findOpenConversation`'s `.is(null)`
   * branch.
   */
  brand: WhatsAppCustomerFacingBrand;
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

    // E.2A §2 — message-replay pre-check, BEFORE any conversation/message
    // mutation. Meta webhooks are at-least-once; if this exact
    // (channel, externalMessageId) was already fully processed, this
    // returns the existing message id with zero further side effects
    // (no second message, no conversation mutation, no re-extension of
    // the service window) rather than re-running everything.
    const existingByExternalId = await ctx.conversationStore.loadMessageByExternalId('WHATSAPP', inbound.id);
    if (existingByExternalId) {
      const candidateProviderOccurredAt = parseMetaMessageTimestamp(inbound.timestamp, ctx.now());
      const candidateBody = inbound.type === 'text' ? (inbound.text?.body ?? '') : inbound.type === 'button' ? (inbound.button?.text ?? '') : `[${inbound.type} attachment]`;
      const candidateHash = sha256({ conversationId: existingByExternalId.conversationId, body: candidateBody, externalMessageId: inbound.id });
      if (isGenuineWhatsAppReplay(existingByExternalId, {
        accountId: ctx.accountId, contactId, customerFacingBrand: ctx.brand,
        contentHash: candidateHash, providerOccurredAt: candidateProviderOccurredAt
      })) {
        // Genuinely the same event, already fully processed — idempotent
        // no-op. Never re-run recordInboundActivity (would extend the
        // service window a second time for a replay) or save a second
        // message row.
        messageIds.push(existingByExternalId.message.messageId);
        continue;
      }
      // Same external id, but the evidence or authority context doesn't
      // match — fail closed rather than silently overwriting or
      // fabricating a second logical event for the same provider id.
      throw new Error(`WHATSAPP_REPLAY_EVIDENCE_MISMATCH: external_message_id ${inbound.id} already exists with different evidence/authority context.`);
    }

    // E.2A fix: reuse the customer's existing open WhatsApp thread instead
    // of fragmenting every inbound message into its own new conversation.
    // Scoped to this exact (accountId, contactId, channel) — never crosses
    // contacts or channels. See findOpenConversation's own doc comment for
    // the one known remaining concurrency edge case (near-simultaneous
    // first-contact messages), which is a migration-29 candidate flagged
    // in the final report rather than silently accepted or silently fixed
    // with an unapproved schema change.
    const existingConversation = await ctx.conversationStore.findOpenConversation({
      accountId: ctx.accountId,
      contactId,
      channel: 'WHATSAPP',
      customerFacingBrand: ctx.brand
    });
    const conversationId = existingConversation?.conversationId ?? randomUUID();
    let realConversationId = conversationId;
    if (!existingConversation) {
      try {
        await ctx.conversationStore.createConversation({
          conversationId, accountId: ctx.accountId, contactId, channel: 'WHATSAPP', status: 'OPEN',
          assignedAgentRole: null, relatedQuoteId: null, correlationId: ctx.correlationId, createdAt: ctx.now().toISOString(),
          customerFacingBrand: ctx.brand, handoverStatus: 'HUMAN', lastInboundAt: null
        });
      } catch (error) {
        // E.2A §6A — typed 23505 recovery for the real concurrency race
        // migration 29's whatsapp_conversations_active_uidx exists to
        // close: two inbound messages for a brand-new contact arriving
        // within milliseconds of each other. The loser here re-reads the
        // EXACT same (account, contact, channel, brand) scope — never a
        // looser one — and reuses whichever conversation actually won.
        // If no matching winner can be found (a genuinely unexpected
        // state), this fails closed by rethrowing the original error
        // rather than fabricating a conversation id.
        if (error instanceof ActiveConversationConflictError) {
          const winner = await ctx.conversationStore.findOpenConversation({
            accountId: error.accountId, contactId: error.contactId, channel: error.channel, customerFacingBrand: error.customerFacingBrand
          });
          if (!winner) throw error;
          realConversationId = winner.conversationId;
        } else {
          throw error;
        }
      }
    }

    // E.2A §0/§4: providerOccurredAt IS the service-window evidence now —
    // there is no separate "conversation activity" fallback anymore. An
    // untrusted/missing Meta timestamp must never open or extend the
    // WhatsApp service window, so recordInboundActivity receives `null`
    // in that case (see its own doc comment) rather than a guessed value.
    // The message itself is still safely recorded either way — a human
    // still needs to see it — this only affects lastInboundAt.
    const providerOccurredAt = parseMetaMessageTimestamp(inbound.timestamp, ctx.now());

    const body = inbound.type === 'text' ? (inbound.text?.body ?? '') : inbound.type === 'button' ? (inbound.button?.text ?? '') : `[${inbound.type} attachment]`;
    const messageId = randomUUID();
    const message: Message = {
      messageId, conversationId: realConversationId, direction: 'INBOUND', senderKind: 'CONTACT', agentRole: null,
      body, contentHash: sha256({ conversationId: realConversationId, body, externalMessageId: inbound.id }),
      status: 'SENT', // an inbound message is already "sent" by the customer — there's nothing to approve
      requiresHumanApproval: false, approvedBy: null, approvedAt: null, sentAt: ctx.now().toISOString(),
      correlationId: ctx.correlationId, createdAt: ctx.now().toISOString(),
      riskClass: 'HUMAN_APPROVAL_REQUIRED', policyId: null, policyHash: null, knowledgeVersion: null, model: null, agentRunId: null,
      messageType: inbound.type === 'button' ? 'BUTTON_REPLY' : inbound.type === 'text' ? 'TEXT' : 'ATTACHMENT',
      externalMessageId: inbound.id, deliveryStatus: null, webhookStatus: null,
      providerOccurredAt
    };
    try {
      await ctx.conversationStore.saveMessage(message);
    } catch (error) {
      // E.2A §2E — concurrent-race catch: two webhook workers could both
      // pass the pre-check (loadMessageByExternalId found nothing yet)
      // before either had inserted. The loser here reloads by the exact
      // (channel, externalMessageId) and performs the SAME full-evidence
      // comparison as the pre-check — never a looser one — before
      // treating it as a safe replay. A genuinely different conflict
      // (evidence mismatch, or an unrelated error) still fails closed.
      if (error instanceof MessageReplayConflictError) {
        const winner = await ctx.conversationStore.loadMessageByExternalId(error.channel, error.externalMessageId);
        if (winner && isGenuineWhatsAppReplay(winner, {
          accountId: ctx.accountId, contactId, customerFacingBrand: ctx.brand,
          contentHash: message.contentHash, providerOccurredAt: message.providerOccurredAt ?? null
        })) {
          messageIds.push(winner.message.messageId);
          continue;
        }
      }
      throw error;
    }
    // E.2A fix: this is now the ONLY store call for inbound activity —
    // last_inbound_at, last_message_at, status, and handover_status are
    // all updated together here (or status/handover only, when
    // providerOccurredAt is null), via the dedicated method that a
    // generic outbound send/draft path can never call (see
    // conversation-store.ts). The webhook itself still succeeds (200,
    // message recorded) even when the timestamp is untrustworthy — this
    // never causes a retry storm; it only means the service window isn't
    // advanced.
    await ctx.conversationStore.recordInboundActivity({
      conversationId: realConversationId,
      inboundAt: providerOccurredAt,
      status: 'PENDING_HUMAN',
      handoverStatus: 'HUMAN'
    });
    messageIds.push(messageId);
  }

  return { messageIds };
}
