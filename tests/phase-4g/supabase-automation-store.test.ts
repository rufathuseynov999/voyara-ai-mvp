import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

const PG_URL = process.env.VOYARA_PG_TEST_URL;
const gated = PG_URL ? test : test.skip;

const FOUNDER = '55555555-5555-4555-8555-555555555555';
const STAFF1 = '33333333-3333-4333-8333-333333333333';

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

async function cleanup(p: Awaited<ReturnType<typeof pool>>) {
  await svcQuery(p, `delete from workflow_idempotency_keys where correlation_id like 'corr-4g-store%'`);
  await svcQuery(p, `delete from workflow_execution_events where correlation_id like 'corr-4g-store%'`);
  await svcQuery(p, `delete from dead_letter_records where correlation_id like 'corr-4g-store%'`);
  await svcQuery(p, `delete from workflow_steps where correlation_id like 'corr-4g-store%'`);
  await svcQuery(p, `delete from workflow_runs where correlation_id like 'corr-4g-store%'`);
  await svcQuery(p, `delete from workflow_version_history where correlation_id like 'corr-4g-store%'`);
  await svcQuery(p, `delete from workflow_versions where correlation_id like 'corr-4g-store%'`);
  await svcQuery(p, `delete from workflow_definitions where correlation_id like 'corr-4g-store%'`);
}

async function seedDefinition(p: Awaited<ReturnType<typeof pool>>) {
  const id = randomUUID();
  await svcQuery(p, `insert into workflow_definitions (id, workflow_code, correlation_id) values ($1,$2,'corr-4g-store-seed')`, [id, `store.test.${randomUUID().slice(0, 8)}`]);
  return id;
}

