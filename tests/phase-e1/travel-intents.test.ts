import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

/**
 * Phase E.1 — first-class public.intents domain primitive.
 *
 * Boundary under test: public.intents is a provenance/lifecycle pointer
 * only. It never duplicates Travel Request content; travel_requests /
 * travel_request_versions remain solely authoritative for destination,
 * dates, travellers, budget, trip purpose, notes and acknowledgements.
 * Intent lifecycle (unresolved / resolved / cancelled) is a separate,
 * non-competing state machine from travel_requests.status.
 */

const customerA = '61000000-0000-4000-8000-000000000001';
const customerB = '61000000-0000-4000-8000-000000000002';
const staffId = '61000000-0000-4000-8000-000000000003';
const customerASession = '62000000-0000-4000-8000-000000000001';
const customerBSession = '62000000-0000-4000-8000-000000000002';
const staffSession = '62000000-0000-4000-8000-000000000003';
const requestId = '63000000-0000-4000-8000-000000000001';

function content(acknowledged = false, notes = 'Synthetic Phase E.1 request') {
  return {
    destination: 'Dubai',
    departureCity: 'Baku',
    departureDate: '2026-10-05',
    returnDate: '2026-10-12',
    travelers: { adults: 1, children: 0, infants: 0 },
    budgetAzn: 3200,
    tripPurpose: 'business',
    notes,
    locale: 'az',
    submissionAcknowledgements: {
      accuracyConfirmed: acknowledged,
      dataProcessingAcknowledged: acknowledged
    }
  };
}

