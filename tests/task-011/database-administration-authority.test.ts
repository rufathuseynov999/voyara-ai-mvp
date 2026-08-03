import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const customer = 'e1000000-0000-4000-8000-000000000001';
const staff = 'e1000000-0000-4000-8000-000000000002';
const otherStaff = 'e1000000-0000-4000-8000-000000000003';
const manager = 'e1000000-0000-4000-8000-000000000004';
const founder = 'e1000000-0000-4000-8000-000000000005';
const staffSession = 'e2000000-0000-4000-8000-000000000001';
const otherSession = 'e2000000-0000-4000-8000-000000000002';
const managerSession = 'e2000000-0000-4000-8000-000000000003';
const requestId = 'e3000000-0000-4000-8000-000000000001';
const taskA = 'e4000000-0000-4000-8000-000000000001';
const taskB = 'e4000000-0000-4000-8000-000000000002';
const supplierId = 'e5000000-0000-4000-8000-000000000001';
const requestHash = '1'.repeat(64);
const commandHash = '9'.repeat(64);

function quote(value: unknown): string {
  return JSON.stringify(value).replaceAll("'", "''");
}

function commandSql(input: {
  commandId: string;
  key: string;
  name: string;
  actorId: string;
  sessionId: string;
  aal?: 'aal1' | 'aal2';
  payload: object;
}) {
  return `select public.execute_administration_command(
    '${input.commandId}', '${input.key}', '${input.name}',
    '${input.actorId}', '${input.sessionId}', '${input.aal ?? 'aal2'}', now() - interval '1 second',
    '${quote(input.payload)}'::jsonb, '${commandHash}'
  ) as result`;
}

function taskEvent(input: {
  taskId: string;
  version: number;
  previousHash: string;
  eventType: string;
  ownerId: string | null;
  status: string;
  note: string;
  eventHash: string;
  dueAt: string;
}) {
  return {
    taskId: input.taskId,
    taskEventPayload: {
      schemaVersion: 'crm-task-event-v1',
      taskId: input.taskId,
      travelRequestId: requestId,
      travelRequestVersion: 1,
      travelRequestHash: requestHash,
      customerId: customer,
      eventVersion: input.version,
      previousEventHash: input.previousHash,
      eventType: input.eventType,
      taskType: 'CUSTOMER_FOLLOW_UP',
      title: 'Confirm exact synthetic Customer request',
      ownerId: input.ownerId,
      status: input.status,
      dueAt: input.dueAt,
      note: input.note,
      authorityDomainsUnaffected: true
    },
    taskEventHash: input.eventHash
  };
}

