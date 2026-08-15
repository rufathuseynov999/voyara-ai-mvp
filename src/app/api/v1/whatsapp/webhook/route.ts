import { NextResponse, type NextRequest } from 'next/server';
import { readWhatsAppCredentials, readWhatsAppActivationFlag } from '@/config/env-core';
import { WhatsAppChannelAdapter } from '@/server/agents/whatsapp/whatsapp-adapter';
import { processInboundWhatsAppMessage } from '@/server/agents/whatsapp/whatsapp-inbound';
import { normalizeMetaWebhookEnvelope } from '@/server/agents/whatsapp/whatsapp-activation';
import { SupabaseConversationStore } from '@/server/agents/supabase-conversation-store';
import { SupabaseIdentityStore } from '@/server/agents/supabase-identity-store';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { reportError } from '@/server/observability/error-reporter';
import { VOYARA_BUSINESS_ACCOUNT_ID } from '@/server/agents/business-account';

/**
 * Phase 4C — WhatsApp Cloud API webhook endpoint.
 *
 * GET handles Meta's one-time webhook-setup challenge. POST handles every
 * subsequent inbound event. Signature verification ALWAYS happens on the
 * raw request body, before any JSON parsing and before any database write —
 * there is no code path in this file that processes a message before the
 * signature check has returned true. Duplicate events (Meta retries
 * delivery on anything short of a fast 200) are rejected via a reserve-first
 * insert into `whatsapp_webhook_receipts`, the same discipline already
 * proven for Hotelbeds/payment-link webhooks.
 *
 * This route always returns 200 to Meta once the event is durably recorded
 * (accepted or duplicate) — Meta interprets anything else as "retry me,"
 * and returning 200 for a duplicate is correct idempotent behavior, not a
 * false positive.
 */

function noStore(body: object | string, status: number, contentType = 'application/json') {
  const isText = typeof body === 'string';
  return new NextResponse(isText ? body : JSON.stringify(body), {
    status,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': isText ? 'text/plain' : contentType }
  });
}

export async function GET(request: NextRequest) {
  const credentials = readWhatsAppCredentials();
  if (!credentials) return noStore({ error: 'WHATSAPP_NOT_CONFIGURED' }, 503);

  const adapter = new WhatsAppChannelAdapter(credentials);
  const mode = request.nextUrl.searchParams.get('hub.mode');
  const verifyToken = request.nextUrl.searchParams.get('hub.verify_token');
  const challenge = request.nextUrl.searchParams.get('hub.challenge');

  const result = adapter.verifyChallenge(mode, verifyToken, challenge);
  if (result === null) return noStore('Forbidden', 403, 'text/plain');
  return noStore(result, 200, 'text/plain');
}