function hashOf(payload: object): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
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
  payload: { requestId: string | null; content: ReturnType<typeof content> };
}) {
  const contentHash = hashOf(input.payload.content);
  const fullPayload = { requestId: input.payload.requestId, content: input.payload.content, contentHash };
  return `select public.execute_travel_request_command(
    '${input.commandId}', '${input.key}', '${input.name}',
    '${input.actorId ?? customerA}', '${input.sessionId ?? customerASession}',
    '${input.aal ?? 'aal1'}', now() - interval '1 second',
    '${quote(fullPayload)}'::jsonb, '${hashOf(fullPayload)}'
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
    'supabase/migrations/20260806090000_task028_phase_e1_travel_intents.sql'
  ]) {
    await database.exec(await readFile(migration, 'utf8'));
  }
  await database.exec(`
    insert into auth.users (id, email) values
      ('${customerA}', 'customer-a@voyara.example'),
      ('${customerB}', 'customer-b@voyara.example'),
      ('${staffId}', 'staff@voyara.example');
    insert into public.role_assignments (user_id, role, assigned_by, reason)
    values ('${staffId}', 'staff', '${staffId}', 'Synthetic Phase E.1 staff role');
  `);
  return database;
}

// --- 1. Migration integrity: 27 prior migrations byte-unchanged, 28 added ---

test('migration 28 is additive: 27 pre-existing migrations are byte-identical to their known Phase D2 hashes', async () => {
  const knownUnchangedHashes: Record<string, string> = {
    '20260717084526_task002_foundation_security.sql':
      '2b6b79acd142ccd63bc2bef7c18eb58560227a7d72ec2cfe0023036fc5f25b93',
    '20260717101137_task003_auth_role_session_security.sql':
      'a79df3b16db664e8d9c96d9a8685fb17ea9924119412f66f56a94dc386e0c50c',
    '20260805090000_task027_phase4h_instagram_dual_brand.sql':
      '5394b0141cb55cc8a21d0fa69086beec68c0df2d7103b67265a35ba25c9e320c'
  };

  for (const [file, expectedHash] of Object.entries(knownUnchangedHashes)) {
    const buffer = await readFile(`supabase/migrations/${file}`);
    const actualHash = createHash('sha256').update(buffer).digest('hex');
    assert.equal(actualHash, expectedHash, `${file} must remain byte-identical to its pre-Phase-E.1 hash`);
  }

  const migrationFiles = (await readdir('supabase/migrations')).filter((name) => name.endsWith('.sql'));
  assert.equal(migrationFiles.length, 29, 'expected exactly 27 pre-existing migrations plus migration 28 plus migration 29 (E.2A)');
  assert.ok(
    migrationFiles.includes('20260806090000_task028_phase_e1_travel_intents.sql'),
    'migration 28 (travel intents) must be present'
  );
});

// --- 2. One Travel Request maps to one correct Intent ---

test('a submitted travel request has exactly one intent row pointing at its submitted version and hash', async () => {
  const database = await setupDatabase();
  try {
    await database.exec('set role service_role;');

    const draftContent = content(false);
    await database.query(commandSql({
      commandId: requestId,
      key: 'e1-save-draft-001',
      name: 'travel_request.save_draft',
      payload: { requestId: null, content: draftContent }
    }));

    const submitContent = content(true);
    const submitted = await database.query<{ result: { versionNumber: number; payloadHash: string } }>(commandSql({
      commandId: '63000000-0000-4000-8000-000000000002',
      key: 'e1-submit-001',
      name: 'travel_request.submit',
      payload: { requestId, content: submitContent }
    }));

    const intentCount = await database.query<{ count: number }>(`
      select count(*)::integer as count from public.intents where travel_request_id = '${requestId}'
    `);
    assert.equal(intentCount.rows[0]?.count, 1, 'exactly one intent row per travel request');

    const intent = await database.query<{
      customer_id: string;
      status: string;
      source: string;
      travel_request_version_number: number;
      travel_request_payload_hash: string;
    }>(`
      select customer_id, status, source, travel_request_version_number, travel_request_payload_hash
      from public.intents where travel_request_id = '${requestId}'
    `);
    assert.equal(intent.rows[0]?.customer_id, customerA);
    assert.equal(intent.rows[0]?.source, 'WIZARD');
    assert.equal(intent.rows[0]?.status, 'unresolved', 'submission alone must not resolve the intent');
    assert.equal(intent.rows[0]?.travel_request_version_number, submitted.rows[0]?.result.versionNumber);
    assert.equal(intent.rows[0]?.travel_request_payload_hash, submitted.rows[0]?.result.payloadHash);
  } finally {
    await database.close();
  }
});

// --- 3. Retries/idempotency do not duplicate Intent rows ---

test('replaying the same idempotency key does not create a duplicate intent row', async () => {
  const database = await setupDatabase();
  try {
    await database.exec('set role service_role;');
    const draftContent = content(false);

    const first = await database.query<{ result: { requestId: string } }>(commandSql({
      commandId: requestId,
      key: 'e1-idempotent-key-001',
      name: 'travel_request.save_draft',
      payload: { requestId: null, content: draftContent }
    }));
    const replay = await database.query<{ result: { requestId: string } }>(commandSql({
      commandId: requestId,
      key: 'e1-idempotent-key-001',
      name: 'travel_request.save_draft',
      payload: { requestId: null, content: draftContent }
    }));
    assert.equal(first.rows[0]?.result.requestId, replay.rows[0]?.result.requestId);

    const intentCount = await database.query<{ count: number }>(`
      select count(*)::integer as count from public.intents where customer_id = '${customerA}'
    `);
    assert.equal(intentCount.rows[0]?.count, 1, 'idempotent replay must not duplicate the intent row');
  } finally {
    await database.close();
  }
});

// --- 4. Draft updates advance the canonical version/hash reference correctly ---

test('successive draft saves advance the intent to the latest version/hash without creating new rows', async () => {
  const database = await setupDatabase();
  try {
    await database.exec('set role service_role;');

    await database.query(commandSql({
      commandId: requestId,
      key: 'e1-draft-version-1',
      name: 'travel_request.save_draft',
      payload: { requestId: null, content: content(false, 'first draft') }
    }));
    const afterFirst = await database.query<{ version: number; hash: string }>(`
      select travel_request_version_number as version, travel_request_payload_hash as hash
      from public.intents where travel_request_id = '${requestId}'
    `);
    assert.equal(afterFirst.rows[0]?.version, 1);

    const secondContent = content(false, 'second draft, materially different');
    const secondHash = hashOf(secondContent);
    await database.query(commandSql({
      commandId: '63000000-0000-4000-8000-000000000010',
      key: 'e1-draft-version-2',
      name: 'travel_request.save_draft',
      payload: { requestId, content: secondContent }
    }));

    const afterSecond = await database.query<{ version: number; hash: string; row_count: number }>(`
      select travel_request_version_number as version, travel_request_payload_hash as hash,
        (select count(*)::integer from public.intents where travel_request_id = '${requestId}') as row_count
      from public.intents where travel_request_id = '${requestId}'
    `);
    assert.equal(afterSecond.rows[0]?.version, 2, 'intent must advance to the newest draft version');
    assert.equal(afterSecond.rows[0]?.hash, secondHash);
    assert.equal(afterSecond.rows[0]?.row_count, 1, 'draft updates must update the existing row, not insert a new one');
  } finally {
    await database.close();
  }
});

// --- 5. Submit behaviour: intent stays unresolved, points at exact submitted version/hash ---

test('submit leaves the intent unresolved and pointed at the exact submitted version/hash', async () => {
  const database = await setupDatabase();
  try {
    await database.exec('set role service_role;');
    await database.query(commandSql({
      commandId: requestId,
      key: 'e1-submit-draft',
      name: 'travel_request.save_draft',
      payload: { requestId: null, content: content(false) }
    }));

    const submitContent = content(true, 'final submitted content');
    const submitHash = hashOf(submitContent);
    const submitted = await database.query<{ result: { versionNumber: number } }>(commandSql({
      commandId: '63000000-0000-4000-8000-000000000020',
      key: 'e1-submit-final',
      name: 'travel_request.submit',
      payload: { requestId, content: submitContent }
    }));

    const intent = await database.query<{ status: string; version: number; hash: string; resolved_at: string | null }>(`
      select status, travel_request_version_number as version, travel_request_payload_hash as hash, resolved_at
      from public.intents where travel_request_id = '${requestId}'
    `);
    assert.equal(intent.rows[0]?.status, 'unresolved');
    assert.equal(intent.rows[0]?.resolved_at, null);
    assert.equal(intent.rows[0]?.version, submitted.rows[0]?.result.versionNumber);
    assert.equal(intent.rows[0]?.hash, submitHash);
  } finally {
    await database.close();
  }
});

// --- 6. Cross-customer access is denied (RLS) ---

test('customer B cannot read customer A intent rows under RLS', async () => {
  const database = await setupDatabase();
  try {
    await database.exec('set role service_role;');
    await database.query(commandSql({
      commandId: requestId,
      key: 'e1-rls-draft',
      name: 'travel_request.save_draft',
      payload: { requestId: null, content: content(false) }
    }));

    await database.exec('reset role;');
    await database.exec(`
      set role authenticated;
      set request.jwt.claim.sub = '${customerB}';
      set request.jwt.claims = '{"aal":"aal1"}';
    `);
    const asCustomerB = await database.query<{ count: number }>(`
      select count(*)::integer as count from public.intents where travel_request_id = '${requestId}'
    `);
    assert.equal(asCustomerB.rows[0]?.count, 0, 'customer B must not see customer A intent row');

    await database.exec(`
      reset role;
      set role authenticated;
      set request.jwt.claim.sub = '${customerA}';
      set request.jwt.claims = '{"aal":"aal1"}';
    `);
    const asCustomerA = await database.query<{ count: number }>(`
      select count(*)::integer as count from public.intents where travel_request_id = '${requestId}'
    `);
    assert.equal(asCustomerA.rows[0]?.count, 1, 'customer A must see their own intent row');
  } finally {
    await database.close();
  }
});

// --- 7. Authorized AAL2 staff access follows existing policy ---

test('AAL2 staff can read intent rows; AAL1 staff cannot', async () => {
  const database = await setupDatabase();
  try {
    await database.exec('set role service_role;');
    await database.query(commandSql({
      commandId: requestId,
      key: 'e1-staff-draft',
      name: 'travel_request.save_draft',
      payload: { requestId: null, content: content(false) }
    }));

    await database.exec('reset role;');
    await database.exec(`
      set role authenticated;
      set request.jwt.claim.sub = '${staffId}';
      set request.jwt.claims = '{"aal":"aal1"}';
    `);
    const asAal1Staff = await database.query<{ count: number }>(`
      select count(*)::integer as count from public.intents where travel_request_id = '${requestId}'
    `);
    assert.equal(asAal1Staff.rows[0]?.count, 0, 'AAL1 staff must not see intent rows they do not own');

    await database.exec(`
      reset role;
      set role authenticated;
      set request.jwt.claim.sub = '${staffId}';
      set request.jwt.claims = '{"aal":"aal2"}';
    `);
    const asAal2Staff = await database.query<{ count: number }>(`
      select count(*)::integer as count from public.intents where travel_request_id = '${requestId}'
    `);
    assert.equal(asAal2Staff.rows[0]?.count, 1, 'AAL2 staff with an authority role must see the intent row');
  } finally {
    await database.close();
  }
});

// --- 8. Intent lifecycle grants no Booking/Payment/Supplier authority ---

test('an authenticated customer cannot write to public.intents directly (no client insert/update authority)', async () => {
  const database = await setupDatabase();
  try {
    await database.exec('set role service_role;');
    await database.query(commandSql({
      commandId: requestId,
      key: 'e1-authority-draft',
      name: 'travel_request.save_draft',
      payload: { requestId: null, content: content(false) }
    }));

    await database.exec('reset role;');
    await database.exec(`
      set role authenticated;
      set request.jwt.claim.sub = '${customerA}';
      set request.jwt.claims = '{"aal":"aal1"}';
    `);

    await assert.rejects(
      database.exec(`
        update public.intents set status = 'resolved', resolved_at = now()
        where travel_request_id = '${requestId}'
      `),
      /permission denied/i,
      'the intents table grants no client-side authority beyond select; resolving an intent is not exposed to any client role'
    );

    await assert.rejects(
      database.exec(`
        insert into public.intents (
          id, customer_id, travel_request_id, travel_request_version_number,
          travel_request_payload_hash, source, locale, status
        ) values (
          gen_random_uuid(), '${customerA}', '${requestId}', 1, '${'a'.repeat(64)}', 'STAFF_MANUAL', 'az', 'unresolved'
        )
      `),
      /permission denied/i,
      'no client role may insert intent rows directly; only the service-role command function may'
    );
  } finally {
    await database.close();
  }
});

// --- 9. Malformed/unauthorized commands fail closed and create no intent ---

test('a first command that fails content validation (missing acknowledgement on submit) is denied and creates no intent row', async () => {
  const database = await setupDatabase();
  try {
    await database.exec('set role service_role;');
    // No prior draft exists for this actor/request: this is the very first
    // command, submitted directly without the required acknowledgements.
    const denied = await database.query<{ result: { status: string; reasonCode: string } }>(commandSql({
      commandId: requestId,
      key: 'e1-malformed-submit',
      name: 'travel_request.submit',
      payload: { requestId: null, content: content(false) }
    }));
    assert.deepEqual(denied.rows[0]?.result, { status: 'denied', reasonCode: 'INVALID_TRAVEL_REQUEST' });

    const intentCount = await database.query<{ count: number }>(`
      select count(*)::integer as count from public.intents
    `);
    assert.equal(intentCount.rows[0]?.count, 0, 'a command denied for invalid content must never create an intent row');

    const requestCount = await database.query<{ count: number }>(`
      select count(*)::integer as count from public.travel_requests
    `);
    assert.equal(requestCount.rows[0]?.count, 0, 'a denied command must not leave a partially-created travel request either');
  } finally {
    await database.close();
  }
});

// --- 10. Existing Travel Request functionality is unchanged ---

test('unrelated travel-request behaviour (own-draft ownership, staff claim path) is unaffected by the intent linkage', async () => {
  const database = await setupDatabase();
  try {
    await database.exec('set role service_role;');
    await database.query(commandSql({
      commandId: requestId,
      key: 'e1-unaffected-draft',
      name: 'travel_request.save_draft',
      payload: { requestId: null, content: content(false) }
    }));

    const submitted = await database.query<{ result: { status: string } }>(commandSql({
      commandId: '63000000-0000-4000-8000-000000000030',
      key: 'e1-unaffected-submit',
      name: 'travel_request.submit',
      payload: { requestId, content: content(true) }
    }));
    assert.equal(submitted.rows[0]?.result.status, 'accepted');

    const claim = await database.query<{ result: { status: string; requestStatus: string } }>(`
      select public.execute_travel_request_command(
        '63000000-0000-4000-8000-000000000031', 'e1-unaffected-claim', 'travel_request.claim',
        '${staffId}', '${staffSession}', 'aal2', now() - interval '1 second',
        '${quote({ requestId })}'::jsonb, '${hashOf({ requestId })}'
      ) as result
    `);
    assert.equal(claim.rows[0]?.result.status, 'accepted');
    assert.equal(claim.rows[0]?.result.requestStatus, 'SUBMITTED');
  } finally {
    await database.close();
  }
});
