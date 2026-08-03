/**
 * Phase 3C Part 3 — generic hosted-checkout wire contract.
 *
 * IMPORTANT: no payment provider has been approved by the founder (checked
 * explicitly against environment variables, uploaded documents, and the
 * founder's own financial model — see the Part 3 checkpoint). This is
 * therefore NOT a real provider's API shape the way hotelbeds-contract.ts is
 * modeled on Hotelbeds' actual documented contract. This is VOYARA's own
 * minimal reference request/response shape for a generic hosted-checkout
 * flow (create a payment intent, get a hosted URL back, receive a signed
 * webhook on completion) — the kind of shape most hosted-checkout providers
 * expose in some form, but not asserted to be any specific one's exact field
 * names or endpoint paths.
 *
 * Once the founder selects and approves a specific provider, this file (and
 * hosted-checkout-adapter.ts's request/response handling) should be updated
 * to match that provider's real, documented API — the certification script
 * (scripts/certify-hosted-payment.mjs) is built to make that gap obvious the
 * moment real credentials are configured, exactly as with Hotelbeds.
 */
import { z } from 'zod';

export const hostedCheckoutCreateRequestSchema = z.object({
  merchantId: z.string(),
  reference: z.string(),
  amountMinor: z.number().int(),
  currency: z.string()
}).strict();
export type HostedCheckoutCreateRequest = z.infer<typeof hostedCheckoutCreateRequestSchema>;

export const hostedCheckoutIntentStatuses = ['PENDING', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED'] as const;

export const hostedCheckoutCreateResponseSchema = z.object({
  id: z.string(),
  hostedUrl: z.string().url(),
  status: z.enum(hostedCheckoutIntentStatuses)
}).strict();
export type HostedCheckoutCreateResponse = z.infer<typeof hostedCheckoutCreateResponseSchema>;

export const hostedCheckoutStatusResponseSchema = z.object({
  id: z.string(),
  status: z.enum(hostedCheckoutIntentStatuses)
}).strict();
export type HostedCheckoutStatusResponse = z.infer<typeof hostedCheckoutStatusResponseSchema>;

export const hostedCheckoutErrorResponseSchema = z.object({
  error: z.object({ code: z.string().optional(), message: z.string().optional() }).strict()
}).strict();
export type HostedCheckoutErrorResponse = z.infer<typeof hostedCheckoutErrorResponseSchema>;

/** The inbound webhook body's payload shape, AFTER signature verification.
 *  The signature itself is verified over the raw string body — see
 *  hosted-checkout-adapter.ts's verifyWebhookSignature, which implements the
 *  exact HMAC-SHA256(timestamp.body, secret) timing-safe scheme already
 *  established by SimulationPaymentAdapter (Phase 3A) as the contract every
 *  real adapter must satisfy — this is VOYARA's own pre-declared webhook
 *  verification contract, not invented for Phase 3C Part 3. */
export const hostedCheckoutWebhookPayloadSchema = z.object({
  eventId: z.string(),
  eventType: z.string(),
  intentId: z.string(),
  status: z.enum(hostedCheckoutIntentStatuses),
  amountMinor: z.number().int(),
  currency: z.string(),
  providerTransactionReference: z.string().nullable()
}).strict();
export type HostedCheckoutWebhookPayload = z.infer<typeof hostedCheckoutWebhookPayloadSchema>;
