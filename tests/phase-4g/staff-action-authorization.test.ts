import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

/**
 * Phase 4G — action-layer authorization coverage.
 *
 * GENUINE ARCHITECTURAL FINDING, investigated before writing these tests:
 * `workflow_runs` carries no `account_id`/`corporate_account_id` column —
 * only a polymorphic `subject_type`/`subject_id` (confirmed by reading
 * the real Migration 23 table definition). Workflow steps are a STAFF-ONLY
 * resource: RLS already restricts every read to AAL2 staff, and staff
 * legitimately operate across every customer/corporate account — that is
 * the entire point of a shared operations queue, not a defect.
 * "Cross-account isolation" for THIS resource is therefore enforced at
 * the staff-role/AAL2 boundary (who may see the queue at all), not by a
 * separate per-account check inside the approval action itself — the
 * same way a real support ticketing system's agent console works. This
 * file tests the isolation boundary that genuinely exists (RLS + AAL2)
 * rather than fabricating a per-account check the schema was never
 * designed to support. Dead-letter retry and completeLevel2Step both
 * operate on this same staff-only resource, so the same reasoning
 * applies to both.
 */

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

async function seedRunWithLevel2Step(p: Awaited<ReturnType<typeof pool>>) {
  const { SupabaseAutomationStore } = await import('@/server/agents/automation/supabase-automation-store');
  const { draftWorkflowVersion, approveAndActivateWorkflowVersion, createWorkflowRun, createStep } = await import('@/server/agents/automation/automation-service');
  const store = new SupabaseAutomationStore();
  const ctx = { store, correlationId: 'corr-4g-authz-seed', now: () => new Date() };
  const definitionId = randomUUID();
  await svcQuery(p, `insert into workflow_definitions (id, workflow_code, correlation_id) values ($1,$2,'corr-4g-authz-seed')`, [definitionId, `authz.test.${randomUUID().slice(0, 8)}`]);
  const { workflowVersionId } = await draftWorkflowVersion(ctx, { workflowDefinitionId: definitionId, version: 1, stepGraph: {} });
  await approveAndActivateWorkflowVersion(ctx, workflowVersionId, FOUNDER);
  const { workflowRunId } = await createWorkflowRun(ctx, { workflowVersionId, subjectType: 'test', subjectId: null, agentCode: null }, `idem-4g-authz-${randomUUID()}`);
  const { stepId } = await createStep(ctx, workflowRunId, 0, 'TEST_AUTHZ', 'LEVEL_2');
  return { workflowRunId, stepId };
}

async function cleanup(p: Awaited<ReturnType<typeof pool>>) {
  await svcQuery(p, `delete from workflow_idempotency_keys where correlation_id like 'idem-4g-authz%'`);
  await svcQuery(p, `delete from workflow_execution_events where correlation_id like 'corr-4g-authz%'`);
  await svcQuery(p, `delete from workflow_steps where correlation_id like 'corr-4g-authz%'`);
  await svcQuery(p, `delete from workflow_runs where correlation_id like 'corr-4g-authz%'`);
  await svcQuery(p, `delete from workflow_version_history where correlation_id like 'corr-4g-authz%'`);
  await svcQuery(p, `delete from workflow_versions where correlation_id like 'corr-4g-authz%'`);
  await svcQuery(p, `delete from workflow_definitions where correlation_id like 'corr-4g-authz%'`);
}

test('every exported action in staff-console-actions.ts calls requireStaffAal2 as its first statement, before any store/business logic', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/automation/staff-console-actions.ts', import.meta.url), 'utf8');
  const actionNames = ['takeoverConversationAction', 'releaseConversationAction', 'approveWorkflowStepAction', 'retryDeadLetterAction'];
  for (const name of actionNames) {
    const start = raw.indexOf(`export async function ${name}`);
    // The function body opens after the return-type annotation, marked
    // by "> {" (e.g. "Promise<void> {" or "Promise<{ stepId: ... }> {")
    // — searching for the bare first "{" instead matches an inline
    // object type in the return annotation, a real bug this fix caught.
    const bodyOpenMarker = raw.indexOf('> {', start);
    const bodyStart = bodyOpenMarker + 3;
    const nextLines = raw.slice(bodyStart, bodyStart + 300);
    const firstStatement = nextLines.trim().split('\n')[0];
    assert.ok(/requireStaffAal2\(/.test(firstStatement), `${name}'s first statement is not the auth check: "${firstStatement}"`);
  }
});

