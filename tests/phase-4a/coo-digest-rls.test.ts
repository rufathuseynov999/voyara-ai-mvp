import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

/** Phase 4A — real PostgreSQL RLS test for coo_digests. Same gating pattern
 *  as every other sandbox-gated file in this project. */

const PG_URL = process.env.VOYARA_PG_TEST_URL;
const gated = PG_URL ? test : test.skip;

const A = '11111111-1111-4111-8111-111111111111';
const STAFF1 = '33333333-3333-4333-8333-333333333333';
const FOUNDER = '55555555-5555-4555-8555-555555555555';

async function pool() {
  const { Pool } = await import('pg');
  return new Pool({ connectionString: PG_URL, max: 4 });
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

gated('coo_digests: AAL2 staff read, AAL1 staff and customers blocked, no direct write policy for anyone', async () => {
  const p = await pool();
  try {
    const digestId = randomUUID();
    await svcQuery(
      p,
      `insert into coo_digests (id, account_id, generated_at, summary, correlation_id) values ($1,$2, now(), 'test summary', 'corr-coo-rls-000001')`,
      [digestId, A]
    );

    await asRole(p, 'authenticated', claimsFor(FOUNDER, 'aal2'), async (c) => {
      const r = await c.query(`select id from coo_digests where id = $1`, [digestId]);
      assert.equal(r.rowCount, 1, 'AAL2 founder reads the digest');
    });
    await asRole(p, 'authenticated', claimsFor(STAFF1, 'aal1'), async (c) => {
      const r = await c.query(`select id from coo_digests where id = $1`, [digestId]);
      assert.equal(r.rowCount, 0, 'AAL1 staff blocked');
    });
    await asRole(p, 'authenticated', claimsFor(A, 'aal1'), async (c) => {
      const r = await c.query(`select id from coo_digests where id = $1`, [digestId]);
      assert.equal(r.rowCount, 0, 'customer blocked');
      await assert.rejects(
        () => c.query(`insert into coo_digests (id, account_id, generated_at, summary, correlation_id) values ($1,$2, now(), 'x', 'corr-coo-rls-000002')`, [randomUUID(), A]),
        (e: unknown) => (e as { code?: string }).code === '42501'
      );
    });

    await svcQuery(p, `delete from coo_digests where id = $1`, [digestId]);
  } finally {
    await p.end();
  }
});
