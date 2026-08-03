import 'server-only';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { Locale } from '@/i18n/config';
import type { Viewer } from '@/server/auth/viewer';
import { sha256 } from '@/server/bos/canonical-json';
import { quotationCanonicalPayloadSchema } from '@/server/commercial/contract';
import {
  bookingVerificationCanonicalPayloadSchema,
  supplierConfirmationCorrectionCanonicalPayloadSchema,
  voucherCanonicalPayloadSchema
} from '@/server/fulfilment/contract';
import {
  bookingStatuses,
  isBookingLocale,
  supplierConfirmationCanonicalPayloadSchema,
  supplierExecutionCanonicalPayloadSchema,
  type BookingOperationsCase,
  type BookingStatus,
  type CustomerBookingView
} from './contract';

type BookingRow = {
  id: string;
  payment_request_id: string;
  readiness_evaluation_id: string;
  readiness_evaluation_hash: string;
  acceptance_id: string;
  quotation_id: string;
  quotation_version: number;
  quotation_hash: string;
  customer_id: string;
  locale: string;
  status: BookingStatus;
  booking_authority_hash: string;
  current_execution_id: string | null;
  current_execution_hash: string | null;
  supplier_confirmation_id: string | null;
  supplier_confirmation_hash: string | null;
  current_verification_review_id: string | null;
  current_verification_id: string | null;
  current_verification_hash: string | null;
  voucher_id: string | null;
  voucher_version: number | null;
  voucher_hash: string | null;
  created_at: string;
  updated_at: string;
  supplier_executed_at: string | null;
  supplier_confirmed_at: string | null;
  verification_started_at: string | null;
  verified_at: string | null;
  voucher_issued_at: string | null;
};

type ReadyPaymentRow = {
  id: string;
  quotation_id: string;
  quotation_version: number;
  quotation_hash: string;
  customer_id: string;
  locale: string;
  currency: string;
  amount_minor: number;
  readiness_evaluation_id: string;
  readiness_evaluation_hash: string;
  readiness_evaluated_at: string;
};

type QuotationVersionRow = {
  quotation_id: string;
  version_number: number;
  canonical_payload: unknown;
  payload_hash: string;
};

type ExecutionRow = {
  id: string;
  booking_id: string;
  canonical_payload: unknown;
  execution_hash: string;
  recorded_at: string;
  executed_by: string;
};

type ConfirmationRow = {
  id: string;
  booking_id: string;
  confirmation_version: number;
  canonical_payload: unknown;
  confirmation_hash: string;
  supersedes_confirmation_id: string | null;
  rejection_verification_id: string | null;
  captured_at: string;
  captured_by: string;
};

type VerificationReviewRow = {
  id: string;
  booking_id: string;
  reviewer_id: string;
  started_at: string;
};

type VerificationDecisionRow = {
  id: string;
  booking_id: string;
  canonical_payload: unknown;
  verification_hash: string;
  decision: 'VERIFY' | 'REJECT';
  reason: string;
  decided_by: string;
  decided_at: string;
};

type VoucherRow = {
  id: string;
  booking_id: string;
  customer_id: string;
  status: 'DRAFT' | 'ISSUED';
  current_version: number;
  current_hash: string;
  issued_version: number | null;
  issued_hash: string | null;
  issued_at: string | null;
};

type VoucherVersionRow = {
  voucher_id: string;
  version_number: number;
  booking_id: string;
  customer_id: string;
  canonical_payload: unknown;
  voucher_hash: string;
};

const customerBookingSelect = [
  'id', 'payment_request_id', 'readiness_evaluation_id', 'readiness_evaluation_hash',
  'acceptance_id', 'quotation_id', 'quotation_version', 'quotation_hash', 'customer_id',
  'locale', 'status', 'booking_authority_hash', 'current_execution_id',
  'current_execution_hash', 'supplier_confirmation_id', 'supplier_confirmation_hash',
  'created_at', 'updated_at', 'supplier_executed_at', 'supplier_confirmed_at',
  'verification_started_at', 'verified_at', 'voucher_issued_at'
].join(', ');

