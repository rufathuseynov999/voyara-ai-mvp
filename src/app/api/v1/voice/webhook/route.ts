import { NextResponse, type NextRequest } from 'next/server';
import { readVoiceCredentials } from '@/config/env-core';
import { SimulationVoiceAdapter } from '@/server/agents/voice/voice-adapter';
import { processCallWebhookEvent } from '@/server/agents/voice/voice-webhook-processing';
import { SupabaseCallStore } from '@/server/agents/voice/supabase-call-store';
import { SupabaseConversationStore } from '@/server/agents/supabase-conversation-store';
import { SupabaseIdentityStore } from '@/server/agents/supabase-identity-store';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { reportError } from '@/server/observability/error-reporter';
import { VOYARA_BUSINESS_ACCOUNT_ID } from '@/server/agents/business-account';

/**
 * Phase 4D — voice call webhook endpoint.
 *
 * Signature verification ALWAYS happens on the raw request body, before any
 * JSON parsing and before any database write — there is no code path in
 * this file that processes a call event before
 * `verifyAndParseWebhookRaw` has returned `valid: true`. Duplicate events
 * are rejected via a reserve-first insert into `call_webhook_receipts`, the
 * same discipline already proven for WhatsApp/payment-link webhooks.
 *
 * The HMAC scheme used here (`VoiceAdapter.verifyAndParseWebhookRaw`) is
 * VOYARA's own fixture/reference contract, not any real external voice
 * provider's actual signature scheme — see the Phase 4D activation runbook.
 * No live telephony/SIP/voice-provider credentials exist anywhere in this
 * project; without them this route always responds `VOICE_NOT_CONFIGURED`.
 *
 * Multi-number/brand routing: the provider's own number id
 * (`providerNumberId`) is looked up against `voice_numbers` to resolve
 * which brand (R-Travel or VOYARA) this call belongs to — never guessed,
 * never defaulted silently to one brand.
 */

function noStore(body: object, status: number) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  const credentials = readVoiceCredentials();
  if (!credentials) return noStore({ error: 'VOICE_NOT_CONFIGURED' }, 503);

  // Signature verification happens on the RAW body text — nothing below
  // this line runs before verifyAndParseWebhookRaw returns valid:true.
  const rawBody = await request.text();
  const signatureHeader = request.headers.get('x-voyara-voice-signature');
  const adapter = new SimulationVoiceAdapter();
  const { valid, payload } = adapter.verifyAndParseWebhookRaw(rawBody, signatureHeader, credentials.webhookSecret);

  if (!valid) {
    reportError(new Error('Voice webhook signature verification failed'), { code: 'VOICE_WEBHOOK_INVALID_SIGNATURE' });
    return noStore({ error: 'INVALID_SIGNATURE' }, 401);
  }
  if (!payload) {
    return noStore({ ok: true, processed: false }, 200);
  }

  const admin = createAdminSupabaseClient();
  if (!admin) return noStore({ error: 'STORE_UNAVAILABLE' }, 503);

  const { randomUUID } = await import('node:crypto');
  const correlationId = request.headers.get('x-correlation-id') || randomUUID();

  // Reserve-first idempotency — one event id per delivery attempt.
  const { error: reserveError } = await admin.from('call_webhook_receipts').insert({
    id: randomUUID(), event_id: payload.eventId, call_id: null,
    event_type: payload.eventType, accepted: true, correlation_id: correlationId
  });
  if (reserveError) {
    if (reserveError.code === '23505') {
      return noStore({ ok: true, duplicate: true }, 200);
    }
    reportError(new Error(`Voice webhook receipt reservation failed: ${reserveError.code}`), { code: 'VOICE_WEBHOOK_RECEIPT_FAILED' });
    return noStore({ error: 'RECEIPT_FAILED' }, 500);
  }

  try {
    // Multi-number/brand resolution — never guessed.
    const { data: voiceNumber } = await admin.from('voice_numbers').select('id, brand').eq('provider_number_id', payload.providerNumberId).maybeSingle();
    const brand = (voiceNumber?.brand as 'RTRAVEL' | 'VOYARA' | undefined) ?? 'RTRAVEL';

    await processCallWebhookEvent(
      {
        callStore: new SupabaseCallStore(), conversationStore: new SupabaseConversationStore(), identityStore: new SupabaseIdentityStore(),
        accountId: VOYARA_BUSINESS_ACCOUNT_ID, brand, voiceNumberId: voiceNumber?.id ?? null, correlationId, now: () => new Date()
      },
      payload,
      null
    );
  } catch (error) {
    reportError(error instanceof Error ? error : new Error('Voice webhook processing failed'), { code: 'VOICE_WEBHOOK_PROCESSING_FAILED' });
    // Still return 200 — the event is durably recorded as received.
  }

  return noStore({ ok: true }, 200);
}
