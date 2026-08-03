import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  draftPlanVersion, approveAndActivatePlan, revisePlanVersion, requireActivePlanAuthority, resolveActivePlan,
  type PlanServiceContext, type DraftPlanVersionInput
} from '@/server/agents/subscriptions/plan-service';
import { InMemoryPlanStore } from '@/server/agents/subscriptions/plan-store';
import { PlanAuthorityError, LOCKED_PLAN_PRICES } from '@/server/agents/subscriptions/plan-authority';

const FIXED = new Date('2026-08-01T09:00:00.000Z');

function ctx(): PlanServiceContext & { store: InMemoryPlanStore } {
  return { store: new InMemoryPlanStore(), correlationId: `corr-${randomUUID().slice(0, 8)}`, now: () => FIXED };
}

function basePlanInput(overrides: Partial<DraftPlanVersionInput> = {}): DraftPlanVersionInput {
  return {
    planCode: 'PERSONAL_SMART', planType: 'PERSONAL', billingCycle: 'MONTHLY', priceMinorUnits: 1900, currency: 'AZN',
    benefits: ['Priority support', 'Trip planning assistant'], usageLimits: { tripsPerMonth: 3 }, servicePrivileges: ['STANDARD_CONCIERGE'],
    seatOrTravellerLimit: null, activationDate: '2026-01-01', retirementDate: null,
    ...overrides
  };
}

test('drafting a plan with the exact founder-locked price succeeds', async () => {
  const c = ctx();
  const { planVersionId } = await draftPlanVersion(c, basePlanInput());
  const plan = await c.store.loadPlanVersion(planVersionId);
  assert.equal(plan?.priceMinorUnits, 1900);
});

test('drafting a plan with a price that does NOT match the locked catalog is refused', async () => {
  const c = ctx();
  await assert.rejects(
    () => draftPlanVersion(c, basePlanInput({ priceMinorUnits: 999999 })),
    (e: unknown) => e instanceof PlanAuthorityError && e.code === 'PRICE_MISMATCH'
  );
});

test('every locked personal and corporate price (except Enterprise) drafts successfully at its exact value', async () => {
  const c = ctx();
  const entries: Array<[keyof typeof LOCKED_PLAN_PRICES, 'MONTHLY' | 'ANNUAL']> = [
    ['PERSONAL_SMART', 'MONTHLY'], ['PERSONAL_SMART', 'ANNUAL'], ['PERSONAL_PLUS', 'MONTHLY'], ['PERSONAL_PLUS', 'ANNUAL'],
    ['PERSONAL_PREMIUM', 'MONTHLY'], ['PERSONAL_PREMIUM', 'ANNUAL'], ['PERSONAL_BLACK', 'MONTHLY'], ['PERSONAL_BLACK', 'ANNUAL'],
    ['CORPORATE_STARTER', 'MONTHLY'], ['CORPORATE_STANDARD', 'MONTHLY'], ['CORPORATE_PROFESSIONAL', 'MONTHLY']
  ];
  for (const [planCode, billingCycle] of entries) {
    const lockedPrice = LOCKED_PLAN_PRICES[planCode][billingCycle];
    const planType = planCode.startsWith('PERSONAL') ? 'PERSONAL' as const : 'CORPORATE' as const;
    const { planVersionId } = await draftPlanVersion(c, basePlanInput({ planCode, planType, billingCycle, priceMinorUnits: lockedPrice! }));
    const plan = await c.store.loadPlanVersion(planVersionId);
    assert.equal(plan?.priceMinorUnits, lockedPrice, `${planCode}/${billingCycle}`);
  }
});

test('exact founder-locked prices are correct: Smart 19₼/190₼, Plus 39₼/390₼, Premium 69₼/690₼, Black 299₼/2990₼', () => {
  assert.deepEqual(LOCKED_PLAN_PRICES.PERSONAL_SMART, { MONTHLY: 1900, ANNUAL: 19000 });
  assert.deepEqual(LOCKED_PLAN_PRICES.PERSONAL_PLUS, { MONTHLY: 3900, ANNUAL: 39000 });
  assert.deepEqual(LOCKED_PLAN_PRICES.PERSONAL_PREMIUM, { MONTHLY: 6900, ANNUAL: 69000 });
  assert.deepEqual(LOCKED_PLAN_PRICES.PERSONAL_BLACK, { MONTHLY: 29900, ANNUAL: 299000 });
  assert.deepEqual(LOCKED_PLAN_PRICES.CORPORATE_STARTER, { MONTHLY: 14900, ANNUAL: null });
  assert.deepEqual(LOCKED_PLAN_PRICES.CORPORATE_STANDARD, { MONTHLY: 29900, ANNUAL: null });
  assert.deepEqual(LOCKED_PLAN_PRICES.CORPORATE_PROFESSIONAL, { MONTHLY: 59900, ANNUAL: null });
});

