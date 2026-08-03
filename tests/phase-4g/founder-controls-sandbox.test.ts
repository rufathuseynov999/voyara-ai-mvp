import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

/**
 * Phase 4G Part 4 — real PostgreSQL tests for the Migration 25 founder-
 * controls schema: widened pause-control scopes (GLOBAL/AGENT/CHANNEL/
 * WORKFLOW), working-hours policies (approval-by-hash), escalation
 * destinations, feature flags, and the append-only founder-control event
 * journal.
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

async function computeExpectedHash(input: Record<string, unknown>): Promise<string> {
  const { sha256 } = await import('@/server/bos/canonical-json');
  return sha256(input);
}

async function seedActiveWorkingHours(p: Awaited<ReturnType<typeof pool>>, policyCode: string, schedule: Record<string, unknown> = { '1': [{ startMinute: 540, endMinute: 1020 }] }) {
  const id = randomUUID();
  const contentHash = await computeExpectedHash({ policyCode, timezone: 'Asia/Baku', schedule, version: 1 });
  await svcQuery(
    p,
    `insert into working_hours_policies (id, policy_code, timezone, schedule, status, approved_by, approved_at, content_hash, correlation_id)
     values ($1,$2,'Asia/Baku',$3,'ACTIVE',$4,now(),$5,'corr-4g-mig25-seed')`,
    [id, policyCode, JSON.stringify(schedule), FOUNDER, contentHash]
  );
  return { id, contentHash };
}

async function cleanup(p: Awaited<ReturnType<typeof pool>>) {
  await svcQuery(p, `delete from founder_control_events where correlation_id like 'corr-4g-mig25%'`);
  await svcQuery(p, `delete from automation_feature_flag_history where correlation_id like 'corr-4g-mig25%'`);
  await svcQuery(p, `delete from automation_feature_flags where correlation_id like 'corr-4g-mig25%'`);
  await svcQuery(p, `delete from escalation_destinations where correlation_id like 'corr-4g-mig25%'`);
  await svcQuery(p, `delete from working_hours_policies where correlation_id like 'corr-4g-mig25%'`);
  await svcQuery(p, `delete from automation_pause_controls where correlation_id like 'corr-4g-mig25%'`);
  await svcQuery(p, `delete from automation_pause_events where correlation_id like 'corr-4g-mig25%'`);
}

gated('forced RLS: AAL2 founder reads, AAL1 staff and customers blocked, on all five Migration 25 tables', async () => {
  const p = await pool();
  try {
    const { id: whId } = await seedActiveWorkingHours(p, `test.rls.${randomUUID().slice(0, 8)}`);

    const escId = randomUUID();
    await svcQuery(p, `insert into escalation_destinations (id, destination_code, escalation_kind, target_description, correlation_id) values ($1,$2,'SLA_BREACH','Test destination','corr-4g-mig25-seed')`, [escId, `dest.${randomUUID().slice(0, 8)}`]);

    const flagId = randomUUID();
    await svcQuery(p, `insert into automation_feature_flags (id, flag_code, enabled, updated_by, correlation_id) values ($1,$2,true,$3,'corr-4g-mig25-seed')`, [flagId, `flag.${randomUUID().slice(0, 8)}`, FOUNDER]);

    const flagHistId = randomUUID();
    await svcQuery(p, `insert into automation_feature_flag_history (id, flag_id, enabled, changed_by, correlation_id) values ($1,$2,true,$3,'corr-4g-mig25-seed')`, [flagHistId, flagId, FOUNDER]);

    const controlEventId = randomUUID();
    await svcQuery(p, `insert into founder_control_events (id, control_kind, action, actor_id, correlation_id) values ($1,'FEATURE_FLAG','ENABLED',$2,'corr-4g-mig25-seed')`, [controlEventId, FOUNDER]);

    const tables: [string, string][] = [
      ['working_hours_policies', whId], ['escalation_destinations', escId], ['automation_feature_flags', flagId],
      ['automation_feature_flag_history', flagHistId], ['founder_control_events', controlEventId]
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
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('no direct authenticated write policy exists on any Migration 25 table, even for AAL2 founder', async () => {
  const p = await pool();
  try {
    await asRole(p, 'authenticated', claimsFor(FOUNDER, 'aal2'), async (c) => {
      await assert.rejects(
        () => c.query(`insert into automation_feature_flags (id, flag_code, updated_by, correlation_id) values ($1,'x',$2,'c')`, [randomUUID(), FOUNDER]),
        (e: unknown) => (e as { code?: string }).code === '42501'
      );
    });
  } finally {
    await p.end();
  }
});

gated('GLOBAL, AGENT, CHANNEL, and WORKFLOW pause scopes all insert successfully with the correct scope_key shape', async () => {
  const p = await pool();
  try {
    const globalId = randomUUID();
    await svcQuery(p, `insert into automation_pause_controls (id, scope, scope_key, correlation_id) values ($1,'GLOBAL',null,'corr-4g-mig25-seed')`, [globalId]);
    const agentId = randomUUID();
    await svcQuery(p, `insert into automation_pause_controls (id, scope, scope_key, correlation_id) values ($1,'AGENT','crm-agent','corr-4g-mig25-seed')`, [agentId]);
    const channelId = randomUUID();
    await svcQuery(p, `insert into automation_pause_controls (id, scope, scope_key, correlation_id) values ($1,'CHANNEL','WHATSAPP','corr-4g-mig25-seed')`, [channelId]);
    const workflowId = randomUUID();
    await svcQuery(p, `insert into automation_pause_controls (id, scope, scope_key, correlation_id) values ($1,'WORKFLOW','customer.journey.v1','corr-4g-mig25-seed')`, [workflowId]);

    const rows = await svcQuery(p, `select scope, scope_key from automation_pause_controls where id = any($1) order by scope`, [[globalId, agentId, channelId, workflowId]]);
    assert.equal(rows.rowCount, 4);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('GLOBAL scope requires a null scope_key — a non-null scope_key with GLOBAL is refused', async () => {
  const p = await pool();
  try {
    await assert.rejects(
      () => svcQuery(p, `insert into automation_pause_controls (id, scope, scope_key, correlation_id) values ($1,'GLOBAL','should-be-null','corr-4g-mig25-seed')`, [randomUUID()]),
      (e: unknown) => /automation_pause_controls_scope_key_matches_scope/.test((e as Error).message)
    );
  } finally {
    await p.end();
  }
});

gated('non-GLOBAL scopes (AGENT/CHANNEL/WORKFLOW) require a non-null scope_key — a null scope_key is refused', async () => {
  const p = await pool();
  try {
    await assert.rejects(
      () => svcQuery(p, `insert into automation_pause_controls (id, scope, scope_key, correlation_id) values ($1,'CHANNEL',null,'corr-4g-mig25-seed')`, [randomUUID()]),
      (e: unknown) => /automation_pause_controls_scope_key_matches_scope/.test((e as Error).message)
    );
  } finally {
    await p.end();
  }
});

gated('an invalid scope value outside GLOBAL/AGENT/CHANNEL/WORKFLOW is refused', async () => {
  const p = await pool();
  try {
    await assert.rejects(
      () => svcQuery(p, `insert into automation_pause_controls (id, scope, scope_key, correlation_id) values ($1,'BOGUS_SCOPE','x','corr-4g-mig25-seed')`, [randomUUID()]),
      (e: unknown) => /automation_pause_controls_scope_check/.test((e as Error).message)
    );
  } finally {
    await p.end();
  }
});

gated('per-channel isolation: a pause row for WHATSAPP does not appear when querying CHANNEL rows for VOICE', async () => {
  const p = await pool();
  try {
    await svcQuery(p, `insert into automation_pause_controls (id, scope, scope_key, correlation_id) values ($1,'CHANNEL','WHATSAPP','corr-4g-mig25-seed')`, [randomUUID()]);
    const voiceRows = await svcQuery(p, `select id from automation_pause_controls where scope = 'CHANNEL' and scope_key = 'VOICE' and correlation_id = 'corr-4g-mig25-seed'`);
    assert.equal(voiceRows.rowCount, 0);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('per-workflow isolation: only one pause row may exist per distinct workflow scope_key (unique partial index)', async () => {
  const p = await pool();
  try {
    await svcQuery(p, `insert into automation_pause_controls (id, scope, scope_key, correlation_id) values ($1,'WORKFLOW','journey.a','corr-4g-mig25-seed')`, [randomUUID()]);
    await assert.rejects(
      () => svcQuery(p, `insert into automation_pause_controls (id, scope, scope_key, correlation_id) values ($1,'WORKFLOW','journey.a','corr-4g-mig25-seed')`, [randomUUID()]),
      (e: unknown) => (e as { code?: string }).code === '23505'
    );
    await svcQuery(p, `insert into automation_pause_controls (id, scope, scope_key, correlation_id) values ($1,'WORKFLOW','journey.b','corr-4g-mig25-seed')`, [randomUUID()]);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('a CHANNEL scope_key and a WORKFLOW scope_key with the same text value do not collide (scope is part of the unique key)', async () => {
  const p = await pool();
  try {
    const sharedKey = `shared.${randomUUID().slice(0, 8)}`;
    await svcQuery(p, `insert into automation_pause_controls (id, scope, scope_key, correlation_id) values ($1,'CHANNEL',$2,'corr-4g-mig25-seed')`, [randomUUID(), sharedKey]);
    await svcQuery(p, `insert into automation_pause_controls (id, scope, scope_key, correlation_id) values ($1,'WORKFLOW',$2,'corr-4g-mig25-seed')`, [randomUUID(), sharedKey]);
    const rows = await svcQuery(p, `select scope from automation_pause_controls where scope_key = $1`, [sharedKey]);
    assert.equal(rows.rowCount, 2);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('the stored content_hash for an approved working-hours policy matches the application\'s own sha256 computation', async () => {
  const p = await pool();
  try {
    const policyCode = `test.hash.${randomUUID().slice(0, 8)}`;
    const { id, contentHash } = await seedActiveWorkingHours(p, policyCode);
    const row = await svcQuery(p, `select content_hash from working_hours_policies where id = $1`, [id]);
    assert.equal(row.rows[0].content_hash, contentHash);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('the database rejects an ACTIVE working-hours policy with no human approver', async () => {
  const p = await pool();
  try {
    await assert.rejects(
      () => svcQuery(p, `insert into working_hours_policies (id, policy_code, timezone, schedule, status, correlation_id) values ($1,'test.no.approval','Asia/Baku','{}'::jsonb,'ACTIVE','corr-4g-mig25-seed')`, [randomUUID()]),
      (e: unknown) => /working_hours_policies_active_requires_approval/.test((e as Error).message)
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('stale working-hours approval: a schedule tampered with in place has a content_hash that no longer matches its own content', async () => {
  const p = await pool();
  try {
    const policyCode = `test.stale.${randomUUID().slice(0, 8)}`;
    const originalSchedule = { '1': [{ startMinute: 540, endMinute: 1020 }] };
    const { id, contentHash } = await seedActiveWorkingHours(p, policyCode, originalSchedule);
    const tamperedSchedule = { '1': [{ startMinute: 0, endMinute: 1439 }] };
    await svcQuery(p, `update working_hours_policies set schedule = $2 where id = $1`, [id, JSON.stringify(tamperedSchedule)]);
    const tamperedExpectedHash = await computeExpectedHash({ policyCode, timezone: 'Asia/Baku', schedule: tamperedSchedule, version: 1 });
    const row = await svcQuery(p, `select content_hash from working_hours_policies where id = $1`, [id]);
    assert.equal(row.rows[0].content_hash, contentHash);
    assert.notEqual(row.rows[0].content_hash, tamperedExpectedHash);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('only one ACTIVE working-hours policy row may exist per policy_code (unique partial index)', async () => {
  const p = await pool();
  try {
    const policyCode = `test.unique.${randomUUID().slice(0, 8)}`;
    await seedActiveWorkingHours(p, policyCode);
    const contentHash = await computeExpectedHash({ policyCode, timezone: 'Asia/Baku', schedule: {}, version: 2 });
    await assert.rejects(
      () => svcQuery(
        p,
        `insert into working_hours_policies (id, policy_code, timezone, schedule, status, approved_by, approved_at, content_hash, version, correlation_id)
         values ($1,$2,'Asia/Baku','{}'::jsonb,'ACTIVE',$3,now(),$4,2,'corr-4g-mig25-seed')`,
        [randomUUID(), policyCode, FOUNDER, contentHash]
      ),
      (e: unknown) => (e as { code?: string }).code === '23505'
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('a feature flag row absent entirely means "disabled" — no row exists for an unconfigured flag_code', async () => {
  const p = await pool();
  try {
    const flagCode = `never.configured.${randomUUID()}`;
    const row = await svcQuery(p, `select id from automation_feature_flags where flag_code = $1`, [flagCode]);
    assert.equal(row.rowCount, 0);
  } finally {
    await p.end();
  }
});

gated('automation_feature_flag_history is append-only: AAL2 staff UPDATE/DELETE affect zero rows, row provably unchanged', async () => {
  const p = await pool();
  try {
    const flagId = randomUUID();
    await svcQuery(p, `insert into automation_feature_flags (id, flag_code, enabled, updated_by, correlation_id) values ($1,$2,true,$3,'corr-4g-mig25-seed')`, [flagId, `flag.hist.${randomUUID().slice(0, 8)}`, FOUNDER]);
    const histId = randomUUID();
    await svcQuery(p, `insert into automation_feature_flag_history (id, flag_id, enabled, changed_by, correlation_id) values ($1,$2,true,$3,'corr-4g-mig25-seed')`, [histId, flagId, FOUNDER]);

    await asRole(p, 'authenticated', claimsFor(FOUNDER, 'aal2'), async (c) => {
      const updateResult = await c.query(`update automation_feature_flag_history set enabled = false where id = $1`, [histId]);
      assert.equal(updateResult.rowCount, 0);
      const deleteResult = await c.query(`delete from automation_feature_flag_history where id = $1`, [histId]);
      assert.equal(deleteResult.rowCount, 0);
    });
    const stillThere = await svcQuery(p, `select enabled from automation_feature_flag_history where id = $1`, [histId]);
    assert.equal(stillThere.rows[0].enabled, true);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('founder_control_events is append-only: AAL2 staff UPDATE/DELETE affect zero rows, row provably unchanged', async () => {
  const p = await pool();
  try {
    const eventId = randomUUID();
    await svcQuery(p, `insert into founder_control_events (id, control_kind, action, actor_id, correlation_id) values ($1,'WORKING_HOURS','APPROVED',$2,'corr-4g-mig25-seed')`, [eventId, FOUNDER]);

    await asRole(p, 'authenticated', claimsFor(FOUNDER, 'aal2'), async (c) => {
      const updateResult = await c.query(`update founder_control_events set action = 'TAMPERED' where id = $1`, [eventId]);
      assert.equal(updateResult.rowCount, 0);
      const deleteResult = await c.query(`delete from founder_control_events where id = $1`, [eventId]);
      assert.equal(deleteResult.rowCount, 0);
    });
    const stillThere = await svcQuery(p, `select action from founder_control_events where id = $1`, [eventId]);
    assert.equal(stillThere.rows[0].action, 'APPROVED');
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('escalation destinations are uniquely keyed by destination_code — a duplicate code is refused', async () => {
  const p = await pool();
  try {
    const code = `dest.unique.${randomUUID().slice(0, 8)}`;
    await svcQuery(p, `insert into escalation_destinations (id, destination_code, escalation_kind, target_description, correlation_id) values ($1,$2,'SLA_BREACH','First','corr-4g-mig25-seed')`, [randomUUID(), code]);
    await assert.rejects(
      () => svcQuery(p, `insert into escalation_destinations (id, destination_code, escalation_kind, target_description, correlation_id) values ($1,$2,'DEAD_LETTER','Second','corr-4g-mig25-seed')`, [randomUUID(), code]),
      (e: unknown) => (e as { code?: string }).code === '23505'
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('no Migration 25 table has a column suggesting a credential, secret, password, or API key is stored', async () => {
  const p = await pool();
  try {
    const result = await svcQuery(
      p,
      `select table_name, column_name from information_schema.columns
       where table_schema = 'public' and table_name in ('working_hours_policies','escalation_destinations','automation_feature_flags','automation_feature_flag_history','founder_control_events','automation_pause_controls')
       and (column_name ilike '%password%' or column_name ilike '%api_key%' or column_name ilike '%api_secret%' or column_name ilike '%credential%' or column_name ilike '%secret%')`
    );
    assert.equal(result.rowCount, 0, `found suspicious columns: ${JSON.stringify(result.rows)}`);
  } finally {
    await p.end();
  }
});
