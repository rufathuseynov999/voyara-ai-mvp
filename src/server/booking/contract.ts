import { z } from 'zod';
import { locales, type Locale } from '@/i18n/config';

export const bookingStatuses = [
  'CREATED',
  'SUPPLIER_EXECUTED',
  'SUPPLIER_CONFIRMED',
  'UNDER_VERIFICATION',
  'VERIFICATION_REJECTED',
  'BOOKING_VERIFIED',
  'VOUCHER_DRAFTED',
  'VOUCHER_ISSUED'
] as const;
export type BookingStatus = (typeof bookingStatuses)[number];

export const supplierExecutionChannels = [
  'SUPPLIER_PORTAL',
  'EMAIL',
  'PHONE',
  'MESSAGING'
] as const;
export type SupplierExecutionChannel = (typeof supplierExecutionChannels)[number];

export const supplierConfirmationChannels = [
  'SUPPLIER_PORTAL',
  'EMAIL',
  'PHONE',
  'MESSAGING'
] as const;
export type SupplierConfirmationChannel = (typeof supplierConfirmationChannels)[number];

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const evidenceTimestampSchema = z.iso.datetime({ offset: true });
const supplierNameSchema = z.string().trim().min(2).max(120);
const referenceSchema = z.string().trim().min(3).max(120);
const serviceSummarySchema = z.string().trim().min(3).max(500);
const noteSchema = z.string().trim().max(500);

const executionDetailsSchema = z.object({
  channel: z.enum(supplierExecutionChannels),
  supplierName: supplierNameSchema,
  executedAt: evidenceTimestampSchema,
  requestReference: referenceSchema,
  serviceSummary: serviceSummarySchema,
  note: noteSchema,
  declarationConfirmed: z.literal(true)
}).strict();

const confirmationDetailsSchema = z.object({
  channel: z.enum(supplierConfirmationChannels),
  confirmedAt: evidenceTimestampSchema,
  confirmationReference: referenceSchema,
  serviceSummary: serviceSummarySchema,
  note: noteSchema,
  declarationConfirmed: z.literal(true)
}).strict();

export const staffBookingCommandSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('booking.create'),
    paymentRequestId: z.uuid(),
    readinessEvaluationId: z.uuid(),
    readinessHash: sha256Schema
  }).strict(),
  z.object({
    action: z.literal('supplier_booking.complete'),
    bookingId: z.uuid(),
    execution: executionDetailsSchema
  }).strict(),
  z.object({
    action: z.literal('supplier_confirmation.capture'),
    bookingId: z.uuid(),
    executionId: z.uuid(),
    executionHash: sha256Schema,
    confirmation: confirmationDetailsSchema
  }).strict()
]);

export const bookingCreationCanonicalPayloadSchema = z.object({
  schemaVersion: z.literal('booking-creation-v1'),
  paymentRequestId: z.uuid(),
  readinessEvaluationId: z.uuid(),
  readinessHash: sha256Schema,
  acceptanceId: z.uuid(),
  quotationId: z.uuid(),
  quotationVersion: z.number().int().positive(),
  quotationHash: sha256Schema
}).strict();

export const supplierExecutionCanonicalPayloadSchema = z.object({
  schemaVersion: z.literal('supplier-execution-v1'),
  bookingId: z.uuid(),
  channel: z.enum(supplierExecutionChannels),
  supplierName: supplierNameSchema,
  executedAt: evidenceTimestampSchema,
  requestReference: referenceSchema,
  serviceSummary: serviceSummarySchema,
  note: noteSchema,
  declarationConfirmed: z.literal(true)
}).strict();

export const supplierConfirmationCanonicalPayloadSchema = z.object({
  schemaVersion: z.literal('supplier-confirmation-v1'),
  bookingId: z.uuid(),
  executionId: z.uuid(),
  executionHash: sha256Schema,
  supplierName: supplierNameSchema,
  channel: z.enum(supplierConfirmationChannels),
  confirmedAt: evidenceTimestampSchema,
  confirmationReference: referenceSchema,
  serviceSummary: serviceSummarySchema,
  note: noteSchema,
  declarationConfirmed: z.literal(true)
}).strict();

export type StaffBookingCommand = z.infer<typeof staffBookingCommandSchema>;
export type BookingCreationCanonicalPayload = z.infer<typeof bookingCreationCanonicalPayloadSchema>;
export type SupplierExecutionCanonicalPayload = z.infer<typeof supplierExecutionCanonicalPayloadSchema>;
export type SupplierConfirmationCanonicalPayload = z.infer<typeof supplierConfirmationCanonicalPayloadSchema>;

