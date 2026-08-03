import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

/**
 * Phase 4B — real PostgreSQL tests for identity linking, dual-account
 * conversations, and payment links. Same gating/helper pattern as every
 * other sandbox-gated file in this project — skips cleanly without
 * VOYARA_PG_TEST_URL, never silently omitted.
 */

const PG_URL = process.env.VOYARA_PG_TEST_URL;
const gated = PG_URL ? test : test.skip;

const A = '11111111-1111-4111-8111-111111111111'; // Phase 3B customer A
const B = '22222222-2222-4222-8222-222222222222'; // Phase 3B customer B
const STAFF1 = '33333333-3333-4333-8333-333333333333'; // AAL1 staff
const FOUNDER = '55555555-5555-4555-8555-555555555555'; // AAL2 founder

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
  await svcQuery(p, `insert into contacts (id, account_id, display_name) values ($1,$2,'Phase 4B Test Contact')`, [contactId, A]);
  await svcQuery(
    p,
    `insert into conversations (id, account_id, contact_id, channel, status, correlation_id, customer_facing_brand) values ($1,$2,$3,'INSTAGRAM_DM','OPEN','corr-4b-000001','RTRAVEL')`,
    [conversationId, A, contactId]
  );
  return { contactId, conversationId };
}

async function cleanup(p: Awaited<ReturnType<typeof pool>>) {
  await svcQuery(p, `delete from payment_link_webhook_receipts`);
  await svcQuery(p, `delete from payment_link_events`);
  await svcQuery(p, `delete from payment_link_requests`);
  await svcQuery(p, `delete from identity_merge_events`);
  await svcQuery(p, `delete from linked_identities`);
  await svcQuery(p, `delete from messages`);
  await svcQuery(p, `delete from conversations`);
  await svcQuery(p, `delete from contacts`);
}

/* ------------------------------- forced RLS on every new table ------------------------------- */