function supplierConfiguration(input: {
  version: number;
  previousHash: string;
  status: 'ACTIVE' | 'PAUSED';
  reason: string;
  hash: string;
}) {
  return {
    supplierId,
    configurationPayload: {
      schemaVersion: 'supplier-configuration-v1',
      supplierId,
      versionNumber: input.version,
      previousVersionHash: input.previousHash,
      code: 'SYNTH_HOTEL',
      displayName: 'Synthetic Hotel Supplier',
      serviceCategory: 'HOTEL',
      operationalChannel: 'EMAIL',
      status: input.status,
      operationsNote: 'Synthetic manual operations channel only.',
      reason: input.reason,
      containsCredentials: false
    },
    configurationHash: input.hash
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
      ('${customer}', 'customer-task011@voyara.example'),
      ('${staff}', 'staff-task011@voyara.example'),
      ('${otherStaff}', 'other-task011@voyara.example'),
      ('${manager}', 'manager-task011@voyara.example'),
      ('${founder}', 'founder-task011@voyara.example');
    insert into public.role_assignments (user_id, role, assigned_by, reason) values
      ('${staff}', 'staff', '${founder}', 'Synthetic Task 011 Staff'),
      ('${otherStaff}', 'staff', '${founder}', 'Synthetic Task 011 Other Staff'),
      ('${manager}', 'manager', '${founder}', 'Synthetic Task 011 Manager'),
      ('${founder}', 'founder', '${founder}', 'Synthetic Task 011 Founder');

    set session_replication_role = replica;
    insert into public.travel_requests (
      id, customer_id, status, current_version, submitted_at, created_at, updated_at
    ) values (
      '${requestId}', '${customer}', 'SUBMITTED', 1,
      now() - interval '1 hour', now() - interval '2 hours', now() - interval '1 hour'
    );
    insert into public.travel_request_versions (
      travel_request_id, version_number, customer_id, locale,
      canonical_payload, payload_hash, created_by
    ) values (
      '${requestId}', 1, '${customer}', 'az',
      '{"destination":"Synthetic Baku"}'::jsonb, '${requestHash}', '${customer}'
    );
    set session_replication_role = origin;
    set role service_role;
  `);
  return database;
}

async function execute(database: PGlite, input: Parameters<typeof commandSql>[0]) {
  const result = await database.query<{ result: { status: string; reasonCode?: string; authorityHash?: string } }>(commandSql(input));
  return result.rows[0].result;
}

test('PostgreSQL enforces exact CRM work, immutable Supplier versions and approved Membership prices', async () => {
  const database = await setupDatabase();
  const dueAt = new Date(Date.now() + 86_400_000).toISOString();
  try {
    await database.exec('set role anon');
    const publicCatalogue = await database.query<{ plan_code: string; monthly_minor: number | null; annual_minor: number | null }>(
      'select plan_code, monthly_minor, annual_minor from public.membership_plan_catalogue order by display_order'
    );
    assert.equal(publicCatalogue.rows.length, 8);
    assert.deepEqual(publicCatalogue.rows.find((row) => row.plan_code === 'smart'), {
      plan_code: 'smart', monthly_minor: 1900, annual_minor: 19000
    });
    assert.deepEqual(publicCatalogue.rows.find((row) => row.plan_code === 'black'), {
      plan_code: 'black', monthly_minor: 29900, annual_minor: 299000
    });
    assert.deepEqual(publicCatalogue.rows.find((row) => row.plan_code === 'enterprise'), {
      plan_code: 'enterprise', monthly_minor: null, annual_minor: null
    });
    await database.exec('set role service_role');

    const createA = taskEvent({
      taskId: taskA, version: 1, previousHash: '', eventType: 'TASK_CREATED',
      ownerId: staff, status: 'OPEN', dueAt,
      note: 'Staff creates an accountable task assigned only to self.', eventHash: 'a'.repeat(64)
    });
    assert.equal((await execute(database, {
      commandId: 'e6000000-0000-4000-8000-000000000001', key: 'task011-create-self',
      name: 'crm.task.create', actorId: staff, sessionId: staffSession, payload: createA
    })).status, 'accepted');

    const createOther = taskEvent({
      taskId: taskB, version: 1, previousHash: '', eventType: 'TASK_CREATED',
      ownerId: otherStaff, status: 'OPEN', dueAt,
      note: 'Staff must not silently assign accountable work to another person.', eventHash: 'b'.repeat(64)
    });
    assert.deepEqual(await execute(database, {
      commandId: 'e6000000-0000-4000-8000-000000000002', key: 'task011-self-only-denial',
      name: 'crm.task.create', actorId: staff, sessionId: staffSession, payload: createOther
    }), { status: 'denied', reasonCode: 'TASK_SELF_ASSIGNMENT_ONLY' });

    assert.deepEqual(await execute(database, {
      commandId: 'e6000000-0000-4000-8000-000000000003', key: 'task011-aal1-denial',
      name: 'crm.task.status.set', actorId: staff, sessionId: staffSession, aal: 'aal1',
      payload: {
        ...taskEvent({ taskId: taskA, version: 2, previousHash: 'a'.repeat(64), eventType: 'TASK_STATUS_CHANGED', ownerId: staff, status: 'IN_PROGRESS', dueAt, note: 'This AAL1 state change must be denied.', eventHash: 'c'.repeat(64) }),
        expectedVersion: 1, expectedHash: 'a'.repeat(64)
      }
    }), { status: 'denied', reasonCode: 'AAL2_COMMAND_CONTEXT_REQUIRED' });

    const progress = {
      ...taskEvent({ taskId: taskA, version: 2, previousHash: 'a'.repeat(64), eventType: 'TASK_STATUS_CHANGED', ownerId: staff, status: 'IN_PROGRESS', dueAt, note: 'Accountable human started the exact Customer follow-up.', eventHash: 'c'.repeat(64) }),
      expectedVersion: 1, expectedHash: 'a'.repeat(64)
    };
    assert.equal((await execute(database, {
      commandId: 'e6000000-0000-4000-8000-000000000004', key: 'task011-progress',
      name: 'crm.task.status.set', actorId: staff, sessionId: staffSession, payload: progress
    })).status, 'accepted');

    assert.deepEqual(await execute(database, {
      commandId: 'e6000000-0000-4000-8000-000000000005', key: 'task011-stale-denial',
      name: 'crm.task.status.set', actorId: staff, sessionId: staffSession, payload: progress
    }), { status: 'denied', reasonCode: 'STALE_CRM_TASK_VERSION' });

    const reassign = {
      ...taskEvent({ taskId: taskA, version: 3, previousHash: 'c'.repeat(64), eventType: 'TASK_REASSIGNED', ownerId: otherStaff, status: 'IN_PROGRESS', dueAt, note: 'Manager reassigns work with an attributable operational reason.', eventHash: 'd'.repeat(64) }),
      expectedVersion: 2, expectedHash: 'c'.repeat(64)
    };
    assert.deepEqual(await execute(database, {
      commandId: 'e6000000-0000-4000-8000-000000000006', key: 'task011-reassign-denial',
      name: 'crm.task.reassign', actorId: staff, sessionId: staffSession, payload: reassign
    }), { status: 'denied', reasonCode: 'ELEVATED_ADMINISTRATION_AUTHORITY_REQUIRED' });
    assert.equal((await execute(database, {
      commandId: 'e6000000-0000-4000-8000-000000000007', key: 'task011-reassign-manager',
      name: 'crm.task.reassign', actorId: manager, sessionId: managerSession, payload: reassign
    })).status, 'accepted');

    const beforeAuthority = await database.query<{ status: string; current_version: number }>(
      `select status, current_version from public.travel_requests where id = '${requestId}'`
    );
    assert.deepEqual(beforeAuthority.rows[0], { status: 'SUBMITTED', current_version: 1 });

    const initialSupplier = supplierConfiguration({
      version: 1, previousHash: '', status: 'ACTIVE',
      reason: 'Initial accountable manual Supplier configuration.', hash: 'e'.repeat(64)
    });
    assert.deepEqual(await execute(database, {
      commandId: 'e6000000-0000-4000-8000-000000000008', key: 'task011-supplier-staff-denial',
      name: 'supplier.configuration.create', actorId: staff, sessionId: staffSession, payload: initialSupplier
    }), { status: 'denied', reasonCode: 'ELEVATED_ADMINISTRATION_AUTHORITY_REQUIRED' });
    assert.equal((await execute(database, {
      commandId: 'e6000000-0000-4000-8000-000000000009', key: 'task011-supplier-manager',
      name: 'supplier.configuration.create', actorId: manager, sessionId: managerSession, payload: initialSupplier
    })).status, 'accepted');

    const revisedSupplier = {
      ...supplierConfiguration({
        version: 2, previousHash: 'e'.repeat(64), status: 'PAUSED',
        reason: 'Manager paused the manual channel pending operational review.', hash: 'f'.repeat(64)
      }),
      expectedVersion: 1,
      expectedHash: 'e'.repeat(64)
    };
    assert.equal((await execute(database, {
      commandId: 'e6000000-0000-4000-8000-000000000010', key: 'task011-supplier-revise',
      name: 'supplier.configuration.revise', actorId: manager, sessionId: managerSession,
      payload: revisedSupplier
    })).status, 'accepted');

    const supplier = await database.query<{ status: string; current_version: number; current_hash: string }>(
      `select status, current_version, current_hash from public.supplier_registry where id = '${supplierId}'`
    );
    assert.deepEqual(supplier.rows[0], { status: 'PAUSED', current_version: 2, current_hash: 'f'.repeat(64) });
    const versions = await database.query<{ version_number: number }>(
      `select version_number from public.supplier_configuration_versions where supplier_id = '${supplierId}' order by version_number`
    );
    assert.deepEqual(versions.rows.map(({ version_number }) => version_number), [1, 2]);

    await assert.rejects(
      database.exec(`update public.supplier_configuration_versions set operations_note = 'tampered' where supplier_id = '${supplierId}' and version_number = 1`),
      /permission denied/
    );
    await database.exec('reset role');
    await assert.rejects(
      database.exec(`update public.supplier_configuration_versions set operations_note = 'tampered' where supplier_id = '${supplierId}' and version_number = 1`),
      /append-only/
    );
    await assert.rejects(
      database.exec("update public.membership_plan_versions set monthly_minor = 1 where plan_code = 'smart'"),
      /append-only/
    );
    await database.exec('set role service_role');

    const afterAuthority = await database.query<{ status: string; current_version: number }>(
      `select status, current_version from public.travel_requests where id = '${requestId}'`
    );
    assert.deepEqual(afterAuthority.rows[0], beforeAuthority.rows[0]);

    const pipeline = await database.query<{ stage_code: string; authority_status: string }>(
      `select stage_code, authority_status from public.administration_crm_pipeline where travel_request_id = '${requestId}'`
    );
    assert.deepEqual(pipeline.rows[0], { stage_code: 'TRAVEL_REQUEST_INTAKE', authority_status: 'SUBMITTED' });

    const privileges = await database.query<{ name: string; auth_select: boolean; service_select: boolean }>(`
      select c.relname as name,
        has_table_privilege('authenticated', 'public.' || c.relname, 'select') as auth_select,
        has_table_privilege('service_role', 'public.' || c.relname, 'select') as service_select
      from pg_class c
      where c.relname in ('administration_crm_pipeline', 'administration_team_directory', 'supplier_configuration_catalogue')
      order by c.relname
    `);
    assert.equal(privileges.rows.length, 3);
    assert.ok(privileges.rows.every((row) => !row.auth_select && row.service_select));
  } finally {
    await database.close();
  }
});
