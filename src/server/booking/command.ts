import 'server-only';
import { randomUUID } from 'node:crypto';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import type { Viewer } from '@/server/auth/viewer';
import { sha256 } from '@/server/bos/canonical-json';
import {
  buildCanonicalBookingCreationPayload,
  buildCanonicalSupplierConfirmationPayload,
  buildCanonicalSupplierExecutionPayload,
  supplierExecutionCanonicalPayloadSchema,
  type BookingCommandResult,
  type StaffBookingCommand
} from './contract';

type ReadyPaymentRow = {
  id: string;
  status: string;
  readiness_evaluation_id: string | null;
  readiness_evaluation_hash: string | null;
  readiness_result: string | null;
  acceptance_id: string;
  quotation_id: string;
  quotation_version: number;
  quotation_hash: string;
};

type BookingExecutionPointerRow = {
  id: string;
  status: string;
  current_execution_id: string | null;
  current_execution_hash: string | null;
};

type SupplierExecutionRow = {
  id: string;
  booking_id: string;
  canonical_payload: unknown;
  execution_hash: string;
};

export async function executeBookingCommand(
  viewer: Viewer,
  input: StaffBookingCommand,
  idempotencyKey: string
): Promise<BookingCommandResult> {
  const admin = createAdminSupabaseClient();
  if (!admin) throw new Error('BOOKING_CONFIGURATION_UNAVAILABLE');

  let payload: Record<string, unknown>;
  if (input.action === 'booking.create') {
    const { data, error } = await admin
      .from('payment_requests')
      .select([
        'id', 'status', 'readiness_evaluation_id', 'readiness_evaluation_hash',
        'readiness_result', 'acceptance_id', 'quotation_id', 'quotation_version',
        'quotation_hash'
      ].join(', '))
      .eq('id', input.paymentRequestId)
      .maybeSingle();
    if (error || !data) throw new Error('PAYMENT_REQUEST_NOT_FOUND');
    const payment = data as unknown as ReadyPaymentRow;
    if (
      payment.status !== 'READY_FOR_BOOKING'
      || payment.readiness_result !== 'READY_FOR_BOOKING'
      || payment.readiness_evaluation_id !== input.readinessEvaluationId
      || payment.readiness_evaluation_hash !== input.readinessHash
    ) throw new Error('FINANCIAL_READINESS_REFERENCE_MISMATCH');

    const bookingPayload = buildCanonicalBookingCreationPayload({
      paymentRequestId: payment.id,
      readinessEvaluationId: input.readinessEvaluationId,
      readinessHash: input.readinessHash,
      acceptanceId: payment.acceptance_id,
      quotationId: payment.quotation_id,
      quotationVersion: payment.quotation_version,
      quotationHash: payment.quotation_hash
    });
    payload = {
      paymentRequestId: input.paymentRequestId,
      readinessEvaluationId: input.readinessEvaluationId,
      readinessHash: input.readinessHash,
      bookingPayload,
      bookingHash: sha256(bookingPayload)
    };
  } else if (input.action === 'supplier_booking.complete') {
    const executionPayload = buildCanonicalSupplierExecutionPayload(input.bookingId, input.execution);
    payload = {
      bookingId: input.bookingId,
      executionPayload,
      executionHash: sha256(executionPayload)
    };
  } else {
    const { data: bookingData, error: bookingError } = await admin
      .from('bookings')
      .select('id, status, current_execution_id, current_execution_hash')
      .eq('id', input.bookingId)
      .maybeSingle();
    if (bookingError || !bookingData) throw new Error('BOOKING_NOT_FOUND');
    const booking = bookingData as unknown as BookingExecutionPointerRow;
    if (
      booking.status !== 'SUPPLIER_EXECUTED'
      || booking.current_execution_id !== input.executionId
      || booking.current_execution_hash !== input.executionHash
    ) throw new Error('SUPPLIER_EXECUTION_REFERENCE_MISMATCH');

    const { data: executionData, error: executionError } = await admin
      .from('supplier_booking_executions')
      .select('id, booking_id, canonical_payload, execution_hash')
      .eq('id', input.executionId)
      .eq('booking_id', input.bookingId)
      .maybeSingle();
    if (executionError || !executionData) throw new Error('SUPPLIER_EXECUTION_NOT_FOUND');
    const execution = executionData as unknown as SupplierExecutionRow;
    const parsedExecution = supplierExecutionCanonicalPayloadSchema.safeParse(execution.canonical_payload);
    if (
      !parsedExecution.success
      || execution.execution_hash !== input.executionHash
      || parsedExecution.data.bookingId !== input.bookingId
    ) throw new Error('SUPPLIER_EXECUTION_REFERENCE_MISMATCH');

    const confirmationPayload = buildCanonicalSupplierConfirmationPayload({
      bookingId: input.bookingId,
      executionId: input.executionId,
      executionHash: input.executionHash,
      supplierName: parsedExecution.data.supplierName,
      confirmation: input.confirmation
    });
    payload = {
      bookingId: input.bookingId,
      executionId: input.executionId,
      executionHash: input.executionHash,
      confirmationPayload,
      confirmationHash: sha256(confirmationPayload)
    };
  }

  const { data, error } = await admin.rpc('execute_booking_command', {
    p_command_id: randomUUID(),
    p_idempotency_key: idempotencyKey,
    p_command_name: input.action,
    p_actor_id: viewer.id,
    p_actor_session_id: viewer.sessionId,
    p_actor_aal: viewer.assuranceLevel,
    p_actor_issued_at: new Date(viewer.issuedAt * 1_000).toISOString(),
    p_payload: payload,
    p_payload_hash: sha256(payload)
  });

  if (error) throw new Error(`BOOKING_DATABASE_ERROR:${error.code ?? 'UNKNOWN'}`);
  return data as BookingCommandResult;
}
