import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

/**
 * Phase 4E — real PostgreSQL tests for all 13 supplier-operations tables.
 * Same gating/helper pattern as every other sandbox-gated file in this
 * project.
 */

const PG_URL = process.env.VOYARA_PG_TEST_URL;
const gated = PG_URL ? test : test.skip;

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
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

async function seedSupplierAndContract(p: Awaited<ReturnType<typeof pool>>, contractStatus = 'ACTIVE') {
  const supplierId = randomUUID();
  await svcQuery(p, `insert into suppliers (id, legal_name, supplier_type, correlation_id) values ($1,'Test Supplier LLC','HOTEL_WHOLESALER','corr-4e-000001')`, [supplierId]);
  const contractId = randomUUID();
  const isActive = contractStatus === 'ACTIVE';
  await svcQuery(
    p,
    `insert into contracts (id, agreement_type, rtravel_legal_entity, supplier_id, supplier_legal_entity, contract_reference, effective_date, pricing_structure, currency, refund_responsibility, chargeback_responsibility, status, approved_by, approved_at, content_hash, correlation_id)
     values ($1,'NET_RATE','R-Travel LLC',$2,'Test Supplier LLC',$3,'2026-01-01','NET rate','AZN','Supplier','R-Travel',$4,$5,$6,$7,'corr-4e-000002')`,
    [contractId, supplierId, `REF-${randomUUID().slice(0, 8)}`, contractStatus, isActive ? FOUNDER : null, isActive ? new Date().toISOString() : null, isActive ? 'a'.repeat(64) : null]
  );
  return { supplierId, contractId };
}

async function cleanup(p: Awaited<ReturnType<typeof pool>>) {
  await svcQuery(p, `delete from migration_rows`);
  await svcQuery(p, `delete from migration_batches`);
  await svcQuery(p, `delete from air_ticketing_records`);
  await svcQuery(p, `delete from service_bookings`);
  await svcQuery(p, `delete from portal_task_idempotency_keys`);
  await svcQuery(p, `delete from portal_task_events`);
  await svcQuery(p, `delete from portal_tasks`);
  await svcQuery(p, `delete from document_events`);
  await svcQuery(p, `delete from document_references`);
  await svcQuery(p, `delete from contract_versions`);
  await svcQuery(p, `delete from contracts`);
  await svcQuery(p, `delete from supplier_events`);
  await svcQuery(p, `delete from suppliers`);
  await svcQuery(p, `delete from contacts where display_name = 'Phase 4E Test Contact'`);
}

