import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const customerA = '91000000-0000-4000-8000-000000000001';
const customerB = '91000000-0000-4000-8000-000000000002';
const staffId = '91000000-0000-4000-8000-000000000003';
const financeId = '91000000-0000-4000-8000-000000000004';
const founderId = '91000000-0000-4000-8000-000000000005';
const customerSession = '92000000-0000-4000-8000-000000000001';
const staffSession = '92000000-0000-4000-8000-000000000002';
const financeSession = '92000000-0000-4000-8000-000000000003';
const founderSession = '92000000-0000-4000-8000-000000000004';
const requestId = '93000000-0000-4000-8000-000000000001';
const quotationId = '93000000-0000-4000-8000-000000000002';
const acceptanceId = '93000000-0000-4000-8000-000000000003';
const paymentRequestId = '94000000-0000-4000-8000-000000000001';
const evidenceId = '94000000-0000-4000-8000-000000000002';
const reviewId = '94000000-0000-4000-8000-000000000003';
const verificationId = '94000000-0000-4000-8000-000000000004';
const allocationId = '94000000-0000-4000-8000-000000000005';
const readinessId = '94000000-0000-4000-8000-000000000006';
const bookingId = '95000000-0000-4000-8000-000000000001';
const executionId = '95000000-0000-4000-8000-000000000002';
const confirmationId = '95000000-0000-4000-8000-000000000003';
const requestHash = 'a'.repeat(64);
const quotationHash = 'b'.repeat(64);
const evidenceHash = 'c'.repeat(64);
const verificationHash = 'd'.repeat(64);
const allocationHash = 'e'.repeat(64);
const readinessHash = 'f'.repeat(64);
const bookingHash = '1'.repeat(64);
const executionHash = '2'.repeat(64);
const confirmationHash = '3'.repeat(64);
const commandHash = '9'.repeat(64);

function quote(value: unknown): string {
  return JSON.stringify(value).replaceAll("'", "''");
}

function paymentCommandSql(input: {
  commandId: string;
  key: string;
  name: string;
  actorId: string;
  sessionId: string;
  aal: 'aal1' | 'aal2';
  payload: object;
}) {
  return `select public.execute_payment_command(
    '${input.commandId}', '${input.key}', '${input.name}',
    '${input.actorId}', '${input.sessionId}', '${input.aal}', now() - interval '1 second',
    '${quote(input.payload)}'::jsonb, '${commandHash}'
  ) as result`;
}

function bookingCommandSql(input: {
  commandId: string;
  key: string;
  name: string;
  actorId: string;
  sessionId: string;
  aal: 'aal1' | 'aal2';
  payload: object;
}) {
  return `select public.execute_booking_command(
    '${input.commandId}', '${input.key}', '${input.name}',
    '${input.actorId}', '${input.sessionId}', '${input.aal}', now() - interval '1 second',
    '${quote(input.payload)}'::jsonb, '${commandHash}'
  ) as result`;
}

function bookingPayload(readinessEvidenceHash = readinessHash) {
  return {
    schemaVersion: 'booking-creation-v1',
    paymentRequestId,
    readinessEvaluationId: readinessId,
    readinessHash: readinessEvidenceHash,
    acceptanceId,
    quotationId,
    quotationVersion: 1,
    quotationHash
  };
}

function executionPayload() {
  return {
    schemaVersion: 'supplier-execution-v1',
    bookingId,
    channel: 'SUPPLIER_PORTAL',
    supplierName: 'Synthetic Supplier',
    executedAt: '2026-07-17T10:00:00.000Z',
    requestReference: 'SUP-REQ-001',
    serviceSummary: 'Exact synthetic flight and hotel services submitted.',
    note: 'No Production Customer data.',
    declarationConfirmed: true
  };
}

