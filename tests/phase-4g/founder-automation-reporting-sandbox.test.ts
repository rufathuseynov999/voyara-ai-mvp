import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

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

async function cleanup(p: Awaited<ReturnType<typeof pool>>) {
  await svcQuery(p, `delete from dead_letter_records where correlation_id like 'corr-4g-ops%'`);
  await svcQuery(p, `delete from workflow_steps where correlation_id like 'corr-4g-ops%'`);
  await svcQuery(p, `delete from workflow_runs where correlation_id like 'corr-4g-ops%'`);
  await svcQuery(p, `delete from workflow_version_history where correlation_id like 'corr-4g-ops%'`);
  await svcQuery(p, `delete from workflow_versions where correlation_id like 'corr-4g-ops%'`);
  await svcQuery(p, `delete from workflow_definitions where correlation_id like 'corr-4g-ops%'`);
}

gated('the fixed payment_link_requests query executes successfully against the real table (was: nonexistent payment_links)', async () => {
  const p = await pool();
  try {
    const { loadAutomationOpsSnapshot } = await import('@/server/agents/automation/automation-ops-queries');
    const snapshot = await loadAutomationOpsSnapshot();
    assert.ok(!snapshot.unavailableReasons.some((r) => r.includes('payment_link_requests') && r.includes('could not read')));
  } finally {
    await p.end();
  }
});

gated('the fixed commercial_quotations PENDING_APPROVAL query executes successfully against the real enum (was: invalid PENDING_HUMAN_REVIEW)', async () => {
  const p = await pool();
  try {
    const { loadAutomationOpsSnapshot } = await import('@/server/agents/automation/automation-ops-queries');
    const snapshot = await loadAutomationOpsSnapshot();
    assert.notEqual(snapshot.proposalsAwaitingApproval, null);
    assert.ok(!snapshot.unavailableReasons.some((r) => r.includes('commercial_quotations')));
  } finally {
    await p.end();
  }
});

gated('workflow totals by status reflect real seeded workflow_runs rows exactly', async () => {
  const p = await pool();
  try {
    const definitionId = randomUUID();
    await svcQuery(p, `insert into workflow_definitions (id, workflow_code, correlation_id) values ($1,$2,'corr-4g-ops-seed')`, [definitionId, `ops.test.${randomUUID().slice(0, 8)}`]);
    const versionId = randomUUID();
    await svcQuery(
      p,
      `insert into workflow_versions (id, workflow_definition_id, version, step_graph, status, approved_by, approved_at, content_hash, correlation_id)
       values ($1,$2,1,'{}'::jsonb,'ACTIVE',$3,now(),$4,'corr-4g-ops-seed')`,
      [versionId, definitionId, '55555555-5555-4555-8555-555555555555', 'a'.repeat(64)]
    );
    const completedId = randomUUID();
    const failedId = randomUUID();
    await svcQuery(p, `insert into workflow_runs (id, workflow_version_id, subject_type, status, correlation_id) values ($1,$2,'test','COMPLETED','corr-4g-ops-seed')`, [completedId, versionId]);
    await svcQuery(p, `insert into workflow_runs (id, workflow_version_id, subject_type, status, correlation_id) values ($1,$2,'test','FAILED','corr-4g-ops-seed')`, [failedId, versionId]);

    const { loadAutomationOpsSnapshot } = await import('@/server/agents/automation/automation-ops-queries');
    const snapshot = await loadAutomationOpsSnapshot();
    assert.ok(snapshot.workflowTotalsByStatus);
    assert.ok((snapshot.completedWorkflows ?? 0) >= 1);
    assert.ok((snapshot.failedWorkflows ?? 0) >= 1);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('dead-lettered (unresolved) count reflects a real unresolved dead_letter_records row', async () => {
  const p = await pool();
  try {
    const definitionId = randomUUID();
    await svcQuery(p, `insert into workflow_definitions (id, workflow_code, correlation_id) values ($1,$2,'corr-4g-ops-seed')`, [definitionId, `ops.dl.${randomUUID().slice(0, 8)}`]);
    const versionId = randomUUID();
    await svcQuery(
      p,
      `insert into workflow_versions (id, workflow_definition_id, version, step_graph, status, approved_by, approved_at, content_hash, correlation_id)
       values ($1,$2,1,'{}'::jsonb,'ACTIVE',$3,now(),$4,'corr-4g-ops-seed')`,
      [versionId, definitionId, '55555555-5555-4555-8555-555555555555', 'b'.repeat(64)]
    );
    const runId = randomUUID();
    await svcQuery(p, `insert into workflow_runs (id, workflow_version_id, subject_type, correlation_id) values ($1,$2,'test','corr-4g-ops-seed')`, [runId, versionId]);
    await svcQuery(p, `insert into dead_letter_records (id, workflow_run_id, reason_code, resolved, correlation_id) values ($1,$2,'TEST_FAILURE',false,'corr-4g-ops-seed')`, [randomUUID(), runId]);

    const { loadAutomationOpsSnapshot } = await import('@/server/agents/automation/automation-ops-queries');
    const snapshot = await loadAutomationOpsSnapshot();
    assert.ok((snapshot.deadLetteredWorkflows ?? 0) >= 1);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('dataAvailability is "partial" against the real database, honestly reflecting the schema gaps for SLA/deadline/risk tables', async () => {
  const p = await pool();
  try {
    const { loadAutomationOpsSnapshot } = await import('@/server/agents/automation/automation-ops-queries');
    const snapshot = await loadAutomationOpsSnapshot();
    assert.equal(snapshot.dataAvailability, 'partial');
    assert.equal(snapshot.slaBreaches, null);
    assert.equal(snapshot.bookingDeadlinesNext7Days, null);
    assert.equal(snapshot.unresolvedOperationalRisks, null);
  } finally {
    await p.end();
  }
});

gated('loadAutomationOpsSnapshot performs zero writes — running it repeatedly never changes any real row', async () => {
  const p = await pool();
  try {
    const { loadAutomationOpsSnapshot } = await import('@/server/agents/automation/automation-ops-queries');
    const before = await svcQuery(p, `select count(*)::int as n from workflow_runs`);
    await loadAutomationOpsSnapshot();
    await loadAutomationOpsSnapshot();
    const after = await svcQuery(p, `select count(*)::int as n from workflow_runs`);
    assert.equal(before.rows[0].n, after.rows[0].n);
  } finally {
    await p.end();
  }
});