const operationsBookingSelect = [
  'id', 'payment_request_id', 'readiness_evaluation_id', 'readiness_evaluation_hash',
  'acceptance_id', 'quotation_id', 'quotation_version', 'quotation_hash', 'customer_id',
  'locale', 'status', 'booking_authority_hash', 'current_execution_id',
  'current_execution_hash', 'supplier_confirmation_id', 'supplier_confirmation_hash',
  'current_verification_review_id', 'current_verification_id', 'current_verification_hash',
  'voucher_id', 'voucher_version', 'voucher_hash', 'created_at', 'updated_at',
  'supplier_executed_at', 'supplier_confirmed_at', 'verification_started_at',
  'verified_at', 'voucher_issued_at'
].join(', ');

function mapCustomerBooking(row: BookingRow): CustomerBookingView | null {
  if (!isBookingLocale(row.locale) || !bookingStatuses.includes(row.status)) return null;
  return {
    id: row.id,
    quotationId: row.quotation_id,
    versionNumber: row.quotation_version,
    quotationHash: row.quotation_hash,
    locale: row.locale,
    status: row.status,
    createdAt: row.created_at,
    supplierExecutedAt: row.supplier_executed_at,
    supplierConfirmedAt: row.supplier_confirmed_at,
    verificationStartedAt: row.verification_started_at,
    verifiedAt: row.verified_at,
    voucherIssuedAt: row.voucher_issued_at,
    voucher: null
  };
}

function parseSupplierConfirmation(payload: unknown) {
  const initial = supplierConfirmationCanonicalPayloadSchema.safeParse(payload);
  if (initial.success) return initial;
  return supplierConfirmationCorrectionCanonicalPayloadSchema.safeParse(payload);
}

