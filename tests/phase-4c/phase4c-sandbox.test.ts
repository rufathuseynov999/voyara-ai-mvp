import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

/**
 * Phase 4C — real PostgreSQL tests for message risk policy, WhatsApp
 * accounts/webhooks, chat sessions, and LLM runs. Same gating/helper pattern
 * as every other sandbox-gated file in this project.
 */

const PG_URL = process.env.VOYARA_PG_TEST_URL;
const gated = PG_URL ? test : test.skip;

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
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

async function seedContactAndConversation(p: Awaited<ReturnType<typeof pool>>) {
  const contactId = randomUUID();
  const conversationId = randomUUID();
  await svcQuery(p, `insert into contacts (id, account_id, display_name) values ($1,$2,'Phase 4C Test Contact')`, [contactId, A]);
  await svcQuery(p, `insert into conversations (id, account_id, contact_id, channel, status, correlation_id) values ($1,$2,$3,'WHATSAPP','OPEN','corr-4c-000001')`, [conversationId, A, contactId]);
  return { contactId, conversationId };
}

async function cleanup(p: Awaited<ReturnType<typeof pool>>) {
  await svcQuery(p, `delete from chat_sessions`);
  await svcQuery(p, `delete from agent_llm_runs`);
  await svcQuery(p, `delete from whatsapp_webhook_receipts`);
  await svcQuery(p, `delete from whatsapp_accounts`);
  await svcQuery(p, `delete from messages`);
  await svcQuery(p, `delete from message_send_policies`);
  await svcQuery(p, `delete from conversations`);
  await svcQuery(p, `delete from contacts`);
}

/* ------------------------------- forced RLS on every new Phase 4C table ------------------------------- */

