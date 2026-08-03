import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { SupabaseJourneyServicePorts } from '@/server/agents/automation/production-journey-ports';
import { InMemoryConversationStore } from '@/server/agents/in-memory-conversation-store';
import { InMemoryQuoteStore } from '@/server/supplier/in-memory-quote-store';
import { InMemoryPaymentLinkStore } from '@/server/payment/in-memory-payment-link-store';
import { InMemoryPortalTaskStore } from '@/server/agents/supplier-ops/portal-task-store';
import { InMemoryPlanStore } from '@/server/agents/subscriptions/plan-store';
import type { SubscriptionContextLoader } from '@/server/agents/subscriptions/subscription-context-queries';
import { AutomationAuthorityError } from '@/server/agents/automation/automation-contract';

const FIXED = new Date('2026-08-01T09:00:00.000Z');
const NO_EXISTING_SUBSCRIPTION: SubscriptionContextLoader = { loadPersonal: async () => null, loadCorporate: async () => null };

function makePorts() {
  const conversationStore = new InMemoryConversationStore();
  const quoteStore = new InMemoryQuoteStore();
  const paymentLinkStore = new InMemoryPaymentLinkStore();
  const portalTaskStore = new InMemoryPortalTaskStore();
  const planStore = new InMemoryPlanStore();
  const ports = new SupabaseJourneyServicePorts(
    { correlationId: `corr-${randomUUID().slice(0, 8)}`, now: () => FIXED, actorId: 'system', actorKind: 'system' },
    { conversationStore, quoteStore, paymentLinkStore, portalTaskStore, planStore, subscriptionContextLoader: NO_EXISTING_SUBSCRIPTION }
  );
  return { ports, portalTaskStore, conversationStore };
}

const AUDITED_FILES = [
  'production-journey-ports.ts', 'journey-stage-executor.ts', 'booking-command-port.ts',
  'founder-controls.ts', 'automation-service.ts'
];

test('no audited production automation file contains a "sim-" or "fixture" prefixed identifier literal', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const file of AUDITED_FILES) {
    const raw = await readFile(new URL(`../../src/server/agents/automation/${file}`, import.meta.url), 'utf8');
    const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/['"`]sim-|['"`]fixture-/i.test(codeOnly), `${file} must not contain a sim-/fixture- prefixed literal`);
  }
});

test('production-journey-ports.ts contains no placeholder all-zero or all-one UUID literal', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/automation/production-journey-ports.ts', import.meta.url), 'utf8');
  assert.ok(!/00000000-0000-0000-0000-000000000000/.test(raw));
  assert.ok(!/11111111-1111-1111-1111-111111111111/.test(raw));
});

test('production-journey-ports.ts contains no hardcoded date literal that could be mistaken for a fabricated booking or supplier date', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/automation/production-journey-ports.ts', import.meta.url), 'utf8');
  const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/['"]202\d-\d{2}-\d{2}['"]/.test(codeOnly));
});

test('production-journey-ports.ts contains no unconditional/hardcoded subscription plan-code literal returned from recommendApprovedSubscription', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/automation/production-journey-ports.ts', import.meta.url), 'utf8');
  assert.ok(!/return\s*\{[^}]*planCode:\s*['"]PERSONAL/.test(raw));
});

test('every store field in SupabaseJourneyServicePorts defaults to a real Supabase-backed adapter, never an in-memory class, in the constructor', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/automation/production-journey-ports.ts', import.meta.url), 'utf8');
  const constructorSection = raw.slice(raw.indexOf('constructor('), raw.indexOf('constructor(') + 1200);
  assert.ok(!/new InMemory\w+Store\(\)/.test(constructorSection), 'constructor defaults must never instantiate an in-memory store');
  assert.ok(/new Supabase\w+Store\(\)/.test(constructorSection), 'constructor defaults must instantiate real Supabase-backed stores');
});

test('portal-task supplier confirmation and service-booking confirmation are two distinct events with two distinct ids', async () => {
  const { ports, portalTaskStore } = makePorts();
  const taskId = randomUUID();
  const now = FIXED.toISOString();
  await portalTaskStore.saveTask({
    portalTaskId: taskId, supplierId: randomUUID(), contractId: null, conversationId: null, contactId: randomUUID(),
    status: 'CONFIRMED', bookingData: {}, proposedMarkup: null, checklist: [], assignedOwnerId: randomUUID(),
    supplierConfirmationReference: 'SUP-REF-12345', voucherMetadata: null, correlationId: 'corr-test', createdAt: now, updatedAt: now
  });

  const result = await ports.recordHumanBookingConfirmation(taskId, randomUUID());
  assert.notEqual(result.bookingId, taskId);
});

test('recordHumanBookingConfirmation refuses when the underlying portal task is not genuinely CONFIRMED — portal-task confirmation cannot be assumed', async () => {
  const { ports, portalTaskStore } = makePorts();
  const taskId = randomUUID();
  const now = FIXED.toISOString();
  await portalTaskStore.saveTask({
    portalTaskId: taskId, supplierId: randomUUID(), contractId: null, conversationId: null, contactId: randomUUID(),
    status: 'READY_FOR_REVIEW', bookingData: {}, proposedMarkup: null, checklist: [], assignedOwnerId: null,
    supplierConfirmationReference: null, voucherMetadata: null, correlationId: 'corr-test', createdAt: now, updatedAt: now
  });
  await assert.rejects(
    () => ports.recordHumanBookingConfirmation(taskId, randomUUID()),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'INVALID_TRANSITION'
  );
});