function confirmationPayload(exactExecutionHash = executionHash) {
  return {
    schemaVersion: 'supplier-confirmation-v1',
    bookingId,
    executionId,
    executionHash: exactExecutionHash,
    supplierName: 'Synthetic Supplier',
    channel: 'EMAIL',
    confirmedAt: '2026-07-17T10:15:00.000Z',
    confirmationReference: 'SUP-CONF-001',
    serviceSummary: 'Exact synthetic services confirmed by Supplier.',
    note: 'Awaiting separate human Booking Verification.',
    declarationConfirmed: true
  };
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
    'supabase/migrations/20260717144340_task007_booking_supplier_confirmation_vertical_slice.sql'
  ]) await database.exec(await readFile(migration, 'utf8'));

  await database.exec(`
    insert into auth.users (id, email) values
      ('${customerA}', 'customer-a@voyara.example'),
      ('${customerB}', 'customer-b@voyara.example'),
      ('${staffId}', 'staff@voyara.example'),
      ('${financeId}', 'finance@voyara.example'),
      ('${founderId}', 'founder@voyara.example');
    insert into public.role_assignments (user_id, role, assigned_by, reason) values
      ('${staffId}', 'staff', '${founderId}', 'Synthetic Task 007 Staff'),
      ('${financeId}', 'finance', '${founderId}', 'Synthetic Task 007 Finance'),
      ('${founderId}', 'founder', '${founderId}', 'Synthetic Task 007 Founder');
  `);
  await prepareAcceptedQuotation(database);
  await database.exec('set role service_role;');
  return database;
}

async function prepareAcceptedQuotation(database: PGlite) {
  const requestPayload = {
    destination: 'Istanbul',
    departureCity: 'Baku',
    departureDate: '2026-09-10',
    returnDate: '2026-09-17',
    travelers: { adults: 2, children: 0, infants: 0 },
    budgetAzn: 6_000,
    tripPurpose: 'leisure',
    notes: 'Synthetic Task 007 request',
    locale: 'az',
    submissionAcknowledgements: { accuracyConfirmed: true, dataProcessingAcknowledged: true }
  };
  const quotationPayload = {
    schemaVersion: 'quotation-v1',
    source: { travelRequestId: requestId, travelRequestVersion: 1, travelRequestHash: requestHash },
    customer: {
      locale: 'az',
      title: 'İstanbul ailə səfəri',
      summary: 'İnsan tərəfindən təsdiqlənmiş sintetik səyahət təklifi.',
      currency: 'AZN',
      lineItems: [{ lineNumber: 1, description: 'Uçuş və otel paketi', quantity: 1, unitPriceMinor: 500_000, totalMinor: 500_000 }],
      subtotalMinor: 500_000,
      serviceFeeMinor: 10_000,
      discountMinor: 5_000,
      totalMinor: 505_000,
      validUntil: '2030-12-31T20:00:00.000Z',
      customerNotes: 'Synthetic quotation only.'
    },
    commercial: { costTotalMinor: 400_000, grossProfitMinor: 105_000, grossMarginBps: 2_079 },
    riskFlags: ['MANUAL_CONFIRMATION_REQUIRED']
  };

  await database.exec(`
    begin;
    set constraints all deferred;
    insert into public.travel_requests (
      id, customer_id, status, current_version, assigned_staff_id,
      claimed_at, submitted_at
    ) values (
      '${requestId}', '${customerA}', 'HUMAN_REVIEW', 1, '${founderId}',
      now(), now()
    );
    insert into public.travel_request_versions (
      travel_request_id, version_number, customer_id, locale,
      canonical_payload, payload_hash, created_by
    ) values (
      '${requestId}', 1, '${customerA}', 'az',
      '${quote(requestPayload)}'::jsonb, '${requestHash}', '${customerA}'
    );
    insert into public.commercial_quotations (
      id, travel_request_id, customer_id, source_request_version,
      source_request_hash, created_by
    ) values (
      '${quotationId}', '${requestId}', '${customerA}', 1,
      '${requestHash}', '${founderId}'
    );
    insert into public.quotation_versions (
      quotation_id, version_number, travel_request_id, source_request_version,
      source_request_hash, customer_id, canonical_payload, payload_hash,
      created_by_kind, created_by
    ) values (
      '${quotationId}', 1, '${requestId}', 1, '${requestHash}', '${customerA}',
      '${quote(quotationPayload)}'::jsonb, '${quotationHash}', 'human', '${founderId}'
    );
    insert into public.commercial_approval_decisions (
      id, quotation_id, version_number, payload_hash, customer_id,
      decision, reason, policy_version_id, decided_by, actor_session_id, actor_aal
    ) values (
      '93000000-0000-4000-8000-000000000004', '${quotationId}', 1, '${quotationHash}', '${customerA}',
      'APPROVE', 'Synthetic Task 007 approval', '55000000-0000-4000-8000-000000000001',
      '${founderId}', '${founderSession}', 'aal2'
    );
    insert into public.published_proposals (
      id, quotation_id, version_number, payload_hash, customer_id,
      customer_payload, locale, valid_until, approval_decision_id,
      published_by, actor_session_id
    ) values (
      '93000000-0000-4000-8000-000000000005', '${quotationId}', 1, '${quotationHash}', '${customerA}',
      '${quote(quotationPayload.customer)}'::jsonb, 'az', '2030-12-31T20:00:00.000Z',
      '93000000-0000-4000-8000-000000000004', '${founderId}', '${founderSession}'
    );
    insert into public.customer_quotation_acceptances (
      id, quotation_id, version_number, payload_hash, customer_id,
      acceptance_version, locale, accepted_by, actor_session_id
    ) values (
      '${acceptanceId}', '${quotationId}', 1, '${quotationHash}', '${customerA}',
      'quotation-acceptance-v1', 'az', '${customerA}', '${customerSession}'
    );
    update public.commercial_quotations
    set status = 'ACCEPTED', current_version = 1, current_hash = '${quotationHash}',
        approved_version = 1, approved_hash = '${quotationHash}',
        published_version = 1, published_hash = '${quotationHash}',
        accepted_at = now(), updated_at = now()
    where id = '${quotationId}';
    commit;
  `);
}

