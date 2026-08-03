import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  assignLeadOwnership, computeLeadResponseDeadline, isLeadPastSlaDeadline, scheduleFollowUp, scheduleReminder,
  scheduleReactivation, scheduleSlaEscalation, InMemorySalesAutomationStore, SalesAutomationError,
  LEAD_FIRST_RESPONSE_SLA_MINUTES, type SalesAutomationContext
} from '@/server/agents/automation/sales-automation';
import { scoreLeadExplainably } from '@/server/agents/automation/lead-scoring';

const FIXED = new Date('2026-08-01T09:00:00.000Z');

function ctx(): SalesAutomationContext & { store: InMemorySalesAutomationStore } {
  return { store: new InMemorySalesAutomationStore(), correlationId: `corr-${randomUUID().slice(0, 8)}`, now: () => FIXED };
}

test('a corporate lead is always routed to corporate sales, regardless of language', () => {
  const owner = assignLeadOwnership({
    isCorporateAccount: true, requestedLanguage: 'ru', personalSalesOwnersByLanguage: { ru: 'personal-ru-owner' }, corporateSalesOwnerId: 'corp-owner'
  });
  assert.equal(owner.ownerKind, 'CORPORATE_SALES');
  assert.equal(owner.ownerId, 'corp-owner');
  assert.ok(owner.reason.includes('Corporate account'));
});

test('a corporate lead with no configured corporate sales owner is refused, never silently assigned to a personal owner', () => {
  assert.throws(
    () => assignLeadOwnership({ isCorporateAccount: true, requestedLanguage: 'az', personalSalesOwnersByLanguage: { az: 'personal-az-owner' }, corporateSalesOwnerId: null }),
    (e: unknown) => e instanceof SalesAutomationError && e.code === 'NO_OWNER_AVAILABLE'
  );
});

test('a personal lead is routed to the correctly language-matched owner', () => {
  const owner = assignLeadOwnership({
    isCorporateAccount: false, requestedLanguage: 'en', personalSalesOwnersByLanguage: { az: 'az-owner', ru: 'ru-owner', en: 'en-owner' }, corporateSalesOwnerId: 'corp-owner'
  });
  assert.equal(owner.ownerKind, 'PERSONAL_SALES');
  assert.equal(owner.ownerId, 'en-owner');
});

test('a personal lead with no owner configured for that language is refused, never assigned an unrelated owner', () => {
  assert.throws(
    () => assignLeadOwnership({ isCorporateAccount: false, requestedLanguage: 'ru', personalSalesOwnersByLanguage: { az: 'az-owner' }, corporateSalesOwnerId: null }),
    (e: unknown) => e instanceof SalesAutomationError && e.code === 'NO_OWNER_AVAILABLE'
  );
});

test('lead qualification reuses the existing explainable lead-scoring service, exposing explicit factors', () => {
  const result = scoreLeadExplainably({
    hasCompleteContactInfo: true, hasStatedBudgetRange: true, hasStatedTravelDates: false, hasRespondedToOutreach: false,
    isReturningCustomer: false, hasActiveSubscription: false, isCorporateAccount: false, engagedWithinLast48Hours: false
  });
  assert.equal(result.score, 30);
  assert.ok(result.factors.every((f) => f.explanation.length > 0));
});

test('computeLeadResponseDeadline adds the founder-approved SLA window', () => {
  const created = '2026-08-01T09:00:00.000Z';
  const deadline = computeLeadResponseDeadline(created);
  assert.equal(deadline, new Date(new Date(created).getTime() + LEAD_FIRST_RESPONSE_SLA_MINUTES * 60000).toISOString());
});

test('a lead past its SLA deadline with no response is correctly flagged', () => {
  const createdLongAgo = new Date(FIXED.getTime() - 60 * 60 * 1000).toISOString();
  assert.equal(isLeadPastSlaDeadline(createdLongAgo, FIXED, null), true);
});

test('a lead that has already responded is never flagged, regardless of elapsed time', () => {
  const createdLongAgo = new Date(FIXED.getTime() - 60 * 60 * 1000).toISOString();
  const respondedAt = new Date(FIXED.getTime() - 50 * 60 * 1000).toISOString();
  assert.equal(isLeadPastSlaDeadline(createdLongAgo, FIXED, respondedAt), false);
});

test('a recently created lead within the SLA window is not yet flagged', () => {
  const recentlyCreated = new Date(FIXED.getTime() - 5 * 60 * 1000).toISOString();
  assert.equal(isLeadPastSlaDeadline(recentlyCreated, FIXED, null), false);
});

