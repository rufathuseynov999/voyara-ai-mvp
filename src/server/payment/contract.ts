import { z } from 'zod';
import { locales, type Locale } from '@/i18n/config';

export const paymentRequestStatuses = [
  'REQUESTED',
  'EVIDENCE_RECEIVED',
  'UNDER_REVIEW',
  'EVIDENCE_REJECTED',
  'VERIFIED',
  'ALLOCATED',
  'READY_FOR_BOOKING'
] as const;
export type PaymentRequestStatus = (typeof paymentRequestStatuses)[number];

export const customerEvidenceChannels = [
  'BANK_TRANSFER_REFERENCE',
  'CARD_PAYMENT_REFERENCE'
] as const;
export const financeDetectionChannels = [
  'BANK_STATEMENT',
  'ACQUIRER_DASHBOARD'
] as const;
export const paymentEvidenceChannels = [
  ...customerEvidenceChannels,
  ...financeDetectionChannels
] as const;
export type PaymentEvidenceChannel = (typeof paymentEvidenceChannels)[number];

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const exactQuotationReference = {
  quotationId: z.uuid(),
  versionNumber: z.coerce.number().int().positive(),
  quotationHash: sha256Schema
};
const exactEvidenceReference = {
  paymentRequestId: z.uuid(),
  evidenceId: z.uuid(),
  evidenceHash: sha256Schema
};

function aznToMinor(value: string): number {
  const [whole, fraction = ''] = value.split('.');
  return Number(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')));
}

const aznAmountSchema = z.string().trim().regex(/^\d{1,10}(?:\.\d{1,2})?$/)
  .refine((value) => aznToMinor(value) > 0 && aznToMinor(value) <= 1_000_000_000_000);
const evidenceTimestampSchema = z.iso.datetime({ offset: true });

const evidenceDetailsSchema = z.object({
  amountAzn: aznAmountSchema,
  observedAt: evidenceTimestampSchema,
  externalReference: z.string().trim().min(3).max(120),
  note: z.string().trim().max(500),
  declarationConfirmed: z.literal(true)
}).strict();

export const customerPaymentCommandSchema = z.object({
  action: z.literal('payment.evidence.submit'),
  paymentRequestId: z.uuid(),
  channel: z.enum(customerEvidenceChannels),
  evidence: evidenceDetailsSchema
}).strict();

export const staffPaymentCommandSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('payment_request.create'),
    ...exactQuotationReference
  }).strict(),
  z.object({
    action: z.literal('payment.detection.record'),
    paymentRequestId: z.uuid(),
    channel: z.enum(financeDetectionChannels),
    evidence: evidenceDetailsSchema
  }).strict(),
  z.object({
    action: z.literal('payment.review.start'),
    ...exactEvidenceReference
  }).strict(),
  z.object({
    action: z.literal('payment.verify'),
    ...exactEvidenceReference,
    decision: z.enum(['VERIFY', 'REJECT']),
    reason: z.string().trim().min(3).max(500)
  }).strict(),
  z.object({
    action: z.literal('funds.allocate'),
    paymentRequestId: z.uuid(),
    verificationId: z.uuid(),
    verificationHash: sha256Schema
  }).strict(),
  z.object({
    action: z.literal('payment.evaluate_readiness'),
    paymentRequestId: z.uuid(),
    allocationId: z.uuid(),
    allocationHash: sha256Schema
  }).strict()
]);

export const paymentEvidenceCanonicalPayloadSchema = z.object({
  schemaVersion: z.literal('payment-evidence-v1'),
  paymentRequestId: z.uuid(),
  sourceKind: z.enum(['CUSTOMER_EVIDENCE', 'FINANCE_DETECTION']),
  channel: z.enum(paymentEvidenceChannels),
  currency: z.literal('AZN'),
  amountMinor: z.number().int().positive().max(1_000_000_000_000),
  observedAt: evidenceTimestampSchema,
  externalReference: z.string().min(3).max(120),
  note: z.string().max(500),
  declarationConfirmed: z.literal(true)
}).strict();

export const paymentVerificationCanonicalPayloadSchema = z.object({
  schemaVersion: z.literal('payment-verification-v1'),
  paymentRequestId: z.uuid(),
  evidenceId: z.uuid(),
  evidenceHash: sha256Schema,
  decision: z.enum(['VERIFY', 'REJECT']),
  reason: z.string().min(3).max(500)
}).strict();

export const fundsAllocationCanonicalPayloadSchema = z.object({
  schemaVersion: z.literal('funds-allocation-v1'),
  paymentRequestId: z.uuid(),
  verificationId: z.uuid(),
  verificationHash: sha256Schema,
  currency: z.literal('AZN'),
  amountMinor: z.number().int().positive().max(1_000_000_000_000)
}).strict();

export const readinessInputCanonicalPayloadSchema = z.object({
  schemaVersion: z.literal('financial-readiness-input-v1'),
  paymentRequestId: z.uuid(),
  allocationId: z.uuid(),
  allocationHash: sha256Schema
}).strict();

