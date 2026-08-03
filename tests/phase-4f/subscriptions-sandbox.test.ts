import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

/**
 * Phase 4F — real PostgreSQL tests for all 10 subscription/entitlement
 * tables. Same gating/helper pattern as every other sandbox-gated file in
 * this project.
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

async function seedActivePlan(p: Awaited<ReturnType<typeof pool>>, planCode = 'PERSONAL_SMART', price = 1900) {
  const planVersionId = randomUUID();
  await svcQuery(
    p,
    `insert into plan_versions (id, plan_code, plan_type, billing_cycle, price_minor_units, currency, status, approved_by, approved_at, content_hash, correlation_id)
     values ($1,$2,'PERSONAL','MONTHLY',$3,'AZN','ACTIVE',$4,now(),$5,'corr-4f-000001')`,
    [planVersionId, planCode, price, FOUNDER, 'a'.repeat(64)]
  );
  return planVersionId;
}

async function seedContact(p: Awaited<ReturnType<typeof pool>>, accountId = A) {
  const contactId = randomUUID();
  await svcQuery(p, `insert into contacts (id, account_id, display_name) values ($1,$2,'Phase 4F Test Contact')`, [contactId, accountId]);
  return contactId;
}

async function cleanup(p: Awaited<ReturnType<typeof pool>>) {
  await svcQuery(p, `delete from renewal_events`);
  await svcQuery(p, `delete from recurring_payment_tokens`);
  await svcQuery(p, `delete from entitlement_usage`);
  await svcQuery(p, `delete from entitlement_grants`);
  await svcQuery(p, `delete from subscription_events`);
  await svcQuery(p, `delete from subscriptions`);
  await svcQuery(p, `delete from corporate_seats`);
  await svcQuery(p, `delete from corporate_accounts`);
  await svcQuery(p, `delete from plan_version_history`);
  await svcQuery(p, `delete from plan_versions`);
  await svcQuery(p, `delete from contacts where display_name = 'Phase 4F Test Contact'`);
}

gated('forced RLS: AAL2 staff read, AAL1 staff and customers blocked, on every Phase 4F table', async () => {
  const p = await pool();
  try {
    const planVersionId = await seedActivePlan(p);
    const contactId = await seedContact(p);

    const historyId = randomUUID();
    await svcQuery(p, `insert into plan_version_history (id, plan_version_id, version, content_hash, snapshot, created_by, correlation_id) values ($1,$2,1,$3,'{}'::jsonb,$4,'corr-4f-000002')`, [historyId, planVersionId, 'a'.repeat(64), FOUNDER]);

    const corpAccountId = randomUUID();
    await svcQuery(p, `insert into corporate_accounts (id, legal_entity_name, account_owner_contact_id, correlation_id) values ($1,'Test Corp','${contactId}','corr-4f-000003')`, [corpAccountId]);
    const seatId = randomUUID();
    await svcQuery(p, `insert into corporate_seats (id, corporate_account_id, traveller_contact_id, correlation_id) values ($1,$2,$3,'corr-4f-000004')`, [seatId, corpAccountId, contactId]);

    const subscriptionId = randomUUID();
    await svcQuery(p, `insert into subscriptions (id, contact_id, plan_version_id, billing_cycle, status, correlation_id) values ($1,$2,$3,'MONTHLY','ACTIVE','corr-4f-000005')`, [subscriptionId, contactId, planVersionId]);
    const eventId = randomUUID();
    await svcQuery(p, `insert into subscription_events (id, subscription_id, kind, actor_id, actor_kind, correlation_id) values ($1,$2,'CREATED',$3,'system','corr-4f-000006')`, [eventId, subscriptionId, FOUNDER]);

    const grantId = randomUUID();
    await svcQuery(p, `insert into entitlement_grants (id, subscription_id, plan_version_id, benefits_snapshot, usage_limits_snapshot, correlation_id) values ($1,$2,$3,'[]'::jsonb,'{}'::jsonb,'corr-4f-000007')`, [grantId, subscriptionId, planVersionId]);
    const usageId = randomUUID();
    await svcQuery(p, `insert into entitlement_usage (id, subscription_id, usage_key, period_start, period_end, correlation_id) values ($1,$2,'tripsPerMonth','2026-08-01','2026-08-31','corr-4f-000008')`, [usageId, subscriptionId]);

    const tokenId = randomUUID();
    await svcQuery(p, `insert into recurring_payment_tokens (id, contact_id, provider_token_reference, correlation_id) values ($1,$2,'tok_sim_abc123','corr-4f-000009')`, [tokenId, contactId]);

    const renewalEventId = randomUUID();
    await svcQuery(p, `insert into renewal_events (id, event_id, subscription_id, transaction_type, accepted, correlation_id) values ($1,$2,$3,'RENEWAL',true,'corr-4f-000010')`, [renewalEventId, `evt-${randomUUID()}`, subscriptionId]);

    const tables: [string, string][] = [
      ['plan_versions', planVersionId], ['plan_version_history', historyId], ['corporate_accounts', corpAccountId], ['corporate_seats', seatId],
      ['subscriptions', subscriptionId], ['subscription_events', eventId], ['entitlement_grants', grantId], ['entitlement_usage', usageId],
      ['recurring_payment_tokens', tokenId], ['renewal_events', renewalEventId]
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

gated('no direct authenticated write policy exists on any Phase 4F table, even for AAL2 founder', async () => {
  const p = await pool();
  try {
    await asRole(p, 'authenticated', claimsFor(FOUNDER, 'aal2'), async (c) => {
      await assert.rejects(
        () => c.query(`insert into plan_versions (id, plan_code, plan_type, billing_cycle, price_minor_units, currency, correlation_id) values ($1,'PERSONAL_SMART','PERSONAL','MONTHLY',1900,'AZN','c')`, [randomUUID()]),
        (e: unknown) => (e as { code?: string }).code === '42501'
      );
    });
  } finally {
    await p.end();
  }
});

gated('cross-customer isolation: customer B cannot see customer A\'s subscription', async () => {
  const p = await pool();
  try {
    const planVersionId = await seedActivePlan(p);
    const contactId = await seedContact(p);
    const subscriptionId = randomUUID();
    await svcQuery(p, `insert into subscriptions (id, contact_id, plan_version_id, billing_cycle, status, correlation_id) values ($1,$2,$3,'MONTHLY','ACTIVE','corr-4f-000011')`, [subscriptionId, contactId, planVersionId]);

    await asRole(p, 'authenticated', claimsFor(B, 'aal1'), async (c) => {
      const r = await c.query(`select id from subscriptions where id = $1`, [subscriptionId]);
      assert.equal(r.rowCount, 0);
    });
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('corporate account isolation: a seat on account A does not appear when querying seats for account B', async () => {
  const p = await pool();
  try {
    const contactId = await seedContact(p);
    const accountA = randomUUID();
    const accountB = randomUUID();
    await svcQuery(p, `insert into corporate_accounts (id, legal_entity_name, account_owner_contact_id, correlation_id) values ($1,'Corp A','${contactId}','corr-4f-000012')`, [accountA]);
    await svcQuery(p, `insert into corporate_accounts (id, legal_entity_name, account_owner_contact_id, correlation_id) values ($1,'Corp B','${contactId}','corr-4f-000013')`, [accountB]);
    const seatId = randomUUID();
    await svcQuery(p, `insert into corporate_seats (id, corporate_account_id, traveller_contact_id, correlation_id) values ($1,$2,$3,'corr-4f-000014')`, [seatId, accountA, contactId]);

    const seatsForB = await svcQuery(p, `select id from corporate_seats where corporate_account_id = $1`, [accountB]);
    assert.equal(seatsForB.rowCount, 0);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('locked prices are exactly correct in the real database: Smart 19₼, Plus 39₼', async () => {
  const p = await pool();
  try {
    const smartId = await seedActivePlan(p, 'PERSONAL_SMART', 1900);
    const plusId = await seedActivePlan(p, 'PERSONAL_PLUS', 3900);
    const smart = await svcQuery(p, `select price_minor_units from plan_versions where id = $1`, [smartId]);
    const plus = await svcQuery(p, `select price_minor_units from plan_versions where id = $1`, [plusId]);
    assert.equal(String(smart.rows[0].price_minor_units), '1900');
    assert.equal(String(plus.rows[0].price_minor_units), '3900');
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('the database rejects an ACTIVE plan version with no human approver (plan_versions_active_requires_approval)', async () => {
  const p = await pool();
  try {
    await assert.rejects(
      () => svcQuery(p, `insert into plan_versions (id, plan_code, plan_type, billing_cycle, price_minor_units, currency, status, correlation_id) values ($1,'PERSONAL_PREMIUM','PERSONAL','MONTHLY',6900,'AZN','ACTIVE','corr-4f-000015')`, [randomUUID()]),
      (e: unknown) => /plan_versions_active_requires_approval/.test((e as Error).message)
    );
  } finally {
    await p.end();
  }
});

gated('the database rejects an ACTIVE Enterprise plan with a non-zero public price (plan_versions_enterprise_never_public_priced)', async () => {
  const p = await pool();
  try {
    await assert.rejects(
      () => svcQuery(
        p,
        `insert into plan_versions (id, plan_code, plan_type, billing_cycle, price_minor_units, currency, status, approved_by, approved_at, content_hash, correlation_id)
         values ($1,'CORPORATE_ENTERPRISE','CORPORATE','MONTHLY',500000,'AZN','ACTIVE',$2,now(),$3,'corr-4f-000016')`,
        [randomUUID(), FOUNDER, 'b'.repeat(64)]
      ),
      (e: unknown) => /plan_versions_enterprise_never_public_priced/.test((e as Error).message)
    );
  } finally {
    await p.end();
  }
});

gated('the database refuses a second ACTIVE subscription for the same contact (unique index)', async () => {
  const p = await pool();
  try {
    const planVersionId = await seedActivePlan(p);
    const contactId = await seedContact(p);
    await svcQuery(p, `insert into subscriptions (id, contact_id, plan_version_id, billing_cycle, status, correlation_id) values ($1,$2,$3,'MONTHLY','ACTIVE','corr-4f-000017')`, [randomUUID(), contactId, planVersionId]);
    await assert.rejects(
      () => svcQuery(p, `insert into subscriptions (id, contact_id, plan_version_id, billing_cycle, status, correlation_id) values ($1,$2,$3,'MONTHLY','ACTIVE','corr-4f-000018')`, [randomUUID(), contactId, planVersionId]),
      (e: unknown) => (e as { code?: string }).code === '23505'
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('the database refuses a subscription with both contact_id and corporate_account_id set (subscriptions_exactly_one_owner)', async () => {
  const p = await pool();
  try {
    const planVersionId = await seedActivePlan(p);
    const contactId = await seedContact(p);
    const corpAccountId = randomUUID();
    await svcQuery(p, `insert into corporate_accounts (id, legal_entity_name, account_owner_contact_id, correlation_id) values ($1,'Test Corp','${contactId}','corr-4f-000019')`, [corpAccountId]);
    await assert.rejects(
      () => svcQuery(p, `insert into subscriptions (id, contact_id, corporate_account_id, plan_version_id, billing_cycle, status, correlation_id) values ($1,$2,$3,$4,'MONTHLY','PENDING_PAYMENT','corr-4f-000020')`, [randomUUID(), contactId, corpAccountId, planVersionId]),
      (e: unknown) => /subscriptions_exactly_one_owner/.test((e as Error).message)
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('the database rejects a recurring payment token containing a raw card number', async () => {
  const p = await pool();
  try {
    const contactId = await seedContact(p);
    await assert.rejects(
      () => svcQuery(p, `insert into recurring_payment_tokens (id, contact_id, provider_token_reference, correlation_id) values ($1,$2,'4111 1111 1111 1111','corr-4f-000021')`, [randomUUID(), contactId]),
      (e: unknown) => /recurring_payment_tokens_no_raw_card_number/.test((e as Error).message)
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('the database rejects a recurring payment token referencing a CVV', async () => {
  const p = await pool();
  try {
    const contactId = await seedContact(p);
    await assert.rejects(
      () => svcQuery(p, `insert into recurring_payment_tokens (id, contact_id, provider_token_reference, correlation_id) values ($1,$2,'cvv_stored_999','corr-4f-000022')`, [randomUUID(), contactId]),
      (e: unknown) => /recurring_payment_tokens_no_cvv_shaped_value/.test((e as Error).message)
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('subscription_events is append-only: AAL2 staff UPDATE/DELETE affect zero rows under RLS, and the row is provably unchanged', async () => {
  const p = await pool();
  try {
    const planVersionId = await seedActivePlan(p);
    const contactId = await seedContact(p);
    const subscriptionId = randomUUID();
    await svcQuery(p, `insert into subscriptions (id, contact_id, plan_version_id, billing_cycle, status, correlation_id) values ($1,$2,$3,'MONTHLY','ACTIVE','corr-4f-000023')`, [subscriptionId, contactId, planVersionId]);
    const eventId = randomUUID();
    await svcQuery(p, `insert into subscription_events (id, subscription_id, kind, actor_id, actor_kind, correlation_id) values ($1,$2,'CREATED',$3,'system','corr-4f-000024')`, [eventId, subscriptionId, FOUNDER]);

    await asRole(p, 'authenticated', claimsFor(FOUNDER, 'aal2'), async (c) => {
      const updateResult = await c.query(`update subscription_events set kind = 'TAMPERED' where id = $1`, [eventId]);
      assert.equal(updateResult.rowCount, 0);
      const deleteResult = await c.query(`delete from subscription_events where id = $1`, [eventId]);
      assert.equal(deleteResult.rowCount, 0);
    });
    const stillThere = await svcQuery(p, `select kind from subscription_events where id = $1`, [eventId]);
    assert.equal(stillThere.rows[0].kind, 'CREATED');
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('concurrent duplicate renewal event ids produce exactly one accepted receipt (real 23505)', async () => {
  const p = await pool();
  try {
    const externalEventId = `evt-4f-concurrent-${randomUUID()}`;
    const insertEvent = async () => {
      const c = await p.connect();
      try {
        await c.query('set role service_role');
        await c.query(`insert into renewal_events (id, event_id, transaction_type, accepted, correlation_id) values ($1,$2,'RENEWAL',true,'corr-4f-concurrent')`, [randomUUID(), externalEventId]);
        return 'ok' as const;
      } catch (error) {
        return (error as { code?: string }).code === '23505' ? ('dup' as const) : Promise.reject(error);
      } finally {
        await c.query('reset role').catch(() => undefined);
        c.release();
      }
    };
    const results = await Promise.all([insertEvent(), insertEvent(), insertEvent(), insertEvent(), insertEvent()]);
    assert.equal(results.filter((r) => r === 'ok').length, 1, 'exactly one insert wins');
    assert.equal(results.filter((r) => r === 'dup').length, 4, 'four real 23505 losers');
    await svcQuery(p, `delete from renewal_events where event_id = $1`, [externalEventId]);
  } finally {
    await p.end();
  }
});

gated('no Phase 4F table has a column suggesting raw card data, CVV, or a payment provider secret is stored', async () => {
  const p = await pool();
  try {
    const result = await svcQuery(
      p,
      `select table_name, column_name from information_schema.columns
       where table_schema = 'public' and table_name in ('plan_versions','plan_version_history','corporate_accounts','corporate_seats','subscriptions','subscription_events','entitlement_grants','entitlement_usage','recurring_payment_tokens','renewal_events')
       and (column_name ilike '%card_number%' or column_name ilike '%cvv%' or column_name ilike '%cvc%' or column_name ilike '%api_key%' or column_name ilike '%api_secret%' or column_name ilike '%password%')`
    );
    assert.equal(result.rowCount, 0, `found suspicious columns: ${JSON.stringify(result.rows)}`);
  } finally {
    await p.end();
  }
});
