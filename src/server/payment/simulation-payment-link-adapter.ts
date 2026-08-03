import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { signHostedCheckoutWebhook } from './providers/hosted-checkout/hosted-checkout-adapter';
import type { InboundWebhook } from './integration-contract';

/**
 * Phase 4B — simulation payment-link adapter.
 *
 * No live provider is connected (no payment provider has been approved — see
 * the Phase 4B runbook). This creates a fixture hosted-checkout URL and can
 * sign a synthetic webhook using the exact same HMAC-SHA256(timestamp.body,
 * secret) scheme already established and tested in Phase 3C Part 3 —
 * reused via `signHostedCheckoutWebhook`, not reinvented.
 */
export class SimulationPaymentLinkAdapter {
  readonly mode = 'SIMULATION' as const;
  readonly simulated = true;

  async createHostedCheckout(params: { orderReference: string; amountMinor: number; currency: string }): Promise<{ hostedUrl: string }> {
    return { hostedUrl: `https://simulation.invalid/pay/${params.orderReference}` };
  }

  verifyWebhookSignature(webhook: InboundWebhook, secret: string): boolean {
    if (!secret || !webhook?.signature || !webhook?.body || !webhook?.timestamp) return false;
    const expected = createHmac('sha256', secret).update(`${webhook.timestamp}.${webhook.body}`).digest('hex');
    if (webhook.signature.length !== expected.length) return false;
    try {
      return timingSafeEqual(Buffer.from(webhook.signature, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
      return false;
    }
  }
}

/** Test/fixture helper — signs a simulated payment-link webhook body. */
export function signPaymentLinkWebhook(secret: string, timestamp: string, body: string): string {
  return signHostedCheckoutWebhook(secret, timestamp, body);
}

export function newSimulatedEventId(): string {
  return `sim-link-evt-${randomUUID()}`;
}