export type CustomerPaymentCommand = z.infer<typeof customerPaymentCommandSchema>;
export type StaffPaymentCommand = z.infer<typeof staffPaymentCommandSchema>;
export type PaymentCommand = CustomerPaymentCommand | StaffPaymentCommand;
export type PaymentEvidenceCanonicalPayload = z.infer<typeof paymentEvidenceCanonicalPayloadSchema>;
export type PaymentVerificationCanonicalPayload = z.infer<typeof paymentVerificationCanonicalPayloadSchema>;
export type FundsAllocationCanonicalPayload = z.infer<typeof fundsAllocationCanonicalPayloadSchema>;
export type ReadinessInputCanonicalPayload = z.infer<typeof readinessInputCanonicalPayloadSchema>;

export function buildCanonicalPaymentEvidencePayload(
  paymentRequestId: string,
  sourceKind: PaymentEvidenceCanonicalPayload['sourceKind'],
  channel: PaymentEvidenceChannel,
  evidence: z.infer<typeof evidenceDetailsSchema>
): PaymentEvidenceCanonicalPayload {
  const parsed = evidenceDetailsSchema.parse(evidence);
  const payload = {
    schemaVersion: 'payment-evidence-v1' as const,
    paymentRequestId,
    sourceKind,
    channel,
    currency: 'AZN' as const,
    amountMinor: aznToMinor(parsed.amountAzn),
    observedAt: new Date(parsed.observedAt).toISOString(),
    externalReference: parsed.externalReference,
    note: parsed.note,
    declarationConfirmed: true as const
  };
  return paymentEvidenceCanonicalPayloadSchema.parse(payload);
}

export function buildCanonicalPaymentVerificationPayload(
  input: Pick<Extract<StaffPaymentCommand, { action: 'payment.verify' }>,
    'paymentRequestId' | 'evidenceId' | 'evidenceHash' | 'decision' | 'reason'>
): PaymentVerificationCanonicalPayload {
  return paymentVerificationCanonicalPayloadSchema.parse({
    schemaVersion: 'payment-verification-v1',
    paymentRequestId: input.paymentRequestId,
    evidenceId: input.evidenceId,
    evidenceHash: input.evidenceHash,
    decision: input.decision,
    reason: input.reason.trim()
  });
}

export function buildCanonicalFundsAllocationPayload(input: {
  paymentRequestId: string;
  verificationId: string;
  verificationHash: string;
  amountMinor: number;
}): FundsAllocationCanonicalPayload {
  return fundsAllocationCanonicalPayloadSchema.parse({
    schemaVersion: 'funds-allocation-v1',
    paymentRequestId: input.paymentRequestId,
    verificationId: input.verificationId,
    verificationHash: input.verificationHash,
    currency: 'AZN',
    amountMinor: input.amountMinor
  });
}

export function buildCanonicalReadinessInputPayload(input: {
  paymentRequestId: string;
  allocationId: string;
  allocationHash: string;
}): ReadinessInputCanonicalPayload {
  return readinessInputCanonicalPayloadSchema.parse({
    schemaVersion: 'financial-readiness-input-v1',
    ...input
  });
}

export type PaymentCommandResult = {
  status: 'accepted' | 'denied';
  reasonCode?: string;
  commandName?: PaymentCommand['action'];
  paymentRequestId?: string;
  paymentStatus?: PaymentRequestStatus;
  quotationId?: string;
  versionNumber?: number;
  quotationHash?: string;
  evidenceId?: string;
  evidenceHash?: string;
  verificationId?: string;
  verificationHash?: string;
  allocationId?: string;
  allocationHash?: string;
  readinessEvaluationId?: string;
  readinessResult?: 'READY_FOR_BOOKING';
  workReceiptId?: string;
};

export type CustomerPaymentRequestView = {
  id: string;
  quotationId: string;
  versionNumber: number;
  quotationHash: string;
  locale: Locale;
  currency: 'AZN';
  amountMinor: number;
  status: PaymentRequestStatus;
  createdAt: string;
  updatedAt: string;
  evidenceReceivedAt: string | null;
  reviewStartedAt: string | null;
  verifiedAt: string | null;
  allocatedAt: string | null;
  readinessEvaluatedAt: string | null;
};

export type FinancePaymentCase = {
  quotation: {
    id: string;
    versionNumber: number;
    payloadHash: string;
    customerId: string;
    locale: Locale;
    title: string;
    amountMinor: number;
    currency: 'AZN';
    acceptedAt: string;
  };
  payment: null | (CustomerPaymentRequestView & {
    customerId: string;
    currentEvidence: null | {
      id: string;
      evidenceHash: string;
      sourceKind: PaymentEvidenceCanonicalPayload['sourceKind'];
      channel: PaymentEvidenceChannel;
      amountMinor: number;
      observedAt: string;
      externalReference: string;
      note: string;
      createdAt: string;
    };
    verification: null | {
      id: string;
      verificationHash: string;
      decision: 'VERIFY' | 'REJECT';
      reason: string;
      decidedAt: string;
    };
    allocation: null | {
      id: string;
      allocationHash: string;
      amountMinor: number;
      allocatedAt: string;
    };
  });
};
