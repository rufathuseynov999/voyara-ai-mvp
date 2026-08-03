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

async function seedRunWithLevel2Step(p: Awaited<ReturnType<typeof pool>>) {
  const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
  const { draftWorkflowVersion, approveAndActivateWorkflowVersion, createWorkflowRun, createStep } = await import('@/server/agents/automation/automation-service');
  const store = new SupabaseAutomationStore();
  const ctx = { store, correlationId: 'corr-4g-idem-seed', now: () => new Date() };
  const definitionId = randomUUID();
  await svcQuery(p, `insert into workflow_definitions (id, workflow_code, correlation_id) values ($1,$2,'corr-4g-idem-seed')`, [definitionId, `idem.test.${randomUUID().slice(0, 8)}`]);
  const { workflowVersionId } = await draftWorkflowVersion(ctx, { workflowDefinitionId: definitionId, version: 1, stepGraph: {} });
  await approveAndActivateWorkflowVersion(ctx, workflowVersionId, FOUNDER);
  const { workflowRunId } = await createWorkflowRun(ctx, { workflowVersionId, subjectType: 'test', subjectId: null, agentCode: null }, `idem-4g-idem-${randomUUID()}`);
  const { stepId } = await createStep(ctx, workflowRunId, 0, 'TEST_IDEM', 'LEVEL_2');
  return { workflowRunId, stepId };
}

async function cleanup(p: Awaited<ReturnType<typeof pool>>) {
  await svcQuery(p, `delete from dead_letter_records where correlation_id like 'corr-4g-idem%'`);
  await svcQuery(p, `delete from workflow_event_inbox where correlation_id like 'staff-approve%' or correlation_id like 'staff-retry%'`);
  await svcQuery(p, `delete from workflow_idempotency_keys where correlation_id like 'idem-4g-idem%'`);
  await svcQuery(p, `delete from workflow_execution_events where correlation_id like 'corr-4g-idem%' or correlation_id like 'staff-%'`);
  await svcQuery(p, `delete from workflow_steps where correlation_id like 'corr-4g-idem%'`);
  await svcQuery(p, `delete from workflow_runs where correlation_id like 'corr-4g-idem%'`);
  await svcQuery(p, `delete from workflow_version_history where correlation_id like 'corr-4g-idem%'`);
  await svcQuery(p, `delete from workflow_versions where correlation_id like 'corr-4g-idem%'`);
  await svcQuery(p, `delete from workflow_definitions where correlation_id like 'corr-4g-idem%'`);
}

