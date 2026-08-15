import { randomUUID } from 'node:crypto';
import type { WhatsAppCredentials } from '@/config/env-core';
import type { ChannelAdapter, ChannelResult } from '../channel-adapter';
import { verifyWebhookChallenge, verifyWebhookSignature } from './whatsapp-signature';
import { WHATSAPP_SERVICE_WINDOW_HOURS } from './whatsapp-contract';

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
  /**
   * E.2A — defense in depth: the founder activation flag is checked here,
   * inside the adapter itself, in addition to wherever the caller checks
   * it. This guarantees no call site can construct a working "live" send
   * path by accident just because it has valid credentials — the flag
   * must be threaded through explicitly.
   */
  activationEnabled?: boolean;
};

export class WhatsAppChannelAdapter implements ChannelAdapter {
  readonly channel = 'WHATSAPP' as const;
  readonly mode = 'SANDBOX' as const;
  readonly simulated = false;

  private readonly fetchImpl: typeof fetch;
  private readonly clock: () => Date;
  private readonly timeoutMs: number;
  private readonly activationEnabled: boolean;

  constructor(private readonly credentials: WhatsAppCredentials, options: WhatsAppAdapterOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.clock = options.clock ?? (() => new Date());
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.activationEnabled = options.activationEnabled ?? false;
  }

  /** Verifies Meta's webhook setup GET challenge. */
  verifyChallenge(mode: string | null, verifyToken: string | null, challenge: string | null): string | null {
    return verifyWebhookChallenge({ mode, verifyToken, challenge, configuredVerifyToken: this.credentials.webhookVerifyToken });
  }

  /** Verifies the signed webhook POST body and parses it as JSON. Signature
   *  verification always happens on the raw string body, before any JSON
   *  parsing. This no longer forces the body into any particular shape —
   *  see normalizeMetaWebhookEnvelope() in whatsapp-activation.ts for
   *  turning the parsed JSON into the real Meta object/entry/changes/value
   *  envelope this project actually receives. */
  verifyAndParseWebhook(rawBody: string, signatureHeader: string | null): { valid: boolean; body: unknown | null } {
    if (!verifyWebhookSignature(rawBody, signatureHeader, this.credentials.appSecret)) {
      return { valid: false, body: null };
    }
    try {
      return { valid: true, body: JSON.parse(rawBody) };
    } catch {
      return { valid: true, body: null };
    }
  }

  /** Whether a free-form text message may still be sent, or whether Meta's
   *  24h service window has expired and only a template message is allowed. */
  withinServiceWindow(lastInboundAt: Date | null): boolean {
    if (!lastInboundAt) return false;
    const hoursSince = (this.clock().getTime() - lastInboundAt.getTime()) / 3_600_000;
    return hoursSince < WHATSAPP_SERVICE_WINDOW_HOURS;
  }

  async sendOutbound(params: { contactExternalId: string; body: string; correlationId: string; lastInboundAt?: Date | null }): Promise<ChannelResult<{ externalMessageId: string }>> {
    if (!this.activationEnabled) {
      return { ok: false, error: { kind: 'TERMINAL_FAILURE', code: 'WHATSAPP_ACTIVATION_DISABLED' } };
    }
    if (!params.body || params.body.length > 4_096) {
      return { ok: false, error: { kind: 'VALIDATION', code: 'INVALID_BODY' } };
    }
    // E.2A fix: the 24h service-window rule is now enforced HERE, at the
    // actual send boundary, instead of only existing as an unused helper
    // method callers could forget to call. Outside the window — or if a
    // caller using the generic ChannelAdapter interface doesn't know about
    // this WhatsApp-specific field and omits it — this fails closed with
    // an explicit "template required" result. It never fabricates an
    // approved template or attempts the free-form send anyway; this is a
    // safe default even for a not-yet-fully-wired generic dispatch path.
    if (!this.withinServiceWindow(params.lastInboundAt ?? null)) {
      return { ok: false, error: { kind: 'VALIDATION', code: 'WHATSAPP_SERVICE_WINDOW_CLOSED_TEMPLATE_REQUIRED' } };
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
    // E.2A: reports the truthful multi-state model (see
    // whatsapp-activation.ts) instead of a bare boolean. Still never
    // fabricates a successful live connection — LIVE_TEST_CERTIFIED can
    // only be reached with real network evidence this class never
    // produces on its own.
    return {
      channel: this.channel,
      healthy: false,
      checkedAt: this.clock().toISOString(),
      activationState: this.activationEnabled ? ('READY_FOR_TEST_ACTIVATION' as const) : ('CONFIGURED_BUT_DISABLED' as const)
    };
  }
}
