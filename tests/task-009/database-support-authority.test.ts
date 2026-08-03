import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const customerA = 'c1000000-0000-4000-8000-000000000001';
const customerB = 'c1000000-0000-4000-8000-000000000002';
const staffA = 'c1000000-0000-4000-8000-000000000003';
const staffB = 'c1000000-0000-4000-8000-000000000004';
const manager = 'c1000000-0000-4000-8000-000000000005';
const founder = 'c1000000-0000-4000-8000-000000000006';
const customerSession = 'c2000000-0000-4000-8000-000000000001';
const customerBSession = 'c2000000-0000-4000-8000-000000000002';
const staffSession = 'c2000000-0000-4000-8000-000000000003';
const staffBSession = 'c2000000-0000-4000-8000-000000000004';
const managerSession = 'c2000000-0000-4000-8000-000000000005';
const bookingId = 'c3000000-0000-4000-8000-000000000001';
const voucherId = 'c3000000-0000-4000-8000-000000000002';
const caseId = 'c4000000-0000-4000-8000-000000000001';
const voucherHash = '7'.repeat(64);
const caseHash = 'a'.repeat(64);
const commandHash = '9'.repeat(64);

function quote(value: unknown): string {
  return JSON.stringify(value).replaceAll("'", "''");
}

function supportSql(input: {
  commandId: string;
  key: string;
  name: string;
  actorId: string;
  sessionId: string;
  aal: 'aal1' | 'aal2';
  payload: object;
}) {
  return `select public.execute_support_command(
    '${input.commandId}', '${input.key}', '${input.name}',
    '${input.actorId}', '${input.sessionId}', '${input.aal}', now() - interval '1 second',
    '${quote(input.payload)}'::jsonb, '${commandHash}'
  ) as result`;
}

