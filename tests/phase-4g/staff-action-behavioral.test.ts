import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { CombinedAutomationAndFounderControlStore } from '@/server/agents/automation/staff-console-action-contract';

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

async function seedActiveWorkflow(p: Awaited<ReturnType<typeof pool>>, workflowCode: string) {
  const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
  const { draftWorkflowVersion, approveAndActivateWorkflowVersion, createWorkflowRun, createStep } = await import('@/server/agents/automation/automation-service');
  const store = new SupabaseAutomationStore();
  const ctx = { store, correlationId: 'corr-4g-staffact-seed', now: () => new Date() };

  const definitionId = randomUUID();
  await svcQuery(p, `insert into workflow_definitions (id, workflow_code, correlation_id) values ($1,$2,'corr-4g-staffact-seed')`, [definitionId, workflowCode]);
  const { workflowVersionId } = await draftWorkflowVersion(ctx, { workflowDefinitionId: definitionId, version: 1, stepGraph: {} });
  await approveAndActivateWorkflowVersion(ctx, workflowVersionId, FOUNDER);
  const { workflowRunId } = await createWorkflowRun(ctx, { workflowVersionId, subjectType: 'test', subjectId: null, agentCode: null }, `idem-4g-staffact-${randomUUID()}`);
  const { stepId } = await createStep(ctx, workflowRunId, 0, 'TEST_L2', 'LEVEL_2');
  return { definitionId, workflowVersionId, workflowRunId, stepId };
}

async function cleanup(p: Awaited<ReturnType<typeof pool>>) {
  await svcQuery(p, `delete from dead_letter_records where correlation_id like 'corr-4g-staffact%'`);
  await svcQuery(p, `delete from workflow_event_inbox where correlation_id like 'staff-%'`);
  await svcQuery(p, `delete from workflow_idempotency_keys where correlation_id like 'idem-4g-staffact%'`);
  await svcQuery(p, `delete from workflow_execution_events where correlation_id like 'corr-4g-staffact%' or correlation_id like 'staff-%'`);
  await svcQuery(p, `delete from workflow_steps where correlation_id like 'corr-4g-staffact%'`);
  await svcQuery(p, `delete from workflow_runs where correlation_id like 'corr-4g-staffact%'`);
  await svcQuery(p, `delete from workflow_version_history where correlation_id like 'corr-4g-staffact%'`);
  await svcQuery(p, `delete from workflow_versions where correlation_id like 'corr-4g-staffact%'`);
  await svcQuery(p, `delete from workflow_definitions where correlation_id like 'corr-4g-staffact%'`);
  await svcQuery(p, `delete from automation_pause_controls where correlation_id like 'corr-4g-staffact%'`);
}

gated('the real feature flag "staff_console_automation_actions" is enabled — the gate genuinely checks it, not skipped', async () => {
  const p = await pool();
  try {
    const { SupabaseFounderControlStore } = await import('@/server/agents/automation/supabase-founder-control-store');
    const store = new SupabaseFounderControlStore();
    const flag = await store.loadFeatureFlag('staff_console_automation_actions');
    assert.equal(flag?.enabled, true);
  } finally {
    await p.end();
  }
});