test('scheduling a follow-up creates a real scheduled-action record, never sends anything', async () => {
  const c = ctx();
  const leadId = randomUUID();
  const result = await scheduleFollowUp(c, leadId, new Date(FIXED.getTime() + 86400000).toISOString(), 'NO_RESPONSE_24H', `idem-${randomUUID()}`);
  assert.equal(result.created, true);
  const actions = await c.store.loadScheduledActionsForLead(leadId);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].actionCode, 'FOLLOW_UP');
});

test('a retried scheduleFollowUp with the same idempotency key never creates a duplicate follow-up', async () => {
  const c = ctx();
  const leadId = randomUUID();
  const idempotencyKey = `idem-${randomUUID()}`;
  const first = await scheduleFollowUp(c, leadId, new Date(FIXED.getTime() + 86400000).toISOString(), 'NO_RESPONSE_24H', idempotencyKey);
  const second = await scheduleFollowUp(c, leadId, new Date(FIXED.getTime() + 86400000).toISOString(), 'NO_RESPONSE_24H', idempotencyKey);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  const actions = await c.store.loadScheduledActionsForLead(leadId);
  assert.equal(actions.length, 1);
});

test('a proposal reminder is scheduled as a real record with an explicit reason code', async () => {
  const c = ctx();
  const leadId = randomUUID();
  await scheduleReminder(c, leadId, new Date(FIXED.getTime() + 86400000).toISOString(), 'PROPOSAL_REMINDER_48H');
  const actions = await c.store.loadScheduledActionsForLead(leadId);
  assert.equal(actions[0].actionCode, 'REMINDER');
  assert.equal(actions[0].reasonCode, 'PROPOSAL_REMINDER_48H');
});

test('an abandoned-payment reminder is scheduled as a real record with an explicit reason code', async () => {
  const c = ctx();
  const leadId = randomUUID();
  await scheduleReminder(c, leadId, new Date(FIXED.getTime() + 43200000).toISOString(), 'ABANDONED_PAYMENT_LINK_12H');
  const actions = await c.store.loadScheduledActionsForLead(leadId);
  assert.equal(actions[0].reasonCode, 'ABANDONED_PAYMENT_LINK_12H');
});

test('human-owner non-response escalation is scheduled as a real record for the founder-configured destination', async () => {
  const c = ctx();
  const leadId = randomUUID();
  await scheduleSlaEscalation(c, leadId, 'OWNER_NON_RESPONSE_60MIN');
  const actions = await c.store.loadScheduledActionsForLead(leadId);
  assert.equal(actions[0].actionCode, 'SLA_ESCALATION');
  assert.equal(actions[0].reasonCode, 'OWNER_NON_RESPONSE_60MIN');
});

test('scheduling reactivation for a recently-active lead is refused — dormancy must be genuine, not assumed', async () => {
  const c = ctx();
  const recentActivity = new Date(FIXED.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
  await assert.rejects(
    () => scheduleReactivation(c, randomUUID(), recentActivity, 30, new Date(FIXED.getTime() + 86400000).toISOString()),
    (e: unknown) => e instanceof SalesAutomationError && e.code === 'VALIDATION'
  );
});

test('scheduling reactivation for a genuinely dormant lead succeeds and records the dormancy source', async () => {
  const c = ctx();
  const oldActivity = new Date(FIXED.getTime() - 45 * 24 * 60 * 60 * 1000).toISOString();
  const leadId = randomUUID();
  const result = await scheduleReactivation(c, leadId, oldActivity, 30, new Date(FIXED.getTime() + 86400000).toISOString());
  assert.ok(result.actionId);
  const actions = await c.store.loadScheduledActionsForLead(leadId);
  assert.equal(actions[0].actionCode, 'REACTIVATION');
  assert.equal(actions[0].reasonCode, 'DORMANT_30D');
});

test('the sales-automation module contains no function that fabricates a subscription plan or benefit', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/automation/sales-automation.ts', import.meta.url), 'utf8');
  assert.ok(!/planCode\s*:\s*['"]/.test(raw));
});

test('no function anywhere in sales-automation.ts computes or returns conversion probability, CLV, expected revenue, or booking likelihood', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/automation/sales-automation.ts', import.meta.url), 'utf8');
  const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/probability|lifetime.?value|expected.?revenue|financial.?value|\bclv\b|booking.?likelihood/i.test(codeOnly));
});

test('no function anywhere in sales-automation.ts sends a message, creates a payment, or confirms a booking', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/automation/sales-automation.ts', import.meta.url), 'utf8');
  const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/sendOutbound|sendMessage|createPaymentLink|confirmBooking|issueTicket|executeRefund/i.test(codeOnly));
});