export async function POST(request: NextRequest) {
  const credentials = readWhatsAppCredentials();
  if (!credentials) return noStore({ error: 'WHATSAPP_NOT_CONFIGURED' }, 503);

  // Signature verification happens on the RAW body text — read it as text
  // first; nothing below this line runs before verifyAndParseWebhook returns
  // valid:true.
  const rawBody = await request.text();
  const signatureHeader = request.headers.get('x-hub-signature-256');
  const adapter = new WhatsAppChannelAdapter(credentials, { activationEnabled: readWhatsAppActivationFlag() });
  const { valid, body } = adapter.verifyAndParseWebhook(rawBody, signatureHeader);

  if (!valid) {
    reportError(new Error('WhatsApp webhook signature verification failed'), { code: 'WHATSAPP_WEBHOOK_INVALID_SIGNATURE' });
    return noStore({ error: 'INVALID_SIGNATURE' }, 401);
  }

  const { createHash, randomUUID } = await import('node:crypto');
  const correlationId = request.headers.get('x-correlation-id') || randomUUID();
  const admin = createAdminSupabaseClient();
  if (!admin) return noStore({ error: 'STORE_UNAVAILABLE' }, 503);

  // Reserve-first idempotency: one event id per delivery attempt from Meta,
  // derived from the raw body itself so an identical retry (Meta retries
  // delivery on anything short of a fast 200) produces an identical hash
  // and is correctly rejected as a duplicate. This happens BEFORE envelope
  // normalization and BEFORE the activation-flag check, so a duplicate
  // delivery is always recognized regardless of activation state.
  const eventId = createHash('sha256').update(rawBody).digest('hex');
  const normalized = normalizeMetaWebhookEnvelope(body);
  const { error: reserveError } = await admin.from('whatsapp_webhook_receipts').insert({
    id: randomUUID(), event_id: eventId, phone_number_id: normalized.batches[0]?.phoneNumberId ?? null,
    event_type: normalized.batches.some((b) => b.messages.length > 0) ? 'messages' : 'statuses',
    accepted: true, correlation_id: correlationId
  });
  if (reserveError) {
    if (reserveError.code === '23505') {
      return noStore({ ok: true, duplicate: true }, 200);
    }
    reportError(new Error(`WhatsApp webhook receipt reservation failed: ${reserveError.code}`), { code: 'WHATSAPP_WEBHOOK_RECEIPT_FAILED' });
    return noStore({ error: 'RECEIPT_FAILED' }, 500);
  }

  if (normalized.malformed) {
    // Structurally unrecognizable body — signature was valid (it really is
    // from Meta) but the shape doesn't match the documented envelope at
    // all. Acknowledged (Meta shouldn't retry a body it will send
    // identically again) but nothing is written beyond the receipt above.
    return noStore({ ok: true, processed: false, malformed: true }, 200);
  }

  // E.2A founder activation gate: credentials being complete and valid is
  // NOT sufficient. Without the explicit flag, the event's receipt is
  // still durably recorded (above, for audit/idempotency proof and so a
  // founder can verify the webhook pipeline is reachable) but nothing is
  // written to contacts/conversations/messages.
  if (!readWhatsAppActivationFlag()) {
    return noStore({ ok: true, processed: false, activationDisabled: true }, 200);
  }

  const processedBatches: string[] = [];
  for (const batch of normalized.batches) {
    if (batch.messages.length === 0 && batch.statuses.length === 0) continue;
    try {
      // Fail closed: an inbound payload is only processed when its
      // phone_number_id exactly matches an existing ACTIVE whatsapp_accounts
      // row. No silent fallback to any brand for an unknown or inactive
      // number — the previous `?? 'RTRAVEL'` default is removed entirely.
      const { data: account, error: accountError } = await admin
        .from('whatsapp_accounts')
        .select('brand, active')
        .eq('phone_number_id', batch.phoneNumberId)
        .maybeSingle();
      if (accountError) {
        reportError(new Error(`WhatsApp account lookup failed: ${accountError.code}`), { code: 'WHATSAPP_ACCOUNT_LOOKUP_FAILED' });
        continue;
      }
      if (!account || account.active !== true) {
        reportError(new Error('WhatsApp inbound for unknown or inactive phone_number_id — failed closed, no brand fallback'), {
          code: 'WHATSAPP_UNKNOWN_OR_INACTIVE_ACCOUNT'
        });
        continue;
      }
      if (account.brand !== 'RTRAVEL' && account.brand !== 'VOYARA') {
        // Structurally shouldn't happen (the column is a Postgres enum),
        // but never blindly cast an unrecognized value into a real brand.
        reportError(new Error('WhatsApp account row has an unrecognized brand value — failed closed'), { code: 'WHATSAPP_UNRECOGNIZED_BRAND' });
        continue;
      }

      if (batch.messages.length > 0) {
        await processInboundWhatsAppMessage(
          {
            conversationStore: new SupabaseConversationStore(),
            identityStore: new SupabaseIdentityStore(),
            adapter,
            accountId: VOYARA_BUSINESS_ACCOUNT_ID,
            brand: account.brand,
            correlationId,
            now: () => new Date()
          },
          batch
        );
        processedBatches.push(batch.phoneNumberId);
      }

      // E.2A §3 — delivery-status reconciliation, scoped to exactly this
      // resolved (account, brand) context. Meta's own status strings map
      // to the existing delivery_status enum; anything else is safely
      // acknowledged and ignored rather than guessed at. A status-only
      // webhook creates no Conversation, Contact, Intent or Travel Request
      // — this is purely an update to an existing message row, or a no-op
      // if no matching row/context exists.
      const statusMap: Record<string, 'PENDING' | 'DELIVERED' | 'READ' | 'FAILED'> = {
        sent: 'PENDING', delivered: 'DELIVERED', read: 'READ', failed: 'FAILED'
      };
      const store = new SupabaseConversationStore();
      for (const status of batch.statuses) {
        const mapped = statusMap[status.status];
        if (!mapped) continue;
        await store.reconcileDeliveryStatus({
          externalMessageId: status.id,
          deliveryStatus: mapped,
          webhookStatus: status.status, // Meta's own short status string only — never a raw error payload
          expectedAccountId: VOYARA_BUSINESS_ACCOUNT_ID,
          expectedBrand: account.brand
        });
      }
    } catch (error) {
      reportError(error instanceof Error ? error : new Error('WhatsApp inbound processing failed'), { code: 'WHATSAPP_INBOUND_PROCESSING_FAILED' });
      // Still return 200 overall — the event is durably recorded as
      // received; a processing failure is investigated via logs/
      // error-reporter, not by asking Meta to retry a webhook it already
      // successfully delivered.
    }
  }

  // Delivery/read/failure status updates: their receipt is durably
  // recorded above (whatsapp_webhook_receipts); full per-message
  // reconciliation onto the exact outbound message row they refer to is
  // scoped out of this checkpoint and flagged explicitly in the final
  // report rather than implemented partially/silently.

  return noStore({ ok: true, processedPhoneNumberIds: processedBatches, unsupportedEvents: normalized.unsupportedEvents }, 200);
}
