import { z } from 'zod';
import { locales } from '@/i18n/config';
import { supplierConfirmationChannels } from '@/server/booking/contract';

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const evidenceTimestampSchema = z.iso.datetime({ offset: true });
const referenceSchema = z.string().trim().min(3).max(120);
const serviceSummarySchema = z.string().trim().min(3).max(500);
const noteSchema = z.string().trim().max(500);

export const verificationDecisions = ['VERIFY', 'REJECT'] as const;
export type VerificationDecision = (typeof verificationDecisions)[number];

export const voucherServiceCategories = [
  'FLIGHT', 'HOTEL', 'TRANSFER', 'ACTIVITY', 'OTHER'
] as const;
export type VoucherServiceCategory = (typeof voucherServiceCategories)[number];

export const voucherPreparationSources = ['HUMAN', 'AI_ASSISTED'] as const;
export type VoucherPreparationSource = (typeof voucherPreparationSources)[number];

const exactEvidenceSchema = z.object({
  bookingId: z.uuid(),
  executionId: z.uuid(),
  executionHash: sha256Schema,
  supplierConfirmationId: z.uuid(),
  supplierConfirmationVersion: z.number().int().positive(),
  supplierConfirmationHash: sha256Schema
}).strict();

const verificationChecksSchema = z.object({
  customerDetailsMatch: z.boolean(),
  datesAndServicesMatch: z.boolean(),
  supplierReferenceValidated: z.boolean(),
  priceAndTermsMatch: z.boolean()
}).strict();

const verificationDetailsSchema = z.object({
  decision: z.enum(verificationDecisions),
  reason: z.string().trim().min(8).max(500),
  checks: verificationChecksSchema,
  declarationConfirmed: z.literal(true)
}).strict().superRefine((value, context) => {
  const allMatch = Object.values(value.checks).every(Boolean);
  if (value.decision === 'VERIFY' && !allMatch) {
    context.addIssue({ code: 'custom', message: 'Every verification check must pass.' });
  }
  if (value.decision === 'REJECT' && allMatch) {
    context.addIssue({ code: 'custom', message: 'A rejected verification must identify a failed check.' });
  }
});

const confirmationCorrectionDetailsSchema = z.object({
  channel: z.enum(supplierConfirmationChannels),
  confirmedAt: evidenceTimestampSchema,
  confirmationReference: referenceSchema,
  serviceSummary: serviceSummarySchema,
  note: noteSchema,
  declarationConfirmed: z.literal(true)
}).strict();

const voucherServiceSchema = z.object({
  sequence: z.number().int().positive(),
  category: z.enum(voucherServiceCategories),
  title: z.string().trim().min(2).max(120),
  details: z.string().trim().min(3).max(500),
  serviceDate: z.iso.date().or(z.literal('')),
  customerReference: z.string().trim().max(120)
}).strict();

const voucherContentSchema = z.object({
  services: z.array(voucherServiceSchema).min(1).max(20),
  supportContact: z.string().trim().min(3).max(120),
  customerNotes: z.string().trim().max(500),
  preparationSource: z.enum(voucherPreparationSources),
  declarationConfirmed: z.literal(true)
}).strict().superRefine((value, context) => {
  const sequences = value.services.map(({ sequence }) => sequence);
  if (new Set(sequences).size !== sequences.length) {
    context.addIssue({ code: 'custom', message: 'Voucher service sequence numbers must be unique.' });
  }
});

