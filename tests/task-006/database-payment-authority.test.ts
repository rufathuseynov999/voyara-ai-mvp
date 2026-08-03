import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const customerA = '81000000-0000-4000-8000-000000000001';
const customerB = '81000000-0000-4000-8000-000000000002';
const financeId = '81000000-0000-4000-8000-000000000003';
const adminId = '81000000-0000-4000-8000-000000000004';
const founderId = '81000000-0000-4000-8000-000000000005';
const customerSession = '82000000-0000-4000-8000-000000000001';
const customerBSession = '82000000-0000-4000-8000-000000000002';
const financeSession = '82000000-0000-4000-8000-000000000003';
const adminSession = '82000000-0000-4000-8000-000000000004';
const requestId = '83000000-0000-4000-8000-000000000001';
const quotationId = '83000000-0000-4000-8000-000000000002';
const acceptanceId = '83000000-0000-4000-8000-000000000003';
const paymentRequestId = '84000000-0000-4000-8000-000000000001';
const requestHash = 'a'.repeat(64);
const quotationHash = 'b'.repeat(64);
const wrongEvidenceHash = 'c'.repeat(64);
const correctEvidenceHash = 'd'.repeat(64);
const rejectionHash = 'e'.repeat(64);
const verificationHash = 'f'.repeat(64);
const allocationHash = '1'.repeat(64);
const readinessHash = '2'.repeat(64);
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
  hash?: string;
}) {
  return `select public.execute_payment_command(
    '${input.commandId}', '${input.key}', '${input.name}',
    '${input.actorId}', '${input.sessionId}', '${input.aal}', now() - interval '1 second',
    '${quote(input.payload)}'::jsonb, '${input.hash ?? commandHash}'
  ) as result`;
}

function evidencePayload(amountMinor: number, sourceKind: 'CUSTOMER_EVIDENCE' | 'FINANCE_DETECTION' = 'CUSTOMER_EVIDENCE') {
  return {
    schemaVersion: 'payment-evidence-v1',
    paymentRequestId,
    sourceKind,
    channel: sourceKind === 'CUSTOMER_EVIDENCE' ? 'BANK_TRANSFER_REFERENCE' : 'BANK_STATEMENT',
    currency: 'AZN',
    amountMinor,
    observedAt: '2026-07-17T08:00:00.000Z',
    externalReference: amountMinor === 505_000 ? 'BANK-CORRECT-001' : 'BANK-WRONG-001',
    note: 'Synthetic Task 006 evidence; no Production data.',
    declarationConfirmed: true
  };
}

