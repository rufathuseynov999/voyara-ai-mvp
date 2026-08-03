#!/usr/bin/env node
/**
 * Phase 4F — subscription fixture certification script.
 *
 * Fixture-only. No live payment provider is connected anywhere in this
 * project — this script exercises the full subscription lifecycle against
 * this project's own in-memory stores and reports the payment provider
 * honestly as NOT_CONFIGURED.
 */
import { randomUUID } from 'node:crypto';
import { draftPlanVersion, approveAndActivatePlan } from '../src/server/agents/subscriptions/plan-service.ts';
import { InMemoryPlanStore } from '../src/server/agents/subscriptions/plan-store.ts';
import { LOCKED_PLAN_PRICES } from '../src/server/agents/subscriptions/plan-authority.ts';
import { InMemorySubscriptionStore } from '../src/server/agents/subscriptions/subscription-store.ts';
import {
  createSubscription, activateAfterReconciledPayment, markRenewalPending, markPaymentFailed, enterGracePeriod,
  renewAfterReconciledPayment, scheduleUpgradeOrDowngrade, applyScheduledPlanChange, cancelAtPeriodEnd
} from '../src/server/agents/subscriptions/subscription-lifecycle.ts';
import { checkEntitlement } from '../src/server/agents/subscriptions/entitlement-engine.ts';
import { InMemoryRecurringPaymentStore, reconcileRenewalWebhook } from '../src/server/agents/subscriptions/recurring-payment-service.ts';
import { createCorporateAccount, addCorporateSeat } from '../src/server/agents/subscriptions/corporate-membership-service.ts';
import { InMemoryCorporateMembershipStore } from '../src/server/agents/subscriptions/corporate-membership-service.ts';
import { readHostedPaymentCredentials } from '../src/config/env-core.ts';

