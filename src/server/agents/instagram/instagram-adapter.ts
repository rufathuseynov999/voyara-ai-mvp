import { randomUUID } from 'node:crypto';
import type { InstagramCredentials } from '@/config/env-core';
import type { ChannelAdapter, ChannelResult } from '../channel-adapter';
import { verifyInstagramWebhookChallenge, verifyInstagramWebhookSignature } from './instagram-signature';
import { instagramWebhookPayloadSchema, INSTAGRAM_SERVICE_WINDOW_HOURS, type InstagramWebhookPayload } from './instagram-contract';

/**
 * Phase 4H — Instagram Messaging adapter (SANDBOX only).
 *
 * Multi-account-ready, mirroring whatsapp-adapter.ts exactly: one adapter
 * INSTANCE is constructed per Instagram account (R-Travel or VOYARA) —
 * `credentials.brand` is fixed at construction and never accepted as a
 * per-call parameter, so nothing downstream of construction can make this
 * adapter act for a brand it wasn't built for. No live network call has
 * ever been made from this environment.
 */

const SEND_MESSAGE_PATH_SUFFIX = '/messages';
const DEFAULT_TIMEOUT_MS = 10_000;

export type InstagramAdapterOptions = {
  fetchImpl?: typeof fetch;
  clock?: () => Date;
  timeoutMs?: number;
};

export class InstagramChannelAdapter implements ChannelAdapter {
  readonly channel = 'INSTAGRAM_DM' as const;
  readonly mode = 'SANDBOX' as const;
  readonly simulated = false;
  readonly brand: 'RTRAVEL' | 'VOYARA';

  private readonly fetchImpl: typeof fetch;
  private readonly clock: () => Date;
  private readonly timeoutMs: number;

  constructor(private readonly credentials: InstagramCredentials, options: InstagramAdapterOptions = {}) {
    this.brand = credentials.brand;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.clock = options.clock ?? (() => new Date());
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Verifies Meta's webhook setup GET challenge. Identical mechanism to
   *  WhatsApp's, using this brand's own configured verify token. */
  verifyChallenge(mode: string | null, verifyToken: string | null, challenge: string | null): string | null {
    return verifyInstagramWebhookChallenge({ mode, verifyToken, challenge, configuredVerifyToken: this.credentials.webhookVerifyToken });
  }

  /** Verifies the signed webhook POST body and parses it. Signature
   *  verification always happens on the raw string body, before any JSON
   *  parsing. Rejects any `object` other than `'instagram'` and any entry
   *  whose Page/account id does not belong to THIS adapter's own brand —
   *  a webhook delivery claiming to be for a different account never
   *  reaches inbound processing through this adapter instance. */
  verifyAndParseWebhook(rawBody: string, signatureHeader: string | null): { valid: boolean; payload: InstagramWebhookPayload | null } {
    if (!verifyInstagramWebhookSignature(rawBody, signatureHeader, this.credentials.appSecret)) {
      return { valid: false, payload: null };
    }
    try {
      const json = JSON.parse(rawBody);
      const parsed = instagramWebhookPayloadSchema.safeParse(json);
      if (!parsed.success) return { valid: true, payload: null };

      // Unknown account/page id rejected here, at the adapter boundary —
      // only entries addressed to THIS adapter's own configured page id
      // are kept; everything else is silently dropped from the parsed
      // payload (not an error — a shared Meta App webhook subscription can
      // legitimately receive events for Pages VOYARA doesn't own at all).
      const entry = parsed.data.entry.filter((e) => e.id === this.credentials.pageId);
      return { valid: true, payload: { ...parsed.data, entry } };
    } catch {
      return { valid: true, payload: null };
    }
  }

  /** Whether a message may still be sent, or whether the 24h service
   *  window has expired. Unlike WhatsApp, Instagram has no template-message
   *  exception — outside the window, sending is simply not possible. */
  withinServiceWindow(lastInboundAt: Date | null): boolean {
    if (!lastInboundAt) return false;
    const hoursSince = (this.clock().getTime() - lastInboundAt.getTime()) / 3_600_000;
    return hoursSince < INSTAGRAM_SERVICE_WINDOW_HOURS;
  }

  async sendOutbound(params: { contactExternalId: string; body: string; correlationId: string }): Promise<ChannelResult<{ externalMessageId: string }>> {
    if (!params.body || params.body.length > 1_000) {
      return { ok: false, error: { kind: 'VALIDATION', code: 'INVALID_BODY' } };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const baseUrl = `https://graph.facebook.com/${this.credentials.graphApiVersion}`;
      const response = await this.fetchImpl(`${baseUrl}/${this.credentials.pageId}${SEND_MESSAGE_PATH_SUFFIX}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.credentials.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: { id: params.contactExternalId }, message: { text: params.body } }),
        signal: controller.signal
      });
      let json: unknown = null;
      try { json = await response.json(); } catch { json = null; }
      if (!response.ok) {
        const kind = response.status === 401 || response.status === 403 ? 'TERMINAL_FAILURE'
          : response.status === 429 ? 'RATE_LIMIT'
          : response.status >= 500 ? 'UNAVAILABLE' : 'VALIDATION';
        return { ok: false, error: { kind, code: `INSTAGRAM_SEND_FAILED_${response.status}` } };
      }
      const externalMessageId = (json as { message_id?: string })?.message_id ?? `ig-${randomUUID()}`;
      return { ok: true, value: { externalMessageId } };
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError';
      return { ok: false, error: { kind: isAbort ? 'TIMEOUT' : 'TERMINAL_FAILURE', code: isAbort ? 'INSTAGRAM_TIMEOUT' : 'INSTAGRAM_NETWORK_ERROR' } };
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
