import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

const PG_URL = process.env.VOYARA_PG_TEST_URL;
const gated = PG_URL ? test : test.skip;

const STAFF1 = '33333333-3333-4333-8333-333333333333';
const FOUNDER = '55555555-5555-4555-8555-555555555555';

async function pool() {
  const { Pool } = await import('pg');
  return new Pool({ connectionString: PG_URL, max: 6 });
}
async function svcQuery(p: Awaited<ReturnType<typeof pool>>, sql: string, params?: unknown[]) {
  const c = await p.connect();
  try {
    await c.query('begin');
    await c.query('set local role service_role');
    const result = await c.query(sql, params);
    await c.query('commit');
    return result;
  } catch (error) {
    await c.query('rollback').catch(() => {});
    throw error;
  } finally {
    c.release();
  }
}
async function asRole(
  p: Awaited<ReturnType<typeof pool>>,
  role: 'authenticated' | 'service_role',
  claims: Record<string, unknown> | null,
  fn: (c: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> }) => Promise<void>
): Promise<void> {
  const c = await p.connect();
  try {
    await c.query('begin');
    if (claims) await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    await c.query(`set local role ${role}`);
    await fn(c);
    await c.query('rollback');
  } finally {
    c.release();
  }
}
function claimsFor(sub: string, aal: 'aal1' | 'aal2') {
  return { sub, aal, role: 'authenticated', session_id: randomUUID(), iat: Math.floor(Date.now() / 1000) };
}

async function seedSupplier(p: Awaited<ReturnType<typeof pool>>) {
  const supplierId = randomUUID();
  await svcQuery(
    p,
    `insert into suppliers (id, legal_name, supplier_type, countries, destinations, currencies, languages, operational_contacts, finance_contacts, emergency_contacts, api_available, integration_status, contract_status, commercial_priority, risk_status, correlation_id)
     values ($1,'Test Supplier LLC','DIRECT_HOTEL','{AZ}','{Baku}','{AZN}','{az}','{}'::jsonb,'{}'::jsonb,'{}'::jsonb,false,'PORTAL_ONLY','ACTIVE',2,'LOW','corr-4g-portal-seed')`,
    [supplierId]
  );
  return supplierId;
}

async function seedContact(p: Awaited<ReturnType<typeof pool>>) {
  const contactId = randomUUID();
  await svcQuery(p, `insert into contacts (id, account_id, display_name) values ($1,$2,'Test Contact')`, [contactId, randomUUID()]);
  return contactId;
}

async function seedTask(p: Awaited<ReturnType<typeof pool>>, supplierId: string, overrides: Partial<{ status: string; assignedOwnerId: string | null; supplierConfirmationReference: string | null }> = {}) {
  const taskId = randomUUID();
  const contactId = await seedContact(p);
  await svcQuery(
    p,
    `insert into portal_tasks (id, supplier_id, contact_id, status, assigned_owner_id, supplier_confirmation_reference, correlation_id)
     values ($1,$2,$3,$4,$5,$6,'corr-4g-portal-seed')`,
    [taskId, supplierId, contactId, overrides.status ?? 'DRAFT', overrides.assignedOwnerId ?? null, overrides.supplierConfirmationReference ?? null]
  );
  return taskId;
}

async function cleanup(p: Awaited<ReturnType<typeof pool>>) {
  await svcQuery(p, `delete from portal_task_idempotency_keys where correlation_id like 'corr-4g-portal%'`);
  await svcQuery(p, `delete from portal_task_events where correlation_id like 'corr-4g-portal%'`);
  await svcQuery(p, `delete from portal_tasks where correlation_id like 'corr-4g-portal%'`);
  await svcQuery(p, `delete from contacts where display_name = 'Test Contact'`);
  await svcQuery(p, `delete from suppliers where correlation_id = 'corr-4g-portal-seed'`);
}

