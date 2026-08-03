import 'server-only';
import { randomUUID } from 'node:crypto';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import type { Viewer } from '@/server/auth/viewer';
import { sha256 } from '@/server/bos/canonical-json';
import {
  supplierConfirmationCanonicalPayloadSchema,
  supplierExecutionCanonicalPayloadSchema
} from '@/server/booking/contract';
import { quotationCanonicalPayloadSchema } from '@/server/commercial/contract';
import {
  buildCanonicalBookingVerificationPayload,
  buildCanonicalSupplierConfirmationCorrectionPayload,
  buildCanonicalVoucherPayload,
  supplierConfirmationCorrectionCanonicalPayloadSchema,
  type FulfilmentCommandResult,
  type StaffFulfilmentCommand
} from './contract';

type BookingEvidenceRow = {
  id: string;
  status: string;
  booking_authority_hash: string;
  quotation_id: string;
  quotation_version: number;
  quotation_hash: string;
  locale: 'az' | 'ru' | 'en';
  current_execution_id: string | null;
  current_execution_hash: string | null;
  supplier_confirmation_id: string | null;
  supplier_confirmation_hash: string | null;
  current_verification_id: string | null;
  current_verification_hash: string | null;
};

type SupplierExecutionRow = {
  id: string;
  booking_id: string;
  execution_hash: string;
  canonical_payload: unknown;
};

type SupplierConfirmationRow = {
  id: string;
  booking_id: string;
  confirmation_version: number;
  confirmation_hash: string;
  supplier_name: string;
  confirmation_reference: string;
  canonical_payload: unknown;
};

type QuotationVersionRow = {
  quotation_id: string;
  version_number: number;
  payload_hash: string;
  canonical_payload: unknown;
};

type VoucherAggregateRow = {
  id: string;
  booking_id: string;
  status: 'DRAFT' | 'ISSUED';
  current_version: number;
  current_hash: string;
};