async function prepareFinancialReadiness(database: PGlite) {
  await database.query(paymentCommandSql({
    commandId: paymentRequestId,
    key: 'task007-payment-request',
    name: 'payment_request.create',
    actorId: financeId,
    sessionId: financeSession,
    aal: 'aal2',
    payload: { quotationId, versionNumber: 1, quotationHash }
  }));
  const evidencePayload = {
    schemaVersion: 'payment-evidence-v1',
    paymentRequestId,
    sourceKind: 'CUSTOMER_EVIDENCE',
    channel: 'BANK_TRANSFER_REFERENCE',
    currency: 'AZN',
    amountMinor: 505_000,
    observedAt: '2026-07-17T09:00:00.000Z',
    externalReference: 'TASK007-PAY-001',
    note: 'Synthetic exact full Payment evidence.',
    declarationConfirmed: true
  };
  await database.query(paymentCommandSql({
    commandId: evidenceId,
    key: 'task007-payment-evidence',
    name: 'payment.evidence.submit',
    actorId: customerA,
    sessionId: customerSession,
    aal: 'aal1',
    payload: { paymentRequestId, evidencePayload, evidenceHash }
  }));
  await database.query(paymentCommandSql({
    commandId: reviewId,
    key: 'task007-payment-review',
    name: 'payment.review.start',
    actorId: financeId,
    sessionId: financeSession,
    aal: 'aal2',
    payload: { paymentRequestId, evidenceId, evidenceHash }
  }));
  const verificationPayload = {
    schemaVersion: 'payment-verification-v1',
    paymentRequestId,
    evidenceId,
    evidenceHash,
    decision: 'VERIFY',
    reason: 'Exact synthetic Payment evidence verified'
  };
  await database.query(paymentCommandSql({
    commandId: verificationId,
    key: 'task007-payment-verify',
    name: 'payment.verify',
    actorId: financeId,
    sessionId: financeSession,
    aal: 'aal2',
    payload: { paymentRequestId, evidenceId, evidenceHash, verificationPayload, verificationHash }
  }));
  const allocationPayload = {
    schemaVersion: 'funds-allocation-v1',
    paymentRequestId,
    verificationId,
    verificationHash,
    currency: 'AZN',
    amountMinor: 505_000
  };
  await database.query(paymentCommandSql({
    commandId: allocationId,
    key: 'task007-payment-allocate',
    name: 'funds.allocate',
    actorId: financeId,
    sessionId: financeSession,
    aal: 'aal2',
    payload: { paymentRequestId, verificationId, verificationHash, allocationPayload, allocationHash }
  }));
  const readinessInput = {
    schemaVersion: 'financial-readiness-input-v1',
    paymentRequestId,
    allocationId,
    allocationHash
  };
  await database.query(paymentCommandSql({
    commandId: readinessId,
    key: 'task007-payment-ready',
    name: 'payment.evaluate_readiness',
    actorId: financeId,
    sessionId: financeSession,
    aal: 'aal2',
    payload: { paymentRequestId, allocationId, allocationHash, readinessInput, readinessHash }
  }));
}