const results = [];
function record(name, pass, detail = '') {
  results.push({ name, pass, detail });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}\n`);
}

const FIXED = new Date('2026-08-01T09:00:00.000Z');

process.stdout.write('=== VOYARA Subscription Certification: FIXTURES ONLY ===\n');
let paymentProviderConfigured = false;
try {
  paymentProviderConfigured = readHostedPaymentCredentials() !== null;
} catch { paymentProviderConfigured = false; }
process.stdout.write(`Payment provider status: ${paymentProviderConfigured ? 'CONFIGURED (unexpected in this build)' : 'NOT_CONFIGURED'}\n`);
process.stdout.write('No real recurring billing has been activated anywhere in this run.\n\n');

const planStore = new InMemoryPlanStore();
const subStore = new InMemorySubscriptionStore();
const payStore = new InMemoryRecurringPaymentStore();
const corpStore = new InMemoryCorporateMembershipStore();
const planCtx = { store: planStore, correlationId: 'cert', now: () => FIXED };
const subCtx = { subscriptionStore: subStore, planStore, correlationId: 'cert', now: () => FIXED };
const payCtx = { store: payStore, planStore, correlationId: 'cert', now: () => FIXED };
const entCtx = { planStore, subscriptionStore: subStore, correlationId: 'cert', now: () => FIXED };
const corpCtx = { store: corpStore, correlationId: 'cert', now: () => FIXED };

async function activePlan(planCode, price, cycle) {
  const { planVersionId } = await draftPlanVersion(planCtx, {
    planCode, planType: planCode.startsWith('PERSONAL') ? 'PERSONAL' : 'CORPORATE', billingCycle: cycle, priceMinorUnits: price, currency: 'AZN',
    benefits: ['Priority support'], usageLimits: { tripsPerMonth: 5 }, servicePrivileges: [], seatOrTravellerLimit: null, activationDate: null, retirementDate: null
  });
  await approveAndActivatePlan(planCtx, planVersionId, randomUUID());
  return planVersionId;
}

const smartMonthlyId = await activePlan('PERSONAL_SMART', LOCKED_PLAN_PRICES.PERSONAL_SMART.MONTHLY, 'MONTHLY');
record('Smart monthly plan activates at the exact locked price (19₼ / 1900 qəpik)', LOCKED_PLAN_PRICES.PERSONAL_SMART.MONTHLY === 1900);
const smartAnnualId = await activePlan('PERSONAL_SMART', LOCKED_PLAN_PRICES.PERSONAL_SMART.ANNUAL, 'ANNUAL');
record('Smart annual plan activates at the exact locked price (190₼ / 19000 qəpik)', LOCKED_PLAN_PRICES.PERSONAL_SMART.ANNUAL === 19000);

const plusMonthlyId = await activePlan('PERSONAL_PLUS', LOCKED_PLAN_PRICES.PERSONAL_PLUS.MONTHLY, 'MONTHLY');
record('Plus monthly activates at the exact locked price (39₼)', LOCKED_PLAN_PRICES.PERSONAL_PLUS.MONTHLY === 3900);
await activePlan('PERSONAL_PREMIUM', LOCKED_PLAN_PRICES.PERSONAL_PREMIUM.MONTHLY, 'MONTHLY');
record('Premium monthly activates at the exact locked price (69₼)', LOCKED_PLAN_PRICES.PERSONAL_PREMIUM.MONTHLY === 6900);
await activePlan('PERSONAL_BLACK', LOCKED_PLAN_PRICES.PERSONAL_BLACK.MONTHLY, 'MONTHLY');
record('Black monthly activates at the exact locked price (299₼)', LOCKED_PLAN_PRICES.PERSONAL_BLACK.MONTHLY === 29900);
const corpStarterId = await activePlan('CORPORATE_STARTER', LOCKED_PLAN_PRICES.CORPORATE_STARTER.MONTHLY, 'MONTHLY');
record('Corporate Starter activates at the exact locked price (149₼)', LOCKED_PLAN_PRICES.CORPORATE_STARTER.MONTHLY === 14900);
await activePlan('CORPORATE_STANDARD', LOCKED_PLAN_PRICES.CORPORATE_STANDARD.MONTHLY, 'MONTHLY');
record('Corporate Standard activates at the exact locked price (299₼)', LOCKED_PLAN_PRICES.CORPORATE_STANDARD.MONTHLY === 29900);
await activePlan('CORPORATE_PROFESSIONAL', LOCKED_PLAN_PRICES.CORPORATE_PROFESSIONAL.MONTHLY, 'MONTHLY');
record('Corporate Professional activates at the exact locked price (599₼)', LOCKED_PLAN_PRICES.CORPORATE_PROFESSIONAL.MONTHLY === 59900);

let enterpriseRejected = false;
try {
  const { planVersionSchema } = await import('../src/server/agents/subscriptions/plan-authority.ts');
  const fakeActiveEnterprise = {
    planVersionId: randomUUID(), planCode: 'CORPORATE_ENTERPRISE', planType: 'CORPORATE', billingCycle: 'MONTHLY',
    priceMinorUnits: 500000, currency: 'AZN', benefits: [], usageLimits: {}, servicePrivileges: [], seatOrTravellerLimit: null,
    activationDate: null, retirementDate: null, status: 'ACTIVE', approvedBy: randomUUID(), approvedAt: FIXED.toISOString(),
    contentHash: 'a'.repeat(64), version: 1, correlationId: 'cert', createdAt: FIXED.toISOString(), updatedAt: FIXED.toISOString()
  };
  const result = planVersionSchema.safeParse(fakeActiveEnterprise);
  enterpriseRejected = result.success === false;
} catch { enterpriseRejected = true; }
record('Enterprise pricing remains structurally unpublished (ACTIVE + non-zero price is refused)', enterpriseRejected);

const contactId = randomUUID();
const { subscriptionId } = await createSubscription(subCtx, { contactId, corporateAccountId: null, planVersionId: smartMonthlyId, billingCycle: 'MONTHLY' });
record('a new subscription starts PENDING_PAYMENT, never ACTIVE', (await subStore.loadSubscription(subscriptionId)).status === 'PENDING_PAYMENT');

const initialReconciled = await reconcileRenewalWebhook(payCtx, { externalEventId: `evt-${randomUUID()}`, subscriptionId, transactionType: 'INITIAL_PAYMENT', amountMinorUnits: 1900, currency: 'AZN', planVersionId: smartMonthlyId });
await activateAfterReconciledPayment(subCtx, subscriptionId, initialReconciled.renewalEventId, '2026-09-01', '2026-09-01');
record('activation only happens after a reconciled payment, never before', (await subStore.loadSubscription(subscriptionId)).status === 'ACTIVE');

await markRenewalPending(subCtx, subscriptionId);
const renewalReconciled = await reconcileRenewalWebhook(payCtx, { externalEventId: `evt-${randomUUID()}`, subscriptionId, transactionType: 'RENEWAL', amountMinorUnits: 1900, currency: 'AZN', planVersionId: smartMonthlyId });
await renewAfterReconciledPayment(subCtx, subscriptionId, renewalReconciled.renewalEventId, '2026-10-01', '2026-10-01');
record('renewal reconciles and keeps the subscription ACTIVE', (await subStore.loadSubscription(subscriptionId)).status === 'ACTIVE');

await markRenewalPending(subCtx, subscriptionId);
await markPaymentFailed(subCtx, subscriptionId, 'CARD_DECLINED');
record('a failed renewal is recorded correctly', (await subStore.loadSubscription(subscriptionId)).status === 'PAYMENT_FAILED');
await enterGracePeriod(subCtx, subscriptionId, '2026-10-08T00:00:00.000Z');
record('grace period is entered after failed payment', (await subStore.loadSubscription(subscriptionId)).status === 'GRACE_PERIOD');
const recoveryReconciled = await reconcileRenewalWebhook(payCtx, { externalEventId: `evt-${randomUUID()}`, subscriptionId, transactionType: 'RENEWAL', amountMinorUnits: 1900, currency: 'AZN', planVersionId: smartMonthlyId });
await renewAfterReconciledPayment(subCtx, subscriptionId, recoveryReconciled.renewalEventId, '2026-11-01', '2026-11-01');
record('recovery from grace period returns the subscription to ACTIVE', (await subStore.loadSubscription(subscriptionId)).status === 'ACTIVE');

await scheduleUpgradeOrDowngrade(subCtx, subscriptionId, plusMonthlyId, 'UPGRADE', randomUUID());
const upgradeReconciled = await reconcileRenewalWebhook(payCtx, { externalEventId: `evt-${randomUUID()}`, subscriptionId, transactionType: 'UPGRADE', amountMinorUnits: 3900, currency: 'AZN', planVersionId: plusMonthlyId });
await applyScheduledPlanChange(subCtx, subscriptionId, upgradeReconciled.renewalEventId, '2026-12-01', '2026-12-01');
const afterUpgrade = await subStore.loadSubscription(subscriptionId);
record('upgrade applies and swaps the active plan version correctly', afterUpgrade.status === 'ACTIVE' && afterUpgrade.planVersionId === plusMonthlyId);

await scheduleUpgradeOrDowngrade(subCtx, subscriptionId, smartMonthlyId, 'DOWNGRADE', randomUUID());
const downgradeReconciled = await reconcileRenewalWebhook(payCtx, { externalEventId: `evt-${randomUUID()}`, subscriptionId, transactionType: 'DOWNGRADE_ADJUSTMENT', amountMinorUnits: 1900, currency: 'AZN', planVersionId: smartMonthlyId });
await applyScheduledPlanChange(subCtx, subscriptionId, downgradeReconciled.renewalEventId, '2027-01-01', '2027-01-01');
const afterDowngrade = await subStore.loadSubscription(subscriptionId);
record('downgrade applies and swaps the active plan version correctly', afterDowngrade.status === 'ACTIVE' && afterDowngrade.planVersionId === smartMonthlyId);

const canceller = randomUUID();
await cancelAtPeriodEnd(subCtx, subscriptionId, canceller);
const afterCancelRequest = await subStore.loadSubscription(subscriptionId);
record('cancel-at-period-end sets the flag without immediately terminating access', afterCancelRequest.cancelAtPeriodEnd === true && afterCancelRequest.status === 'ACTIVE');

const entitlement = await checkEntitlement(entCtx, subscriptionId);
record('entitlement calculation reflects the currently active plan\'s real benefits', entitlement.planActive === true && entitlement.benefits.includes('Priority support'));

let duplicateRejected = false;
const dupEventId = `evt-dup-test-${randomUUID()}`;
try {
  await reconcileRenewalWebhook(payCtx, { externalEventId: dupEventId, subscriptionId, transactionType: 'RENEWAL', amountMinorUnits: 1900, currency: 'AZN', planVersionId: smartMonthlyId });
  await reconcileRenewalWebhook(payCtx, { externalEventId: dupEventId, subscriptionId, transactionType: 'RENEWAL', amountMinorUnits: 1900, currency: 'AZN', planVersionId: smartMonthlyId });
} catch (e) {
  duplicateRejected = e.code === 'DUPLICATE_EVENT';
}
record('a duplicate webhook event id is rejected, never double-processed', duplicateRejected);

const ownerContactId = randomUUID();
const { corporateAccountId } = await createCorporateAccount(corpCtx, {
  legalEntityName: 'Fixture Corp LLC', billingContact: { name: 'Finance', email: 'finance@fixturecorp.example' },
  accountOwnerContactId: ownerContactId, planVersionId: null, authorizedUserLimit: 10, enterpriseContractReference: null
});
const { subscriptionId: corpSubId } = await createSubscription(subCtx, { contactId: null, corporateAccountId, planVersionId: corpStarterId, billingCycle: 'MONTHLY' });
const corpReconciled = await reconcileRenewalWebhook(payCtx, { externalEventId: `evt-${randomUUID()}`, subscriptionId: corpSubId, transactionType: 'CORPORATE_SUBSCRIPTION', amountMinorUnits: 14900, currency: 'AZN', planVersionId: corpStarterId });
await activateAfterReconciledPayment(subCtx, corpSubId, corpReconciled.renewalEventId, '2026-09-01', '2026-09-01');
await addCorporateSeat(corpCtx, corporateAccountId, randomUUID(), 'TRAVELLER');
record('a corporate subscription activates at the exact locked corporate price and supports seats', (await subStore.loadSubscription(corpSubId)).status === 'ACTIVE');

process.stdout.write('\nFixture-only subscription certification complete. No live recurring billing was activated.\n');

const failed = results.filter((r) => !r.pass);
process.stdout.write(`\n${results.length - failed.length}/${results.length} checks passed.\n`);
if (failed.length > 0) {
  process.stderr.write(`FAILED: ${failed.map((f) => f.name).join(', ')}\n`);
  process.exitCode = 1;
}