export async function loadCustomerBookings(
  viewer: Viewer,
  locale: Locale
): Promise<{ bookings: CustomerBookingView[]; availableLocales: Locale[] }> {
  if (viewer.source !== 'supabase' || !viewer.roles.includes('customer')) {
    return { bookings: [], availableLocales: [] };
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { bookings: [], availableLocales: [] };

  const { data, error } = await supabase
    .from('bookings')
    .select(customerBookingSelect)
    .eq('customer_id', viewer.id)
    .order('created_at', { ascending: false });
  if (error) return { bookings: [], availableLocales: [] };
  const bookingRows = (data ?? []) as unknown as BookingRow[];
  const issuedBookingIds = bookingRows.flatMap(({ id, status }) =>
    status === 'VOUCHER_ISSUED' ? [id] : []
  );
  const voucherResult = issuedBookingIds.length === 0
    ? { data: [], error: null }
    : await supabase.from('vouchers')
      .select([
        'id', 'booking_id', 'customer_id', 'status', 'current_version', 'current_hash',
        'issued_version', 'issued_hash', 'issued_at'
      ].join(', '))
      .in('booking_id', issuedBookingIds);
  const voucherRows = (voucherResult.data ?? []) as unknown as VoucherRow[];
  const voucherIds = voucherRows.map(({ id }) => id);
  const versionResult = voucherIds.length === 0
    ? { data: [], error: null }
    : await supabase.from('voucher_versions')
      .select('voucher_id, version_number, booking_id, customer_id, canonical_payload, voucher_hash')
      .in('voucher_id', voucherIds);
  if (voucherResult.error || versionResult.error) return { bookings: [], availableLocales: [] };
  const voucherMap = new Map(voucherRows.map((row) => [row.booking_id, row]));
  const versionMap = new Map(((versionResult.data ?? []) as unknown as VoucherVersionRow[])
    .map((row) => [`${row.voucher_id}:${row.version_number}`, row]));

  const mapped = bookingRows.flatMap((row) => {
    const booking = mapCustomerBooking(row);
    if (!booking) return [];
    if (row.status === 'VOUCHER_ISSUED') {
      const voucher = voucherMap.get(row.id);
      const version = voucher?.issued_version
        ? versionMap.get(`${voucher.id}:${voucher.issued_version}`)
        : null;
      const payload = version ? voucherCanonicalPayloadSchema.safeParse(version.canonical_payload) : null;
      if (
        !voucher || voucher.status !== 'ISSUED' || !voucher.issued_at
        || voucher.customer_id !== viewer.id || voucher.booking_id !== row.id
        || voucher.issued_version !== voucher.current_version || voucher.issued_hash !== voucher.current_hash
        || !version || version.customer_id !== viewer.id || version.booking_id !== row.id
        || version.voucher_hash !== voucher.issued_hash || !payload?.success
        || sha256(payload.data) !== voucher.issued_hash
      ) return [];
      booking.voucher = {
        id: voucher.id,
        versionNumber: version.version_number,
        voucherHash: version.voucher_hash,
        issuedAt: voucher.issued_at,
        supplierName: payload.data.supplier.name,
        confirmationReference: payload.data.supplier.confirmationReference,
        confirmationSummary: payload.data.supplier.confirmationSummary,
        title: payload.data.trip.title,
        summary: payload.data.trip.summary,
        services: payload.data.services,
        supportContact: payload.data.supportContact,
        customerNotes: payload.data.customerNotes
      };
    }
    return [booking];
  });
  const availableLocales = [...new Set(mapped.map(({ locale: value }) => value))];
  return {
    bookings: mapped.filter((booking) => booking.locale === locale),
    availableLocales
  };
}

export async function loadBookingOperationsCases(viewer: Viewer): Promise<BookingOperationsCase[]> {
  if (
    viewer.source !== 'supabase'
    || viewer.assuranceLevel !== 'aal2'
    || !viewer.roles.some((role) => ['staff', 'manager', 'admin', 'founder'].includes(role))
  ) return [];
  const supabase = createAdminSupabaseClient();
  if (!supabase) return [];

  const { data: paymentData, error: paymentError } = await supabase
    .from('payment_requests')
    .select([
      'id', 'quotation_id', 'quotation_version', 'quotation_hash', 'customer_id',
      'locale', 'currency', 'amount_minor', 'readiness_evaluation_id',
      'readiness_evaluation_hash', 'readiness_evaluated_at'
    ].join(', '))
    .eq('status', 'READY_FOR_BOOKING')
    .eq('readiness_result', 'READY_FOR_BOOKING')
    .order('readiness_evaluated_at', { ascending: true })
    .limit(100);
  if (paymentError) return [];
  const payments = (paymentData ?? []) as unknown as ReadyPaymentRow[];
  if (payments.length === 0) return [];

  const quotationIds = [...new Set(payments.map(({ quotation_id }) => quotation_id))];
  const paymentIds = payments.map(({ id }) => id);
  const [versionResult, bookingResult] = await Promise.all([
    supabase
      .from('quotation_versions')
      .select('quotation_id, version_number, canonical_payload, payload_hash')
      .in('quotation_id', quotationIds),
    supabase
      .from('bookings')
      .select(operationsBookingSelect)
      .in('payment_request_id', paymentIds)
  ]);
  if (versionResult.error || bookingResult.error) return [];
  const versions = (versionResult.data ?? []) as unknown as QuotationVersionRow[];
  const bookings = (bookingResult.data ?? []) as unknown as BookingRow[];
  const bookingByPayment = new Map(bookings.map((booking) => [booking.payment_request_id, booking]));
  const executionIds = bookings.flatMap(({ current_execution_id }) => current_execution_id ? [current_execution_id] : []);
  const confirmationIds = bookings.flatMap(({ supplier_confirmation_id }) => supplier_confirmation_id ? [supplier_confirmation_id] : []);
  const reviewIds = bookings.flatMap(({ current_verification_review_id }) =>
    current_verification_review_id ? [current_verification_review_id] : []
  );
  const verificationIds = bookings.flatMap(({ current_verification_id }) =>
    current_verification_id ? [current_verification_id] : []
  );
  const voucherIds = bookings.flatMap(({ voucher_id }) => voucher_id ? [voucher_id] : []);

  const [executionResult, confirmationResult, reviewResult, verificationResult, voucherResult] = await Promise.all([
    executionIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase
        .from('supplier_booking_executions')
        .select('id, booking_id, canonical_payload, execution_hash, recorded_at, executed_by')
        .in('id', executionIds),
    confirmationIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase
        .from('supplier_confirmations')
        .select([
          'id', 'booking_id', 'confirmation_version', 'canonical_payload',
          'confirmation_hash', 'supersedes_confirmation_id',
          'rejection_verification_id', 'captured_at', 'captured_by'
        ].join(', '))
        .in('id', confirmationIds),
    reviewIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase
        .from('booking_verification_reviews')
        .select('id, booking_id, reviewer_id, started_at')
        .in('id', reviewIds),
    verificationIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase
        .from('booking_verification_decisions')
        .select([
          'id', 'booking_id', 'canonical_payload', 'verification_hash',
          'decision', 'reason', 'decided_by', 'decided_at'
        ].join(', '))
        .in('id', verificationIds),
    voucherIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase
        .from('vouchers')
        .select([
          'id', 'booking_id', 'customer_id', 'status', 'current_version', 'current_hash',
          'issued_version', 'issued_hash', 'issued_at'
        ].join(', '))
        .in('id', voucherIds)
  ]);
  if (
    executionResult.error || confirmationResult.error || reviewResult.error
    || verificationResult.error || voucherResult.error
  ) return [];

  const versionMap = new Map(versions.map((version) => [`${version.quotation_id}:${version.version_number}`, version]));
  const executionMap = new Map(((executionResult.data ?? []) as ExecutionRow[]).map((row) => [row.id, row]));
  const confirmationMap = new Map(((confirmationResult.data ?? []) as ConfirmationRow[]).map((row) => [row.id, row]));
  const reviewMap = new Map(((reviewResult.data ?? []) as VerificationReviewRow[]).map((row) => [row.id, row]));
  const verificationMap = new Map(((verificationResult.data ?? []) as VerificationDecisionRow[]).map((row) => [row.id, row]));
  const voucherMap = new Map(((voucherResult.data ?? []) as VoucherRow[]).map((row) => [row.id, row]));

  return payments.flatMap((payment) => {
    if (
      !isBookingLocale(payment.locale)
      || payment.currency !== 'AZN'
      || !payment.readiness_evaluation_id
      || !payment.readiness_evaluation_hash
    ) return [];
    const amountMinor = Number(payment.amount_minor);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return [];
    const version = versionMap.get(`${payment.quotation_id}:${payment.quotation_version}`);
    if (!version || version.payload_hash !== payment.quotation_hash) return [];
    const quotation = quotationCanonicalPayloadSchema.safeParse(version.canonical_payload);
    if (!quotation.success || sha256(quotation.data) !== version.payload_hash) return [];

    const bookingRow = bookingByPayment.get(payment.id);
    let booking: BookingOperationsCase['booking'] = null;
    if (bookingRow) {
      const safe = mapCustomerBooking(bookingRow);
      if (
        !safe
        || bookingRow.readiness_evaluation_id !== payment.readiness_evaluation_id
        || bookingRow.readiness_evaluation_hash !== payment.readiness_evaluation_hash
        || bookingRow.quotation_hash !== payment.quotation_hash
        || bookingRow.quotation_version !== payment.quotation_version
      ) return [];

      const executionRow = bookingRow.current_execution_id
        ? executionMap.get(bookingRow.current_execution_id)
        : null;
      const executionPayload = executionRow
        ? supplierExecutionCanonicalPayloadSchema.safeParse(executionRow.canonical_payload)
        : null;
      if (
        executionRow
        && (
          !executionPayload?.success
          || executionRow.booking_id !== bookingRow.id
          || executionRow.execution_hash !== bookingRow.current_execution_hash
          || sha256(executionPayload.data) !== executionRow.execution_hash
        )
      ) return [];

      const confirmationRow = bookingRow.supplier_confirmation_id
        ? confirmationMap.get(bookingRow.supplier_confirmation_id)
        : null;
      const confirmationPayload = confirmationRow
        ? parseSupplierConfirmation(confirmationRow.canonical_payload)
        : null;
      if (
        confirmationRow
        && (
          !confirmationPayload?.success
          || confirmationRow.booking_id !== bookingRow.id
          || confirmationRow.confirmation_hash !== bookingRow.supplier_confirmation_hash
          || sha256(confirmationPayload.data) !== confirmationRow.confirmation_hash
        )
      ) return [];

      const reviewRow = bookingRow.current_verification_review_id
        ? reviewMap.get(bookingRow.current_verification_review_id)
        : null;
      if (bookingRow.current_verification_review_id && !reviewRow) return [];
      if (reviewRow && reviewRow.booking_id !== bookingRow.id) return [];

      const verificationRow = bookingRow.current_verification_id
        ? verificationMap.get(bookingRow.current_verification_id)
        : null;
      const verificationPayload = verificationRow
        ? bookingVerificationCanonicalPayloadSchema.safeParse(verificationRow.canonical_payload)
        : null;
      if (bookingRow.current_verification_id && !verificationRow) return [];
      if (
        verificationRow
        && (
          !verificationPayload?.success
          || verificationRow.booking_id !== bookingRow.id
          || verificationRow.verification_hash !== bookingRow.current_verification_hash
          || verificationRow.decision !== verificationPayload.data.decision
          || sha256(verificationPayload.data) !== verificationRow.verification_hash
        )
      ) return [];

      const voucherRow = bookingRow.voucher_id ? voucherMap.get(bookingRow.voucher_id) : null;
      if (bookingRow.voucher_id && !voucherRow) return [];
      if (
        voucherRow
        && (
          voucherRow.booking_id !== bookingRow.id
          || voucherRow.current_version !== bookingRow.voucher_version
          || voucherRow.current_hash !== bookingRow.voucher_hash
        )
      ) return [];

      booking = {
        ...safe,
        customerId: bookingRow.customer_id,
        bookingAuthorityHash: bookingRow.booking_authority_hash,
        execution: executionRow && executionPayload?.success ? {
          id: executionRow.id,
          executionHash: executionRow.execution_hash,
          channel: executionPayload.data.channel,
          supplierName: executionPayload.data.supplierName,
          executedAt: executionPayload.data.executedAt,
          requestReference: executionPayload.data.requestReference,
          serviceSummary: executionPayload.data.serviceSummary,
          note: executionPayload.data.note,
          recordedAt: executionRow.recorded_at,
          executedBy: executionRow.executed_by
        } : null,
        confirmation: confirmationRow && confirmationPayload?.success ? {
          id: confirmationRow.id,
          versionNumber: confirmationRow.confirmation_version,
          confirmationHash: confirmationRow.confirmation_hash,
          channel: confirmationPayload.data.channel,
          confirmationReference: confirmationPayload.data.confirmationReference,
          serviceSummary: confirmationPayload.data.serviceSummary,
          note: confirmationPayload.data.note,
          confirmedAt: confirmationPayload.data.confirmedAt,
          capturedAt: confirmationRow.captured_at,
          capturedBy: confirmationRow.captured_by,
          supersedesConfirmationId: confirmationRow.supersedes_confirmation_id,
          rejectionVerificationId: confirmationRow.rejection_verification_id
        } : null,
        verificationReview: reviewRow ? {
          id: reviewRow.id,
          reviewerId: reviewRow.reviewer_id,
          startedAt: reviewRow.started_at
        } : null,
        verification: verificationRow && verificationPayload?.success ? {
          id: verificationRow.id,
          verificationHash: verificationRow.verification_hash,
          decision: verificationRow.decision,
          reason: verificationRow.reason,
          decidedBy: verificationRow.decided_by,
          decidedAt: verificationRow.decided_at,
          checks: verificationPayload.data.checks
        } : null,
        voucherRecord: voucherRow ? {
          id: voucherRow.id,
          status: voucherRow.status,
          currentVersion: voucherRow.current_version,
          currentHash: voucherRow.current_hash,
          issuedAt: voucherRow.issued_at
        } : null
      };
    }

    return [{
      financialReadiness: {
        paymentRequestId: payment.id,
        readinessEvaluationId: payment.readiness_evaluation_id,
        readinessHash: payment.readiness_evaluation_hash,
        customerId: payment.customer_id,
        quotationId: payment.quotation_id,
        versionNumber: payment.quotation_version,
        quotationHash: payment.quotation_hash,
        locale: payment.locale,
        title: quotation.data.customer.title,
        amountMinor,
        currency: 'AZN',
        readyAt: payment.readiness_evaluated_at
      },
      booking
    } satisfies BookingOperationsCase];
  });
}
