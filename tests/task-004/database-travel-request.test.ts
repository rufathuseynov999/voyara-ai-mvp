import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const customerA = '51000000-0000-4000-8000-000000000001';
const customerB = '51000000-0000-4000-8000-000000000002';
const staffId = '51000000-0000-4000-8000-000000000003';
const customerSession = '52000000-0000-4000-8000-000000000001';
const staffSession = '52000000-0000-4000-8000-000000000003';
const requestId = '53000000-0000-4000-8000-000000000001';
const contentHash = 'b'.repeat(64);
const commandHash = 'a'.repeat(64);

function content(acknowledged = false, notes = 'Synthetic request') {
  return {
    destination: 'Istanbul',
    departureCity: 'Baku',
    departureDate: '2026-09-10',
    returnDate: '2026-09-17',
    travelers: { adults: 2, children: 0, infants: 0 },
    budgetAzn: 4500,
    tripPurpose: 'leisure',
    notes,
    locale: 'az',
    submissionAcknowledgements: {
      accuracyConfirmed: acknowledged,
      dataProcessingAcknowledged: acknowledged
    }
  };
}

function quote(value: unknown): string {
  return JSON.stringify(value).replaceAll("'", "''");
}

function commandSql(input: {
  commandId: string;
  key: string;
  name: string;
  actorId?: string;
  sessionId?: string;
  aal?: string;
  payload: object;
  hash?: string;
}) {
  return `select public.execute_travel_request_command(
    '${input.commandId}', '${input.key}', '${input.name}',
    '${input.actorId ?? customerA}', '${input.sessionId ?? customerSession}',
    '${input.aal ?? 'aal1'}', now() - interval '1 second',
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
    'supabase/migrations/20260717104504_task004_travel_request_vertical_slice.sql'
  ]) {
    await database.exec(await readFile(migration, 'utf8'));
  }
  await database.exec(`
    insert into auth.users (id, email) values
      ('${customerA}', 'customer-a@voyara.example'),
      ('${customerB}', 'customer-b@voyara.example'),
      ('${staffId}', 'staff@voyara.example');
    insert into public.role_assignments (user_id, role, assigned_by, reason)
    values ('${staffId}', 'staff', '${staffId}', 'Synthetic staff Role');
  `);
  return database;
}

async function createSubmittedRequest(database: PGlite) {
  await database.exec('set role service_role;');
  await database.query(commandSql({
    commandId: requestId,
    key: 'save-draft-000001',
    name: 'travel_request.save_draft',
    payload: { requestId: null, content: content(false), contentHash }
  }));
  return database.query<{ result: { status: string; requestStatus: string; versionNumber: number } }>(commandSql({
    commandId: '53000000-0000-4000-8000-000000000002',
    key: 'submit-request-001',
    name: 'travel_request.submit',
    payload: { requestId, content: content(true), contentHash }
  }));
}

test('draft saves create immutable versions and submission binds one exact version and hash', async () => {
  const database = await setupDatabase();
  try {
    await database.exec('set role service_role;');
    const first = await database.query<{ result: { status: string; requestId: string; versionNumber: number } }>(commandSql({
      commandId: requestId,
      key: 'save-draft-000001',
      name: 'travel_request.save_draft',
      payload: { requestId: null, content: content(false), contentHash }
    }));
    assert.deepEqual(first.rows[0]?.result, {
      status: 'accepted',
      commandName: 'travel_request.save_draft',
      requestId,
      requestStatus: 'DRAFT',
      versionNumber: 1,
      payloadHash: contentHash
    });

    const replay = await database.query<{ result: { versionNumber: number } }>(commandSql({
      commandId: '53000000-0000-4000-8000-000000000099',
      key: 'save-draft-000001',
      name: 'travel_request.save_draft',
      payload: { requestId: null, content: content(false), contentHash }
    }));
    assert.equal(replay.rows[0]?.result.versionNumber, 1);

    const conflict = await database.query<{ result: { status: string; reasonCode: string } }>(commandSql({
      commandId: '53000000-0000-4000-8000-000000000098',
      key: 'save-draft-000001',
      name: 'travel_request.save_draft',
      payload: { requestId, content: content(false, 'Conflicting replay'), contentHash },
      hash: 'd'.repeat(64)
    }));
    assert.deepEqual(conflict.rows[0]?.result, { status: 'denied', reasonCode: 'IDEMPOTENCY_CONFLICT' });

    await database.query(commandSql({
      commandId: '53000000-0000-4000-8000-000000000010',
      key: 'save-draft-000002',
      name: 'travel_request.save_draft',
      payload: { requestId, content: content(false, 'Second immutable version'), contentHash }
    }));

    const missingAcknowledgement = await database.query<{ result: { status: string; reasonCode: string } }>(commandSql({
      commandId: '53000000-0000-4000-8000-000000000097',
      key: 'submit-without-ack1',
      name: 'travel_request.submit',
      payload: { requestId, content: content(false), contentHash }
    }));
    assert.deepEqual(missingAcknowledgement.rows[0]?.result, { status: 'denied', reasonCode: 'INVALID_TRAVEL_REQUEST' });
    const submitted = await database.query<{ result: { status: string; requestStatus: string; versionNumber: number } }>(commandSql({
      commandId: '53000000-0000-4000-8000-000000000011',
      key: 'submit-request-001',
      name: 'travel_request.submit',
      payload: { requestId, content: content(true), contentHash }
    }));
    assert.equal(submitted.rows[0]?.result.requestStatus, 'SUBMITTED');
    assert.equal(submitted.rows[0]?.result.versionNumber, 3);

    const evidence = await database.query<{ versions: number; submissions: number; events: number }>(`
      select
        (select count(*)::integer from public.travel_request_versions where travel_request_id = '${requestId}') as versions,
        (select count(*)::integer from public.travel_request_submissions where travel_request_id = '${requestId}') as submissions,
        (select count(*)::integer from public.travel_request_lifecycle_events where travel_request_id = '${requestId}') as events
    `);
    assert.deepEqual(evidence.rows[0], { versions: 3, submissions: 1, events: 3 });

    const binding = await database.query<{ version_number: number; submission_hash: string; version_hash: string }>(`
      select s.version_number, s.payload_hash as submission_hash, v.payload_hash as version_hash
      from public.travel_request_submissions s
      join public.travel_request_versions v
        on v.travel_request_id = s.travel_request_id and v.version_number = s.version_number
      where s.travel_request_id = '${requestId}'
    `);
    assert.deepEqual(binding.rows[0], { version_number: 3, submission_hash: contentHash, version_hash: contentHash });

    await database.exec('reset role;');
    await assert.rejects(
      database.exec(`update public.travel_request_versions set payload_hash = '${'c'.repeat(64)}' where travel_request_id = '${requestId}'`),
      /append-only/i
    );
    await assert.rejects(
      database.exec(`delete from public.travel_request_submissions where travel_request_id = '${requestId}'`),
      /append-only/i
    );

    await database.exec('set role service_role;');
    const lateSave = await database.query<{ result: { status: string; reasonCode: string } }>(commandSql({
      commandId: '53000000-0000-4000-8000-000000000012',
      key: 'late-save-denied1',
      name: 'travel_request.save_draft',
      payload: { requestId, content: content(false), contentHash }
    }));
    assert.deepEqual(lateSave.rows[0]?.result, { status: 'denied', reasonCode: 'REQUEST_NOT_EDITABLE' });
  } finally {
    await database.close();
  }
});

test('AAL2 staff claim and ordered preparation transitions are enforced', async () => {
  const database = await setupDatabase();
  try {
    await createSubmittedRequest(database);
    const aal1 = await database.query<{ result: { status: string; reasonCode: string } }>(commandSql({
      commandId: '53000000-0000-4000-8000-000000000020',
      key: 'staff-aal1-denied1',
      name: 'travel_request.claim',
      actorId: staffId,
      sessionId: staffSession,
      aal: 'aal1',
      payload: { requestId }
    }));
    assert.deepEqual(aal1.rows[0]?.result, { status: 'denied', reasonCode: 'AAL2_REQUIRED' });

    const claim = await database.query<{ result: { status: string; assignedStaffId: string } }>(commandSql({
      commandId: '53000000-0000-4000-8000-000000000021',
      key: 'staff-claim-00001',
      name: 'travel_request.claim',
      actorId: staffId,
      sessionId: staffSession,
      aal: 'aal2',
      payload: { requestId }
    }));
    assert.equal(claim.rows[0]?.result.assignedStaffId, staffId);

    const earlyReview = await database.query<{ result: { status: string; reasonCode: string } }>(commandSql({
      commandId: '53000000-0000-4000-8000-000000000022',
      key: 'early-review-denied',
      name: 'travel_request.start_human_review',
      actorId: staffId,
      sessionId: staffSession,
      aal: 'aal2',
      payload: { requestId }
    }));
    assert.deepEqual(earlyReview.rows[0]?.result, { status: 'denied', reasonCode: 'INVALID_STATE_TRANSITION' });

    const ai = await database.query<{ result: { requestStatus: string } }>(commandSql({
      commandId: '53000000-0000-4000-8000-000000000023',
      key: 'start-ai-prep-0001',
      name: 'travel_request.start_ai_preparation',
      actorId: staffId,
      sessionId: staffSession,
      aal: 'aal2',
      payload: { requestId }
    }));
    assert.equal(ai.rows[0]?.result.requestStatus, 'AI_PREPARATION');

    const review = await database.query<{ result: { requestStatus: string } }>(commandSql({
      commandId: '53000000-0000-4000-8000-000000000024',
      key: 'start-review-00001',
      name: 'travel_request.start_human_review',
      actorId: staffId,
      sessionId: staffSession,
      aal: 'aal2',
      payload: { requestId }
    }));
    assert.equal(review.rows[0]?.result.requestStatus, 'HUMAN_REVIEW');
  } finally {
    await database.close();
  }
});

test('RLS isolates Customers, permits only AAL2 staff reads and denies client writes or RPC', async () => {
  const database = await setupDatabase();
  try {
    await createSubmittedRequest(database);
    await database.exec(`reset role; set role authenticated; set request.jwt.claim.sub = '${customerA}'; set request.jwt.claims = '{"aal":"aal1"}';`);
    const own = await database.query<{ count: number }>('select count(*)::integer as count from public.travel_requests');
    assert.equal(own.rows[0]?.count, 1);

    await database.exec(`set request.jwt.claim.sub = '${customerB}';`);
    const other = await database.query<{ count: number }>('select count(*)::integer as count from public.travel_requests');
    assert.equal(other.rows[0]?.count, 0);
    await assert.rejects(
      database.exec(`update public.travel_requests set status = 'HUMAN_REVIEW' where id = '${requestId}'`),
      /permission denied/i
    );
    await assert.rejects(database.query('select * from public.travel_request_command_receipts'), /permission denied/i);
    await assert.rejects(
      database.query(commandSql({
        commandId: '53000000-0000-4000-8000-000000000030',
        key: 'client-rpc-denied1',
        name: 'travel_request.save_draft',
        actorId: customerB,
        payload: { requestId: null, content: content(false), contentHash }
      })),
      /permission denied/i
    );

    await database.exec(`set request.jwt.claim.sub = '${staffId}'; set request.jwt.claims = '{"aal":"aal1"}';`);
    const staffAal1 = await database.query<{ count: number }>('select count(*)::integer as count from public.travel_requests');
    assert.equal(staffAal1.rows[0]?.count, 0);
    await database.exec(`set request.jwt.claims = '{"aal":"aal2"}';`);
    const staffAal2 = await database.query<{ count: number }>('select count(*)::integer as count from public.travel_requests');
    assert.equal(staffAal2.rows[0]?.count, 1);
  } finally {
    await database.close();
  }
});
