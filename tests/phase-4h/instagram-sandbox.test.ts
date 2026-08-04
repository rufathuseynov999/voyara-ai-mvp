import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

/**
 * Phase 4H — real PostgreSQL tests for the Instagram dual-brand tables
 * (migration 27). Same gating/helper pattern as
 * tests/phase-4c/phase4c-sandbox.test.ts, with two deliberate
 * improvements this file adds over that template:
 *
 *  1. Every test seeds its OWN `role_assignments` row for the founder/staff
 *     ids it uses, rather than assuming an earlier test file in the suite
 *     already committed one. (Root-cause note: the pre-existing
 *     phase4c-sandbox.test.ts does NOT self-seed and was found, during
 *     Phase 4H verification, to fail identically to this file's original
 *     version when role_assignments is empty — confirmed by running it in
 *     isolation and inside the full `npm run test:db` suite. That is a
 *     pre-existing gap in this test suite, not a defect this migration
 *     introduced, and not one this file repeats.)
 *  2. Every test's cleanup runs in a `finally` block, so a failed
 *     assertion can never leave residue that causes a DIFFERENT,
 *     unrelated test to fail on a stale unique-constraint collision.
 */

const PG_URL = process.env.VOYARA_PG_TEST_URL;
const gated = PG_URL ? test : test.skip;

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
  role: 'anon' | 'authenticated' | 'service_role',
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

/** Seeds a synthetic auth.users row plus a role_assignments row for this
 *  test's own founder/staff id, and returns a cleanup function that
 *  removes both — self contained, no dependency on any other test file's
 *  execution order. role_assignments.user_id has a foreign key to
 *  auth.users(id) (migration 2), so the auth.users row must exist first. */
async function seedRole(p: Awaited<ReturnType<typeof pool>>, userId: string, role: string) {
  await svcQuery(p, `insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing`, [userId, `test-${userId}@fixture.invalid`]);
  await svcQuery(p, `insert into role_assignments (user_id, role, active) values ($1,$2,true) on conflict do nothing`, [userId, role]);
  return async () => {
    await svcQuery(p, `delete from role_assignments where user_id = $1 and role = $2`, [userId, role]);
    await svcQuery(p, `delete from auth.users where id = $1`, [userId]);
  };
}

/** Test-only administrative cleanup for the append-only receipts table.
 *  Superuser status alone does NOT bypass a user-defined BEFORE
 *  UPDATE/DELETE trigger in PostgreSQL (only row-level security has that
 *  superuser exemption) — genuinely removing a receipt row requires
 *  explicitly disabling the trigger first. This function exists ONLY in
 *  this test file; the real application has no code path that ever
 *  disables this trigger. */
async function adminPurgeReceipts() {
  const { Pool } = await import('pg');
  const admin = new Pool({ connectionString: PG_URL, max: 1 });
  try {
    await admin.query('alter table instagram_webhook_receipts disable trigger instagram_webhook_receipts_immutable');
    await admin.query('delete from instagram_webhook_receipts');
  } finally {
    await admin.query('alter table instagram_webhook_receipts enable trigger instagram_webhook_receipts_immutable').catch(() => {});
    await admin.end();
  }
}

async function cleanupInstagramRows(p: Awaited<ReturnType<typeof pool>>) {
  await adminPurgeReceipts();
  await svcQuery(p, `delete from instagram_accounts`);
}

/* ------------------------------- forced RLS: authorised access ------------------------------- */