function eventPayload(input: {
  eventSequence: number;
  previousEventHash: string;
  eventType: string;
  visibility: 'CUSTOMER' | 'INTERNAL';
  message: string;
  nextStatus?: string;
  priority?: string;
  escalationLevel?: string;
}) {
  return {
    caseId,
    eventPayload: {
      schemaVersion: 'support-case-event-v1',
      caseId,
      caseAuthorityHash: caseHash,
      eventSequence: input.eventSequence,
      previousEventHash: input.previousEventHash,
      eventType: input.eventType,
      visibility: input.visibility,
      message: input.message,
      nextStatus: input.nextStatus ?? '',
      priority: input.priority ?? '',
      escalationLevel: input.escalationLevel ?? '',
      financialAuthorityUnaffected: true
    }
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
  for (const migration of (await readdir('supabase/migrations')).filter((name) => name.endsWith('.sql')).sort()) {
    await database.exec(await readFile(`supabase/migrations/${migration}`, 'utf8'));
  }
  await database.exec(`
    insert into auth.users (id, email) values
      ('${customerA}', 'customer-a@voyara.example'),
      ('${customerB}', 'customer-b@voyara.example'),
      ('${staffA}', 'staff-a@voyara.example'),
      ('${staffB}', 'staff-b@voyara.example'),
      ('${manager}', 'manager@voyara.example'),
      ('${founder}', 'founder@voyara.example');
    insert into public.role_assignments (user_id, role, assigned_by, reason) values
      ('${staffA}', 'staff', '${founder}', 'Synthetic Task 009 Staff A'),
      ('${staffB}', 'staff', '${founder}', 'Synthetic Task 009 Staff B'),
      ('${manager}', 'manager', '${founder}', 'Synthetic Task 009 Manager'),
      ('${founder}', 'founder', '${founder}', 'Synthetic Task 009 Founder');

    set session_replication_role = replica;
    insert into public.bookings (
      id, payment_request_id, readiness_evaluation_id, readiness_evaluation_hash,
      acceptance_id, quotation_id, quotation_version, quotation_hash,
      customer_id, locale, currency, amount_minor, status,
      canonical_authority_payload, booking_authority_hash,
      current_execution_id, current_execution_hash,
      supplier_confirmation_id, supplier_confirmation_hash,
      created_by, actor_session_id, actor_aal,
      supplier_executed_at, supplier_confirmed_at,
      current_verification_review_id, current_verification_id, current_verification_hash,
      voucher_id, voucher_version, voucher_hash,
      verification_started_at, verified_at, voucher_issued_at
    ) values (
      '${bookingId}', 'c5000000-0000-4000-8000-000000000001',
      'c5000000-0000-4000-8000-000000000002', '${'1'.repeat(64)}',
      'c5000000-0000-4000-8000-000000000003',
      'c5000000-0000-4000-8000-000000000004', 1, '${'2'.repeat(64)}',
      '${customerA}', 'az', 'AZN', 505000, 'VOUCHER_ISSUED',
      '{}'::jsonb, '${'3'.repeat(64)}',
      'c5000000-0000-4000-8000-000000000005', '${'4'.repeat(64)}',
      'c5000000-0000-4000-8000-000000000006', '${'5'.repeat(64)}',
      '${manager}', '${managerSession}', 'aal2',
      now(), now(),
      'c5000000-0000-4000-8000-000000000007',
      'c5000000-0000-4000-8000-000000000008', '${'6'.repeat(64)}',
      '${voucherId}', 1, '${voucherHash}', now(), now(), now()
    );
    insert into public.vouchers (
      id, booking_id, customer_id, locale, status, current_version,
      current_hash, issued_version, issued_hash, issued_at
    ) values (
      '${voucherId}', '${bookingId}', '${customerA}', 'az', 'ISSUED', 1,
      '${voucherHash}', 1, '${voucherHash}', now()
    );
    insert into public.voucher_versions (
      voucher_id, version_number, booking_id, booking_authority_hash,
      customer_id, verification_id, verification_hash,
      execution_id, execution_hash, supplier_confirmation_id,
      supplier_confirmation_version, supplier_confirmation_hash,
      quotation_id, quotation_version, quotation_hash, locale,
      canonical_payload, voucher_hash, preparation_source,
      created_by, actor_session_id, actor_aal
    ) values (
      '${voucherId}', 1, '${bookingId}', '${'3'.repeat(64)}',
      '${customerA}', 'c5000000-0000-4000-8000-000000000008', '${'6'.repeat(64)}',
      'c5000000-0000-4000-8000-000000000005', '${'4'.repeat(64)}',
      'c5000000-0000-4000-8000-000000000006', 1, '${'5'.repeat(64)}',
      'c5000000-0000-4000-8000-000000000004', 1, '${'2'.repeat(64)}', 'az',
      '{}'::jsonb, '${voucherHash}', 'HUMAN', '${manager}', '${managerSession}', 'aal2'
    );
    set session_replication_role = origin;
    set role service_role;
  `);
  return database;
}

async function command(database: PGlite, input: Parameters<typeof supportSql>[0]) {
  const result = await database.query<{ result: { status: string; reasonCode?: string } }>(supportSql(input));
  return result.rows[0].result;
}

test('PostgreSQL enforces exact Voucher ownership, human ownership, visibility, chain and terminal states', async () => {
  const database = await setupDatabase();
  try {
    const openPayload = {
      caseId,
      bookingId,
      voucherId,
      voucherVersion: 1,
      voucherHash,
      casePayload: {
        schemaVersion: 'support-case-open-v1',
        caseId,
        bookingId,
        voucherId,
        voucherVersion: 1,
        voucherHash,
        customerId: customerA,
        locale: 'az',
        category: 'TRAVEL_DISRUPTION',
        urgency: 'URGENT',
        subject: 'Synthetic flight disruption',
        message: 'Synthetic flight timing changed and requires human Support.',
        declarationConfirmed: true
      },
      caseAuthorityHash: caseHash
    };

    assert.deepEqual(await command(database, {
      commandId: 'c4000000-0000-4000-8000-000000000080', key: 'task009-owner-denial',
      name: 'support.case.open', actorId: customerB, sessionId: customerBSession, aal: 'aal1',
      payload: { ...openPayload, caseId: 'c4000000-0000-4000-8000-000000000080' }
    }), { status: 'denied', reasonCode: 'EXACT_ISSUED_VOUCHER_REQUIRED' });

    assert.deepEqual(await command(database, {
      commandId: 'c4000000-0000-4000-8000-000000000081', key: 'task009-hash-denial',
      name: 'support.case.open', actorId: customerA, sessionId: customerSession, aal: 'aal1',
      payload: { ...openPayload, caseId: 'c4000000-0000-4000-8000-000000000081', voucherHash: '8'.repeat(64) }
    }), { status: 'denied', reasonCode: 'EXACT_ISSUED_VOUCHER_REQUIRED' });

    assert.equal((await command(database, {
      commandId: caseId, key: 'task009-open-accepted', name: 'support.case.open',
      actorId: customerA, sessionId: customerSession, aal: 'aal1', payload: openPayload
    })).status, 'accepted');

    const duplicateCaseId = 'c4000000-0000-4000-8000-000000000085';
    assert.deepEqual(await command(database, {
      commandId: duplicateCaseId, key: 'task009-active-case-denial',
      name: 'support.case.open', actorId: customerA, sessionId: customerSession, aal: 'aal1',
      payload: {
        ...openPayload,
        caseId: duplicateCaseId,
        casePayload: { ...openPayload.casePayload, caseId: duplicateCaseId }
      }
    }), { status: 'denied', reasonCode: 'ACTIVE_SUPPORT_CASE_EXISTS' });

    assert.equal((await command(database, {
      commandId: 'c4000000-0000-4000-8000-000000000002', key: 'task009-customer-message',
      name: 'support.case.message', actorId: customerA, sessionId: customerSession, aal: 'aal1',
      payload: { ...eventPayload({
        eventSequence: 2, previousEventHash: caseHash, eventType: 'CUSTOMER_MESSAGE',
        visibility: 'CUSTOMER', message: 'Please confirm the next accountable human action.'
      }), eventHash: 'b'.repeat(64) }
    })).status, 'accepted');

    assert.deepEqual(await command(database, {
      commandId: 'c4000000-0000-4000-8000-000000000082', key: 'task009-aal1-denial',
      name: 'support.case.claim', actorId: staffA, sessionId: staffSession, aal: 'aal1',
      payload: { ...eventPayload({
        eventSequence: 3, previousEventHash: 'b'.repeat(64), eventType: 'CASE_CLAIMED',
        visibility: 'INTERNAL', message: 'Case claimed by accountable human operations.'
      }), eventHash: 'c'.repeat(64) }
    }), { status: 'denied', reasonCode: 'AAL2_REQUIRED' });

    assert.equal((await command(database, {
      commandId: 'c4000000-0000-4000-8000-000000000003', key: 'task009-claim-accepted',
      name: 'support.case.claim', actorId: staffA, sessionId: staffSession, aal: 'aal2',
      payload: { ...eventPayload({
        eventSequence: 3, previousEventHash: 'b'.repeat(64), eventType: 'CASE_CLAIMED',
        visibility: 'INTERNAL', message: 'Case claimed by accountable human operations.'
      }), eventHash: 'c'.repeat(64) }
    })).status, 'accepted');

    assert.deepEqual(await command(database, {
      commandId: 'c4000000-0000-4000-8000-000000000083', key: 'task009-owner-required',
      name: 'support.case.internal_note', actorId: staffB, sessionId: staffBSession, aal: 'aal2',
      payload: { ...eventPayload({
        eventSequence: 4, previousEventHash: 'c'.repeat(64), eventType: 'INTERNAL_NOTE',
        visibility: 'INTERNAL', message: 'Unowned synthetic note must be denied.'
      }), eventHash: 'd'.repeat(64) }
    }), { status: 'denied', reasonCode: 'CASE_OWNER_REQUIRED' });

    assert.equal((await command(database, {
      commandId: 'c4000000-0000-4000-8000-000000000004', key: 'task009-priority',
      name: 'support.case.priority.set', actorId: manager, sessionId: managerSession, aal: 'aal2',
      payload: { ...eventPayload({
        eventSequence: 4, previousEventHash: 'c'.repeat(64), eventType: 'PRIORITY_CHANGED',
        visibility: 'INTERNAL', message: 'Critical active travel disruption requires immediate response.',
        priority: 'P1_CRITICAL'
      }), eventHash: 'd'.repeat(64) }
    })).status, 'accepted');

    assert.equal((await command(database, {
      commandId: 'c4000000-0000-4000-8000-000000000005', key: 'task009-escalate',
      name: 'support.case.escalate', actorId: staffA, sessionId: staffSession, aal: 'aal2',
      payload: { ...eventPayload({
        eventSequence: 5, previousEventHash: 'd'.repeat(64), eventType: 'CASE_ESCALATED',
        visibility: 'INTERNAL', message: 'Manager visibility requested for critical disruption.',
        escalationLevel: 'MANAGER'
      }), eventHash: 'e'.repeat(64) }
    })).status, 'accepted');

    assert.equal((await command(database, {
      commandId: 'c4000000-0000-4000-8000-000000000006', key: 'task009-internal-note',
      name: 'support.case.internal_note', actorId: staffA, sessionId: staffSession, aal: 'aal2',
      payload: { ...eventPayload({
        eventSequence: 6, previousEventHash: 'e'.repeat(64), eventType: 'INTERNAL_NOTE',
        visibility: 'INTERNAL', message: 'Synthetic Supplier evidence is internal and Customer-hidden.'
      }), eventHash: 'f'.repeat(64) }
    })).status, 'accepted');

    assert.equal((await command(database, {
      commandId: 'c4000000-0000-4000-8000-000000000007', key: 'task009-customer-update',
      name: 'support.case.customer_update', actorId: staffA, sessionId: staffSession, aal: 'aal2',
      payload: { ...eventPayload({
        eventSequence: 7, previousEventHash: 'f'.repeat(64), eventType: 'CUSTOMER_UPDATE',
        visibility: 'CUSTOMER', message: 'VOYARA operations is checking the exact issued travel service.',
        nextStatus: 'IN_PROGRESS'
      }), eventHash: '1'.repeat(64) }
    })).status, 'accepted');

    assert.equal((await command(database, {
      commandId: 'c4000000-0000-4000-8000-000000000008', key: 'task009-resolve',
      name: 'support.case.resolve', actorId: staffA, sessionId: staffSession, aal: 'aal2',
      payload: { ...eventPayload({
        eventSequence: 8, previousEventHash: '1'.repeat(64), eventType: 'CASE_RESOLVED',
        visibility: 'CUSTOMER', message: 'The updated synthetic service timing was confirmed to the Customer.',
        nextStatus: 'RESOLVED'
      }), eventHash: '2'.repeat(64) }
    })).status, 'accepted');

    assert.deepEqual(await command(database, {
      commandId: 'c4000000-0000-4000-8000-000000000084', key: 'task009-message-after-resolve',
      name: 'support.case.message', actorId: customerA, sessionId: customerSession, aal: 'aal1',
      payload: { ...eventPayload({
        eventSequence: 9, previousEventHash: '2'.repeat(64), eventType: 'CUSTOMER_MESSAGE',
        visibility: 'CUSTOMER', message: 'This message must not reopen a resolved case.'
      }), eventHash: '3'.repeat(64) }
    }), { status: 'denied', reasonCode: 'INVALID_SUPPORT_CASE_STATE' });

    assert.equal((await command(database, {
      commandId: 'c4000000-0000-4000-8000-000000000009', key: 'task009-close',
      name: 'support.case.close', actorId: staffA, sessionId: staffSession, aal: 'aal2',
      payload: { ...eventPayload({
        eventSequence: 9, previousEventHash: '2'.repeat(64), eventType: 'CASE_CLOSED',
        visibility: 'CUSTOMER', message: 'The resolved synthetic Support case is now closed.',
        nextStatus: 'CLOSED'
      }), eventHash: '3'.repeat(64) }
    })).status, 'accepted');

    const finalState = await database.query<{
      status: string; priority: string; escalation_level: string; owner_id: string;
    }>(`select status, priority, escalation_level, owner_id from public.support_cases where id = '${caseId}'`);
    assert.deepEqual(finalState.rows[0], {
      status: 'CLOSED', priority: 'P1_CRITICAL', escalation_level: 'MANAGER', owner_id: staffA
    });

    await database.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${customerA}', false); select set_config('request.jwt.claims', '{"sub":"${customerA}","aal":"aal1"}', false);`);
    assert.equal((await database.query<{ count: string }>('select count(*)::text as count from public.support_cases')).rows[0].count, '1');
    assert.equal((await database.query<{ count: string }>('select count(*)::text as count from public.support_case_events')).rows[0].count, '5');

    await database.exec(`select set_config('request.jwt.claim.sub', '${customerB}', false); select set_config('request.jwt.claims', '{"sub":"${customerB}","aal":"aal1"}', false);`);
    assert.equal((await database.query<{ count: string }>('select count(*)::text as count from public.support_cases')).rows[0].count, '0');

    await database.exec(`select set_config('request.jwt.claim.sub', '${staffA}', false); select set_config('request.jwt.claims', '{"sub":"${staffA}","aal":"aal1"}', false);`);
    assert.equal((await database.query<{ count: string }>('select count(*)::text as count from public.support_cases')).rows[0].count, '0');

    await database.exec(`select set_config('request.jwt.claims', '{"sub":"${staffA}","aal":"aal2"}', false);`);
    assert.equal((await database.query<{ count: string }>('select count(*)::text as count from public.support_cases')).rows[0].count, '1');
    assert.equal((await database.query<{ count: string }>('select count(*)::text as count from public.support_case_events')).rows[0].count, '9');

    await database.exec('reset role;');
    await assert.rejects(database.exec(`update public.support_case_events set message = 'mutated' where case_id = '${caseId}'`), /append-only/i);
    await assert.rejects(database.exec(`delete from public.support_cases where id = '${caseId}'`), /cannot be deleted|closed support cases/i);

    const unaffected = await database.query<{ booking_status: string; voucher_status: string; voucher_hash: string }>(`
      select b.status as booking_status, v.status as voucher_status, b.voucher_hash
      from public.bookings b join public.vouchers v on v.booking_id = b.id
      where b.id = '${bookingId}'
    `);
    assert.deepEqual(unaffected.rows[0], {
      booking_status: 'VOUCHER_ISSUED', voucher_status: 'ISSUED', voucher_hash: voucherHash
    });
  } finally {
    await database.close();
  }
});
