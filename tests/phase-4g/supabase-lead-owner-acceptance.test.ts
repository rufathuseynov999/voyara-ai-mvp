import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

const PG_URL = process.env.VOYARA_PG_TEST_URL;
const gated = PG_URL ? test : test.skip;

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

async function seedContact(p: Awaited<ReturnType<typeof pool>>) {
  const contactId = randomUUID();
  await svcQuery(p, `insert into contacts (id, account_id, display_name) values ($1,$2,'Test Contact')`, [contactId, randomUUID()]);
  return contactId;
}

async function seedConversation(p: Awaited<ReturnType<typeof pool>>, assignedOwnerId: string | null) {
  const conversationId = randomUUID();
  const contactId = await seedContact(p);
  const accountId = randomUUID();
  await svcQuery(
    p,
    `insert into conversations (id, account_id, contact_id, channel, assigned_owner_id, correlation_id) values ($1,$2,$3,'WEB_CHAT',$4,'corr-4g-owner-seed')`,
    [conversationId, accountId, contactId, assignedOwnerId]
  );
  return { conversationId, accountId };
}

async function cleanup(p: Awaited<ReturnType<typeof pool>>) {
  await svcQuery(p, `delete from agent_idempotency_keys where correlation_id like 'idem-4g-owner%'`);
  await svcQuery(p, `delete from agent_audit_events where correlation_id like 'corr-4g-owner%'`);
  await svcQuery(p, `delete from conversations where correlation_id = 'corr-4g-owner-seed'`);
  await svcQuery(p, `delete from contacts where display_name = 'Test Contact'`);
}

