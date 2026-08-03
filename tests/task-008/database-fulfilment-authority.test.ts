import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const customerA = 'a1000000-0000-4000-8000-000000000001';
const customerB = 'a1000000-0000-4000-8000-000000000002';
const staffId = 'a1000000-0000-4000-8000-000000000003';
const financeId = 'a1000000-0000-4000-8000-000000000004';
const founderId = 'a1000000-0000-4000-8000-000000000005';
const managerId = 'a1000000-0000-4000-8000-000000000006';
const customerSession = 'a2000000-0000-4000-8000-000000000001';
const staffSession = 'a2000000-0000-4000-8000-000000000002';
const financeSession = 'a2000000-0000-4000-8000-000000000003';
const founderSession = 'a2000000-0000-4000-8000-000000000004';
const managerSession = 'a2000000-0000-4000-8000-000000000005';
const requestId = 'a3000000-0000-4000-8000-000000000001';
const quotationId = 'a3000000-0000-4000-8000-000000000002';
const acceptanceId = 'a3000000-0000-4000-8000-000000000003';
const paymentRequestId = 'a4000000-0000-4000-8000-000000000001';
const paymentEvidenceId = 'a4000000-0000-4000-8000-000000000002';
const paymentReviewId = 'a4000000-0000-4000-8000-000000000003';
const paymentVerificationId = 'a4000000-0000-4000-8000-000000000004';
const allocationId = 'a4000000-0000-4000-8000-000000000005';
const readinessId = 'a4000000-0000-4000-8000-000000000006';
const bookingId = 'a5000000-0000-4000-8000-000000000001';
const executionId = 'a5000000-0000-4000-8000-000000000002';
const confirmationId = 'a5000000-0000-4000-8000-000000000003';
const firstReviewId = 'a6000000-0000-4000-8000-000000000001';
const rejectionId = 'a6000000-0000-4000-8000-000000000002';
const correctionId = 'a6000000-0000-4000-8000-000000000003';
const secondReviewId = 'a6000000-0000-4000-8000-000000000004';
const verifiedId = 'a6000000-0000-4000-8000-000000000005';
const voucherId = 'a6000000-0000-4000-8000-000000000006';
const voucherDraftCommandId = 'a6000000-0000-4000-8000-000000000007';
const voucherIssueCommandId = 'a6000000-0000-4000-8000-000000000008';
const voucherRevisionCommandId = 'a6000000-0000-4000-8000-000000000009';

const requestHash = 'a'.repeat(64);
const quotationHash = 'b'.repeat(64);
const evidenceHash = 'c'.repeat(64);
const paymentVerificationHash = 'd'.repeat(64);
const allocationHash = 'e'.repeat(64);
const readinessHash = 'f'.repeat(64);
const bookingHash = '1'.repeat(64);
const executionHash = '2'.repeat(64);
const confirmationHash = '3'.repeat(64);
const rejectionHash = '4'.repeat(64);
const correctionHash = '5'.repeat(64);
const verifiedHash = '6'.repeat(64);
const voucherHash = '7'.repeat(64);
const voucherRevisionHash = '8'.repeat(64);
const commandHash = '9'.repeat(64);

function quote(value: unknown): string {
  return JSON.stringify(value).replaceAll("'", "''");
}

function authoritySql(
  gateway: 'payment' | 'booking' | 'fulfilment',
  input: {
    commandId: string;
    key: string;
    name: string;
    actorId: string;
    sessionId: string;
    aal: 'aal1' | 'aal2';
    payload: object;
  }
) {
  return `select public.execute_${gateway}_command(
    '${input.commandId}', '${input.key}', '${input.name}',
    '${input.actorId}', '${input.sessionId}', '${input.aal}', now() - interval '1 second',
    '${quote(input.payload)}'::jsonb, '${commandHash}'
  ) as result`;
}

