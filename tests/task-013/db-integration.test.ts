import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

/**
 * Phase 3B Part 4 — real sandbox PostgreSQL integration tests.
 *
 * Gated by VOYARA_PG_TEST_URL (plus NEXT_PUBLIC_SUPABASE_URL /
 * SUPABASE_SECRET_KEY for the real-store section) so the standard test run
 * stays hermetic. In the sandbox these run against a clean PostgreSQL 16 with
 * all 14 migrations applied, a Supabase-compatible auth shim, PostgREST, and
 * synthetic users only. Sections:
 *   A. Raw-SQL authority: forced-RLS ownership matrix, customer write denial,
 *      immutable versions, append-only audit, webhook uniqueness, and real
 *      concurrent 23505 races on the idempotency PRIMARY KEY.
 *   B. Real SupabaseQuoteStore through PostgREST (service role): full
 *      persistence of every record type, app-level ownership even under a
 *      BYPASSRLS role, and the reserve-first concurrent-duplicate guarantee.
 *   C. Real concurrent command execution through the orchestration service
 *      against the real store: exactly one authoritative result per key.
 */

const PG_URL = process.env.VOYARA_PG_TEST_URL;
const gated = PG_URL ? test : test.skip;

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const STAFF1 = '33333333-3333-4333-8333-333333333333';
const OPS = '44444444-4444-4444-8444-444444444444';
const FOUNDER = '55555555-5555-4555-8555-555555555555';

type PgClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  release: () => void;
};
type PgPool = { connect: () => Promise<PgClient>; end: () => Promise<void>; query: PgClient['query'] };

async function pool(): Promise<PgPool> {
  const { Pool } = await import('pg');
  return new Pool({ connectionString: PG_URL, max: 8 }) as unknown as PgPool;
}

