import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
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
} from './integration-contract';

/**
 * Deterministic simulation payment adapter.
 *
 * Fully offline. Produces repeatable, clearly simulated references. Detection
 * scenarios are driven by reserved tokens embedded in the correlation ID so
 * tests can exercise pending/failed/partial/excess/currency-mismatch without
 * any real provider. It NEVER treats detection as verification (verification is
 * a reconciliation decision, not an adapter output) and NEVER issues a real
 * refund (only prepares a human-approval refund request).
 */

const ADAPTER_ID = 'simulation';
const FIXED_CLOCK = Date.parse('2026-07-20T09:00:00.000Z');

export class SimulationPaymentAdapter implements PaymentAdapter {
  readonly adapterId = ADAPTER_ID;
  readonly mode = 'SIMULATION' as const;
  readonly simulated = true;

  async createPayment(request: CreatePaymentRequest): Promise<PaymentResult<PaymentIntent>> {
    const parsed = createPaymentRequestSchema.safeParse(request);
    if (!parsed.success) return { ok: false, error: { kind: 'VALIDATION', code: 'PAYMENT_VALIDATION' } };
    const { quoteId, expectedAmountMinor, currency, correlationId } = parsed.data;

    const intentReference = `SIM-PI-${createHash('sha256').update(`${quoteId}|${correlationId}`).digest('hex').slice(0, 16)}`;
    const intent: PaymentIntent = {
      intentReference,
      hostedPaymentUrl: `https://sim.voyara.local/pay/${intentReference}`,
      expectedAmountMinor,
      currency,
      detectedStatus: 'PENDING',
      source: paymentSourceForMode('SIMULATION'),
      simulated: true,
      createdAt: new Date(FIXED_CLOCK).toISOString()
    };
    return { ok: true, value: intent };
  }

  async lookupStatus(request: PaymentStatusRequest): Promise<PaymentResult<PaymentDetectedStatus>> {
    const parsed = paymentStatusRequestSchema.safeParse(request);
    if (!parsed.success) return { ok: false, error: { kind: 'VALIDATION', code: 'PAYMENT_VALIDATION' } };
    const token = parsed.data.correlationId.toUpperCase();
    // Deterministic scenario mapping. Default is DETECTED.
    if (token.includes('SIM-PENDING')) return { ok: true, value: 'PENDING' };
    if (token.includes('SIM-FAILED')) return { ok: true, value: 'FAILED' };
    return { ok: true, value: 'DETECTED' };
  }

  async cancel(intentReference: string): Promise<PaymentResult<PaymentDetectedStatus>> {
    if (!intentReference || intentReference.length > 128) {
      return { ok: false, error: { kind: 'VALIDATION', code: 'PAYMENT_VALIDATION' } };
    }
    return { ok: true, value: 'FAILED' };
  }

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
      simulated: true,
      preparedAt: new Date(FIXED_CLOCK).toISOString()
    });
    if (!preparation.success) return { ok: false, error: { kind: 'VALIDATION', code: 'REFUND_VALIDATION' } };
    return { ok: true, value: preparation.data };
  }

  /** HMAC-SHA256 signature check with constant-time comparison. Fails closed on
   *  any malformed input. This same verification is what a real adapter must
   *  implement, so the contract test binds future adapters to it. */
  verifyWebhookSignature(webhook: InboundWebhook, secret: string): boolean {
    if (!secret || !webhook?.signature || !webhook?.body || !webhook?.timestamp) return false;
    const expected = createHmac('sha256', secret)
      .update(`${webhook.timestamp}.${webhook.body}`)
      .digest('hex');
    const provided = webhook.signature;
    if (provided.length !== expected.length) return false;
    try {
      return timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
      return false;
    }
  }

  async health(): Promise<PaymentHealth> {
    return {
      adapterId: ADAPTER_ID,
      mode: 'SIMULATION',
      simulated: true,
      healthy: true,
      checkedAt: new Date(FIXED_CLOCK).toISOString()
    };
  }
}

/** Test/utility helper: produce a valid signature for a body+timestamp. */
export function signSimulatedWebhook(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}