async function createBooking(database: PGlite) {
  return database.query<{ result: Record<string, unknown> }>(bookingCommandSql({
    commandId: bookingId,
    key: 'task007-booking-create',
    name: 'booking.create',
    actorId: staffId,
    sessionId: staffSession,
    aal: 'aal2',
    payload: {
      paymentRequestId,
      readinessEvaluationId: readinessId,
      readinessHash,
      bookingPayload: bookingPayload(),
      bookingHash
    }
  }));
}

async function completeSupplierFlow(database: PGlite) {
  await createBooking(database);
  await database.query(bookingCommandSql({
    commandId: executionId,
    key: 'task007-supplier-exec',
    name: 'supplier_booking.complete',
    actorId: staffId,
    sessionId: staffSession,
    aal: 'aal2',
    payload: { bookingId, executionPayload: executionPayload(), executionHash }
  }));
  await database.query(bookingCommandSql({
    commandId: confirmationId,
    key: 'task007-supplier-confirm',
    name: 'supplier_confirmation.capture',
    actorId: staffId,
    sessionId: staffSession,
    aal: 'aal2',
    payload: {
      bookingId,
      executionId,
      executionHash,
      confirmationPayload: confirmationPayload(),
      confirmationHash
    }
  }));
}

test('Booking authority requires exact readiness and preserves every human boundary', async () => {
  const database = await setupDatabase();
  try {
    const premature = await database.query<{ result: { status: string; reasonCode: string } }>(bookingCommandSql({
      commandId: '95000000-0000-4000-8000-000000000010',
      key: 'premature-booking-01',
      name: 'booking.create',
      actorId: staffId,
      sessionId: staffSession,
      aal: 'aal2',
      payload: {
        paymentRequestId,
        readinessEvaluationId: readinessId,
        readinessHash,
        bookingPayload: bookingPayload(),
        bookingHash
      }
    }));
    assert.deepEqual(premature.rows[0]?.result, { status: 'denied', reasonCode: 'FINANCIAL_READINESS_REQUIRED' });

    await prepareFinancialReadiness(database);

    const aal1 = await database.query<{ result: { status: string; reasonCode: string } }>(bookingCommandSql({
      commandId: '95000000-0000-4000-8000-000000000011',
      key: 'booking-aal1-denied',
      name: 'booking.create',
      actorId: staffId,
      sessionId: staffSession,
      aal: 'aal1',
      payload: {
        paymentRequestId,
        readinessEvaluationId: readinessId,
        readinessHash,
        bookingPayload: bookingPayload(),
        bookingHash
      }
    }));
    assert.deepEqual(aal1.rows[0]?.result, { status: 'denied', reasonCode: 'AAL2_REQUIRED' });

    const financeDenied = await database.query<{ result: { status: string; reasonCode: string } }>(bookingCommandSql({
      commandId: '95000000-0000-4000-8000-000000000012',
      key: 'finance-booking-deny',
      name: 'booking.create',
      actorId: financeId,
      sessionId: financeSession,
      aal: 'aal2',
      payload: {
        paymentRequestId,
        readinessEvaluationId: readinessId,
        readinessHash,
        bookingPayload: bookingPayload(),
        bookingHash
      }
    }));
    assert.deepEqual(financeDenied.rows[0]?.result, { status: 'denied', reasonCode: 'BOOKING_OPERATIONS_AUTHORITY_REQUIRED' });

    const wrongReadiness = await database.query<{ result: { status: string; reasonCode: string } }>(bookingCommandSql({
      commandId: '95000000-0000-4000-8000-000000000013',
      key: 'wrong-readiness-001',
      name: 'booking.create',
      actorId: staffId,
      sessionId: staffSession,
      aal: 'aal2',
      payload: {
        paymentRequestId,
        readinessEvaluationId: readinessId,
        readinessHash: '4'.repeat(64),
        bookingPayload: bookingPayload('4'.repeat(64)),
        bookingHash
      }
    }));
    assert.deepEqual(wrongReadiness.rows[0]?.result, { status: 'denied', reasonCode: 'FINANCIAL_READINESS_REQUIRED' });

    const created = await createBooking(database);
    assert.deepEqual(created.rows[0]?.result, {
      status: 'accepted',
      commandName: 'booking.create',
      bookingId,
      bookingStatus: 'CREATED',
      paymentRequestId,
      readinessEvaluationId: readinessId,
      readinessHash,
      quotationId,
      versionNumber: 1,
      quotationHash,
      workReceiptId: bookingId
    });

    const replay = await database.query<{ result: { bookingId: string } }>(bookingCommandSql({
      commandId: '95000000-0000-4000-8000-000000000014',
      key: 'task007-booking-create',
      name: 'booking.create',
      actorId: staffId,
      sessionId: staffSession,
      aal: 'aal2',
      payload: {
        paymentRequestId,
        readinessEvaluationId: readinessId,
        readinessHash,
        bookingPayload: bookingPayload(),
        bookingHash
      }
    }));
    assert.equal(replay.rows[0]?.result.bookingId, bookingId);

    const afterCreation = await database.query<{
      status: string;
      executions: number;
      confirmations: number;
    }>(`
      select b.status,
        (select count(*)::integer from public.supplier_booking_executions where booking_id = b.id) as executions,
        (select count(*)::integer from public.supplier_confirmations where booking_id = b.id) as confirmations
      from public.bookings b where id = '${bookingId}'
    `);
    assert.deepEqual(afterCreation.rows[0], { status: 'CREATED', executions: 0, confirmations: 0 });

    const prematureConfirmation = await database.query<{ result: { status: string; reasonCode: string } }>(bookingCommandSql({
      commandId: '95000000-0000-4000-8000-000000000015',
      key: 'premature-confirm-1',
      name: 'supplier_confirmation.capture',
      actorId: staffId,
      sessionId: staffSession,
      aal: 'aal2',
      payload: {
        bookingId,
        executionId,
        executionHash,
        confirmationPayload: confirmationPayload(),
        confirmationHash
      }
    }));
    assert.deepEqual(prematureConfirmation.rows[0]?.result, { status: 'denied', reasonCode: 'EXACT_SUPPLIER_EXECUTION_REQUIRED' });

    const execution = await database.query<{ result: Record<string, unknown> }>(bookingCommandSql({
      commandId: executionId,
      key: 'task007-supplier-exec',
      name: 'supplier_booking.complete',
      actorId: staffId,
      sessionId: staffSession,
      aal: 'aal2',
      payload: { bookingId, executionPayload: executionPayload(), executionHash }
    }));
    assert.equal(execution.rows[0]?.result.bookingStatus, 'SUPPLIER_EXECUTED');
    assert.equal(execution.rows[0]?.result.executionHash, executionHash);

    const afterExecution = await database.query<{ status: string; confirmations: number }>(`
      select b.status,
        (select count(*)::integer from public.supplier_confirmations where booking_id = b.id) as confirmations
      from public.bookings b where id = '${bookingId}'
    `);
    assert.deepEqual(afterExecution.rows[0], { status: 'SUPPLIER_EXECUTED', confirmations: 0 });

    const wrongExecution = await database.query<{ result: { status: string; reasonCode: string } }>(bookingCommandSql({
      commandId: '95000000-0000-4000-8000-000000000016',
      key: 'wrong-execution-001',
      name: 'supplier_confirmation.capture',
      actorId: staffId,
      sessionId: staffSession,
      aal: 'aal2',
      payload: {
        bookingId,
        executionId,
        executionHash: '5'.repeat(64),
        confirmationPayload: confirmationPayload('5'.repeat(64)),
        confirmationHash
      }
    }));
    assert.deepEqual(wrongExecution.rows[0]?.result, { status: 'denied', reasonCode: 'EXACT_SUPPLIER_EXECUTION_REQUIRED' });

    const confirmed = await database.query<{ result: Record<string, unknown> }>(bookingCommandSql({
      commandId: confirmationId,
      key: 'task007-supplier-confirm',
      name: 'supplier_confirmation.capture',
      actorId: staffId,
      sessionId: staffSession,
      aal: 'aal2',
      payload: {
        bookingId,
        executionId,
        executionHash,
        confirmationPayload: confirmationPayload(),
        confirmationHash
      }
    }));
    assert.equal(confirmed.rows[0]?.result.bookingStatus, 'SUPPLIER_CONFIRMED');
    assert.equal(confirmed.rows[0]?.result.supplierConfirmationHash, confirmationHash);

    const finalEvidence = await database.query<{
      status: string;
      executions: number;
      confirmations: number;
      receipts: number;
      verifications: string | null;
      vouchers: string | null;
    }>(`
      select b.status,
        (select count(*)::integer from public.supplier_booking_executions where booking_id = b.id) as executions,
        (select count(*)::integer from public.supplier_confirmations where booking_id = b.id) as confirmations,
        (select count(*)::integer from public.booking_work_receipts where booking_id = b.id) as receipts,
        to_regclass('public.booking_verifications')::text as verifications,
        to_regclass('public.vouchers')::text as vouchers
      from public.bookings b where id = '${bookingId}'
    `);
    assert.deepEqual(finalEvidence.rows[0], {
      status: 'SUPPLIER_CONFIRMED',
      executions: 1,
      confirmations: 1,
      receipts: 3,
      verifications: null,
      vouchers: null
    });

    await database.exec('reset role;');
    await assert.rejects(
      database.exec(`update public.supplier_booking_executions set execution_hash = '${'6'.repeat(64)}' where id = '${executionId}'`),
      /append-only/i
    );
    await assert.rejects(
      database.exec(`delete from public.supplier_confirmations where id = '${confirmationId}'`),
      /append-only/i
    );
    await assert.rejects(
      database.exec(`update public.bookings set status = 'CREATED' where id = '${bookingId}'`),
      /invalid or non-monotonic/i
    );
  } finally {
    await database.close();
  }
});