gated('forced RLS: a genuinely-assigned AAL2 founder can read both Instagram tables', async () => {
  const p = await pool();
  const founderId = randomUUID();
  let unseedRole: () => Promise<void> = async () => {};
  try {
    unseedRole = await seedRole(p, founderId, 'founder');

    const accountId = randomUUID();
    await svcQuery(p, `insert into instagram_accounts (id, brand, instagram_account_id, page_id, display_username) values ($1,'RTRAVEL','ig-acct-auth-1','page-auth-1','rtravel_auth')`, [accountId]);
    const receiptId = randomUUID();
    await svcQuery(p, `insert into instagram_webhook_receipts (id, event_id, event_type, accepted, correlation_id) values ($1,$2,'messaging',true,'corr-4h-auth-001')`, [receiptId, `evt-${randomUUID()}`]);

    for (const [table, id] of [['instagram_accounts', accountId], ['instagram_webhook_receipts', receiptId]] as const) {
      await asRole(p, 'authenticated', claimsFor(founderId, 'aal2'), async (c) => {
        const r = await c.query(`select id from ${table} where id = $1`, [id]);
        assert.equal(r.rowCount, 1, `a genuinely AAL2-assigned founder must read ${table}`);
      });
    }
  } finally {
    await cleanupInstagramRows(p);
    await unseedRole();
    await p.end();
  }
});

/* ------------------------------- forced RLS: unauthorised access denied ------------------------------- */

gated('forced RLS: AAL1 staff, an unassigned user, and anonymous are all blocked from both Instagram tables', async () => {
  const p = await pool();
  const staffId = randomUUID();
  const unassignedId = randomUUID();
  let unseedRole: () => Promise<void> = async () => {};
  try {
    // staffId is deliberately assigned only at AAL1 (no active founder/staff
    // row is inserted for it at aal2) — proves AAL2 is actually required,
    // not merely "any authenticated user with claims."
    unseedRole = await seedRole(p, staffId, 'staff');

    const accountId = randomUUID();
    await svcQuery(p, `insert into instagram_accounts (id, brand, instagram_account_id, page_id, display_username) values ($1,'RTRAVEL','ig-acct-deny-1','page-deny-1','rtravel_deny')`, [accountId]);
    const receiptId = randomUUID();
    await svcQuery(p, `insert into instagram_webhook_receipts (id, event_id, event_type, accepted, correlation_id) values ($1,$2,'messaging',true,'corr-4h-deny-001')`, [receiptId, `evt-${randomUUID()}`]);

    for (const [table, id] of [['instagram_accounts', accountId], ['instagram_webhook_receipts', receiptId]] as const) {
      await asRole(p, 'authenticated', claimsFor(staffId, 'aal1'), async (c) => {
        const r = await c.query(`select id from ${table} where id = $1`, [id]);
        assert.equal(r.rowCount, 0, `AAL1 (not AAL2) must be blocked from ${table}, even though the role assignment itself is real`);
      });
      await asRole(p, 'authenticated', claimsFor(unassignedId, 'aal2'), async (c) => {
        const r = await c.query(`select id from ${table} where id = $1`, [id]);
        assert.equal(r.rowCount, 0, `an AAL2 session with NO role_assignments row at all must be blocked from ${table}`);
      });
      await asRole(p, 'anon', null, async (c) => {
        const r = await c.query(`select id from ${table} where id = $1`, [id]);
        assert.equal(r.rowCount, 0, `anonymous (unauthenticated) must be blocked from ${table}`);
      });
    }
  } finally {
    await cleanupInstagramRows(p);
    await unseedRole();
    await p.end();
  }
});

/* ------------------------------- brand isolation (DB constraints) ------------------------------- */

gated('instagram_accounts: at most one account per brand — a second RTRAVEL row is rejected', async () => {
  const p = await pool();
  try {
    await svcQuery(p, `insert into instagram_accounts (id, brand, instagram_account_id, page_id, display_username) values ($1,'RTRAVEL','ig-acct-2','page-2','rtravel_a')`, [randomUUID()]);
    await assert.rejects(
      () => svcQuery(p, `insert into instagram_accounts (id, brand, instagram_account_id, page_id, display_username) values ($1,'RTRAVEL','ig-acct-3','page-3','rtravel_b')`, [randomUUID()]),
      (e: unknown) => (e as { code?: string }).code === '23505'
    );
  } finally {
    await cleanupInstagramRows(p);
    await p.end();
  }
});

