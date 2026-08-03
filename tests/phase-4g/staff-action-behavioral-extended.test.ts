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

async function seedRunWithStep(p: Awaited<ReturnType<typeof pool>>, actionLevel: 'LEVEL_0' | 'LEVEL_1' | 'LEVEL_2' | 'LEVEL_3', stepStatus?: string) {
  const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
  const { draftWorkflowVersion, approveAndActivateWorkflowVersion, createWorkflowRun, createStep } = await import('@/server/agents/automation/automation-service');
  const store = new SupabaseAutomationStore();
  const ctx = { store, correlationId: 'corr-4g-behav-seed', now: () => new Date() };
  const definitionId = randomUUID();
  await svcQuery(p, `insert into workflow_definitions (id, workflow_code, correlation_id) values ($1,$2,'corr-4g-behav-seed')`, [definitionId, `behav.test.${randomUUID().slice(0, 8)}`]);
  const { workflowVersionId } = await draftWorkflowVersion(ctx, { workflowDefinitionId: definitionId, version: 1, stepGraph: {} });
  await approveAndActivateWorkflowVersion(ctx, workflowVersionId, FOUNDER);
  const { workflowRunId } = await createWorkflowRun(ctx, { workflowVersionId, subjectType: 'test', subjectId: null, agentCode: null }, `idem-4g-behav-${randomUUID()}`);
  let stepId: string;
  if (actionLevel === 'LEVEL_0') {
    stepId = randomUUID();
    await svcQuery(p, `insert into workflow_steps (id, workflow_run_id, step_index, step_code, action_level, correlation_id) values ($1,$2,0,'TEST_L0','LEVEL_0','corr-4g-behav-seed')`, [stepId, workflowRunId]);
  } else {
    const created = await createStep(ctx, workflowRunId, 0, `TEST_${actionLevel}`, actionLevel);
    stepId = created.stepId;
  }
  if (stepStatus) {
    await svcQuery(p, `update workflow_steps set status = $2 where id = $1`, [stepId, stepStatus]);
  }
  return { workflowRunId, stepId };
}

async function cleanup(p: Awaited<ReturnType<typeof pool>>) {
  await svcQuery(p, `delete from dead_letter_records where correlation_id like 'corr-4g-behav%'`);
  await svcQuery(p, `delete from workflow_idempotency_keys where correlation_id like 'idem-4g-behav%'`);
  await svcQuery(p, `delete from workflow_execution_events where correlation_id like 'corr-4g-behav%'`);
  await svcQuery(p, `delete from workflow_steps where correlation_id like 'corr-4g-behav%'`);
  await svcQuery(p, `delete from workflow_runs where correlation_id like 'corr-4g-behav%'`);
  await svcQuery(p, `delete from workflow_version_history where correlation_id like 'corr-4g-behav%'`);
  await svcQuery(p, `delete from workflow_versions where correlation_id like 'corr-4g-behav%'`);
  await svcQuery(p, `delete from workflow_definitions where correlation_id like 'corr-4g-behav%'`);
}

gated('LEVEL_0 is not even a valid workflow_action_level at the database level — read-only actions are structurally excluded from workflow_steps entirely, a stronger guarantee than a runtime refusal', async () => {
  const p = await pool();
  try {
    await assert.rejects(
      () => svcQuery(p, `insert into workflow_steps (id, workflow_run_id, step_index, step_code, action_level, correlation_id) values ($1,$2,0,'TEST_L0','LEVEL_0','corr-4g-behav-seed')`, [randomUUID(), randomUUID()]),
      (e: unknown) => (e as { code?: string }).code === '22P02'
    );
  } finally {
    await p.end();
  }
});