gated('the current assigned owner can accept through the real production store', async () => {
  const p = await pool();
  try {
    const owner = FOUNDER;
    const { conversationId } = await seedConversation(p, owner);
    const { SupabaseLeadOwnerAcceptanceStore } = await import('@/server/agents/automation/supabase-lead-owner-acceptance-store');
    const store = new SupabaseLeadOwnerAcceptanceStore();

    const context = await store.loadConversationOwner(conversationId);
    assert.equal(context?.assignedOwnerId, owner);

    const eventId = randomUUID();
    const reservation = await store.reserveAcceptanceIdempotencyKey(`idem-4g-owner-${randomUUID()}`, eventId);
    assert.equal(reservation.winner, true);
    await store.recordAcceptanceEvent({ eventId, conversationId, actorId: owner, correlationId: 'corr-4g-owner-seed', causationId: null, reasonCode: 'SLA_DEADLINE:2026-08-02T00:00:00.000Z' });

    const row = await svcQuery(p, `select kind, actor_id from agent_audit_events where id = $1`, [eventId]);
    assert.equal(row.rows[0].kind, 'LEAD_OWNER_ACCEPTED');
    assert.equal(row.rows[0].actor_id, owner);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('loadConversationOwner reports the real current owner, so a different actor is provably not the current owner', async () => {
  const p = await pool();
  try {
    const realOwner = FOUNDER;
    const impersonator = STAFF1;
    const { conversationId } = await seedConversation(p, realOwner);
    const { SupabaseLeadOwnerAcceptanceStore } = await import('@/server/agents/automation/supabase-lead-owner-acceptance-store');
    const store = new SupabaseLeadOwnerAcceptanceStore();
    const context = await store.loadConversationOwner(conversationId);
    assert.notEqual(context?.assignedOwnerId, impersonator);
    assert.equal(context?.assignedOwnerId, realOwner);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('loadConversationOwner returns null for a conversation that does not exist — fails closed, never fabricates an owner', async () => {
  const p = await pool();
  try {
    const { SupabaseLeadOwnerAcceptanceStore } = await import('@/server/agents/automation/supabase-lead-owner-acceptance-store');
    const store = new SupabaseLeadOwnerAcceptanceStore();
    const context = await store.loadConversationOwner(randomUUID());
    assert.equal(context, null);
  } finally {
    await p.end();
  }
});

gated('a duplicate acceptance idempotency key reserved through the real production store produces exactly one winner', async () => {
  const p = await pool();
  try {
    const owner = FOUNDER;
    const { conversationId } = await seedConversation(p, owner);
    const { SupabaseLeadOwnerAcceptanceStore } = await import('@/server/agents/automation/supabase-lead-owner-acceptance-store');
    const store = new SupabaseLeadOwnerAcceptanceStore();
    const key = `idem-4g-owner-dup-${randomUUID()}`;
    const eventId1 = randomUUID();
    const eventId2 = randomUUID();
    const first = await store.reserveAcceptanceIdempotencyKey(key, eventId1);
    const second = await store.reserveAcceptanceIdempotencyKey(key, eventId2);
    assert.equal(first.winner, true);
    assert.equal(second.winner, false);
    assert.equal(second.resultId, eventId1);
    void conversationId;
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('concurrent duplicate acceptance idempotency-key reservations produce exactly one winner under real concurrent load', async () => {
  const p = await pool();
  try {
    const { SupabaseLeadOwnerAcceptanceStore } = await import('@/server/agents/automation/supabase-lead-owner-acceptance-store');
    const key = `idem-4g-owner-concurrent-${randomUUID()}`;
    const attempt = async () => {
      try {
        const store = new SupabaseLeadOwnerAcceptanceStore();
        const result = await store.reserveAcceptanceIdempotencyKey(key, randomUUID());
        return result.winner ? ('ok' as const) : ('dup' as const);
      } catch {
        return 'dup' as const;
      }
    };
    const results = await Promise.all([attempt(), attempt(), attempt(), attempt(), attempt()]);
    assert.equal(results.filter((r) => r === 'ok').length, 1);
    await svcQuery(p, `delete from agent_idempotency_keys where key = $1`, [key]);
  } finally {
    await p.end();
  }
});

gated('reassigning a conversation to a new owner is immediately reflected in loadConversationOwner — the original owner is no longer current', async () => {
  const p = await pool();
  try {
    const originalOwner = FOUNDER;
    const newOwner = STAFF1;
    const { conversationId } = await seedConversation(p, originalOwner);
    const { SupabaseLeadOwnerAcceptanceStore } = await import('@/server/agents/automation/supabase-lead-owner-acceptance-store');
    const store = new SupabaseLeadOwnerAcceptanceStore();

    const before = await store.loadConversationOwner(conversationId);
    assert.equal(before?.assignedOwnerId, originalOwner);

    await svcQuery(p, `update conversations set assigned_owner_id = $2 where id = $1`, [conversationId, newOwner]);

    const after = await store.loadConversationOwner(conversationId);
    assert.equal(after?.assignedOwnerId, newOwner);
    assert.notEqual(after?.assignedOwnerId, originalOwner);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('agent_audit_events acceptance rows are append-only: AAL2 staff UPDATE/DELETE affect zero rows, row provably unchanged', async () => {
  const p = await pool();
  try {
    const owner = FOUNDER;
    const { conversationId } = await seedConversation(p, owner);
    const { SupabaseLeadOwnerAcceptanceStore } = await import('@/server/agents/automation/supabase-lead-owner-acceptance-store');
    const store = new SupabaseLeadOwnerAcceptanceStore();
    const eventId = randomUUID();
    await store.recordAcceptanceEvent({ eventId, conversationId, actorId: owner, correlationId: 'corr-4g-owner-seed', causationId: null, reasonCode: 'SLA_DEADLINE:test' });

    await asRole(p, 'authenticated', claimsFor(FOUNDER, 'aal2'), async (c) => {
      const updateResult = await c.query(`update agent_audit_events set kind = 'TAMPERED' where id = $1`, [eventId]);
      assert.equal(updateResult.rowCount, 0);
      const deleteResult = await c.query(`delete from agent_audit_events where id = $1`, [eventId]);
      assert.equal(deleteResult.rowCount, 0);
    });
    const stillThere = await svcQuery(p, `select kind from agent_audit_events where id = $1`, [eventId]);
    assert.equal(stillThere.rows[0].kind, 'LEAD_OWNER_ACCEPTED');
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('forced RLS: AAL2 founder reads conversations; AAL1 staff is blocked', async () => {
  const p = await pool();
  try {
    const { conversationId } = await seedConversation(p, FOUNDER);
    await asRole(p, 'authenticated', claimsFor(FOUNDER, 'aal2'), async (c) => {
      const r = await c.query(`select id from conversations where id = $1`, [conversationId]);
      assert.equal(r.rowCount, 1);
    });
    await asRole(p, 'authenticated', claimsFor(STAFF1, 'aal1'), async (c) => {
      const r = await c.query(`select id from conversations where id = $1`, [conversationId]);
      assert.equal(r.rowCount, 0);
    });
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('two conversations for two different accounts and owners never leak into each other via loadConversationOwner', async () => {
  const p = await pool();
  try {
    const ownerA = FOUNDER;
    const ownerB = STAFF1;
    const { conversationId: conversationA } = await seedConversation(p, ownerA);
    const { conversationId: conversationB } = await seedConversation(p, ownerB);
    const { SupabaseLeadOwnerAcceptanceStore } = await import('@/server/agents/automation/supabase-lead-owner-acceptance-store');
    const store = new SupabaseLeadOwnerAcceptanceStore();
    const foundA = await store.loadConversationOwner(conversationA);
    const foundB = await store.loadConversationOwner(conversationB);
    assert.equal(foundA?.assignedOwnerId, ownerA);
    assert.equal(foundB?.assignedOwnerId, ownerB);
    assert.notEqual(foundA?.assignedOwnerId, foundB?.assignedOwnerId);
    await cleanup(p);
  } finally {
    await p.end();
  }
});