function deterministicVoucherId(bookingId: string, idempotencyKey: string): string {
  const hex = sha256({ scope: 'voyara-voucher-id-v1', bookingId, idempotencyKey });
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function parseConfirmationSummary(payload: unknown): string | null {
  const initial = supplierConfirmationCanonicalPayloadSchema.safeParse(payload);
  if (initial.success) return initial.data.serviceSummary;
  const correction = supplierConfirmationCorrectionCanonicalPayloadSchema.safeParse(payload);
  return correction.success ? correction.data.serviceSummary : null;
}

async function loadBookingEvidence(bookingId: string): Promise<BookingEvidenceRow> {
  const admin = createAdminSupabaseClient();
  if (!admin) throw new Error('FULFILMENT_CONFIGURATION_UNAVAILABLE');
  const { data, error } = await admin
    .from('bookings')
    .select([
      'id', 'status', 'booking_authority_hash', 'quotation_id', 'quotation_version',
      'quotation_hash', 'locale', 'current_execution_id', 'current_execution_hash',
      'supplier_confirmation_id', 'supplier_confirmation_hash',
      'current_verification_id', 'current_verification_hash'
    ].join(', '))
    .eq('id', bookingId)
    .maybeSingle();
  if (error || !data) throw new Error('BOOKING_NOT_FOUND');
  return data as unknown as BookingEvidenceRow;
}

export async function executeFulfilmentCommand(
  viewer: Viewer,
  input: StaffFulfilmentCommand,
  idempotencyKey: string
): Promise<FulfilmentCommandResult> {
  const admin = createAdminSupabaseClient();
  if (!admin) throw new Error('FULFILMENT_CONFIGURATION_UNAVAILABLE');
  const commandId = randomUUID();
  let payload: Record<string, unknown>;

  if (input.action === 'booking.verification.start') {
    payload = {
      bookingId: input.bookingId,
      executionId: input.executionId,
      executionHash: input.executionHash,
      supplierConfirmationId: input.supplierConfirmationId,
      supplierConfirmationVersion: input.supplierConfirmationVersion,
      supplierConfirmationHash: input.supplierConfirmationHash
    };
  } else if (input.action === 'booking.verify') {
    const booking = await loadBookingEvidence(input.bookingId);
    const verificationPayload = buildCanonicalBookingVerificationPayload({
      bookingId: input.bookingId,
      bookingAuthorityHash: booking.booking_authority_hash,
      reviewId: input.reviewId,
      executionId: input.executionId,
      executionHash: input.executionHash,
      supplierConfirmationId: input.supplierConfirmationId,
      supplierConfirmationVersion: input.supplierConfirmationVersion,
      supplierConfirmationHash: input.supplierConfirmationHash,
      verification: input.verification
    });
    payload = {
      bookingId: input.bookingId,
      reviewId: input.reviewId,
      executionId: input.executionId,
      executionHash: input.executionHash,
      supplierConfirmationId: input.supplierConfirmationId,
      supplierConfirmationVersion: input.supplierConfirmationVersion,
      supplierConfirmationHash: input.supplierConfirmationHash,
      verificationPayload,
      verificationHash: sha256(verificationPayload)
    };
  } else if (input.action === 'supplier_confirmation.correct') {
    const { data, error } = await admin
      .from('supplier_booking_executions')
      .select('id, booking_id, execution_hash, canonical_payload')
      .eq('id', input.executionId)
      .eq('booking_id', input.bookingId)
      .maybeSingle();
    if (error || !data) throw new Error('SUPPLIER_EXECUTION_NOT_FOUND');
    const execution = data as unknown as SupplierExecutionRow;
    const parsedExecution = supplierExecutionCanonicalPayloadSchema.safeParse(execution.canonical_payload);
    if (
      !parsedExecution.success
      || execution.execution_hash !== input.executionHash
      || parsedExecution.data.bookingId !== input.bookingId
    ) throw new Error('SUPPLIER_EXECUTION_REFERENCE_MISMATCH');

    const confirmationPayload = buildCanonicalSupplierConfirmationCorrectionPayload({
      bookingId: input.bookingId,
      executionId: input.executionId,
      executionHash: input.executionHash,
      supersedesConfirmationId: input.supplierConfirmationId,
      supersedesConfirmationHash: input.supplierConfirmationHash,
      rejectedVerificationId: input.verificationId,
      rejectedVerificationHash: input.verificationHash,
      supplierName: parsedExecution.data.supplierName,
      confirmation: input.confirmation
    });
    payload = {
      bookingId: input.bookingId,
      executionId: input.executionId,
      executionHash: input.executionHash,
      supplierConfirmationId: input.supplierConfirmationId,
      supplierConfirmationHash: input.supplierConfirmationHash,
      verificationId: input.verificationId,
      verificationHash: input.verificationHash,
      confirmationPayload,
      correctedConfirmationHash: sha256(confirmationPayload)
    };
  } else if (input.action === 'voucher.draft.create') {
    const booking = await loadBookingEvidence(input.bookingId);
    if (
      booking.current_execution_id !== input.executionId
      || booking.current_execution_hash !== input.executionHash
      || booking.supplier_confirmation_id !== input.supplierConfirmationId
      || booking.supplier_confirmation_hash !== input.supplierConfirmationHash
      || booking.current_verification_id !== input.verificationId
      || booking.current_verification_hash !== input.verificationHash
    ) throw new Error('VERIFIED_BOOKING_REFERENCE_MISMATCH');

    const [executionResult, confirmationResult, quotationResult, voucherResult] = await Promise.all([
      admin.from('supplier_booking_executions')
        .select('id, booking_id, execution_hash, canonical_payload')
        .eq('id', input.executionId).eq('booking_id', input.bookingId).maybeSingle(),
      admin.from('supplier_confirmations')
        .select([
          'id', 'booking_id', 'confirmation_version', 'confirmation_hash',
          'supplier_name', 'confirmation_reference', 'canonical_payload'
        ].join(', '))
        .eq('id', input.supplierConfirmationId).eq('booking_id', input.bookingId).maybeSingle(),
      admin.from('quotation_versions')
        .select('quotation_id, version_number, payload_hash, canonical_payload')
        .eq('quotation_id', booking.quotation_id)
        .eq('version_number', booking.quotation_version).maybeSingle(),
      admin.from('vouchers')
        .select('id, booking_id, status, current_version, current_hash')
        .eq('booking_id', input.bookingId).maybeSingle()
    ]);
    if (executionResult.error || !executionResult.data) throw new Error('SUPPLIER_EXECUTION_NOT_FOUND');
    if (confirmationResult.error || !confirmationResult.data) throw new Error('SUPPLIER_CONFIRMATION_NOT_FOUND');
    if (quotationResult.error || !quotationResult.data) throw new Error('QUOTATION_VERSION_NOT_FOUND');
    if (voucherResult.error) throw new Error('VOUCHER_LOOKUP_FAILED');

    const execution = executionResult.data as unknown as SupplierExecutionRow;
    const confirmation = confirmationResult.data as unknown as SupplierConfirmationRow;
    const quotation = quotationResult.data as unknown as QuotationVersionRow;
    const existingVoucher = voucherResult.data as unknown as VoucherAggregateRow | null;
    const parsedExecution = supplierExecutionCanonicalPayloadSchema.safeParse(execution.canonical_payload);
    const parsedQuotation = quotationCanonicalPayloadSchema.safeParse(quotation.canonical_payload);
    const confirmationSummary = parseConfirmationSummary(confirmation.canonical_payload);
    if (
      !parsedExecution.success || !parsedQuotation.success || !confirmationSummary
      || execution.execution_hash !== input.executionHash
      || confirmation.confirmation_hash !== input.supplierConfirmationHash
      || confirmation.confirmation_version !== input.supplierConfirmationVersion
      || quotation.payload_hash !== booking.quotation_hash
      || existingVoucher?.status === 'ISSUED'
    ) throw new Error('VERIFIED_BOOKING_REFERENCE_MISMATCH');

    const voucherId = existingVoucher?.id ?? deterministicVoucherId(input.bookingId, idempotencyKey);
    const versionNumber = (existingVoucher?.current_version ?? 0) + 1;
    const voucherPayload = buildCanonicalVoucherPayload({
      voucherId,
      versionNumber,
      bookingId: input.bookingId,
      bookingAuthorityHash: booking.booking_authority_hash,
      verificationId: input.verificationId,
      verificationHash: input.verificationHash,
      executionId: input.executionId,
      executionHash: input.executionHash,
      supplierConfirmationId: input.supplierConfirmationId,
      supplierConfirmationVersion: input.supplierConfirmationVersion,
      supplierConfirmationHash: input.supplierConfirmationHash,
      quotationId: booking.quotation_id,
      quotationVersion: booking.quotation_version,
      quotationHash: booking.quotation_hash,
      locale: booking.locale,
      supplier: {
        name: confirmation.supplier_name,
        confirmationReference: confirmation.confirmation_reference,
        confirmationSummary
      },
      trip: {
        title: parsedQuotation.data.customer.title,
        summary: parsedQuotation.data.customer.summary.slice(0, 500)
      },
      content: input.content
    });
    payload = {
      bookingId: input.bookingId,
      verificationId: input.verificationId,
      verificationHash: input.verificationHash,
      executionId: input.executionId,
      executionHash: input.executionHash,
      supplierConfirmationId: input.supplierConfirmationId,
      supplierConfirmationVersion: input.supplierConfirmationVersion,
      supplierConfirmationHash: input.supplierConfirmationHash,
      voucherId,
      versionNumber,
      voucherPayload,
      voucherHash: sha256(voucherPayload)
    };
  } else {
    payload = {
      bookingId: input.bookingId,
      verificationId: input.verificationId,
      verificationHash: input.verificationHash,
      voucherId: input.voucherId,
      versionNumber: input.versionNumber,
      voucherHash: input.voucherHash
    };
  }

  const { data, error } = await admin.rpc('execute_fulfilment_command', {
    p_command_id: commandId,
    p_idempotency_key: idempotencyKey,
    p_command_name: input.action,
    p_actor_id: viewer.id,
    p_actor_session_id: viewer.sessionId,
    p_actor_aal: viewer.assuranceLevel,
    p_actor_issued_at: new Date(viewer.issuedAt * 1_000).toISOString(),
    p_payload: payload,
    p_payload_hash: sha256(input)
  });
  if (error) throw new Error(`FULFILMENT_DATABASE_ERROR:${error.code ?? 'UNKNOWN'}`);
  return data as FulfilmentCommandResult;
}
