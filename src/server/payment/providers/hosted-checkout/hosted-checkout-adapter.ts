import { createHmac, timingSafeEqual } from 'node:crypto';
import type { HostedPaymentCredentials } from '@/config/env-core';
import {
  createPaymentRequestSchema,
  paymentStatusRequestSchema,
  paymentSourceForMode,
  refundRequestPreparationSchema,
  type CreatePaymentRequest,
  type InboundWebhook,
  type PaymentAdapter,
  type PaymentDetectedStatus,
  type PaymentHealth,
  type PaymentIntent,
  type PaymentRecord,
  type PaymentResult,
  type PaymentStatusRequest,
  type RefundRequestPreparation
} from '../../integration-contract';
import {
  hostedCheckoutCreateResponseSchema,
  hostedCheckoutStatusResponseSchema
} from './hosted-checkout-contract';

/**
 * Phase 3C Part 3 — generic hosted-checkout payment adapter (SANDBOX only).
 *
 * No specific payment provider has been approved by the founder (checked
 * explicitly — see the Part 3 checkpoint). This adapter is therefore a
 * provider-NEUTRAL reference implementation: it can be pointed at whichever
 * provider's sandbox the founder eventually selects, PROVIDED that provider
 * exposes (or can be fronted by a thin translation layer exposing) a
 * hosted-checkout-style create/status/webhook flow. It does not claim to be
 * Stripe, Payriff, ePoint, a PASHA/Kapital gateway, or any other named
 * provider — hosted-checkout-contract.ts's own header explains exactly what
 * is and is not verified.
 *
 * No live network call has ever been made from this environment — there are
 * no payment credentials anywhere in this project and no network path to any
 * payment provider from this sandbox.
 *
 * Refunds are NEVER executed here — `prepareRefundRequest` only ever
 * produces a `RefundRequestPreparation` whose `requiresHumanApproval` field
 * is the literal `true` (compiler-enforced, not just a runtime check); there
 * is no method on the `PaymentAdapter` interface, implemented or not, that
 * could execute a refund or confirm a booking. Booking confirmation is
 * entirely absent from this file and from the interface it implements.
 */

const ADAPTER_ID = 'hosted-checkout';
const DEFAULT_TIMEOUT_MS = 10_000;

export type HostedCheckoutAdapterOptions = {
  fetchImpl?: typeof fetch;
  clock?: () => Date;
  timeoutMs?: number;
};

type HttpOutcome =
  | { ok: true; status: number; body: unknown }
  | { ok: false; status: number | 'TIMEOUT'; body: unknown };

export class HostedCheckoutPaymentAdapter implements PaymentAdapter {
  readonly adapterId = ADAPTER_ID;
  readonly mode = 'SANDBOX' as const;
  readonly simulated = false;

  private readonly fetchImpl: typeof fetch;
  private readonly clock: () => Date;
  private readonly timeoutMs: number;

