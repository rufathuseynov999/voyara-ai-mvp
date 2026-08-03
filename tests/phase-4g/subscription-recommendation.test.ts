import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { recommendSubscriptionFromAuthoritativeContext, type SubscriptionContextLoader } from '@/server/agents/subscriptions/subscription-context-queries';
import { InMemoryPlanStore } from '@/server/agents/subscriptions/plan-store';
import { draftPlanVersion, approveAndActivatePlan } from '@/server/agents/subscriptions/plan-service';

const FIXED = new Date('2026-08-01T09:00:00.000Z');

const NO_EXISTING_SUBSCRIPTION: SubscriptionContextLoader = {
  loadPersonal: async () => null,
  loadCorporate: async () => null
};

function planCtx(store: InMemoryPlanStore) {
  return { store, correlationId: `corr-${randomUUID().slice(0, 8)}`, now: () => FIXED };
}

async function activePlan(store: InMemoryPlanStore, planCode: 'PERSONAL_SMART' | 'CORPORATE_ENTERPRISE' = 'PERSONAL_SMART', billingCycle: 'MONTHLY' | 'ANNUAL' = 'MONTHLY') {
  const ctx = planCtx(store);
  const { planVersionId } = await draftPlanVersion(ctx, {
    planCode, planType: planCode.startsWith('PERSONAL') ? 'PERSONAL' : 'CORPORATE', billingCycle,
    priceMinorUnits: planCode === 'CORPORATE_ENTERPRISE' ? 0 : 1900, currency: 'AZN',
    benefits: ['Priority support', 'Free changes'], usageLimits: { tripsPerMonth: 5 }, servicePrivileges: [],
    seatOrTravellerLimit: null, activationDate: null, retirementDate: null
  });
  await approveAndActivatePlan(ctx, planVersionId, randomUUID());
  return planVersionId;
}

test('with no contact or corporate context supplied, refuses to recommend', async () => {
  const store = new InMemoryPlanStore();
  const result = await recommendSubscriptionFromAuthoritativeContext(store, { contactId: null, corporateAccountId: null, candidatePlanCode: 'PERSONAL_SMART', candidateBillingCycle: 'MONTHLY' }, NO_EXISTING_SUBSCRIPTION);
  assert.equal(result.planCode, null);
  if (result.planCode === null) assert.ok(result.reason.length > 0);
});

test('with no ACTIVE approved plan version for the candidate code, refuses to recommend rather than guessing', async () => {
  const store = new InMemoryPlanStore();
  const result = await recommendSubscriptionFromAuthoritativeContext(store, { contactId: randomUUID(), corporateAccountId: null, candidatePlanCode: 'PERSONAL_SMART', candidateBillingCycle: 'MONTHLY' }, NO_EXISTING_SUBSCRIPTION);
  assert.equal(result.planCode, null);
});

test('a real, ACTIVE, approved plan produces a recommendation using exactly that plan\'s own real benefits — never invented ones', async () => {
  const store = new InMemoryPlanStore();
  await activePlan(store);
  const result = await recommendSubscriptionFromAuthoritativeContext(store, { contactId: randomUUID(), corporateAccountId: null, candidatePlanCode: 'PERSONAL_SMART', candidateBillingCycle: 'MONTHLY' }, NO_EXISTING_SUBSCRIPTION);
  assert.equal(result.planCode, 'PERSONAL_SMART');
  if (result.planCode !== null) {
    assert.deepEqual(result.benefits, ['Priority support', 'Free changes']);
    assert.ok(result.explanation.includes('PERSONAL_SMART'));
  }
});

test('Enterprise plans are never automatically recommended, even if an ACTIVE row somehow existed', async () => {
  const store = new InMemoryPlanStore();
  const ctx = planCtx(store);
  const { planVersionId } = await draftPlanVersion(ctx, {
    planCode: 'CORPORATE_ENTERPRISE', planType: 'CORPORATE', billingCycle: 'MONTHLY', priceMinorUnits: 0, currency: 'AZN',
    benefits: ['Custom'], usageLimits: {}, servicePrivileges: [], seatOrTravellerLimit: null, activationDate: null, retirementDate: null
  });
  await approveAndActivatePlan(ctx, planVersionId, randomUUID());
  const result = await recommendSubscriptionFromAuthoritativeContext(store, { contactId: randomUUID(), corporateAccountId: null, candidatePlanCode: 'CORPORATE_ENTERPRISE', candidateBillingCycle: 'MONTHLY' }, NO_EXISTING_SUBSCRIPTION);
  assert.equal(result.planCode, null);
  if (result.planCode === null) assert.ok(result.reason.includes('Enterprise'));
});

test('a plan whose content has drifted from its approved hash is refused, never recommended', async () => {
  const store = new InMemoryPlanStore();
  const versionId = await activePlan(store);
  const plan = await store.loadPlanVersion(versionId);
  await store.savePlanVersion({ ...plan!, benefits: ['Tampered benefit'] });
  const result = await recommendSubscriptionFromAuthoritativeContext(store, { contactId: randomUUID(), corporateAccountId: null, candidatePlanCode: 'PERSONAL_SMART', candidateBillingCycle: 'MONTHLY' }, NO_EXISTING_SUBSCRIPTION);
  assert.equal(result.planCode, null);
});

test('subscription-context-queries.ts contains no hardcoded benefit, discount, or savings literal that could be mistaken for a fabricated recommendation', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/subscriptions/subscription-context-queries.ts', import.meta.url), 'utf8');
  const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/discount|savings|\d+%\s*off/i.test(codeOnly));
});
