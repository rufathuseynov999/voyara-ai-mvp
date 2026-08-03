import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const customerA = '71000000-0000-4000-8000-000000000001';
const customerB = '71000000-0000-4000-8000-000000000002';
const staffId = '71000000-0000-4000-8000-000000000003';
const founderId = '71000000-0000-4000-8000-000000000004';
const customerSession = '72000000-0000-4000-8000-000000000001';
const customerBSession = '72000000-0000-4000-8000-000000000002';
const staffSession = '72000000-0000-4000-8000-000000000003';
const founderSession = '72000000-0000-4000-8000-000000000004';
const requestId = '73000000-0000-4000-8000-000000000001';
const quotationId = '74000000-0000-4000-8000-000000000001';
const requestHash = 'b'.repeat(64);
const quotationHash = 'c'.repeat(64);
const revisedHash = 'd'.repeat(64);
const commandHash = 'a'.repeat(64);

function quote(value: unknown): string {
  return JSON.stringify(value).replaceAll("'", "''");
}

function requestContent(acknowledged: boolean) {
  return {
    destination: 'Istanbul',
    departureCity: 'Baku',
    departureDate: '2026-09-10',
    returnDate: '2026-09-17',
    travelers: { adults: 2, children: 0, infants: 0 },
    budgetAzn: 6_000,
    tripPurpose: 'leisure',
    notes: 'Synthetic Task 005 request',
    locale: 'az',
    submissionAcknowledgements: {
      accuracyConfirmed: acknowledged,
      dataProcessingAcknowledged: acknowledged
    }
  };
}

function quotationPayload(hash = quotationHash) {
  return {
    schemaVersion: 'quotation-v1',
    source: {
      travelRequestId: requestId,
      travelRequestVersion: 2,
      travelRequestHash: requestHash
    },
    customer: {
      locale: 'az',
      title: 'İstanbul ailə səfəri',
      summary: 'Uçuş, otel və insan tərəfindən yoxlanılan səyahət şərtləri.',
      currency: 'AZN',
      lineItems: [{
        lineNumber: 1,
        description: hash === quotationHash ? 'Uçuş və otel paketi' : 'Yenilənmiş uçuş və otel paketi',
        quantity: 2,
        unitPriceMinor: 250_000,
        totalMinor: 500_000
      }],
      subtotalMinor: 500_000,
      serviceFeeMinor: 10_000,
      discountMinor: 5_000,
      totalMinor: 505_000,
      validUntil: '2030-12-31T20:00:00.000Z',
      customerNotes: 'Synthetic proposal; no Production Customer data.'
    },
    commercial: {
      costTotalMinor: 400_000,
      grossProfitMinor: 105_000,
      grossMarginBps: 2_079
    },
    riskFlags: ['MANUAL_CONFIRMATION_REQUIRED', 'PRICE_VOLATILITY']
  };
}

function travelCommandSql(input: {
  commandId: string;
  key: string;
  name: string;
  actorId: string;
  sessionId: string;
  aal: 'aal1' | 'aal2';
  payload: object;
}) {
  return `select public.execute_travel_request_command(
    '${input.commandId}', '${input.key}', '${input.name}',
    '${input.actorId}', '${input.sessionId}', '${input.aal}', now() - interval '1 second',
    '${quote(input.payload)}'::jsonb, '${commandHash}'
  ) as result`;
}

