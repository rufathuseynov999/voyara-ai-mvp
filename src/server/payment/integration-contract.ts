import { z } from 'zod';
import {
  commercialSources,
  integrationModes,
  type CommercialSource,
  type IntegrationMode
} from '@/server/supplier/contract';

/**
 * Phase 3A Part 4 — provider-neutral payment contracts.
 *
 * Strict separation of commercial concepts: expected vs received amount,
 * detected vs verified status, provider fees, supplier payable, VOYARA revenue
 * (only when authoritatively known), cash received, refundable amount. No fee,
 * revenue or markup value is invented anywhere; unknown values are null.
 *
 * Detection is never verification: a detected payment sets `detectedStatus`
 * only; `verifiedStatus` becomes VERIFIED exclusively through an exact,
 * authoritative reconciliation match.
 */

const minorAmountSchema = z.number().int().min(0).max(10_000_000_000);
const currencySchema = z.enum(['AZN', 'USD', 'EUR', 'TRY', 'AED']);
const correlationIdSchema = z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/);

export const paymentDetectedStatuses = ['NONE', 'PENDING', 'DETECTED', 'FAILED'] as const;
export type PaymentDetectedStatus = (typeof paymentDetectedStatuses)[number];

export const paymentVerifiedStatuses = ['UNVERIFIED', 'VERIFIED', 'REJECTED'] as const;
export type PaymentVerifiedStatus = (typeof paymentVerifiedStatuses)[number];

export const reconciliationStatuses = [
  'PENDING',
  'MATCHED',
  'PARTIAL',
  'EXCESS',
  'CURRENCY_MISMATCH',
  'DUPLICATE',
  'MISSING_REFERENCE',
  'STATUS_DISAGREEMENT',
  'WRONG_QUOTE',
  'AFTER_EXPIRY'
] as const;
export type ReconciliationStatus = (typeof reconciliationStatuses)[number];

export const refundRequestStatuses = ['NONE', 'REQUESTED', 'PREPARED'] as const;
export type RefundRequestStatus = (typeof refundRequestStatuses)[number];

/** The canonical payment record. Money is minor units; unknown commercial
 *  values are explicitly null rather than guessed. */
export const paymentRecordSchema = z.object({
  paymentId: z.string().uuid(),
  quoteId: z.string().uuid(),
  tenantId: z.string().uuid(),
  customerId: z.string().uuid(),
  expectedAmountMinor: minorAmountSchema,
  receivedAmountMinor: minorAmountSchema.nullable(),
  currency: currencySchema,
  receivedCurrency: currencySchema.nullable(),
  providerTransactionReference: z.string().trim().min(1).max(128).nullable(),
  intentReference: z.string().trim().min(1).max(128),
  detectedStatus: z.enum(paymentDetectedStatuses),
  verifiedStatus: z.enum(paymentVerifiedStatuses),
  reconciliationStatus: z.enum(reconciliationStatuses),
  providerFeesMinor: minorAmountSchema.nullable(),
  supplierPayableMinor: minorAmountSchema.nullable(),
  voyaraRevenueMinor: minorAmountSchema.nullable(),
  cashReceivedMinor: minorAmountSchema.nullable(),
  refundableAmountMinor: minorAmountSchema.nullable(),
  refundRequestStatus: z.enum(refundRequestStatuses),
  bookingAllocationReference: z.string().trim().min(1).max(128).nullable(),
  correlationId: correlationIdSchema,
  source: z.enum(commercialSources),
  simulated: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string()
}).strict();
export type PaymentRecord = z.infer<typeof paymentRecordSchema>;

/* --------------------------- Adapter requests ---------------------------- */

export const createPaymentRequestSchema = z.object({
  quoteId: z.string().uuid(),
  expectedAmountMinor: minorAmountSchema,
  currency: currencySchema,
  correlationId: correlationIdSchema
}).strict();
export type CreatePaymentRequest = z.infer<typeof createPaymentRequestSchema>;

export const paymentStatusRequestSchema = z.object({
  intentReference: z.string().trim().min(1).max(128),
  correlationId: correlationIdSchema
}).strict();
export type PaymentStatusRequest = z.infer<typeof paymentStatusRequestSchema>;

/** A prepared payment intent / hosted link. Contains no secrets. */
export const paymentIntentSchema = z.object({
  intentReference: z.string().trim().min(1).max(128),
  hostedPaymentUrl: z.string().url().nullable(),
  expectedAmountMinor: minorAmountSchema,
  currency: currencySchema,
  detectedStatus: z.enum(paymentDetectedStatuses),
  source: z.enum(commercialSources),
  simulated: z.boolean(),
  createdAt: z.string()
}).strict();
export type PaymentIntent = z.infer<typeof paymentIntentSchema>;

/** A refund-request preparation (never an executed refund). */
export const refundRequestPreparationSchema = z.object({
  paymentId: z.string().uuid(),
  refundableAmountMinor: minorAmountSchema,
  currency: currencySchema,
  refundRequestStatus: z.literal('PREPARED'),
  requiresHumanApproval: z.literal(true),
  simulated: z.boolean(),
  preparedAt: z.string()
}).strict();
export type RefundRequestPreparation = z.infer<typeof refundRequestPreparationSchema>;

/* ------------------------------ Webhook types ---------------------------- */

/** A raw inbound webhook, before verification. */
export type InboundWebhook = {
  eventId: string;
  eventType: string;
  timestamp: string;
  signature: string;
  body: string;
};

/** An immutable, stored webhook receipt (no secrets, no raw signature). */
export const webhookReceiptSchema = z.object({
  eventId: z.string().min(1).max(128),
  eventType: z.string().min(1).max(80),
  receivedAt: z.string(),
  correlationId: z.string().min(1).max(128),
  accepted: z.boolean(),
  reasonCode: z.string().min(1).max(64)
}).strict();
export type WebhookReceipt = z.infer<typeof webhookReceiptSchema>;

/* ------------------------------ Adapter result --------------------------- */

export type PaymentResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { kind: string; code: string } };

export type PaymentHealth = {
  adapterId: string;
  mode: IntegrationMode;
  simulated: boolean;
  healthy: boolean;
  checkedAt: string;
};

export interface PaymentAdapter {
  readonly adapterId: string;
  readonly mode: IntegrationMode;
  readonly simulated: boolean;
  createPayment(request: CreatePaymentRequest): Promise<PaymentResult<PaymentIntent>>;
  lookupStatus(request: PaymentStatusRequest): Promise<PaymentResult<PaymentDetectedStatus>>;
  cancel(intentReference: string): Promise<PaymentResult<PaymentDetectedStatus>>;
  prepareRefundRequest(paymentId: string, refundableAmountMinor: number, currency: PaymentRecord['currency']): Promise<PaymentResult<RefundRequestPreparation>>;
  verifyWebhookSignature(webhook: InboundWebhook, secret: string): boolean;
  health(): Promise<PaymentHealth>;
}

export function paymentSourceForMode(mode: IntegrationMode): Exclude<CommercialSource, 'MANUAL'> {
  return mode === 'LIVE' ? 'LIVE' : mode === 'SANDBOX' ? 'SANDBOX' : 'SIMULATED';
}

export { integrationModes };