/** Run fn inside a transaction under a given DB role + JWT claims, rollback after. */
async function asRole(
  p: PgPool,
  role: 'authenticated' | 'service_role',
  claims: Record<string, unknown> | null,
  fn: (c: PgClient) => Promise<void>
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

/** One-shot query under the service role (the authenticator base role has no
 *  privileges by design — NOINHERIT — mirroring Supabase's connection model). */
async function svcQuery(p: PgPool, sql: string, params?: unknown[]) {
  const c = await p.connect();
  try {
    await c.query('begin');
    await c.query('set local role service_role');
    const result = await c.query(sql, params);
    await c.query('commit');
    return result;
  } finally {
    c.release();
  }
}

function claimsFor(sub: string, aal: 'aal1' | 'aal2') {
  return { sub, aal, role: 'authenticated', session_id: randomUUID(), iat: Math.floor(Date.now() / 1000) };
}

const SEED_MATERIAL = {
  supplierNetMinor: 100_000,
  taxesAndFeesMinor: 12_000,
  customerTotalMinor: 130_000,
  currency: 'AZN',
  roomType: 'Deluxe Room',
  boardBasis: 'BED_AND_BREAKFAST',
  cancellationPolicy: { kind: 'NON_REFUNDABLE' },
  checkIn: '2026-08-12',
  checkOut: '2026-08-19',
  occupancy: { adults: 2, children: 0, rooms: 1 },
  supplierOfferReference: 'SIM-OFFER-RLS',
  offerExpiry: '2026-08-01T09:30:00.000Z'
};

/** Seed one quote owned by customer A (committed; caller cleans up). */
async function seedQuote(p: PgPool): Promise<string> {
  const quoteId = randomUUID();
  const c = await p.connect();
  try {
    await c.query('begin');
    await c.query(`set local role service_role`);
    await c.query(
      `insert into quotes (id, account_id, customer_id, status, supplier_offer_reference, source, correlation_id, current_version_number, created_at, expires_at)
       values ($1,$2,$2,'PREPARED','SIM-OFFER-RLS','SIMULATED','corr-rls-000001',1, now(), now() + interval '30 minutes')`,
      [quoteId, A]
    );
    await c.query(
      `insert into quote_versions (id, quote_id, account_id, customer_id, version_number, content_hash, material, approval_invalidated, created_at)
       values ($1,$2,$3,$3,1,$4,$5::jsonb,false, now())`,
      [randomUUID(), quoteId, A, 'a'.repeat(64), JSON.stringify(SEED_MATERIAL)]
    );
    await c.query('commit');
  } finally {
    c.release();
  }
  return quoteId;
}

async function cleanup(p: PgPool): Promise<void> {
  const c = await p.connect();
  try {
    await c.query('begin');
    await c.query(`set local role service_role`);
    for (const table of [
      'orchestration_audit_events', 'orchestration_idempotency_keys', 'booking_preparations',
      'payment_reconciliations', 'payment_webhook_receipts', 'payment_events', 'payment_intents',
      'offer_revalidations', 'quote_versions', 'quotes', 'normalized_offers',
      'supplier_responses', 'supplier_requests'
    ]) {
      await c.query(`delete from ${table}`);
    }
    await c.query('commit');
  } finally {
    c.release();
  }
}

/* ------------------------- A. Raw-SQL authority ------------------------- */

gated('RLS matrix: owner reads own quote; B, AAL1 staff cannot; AAL2 ops/founder can', async () => {
  const p = await pool();
  try {
    const quoteId = await seedQuote(p);
    const select = `select id from quotes where id = '${quoteId}'`;

    await asRole(p, 'authenticated', claimsFor(A, 'aal1'), async (c) => {
      assert.equal((await c.query(select)).rowCount, 1, 'customer A reads own quote');
    });
    await asRole(p, 'authenticated', claimsFor(B, 'aal1'), async (c) => {
      assert.equal((await c.query(select)).rowCount, 0, 'customer B blocked');
    });
    await asRole(p, 'authenticated', claimsFor(STAFF1, 'aal1'), async (c) => {
      assert.equal((await c.query(select)).rowCount, 0, 'AAL1 staff blocked by forced RLS');
    });
    await asRole(p, 'authenticated', claimsFor(OPS, 'aal2'), async (c) => {
      assert.equal((await c.query(select)).rowCount, 1, 'AAL2 ops staff reads');
    });
    await asRole(p, 'authenticated', claimsFor(FOUNDER, 'aal2'), async (c) => {
      assert.equal((await c.query(select)).rowCount, 1, 'AAL2 founder reads');
    });
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('customers cannot write quotes directly (no insert policy => denied)', async () => {
  const p = await pool();
  try {
    await asRole(p, 'authenticated', claimsFor(A, 'aal1'), async (c) => {
      await assert.rejects(
        () => c.query(
          `insert into quotes (id, account_id, customer_id, status, supplier_offer_reference, source, correlation_id, current_version_number, created_at, expires_at)
           values ($1,$2,$2,'PREPARED','X','SIMULATED','corr-deny-000001',1, now(), now())`,
          [randomUUID(), A]
        ),
        (e: unknown) => (e as { code?: string }).code === '42501'
      );
    });
  } finally {
    await p.end();
  }
});

gated('quote versions are immutable and audit events are append-only for authenticated roles', async () => {
  const p = await pool();
  try {
    const quoteId = await seedQuote(p);
    await asRole(p, 'authenticated', claimsFor(FOUNDER, 'aal2'), async (c) => {
      // No UPDATE policy on quote_versions: statement affects zero rows.
      const update = await c.query(`update quote_versions set content_hash = '${'b'.repeat(64)}' where quote_id = '${quoteId}'`);
      assert.equal(update.rowCount, 0, 'version update affects zero rows under RLS');
    });
    // Append-only audit: INSERT without a policy raises an RLS violation
    // (fresh transaction — the rejection aborts the block it runs in).
    await asRole(p, 'authenticated', claimsFor(FOUNDER, 'aal2'), async (c) => {
      await assert.rejects(
        () => c.query(`insert into orchestration_audit_events (id, quote_id, kind, actor_id, actor_kind, correlation_id) values ($1,$2,'X',$3,'human','corr-append-000001')`, [randomUUID(), quoteId, FOUNDER]),
        (e: unknown) => (e as { code?: string }).code === '42501'
      );
    });
    await asRole(p, 'authenticated', claimsFor(FOUNDER, 'aal2'), async (c) => {
      const del = await c.query(`delete from orchestration_audit_events where quote_id = '${quoteId}'`);
      assert.equal(del.rowCount, 0, 'audit delete affects zero rows');
    });
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('webhook event uniqueness and idempotency PRIMARY KEY produce real 23505 under concurrency', async () => {
  const p = await pool();
  try {
    // Webhook receipts: duplicate event_id -> 23505.
    const eventId = `evt-${randomUUID()}`;
    const insertReceipt = async () => {
      const c = await p.connect();
      try {
        await c.query(`set role service_role`);
        return await c.query(
          `insert into payment_webhook_receipts (id, event_id, event_type, accepted, reason_code, correlation_id, received_at)
           values ($1,$2,'payment.detected',true,'ACCEPTED','corr-webhook-000001', now())`,
          [randomUUID(), eventId]
        );
      } finally {
        await c.query('reset role').catch(() => undefined);
        c.release();
      }
    };
    await insertReceipt();
    await assert.rejects(insertReceipt, (e: unknown) => (e as { code?: string }).code === '23505');

    // Idempotency PK: five concurrent inserts of the same key — exactly one wins.
    const key = `concurrent-${randomUUID()}`;
    const insertKey = async () => {
      const c = await p.connect();
      try {
        await c.query(`set role service_role`);
        await c.query(
          `insert into orchestration_idempotency_keys (key, result_id, account_id, customer_id, actor_id, correlation_id)
           values ($1,$2,$3,$3,$3,'corr-idem-000001')`,
          [key, randomUUID(), A]
        );
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
    const count = await svcQuery(p, `select count(*)::int as n from orchestration_idempotency_keys where key = $1`, [key]);
    assert.equal(count.rows[0].n, 1);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

/* --------------- B. Real SupabaseQuoteStore through PostgREST ------------ */

const storeGated = PG_URL && process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY ? test : test.skip;

const FIXED = new Date('2026-07-20T09:00:00.000Z');

async function realDeps() {
  const { SupabaseQuoteStore } = await import('@/server/supplier/supabase-quote-store');
  const { SimulationSupplierAdapter } = await import('@/server/supplier/simulation-adapter');
  const { SimulationPaymentAdapter } = await import('@/server/payment/simulation-payment-adapter');
  return {
    store: new SupabaseQuoteStore(),
    supplier: new SimulationSupplierAdapter(),
    payment: new SimulationPaymentAdapter(),
    webhookSecret: 'w'.repeat(40),
    now: () => new Date()
  };
}

storeGated('real SupabaseQuoteStore persists the full simulated flow into PostgreSQL', async () => {
  const p = await pool();
  const deps = await realDeps();
  const { executeOrchestrationCommand, executeOrchestrationQuery } = await import('@/server/supplier/orchestration-service');
  const owner = { id: A, roles: ['customer' as const], source: 'supabase' as const, assuranceLevel: 'aal1' as const };
  const approver = { id: FOUNDER, roles: ['founder' as const], source: 'supabase' as const, assuranceLevel: 'aal2' as const };
  try {
    await cleanup(p);
    const created = await executeOrchestrationCommand({
      viewer: owner, idempotencyKey: `store-search-${randomUUID().slice(0, 12)}`,
      input: { command: 'SEARCH_AND_CREATE_QUOTE', destination: 'Maldives', checkIn: '2026-08-12', checkOut: '2026-08-19', occupancy: { adults: 2, children: 0, rooms: 1 }, currency: 'AZN' },
      deps
    });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const quoteId = created.body.quoteId as string;

    await executeOrchestrationCommand({ viewer: approver, idempotencyKey: `s-${randomUUID().slice(0, 16)}`, input: { command: 'SUBMIT_FOR_REVIEW', quoteId }, deps });
    const status1 = await executeOrchestrationQuery({ viewer: approver, input: { view: 'quoteStatus', quoteId }, deps });
    const hash = status1.body.contentHash as string;
    const approved = await executeOrchestrationCommand({ viewer: approver, idempotencyKey: `a-${randomUUID().slice(0, 16)}`, input: { command: 'APPROVE_QUOTE', quoteId, expectedContentHash: hash }, deps });
    assert.equal(approved.status, 200);
    await executeOrchestrationCommand({ viewer: approver, idempotencyKey: `p-${randomUUID().slice(0, 16)}`, input: { command: 'PRESENT_QUOTE', quoteId }, deps });
    await executeOrchestrationCommand({ viewer: owner, idempotencyKey: `acc-${randomUUID().slice(0, 16)}`, input: { command: 'ACCEPT_QUOTE', quoteId }, deps });
    await executeOrchestrationCommand({ viewer: approver, idempotencyKey: `pi-${randomUUID().slice(0, 16)}`, input: { command: 'PREPARE_PAYMENT_INTENT', quoteId }, deps });
    const webhook = await executeOrchestrationCommand({ viewer: approver, idempotencyKey: `w-${randomUUID().slice(0, 16)}`, input: { command: 'SIMULATE_WEBHOOK', quoteId }, deps });
    assert.equal(webhook.status, 200, JSON.stringify(webhook.body));
    const recon = await executeOrchestrationCommand({ viewer: approver, idempotencyKey: `r-${randomUUID().slice(0, 16)}`, input: { command: 'RECONCILE_SIMULATED', quoteId, scenario: 'EXACT' }, deps });
    assert.equal(recon.body.verified, true, JSON.stringify(recon.body));
    const prep = await executeOrchestrationCommand({
      viewer: approver, idempotencyKey: `bp-${randomUUID().slice(0, 16)}`,
      input: { command: 'PREPARE_BOOKING', quoteId, travellers: [{ fullName: 'Sandbox Traveller', isLead: true }], rooming: [{ roomIndex: 1, travellerNames: ['Sandbox Traveller'] }], specialRequests: '', hagApprovalReference: randomUUID() },
      deps
    });
    assert.equal(prep.status, 200, JSON.stringify(prep.body));

    // Verify persisted rows in PostgreSQL directly.
    const counts = await svcQuery(p, `
      select
        (select count(*)::int from quotes where id = $1) as quotes,
        (select count(*)::int from quote_versions where quote_id = $1) as versions,
        (select count(*)::int from payment_intents where quote_id = $1) as intents,
        (select count(*)::int from payment_webhook_receipts) as receipts,
        (select count(*)::int from payment_reconciliations) as recons,
        (select count(*)::int from booking_preparations where quote_id = $1) as preparations,
        (select count(*)::int from orchestration_audit_events where quote_id = $1) as audit,
        (select count(*)::int from orchestration_idempotency_keys) as idem
    `, [quoteId]);
    const row = counts.rows[0] as Record<string, number>;
    assert.equal(row.quotes, 1);
    assert.equal(row.versions, 1);
    assert.equal(row.intents, 1);
    assert.ok(row.receipts >= 1);
    assert.ok(row.recons >= 1);
    assert.equal(row.preparations, 1);
    assert.ok(row.audit >= 8, `audit rows ${row.audit}`);
    assert.equal(row.idem, 3, 'exactly the three keyed commands (search, accept, booking prep)');

    const quoteRow = await svcQuery(p, `select status, customer_id, source from quotes where id = $1`, [quoteId]);
    assert.equal(quoteRow.rows[0].status, 'PAYMENT_VERIFIED');
    assert.equal(quoteRow.rows[0].customer_id, A, 'staff actions never re-own the quote');
    assert.equal(quoteRow.rows[0].source, 'SIMULATED');
    await cleanup(p);
  } finally {
    await p.end();
  }
});

storeGated('service-role store access does not bypass application ownership checks', async () => {
  const p = await pool();
  const deps = await realDeps();
  try {
    await cleanup(p);
    const quoteId = await seedQuote(p);
    // The store runs with the service role (BYPASSRLS at DB level), but the
    // application boundary still refuses a foreign non-staff requester.
    const denied = await deps.store.loadQuote(quoteId, { tenantId: B, customerId: B, isStaff: false });
    assert.equal(denied, null);
    const staffRead = await deps.store.loadQuote(quoteId, { tenantId: FOUNDER, customerId: FOUNDER, isStaff: true });
    assert.ok(staffRead);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

/* ------------- C. Real concurrent commands via the real store ------------ */

storeGated('concurrent duplicate commands against PostgreSQL create exactly one authoritative result', async () => {
  const p = await pool();
  const deps = await realDeps();
  const { executeOrchestrationCommand } = await import('@/server/supplier/orchestration-service');
  const owner = { id: A, roles: ['customer' as const], source: 'supabase' as const, assuranceLevel: 'aal1' as const };
  const approver = { id: FOUNDER, roles: ['founder' as const], source: 'supabase' as const, assuranceLevel: 'aal2' as const };
  const search = { command: 'SEARCH_AND_CREATE_QUOTE', destination: 'Maldives', checkIn: '2026-08-12', checkOut: '2026-08-19', occupancy: { adults: 2, children: 0, rooms: 1 }, currency: 'AZN' };
  try {
    await cleanup(p);

    // Duplicate search: three concurrent identical commands, one quote row.
    const key = `race-search-${randomUUID().slice(0, 12)}`;
    const [r1, r2, r3] = await Promise.all([
      executeOrchestrationCommand({ viewer: owner, idempotencyKey: key, input: search, deps }),
      executeOrchestrationCommand({ viewer: owner, idempotencyKey: key, input: search, deps }),
      executeOrchestrationCommand({ viewer: owner, idempotencyKey: key, input: search, deps })
    ]);
    const ids = new Set([r1.body.quoteId, r2.body.quoteId, r3.body.quoteId]);
    assert.equal(ids.size, 1, 'all callers converge on the winner quote id');
    const quoteId = r1.body.quoteId as string;
    const quoteCount = await svcQuery(p, `select count(*)::int as n from quotes`);
    assert.equal(quoteCount.rows[0].n, 1, 'exactly one quote row in PostgreSQL');

    // Duplicate submission (sequential): the second fails closed on the
    // lifecycle transition — no duplicate state is recorded.
    await executeOrchestrationCommand({ viewer: approver, idempotencyKey: `sub-${randomUUID().slice(0, 14)}`, input: { command: 'SUBMIT_FOR_REVIEW', quoteId }, deps });
    const duplicateSubmit = await executeOrchestrationCommand({ viewer: approver, idempotencyKey: `sub-${randomUUID().slice(0, 14)}`, input: { command: 'SUBMIT_FOR_REVIEW', quoteId }, deps });
    assert.ok(duplicateSubmit.status >= 400, 'duplicate submission fails closed');

    // Repeated acceptance with one key: single audit event.
    const { executeOrchestrationQuery } = await import('@/server/supplier/orchestration-service');
    const status = await executeOrchestrationQuery({ viewer: approver, input: { view: 'quoteStatus', quoteId }, deps });
    await executeOrchestrationCommand({ viewer: approver, idempotencyKey: `ap-${randomUUID().slice(0, 14)}`, input: { command: 'APPROVE_QUOTE', quoteId, expectedContentHash: status.body.contentHash as string }, deps });
    await executeOrchestrationCommand({ viewer: approver, idempotencyKey: `pr-${randomUUID().slice(0, 14)}`, input: { command: 'PRESENT_QUOTE', quoteId }, deps });
    const acceptKey = `race-accept-${randomUUID().slice(0, 12)}`;
    await Promise.all([
      executeOrchestrationCommand({ viewer: owner, idempotencyKey: acceptKey, input: { command: 'ACCEPT_QUOTE', quoteId }, deps }),
      executeOrchestrationCommand({ viewer: owner, idempotencyKey: acceptKey, input: { command: 'ACCEPT_QUOTE', quoteId }, deps })
    ]);
    const acceptedAudit = await svcQuery(p, `select count(*)::int as n from orchestration_audit_events where quote_id = $1 and kind = 'QUOTE_CUSTOMER_ACCEPTED'`, [quoteId]);
    assert.equal(acceptedAudit.rows[0].n, 1, 'one acceptance audit event');

    // Duplicate webhook: same signed event twice — one receipt, one detection.
    await executeOrchestrationCommand({ viewer: approver, idempotencyKey: `pi2-${randomUUID().slice(0, 13)}`, input: { command: 'PREPARE_PAYMENT_INTENT', quoteId }, deps });
    const { signSimulatedWebhook } = await import('@/server/payment/simulation-payment-adapter');
    const timestamp = new Date().toISOString();
    const eventId = `race-evt-${randomUUID().slice(0, 8)}`;
    const body = JSON.stringify({ id: eventId, type: 'payment.detected' });
    const webhookInput = {
      command: 'INGEST_PAYMENT_WEBHOOK', quoteId, eventId, eventType: 'payment.detected',
      timestamp, signature: signSimulatedWebhook('w'.repeat(40), timestamp, body), body
    };
    const [w1, w2] = await Promise.all([
      executeOrchestrationCommand({ viewer: approver, idempotencyKey: `wh-${randomUUID().slice(0, 14)}`, input: webhookInput, deps }),
      executeOrchestrationCommand({ viewer: approver, idempotencyKey: `wh-${randomUUID().slice(0, 14)}`, input: webhookInput, deps })
    ]);
    assert.ok([w1, w2].some((w) => w.status === 200));
    const receipts = await svcQuery(p, `select count(*)::int as n from payment_webhook_receipts where event_id = $1`, [eventId]);
    assert.equal(receipts.rows[0].n, 1, 'unique event receipt');

    // Duplicate booking preparation after exact reconciliation: one row.
    await executeOrchestrationCommand({ viewer: approver, idempotencyKey: `re-${randomUUID().slice(0, 14)}`, input: { command: 'RECONCILE_SIMULATED', quoteId, scenario: 'EXACT' }, deps });
    const prepKey = `race-prep-${randomUUID().slice(0, 12)}`;
    const prepInput = { command: 'PREPARE_BOOKING', quoteId, travellers: [{ fullName: 'T', isLead: true }], rooming: [{ roomIndex: 1, travellerNames: ['T'] }], specialRequests: '', hagApprovalReference: randomUUID() };
    await Promise.all([
      executeOrchestrationCommand({ viewer: approver, idempotencyKey: prepKey, input: prepInput, deps }),
      executeOrchestrationCommand({ viewer: approver, idempotencyKey: prepKey, input: prepInput, deps })
    ]);
    const preparations = await svcQuery(p, `select count(*)::int as n from booking_preparations where quote_id = $1`, [quoteId]);
    assert.equal(preparations.rows[0].n, 1, 'one booking preparation row');

    await cleanup(p);
  } finally {
    await p.end();
  }
});
