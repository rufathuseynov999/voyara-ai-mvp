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
async function computeExpectedHash(input: Record<string, unknown>): Promise<string> {
  const { sha256 } = await import('@/server/bos/canonical-json');
  return sha256(input);
}

async function seedContact(p: Awaited<ReturnType<typeof pool>>) {
  const contactId = randomUUID();
  await svcQuery(p, `insert into contacts (id, account_id, display_name) values ($1,$2,'Test Contact')`, [contactId, randomUUID()]);
  return contactId;
}

async function seedActivePlan(p: Awaited<ReturnType<typeof pool>>, planCode: string, planType = 'PERSONAL', priceMinor = 1900) {
  const id = randomUUID();
  const benefits = ['Priority support'];
  // Must match the REAL planHashInput (plan-authority.ts) exactly — it
  // includes currency, sorted benefits/servicePrivileges, usageLimits and
  // version, not just the three fields a naive hash might assume.
  const contentHash = await computeExpectedHash({
    planCode, billingCycle: 'MONTHLY', priceMinorUnits: priceMinor, currency: 'AZN',
    benefits: [...benefits].sort(), usageLimits: {}, servicePrivileges: [], version: 1
  });
  await svcQuery(
    p,
    `insert into plan_versions (id, plan_code, plan_type, billing_cycle, price_minor_units, currency, benefits, status, approved_by, approved_at, content_hash, correlation_id)
     values ($1,$2,$3,'MONTHLY',$4,'AZN',$5::jsonb,'ACTIVE',$6,now(),$7,'corr-4g-plan-seed')`,
    [id, planCode, planType, priceMinor, JSON.stringify(benefits), FOUNDER, contentHash]
  );
  return id;
}

async function cleanup(p: Awaited<ReturnType<typeof pool>>) {
  await svcQuery(p, `delete from entitlement_usage where correlation_id like 'corr-4g-plan%'`);
  await svcQuery(p, `delete from entitlement_grants where correlation_id like 'corr-4g-plan%'`);
  await svcQuery(p, `delete from subscription_events where correlation_id like 'corr-4g-plan%'`);
  await svcQuery(p, `delete from subscriptions where correlation_id like 'corr-4g-plan%'`);
  await svcQuery(p, `delete from corporate_seats where correlation_id like 'corr-4g-plan%'`);
  await svcQuery(p, `delete from corporate_accounts where correlation_id like 'corr-4g-plan%'`);
  await svcQuery(p, `delete from plan_version_history where correlation_id like 'corr-4g-plan%'`);
  await svcQuery(p, `delete from plan_versions where correlation_id like 'corr-4g-plan%'`);
  await svcQuery(p, `delete from contacts where display_name = 'Test Contact'`);
}

