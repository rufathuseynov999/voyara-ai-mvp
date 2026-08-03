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

async function seedRunWithLevel2Step(p: Awaited<ReturnType<typeof pool>>, workflowCode: string) {
  const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
  const { draftWorkflowVersion, approveAndActivateWorkflowVersion, createWorkflowRun, createStep } = await import('@/server/agents/automation/automation-service');
  const store = new SupabaseAutomationStore();
  const ctx = { store, correlationId: 'corr-4g-ctrl-seed', now: () => new Date() };
  const definitionId = randomUUID();
  await svcQuery(p, `insert into workflow_definitions (id, workflow_code, correlation_id) values ($1,$2,'corr-4g-ctrl-seed')`, [definitionId, workflowCode]);
  const { workflowVersionId } = await draftWorkflowVersion(ctx, { workflowDefinitionId: definitionId, version: 1, stepGraph: {} });
  await approveAndActivateWorkflowVersion(ctx, workflowVersionId, FOUNDER);
  const { workflowRunId } = await createWorkflowRun(ctx, { workflowVersionId, subjectType: 'test', subjectId: null, agentCode: null }, `idem-4g-ctrl-${randomUUID()}`);
  const { stepId } = await createStep(ctx, workflowRunId, 0, 'TEST_CTRL', 'LEVEL_2');
  return { workflowRunId, stepId };
}

async function runFullActionFlow(store: unknown, founderControlStore: unknown, workflowCode: string, stepId: string, approver: string, idemKey: string) {
  const { CombinedAutomationAndFounderControlStore } = await import('@/server/agents/automation/staff-console-action-contract');
  const { buildStaffActionGatePlan, gatePlanToExtendedGateInput } = await import('@/server/agents/automation/staff-action-authority-policy');
  const { checkAutomationGateExtended } = await import('@/server/agents/automation/founder-controls');
  const { completeLevel2Step, guardAgainstDuplicateEvent } = await import('@/server/agents/automation/automation-service');

  const combined = new (CombinedAutomationAndFounderControlStore as new (a: unknown, b: unknown) => unknown)(store, founderControlStore);
  const ctx = { store: combined, correlationId: `corr-4g-ctrl-${randomUUID()}`, now: () => new Date() };
  const plan = buildStaffActionGatePlan({ agentCode: null, channel: null, workflowCode });
  await checkAutomationGateExtended(ctx as never, gatePlanToExtendedGateInput(plan, { agentCode: null, channel: null, workflowCode }));
  await guardAgainstDuplicateEvent(ctx as never, idemKey);
  await completeLevel2Step(ctx as never, stepId, approver);
}

async function cleanupControl(p: Awaited<ReturnType<typeof pool>>) {
  await svcQuery(p, `delete from workflow_idempotency_keys where correlation_id like 'idem-4g-ctrl%'`);
  await svcQuery(p, `delete from workflow_event_inbox where correlation_id like 'corr-4g-ctrl%'`);
  await svcQuery(p, `delete from dead_letter_records where correlation_id like 'corr-4g-ctrl%'`);
  await svcQuery(p, `delete from workflow_execution_events where correlation_id like 'corr-4g-ctrl%'`);
  await svcQuery(p, `delete from workflow_steps where correlation_id like 'corr-4g-ctrl%'`);
  await svcQuery(p, `delete from workflow_runs where correlation_id like 'corr-4g-ctrl%'`);
  await svcQuery(p, `delete from workflow_version_history where correlation_id like 'corr-4g-ctrl%'`);
  await svcQuery(p, `delete from workflow_versions where correlation_id like 'corr-4g-ctrl%'`);
  await svcQuery(p, `delete from workflow_definitions where correlation_id like 'corr-4g-ctrl%'`);
  await svcQuery(p, `delete from automation_pause_controls where correlation_id like 'corr-4g-ctrl%'`);
}

gated('emergency stop blocks the real action flow — no idempotency reservation, no completion, no execution event', async () => {
  const p = await pool();
  try {
    const workflowCode = `ctrl.emerg.${randomUUID().slice(0, 8)}`;
    const { stepId } = await seedRunWithLevel2Step(p, workflowCode);
    await svcQuery(p, `update emergency_stop_state set active = true, activated_by = $1, activated_at = now(), correlation_id = 'corr-4g-ctrl-seed' where id = 1`, [FOUNDER]);

    const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
    const { SupabaseFounderControlStore } = await import('@/server/agents/automation/supabase-founder-control-store');
    const store = new SupabaseAutomationStore();
    const founderControlStore = new SupabaseFounderControlStore();
    const idemKey = `idem-4g-ctrl-${randomUUID()}`;
    await assert.rejects(() => runFullActionFlow(store, founderControlStore, workflowCode, stepId, STAFF1, idemKey));

    const step = await store.loadWorkflowStep(stepId);
    assert.equal(step?.status, 'PENDING');
    const reservation = await svcQuery(p, `select count(*)::int as n from workflow_idempotency_keys where idempotency_key = $1`, [idemKey]);
    assert.equal(reservation.rows[0].n, 0);
    const events = await svcQuery(p, `select count(*)::int as n from workflow_execution_events where workflow_step_id = $1`, [stepId]);
    assert.equal(events.rows[0].n, 0);

    await svcQuery(p, `update emergency_stop_state set active = false, activated_by = null, activated_at = null, correlation_id = 'corr-4g-ctrl-seed' where id = 1`);
    await cleanupControl(p);
  } finally {
    await p.end();
  }
});

