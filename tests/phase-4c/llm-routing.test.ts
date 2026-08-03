import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createLlmRouter, LlmRoutingError, llmToolPermissions, routeModelTier, SimulationLlmRouter } from '@/server/agents/llm-routing';

const FIXED = new Date('2026-08-01T09:00:00.000Z');

/* -------------------------------- tiered routing -------------------------------- */

test('FAQ/qualification routes to the cheap tier with an explicit reason', () => {
  const { tier, reason } = routeModelTier('FAQ_OR_QUALIFICATION');
  assert.equal(tier, 'CHEAP');
  assert.ok(reason.length > 0);
});

test('complex travel planning routes to the strong tier with an explicit reason', () => {
  const { tier, reason } = routeModelTier('COMPLEX_TRAVEL_PLANNING');
  assert.equal(tier, 'STRONG');
  assert.ok(reason.length > 0);
});

/* -------------------------------- spending ceiling -------------------------------- */

test('a run within the spending ceiling succeeds and reports cost metadata', async () => {
  const router = new SimulationLlmRouter(() => FIXED);
  const run = await router.run(
    { conversationId: randomUUID(), taskKind: 'FAQ_OR_QUALIFICATION', toolPermissions: ['READ_KNOWLEDGE_BASE'], correlationId: 'corr-1' },
    1000, 0
  );
  assert.equal(run.simulated, true);
  assert.ok(run.estimatedCostMinorUnits > 0);
  assert.equal(run.modelTier, 'CHEAP');
});

test('a run that would exceed the spending ceiling is refused', async () => {
  const router = new SimulationLlmRouter(() => FIXED);
  await assert.rejects(
    () => router.run({ conversationId: randomUUID(), taskKind: 'COMPLEX_TRAVEL_PLANNING', toolPermissions: ['READ_KNOWLEDGE_BASE'], correlationId: 'corr-2' }, 10, 5),
    (e: unknown) => e instanceof LlmRoutingError && e.code === 'SPENDING_CEILING_EXCEEDED'
  );
});

/* -------------------------------- fail-closed registry -------------------------------- */

test('SIMULATION mode constructs a working router', () => {
  const router = createLlmRouter('SIMULATION');
  assert.equal(router.mode, 'SIMULATION');
  assert.equal(router.simulated, true);
});

test('SANDBOX mode fails closed — no LLM credentials exist anywhere in this project', () => {
  assert.throws(() => createLlmRouter('SANDBOX'), (e: unknown) => e instanceof LlmRoutingError && e.code === 'CREDENTIALS_MISSING');
});

test('LIVE mode is never available', () => {
  assert.throws(() => createLlmRouter('LIVE'), (e: unknown) => e instanceof LlmRoutingError && e.code === 'LIVE_NOT_AVAILABLE');
});

/* -------------------------------- structural: no authoritative tool permissions -------------------------------- */

test('the closed tool-permission set has no member resembling a direct DB write, payment, booking, cancellation, or refund', () => {
  const forbidden = ['WRITE', 'PAYMENT', 'BOOK', 'CANCEL', 'REFUND', 'EXECUTE', 'CONFIRM'];
  for (const permission of llmToolPermissions) {
    for (const term of forbidden) {
      assert.ok(!permission.toUpperCase().includes(term), `tool permission "${permission}" must not resemble a forbidden authority (${term})`);
    }
  }
});

test('every tool permission is either read-only or explicitly produces a draft/proposal, not an executed action', () => {
  for (const permission of llmToolPermissions) {
    assert.ok(permission.startsWith('READ_') || permission.startsWith('DRAFT_') || permission.startsWith('PROPOSE_'));
  }
});