export function buildCanonicalBookingCreationPayload(input: {
  paymentRequestId: string;
  readinessEvaluationId: string;
  readinessHash: string;
  acceptanceId: string;
  quotationId: string;
  quotationVersion: number;
  quotationHash: string;
}): BookingCreationCanonicalPayload {
  return bookingCreationCanonicalPayloadSchema.parse({
    schemaVersion: 'booking-creation-v1',
    ...input
  });
}

export function buildCanonicalSupplierExecutionPayload(
  bookingId: string,
  execution: z.infer<typeof executionDetailsSchema>
): SupplierExecutionCanonicalPayload {
  const parsed = executionDetailsSchema.parse(execution);
  return supplierExecutionCanonicalPayloadSchema.parse({
    schemaVersion: 'supplier-execution-v1',
    bookingId,
    ...parsed,
    executedAt: new Date(parsed.executedAt).toISOString()
  });
}

export function buildCanonicalSupplierConfirmationPayload(input: {
  bookingId: string;
  executionId: string;
  executionHash: string;
  supplierName: string;
  confirmation: z.infer<typeof confirmationDetailsSchema>;
}): SupplierConfirmationCanonicalPayload {
  const parsed = confirmationDetailsSchema.parse(input.confirmation);
  return supplierConfirmationCanonicalPayloadSchema.parse({
    schemaVersion: 'supplier-confirmation-v1',
    bookingId: input.bookingId,
    executionId: input.executionId,
    executionHash: input.executionHash,
    supplierName: input.supplierName,
    ...parsed,
    confirmedAt: new Date(parsed.confirmedAt).toISOString()
  });
}

export type BookingCommandResult = {
  status: 'accepted' | 'denied';
  reasonCode?: string;
  commandName?: StaffBookingCommand['action'];
  bookingId?: string;
  bookingStatus?: BookingStatus;
  paymentRequestId?: string;
  readinessEvaluationId?: string;
  readinessHash?: string;
  quotationId?: string;
  versionNumber?: number;
  quotationHash?: string;
  executionId?: string;
  executionHash?: string;
  supplierConfirmationId?: string;
  supplierConfirmationHash?: string;
  workReceiptId?: string;
};

export type CustomerBookingView = {
  id: string;
  quotationId: string;
  versionNumber: number;
  quotationHash: string;
  locale: Locale;
  status: BookingStatus;
  createdAt: string;
  supplierExecutedAt: string | null;
  supplierConfirmedAt: string | null;
  verificationStartedAt: string | null;
  verifiedAt: string | null;
  voucherIssuedAt: string | null;
  voucher: null | {
    id: string;
    versionNumber: number;
    voucherHash: string;
    issuedAt: string;
    supplierName: string;
    confirmationReference: string;
    confirmationSummary: string;
    title: string;
    summary: string;
    services: Array<{
      sequence: number;
      category: 'FLIGHT' | 'HOTEL' | 'TRANSFER' | 'ACTIVITY' | 'OTHER';
      title: string;
      details: string;
      serviceDate: string;
      customerReference: string;
    }>;
    supportContact: string;
    customerNotes: string;
  };
};

export type BookingOperationsCase = {
  financialReadiness: {
    paymentRequestId: string;
    readinessEvaluationId: string;
    readinessHash: string;
    customerId: string;
    quotationId: string;
    versionNumber: number;
    quotationHash: string;
    locale: Locale;
    title: string;
    amountMinor: number;
    currency: 'AZN';
    readyAt: string;
  };
  booking: null | (CustomerBookingView & {
    customerId: string;
    bookingAuthorityHash: string;
    execution: null | {
      id: string;
      executionHash: string;
      channel: SupplierExecutionChannel;
      supplierName: string;
      executedAt: string;
      requestReference: string;
      serviceSummary: string;
      note: string;
      recordedAt: string;
      executedBy: string;
    };
    confirmation: null | {
      id: string;
      versionNumber: number;
      confirmationHash: string;
      channel: SupplierConfirmationChannel;
      confirmationReference: string;
      serviceSummary: string;
      note: string;
      confirmedAt: string;
      capturedAt: string;
      capturedBy: string;
      supersedesConfirmationId: string | null;
      rejectionVerificationId: string | null;
    };
    verificationReview: null | {
      id: string;
      reviewerId: string;
      startedAt: string;
    };
    verification: null | {
      id: string;
      verificationHash: string;
      decision: 'VERIFY' | 'REJECT';
      reason: string;
      decidedBy: string;
      decidedAt: string;
      checks: {
        customerDetailsMatch: boolean;
        datesAndServicesMatch: boolean;
        supplierReferenceValidated: boolean;
        priceAndTermsMatch: boolean;
      };
    };
    voucherRecord: null | {
      id: string;
      status: 'DRAFT' | 'ISSUED';
      currentVersion: number;
      currentHash: string;
      issuedAt: string | null;
    };
  });
};

export function isBookingLocale(value: string): value is Locale {
  return locales.includes(value as Locale);
}
