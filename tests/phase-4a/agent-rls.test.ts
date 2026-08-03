import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

/**
 * Phase 4A — real PostgreSQL RLS tests for the conversation/CRM tables.
 * Same gating and helper pattern as tests/task-013/db-integration.test.ts —
 * skips cleanly without VOYARA_PG_TEST_URL, never silently omitted.
 */

const PG_URL = process.env.VOYARA_PG_TEST_URL;
const gated = PG_URL ? test : test.skip;

const A = '11111111-1111-4111-8111-111111111111'; // Phase 3B customer A
const STAFF1 = '33333333-3333-4333-8333-333333333333'; // AAL1 staff
const OPS = '44444444-4444-4444-8444-444444444444'; // AAL2 staff
const FOUNDER = '55555555-5555-4555-8555-555555555555'; // AAL2 founder

async function pool() {
  const { Pool } = await import('pg');
  return new Pool({ connectionString: PG_URL, max: 4 });
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

async function seedConversation(p: Awaited<ReturnType<typeof pool>>): Promise<{ contactId: string; conversationId: string; messageId: string }> {
  const contactId = randomUUID();
  const conversationId = randomUUID();
  const messageId = randomUUID();
  await svcQuery(p, `insert into contacts (id, account_id, display_name) values ($1, $2, 'RLS Test Contact')`, [contactId, A]);
  await svcQuery(
    p,
    `insert into conversations (id, account_id, contact_id, channel, status, correlation_id) values ($1,$2,$3,'SIMULATION','OPEN','corr-agent-rls-000001')`,
    [conversationId, A, contactId]
  );
  await svcQuery(
    p,
    `insert into messages (id, conversation_id, direction, sender_kind, body, content_hash, status, requires_human_approval, correlation_id)
     values ($1,$2,'OUTBOUND','AI_AGENT','Hello','${'a'.repeat(64)}','DRAFTED',true,'corr-agent-rls-000001')`,
    [messageId, conversationId]
  );
  return { contactId, conversationId, messageId };
}

async function cleanup(p: Awaited<ReturnType<typeof pool>>): Promise<void> {
  await svcQuery(p, `delete from agent_audit_events`);
  await svcQuery(p, `delete from messages`);
  await svcQuery(p, `delete from conversations`);
  await svcQuery(p, `delete from contacts`);
  await svcQuery(p, `delete from agent_idempotency_keys`);
}

gated('RLS: AAL2 staff read conversations/messages, AAL1 staff and customers are blocked', async () => {
  const p = await pool();
  try {
    const { conversationId, messageId } = await seedConversation(p);

    await asRole(p, 'authenticated', claimsFor(FOUNDER, 'aal2'), async (c) => {
      const conv = await c.query(`select id from conversations where id = $1`, [conversationId]);
      assert.equal(conv.rowCount, 1, 'AAL2 founder reads conversation');
      const msg = await c.query(`select id from messages where id = $1`, [messageId]);
      assert.equal(msg.rowCount, 1, 'AAL2 founder reads message');
    });

    await asRole(p, 'authenticated', claimsFor(OPS, 'aal2'), async (c) => {
      const conv = await c.query(`select id from conversations where id = $1`, [conversationId]);
      assert.equal(conv.rowCount, 1, 'AAL2 ops staff reads conversation');
    });

    await asRole(p, 'authenticated', claimsFor(STAFF1, 'aal1'), async (c) => {
      const conv = await c.query(`select id from conversations where id = $1`, [conversationId]);
      assert.equal(conv.rowCount, 0, 'AAL1 staff blocked from conversations (same rule as orchestration_audit_events)');
    });

    await asRole(p, 'authenticated', claimsFor(A, 'aal1'), async (c) => {
      const conv = await c.query(`select id from conversations where id = $1`, [conversationId]);
      assert.equal(conv.rowCount, 0, 'a customer cannot read the internal CRM inbox — no policy grants this');
    });

    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('RLS: customers cannot write conversations or messages directly (no insert policy => denied)', async () => {
  const p = await pool();
  try {
    await asRole(p, 'authenticated', claimsFor(A, 'aal1'), async (c) => {
      await assert.rejects(
        () => c.query(`insert into contacts (id, account_id, display_name) values ($1, $2, 'x')`, [randomUUID(), A]),
        (e: unknown) => (e as { code?: string }).code === '42501'
      );
    });
    await asRole(p, 'authenticated', claimsFor(FOUNDER, 'aal2'), async (c) => {
      // Even AAL2 staff has no direct write policy — writes go through the
      // service-role store only, same rule as quotes.
      await assert.rejects(
        () => c.query(`insert into contacts (id, account_id, display_name) values ($1, $2, 'x')`, [randomUUID(), A]),
        (e: unknown) => (e as { code?: string }).code === '42501'
      );
    });
  } finally {
    await p.end();
  }
});

gated('database CHECK constraint refuses a SENT message without a human approver, independent of application code', async () => {
  const p = await pool();
  try {
    const { conversationId } = await seedConversation(p);
    await assert.rejects(
      () => svcQuery(
        p,
        `insert into messages (id, conversation_id, direction, sender_kind, body, content_hash, status, requires_human_approval, correlation_id)
         values ($1,$2,'OUTBOUND','AI_AGENT','x','${'b'.repeat(64)}','SENT',true,'corr-agent-rls-000002')`,
        [randomUUID(), conversationId]
      ),
      (e: unknown) => /messages_sent_requires_approval/.test((e as Error).message)
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('agent idempotency key: real concurrent inserts under the same key produce exactly one winner (real 23505)', async () => {
  const p = await pool();
  try {
    const key = `agent-concurrent-${randomUUID()}`;
    const insertKey = async () => {
      const c = await p.connect();
      try {
        await c.query('set role service_role');
        await c.query(
          `insert into agent_idempotency_keys (key, result_id, account_id, actor_id, correlation_id) values ($1,$2,$3,$3,'corr-agent-idem-000001')`,
          [key, randomUUID(), A]
        );
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
    await svcQuery(p, `delete from agent_idempotency_keys where key = $1`, [key]);
  } finally {
    await p.end();
  }
});
