import assert from 'node:assert/strict';
import test from 'node:test';
import { administrationCommandSchema } from '../../src/server/administration/contract';
import { assertCommandAuthority, AuthorityError } from '../../src/server/bos/authority';

const requestId = 'e1000000-0000-4000-8000-000000000001';
const taskId = 'e1000000-0000-4000-8000-000000000002';
const supplierId = 'e1000000-0000-4000-8000-000000000003';
const hash = 'a'.repeat(64);

test('administration commands are strict, bounded and exact-version-aware', () => {
  assert.equal(administrationCommandSchema.safeParse({
    action: 'crm.task.create',
    travelRequestId: requestId,
    taskType: 'CUSTOMER_FOLLOW_UP',
    title: 'Confirm exact Customer travel preference',
    ownerId: null,
    dueAt: '2026-07-20T10:00:00.000Z',
    note: 'Accountable human follow-up required before commercial preparation.'
  }).success, true);
  assert.equal(administrationCommandSchema.safeParse({
    action: 'crm.task.status.set',
    taskId,
    expectedVersion: 2,
    expectedHash: hash,
    nextStatus: 'DONE',
    note: 'Accountable Customer follow-up completed and recorded.'
  }).success, true);
  assert.equal(administrationCommandSchema.safeParse({
    action: 'crm.task.status.set', taskId, expectedVersion: 2,
    expectedHash: hash, nextStatus: 'VOUCHER_ISSUED', note: 'Invalid authority crossover.'
  }).success, false);
  assert.equal(administrationCommandSchema.safeParse({
    action: 'refund.execute', taskId, expectedVersion: 2, expectedHash: hash
  }).success, false);
});

test('Supplier configuration has no credential, commercial or booking fields', () => {
  const valid = {
    action: 'supplier.configuration.revise',
    supplierId,
    expectedVersion: 1,
    expectedHash: hash,
    displayName: 'Synthetic Hotel Supplier',
    serviceCategory: 'HOTEL',
    operationalChannel: 'EMAIL',
    status: 'ACTIVE',
    operationsNote: 'Use the accountable manual operations channel only.',
    reason: 'Operations contact configuration was reviewed by a Manager.'
  } as const;
  assert.equal(administrationCommandSchema.safeParse(valid).success, true);
  assert.equal(administrationCommandSchema.safeParse({ ...valid, apiKey: 'not-permitted' }).success, false);
  assert.equal(administrationCommandSchema.safeParse({ ...valid, netRate: 100 }).success, false);
  assert.equal(administrationCommandSchema.safeParse({ ...valid, autonomouslyBook: true }).success, false);
});

test('AI cannot operate CRM tasks or Supplier configuration', () => {
  for (const commandName of [
    'crm.task.create', 'crm.task.claim', 'crm.task.status.set',
    'crm.task.reassign', 'crm.task.cancel',
    'supplier.configuration.create', 'supplier.configuration.revise'
  ]) {
    assert.throws(() => assertCommandAuthority({
      commandId: crypto.randomUUID(),
      idempotencyKey: `task011-${commandName}`,
      commandName,
      requestedAt: new Date().toISOString(),
      actor: { id: crypto.randomUUID(), kind: 'ai_agent', roles: ['founder'] },
      payload: {}
    }), AuthorityError);
  }
});
