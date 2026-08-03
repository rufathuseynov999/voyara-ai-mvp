import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

/**
 * Phase 4G Part 3 — real PostgreSQL tests for the automation-policy engine
 * (approval-by-hash, stale-hash rejection, revision invalidation) and the
 * Level 0-3 enforcement guarantees, run against the actual applied schema
 * (Migrations 23-24). Same gating/helper pattern as every other
 * sandbox-gated file in this project.
 */

const PG_URL = process.env.VOYARA_PG_TEST_URL;
const gated = PG_URL ? test : test.skip;

const A = '11111111-1111-4111-8111-111111111111';
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

async function computeExpectedHash(input: { policyCode: string; scope: string; rules: Record<string, unknown>; version: number }): Promise<string> {
  const { sha256 } = await import('@/server/bos/canonical-json');
  return sha256(input);
}

async function seedActivePolicy(p: Awaited<ReturnType<typeof pool>>, policyCode: string, rules: Record<string, unknown> = { limit: 5 }) {
  const policyId = randomUUID();
  const contentHash = await computeExpectedHash({ policyCode, scope: 'TEST', rules, version: 1 });
  await svcQuery(
    p,
    `insert into automation_policies (id, policy_code, scope, rules, status, approved_by, approved_at, content_hash, correlation_id)
     values ($1,$2,'TEST',$3,'ACTIVE',$4,now(),$5,'corr-4g-pol-seed')`,
    [policyId, policyCode, JSON.stringify(rules), FOUNDER, contentHash]
  );
  return { policyId, contentHash };
}

async function cleanup(p: Awaited<ReturnType<typeof pool>>) {
  await svcQuery(p, `delete from automation_policy_history where correlation_id like 'corr-4g-pol%'`);
  await svcQuery(p, `delete from automation_policies where correlation_id like 'corr-4g-pol%'`);
  await svcQuery(p, `delete from workflow_execution_events where correlation_id like 'corr-4g-pol%'`);
  await svcQuery(p, `delete from workflow_steps where correlation_id like 'corr-4g-pol%'`);
  await svcQuery(p, `delete from workflow_runs where correlation_id like 'corr-4g-pol%'`);
  await svcQuery(p, `delete from workflow_versions where correlation_id like 'corr-4g-pol%'`);
  await svcQuery(p, `delete from workflow_definitions where correlation_id like 'corr-4g-pol%'`);
}

