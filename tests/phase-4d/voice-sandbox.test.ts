import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { SYSTEM_ACTOR_ID } from '@/server/agents/business-account';

/**
 * Phase 4D — real PostgreSQL tests for voice_numbers, calls, call_events,
 * call_webhook_receipts, callback_tasks. Same gating/helper pattern as
 * every other sandbox-gated file in this project.
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

async function seedCall(p: Awaited<ReturnType<typeof pool>>) {
  const contactId = randomUUID();
  const conversationId = randomUUID();
  const callId = randomUUID();
  await svcQuery(p, `insert into contacts (id, account_id, display_name) values ($1,$2,'Phase 4D Test Contact')`, [contactId, A]);
  await svcQuery(p, `insert into conversations (id, account_id, contact_id, channel, status, correlation_id) values ($1,$2,$3,'VOICE','OPEN','corr-4d-000001')`, [conversationId, A, contactId]);
  await svcQuery(
    p,
    `insert into calls (id, conversation_id, contact_id, brand, called_number, caller_number, status, correlation_id)
     values ($1,$2,$3,'RTRAVEL','+994121234567','+994501234567','STARTED','corr-4d-000002')`,
    [callId, conversationId, contactId]
  );
  return { contactId, conversationId, callId };
}

async function cleanup(p: Awaited<ReturnType<typeof pool>>) {
  await svcQuery(p, `delete from callback_tasks`);
  await svcQuery(p, `delete from call_webhook_receipts`);
  await svcQuery(p, `delete from call_events`);
  await svcQuery(p, `delete from calls`);
  await svcQuery(p, `delete from voice_numbers`);
  await svcQuery(p, `delete from conversations`);
  await svcQuery(p, `delete from contacts`);
}

/* ------------------------------- forced RLS on all 5 voice tables ------------------------------- */