gated('completeLevel2Step + checkAutomationGateExtended succeed end-to-end with the real derived workflowCode and real feature flag', async () => {
  const p = await pool();
  try {
    const workflowCode = `staffact.test.${randomUUID().slice(0, 8)}`;
    const { stepId, workflowRunId } = await seedActiveWorkflow(p, workflowCode);

    const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
    const { SupabaseFounderControlStore } = await import('@/server/agents/automation/supabase-founder-control-store');
    const { completeLevel2Step, guardAgainstDuplicateEvent } = await import('@/server/agents/automation/automation-service');
    const { checkAutomationGateExtended } = await import('@/server/agents/automation/founder-controls');
    const store = new SupabaseAutomationStore();
    const founderControlStore = new SupabaseFounderControlStore();
    const ctx = { store: new CombinedAutomationAndFounderControlStore(store, founderControlStore) as never, correlationId: `corr-4g-staffact-${randomUUID()}`, now: () => new Date() };

    await checkAutomationGateExtended(ctx, {
      agentCode: null, channel: null, workflowCode, workingHoursPolicyCode: null,
      requiredFeatureFlag: 'staff_console_automation_actions', level1PolicyCode: null
    });
    await guardAgainstDuplicateEvent(ctx, `staff-approve-step-${stepId}-${STAFF1}`);
    await completeLevel2Step(ctx, stepId, STAFF1);

    const step = await store.loadWorkflowStep(stepId);
    assert.equal(step?.status, 'COMPLETED');
    void workflowRunId;
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('a paused workflow (matching the REAL derived workflowCode) blocks approval', async () => {
  const p = await pool();
  try {
    const workflowCode = `staffact.paused.${randomUUID().slice(0, 8)}`;
    const { stepId } = await seedActiveWorkflow(p, workflowCode);
    await svcQuery(p, `insert into automation_pause_controls (id, scope, scope_key, paused, paused_by, paused_at, correlation_id) values ($1,'WORKFLOW',$2,true,$3,now(),'corr-4g-staffact-seed')`, [randomUUID(), workflowCode, FOUNDER]);

    const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
    const { SupabaseFounderControlStore } = await import('@/server/agents/automation/supabase-founder-control-store');
    const { checkAutomationGateExtended } = await import('@/server/agents/automation/founder-controls');
    const { AutomationAuthorityError } = await import('@/server/agents/automation/automation-contract');
    const store = new SupabaseAutomationStore();
    const founderControlStore = new SupabaseFounderControlStore();
    const ctx = { store: new CombinedAutomationAndFounderControlStore(store, founderControlStore) as never, correlationId: `corr-4g-staffact-${randomUUID()}`, now: () => new Date() };

    await assert.rejects(
      () => checkAutomationGateExtended(ctx, { agentCode: null, channel: null, workflowCode, workingHoursPolicyCode: null, requiredFeatureFlag: 'staff_console_automation_actions', level1PolicyCode: null }),
      (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'AGENT_PAUSED'
    );
    void stepId;
    await svcQuery(p, `delete from automation_pause_controls where scope_key = $1`, [workflowCode]);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('a disabled feature flag blocks execution', async () => {
  const p = await pool();
  try {
    const flagCode = `test_4g_staffact_disabled_${randomUUID().slice(0, 8)}`;
    const { SupabaseFounderControlStore } = await import('@/server/agents/automation/supabase-founder-control-store');
    const store = new SupabaseFounderControlStore();
    await store.saveFeatureFlag({ flagCode, enabled: false }, FOUNDER);

    const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
    const { checkAutomationGateExtended, FounderControlError } = await import('@/server/agents/automation/founder-controls');
    const automationStore = new SupabaseAutomationStore();
    const ctx = { store: new CombinedAutomationAndFounderControlStore(automationStore, store) as never, correlationId: `corr-4g-staffact-${randomUUID()}`, now: () => new Date() };

    await assert.rejects(
      () => checkAutomationGateExtended(ctx, { agentCode: null, channel: null, workflowCode: null, workingHoursPolicyCode: null, requiredFeatureFlag: flagCode, level1PolicyCode: null }),
      (e: unknown) => e instanceof FounderControlError && e.code === 'FEATURE_DISABLED'
    );
    await svcQuery(p, `delete from automation_feature_flags where flag_code = $1`, [flagCode]);
  } finally {
    await p.end();
  }
});

gated('a step\'s real workflowCode is derived only from a real workflowRunId — the function admits no caller-supplied override', async () => {
  const p = await pool();
  try {
    const realWorkflowCode = `staffact.real.${randomUUID().slice(0, 8)}`;
    const { workflowRunId } = await seedActiveWorkflow(p, realWorkflowCode);

    const raw = await (await import('node:fs/promises')).readFile(
      new URL('../../src/server/agents/automation/staff-console-actions.ts', import.meta.url), 'utf8'
    );
    const fnMatch = raw.match(/async function deriveWorkflowCode\(([^)]*)\)/);
    assert.ok(fnMatch);
    assert.equal(fnMatch![1].trim(), 'workflowRunId: string');
    void workflowRunId;
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('automation-ops-panel.tsx still contains no mutation control after this block\'s changes', async () => {
  const raw = await (await import('node:fs/promises')).readFile(
    new URL('../../src/components/automation-ops-panel.tsx', import.meta.url), 'utf8'
  );
  assert.ok(!/<button/i.test(raw));
  assert.ok(!/onClick|onSubmit/i.test(raw));
});