function verificationPayload(evidenceId: string, evidenceHash: string, decision: 'VERIFY' | 'REJECT', reason: string) {
  return {
    schemaVersion: 'payment-verification-v1',
    paymentRequestId,
    evidenceId,
    evidenceHash,
    decision,
    reason
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
    'supabase/migrations/20260717143000_task006_payment_verification_vertical_slice.sql'
  ]) await database.exec(await readFile(migration, 'utf8'));

  await database.exec(`
    insert into auth.users (id, email) values
      ('${customerA}', 'customer-a@voyara.example'),
      ('${customerB}', 'customer-b@voyara.example'),
      ('${financeId}', 'finance@voyara.example'),
      ('${adminId}', 'admin@voyara.example'),
      ('${founderId}', 'founder@voyara.example');
    insert into public.role_assignments (user_id, role, assigned_by, reason) values
      ('${financeId}', 'finance', '${founderId}', 'Synthetic Task 006 Finance'),
      ('${adminId}', 'admin', '${founderId}', 'Synthetic Task 006 Admin'),
      ('${founderId}', 'founder', '${founderId}', 'Synthetic Task 006 Founder');
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
    notes: 'Synthetic Task 006 request',
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
      '83000000-0000-4000-8000-000000000004', '${quotationId}', 1, '${quotationHash}', '${customerA}',
      'APPROVE', 'Synthetic Task 006 approval', '55000000-0000-4000-8000-000000000001',
      '${founderId}', '${adminSession}', 'aal2'
    );
    insert into public.published_proposals (
      id, quotation_id, version_number, payload_hash, customer_id,
      customer_payload, locale, valid_until, approval_decision_id,
      published_by, actor_session_id
    ) values (
      '83000000-0000-4000-8000-000000000005', '${quotationId}', 1, '${quotationHash}', '${customerA}',
      '${quote(quotationPayload.customer)}'::jsonb, 'az', '2030-12-31T20:00:00.000Z',
      '83000000-0000-4000-8000-000000000004', '${founderId}', '${adminSession}'
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

test('evidence remains unverified until human review, then exact Verification, allocation and readiness are ordered', async () => {
  const database = await setupDatabase();
  try {
    const created = await database.query<{ result: Record<string, unknown> }>(paymentCommandSql({
      commandId: paymentRequestId,
      key: 'payment-request-0001',
      name: 'payment_request.create',
      actorId: financeId,
      sessionId: financeSession,
      aal: 'aal2',
      payload: { quotationId, versionNumber: 1, quotationHash }
    }));
    assert.deepEqual(created.rows[0]?.result, {
      status: 'accepted',
      commandName: 'payment_request.create',
      paymentRequestId,
      paymentStatus: 'REQUESTED',
      quotationId,
      versionNumber: 1,
      quotationHash,
      workReceiptId: paymentRequestId
    });

    const replay = await database.query<{ result: { paymentRequestId: string } }>(paymentCommandSql({
      commandId: '84000000-0000-4000-8000-000000000099',
      key: 'payment-request-0001',
      name: 'payment_request.create',
      actorId: financeId,
      sessionId: financeSession,
      aal: 'aal2',
      payload: { quotationId, versionNumber: 1, quotationHash }
    }));
    assert.equal(replay.rows[0]?.result.paymentRequestId, paymentRequestId);

    const otherCustomer = await database.query<{ result: { status: string; reasonCode: string } }>(paymentCommandSql({
      commandId: '84000000-0000-4000-8000-000000000002',
      key: 'other-evidence-denied',
      name: 'payment.evidence.submit',
      actorId: customerB,
      sessionId: customerBSession,
      aal: 'aal1',
      payload: {
        paymentRequestId,
        evidencePayload: evidencePayload(505_000),
        evidenceHash: correctEvidenceHash
      }
    }));
    assert.deepEqual(otherCustomer.rows[0]?.result, { status: 'denied', reasonCode: 'CUSTOMER_OWNERSHIP_REQUIRED' });

    const wrongEvidenceId = '84000000-0000-4000-8000-000000000003';
    const wrongEvidenceResult = await database.query<{ result: { paymentStatus: string; evidenceId: string } }>(paymentCommandSql({
      commandId: wrongEvidenceId,
      key: 'wrong-evidence-0001',
      name: 'payment.evidence.submit',
      actorId: customerA,
      sessionId: customerSession,
      aal: 'aal1',
      payload: {
        paymentRequestId,
        evidencePayload: evidencePayload(400_000),
        evidenceHash: wrongEvidenceHash
      }
    }));
    assert.deepEqual(wrongEvidenceResult.rows[0]?.result, {
      status: 'accepted',
      commandName: 'payment.evidence.submit',
      paymentRequestId,
      paymentStatus: 'EVIDENCE_RECEIVED',
      quotationId,
      versionNumber: 1,
      quotationHash,
      evidenceId: wrongEvidenceId,
      evidenceHash: wrongEvidenceHash,
      workReceiptId: wrongEvidenceId
    });

    const separation = await database.query<{ status: string; verifications: number; allocations: number }>(`
      select p.status,
        (select count(*)::integer from public.payment_verification_decisions where payment_request_id = p.id) as verifications,
        (select count(*)::integer from public.fund_allocations where payment_request_id = p.id) as allocations
      from public.payment_requests p where id = '${paymentRequestId}'
    `);
    assert.deepEqual(separation.rows[0], { status: 'EVIDENCE_RECEIVED', verifications: 0, allocations: 0 });

    const wrongHashReview = await database.query<{ result: { status: string; reasonCode: string } }>(paymentCommandSql({
      commandId: '84000000-0000-4000-8000-000000000004',
      key: 'review-wrong-hash1',
      name: 'payment.review.start',
      actorId: financeId,
      sessionId: financeSession,
      aal: 'aal2',
      payload: { paymentRequestId, evidenceId: wrongEvidenceId, evidenceHash: correctEvidenceHash }
    }));
    assert.deepEqual(wrongHashReview.rows[0]?.result, { status: 'denied', reasonCode: 'EXACT_PAYMENT_EVIDENCE_REQUIRED' });

    const wrongReviewId = '84000000-0000-4000-8000-000000000005';
    await database.query(paymentCommandSql({
      commandId: wrongReviewId,
      key: 'review-wrong-00001',
      name: 'payment.review.start',
      actorId: financeId,
      sessionId: financeSession,
      aal: 'aal2',
      payload: { paymentRequestId, evidenceId: wrongEvidenceId, evidenceHash: wrongEvidenceHash }
    }));

    const aal1 = await database.query<{ result: { status: string; reasonCode: string } }>(paymentCommandSql({
      commandId: '84000000-0000-4000-8000-000000000006',
      key: 'verify-aal1-deny1',
      name: 'payment.verify',
      actorId: adminId,
      sessionId: adminSession,
      aal: 'aal1',
      payload: {
        paymentRequestId,
        evidenceId: wrongEvidenceId,
        evidenceHash: wrongEvidenceHash,
        verificationPayload: verificationPayload(wrongEvidenceId, wrongEvidenceHash, 'VERIFY', 'Wrong amount test'),
        verificationHash: rejectionHash
      }
    }));
    assert.deepEqual(aal1.rows[0]?.result, { status: 'denied', reasonCode: 'AAL2_REQUIRED' });

    const amountMismatch = await database.query<{ result: { status: string; reasonCode: string } }>(paymentCommandSql({
      commandId: '84000000-0000-4000-8000-000000000007',
      key: 'verify-wrong-amount',
      name: 'payment.verify',
      actorId: financeId,
      sessionId: financeSession,
      aal: 'aal2',
      payload: {
        paymentRequestId,
        evidenceId: wrongEvidenceId,
        evidenceHash: wrongEvidenceHash,
        verificationPayload: verificationPayload(wrongEvidenceId, wrongEvidenceHash, 'VERIFY', 'Attempt exact verification'),
        verificationHash: rejectionHash
      }
    }));
    assert.deepEqual(amountMismatch.rows[0]?.result, { status: 'denied', reasonCode: 'PAYMENT_AMOUNT_MISMATCH' });

    const rejectionId = '84000000-0000-4000-8000-000000000008';
    const rejection = await database.query<{ result: { paymentStatus: string } }>(paymentCommandSql({
      commandId: rejectionId,
      key: 'reject-wrong-0001',
      name: 'payment.verify',
      actorId: financeId,
      sessionId: financeSession,
      aal: 'aal2',
      payload: {
        paymentRequestId,
        evidenceId: wrongEvidenceId,
        evidenceHash: wrongEvidenceHash,
        verificationPayload: verificationPayload(wrongEvidenceId, wrongEvidenceHash, 'REJECT', 'Amount does not match request'),
        verificationHash: rejectionHash
      }
    }));
    assert.equal(rejection.rows[0]?.result.paymentStatus, 'EVIDENCE_REJECTED');

    const correctEvidenceId = '84000000-0000-4000-8000-000000000009';
    await database.query(paymentCommandSql({
      commandId: correctEvidenceId,
      key: 'correct-evidence-01',
      name: 'payment.evidence.submit',
      actorId: customerA,
      sessionId: customerSession,
      aal: 'aal1',
      payload: {
        paymentRequestId,
        evidencePayload: evidencePayload(505_000),
        evidenceHash: correctEvidenceHash
      }
    }));
    const correctReviewId = '84000000-0000-4000-8000-000000000010';
    await database.query(paymentCommandSql({
      commandId: correctReviewId,
      key: 'review-correct-001',
      name: 'payment.review.start',
      actorId: financeId,
      sessionId: financeSession,
      aal: 'aal2',
      payload: { paymentRequestId, evidenceId: correctEvidenceId, evidenceHash: correctEvidenceHash }
    }));

    const verificationId = '84000000-0000-4000-8000-000000000011';
    const verified = await database.query<{ result: { paymentStatus: string; verificationHash: string } }>(paymentCommandSql({
      commandId: verificationId,
      key: 'verify-correct-001',
      name: 'payment.verify',
      actorId: financeId,
      sessionId: financeSession,
      aal: 'aal2',
      payload: {
        paymentRequestId,
        evidenceId: correctEvidenceId,
        evidenceHash: correctEvidenceHash,
        verificationPayload: verificationPayload(correctEvidenceId, correctEvidenceHash, 'VERIFY', 'Exact bank reference and amount verified'),
        verificationHash
      }
    }));
    assert.equal(verified.rows[0]?.result.paymentStatus, 'VERIFIED');
    assert.equal(verified.rows[0]?.result.verificationHash, verificationHash);

    const adminAllocation = await database.query<{ result: { status: string; reasonCode: string } }>(paymentCommandSql({
      commandId: '84000000-0000-4000-8000-000000000012',
      key: 'admin-allocate-deny',
      name: 'funds.allocate',
      actorId: adminId,
      sessionId: adminSession,
      aal: 'aal2',
      payload: {
        paymentRequestId,
        verificationId,
        verificationHash,
        allocationPayload: {
          schemaVersion: 'funds-allocation-v1', paymentRequestId,
          verificationId, verificationHash, currency: 'AZN', amountMinor: 505_000
        },
        allocationHash
      }
    }));
    assert.deepEqual(adminAllocation.rows[0]?.result, { status: 'denied', reasonCode: 'ALLOCATION_AUTHORITY_REQUIRED' });

    const allocationId = '84000000-0000-4000-8000-000000000013';
    const allocated = await database.query<{ result: { paymentStatus: string; allocationHash: string } }>(paymentCommandSql({
      commandId: allocationId,
      key: 'allocate-correct-01',
      name: 'funds.allocate',
      actorId: financeId,
      sessionId: financeSession,
      aal: 'aal2',
      payload: {
        paymentRequestId,
        verificationId,
        verificationHash,
        allocationPayload: {
          schemaVersion: 'funds-allocation-v1', paymentRequestId,
          verificationId, verificationHash, currency: 'AZN', amountMinor: 505_000
        },
        allocationHash
      }
    }));
    assert.equal(allocated.rows[0]?.result.paymentStatus, 'ALLOCATED');
    assert.equal(allocated.rows[0]?.result.allocationHash, allocationHash);

    const readinessId = '84000000-0000-4000-8000-000000000014';
    const readiness = await database.query<{ result: { paymentStatus: string; readinessResult: string } }>(paymentCommandSql({
      commandId: readinessId,
      key: 'readiness-check-01',
      name: 'payment.evaluate_readiness',
      actorId: financeId,
      sessionId: financeSession,
      aal: 'aal2',
      payload: {
        paymentRequestId,
        allocationId,
        allocationHash,
        readinessInput: {
          schemaVersion: 'financial-readiness-input-v1', paymentRequestId, allocationId, allocationHash
        },
        readinessHash
      }
    }));
    assert.deepEqual(readiness.rows[0]?.result, {
      status: 'accepted',
      commandName: 'payment.evaluate_readiness',
      paymentRequestId,
      paymentStatus: 'READY_FOR_BOOKING',
      quotationId,
      versionNumber: 1,
      quotationHash,
      allocationId,
      allocationHash,
      readinessEvaluationId: readinessId,
      readinessResult: 'READY_FOR_BOOKING',
      workReceiptId: readinessId
    });

    const authorityEvidence = await database.query<{
      status: string;
      evidences: number;
      reviews: number;
      decisions: number;
      allocations: number;
      evaluations: number;
      receipts: number;
      bookings: string | null;
    }>(`
      select p.status,
        (select count(*)::integer from public.payment_evidence_versions where payment_request_id = p.id) as evidences,
        (select count(*)::integer from public.payment_review_events where payment_request_id = p.id) as reviews,
        (select count(*)::integer from public.payment_verification_decisions where payment_request_id = p.id) as decisions,
        (select count(*)::integer from public.fund_allocations where payment_request_id = p.id) as allocations,
        (select count(*)::integer from public.financial_readiness_evaluations where payment_request_id = p.id) as evaluations,
        (select count(*)::integer from public.financial_work_receipts where payment_request_id = p.id) as receipts,
        to_regclass('public.bookings')::text as bookings
      from public.payment_requests p where id = '${paymentRequestId}'
    `);
    assert.deepEqual(authorityEvidence.rows[0], {
      status: 'READY_FOR_BOOKING',
      evidences: 2,
      reviews: 2,
      decisions: 2,
      allocations: 1,
      evaluations: 1,
      receipts: 9,
      bookings: null
    });

    await database.exec('reset role;');
    await assert.rejects(
      database.exec(`update public.payment_evidence_versions set evidence_hash = '${'3'.repeat(64)}' where id = '${correctEvidenceId}'`),
      /append-only/i
    );
    await assert.rejects(
      database.exec(`delete from public.fund_allocations where id = '${allocationId}'`),
      /append-only/i
    );
  } finally {
    await database.close();
  }
});

test('RLS isolates Customer Payment views and keeps internal Finance evidence AAL2-only', async () => {
  const database = await setupDatabase();
  try {
    await database.query(paymentCommandSql({
      commandId: paymentRequestId,
      key: 'rls-payment-create',
      name: 'payment_request.create',
      actorId: financeId,
      sessionId: financeSession,
      aal: 'aal2',
      payload: { quotationId, versionNumber: 1, quotationHash }
    }));
    const evidenceId = '85000000-0000-4000-8000-000000000001';
    await database.query(paymentCommandSql({
      commandId: evidenceId,
      key: 'rls-evidence-0001',
      name: 'payment.evidence.submit',
      actorId: customerA,
      sessionId: customerSession,
      aal: 'aal1',
      payload: {
        paymentRequestId,
        evidencePayload: evidencePayload(505_000),
        evidenceHash: correctEvidenceHash
      }
    }));

    await database.exec(`reset role; set role authenticated; set request.jwt.claim.sub = '${customerA}'; set request.jwt.claims = '{"aal":"aal1"}';`);
    const own = await database.query<{ payments: number; evidence: number; receipts: number }>(`
      select
        (select count(*)::integer from public.payment_requests) as payments,
        (select count(*)::integer from public.payment_evidence_versions) as evidence,
        (select count(*)::integer from public.financial_work_receipts) as receipts
    `);
    assert.deepEqual(own.rows[0], { payments: 1, evidence: 0, receipts: 2 });
    await assert.rejects(database.query('select created_by from public.payment_requests'), /permission denied/i);
    await assert.rejects(
      database.exec(`update public.payment_requests set status = 'VERIFIED' where id = '${paymentRequestId}'`),
      /permission denied/i
    );
    await assert.rejects(
      database.query(paymentCommandSql({
        commandId: '85000000-0000-4000-8000-000000000002',
        key: 'client-rpc-denied1',
        name: 'payment.evidence.submit',
        actorId: customerA,
        sessionId: customerSession,
        aal: 'aal1',
        payload: { paymentRequestId, evidencePayload: evidencePayload(505_000), evidenceHash: correctEvidenceHash }
      })),
      /permission denied/i
    );

    await database.exec(`set request.jwt.claim.sub = '${customerB}';`);
    const other = await database.query<{ count: number }>('select count(*)::integer as count from public.payment_requests');
    assert.equal(other.rows[0]?.count, 0);

    await database.exec(`set request.jwt.claim.sub = '${financeId}'; set request.jwt.claims = '{"aal":"aal1"}';`);
    const financeAal1 = await database.query<{ payments: number; evidence: number }>(`
      select
        (select count(*)::integer from public.payment_requests) as payments,
        (select count(*)::integer from public.payment_evidence_versions) as evidence
    `);
    assert.deepEqual(financeAal1.rows[0], { payments: 0, evidence: 0 });
    await database.exec(`set request.jwt.claims = '{"aal":"aal2"}';`);
    const financeAal2 = await database.query<{ payments: number; evidence: number }>(`
      select
        (select count(*)::integer from public.payment_requests) as payments,
        (select count(*)::integer from public.payment_evidence_versions) as evidence
    `);
    assert.deepEqual(financeAal2.rows[0], { payments: 1, evidence: 1 });
  } finally {
    await database.close();
  }
});