test('RLS exposes safe Customer Booking status and keeps Supplier evidence AAL2-operations-only', async () => {
  const database = await setupDatabase();
  try {
    await prepareFinancialReadiness(database);
    await completeSupplierFlow(database);

    await database.exec(`reset role; set role authenticated; set request.jwt.claim.sub = '${customerA}'; set request.jwt.claims = '{"aal":"aal1"}';`);
    const own = await database.query<{ bookings: number; executions: number; confirmations: number; receipts: number }>(`
      select
        (select count(*)::integer from public.bookings) as bookings,
        (select count(*)::integer from public.supplier_booking_executions) as executions,
        (select count(*)::integer from public.supplier_confirmations) as confirmations,
        (select count(*)::integer from public.booking_work_receipts) as receipts
    `);
    assert.deepEqual(own.rows[0], { bookings: 1, executions: 0, confirmations: 0, receipts: 3 });
    await assert.rejects(database.query('select created_by from public.bookings'), /permission denied/i);
    await assert.rejects(
      database.exec(`update public.bookings set status = 'CREATED' where id = '${bookingId}'`),
      /permission denied/i
    );
    await assert.rejects(
      database.query(bookingCommandSql({
        commandId: '95000000-0000-4000-8000-000000000020',
        key: 'customer-rpc-denied',
        name: 'booking.create',
        actorId: customerA,
        sessionId: customerSession,
        aal: 'aal2',
        payload: {
          paymentRequestId,
          readinessEvaluationId: readinessId,
          readinessHash,
          bookingPayload: bookingPayload(),
          bookingHash
        }
      })),
      /permission denied/i
    );

    await database.exec(`set request.jwt.claim.sub = '${customerB}';`);
    const other = await database.query<{ count: number }>('select count(*)::integer as count from public.bookings');
    assert.equal(other.rows[0]?.count, 0);

    await database.exec(`set request.jwt.claim.sub = '${staffId}'; set request.jwt.claims = '{"aal":"aal1"}';`);
    const staffAal1 = await database.query<{ bookings: number; confirmations: number }>(`
      select
        (select count(*)::integer from public.bookings) as bookings,
        (select count(*)::integer from public.supplier_confirmations) as confirmations
    `);
    assert.deepEqual(staffAal1.rows[0], { bookings: 0, confirmations: 0 });

    await database.exec(`set request.jwt.claims = '{"aal":"aal2"}';`);
    const staffAal2 = await database.query<{ bookings: number; executions: number; confirmations: number }>(`
      select
        (select count(*)::integer from public.bookings) as bookings,
        (select count(*)::integer from public.supplier_booking_executions) as executions,
        (select count(*)::integer from public.supplier_confirmations) as confirmations
    `);
    assert.deepEqual(staffAal2.rows[0], { bookings: 1, executions: 1, confirmations: 1 });
  } finally {
    await database.close();
  }
});