gated('a Level 1 step is refused by completeLevel2Step', async () => {
  const p = await pool();
  try {
    const { stepId } = await seedRunWithStep(p, 'LEVEL_1');
    const { completeLevel2Step } = await import('@/server/agents/automation/automation-service');
    const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
    const ctx = { store: new SupabaseAutomationStore(), correlationId: 'corr-4g-behav-seed', now: () => new Date() };
    await assert.rejects(
      () => completeLevel2Step(ctx, stepId, STAFF1),
      (e: unknown) => (e as { code?: string }).code === 'MISSING_APPROVAL'
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('a Level 3 step is refused by completeLevel2Step, confirmed again against real data', async () => {
  const p = await pool();
  try {
    const { stepId } = await seedRunWithStep(p, 'LEVEL_3');
    const { completeLevel2Step } = await import('@/server/agents/automation/automation-service');
    const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
    const ctx = { store: new SupabaseAutomationStore(), correlationId: 'corr-4g-behav-seed', now: () => new Date() };
    await assert.rejects(
      () => completeLevel2Step(ctx, stepId, STAFF1),
      (e: unknown) => (e as { code?: string }).code === 'MISSING_APPROVAL'
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('a FAILED Level 2 step is now refused by completeLevel2Step — a real gap found and fixed this block', async () => {
  const p = await pool();
  try {
    const { stepId } = await seedRunWithStep(p, 'LEVEL_2', 'FAILED');
    const { completeLevel2Step } = await import('@/server/agents/automation/automation-service');
    const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
    const ctx = { store: new SupabaseAutomationStore(), correlationId: 'corr-4g-behav-seed', now: () => new Date() };
    await assert.rejects(
      () => completeLevel2Step(ctx, stepId, STAFF1),
      (e: unknown) => (e as { code?: string }).code === 'INVALID_TRANSITION'
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('a SKIPPED Level 2 step is now refused by completeLevel2Step — the same real gap fixed this block', async () => {
  const p = await pool();
  try {
    const { stepId } = await seedRunWithStep(p, 'LEVEL_2', 'SKIPPED');
    const { completeLevel2Step } = await import('@/server/agents/automation/automation-service');
    const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
    const ctx = { store: new SupabaseAutomationStore(), correlationId: 'corr-4g-behav-seed', now: () => new Date() };
    await assert.rejects(
      () => completeLevel2Step(ctx, stepId, STAFF1),
      (e: unknown) => (e as { code?: string }).code === 'INVALID_TRANSITION'
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('a genuinely PENDING Level 2 step still succeeds after this block\'s fix', async () => {
  const p = await pool();
  try {
    const { stepId } = await seedRunWithStep(p, 'LEVEL_2');
    const { completeLevel2Step } = await import('@/server/agents/automation/automation-service');
    const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
    const store = new SupabaseAutomationStore();
    const ctx = { store, correlationId: 'corr-4g-behav-seed', now: () => new Date() };
    await completeLevel2Step(ctx, stepId, STAFF1);
    const step = await store.loadWorkflowStep(stepId);
    assert.equal(step?.status, 'COMPLETED');
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('missing approver identity is refused', async () => {
  const p = await pool();
  try {
    const { stepId } = await seedRunWithStep(p, 'LEVEL_2');
    const { completeLevel2Step } = await import('@/server/agents/automation/automation-service');
    const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
    const ctx = { store: new SupabaseAutomationStore(), correlationId: 'corr-4g-behav-seed', now: () => new Date() };
    await assert.rejects(
      () => completeLevel2Step(ctx, stepId, ''),
      (e: unknown) => (e as { code?: string }).code === 'MISSING_APPROVAL'
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('a genuinely FAILED step retried via manuallyRetryDeadLetteredStep resets it to PENDING and records a distinct retry event', async () => {
  const p = await pool();
  try {
    const { stepId } = await seedRunWithStep(p, 'LEVEL_1', 'FAILED');
    const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
    const { SupabaseWorkflowRuntimeStore } = await import('@/server/agents/automation/supabase-workflow-runtime-store');
    const { manuallyRetryDeadLetteredStep } = await import('@/server/agents/automation/workflow-runtime');
    const store = new SupabaseAutomationStore();
    const runtimeStore = new SupabaseWorkflowRuntimeStore();
    const ctx = { store, runtimeStore, correlationId: 'corr-4g-behav-seed', now: () => new Date() };
    await manuallyRetryDeadLetteredStep(ctx, stepId, FOUNDER);
    const step = await store.loadWorkflowStep(stepId);
    assert.equal(step?.status, 'PENDING');
    const events = await svcQuery(p, `select kind from workflow_execution_events where workflow_step_id = $1`, [stepId]);
    assert.ok(events.rows.some((r) => r.kind === 'STEP_MANUALLY_RETRIED'));
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('manuallyRetryDeadLetteredStep refuses a step that is not genuinely FAILED', async () => {
  const p = await pool();
  try {
    const { stepId } = await seedRunWithStep(p, 'LEVEL_1');
    const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
    const { SupabaseWorkflowRuntimeStore } = await import('@/server/agents/automation/supabase-workflow-runtime-store');
    const { manuallyRetryDeadLetteredStep } = await import('@/server/agents/automation/workflow-runtime');
    const ctx = { store: new SupabaseAutomationStore(), runtimeStore: new SupabaseWorkflowRuntimeStore(), correlationId: 'corr-4g-behav-seed', now: () => new Date() };
    await assert.rejects(
      () => manuallyRetryDeadLetteredStep(ctx, stepId, FOUNDER),
      (e: unknown) => (e as { code?: string }).code === 'INVALID_TRANSITION'
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('original execution-event history remains unchanged after a manual retry', async () => {
  const p = await pool();
  try {
    const { stepId, workflowRunId } = await seedRunWithStep(p, 'LEVEL_1', 'FAILED');
    const originalEventId = randomUUID();
    await svcQuery(p, `insert into workflow_execution_events (id, workflow_run_id, workflow_step_id, kind, actor_id, actor_kind, correlation_id) values ($1,$2,$3,'STEP_FAILED',$4,'system','corr-4g-behav-seed')`, [originalEventId, workflowRunId, stepId, FOUNDER]);

    const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
    const { SupabaseWorkflowRuntimeStore } = await import('@/server/agents/automation/supabase-workflow-runtime-store');
    const { manuallyRetryDeadLetteredStep } = await import('@/server/agents/automation/workflow-runtime');
    const ctx = { store: new SupabaseAutomationStore(), runtimeStore: new SupabaseWorkflowRuntimeStore(), correlationId: 'corr-4g-behav-seed', now: () => new Date() };
    await manuallyRetryDeadLetteredStep(ctx, stepId, FOUNDER);

    const original = await svcQuery(p, `select kind from workflow_execution_events where id = $1`, [originalEventId]);
    assert.equal(original.rows[0].kind, 'STEP_FAILED');
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('two workflow runs for two different workflow codes are genuinely distinct records', async () => {
  const p = await pool();
  try {
    const { workflowRunId: runA } = await seedRunWithStep(p, 'LEVEL_1');
    const { workflowRunId: runB } = await seedRunWithStep(p, 'LEVEL_1');
    assert.notEqual(runA, runB);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

test('automation-ops-panel.tsx (Founder/COO view) contains no reference to any staff-console action', async () => {
  const raw = await (await import('node:fs/promises')).readFile(
    new URL('../../src/components/automation-ops-panel.tsx', import.meta.url), 'utf8'
  );
  assert.ok(!/approveWorkflowStepAction|retryDeadLetterAction|takeoverConversationAction/.test(raw));
});

test('the staff automation route enforces both requireViewerRole(staffAreaRoles) and requireAssuranceLevel(aal2)', async () => {
  const raw = await (await import('node:fs/promises')).readFile(
    new URL('../../src/app/[locale]/staff/automation/page.tsx', import.meta.url), 'utf8'
  );
  assert.ok(/requireViewerRole\(locale, staffAreaRoles/.test(raw));
  assert.ok(/requireAssuranceLevel\(locale, viewer, 'aal2'/.test(raw));
});