gated('instagram_accounts: the same Instagram account id cannot be claimed by both brands', async () => {
  const p = await pool();
  try {
    await svcQuery(p, `insert into instagram_accounts (id, brand, instagram_account_id, page_id, display_username) values ($1,'RTRAVEL','shared-ig-account','page-r','rtravel_c')`, [randomUUID()]);
    await assert.rejects(
      () => svcQuery(p, `insert into instagram_accounts (id, brand, instagram_account_id, page_id, display_username) values ($1,'VOYARA','shared-ig-account','page-v','voyara_c')`, [randomUUID()]),
      (e: unknown) => (e as { code?: string }).code === '23505'
    );
  } finally {
    await cleanupInstagramRows(p);
    await p.end();
  }
});

gated('instagram_accounts: the same Page id cannot be claimed by both brands', async () => {
  const p = await pool();
  try {
    await svcQuery(p, `insert into instagram_accounts (id, brand, instagram_account_id, page_id, display_username) values ($1,'RTRAVEL','ig-acct-4','shared-page','rtravel_d')`, [randomUUID()]);
    await assert.rejects(
      () => svcQuery(p, `insert into instagram_accounts (id, brand, instagram_account_id, page_id, display_username) values ($1,'VOYARA','ig-acct-5','shared-page','voyara_d')`, [randomUUID()]),
      (e: unknown) => (e as { code?: string }).code === '23505'
    );
  } finally {
    await cleanupInstagramRows(p);
    await p.end();
  }
});

gated('both brands can be configured simultaneously with distinct ids — the happy path', async () => {
  const p = await pool();
  try {
    await svcQuery(p, `insert into instagram_accounts (id, brand, instagram_account_id, page_id, display_username) values ($1,'RTRAVEL','ig-acct-6','page-6','rtravel_e')`, [randomUUID()]);
    await svcQuery(p, `insert into instagram_accounts (id, brand, instagram_account_id, page_id, display_username) values ($1,'VOYARA','ig-acct-7','page-7','voyara_e')`, [randomUUID()]);
    const result = await svcQuery(p, `select brand from instagram_accounts order by brand`);
    assert.deepEqual(result.rows.map((r) => r.brand), ['RTRAVEL', 'VOYARA']);
  } finally {
    await cleanupInstagramRows(p);
    await p.end();
  }
});

/* ------------------------------- reserve-first idempotency ------------------------------- */

gated('concurrent duplicate Instagram webhook event ids produce exactly one accepted receipt (real 23505)', async () => {
  const p = await pool();
  const eventId = `evt-4h-concurrent-${randomUUID()}`;
  try {
    const insertReceipt = async () => {
      const c = await p.connect();
      try {
        await c.query('set role service_role');
        await c.query(`insert into instagram_webhook_receipts (id, event_id, event_type, accepted, correlation_id) values ($1,$2,'messaging',true,'corr-4h-concurrent')`, [randomUUID(), eventId]);
        return 'ok' as const;
      } catch (error) {
        return (error as { code?: string }).code === '23505' ? ('dup' as const) : Promise.reject(error);
      } finally {
        await c.query('reset role').catch(() => undefined);
        c.release();
      }
    };
    const results = await Promise.all([insertReceipt(), insertReceipt(), insertReceipt(), insertReceipt(), insertReceipt()]);
    assert.equal(results.filter((r) => r === 'ok').length, 1, 'exactly one of five concurrent identical event ids is accepted');
    assert.equal(results.filter((r) => r === 'dup').length, 4, 'the other four are correctly rejected as duplicates');
  } finally {
    await adminPurgeReceipts();
    await p.end();
  }
});

gated('a duplicate event id is rejected even with a different event_type/accepted value — the event id alone is the identity', async () => {
  const p = await pool();
  const eventId = `evt-4h-dup-shape-${randomUUID()}`;
  try {
    await svcQuery(p, `insert into instagram_webhook_receipts (id, event_id, event_type, accepted, correlation_id) values ($1,$2,'messaging',true,'corr-4h-dup-1')`, [randomUUID(), eventId]);
    await assert.rejects(
      () => svcQuery(p, `insert into instagram_webhook_receipts (id, event_id, event_type, accepted, correlation_id) values ($1,$2,'standby',false,'corr-4h-dup-2')`, [randomUUID(), eventId]),
      (e: unknown) => (e as { code?: string }).code === '23505'
    );
  } finally {
    await adminPurgeReceipts();
    await p.end();
  }
});