gated('global pause blocks the real action flow the same way', async () => {
  const p = await pool();
  try {
    const workflowCode = `ctrl.global.${randomUUID().slice(0, 8)}`;
    const { stepId } = await seedRunWithLevel2Step(p, workflowCode);
    await svcQuery(p, `delete from automation_pause_controls where scope = 'GLOBAL'`);
    await svcQuery(p, `insert into automation_pause_controls (id, scope, paused, paused_by, paused_at, correlation_id) values ($1,'GLOBAL',true,$2,now(),'corr-4g-ctrl-seed')`, [randomUUID(), FOUNDER]);

    const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
    const { SupabaseFounderControlStore } = await import('@/server/agents/automation/supabase-founder-control-store');
    const store = new SupabaseAutomationStore();
    const founderControlStore = new SupabaseFounderControlStore();
    await assert.rejects(() => runFullActionFlow(store, founderControlStore, workflowCode, stepId, STAFF1, `idem-4g-ctrl-${randomUUID()}`));

    const step = await store.loadWorkflowStep(stepId);
    assert.equal(step?.status, 'PENDING');

    await svcQuery(p, `delete from automation_pause_controls where scope = 'GLOBAL'`);
    await cleanupControl(p);
  } finally {
    await p.end();
  }
});

gated('a workflow pause matching the real derived workflow code blocks the action flow; a different workflow code does not', async () => {
  const p = await pool();
  try {
    const pausedCode = `ctrl.wf.paused.${randomUUID().slice(0, 8)}`;
    const otherCode = `ctrl.wf.other.${randomUUID().slice(0, 8)}`;
    const { stepId: pausedStepId } = await seedRunWithLevel2Step(p, pausedCode);
    const { stepId: otherStepId } = await seedRunWithLevel2Step(p, otherCode);
    await svcQuery(p, `insert into automation_pause_controls (id, scope, scope_key, paused, paused_by, paused_at, correlation_id) values ($1,'WORKFLOW',$2,true,$3,now(),'corr-4g-ctrl-seed')`, [randomUUID(), pausedCode, FOUNDER]);

    const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
    const { SupabaseFounderControlStore } = await import('@/server/agents/automation/supabase-founder-control-store');
    const store = new SupabaseAutomationStore();
    const founderControlStore = new SupabaseFounderControlStore();

    await assert.rejects(() => runFullActionFlow(store, founderControlStore, pausedCode, pausedStepId, STAFF1, `idem-4g-ctrl-${randomUUID()}`));
    await runFullActionFlow(store, founderControlStore, otherCode, otherStepId, STAFF1, `idem-4g-ctrl-${randomUUID()}`);

    const pausedStep = await store.loadWorkflowStep(pausedStepId);
    const otherStep = await store.loadWorkflowStep(otherStepId);
    assert.equal(pausedStep?.status, 'PENDING');
    assert.equal(otherStep?.status, 'COMPLETED');

    await svcQuery(p, `delete from automation_pause_controls where scope_key = $1`, [pausedCode]);
    await cleanupControl(p);
  } finally {
    await p.end();
  }
});

gated('a disabled required feature flag blocks the real action flow', async () => {
  const p = await pool();
  try {
    const workflowCode = `ctrl.flagoff.${randomUUID().slice(0, 8)}`;
    const { stepId } = await seedRunWithLevel2Step(p, workflowCode);
    const { SupabaseFounderControlStore } = await import('@/server/agents/automation/supabase-founder-control-store');
    const founderControlStore = new SupabaseFounderControlStore();
    await founderControlStore.saveFeatureFlag({ flagCode: 'staff_console_automation_actions', enabled: false }, FOUNDER);

    const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
    const store = new SupabaseAutomationStore();
    await assert.rejects(() => runFullActionFlow(store, founderControlStore, workflowCode, stepId, STAFF1, `idem-4g-ctrl-${randomUUID()}`));

    const step = await store.loadWorkflowStep(stepId);
    assert.equal(step?.status, 'PENDING');

    await founderControlStore.saveFeatureFlag({ flagCode: 'staff_console_automation_actions', enabled: true }, FOUNDER);
    await cleanupControl(p);
  } finally {
    await p.end();
  }
});