function commercialCommandSql(input: {
  commandId: string;
  key: string;
  name: string;
  actorId: string;
  sessionId: string;
  aal: 'aal1' | 'aal2';
  payload: object;
  hash?: string;
}) {
  return `select public.execute_commercial_command(
    '${input.commandId}', '${input.key}', '${input.name}',
    '${input.actorId}', '${input.sessionId}', '${input.aal}', now() - interval '1 second',
    '${quote(input.payload)}'::jsonb, '${input.hash ?? commandHash}'
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
    'supabase/migrations/20260717115718_task005_commercial_approval_vertical_slice.sql'
  ]) {
    await database.exec(await readFile(migration, 'utf8'));
  }
  await database.exec(`
    insert into auth.users (id, email) values
      ('${customerA}', 'customer-a@voyara.example'),
      ('${customerB}', 'customer-b@voyara.example'),
      ('${staffId}', 'staff@voyara.example'),
      ('${founderId}', 'founder@voyara.example');
    insert into public.role_assignments (user_id, role, assigned_by, reason) values
      ('${staffId}', 'staff', '${founderId}', 'Synthetic Task 005 staff'),
      ('${founderId}', 'founder', '${founderId}', 'Synthetic Task 005 Founder');
  `);
  return database;
}

async function prepareHumanReview(database: PGlite) {
  await database.exec('set role service_role;');
  await database.query(travelCommandSql({
    commandId: requestId,
    key: 'commercial-draft-001',
    name: 'travel_request.save_draft',
    actorId: customerA,
    sessionId: customerSession,
    aal: 'aal1',
    payload: { requestId: null, content: requestContent(false), contentHash: requestHash }
  }));
  await database.query(travelCommandSql({
    commandId: '73000000-0000-4000-8000-000000000002',
    key: 'commercial-submit-01',
    name: 'travel_request.submit',
    actorId: customerA,
    sessionId: customerSession,
    aal: 'aal1',
    payload: { requestId, content: requestContent(true), contentHash: requestHash }
  }));
  for (const command of [
    { commandId: '73000000-0000-4000-8000-000000000003', key: 'commercial-claim-001', name: 'travel_request.claim' },
    { commandId: '73000000-0000-4000-8000-000000000004', key: 'commercial-ai-prep1', name: 'travel_request.start_ai_preparation' },
    { commandId: '73000000-0000-4000-8000-000000000005', key: 'commercial-review01', name: 'travel_request.start_human_review' }
  ]) {
    await database.query(travelCommandSql({
      ...command,
      actorId: staffId,
      sessionId: staffSession,
      aal: 'aal2',
      payload: { requestId }
    }));
  }
}

async function createQuotation(database: PGlite, hash = quotationHash) {
  return database.query<{ result: { status: string; quotationStatus: string; versionNumber: number; payloadHash: string } }>(commercialCommandSql({
    commandId: quotationId,
    key: 'quotation-version-001',
    name: 'quotation.create_version',
    actorId: staffId,
    sessionId: staffSession,
    aal: 'aal2',
    payload: {
      travelRequestId: requestId,
      quotationId: null,
      canonicalPayload: quotationPayload(hash),
      quotationHash: hash
    }
  }));
}

async function submitQuotation(database: PGlite, versionNumber = 1, hash = quotationHash, key = 'quotation-submit-001') {
  return database.query<{ result: { status: string; quotationStatus: string } }>(commercialCommandSql({
    commandId: versionNumber === 1 ? '74000000-0000-4000-8000-000000000002' : '74000000-0000-4000-8000-000000000012',
    key,
    name: 'quotation.submit_for_approval',
    actorId: staffId,
    sessionId: staffSession,
    aal: 'aal2',
    payload: { quotationId, versionNumber, quotationHash: hash }
  }));
}

test('exact Founder Approval, publication and Customer Acceptance preserve one hash chain', async () => {
  const database = await setupDatabase();
  try {
    await prepareHumanReview(database);
    const created = await createQuotation(database);
    assert.deepEqual(created.rows[0]?.result, {
      status: 'accepted',
      commandName: 'quotation.create_version',
      quotationId,
      quotationStatus: 'DRAFT',
      versionNumber: 1,
      payloadHash: quotationHash,
      workReceiptId: quotationId
    });
    const replay = await createQuotation(database);
    assert.equal(replay.rows[0]?.result.versionNumber, 1);

    const submitted = await submitQuotation(database);
    assert.equal(submitted.rows[0]?.result.quotationStatus, 'PENDING_APPROVAL');

    const staffDecision = await database.query<{ result: { status: string; reasonCode: string } }>(commercialCommandSql({
      commandId: '74000000-0000-4000-8000-000000000003',
      key: 'staff-decision-deny',
      name: 'quotation.decide',
      actorId: staffId,
      sessionId: staffSession,
      aal: 'aal2',
      payload: { quotationId, versionNumber: 1, quotationHash, decision: 'APPROVE', reason: 'Looks correct' }
    }));
    assert.deepEqual(staffDecision.rows[0]?.result, { status: 'denied', reasonCode: 'FOUNDER_REQUIRED' });

    const aal1Decision = await database.query<{ result: { status: string; reasonCode: string } }>(commercialCommandSql({
      commandId: '74000000-0000-4000-8000-000000000004',
      key: 'founder-aal1-deny1',
      name: 'quotation.decide',
      actorId: founderId,
      sessionId: founderSession,
      aal: 'aal1',
      payload: { quotationId, versionNumber: 1, quotationHash, decision: 'APPROVE', reason: 'Looks correct' }
    }));
    assert.deepEqual(aal1Decision.rows[0]?.result, { status: 'denied', reasonCode: 'AAL2_REQUIRED' });

    const hashMismatch = await database.query<{ result: { status: string; reasonCode: string } }>(commercialCommandSql({
      commandId: '74000000-0000-4000-8000-000000000005',
      key: 'founder-hash-denied',
      name: 'quotation.decide',
      actorId: founderId,
      sessionId: founderSession,
      aal: 'aal2',
      payload: { quotationId, versionNumber: 1, quotationHash: revisedHash, decision: 'APPROVE', reason: 'Wrong hash' }
    }));
    assert.deepEqual(hashMismatch.rows[0]?.result, { status: 'denied', reasonCode: 'QUOTATION_HASH_MISMATCH' });

    const approval = await database.query<{ result: { quotationStatus: string; payloadHash: string } }>(commercialCommandSql({
      commandId: '74000000-0000-4000-8000-000000000006',
      key: 'founder-approval-001',
      name: 'quotation.decide',
      actorId: founderId,
      sessionId: founderSession,
      aal: 'aal2',
      payload: { quotationId, versionNumber: 1, quotationHash, decision: 'APPROVE', reason: 'Commercial terms verified' }
    }));
    assert.equal(approval.rows[0]?.result.quotationStatus, 'APPROVED');
    assert.equal(approval.rows[0]?.result.payloadHash, quotationHash);

    const editAfterApproval = await database.query<{ result: { status: string; reasonCode: string } }>(commercialCommandSql({
      commandId: '74000000-0000-4000-8000-000000000007',
      key: 'edit-approved-denied',
      name: 'quotation.create_version',
      actorId: staffId,
      sessionId: staffSession,
      aal: 'aal2',
      payload: { travelRequestId: requestId, quotationId, canonicalPayload: quotationPayload(revisedHash), quotationHash: revisedHash }
    }));
    assert.deepEqual(editAfterApproval.rows[0]?.result, { status: 'denied', reasonCode: 'QUOTATION_NOT_EDITABLE' });

    const publication = await database.query<{ result: { quotationStatus: string; payloadHash: string } }>(commercialCommandSql({
      commandId: '74000000-0000-4000-8000-000000000008',
      key: 'founder-publish-001',
      name: 'quotation.publish',
      actorId: founderId,
      sessionId: founderSession,
      aal: 'aal2',
      payload: { quotationId, versionNumber: 1, quotationHash }
    }));
    assert.equal(publication.rows[0]?.result.quotationStatus, 'PUBLISHED');
    assert.equal(publication.rows[0]?.result.payloadHash, quotationHash);

    const viewingOnly = await database.query<{ published: number; acceptances: number }>(`
      select
        (select count(*)::integer from public.published_proposals where quotation_id = '${quotationId}') as published,
        (select count(*)::integer from public.customer_quotation_acceptances where quotation_id = '${quotationId}') as acceptances
    `);
    assert.deepEqual(viewingOnly.rows[0], { published: 1, acceptances: 0 });

    const otherCustomer = await database.query<{ result: { status: string; reasonCode: string } }>(commercialCommandSql({
      commandId: '74000000-0000-4000-8000-000000000009',
      key: 'other-customer-deny',
      name: 'quotation.accept',
      actorId: customerB,
      sessionId: customerBSession,
      aal: 'aal1',
      payload: { quotationId, versionNumber: 1, quotationHash, locale: 'az', acceptanceConfirmed: true }
    }));
    assert.deepEqual(otherCustomer.rows[0]?.result, { status: 'denied', reasonCode: 'CUSTOMER_OWNERSHIP_REQUIRED' });

    const wrongLocale = await database.query<{ result: { status: string; reasonCode: string } }>(commercialCommandSql({
      commandId: '74000000-0000-4000-8000-000000000010',
      key: 'wrong-locale-denied1',
      name: 'quotation.accept',
      actorId: customerA,
      sessionId: customerSession,
      aal: 'aal1',
      payload: { quotationId, versionNumber: 1, quotationHash, locale: 'en', acceptanceConfirmed: true }
    }));
    assert.deepEqual(wrongLocale.rows[0]?.result, { status: 'denied', reasonCode: 'EXACT_ACCEPTANCE_CONFIRMATION_REQUIRED' });

    const acceptance = await database.query<{ result: { quotationStatus: string; payloadHash: string } }>(commercialCommandSql({
      commandId: '74000000-0000-4000-8000-000000000011',
      key: 'customer-accept-0001',
      name: 'quotation.accept',
      actorId: customerA,
      sessionId: customerSession,
      aal: 'aal1',
      payload: { quotationId, versionNumber: 1, quotationHash, locale: 'az', acceptanceConfirmed: true }
    }));
    assert.equal(acceptance.rows[0]?.result.quotationStatus, 'ACCEPTED');
    assert.equal(acceptance.rows[0]?.result.payloadHash, quotationHash);

    const chain = await database.query<{
      version_hash: string;
      approved_hash: string;
      published_hash: string;
      acceptance_hash: string;
      receipt_count: number;
    }>(`
      select
        v.payload_hash as version_hash,
        q.approved_hash,
        p.payload_hash as published_hash,
        a.payload_hash as acceptance_hash,
        (select count(*)::integer from public.commercial_work_receipts where quotation_id = q.id) as receipt_count
      from public.commercial_quotations q
      join public.quotation_versions v on v.quotation_id = q.id and v.version_number = q.current_version
      join public.published_proposals p on p.quotation_id = q.id
      join public.customer_quotation_acceptances a on a.quotation_id = q.id
      where q.id = '${quotationId}'
    `);
    assert.deepEqual(chain.rows[0], {
      version_hash: quotationHash,
      approved_hash: quotationHash,
      published_hash: quotationHash,
      acceptance_hash: quotationHash,
      receipt_count: 5
    });

    await database.exec('reset role;');
    await assert.rejects(
      database.exec(`update public.quotation_versions set payload_hash = '${revisedHash}' where quotation_id = '${quotationId}'`),
      /append-only/i
    );
    await assert.rejects(
      database.exec(`delete from public.customer_quotation_acceptances where quotation_id = '${quotationId}'`),
      /append-only/i
    );
  } finally {
    await database.close();
  }
});

test('rejection requires a new version and preserves both decisions', async () => {
  const database = await setupDatabase();
  try {
    await prepareHumanReview(database);
    await createQuotation(database);
    await submitQuotation(database);
    const rejection = await database.query<{ result: { quotationStatus: string } }>(commercialCommandSql({
      commandId: '75000000-0000-4000-8000-000000000001',
      key: 'founder-reject-0001',
      name: 'quotation.decide',
      actorId: founderId,
      sessionId: founderSession,
      aal: 'aal2',
      payload: { quotationId, versionNumber: 1, quotationHash, decision: 'REJECT', reason: 'Margin requires revision' }
    }));
    assert.equal(rejection.rows[0]?.result.quotationStatus, 'REJECTED');

    const revision = await database.query<{ result: { quotationStatus: string; versionNumber: number } }>(commercialCommandSql({
      commandId: '75000000-0000-4000-8000-000000000002',
      key: 'quotation-version-002',
      name: 'quotation.create_version',
      actorId: staffId,
      sessionId: staffSession,
      aal: 'aal2',
      payload: { travelRequestId: requestId, quotationId, canonicalPayload: quotationPayload(revisedHash), quotationHash: revisedHash }
    }));
    assert.equal(revision.rows[0]?.result.quotationStatus, 'DRAFT');
    assert.equal(revision.rows[0]?.result.versionNumber, 2);
    await submitQuotation(database, 2, revisedHash, 'quotation-submit-002');
    await database.query(commercialCommandSql({
      commandId: '75000000-0000-4000-8000-000000000003',
      key: 'founder-approval-002',
      name: 'quotation.decide',
      actorId: founderId,
      sessionId: founderSession,
      aal: 'aal2',
      payload: { quotationId, versionNumber: 2, quotationHash: revisedHash, decision: 'APPROVE', reason: 'Revised terms verified' }
    }));

    const history = await database.query<{ versions: number; decisions: number; current_version: number; approved_hash: string }>(`
      select
        (select count(*)::integer from public.quotation_versions where quotation_id = q.id) as versions,
        (select count(*)::integer from public.commercial_approval_decisions where quotation_id = q.id) as decisions,
        q.current_version,
        q.approved_hash
      from public.commercial_quotations q where q.id = '${quotationId}'
    `);
    assert.deepEqual(history.rows[0], { versions: 2, decisions: 2, current_version: 2, approved_hash: revisedHash });
  } finally {
    await database.close();
  }
});

test('RLS isolates Customer proposals and requires AAL2 for internal commercial records', async () => {
  const database = await setupDatabase();
  try {
    await prepareHumanReview(database);
    await createQuotation(database);
    await submitQuotation(database);
    await database.query(commercialCommandSql({
      commandId: '76000000-0000-4000-8000-000000000001',
      key: 'rls-founder-approve',
      name: 'quotation.decide',
      actorId: founderId,
      sessionId: founderSession,
      aal: 'aal2',
      payload: { quotationId, versionNumber: 1, quotationHash, decision: 'APPROVE', reason: 'RLS fixture approval' }
    }));
    await database.query(commercialCommandSql({
      commandId: '76000000-0000-4000-8000-000000000002',
      key: 'rls-founder-publish',
      name: 'quotation.publish',
      actorId: founderId,
      sessionId: founderSession,
      aal: 'aal2',
      payload: { quotationId, versionNumber: 1, quotationHash }
    }));

    await database.exec(`reset role; set role authenticated; set request.jwt.claim.sub = '${customerA}'; set request.jwt.claims = '{"aal":"aal1"}';`);
    const own = await database.query<{ proposals: number; quotations: number; internal_versions: number; decisions: number; safe_receipts: number }>(`
      select
        (select count(*)::integer from public.published_proposals) as proposals,
        (select count(*)::integer from public.commercial_quotations) as quotations,
        (select count(*)::integer from public.quotation_versions) as internal_versions,
        (select count(*)::integer from public.commercial_approval_decisions) as decisions,
        (select count(*)::integer from public.commercial_work_receipts) as safe_receipts
    `);
    assert.deepEqual(own.rows[0], { proposals: 1, quotations: 0, internal_versions: 0, decisions: 0, safe_receipts: 1 });
    await assert.rejects(
      database.query('select published_by from public.published_proposals'),
      /permission denied/i
    );
    await assert.rejects(
      database.query('select actor_session_id from public.published_proposals'),
      /permission denied/i
    );

    await database.exec(`set request.jwt.claim.sub = '${customerB}';`);
    const other = await database.query<{ proposals: number; quotations: number }>(`
      select
        (select count(*)::integer from public.published_proposals) as proposals,
        (select count(*)::integer from public.commercial_quotations) as quotations
    `);
    assert.deepEqual(other.rows[0], { proposals: 0, quotations: 0 });
    await assert.rejects(
      database.exec(`update public.commercial_quotations set status = 'ACCEPTED' where id = '${quotationId}'`),
      /permission denied/i
    );
    await assert.rejects(
      database.query(commercialCommandSql({
        commandId: '76000000-0000-4000-8000-000000000003',
        key: 'client-rpc-denied1',
        name: 'quotation.accept',
        actorId: customerB,
        sessionId: customerBSession,
        aal: 'aal1',
        payload: { quotationId, versionNumber: 1, quotationHash, locale: 'az', acceptanceConfirmed: true }
      })),
      /permission denied/i
    );

    await database.exec(`set request.jwt.claim.sub = '${staffId}'; set request.jwt.claims = '{"aal":"aal1"}';`);
    const aal1 = await database.query<{ quotations: number; versions: number }>(`
      select
        (select count(*)::integer from public.commercial_quotations) as quotations,
        (select count(*)::integer from public.quotation_versions) as versions
    `);
    assert.deepEqual(aal1.rows[0], { quotations: 0, versions: 0 });
    await database.exec(`set request.jwt.claims = '{"aal":"aal2"}';`);
    const aal2 = await database.query<{ quotations: number; versions: number }>(`
      select
        (select count(*)::integer from public.commercial_quotations) as quotations,
        (select count(*)::integer from public.quotation_versions) as versions
    `);
    assert.deepEqual(aal2.rows[0], { quotations: 1, versions: 1 });
  } finally {
    await database.close();
  }
});