export const staffFulfilmentCommandSchema = z.discriminatedUnion('action', [
  exactEvidenceSchema.extend({
    action: z.literal('booking.verification.start')
  }).strict(),
  exactEvidenceSchema.extend({
    action: z.literal('booking.verify'),
    reviewId: z.uuid(),
    verification: verificationDetailsSchema
  }).strict(),
  z.object({
    action: z.literal('supplier_confirmation.correct'),
    bookingId: z.uuid(),
    executionId: z.uuid(),
    executionHash: sha256Schema,
    supplierConfirmationId: z.uuid(),
    supplierConfirmationHash: sha256Schema,
    verificationId: z.uuid(),
    verificationHash: sha256Schema,
    confirmation: confirmationCorrectionDetailsSchema
  }).strict(),
  exactEvidenceSchema.extend({
    action: z.literal('voucher.draft.create'),
    verificationId: z.uuid(),
    verificationHash: sha256Schema,
    content: voucherContentSchema
  }).strict(),
  z.object({
    action: z.literal('voucher.issue'),
    bookingId: z.uuid(),
    verificationId: z.uuid(),
    verificationHash: sha256Schema,
    voucherId: z.uuid(),
    versionNumber: z.number().int().positive(),
    voucherHash: sha256Schema
  }).strict()
]);

export const bookingVerificationCanonicalPayloadSchema = exactEvidenceSchema.extend({
  schemaVersion: z.literal('booking-verification-v1'),
  bookingAuthorityHash: sha256Schema,
  reviewId: z.uuid(),
  decision: z.enum(verificationDecisions),
  reason: z.string().trim().min(8).max(500),
  checks: verificationChecksSchema,
  declarationConfirmed: z.literal(true)
}).strict().superRefine((value, context) => {
  const allMatch = Object.values(value.checks).every(Boolean);
  if (value.decision === 'VERIFY' && !allMatch) {
    context.addIssue({ code: 'custom', message: 'Every verification check must pass.' });
  }
  if (value.decision === 'REJECT' && allMatch) {
    context.addIssue({ code: 'custom', message: 'A rejected verification must identify a failed check.' });
  }
});

export const supplierConfirmationCorrectionCanonicalPayloadSchema = z.object({
  schemaVersion: z.literal('supplier-confirmation-correction-v1'),
  bookingId: z.uuid(),
  executionId: z.uuid(),
  executionHash: sha256Schema,
  supersedesConfirmationId: z.uuid(),
  supersedesConfirmationHash: sha256Schema,
  rejectedVerificationId: z.uuid(),
  rejectedVerificationHash: sha256Schema,
  supplierName: z.string().trim().min(2).max(120),
  channel: z.enum(supplierConfirmationChannels),
  confirmedAt: evidenceTimestampSchema,
  confirmationReference: referenceSchema,
  serviceSummary: serviceSummarySchema,
  note: noteSchema,
  declarationConfirmed: z.literal(true)
}).strict();

export const voucherCanonicalPayloadSchema = z.object({
  schemaVersion: z.literal('voucher-v1'),
  voucherId: z.uuid(),
  versionNumber: z.number().int().positive(),
  bookingId: z.uuid(),
  bookingAuthorityHash: sha256Schema,
  verificationId: z.uuid(),
  verificationHash: sha256Schema,
  executionId: z.uuid(),
  executionHash: sha256Schema,
  supplierConfirmationId: z.uuid(),
  supplierConfirmationVersion: z.number().int().positive(),
  supplierConfirmationHash: sha256Schema,
  quotationId: z.uuid(),
  quotationVersion: z.number().int().positive(),
  quotationHash: sha256Schema,
  locale: z.enum(locales),
  supplier: z.object({
    name: z.string().trim().min(2).max(120),
    confirmationReference: referenceSchema,
    confirmationSummary: serviceSummarySchema
  }).strict(),
  trip: z.object({
    title: z.string().trim().min(3).max(120),
    summary: z.string().trim().min(3).max(500)
  }).strict(),
  services: z.array(voucherServiceSchema).min(1).max(20),
  supportContact: z.string().trim().min(3).max(120),
  customerNotes: z.string().trim().max(500),
  preparationSource: z.enum(voucherPreparationSources),
  declarationConfirmed: z.literal(true)
}).strict();

