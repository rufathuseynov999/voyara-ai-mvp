import { NextResponse, type NextRequest } from 'next/server';
import { readWhatsAppCredentials } from '@/config/env-core';
import { WhatsAppChannelAdapter } from '@/server/agents/whatsapp/whatsapp-adapter';
import { processInboundWhatsAppMessage } from '@/server/agents/whatsapp/whatsapp-inbound';
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
  const adapter = new WhatsAppChannelAdapter(credentials);
  const { valid, payload } = adapter.verifyAndParseWebhook(rawBody, signatureHeader);

  if (!valid) {
    reportError(new Error('WhatsApp webhook signature verification failed'), { code: 'WHATSAPP_WEBHOOK_INVALID_SIGNATURE' });
    return noStore({ error: 'INVALID_SIGNATURE' }, 401);
  }
  if (!payload) {
    // Signature was valid but the body didn't parse into a known shape —
    // acknowledge with 200 (Meta shouldn't retry a body it will send
    // identically again) but do nothing with it.
    return noStore({ ok: true, processed: false }, 200);
  }

  const admin = createAdminSupabaseClient();
  if (!admin) return noStore({ error: 'STORE_UNAVAILABLE' }, 503);

  // Reserve-first idempotency: one event id per delivery attempt from Meta.
  // Since a single POST body can carry multiple messages/statuses, the
  // event id used here is derived from the raw body itself — an identical
  // retry produces an identical hash and is correctly rejected as duplicate.
  const { createHash, randomUUID } = await import('node:crypto');
  const eventId = createHash('sha256').update(rawBody).digest('hex');
  const correlationId = request.headers.get('x-correlation-id') || randomUUID();

  const { error: reserveError } = await admin.from('whatsapp_webhook_receipts').insert({
    id: randomUUID(), event_id: eventId, phone_number_id: payload.phoneNumberId,
    event_type: payload.messages.length > 0 ? 'messages' : 'statuses', accepted: true, correlation_id: correlationId
  });
  if (reserveError) {
    if (reserveError.code === '23505') {
      return noStore({ ok: true, duplicate: true }, 200);
    }
    reportError(new Error(`WhatsApp webhook receipt reservation failed: ${reserveError.code}`), { code: 'WHATSAPP_WEBHOOK_RECEIPT_FAILED' });
    return noStore({ error: 'RECEIPT_FAILED' }, 500);
  }

  if (payload.messages.length > 0) {
    try {
      const { data: account } = await admin.from('whatsapp_accounts').select('brand').eq('phone_number_id', payload.phoneNumberId).maybeSingle();
      await processInboundWhatsAppMessage(
        {
          conversationStore: new SupabaseConversationStore(),
          identityStore: new SupabaseIdentityStore(),
          adapter,
          accountId: VOYARA_BUSINESS_ACCOUNT_ID, // single-business context — must be a valid uuid; phone number id is used separately below for brand resolution
          brand: (account?.brand as 'RTRAVEL' | 'VOYARA' | undefined) ?? 'RTRAVEL',
          correlationId,
          now: () => new Date()
        },
        payload
      );
    } catch (error) {
      reportError(error instanceof Error ? error : new Error('WhatsApp inbound processing failed'), { code: 'WHATSAPP_INBOUND_PROCESSING_FAILED' });
      // Still return 200 — the event is durably recorded as received; a
      // processing failure is investigated via logs/error-reporter, not by
      // asking Meta to retry a webhook it already successfully delivered.
    }
  }

  // Delivery/read/failure status updates are recorded on the message rows
  // they refer to when a real account mapping exists; this phase records
  // their receipt (via whatsapp_webhook_receipts, above) and defers full
  // per-message delivery-status reconciliation to when the inbox UI
  // consumes WhatsApp data directly (noted in the final report).

  return noStore({ ok: true }, 200);
}