test('recordHumanBookingConfirmation refuses when the portal task is CONFIRMED but somehow has no supplier confirmation reference', async () => {
  const { ports, portalTaskStore } = makePorts();
  const taskId = randomUUID();
  const now = FIXED.toISOString();
  await portalTaskStore.saveTask({
    portalTaskId: taskId, supplierId: randomUUID(), contractId: null, conversationId: null, contactId: randomUUID(),
    status: 'CONFIRMED', bookingData: {}, proposedMarkup: null, checklist: [], assignedOwnerId: randomUUID(),
    supplierConfirmationReference: null, voucherMetadata: null, correlationId: 'corr-test', createdAt: now, updatedAt: now
  });
  await assert.rejects(
    () => ports.recordHumanBookingConfirmation(taskId, randomUUID()),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'INVALID_TRANSITION'
  );
});

test('activateTripRoom rejects a bare booking id with no traceable portal-task origin — portalTaskId is required', async () => {
  const { ports } = makePorts();
  await assert.rejects(
    () => ports.activateTripRoom(randomUUID()),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'VALIDATION'
  );
});

test('activateTripRoom rejects when the referenced portal task does not exist — never trusts an unverifiable booking id', async () => {
  const { ports } = makePorts();
  await assert.rejects(
    () => ports.activateTripRoom(randomUUID(), randomUUID()),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'NOT_FOUND'
  );
});

test('activateTripRoom rejects portal-task confirmation alone when the task is not genuinely CONFIRMED', async () => {
  const { ports, portalTaskStore } = makePorts();
  const taskId = randomUUID();
  const now = FIXED.toISOString();
  await portalTaskStore.saveTask({
    portalTaskId: taskId, supplierId: randomUUID(), contractId: null, conversationId: null, contactId: randomUUID(),
    status: 'SUPPLIER_PENDING', bookingData: {}, proposedMarkup: null, checklist: [], assignedOwnerId: randomUUID(),
    supplierConfirmationReference: null, voucherMetadata: null, correlationId: 'corr-test', createdAt: now, updatedAt: now
  });
  await assert.rejects(
    () => ports.activateTripRoom(randomUUID(), taskId),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'INVALID_TRANSITION'
  );
});

test('activateTripRoom rejects a supplier reference alone (CONFIRMED status missing) — a reference string is not sufficient by itself', async () => {
  const { ports, portalTaskStore } = makePorts();
  const taskId = randomUUID();
  const now = FIXED.toISOString();
  await portalTaskStore.saveTask({
    portalTaskId: taskId, supplierId: randomUUID(), contractId: null, conversationId: null, contactId: randomUUID(),
    status: 'SUPPLIER_PENDING', bookingData: {}, proposedMarkup: null, checklist: [], assignedOwnerId: randomUUID(),
    supplierConfirmationReference: 'SUP-REF-PREMATURE', voucherMetadata: null, correlationId: 'corr-test', createdAt: now, updatedAt: now
  });
  await assert.rejects(
    () => ports.activateTripRoom(randomUUID(), taskId),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'INVALID_TRANSITION'
  );
});

test('activateTripRoom succeeds only with a genuinely CONFIRMED portal task carrying a real supplier confirmation reference', async () => {
  const { ports, portalTaskStore } = makePorts();
  const taskId = randomUUID();
  const now = FIXED.toISOString();
  await portalTaskStore.saveTask({
    portalTaskId: taskId, supplierId: randomUUID(), contractId: null, conversationId: null, contactId: randomUUID(),
    status: 'CONFIRMED', bookingData: {}, proposedMarkup: null, checklist: [], assignedOwnerId: randomUUID(),
    supplierConfirmationReference: 'SUP-REF-REAL', voucherMetadata: null, correlationId: 'corr-test', createdAt: now, updatedAt: now
  });
  const result = await ports.activateTripRoom(randomUUID(), taskId);
  assert.ok(result.tripRoomId);
});

test('recordHumanBookingConfirmation refuses without a real human confirming actor, mirroring the payment-link and proposal approval pattern', async () => {
  const { ports, portalTaskStore } = makePorts();
  const taskId = randomUUID();
  const now = FIXED.toISOString();
  await portalTaskStore.saveTask({
    portalTaskId: taskId, supplierId: randomUUID(), contractId: null, conversationId: null, contactId: randomUUID(),
    status: 'CONFIRMED', bookingData: {}, proposedMarkup: null, checklist: [], assignedOwnerId: randomUUID(),
    supplierConfirmationReference: 'SUP-REF-X', voucherMetadata: null, correlationId: 'corr-test', createdAt: now, updatedAt: now
  });
  await assert.rejects(
    () => ports.recordHumanBookingConfirmation(taskId, ''),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'MISSING_APPROVAL'
  );
});
