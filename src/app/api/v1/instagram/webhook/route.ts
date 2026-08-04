import { NextResponse, type NextRequest } from 'next/server';
import { readInstagramAppCredentials, readInstagramBrandCredentials } from '@/config/env-core';
import { InstagramChannelAdapter } from '@/server/agents/instagram/instagram-adapter';
import { verifyInstagramWebhookChallenge, verifyInstagramWebhookSignature } from '@/server/agents/instagram/instagram-signature';
import { instagramWebhookPayloadSchema, type InstagramWebhookPayload } from '@/server/agents/instagram/instagram-contract';
import { processInboundInstagramMessage } from '@/server/agents/instagram/instagram-inbound';
import { SupabaseConversationStore } from '@/server/agents/supabase-conversation-store';
import { SupabaseIdentityStore } from '@/server/agents/supabase-identity-store';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { reportError } from '@/server/observability/error-reporter';
import { VOYARA_BUSINESS_ACCOUNT_ID } from '@/server/agents/business-account';

/**
 * Phase 4H — Instagram Messaging API webhook endpoint, dual-brand.
 *
 * Same discipline as the WhatsApp webhook route: signature verification
 * ALWAYS happens on the raw request body, before any JSON parsing and
 * before any database write. Duplicate events are rejected via a
 * reserve-first insert into `instagram_webhook_receipts`.
 *
 * ONE DELIBERATE STRUCTURAL DIFFERENCE FROM THE WHATSAPP ROUTE: WhatsApp's
 * route reads ONE set of credentials for one phone number and constructs
 * ONE adapter up front, because the phone_number_id in the payload always
 * belongs to that single configured number. Instagram's shared Meta App
 * can own BOTH brands' Pages under one webhook subscription, so the brand
 * is not known until AFTER the body is parsed. The fix: signature
 * verification uses the shared app-level secret directly (verified in this
 * file, not inside a brand-specific adapter instance, since no brand is
 * known yet); brand resolution happens per-entry, by matching the entry's
 * Page id against each brand's OWN configured `pageId` — an entry whose
 * Page id matches neither brand's configured id is an unknown
 * account/page and is dropped without processing (never guessed at, never
 * defaulted to either brand).
 */

function noStore(body: object | string, status: number, contentType = 'application/json') {
  const isText = typeof body === 'string';
  return new NextResponse(isText ? body : JSON.stringify(body), {
    status,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': isText ? 'text/plain' : contentType }
  });
}

export async function GET(request: NextRequest) {
  const app = readInstagramAppCredentials();
  if (!app) return noStore({ error: 'INSTAGRAM_NOT_CONFIGURED' }, 503);

  const mode = request.nextUrl.searchParams.get('hub.mode');
  const verifyToken = request.nextUrl.searchParams.get('hub.verify_token');
  const challenge = request.nextUrl.searchParams.get('hub.challenge');

  const result = verifyInstagramWebhookChallenge({ mode, verifyToken, challenge, configuredVerifyToken: app.webhookVerifyToken });
  if (result === null) return noStore('Forbidden', 403, 'text/plain');
  return noStore(result, 200, 'text/plain');
}

export async function POST(request: NextRequest) {
  const app = readInstagramAppCredentials();
  if (!app) return noStore({ error: 'INSTAGRAM_NOT_CONFIGURED' }, 503);

  // Signature verification happens on the RAW body text — read it as text
  // first; nothing below this line runs before verification returns true.
  const rawBody = await request.text();
  const signatureHeader = request.headers.get('x-hub-signature-256');
  if (!verifyInstagramWebhookSignature(rawBody, signatureHeader, app.appSecret)) {
    reportError(new Error('Instagram webhook signature verification failed'), { code: 'INSTAGRAM_WEBHOOK_INVALID_SIGNATURE' });
    return noStore({ error: 'INVALID_SIGNATURE' }, 401);
  }

  // Unsupported `object` types (anything other than the literal
  // 'instagram') are rejected here — the schema itself enforces the
  // literal, so any other value fails safeParse.
  let payload: InstagramWebhookPayload | null = null;
  try {
    const parsed = instagramWebhookPayloadSchema.safeParse(JSON.parse(rawBody));
    payload = parsed.success ? parsed.data : null;
  } catch {
    payload = null;
  }
  if (!payload) {
    // Signature was valid but the body didn't parse into a known shape —
    // acknowledge with 200 (Meta shouldn't retry a body it will send
    // identically again) but do nothing with it.
    return noStore({ ok: true, processed: false }, 200);
  }

  const admin = createAdminSupabaseClient();
  if (!admin) return noStore({ error: 'STORE_UNAVAILABLE' }, 503);

  // Reserve-first idempotency: one event id per delivery attempt from Meta,
  // derived from the raw body itself — an identical retry produces an
  // identical hash and is correctly rejected as duplicate.
  const { createHash, randomUUID } = await import('node:crypto');
  const eventId = createHash('sha256').update(rawBody).digest('hex');
  const correlationId = request.headers.get('x-correlation-id') || randomUUID();
  const firstEntry = payload.entry[0];

  const { error: reserveError } = await admin.from('instagram_webhook_receipts').insert({
    id: randomUUID(), event_id: eventId, instagram_account_id: null, page_id: firstEntry?.id ?? null,
    event_type: 'messaging', accepted: true, correlation_id: correlationId
  });
  if (reserveError) {
    if (reserveError.code === '23505') {
      return noStore({ ok: true, duplicate: true }, 200);
    }
    reportError(new Error(`Instagram webhook receipt reservation failed: ${reserveError.code}`), { code: 'INSTAGRAM_WEBHOOK_RECEIPT_FAILED' });
    return noStore({ error: 'RECEIPT_FAILED' }, 500);
  }

  // Brand resolution — per entry, by Page id match against each brand's
  // OWN configured credentials. An entry matching neither brand is an
  // unknown account/page: dropped, never processed, never guessed.
  const rtravel = readInstagramBrandCredentials('RTRAVEL');
  const voyara = readInstagramBrandCredentials('VOYARA');

  for (const entry of payload.entry) {
    const brandCredentials = rtravel && entry.id === rtravel.pageId ? rtravel
      : voyara && entry.id === voyara.pageId ? voyara
      : null;
    if (!brandCredentials) continue; // unknown account/page id — rejected by omission, not processed

    try {
      const adapter = new InstagramChannelAdapter({ ...app, ...brandCredentials });
      await processInboundInstagramMessage(
        {
          conversationStore: new SupabaseConversationStore(),
          identityStore: new SupabaseIdentityStore(),
          adapter,
          accountId: VOYARA_BUSINESS_ACCOUNT_ID,
          brand: brandCredentials.brand,
          correlationId,
          now: () => new Date()
        },
        { object: 'instagram', entry: [entry] }
      );
    } catch (error) {
      reportError(error instanceof Error ? error : new Error('Instagram inbound processing failed'), { code: 'INSTAGRAM_INBOUND_PROCESSING_FAILED' });
      // Still return 200 — the event is durably recorded as received; a
      // processing failure is investigated via logs/error-reporter, not by
      // asking Meta to retry a webhook it already successfully delivered.
    }
  }

  return noStore({ ok: true }, 200);
}