export type StaffFulfilmentCommand = z.infer<typeof staffFulfilmentCommandSchema>;
export type BookingVerificationCanonicalPayload = z.infer<typeof bookingVerificationCanonicalPayloadSchema>;
export type SupplierConfirmationCorrectionCanonicalPayload = z.infer<typeof supplierConfirmationCorrectionCanonicalPayloadSchema>;
export type VoucherCanonicalPayload = z.infer<typeof voucherCanonicalPayloadSchema>;

export function buildCanonicalBookingVerificationPayload(input: {
  bookingId: string;
  bookingAuthorityHash: string;
  reviewId: string;
  executionId: string;
  executionHash: string;
  supplierConfirmationId: string;
  supplierConfirmationVersion: number;
  supplierConfirmationHash: string;
  verification: z.infer<typeof verificationDetailsSchema>;
}): BookingVerificationCanonicalPayload {
  return bookingVerificationCanonicalPayloadSchema.parse({
    schemaVersion: 'booking-verification-v1',
    bookingId: input.bookingId,
    bookingAuthorityHash: input.bookingAuthorityHash,
    reviewId: input.reviewId,
    executionId: input.executionId,
    executionHash: input.executionHash,
    supplierConfirmationId: input.supplierConfirmationId,
    supplierConfirmationVersion: input.supplierConfirmationVersion,
    supplierConfirmationHash: input.supplierConfirmationHash,
    ...input.verification
  });
}

export function buildCanonicalSupplierConfirmationCorrectionPayload(input: {
  bookingId: string;
  executionId: string;
  executionHash: string;
  supersedesConfirmationId: string;
  supersedesConfirmationHash: string;
  rejectedVerificationId: string;
  rejectedVerificationHash: string;
  supplierName: string;
  confirmation: z.infer<typeof confirmationCorrectionDetailsSchema>;
}): SupplierConfirmationCorrectionCanonicalPayload {
  const confirmation = confirmationCorrectionDetailsSchema.parse(input.confirmation);
  return supplierConfirmationCorrectionCanonicalPayloadSchema.parse({
    schemaVersion: 'supplier-confirmation-correction-v1',
    bookingId: input.bookingId,
    executionId: input.executionId,
    executionHash: input.executionHash,
    supersedesConfirmationId: input.supersedesConfirmationId,
    supersedesConfirmationHash: input.supersedesConfirmationHash,
    rejectedVerificationId: input.rejectedVerificationId,
    rejectedVerificationHash: input.rejectedVerificationHash,
    supplierName: input.supplierName,
    ...confirmation,
    confirmedAt: new Date(confirmation.confirmedAt).toISOString()
  });
}

export function buildCanonicalVoucherPayload(input: {
  voucherId: string;
  versionNumber: number;
  bookingId: string;
  bookingAuthorityHash: string;
  verificationId: string;
  verificationHash: string;
  executionId: string;
  executionHash: string;
  supplierConfirmationId: string;
  supplierConfirmationVersion: number;
  supplierConfirmationHash: string;
  quotationId: string;
  quotationVersion: number;
  quotationHash: string;
  locale: 'az' | 'ru' | 'en';
  supplier: { name: string; confirmationReference: string; confirmationSummary: string };
  trip: { title: string; summary: string };
  content: z.infer<typeof voucherContentSchema>;
}): VoucherCanonicalPayload {
  const { content, ...evidence } = input;
  return voucherCanonicalPayloadSchema.parse({
    schemaVersion: 'voucher-v1',
    ...evidence,
    ...content,
    services: content.services.map((service) => ({ ...service }))
  });
}

export type FulfilmentCommandResult = {
  status: 'accepted' | 'denied';
  reasonCode?: string;
  commandName?: StaffFulfilmentCommand['action'];
  bookingId?: string;
  bookingStatus?: string;
  reviewId?: string;
  verificationId?: string;
  verificationHash?: string;
  supplierConfirmationId?: string;
  supplierConfirmationVersion?: number;
  supplierConfirmationHash?: string;
  voucherId?: string;
  voucherVersion?: number;
  voucherHash?: string;
  workReceiptId?: string;
};
