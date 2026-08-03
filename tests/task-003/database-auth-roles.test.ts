import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const founderId = '20000000-0000-4000-8000-000000000001';
const customerId = '20000000-0000-4000-8000-000000000002';
const staffId = '20000000-0000-4000-8000-000000000003';
const founderSession = '30000000-0000-4000-8000-000000000001';
const invitationId = '40000000-0000-4000-8000-000000000001';
const hash = 'a'.repeat(64);

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
    returns uuid
    language sql
    stable
    as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
  `);
  const task002 = await readFile('supabase/migrations/20260717084526_task002_foundation_security.sql', 'utf8');
  await database.exec(task002);
  await database.exec(`insert into auth.users (id, email) values ('${founderId}', 'founder@voyara.example');`);
  const task003 = await readFile('supabase/migrations/20260717101137_task003_auth_role_session_security.sql', 'utf8');
  await database.exec(task003);
  await database.exec(`
    insert into public.role_assignments (user_id, role, assigned_by, reason)
    values ('${founderId}', 'founder', '${founderId}', 'Synthetic bootstrap');
    insert into auth.users (id, email) values ('${customerId}', 'customer@voyara.example');
  `);
  return database;
}

function commandSql(input: {
  commandId: string;
  key: string;
  name: string;
  actorId?: string;
  sessionId?: string;
  aal?: string;
  payload: string;
  payloadHash?: string;
}) {
  return `select public.execute_access_command(
    '${input.commandId}',
    '${input.key}',
    '${input.name}',
    '${input.actorId ?? founderId}',
    '${input.sessionId ?? founderSession}',
    '${input.aal ?? 'aal2'}',
    now() - interval '1 second',
    '${input.payload}'::jsonb,
    '${input.payloadHash ?? hash}'
  ) as result`;
}

test('Founder AAL2 staff invitation activates only the invited Role and records immutable evidence', async () => {
  const database = await setupDatabase();
  try {
    await database.exec('set role service_role;');
    const invitation = await database.query<{ result: { status: string; invitationId: string } }>(
      commandSql({
        commandId: invitationId,
        key: 'invite-staff-000001',
        name: 'staff.invite',
        payload: JSON.stringify({
          email: 'staff@voyara.example',
          emailHash: hash,
          role: 'finance',
          locale: 'az'
        }).replaceAll("'", "''")
      })
    );
    assert.equal(invitation.rows[0]?.result.status, 'accepted');
    assert.equal(invitation.rows[0]?.result.invitationId, invitationId);

    await database.exec(`reset role; insert into auth.users (id, email) values ('${staffId}', 'staff@voyara.example');`);
    const roles = await database.query<{ role: string }>(
      `select role from public.role_assignments where user_id = '${staffId}' order by role`
    );
    assert.deepEqual(roles.rows.map(({ role }) => role), ['finance']);

    const claimed = await database.query<{ status: string; claimed_by: string }>(
      `select status, claimed_by::text from public.staff_invitations where id = '${invitationId}'`
    );
    assert.deepEqual(claimed.rows[0], { status: 'claimed', claimed_by: staffId });

    const events = await database.query<{ event_type: string }>(
      `select event_type from public.authority_audit_events order by id`
    );
    assert.deepEqual(events.rows.map(({ event_type }) => event_type), ['staff.invite', 'staff.invitation.claimed']);
    await assert.rejects(
      database.exec(`update public.authority_audit_events set outcome = 'denied' where correlation_id = '${invitationId}'`),
      /append-only/i
    );
  } finally {
    await database.close();
  }
});

test('AAL1, non-Founder, revoked sessions and current-Founder revocation are denied', async () => {
  const database = await setupDatabase();
  try {
    await database.exec('set role service_role;');
    const aal1 = await database.query<{ result: { status: string; reasonCode: string } }>(
      commandSql({
        commandId: '40000000-0000-4000-8000-000000000010',
        key: 'aal1-denied-000001',
        name: 'role.assign',
        aal: 'aal1',
        payload: JSON.stringify({ userId: customerId, role: 'staff', reason: 'Synthetic test' })
      })
    );
    assert.deepEqual(aal1.rows[0]?.result, { status: 'denied', reasonCode: 'AAL2_REQUIRED' });

    const nonFounder = await database.query<{ result: { status: string; reasonCode: string } }>(
      commandSql({
        commandId: '40000000-0000-4000-8000-000000000011',
        key: 'nonfounder-denied-1',
        name: 'role.assign',
        actorId: customerId,
        sessionId: '30000000-0000-4000-8000-000000000002',
        payload: JSON.stringify({ userId: customerId, role: 'staff', reason: 'Synthetic test' })
      })
    );
    assert.deepEqual(nonFounder.rows[0]?.result, { status: 'denied', reasonCode: 'FOUNDER_REQUIRED' });

    await database.exec(`
      insert into public.session_revocations (session_id, user_id, revoked_by, reason)
      values ('${founderSession}', '${founderId}', '${founderId}', 'user_logout');
    `);
    const revoked = await database.query<{ result: { status: string; reasonCode: string } }>(
      commandSql({
        commandId: '40000000-0000-4000-8000-000000000012',
        key: 'revoked-denied-0001',
        name: 'role.assign',
        payload: JSON.stringify({ userId: customerId, role: 'staff', reason: 'Synthetic test' })
      })
    );
    assert.deepEqual(revoked.rows[0]?.result, { status: 'denied', reasonCode: 'SESSION_REVOKED' });

    const selfRevoke = await database.query<{ result: { status: string; reasonCode: string } }>(
      commandSql({
        commandId: '40000000-0000-4000-8000-000000000013',
        key: 'lastfounder-denied1',
        name: 'role.revoke',
        sessionId: '30000000-0000-4000-8000-000000000099',
        payload: JSON.stringify({ userId: founderId, role: 'founder', reason: 'Synthetic test' })
      })
    );
    assert.deepEqual(selfRevoke.rows[0]?.result, { status: 'denied', reasonCode: 'LAST_OR_CURRENT_FOUNDER' });
  } finally {
    await database.close();
  }
});

test('Customer RLS isolates session state and denies locked access-command infrastructure', async () => {
  const database = await setupDatabase();
  try {
    await database.exec(`set role authenticated; set request.jwt.claim.sub = '${customerId}';`);
    const sessionRows = await database.query<{ user_id: string }>(
      'select user_id::text from public.user_session_security order by user_id'
    );
    assert.deepEqual(sessionRows.rows.map(({ user_id }) => user_id), [customerId]);
    await assert.rejects(database.query('select * from public.staff_invitations'), /permission denied/i);
    await assert.rejects(database.query('select * from public.command_receipts'), /permission denied/i);
    await assert.rejects(database.query('select * from public.authority_audit_events'), /permission denied/i);
    await assert.rejects(
      database.query(
        commandSql({
          commandId: '40000000-0000-4000-8000-000000000020',
          key: 'client-command-denied',
          name: 'role.assign',
          actorId: customerId,
          sessionId: '30000000-0000-4000-8000-000000000020',
          payload: JSON.stringify({ userId: customerId, role: 'founder', reason: 'Forbidden' })
        })
      ),
      /permission denied/i
    );
  } finally {
    await database.close();
  }
});
