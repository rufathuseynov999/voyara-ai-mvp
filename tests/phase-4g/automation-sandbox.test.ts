import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { SYSTEM_ACTOR_ID } from '@/server/agents/business-account';

/**
 * Phase 4G — real PostgreSQL tests for all 15 automation-foundation
 * tables. Same gating/helper pattern as every other sandbox-gated file in
 * this project.
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

async function seedActiveWorkflow(p: Awaited<ReturnType<typeof pool>>) {
  const definitionId = randomUUID();
  await svcQuery(p, `insert into workflow_definitions (id, workflow_code, correlation_id) values ($1,$2,'corr-4g-seed1')`, [definitionId, `test.workflow.${randomUUID().slice(0, 8)}`]);
  const versionId = randomUUID();
  await svcQuery(
    p,
    `insert into workflow_versions (id, workflow_definition_id, version, step_graph, status, approved_by, approved_at, content_hash, correlation_id)
     values ($1,$2,1,'{}'::jsonb,'ACTIVE',$3,now(),$4,'corr-4g-seed2')`,
    [versionId, definitionId, FOUNDER, 'a'.repeat(64)]
  );
  const runId = randomUUID();
  await svcQuery(p, `insert into workflow_runs (id, workflow_version_id, subject_type, correlation_id) values ($1,$2,'test','corr-4g-seed3')`, [runId, versionId]);
  return { definitionId, versionId, runId };
}

async function cleanup(p: Awaited<ReturnType<typeof pool>>) {
  await svcQuery(p, `delete from workflow_idempotency_keys where correlation_id like 'corr-4g%'`);
  await svcQuery(p, `delete from dead_letter_records where correlation_id like 'corr-4g%'`);
  await svcQuery(p, `delete from scheduled_actions where correlation_id like 'corr-4g%'`);
  await svcQuery(p, `delete from workflow_execution_events where correlation_id like 'corr-4g%'`);
  await svcQuery(p, `delete from workflow_steps where correlation_id like 'corr-4g%'`);
  await svcQuery(p, `delete from workflow_runs where correlation_id like 'corr-4g%'`);
  await svcQuery(p, `delete from workflow_version_history where correlation_id like 'corr-4g%'`);
  await svcQuery(p, `delete from workflow_versions where correlation_id like 'corr-4g%'`);
  await svcQuery(p, `delete from workflow_definitions where correlation_id like 'corr-4g%'`);
  await svcQuery(p, `delete from automation_policy_history where correlation_id like 'corr-4g%'`);
  await svcQuery(p, `delete from automation_policies where correlation_id like 'corr-4g%'`);
  await svcQuery(p, `delete from automation_pause_events where correlation_id like 'corr-4g%'`);
  await svcQuery(p, `delete from automation_pause_controls where correlation_id like 'corr-4g%'`);
}

gated('forced RLS: AAL2 staff read, AAL1 staff and customers blocked, on every Phase 4G table', async () => {
  const p = await pool();
  try {
    const { definitionId, versionId, runId } = await seedActiveWorkflow(p);

    const historyId = randomUUID();
    await svcQuery(p, `insert into workflow_version_history (id, workflow_version_id, version, content_hash, snapshot, created_by, correlation_id) values ($1,$2,1,$3,'{}'::jsonb,$4,'corr-4g-000001')`, [historyId, versionId, 'a'.repeat(64), FOUNDER]);

    const stepId = randomUUID();
    await svcQuery(p, `insert into workflow_steps (id, workflow_run_id, step_index, step_code, action_level, correlation_id) values ($1,$2,0,'test.step','LEVEL_1','corr-4g-000002')`, [stepId, runId]);

    const eventId = randomUUID();
    await svcQuery(p, `insert into workflow_execution_events (id, workflow_run_id, workflow_step_id, kind, actor_id, actor_kind, correlation_id) values ($1,$2,$3,'RUN_CREATED',$4,'system','corr-4g-000003')`, [eventId, runId, stepId, SYSTEM_ACTOR_ID]);

    const policyId = randomUUID();
    await svcQuery(p, `insert into automation_policies (id, policy_code, scope, status, approved_by, approved_at, content_hash, correlation_id) values ($1,'test.policy','GLOBAL','ACTIVE',$2,now(),$3,'corr-4g-000004')`, [policyId, FOUNDER, 'b'.repeat(64)]);
    const policyHistoryId = randomUUID();
    await svcQuery(p, `insert into automation_policy_history (id, automation_policy_id, version, content_hash, snapshot, created_by, correlation_id) values ($1,$2,1,$3,'{}'::jsonb,$4,'corr-4g-000005')`, [policyHistoryId, policyId, 'b'.repeat(64), FOUNDER]);

    const dlrId = randomUUID();
    await svcQuery(p, `insert into dead_letter_records (id, workflow_run_id, workflow_step_id, reason_code, correlation_id) values ($1,$2,$3,'TEST_FAILURE','corr-4g-000006')`, [dlrId, runId, stepId]);

    const scheduledId = randomUUID();
    await svcQuery(p, `insert into scheduled_actions (id, action_code, scheduled_for, workflow_run_id, correlation_id) values ($1,'test.action',now() + interval '1 day',$2,'corr-4g-000007')`, [scheduledId, runId]);

    const pauseId = randomUUID();
    await svcQuery(p, `insert into automation_pause_controls (id, scope, correlation_id) values ($1,'GLOBAL','corr-4g-000008')`, [pauseId]);
    const pauseEventId = randomUUID();
    await svcQuery(p, `insert into automation_pause_events (id, scope, kind, actor_id, correlation_id) values ($1,'GLOBAL','PAUSED',$2,'corr-4g-000009')`, [pauseEventId, FOUNDER]);

    const emergencyEventId = randomUUID();
    await svcQuery(p, `insert into emergency_stop_events (id, kind, actor_id, correlation_id) values ($1,'ACTIVATED',$2,'corr-4g-0000010')`, [emergencyEventId, FOUNDER]);

    const idemKey = `idem-4g-${randomUUID()}`;
    await svcQuery(p, `insert into workflow_idempotency_keys (idempotency_key, workflow_run_id, correlation_id) values ($1,$2,'corr-4g-0000011')`, [idemKey, runId]);

    const tables: [string, string][] = [
      ['workflow_definitions', definitionId], ['workflow_versions', versionId], ['workflow_version_history', historyId],
      ['workflow_runs', runId], ['workflow_steps', stepId], ['workflow_execution_events', eventId],
      ['automation_policies', policyId], ['automation_policy_history', policyHistoryId],
      ['dead_letter_records', dlrId], ['scheduled_actions', scheduledId],
      ['automation_pause_controls', pauseId], ['automation_pause_events', pauseEventId],
      ['emergency_stop_events', emergencyEventId]
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
      const r = await c.query(`select id from emergency_stop_state where id = 1`);
      assert.equal(r.rowCount, 1, 'AAL2 founder reads emergency_stop_state');
      const r2 = await c.query(`select idempotency_key from workflow_idempotency_keys where idempotency_key = $1`, [idemKey]);
      assert.equal(r2.rowCount, 1, 'AAL2 founder reads workflow_idempotency_keys');
    });
    await asRole(p, 'authenticated', claimsFor(STAFF1, 'aal1'), async (c) => {
      const r = await c.query(`select id from emergency_stop_state where id = 1`);
      assert.equal(r.rowCount, 0, 'AAL1 staff blocked from emergency_stop_state');
      const r2 = await c.query(`select idempotency_key from workflow_idempotency_keys where idempotency_key = $1`, [idemKey]);
      assert.equal(r2.rowCount, 0, 'AAL1 staff blocked from workflow_idempotency_keys');
    });

    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('no direct authenticated write policy exists on any Phase 4G table, even for AAL2 founder', async () => {
  const p = await pool();
  try {
    await asRole(p, 'authenticated', claimsFor(FOUNDER, 'aal2'), async (c) => {
      await assert.rejects(
        () => c.query(`insert into workflow_definitions (id, workflow_code, correlation_id) values ($1,'x','c')`, [randomUUID()]),
        (e: unknown) => (e as { code?: string }).code === '42501'
      );
    });
  } finally {
    await p.end();
  }
});

gated('the database rejects an ACTIVE workflow version with no human approver (workflow_versions_active_requires_approval)', async () => {
  const p = await pool();
  try {
    const definitionId = randomUUID();
    await svcQuery(p, `insert into workflow_definitions (id, workflow_code, correlation_id) values ($1,$2,'corr-4g-000012')`, [definitionId, `test.stale.${randomUUID().slice(0, 8)}`]);
    await assert.rejects(
      () => svcQuery(p, `insert into workflow_versions (id, workflow_definition_id, version, step_graph, status, correlation_id) values ($1,$2,1,'{}'::jsonb,'ACTIVE','corr-4g-000013')`, [randomUUID(), definitionId]),
      (e: unknown) => /workflow_versions_active_requires_approval/.test((e as Error).message)
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('only one ACTIVE workflow version may exist per workflow definition (unique partial index)', async () => {
  const p = await pool();
  try {
    const { definitionId } = await seedActiveWorkflow(p);
    await assert.rejects(
      () => svcQuery(
        p,
        `insert into workflow_versions (id, workflow_definition_id, version, step_graph, status, approved_by, approved_at, content_hash, correlation_id)
         values ($1,$2,2,'{}'::jsonb,'ACTIVE',$3,now(),$4,'corr-4g-000014')`,
        [randomUUID(), definitionId, FOUNDER, 'c'.repeat(64)]
      ),
      (e: unknown) => (e as { code?: string }).code === '23505'
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('the database refuses a COMPLETED Level 2 step with no human approval on file', async () => {
  const p = await pool();
  try {
    const { runId } = await seedActiveWorkflow(p);
    await assert.rejects(
      () => svcQuery(p, `insert into workflow_steps (id, workflow_run_id, step_index, step_code, action_level, status, correlation_id) values ($1,$2,0,'sensitive','LEVEL_2','COMPLETED','corr-4g-000015')`, [randomUUID(), runId]),
      (e: unknown) => /workflow_steps_level2_requires_approval_to_complete/.test((e as Error).message)
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('the database refuses a COMPLETED Level 2 step even after ONLY approved_by is set (partial approval insufficient)', async () => {
  const p = await pool();
  try {
    const { runId } = await seedActiveWorkflow(p);
    await assert.rejects(
      () => svcQuery(p, `insert into workflow_steps (id, workflow_run_id, step_index, step_code, action_level, status, approved_by, correlation_id) values ($1,$2,0,'sensitive','LEVEL_2','COMPLETED',$3,'corr-4g-000016')`, [randomUUID(), runId, FOUNDER]),
      (e: unknown) => /workflow_steps_level2_requires_approval_to_complete/.test((e as Error).message)
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('the database refuses a COMPLETED Level 3 step unconditionally, even with full approval fields set', async () => {
  const p = await pool();
  try {
    const { runId } = await seedActiveWorkflow(p);
    await assert.rejects(
      () => svcQuery(
        p,
        `insert into workflow_steps (id, workflow_run_id, step_index, step_code, action_level, status, approved_by, approved_at, approval_content_hash, correlation_id)
         values ($1,$2,0,'forbidden','LEVEL_3','COMPLETED',$3,now(),$4,'corr-4g-000017')`,
        [randomUUID(), runId, FOUNDER, 'd'.repeat(64)]
      ),
      (e: unknown) => /workflow_steps_level3_never_completes/.test((e as Error).message)
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('a Level 1 step completes with no approval fields required', async () => {
  const p = await pool();
  try {
    const { runId } = await seedActiveWorkflow(p);
    const stepId = randomUUID();
    await svcQuery(p, `insert into workflow_steps (id, workflow_run_id, step_index, step_code, action_level, status, correlation_id) values ($1,$2,0,'auto','LEVEL_1','COMPLETED','corr-4g-000018')`, [stepId, runId]);
    const row = await svcQuery(p, `select status from workflow_steps where id = $1`, [stepId]);
    assert.equal(row.rows[0].status, 'COMPLETED');
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('emergency_stop_state is a real singleton — a second row is rejected by the database', async () => {
  const p = await pool();
  try {
    await assert.rejects(
      () => svcQuery(p, `insert into emergency_stop_state (id, active, correlation_id) values (2, false, 'corr-4g-000019')`),
      (e: unknown) => /emergency_stop_state_singleton/.test((e as Error).message)
    );
  } finally {
    await p.end();
  }
});

gated('the database refuses an ACTIVE emergency-stop state with no activating actor', async () => {
  const p = await pool();
  try {
    await assert.rejects(
      () => svcQuery(p, `update emergency_stop_state set active = true, correlation_id = 'corr-4g-000020' where id = 1`),
      (e: unknown) => /emergency_stop_state_active_requires_actor/.test((e as Error).message)
    );
    const row = await svcQuery(p, `select active from emergency_stop_state where id = 1`);
    assert.equal(row.rows[0].active, false);
  } finally {
    await p.end();
  }
});

gated('only one GLOBAL pause control row may exist (unique partial index)', async () => {
  const p = await pool();
  try {
    await svcQuery(p, `insert into automation_pause_controls (id, scope, correlation_id) values ($1,'GLOBAL','corr-4g-000021')`, [randomUUID()]);
    await assert.rejects(
      () => svcQuery(p, `insert into automation_pause_controls (id, scope, correlation_id) values ($1,'GLOBAL','corr-4g-000022')`, [randomUUID()]),
      (e: unknown) => (e as { code?: string }).code === '23505'
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('only one pause control row may exist per distinct scope_key (unique partial index)', async () => {
  const p = await pool();
  try {
    await svcQuery(p, `insert into automation_pause_controls (id, scope, scope_key, correlation_id) values ($1,'AGENT','crm-agent','corr-4g-000023')`, [randomUUID()]);
    await assert.rejects(
      () => svcQuery(p, `insert into automation_pause_controls (id, scope, scope_key, correlation_id) values ($1,'AGENT','crm-agent','corr-4g-000024')`, [randomUUID()]),
      (e: unknown) => (e as { code?: string }).code === '23505'
    );
    await svcQuery(p, `insert into automation_pause_controls (id, scope, scope_key, correlation_id) values ($1,'AGENT','voice-agent','corr-4g-000025')`, [randomUUID()]);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('the database rejects a paused control row with no pausing actor', async () => {
  const p = await pool();
  try {
    await assert.rejects(
      () => svcQuery(p, `insert into automation_pause_controls (id, scope, paused, correlation_id) values ($1,'GLOBAL',true,'corr-4g-000026')`, [randomUUID()]),
      (e: unknown) => /automation_pause_controls_paused_requires_actor/.test((e as Error).message)
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('a duplicate workflow idempotency key is rejected by the real primary key constraint', async () => {
  const p = await pool();
  try {
    const { runId: runA } = await seedActiveWorkflow(p);
    const { runId: runB } = await seedActiveWorkflow(p);
    const key = `idem-4g-dup-${randomUUID()}`;
    await svcQuery(p, `insert into workflow_idempotency_keys (idempotency_key, workflow_run_id, correlation_id) values ($1,$2,'corr-4g-000027')`, [key, runA]);
    await assert.rejects(
      () => svcQuery(p, `insert into workflow_idempotency_keys (idempotency_key, workflow_run_id, correlation_id) values ($1,$2,'corr-4g-000028')`, [key, runB]),
      (e: unknown) => (e as { code?: string }).code === '23505'
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('concurrent duplicate idempotency-key inserts produce exactly one winner under real concurrent load', async () => {
  const p = await pool();
  try {
    const { runId } = await seedActiveWorkflow(p);
    const key = `idem-4g-concurrent-${randomUUID()}`;
    const insertKey = async () => {
      const c = await p.connect();
      try {
        await c.query('set role service_role');
        await c.query(`insert into workflow_idempotency_keys (idempotency_key, workflow_run_id, correlation_id) values ($1,$2,'corr-4g-concurrent')`, [key, runId]);
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

gated('workflow_execution_events is append-only: AAL2 staff UPDATE/DELETE affect zero rows under RLS, row provably unchanged', async () => {
  const p = await pool();
  try {
    const { runId } = await seedActiveWorkflow(p);
    const eventId = randomUUID();
    await svcQuery(p, `insert into workflow_execution_events (id, workflow_run_id, kind, actor_id, actor_kind, correlation_id) values ($1,$2,'RUN_CREATED',$3,'system','corr-4g-000029')`, [eventId, runId, SYSTEM_ACTOR_ID]);
    await asRole(p, 'authenticated', claimsFor(FOUNDER, 'aal2'), async (c) => {
      const updateResult = await c.query(`update workflow_execution_events set kind = 'TAMPERED' where id = $1`, [eventId]);
      assert.equal(updateResult.rowCount, 0);
      const deleteResult = await c.query(`delete from workflow_execution_events where id = $1`, [eventId]);
      assert.equal(deleteResult.rowCount, 0);
    });
    const stillThere = await svcQuery(p, `select kind from workflow_execution_events where id = $1`, [eventId]);
    assert.equal(stillThere.rows[0].kind, 'RUN_CREATED');
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('workflow_version_history is append-only: AAL2 staff UPDATE/DELETE affect zero rows, row provably unchanged', async () => {
  const p = await pool();
  try {
    const { versionId } = await seedActiveWorkflow(p);
    const historyId = randomUUID();
    await svcQuery(p, `insert into workflow_version_history (id, workflow_version_id, version, content_hash, snapshot, created_by, correlation_id) values ($1,$2,1,$3,'{}'::jsonb,$4,'corr-4g-000030')`, [historyId, versionId, 'e'.repeat(64), FOUNDER]);
    await asRole(p, 'authenticated', claimsFor(FOUNDER, 'aal2'), async (c) => {
      const updateResult = await c.query(`update workflow_version_history set content_hash = $1 where id = $2`, ['f'.repeat(64), historyId]);
      assert.equal(updateResult.rowCount, 0);
    });
    const stillThere = await svcQuery(p, `select content_hash from workflow_version_history where id = $1`, [historyId]);
    assert.equal(stillThere.rows[0].content_hash, 'e'.repeat(64));
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('the database refuses a resolved dead-letter record with no resolving actor', async () => {
  const p = await pool();
  try {
    const { runId } = await seedActiveWorkflow(p);
    await assert.rejects(
      () => svcQuery(p, `insert into dead_letter_records (id, workflow_run_id, reason_code, resolved, correlation_id) values ($1,$2,'FAILURE',true,'corr-4g-000031')`, [randomUUID(), runId]),
      (e: unknown) => /dead_letter_resolved_requires_resolver/.test((e as Error).message)
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('the database refuses a CANCELLED scheduled action with no cancelling actor', async () => {
  const p = await pool();
  try {
    await assert.rejects(
      () => svcQuery(p, `insert into scheduled_actions (id, action_code, scheduled_for, status, correlation_id) values ($1,'test.action',now(),'CANCELLED','corr-4g-000032')`, [randomUUID()]),
      (e: unknown) => /scheduled_actions_cancelled_requires_actor/.test((e as Error).message)
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('dead-letter records for one workflow run are never returned when querying another run\'s dead letters', async () => {
  const p = await pool();
  try {
    const { runId: runA } = await seedActiveWorkflow(p);
    const { runId: runB } = await seedActiveWorkflow(p);
    await svcQuery(p, `insert into dead_letter_records (id, workflow_run_id, reason_code, correlation_id) values ($1,$2,'FAILURE_A','corr-4g-000033')`, [randomUUID(), runA]);
    const dlrForB = await svcQuery(p, `select id from dead_letter_records where workflow_run_id = $1`, [runB]);
    assert.equal(dlrForB.rowCount, 0);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('no Phase 4G table has a column suggesting a credential, secret, password, or API key is stored', async () => {
  const p = await pool();
  try {
    const result = await svcQuery(
      p,
      `select table_name, column_name from information_schema.columns
       where table_schema = 'public' and table_name in ('workflow_definitions','workflow_versions','workflow_version_history','workflow_runs','workflow_steps','workflow_execution_events','automation_policies','automation_policy_history','dead_letter_records','scheduled_actions','automation_pause_controls','automation_pause_events','emergency_stop_state','emergency_stop_events','workflow_idempotency_keys')
       and (column_name ilike '%password%' or column_name ilike '%api_key%' or column_name ilike '%api_secret%' or column_name ilike '%credential%' or column_name ilike '%token%' or column_name ilike '%secret%')`
    );
    assert.equal(result.rowCount, 0, `found suspicious columns: ${JSON.stringify(result.rows)}`);
  } finally {
    await p.end();
  }
});