gated('the stored content_hash for an approved policy exactly matches what the application\'s own sha256 function would compute', async () => {
  const p = await pool();
  try {
    const policyCode = `test.hash.${randomUUID().slice(0, 8)}`;
    const { policyId, contentHash } = await seedActivePolicy(p, policyCode);
    const row = await svcQuery(p, `select content_hash from automation_policies where id = $1`, [policyId]);
    assert.equal(row.rows[0].content_hash, contentHash);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('a policy whose rules were tampered with in place (bypassing revision) has a content_hash that no longer matches its own content', async () => {
  const p = await pool();
  try {
    const policyCode = `test.stale.${randomUUID().slice(0, 8)}`;
    const { policyId, contentHash } = await seedActivePolicy(p, policyCode, { limit: 5 });
    await svcQuery(p, `update automation_policies set rules = '{"limit": 99999}'::jsonb where id = $1`, [policyId]);
    const tamperedExpectedHash = await computeExpectedHash({ policyCode, scope: 'TEST', rules: { limit: 99999 }, version: 1 });
    const row = await svcQuery(p, `select content_hash from automation_policies where id = $1`, [policyId]);
    assert.equal(row.rows[0].content_hash, contentHash);
    assert.notEqual(row.rows[0].content_hash, tamperedExpectedHash);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('revising a policy (new version, reverted to DRAFT) means no ACTIVE row exists for that code until re-approved', async () => {
  const p = await pool();
  try {
    const policyCode = `test.revise.${randomUUID().slice(0, 8)}`;
    const { policyId: v1Id } = await seedActivePolicy(p, policyCode, { limit: 5 });
    await svcQuery(p, `update automation_policies set status = 'RETIRED' where id = $1`, [v1Id]);
    const v2Id = randomUUID();
    await svcQuery(p, `insert into automation_policies (id, policy_code, scope, rules, status, version, correlation_id) values ($1,$2,'TEST','{"limit":100}'::jsonb,'DRAFT',2,'corr-4g-pol-seed')`, [v2Id, policyCode]);

    const activeRows = await svcQuery(p, `select id from automation_policies where policy_code = $1 and status = 'ACTIVE'`, [policyCode]);
    assert.equal(activeRows.rowCount, 0, 'no ACTIVE policy exists until the new version is re-approved');
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('a DRAFT policy row can never satisfy the active-requires-approval CHECK — attempting ACTIVE with no approval is refused by the database', async () => {
  const p = await pool();
  try {
    await assert.rejects(
      () => svcQuery(p, `insert into automation_policies (id, policy_code, scope, status, correlation_id) values ($1,'test.no.approval','TEST','ACTIVE','corr-4g-pol-seed')`, [randomUUID()]),
      (e: unknown) => /automation_policies_active_requires_approval/.test((e as Error).message)
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('only one ACTIVE policy row may exist per policy_code (unique partial index)', async () => {
  const p = await pool();
  try {
    const policyCode = `test.unique.${randomUUID().slice(0, 8)}`;
    await seedActivePolicy(p, policyCode);
    const contentHash = await computeExpectedHash({ policyCode, scope: 'TEST', rules: { limit: 5 }, version: 2 });
    await assert.rejects(
      () => svcQuery(
        p,
        `insert into automation_policies (id, policy_code, scope, rules, status, approved_by, approved_at, content_hash, version, correlation_id)
         values ($1,$2,'TEST','{"limit":5}'::jsonb,'ACTIVE',$3,now(),$4,2,'corr-4g-pol-seed')`,
        [randomUUID(), policyCode, FOUNDER, contentHash]
      ),
      (e: unknown) => (e as { code?: string }).code === '23505'
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

async function seedActiveWorkflowRun(p: Awaited<ReturnType<typeof pool>>) {
  const definitionId = randomUUID();
  await svcQuery(p, `insert into workflow_definitions (id, workflow_code, correlation_id) values ($1,$2,'corr-4g-pol-seed')`, [definitionId, `test.wf.${randomUUID().slice(0, 8)}`]);
  const versionId = randomUUID();
  await svcQuery(
    p,
    `insert into workflow_versions (id, workflow_definition_id, version, step_graph, status, approved_by, approved_at, content_hash, correlation_id)
     values ($1,$2,1,'{}'::jsonb,'ACTIVE',$3,now(),$4,'corr-4g-pol-seed')`,
    [versionId, definitionId, FOUNDER, 'a'.repeat(64)]
  );
  const runId = randomUUID();
  await svcQuery(p, `insert into workflow_runs (id, workflow_version_id, subject_type, correlation_id) values ($1,$2,'test','corr-4g-pol-seed')`, [runId, versionId]);
  return runId;
}

gated('Level 2 requires a real human approver — direct COMPLETED insert with no approval fields is refused at the database', async () => {
  const p = await pool();
  try {
    const runId = await seedActiveWorkflowRun(p);
    await assert.rejects(
      () => svcQuery(p, `insert into workflow_steps (id, workflow_run_id, step_index, step_code, action_level, status, correlation_id) values ($1,$2,0,'sensitive','LEVEL_2','COMPLETED','corr-4g-pol-seed')`, [randomUUID(), runId]),
      (e: unknown) => /workflow_steps_level2_requires_approval_to_complete/.test((e as Error).message)
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('a genuinely approved Level 2 step is written with exactly one attributable approver on file', async () => {
  const p = await pool();
  try {
    const runId = await seedActiveWorkflowRun(p);
    const stepId = randomUUID();
    const firstApprover = FOUNDER;
    await svcQuery(
      p,
      `insert into workflow_steps (id, workflow_run_id, step_index, step_code, action_level, status, approved_by, approved_at, approval_content_hash, correlation_id)
       values ($1,$2,0,'sensitive','LEVEL_2','COMPLETED',$3,now(),$4,'corr-4g-pol-seed')`,
      [stepId, runId, firstApprover, 'b'.repeat(64)]
    );
    const row = await svcQuery(p, `select status, approved_by from workflow_steps where id = $1`, [stepId]);
    assert.equal(row.rows[0].status, 'COMPLETED');
    assert.equal(row.rows[0].approved_by, firstApprover);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('Level 3 cannot complete even when every approval field a Level 2 step would need is fully populated', async () => {
  const p = await pool();
  try {
    const runId = await seedActiveWorkflowRun(p);
    await assert.rejects(
      () => svcQuery(
        p,
        `insert into workflow_steps (id, workflow_run_id, step_index, step_code, action_level, status, approved_by, approved_at, approval_content_hash, correlation_id)
         values ($1,$2,0,'forbidden','LEVEL_3','COMPLETED',$3,now(),$4,'corr-4g-pol-seed')`,
        [randomUUID(), runId, FOUNDER, 'c'.repeat(64)]
      ),
      (e: unknown) => /workflow_steps_level3_never_completes/.test((e as Error).message)
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('Level 3 cannot complete even via UPDATE from a different prior status', async () => {
  const p = await pool();
  try {
    const runId = await seedActiveWorkflowRun(p);
    const stepId = randomUUID();
    await svcQuery(p, `insert into workflow_steps (id, workflow_run_id, step_index, step_code, action_level, status, correlation_id) values ($1,$2,0,'forbidden','LEVEL_3','PENDING','corr-4g-pol-seed')`, [stepId, runId]);
    await assert.rejects(
      () => svcQuery(p, `update workflow_steps set status = 'COMPLETED', approved_by = $2, approved_at = now(), approval_content_hash = $3 where id = $1`, [stepId, FOUNDER, 'd'.repeat(64)]),
      (e: unknown) => /workflow_steps_level3_never_completes/.test((e as Error).message)
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('automation_policy_history is append-only: AAL2 staff UPDATE/DELETE affect zero rows under RLS, row provably unchanged', async () => {
  const p = await pool();
  try {
    const policyCode = `test.history.${randomUUID().slice(0, 8)}`;
    const { policyId, contentHash } = await seedActivePolicy(p, policyCode);
    const historyId = randomUUID();
    await svcQuery(p, `insert into automation_policy_history (id, automation_policy_id, version, content_hash, snapshot, created_by, correlation_id) values ($1,$2,1,$3,'{}'::jsonb,$4,'corr-4g-pol-seed')`, [historyId, policyId, contentHash, FOUNDER]);

    await asRole(p, 'authenticated', claimsFor(FOUNDER, 'aal2'), async (c) => {
      const updateResult = await c.query(`update automation_policy_history set content_hash = $1 where id = $2`, ['z'.repeat(64), historyId]);
      assert.equal(updateResult.rowCount, 0);
      const deleteResult = await c.query(`delete from automation_policy_history where id = $1`, [historyId]);
      assert.equal(deleteResult.rowCount, 0);
    });
    const stillThere = await svcQuery(p, `select content_hash from automation_policy_history where id = $1`, [historyId]);
    assert.equal(stillThere.rows[0].content_hash, contentHash);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('RLS: AAL2 founder reads automation_policies and automation_policy_history; AAL1 staff and customers are blocked', async () => {
  const p = await pool();
  try {
    const policyCode = `test.rls.${randomUUID().slice(0, 8)}`;
    const { policyId } = await seedActivePolicy(p, policyCode);

    await asRole(p, 'authenticated', claimsFor(FOUNDER, 'aal2'), async (c) => {
      const r = await c.query(`select id from automation_policies where id = $1`, [policyId]);
      assert.equal(r.rowCount, 1);
    });
    await asRole(p, 'authenticated', claimsFor(STAFF1, 'aal1'), async (c) => {
      const r = await c.query(`select id from automation_policies where id = $1`, [policyId]);
      assert.equal(r.rowCount, 0);
    });
    await asRole(p, 'authenticated', claimsFor(A, 'aal1'), async (c) => {
      const r = await c.query(`select id from automation_policies where id = $1`, [policyId]);
      assert.equal(r.rowCount, 0);
    });
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('no direct authenticated write policy exists on automation_policies or automation_policy_history, even for AAL2 founder', async () => {
  const p = await pool();
  try {
    await asRole(p, 'authenticated', claimsFor(FOUNDER, 'aal2'), async (c) => {
      await assert.rejects(
        () => c.query(`insert into automation_policies (id, policy_code, scope, correlation_id) values ($1,'x','TEST','c')`, [randomUUID()]),
        (e: unknown) => (e as { code?: string }).code === '42501'
      );
    });
  } finally {
    await p.end();
  }
});