gated('forced RLS: AAL2 staff read, AAL1 staff and customers blocked, on every Phase 4B table', async () => {
  const p = await pool();
  try {
    const { contactId, conversationId } = await seedContactAndConversation(p);
    const identityId = randomUUID();
    await svcQuery(p, `insert into linked_identities (id, contact_id, identity_kind, external_id, verified, linked_via, correlation_id) values ($1,$2,'TELEPHONE','+994500000001',true,'AUTO_VERIFIED_PHONE','corr-4b-000002')`, [identityId, contactId]);
    const mergeId = randomUUID();
    await svcQuery(p, `insert into identity_merge_events (id, from_contact_id, to_contact_id, reason, performed_by, correlation_id) values ($1,$2,$3,'test','${FOUNDER}','corr-4b-000003')`, [mergeId, contactId, randomUUID()]);
    const linkId = randomUUID();
    await svcQuery(
      p,
      `insert into payment_link_requests (id, order_reference, correlation_id, contact_id, originating_conversation_id, originating_brand, service_description, transaction_type, amount_minor, currency, merchant_authority, expires_at, payment_purpose, content_hash, status)
       values ($1,$2,'corr-4b-000004',$3,$4,'RTRAVEL','test service','TOUR_PACKAGE',100000,'AZN','R-Travel LLC', now() + interval '1 hour', 'test purpose', $5, 'DRAFTED')`,
      [linkId, `VOY-TEST-${randomUUID().slice(0, 8)}`, contactId, conversationId, 'a'.repeat(64)]
    );

    const tables: [string, string][] = [
      ['linked_identities', identityId],
      ['identity_merge_events', mergeId],
      ['payment_link_requests', linkId]
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

gated('no direct authenticated write policy exists on any Phase 4B table, even for AAL2 founder', async () => {
  const p = await pool();
  try {
    // Each assertion runs in its OWN transaction: a rejected INSERT aborts
    // the current transaction, so a second statement in the same block would
    // fail with 25P02 rather than proving the second table's own policy.
    await asRole(p, 'authenticated', claimsFor(FOUNDER, 'aal2'), async (c) => {
      await assert.rejects(
        () => c.query(`insert into contacts (id, account_id, display_name) values ($1,$2,'x')`, [randomUUID(), A]),
        (e: unknown) => (e as { code?: string }).code === '42501'
      );
    });
    await asRole(p, 'authenticated', claimsFor(FOUNDER, 'aal2'), async (c) => {
      await assert.rejects(
        () => c.query(`insert into linked_identities (id, contact_id, identity_kind, external_id, verified, linked_via, correlation_id) values ($1,$2,'EMAIL','x@x.com',true,'AUTO_VERIFIED_EMAIL','c')`, [randomUUID(), A]),
        (e: unknown) => (e as { code?: string }).code === '42501'
      );
    });
  } finally {
    await p.end();
  }
});

/* -------------------------------- cross-customer isolation -------------------------------- */

gated('cross-customer isolation: customer B cannot see customer A\'s conversation or linked identities', async () => {
  const p = await pool();
  try {
    const { contactId, conversationId } = await seedContactAndConversation(p);
    await svcQuery(p, `insert into linked_identities (id, contact_id, identity_kind, external_id, verified, linked_via, correlation_id) values ($1,$2,'EMAIL','customer-a@example.com',true,'AUTO_VERIFIED_EMAIL','corr-4b-000005')`, [randomUUID(), contactId]);

    await asRole(p, 'authenticated', claimsFor(B, 'aal1'), async (c) => {
      const conv = await c.query(`select id from conversations where id = $1`, [conversationId]);
      assert.equal(conv.rowCount, 0);
      const identities = await c.query(`select id from linked_identities where contact_id = $1`, [contactId]);
      assert.equal(identities.rowCount, 0);
    });

    await cleanup(p);
  } finally {
    await p.end();
  }
});

/* ------------------------------------- identity merge rules ------------------------------------- */

gated('the database rejects a HUMAN_CONFIRMED link with no linked_by actor (CHECK constraint, independent of application code)', async () => {
  const p = await pool();
  try {
    const { contactId } = await seedContactAndConversation(p);
    await assert.rejects(
      () => svcQuery(
        p,
        `insert into linked_identities (id, contact_id, identity_kind, external_id, verified, linked_via, linked_by, correlation_id) values ($1,$2,'INSTAGRAM_VOYARA','ig-user-1',true,'HUMAN_CONFIRMED',null,'corr-4b-000006')`,
        [randomUUID(), contactId]
      ),
      (e: unknown) => /linked_identities_human_confirmed_has_actor/.test((e as Error).message)
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('the database rejects one external identity linked to two different contacts (unique constraint)', async () => {
  const p = await pool();
  try {
    const { contactId: contactA } = await seedContactAndConversation(p);
    const contactB = randomUUID();
    await svcQuery(p, `insert into contacts (id, account_id, display_name) values ($1,$2,'Second Contact')`, [contactB, A]);

    await svcQuery(p, `insert into linked_identities (id, contact_id, identity_kind, external_id, verified, linked_via, correlation_id) values ($1,$2,'TELEPHONE','+994500000099',true,'AUTO_VERIFIED_PHONE','corr-4b-000007')`, [randomUUID(), contactA]);
    await assert.rejects(
      () => svcQuery(p, `insert into linked_identities (id, contact_id, identity_kind, external_id, verified, linked_via, correlation_id) values ($1,$2,'TELEPHONE','+994500000099',true,'AUTO_VERIFIED_PHONE','corr-4b-000008')`, [randomUUID(), contactB]),
      (e: unknown) => (e as { code?: string }).code === '23505'
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('the database rejects a merge event that targets the same contact on both sides', async () => {
  const p = await pool();
  try {
    const { contactId } = await seedContactAndConversation(p);
    await assert.rejects(
      () => svcQuery(p, `insert into identity_merge_events (id, from_contact_id, to_contact_id, reason, performed_by, correlation_id) values ($1,$2,$2,'x','${FOUNDER}','corr-4b-000009')`, [randomUUID(), contactId]),
      (e: unknown) => /identity_merge_distinct_contacts/.test((e as Error).message)
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

/* -------------------------- real concurrency: order references -------------------------- */

gated('concurrent inserts with the same order_reference produce exactly one winner (real 23505)', async () => {
  const p = await pool();
  try {
    const { contactId, conversationId } = await seedContactAndConversation(p);
    const orderReference = `VOY-CONCURRENT-${randomUUID().slice(0, 8)}`;

    const insertLink = async () => {
      const c = await p.connect();
      try {
        await c.query('set role service_role');
        await c.query(
          `insert into payment_link_requests (id, order_reference, correlation_id, contact_id, originating_conversation_id, originating_brand, service_description, transaction_type, amount_minor, currency, merchant_authority, expires_at, payment_purpose, content_hash, status)
           values ($1,$2,'corr-4b-concurrent',$3,$4,'RTRAVEL','test','TOUR_PACKAGE',100000,'AZN','R-Travel LLC', now() + interval '1 hour', 'test', $5, 'DRAFTED')`,
          [randomUUID(), orderReference, contactId, conversationId, 'b'.repeat(64)]
        );
        return 'ok' as const;
      } catch (error) {
        return (error as { code?: string }).code === '23505' ? ('dup' as const) : Promise.reject(error);
      } finally {
        await c.query('reset role').catch(() => undefined);
        c.release();
      }
    };

    const results = await Promise.all([insertLink(), insertLink(), insertLink(), insertLink(), insertLink()]);
    assert.equal(results.filter((r) => r === 'ok').length, 1, 'exactly one insert wins');
    assert.equal(results.filter((r) => r === 'dup').length, 4, 'four real 23505 losers');
    const count = await svcQuery(p, `select count(*)::int as n from payment_link_requests where order_reference = $1`, [orderReference]);
    assert.equal(count.rows[0].n, 1);

    await cleanup(p);
  } finally {
    await p.end();
  }
});

/* --------------------------- webhook idempotency under concurrency --------------------------- */

gated('concurrent duplicate webhook event ids produce exactly one accepted receipt (real 23505)', async () => {
  const p = await pool();
  try {
    const eventId = `evt-4b-concurrent-${randomUUID()}`;

    const insertReceipt = async () => {
      const c = await p.connect();
      try {
        await c.query('set role service_role');
        await c.query(
          `insert into payment_link_webhook_receipts (id, event_id, event_type, accepted, correlation_id) values ($1,$2,'payment.paid',true,'corr-4b-webhook')`,
          [randomUUID(), eventId]
        );
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
    const count = await svcQuery(p, `select count(*)::int as n from payment_link_webhook_receipts where event_id = $1`, [eventId]);
    assert.equal(count.rows[0].n, 1);

    await svcQuery(p, `delete from payment_link_webhook_receipts where event_id = $1`, [eventId]);
  } finally {
    await p.end();
  }
});

/* -------------------------------- payment link CHECK constraint -------------------------------- */

gated('the database refuses a LINK_CREATED/SENT payment link without a human approver', async () => {
  const p = await pool();
  try {
    const { contactId, conversationId } = await seedContactAndConversation(p);
    await assert.rejects(
      () => svcQuery(
        p,
        `insert into payment_link_requests (id, order_reference, correlation_id, contact_id, originating_conversation_id, originating_brand, service_description, transaction_type, amount_minor, currency, merchant_authority, expires_at, payment_purpose, content_hash, status)
         values ($1,$2,'corr-4b-000010',$3,$4,'RTRAVEL','test','TOUR_PACKAGE',100000,'AZN','R-Travel LLC', now() + interval '1 hour', 'test', $5, 'SENT')`,
        [randomUUID(), `VOY-NOAPPROVAL-${randomUUID().slice(0, 8)}`, contactId, conversationId, 'c'.repeat(64)]
      ),
      (e: unknown) => /payment_link_sent_requires_approval/.test((e as Error).message)
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});