gated('a missing (never-configured) required feature flag fails closed', async () => {
  const p = await pool();
  try {
    const { CombinedAutomationAndFounderControlStore } = await import('@/server/agents/automation/staff-console-action-contract');
    const { checkAutomationGateExtended } = await import('@/server/agents/automation/founder-controls');
    const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
    const { SupabaseFounderControlStore } = await import('@/server/agents/automation/supabase-founder-control-store');
    const store = new SupabaseAutomationStore();
    const founderControlStore = new SupabaseFounderControlStore();
    const combined = new CombinedAutomationAndFounderControlStore(store, founderControlStore);
    const ctx = { store: combined, correlationId: `corr-4g-ctrl-${randomUUID()}`, now: () => new Date() };
    await assert.rejects(() => checkAutomationGateExtended(ctx as never, {
      agentCode: null, channel: null, workflowCode: null, workingHoursPolicyCode: null,
      requiredFeatureFlag: `never_configured_4g_ctrl_${randomUUID()}`, level1PolicyCode: null
    }));
  } finally {
    await p.end();
  }
});

test('the explicit working-hours exemption and Level-2-human-authority reason codes remain present and auditable', async () => {
  const { buildStaffActionGatePlan } = await import('@/server/agents/automation/staff-action-authority-policy');
  const plan = buildStaffActionGatePlan({ agentCode: null, channel: null, workflowCode: null });
  assert.equal(plan.find((pt) => pt.point === 'WORKING_HOURS')?.reasonCode, 'STAFF_MANUAL_ACTION_WORKING_HOURS_EXEMPT');
  assert.equal(plan.find((pt) => pt.point === 'RISK_POLICY_AUTHORITY')?.reasonCode, 'LEVEL_2_HUMAN_AUTHORITY');
});

gated('a blocked retry (emergency stop active) does not resolve the dead-letter record and appends no retry events', async () => {
  const p = await pool();
  try {
    const workflowCode = `ctrl.retryblock.${randomUUID().slice(0, 8)}`;
    const { workflowRunId, stepId } = await seedRunWithLevel2Step(p, workflowCode);
    await svcQuery(p, `update workflow_steps set status = 'FAILED' where id = $1`, [stepId]);
    const dlId = randomUUID();
    await svcQuery(p, `insert into dead_letter_records (id, workflow_run_id, workflow_step_id, reason_code, resolved, correlation_id) values ($1,$2,$3,'TEST_FAILURE',false,'corr-4g-ctrl-seed')`, [dlId, workflowRunId, stepId]);
    await svcQuery(p, `update emergency_stop_state set active = true, activated_by = $1, activated_at = now(), correlation_id = 'corr-4g-ctrl-seed' where id = 1`, [FOUNDER]);

    const { CombinedAutomationAndFounderControlStore } = await import('@/server/agents/automation/staff-console-action-contract');
    const { buildStaffActionGatePlan, gatePlanToExtendedGateInput } = await import('@/server/agents/automation/staff-action-authority-policy');
    const { checkAutomationGateExtended } = await import('@/server/agents/automation/founder-controls');
    const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
    const { SupabaseFounderControlStore } = await import('@/server/agents/automation/supabase-founder-control-store');
    const store = new SupabaseAutomationStore();
    const founderControlStore = new SupabaseFounderControlStore();
    const combined = new CombinedAutomationAndFounderControlStore(store, founderControlStore);
    const ctx = { store: combined, correlationId: `corr-4g-ctrl-${randomUUID()}`, now: () => new Date() };
    const plan = buildStaffActionGatePlan({ agentCode: null, channel: null, workflowCode });
    await assert.rejects(() => checkAutomationGateExtended(ctx as never, gatePlanToExtendedGateInput(plan, { agentCode: null, channel: null, workflowCode })));

    const dl = await svcQuery(p, `select resolved from dead_letter_records where id = $1`, [dlId]);
    assert.equal(dl.rows[0].resolved, false);
    const events = await svcQuery(p, `select count(*)::int as n from workflow_execution_events where workflow_step_id = $1`, [stepId]);
    assert.equal(events.rows[0].n, 0);

    await svcQuery(p, `update emergency_stop_state set active = false, activated_by = null, activated_at = null, correlation_id = 'corr-4g-ctrl-seed' where id = 1`);
    await cleanupControl(p);
  } finally {
    await p.end();
  }
});