gated('forced RLS: AAL2 staff read, AAL1 staff and customers blocked, on every Phase 4C table', async () => {
  const p = await pool();
  try {
    const { contactId, conversationId } = await seedContactAndConversation(p);

    const policyId = randomUUID();
    await svcQuery(p, `insert into message_send_policies (id, policy_name, version, policy_hash, knowledge_version, allowed_intents, approved_by, correlation_id) values ($1,'test-policy',1,$2,'kb-1',array['GREETING'],'${FOUNDER}','corr-4c-000002')`, [policyId, 'a'.repeat(64)]);

    const waAccountId = randomUUID();
    await svcQuery(p, `insert into whatsapp_accounts (id, brand, waba_id, phone_number_id, display_phone_number) values ($1,'RTRAVEL','waba-1','phone-1','+994000000000')`, [waAccountId]);

    const receiptId = randomUUID();
    await svcQuery(p, `insert into whatsapp_webhook_receipts (id, event_id, event_type, accepted, correlation_id) values ($1,$2,'messages',true,'corr-4c-000003')`, [receiptId, `evt-${randomUUID()}`]);

    const sessionId = randomUUID();
    await svcQuery(p, `insert into chat_sessions (id, account_id, conversation_id, session_token_hash, expires_at) values ($1,$2,$3,$4, now() + interval '1 hour')`, [sessionId, A, conversationId, 'b'.repeat(64)]);

    const runId = randomUUID();
    await svcQuery(p, `insert into agent_llm_runs (id, conversation_id, model_tier, model_name, simulated, correlation_id) values ($1,$2,'CHEAP','sim-cheap-v1',true,'corr-4c-000004')`, [runId, conversationId]);

    const tables: [string, string][] = [
      ['message_send_policies', policyId], ['whatsapp_accounts', waAccountId], ['whatsapp_webhook_receipts', receiptId],
      ['chat_sessions', sessionId], ['agent_llm_runs', runId]
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

/* --------------------------- anonymous chat session isolation (DB level) --------------------------- */

gated('cross-customer/anonymous isolation: customer B cannot see customer A\'s chat session', async () => {
  const p = await pool();
  try {
    const { conversationId } = await seedContactAndConversation(p);
    const sessionId = randomUUID();
    await svcQuery(p, `insert into chat_sessions (id, account_id, conversation_id, session_token_hash, expires_at) values ($1,$2,$3,$4, now() + interval '1 hour')`, [sessionId, A, conversationId, 'c'.repeat(64)]);

    await asRole(p, 'authenticated', claimsFor(B, 'aal1'), async (c) => {
      const r = await c.query(`select id from chat_sessions where id = $1`, [sessionId]);
      assert.equal(r.rowCount, 0);
    });

    await cleanup(p);
  } finally {
    await p.end();
  }
});

/* ------------------------------ messages_sent_requires_approval_or_policy (real DB) ------------------------------ */

gated('a valid low-risk-policy-authorized SENT message is accepted by the database', async () => {
  const p = await pool();
  try {
    const { conversationId } = await seedContactAndConversation(p);
    const policyId = randomUUID();
    const policyHash = 'd'.repeat(64);
    await svcQuery(p, `insert into message_send_policies (id, policy_name, version, policy_hash, knowledge_version, allowed_intents, approved_by, correlation_id) values ($1,'test-policy-2',1,$2,'kb-1',array['GREETING'],'${FOUNDER}','corr-4c-000005')`, [policyId, policyHash]);

    await svcQuery(
      p,
      `insert into messages (id, conversation_id, direction, sender_kind, agent_role, body, content_hash, status, requires_human_approval, correlation_id, risk_class, policy_id, policy_hash, knowledge_version, model, agent_run_id)
       values ($1,$2,'OUTBOUND','AI_AGENT','sales','Salam!','${'e'.repeat(64)}','SENT',false,'corr-4c-000006','LOW_RISK_INFORMATIONAL',$3,$4,'kb-1','sim-cheap-v1',$5)`,
      [randomUUID(), conversationId, policyId, policyHash, randomUUID()]
    );

    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('the database rejects a SENT message with an incomplete policy authorization (missing agent_run_id)', async () => {
  const p = await pool();
  try {
    const { conversationId } = await seedContactAndConversation(p);
    const policyId = randomUUID();
    await svcQuery(p, `insert into message_send_policies (id, policy_name, version, policy_hash, knowledge_version, allowed_intents, approved_by, correlation_id) values ($1,'test-policy-3',1,$2,'kb-1',array['FAQ'],'${FOUNDER}','corr-4c-000007')`, [policyId, 'f'.repeat(64)]);

    await assert.rejects(
      () => svcQuery(
        p,
        `insert into messages (id, conversation_id, direction, sender_kind, agent_role, body, content_hash, status, requires_human_approval, correlation_id, risk_class, policy_id, policy_hash, knowledge_version, model, agent_run_id)
         values ($1,$2,'OUTBOUND','AI_AGENT','sales','x','${'0'.repeat(64)}','SENT',false,'corr-4c-000008','LOW_RISK_INFORMATIONAL',$3,'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff','kb-1','sim-cheap-v1',null)`,
        [randomUUID(), conversationId, policyId]
      ),
      (e: unknown) => /messages_sent_requires_approval_or_policy|messages_agent_drafts_require_approval_or_policy/.test((e as Error).message)
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('the database rejects a HUMAN_APPROVAL_REQUIRED message that carries a policy id (sensitive messages can never be policy-authorized)', async () => {
  const p = await pool();
  try {
    const { conversationId } = await seedContactAndConversation(p);
    const policyId = randomUUID();
    await svcQuery(p, `insert into message_send_policies (id, policy_name, version, policy_hash, knowledge_version, allowed_intents, approved_by, correlation_id) values ($1,'test-policy-4',1,$2,'kb-1',array['FAQ'],'${FOUNDER}','corr-4c-000009')`, [policyId, '1'.repeat(64)]);

    await assert.rejects(
      () => svcQuery(
        p,
        `insert into messages (id, conversation_id, direction, sender_kind, body, content_hash, status, requires_human_approval, correlation_id, risk_class, policy_id)
         values ($1,$2,'OUTBOUND','STAFF','a price offer','${'2'.repeat(64)}','DRAFTED',true,'corr-4c-000010','HUMAN_APPROVAL_REQUIRED',$3)`,
        [randomUUID(), conversationId, policyId]
      ),
      (e: unknown) => /messages_sensitive_never_policy_authorized/.test((e as Error).message)
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('an INBOUND customer message is accepted as SENT with no approval and no policy (the migration 19 correction)', async () => {
  const p = await pool();
  try {
    const { conversationId } = await seedContactAndConversation(p);
    await svcQuery(
      p,
      `insert into messages (id, conversation_id, direction, sender_kind, body, content_hash, status, requires_human_approval, correlation_id)
       values ($1,$2,'INBOUND','CONTACT','customer message','${'3'.repeat(64)}','SENT',false,'corr-4c-000011')`,
      [randomUUID(), conversationId]
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

/* ------------------------------ WhatsApp webhook concurrency ------------------------------ */

gated('concurrent duplicate WhatsApp webhook event ids produce exactly one accepted receipt (real 23505)', async () => {
  const p = await pool();
  try {
    const eventId = `evt-4c-concurrent-${randomUUID()}`;
    const insertReceipt = async () => {
      const c = await p.connect();
      try {
        await c.query('set role service_role');
        await c.query(`insert into whatsapp_webhook_receipts (id, event_id, event_type, accepted, correlation_id) values ($1,$2,'messages',true,'corr-4c-concurrent')`, [randomUUID(), eventId]);
        return 'ok' as const;
      } catch (error) {
        return (error as { code?: string }).code === '23505' ? ('dup' as const) : Promise.reject(error);
      } finally {
        await c.query('reset role').catch(() => undefined);
        c.release();
      }
    };
    const results = await Promise.all([insertReceipt(), insertReceipt(), insertReceipt(), insertReceipt(), insertReceipt()]);
    assert.equal(results.filter((r) => r === 'ok').length, 1);
    assert.equal(results.filter((r) => r === 'dup').length, 4);
    await svcQuery(p, `delete from whatsapp_webhook_receipts where event_id = $1`, [eventId]);
  } finally {
    await p.end();
  }
});

/* ------------------------------ no card data / secrets stored ------------------------------ */

gated('no table in this project has a column suggesting card data or a raw credential is stored', async () => {
  const p = await pool();
  try {
    const result = await svcQuery(
      p,
      `select table_name, column_name from information_schema.columns
       where table_schema = 'public'
       and (column_name ilike '%card_number%' or column_name ilike '%cvv%' or column_name ilike '%cvc%'
            or column_name ilike '%access_token%' or column_name ilike '%app_secret%' or column_name ilike '%raw_token%')`
    );
    assert.equal(result.rowCount, 0, `found suspicious columns: ${JSON.stringify(result.rows)}`);
  } finally {
    await p.end();
  }
});
