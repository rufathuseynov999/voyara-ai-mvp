import { randomUUID } from 'node:crypto';
import type { WhatsAppCredentials } from '@/config/env-core';
import type { ChannelAdapter, ChannelResult } from '../channel-adapter';
import { verifyWebhookChallenge, verifyWebhookSignature } from './whatsapp-signature';
import { whatsappWebhookPayloadSchema, WHATSAPP_SERVICE_WINDOW_HOURS, type WhatsAppWebhookPayload } from './whatsapp-contract';

/**
 * Phase 4C — WhatsApp Cloud API adapter (SANDBOX only).
 *
 * Multi-account-ready: one adapter INSTANCE is constructed per WhatsApp
 * number (R-Travel, VOYARA, or the single Meta test number used for initial
 * certification) — `brand` and `phoneNumberId` are per-instance, exactly
 * mirroring how `whatsapp_accounts` models one row per connected number. No
 * live network call has ever been made from this environment.
 */

const SEND_MESSAGE_PATH_SUFFIX = '/messages';
const DEFAULT_TIMEOUT_MS = 10_000;

export type WhatsAppAdapterOptions = {
  fetchImpl?: typeof fetch;
  clock?: () => Date;
  timeoutMs?: number;
};

export class WhatsAppChannelAdapter implements ChannelAdapter {
  readonly channel = 'WHATSAPP' as const;
  readonly mode = 'SANDBOX' as const;
  readonly simulated = false;

  private readonly fetchImpl: typeof fetch;
  private readonly clock: () => Date;
  private readonly timeoutMs: number;

  constructor(private readonly credentials: WhatsAppCredentials, options: WhatsAppAdapterOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.clock = options.clock ?? (() => new Date());
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Verifies Meta's webhook setup GET challenge. */
  verifyChallenge(mode: string | null, verifyToken: string | null, challenge: string | null): string | null {
    return verifyWebhookChallenge({ mode, verifyToken, challenge, configuredVerifyToken: this.credentials.webhookVerifyToken });
  }

  /** Verifies the signed webhook POST body and parses it. Signature
   *  verification always happens on the raw string body, before any JSON
   *  parsing. */
  verifyAndParseWebhook(rawBody: string, signatureHeader: string | null): { valid: boolean; payload: WhatsAppWebhookPayload | null } {
    if (!verifyWebhookSignature(rawBody, signatureHeader, this.credentials.appSecret)) {
      return { valid: false, payload: null };
    }
    try {
      const parsed = whatsappWebhookPayloadSchema.safeParse(JSON.parse(rawBody));
      return parsed.success ? { valid: true, payload: parsed.data } : { valid: true, payload: null };
    } catch {
      return { valid: true, payload: null };
    }
  }

  /** Whether a free-form text message may still be sent, or whether Meta's
   *  24h service window has expired and only a template message is allowed. */
  withinServiceWindow(lastInboundAt: Date | null): boolean {
    if (!lastInboundAt) return false;
    const hoursSince = (this.clock().getTime() - lastInboundAt.getTime()) / 3_600_000;
    return hoursSince < WHATSAPP_SERVICE_WINDOW_HOURS;
  }

  async sendOutbound(params: { contactExternalId: string; body: string; correlationId: string }): Promise<ChannelResult<{ externalMessageId: string }>> {
    if (!params.body || params.body.length > 4_096) {
      return { ok: false, error: { kind: 'VALIDATION', code: 'INVALID_BODY' } };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.credentials.baseUrl}/${this.credentials.phoneNumberId}${SEND_MESSAGE_PATH_SUFFIX}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.credentials.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: params.contactExternalId, type: 'text', text: { body: params.body } }),
        signal: controller.signal
      });
      let json: unknown = null;
      try { json = await response.json(); } catch { json = null; }
      if (!response.ok) {
        const kind = response.status === 401 || response.status === 403 ? 'TERMINAL_FAILURE'
          : response.status === 429 ? 'RATE_LIMIT'
          : response.status >= 500 ? 'UNAVAILABLE' : 'VALIDATION';
        return { ok: false, error: { kind, code: `WHATSAPP_SEND_FAILED_${response.status}` } };
      }
      const externalMessageId = (json as { messages?: [{ id?: string }] })?.messages?.[0]?.id ?? `wa-${randomUUID()}`;
      return { ok: true, value: { externalMessageId } };
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError';
      return { ok: false, error: { kind: isAbort ? 'TIMEOUT' : 'TERMINAL_FAILURE', code: isAbort ? 'WHATSAPP_TIMEOUT' : 'WHATSAPP_NETWORK_ERROR' } };
    } finally {
      clearTimeout(timer);
    }
  }

  async health() {
    return { channel: this.channel, healthy: false, checkedAt: this.clock().toISOString() };
    // Always reports unhealthy without a real network probe having succeeded
    // — never fabricates a successful live connection, same rule as every
    // other adapter's health() in this project.
  }
}
