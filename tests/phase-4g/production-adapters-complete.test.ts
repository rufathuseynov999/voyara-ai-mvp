import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

const PG_URL = process.env.VOYARA_PG_TEST_URL;
const gated = PG_URL ? test : test.skip;

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

async function cleanup(p: Awaited<ReturnType<typeof pool>>) {
  await svcQuery(p, `delete from automation_feature_flags where flag_code like 'test_4g_adapter%'`);
  await svcQuery(p, `delete from working_hours_policies where correlation_id like 'corr-4g-adapter%'`);
  await svcQuery(p, `delete from workflow_event_inbox where correlation_id like 'idem-4g-adapter%' or event_key like 'evt-4g-adapter%'`);
}

gated('SupabaseFounderControlStore.saveFeatureFlag + loadFeatureFlag round-trip through the real class — no throwing stub', async () => {
  const p = await pool();
  try {
    const { SupabaseFounderControlStore } = await import('@/server/agents/automation/supabase-founder-control-store');
    const store = new SupabaseFounderControlStore();
    const flagCode = `test_4g_adapter_${randomUUID().slice(0, 8)}`;
    await store.saveFeatureFlag({ flagCode, enabled: true }, FOUNDER);
    const loaded = await store.loadFeatureFlag(flagCode);
    assert.equal(loaded?.enabled, true);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('SupabaseFounderControlStore.loadFeatureFlag genuinely returns null (fail-closed) for a flag that was never configured', async () => {
  const p = await pool();
  try {
    const { SupabaseFounderControlStore } = await import('@/server/agents/automation/supabase-founder-control-store');
    const store = new SupabaseFounderControlStore();
    const loaded = await store.loadFeatureFlag(`test_4g_adapter_nonexistent_${randomUUID()}`);
    assert.equal(loaded, null);
  } finally {
    await p.end();
  }
});

gated('SupabaseFounderControlStore.findActiveWorkingHoursPolicyByCode reads a genuinely ACTIVE real row — no throwing stub', async () => {
  const p = await pool();
  try {
    const { SupabaseFounderControlStore } = await import('@/server/agents/automation/supabase-founder-control-store');
    const { sha256 } = await import('@/server/bos/canonical-json');
    const store = new SupabaseFounderControlStore();
    const policyCode = `test-4g-adapter-${randomUUID().slice(0, 8)}`;
    const schedule = { '1': [{ startMinute: 540, endMinute: 1020 }] };
    const contentHash = sha256({ policyCode, timezone: 'Asia/Baku', schedule, version: 1 });
    const policyId = randomUUID();
    await svcQuery(
      p,
      `insert into working_hours_policies (id, policy_code, timezone, schedule, status, approved_by, approved_at, content_hash, version, correlation_id)
       values ($1,$2,'Asia/Baku',$3::jsonb,'ACTIVE',$4,now(),$5,1,'corr-4g-adapter-seed')`,
      [policyId, policyCode, JSON.stringify(schedule), FOUNDER, contentHash]
    );
    const loaded = await store.findActiveWorkingHoursPolicyByCode(policyCode);
    assert.equal(loaded?.status, 'ACTIVE');
    assert.equal(loaded?.policyCode, policyCode);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('SupabaseFounderControlStore.recordFounderControlEvent writes a real, readable row', async () => {
  const p = await pool();
  try {
    const { SupabaseFounderControlStore } = await import('@/server/agents/automation/supabase-founder-control-store');
    const store = new SupabaseFounderControlStore();
    const eventId = randomUUID();
    await store.recordFounderControlEvent({ eventId, controlKind: 'TEST_ADAPTER', controlKey: null, action: 'TEST', actorId: FOUNDER, correlationId: 'corr-4g-adapter-seed' });
    const row = await svcQuery(p, `select control_kind, actor_id from founder_control_events where id = $1`, [eventId]);
    assert.equal(row.rows[0].control_kind, 'TEST_ADAPTER');
    assert.equal(row.rows[0].actor_id, FOUNDER);
    await svcQuery(p, `delete from founder_control_events where id = $1`, [eventId]);
  } finally {
    await p.end();
  }
});

gated('SupabaseWorkflowRuntimeStore.reserveInboxEvent + markInboxEventProcessed work through the real class — no throwing stub', async () => {
  const p = await pool();
  try {
    const { SupabaseWorkflowRuntimeStore } = await import('@/server/agents/automation/supabase-workflow-runtime-store');
    const store = new SupabaseWorkflowRuntimeStore();
    const eventKey = `evt-4g-adapter-${randomUUID()}`;
    const first = await store.reserveInboxEvent(eventKey, null, 'TEST_EVENT', {}, null);
    assert.equal(first.winner, true);
    const second = await store.reserveInboxEvent(eventKey, null, 'TEST_EVENT', {}, null);
    assert.equal(second.winner, false);
    assert.equal(second.eventId, first.eventId);

    await store.markInboxEventProcessed(eventKey, new Date().toISOString());
    const row = await svcQuery(p, `select processed from workflow_event_inbox where event_key = $1`, [eventKey]);
    assert.equal(row.rows[0].processed, true);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('SupabaseWorkflowRuntimeStore.loadRunnableSteps and loadExpiredLeases execute against the real workflow_steps table without error — no throwing stub', async () => {
  const p = await pool();
  try {
    const { SupabaseWorkflowRuntimeStore } = await import('@/server/agents/automation/supabase-workflow-runtime-store');
    const store = new SupabaseWorkflowRuntimeStore();
    const runnable = await store.loadRunnableSteps(new Date(), 5);
    assert.ok(Array.isArray(runnable));
    const expired = await store.loadExpiredLeases(new Date());
    assert.ok(Array.isArray(expired));
  } finally {
    await p.end();
  }
});
