import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import type { CallStatus } from './voice-contract';

/**
 * Phase 4D — provider-neutral voice/telephony adapter.
 *
 * A single cohesive interface covering both the SIP/PSTN telephony layer
 * (inbound webhook verification, call control: answer/transfer/end) and the
 * voice-provider layer (speak/listen) — matching how real managed voice
 * platforms (Twilio Voice, Vonage, etc.) present one unified API for both
 * concerns, the same way this project's `ChannelAdapter` covers both
 * "messaging" and "webhook" for WhatsApp. No real telephony/voice provider
 * is implemented — only `SimulationVoiceAdapter` exists, exactly the same
 * posture as every other channel in this project. Webhook signature
 * verification below is VOYARA's own reference HMAC scheme (this project's
 * own contract, reused identically from the WhatsApp/payment-link adapters
 * — not any named provider's real scheme, since no provider is chosen).
 */

export type InboundCallWebhook = {
  eventId: string;
  eventType: 'call.started' | 'call.ringing' | 'call.answered' | 'call.transferred' | 'call.completed' | 'call.failed' | 'call.transcript_chunk';
  providerNumberId: string;
  calledNumber: string;
  callerNumber: string;
  callStatus: CallStatus;
  transcriptChunk: string | null;
  durationSeconds: number | null;
  timestamp: string;
  signature: string;
};

export type VoiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { kind: 'VALIDATION' | 'TIMEOUT' | 'RATE_LIMIT' | 'UNAVAILABLE' | 'TERMINAL_FAILURE'; code: string } };

export interface VoiceAdapter {
  readonly mode: 'SIMULATION' | 'SANDBOX' | 'LIVE';
  readonly simulated: boolean;

  /** Verifies an inbound webhook's HMAC signature over its own canonical
   *  fields, given an ALREADY-PARSED payload. Kept for callers that already
   *  hold a validated payload; the webhook route itself uses
   *  `verifyAndParseWebhookRaw` below instead, so verification always
   *  happens before parsing, never after. */
  verifyWebhookSignature(webhook: InboundCallWebhook, secret: string): boolean;

  /** Verifies the signature against the RAW request body BEFORE any JSON
   *  parsing occurs, then parses only on success — mirroring
   *  whatsapp-adapter.ts's `verifyAndParseWebhook` exactly. This is the
   *  method the webhook route calls; nothing in this codebase parses a
   *  voice webhook body before this returns `valid: true`. */
  verifyAndParseWebhookRaw(rawBody: string, signatureHeader: string | null, secret: string): { valid: boolean; payload: InboundCallWebhook | null };

  /** Speaks a line of text to the caller in the given language — the ONLY
   *  way this adapter ever produces audio. Never accepts raw card data or a
   *  CVV as input (the caller of this method — voice-call-service.ts — never
   *  constructs a request containing either). */
  speak(callProviderId: string, text: string, language: 'az' | 'ru' | 'en'): Promise<VoiceResult<{ spoken: true }>>;

  /** Transfers the live call to a human at the given destination — this and
   *  `endCall` are the only two call-control actions this interface exposes
   *  beyond speaking; there is no "confirmBooking"/"chargePayment"/
   *  "issueRefund" method anywhere on this interface, structurally. */
  transferCall(callProviderId: string, destinationNumber: string): Promise<VoiceResult<{ transferred: true }>>;

  endCall(callProviderId: string): Promise<VoiceResult<{ ended: true }>>;

  health(): Promise<{ healthy: boolean; checkedAt: string }>;
}

export class SimulationVoiceAdapter implements VoiceAdapter {
  readonly mode = 'SIMULATION' as const;
  readonly simulated = true;

  constructor(private readonly clock: () => Date = () => new Date()) {}

  verifyWebhookSignature(webhook: InboundCallWebhook, secret: string): boolean {
    if (!secret || !webhook?.signature || !webhook?.timestamp) return false;
    const canonical = `${webhook.eventId}.${webhook.eventType}.${webhook.callStatus}.${webhook.timestamp}`;
    const expected = createHmac('sha256', secret).update(canonical).digest('hex');
    if (webhook.signature.length !== expected.length) return false;
    try {
      return timingSafeEqual(Buffer.from(webhook.signature, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
      return false;
    }
  }

  verifyAndParseWebhookRaw(rawBody: string, signatureHeader: string | null, secret: string): { valid: boolean; payload: InboundCallWebhook | null } {
    // HMAC-SHA256 over the raw body bytes — verified BEFORE any JSON.parse,
    // exactly the same discipline as whatsapp-adapter.ts's
    // verifyAndParseWebhook and simulation-payment-link-adapter.ts. This is
    // VOYARA's own fixture/reference contract, not any real external
    // provider's scheme — see voice-adapter.ts's header note.
    if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return { valid: false, payload: null };
    const provided = signatureHeader.slice('sha256='.length);
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    let signatureValid = false;
    if (provided.length === expected.length) {
      try {
        signatureValid = timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
      } catch {
        signatureValid = false;
      }
    }
    if (!signatureValid) return { valid: false, payload: null };

    try {
      const parsed = JSON.parse(rawBody) as InboundCallWebhook;
      return { valid: true, payload: parsed };
    } catch {
      return { valid: true, payload: null }; // signature genuinely valid; body just didn't parse
    }
  }

  async speak(): Promise<VoiceResult<{ spoken: true }>> {
    return { ok: true, value: { spoken: true } };
  }

  async transferCall(): Promise<VoiceResult<{ transferred: true }>> {
    return { ok: true, value: { transferred: true } };
  }

  async endCall(): Promise<VoiceResult<{ ended: true }>> {
    return { ok: true, value: { ended: true } };
  }

  async health() {
    return { healthy: true, checkedAt: this.clock().toISOString() };
  }
}

/** Test/certification helper — signs a simulated inbound call webhook's raw
 *  JSON body, matching `verifyAndParseWebhookRaw` exactly (HMAC-SHA256 over
 *  the raw body bytes, "sha256=" prefix — the same scheme WhatsApp's
 *  X-Hub-Signature-256 uses, applied here as VOYARA's own reference
 *  contract, not a claim about matching any real provider). */
export function signCallWebhookRawBody(secret: string, rawBody: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

/** Legacy structured-field signer, kept only because
 *  `verifyWebhookSignature` (the already-parsed-payload variant) still uses
 *  this canonical form internally. */
export function signCallWebhook(secret: string, webhook: Omit<InboundCallWebhook, 'signature'>): string {
  const canonical = `${webhook.eventId}.${webhook.eventType}.${webhook.callStatus}.${webhook.timestamp}`;
  return createHmac('sha256', secret).update(canonical).digest('hex');
}

export function newSimulatedCallEventId(): string {
  return `sim-call-evt-${randomUUID()}`;
}