async function setupDatabase() {
  const database = new PGlite();
  await database.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (
      id uuid primary key,
      email text,
      raw_user_meta_data jsonb default '{}'::jsonb
    );
    create or replace function auth.uid()
    returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create or replace function auth.jwt()
    returns jsonb language sql stable
    as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  `);
  for (const migration of [
    'supabase/migrations/20260717084526_task002_foundation_security.sql',
    'supabase/migrations/20260717101137_task003_auth_role_session_security.sql',
    'supabase/migrations/20260717104504_task004_travel_request_vertical_slice.sql',
    'supabase/migrations/20260717115718_task005_commercial_approval_vertical_slice.sql',
    'supabase/migrations/20260717143000_task006_payment_verification_vertical_slice.sql',
    'supabase/migrations/20260717144340_task007_booking_supplier_confirmation_vertical_slice.sql',
    'supabase/migrations/20260717175117_task008_booking_verification_voucher_vertical_slice.sql'
  ]) await database.exec(await readFile(migration, 'utf8'));

  await database.exec(`
    insert into auth.users (id, email) values
      ('${customerA}', 'customer-a@voyara.example'),
      ('${customerB}', 'customer-b@voyara.example'),
      ('${staffId}', 'staff@voyara.example'),
      ('${financeId}', 'finance@voyara.example'),
      ('${founderId}', 'founder@voyara.example'),
      ('${managerId}', 'manager@voyara.example');
    insert into public.role_assignments (user_id, role, assigned_by, reason) values
      ('${staffId}', 'staff', '${founderId}', 'Synthetic Task 008 Staff'),
      ('${financeId}', 'finance', '${founderId}', 'Synthetic Task 008 Finance'),
      ('${founderId}', 'founder', '${founderId}', 'Synthetic Task 008 Founder'),
      ('${managerId}', 'manager', '${founderId}', 'Synthetic Task 008 Manager');
  `);
  await prepareAcceptedQuotation(database);
  await database.exec('set role service_role;');
  await prepareSupplierConfirmation(database);
  return database;
}

async function prepareAcceptedQuotation(database: PGlite) {
  const requestPayload = {
    destination: 'Istanbul', departureCity: 'Baku', departureDate: '2026-09-10',
    returnDate: '2026-09-17', travelers: { adults: 2, children: 0, infants: 0 },
    budgetAzn: 6_000, tripPurpose: 'leisure', notes: 'Synthetic Task 008 request',
    locale: 'az', submissionAcknowledgements: {
      accuracyConfirmed: true, dataProcessingAcknowledged: true
    }
  };
  const quotationPayload = {
    schemaVersion: 'quotation-v1',
    source: { travelRequestId: requestId, travelRequestVersion: 1, travelRequestHash: requestHash },
    customer: {
      locale: 'az', title: 'İstanbul ailə səfəri',
      summary: 'İnsan tərəfindən təsdiqlənmiş sintetik səyahət təklifi.', currency: 'AZN',
      lineItems: [{ lineNumber: 1, description: 'Uçuş və otel paketi', quantity: 1, unitPriceMinor: 500_000, totalMinor: 500_000 }],
      subtotalMinor: 500_000, serviceFeeMinor: 10_000, discountMinor: 5_000,
      totalMinor: 505_000, validUntil: '2030-12-31T20:00:00.000Z',
      customerNotes: 'Synthetic quotation only.'
    },
    commercial: { costTotalMinor: 400_000, grossProfitMinor: 105_000, grossMarginBps: 2_079 },
    riskFlags: ['MANUAL_CONFIRMATION_REQUIRED']
  };
  await database.exec(`
    begin;
    set constraints all deferred;
    insert into public.travel_requests (
      id, customer_id, status, current_version, assigned_staff_id, claimed_at, submitted_at
    ) values ('${requestId}', '${customerA}', 'HUMAN_REVIEW', 1, '${founderId}', now(), now());
    insert into public.travel_request_versions (
      travel_request_id, version_number, customer_id, locale,
      canonical_payload, payload_hash, created_by
    ) values ('${requestId}', 1, '${customerA}', 'az', '${quote(requestPayload)}'::jsonb, '${requestHash}', '${customerA}');
    insert into public.commercial_quotations (
      id, travel_request_id, customer_id, source_request_version, source_request_hash, created_by
    ) values ('${quotationId}', '${requestId}', '${customerA}', 1, '${requestHash}', '${founderId}');
    insert into public.quotation_versions (
      quotation_id, version_number, travel_request_id, source_request_version,
      source_request_hash, customer_id, canonical_payload, payload_hash,
      created_by_kind, created_by
    ) values ('${quotationId}', 1, '${requestId}', 1, '${requestHash}', '${customerA}',
      '${quote(quotationPayload)}'::jsonb, '${quotationHash}', 'human', '${founderId}');
    insert into public.commercial_approval_decisions (
      id, quotation_id, version_number, payload_hash, customer_id, decision,
      reason, policy_version_id, decided_by, actor_session_id, actor_aal
    ) values ('a3000000-0000-4000-8000-000000000004', '${quotationId}', 1,
      '${quotationHash}', '${customerA}', 'APPROVE', 'Synthetic Task 008 approval',
      '55000000-0000-4000-8000-000000000001', '${founderId}', '${founderSession}', 'aal2');
    insert into public.published_proposals (
      id, quotation_id, version_number, payload_hash, customer_id, customer_payload,
      locale, valid_until, approval_decision_id, published_by, actor_session_id
    ) values ('a3000000-0000-4000-8000-000000000005', '${quotationId}', 1,
      '${quotationHash}', '${customerA}', '${quote(quotationPayload.customer)}'::jsonb,
      'az', '2030-12-31T20:00:00.000Z', 'a3000000-0000-4000-8000-000000000004',
      '${founderId}', '${founderSession}');
    insert into public.customer_quotation_acceptances (
      id, quotation_id, version_number, payload_hash, customer_id,
      acceptance_version, locale, accepted_by, actor_session_id
    ) values ('${acceptanceId}', '${quotationId}', 1, '${quotationHash}', '${customerA}',
      'quotation-acceptance-v1', 'az', '${customerA}', '${customerSession}');
    update public.commercial_quotations set status = 'ACCEPTED',
      current_version = 1, current_hash = '${quotationHash}',
      approved_version = 1, approved_hash = '${quotationHash}',
      published_version = 1, published_hash = '${quotationHash}',
      accepted_at = now(), updated_at = now() where id = '${quotationId}';
    commit;
  `);
}

async function prepareSupplierConfirmation(database: PGlite) {
  const evidencePayload = {
    schemaVersion: 'payment-evidence-v1', paymentRequestId,
    sourceKind: 'CUSTOMER_EVIDENCE', channel: 'BANK_TRANSFER_REFERENCE',
    currency: 'AZN', amountMinor: 505_000, observedAt: '2026-07-17T09:00:00.000Z',
    externalReference: 'TASK008-PAY-001', note: 'Synthetic exact Payment evidence.',
    declarationConfirmed: true
  };
  const paymentVerificationPayload = {
    schemaVersion: 'payment-verification-v1', paymentRequestId,
    evidenceId: paymentEvidenceId, evidenceHash, decision: 'VERIFY',
    reason: 'Exact synthetic Payment evidence verified'
  };
  const allocationPayload = {
    schemaVersion: 'funds-allocation-v1', paymentRequestId,
    verificationId: paymentVerificationId, verificationHash: paymentVerificationHash,
    currency: 'AZN', amountMinor: 505_000
  };
  const readinessInput = {
    schemaVersion: 'financial-readiness-input-v1', paymentRequestId,
    allocationId, allocationHash
  };
  for (const command of [
    { commandId: paymentRequestId, key: 'task008-payment-request', name: 'payment_request.create', actorId: financeId, sessionId: financeSession, aal: 'aal2' as const, payload: { quotationId, versionNumber: 1, quotationHash } },
    { commandId: paymentEvidenceId, key: 'task008-payment-evidence', name: 'payment.evidence.submit', actorId: customerA, sessionId: customerSession, aal: 'aal1' as const, payload: { paymentRequestId, evidencePayload, evidenceHash } },
    { commandId: paymentReviewId, key: 'task008-payment-review', name: 'payment.review.start', actorId: financeId, sessionId: financeSession, aal: 'aal2' as const, payload: { paymentRequestId, evidenceId: paymentEvidenceId, evidenceHash } },
    { commandId: paymentVerificationId, key: 'task008-payment-verify', name: 'payment.verify', actorId: financeId, sessionId: financeSession, aal: 'aal2' as const, payload: { paymentRequestId, evidenceId: paymentEvidenceId, evidenceHash, verificationPayload: paymentVerificationPayload, verificationHash: paymentVerificationHash } },
    { commandId: allocationId, key: 'task008-payment-allocate', name: 'funds.allocate', actorId: financeId, sessionId: financeSession, aal: 'aal2' as const, payload: { paymentRequestId, verificationId: paymentVerificationId, verificationHash: paymentVerificationHash, allocationPayload, allocationHash } },
    { commandId: readinessId, key: 'task008-payment-ready', name: 'payment.evaluate_readiness', actorId: financeId, sessionId: financeSession, aal: 'aal2' as const, payload: { paymentRequestId, allocationId, allocationHash, readinessInput, readinessHash } }
  ]) await database.query(authoritySql('payment', command));

  const bookingPayload = {
    schemaVersion: 'booking-creation-v1', paymentRequestId,
    readinessEvaluationId: readinessId, readinessHash, acceptanceId,
    quotationId, quotationVersion: 1, quotationHash
  };
  const executionPayload = {
    schemaVersion: 'supplier-execution-v1', bookingId, channel: 'SUPPLIER_PORTAL',
    supplierName: 'Synthetic Supplier', executedAt: '2026-07-17T10:00:00.000Z',
    requestReference: 'SUP-REQ-008', serviceSummary: 'Synthetic flight and hotel submitted.',
    note: 'No Production Customer data.', declarationConfirmed: true
  };
  const confirmationPayload = {
    schemaVersion: 'supplier-confirmation-v1', bookingId, executionId, executionHash,
    supplierName: 'Synthetic Supplier', channel: 'EMAIL',
    confirmedAt: '2026-07-17T10:15:00.000Z', confirmationReference: 'SUP-CONF-008',
    serviceSummary: 'Synthetic flight and hotel confirmed by Supplier.',
    note: 'Awaiting separate human Booking Verification.', declarationConfirmed: true
  };
  for (const command of [
    { commandId: bookingId, key: 'task008-booking-create', name: 'booking.create', actorId: staffId, sessionId: staffSession, aal: 'aal2' as const, payload: { paymentRequestId, readinessEvaluationId: readinessId, readinessHash, bookingPayload, bookingHash } },
    { commandId: executionId, key: 'task008-supplier-exec', name: 'supplier_booking.complete', actorId: staffId, sessionId: staffSession, aal: 'aal2' as const, payload: { bookingId, executionPayload, executionHash } },
    { commandId: confirmationId, key: 'task008-supplier-confirm', name: 'supplier_confirmation.capture', actorId: staffId, sessionId: staffSession, aal: 'aal2' as const, payload: { bookingId, executionId, executionHash, confirmationPayload, confirmationHash } }
  ]) await database.query(authoritySql('booking', command));
}

function exactConfirmation(id = confirmationId, hash = confirmationHash, version = 1) {
  return {
    bookingId, executionId, executionHash,
    supplierConfirmationId: id,
    supplierConfirmationVersion: version,
    supplierConfirmationHash: hash
  };
}

function verificationPayload(input: {
  reviewId: string;
  confirmationId: string;
  confirmationVersion: number;
  confirmationHash: string;
  decision: 'VERIFY' | 'REJECT';
}) {
  const verified = input.decision === 'VERIFY';
  return {
    schemaVersion: 'booking-verification-v1', bookingId,
    bookingAuthorityHash: bookingHash, reviewId: input.reviewId,
    executionId, executionHash, supplierConfirmationId: input.confirmationId,
    supplierConfirmationVersion: input.confirmationVersion,
    supplierConfirmationHash: input.confirmationHash, decision: input.decision,
    reason: verified ? 'Exact synthetic Booking evidence independently verified' : 'Supplier reference does not match the exact Booking evidence',
    checks: {
      customerDetailsMatch: true, datesAndServicesMatch: true,
      supplierReferenceValidated: verified, priceAndTermsMatch: true
    },
    declarationConfirmed: true
  };
}

async function runFullVerifiedFlow(database: PGlite) {
  await database.query(authoritySql('fulfilment', {
    commandId: firstReviewId, key: 'task008-review-start-1', name: 'booking.verification.start',
    actorId: managerId, sessionId: managerSession, aal: 'aal2', payload: exactConfirmation()
  }));
  const rejectedPayload = verificationPayload({
    reviewId: firstReviewId, confirmationId, confirmationVersion: 1,
    confirmationHash, decision: 'REJECT'
  });
  await database.query(authoritySql('fulfilment', {
    commandId: rejectionId, key: 'task008-review-reject', name: 'booking.verify',
    actorId: managerId, sessionId: managerSession, aal: 'aal2',
    payload: { ...exactConfirmation(), reviewId: firstReviewId, verificationPayload: rejectedPayload, verificationHash: rejectionHash }
  }));
  const correctionPayload = {
    schemaVersion: 'supplier-confirmation-correction-v1', bookingId,
    executionId, executionHash, supersedesConfirmationId: confirmationId,
    supersedesConfirmationHash: confirmationHash, rejectedVerificationId: rejectionId,
    rejectedVerificationHash: rejectionHash, supplierName: 'Synthetic Supplier',
    channel: 'EMAIL', confirmedAt: '2026-07-17T11:00:00.000Z',
    confirmationReference: 'SUP-CONF-008-CORRECTED',
    serviceSummary: 'Corrected synthetic flight and hotel confirmed by Supplier.',
    note: 'Append-only correction.', declarationConfirmed: true
  };
  await database.query(authoritySql('fulfilment', {
    commandId: correctionId, key: 'task008-confirm-correct', name: 'supplier_confirmation.correct',
    actorId: staffId, sessionId: staffSession, aal: 'aal2',
    payload: {
      bookingId, executionId, executionHash, supplierConfirmationId: confirmationId,
      supplierConfirmationHash: confirmationHash, verificationId: rejectionId,
      verificationHash: rejectionHash, confirmationPayload: correctionPayload,
      correctedConfirmationHash: correctionHash
    }
  }));
  await database.query(authoritySql('fulfilment', {
    commandId: secondReviewId, key: 'task008-review-start-2', name: 'booking.verification.start',
    actorId: managerId, sessionId: managerSession, aal: 'aal2',
    payload: exactConfirmation(correctionId, correctionHash, 2)
  }));
  const verifiedPayload = verificationPayload({
    reviewId: secondReviewId, confirmationId: correctionId, confirmationVersion: 2,
    confirmationHash: correctionHash, decision: 'VERIFY'
  });
  await database.query(authoritySql('fulfilment', {
    commandId: verifiedId, key: 'task008-review-verify', name: 'booking.verify',
    actorId: managerId, sessionId: managerSession, aal: 'aal2',
    payload: {
      ...exactConfirmation(correctionId, correctionHash, 2), reviewId: secondReviewId,
      verificationPayload: verifiedPayload, verificationHash: verifiedHash
    }
  }));
}

function exactVoucherPayload(versionNumber = 1) {
  return {
    schemaVersion: 'voucher-v1', voucherId, versionNumber, bookingId,
    bookingAuthorityHash: bookingHash, verificationId: verifiedId,
    verificationHash: verifiedHash, executionId, executionHash,
    supplierConfirmationId: correctionId, supplierConfirmationVersion: 2,
    supplierConfirmationHash: correctionHash, quotationId, quotationVersion: 1,
    quotationHash, locale: 'az',
    supplier: {
      name: 'Synthetic Supplier', confirmationReference: 'SUP-CONF-008-CORRECTED',
      confirmationSummary: 'Corrected synthetic flight and hotel confirmed by Supplier.'
    },
    trip: {
      title: 'İstanbul ailə səfəri',
      summary: 'İnsan tərəfindən təsdiqlənmiş sintetik səyahət təklifi.'
    },
    services: [{
      sequence: 1, category: 'OTHER', title: 'Uçuş və otel paketi',
      details: 'Corrected synthetic flight and hotel confirmed by Supplier.',
      serviceDate: '2026-09-10', customerReference: 'SUP-CONF-008-CORRECTED'
    }],
    supportContact: 'Synthetic VOYARA support',
    customerNotes: versionNumber === 1 ? 'Synthetic Voucher only.' : 'Synthetic revised Voucher only.',
    preparationSource: 'HUMAN', declarationConfirmed: true
  };
}

async function createVoucherDraft(database: PGlite) {
  return database.query<{ result: Record<string, unknown> }>(authoritySql('fulfilment', {
    commandId: voucherDraftCommandId, key: 'task008-voucher-draft', name: 'voucher.draft.create',
    actorId: staffId, sessionId: staffSession, aal: 'aal2',
    payload: {
      ...exactConfirmation(correctionId, correctionHash, 2),
      verificationId: verifiedId, verificationHash: verifiedHash,
      voucherId, versionNumber: 1, voucherPayload: exactVoucherPayload(), voucherHash
    }
  }));
}

async function reviseVoucherDraft(database: PGlite) {
  return database.query<{ result: Record<string, unknown> }>(authoritySql('fulfilment', {
    commandId: voucherRevisionCommandId, key: 'task008-voucher-revision', name: 'voucher.draft.create',
    actorId: staffId, sessionId: staffSession, aal: 'aal2',
    payload: {
      ...exactConfirmation(correctionId, correctionHash, 2),
      verificationId: verifiedId, verificationHash: verifiedHash,
      voucherId, versionNumber: 2, voucherPayload: exactVoucherPayload(2),
      voucherHash: voucherRevisionHash
    }
  }));
}

async function issueVoucher(database: PGlite) {
  return database.query<{ result: Record<string, unknown> }>(authoritySql('fulfilment', {
    commandId: voucherIssueCommandId, key: 'task008-voucher-issue', name: 'voucher.issue',
    actorId: founderId, sessionId: founderSession, aal: 'aal2',
    payload: { bookingId, verificationId: verifiedId, verificationHash: verifiedHash, voucherId, versionNumber: 2, voucherHash: voucherRevisionHash }
  }));
}

test('human Verification rejects, preserves evidence, accepts correction and gates exact Voucher issue', async () => {
  const database = await setupDatabase();
  try {
    const wrongEvidence = await database.query<{ result: { status: string; reasonCode: string } }>(authoritySql('fulfilment', {
      commandId: 'a6000000-0000-4000-8000-000000000020', key: 'task008-wrong-hash-01',
      name: 'booking.verification.start', actorId: managerId, sessionId: managerSession,
      aal: 'aal2', payload: exactConfirmation(confirmationId, '8'.repeat(64), 1)
    }));
    assert.deepEqual(wrongEvidence.rows[0]?.result, { status: 'denied', reasonCode: 'EXACT_SUPPLIER_CONFIRMATION_REQUIRED' });

    const staffDenied = await database.query<{ result: { status: string; reasonCode: string } }>(authoritySql('fulfilment', {
      commandId: 'a6000000-0000-4000-8000-000000000021', key: 'task008-staff-verify-1',
      name: 'booking.verification.start', actorId: staffId, sessionId: staffSession,
      aal: 'aal2', payload: exactConfirmation()
    }));
    assert.deepEqual(staffDenied.rows[0]?.result, { status: 'denied', reasonCode: 'BOOKING_VERIFICATION_AUTHORITY_REQUIRED' });

    const aal1 = await database.query<{ result: { status: string; reasonCode: string } }>(authoritySql('fulfilment', {
      commandId: 'a6000000-0000-4000-8000-000000000022', key: 'task008-aal1-denied',
      name: 'booking.verification.start', actorId: managerId, sessionId: managerSession,
      aal: 'aal1', payload: exactConfirmation()
    }));
    assert.deepEqual(aal1.rows[0]?.result, { status: 'denied', reasonCode: 'AAL2_REQUIRED' });

    await runFullVerifiedFlow(database);
    const corrected = await database.query<{
      status: string; confirmations: number; decisions: number; old_hash: string; current_hash: string;
    }>(`
      select b.status,
        (select count(*)::integer from public.supplier_confirmations where booking_id = b.id) as confirmations,
        (select count(*)::integer from public.booking_verification_decisions where booking_id = b.id) as decisions,
        (select confirmation_hash from public.supplier_confirmations where id = '${confirmationId}') as old_hash,
        b.supplier_confirmation_hash as current_hash
      from public.bookings b where id = '${bookingId}'
    `);
    assert.deepEqual(corrected.rows[0], {
      status: 'BOOKING_VERIFIED', confirmations: 2, decisions: 2,
      old_hash: confirmationHash, current_hash: correctionHash
    });

    const prematureIssue = await database.query<{ result: { status: string; reasonCode: string } }>(authoritySql('fulfilment', {
      commandId: 'a6000000-0000-4000-8000-000000000023', key: 'task008-no-draft-issue',
      name: 'voucher.issue', actorId: founderId, sessionId: founderSession, aal: 'aal2',
      payload: { bookingId, verificationId: verifiedId, verificationHash: verifiedHash, voucherId, versionNumber: 1, voucherHash }
    }));
    assert.deepEqual(prematureIssue.rows[0]?.result, { status: 'denied', reasonCode: 'EXACT_VOUCHER_VERSION_REQUIRED' });

    const drafted = await createVoucherDraft(database);
    assert.equal(drafted.rows[0]?.result.bookingStatus, 'VOUCHER_DRAFTED');
    assert.equal(drafted.rows[0]?.result.voucherHash, voucherHash);

    const wrongVoucher = await database.query<{ result: { status: string; reasonCode: string } }>(authoritySql('fulfilment', {
      commandId: 'a6000000-0000-4000-8000-000000000024', key: 'task008-wrong-voucher',
      name: 'voucher.issue', actorId: founderId, sessionId: founderSession, aal: 'aal2',
      payload: { bookingId, verificationId: verifiedId, verificationHash: verifiedHash, voucherId, versionNumber: 1, voucherHash: '0'.repeat(64) }
    }));
    assert.deepEqual(wrongVoucher.rows[0]?.result, { status: 'denied', reasonCode: 'EXACT_VOUCHER_VERSION_REQUIRED' });

    const revised = await reviseVoucherDraft(database);
    assert.equal(revised.rows[0]?.result.bookingStatus, 'VOUCHER_DRAFTED');
    assert.equal(revised.rows[0]?.result.voucherVersion, 2);
    assert.equal(revised.rows[0]?.result.voucherHash, voucherRevisionHash);

    const issued = await issueVoucher(database);
    assert.equal(issued.rows[0]?.result.bookingStatus, 'VOUCHER_ISSUED');
    const final = await database.query<{ status: string; voucher_status: string; versions: number; issues: number }>(`
      select b.status, v.status as voucher_status,
        (select count(*)::integer from public.voucher_versions where booking_id = b.id) as versions,
        (select count(*)::integer from public.voucher_issuance_events where booking_id = b.id) as issues
      from public.bookings b join public.vouchers v on v.booking_id = b.id
      where b.id = '${bookingId}'
    `);
    assert.deepEqual(final.rows[0], { status: 'VOUCHER_ISSUED', voucher_status: 'ISSUED', versions: 2, issues: 1 });

    await database.exec('reset role;');
    await assert.rejects(
      database.exec(`update public.booking_verification_decisions set reason = 'tampered evidence' where id = '${verifiedId}'`),
      /append-only/i
    );
    await assert.rejects(
      database.exec(`delete from public.voucher_versions where voucher_id = '${voucherId}'`),
      /append-only/i
    );
  } finally {
    await database.close();
  }
});

test('RLS hides draft Vouchers and internal Verification, then privately delivers only the issued version', async () => {
  const database = await setupDatabase();
  try {
    await runFullVerifiedFlow(database);
    await createVoucherDraft(database);
    await reviseVoucherDraft(database);

    await database.exec(`reset role; set role authenticated; set request.jwt.claim.sub = '${customerA}'; set request.jwt.claims = '{"aal":"aal1"}';`);
    const beforeIssue = await database.query<{ vouchers: number; versions: number; decisions: number }>(`
      select (select count(*)::integer from public.vouchers) as vouchers,
        (select count(*)::integer from public.voucher_versions) as versions,
        (select count(*)::integer from public.booking_verification_decisions) as decisions
    `);
    assert.deepEqual(beforeIssue.rows[0], { vouchers: 0, versions: 0, decisions: 0 });
    await assert.rejects(
      database.query('select voucher_id, voucher_version, voucher_hash from public.bookings'),
      /permission denied/i
    );
    await assert.rejects(
      database.query(authoritySql('fulfilment', {
        commandId: 'a6000000-0000-4000-8000-000000000030', key: 'task008-customer-rpc',
        name: 'voucher.issue', actorId: customerA, sessionId: customerSession, aal: 'aal2',
        payload: { bookingId, verificationId: verifiedId, verificationHash: verifiedHash, voucherId, versionNumber: 1, voucherHash }
      })),
      /permission denied/i
    );

    await database.exec('reset role; set role service_role;');
    await issueVoucher(database);
    await database.exec(`reset role; set role authenticated; set request.jwt.claim.sub = '${customerA}'; set request.jwt.claims = '{"aal":"aal1"}';`);
    const own = await database.query<{ vouchers: number; versions: number; decisions: number; hash: string }>(`
      select (select count(*)::integer from public.vouchers) as vouchers,
        (select count(*)::integer from public.voucher_versions) as versions,
        (select count(*)::integer from public.booking_verification_decisions) as decisions,
        (select voucher_hash from public.voucher_versions limit 1) as hash
    `);
    assert.deepEqual(own.rows[0], { vouchers: 1, versions: 1, decisions: 0, hash: voucherRevisionHash });

    await database.exec(`set request.jwt.claim.sub = '${customerB}';`);
    const other = await database.query<{ vouchers: number; versions: number }>(`
      select (select count(*)::integer from public.vouchers) as vouchers,
        (select count(*)::integer from public.voucher_versions) as versions
    `);
    assert.deepEqual(other.rows[0], { vouchers: 0, versions: 0 });

    await database.exec(`set request.jwt.claim.sub = '${staffId}'; set request.jwt.claims = '{"aal":"aal1"}';`);
    const staffAal1 = await database.query<{ decisions: number; vouchers: number }>(`
      select (select count(*)::integer from public.booking_verification_decisions) as decisions,
        (select count(*)::integer from public.vouchers) as vouchers
    `);
    assert.deepEqual(staffAal1.rows[0], { decisions: 0, vouchers: 0 });

    await database.exec(`set request.jwt.claims = '{"aal":"aal2"}';`);
    const staffAal2 = await database.query<{ decisions: number; vouchers: number }>(`
      select (select count(*)::integer from public.booking_verification_decisions) as decisions,
        (select count(*)::integer from public.vouchers) as vouchers
    `);
    assert.deepEqual(staffAal2.rows[0], { decisions: 2, vouchers: 1 });
  } finally {
    await database.close();
  }
});