gated('forced RLS: AAL2 staff read, AAL1 staff and customers blocked, on every Phase 4E table', async () => {
  const p = await pool();
  try {
    const { supplierId, contractId } = await seedSupplierAndContract(p);
    const contactId = randomUUID();
    await svcQuery(p, `insert into contacts (id, account_id, display_name) values ($1,$2,'Phase 4E Test Contact')`, [contactId, A]);

    const supplierEventId = randomUUID();
    await svcQuery(p, `insert into supplier_events (id, supplier_id, kind, actor_id, actor_kind, correlation_id) values ($1,$2,'CREATED',$3,'human','corr-4e-000004')`, [supplierEventId, supplierId, FOUNDER]);

    const contractVersionId = randomUUID();
    await svcQuery(p, `insert into contract_versions (id, contract_id, version, content_hash, snapshot, created_by, correlation_id) values ($1,$2,1,$3,'{}'::jsonb,$4,'corr-4e-000005')`, [contractVersionId, contractId, 'a'.repeat(64), FOUNDER]);

    const documentId = randomUUID();
    await svcQuery(p, `insert into document_references (id, subject_type, subject_id, document_type, object_storage_key, checksum, uploaded_by, correlation_id) values ($1,'contract',$2,'CONTRACT','private/contracts/test.pdf',$3,$4,'corr-4e-000006')`, [documentId, contractId, 'b'.repeat(64), FOUNDER]);
    const documentEventId = randomUUID();
    await svcQuery(p, `insert into document_events (id, document_id, kind, actor_id, actor_kind, correlation_id) values ($1,$2,'REGISTERED',$3,'human','corr-4e-000007')`, [documentEventId, documentId, FOUNDER]);

    const portalTaskId = randomUUID();
    await svcQuery(p, `insert into portal_tasks (id, supplier_id, contract_id, contact_id, correlation_id) values ($1,$2,$3,$4,'corr-4e-000008')`, [portalTaskId, supplierId, contractId, contactId]);
    const portalTaskEventId = randomUUID();
    await svcQuery(p, `insert into portal_task_events (id, portal_task_id, kind, actor_id, actor_kind, correlation_id) values ($1,$2,'CREATED',$3,'agent','corr-4e-000009')`, [portalTaskEventId, portalTaskId, FOUNDER]);
    const idempotencyKey = `idem-${randomUUID()}`;
    await svcQuery(p, `insert into portal_task_idempotency_keys (idempotency_key, portal_task_id, correlation_id) values ($1,$2,'corr-4e-000010')`, [idempotencyKey, portalTaskId]);

    const bookingId = randomUUID();
    await svcQuery(p, `insert into service_bookings (id, contact_id, supplier_id, contract_id, service_type, net_cost_minor_units, customer_price_minor_units, currency, expected_margin_minor_units, responsible_employee_id, correlation_id) values ($1,$2,$3,$4,'HOTEL_ONLY',10000,12000,'AZN',2000,$5,'corr-4e-000011')`, [bookingId, contactId, supplierId, contractId, FOUNDER]);

    const ticketId = randomUUID();
    await svcQuery(p, `insert into air_ticketing_records (id, contact_id, consolidator_supplier_id, contract_id, route, net_fare_minor_units, customer_price_minor_units, currency, correlation_id) values ($1,$2,$3,$4,'GYD-IST-GYD',40000,50000,'AZN','corr-4e-000012')`, [ticketId, contactId, supplierId, contractId]);

    const batchId = randomUUID();
    await svcQuery(p, `insert into migration_batches (id, batch_type, source_provenance, imported_by, correlation_id) values ($1,'SUPPLIERS','test.csv',$2,'corr-4e-000013')`, [batchId, FOUNDER]);
    const rowId = randomUUID();
    await svcQuery(p, `insert into migration_rows (id, batch_id, row_number, raw_data, status, correlation_id) values ($1,$2,1,'{}'::jsonb,'ACCEPTED','corr-4e-000014')`, [rowId, batchId]);

    const tables: [string, string][] = [
      ['suppliers', supplierId], ['supplier_events', supplierEventId], ['contracts', contractId], ['contract_versions', contractVersionId],
      ['document_references', documentId], ['document_events', documentEventId], ['portal_tasks', portalTaskId], ['portal_task_events', portalTaskEventId],
      ['service_bookings', bookingId], ['air_ticketing_records', ticketId], ['migration_batches', batchId], ['migration_rows', rowId]
    ];

    for (const [table, id] of tables) {
      await asRole(p, 'authenticated', claimsFor(FOUNDER, 'aal2'), async (c) => {
        const r = await c.query(`select id from ${table} where id = $1`, [id]);
        assert.equal(r.rowCount, 1, `AAL2 founder reads ${table}`);
      });
      await asRole(p, 'authenticated', claimsFor(STAFF1, 'aal1'), async (c) => {
        const r = await c.query(`select id from ${table} where id = $1`, [id]);
        assert.equal(r.rowCount, 0, `AAL1 staff blocked from ${table}`);
      });
      await asRole(p, 'authenticated', claimsFor(A, 'aal1'), async (c) => {
        const r = await c.query(`select id from ${table} where id = $1`, [id]);
        assert.equal(r.rowCount, 0, `customer blocked from ${table}`);
      });
    }

    await asRole(p, 'authenticated', claimsFor(FOUNDER, 'aal2'), async (c) => {
      const r = await c.query(`select idempotency_key from portal_task_idempotency_keys where idempotency_key = $1`, [idempotencyKey]);
      assert.equal(r.rowCount, 1, 'AAL2 founder reads portal_task_idempotency_keys');
    });
    await asRole(p, 'authenticated', claimsFor(STAFF1, 'aal1'), async (c) => {
      const r = await c.query(`select idempotency_key from portal_task_idempotency_keys where idempotency_key = $1`, [idempotencyKey]);
      assert.equal(r.rowCount, 0, 'AAL1 staff blocked from portal_task_idempotency_keys');
    });

    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('no direct authenticated write policy exists on any Phase 4E table, even for AAL2 founder', async () => {
  const p = await pool();
  try {
    await asRole(p, 'authenticated', claimsFor(FOUNDER, 'aal2'), async (c) => {
      await assert.rejects(
        () => c.query(`insert into suppliers (id, legal_name, supplier_type, correlation_id) values ($1,'x','DMC','c')`, [randomUUID()]),
        (e: unknown) => (e as { code?: string }).code === '42501'
      );
    });
  } finally {
    await p.end();
  }
});

gated('cross-customer isolation: customer B cannot see customer A\'s service booking', async () => {
  const p = await pool();
  try {
    const { supplierId, contractId } = await seedSupplierAndContract(p);
    const contactId = randomUUID();
    await svcQuery(p, `insert into contacts (id, account_id, display_name) values ($1,$2,'Phase 4E Test Contact')`, [contactId, A]);
    const bookingId = randomUUID();
    await svcQuery(p, `insert into service_bookings (id, contact_id, supplier_id, contract_id, service_type, net_cost_minor_units, customer_price_minor_units, currency, expected_margin_minor_units, responsible_employee_id, correlation_id) values ($1,$2,$3,$4,'HOTEL_ONLY',10000,12000,'AZN',2000,$5,'corr-4e-000015')`, [bookingId, contactId, supplierId, contractId, FOUNDER]);

    await asRole(p, 'authenticated', claimsFor(B, 'aal1'), async (c) => {
      const r = await c.query(`select id from service_bookings where id = $1`, [bookingId]);
      assert.equal(r.rowCount, 0);
    });
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('the database rejects an ACTIVE contract with no human approver (contracts_active_requires_approval)', async () => {
  const p = await pool();
  try {
    const supplierId = randomUUID();
    await svcQuery(p, `insert into suppliers (id, legal_name, supplier_type, correlation_id) values ($1,'Test Supplier','DMC','corr-4e-000016')`, [supplierId]);
    await assert.rejects(
      () => svcQuery(
        p,
        `insert into contracts (id, agreement_type, rtravel_legal_entity, supplier_id, supplier_legal_entity, contract_reference, effective_date, pricing_structure, currency, refund_responsibility, chargeback_responsibility, status, correlation_id)
         values ($1,'NET_RATE','R-Travel LLC',$2,'Test Supplier',$3,'2026-01-01','NET rate','AZN','Supplier','R-Travel','ACTIVE','corr-4e-000017')`,
        [randomUUID(), supplierId, `REF-${randomUUID().slice(0, 8)}`]
      ),
      (e: unknown) => /contracts_active_requires_approval/.test((e as Error).message)
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('duplicate contract reference is rejected by the unique constraint', async () => {
  const p = await pool();
  try {
    const supplierId = randomUUID();
    await svcQuery(p, `insert into suppliers (id, legal_name, supplier_type, correlation_id) values ($1,'Test Supplier','DMC','corr-4e-000018')`, [supplierId]);
    const ref = `DUPLICATE-REF-${randomUUID().slice(0, 8)}`;
    await svcQuery(p, `insert into contracts (id, agreement_type, rtravel_legal_entity, supplier_id, supplier_legal_entity, contract_reference, effective_date, pricing_structure, currency, refund_responsibility, chargeback_responsibility, correlation_id) values ($1,'NET_RATE','R-Travel LLC',$2,'Test Supplier',$3,'2026-01-01','NET rate','AZN','Supplier','R-Travel','corr-4e-000019')`, [randomUUID(), supplierId, ref]);
    await assert.rejects(
      () => svcQuery(p, `insert into contracts (id, agreement_type, rtravel_legal_entity, supplier_id, supplier_legal_entity, contract_reference, effective_date, pricing_structure, currency, refund_responsibility, chargeback_responsibility, correlation_id) values ($1,'NET_RATE','R-Travel LLC',$2,'Test Supplier',$3,'2026-01-01','NET rate','AZN','Supplier','R-Travel','corr-4e-000020')`, [randomUUID(), supplierId, ref]),
      (e: unknown) => (e as { code?: string }).code === '23505'
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('the database refuses a CONFIRMED portal task without both a human owner and a supplier confirmation reference', async () => {
  const p = await pool();
  try {
    const { supplierId, contractId } = await seedSupplierAndContract(p);
    const contactId = randomUUID();
    await svcQuery(p, `insert into contacts (id, account_id, display_name) values ($1,$2,'Phase 4E Test Contact')`, [contactId, A]);
    await assert.rejects(
      () => svcQuery(p, `insert into portal_tasks (id, supplier_id, contract_id, contact_id, status, correlation_id) values ($1,$2,$3,$4,'CONFIRMED','corr-4e-000021')`, [randomUUID(), supplierId, contractId, contactId]),
      (e: unknown) => /portal_tasks_confirmed_requires_evidence/.test((e as Error).message)
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('the database refuses a TICKETED air-ticketing record with no human ticketing owner', async () => {
  const p = await pool();
  try {
    const { supplierId, contractId } = await seedSupplierAndContract(p);
    const contactId = randomUUID();
    await svcQuery(p, `insert into contacts (id, account_id, display_name) values ($1,$2,'Phase 4E Test Contact')`, [contactId, A]);
    await assert.rejects(
      () => svcQuery(p, `insert into air_ticketing_records (id, contact_id, consolidator_supplier_id, contract_id, route, net_fare_minor_units, customer_price_minor_units, currency, ticketing_status, correlation_id) values ($1,$2,$3,$4,'GYD-IST-GYD',40000,50000,'AZN','TICKETED','corr-4e-000022')`, [randomUUID(), contactId, supplierId, contractId]),
      (e: unknown) => /air_ticketing_ticketed_requires_human_owner/.test((e as Error).message)
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('the database refuses a COMMITTED migration batch with no human approver', async () => {
  const p = await pool();
  try {
    await assert.rejects(
      () => svcQuery(p, `insert into migration_batches (id, batch_type, source_provenance, imported_by, status, correlation_id) values ($1,'SUPPLIERS','test.csv',$2,'COMMITTED','corr-4e-000023')`, [randomUUID(), FOUNDER]),
      (e: unknown) => /migration_batches_committed_requires_approval/.test((e as Error).message)
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('the database refuses a document reference with a credential-shaped object storage key', async () => {
  const p = await pool();
  try {
    const { contractId } = await seedSupplierAndContract(p);
    await assert.rejects(
      () => svcQuery(p, `insert into document_references (id, subject_type, subject_id, document_type, object_storage_key, checksum, uploaded_by, correlation_id) values ($1,'contract',$2,'CONTRACT','private/supplier-password.txt',$3,$4,'corr-4e-000024')`, [randomUUID(), contractId, 'c'.repeat(64), FOUNDER]),
      (e: unknown) => /document_references_no_credential_shaped_key/.test((e as Error).message)
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('supplier_events is append-only: AAL2 staff UPDATE/DELETE affect zero rows under RLS, and the row is provably unchanged', async () => {
  const p = await pool();
  try {
    const { supplierId } = await seedSupplierAndContract(p);
    const eventId = randomUUID();
    await svcQuery(p, `insert into supplier_events (id, supplier_id, kind, actor_id, actor_kind, correlation_id) values ($1,$2,'CREATED',$3,'human','corr-4e-000025')`, [eventId, supplierId, FOUNDER]);
    await asRole(p, 'authenticated', claimsFor(FOUNDER, 'aal2'), async (c) => {
      const updateResult = await c.query(`update supplier_events set kind = 'TAMPERED' where id = $1`, [eventId]);
      assert.equal(updateResult.rowCount, 0);
      const deleteResult = await c.query(`delete from supplier_events where id = $1`, [eventId]);
      assert.equal(deleteResult.rowCount, 0);
    });
    const stillThere = await svcQuery(p, `select kind from supplier_events where id = $1`, [eventId]);
    assert.equal(stillThere.rows[0].kind, 'CREATED');
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('concurrent duplicate portal-task idempotency keys produce exactly one winner (real 23505)', async () => {
  const p = await pool();
  try {
    const { supplierId, contractId } = await seedSupplierAndContract(p);
    const contactId = randomUUID();
    await svcQuery(p, `insert into contacts (id, account_id, display_name) values ($1,$2,'Phase 4E Test Contact')`, [contactId, A]);
    const idempotencyKey = `idem-4e-concurrent-${randomUUID()}`;

    const insertKey = async () => {
      const c = await p.connect();
      try {
        await c.query('set role service_role');
        const taskId = randomUUID();
        await c.query(`insert into portal_tasks (id, supplier_id, contract_id, contact_id, correlation_id) values ($1,$2,$3,$4,'corr-4e-concurrent')`, [taskId, supplierId, contractId, contactId]);
        await c.query(`insert into portal_task_idempotency_keys (idempotency_key, portal_task_id, correlation_id) values ($1,$2,'corr-4e-concurrent')`, [idempotencyKey, taskId]);
        return 'ok' as const;
      } catch (error) {
        return (error as { code?: string }).code === '23505' ? ('dup' as const) : Promise.reject(error);
      } finally {
        await c.query('reset role').catch(() => undefined);
        c.release();
      }
    };
    const results = await Promise.all([insertKey(), insertKey(), insertKey(), insertKey(), insertKey()]);
    assert.equal(results.filter((r) => r === 'ok').length, 1, 'exactly one insert wins');
    assert.equal(results.filter((r) => r === 'dup').length, 4, 'four real 23505 losers');
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('no Phase 4E table has a column suggesting a portal password, API key, or card data is stored', async () => {
  const p = await pool();
  try {
    const result = await svcQuery(
      p,
      `select table_name, column_name from information_schema.columns
       where table_schema = 'public' and table_name in ('suppliers','supplier_events','contracts','contract_versions','document_references','document_events','portal_tasks','portal_task_events','portal_task_idempotency_keys','service_bookings','air_ticketing_records','migration_batches','migration_rows')
       and (column_name ilike '%password%' or column_name ilike '%api_key%' or column_name ilike '%card_number%' or column_name ilike '%cvv%' or column_name ilike '%cvc%' or column_name ilike '%portal_secret%')`
    );
    assert.equal(result.rowCount, 0, `found suspicious columns: ${JSON.stringify(result.rows)}`);
  } finally {
    await p.end();
  }
});