test('requireStaffAal2 calls requireViewerRole before requireAssuranceLevel — role is checked before AAL, never the reverse', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/automation/staff-console-actions.ts', import.meta.url), 'utf8');
  const helperBody = raw.slice(raw.indexOf('async function requireStaffAal2'), raw.indexOf('export async function takeoverConversationAction'));
  const roleIdx = helperBody.indexOf('requireViewerRole');
  const aalIdx = helperBody.indexOf('requireAssuranceLevel');
  assert.ok(roleIdx > 0 && aalIdx > 0 && roleIdx < aalIdx);
});

test('approveWorkflowStepAction passes viewer.id, never a browser-supplied value, as the approver — and admits no such parameter', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/automation/staff-console-actions.ts', import.meta.url), 'utf8');
  const block = raw.slice(raw.indexOf('export async function approveWorkflowStepAction'), raw.indexOf('export async function retryDeadLetterAction'));
  assert.ok(/completeLevel2Step\(ctx, stepId, viewer\.id\)/.test(block));
  const signature = raw.match(/export async function approveWorkflowStepAction\(([^)]*)\)/);
  assert.ok(signature);
  assert.equal(signature![1].trim(), 'locale: string, stepId: string');
});

test('retryDeadLetterAction passes viewer.id as the retrying actor, and admits no caller-supplied actor identity', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/automation/staff-console-actions.ts', import.meta.url), 'utf8');
  const block = raw.slice(raw.indexOf('export async function retryDeadLetterAction'));
  assert.ok(/manuallyRetryDeadLetteredStep\(ctx, dl\.workflow_step_id, viewer\.id\)/.test(block));
  const signature = raw.match(/export async function retryDeadLetterAction\(([^)]*)\)/);
  assert.ok(signature);
  assert.equal(signature![1].trim(), 'locale: string, deadLetterId: string');
});

gated('the real customer-exclusion boundary is even stronger than RLS filtering: an anonymous role has no GRANT on workflow_steps at all', async () => {
  const p = await pool();
  try {
    const { stepId } = await seedRunWithLevel2Step(p);
    const c = await p.connect();
    try {
      await c.query('begin');
      await c.query('set local role anon');
      await assert.rejects(
        () => c.query(`select id from workflow_steps where id = $1`, [stepId]),
        (e: unknown) => (e as { code?: string }).code === '42501'
      );
      await c.query('rollback');
    } finally {
      c.release();
    }
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('AAL1 staff cannot read workflow_steps either — matching the AAL2 requirement enforced again at the RLS layer', async () => {
  const p = await pool();
  try {
    const { stepId } = await seedRunWithLevel2Step(p);
    await asRole(p, 'authenticated', claimsFor(STAFF1, 'aal1'), async (c) => {
      const r = await c.query(`select id from workflow_steps where id = $1`, [stepId]);
      assert.equal(r.rowCount, 0);
    });
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('AAL2 founder CAN read workflow_steps', async () => {
  const p = await pool();
  try {
    const { stepId } = await seedRunWithLevel2Step(p);
    await asRole(p, 'authenticated', claimsFor(FOUNDER, 'aal2'), async (c) => {
      const r = await c.query(`select id from workflow_steps where id = $1`, [stepId]);
      assert.equal(r.rowCount, 1);
    });
    await cleanup(p);
  } finally {
    await p.end();
  }
});

test('completeLevel2Step always loads the step fresh from the store by id — it never accepts a step object or payload from the caller', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/automation/automation-service.ts', import.meta.url), 'utf8');
  const fnMatch = raw.match(/export async function completeLevel2Step\(([^)]*)\)/);
  assert.ok(fnMatch);
  assert.ok(/ctx: AutomationContext, stepId: string, approvedBy: string/.test(fnMatch![1]));
  assert.ok(/ctx\.store\.loadWorkflowStep\(stepId\)/.test(raw));
});