  constructor(private readonly credentials: HostedPaymentCredentials, options: HostedCheckoutAdapterOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.clock = options.clock ?? (() => new Date());
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<HttpOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.credentials.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.credentials.apiKey}`,
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
      let parsedBody: unknown = null;
      try {
        parsedBody = await response.json();
      } catch {
        parsedBody = null;
      }
      if (!response.ok) return { ok: false, status: response.status, body: parsedBody };
      return { ok: true, status: response.status, body: parsedBody };
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError';
      return { ok: false, status: isAbort ? 'TIMEOUT' : 500, body: null };
    } finally {
      clearTimeout(timer);
    }
  }

  private mapFailure(status: number | 'TIMEOUT'): { kind: string; code: string } {
    if (status === 'TIMEOUT') return { kind: 'TIMEOUT', code: 'PAYMENT_TIMEOUT' };
    if (status === 401 || status === 403) return { kind: 'TERMINAL_FAILURE', code: 'PAYMENT_AUTH_FAILED' };
    if (status === 429) return { kind: 'RATE_LIMIT', code: 'PAYMENT_RATE_LIMITED' };
    if (status === 400 || status === 422) return { kind: 'VALIDATION', code: 'PAYMENT_VALIDATION' };
    if (typeof status === 'number' && status >= 500) return { kind: 'UNAVAILABLE', code: 'PAYMENT_PROVIDER_UNAVAILABLE' };
    return { kind: 'TERMINAL_FAILURE', code: 'PAYMENT_UNKNOWN_FAILURE' };
  }

  async createPayment(request: CreatePaymentRequest): Promise<PaymentResult<PaymentIntent>> {
    const parsed = createPaymentRequestSchema.safeParse(request);
    if (!parsed.success) return { ok: false, error: { kind: 'VALIDATION', code: 'PAYMENT_VALIDATION' } };
    const { expectedAmountMinor, currency, correlationId } = parsed.data;

    const outcome = await this.request('POST', '/v1/payment-intents', {
      merchantId: this.credentials.merchantId,
      reference: correlationId,
      amountMinor: expectedAmountMinor,
      currency
    });
    if (!outcome.ok) return { ok: false, error: this.mapFailure(outcome.status) };

    const body = hostedCheckoutCreateResponseSchema.safeParse(outcome.body);
    if (!body.success) return { ok: false, error: { kind: 'TERMINAL_FAILURE', code: 'PAYMENT_MALFORMED_RESPONSE' } };

    const intent: PaymentIntent = {
      intentReference: body.data.id,
      hostedPaymentUrl: body.data.hostedUrl,
      expectedAmountMinor,
      currency,
      detectedStatus: 'PENDING',
      source: paymentSourceForMode(this.mode),
      simulated: false,
      createdAt: this.clock().toISOString()
    };
    return { ok: true, value: intent };
  }

  async lookupStatus(request: PaymentStatusRequest): Promise<PaymentResult<PaymentDetectedStatus>> {
    const parsed = paymentStatusRequestSchema.safeParse(request);
    if (!parsed.success) return { ok: false, error: { kind: 'VALIDATION', code: 'PAYMENT_VALIDATION' } };

    const outcome = await this.request('GET', `/v1/payment-intents/${encodeURIComponent(parsed.data.intentReference)}`);
    if (!outcome.ok) return { ok: false, error: this.mapFailure(outcome.status) };

    const body = hostedCheckoutStatusResponseSchema.safeParse(outcome.body);
    if (!body.success) return { ok: false, error: { kind: 'TERMINAL_FAILURE', code: 'PAYMENT_MALFORMED_RESPONSE' } };

    const mapped: Record<string, PaymentDetectedStatus> = {
      PENDING: 'PENDING', PAID: 'DETECTED', FAILED: 'FAILED', CANCELLED: 'FAILED', EXPIRED: 'FAILED'
    };
    return { ok: true, value: mapped[body.data.status] ?? 'NONE' };
  }

  async cancel(intentReference: string): Promise<PaymentResult<PaymentDetectedStatus>> {
    if (!intentReference || intentReference.length > 128) {
      return { ok: false, error: { kind: 'VALIDATION', code: 'PAYMENT_VALIDATION' } };
    }
    const outcome = await this.request('POST', `/v1/payment-intents/${encodeURIComponent(intentReference)}/cancel`);
    if (!outcome.ok) return { ok: false, error: this.mapFailure(outcome.status) };
    return { ok: true, value: 'FAILED' };
  }

  /** NEVER calls a live refund-execution endpoint. Only produces a
   *  human-approval-required preparation, exactly like the simulation
   *  adapter — there is no other code path available to this method. */
  async prepareRefundRequest(
    paymentId: string,
    refundableAmountMinor: number,
    currency: PaymentRecord['currency']
  ): Promise<PaymentResult<RefundRequestPreparation>> {
    const preparation = refundRequestPreparationSchema.safeParse({
      paymentId,
      refundableAmountMinor,
      currency,
      refundRequestStatus: 'PREPARED',
      requiresHumanApproval: true,
      simulated: false,
      preparedAt: this.clock().toISOString()
    });
    if (!preparation.success) return { ok: false, error: { kind: 'VALIDATION', code: 'REFUND_VALIDATION' } };
    return { ok: true, value: preparation.data };
  }

  /** HMAC-SHA256(timestamp.body, secret), timing-safe comparison. This is
   *  the exact contract SimulationPaymentAdapter (Phase 3A) already
   *  establishes as "what a real adapter must implement" — not invented
   *  here, just implemented for real. Fails closed on any malformed input. */
  verifyWebhookSignature(webhook: InboundWebhook, secret: string): boolean {
    if (!secret || !webhook?.signature || !webhook?.body || !webhook?.timestamp) return false;
    const expected = createHmac('sha256', secret).update(`${webhook.timestamp}.${webhook.body}`).digest('hex');
    const provided = webhook.signature;
    if (provided.length !== expected.length) return false;
    try {
      return timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
      return false;
    }
  }

  async health(): Promise<PaymentHealth> {
    // A real health probe would call a lightweight status endpoint; without
    // live credentials or network access this cannot be exercised, so health
    // reports unhealthy rather than fabricating success.
    const outcome = await this.request('GET', '/v1/payment-intents/health-check').catch(() => ({ ok: false as const, status: 500 as const, body: null }));
    return {
      adapterId: this.adapterId,
      mode: this.mode,
      simulated: false,
      healthy: outcome.ok,
      checkedAt: this.clock().toISOString()
    };
  }
}

/** Test/certification helper — mirrors signSimulatedWebhook exactly. */
export function signHostedCheckoutWebhook(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}