gated('draftWorkflowVersion + approveAndActivateWorkflowVersion, run through the real store, produces a genuine ACTIVE version with a verifiable content hash', async () => {
  const p = await pool();
  try {
    const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
    const { draftWorkflowVersion, approveAndActivateWorkflowVersion } = await import('@/server/agents/automation/automation-service');
    const store = new SupabaseAutomationStore();
    const ctx = { store, correlationId: 'corr-4g-store-seed', now: () => new Date() };

    const definitionId = await seedDefinition(p);
    const { workflowVersionId } = await draftWorkflowVersion(ctx, { workflowDefinitionId: definitionId, version: 1, stepGraph: { steps: [] } });
    await approveAndActivateWorkflowVersion(ctx, workflowVersionId, FOUNDER);

    const loaded = await store.loadWorkflowVersion(workflowVersionId);
    assert.equal(loaded?.status, 'ACTIVE');
    assert.equal(loaded?.approvedBy, FOUNDER);
    assert.ok(loaded?.contentHash);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('createWorkflowRun + createStep, run through the real store, create genuine PostgreSQL rows readable back through the same store', async () => {
  const p = await pool();
  try {
    const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
    const { draftWorkflowVersion, approveAndActivateWorkflowVersion, createWorkflowRun, createStep } = await import('@/server/agents/automation/automation-service');
    const store = new SupabaseAutomationStore();
    const ctx = { store, correlationId: 'corr-4g-store-seed', now: () => new Date() };

    const definitionId = await seedDefinition(p);
    const { workflowVersionId } = await draftWorkflowVersion(ctx, { workflowDefinitionId: definitionId, version: 1, stepGraph: {} });
    await approveAndActivateWorkflowVersion(ctx, workflowVersionId, FOUNDER);

    const { workflowRunId } = await createWorkflowRun(ctx, { workflowVersionId, subjectType: 'test', subjectId: null, agentCode: null }, `idem-4g-store-${randomUUID()}`);
    const { stepId } = await createStep(ctx, workflowRunId, 0, 'TEST_STEP', 'LEVEL_2');

    const loadedRun = await store.loadWorkflowRun(workflowRunId);
    const loadedStep = await store.loadWorkflowStep(stepId);
    assert.ok(loadedRun);
    assert.equal(loadedStep?.actionLevel, 'LEVEL_2');
    assert.equal(loadedStep?.status, 'PENDING');
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('completeLevel2Step, run through the real store, succeeds with a real human approver and writes a real execution event', async () => {
  const p = await pool();
  try {
    const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
    const { draftWorkflowVersion, approveAndActivateWorkflowVersion, createWorkflowRun, createStep, completeLevel2Step } = await import('@/server/agents/automation/automation-service');
    const store = new SupabaseAutomationStore();
    const ctx = { store, correlationId: 'corr-4g-store-seed', now: () => new Date() };

    const definitionId = await seedDefinition(p);
    const { workflowVersionId } = await draftWorkflowVersion(ctx, { workflowDefinitionId: definitionId, version: 1, stepGraph: {} });
    await approveAndActivateWorkflowVersion(ctx, workflowVersionId, FOUNDER);
    const { workflowRunId } = await createWorkflowRun(ctx, { workflowVersionId, subjectType: 'test', subjectId: null, agentCode: null }, `idem-4g-store-${randomUUID()}`);
    const { stepId } = await createStep(ctx, workflowRunId, 0, 'TEST_L2_STEP', 'LEVEL_2');

    await completeLevel2Step(ctx, stepId, STAFF1);
    const step = await store.loadWorkflowStep(stepId);
    assert.equal(step?.status, 'COMPLETED');
    assert.equal(step?.approvedBy, STAFF1);

    const events = await svcQuery(p, `select kind, reason_code from workflow_execution_events where workflow_step_id = $1`, [stepId]);
    assert.ok(events.rows.some((r) => r.kind === 'STEP_COMPLETED' && r.reason_code === 'LEVEL_2_APPROVED'));
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('a second completeLevel2Step call on an already-COMPLETED step is refused — genuine single-use enforcement against real data', async () => {
  const p = await pool();
  try {
    const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
    const { draftWorkflowVersion, approveAndActivateWorkflowVersion, createWorkflowRun, createStep, completeLevel2Step } = await import('@/server/agents/automation/automation-service');
    const store = new SupabaseAutomationStore();
    const ctx = { store, correlationId: 'corr-4g-store-seed', now: () => new Date() };

    const definitionId = await seedDefinition(p);
    const { workflowVersionId } = await draftWorkflowVersion(ctx, { workflowDefinitionId: definitionId, version: 1, stepGraph: {} });
    await approveAndActivateWorkflowVersion(ctx, workflowVersionId, FOUNDER);
    const { workflowRunId } = await createWorkflowRun(ctx, { workflowVersionId, subjectType: 'test', subjectId: null, agentCode: null }, `idem-4g-store-${randomUUID()}`);
    const { stepId } = await createStep(ctx, workflowRunId, 0, 'TEST_L2_DUP', 'LEVEL_2');

    await completeLevel2Step(ctx, stepId, STAFF1);
    await assert.rejects(() => completeLevel2Step(ctx, stepId, STAFF1));
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('the database structurally refuses a Level 3 step to ever reach COMPLETED, even with a direct write attempt', async () => {
  const p = await pool();
  try {
    const definitionId = await seedDefinition(p);
    const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
    const { draftWorkflowVersion, approveAndActivateWorkflowVersion, createWorkflowRun, createStep } = await import('@/server/agents/automation/automation-service');
    const store = new SupabaseAutomationStore();
    const ctx = { store, correlationId: 'corr-4g-store-seed', now: () => new Date() };
    const { workflowVersionId } = await draftWorkflowVersion(ctx, { workflowDefinitionId: definitionId, version: 1, stepGraph: {} });
    await approveAndActivateWorkflowVersion(ctx, workflowVersionId, FOUNDER);
    const { workflowRunId } = await createWorkflowRun(ctx, { workflowVersionId, subjectType: 'test', subjectId: null, agentCode: null }, `idem-4g-store-${randomUUID()}`);
    const { stepId } = await createStep(ctx, workflowRunId, 0, 'TEST_L3', 'LEVEL_3');

    await assert.rejects(
      () => svcQuery(p, `update workflow_steps set status = 'COMPLETED' where id = $1`, [stepId]),
      (e: unknown) => /workflow_steps_level3_never_completes/.test((e as Error).message)
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('workflow_execution_events written by the real store are append-only under RLS', async () => {
  const p = await pool();
  try {
    const definitionId = await seedDefinition(p);
    const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
    const { draftWorkflowVersion, approveAndActivateWorkflowVersion, createWorkflowRun, createStep, completeLevel2Step } = await import('@/server/agents/automation/automation-service');
    const store = new SupabaseAutomationStore();
    const ctx = { store, correlationId: 'corr-4g-store-seed', now: () => new Date() };
    const { workflowVersionId } = await draftWorkflowVersion(ctx, { workflowDefinitionId: definitionId, version: 1, stepGraph: {} });
    await approveAndActivateWorkflowVersion(ctx, workflowVersionId, FOUNDER);
    const { workflowRunId } = await createWorkflowRun(ctx, { workflowVersionId, subjectType: 'test', subjectId: null, agentCode: null }, `idem-4g-store-${randomUUID()}`);
    const { stepId } = await createStep(ctx, workflowRunId, 0, 'TEST_IMMUT', 'LEVEL_2');
    await completeLevel2Step(ctx, stepId, STAFF1);

    const eventRow = await svcQuery(p, `select id, kind from workflow_execution_events where workflow_step_id = $1 limit 1`, [stepId]);
    const eventId = eventRow.rows[0].id as string;
    await asRole(p, 'authenticated', claimsFor(FOUNDER, 'aal2'), async (c) => {
      const updateResult = await c.query(`update workflow_execution_events set kind = 'TAMPERED' where id = $1`, [eventId]);
      assert.equal(updateResult.rowCount, 0);
    });
    const stillThere = await svcQuery(p, `select kind from workflow_execution_events where id = $1`, [eventId]);
    assert.notEqual(stillThere.rows[0].kind, 'TAMPERED');
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('reserveWorkflowIdempotencyKey via the real store produces exactly one winner under real concurrent load', async () => {
  const p = await pool();
  try {
    const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
    const key = `idem-4g-store-concurrent-${randomUUID()}`;
    const attempt = async () => {
      try {
        const store = new SupabaseAutomationStore();
        const result = await store.reserveWorkflowIdempotencyKey(key, randomUUID());
        return result.winner ? ('ok' as const) : ('dup' as const);
      } catch { return 'dup' as const; }
    };
    const results = await Promise.all([attempt(), attempt(), attempt(), attempt(), attempt()]);
    assert.equal(results.filter((r) => r === 'ok').length, 1);
    await svcQuery(p, `delete from workflow_idempotency_keys where idempotency_key = $1`, [key]);
  } finally {
    await p.end();
  }
});

gated('a dead-letter record created directly reflects real workflow_run linkage through the store-compatible schema', async () => {
  const p = await pool();
  try {
    const definitionId = await seedDefinition(p);
    const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
    const { draftWorkflowVersion, approveAndActivateWorkflowVersion, createWorkflowRun } = await import('@/server/agents/automation/automation-service');
    const store = new SupabaseAutomationStore();
    const ctx = { store, correlationId: 'corr-4g-store-seed', now: () => new Date() };
    const { workflowVersionId } = await draftWorkflowVersion(ctx, { workflowDefinitionId: definitionId, version: 1, stepGraph: {} });
    await approveAndActivateWorkflowVersion(ctx, workflowVersionId, FOUNDER);
    const { workflowRunId } = await createWorkflowRun(ctx, { workflowVersionId, subjectType: 'test', subjectId: null, agentCode: null }, `idem-4g-store-${randomUUID()}`);

    const dlId = randomUUID();
    await svcQuery(p, `insert into dead_letter_records (id, workflow_run_id, reason_code, resolved, correlation_id) values ($1,$2,'TEST_FAILURE',false,'corr-4g-store-seed')`, [dlId, workflowRunId]);
    const row = await svcQuery(p, `select workflow_run_id, resolved from dead_letter_records where id = $1`, [dlId]);
    assert.equal(row.rows[0].workflow_run_id, workflowRunId);
    assert.equal(row.rows[0].resolved, false);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('savePauseControl + loadPauseControl through the real store persist and read back a GLOBAL pause correctly', async () => {
  const p = await pool();
  try {
    // Pre-emptive cleanup: a prior failed run of this exact test must
    // never leave the GLOBAL scope permanently occupied.
    await svcQuery(p, `delete from automation_pause_controls where scope = 'GLOBAL'`);
    const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
    const store = new SupabaseAutomationStore();
    const now = new Date().toISOString();
    await store.savePauseControl({ scope: 'GLOBAL', scopeKey: null, paused: true, pausedBy: FOUNDER, pausedAt: now, reason: 'TEST_MAINTENANCE', resumedBy: null, resumedAt: null });
    const loaded = await store.loadPauseControl('GLOBAL', null);
    assert.equal(loaded?.paused, true);
    assert.equal(loaded?.pausedBy, FOUNDER);
  } finally {
    // Must fully DELETE the row this test created, not merely write
    // another row with paused: false — automation_pause_controls has a
    // real unique partial index on (scope) WHERE scope = 'GLOBAL', and
    // other sandbox test files (automation-sandbox.test.ts,
    // founder-controls-sandbox.test.ts) assume a clean slate for GLOBAL
    // before their own first insert. Leaving any row behind — even a
    // "resolved" one — collides with those tests and is a genuine
    // pollution bug this file must not reintroduce.
    await svcQuery(p, `delete from automation_pause_controls where scope = 'GLOBAL'`);
    await p.end();
  }
});

gated('saveEmergencyStopState + loadEmergencyStopState through the real store round-trip correctly, then reset', async () => {
  const p = await pool();
  try {
    const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
    const store = new SupabaseAutomationStore();
    const before = await store.loadEmergencyStopState();
    assert.equal(before.active, false);

    await store.saveEmergencyStopState({ active: true, activatedBy: FOUNDER, activatedAt: new Date().toISOString(), reason: 'TEST_INCIDENT' });
    const during = await store.loadEmergencyStopState();
    assert.equal(during.active, true);

    await store.saveEmergencyStopState({ active: false, activatedBy: null, activatedAt: null, reason: null });
    const after = await store.loadEmergencyStopState();
    assert.equal(after.active, false);
  } finally {
    await p.end();
  }
});

gated('no direct authenticated write policy exists on workflow_runs, even for AAL2 founder', async () => {
  const p = await pool();
  try {
    await asRole(p, 'authenticated', claimsFor(FOUNDER, 'aal2'), async (c) => {
      await assert.rejects(
        () => c.query(`insert into workflow_runs (id, workflow_version_id, subject_type, correlation_id) values ($1,$2,'test','c')`, [randomUUID(), randomUUID()]),
        (e: unknown) => (e as { code?: string }).code === '42501'
      );
    });
  } finally {
    await p.end();
  }
});

gated('forced RLS: AAL2 founder reads workflow_runs; AAL1 staff is blocked', async () => {
  const p = await pool();
  try {
    const definitionId = await seedDefinition(p);
    const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
    const { draftWorkflowVersion, approveAndActivateWorkflowVersion, createWorkflowRun } = await import('@/server/agents/automation/automation-service');
    const store = new SupabaseAutomationStore();
    const ctx = { store, correlationId: 'corr-4g-store-seed', now: () => new Date() };
    const { workflowVersionId } = await draftWorkflowVersion(ctx, { workflowDefinitionId: definitionId, version: 1, stepGraph: {} });
    await approveAndActivateWorkflowVersion(ctx, workflowVersionId, FOUNDER);
    const { workflowRunId } = await createWorkflowRun(ctx, { workflowVersionId, subjectType: 'test', subjectId: null, agentCode: null }, `idem-4g-store-${randomUUID()}`);

    await asRole(p, 'authenticated', claimsFor(FOUNDER, 'aal2'), async (c) => {
      const r = await c.query(`select id from workflow_runs where id = $1`, [workflowRunId]);
      assert.equal(r.rowCount, 1);
    });
    await asRole(p, 'authenticated', claimsFor(STAFF1, 'aal1'), async (c) => {
      const r = await c.query(`select id from workflow_runs where id = $1`, [workflowRunId]);
      assert.equal(r.rowCount, 0);
    });
    await cleanup(p);
  } finally {
    await p.end();
  }
});