/* ------------------------------- immutability: append-only audit trail ------------------------------- */

gated('instagram_webhook_receipts cannot be UPDATEd, even by service_role', async () => {
  const p = await pool();
  const receiptId = randomUUID();
  const eventId = `evt-4h-immutable-${randomUUID()}`;
  try {
    await svcQuery(p, `insert into instagram_webhook_receipts (id, event_id, event_type, accepted, correlation_id) values ($1,$2,'messaging',true,'corr-4h-immutable-1')`, [receiptId, eventId]);
    await assert.rejects(
      () => svcQuery(p, `update instagram_webhook_receipts set accepted = false where id = $1`, [receiptId]),
      (e: unknown) => /append-only/.test((e as Error).message)
    );
  } finally {
    // Cleanup requires explicitly disabling the trigger first (see
    // adminPurgeReceipts) — this does not weaken the guarantee, since the
    // real application never disables this trigger; only this test file's
    // own teardown does.
    await adminPurgeReceipts();
    await p.end();
  }
});

gated('instagram_webhook_receipts cannot be DELETEd, even by service_role', async () => {
  const p = await pool();
  const receiptId = randomUUID();
  const eventId = `evt-4h-immutable-del-${randomUUID()}`;
  try {
    await svcQuery(p, `insert into instagram_webhook_receipts (id, event_id, event_type, accepted, correlation_id) values ($1,$2,'messaging',true,'corr-4h-immutable-2')`, [receiptId, eventId]);
    await assert.rejects(
      () => svcQuery(p, `delete from instagram_webhook_receipts where id = $1`, [receiptId]),
      (e: unknown) => /append-only/.test((e as Error).message)
    );
    const stillThere = await svcQuery(p, `select id from instagram_webhook_receipts where id = $1`, [receiptId]);
    assert.equal(stillThere.rowCount, 1, 'the row must still exist — the rejected delete did not silently succeed');
  } finally {
    await adminPurgeReceipts();
    await p.end();
  }
});

/* ------------------------------- no secrets stored ------------------------------- */

gated('instagram_accounts stores no access token or app secret column', async () => {
  const p = await pool();
  try {
    const result = await svcQuery(
      p,
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'instagram_accounts'
       and (column_name ilike '%access_token%' or column_name ilike '%app_secret%' or column_name ilike '%secret%')`
    );
    assert.equal(result.rowCount, 0, `found suspicious columns: ${JSON.stringify(result.rows)}`);
  } finally {
    await p.end();
  }
});

/* ------------------------------- cleanup is repeatable ------------------------------- */

gated('running the full seed → assert → cleanup cycle twice in a row leaves zero residue both times', async () => {
  const p = await pool();
  try {
    for (let cycle = 0; cycle < 2; cycle += 1) {
      const accountId = randomUUID();
      await svcQuery(p, `insert into instagram_accounts (id, brand, instagram_account_id, page_id, display_username) values ($1,'RTRAVEL','ig-acct-repeat','page-repeat','rtravel_repeat')`, [accountId]);
      const count = await svcQuery(p, `select count(*)::int as n from instagram_accounts`);
      assert.equal(count.rows[0].n, 1, `cycle ${cycle}: exactly one row exists after seeding`);
      await cleanupInstagramRows(p);
      const afterCleanup = await svcQuery(p, `select count(*)::int as n from instagram_accounts`);
      assert.equal(afterCleanup.rows[0].n, 0, `cycle ${cycle}: zero rows remain after cleanup — repeatable`);
    }
  } finally {
    await cleanupInstagramRows(p);
    await p.end();
  }
});