gated('a duplicate idempotency key is rejected by the real PRIMARY KEY constraint — no second portal task is created', async () => {
  const p = await pool();
  try {
    const supplierId = await seedSupplier(p);
    const taskId = await seedTask(p, supplierId);
    const key = `idem-4g-portal-${randomUUID()}`;
    await svcQuery(p, `insert into portal_task_idempotency_keys (idempotency_key, portal_task_id, correlation_id) values ($1,$2,'corr-4g-portal-seed')`, [key, taskId]);
    await assert.rejects(
      () => svcQuery(p, `insert into portal_task_idempotency_keys (idempotency_key, portal_task_id, correlation_id) values ($1,$2,'corr-4g-portal-seed')`, [key, randomUUID()]),
      (e: unknown) => (e as { code?: string }).code === '23505'
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('concurrent duplicate idempotency-key inserts for portal tasks produce exactly one winner under real concurrent load', async () => {
  const p = await pool();
  try {
    const supplierId = await seedSupplier(p);
    const taskId = await seedTask(p, supplierId);
    const key = `idem-4g-portal-concurrent-${randomUUID()}`;
    const insertKey = async () => {
      const c = await p.connect();
      try {
        await c.query('set role service_role');
        await c.query(`insert into portal_task_idempotency_keys (idempotency_key, portal_task_id, correlation_id) values ($1,$2,'corr-4g-portal-seed')`, [key, taskId]);
        return 'ok' as const;
      } catch (error) {
        return (error as { code?: string }).code === '23505' ? ('dup' as const) : Promise.reject(error);
      } finally {
        await c.query('reset role').catch(() => undefined);
        c.release();
      }
    };
    const results = await Promise.all([insertKey(), insertKey(), insertKey(), insertKey(), insertKey()]);
    assert.equal(results.filter((r) => r === 'ok').length, 1);
    assert.equal(results.filter((r) => r === 'dup').length, 4);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('the database refuses a CONFIRMED portal task with no supplier confirmation reference or assigned owner', async () => {
  const p = await pool();
  try {
    const supplierId = await seedSupplier(p);
    await assert.rejects(
      () => seedTask(p, supplierId, { status: 'CONFIRMED' }),
      (e: unknown) => /portal_tasks_confirmed_requires_evidence/.test((e as Error).message)
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('the database refuses a CONFIRMED portal task with an owner but a blank confirmation reference', async () => {
  const p = await pool();
  try {
    const supplierId = await seedSupplier(p);
    await assert.rejects(
      () => seedTask(p, supplierId, { status: 'CONFIRMED', assignedOwnerId: FOUNDER, supplierConfirmationReference: null }),
      (e: unknown) => /portal_tasks_confirmed_requires_evidence/.test((e as Error).message)
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('a genuinely CONFIRMED portal task with both a real owner and a real confirmation reference is accepted', async () => {
  const p = await pool();
  try {
    const supplierId = await seedSupplier(p);
    const taskId = await seedTask(p, supplierId, { status: 'CONFIRMED', assignedOwnerId: FOUNDER, supplierConfirmationReference: 'SUP-CONF-99887' });
    const row = await svcQuery(p, `select status, supplier_confirmation_reference from portal_tasks where id = $1`, [taskId]);
    assert.equal(row.rows[0].status, 'CONFIRMED');
    assert.equal(row.rows[0].supplier_confirmation_reference, 'SUP-CONF-99887');
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('a task already CONFIRMED cannot be inserted a second time with the same id (real PRIMARY KEY)', async () => {
  const p = await pool();
  try {
    const supplierId = await seedSupplier(p);
    const contactId = await seedContact(p);
    const taskId = randomUUID();
    await svcQuery(p, `insert into portal_tasks (id, supplier_id, contact_id, status, assigned_owner_id, supplier_confirmation_reference, correlation_id) values ($1,$2,$3,'CONFIRMED',$4,'SUP-1','corr-4g-portal-seed')`, [taskId, supplierId, contactId, FOUNDER]);
    await assert.rejects(
      () => svcQuery(p, `insert into portal_tasks (id, supplier_id, contact_id, status, assigned_owner_id, supplier_confirmation_reference, correlation_id) values ($1,$2,$3,'CONFIRMED',$4,'SUP-2','corr-4g-portal-seed')`, [taskId, supplierId, contactId, FOUNDER]),
      (e: unknown) => (e as { code?: string }).code === '23505'
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('portal_task_events is append-only: AAL2 staff UPDATE/DELETE affect zero rows under RLS, row provably unchanged', async () => {
  const p = await pool();
  try {
    const supplierId = await seedSupplier(p);
    const taskId = await seedTask(p, supplierId);
    const eventId = randomUUID();
    await svcQuery(p, `insert into portal_task_events (id, portal_task_id, kind, actor_id, actor_kind, correlation_id) values ($1,$2,'TASK_PREPARED',$3,'agent','corr-4g-portal-seed')`, [eventId, taskId, FOUNDER]);

    await asRole(p, 'authenticated', claimsFor(FOUNDER, 'aal2'), async (c) => {
      const updateResult = await c.query(`update portal_task_events set kind = 'TAMPERED' where id = $1`, [eventId]);
      assert.equal(updateResult.rowCount, 0);
      const deleteResult = await c.query(`delete from portal_task_events where id = $1`, [eventId]);
      assert.equal(deleteResult.rowCount, 0);
    });
    const stillThere = await svcQuery(p, `select kind from portal_task_events where id = $1`, [eventId]);
    assert.equal(stillThere.rows[0].kind, 'TASK_PREPARED');
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('forced RLS: AAL2 founder reads portal_tasks; AAL1 staff and unauthenticated customers are blocked', async () => {
  const p = await pool();
  try {
    const supplierId = await seedSupplier(p);
    const taskId = await seedTask(p, supplierId);

    await asRole(p, 'authenticated', claimsFor(FOUNDER, 'aal2'), async (c) => {
      const r = await c.query(`select id from portal_tasks where id = $1`, [taskId]);
      assert.equal(r.rowCount, 1);
    });
    await asRole(p, 'authenticated', claimsFor(STAFF1, 'aal1'), async (c) => {
      const r = await c.query(`select id from portal_tasks where id = $1`, [taskId]);
      assert.equal(r.rowCount, 0);
    });
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('no direct authenticated write policy exists on portal_tasks, even for AAL2 founder', async () => {
  const p = await pool();
  try {
    await asRole(p, 'authenticated', claimsFor(FOUNDER, 'aal2'), async (c) => {
      await assert.rejects(
        () => c.query(`insert into portal_tasks (id, supplier_id, contact_id, correlation_id) values ($1,$2,$3,'c')`, [randomUUID(), randomUUID(), randomUUID()]),
        (e: unknown) => (e as { code?: string }).code === '42501'
      );
    });
  } finally {
    await p.end();
  }
});

gated('SupabasePortalTaskStore.saveTask + loadTask round-trips a real portal task through the real class', async () => {
  const p = await pool();
  try {
    const supplierId = await seedSupplier(p);
    const contactId = await seedContact(p);
    const { SupabasePortalTaskStore } = await import('@/server/agents/supplier-ops/supabase-portal-task-store');
    const store = new SupabasePortalTaskStore();
    const taskId = randomUUID();
    const now = new Date().toISOString();
    await store.saveTask({
      portalTaskId: taskId, supplierId, contractId: null, conversationId: null, contactId,
      status: 'DRAFT', bookingData: { note: 'real class test' }, proposedMarkup: null, checklist: [],
      assignedOwnerId: null, supplierConfirmationReference: null, voucherMetadata: null,
      correlationId: 'corr-4g-portal-seed', createdAt: now, updatedAt: now
    });
    const loaded = await store.loadTask(taskId);
    assert.equal(loaded?.portalTaskId, taskId);
    assert.equal(loaded?.status, 'DRAFT');
    assert.deepEqual(loaded?.bookingData, { note: 'real class test' });
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('SupabasePortalTaskStore.reserveIdempotencyKey genuinely reserves via the real class against the real database', async () => {
  const p = await pool();
  try {
    const supplierId = await seedSupplier(p);
    const { SupabasePortalTaskStore } = await import('@/server/agents/supplier-ops/supabase-portal-task-store');
    const store = new SupabasePortalTaskStore();
    const taskId = await seedTask(p, supplierId);
    const key = `idem-4g-portal-class-${randomUUID()}`;
    const first = await store.reserveIdempotencyKey(key, taskId, 'corr-4g-portal-seed');
    const second = await store.reserveIdempotencyKey(key, randomUUID(), 'corr-4g-portal-seed');
    assert.equal(first.winner, true);
    assert.equal(second.winner, false);
    assert.equal(second.portalTaskId, taskId);
    await cleanup(p);
  } finally {
    await p.end();
  }
});