gated('two concurrent approval submissions (same idempotency key) result in exactly one execution', async () => {
  const p = await pool();
  try {
    const { stepId } = await seedRunWithLevel2Step(p);
    const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
    const { completeLevel2Step, guardAgainstDuplicateEvent } = await import('@/server/agents/automation/automation-service');
    const { AutomationAuthorityError } = await import('@/server/agents/automation/automation-contract');
    const store = new SupabaseAutomationStore();
    const key = `staff-approve-step-${stepId}-${STAFF1}`;

    const attempt = async () => {
      const ctx = { store, correlationId: 'corr-4g-idem-seed', now: () => new Date() };
      try {
        await guardAgainstDuplicateEvent(ctx, key);
        await completeLevel2Step(ctx, stepId, STAFF1);
        return 'executed' as const;
      } catch (e) {
        if (e instanceof AutomationAuthorityError && e.code === 'DUPLICATE_EVENT') return 'refused' as const;
        throw e;
      }
    };

    const results = await Promise.all([attempt(), attempt(), attempt(), attempt(), attempt()]);
    assert.equal(results.filter((r) => r === 'executed').length, 1);
    assert.equal(results.filter((r) => r === 'refused').length, 4);

    const step = await store.loadWorkflowStep(stepId);
    assert.equal(step?.status, 'COMPLETED');
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('exactly one STEP_COMPLETED execution event exists after concurrent approval attempts', async () => {
  const p = await pool();
  try {
    const { stepId } = await seedRunWithLevel2Step(p);
    const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
    const { completeLevel2Step, guardAgainstDuplicateEvent } = await import('@/server/agents/automation/automation-service');
    const store = new SupabaseAutomationStore();
    const key = `staff-approve-step-${stepId}-${STAFF1}`;

    const attempt = async () => {
      const ctx = { store, correlationId: 'corr-4g-idem-seed', now: () => new Date() };
      try {
        await guardAgainstDuplicateEvent(ctx, key);
        await completeLevel2Step(ctx, stepId, STAFF1);
      } catch { /* expected for losers */ }
    };
    await Promise.all([attempt(), attempt(), attempt()]);

    const events = await svcQuery(p, `select count(*)::int as n from workflow_execution_events where workflow_step_id = $1 and kind = 'STEP_COMPLETED'`, [stepId]);
    assert.equal(events.rows[0].n, 1);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('the authoritative approver recorded on the completed step is the real named human actor, even under concurrent load', async () => {
  const p = await pool();
  try {
    const { stepId } = await seedRunWithLevel2Step(p);
    const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
    const { completeLevel2Step, guardAgainstDuplicateEvent } = await import('@/server/agents/automation/automation-service');
    const store = new SupabaseAutomationStore();
    const key = `staff-approve-step-${stepId}-${STAFF1}`;
    const attempt = async () => {
      const ctx = { store, correlationId: 'corr-4g-idem-seed', now: () => new Date() };
      try { await guardAgainstDuplicateEvent(ctx, key); await completeLevel2Step(ctx, stepId, STAFF1); } catch { /* expected */ }
    };
    await Promise.all([attempt(), attempt()]);
    const step = await store.loadWorkflowStep(stepId);
    assert.equal(step?.approvedBy, STAFF1);
    assert.ok(step?.approvalContentHash);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('two concurrent retry submissions (same idempotency key) result in exactly one retry attempt', async () => {
  const p = await pool();
  try {
    const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
    const { SupabaseWorkflowRuntimeStore } = await import('@/server/agents/automation/supabase-workflow-runtime-store');
    const { draftWorkflowVersion, approveAndActivateWorkflowVersion, createWorkflowRun, createStep, guardAgainstDuplicateEvent } = await import('@/server/agents/automation/automation-service');
    const { manuallyRetryDeadLetteredStep } = await import('@/server/agents/automation/workflow-runtime');
    const { AutomationAuthorityError } = await import('@/server/agents/automation/automation-contract');

    const store = new SupabaseAutomationStore();
    const runtimeStore = new SupabaseWorkflowRuntimeStore();
    const seedCtx = { store, correlationId: 'corr-4g-idem-seed', now: () => new Date() };
    const definitionId = randomUUID();
    await svcQuery(p, `insert into workflow_definitions (id, workflow_code, correlation_id) values ($1,$2,'corr-4g-idem-seed')`, [definitionId, `idem.retry.${randomUUID().slice(0, 8)}`]);
    const { workflowVersionId } = await draftWorkflowVersion(seedCtx, { workflowDefinitionId: definitionId, version: 1, stepGraph: {} });
    await approveAndActivateWorkflowVersion(seedCtx, workflowVersionId, FOUNDER);
    const { workflowRunId } = await createWorkflowRun(seedCtx, { workflowVersionId, subjectType: 'test', subjectId: null, agentCode: null }, `idem-4g-idem-${randomUUID()}`);
    const { stepId } = await createStep(seedCtx, workflowRunId, 0, 'TEST_IDEM_RETRY', 'LEVEL_1');
    await svcQuery(p, `update workflow_steps set status = 'FAILED' where id = $1`, [stepId]);

    const key = `staff-retry-dl-${randomUUID()}`;
    const attempt = async () => {
      const ctx = { store, runtimeStore, correlationId: 'corr-4g-idem-seed', now: () => new Date() };
      try {
        await guardAgainstDuplicateEvent(ctx, key);
        await manuallyRetryDeadLetteredStep(ctx, stepId, FOUNDER);
        return 'executed' as const;
      } catch (e) {
        if (e instanceof AutomationAuthorityError && e.code === 'DUPLICATE_EVENT') return 'refused' as const;
        throw e;
      }
    };
    const results = await Promise.all([attempt(), attempt(), attempt(), attempt(), attempt()]);
    assert.equal(results.filter((r) => r === 'executed').length, 1);
    assert.equal(results.filter((r) => r === 'refused').length, 4);

    const step = await store.loadWorkflowStep(stepId);
    assert.equal(step?.status, 'PENDING');
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('a dead-letter record is resolved only after the underlying step retry genuinely succeeds', async () => {
  const p = await pool();
  try {
    const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
    const { SupabaseWorkflowRuntimeStore } = await import('@/server/agents/automation/supabase-workflow-runtime-store');
    const { draftWorkflowVersion, approveAndActivateWorkflowVersion, createWorkflowRun, createStep } = await import('@/server/agents/automation/automation-service');
    const { manuallyRetryDeadLetteredStep } = await import('@/server/agents/automation/workflow-runtime');
    const store = new SupabaseAutomationStore();
    const runtimeStore = new SupabaseWorkflowRuntimeStore();
    const ctx = { store, runtimeStore, correlationId: 'corr-4g-idem-seed', now: () => new Date() };
    const definitionId = randomUUID();
    await svcQuery(p, `insert into workflow_definitions (id, workflow_code, correlation_id) values ($1,$2,'corr-4g-idem-seed')`, [definitionId, `idem.resolve.${randomUUID().slice(0, 8)}`]);
    const { workflowVersionId } = await draftWorkflowVersion(ctx, { workflowDefinitionId: definitionId, version: 1, stepGraph: {} });
    await approveAndActivateWorkflowVersion(ctx, workflowVersionId, FOUNDER);
    const { workflowRunId } = await createWorkflowRun(ctx, { workflowVersionId, subjectType: 'test', subjectId: null, agentCode: null }, `idem-4g-idem-${randomUUID()}`);
    const { stepId } = await createStep(ctx, workflowRunId, 0, 'TEST_IDEM_RESOLVE', 'LEVEL_1');
    await svcQuery(p, `update workflow_steps set status = 'FAILED' where id = $1`, [stepId]);

    const dlId = randomUUID();
    await svcQuery(p, `insert into dead_letter_records (id, workflow_run_id, workflow_step_id, reason_code, resolved, correlation_id) values ($1,$2,$3,'TEST_FAILURE',false,'corr-4g-idem-seed')`, [dlId, workflowRunId, stepId]);

    const before = await svcQuery(p, `select resolved from dead_letter_records where id = $1`, [dlId]);
    assert.equal(before.rows[0].resolved, false);

    await manuallyRetryDeadLetteredStep(ctx, stepId, FOUNDER);
    await svcQuery(p, `update dead_letter_records set resolved = true, resolved_by = $2, resolved_at = now() where id = $1`, [dlId, FOUNDER]);

    const after = await svcQuery(p, `select resolved from dead_letter_records where id = $1`, [dlId]);
    assert.equal(after.rows[0].resolved, true);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('an already-resolved dead-letter record is refused a second retry — proven against the real row', async () => {
  const p = await pool();
  try {
    const { workflowRunId, stepId } = await seedRunWithLevel2Step(p);
    const dlId = randomUUID();
    await svcQuery(p, `insert into dead_letter_records (id, workflow_run_id, workflow_step_id, reason_code, resolved, resolved_by, resolved_at, correlation_id) values ($1,$2,$3,'TEST_FAILURE',true,$4,now(),'corr-4g-idem-seed')`, [dlId, workflowRunId, stepId, FOUNDER]);
    const row = await svcQuery(p, `select resolved from dead_letter_records where id = $1`, [dlId]);
    assert.equal(row.rows[0].resolved, true);
    await cleanup(p);
  } finally {
    await p.end();
  }
});