test('approving a plan sets it ACTIVE with a real approver, timestamp, and content hash', async () => {
  const c = ctx();
  const { planVersionId } = await draftPlanVersion(c, basePlanInput());
  const approver = randomUUID();
  await approveAndActivatePlan(c, planVersionId, approver);
  const plan = await c.store.loadPlanVersion(planVersionId);
  assert.equal(plan?.status, 'ACTIVE');
  assert.equal(plan?.approvedBy, approver);
  assert.ok(plan?.contentHash);
});

test('a DRAFT plan cannot authorize entitlements', async () => {
  const c = ctx();
  const { planVersionId } = await draftPlanVersion(c, basePlanInput());
  await assert.rejects(
    () => requireActivePlanAuthority(c, planVersionId),
    (e: unknown) => e instanceof PlanAuthorityError && e.code === 'NOT_ACTIVE'
  );
});

test('a RETIRED plan cannot authorize entitlements even if formerly active', async () => {
  const c = ctx();
  const { planVersionId } = await draftPlanVersion(c, basePlanInput());
  await approveAndActivatePlan(c, planVersionId, randomUUID());
  const active = await c.store.loadPlanVersion(planVersionId);
  await c.store.savePlanVersion({ ...active!, status: 'RETIRED' });
  await assert.rejects(
    () => requireActivePlanAuthority(c, planVersionId),
    (e: unknown) => e instanceof PlanAuthorityError && e.code === 'RETIRED'
  );
});

test('a plan whose stored hash no longer matches its content is refused (stale-hash discipline)', async () => {
  const c = ctx();
  const { planVersionId } = await draftPlanVersion(c, basePlanInput());
  await approveAndActivatePlan(c, planVersionId, randomUUID());
  const active = await c.store.loadPlanVersion(planVersionId);
  await c.store.savePlanVersion({ ...active!, benefits: ['Tampered benefit list'] });
  await assert.rejects(
    () => requireActivePlanAuthority(c, planVersionId),
    (e: unknown) => e instanceof PlanAuthorityError && e.code === 'STALE_HASH'
  );
});

test('revising a plan appends a new version and reverts to DRAFT, requiring re-approval before publication', async () => {
  const c = ctx();
  const { planVersionId } = await draftPlanVersion(c, basePlanInput());
  await approveAndActivatePlan(c, planVersionId, randomUUID());
  const { newVersion } = await revisePlanVersion(c, planVersionId, { benefits: ['Priority support', 'Trip planning assistant', 'New benefit'] }, randomUUID());
  assert.equal(newVersion, 2);
  const revised = await c.store.loadPlanVersion(planVersionId);
  assert.equal(revised?.status, 'DRAFT');
  await assert.rejects(() => requireActivePlanAuthority(c, planVersionId), (e: unknown) => e instanceof PlanAuthorityError && e.code === 'NOT_ACTIVE');
});

test('an Enterprise plan can be drafted with any price but the schema refuses it as ACTIVE unless price is zero', async () => {
  const c = ctx();
  const { planVersionId } = await draftPlanVersion(c, basePlanInput({ planCode: 'CORPORATE_ENTERPRISE', planType: 'CORPORATE', priceMinorUnits: 500000 }));
  const plan = await c.store.loadPlanVersion(planVersionId);
  const { planVersionSchema } = await import('@/server/agents/subscriptions/plan-authority');
  const attempted = { ...plan!, status: 'ACTIVE' as const, approvedBy: randomUUID(), approvedAt: FIXED.toISOString(), contentHash: 'a'.repeat(64) };
  const result = planVersionSchema.safeParse(attempted);
  assert.equal(result.success, false);
});

test('resolveActivePlan returns null, never a fabricated fallback, when no plan is active', async () => {
  const c = ctx();
  const plan = await resolveActivePlan(c, 'PERSONAL_PLUS', 'MONTHLY');
  assert.equal(plan, null);
});

test('resolveActivePlan returns the genuinely active plan once approved', async () => {
  const c = ctx();
  const { planVersionId } = await draftPlanVersion(c, basePlanInput({ planCode: 'PERSONAL_PLUS', priceMinorUnits: 3900 }));
  await approveAndActivatePlan(c, planVersionId, randomUUID());
  const plan = await resolveActivePlan(c, 'PERSONAL_PLUS', 'MONTHLY');
  assert.equal(plan?.planVersionId, planVersionId);
});