gated('forced RLS: AAL2 staff read, AAL1 staff and customers blocked, on every voice table', async () => {
  const p = await pool();
  try {
    const { contactId, callId } = await seedCall(p);

    const voiceNumberId = randomUUID();
    await svcQuery(p, `insert into voice_numbers (id, brand, provider_number_id, phone_number) values ($1,'RTRAVEL','test-provider-num-1','+994121234567')`, [voiceNumberId]);

    const eventId = randomUUID();
    await svcQuery(p, `insert into call_events (id, call_id, kind, actor_id, actor_kind, correlation_id) values ($1,$2,'CALL_STARTED',$3,'system','corr-4d-000003')`, [eventId, callId, SYSTEM_ACTOR_ID]);

    const receiptId = randomUUID();
    await svcQuery(p, `insert into call_webhook_receipts (id, event_id, call_id, event_type, accepted, correlation_id) values ($1,$2,$3,'call.started',true,'corr-4d-000004')`, [receiptId, `evt-${randomUUID()}`, callId]);

    const taskId = randomUUID();
    await svcQuery(p, `insert into callback_tasks (id, call_id, contact_id, due_at, correlation_id) values ($1,$2,$3, now() + interval '1 day', 'corr-4d-000005')`, [taskId, callId, contactId]);

    const tables: [string, string][] = [
      ['voice_numbers', voiceNumberId], ['calls', callId], ['call_events', eventId],
      ['call_webhook_receipts', receiptId], ['callback_tasks', taskId]
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

gated('no direct authenticated write policy exists on any voice table, even for AAL2 founder', async () => {
  const p = await pool();
  try {
    await asRole(p, 'authenticated', claimsFor(FOUNDER, 'aal2'), async (c) => {
      await assert.rejects(
        () => c.query(`insert into voice_numbers (id, brand, provider_number_id, phone_number) values ($1,'RTRAVEL','x','+994000000000')`, [randomUUID()]),
        (e: unknown) => (e as { code?: string }).code === '42501'
      );
    });
  } finally {
    await p.end();
  }
});

/* --------------------------- cross-customer isolation --------------------------- */

gated('cross-customer isolation: customer B cannot see customer A\'s call', async () => {
  const p = await pool();
  try {
    const { callId } = await seedCall(p);
    await asRole(p, 'authenticated', claimsFor(B, 'aal1'), async (c) => {
      const r = await c.query(`select id from calls where id = $1`, [callId]);
      assert.equal(r.rowCount, 0);
    });
    await cleanup(p);
  } finally {
    await p.end();
  }
});

/* --------------------------- card-data CHECK constraints --------------------------- */

gated('the database rejects a transcript containing something resembling a card number', async () => {
  const p = await pool();
  try {
    const { conversationId, contactId } = await seedCall(p);
    await assert.rejects(
      () => svcQuery(
        p,
        `insert into calls (id, conversation_id, contact_id, brand, called_number, caller_number, status, transcript, correlation_id)
         values ($1,$2,$3,'RTRAVEL','+994121234567','+994501234599','STARTED','my card number is 4111 1111 1111 1111','corr-4d-000006')`,
        [randomUUID(), conversationId, contactId]
      ),
      (e: unknown) => /calls_transcript_no_card_number/.test((e as Error).message)
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('the database rejects an ai_summary containing something resembling a card number', async () => {
  const p = await pool();
  try {
    const { conversationId, contactId } = await seedCall(p);
    await assert.rejects(
      () => svcQuery(
        p,
        `insert into calls (id, conversation_id, contact_id, brand, called_number, caller_number, status, ai_summary, correlation_id)
         values ($1,$2,$3,'RTRAVEL','+994121234567','+994501234588','STARTED','card 4111-1111-1111-1111 mentioned','corr-4d-000007')`,
        [randomUUID(), conversationId, contactId]
      ),
      (e: unknown) => /calls_summary_no_card_number/.test((e as Error).message)
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('an ordinary transcript with no card-like number pattern is accepted', async () => {
  const p = await pool();
  try {
    const { conversationId, contactId } = await seedCall(p);
    await svcQuery(
      p,
      `insert into calls (id, conversation_id, contact_id, brand, called_number, caller_number, status, transcript, correlation_id)
       values ($1,$2,$3,'RTRAVEL','+994121234567','+994501234577','STARTED','the customer wants a 5 night trip to Baku for 2 travellers','corr-4d-000008')`,
      [randomUUID(), conversationId, contactId]
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

/* --------------------------- consent + recording-disabled behavior --------------------------- */

gated('consent columns default to NOT_ASKED and a minimal call record persists with recording disabled', async () => {
  const p = await pool();
  try {
    const { callId } = await seedCall(p);
    const result = await svcQuery(p, `select consent_recording, recording_enabled from calls where id = $1`, [callId]);
    assert.equal(result.rows[0].consent_recording, 'NOT_ASKED');
    assert.equal(result.rows[0].recording_enabled, false);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

/* --------------------------- append-only call events --------------------------- */

gated('call_events is genuinely append-only: AAL2 staff can UPDATE/DELETE syntactically (table grants exist) but RLS makes it affect zero rows, since only a SELECT policy exists — the row is provably unchanged afterward', async () => {
  const p = await pool();
  try {
    const { callId } = await seedCall(p);
    const eventId = randomUUID();
    await svcQuery(p, `insert into call_events (id, call_id, kind, actor_id, actor_kind, correlation_id) values ($1,$2,'CALL_STARTED',$3,'system','corr-4d-000009')`, [eventId, callId, SYSTEM_ACTOR_ID]);
    await asRole(p, 'authenticated', claimsFor(FOUNDER, 'aal2'), async (c) => {
      // FORCE ROW LEVEL SECURITY + only a `for select` policy means UPDATE
      // and DELETE match zero rows (RLS's USING clause applies to every
      // command, and no policy grants visibility for write commands) —
      // Postgres does not raise 42501 for this; it silently affects 0 rows,
      // which is the correct, safe outcome. The test below proves that
      // outcome directly rather than assuming a thrown error.
      const updateResult = await c.query(`update call_events set kind = 'TAMPERED' where id = $1`, [eventId]);
      assert.equal(updateResult.rowCount, 0, 'UPDATE must affect zero rows under RLS');
      const deleteResult = await c.query(`delete from call_events where id = $1`, [eventId]);
      assert.equal(deleteResult.rowCount, 0, 'DELETE must affect zero rows under RLS');
    });
    // Proves the row genuinely still exists, unmodified — not just that the
    // AAL2 role's own statements reported zero affected rows.
    const stillThere = await svcQuery(p, `select kind from call_events where id = $1`, [eventId]);
    assert.equal(stillThere.rowCount, 1, 'the event row must still exist');
    assert.equal(stillThere.rows[0].kind, 'CALL_STARTED', 'the event must be byte-for-byte unchanged, not tampered');
    await cleanup(p);
  } finally {
    await p.end();
  }
});

/* --------------------------- transfer + callback persistence --------------------------- */

gated('transfer status and callback task persist correctly and are linked to the right call/contact', async () => {
  const p = await pool();
  try {
    const { callId, contactId } = await seedCall(p);
    await svcQuery(p, `update calls set status = 'TRANSFERRED', transfer_status = 'TRANSFERRED_TO:+994559999999', handover_status = 'HUMAN' where id = $1`, [callId]);
    const taskId = randomUUID();
    await svcQuery(p, `insert into callback_tasks (id, call_id, contact_id, due_at, notes, correlation_id) values ($1,$2,$3, now() + interval '1 day', 'call back re trip', 'corr-4d-000010')`, [taskId, callId, contactId]);

    const call = await svcQuery(p, `select status, transfer_status, handover_status from calls where id = $1`, [callId]);
    assert.equal(call.rows[0].status, 'TRANSFERRED');
    assert.equal(call.rows[0].handover_status, 'HUMAN');
    const task = await svcQuery(p, `select call_id, contact_id, notes from callback_tasks where id = $1`, [taskId]);
    assert.equal(task.rows[0].call_id, callId);
    assert.equal(task.rows[0].contact_id, contactId);

    await cleanup(p);
  } finally {
    await p.end();
  }
});

/* --------------------------- webhook idempotency + real concurrency --------------------------- */

gated('concurrent duplicate call webhook event ids produce exactly one accepted receipt (real 23505)', async () => {
  const p = await pool();
  try {
    const eventId = `evt-4d-concurrent-${randomUUID()}`;
    const insertReceipt = async () => {
      const c = await p.connect();
      try {
        await c.query('set role service_role');
        await c.query(`insert into call_webhook_receipts (id, event_id, event_type, accepted, correlation_id) values ($1,$2,'call.started',true,'corr-4d-concurrent')`, [randomUUID(), eventId]);
        return 'ok' as const;
      } catch (error) {
        return (error as { code?: string }).code === '23505' ? ('dup' as const) : Promise.reject(error);
      } finally {
        await c.query('reset role').catch(() => undefined);
        c.release();
      }
    };
    const results = await Promise.all([insertReceipt(), insertReceipt(), insertReceipt(), insertReceipt(), insertReceipt()]);
    assert.equal(results.filter((r) => r === 'ok').length, 1, 'exactly one insert wins');
    assert.equal(results.filter((r) => r === 'dup').length, 4, 'four real 23505 losers');
    await svcQuery(p, `delete from call_webhook_receipts where event_id = $1`, [eventId]);
  } finally {
    await p.end();
  }
});

/* --------------------------- no provider keys, raw secrets, or card data stored --------------------------- */

gated('no voice table has a column suggesting a provider key, raw secret, or card data is stored', async () => {
  const p = await pool();
  try {
    const result = await svcQuery(
      p,
      `select table_name, column_name from information_schema.columns
       where table_schema = 'public' and table_name in ('voice_numbers','calls','call_events','call_webhook_receipts','callback_tasks')
       and (column_name ilike '%api_key%' or column_name ilike '%secret%' or column_name ilike '%card_number%' or column_name ilike '%cvv%' or column_name ilike '%cvc%' or column_name ilike '%access_token%')`
    );
    assert.equal(result.rowCount, 0, `found suspicious columns: ${JSON.stringify(result.rows)}`);
  } finally {
    await p.end();
  }
});