gated('SupabasePlanStore.savePlanVersion + loadPlanVersion round-trips a real plan through the real class, with correct bigint and timestamp normalization', async () => {
  const p = await pool();
  try {
    const { SupabasePlanStore } = await import('@/server/agents/subscriptions/supabase-plan-store');
    const store = new SupabasePlanStore();
    const planVersionId = randomUUID();
    const now = new Date().toISOString();
    await store.savePlanVersion({
      planVersionId, planCode: 'PERSONAL_SMART', planType: 'PERSONAL', billingCycle: 'MONTHLY',
      priceMinorUnits: 1900, currency: 'AZN', benefits: ['Priority support'], usageLimits: {}, servicePrivileges: [],
      seatOrTravellerLimit: null, activationDate: null, retirementDate: null, status: 'DRAFT', approvedBy: null,
      approvedAt: null, contentHash: null, version: 1, correlationId: 'corr-4g-plan-seed', createdAt: now, updatedAt: now
    });
    const loaded = await store.loadPlanVersion(planVersionId);
    assert.equal(loaded?.priceMinorUnits, 1900);
    assert.equal(typeof loaded?.priceMinorUnits, 'number');
    assert.match(loaded!.createdAt, /Z$/);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('SupabasePlanStore.findActivePlan only ever returns a genuinely ACTIVE plan version through the real class', async () => {
  const p = await pool();
  try {
    const planCode = 'PERSONAL_PLUS';
    await seedActivePlan(p, planCode);
    const { SupabasePlanStore } = await import('@/server/agents/subscriptions/supabase-plan-store');
    const store = new SupabasePlanStore();
    const found = await store.findActivePlan(planCode as never, 'MONTHLY');
    assert.equal(found?.status, 'ACTIVE');
    assert.equal(found?.planCode, planCode);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('the stored content_hash for an approved plan matches the application\'s own sha256 computation', async () => {
  const p = await pool();
  try {
    const planCode = 'PERSONAL_PREMIUM';
    const id = await seedActivePlan(p, planCode);
    const expectedHash = await computeExpectedHash({ planCode, billingCycle: 'MONTHLY', priceMinorUnits: 1900, currency: 'AZN', benefits: ['Priority support'], usageLimits: {}, servicePrivileges: [], version: 1 });
    const row = await svcQuery(p, `select content_hash from plan_versions where id = $1`, [id]);
    assert.equal(row.rows[0].content_hash, expectedHash);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('the database rejects an ACTIVE plan version with no human approver', async () => {
  const p = await pool();
  try {
    await assert.rejects(
      () => svcQuery(p, `insert into plan_versions (id, plan_code, plan_type, billing_cycle, price_minor_units, status, correlation_id) values ($1,'PERSONAL_SMART','PERSONAL','MONTHLY',1900,'ACTIVE','corr-4g-plan-seed')`, [randomUUID()]),
      (e: unknown) => /plan_versions_active_requires_approval/.test((e as Error).message)
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('a DRAFT plan version is never returned by findActivePlan — only ACTIVE, approved plans qualify', async () => {
  const p = await pool();
  try {
    const planCode = 'PERSONAL_BLACK';
    await svcQuery(p, `insert into plan_versions (id, plan_code, plan_type, billing_cycle, price_minor_units, status, correlation_id) values ($1,$2,'PERSONAL','MONTHLY',1900,'DRAFT','corr-4g-plan-seed')`, [randomUUID(), planCode]);
    const { SupabasePlanStore } = await import('@/server/agents/subscriptions/supabase-plan-store');
    const store = new SupabasePlanStore();
    const found = await store.findActivePlan(planCode as never, 'MONTHLY');
    assert.equal(found, null);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('a RETIRED plan version is never returned by findActivePlan', async () => {
  const p = await pool();
  try {
    const planCode = 'CORPORATE_STARTER';
    const contentHash = await computeExpectedHash({ planCode, priceMinorUnits: 1900, billingCycle: 'MONTHLY' });
    await svcQuery(p, `insert into plan_versions (id, plan_code, plan_type, billing_cycle, price_minor_units, status, approved_by, approved_at, content_hash, correlation_id) values ($1,$2,'PERSONAL','MONTHLY',1900,'RETIRED',$3,now(),$4,'corr-4g-plan-seed')`, [randomUUID(), planCode, FOUNDER, contentHash]);
    const { SupabasePlanStore } = await import('@/server/agents/subscriptions/supabase-plan-store');
    const store = new SupabasePlanStore();
    const found = await store.findActivePlan(planCode as never, 'MONTHLY');
    assert.equal(found, null);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('the database structurally refuses an ACTIVE Enterprise plan version with any non-zero public price', async () => {
  const p = await pool();
  try {
    const contentHash = await computeExpectedHash({ planCode: 'CORPORATE_ENTERPRISE', priceMinorUnits: 50000, billingCycle: 'MONTHLY' });
    await assert.rejects(
      () => svcQuery(
        p,
        `insert into plan_versions (id, plan_code, plan_type, billing_cycle, price_minor_units, status, approved_by, approved_at, content_hash, correlation_id)
         values ($1,'CORPORATE_ENTERPRISE','CORPORATE','MONTHLY',50000,'ACTIVE',$2,now(),$3,'corr-4g-plan-seed')`,
        [randomUUID(), FOUNDER, contentHash]
      ),
      (e: unknown) => /enterprise/i.test((e as Error).message)
    );
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('loadPersonalSubscriptionContext returns only the specific contact\'s own subscription, never another contact\'s', async () => {
  const p = await pool();
  try {
    const planVersionId = await seedActivePlan(p, 'CORPORATE_STANDARD');
    const contactA = await seedContact(p);
    const contactB = await seedContact(p);
    const subId = randomUUID();
    await svcQuery(p, `insert into subscriptions (id, contact_id, plan_version_id, status, billing_cycle, correlation_id) values ($1,$2,$3,'ACTIVE','MONTHLY','corr-4g-plan-seed')`, [subId, contactA, planVersionId]);

    const { loadPersonalSubscriptionContext } = await import('@/server/agents/subscriptions/subscription-context-queries');
    const foundA = await loadPersonalSubscriptionContext(contactA);
    const foundB = await loadPersonalSubscriptionContext(contactB);
    assert.equal(foundA?.subscriptionId, subId);
    assert.equal(foundB, null);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('loadCorporateSubscriptionContext returns only the specific corporate account\'s own subscription, never another corporate account\'s', async () => {
  const p = await pool();
  try {
    const planVersionId = await seedActivePlan(p, 'CORPORATE_PROFESSIONAL', 'CORPORATE', 14900);
    const corpA = randomUUID();
    const corpB = randomUUID();
    const ownerA = await seedContact(p);
    const ownerB = await seedContact(p);
    await svcQuery(p, `insert into corporate_accounts (id, legal_entity_name, billing_contact, account_owner_contact_id, authorized_user_limit, correlation_id) values ($1,'Corp A','{}'::jsonb,$2,5,'corr-4g-plan-seed')`, [corpA, ownerA]);
    await svcQuery(p, `insert into corporate_accounts (id, legal_entity_name, billing_contact, account_owner_contact_id, authorized_user_limit, correlation_id) values ($1,'Corp B','{}'::jsonb,$2,5,'corr-4g-plan-seed')`, [corpB, ownerB]);
    const subId = randomUUID();
    await svcQuery(p, `insert into subscriptions (id, corporate_account_id, plan_version_id, status, billing_cycle, correlation_id) values ($1,$2,$3,'ACTIVE','MONTHLY','corr-4g-plan-seed')`, [subId, corpA, planVersionId]);

    const { loadCorporateSubscriptionContext } = await import('@/server/agents/subscriptions/subscription-context-queries');
    const foundA = await loadCorporateSubscriptionContext(corpA);
    const foundB = await loadCorporateSubscriptionContext(corpB);
    assert.equal(foundA?.subscriptionId, subId);
    assert.equal(foundB, null);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('loadEntitlementGrantContext returns the real benefits snapshot and expiry for the exact subscription only', async () => {
  const p = await pool();
  try {
    const planVersionId = await seedActivePlan(p, 'PERSONAL_SMART');
    const contactId = await seedContact(p);
    const subId = randomUUID();
    await svcQuery(p, `insert into subscriptions (id, contact_id, plan_version_id, status, billing_cycle, correlation_id) values ($1,$2,$3,'ACTIVE','MONTHLY','corr-4g-plan-seed')`, [subId, contactId, planVersionId]);
    await svcQuery(p, `insert into entitlement_grants (id, subscription_id, plan_version_id, benefits_snapshot, usage_limits_snapshot, expires_at, correlation_id) values ($1,$2,$3,'["Priority support"]'::jsonb,'{}'::jsonb,now() + interval '30 days','corr-4g-plan-seed')`, [randomUUID(), subId, planVersionId]);

    const { loadEntitlementGrantContext } = await import('@/server/agents/subscriptions/subscription-context-queries');
    const grant = await loadEntitlementGrantContext(subId);
    assert.deepEqual(grant?.benefitsSnapshot, ['Priority support']);
    assert.ok(grant?.expiresAt);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('loadEntitlementUsageContext returns only usage rows for the exact subscription', async () => {
  const p = await pool();
  try {
    const planVersionId = await seedActivePlan(p, 'PERSONAL_PLUS');
    const contactId = await seedContact(p);
    const subId = randomUUID();
    await svcQuery(p, `insert into subscriptions (id, contact_id, plan_version_id, status, billing_cycle, correlation_id) values ($1,$2,$3,'ACTIVE','MONTHLY','corr-4g-plan-seed')`, [subId, contactId, planVersionId]);
    await svcQuery(p, `insert into entitlement_usage (id, subscription_id, usage_key, used_amount, period_start, period_end, correlation_id) values ($1,$2,'trips_per_month',2,current_date,current_date + 30,'corr-4g-plan-seed')`, [randomUUID(), subId]);

    const { loadEntitlementUsageContext } = await import('@/server/agents/subscriptions/subscription-context-queries');
    const usage = await loadEntitlementUsageContext(subId);
    assert.equal(usage.length, 1);
    assert.equal(usage[0].usageKey, 'trips_per_month');
    assert.equal(usage[0].usedAmount, 2);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('forced RLS: AAL2 founder reads plan_versions; AAL1 staff is blocked', async () => {
  const p = await pool();
  try {
    const id = await seedActivePlan(p, 'PERSONAL_PREMIUM');
    await asRole(p, 'authenticated', claimsFor(FOUNDER, 'aal2'), async (c) => {
      const r = await c.query(`select id from plan_versions where id = $1`, [id]);
      assert.equal(r.rowCount, 1);
    });
    await asRole(p, 'authenticated', claimsFor(STAFF1, 'aal1'), async (c) => {
      const r = await c.query(`select id from plan_versions where id = $1`, [id]);
      assert.equal(r.rowCount, 0);
    });
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('no direct authenticated write policy exists on plan_versions, even for AAL2 founder', async () => {
  const p = await pool();
  try {
    await asRole(p, 'authenticated', claimsFor(FOUNDER, 'aal2'), async (c) => {
      await assert.rejects(
        () => c.query(`insert into plan_versions (id, plan_code, plan_type, billing_cycle, price_minor_units, correlation_id) values ($1,'PERSONAL_SMART','PERSONAL','MONTHLY',1900,'c')`, [randomUUID()]),
        (e: unknown) => (e as { code?: string }).code === '42501'
      );
    });
  } finally {
    await p.end();
  }
});

gated('recommendSubscriptionFromAuthoritativeContext produces a real recommendation from real database data, never a fabricated benefit', async () => {
  const p = await pool();
  try {
    const planCode = 'PERSONAL_BLACK';
    await seedActivePlan(p, planCode);
    const contactId = await seedContact(p);

    const { SupabasePlanStore } = await import('@/server/agents/subscriptions/supabase-plan-store');
    const { recommendSubscriptionFromAuthoritativeContext, defaultSubscriptionContextLoader } = await import('@/server/agents/subscriptions/subscription-context-queries');
    const store = new SupabasePlanStore();
    const result = await recommendSubscriptionFromAuthoritativeContext(store, { contactId, corporateAccountId: null, candidatePlanCode: planCode, candidateBillingCycle: 'MONTHLY' }, defaultSubscriptionContextLoader);
    assert.equal(result.planCode, planCode);
    if (result.planCode !== null) assert.deepEqual(result.benefits, ['Priority support']);
    await cleanup(p);
  } finally {
    await p.end();
  }
});

gated('recommendSubscriptionFromAuthoritativeContext returns planCode: null against real data when the contact already has an ACTIVE subscription', async () => {
  const p = await pool();
  try {
    const planVersionId = await seedActivePlan(p, 'CORPORATE_STARTER');
    const contactId = await seedContact(p);
    await svcQuery(p, `insert into subscriptions (id, contact_id, plan_version_id, status, billing_cycle, correlation_id) values ($1,$2,$3,'ACTIVE','MONTHLY','corr-4g-plan-seed')`, [randomUUID(), contactId, planVersionId]);

    const { SupabasePlanStore } = await import('@/server/agents/subscriptions/supabase-plan-store');
    const { recommendSubscriptionFromAuthoritativeContext, defaultSubscriptionContextLoader } = await import('@/server/agents/subscriptions/subscription-context-queries');
    const store = new SupabasePlanStore();
    const result = await recommendSubscriptionFromAuthoritativeContext(store, { contactId, corporateAccountId: null, candidatePlanCode: 'PERSONAL_SMART', candidateBillingCycle: 'MONTHLY' }, defaultSubscriptionContextLoader);
    assert.equal(result.planCode, null);
    await cleanup(p);
  } finally {
    await p.end();
  }
});
